'use strict';
// SantriHub Hub: one index of every skill the member has (catalog paket + own library), the
// MCP servers behind the gateway and the paket docs, searched locally without dependencies.
// The MCP servers (`mcp-serve`, `mcp-gateway`) offer it as hub_* tools so an agent loads only
// what the task needs; every hub call is logged to activity.jsonl for the dashboard.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registry, CACHE_ROOT } = require('./sources');
const library = require('./library');

const MAX_FILE_BYTES = 512 * 1024;
const MAX_BODY_CHARS = 20000;
const MAX_ACTIVITY_BYTES = 512 * 1024;

// ~/.santrihub, or the folder of an explicit gateway file (tests and portable setups).
const hubHome = (env = process.env, home = os.homedir()) =>
  env.SANTRIHUB_HOME || (env.SANTRIHUB_GATEWAY_FILE ? path.dirname(env.SANTRIHUB_GATEWAY_FILE) : path.join(home, '.santrihub'));
const activityFile = (dir) => path.join(dir, 'activity.jsonl');
const toolCacheFile = (dir) => path.join(dir, 'tool-cache.json');

// ---------------------------------------------------------------- search

const STOP = new Set(('yang dan di ke dari untuk dengan ini itu saya aku kamu mau ingin tolong buat buatkan bikin bisa ada '
  + 'agar supaya juga atau pada dalam akan sudah belum tidak jadi gimana bagaimana cara pakai pakaikan dong ya '
  + 'the a an and or for to of in on with use using when is are be it this that how my me i you').split(' '));

// Indonesian words → the English words the skill descriptions use (and common short forms).
const SYNONYMS = {
  gas: ['apps', 'script'], appscript: ['apps', 'script'], appsscript: ['apps', 'script'], spreadsheet: ['sheets'], sheet: ['sheets'], tabel: ['sheets', 'table'],
  keamanan: ['security'], aman: ['security'], amankan: ['security'], celah: ['security', 'vulnerability'],
  tampilan: ['ui', 'ux', 'design'], antarmuka: ['ui', 'interface'], desain: ['design', 'ui'], halaman: ['page', 'ui'], cantik: ['ui', 'design'], modern: ['ui', 'design'],
  uji: ['test', 'testing'], tes: ['test', 'testing'], pengujian: ['testing'],
  lambat: ['performance', 'slow'], lemot: ['performance', 'slow'], cepat: ['performance'], performa: ['performance'], kuota: ['quota'],
  otomatis: ['automation', 'trigger'], otomasi: ['automation'], jadwal: ['schedule', 'trigger'], terjadwal: ['schedule', 'trigger'], pemicu: ['trigger'],
  basisdata: ['database'], db: ['database'], data: ['data', 'database'],
  rilis: ['release', 'deploy'], terbit: ['deploy', 'release'], hosting: ['hosting', 'deploy'], deploy: ['deploy', 'deployment'],
  error: ['error', 'debug'], eror: ['error', 'debug'], galat: ['error', 'debug'], bug: ['bug', 'debug'], rusak: ['debug', 'error'], perbaiki: ['fix', 'debug', 'repair'],
  migrasi: ['migration', 'migrate'], pindah: ['migration'], integrasi: ['integration'], sambungkan: ['integration'], hubungkan: ['integration'],
  langganan: ['saas', 'subscription'], tenant: ['saas', 'tenant'], member: ['membership', 'saas'],
  arsitektur: ['architecture'], struktur: ['architecture', 'structure'], rancang: ['design', 'architecture'], rancangan: ['design', 'architecture'],
  rencana: ['plan', 'prd'], perencanaan: ['plan', 'prd'], login: ['authentication', 'login'], masuk: ['login'], autentikasi: ['authentication'],
  aplikasi: ['app'], situs: ['website', 'web'], webapp: ['web', 'app'], formulir: ['form'], laporan: ['report', 'dashboard'],
  offline: ['offline', 'pwa'], tugas: ['task'], kode: ['code'], review: ['review'], cek: ['check', 'review'],
};
const PAKET_HINTS = {
  appscript: ['apps', 'script', 'sheets', 'clasp', 'appsscript'],
  monorepo: ['monorepo', 'turborepo', 'turbo', 'nextjs', 'next', 'react', 'supabase', 'vercel', 'prd', 'pnpm'],
};

function words(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
}
/** Query words without filler, plus their English synonyms. */
function queryTokens(text) {
  const out = new Set();
  for (const w of words(text)) {
    if (STOP.has(w)) continue;
    out.add(w);
    for (const s of SYNONYMS[w] || []) out.add(s);
  }
  return [...out];
}

/** Ranks `items` ({ id, name, description, body?, paket? }) for `query`; paket in `prefer` count extra. */
function rank(items, query, { prefer = [], limit = 5 } = {}) {
  const q = queryTokens(query);
  if (!q.length) return [];
  const docs = items.map((item) => ({ item, head: new Set([...words(item.id), ...words(item.name)]), desc: new Set(words(item.description)), body: new Set(words(item.body)) }));
  const df = (t) => docs.filter((d) => d.head.has(t) || d.desc.has(t) || d.body.has(t)).length;
  const idf = Object.fromEntries(q.map((t) => [t, Math.log(1 + docs.length / (1 + df(t)))]));
  const near = (set, t) => t.length >= 4 && [...set].some((w) => w.length >= 4 && (w.startsWith(t) || t.startsWith(w)));
  const scored = docs.map((d) => {
    let score = 0;
    const hits = [];
    for (const t of q) {
      const w = idf[t];
      if (d.head.has(t)) { score += 4 * w; hits.push(t); } else if (d.desc.has(t)) { score += 2 * w; hits.push(t); } else if (d.body.has(t)) { score += 0.6 * w; hits.push(t); } else if (near(d.head, t) || near(d.desc, t)) score += 0.8 * w;
    }
    if (score > 0 && (d.item.paket || []).some((p) => prefer.includes(p))) score *= 1.4;
    return { ...d.item, score: Math.round(score * 100) / 100, hits };
  });
  const sorted = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // Weak tail matches (a shared common word) are noise next to a strong first hit.
  const floor = sorted.length ? sorted[0].score * 0.3 : 0;
  return sorted.filter((s) => s.score >= floor).slice(0, limit);
}

/** Paket a project folder looks like, from file names only (plus package.json workspaces). */
function detectProject(dir) {
  const found = { paket: [], signals: [] };
  if (!dir || !path.isAbsolute(dir)) return found;
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) return found;
  let names;
  try { names = fs.readdirSync(resolved); } catch { return found; }
  const has = (n) => names.includes(n);
  const add = (paket, signal) => { if (!found.paket.includes(paket)) found.paket.push(paket); found.signals.push(signal); };
  for (const n of ['appsscript.json', '.clasp.json']) if (has(n)) add('appscript', n);
  if (!found.paket.includes('appscript') && names.some((n) => /\.gs$/i.test(n))) add('appscript', '*.gs');
  for (const n of ['turbo.json', 'pnpm-workspace.yaml', 'nx.json', 'lerna.json']) if (has(n)) add('monorepo', n);
  if (has('package.json')) {
    try {
      const file = path.join(resolved, 'package.json');
      if (fs.statSync(file).size < 256 * 1024 && JSON.parse(fs.readFileSync(file, 'utf8')).workspaces) add('monorepo', 'package.json workspaces');
    } catch { /* not JSON: no signal */ }
  }
  for (const n of ['PRD.md', 'TASKS.md']) if (has(n)) add('monorepo', n);
  return found;
}

/** Paket hinted by the words of a request ("apps script", "turborepo" …). */
function paketFromQuery(query) {
  const q = new Set(queryTokens(query));
  return Object.entries(PAKET_HINTS).filter(([, hints]) => hints.some((h) => q.has(h))).map(([id]) => id);
}

// ---------------------------------------------------------------- index

function frontmatterAndBody(text) {
  const fm = library.readFrontmatter(text);
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').slice(0, MAX_BODY_CHARS);
  return { fm, body };
}

/**
 * Every skill the hub can hand out: catalog paket (cached repos) first, then the member's
 * library. `catalog` is the loaded catalog ([{ source, root, skills }]) or null when offline.
 */
function indexSkills({ catalog, libRoot }) {
  const out = new Map();
  for (const group of catalog || []) {
    for (const s of group.skills) {
      if (out.has(s.id)) continue;
      let text = '';
      try { text = fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'); } catch { continue; }
      out.set(s.id, { id: s.id, name: s.name, description: s.description, body: frontmatterAndBody(text).body, dir: s.dir, paket: [group.source.id], origin: 'paket', builtin: true });
    }
  }
  for (const s of libRoot ? library.listLibrary(libRoot) : []) {
    const prev = out.get(s.id);
    if (prev) { prev.paket = [...new Set([...prev.paket, ...s.paket])]; continue; }
    let text = '';
    try { text = fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'); } catch { continue; }
    out.set(s.id, { id: s.id, name: s.name, description: s.description, body: frontmatterAndBody(text).body, dir: s.dir, paket: s.paket, origin: 'library', builtin: false });
  }
  return [...out.values()];
}

/** Tools of the gateway servers as last seen ({ server: { sig, tools } }); never spawns anything. */
function readToolCache(dir) {
  try {
    const data = JSON.parse(fs.readFileSync(toolCacheFile(dir), 'utf8'));
    return data && typeof data.servers === 'object' && data.servers ? data.servers : {};
  } catch { return {}; }
}
function writeToolCache(dir, servers) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = toolCacheFile(dir), tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ version: 1, servers }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

// ---------------------------------------------------------------- files

function* walkFiles(dir, root = dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walkFiles(p, root);
    else if (d.isFile() && d.name !== '.santri-skills.json') yield path.relative(root, p).split(path.sep).join('/');
  }
}

// Read-only, inside `root` only: no absolute path, no '..', no symlink, text up to 512 KB.
function readInside(root, rel, what) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(rel)) {
    throw new Error(`path harus relatif di dalam ${what}.`);
  }
  const base = path.resolve(root);
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep)) throw new Error(`path keluar dari ${what}.`);
  for (let cur = file; cur !== base; cur = path.dirname(cur)) {
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw new Error('Symlink ditolak.');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new Error('File melebihi 512 KB.');
  const data = fs.readFileSync(file);
  if (data.includes(0)) throw new Error('File biner tidak dikirim lewat MCP.');
  return data.toString('utf8');
}

/** File list (no path) or one text file of a skill folder. */
function readSkillFile(skill, rel) {
  if (rel === undefined || rel === '') {
    const files = [...walkFiles(skill.dir)].sort();
    return `${files.length} file di skill ${skill.id}:\n${files.map((f) => `- ${f}`).join('\n')}`;
  }
  const text = readInside(skill.dir, rel, 'folder skill');
  if (text === null) throw new Error(`File '${rel}' tidak ada di skill ${skill.id}. Panggil tanpa path untuk daftar file.`);
  return text;
}

function* walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walkMarkdown(p);
    else if (d.isFile() && d.name.toLowerCase().endsWith('.md')) yield p;
  }
}

/** Markdown files of the paket repos: root files (README, START-HERE …), skills and docs dirs. */
function docFiles(sources, cacheRoot) {
  const out = [];
  for (const source of sources) {
    const root = path.join(cacheRoot, source.id);
    if (!fs.existsSync(root)) continue;
    const add = (file) => out.push({ source, root, file, rel: path.relative(root, file).split(path.sep).join('/') });
    for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isFile() && d.name.toLowerCase().endsWith('.md')) add(path.join(root, d.name));
    for (const sub of [source.skillsDir, ...(source.docsDirs || [])]) for (const file of walkMarkdown(path.join(root, sub))) add(file);
  }
  return out;
}

// ---------------------------------------------------------------- activity

const cleanClient = (name) => (typeof name === 'string' ? name.replace(/[^\w .()-]/g, '').trim().slice(0, 40) : '') || 'agent';

/** Appends one hub call; trims the log to its newest half once it passes 512 KB. Never throws. */
function logActivity(dir, entry) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = activityFile(dir);
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 });
    if (fs.statSync(file).size > MAX_ACTIVITY_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
      fs.writeFileSync(file, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n', { mode: 0o600 });
    }
  } catch { /* logging must never break a tool call */ }
}

/** Newest first. */
function readActivity(dir, limit = 50) {
  let lines;
  try { lines = fs.readFileSync(activityFile(dir), 'utf8').trim().split('\n'); } catch { return []; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const e = JSON.parse(lines[i]);
      if (e && typeof e.at === 'string' && typeof e.tool === 'string') out.push({ at: e.at, client: cleanClient(e.client), server: String(e.server || ''), tool: e.tool, detail: String(e.detail || '').slice(0, 160) });
    } catch { /* torn line */ }
  }
  return out;
}

// ---------------------------------------------------------------- MCP tools

// ---------------------------------------------------------------- Santriverse builder flow

// One flow per paket: the phases a new app goes through, the skills and paket docs of each phase,
// and the gate question the agent asks (in the Santriverse voice) before moving on.
const VOICE = 'Sampaikan setiap rekomendasi, pilihan, temuan dan gerbang fase atas nama Santriverse, contoh: "Santriverse merekomendasikan …, karena …" lalu tutup dengan pertanyaan yang bisa dijawab singkat (ya/tidak/nomor).';
const FLOWS = {
  appscript: [
    { fase: 'PRD', skills: ['apps-script-prd'], hasil: 'kebutuhan: pengguna & peran, fitur MVP, di luar cakupan, alur utama', gerbang: 'Santriverse sudah menyusun PRD dengan N fitur MVP. Ada yang mau diubah, atau lanjut ke desain UI/UX?' },
    { fase: 'Desain UI/UX', tools: ['hub_referensi'], skills: ['apps-script-design-research', 'apps-script-ui-ux', 'apps-script-motion'], hasil: 'gaya terpilih, token warna, tipografi, komponen, 4 state data, logika animasi (Tailwind, GSAP, Motion)', gerbang: 'Santriverse merekomendasikan gaya <gaya> (referensi: <link>). Setuju, atau mau lihat gaya lain?' },
    { fase: 'Arsitektur & tugas', skills: ['apps-script-architect', 'apps-script-sheets-data-layer'], hasil: 'struktur file, sheet sebagai tabel, identitas eksekusi, trigger, daftar tugas', gerbang: 'Santriverse membagi pekerjaan menjadi N tugas. Mulai dari tugas 1?' },
    { fase: 'Build per tugas', skills: ['apps-script-web-app'], opsional: ['apps-script-motion', 'apps-script-auth', 'apps-script-documents', 'apps-script-notifications', 'apps-script-automation', 'apps-script-integrations', 'apps-script-ai-integration'], hasil: 'satu tugas per putaran, dengan bukti uji', gerbang: 'Santriverse menyelesaikan tugas N. Bukti: <hasil uji>. Lanjut ke tugas berikutnya?' },
    { fase: 'Security', skills: ['apps-script-security'], hasil: 'temuan bernomor dengan risiko Tinggi/Sedang/Rendah dan perbaikannya', gerbang: 'Santriverse menemukan N hal (X risiko tinggi). Mau diimplementasikan semua perbaikannya?' },
    { fase: 'Performa & tes', skills: ['apps-script-performance', 'apps-script-testing'], hasil: 'hasil ukur kuota/waktu dan uji alur utama', gerbang: 'Santriverse merekomendasikan N optimasi. Terapkan sekarang?' },
    { fase: 'Deploy', skills: ['apps-script-clasp-deployment'], hasil: 'checklist rilis lolos; deploy hanya dengan izin', gerbang: 'Santriverse siap membantu deploy. Lanjut?' },
  ],
  monorepo: [
    { fase: 'PRD', docs: ['monorepo:docs/02-dokumen-perencanaan/01-prd.md', 'monorepo:templates/PRD.md'], hasil: 'PRD.md', gerbang: 'Santriverse sudah menyusun PRD dengan N fitur MVP. Ada yang mau diubah, atau lanjut ke desain UI/UX?' },
    { fase: 'Desain UI/UX', tools: ['hub_referensi'], skills: ['santriverse-ui-ux', 'santriverse-motion'], docs: ['monorepo:docs/02-dokumen-perencanaan/03-design-md.md', 'monorepo:templates/DESIGN.md'], hasil: 'DESIGN.md: gaya terpilih, token Tailwind, komponen shadcn/ui, 4 state data, logika animasi (Motion, GSAP)', gerbang: 'Santriverse merekomendasikan gaya <gaya> (referensi: <link>). Setuju, atau mau lihat gaya lain?' },
    { fase: 'Arsitektur & tugas', docs: ['monorepo:docs/02-dokumen-perencanaan/04-architecture-md.md', 'monorepo:docs/02-dokumen-perencanaan/05-tasks-md.md', 'monorepo:templates/ARCHITECTURE.md', 'monorepo:templates/TASKS.md'], hasil: 'ARCHITECTURE.md dan TASKS.md', gerbang: 'Santriverse membagi pekerjaan menjadi N tugas. Mulai dari tugas 1?' },
    { fase: 'Build per tugas', skills: ['santriverse-vibe-coding'], opsional: ['santriverse-ui-ux', 'santriverse-motion'], hasil: 'satu tugas per putaran, dengan bukti tes/lint/build', gerbang: 'Santriverse menyelesaikan tugas N. Bukti: <hasil uji>. Lanjut ke tugas berikutnya?' },
    { fase: 'Security', docs: ['monorepo:checklists/keamanan.md', 'monorepo:docs/14-keamanan-secret/02-hardening-aplikasi-web.md'], hasil: 'temuan bernomor dengan risiko Tinggi/Sedang/Rendah dan perbaikannya', gerbang: 'Santriverse menemukan N hal (X risiko tinggi). Mau diimplementasikan semua perbaikannya?' },
    { fase: 'Performa & tes', docs: ['monorepo:docs/08-testing/01-testing-sebelum-deploy.md', 'monorepo:checklists/qa-manual.md'], hasil: 'hasil tes dan uji alur utama', gerbang: 'Santriverse merekomendasikan N perbaikan sebelum rilis. Terapkan sekarang?' },
    { fase: 'Deploy', skills: ['pre-deploy-gate'], docs: ['monorepo:checklists/rilis-produksi.md'], hasil: 'gerbang pra-deploy lolos; deploy hanya dengan izin', gerbang: 'Santriverse siap membantu deploy. Lanjut?' },
  ],
};
// The opening skill of each paket; both carry the same phases, gates and voice.
const BUILDERS = { appscript: 'apps-script-builder', monorepo: 'santriverse-builder' };
const MOTION_SKILL = { appscript: 'apps-script-motion', monorepo: 'santriverse-motion' };

// ---------------------------------------------------------------- design references (MONOREPO-SKILLS/design-references)

const DESIGN_FILE = 'design-references/catalog.json';
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const IMAGE_FILE = /^images\/[a-z0-9-]+\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|svg)$/;
const str = (v, max = 300) => (typeof v === 'string' && v.trim() && !/[\x00-\x1f]/.test(v) ? v.trim().slice(0, max) : '');
const strs = (v, max = 20) => (Array.isArray(v) ? v.map((x) => str(x, 200)).filter(Boolean).slice(0, max) : []);
const https = (v) => { const u = str(v, 500); try { return u && new URL(u).protocol === 'https:' ? u : ''; } catch { return ''; } };
const links = (v) => (Array.isArray(v) ? v.map((x) => ({ nama: str(x && x.nama, 80), url: https(x && x.url), catatan: str(x && x.catatan, 160) })).filter((x) => x.nama && x.url).slice(0, 10) : []);

// "cara_bangun" is one text (for the catalog's own paket), or one text per paket ({ "monorepo": "…", "appscript": "…" }).
const howTo = (v, own) => {
  if (typeof v === 'string') return str(v, 400) ? { [own]: str(v, 400) } : {};
  if (!v || typeof v !== 'object') return {};
  return Object.fromEntries(Object.entries(v).filter(([k]) => SAFE_ID.test(k)).map(([k, t]) => [k, str(t, 400)]).filter(([, t]) => t));
};

/**
 * Every paket repo's design catalog merged (Apps Script app patterns, Monorepo visual styles …).
 * Entries cleaned, links https only, each tagged with its paket; the first entry of an id wins.
 */
function loadDesignCatalog(sources, cacheRoot) {
  const styles = [], seen = new Set();
  let updated = '';
  for (const source of sources) {
    const text = readInside(path.join(cacheRoot, source.id), DESIGN_FILE, 'repo paket');
    if (text === null) continue;
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`${DESIGN_FILE} di ${source.repo} bukan JSON yang valid.`); }
    const raw = `https://raw.githubusercontent.com/${source.repo}/${source.branch}/design-references/`;
    for (const s of Array.isArray(data && data.styles) ? data.styles : []) {
      if (!s || !SAFE_ID.test(s.id || '') || !str(s.nama, 80) || seen.has(s.id)) continue;
      seen.add(s.id);
      styles.push({
        id: s.id, nama: str(s.nama, 80), ringkas: str(s.ringkas), kata_kunci: strs(s.kata_kunci, 40), cocok: strs(s.cocok), hindari: strs(s.hindari), ciri: strs(s.ciri),
        warna: str(s.warna), tipografi: str(s.tipografi), animasi: str(s.animasi), cara_bangun: howTo(s.cara_bangun, source.id),
        contoh: links(s.contoh), galeri: links(s.galeri), pustaka: links(s.pustaka), paket: [source.id],
        gambar: (Array.isArray(s.gambar) ? s.gambar : []).map((g) => ({ url: g && IMAGE_FILE.test(g.file || '') ? raw + g.file : https(g && g.url), keterangan: str(g && g.keterangan, 160) })).filter((g) => g.url).slice(0, 8),
      });
    }
    const date = str(data && data.updated, 20);
    if (date > updated) updated = date;
  }
  return styles.length ? { styles, updated } : null;
}

function renderStyle(s, i, jenis, label) {
  const out = [`### ${i + 1}. ${s.nama} (gaya="${s.id}", ${s.paket.map(label).join(', ')})`, s.ringkas];
  if (s.cocok.length) out.push(`Cocok untuk: ${s.cocok.join('; ')}.`);
  if (s.ciri.length) out.push(`Ciri: ${s.ciri.join('; ')}.`);
  for (const [k, v] of [['Warna', s.warna], ['Tipografi', s.tipografi], ['Animasi', s.animasi]]) if (v) out.push(`${k}: ${v}`);
  const how = s.cara_bangun;
  if (jenis && how[jenis]) out.push(`Cara membangun (${label(jenis)}): ${how[jenis]}`);
  else for (const [k, v] of Object.entries(how)) out.push(`Cara membangun (${label(k)}): ${v}`);
  if (s.hindari.length) out.push(`Kurang cocok untuk: ${s.hindari.join('; ')}.`);
  // Each link once, in the first list that has it.
  const shown = new Set();
  const list = (title, items, note) => {
    const fresh = items.filter((c) => !shown.has(c.url) && shown.add(c.url));
    if (fresh.length) out.push(title, ...fresh.map((c) => `- ${c.nama}: ${c.url}${note && c.catatan ? ` (${c.catatan})` : ''}`));
  };
  list('Komponen & animasi siap pakai:', s.pustaka, true);
  list('Contoh nyata:', s.contoh, true);
  list('Galeri inspirasi:', s.galeri, false);
  if (s.gambar.length) out.push('Gambar referensi:', ...s.gambar.map((g) => `- ![${g.keterangan || s.nama}](${g.url})`));
  return out.filter(Boolean).join('\n');
}

const INSTRUCTIONS = [
  'SantriHub adalah pusat skill & MCP milik pengguna (paket Apps Script, Monorepo, dan skill miliknya sendiri).',
  'Untuk membuat website, web app, atau aplikasi baru: panggil hub_mulai_proyek lebih dulu. Ia memastikan jenis proyek (Apps Script atau Monorepo) lalu memberi alur Santriverse: PRD, desain UI/UX, arsitektur, build, security, tes, deploy.',
  'Untuk memilih gaya UI/UX: panggil hub_referensi lalu tawarkan 2-3 gaya beserta link referensinya.',
  VOICE,
  'Di awal setiap tugas lain: panggil hub_cari dengan ringkasan tugas (sertakan project_path bila tahu folder proyeknya).',
  'Muat hanya skill yang benar-benar dibutuhkan dengan hub_skill, lalu ikuti isinya. Jangan memuat semua skill.',
  'Materi pedoman (bab kelas, paket arsitektur, checklist, template) ada di hub_docs.',
].join(' ');

const HUB_TOOLS = [
  {
    name: 'hub_cari',
    description: 'Mulai di sini untuk setiap tugas baru. Cari skill (dan MCP) SantriHub yang cocok untuk tugas pengguna; hasilnya daftar pendek yang diurutkan. Lalu muat yang relevan dengan hub_skill.',
    inputSchema: {
      type: 'object',
      properties: {
        tugas: { type: 'string', description: 'ringkasan tugas pengguna, contoh: "buat web app absensi di Google Sheets"' },
        project_path: { type: 'string', description: 'path absolut folder proyek (opsional) untuk mendeteksi jenis proyek' },
        limit: { type: 'number', description: 'maksimal skill, default 5' },
      },
      required: ['tugas'],
      additionalProperties: false,
    },
  },
  {
    name: 'hub_skill',
    description: 'Muat isi lengkap satu skill SantriHub (SKILL.md) berdasarkan id dari hub_cari. Dengan path: baca satu file pendukung skill itu (references/, templates/, scripts/).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id skill, contoh: apps-script-web-app' },
        path: { type: 'string', description: 'path relatif file pendukung (opsional), contoh: references/checklist.md' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'hub_docs',
    description: 'Cari atau baca materi pedoman paket SantriHub (README, bab kelas, paket arsitektur, checklist, template). Dengan query: daftar dokumen yang cocok. Dengan path dari hasil itu: isi dokumennya.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'kata kunci, contoh: "deploy vercel supabase"' },
        path: { type: 'string', description: 'dokumen dari hasil pencarian, format <paket>:<path>, contoh: monorepo:START-HERE.md' },
        paket: { type: 'string', description: 'batasi ke satu paket (opsional), contoh: appscript' },
        limit: { type: 'number', description: 'maksimal hasil, default 8' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'hub_status',
    description: 'Ringkasan SantriHub: versi, jumlah skill per paket, MCP di belakang hub, dan jenis proyek yang terdeteksi. Read-only, tanpa config atau secret.',
    inputSchema: { type: 'object', properties: { project_path: { type: 'string', description: 'path absolut folder proyek (opsional)' } }, additionalProperties: false },
  },
  {
    name: 'hub_mulai_proyek',
    description: 'Panggil PERTAMA saat pengguna ingin membuat website, web app, atau aplikasi baru. Tanpa jenis: memberi pertanyaan Santriverse "Apps Script atau Monorepo?" yang wajib ditanyakan ke pengguna sebelum PRD. Dengan jenis: memberi alur fase Santriverse (PRD, desain UI/UX, arsitektur, build, security, tes, deploy) beserta skill, pedoman, dan pertanyaan gerbang tiap fase.',
    inputSchema: {
      type: 'object',
      properties: {
        tugas: { type: 'string', description: 'ide aplikasi pengguna, contoh: "aplikasi kasir toko kelontong"' },
        jenis: { type: 'string', enum: ['appscript', 'monorepo'], description: 'jenis proyek yang sudah dipilih pengguna; kosongkan bila belum ditanyakan' },
        project_path: { type: 'string', description: 'path absolut folder proyek (opsional) untuk mendeteksi jenis proyek' },
      },
      required: ['tugas'],
      additionalProperties: false,
    },
  },
  {
    name: 'hub_referensi',
    description: 'Rekomendasi UI/UX dari katalog referensi Santriverse: gaya visual (minimalis, brutalism, bento, glassmorphism …) dan pola aplikasi Apps Script (kasir, absensi, form bertahap, LMS, portal lembaga …), lengkap dengan ciri, warna, tipografi, animasi, cara membangun, pustaka komponen/animasi, link contoh nyata, dan gambar referensi.',
    inputSchema: {
      type: 'object',
      properties: {
        aplikasi: { type: 'string', description: 'jenis aplikasi, pengguna, dan kesan yang diinginkan, contoh: "dashboard kasir toko, dipakai di tablet, ingin bersih"' },
        jenis: { type: 'string', enum: ['appscript', 'monorepo'], description: 'jenis proyek bila sudah diketahui; mengutamakan referensi dan cara membangun untuk jenis itu' },
        gaya: { type: 'string', description: 'id atau nama satu gaya untuk detailnya (opsional), contoh: "neo-brutalism"' },
        limit: { type: 'number', description: 'jumlah gaya, default 3, maksimal 5' },
      },
      additionalProperties: false,
    },
  },
];

const PROMPTS = [{
  name: 'mulai',
  description: 'Kerjakan tugas dengan skill & MCP SantriHub yang cocok',
  arguments: [{ name: 'tugas', description: 'apa yang mau dikerjakan', required: true }],
}, {
  name: 'bangun',
  description: 'Bangun aplikasi baru dengan alur Santriverse (PRD sampai deploy)',
  arguments: [{ name: 'ide', description: 'ide aplikasi yang mau dibuat', required: true }],
}];
function getPrompt(name, args = {}) {
  if (name === 'bangun') {
    const ide = String(args.ide || '').slice(0, 2000);
    return {
      description: PROMPTS[1].description,
      messages: [{ role: 'user', content: { type: 'text', text: `Ide aplikasi: ${ide}\n\nGunakan SantriHub: panggil hub_mulai_proyek dengan ide ini, tanyakan jenis proyeknya bila belum jelas, lalu kerjakan fase demi fase mengikuti alur Santriverse.` } }],
    };
  }
  if (name !== 'mulai') throw Object.assign(new Error(`Prompt tidak dikenal: ${name}`), { code: -32602 });
  const tugas = String(args.tugas || '').slice(0, 2000);
  return {
    description: PROMPTS[0].description,
    messages: [{ role: 'user', content: { type: 'text', text: `Tugas: ${tugas}\n\nGunakan SantriHub: panggil hub_cari dengan tugas ini, muat skill yang cocok dengan hub_skill, lalu kerjakan tugasnya mengikuti skill itu.` } }],
  };
}

/**
 * The hub as used by an MCP server. `catalog()` resolves the loaded paket catalog (it may
 * reject when offline: the library still answers). `extraServers()` lists the MCP servers
 * behind the gateway ({ name: { tools } }), when there is one.
 */
function createHub({ catalog, env = process.env, home = os.homedir(), cwd = process.cwd(), server = 'santri-skills', version = '', extraServers = () => ({}) } = {}) {
  const dir = hubHome(env, home);
  const libRoot = path.join(dir, 'library');
  let client = 'agent';

  async function loadSkills() {
    let groups = null, offline = null;
    try { groups = await catalog(); } catch (e) { offline = e.message; }
    return { skills: indexSkills({ catalog: groups, libRoot }), offline };
  }
  const projectOf = (p) => detectProject(typeof p === 'string' && path.isAbsolute(p) ? p : cwd);
  const label = (id) => { const s = registry().sources.find((x) => x.id === id); return s ? s.short || s.label : id === 'mine' ? 'Milik Anda' : id; };

  async function find(args) {
    const tugas = String(args.tugas || '').trim();
    if (!tugas) throw new Error('tugas kosong: tulis ringkasan tugas pengguna.');
    const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 15);
    const project = projectOf(args.project_path);
    const prefer = [...new Set([...project.paket, ...paketFromQuery(tugas)])];
    const { skills, offline } = await loadSkills();
    let hits = rank(skills, tugas, { prefer, limit });
    // A detected paket with no strong match still gets its starter skill.
    for (const id of prefer) {
      const starter = registry().sources.find((s) => s.id === id)?.starter;
      const skill = starter && skills.find((s) => s.id === starter);
      if (skill && !hits.some((h) => h.id === starter) && (!hits.length || hits[0].score < 6)) hits = [...hits.slice(0, limit - 1), { ...skill, starter: true }];
    }
    const servers = extraServers();
    const tools = Object.entries(servers).flatMap(([name, s]) => (s.tools || []).map((t) => ({ id: `${name}/${t.name}`, name: t.name, description: t.description || '', paket: [], server: name })));
    const mcpHits = rank([...tools, ...Object.keys(servers).map((name) => ({ id: name, name, description: '', paket: [], server: name }))], tugas, { limit: 6 });
    const mcpServers = [...new Set(mcpHits.map((t) => t.server))];
    const lines = [];
    lines.push(project.paket.length ? `Proyek terdeteksi: ${project.paket.map(label).join(', ')} (${project.signals.join(', ')}).` : 'Jenis proyek tidak terdeteksi dari folder; hasil berdasarkan tugas saja.');
    if (hits.length) {
      lines.push('', 'Skill yang cocok (muat yang relevan saja dengan hub_skill):');
      hits.forEach((h, i) => lines.push(`${i + 1}. ${h.id} [${h.paket.map(label).join(', ') || 'Milik Anda'}]${h.starter ? ' (skill awal paket)' : ''} — ${h.description.slice(0, 220)}`));
    } else {
      lines.push('', 'Tidak ada skill yang cocok. Kerjakan tanpa skill, atau coba kata kunci lain (bahasa Inggris juga bisa).');
    }
    if (mcpServers.length) lines.push('', `MCP yang mungkin berguna: ${mcpServers.join(', ')}. Cari alatnya dengan hub_alat, jalankan dengan hub_pakai.`);
    lines.push('', 'Materi pedoman terkait: hub_docs dengan query singkat.');
    if (offline) lines.push('', `Catatan: paket bawaan belum bisa dimuat (${offline}); hanya skill milik pengguna yang dicari.`);
    return { text: lines.join('\n'), detail: `${tugas.slice(0, 100)} → ${hits.map((h) => h.id).join(', ') || '-'}` };
  }

  async function skill(args) {
    const id = String(args.id || '');
    const { skills } = await loadSkills();
    const s = skills.find((x) => x.id === id);
    if (!s) throw new Error(`Skill '${id}' tidak ditemukan. Panggil hub_cari dulu untuk id yang benar.`);
    if (args.path) return { text: readSkillFile(s, args.path), detail: `${id}/${String(args.path).slice(0, 80)}` };
    const files = [...walkFiles(s.dir)].filter((f) => f !== 'SKILL.md').sort();
    const text = fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8');
    const more = files.length ? `\n\n---\nFile pendukung skill ini (baca dengan hub_skill id="${id}" path="..."):\n${files.slice(0, 80).map((f) => `- ${f}`).join('\n')}${files.length > 80 ? `\n… dan ${files.length - 80} file lain` : ''}` : '';
    return { text: text + more, detail: id };
  }

  async function docs(args) {
    try { await catalog(); } catch { /* use whatever is cached */ }
    const sources = registry().sources.filter((s) => !args.paket || s.id === args.paket);
    if (args.path) {
      const m = /^([a-z0-9-]+):(.+)$/.exec(String(args.path));
      const source = m && sources.find((s) => s.id === m[1]);
      if (!source || !/\.md$/i.test(m[2])) throw new Error('path harus berformat <paket>:<file>.md dari hasil hub_docs.');
      const text = readInside(path.join(CACHE_ROOT, source.id), m[2], 'repo paket');
      if (text === null) throw new Error(`Dokumen '${args.path}' tidak ada. Cari dulu dengan query.`);
      return { text, detail: args.path };
    }
    const query = String(args.query || '').trim();
    if (!query) throw new Error('Isi query (kata kunci) atau path dokumen.');
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 30);
    const files = docFiles(sources, CACHE_ROOT).map((d) => {
      const text = fs.statSync(d.file).size <= MAX_FILE_BYTES ? fs.readFileSync(d.file, 'utf8') : '';
      const title = (/^#\s+(.+)$/m.exec(text) || [])[1] || path.basename(d.file);
      return { ...d, id: `${d.source.id}:${d.rel}`, name: `${d.rel} ${title}`, description: title, body: text.slice(0, MAX_BODY_CHARS), text, paket: [d.source.id] };
    });
    const hits = rank(files, query, { limit });
    if (!hits.length) return { text: `Tidak ada dokumen untuk '${query}'.`, detail: query };
    const q = queryTokens(query);
    const lines = hits.map((h) => {
      const line = h.text.split(/\r?\n/).find((l) => q.some((t) => l.toLowerCase().includes(t)) && !/^#/.test(l.trim())) || '';
      return `- ${h.id} — ${h.description.slice(0, 100)}${line ? `\n  "${line.trim().slice(0, 180)}"` : ''}`;
    });
    return { text: `Dokumen yang cocok (baca dengan hub_docs path="<paket>:<file>"):\n${lines.join('\n')}`, detail: query };
  }

  async function status(args) {
    const { skills, offline } = await loadSkills();
    const perPaket = {};
    for (const s of skills) for (const p of s.paket.length ? s.paket : ['mine']) {
      perPaket[p] ||= { bawaan: 0, tambahan: 0 };
      perPaket[p][s.builtin ? 'bawaan' : 'tambahan']++;
    }
    const servers = extraServers();
    return {
      text: JSON.stringify({
        server, version, protocolNote: 'Hub SantriHub: hub_cari → hub_skill → (hub_docs, hub_alat/hub_pakai).',
        skills: skills.length, paket: Object.fromEntries(Object.entries(perPaket).map(([p, n]) => [label(p), n])),
        mcpBehindHub: Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, (s.tools || []).length])),
        project: projectOf(args.project_path), offline: offline || undefined,
      }, null, 2),
      detail: '',
    };
  }

  // Asks Apps Script vs Monorepo unless the member already chose or the folder says so, then hands out the flow.
  async function startProject(args) {
    const tugas = String(args.tugas || '').trim().slice(0, 500);
    if (!tugas) throw new Error('tugas kosong: tulis ide aplikasi pengguna.');
    const project = projectOf(args.project_path);
    let jenis = '', why = '';
    if (FLOWS[args.jenis]) { jenis = args.jenis; why = 'dipilih pengguna'; }
    else if (project.paket.length === 1) { jenis = project.paket[0]; why = `terdeteksi dari folder: ${project.signals.join(', ')}`; }
    const sources = registry().sources;
    if (!jenis) {
      const opt = (id, n) => { const s = sources.find((x) => x.id === id) || {}; return `${n}. **${s.short || id}**: ${s.description || ''}${s.fit ? ` Cocok jika: ${s.fit.join('; ')}.` : ''}`; };
      const hint = paketFromQuery(tugas).filter((p) => FLOWS[p]);
      return {
        text: [
          'LANGKAH 0: Santriverse perlu tahu jenis proyek. Jangan menulis PRD atau kode sebelum pengguna menjawab.',
          '', 'Tanyakan ke pengguna dengan gaya ini:', '',
          '"Santriverse perlu tahu dulu: proyek ini mau dibangun dengan apa?',
          opt('appscript', 1), opt('monorepo', 2),
          'Kalau ragu, ceritakan jumlah pengguna dan datanya; Santriverse bantu pilihkan."',
          ...(hint.length === 1 ? ['', `Petunjuk dari permintaan: kemungkinan ${label(hint[0])}. Tetap konfirmasi ke pengguna.`] : []),
          '', 'Setelah dijawab, panggil hub_mulai_proyek lagi dengan jenis="appscript" atau jenis="monorepo".',
        ].join('\n'),
        detail: `${tugas.slice(0, 80)} → tanya jenis`,
      };
    }
    const { skills } = await loadSkills();
    const have = (id) => skills.some((s) => s.id === id);
    const lines = [`Proyek: ${label(jenis)} (${why}). Ide: "${tugas}".`];
    const builder = [BUILDERS[jenis], BUILDERS.monorepo].find(have);
    if (builder) lines.push(`Aturan lengkap: hub_skill id="${builder}".`);
    lines.push('', 'Alur Santriverse: kerjakan berurutan; di akhir setiap fase ringkas hasilnya, beri rekomendasi, lalu tunggu jawaban pengguna sebelum lanjut.');
    FLOWS[jenis].forEach((f, i) => {
      lines.push('', `${i + 1}. ${f.fase}`);
      if (f.tools) lines.push(`   Tool: ${f.tools.join(', ')}`);
      if (f.skills) lines.push(`   Skill (muat saat fase ini tiba): ${f.skills.map((id) => (have(id) ? id : `${id} (belum ada di katalog)`)).join(', ')}`);
      if (f.opsional) lines.push(`   Bila perlu (animasi, login, PDF, notifikasi, otomasi, integrasi, AI): ${f.opsional.filter(have).join(', ') || '-'}`);
      if (f.docs) lines.push(`   Pedoman: ${f.docs.map((d) => `hub_docs path="${d}"`).join(', ')}`);
      lines.push(`   Hasil: ${f.hasil}`, `   Gerbang: "${f.gerbang}"`);
    });
    lines.push('', `Suara: ${VOICE}`, 'Jangan commit, push, migrasi produksi, atau deploy tanpa izin eksplisit pengguna.', '', 'Mulai dari fase 1 sekarang.');
    return { text: lines.join('\n'), detail: `${tugas.slice(0, 80)} → ${jenis}` };
  }

  async function designReferences(args) {
    const aplikasi = String(args.aplikasi || '').trim().slice(0, 500), gaya = String(args.gaya || '').trim().toLowerCase();
    if (!aplikasi && !gaya) throw new Error('Isi aplikasi (jenis aplikasi, pengguna, kesan) atau gaya.');
    try { await catalog(); } catch { /* use whatever is cached */ }
    const cat = loadDesignCatalog(registry().sources, CACHE_ROOT);
    if (!cat || !cat.styles.length) return { text: 'Katalog referensi UI/UX Santriverse belum tersedia di komputer ini. Perbarui katalog SantriHub, lalu coba lagi. Sementara itu, rekomendasikan gaya tanpa link referensi dan katakan bahwa link belum tersedia.', detail: 'katalog kosong' };
    const limit = Math.min(Math.max(Number(args.limit) || 3, 1), 5);
    const jenis = FLOWS[args.jenis] ? args.jenis : '';
    // With a known jenis, only entries that say how to build them there.
    const pool = jenis ? cat.styles.filter((s) => s.cara_bangun[jenis]) : cat.styles;
    const items = pool.map((s) => ({ ...s, name: `${s.nama} ${s.kata_kunci.join(' ')}`, description: `${s.ringkas} ${s.cocok.join(' ')}`, body: s.ciri.join(' ') }));
    let picks, note = '';
    if (gaya) {
      picks = cat.styles.filter((s) => s.id === gaya || s.nama.toLowerCase() === gaya);
      if (!picks.length) picks = rank(items, gaya, { limit: 1 });
      if (!picks.length) throw new Error(`Gaya '${args.gaya}' tidak ada di katalog. Pilihan: ${cat.styles.map((s) => s.id).join(', ')}.`);
    } else {
      picks = rank(items, aplikasi, { limit, prefer: jenis ? [jenis] : [] });
      if (!picks.length) { picks = pool.slice(0, limit); note = 'Tidak ada gaya yang cocok kuat dengan deskripsi ini; berikut gaya umum di katalog. Tanyakan kesan yang diinginkan pengguna.'; }
    }
    const others = pool.filter((s) => !picks.some((p) => p.id === s.id)).map((s) => `${s.nama} (${s.id})`);
    const text = [
      `Referensi UI/UX Santriverse${aplikasi ? ` untuk: "${aplikasi}"` : ''}${cat.updated ? ` (katalog ${cat.updated})` : ''}.`,
      ...(note ? ['', note] : []),
      '', picks.map((p, i) => renderStyle(p, i, jenis, label)).join('\n\n'),
      '', 'Sampaikan ke pengguna dengan suara Santriverse, contoh: "Santriverse merekomendasikan gaya <A> atau <B> untuk aplikasi ini, karena … Lihat referensinya: <link>. Mau pakai yang mana?"',
      'Sertakan link di atas apa adanya dan jangan menambah link lain yang belum dibuka. Setelah pengguna memilih, tuangkan ke DESIGN.md: token warna, tipografi, komponen, dan aturan animasi.',
      `Untuk logika animasi muat skill ${MOTION_SKILL[jenis] || `${MOTION_SKILL.monorepo} (Monorepo) atau ${MOTION_SKILL.appscript} (Apps Script)`} dengan hub_skill.`,
      ...(others.length ? ['', `Gaya lain di katalog (detail: hub_referensi gaya="<id>"): ${others.join(', ')}.`] : []),
    ].join('\n');
    return { text, detail: `${(aplikasi || gaya).slice(0, 80)} → ${picks.map((p) => p.id).join(', ')}` };
  }

  const handlers = { hub_cari: find, hub_skill: skill, hub_docs: docs, hub_status: status, hub_mulai_proyek: startProject, hub_referensi: designReferences };
  return {
    tools: HUB_TOOLS,
    instructions: INSTRUCTIONS,
    prompts: PROMPTS,
    getPrompt,
    dir,
    setClient(info) { client = cleanClient(info && info.name); },
    has: (name) => Object.hasOwn(handlers, name),
    log(tool, detail) { logActivity(dir, { client, server, tool, detail }); },
    /** Text result of hub tool `name`; logged to the activity file. */
    async call(name, args = {}) {
      const { text, detail } = await handlers[name](args || {});
      logActivity(dir, { client, server, tool: name, detail });
      return text;
    },
  };
}

module.exports = {
  createHub, HUB_TOOLS, INSTRUCTIONS, PROMPTS, getPrompt, hubHome, rank, queryTokens, detectProject, paketFromQuery, FLOWS, loadDesignCatalog,
  indexSkills, readSkillFile, walkFiles, readToolCache, writeToolCache, logActivity, readActivity, activityFile,
};
