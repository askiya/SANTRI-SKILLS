'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractTarGz } = require('./targz');
const REGISTRY = require('../registry.json');
const CACHE_ROOT = process.env.SANTRI_SKILLS_CACHE || path.join(os.homedir(), '.santri-skills', 'cache');

function selectSources(ids) {
  if (!ids || ids.length === 0) return REGISTRY.sources;
  const picked = REGISTRY.sources.filter((s) => ids.includes(s.id));
  const unknown = ids.filter((id) => !REGISTRY.sources.some((s) => s.id === id));
  if (unknown.length) throw new Error(`Sumber tidak dikenal: ${unknown.join(', ')}. Pilihan: ${REGISTRY.sources.map((s) => s.id).join(', ')}`);
  return picked;
}

// Download repo tarball from GitHub and extract with system `tar` (bundled on Windows 10+, macOS, Linux).
// ponytail: no checksum pinning; branch tip is trusted. Add pinned commit SHA in registry when releases matter.
async function fetchSource(source, { refresh = false } = {}) {
  const dir = path.join(CACHE_ROOT, source.id);
  const marker = path.join(dir, '.fetched');
  if (!refresh && fs.existsSync(marker)) return dir;

  const url = `https://codeload.github.com/${source.repo}/tar.gz/refs/heads/${source.branch}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'santriverse-skills-cli' } });
  if (!res.ok) throw new Error(`Gagal download ${source.repo} (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  extractTarGz(buf, dir, { strip: 1 });
  if (!listSkills(source, dir).length) throw new Error(`Tidak ada skill valid: ${source.repo}`);
  fs.writeFileSync(marker, new Date().toISOString());
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
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'SKILL.md')))
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

module.exports = { REGISTRY, CACHE_ROOT, selectSources, fetchSource, listSkills, loadCatalog, parseFrontmatter };
