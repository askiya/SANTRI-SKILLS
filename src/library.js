'use strict';
// The member's own skill library: ~/.santrihub/library/skills/<id>/ (SKILL.md + text files),
// with sources recorded in ~/.santrihub/library/index.json. Skills come from:
//   - any public GitHub repo: every folder with a SKILL.md (also in agent folders such as
//     .claude/skills or .codex/skills; mirrored copies are imported once), or, when the repo
//     has none, one skill generated from AGENTS.md / CLAUDE.md / Cursor, Copilot, Windsurf,
//     Cline or Kiro rules / README.md (SKILL.md written here)
//   - Markdown written or uploaded in the dashboard
// From the library a skill is turned on per AI agent (src/harnesses.js), like catalog skills.
//
// Safety: text files, images and fonts are imported (scripts only when the member opts in),
// paths are re-validated, nothing from a repo is executed, and writes are atomic (stage + rename).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseIngestUrl, boundedFetch, archiveEntries, MAX_FILE } = require('./github-import');
const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TEXT_EXT = /\.(md|markdown|mdx|txt|json|ya?ml|csv|toml|xml|html?|css|svg)$/i;
const SCRIPT_EXT = /\.(js|mjs|cjs|ts|py|sh|bash|ps1|rb)$/i;
// Assets a skill may ship (stand-in photos, icons, fonts): data, never executed.
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|ico|bmp|woff2?|ttf|otf)$/i;
const MAX_ASSET = 4 * 1024 * 1024; // per file from a GitHub skill folder
// Instruction files a repo without SKILL.md may carry, best first.
const CANDIDATES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', 'README.md'];
const MAX_SKILLS = 20;
const MAX_SKILL_BYTES = 64 * 1024 * 1024;
// Limits for reading a GitHub archive: skills often carry data (CSV, JSON) and many references.
const ARCHIVE_LIMITS = { maxArtifacts: 6000, maxTotal: 160 * 1024 * 1024, maxFile: MAX_ASSET, maxEntries: 30000, maxArchive: 160 * 1024 * 1024, maxUncompressed: 480 * 1024 * 1024 };

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

// Hidden folders are skipped, except agent skill folders (.agents/…, .claude/skills, .codex/skills …).
const hiddenOrVendored = (rel) => /(^|\/)(node_modules|\.git)(\/|$)/.test(rel)
  || rel.split('/').slice(0, -1).some((seg, i, dirs) => seg.startsWith('.') && seg !== '.agents' && !/^skills?$/.test(dirs[i + 1] || ''));
const isSkillMd = (rel) => (rel === 'SKILL.md' || rel.endsWith('/SKILL.md')) && !hiddenOrVendored(rel) && !/(^|\/)(?:tests?|__tests__|fixtures)\//.test(rel);
// Instruction files of other agents, used when a repo has no SKILL.md.
const AGENT_DOC = /^(?:\.github\/copilot-instructions\.md|\.github\/instructions\/[^/]+\.md|\.cursor\/rules\/[^/]+\.mdc?|\.windsurf\/rules\/[^/]+\.md|\.clinerules(?:\/[^/]+\.md)?|\.kiro\/steering\/[^/]+\.md|\.claude\/(?:commands|agents)\/[^/]+\.md)$/;
const isDoc = (rel) => /\.(md|markdown|mdx|mdc)$/i.test(rel) || rel === '.clinerules';

// The repository tarball is downloaded once per scan (kept in `held`) and read in two passes.
async function downloadArchive(src, want, fetcher, held = {}, limits = ARCHIVE_LIMITS) {
  const read = async () => {
    const archive = await archiveEntries(held.data, { subdir: src.subdir, want, limits });
    return { branch: held.branch, files: archive.files, oversized: archive.oversized || [] };
  };
  if (held.data) return read();
  const deadline = AbortSignal.timeout(180000);
  const branches = src.branch ? [src.branch] : ['main', 'master'];
  for (const branch of branches) {
    try {
      held.data = await boundedFetch(`https://codeload.github.com/${src.repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`,
        { fetcher, deadline, cap: limits.maxArchive, tooLarge: true });
      held.branch = branch;
      return await read();
    } catch (e) {
      if (e.status === 404 && branch !== branches.at(-1)) continue;
      if (e.status === 404) throw new Error(src.branch ? `Branch ${src.branch} tidak ditemukan.` : 'Branch main/master tidak ditemukan; pakai URL https://github.com/owner/repo/tree/<branch>.');
      throw e;
    }
  }
  throw new Error('Repository tidak bisa diunduh.');
}

const skillRoots = (rels) => {
  const dirs = rels.filter(isSkillMd).map((rel) => path.posix.dirname(rel)).sort();
  // A SKILL.md inside another skill's folder belongs to that skill (its examples), not a new skill.
  // (A root SKILL.md next to skills/<x>/SKILL.md: both are skills.)
  const top = dirs.filter((d) => !dirs.some((o) => o !== d && o !== '.' && d.startsWith(o + '/')));
  // Repos often ship one skill several times (.claude/skills/x, cli/assets/skills/x): keep the most original copy.
  const best = new Map();
  for (const d of top) {
    const key = d === '.' ? '.' : path.posix.basename(d).toLowerCase();
    const cur = best.get(key);
    if (!cur || rootRank(d) < rootRank(cur) || (rootRank(d) === rootRank(cur) && d.split('/').length < cur.split('/').length)) best.set(key, d);
  }
  return [...best.values()].sort();
};
// How original a skill folder looks: skills/<x> or the root first, then .agents/.claude skill
// folders, then the rest; copies bundled in assets/templates/dist/cli/plugins … last.
function rootRank(dir) {
  if (dir === '.' || /^skills\/[^/]+$/.test(dir)) return 0;
  if (dir.split('/').some((x) => /^(assets|templates?|dist|build|out|vendor|examples?|cli|packages|configs?|plugins?)$/i.test(x))) return 3;
  if (/^\.(agents|claude)\/skills\//.test(dir)) return 1;
  return 2;
}
const isRootDoc = (rel) => (!rel.includes('/') && (CANDIDATES.includes(rel) || /\.(md|markdown|mdx)$/i.test(rel))) || AGENT_DOC.test(rel);
const NOTHING = 'tidak punya SKILL.md maupun file Markdown untuk dijadikan skill.';

/**
 * Skills in a set of files (a GitHub folder, an uploaded ZIP, folder or file), paths relative
 * to the source root: every folder with a SKILL.md or, when there is none, one skill generated
 * from the root instructions (AGENTS.md, CLAUDE.md, README.md, any .md).
 * Each: { key, id, description, generated, repaired, skillMd, files: [{rel,data}], skipped, sourceHash }.
 * `name`: id fallback; `label`: where it came from, for descriptions; `origin`: shown in a generated SKILL.md.
 */
function scanFiles(files, { name, label, origin = label, includeScripts = false, oversized = [], tooMany = '', maxSkills = MAX_SKILLS }) {
  const rels = [...files.keys()];
  const roots = skillRoots(rels);
  if (roots.length > maxSkills) throw new Error(`${label} berisi ${roots.length} skill (maks ${maxSkills}).${tooMany}`);
  const skills = [];
  if (roots.length) {
    // Deepest skill folder holding `rel` (a root SKILL.md does not swallow nested skills).
    const under = (rel) => roots.filter((d) => d === '.' || rel.startsWith(d + '/')).sort((a, b) => b.length - a.length)[0];
    for (const dir of roots) {
      const inside = (rel) => (dir === '.' ? rel : rel.slice(dir.length + 1));
      const own = [], skipped = oversized.filter((rel) => under(rel) === dir).map((rel) => `${inside(rel)} (> ${mb(MAX_ASSET)})`);
      for (const [rel, data] of files) {
        if (under(rel) !== dir || hiddenOrVendored(rel)) continue;
        const inner = inside(rel);
        if (!TEXT_EXT.test(inner) && !SCRIPT_EXT.test(inner) && !MEDIA_EXT.test(inner)) { skipped.push(`${inner} (tipe file tidak didukung)`); continue; }
        if (!validRel(inner)) { skipped.push(inner); continue; }
        if (SCRIPT_EXT.test(inner) && !includeScripts) { skipped.push(inner); continue; }
        own.push({ rel: inner, data });
      }
      // Stay within the per-skill budget: leave out the largest files instead of failing the import.
      let size = own.reduce((n, x) => n + x.data.length, 0);
      for (const x of [...own].sort((a, b) => b.data.length - a.data.length)) {
        if (size <= MAX_SKILL_BYTES - MAX_FILE || x.rel === 'SKILL.md') continue;
        own.splice(own.indexOf(x), 1); size -= x.data.length; skipped.push(`${x.rel} (batas ${mb(MAX_SKILL_BYTES)} per skill)`);
      }
      const original = files.get(dir === '.' ? 'SKILL.md' : `${dir}/SKILL.md`).toString('utf8');
      const meta = readFrontmatter(original);
      const id = slug(meta.name || (dir === '.' ? name : path.posix.basename(dir)));
      const description = String(meta.description || summarize(original) || `Skill dari ${label}`).slice(0, 1024);
      const repaired = !meta.name || !meta.description || meta.name !== id;
      const scriptsLeft = skipped.filter((x) => SCRIPT_EXT.test(x)).length;
      const note = scriptsLeft && /(scripts?\/|\.py\b|python3?\s|node\s+\S+\.m?js)/i.test(original)
        ? `SKILL.md ini menjalankan script (${scriptsLeft} dilewati). Centang "Sertakan script" bila Anda mempercayai repository ini, agar skill bekerja penuh.` : '';
      skills.push({ key: dir, id, description, generated: false, repaired, note, skillMd: withFrontmatter(original, { name: id, description }),
        files: own.filter((f) => f.rel !== 'SKILL.md'), skipped });
    }
  } else {
    // No SKILL.md anywhere: build one from the source's own instructions.
    const docs = rels.filter((rel) => (!hiddenOrVendored(rel) || AGENT_DOC.test(rel)) && isDoc(rel));
    const pick = CANDIDATES.map((c) => rels.find((rel) => rel === c)).find(Boolean)
      || ['.github/copilot-instructions.md', '.clinerules'].find((c) => rels.includes(c))
      || rels.find((rel) => !rel.includes('/') && /\.(md|markdown|mdx)$/i.test(rel)) || (docs.length === 1 ? docs[0] : null);
    if (!pick) throw new Error(`${label} ${NOTHING}`);
    const text = files.get(pick).toString('utf8');
    const id = slug(name);
    const description = (summarize(text) || `Panduan dari ${label}`).slice(0, 1024);
    const seen = new Set();
    const refName = (rel) => (rel === '.clinerules' ? 'clinerules.md' : path.posix.basename(rel).replace(/\.mdc$/i, '.md').replace(/^\.+/, ''));
    const refs = docs.filter((rel) => rel !== pick && !seen.has(refName(rel)) && seen.add(refName(rel))).slice(0, 20)
      .map((rel) => ({ rel: `references/${refName(rel)}`, data: files.get(rel) }));
    const body = `> Dibuat otomatis oleh SantriHub dari \`${pick}\` di ${origin}.\n\n${stripFrontmatter(text)}`;
    skills.push({ key: '@generated', id, description, generated: true, repaired: false, skillMd: withFrontmatter(body, { name: id, description }), files: refs, skipped: [] });
  }
  for (const s of skills) {
    s.sourceHash = sha(JSON.stringify([s.skillMd, ...s.files.map((f) => [f.rel, sha(f.data)])]));
    if (s.files.reduce((n, f) => n + f.data.length, Buffer.byteLength(s.skillMd)) > MAX_SKILL_BYTES) throw new Error(`Skill ${s.id} melebihi ${mb(MAX_SKILL_BYTES)}.`);
  }
  return skills;
}

/** Files of `files` below `prefix/` with that prefix removed. */
const below = (files, prefix) => (prefix ? new Map([...files].filter(([rel]) => rel.startsWith(prefix + '/')).map(([rel, data]) => [rel.slice(prefix.length + 1), data])) : files);

/** Skills found in a public GitHub repo, ready for the member to review and save (see scanFiles). */
async function scanGithub(url, { fetcher = globalThis.fetch, includeScripts = false } = {}) {
  const src = parseIngestUrl(url);
  const within = (rel) => (src.subdir && rel.startsWith(src.subdir + '/') ? rel.slice(src.subdir.length + 1) : rel);
  const opts = { name: src.subdir ? src.subdir.split('/').pop() : src.repo.split('/')[1], label: src.repo, origin: `https://github.com/${src.repo}`, includeScripts,
    tooMany: ' Pakai URL /tree/<branch>/<folder> untuk memilih sebagian.' };
  const NONE = `Repository ${NOTHING}`;
  // Pass 1: where are the SKILL.md files, and which root instruction files exist.
  const held = {};
  const first = await downloadArchive(src, (rel) => isSkillMd(rel) || isRootDoc(within(rel)), fetcher, held)
    .catch((e) => { throw /tidak punya artefak relevan/.test(e.message) ? new Error(NONE) : e; });
  const roots = skillRoots([...first.files.keys()]);
  let skills;
  if (roots.length) {
    if (roots.length > MAX_SKILLS) throw new Error(`Repository berisi ${roots.length} skill (maks ${MAX_SKILLS}).${opts.tooMany}`);
    // Pass 2: the full folders of those skills (text files; scripts are left out unless asked).
    const inSkill = (rel) => roots.some((d) => d === '.' || rel.startsWith(d + '/'));
    const second = await downloadArchive({ ...src, branch: first.branch }, (rel) => inSkill(rel) && !hiddenOrVendored(rel) && (TEXT_EXT.test(rel) || SCRIPT_EXT.test(rel) || MEDIA_EXT.test(rel)), fetcher, held);
    skills = scanFiles(below(second.files, src.subdir), { ...opts, oversized: second.oversized.map(within) });
  } else {
    skills = scanFiles(below(first.files, src.subdir), opts);
  }
  // Keys stay repo paths: saved skills find themselves again by key on "Cek update".
  if (src.subdir) for (const s of skills) if (s.key !== '@generated') s.key = s.key === '.' ? src.subdir : `${src.subdir}/${s.key}`;
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
    if ((total += f.data.length) > MAX_SKILL_BYTES) throw new Error(`Skill melebihi ${mb(MAX_SKILL_BYTES)}.`);
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
      url: meta.url || null, repo: meta.repo || null, origin: typeof meta.source === 'string' ? meta.source : null, paket: Array.isArray(meta.paket) ? meta.paket : [], generated: Boolean(meta.generated), importedAt: meta.importedAt, updatedAt: meta.updatedAt }];
  });
}

/** Which paket a library skill is also shown in (Apps Script, Monorepo, own paket …). */
function setLibraryPaket(root, id, paket) {
  const index = readIndex(root);
  if (!index.skills[id]) throw new Error('Skill tidak ada di library.');
  index.skills[id] = { ...index.skills[id], paket };
  writeIndex(root, index);
  return paket;
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

module.exports = { readFrontmatter, libraryRoot, slug, summarize, withFrontmatter, scanGithub, scanFiles, validRel, TEXT_EXT, SCRIPT_EXT, MEDIA_EXT, saveSkill, listLibrary, removeSkill, setLibraryPaket, markdownSkill, readIndex, ID_RE };
