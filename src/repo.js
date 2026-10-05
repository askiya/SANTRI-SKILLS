'use strict';

// GitHub repo preview + install. Only HTTPS github.com owner/repo is accepted,
// archives are size-bounded, and nothing from the archive is ever executed:
// SKILL.md files are read as text and copied as plain files.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { extractTarGz } = require('./targz');
const { parseFrontmatter, valid } = require('./sources');
const { installSkills } = require('./install');

const GITHUB_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 80 * 1024 * 1024;
const MAX_SKILLS = 200;
const PREVIEW_CHARS = 1200;
const FETCH_TIMEOUT_MS = Number(process.env.SANTRI_SKILLS_TIMEOUT_MS) || 60000;

function parseGithubRepo(url) {
  if (typeof url !== 'string') throw new Error('URL repo harus string');
  const m = GITHUB_RE.exec(url.trim());
  if (!m) throw new Error('Hanya URL GitHub HTTPS bentuk https://github.com/owner/repo yang diterima.');
  const [, owner, repo] = m;
  if (/^\.+$/.test(owner) || /^\.+$/.test(repo)) throw new Error('Nama owner/repo tidak aman.');
  return { owner, repo };
}

function safeBranch(branch) {
  if (branch === undefined || branch === null || branch === '') return 'main';
  if (typeof branch !== 'string' || !valid.branch.test(branch) || branch.split(/[/\\]/).some((s) => !s || /^\.+$/.test(s))) throw new Error('Nama branch tidak valid.');
  return branch;
}

async function downloadArchive(url) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'santriverse-skills-cli' }, redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error('Gagal mengunduh arsip repo. Periksa koneksi.');
  }
  if (res.status === 404) throw new Error('Repo atau branch tidak ditemukan (atau privat).');
  if (!res.ok) throw new Error(`Gagal mengunduh arsip repo (HTTP ${res.status}).`);
  if (Number(res.headers.get('content-length') || 0) > MAX_ARCHIVE_BYTES) throw new Error('Arsip repo melebihi 25 MB.');
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_ARCHIVE_BYTES) throw new Error('Arsip repo melebihi 25 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

// Walk the extracted tree for `<dir>/SKILL.md`; the folder name becomes the skill id.
function discoverSkills(root, sourceId) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6 || found.length >= MAX_SKILLS) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue; // never follow symlinks
      const sub = path.join(dir, entry.name);
      const file = path.join(sub, 'SKILL.md');
      if (valid.id.test(entry.name) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const text = fs.readFileSync(file, 'utf8');
        const meta = parseFrontmatter(text);
        found.push({
          id: entry.name,
          name: meta.name || entry.name,
          description: meta.description || '',
          relative: path.relative(root, sub).split(path.sep).join('/'),
          bytes: Buffer.byteLength(text),
          preview: text.slice(0, PREVIEW_CHARS),
          source: sourceId,
          dir: sub,
        });
      } else {
        walk(sub, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

const publicSkill = ({ id, name, description, relative, bytes, preview }) => ({ id, name, description, relative, bytes, preview });

// Download + extract into a temp dir, hand the discovered skills to `use`,
// then always remove the temp dir. Extraction is bounded and link entries are rejected.
async function withRepoSkills(url, branch, use) {
  const { owner, repo } = parseGithubRepo(url);
  const ref = safeBranch(branch);
  const buffer = await downloadArchive(`https://codeload.github.com/${owner}/${repo}/tar.gz/refs/heads/${ref}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-repo-'));
  try {
    extractTarGz(buffer, tmp, { strip: 1, maxBytes: MAX_EXTRACTED_BYTES });
    const skills = discoverSkills(tmp, `${owner}/${repo}`);
    if (!skills.length) throw new Error(`Tidak ada SKILL.md ditemukan di ${owner}/${repo}@${ref}.`);
    return await use(skills, { owner, repo, ref });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function previewRepo(url, branch) {
  return withRepoSkills(url, branch, (skills, info) => ({
    repo: `${info.owner}/${info.repo}`,
    branch: info.ref,
    skills: skills.map(publicSkill),
    mcpSupported: false,
    mcpNote: 'MCP server dari repo sembarangan tidak dijalankan otomatis. Hanya katalog MCP terkurasi yang bisa didaftarkan.',
  }));
}

async function installFromRepo(url, branch, selectedIds, targets, opts) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (!ids.length || ids.some((id) => typeof id !== 'string')) throw new Error('Pilih minimal satu skill dari hasil preview.');
  return withRepoSkills(url, branch, (skills, info) => {
    const unknown = ids.filter((id) => !skills.some((s) => s.id === id));
    if (unknown.length) throw new Error(`Skill tidak ada di repo: ${unknown.join(', ')}`);
    const result = installSkills(skills.filter((s) => ids.includes(s.id)), targets, opts);
    return { repo: `${info.owner}/${info.repo}`, branch: info.ref, installed: result.installed.length, skipped: result.skipped.length };
  });
}

module.exports = { parseGithubRepo, safeBranch, discoverSkills, previewRepo, installFromRepo, MAX_ARCHIVE_BYTES, MAX_EXTRACTED_BYTES };
