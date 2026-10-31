'use strict';
// "Tes koneksi" for one MCP server: start it the way an AI agent would (stdio command, or
// HTTP for a remote URL), do the MCP handshake (initialize → initialized → tools/list) and
// stop it again. Proves the server really runs on this computer, before the member reloads
// an agent and wonders why no tools show up.
const { Child } = require('./mcp-gateway');
const { SUPPORTED_PROTOCOLS } = require('./mcp-server');
const pkg = require('../package.json');

const CLIENT = { name: 'santrihub-test', version: pkg.version };
const DEFAULT_TIMEOUT = 60000; // first `npx -y pkg` run downloads the package

function hintFor(entry, message) {
  const cmd = entry.command || '';
  if (/ENOENT|tidak bisa dijalankan|not recognized|not found/i.test(message)) {
    if (/^(npx|npm|node)(\.cmd)?$/i.test(cmd)) return 'Node.js belum terpasang atau belum ada di PATH. Pasang Node.js LTS dari nodejs.org, lalu buka ulang SantriHub.';
    if (/^(uvx|uv)(\.exe)?$/i.test(cmd)) return 'uv belum terpasang. Pasang dari docs.astral.sh/uv, lalu buka ulang SantriHub.';
    if (/^(python|python3|py)(\.exe)?$/i.test(cmd)) return 'Python belum terpasang atau belum ada di PATH.';
    if (/^docker(\.exe)?$/i.test(cmd)) return 'Docker Desktop belum terpasang atau belum berjalan.';
    return `Program "${cmd}" tidak ditemukan. Periksa command MCP-nya.`;
  }
  if (/tidak dijawab|timeout|aborted/i.test(message)) return 'Server tidak menjawab. Bisa jadi masih mengunduh paket (coba lagi), butuh env/API key, atau bukan server MCP.';
  if (/berhenti \(exit/i.test(message)) return 'Server langsung berhenti. Lihat log di bawah: biasanya API key/env kurang atau argumen salah.';
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|certificate/i.test(message)) return 'Server di URL itu tidak bisa dihubungi. Periksa alamatnya dan koneksi internet.';
  if (/401|403/.test(message)) return 'Server menolak akses: butuh login atau token.';
  return '';
}

async function probeStdio(entry, { env = process.env, timeout = DEFAULT_TIMEOUT } = {}) {
  const log = [];
  const child = new Child('Server', entry, { env, log: (line) => { log.push(line.replace(/^\[Server\] /, '')); if (log.length > 40) log.shift(); } });
  try {
    child.start();
    const init = await child.request('initialize', { protocolVersion: SUPPORTED_PROTOCOLS[0], capabilities: {}, clientInfo: CLIENT }, timeout);
    child.notify('notifications/initialized', {});
    const tools = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const res = await child.request('tools/list', cursor ? { cursor } : {}, Math.min(timeout, 30000));
      tools.push(...((res && res.tools) || []).filter((t) => t && typeof t.name === 'string'));
      if (!(cursor = res && res.nextCursor)) break;
    }
    return { ok: true, server: init && init.serverInfo, protocol: init && init.protocolVersion, tools, log };
  } catch (e) {
    return { ok: false, error: e.message, log };
  } finally {
    child.stop();
  }
}

/** JSON-RPC result from a Streamable HTTP response (plain JSON or an SSE stream). */
async function rpcResult(res, id) {
  const text = await res.text();
  const messages = /text\/event-stream/i.test(res.headers.get('content-type') || '')
    ? text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } })
    : [(() => { try { return JSON.parse(text); } catch { return null; } })()];
  const msg = messages.find((m) => m && m.id === id);
  if (!msg) throw new Error(`Jawaban server bukan JSON-RPC (HTTP ${res.status}).`);
  if (msg.error) throw new Error(msg.error.message || 'MCP error');
  return msg.result;
}

async function probeHttp(entry, { fetchImpl = globalThis.fetch, timeout = DEFAULT_TIMEOUT } = {}) {
  const signal = AbortSignal.timeout(timeout);
  let session = null;
  const call = async (id, method, params) => {
    const res = await fetchImpl(entry.url, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify(id == null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }) });
    if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status}: server butuh login atau token.`);
    if (!res.ok && res.status !== 202) throw new Error(`HTTP ${res.status} dari server MCP.`);
    session = res.headers.get('mcp-session-id') || session;
    return id == null ? null : rpcResult(res, id);
  };
  try {
    const init = await call(1, 'initialize', { protocolVersion: SUPPORTED_PROTOCOLS[0], capabilities: {}, clientInfo: CLIENT });
    await call(null, 'notifications/initialized', {});
    const res = await call(2, 'tools/list', {});
    return { ok: true, server: init && init.serverInfo, protocol: init && init.protocolVersion, tools: ((res && res.tools) || []).filter((t) => t && typeof t.name === 'string'), log: [] };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message, log: [] };
  }
}

/** { ok, ms, server, tools: [{name, description}], error, hint, log } for one MCP entry. */
async function probeMcp(entry, opts = {}) {
  const start = Date.now();
  const r = entry.url ? await probeHttp(entry, opts) : await probeStdio(entry, opts);
  const tools = (r.tools || []).slice(0, 200).map((t) => ({ name: t.name, description: String(t.description || '').slice(0, 200) }));
  const server = r.server && typeof r.server === 'object' ? { name: String(r.server.name || '').slice(0, 100), version: String(r.server.version || '').slice(0, 40) } : null;
  return { ok: r.ok, ms: Date.now() - start, server, protocol: r.protocol || null, tools, toolCount: (r.tools || []).length,
    error: r.ok ? null : r.error, hint: r.ok ? (tools.length ? '' : 'Server jalan tapi tidak menawarkan tool.') : hintFor(entry, r.error || ''), log: r.log.join('\n').slice(-3000) };
}

module.exports = { probeMcp, hintFor };
