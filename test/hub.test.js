'use strict';
// SantriHub Hub (src/hub.js): one index over paket + library skills, search, project detection,
// sandboxed skill/doc reads and the activity log, through a real `mcp-serve` process.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const hub = require('../src/hub');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const skillMd = (name, description, body = '') => `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n${body}\n`;

// Offline cache of both paket repos, a library with one own skill, and an Apps Script project.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-hub-'));
  const cache = path.join(root, 'cache'), home = path.join(root, 'hub');
  for (const id of ['appscript', 'monorepo']) write(path.join(cache, id, '.fetched'), 'x');
  write(path.join(cache, 'appscript', 'skills', 'apps-script-architect', 'SKILL.md'), skillMd('apps-script-architect', 'Design Google Apps Script architecture before implementation.'));
  write(path.join(cache, 'appscript', 'skills', 'apps-script-builder', 'SKILL.md'), skillMd('apps-script-builder', 'Opening skill for a new Apps Script project with Santriverse.'));
  write(path.join(cache, 'appscript', 'skills', 'apps-script-web-app', 'SKILL.md'), skillMd('apps-script-web-app', 'Build Google Apps Script web apps with HTML Service, forms and dashboards.'));
  write(path.join(cache, 'appscript', 'skills', 'apps-script-web-app', 'references', 'routing.md'), 'ROUTING NOTES');
  write(path.join(cache, 'appscript', 'skills', 'apps-script-performance', 'SKILL.md'), skillMd('apps-script-performance', 'Optimize slow, quota-heavy or timeout-prone Apps Script code and Sheets batching.'));
  write(path.join(cache, 'monorepo', 'skills', 'santriverse-vibe-coding', 'SKILL.md'), skillMd('santriverse-vibe-coding', 'Build an app from PRD and TASKS files one task at a time.'));
  write(path.join(cache, 'monorepo', 'skills', 'pre-deploy-gate', 'SKILL.md'), skillMd('pre-deploy-gate', 'Use before deploying a web app: tests, secrets, rollback.'));
  write(path.join(cache, 'monorepo', 'START-HERE.md'), '# Mulai dari sini\nPilih jalur belajar dulu.\n');
  write(path.join(cache, 'monorepo', 'docs', '09-deploy', 'vercel.md'), '# Deploy ke Vercel\nHubungkan repo GitHub ke Vercel lalu deploy.\n');
  write(path.join(cache, 'monorepo', 'secret.txt'), 'SECRET');
  write(path.join(home, 'library', 'skills', 'migrasi-ke-supabase', 'SKILL.md'), skillMd('migrasi-ke-supabase', 'Migrasi database Google Sheets ke Supabase PostgreSQL.'));
  write(path.join(home, 'library', 'index.json'), JSON.stringify({ version: 1, skills: { 'migrasi-ke-supabase': { type: 'markdown', paket: ['appscript'] } } }));
  const project = path.join(root, 'absensi');
  write(path.join(project, 'appsscript.json'), '{}');
  return { root, cache, home, project };
}

function serve(fx, lines) {
  const input = lines.map((m) => JSON.stringify({ jsonrpc: '2.0', ...m })).join('\n') + '\n';
  const r = spawnSync(process.execPath, [CLI, 'mcp-serve'], {
    input, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SANTRI_SKILLS_CACHE: fx.cache, SANTRIHUB_HOME: fx.home, SANTRIHUB_BRIDGE_FILE: path.join(fx.root, 'bridge.json') },
  });
  const replies = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return (id) => replies.find((x) => x.id === id);
}
const call = (id, name, args) => ({ id, method: 'tools/call', params: { name, arguments: args } });
const text = (reply) => reply.result.content[0].text;

test('query words: filler dropped, Indonesian words also searched in English', () => {
  const q = hub.queryTokens('Tolong buatkan tampilan yang aman untuk aplikasi GAS');
  for (const w of ['tampilan', 'ui', 'aman', 'security', 'apps', 'script']) assert.ok(q.includes(w), w);
  for (const w of ['tolong', 'buatkan', 'yang', 'untuk']) assert.ok(!q.includes(w), w);
  assert.deepEqual(hub.paketFromQuery('web app google apps script'), ['appscript']);
  assert.deepEqual(hub.paketFromQuery('monorepo turborepo'), ['monorepo']);
});

test('ranking: name beats description beats body; weak tail matches are dropped', () => {
  const items = [
    { id: 'apps-script-performance', name: 'apps-script-performance', description: 'Optimize slow code', paket: ['appscript'] },
    { id: 'ui-kit', name: 'ui-kit', description: 'Pretty buttons', body: 'sometimes code is slow', paket: [] },
    { id: 'notes', name: 'notes', description: 'Unrelated', paket: [] },
  ];
  const hits = hub.rank(items, 'kode lambat', { limit: 5 });
  assert.equal(hits[0].id, 'apps-script-performance');
  assert.ok(!hits.some((h) => h.id === 'notes'));
  assert.deepEqual(hub.rank(items, 'yang dan di'), [], 'only filler: no results');
});

test('project detection reads file names only and ignores home and drive roots', () => {
  const fx = fixture();
  try {
    assert.deepEqual(hub.detectProject(fx.project), { paket: ['appscript'], signals: ['appsscript.json'] });
    const mono = path.join(fx.root, 'mono');
    write(path.join(mono, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    write(path.join(mono, 'turbo.json'), '{}');
    assert.deepEqual(hub.detectProject(mono).paket, ['monorepo']);
    assert.deepEqual(hub.detectProject(os.homedir()).paket, []);
    assert.deepEqual(hub.detectProject('relative/path').paket, []);
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('hub over MCP: find, load a skill and its files, docs, status, prompt and activity log', () => {
  const fx = fixture();
  try {
    const reply = serve(fx, [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Antigravity' } } },
      { id: 2, method: 'tools/list' },
      call(3, 'hub_cari', { tugas: 'buatkan web app absensi dengan form', project_path: fx.project }),
      call(4, 'hub_cari', { tugas: 'pindahkan data sheets ke supabase' }),
      call(5, 'hub_skill', { id: 'apps-script-web-app' }),
      call(6, 'hub_skill', { id: 'apps-script-web-app', path: 'references/routing.md' }),
      call(7, 'hub_skill', { id: 'apps-script-web-app', path: '../../apps-script-architect/SKILL.md' }),
      call(8, 'hub_docs', { query: 'deploy vercel' }),
      call(9, 'hub_docs', { path: 'monorepo:START-HERE.md' }),
      call(10, 'hub_docs', { path: 'monorepo:secret.txt' }),
      call(11, 'hub_status', { project_path: fx.project }),
      call(12, 'hub_cari', { tugas: 'lanjutkan pekerjaan kemarin', project_path: fx.project }),
      { id: 13, method: 'prompts/get', params: { name: 'mulai', arguments: { tugas: 'bikin toko online' } } },
      call(14, 'hub_skill', { id: 'tidak-ada' }),
    ]);
    const init = reply(1).result;
    assert.match(init.instructions, /hub_cari/);
    assert.ok(init.capabilities.prompts);
    const names = reply(2).result.tools.map((t) => t.name);
    for (const n of ['hub_cari', 'hub_skill', 'hub_docs', 'hub_status', 'list_skills', 'santrihub_verify']) assert.ok(names.includes(n), n);

    const found = text(reply(3));
    assert.match(found, /Proyek terdeteksi: Apps Script \(appsscript\.json\)/);
    assert.match(found, /^1\. apps-script-web-app \[Apps Script\]/m);
    assert.match(text(reply(4)), /^1\. migrasi-ke-supabase \[Apps Script\]/m, 'own library skills are searched too');

    assert.match(text(reply(5)), /^---\nname: apps-script-web-app/);
    assert.match(text(reply(5)), /- references\/routing\.md/);
    assert.equal(text(reply(6)), 'ROUTING NOTES');
    assert.equal(reply(7).result.isError, true);

    assert.match(text(reply(8)), /monorepo:docs\/09-deploy\/vercel\.md — Deploy ke Vercel/);
    assert.match(text(reply(9)), /Pilih jalur belajar/);
    assert.equal(reply(10).result.isError, true, 'only Markdown docs are readable');
    assert.doesNotMatch(JSON.stringify(reply(10)), /SECRET/);

    const status = JSON.parse(text(reply(11)));
    assert.equal(status.skills, 7);
    assert.deepEqual(status.paket['Apps Script'], { bawaan: 4, tambahan: 1 });
    assert.deepEqual(status.paket.Monorepo, { bawaan: 2, tambahan: 0 });
    assert.deepEqual(status.project.paket, ['appscript']);

    assert.match(text(reply(12)), /apps-script-builder \[Apps Script\] \(skill awal paket\)/, 'a vague task in a known project gets the starter skill');
    assert.match(reply(13).result.messages[0].content.text, /bikin toko online[\s\S]*hub_cari/);
    assert.match(text(reply(14)), /tidak ditemukan/);

    const log = hub.readActivity(fx.home);
    assert.deepEqual([...new Set(log.map((e) => e.tool))].sort(), ['hub_cari', 'hub_docs', 'hub_skill', 'hub_status']);
    assert.ok(log.every((e) => e.client === 'Antigravity' && e.server === 'santri-skills'));
    assert.ok(log.some((e) => e.tool === 'hub_cari' && /absensi.*apps-script-web-app/.test(e.detail)));
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

test('activity log: torn lines skipped, trimmed when it grows past 512 KB', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-activity-'));
  try {
    fs.writeFileSync(hub.activityFile(dir), '{"broken\n');
    for (let i = 0; i < 3; i++) hub.logActivity(dir, { client: 'x<script>', server: 'santrihub', tool: 'hub_cari', detail: `q${i}` });
    const log = hub.readActivity(dir);
    assert.deepEqual(log.map((e) => e.detail), ['q2', 'q1', 'q0']);
    assert.equal(log[0].client, 'xscript');
    fs.appendFileSync(hub.activityFile(dir), (JSON.stringify({ at: 'x', tool: 'hub_cari', detail: 'y'.repeat(200) }) + '\n').repeat(3000));
    hub.logActivity(dir, { tool: 'hub_status' });
    assert.ok(fs.statSync(hub.activityFile(dir)).size < 512 * 1024);
    assert.equal(hub.readActivity(dir, 1)[0].tool, 'hub_status');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('builder flow and design references: ask Apps Script or Monorepo first, then phases; styles with https links only', () => {
  const fx = fixture();
  try {
    write(path.join(fx.cache, 'monorepo', 'skills', 'santriverse-builder', 'SKILL.md'), skillMd('santriverse-builder', 'Build a new app with Santriverse from PRD to deploy.'));
    write(path.join(fx.cache, 'appscript', 'skills', 'apps-script-prd', 'SKILL.md'), skillMd('apps-script-prd', 'Turn an Apps Script app idea into a one-page PRD.'));
    write(path.join(fx.cache, 'appscript', 'skills', 'apps-script-auth', 'SKILL.md'), skillMd('apps-script-auth', 'Login, sessions and roles for Apps Script web apps.'));
    write(path.join(fx.cache, 'monorepo', 'design-references', 'catalog.json'), JSON.stringify({ version: 1, updated: '2026-11-23', styles: [
      { id: 'minimalis', nama: 'Minimalis', ringkas: 'Bersih dan tenang.', kata_kunci: ['minimal', 'dashboard', 'kasir'], cocok: ['dashboard'], ciri: ['ruang kosong'], warna: 'Netral', cara_bangun: { monorepo: 'shadcn/ui + Tailwind.', appscript: 'Tailwind + Flowbite.' }, pustaka: [{ nama: 'shadcn/ui', url: 'https://ui.shadcn.com' }, { nama: 'Bad', url: 'http://x.example' }], contoh: [{ nama: 'Linear', url: 'https://linear.app' }, { nama: 'Bad', url: 'http://insecure.example' }, { nama: 'Js', url: 'javascript:alert(1)' }], gambar: [{ file: 'images/minimalis/kasir.webp', keterangan: 'Kasir' }, { file: '../secret.png' }] },
      { id: 'playful', nama: 'Playful', ringkas: 'Ceria.', kata_kunci: ['anak', 'belajar', 'kuis'], cocok: ['aplikasi belajar'], galeri: [{ nama: 'Dribbble', url: 'https://dribbble.com/search/playful-ui' }] },
      { id: 'Bad Id', nama: 'Rusak' },
      { id: 'pola-kasir', nama: 'Duplikat', ringkas: 'Id sudah ada di katalog Apps Script (dibaca lebih dulu): diabaikan.', kata_kunci: ['kasir'] },
    ] }));
    // The Apps Script repo has its own catalog (app patterns); both are merged.
    write(path.join(fx.cache, 'appscript', 'design-references', 'catalog.json'), JSON.stringify({ version: 1, updated: '2026-11-24', styles: [
      { id: 'pola-kasir', nama: 'Pola: Kasir', ringkas: 'Layar kasir cepat.', kata_kunci: ['kasir', 'pos', 'toko'], cocok: ['toko'], cara_bangun: 'Tailwind + Motion animate.', pustaka: [{ nama: 'Flowbite', url: 'https://flowbite.com' }] },
    ] }));
    const mono = path.join(fx.root, 'mono');
    write(path.join(mono, 'turbo.json'), '{}');
    const reply = serve(fx, [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'Claude Code' } } },
      { id: 2, method: 'tools/list' },
      call(3, 'hub_mulai_proyek', { tugas: 'buatkan aplikasi kasir toko' }),
      call(4, 'hub_mulai_proyek', { tugas: 'buatkan aplikasi kasir toko', jenis: 'appscript' }),
      call(5, 'hub_mulai_proyek', { tugas: 'lanjutkan aplikasi', project_path: mono }),
      call(6, 'hub_referensi', { aplikasi: 'dashboard kasir toko yang minimal' }),
      call(7, 'hub_referensi', { gaya: 'playful' }),
      call(8, 'hub_referensi', { gaya: 'tidak-ada' }),
      { id: 9, method: 'prompts/get', params: { name: 'bangun', arguments: { ide: 'aplikasi absensi santri' } } },
      call(10, 'hub_referensi', { aplikasi: 'dashboard kasir toko yang minimal', jenis: 'appscript' }),
      call(11, 'hub_referensi', { aplikasi: 'dashboard kasir toko yang minimal', jenis: 'monorepo' }),
    ]);
    assert.match(reply(1).result.instructions, /hub_mulai_proyek[\s\S]*hub_referensi[\s\S]*Santriverse merekomendasikan/);
    const names = reply(2).result.tools.map((t) => t.name);
    for (const n of ['hub_mulai_proyek', 'hub_referensi']) assert.ok(names.includes(n), n);

    const ask = text(reply(3));
    assert.match(ask, /Jangan menulis PRD atau kode sebelum pengguna menjawab/);
    assert.match(ask, /Santriverse perlu tahu dulu: proyek ini mau dibangun dengan apa\?\n1\. \*\*Apps Script\*\*[\s\S]*\n2\. \*\*Monorepo\*\*/);
    assert.doesNotMatch(ask, /1\. PRD/, 'no phases before the member answers');

    const gas = text(reply(4));
    assert.match(gas, /Proyek: Apps Script \(dipilih pengguna\)/);
    assert.match(gas, /hub_skill id="apps-script-builder"/, 'the Apps Script flow points to its own builder');
    assert.match(gas, /1\. PRD\n   Skill \(muat saat fase ini tiba\): apps-script-prd\n/);
    assert.match(gas, /Bila perlu \(animasi, login, PDF, notifikasi, otomasi, integrasi, AI\): apps-script-auth\n/, 'optional skills only when present');
    assert.match(gas, /apps-script-security \(belum ada di katalog\)/, 'missing skills are named, not hidden');
    assert.match(gas, /Gerbang: "Santriverse menemukan N hal/);

    const monoFlow = text(reply(5));
    assert.match(monoFlow, /Proyek: Monorepo \(terdeteksi dari folder: turbo\.json\)/);
    assert.match(monoFlow, /hub_docs path="monorepo:templates\/PRD\.md"/);
    assert.match(monoFlow, /Skill \(muat saat fase ini tiba\): santriverse-vibe-coding\n/);

    const refs = text(reply(6));
    assert.match(refs, /### \d\. Minimalis \(gaya="minimalis", Monorepo\)/);
    assert.match(refs, /### \d\. Pola: Kasir \(gaya="pola-kasir", Apps Script\)/, 'both catalogs are searched');
    assert.match(refs, /\(katalog 2026-11-24\)/, 'newest catalog date');
    assert.match(refs, /- Linear: https:\/\/linear\.app/);
    assert.match(refs, /Komponen & animasi siap pakai:\n- shadcn\/ui: https:\/\/ui\.shadcn\.com/);
    assert.match(refs, /Cara membangun \(Monorepo\): shadcn\/ui \+ Tailwind\.\nCara membangun \(Apps Script\): Tailwind \+ Flowbite\./, 'no jenis: every build note');
    assert.doesNotMatch(refs, /insecure\.example|x\.example|javascript:|secret\.png|Rusak|Duplikat/);
    assert.match(refs, /!\[Kasir\]\(https:\/\/raw\.githubusercontent\.com\/askiya\/MONOREPO-SKILLS\/main\/design-references\/images\/minimalis\/kasir\.webp\)/);
    assert.match(refs, /Santriverse merekomendasikan gaya/);
    assert.match(refs, /santriverse-motion \(Monorepo\) atau apps-script-motion \(Apps Script\)/);
    assert.match(refs, /Gaya lain di katalog[^\n]*Playful \(playful\)/);

    const gasRefs = text(reply(10));
    assert.match(gasRefs, /### \d\. Pola: Kasir \(gaya="pola-kasir", Apps Script\)/);
    assert.match(gasRefs, /Cara membangun \(Apps Script\): Tailwind \+ Flowbite\./);
    assert.doesNotMatch(gasRefs, /Cara membangun \(Monorepo\)/);
    assert.match(gasRefs, /muat skill apps-script-motion dengan hub_skill/);
    const monoRefs = text(reply(11));
    assert.match(monoRefs, /Cara membangun \(Monorepo\): shadcn\/ui \+ Tailwind\.[\s\S]*muat skill santriverse-motion/);
    assert.doesNotMatch(monoRefs, /pola-kasir/, 'an entry with only Apps Script build notes is not offered for Monorepo');
    assert.match(refs, /Cara membangun \(Apps Script\): Tailwind \+ Motion animate\./, 'a single build note belongs to its own paket');

    assert.match(text(reply(7)), /### 1\. Playful \(gaya="playful", Monorepo\)[\s\S]*https:\/\/dribbble\.com\/search\/playful-ui/);
    assert.equal(reply(8).result.isError, true);
    assert.match(reply(9).result.messages[0].content.text, /aplikasi absensi santri[\s\S]*hub_mulai_proyek/);

    const log = hub.readActivity(fx.home);
    assert.ok(log.some((e) => e.tool === 'hub_mulai_proyek' && /tanya jenis/.test(e.detail)));
    assert.ok(log.some((e) => e.tool === 'hub_referensi' && /minimalis/.test(e.detail)));
  } finally { fs.rmSync(fx.root, { recursive: true, force: true }); }
});

// The catalogs in the local MONOREPO-SKILLS and GOOGLE-APPSCRIPT-SKILLS checkouts, when present.
const REAL_CATALOGS = [['monorepo', 'PEDOMAN MONOREPO', 'askiya/MONOREPO-SKILLS'], ['appscript', 'GAS MOD SKILLS APPSCRIPT', 'askiya/GOOGLE-APPSCRIPT-SKILLS']]
  .map(([id, dir, repo]) => ({ id, repo, branch: 'main', file: path.join(__dirname, '..', '..', dir, 'design-references', 'catalog.json') }))
  .filter((c) => fs.existsSync(c.file));
test('the real design catalogs parse with https links, build notes, and ids unique across repos', { skip: !REAL_CATALOGS.length && 'repo katalog lokal tidak ada' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-design-'));
  try {
    let total = 0;
    for (const c of REAL_CATALOGS) {
      write(path.join(root, c.id, 'design-references', 'catalog.json'), fs.readFileSync(c.file, 'utf8'));
      const raw = JSON.parse(fs.readFileSync(c.file, 'utf8'));
      total += raw.styles.length;
      const cat = hub.loadDesignCatalog([c], root);
      assert.equal(cat.styles.length, raw.styles.length, `${c.id}: no style dropped by validation`);
      for (const s of cat.styles) {
        const r = raw.styles.find((x) => x.id === s.id), count = (k) => (r[k] || []).length;
        assert.equal(s.contoh.length + s.galeri.length + s.pustaka.length, count('contoh') + count('galeri') + count('pustaka'), `${s.id}: every link is https`);
        assert.ok(s.kata_kunci.length >= 5 && s.contoh.length + s.galeri.length >= 1, s.id);
        assert.ok(Object.keys(s.cara_bangun).length >= 1 && s.pustaka.length >= 1, `${s.id}: build note and libraries`);
      }
    }
    const merged = hub.loadDesignCatalog(REAL_CATALOGS, root);
    assert.equal(merged.styles.length, total, 'ids are unique across both repos');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
