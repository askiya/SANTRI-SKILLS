'use strict';
// SantriHub MCP Hub (stdio, the "santrihub" entry in every AI agent). It answers with the hub
// tools (hub_cari, hub_skill, hub_docs, hub_status; src/hub.js) over all skills, and keeps the
// MCP servers the member switched on in SantriHub (~/.santrihub/gateway.json) behind two tools:
// hub_alat finds a tool, hub_pakai runs it. The agent's tool list stays short however many
// servers there are, and a server only starts when it is needed.
//
//   santriverse-skills mcp-gateway
//
// Changing the server list needs no edit of any agent config, only a reload of the agent.
// Tools only: resources and prompts of the servers behind the hub are not forwarded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { SUPPORTED_PROTOCOLS } = require('./mcp-server');
const { resolveCommand } = require('./runtime-status');
const { loadCatalog } = require('./sources');
const { createHub, rank, readToolCache, writeToolCache, hubHome } = require('./hub');
const pkg = require('../package.json');

const SEP = '__';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const START_TIMEOUT_MS = Number(process.env.SANTRIHUB_GATEWAY_TIMEOUT_MS) || 30000;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

const gatewayFile = (home = os.homedir(), env = process.env) => env.SANTRIHUB_GATEWAY_FILE || path.join(home, '.santrihub', 'gateway.json');

/** { name: { command, args, env? } } from the gateway file; invalid entries are dropped. */
function readGateway(file) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  const out = {};
  for (const [name, e] of Object.entries((cfg && cfg.servers) || {})) {
    if (!NAME_RE.test(name) || name.includes(SEP) || !e || typeof e.command !== 'string' || !Array.isArray(e.args) || e.args.some((a) => typeof a !== 'string')) continue;
    out[name] = { command: e.command, args: e.args, ...(e.env && typeof e.env === 'object' ? { env: e.env } : {}) };
  }
  return out;
}

/** Adds (entry) or removes (null) server `name` in the gateway file, atomically. */
function setGatewayServer(file, name, entry) {
  if (!NAME_RE.test(name) || name.includes(SEP)) throw new Error('Nama MCP tidak bisa dipakai di Gateway.');
  const servers = readGateway(file);
  if (entry) servers[name] = { command: entry.command, args: [...entry.args], ...(entry.env && Object.keys(entry.env).length ? { env: { ...entry.env } } : {}) };
  else delete servers[name];
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ servers }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
  return Object.keys(servers);
}

/** Windows runs npx & co. as .cmd files, which only start through the shell. */
function spawnServer(entry, env) {
  const resolved = resolveCommand(entry.command, env) || entry.command;
  const childEnv = { ...env, ...(entry.env || {}) };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const quote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);
    return spawn([resolved, ...entry.args].map(quote).join(' '), { shell: true, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  }
  return spawn(resolved, entry.args, { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

/** A JSON-RPC client over one server's stdio. */
class Child {
  constructor(name, entry, { env = process.env, log = () => {} } = {}) {
    Object.assign(this, { name, entry, env, log, nextId: 1, pending: new Map(), tools: [] });
  }

  start() {
    this.proc = spawnServer(this.entry, this.env);
    this.proc.stderr.on('data', (d) => this.log(`[${this.name}] ${String(d).trimEnd()}`));
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      const waiter = msg && msg.id != null && this.pending.get(msg.id);
      if (!waiter) return; // server requests/notifications are not supported through the gateway
      this.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message || 'MCP error'), { rpc: msg.error }));
      else waiter.resolve(msg.result);
    });
    const fail = (why) => { for (const w of this.pending.values()) { clearTimeout(w.timer); w.reject(new Error(why)); } this.pending.clear(); this.dead = why; };
    this.proc.on('error', (e) => fail(`${this.name} tidak bisa dijalankan: ${e.message}`));
    this.proc.on('exit', (code) => fail(`${this.name} berhenti (exit ${code}).`));
    this.proc.stdin.on('error', () => {});
  }

  request(method, params, timeout = START_TIMEOUT_MS) {
    if (this.dead) return Promise.reject(new Error(this.dead));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name}: ${method} tidak dijawab dalam ${Math.round(timeout / 1000)} detik.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) { if (!this.dead) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }

  async init() {
    this.start();
    await this.request('initialize', { protocolVersion: SUPPORTED_PROTOCOLS[0], capabilities: {}, clientInfo: { name: 'santrihub-gateway', version: pkg.version } });
    this.notify('notifications/initialized', {});
    let cursor;
    for (let page = 0; page < 20; page++) {
      const res = await this.request('tools/list', cursor ? { cursor } : {});
      this.tools.push(...((res && res.tools) || []).filter((t) => t && typeof t.name === 'string'));
      if (!(cursor = res && res.nextCursor)) break;
    }
    return this;
  }

  stop() { try { this.proc && this.proc.kill(); } catch { /* gone */ } }
}

// santri-skills (or the hub itself) behind the hub would only repeat the hub's own tools.
const SELF = new Set(['santri-skills', 'santrihub']);
const sig = (entry) => crypto.createHash('sha256').update(JSON.stringify([entry.command, entry.args])).digest('hex').slice(0, 16);
const MAX_SCHEMA_CHARS = 1500;

const GATEWAY_TOOLS = [
  {
    name: 'hub_alat',
    description: 'Cari alat (tool) dari MCP lain yang terhubung ke SantriHub: database, GitHub, deploy, dan lainnya. Hasilnya nama server, nama tool dan skema argumennya; jalankan dengan hub_pakai. Tanpa query: daftar MCP beserta tool-nya.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'apa yang mau dilakukan, contoh: "buat tabel di database"' },
        server: { type: 'string', description: 'batasi ke satu MCP (opsional)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'hub_pakai',
    description: 'Jalankan satu tool dari MCP lain lewat SantriHub. Pakai nama server dan tool persis seperti hasil hub_alat; arguments mengikuti skemanya.',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'nama MCP dari hub_alat' },
        tool: { type: 'string', description: 'nama tool dari hub_alat' },
        arguments: { type: 'object', description: 'argumen tool sesuai skema dari hub_alat' },
      },
      required: ['server', 'tool'],
      additionalProperties: false,
    },
  },
];

/**
 * The MCP servers behind the hub. Nothing starts until a tool search needs a server it has never
 * seen or a call needs it; the tools a server offers are cached on disk (tool-cache.json) so later
 * searches do not start it again.
 */
function createGateway(servers, opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || ((line) => process.stderr.write(`[santrihub] ${line}\n`));
  const dir = opts.dir || hubHome(env);
  const entries = Object.fromEntries(Object.entries(servers).filter(([name]) => !SELF.has(name)));
  const children = new Map(); // name → Promise<Child>
  const failures = {};

  function ensure(name) {
    if (!children.has(name)) {
      const child = new Child(name, entries[name], { env, log });
      children.set(name, child.init().then((c) => {
        delete failures[name];
        const cache = readToolCache(dir);
        cache[name] = { sig: sig(entries[name]), at: new Date().toISOString(),
          tools: c.tools.map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 1000), inputSchema: t.inputSchema || { type: 'object' } })) };
        try { writeToolCache(dir, cache); } catch (e) { log(`tool-cache: ${e.message}`); }
        return c;
      }, (e) => {
        failures[name] = e.message;
        log(e.message);
        child.stop();
        children.delete(name); // a later call may try again
        throw e;
      }));
    }
    return children.get(name);
  }

  /** { name: { tools, cached } } for the configured servers, from the cache only. */
  function known() {
    const cache = readToolCache(dir);
    return Object.fromEntries(Object.keys(entries).map((name) => {
      const hit = cache[name] && cache[name].sig === sig(entries[name]) && Array.isArray(cache[name].tools);
      return [name, { tools: hit ? cache[name].tools : [], cached: Boolean(hit) }];
    }));
  }

  async function findTools({ query, server } = {}) {
    if (server && !entries[server]) throw new Error(`MCP '${server}' tidak ada di SantriHub. Yang ada: ${Object.keys(entries).join(', ') || '(belum ada)'}.`);
    const names = server ? [server] : Object.keys(entries);
    if (!names.length) return 'Belum ada MCP lain di SantriHub. Tambahkan di aplikasi SantriHub → Koleksi, lalu nyalakan di panel Gateway.';
    const before = known();
    await Promise.all(names.filter((n) => !before[n].cached).map((n) => ensure(n).catch(() => {})));
    const now = known();
    const failed = names.filter((n) => failures[n]).map((n) => `- ${n}: gagal dijalankan (${failures[n]})`);
    const tail = failed.length ? `\n\nMCP yang gagal:\n${failed.join('\n')}` : '';
    if (!query || !String(query).trim()) {
      const rows = names.map((n) => `- ${n}: ${now[n].tools.length} tool${now[n].tools.length ? ' — ' + now[n].tools.slice(0, 30).map((t) => t.name).join(', ') : ''}`);
      return `MCP di SantriHub:\n${rows.join('\n')}${tail}\n\nCari dengan query untuk melihat skema argumen.`;
    }
    const tools = names.flatMap((n) => now[n].tools.map((t) => ({ id: `${n}/${t.name}`, name: `${n} ${t.name}`, description: t.description || '', paket: [], server: n, tool: t })));
    const hits = rank(tools, query, { limit: 8 });
    if (!hits.length) return `Tidak ada tool untuk '${query}'. Panggil hub_alat tanpa query untuk daftar lengkap.${tail}`;
    const blocks = hits.map((h) => {
      const schema = JSON.stringify(h.tool.inputSchema || { type: 'object' });
      return `- server: ${h.server} · tool: ${h.tool.name}\n  ${h.description.slice(0, 300)}\n  arguments: ${schema.length > MAX_SCHEMA_CHARS ? schema.slice(0, MAX_SCHEMA_CHARS) + '…' : schema}`;
    });
    return `Tool yang cocok (jalankan dengan hub_pakai):\n${blocks.join('\n')}${tail}`;
  }

  async function callDownstream(name, tool, args) {
    if (!entries[name]) throw new Error(`MCP '${name}' tidak ada di SantriHub. Cari dulu dengan hub_alat.`);
    const child = await ensure(name);
    if (!child.tools.some((t) => t.name === tool)) throw new Error(`Tool '${tool}' tidak ada di MCP ${name}. Cari dengan hub_alat.`);
    return child.request('tools/call', { name: tool, arguments: args && typeof args === 'object' ? args : {} }, CALL_TIMEOUT_MS);
  }

  const stop = () => { for (const p of children.values()) p.then((c) => c.stop(), () => {}); };
  return { findTools, callDownstream, known, ensure, stop, failures, entries };
}

function serve({ input = process.stdin, output = process.stdout, env = process.env, servers = readGateway(gatewayFile(os.homedir(), env)) } = {}) {
  const gw = createGateway(servers, { env });
  let catalogPromise;
  // A failed load (offline) is not kept: the next call tries again.
  const catalog = () => (catalogPromise ||= loadCatalog().catch((e) => { catalogPromise = null; throw e; }));
  const hub = createHub({ catalog, env, server: 'santrihub', version: pkg.version, extraServers: gw.known });
  const tools = [...hub.tools, ...GATEWAY_TOOLS];
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  const text = (t) => ({ content: [{ type: 'text', text: t }] });
  const rl = readline.createInterface({ input, terminal: false });
  rl.on('close', () => { gw.stop(); });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: 'Parse error' } }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send({ id: null, error: { code: -32600, message: 'Invalid Request' } });
    const { id, method, params } = msg;
    if (id === undefined) return;
    try {
      if (method === 'initialize') {
        const requested = params && params.protocolVersion;
        hub.setClient(params && params.clientInfo);
        return send({ id, result: { protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'santrihub-gateway', version: pkg.version },
          instructions: `${hub.instructions} Alat dari MCP lain (database, GitHub, deploy …): cari dengan hub_alat, jalankan dengan hub_pakai.` } });
      }
      if (method === 'ping') return send({ id, result: {} });
      if (method === 'tools/list') return send({ id, result: { tools } });
      if (method === 'prompts/list') return send({ id, result: { prompts: hub.prompts } });
      if (method === 'prompts/get') {
        try { return send({ id, result: hub.getPrompt(params && params.name, params && params.arguments) }); } catch (e) { return send({ id, error: { code: e.code || -32000, message: e.message } }); }
      }
      if (method === 'tools/call') {
        const name = params && params.name, args = (params && params.arguments) || {};
        if (!tools.some((t) => t.name === name)) return send({ id, error: { code: -32602, message: `Tool tidak dikenal: ${name}` } });
        try {
          if (hub.has(name)) return send({ id, result: text(await hub.call(name, args)) });
          if (name === 'hub_alat') {
            const out = await gw.findTools(args);
            hub.log(name, String(args.query || args.server || '').slice(0, 100));
            return send({ id, result: text(out) });
          }
          // hub_pakai: the other server's result goes back as it is. Only names are logged, never arguments.
          const result = await gw.callDownstream(String(args.server || ''), String(args.tool || ''), args.arguments);
          hub.log(name, `${args.server}/${args.tool}`);
          return send({ id, result });
        } catch (e) {
          return send({ id, result: { ...text(e.message), isError: true } });
        }
      }
      return send({ id, error: { code: -32601, message: `Method tidak didukung: ${method}` } });
    } catch (e) {
      return send({ id, error: { code: -32000, message: e.message } });
    }
  });
  return gw;
}

module.exports = { serve, createGateway, readGateway, setGatewayServer, gatewayFile, Child, SEP, NAME_RE, GATEWAY_TOOLS };
