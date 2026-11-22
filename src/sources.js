'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractTarGz } = require('./targz');
const { loadRegistry, validateSource, valid } = require('./registry');
const CACHE_ROOT = process.env.SANTRI_SKILLS_CACHE || path.join(os.homedir(), '.santri-skills', 'cache');
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = Number(process.env.SANTRI_SKILLS_TIMEOUT_MS) || 60000;

// Cached per registry file so SANTRI_SKILLS_REGISTRY can be set before first use.
let cached = { file: null, reg: null };
function registry() {
  const file = process.env.SANTRI_SKILLS_REGISTRY || '';
  if (cached.file !== file || !cached.reg) cached = { file, reg: loadRegistry() };
  return cached.reg;
}

function selectSources(ids) {
  const sources = registry().sources;
  if (!ids || ids.length === 0) return sources;
  const unknown = ids.filter((id) => !sources.some((s) => s.id === id));
  if (unknown.length) throw new Error(`Sumber tidak dikenal: ${unknown.join(', ')}. Pilihan: ${sources.map((s) => s.id).join(', ')}`);
  return sources.filter((s) => ids.includes(s.id));
}

// Stream the body so an oversized archive is aborted mid-flight, not after buffering.
async function download(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'santriverse-skills-cli' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Gagal download ${url} (HTTP ${res.status})`);
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new Error(`Arsip ${url} melebihi 50 MB`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error(`Arsip ${url} melebihi 50 MB`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

// Swap staged -> live only after `validate()` passes. On any failure the old cache
// is restored untouched and the staging dir is left for inspection by the caller.
function replaceCache(staging, dir, validate = () => {}) {
  validate();
  const backup = `${dir}.old-${process.pid}`;
  const hadOld = fs.existsSync(dir);
  if (hadOld) fs.renameSync(dir, backup);
  try {
    fs.renameSync(staging, dir);
  } catch (err) {
    if (hadOld) fs.renameSync(backup, dir);
    throw err;
  }
  fs.rmSync(backup, { recursive: true, force: true });
  return dir;
}

// A cached repo older than this is fetched again in the background, so new skills and the
// design catalog reach members without a manual `update`. The current read never waits for it.
const MAX_AGE_MS = Number(process.env.SANTRI_SKILLS_CACHE_MAX_AGE_MS) || 24 * 60 * 60 * 1000;
const refreshing = new Map();

// Download repo tarball from GitHub and extract with the stdlib tar.gz reader.
// Extraction happens in a staging dir: the existing cache stays usable if anything fails.
// ponytail: no checksum pinning; branch tip is trusted. Add pinned commit SHA in registry when releases matter.
async function fetchSource(rawSource, { refresh = false } = {}) {
  const source = validateSource(rawSource);
  const dir = path.join(CACHE_ROOT, source.id);
  const marker = path.join(dir, '.fetched');
  if (!refresh && fs.existsSync(marker)) {
    if (Date.now() - fs.statSync(marker).mtimeMs > MAX_AGE_MS && !refreshing.has(source.id)) {
      // Offline or a failed download keeps the old copy; the next read tries again.
      refreshing.set(source.id, fetchSource(source, { refresh: true }).catch(() => {}).finally(() => refreshing.delete(source.id)));
    }
    return dir;
  }

  const url = `https://codeload.github.com/${source.repo}/tar.gz/refs/heads/${source.branch}`;
  const buf = await download(url);

  const staging = `${dir}.staging-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  try {
    extractTarGz(buf, staging, { strip: 1 });
    replaceCache(staging, dir, () => {
      if (!listSkills(source, staging).length) throw new Error(`Tidak ada skill valid: ${source.repo}`);
      fs.writeFileSync(path.join(staging, '.fetched'), new Date().toISOString());
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return dir;
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta = {};
  if (!m) return meta;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return meta;
}

function listSkills(source, root) {
  const base = path.join(root, source.skillsDir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && valid.id.test(d.name) && fs.existsSync(path.join(base, d.name, 'SKILL.md')))
    .map((d) => {
      const dir = path.join(base, d.name);
      const meta = parseFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'));
      return { id: d.name, name: meta.name || d.name, description: meta.description || '', source: source.id, dir };
    });
}

async function loadCatalog(ids, opts) {
  const catalog = [];
  for (const source of selectSources(ids)) {
    const root = await fetchSource(source, opts);
    catalog.push({ source, root, skills: listSkills(source, root) });
  }
  return catalog;
}

module.exports = { CACHE_ROOT, MAX_DOWNLOAD_BYTES, registry, selectSources, fetchSource, replaceCache, listSkills, loadCatalog, parseFrontmatter, validateSource, valid };
// Back-compat: `REGISTRY.sources` used by mcp-server; resolved lazily so env overrides apply.
Object.defineProperty(module.exports, 'REGISTRY', { enumerable: true, get: registry });
