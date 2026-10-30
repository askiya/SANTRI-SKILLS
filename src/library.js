'use strict';
// The member's own skill library: ~/.santrihub/library/skills/<id>/ (SKILL.md + text files),
// with sources recorded in ~/.santrihub/library/index.json. Skills come from:
//   - any public GitHub repo: every folder with a SKILL.md, or, when the repo has none,
//     one skill generated from AGENTS.md / CLAUDE.md / README.md / ... (SKILL.md written here)
//   - Markdown written or uploaded in the dashboard
// From the library a skill is turned on per AI agent (src/harnesses.js), like catalog skills.
//
// Safety: only text files are imported (scripts only when the member opts in), paths are
// re-validated, nothing from a repo is executed, and writes are atomic (stage + rename).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseIngestUrl, openArchive, relevantSkill, MAX_FILE } = require('./github-import');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEXT_EXT = /\.(md|markdown|mdx|txt|json|ya?ml|csv|toml|xml|html?|css|svg)$/i;
const SCRIPT_EXT = /\.(js|mjs|cjs|ts|py|sh|bash|ps1|rb)$/i;
// Instruction files a repo without SKILL.md may carry, best first.
const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', 'README.md'];
const MAX_SKILLS = 20;
const MAX_SKILL_BYTES = 4 * 1024 * 1024;

const libraryRoot = (home = os.homedir()) => path.join(home, '.santrihub', 'library');
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');

/** Lowercase-hyphen id as the Agent Skills spec wants for `name` (= folder name). */
function slug(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\x00-\x7f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '') || 'skill';
}
/** Top-level frontmatter keys, including YAML block values (`description: >-` + indented lines). */
function readFrontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text));
  const out = {};
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '' || /^[>|][+-]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || (lines[i + 1].trim() === '' && /^\s/.test(lines[i + 2] || '')))) block.push(lines[++i].trim());
      value = value.startsWith('|') ? block.join('\n') : block.join(' ');
    }
    out[kv[1]] = value.replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/''/g, "'").replace(/\s+/g, ' ').trim();
  }
  return out;
}

const stripFrontmatter = (text) => String(text).replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** First prose paragraph, markdown removed, one line, ≤ 300 chars. */
function summarize(markdown) {
  for (const block of stripFrontmatter(markdown).split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => !/^\s*(#|<|!\[|\||```|---|\[!\[)/.test(l));
    const text = lines.join(' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
    if (text.length >= 20) return text.length > 300 ? `${text.slice(0, 297).trimEnd()}...` : text;
  }
  return '';
}

// One-line YAML string; single quotes when the text has double quotes (no escapes to read back).
function yamlString(s) {
  const text = String(s).replace(/\s+/g, ' ').trim();
  return text.includes('"') ? `'${text.replace(/'/g, "''")}'` : `"${text}"`;
}

/** SKILL.md text with `name`/`description` set; other frontmatter keys and the body are kept. */
function withFrontmatter(markdown, { name, description }) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  const keep = [];
  let dropping = false; // continuation lines of a replaced multi-line value
  for (const line of m ? m[1].split(/\r?\n/) : []) {
    if (/^(name|description)\s*:/.test(line)) { dropping = true; continue; }
    if (dropping && /^\s+\S/.test(line)) continue;
    dropping = false;
    keep.push(line);
  }
  const body = m ? markdown.slice(m[0].length) : markdown;
  return `---\nname: ${name}\ndescription: ${yamlString(description)}\n${keep.length ? keep.join('\n') + '\n' : ''}---\n\n${body.replace(/^\s+/, '')}`;
}

function validRel(rel) {
  return typeof rel === 'string' && rel.length <= 300 && !path.isAbsolute(rel) && !/[\\\x00-\x1f:*?"<>|]/.test(rel)
    && rel.split('/').every((p) => p && p !== '.' && p !== '..' && !p.startsWith('.')) ;
}

// ── GitHub ──────────────────────────────────────────────────────────────────

const hiddenOrVendored = (rel) => /(^|\/)(node_modules|\.git)(\/|$)/.test(rel) || /(^|\/)\.(?!agents\/)[^/]+\//.test(rel);

async function downloadArchive(src, want, fetcher) {
  const signal = AbortSignal.timeout(60000);
  const branches = src.branch ? [src.branch] : ['main', 'master'];
  for (const branch of branches) {
    try {
      const archive = await openArchive(`https://codeload.github.com/${src.repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`, { fetcher, signal, subdir: src.subdir, want });
      return { branch, files: archive.files, oversized: archive.oversized || [] };
    } catch (e) {
      if (e.status === 404 && branch !== branches.at(-1)) continue;
      if (e.status === 404) throw new Error(src.branch ? `Branch ${src.branch} tidak ditemukan.` : 'Branch main/master tidak ditemukan; pakai URL https://github.com/owner/repo/tree/<branch>.');
      throw e;
    }
  }
  throw new Error('Repository tidak bisa diunduh.');
}

/**
 * Skills found in a public GitHub repo, ready for the member to review and save.
 * Each: { key, id, description, generated, repaired, skillMd, files: [{rel,data}], skipped: [rel] }.
 */
async function scanGithub(url, { fetcher = globalThis.fetch, includeScripts = false } = {}) {
  const src = parseIngestUrl(url);
  const within = (rel) => (src.subdir && rel.startsWith(src.subdir + '/') ? rel.slice(src.subdir.length + 1) : rel);
  // Pass 1: where are the SKILL.md files, and which root instruction files exist.
  const isCandidate = (rel) => !within(rel).includes('/') && (CANDIDATES.includes(within(rel)) || /\.md$/i.test(within(rel)));
  const NOTHING = 'Repository tidak punya SKILL.md maupun file Markdown di root untuk dijadikan skill.';
  const first = await downloadArchive(src, (rel) => (relevantSkill(rel) && !hiddenOrVendored(rel)) || isCandidate(rel), fetcher)
    .catch((e) => { throw /tidak punya artefak relevan/.test(e.message) ? new Error(NOTHING) : e; });
  const skillDirs = [...first.files.keys()].filter((rel) => relevantSkill(rel) && !hiddenOrVendored(rel)).map((rel) => path.posix.dirname(rel)).sort();
  // A SKILL.md inside another skill's folder belongs to that skill (its examples), not a new skill.
  // (A root SKILL.md next to skills/<x>/SKILL.md: both are skills.)
  const roots = skillDirs.filter((d) => !skillDirs.some((o) => o !== d && o !== '.' && d.startsWith(o + '/')));
  if (roots.length > MAX_SKILLS) throw new Error(`Repository berisi ${roots.length} skill (maks ${MAX_SKILLS}). Pakai URL /tree/<branch>/<folder> untuk memilih sebagian.`);
  const repoName = src.subdir ? src.subdir.split('/').pop() : src.repo.split('/')[1];
  const skills = [];

  if (roots.length) {
    // Pass 2: the full folders of those skills (text files; scripts only on request).
    // Deepest skill folder holding `rel` (a root SKILL.md does not swallow nested skills).
    const under = (rel) => roots.filter((d) => d === '.' || rel.startsWith(d + '/')).sort((a, b) => b.length - a.length)[0];
    const second = await downloadArchive({ ...src, branch: first.branch }, (rel) => Boolean(under(rel)) && !hiddenOrVendored(rel) && (TEXT_EXT.test(rel) || SCRIPT_EXT.test(rel)), fetcher);
    for (const dir of roots) {
      const files = [];
      const skipped = second.oversized.filter((rel) => under(rel) === dir).map((rel) => `${dir === '.' ? rel : rel.slice(dir.length + 1)} (> 512 KB)`);
      for (const [rel, data] of second.files) {
        if (under(rel) !== dir) continue;
        const inner = dir === '.' ? rel : rel.slice(dir.length + 1);
        if (!validRel(inner)) { skipped.push(inner); continue; }
        if (SCRIPT_EXT.test(inner) && !includeScripts) { skipped.push(inner); continue; }
        files.push({ rel: inner, data });
      }
      const original = (files.find((f) => f.rel === 'SKILL.md') || { data: first.files.get(dir === '.' ? 'SKILL.md' : `${dir}/SKILL.md`) }).data.toString('utf8');
      const meta = readFrontmatter(original);
      const id = slug(meta.name || (dir === '.' ? repoName : path.posix.basename(dir)));
      const description = String(meta.description || summarize(original) || `Skill dari ${src.repo}`).slice(0, 1024);
      const repaired = !meta.name || !meta.description || meta.name !== id;
      skills.push({ key: dir, id, description, generated: false, repaired, skillMd: withFrontmatter(original, { name: id, description }),
        files: files.filter((f) => f.rel !== 'SKILL.md'), skipped });
    }
  } else {
    // No SKILL.md anywhere: build one from the repo's own instructions.
    const pick = CANDIDATES.map((c) => [...first.files.keys()].find((rel) => within(rel) === c)).find(Boolean)
      || [...first.files.keys()].find((rel) => isCandidate(rel) && /\.md$/i.test(rel));
    if (!pick) throw new Error(NOTHING);
    const text = first.files.get(pick).toString('utf8');
    const id = slug(repoName);
    const description = (summarize(text) || `Panduan dari ${src.repo}`).slice(0, 1024);
    const refs = [...first.files.keys()].filter((rel) => rel !== pick && isCandidate(rel) && /\.md$/i.test(rel)).slice(0, 10)
      .map((rel) => ({ rel: `references/${path.posix.basename(rel)}`, data: first.files.get(rel) }));
    const body = `> Dibuat otomatis oleh SantriHub dari \`${within(pick)}\` di https://github.com/${src.repo}.\n\n${stripFrontmatter(text)}`;
    skills.push({ key: '@generated', id, description, generated: true, repaired: false, skillMd: withFrontmatter(body, { name: id, description }), files: refs, skipped: [] });
  }
  for (const s of skills) {
    s.sourceHash = sha(JSON.stringify([s.skillMd, ...s.files.map((f) => [f.rel, sha(f.data)])]));
    if (s.files.reduce((n, f) => n + f.data.length, Buffer.byteLength(s.skillMd)) > MAX_SKILL_BYTES) throw new Error(`Skill ${s.id} melebihi 4 MB.`);
  }
  return { source: { url, repo: src.repo, branch: first.branch, subdir: src.subdir }, skills };
}

// ── Library on disk ─────────────────────────────────────────────────────────

function readIndex(root) {
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
    return idx && typeof idx.skills === 'object' && !Array.isArray(idx.skills) ? idx : { skills: {} };
  } catch { return { skills: {} }; }
}
function writeIndex(root, index) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = path.join(root, 'index.json'), tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(index, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

/** Writes skill `id` (SKILL.md + files) atomically and records its source. */
function saveSkill(root, { id, skillMd, files = [], meta }) {
  if (!ID_RE.test(id)) throw new Error('ID skill wajib huruf kecil, angka, dan tanda hubung (maks 64).');
  if (typeof skillMd !== 'string' || !skillMd.trim()) throw new Error('SKILL.md kosong.');
  if (Buffer.byteLength(skillMd) > MAX_FILE) throw new Error('SKILL.md melebihi 512 KB.');
  let total = Buffer.byteLength(skillMd);
  for (const f of files) {
    if (!validRel(f.rel) || f.rel === 'SKILL.md') throw new Error(`Path file tidak aman: ${f.rel}`);
    if ((total += f.data.length) > MAX_SKILL_BYTES) throw new Error('Skill melebihi 4 MB.');
  }
  const dir = path.join(root, 'skills', id), staged = `${dir}.staged-${crypto.randomBytes(4).toString('hex')}`, old = `${dir}.old-${crypto.randomBytes(4).toString('hex')}`;
  fs.mkdirSync(path.join(root, 'skills'), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, 'SKILL.md'), skillMd);
    for (const f of files) {
      const target = path.join(staged, ...f.rel.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, f.data, { flag: 'wx' });
    }
    if (fs.existsSync(dir)) fs.renameSync(dir, old);
    fs.renameSync(staged, dir);
  } catch (e) {
    if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);
    throw e;
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(old, { recursive: true, force: true });
  }
  const index = readIndex(root);
  const now = new Date().toISOString();
  index.skills[id] = { ...meta, importedAt: index.skills[id]?.importedAt || now, updatedAt: now };
  writeIndex(root, index);
  return { id, dir };
}

/** Library skills with name/description from their SKILL.md. */
function listLibrary(root) {
  const index = readIndex(root);
  return Object.entries(index.skills).flatMap(([id, meta]) => {
    const dir = path.join(root, 'skills', id);
    let text;
    try { text = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'); } catch { return []; }
    const fm = readFrontmatter(text);
    return [{ id, dir, source: 'library', name: fm.name || id, description: fm.description || '', type: meta.type,
      url: meta.url || null, repo: meta.repo || null, generated: Boolean(meta.generated), importedAt: meta.importedAt, updatedAt: meta.updatedAt }];
  });
}

function removeSkill(root, id) {
  if (!ID_RE.test(id)) throw new Error('ID skill invalid.');
  const index = readIndex(root);
  if (!index.skills[id]) return { removed: false };
  fs.rmSync(path.join(root, 'skills', id), { recursive: true, force: true });
  delete index.skills[id];
  writeIndex(root, index);
  return { removed: true, id };
}

/** A skill written in the dashboard (or an uploaded .md), plus optional reference files. */
function markdownSkill({ id, description, content, references = [] }) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Isi Markdown wajib.');
  if (Buffer.byteLength(content) > MAX_FILE) throw new Error('Markdown melebihi 512 KB.');
  const fm = readFrontmatter(content);
  const finalId = slug(id || fm.name || content.match(/^#\s+(.+)$/m)?.[1] || '');
  const finalDescription = String(description || fm.description || summarize(content) || '').trim().slice(0, 1024);
  if (!finalDescription) throw new Error('Deskripsi wajib: jelaskan kapan agent harus memakai skill ini.');
  if (!Array.isArray(references) || references.length > 20) throw new Error('Maksimal 20 file referensi.');
  const files = references.map((r) => {
    const name = String(r && r.name || '').replace(/^.*[\\/]/, '');
    if (!/^[\w.-]{1,100}\.(md|markdown|txt)$/i.test(name) || name.startsWith('.')) throw new Error(`Nama file referensi tidak valid: ${name}`);
    if (typeof r.content !== 'string' || Buffer.byteLength(r.content) > MAX_FILE) throw new Error(`File referensi ${name} kosong atau melebihi 512 KB.`);
    return { rel: `references/${name}`, data: Buffer.from(r.content) };
  });
  return { id: finalId, description: finalDescription, skillMd: withFrontmatter(content, { name: finalId, description: finalDescription }), files };
}

module.exports = { readFrontmatter, libraryRoot, slug, summarize, withFrontmatter, scanGithub, saveSkill, listLibrary, removeSkill, markdownSkill, readIndex, ID_RE };
