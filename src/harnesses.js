'use strict';
// AI agent harnesses SantriHub can activate skills and MCP servers for (user level only).
//
// Locations follow each vendor's documentation (checked October 2026):
//   Antigravity  skills ~/.gemini/config/skills         MCP ~/.gemini/config/mcp_config.json (mcpServers)
//   Claude Code  skills ~/.claude/skills                MCP ~/.claude.json (top-level mcpServers, user scope)
//   Codex        skills ~/.agents/skills                MCP ~/.codex/config.toml ([mcp_servers.<name>])
//   Gemini CLI   skills ~/.gemini/skills                MCP ~/.gemini/settings.json (mcpServers)
//   Cursor       skills ~/.cursor/skills                MCP ~/.cursor/mcp.json (mcpServers)
//   VS Code      skills ~/.copilot/skills               MCP <VS Code user dir>/mcp.json (servers, type stdio)
//   Windsurf     skills ~/.codeium/windsurf/skills      MCP ~/.codeium/windsurf/mcp_config.json (mcpServers)
// Remote (HTTP) MCP servers use each vendor's own key: `http` below (Codex: url = "...").
// Several harnesses also read each other's skill folders (Cursor and VS Code read
// ~/.claude/skills and ~/.agents/skills, ...): `reads` lists them so the UI can say so.
//
// Ownership: skills carry the .santri-skills.json marker (install.js). MCP entries are
// SantriHub's when they are the santri-skills bridge (isOurs) or when their exact content
// was recorded in ~/.santrihub/harness-mcp.json at the time SantriHub wrote them.
// Anything else under the same name is never replaced or removed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { installSkills, removeInstalled, mutateMcp, isOurs, ownedMarker, SERVER_NAME } = require('./install');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

function vscodeUserDir(home, env, platform) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Code', 'User');
}

/** Harness definitions for this machine. Paths only; nothing is read or written. */
function harnessDefs({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const agBase = env.SANTRI_SKILLS_AG_HOME || env.ANTIGRAVITY_HOME ? path.resolve(env.SANTRI_SKILLS_AG_HOME || env.ANTIGRAVITY_HOME) : path.join(home, '.gemini', 'config');
  const codexHome = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  const dirs = {
    antigravity: path.join(agBase, 'skills'),
    claude: path.join(home, '.claude', 'skills'),
    agents: path.join(home, '.agents', 'skills'),
    codexLegacy: path.join(codexHome, 'skills'),
    gemini: path.join(home, '.gemini', 'skills'),
    cursor: path.join(home, '.cursor', 'skills'),
    copilot: path.join(home, '.copilot', 'skills'),
    windsurf: path.join(home, '.codeium', 'windsurf', 'skills'),
  };
  const vscode = vscodeUserDir(home, env, platform);
  return [
    { id: 'antigravity', name: 'Google Antigravity', skillsDir: dirs.antigravity, reads: [dirs.antigravity],
      mcp: { format: 'json', file: path.join(agBase, 'mcp_config.json'), key: 'mcpServers', http: { url: 'serverUrl' } },
      evidence: [agBase, path.join(home, '.gemini', 'antigravity')] },
    { id: 'claude-code', name: 'Claude Code', skillsDir: dirs.claude, reads: [dirs.claude],
      mcp: { format: 'json', file: path.join(home, '.claude.json'), key: 'mcpServers', http: { type: 'http', url: 'url' } },
      evidence: [path.join(home, '.claude'), path.join(home, '.claude.json')], restartHint: 'Mulai sesi Claude Code baru.' },
    { id: 'codex', name: 'Codex', skillsDir: dirs.agents, reads: [dirs.agents, dirs.codexLegacy],
      mcp: { format: 'toml', file: path.join(codexHome, 'config.toml') },
      evidence: [codexHome] },
    { id: 'gemini-cli', name: 'Gemini CLI', skillsDir: dirs.gemini, reads: [dirs.gemini, dirs.agents],
      mcp: { format: 'json', file: path.join(home, '.gemini', 'settings.json'), key: 'mcpServers', http: { url: 'httpUrl' } },
      evidence: [path.join(home, '.gemini', 'settings.json'), dirs.gemini] },
    { id: 'cursor', name: 'Cursor', skillsDir: dirs.cursor, reads: [dirs.cursor, dirs.agents, dirs.claude, dirs.codexLegacy],
      mcp: { format: 'json', file: path.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', stdioType: true, http: { url: 'url' } },
      evidence: [path.join(home, '.cursor')] },
    { id: 'vscode', name: 'VS Code (Copilot)', skillsDir: dirs.copilot, reads: [dirs.copilot, dirs.claude, dirs.agents],
      mcp: { format: 'json', file: path.join(vscode, 'mcp.json'), key: 'servers', stdioType: true, http: { type: 'http', url: 'url' } },
      evidence: [vscode] },
    { id: 'windsurf', name: 'Windsurf', skillsDir: dirs.windsurf, reads: [dirs.windsurf],
      mcp: { format: 'json', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', http: { url: 'serverUrl' } },
      evidence: [path.join(home, '.codeium', 'windsurf')] },
  ];
}

const findHarness = (defs, id) => {
  const h = defs.find((x) => x.id === id);
  if (!h) throw new Error('Harness tidak dikenal.');
  return h;
};

// ── Skills ──────────────────────────────────────────────────────────────────

function skillIds(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md')))
      .map((d) => ({ id: d.name, managed: ownedMarker(path.join(dir, d.name)) }));
  } catch { return []; }
}

function setSkill(h, skill, enable) {
  if (!NAME_RE.test(skill.id)) throw new Error('ID skill invalid.');
  if (!enable) return removeInstalled({ kind: 'skill', id: skill.id, skillsDir: h.skillsDir });
  const result = installSkills([skill], [h.skillsDir]);
  if (result.skipped.length) throw new Error(`Folder ${skill.id} di ${h.skillsDir} sudah ada dan bukan milik SantriHub; tidak ditimpa.`);
  return { installed: true, id: skill.id, dir: path.join(h.skillsDir, skill.id) };
}

// ── MCP ─────────────────────────────────────────────────────────────────────

const sha = (value) => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function readState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) && s.mcp && typeof s.mcp === 'object' ? s : { mcp: {} };
  } catch { return { mcp: {} }; }
}
function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

/**
 * The entry as this harness wants it: VS Code and Cursor document `type: "stdio"`; a remote
 * server ({ url }) goes under the harness's own key. `env` (API keys) is passed as given.
 */
function entryFor(h, base) {
  if (base.url) {
    const http = h.mcp.http || { url: 'url' };
    return { ...(http.type ? { type: http.type } : {}), [http.url]: base.url };
  }
  const entry = { command: base.command, args: [...base.args], ...(base.env && Object.keys(base.env).length ? { env: { ...base.env } } : {}) };
  return h.mcp.stdioType ? { type: 'stdio', ...entry } : entry;
}
const withoutStdioType = (e) => {
  if (!e || typeof e !== 'object' || e.type !== 'stdio') return e;
  const { type, ...rest } = e;
  return rest;
};

// Codex: a tiny TOML writer for exactly one table, [mcp_servers.<name>]. Everything
// else in config.toml is kept byte for byte.
const tomlString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\x00-\x1f\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
const tomlKey = (k) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k));
const tomlEnv = (env) => (env ? `env = { ${Object.entries(env).map(([k, v]) => `${tomlKey(k)} = ${tomlString(v)}`).join(', ')} }\n` : '');
const tomlBlock = (name, e) => (e.url ? `[mcp_servers.${name}]\nurl = ${tomlString(e.url)}\n`
  : `[mcp_servers.${name}]\ncommand = ${tomlString(e.command)}\nargs = [${e.args.map(tomlString).join(', ')}]\n${tomlEnv(e.env)}`);
const isHeader = (line) => /^\s*\[/.test(line);
const serverHeader = (line) => {
  const m = /^\s*\[\s*mcp_servers\s*\.\s*("?)([A-Za-z0-9_-]+)\1\s*(\.[^\]]*)?\]\s*(#.*)?$/.exec(line);
  return m ? m[2] : null;
};
/** { names, blocks: { name: text } } of the [mcp_servers.*] tables (incl. sub-tables). */
function tomlServers(text) {
  const blocks = {};
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (isHeader(line)) current = serverHeader(line);
    if (current) blocks[current] = (blocks[current] || '') + line.trimEnd() + '\n';
  }
  return { names: Object.keys(blocks), blocks };
}
function tomlWithout(text, name) {
  const out = [];
  let skip = false;
  for (const line of String(text).split(/\r?\n/)) {
    if (isHeader(line)) skip = serverHeader(line) === name;
    if (!skip) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}
const normalizeBlock = (b) => String(b).trim().replace(/\r\n/g, '\n');

/** Atomic text write with a unique backup; refuses when the file changed meanwhile. */
function writeText(file, original, next) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  if (original !== null) {
    backup = `${file}.bak-${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
  }
  const tmp = `${file}.tmp-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tmp, next, { flag: 'wx', mode: 0o600 });
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current !== original) throw new Error('Config berubah saat menulis. File tidak ditimpa; coba lagi.');
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); }
  return backup;
}

/** Names of the MCP servers configured for this harness (no values, ever). */
function mcpNames(h) {
  const file = h.mcp.file;
  if (!fs.existsSync(file)) return { exists: false, valid: null, names: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (h.mcp.format === 'toml') return { exists: true, valid: true, names: tomlServers(raw).names };
    const cfg = raw.trim() ? JSON.parse(raw) : {};
    const bag = cfg && cfg[h.mcp.key];
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg) || (bag != null && (typeof bag !== 'object' || Array.isArray(bag)))) return { exists: true, valid: false, names: [] };
    return { exists: true, valid: true, names: Object.keys(bag || {}) };
  } catch { return { exists: true, valid: false, names: [] }; }
}

/**
 * Adds (enable) or removes (disable) MCP server `name` for harness `h`.
 * `base` is { command, args } from the catalog (or the bridge entry for santri-skills).
 */
function setMcp(h, name, base, enable, { stateFile }) {
  if (!NAME_RE.test(name)) throw new Error('Nama MCP invalid.');
  const key = `${h.id}/${name}`;
  const state = readState(stateFile);
  const entry = entryFor(h, base);

  if (h.mcp.format === 'toml') {
    const file = h.mcp.file;
    const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const existing = original === null ? undefined : tomlServers(original).blocks[name];
    const block = tomlBlock(name, entry);
    const owned = existing !== undefined && state.mcp[key] === sha(normalizeBlock(existing));
    if (enable) {
      if (existing !== undefined && normalizeBlock(existing) !== normalizeBlock(block) && !owned) throw new Error(`MCP '${name}' sudah ada di ${file} dengan konfigurasi lain. Hapus manual dulu, file tidak diubah.`);
      if (existing !== undefined && normalizeBlock(existing) === normalizeBlock(block)) { state.mcp[key] = sha(normalizeBlock(block)); writeState(stateFile, state); return { added: false, name, file }; }
      const kept = original === null ? '' : tomlWithout(original, name);
      const backup = writeText(file, original, `${kept ? `${kept}\n\n` : ''}${block}`);
      state.mcp[key] = sha(normalizeBlock(block));
      writeState(stateFile, state);
      return { added: true, name, file, backup };
    }
    if (existing === undefined) return { removed: false, name, file };
    if (!owned) throw new Error(`MCP '${name}' di ${file} bukan milik SantriHub; tidak dihapus.`);
    const backup = writeText(file, original, `${tomlWithout(original, name)}\n`);
    delete state.mcp[key];
    writeState(stateFile, state);
    return { removed: true, name, file, backup };
  }

  const owns = (existing) => state.mcp[key] === sha(existing) || (name === SERVER_NAME && isOurs(withoutStdioType(existing)));
  let result = null;
  const written = mutateMcp(h.mcp.file, (cfg) => {
    const bag = cfg[h.mcp.key];
    if (bag != null && (typeof bag !== 'object' || Array.isArray(bag))) throw new Error(`${h.mcp.key} di ${h.mcp.file} bukan object. File tidak diubah.`);
    const existing = bag ? bag[name] : undefined;
    if (enable) {
      if (existing !== undefined && !isDeepStrictEqual(existing, entry) && !owns(existing)) throw new Error(`MCP '${name}' sudah ada di ${h.mcp.file} dengan konfigurasi lain. Hapus manual dulu, file tidak diubah.`);
      result = { added: !isDeepStrictEqual(existing, entry), name, file: h.mcp.file };
      if (result.added) cfg[h.mcp.key] = { ...(bag || {}), [name]: entry };
      return;
    }
    if (existing === undefined) { result = { removed: false, name, file: h.mcp.file }; return; }
    if (!owns(existing)) throw new Error(`MCP '${name}' di ${h.mcp.file} bukan milik SantriHub; tidak dihapus.`);
    delete bag[name];
    result = { removed: true, name, file: h.mcp.file };
  });
  if (enable) state.mcp[key] = sha(entry);
  else if (result.removed) delete state.mcp[key];
  writeState(stateFile, state);
  return { ...result, backup: written.backup };
}

// ── Overview ────────────────────────────────────────────────────────────────

/** Detection + current skills/MCP per harness. Paths and names only, never config values. */
function harnessStatus(opts = {}) {
  const defs = harnessDefs(opts);
  const owners = {}; // skill dir → harnesses reading it
  for (const h of defs) for (const dir of h.reads) (owners[dir] ||= []).push(h.name);
  return defs.map((h) => {
    const found = h.evidence.filter((p) => fs.existsSync(p));
    const own = skillIds(h.skillsDir);
    const via = h.reads.filter((d) => d !== h.skillsDir).flatMap((dir) => skillIds(dir).map((s) => ({ id: s.id, dir })));
    return {
      id: h.id, name: h.name, detected: found.length > 0, evidence: found,
      skillsDir: h.skillsDir, sharedWith: (owners[h.skillsDir] || []).filter((n) => n !== h.name),
      skills: own, skillsViaOtherFolders: via,
      mcp: { file: h.mcp.file, format: h.mcp.format, ...mcpNames(h) },
      restartHint: h.restartHint || `Reload ${h.name} agar perubahan terbaca.`,
    };
  });
}

module.exports = { harnessDefs, findHarness, harnessStatus, setSkill, setMcp, mcpNames, entryFor, tomlServers, tomlWithout, tomlBlock, tomlString };
