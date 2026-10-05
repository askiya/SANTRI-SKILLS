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
  return { id: source.id, label: source.label || source.id, repo: source.repo, branch: source.branch, skillsDir: source.skillsDir, docsDirs: dirs };
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
  return { id: entry.id, label: entry.label || entry.id, description: entry.description || '', command: entry.command, args };
}

const BUILTIN_MCP = { id: 'santri-skills', label: 'Santri Skills MCP', description: 'Akses pedoman Santriverse melalui MCP lokal.', builtin: true };

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

module.exports = { loadRegistry, validateSource, validateMcpEntry, mcpCatalog, BUILTIN_MCP, BUNDLED, valid };
