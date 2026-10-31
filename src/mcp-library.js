'use strict';
// The member's own MCP servers: ~/.santrihub/mcp-library.json. They come from a pasted
// config ({"mcpServers": {...}}, one server object), a command line (`npx -y @x/mcp`,
// `claude mcp add name -- cmd ...`), a URL (remote MCP over HTTP), or an MCP JSON file in
// an upload. From here they are turned on per AI agent like catalog MCP servers.
//
// Env values (API keys) stay on this computer: the browser only ever gets the env names.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
const MAX_SERVERS = 100;

const mcpLibraryFile = (home = os.homedir()) => path.join(home, '.santrihub', 'mcp-library.json');

/** A config-safe name: letters, digits, - and _, ≤ 40 characters. */
function mcpName(text) {
  const s = String(text || '').replace(/^@[^/]+\//, '').replace(/^(mcp-server-|server-|mcp-)/i, '').replace(/(-mcp|-server|-mcp-server)$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40).replace(/[-_]+$/, '');
  return s || 'mcp';
}

/** { command, args, env? } or { url } from untrusted input; throws with a readable reason. */
function cleanEntry(raw, label = 'MCP') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}: bukan object MCP.`);
  const url = raw.url || raw.serverUrl || raw.httpUrl;
  if (url != null) {
    let u;
    try { u = new URL(String(url)); } catch { throw new Error(`${label}: URL tidak valid.`); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && local)) || u.username || u.password) throw new Error(`${label}: URL MCP wajib https:// (http hanya untuk localhost).`);
    if (raw.headers && Object.keys(raw.headers).length) throw new Error(`${label}: header (token) belum didukung. Pakai MCP lewat command, atau tambahkan header langsung di config agent.`);
    return { url: u.href };
  }
  if (typeof raw.command !== 'string' || !raw.command.trim() || raw.command.length > 300 || /[\x00-\x1f]/.test(raw.command)) throw new Error(`${label}: "command" wajib diisi.`);
  const args = raw.args == null ? [] : raw.args;
  if (!Array.isArray(args) || args.length > 50 || args.some((a) => typeof a !== 'string' || a.length > 1000 || /[\x00-\x1f]/.test(a))) throw new Error(`${label}: "args" wajib daftar teks.`);
  const entry = { command: raw.command.trim(), args: [...args] };
  if (raw.env != null) {
    if (typeof raw.env !== 'object' || Array.isArray(raw.env)) throw new Error(`${label}: "env" wajib object.`);
    const env = {};
    for (const [k, v] of Object.entries(raw.env)) {
      if (!ENV_RE.test(k) || typeof v !== 'string' || v.length > 4000) throw new Error(`${label}: env ${k} tidak valid.`);
      env[k] = v;
    }
    if (Object.keys(env).length) entry.env = env;
  }
  return entry;
}

/** Splits a command line like a shell would: quotes group, backslashes stay (Windows paths). */
function splitCommand(line) {
  const out = [];
  let cur = '', quote = null, has = false;
  for (const ch of String(line).trim()) {
    if (quote) { if (ch === quote) quote = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has || cur) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (quote) throw new Error('Tanda kutip pada perintah tidak ditutup.');
  if (has || cur) out.push(cur);
  return out;
}

/** Name from the package or script: `@x/server-github@latest` → github, `@playwright/mcp` → playwright, `C:\t\notes.js` → notes. */
function guessName(command, args = []) {
  const target = String(args.find((a) => typeof a === 'string' && !a.startsWith('-')) || command || '').replace(/(.)@[^@/]*$/, '$1');
  const scoped = /^@([^/]+)\/(.+)$/.exec(target);
  if (scoped && /^(mcp|server|mcp-server)$/i.test(scoped[2])) return mcpName(scoped[1]);
  return mcpName(target.replace(/^.*[\\/]/, '').replace(/\.(m?js|cjs|ts|py|exe)$/i, ''));
}

const fromServerMap =(bag, from) => Object.entries(bag).map(([name, raw]) => ({ name: mcpName(name) === name ? name : mcpName(name), entry: cleanEntry(raw, name), from }));

/**
 * MCP servers in pasted text: JSON config, one server object, a command line or a URL.
 * Returns [{ name, entry, from }].
 */
function parseMcpText(text, from = 'teks') {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length > 64 * 1024) throw new Error('Teks MCP terlalu panjang.');
  if (/^[{[]/.test(t)) {
    let cfg;
    try { cfg = JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); } catch { throw new Error('JSON MCP tidak valid. Periksa tanda kurung dan koma.'); }
    return fromConfig(cfg, from);
  }
  if (/^https?:\/\//i.test(t)) {
    const u = new URL(t);
    return [{ name: mcpName(u.hostname.split('.').slice(-2, -1)[0] || u.hostname), entry: cleanEntry({ url: t }), from }];
  }
  // Multi-line commands: shell (\) and PowerShell (`) line continuations.
  let words = splitCommand(t.split(/\r?\n/).map((l) => l.replace(/\s[\\`]\s*$/, '')).filter((l) => l.trim()).join(' '));
  let name = null;
  // `claude mcp add [--scope x] [-e K=V] <name> -- <command...>` / `codex mcp add <name> -- <command...>`
  const env = {};
  if (/^(claude|codex|gemini)$/i.test(words[0] || '') && words[1] === 'mcp' && words[2] === 'add') {
    const dash = words.indexOf('--');
    const head = dash < 0 ? words.slice(3) : words.slice(3, dash);
    for (let i = 0; i < head.length; i++) {
      const w = head[i];
      if (/^(-e|--env)$/.test(w)) { const [k, ...v] = String(head[++i] || '').split('='); env[k] = v.join('='); continue; }
      if (/^--env=/.test(w)) { const [k, ...v] = w.slice(6).split('='); env[k] = v.join('='); continue; }
      if (/^(-s|--scope|-t|--transport|-H|--header)$/.test(w)) { i++; continue; }
      if (w.startsWith('-')) continue;
      if (!name) name = w;
      else if (/^https?:\/\//i.test(w)) return [{ name: mcpName(name), entry: cleanEntry({ url: w }), from }];
    }
    words = dash < 0 ? [] : words.slice(dash + 1);
    if (!words.length) throw new Error('Perintah "mcp add" tanpa command setelah "--".');
  }
  // Leading KEY=value pairs set env, like a shell.
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) { const [k, ...v] = words.shift().split('='); env[k] = v.join('='); }
  if (!words.length) throw new Error('Tidak ada command MCP.');
  const [command, ...args] = words;
  return [{ name: name ? mcpName(name) : guessName(command, args), entry: cleanEntry({ command, args, env }, name || command), from }];
}

/** MCP servers in a parsed JSON config (mcpServers / servers / mcp_servers), or one server. */
function fromConfig(cfg, from) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('JSON MCP wajib object.');
  for (const key of ['mcpServers', 'servers', 'mcp_servers']) {
    if (cfg[key] && typeof cfg[key] === 'object' && !Array.isArray(cfg[key])) return fromServerMap(cfg[key], from);
  }
  if (cfg.command || cfg.url || cfg.serverUrl || cfg.httpUrl) {
    const entry = cleanEntry(cfg);
    return [{ name: cfg.name ? mcpName(cfg.name) : entry.url ? mcpName(new URL(entry.url).hostname.split('.').slice(-2, -1)[0]) : guessName(entry.command, entry.args), entry, from }];
  }
  const values = Object.values(cfg);
  if (values.length && values.every((v) => v && typeof v === 'object' && (v.command || v.url || v.serverUrl || v.httpUrl))) return fromServerMap(cfg, from);
  throw new Error('JSON tidak berisi MCP server (mcpServers, command, atau url).');
}

/** True when a JSON file (from an upload) looks like an MCP config. */
function looksLikeMcpConfig(text) {
  try { const cfg = JSON.parse(text); return Boolean(cfg && typeof cfg === 'object' && ['mcpServers', 'servers', 'mcp_servers'].some((k) => cfg[k] && typeof cfg[k] === 'object' && !Array.isArray(cfg[k]) && Object.values(cfg[k]).some((v) => v && (v.command || v.url || v.serverUrl)))); } catch { return false; }
}

// ── Store ───────────────────────────────────────────────────────────────────

function readMcpLibrary(file) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  const out = {};
  for (const [name, row] of Object.entries((cfg && cfg.servers) || {})) {
    if (!NAME_RE.test(name)) continue;
    try { out[name] = { entry: cleanEntry(row && row.entry, name), from: String(row.from || ''), addedAt: row.addedAt || null, paket: Array.isArray(row.paket) ? row.paket.filter((p) => typeof p === 'string').slice(0, 10) : [] }; } catch { /* skip broken rows */ }
  }
  return out;
}
function writeMcpLibrary(file, servers) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
function saveMcp(file, name, entry, from = '', paket = []) {
  if (!NAME_RE.test(name)) throw new Error(`Nama MCP "${name}" wajib huruf, angka, - atau _ (maks 40).`);
  const servers = readMcpLibrary(file);
  if (!servers[name] && Object.keys(servers).length >= MAX_SERVERS) throw new Error(`Maksimal ${MAX_SERVERS} MCP milik Anda.`);
  servers[name] = { entry: cleanEntry(entry, name), from: String(from).slice(0, 300), addedAt: servers[name]?.addedAt || new Date().toISOString(), paket };
  writeMcpLibrary(file, servers);
  return name;
}
function setMcpPaket(file, name, paket) {
  const servers = readMcpLibrary(file);
  if (!servers[name]) throw new Error('MCP tidak ada di koleksi Anda.');
  servers[name].paket = paket;
  writeMcpLibrary(file, servers);
  return paket;
}
function removeMcp(file, name) {
  const servers = readMcpLibrary(file);
  if (!servers[name]) return false;
  delete servers[name];
  writeMcpLibrary(file, servers);
  return true;
}

/** What the browser may see of an entry: no env values, no URL query (tokens hide there). */
function publicEntry(entry) {
  if (entry.url) { const u = new URL(entry.url); return { kind: 'http', summary: `${u.origin}${u.pathname}`, envKeys: [] }; }
  const pkg = entry.args.find((a) => !a.startsWith('-'));
  return { kind: 'stdio', summary: [path.basename(entry.command), pkg].filter(Boolean).join(' '), envKeys: Object.keys(entry.env || {}) };
}

module.exports = { mcpLibraryFile, mcpName, cleanEntry, splitCommand, parseMcpText, fromConfig, looksLikeMcpConfig, readMcpLibrary, saveMcp, setMcpPaket, removeMcp, publicEntry, NAME_RE };
