'use strict';
// SantriHub MCP Gateway (stdio): one MCP entry ("santrihub") in every AI agent, behind it
// the MCP servers the member switched on in SantriHub (~/.santrihub/gateway.json).
// Changing that list needs no edit of any agent config, only a reload of the agent.
//
//   santriverse-skills mcp-gateway
//
// Tools of server `x` are offered as `x__<tool>`; calls are routed back to `x` with the
// original name. Servers start on the first tools request; one that fails to start is
// left out (reason on stderr) instead of breaking the others. Tools only: resources and
// prompts of the servers behind the gateway are not forwarded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { SUPPORTED_PROTOCOLS } = require('./mcp-server');
const { resolveCommand } = require('./runtime-status');
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

/** Starts every configured server once; keeps the ones that came up. */
function createGateway(servers, opts = {}) {
  const log = opts.log || ((line) => process.stderr.write(`[santrihub-gateway] ${line}\n`));
  const children = new Map();
  const failures = {};
  let ready = null;
  const start = () => (ready ||= Promise.all(Object.entries(servers).map(async ([name, entry]) => {
    const child = new Child(name, entry, { env: opts.env || process.env, log });
    try { children.set(name, await child.init()); } catch (e) { failures[name] = e.message; log(e.message); child.stop(); }
  })));

  // Exposed name → { child, tool }. Agents such as Claude allow [A-Za-z0-9_-]{1,64}, so long or
  // odd names are shortened/cleaned and made unique; the table, not the name, routes the call.
  const routes = new Map();
  async function listTools() {
    await start();
    routes.clear();
    const tools = [];
    for (const [name, child] of children) {
      for (const t of child.tools) {
        let exposed = `${name}${SEP}${t.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
        for (let n = 2; routes.has(exposed); n++) exposed = `${exposed.slice(0, 60)}_${n}`;
        routes.set(exposed, { child, tool: t.name });
        tools.push({ ...t, name: exposed, description: `[${name}] ${t.description || ''}`.trim() });
      }
    }
    return tools;
  }

  async function callTool(exposed, args) {
    if (!routes.size) await listTools();
    const route = routes.get(exposed);
    if (!route) throw Object.assign(new Error(`Tool tidak dikenal: ${exposed}`), { code: -32602 });
    return route.child.request('tools/call', { name: route.tool, arguments: args || {} }, CALL_TIMEOUT_MS);
  }

  const stop = () => { for (const c of children.values()) c.stop(); };
  return { listTools, callTool, stop, failures, start };
}

function serve({ input = process.stdin, output = process.stdout, servers = readGateway(gatewayFile()) } = {}) {
  const gw = createGateway(servers);
  const send = (msg) => output.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
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
        gw.start(); // warm up the servers while the agent finishes its handshake
        return send({ id, result: { protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} }, serverInfo: { name: 'santrihub-gateway', version: pkg.version } } });
      }
      if (method === 'ping') return send({ id, result: {} });
      if (method === 'tools/list') return send({ id, result: { tools: await gw.listTools() } });
      if (method === 'tools/call') {
        try {
          return send({ id, result: await gw.callTool(params && params.name, params && params.arguments) });
        } catch (e) {
          if (e.code === -32602) return send({ id, error: { code: -32602, message: e.message } });
          return send({ id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
        }
      }
      return send({ id, error: { code: -32601, message: `Method tidak didukung: ${method}` } });
    } catch (e) {
      return send({ id, error: { code: -32000, message: e.message } });
    }
  });
  return gw;
}

module.exports = { serve, createGateway, readGateway, setGatewayServer, gatewayFile, Child, SEP, NAME_RE };
