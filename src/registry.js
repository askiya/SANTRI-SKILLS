'use strict';

// Registry loader + schema validation. Single source of truth for sources and the
// vetted MCP catalog. Bundled registry.json is the default; SANTRI_SKILLS_REGISTRY
// points at an explicit local catalog file (no remote fetch here).

const fs = require('node:fs');
const path = require('node:path');

const BUNDLED = path.join(__dirname, '..', 'registry.json');

const valid = {
  id: /^[a-z0-9][a-z0-9-]{0,63}$/,
  repo: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,
  branch: /^[A-Za-z0-9._/-]+$/,
  relative: /^(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/\\-]+$/,
};
// Windows reserved device names and dot-only segments never reach the filesystem.
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const safeSegments = (p) => p.split(/[\\/]/).every((s) => s && !/^\.+$/.test(s) && !RESERVED.test(s.split('.')[0]));
const safeRelative = (p) => typeof p === 'string' && valid.relative.test(p) && safeSegments(p);

function validateSource(source) {
  const dirs = source && source.docsDirs === undefined ? [] : source && source.docsDirs;
  const ok =
    source &&
    valid.id.test(source.id || '') &&
    !RESERVED.test(source.id) &&
    valid.repo.test(source.repo || '') &&
    source.repo.split('/').every((s) => !/^\.+$/.test(s)) &&
    valid.branch.test(source.branch || '') &&
    safeSegments(source.branch) &&
    safeRelative(source.skillsDir) &&
    Array.isArray(dirs) &&
    dirs.every(safeRelative);
  if (!ok) throw new Error(`Sumber registry invalid: ${(source && source.id) || '?'}`);
  return { id: source.id, label: source.label || source.id, repo: source.repo, branch: source.branch, skillsDir: source.skillsDir, docsDirs: dirs, ...paketMeta(source) };
}

// A source is shown as a "paket" (Apps Script, Monorepo, …): optional display metadata.
// Display only, so a bad field is dropped instead of failing the whole catalog.
const COLORS = ['teal', 'purple', 'coral', 'blue', 'amber', 'pink', 'green', 'gray'];
const text = (v, max) => (typeof v === 'string' && v.trim() && !/[\x00-\x1f<>]/.test(v) ? v.trim().slice(0, max) : undefined);
function paketMeta(source) {
  const meta = {
    short: text(source.short, 40),
    description: text(source.description, 300),
    author: text(source.author, 80),
    color: COLORS.includes(source.color) ? source.color : undefined,
    icon: text(source.icon, 4),
    starter: typeof source.starter === 'string' && valid.id.test(source.starter) ? source.starter : undefined,
    order: Number.isInteger(source.order) ? source.order : undefined,
    // "Cocok jika …" points for choosing a paket on Beranda.
    fit: Array.isArray(source.fit) ? source.fit.map((x) => text(x, 90)).filter(Boolean).slice(0, 4) : undefined,
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
}

// Declarative config only: no shell metacharacters, no env/token/key fields, string args.
const SECRET_KEY = /(env|token|secret|key|pass|auth|header|credential)/i;
const SHELL = /[\s;&|`$><]/;

function validateMcpEntry(entry) {
  const args = entry && Array.isArray(entry.args) ? entry.args : [];
  const ok =
    entry &&
    valid.id.test(entry.id || '') &&
    typeof entry.command === 'string' &&
    entry.command.trim() !== '' &&
    !SHELL.test(entry.command) &&
    Array.isArray(entry.args) &&
    args.every((a) => typeof a === 'string' && !SHELL.test(a)) &&
    !Object.keys(entry).some((k) => SECRET_KEY.test(k));
  if (!ok) throw new Error(`Entri MCP invalid atau berisi rahasia: ${(entry && entry.id) || '?'}`);
  // Which paket(s) the server belongs to; none = "umum" (useful for every paket).
  const paket = Array.isArray(entry.paket) ? entry.paket.filter((p) => typeof p === 'string' && valid.id.test(p)).slice(0, 10) : [];
  return { id: entry.id, label: entry.label || entry.id, description: entry.description || '', command: entry.command, args, ...(paket.length ? { paket } : {}) };
}

const BUILTIN_MCP = { id: 'santri-skills', label: 'Santri Skills MCP', description: 'Akses pedoman Santriverse melalui MCP lokal.', builtin: true };
// The paket for MCP servers that serve every paket (the built-in santri-skills docs server).
const UMUM = { id: 'umum', label: 'Umum', short: 'Umum', description: 'Dipakai semua paket: pedoman dan alat bantu Santriverse.', author: 'Santriverse', color: 'gray', icon: '⌁', order: 900 };

// Built-in server first, then the user's vetted catalog entries.
function mcpCatalog(reg = loadRegistry()) {
  return [BUILTIN_MCP, ...reg.mcpServers];
}

function loadRegistry({ file = process.env.SANTRI_SKILLS_REGISTRY || BUNDLED } = {}) {
  if (!fs.existsSync(file)) throw new Error(`SANTRI_SKILLS_REGISTRY tidak ditemukan: ${file}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error(`Katalog registry bukan JSON valid: ${file}`);
  }
  return validateRegistry(raw);
}

function validateRegistry(raw) {
  const file = 'remote catalog';
  const mcpRaw = raw && raw.mcpServers === undefined ? [] : raw && raw.mcpServers;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sources) || !Array.isArray(mcpRaw)) {
    throw new Error(`Schema registry invalid (butuh sources[] dan mcpServers[]): ${file}`);
  }
  const sources = raw.sources.map(validateSource);
  const mcpServers = mcpRaw.map(validateMcpEntry);
  const ids = (list) => list.map((x) => x.id);
  if (new Set(ids(sources)).size !== sources.length) throw new Error('ID sumber registry duplikat');
  const mcpIds = [BUILTIN_MCP.id, ...ids(mcpServers)];
  if (new Set(mcpIds).size !== mcpIds.length) throw new Error('ID MCP registry duplikat atau bentrok dengan santri-skills');
  return { sources, mcpServers };
}

module.exports = { validateRegistry, loadRegistry, validateSource, validateMcpEntry, mcpCatalog, paketMeta, BUILTIN_MCP, UMUM, BUNDLED, valid };
