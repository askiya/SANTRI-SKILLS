'use strict';
// The member's skill library: GitHub import (with generated SKILL.md), Markdown skills,
// storage, and the dashboard API that ties them to the AI agents.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
// Before sources.js loads: never touch the real ~/.santri-skills/cache.
process.env.SANTRI_SKILLS_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-library-cache-'));
const L = require('../src/library');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-library-'));

// A codeload.github.com tar.gz for repo `fixture/<name>` on `branch`.
function tarball(files, root = 'repo-main') {
  const blocks = [];
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text);
    const h = Buffer.alloc(512);
    h.write(`${root}/${name}`);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h[156] = 48;
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}
function githubFixture(files, branch = 'main') {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url) === `https://codeload.github.com/fixture/repo/tar.gz/refs/heads/${branch}`) return new Response(tarball(files));
    return new Response('Not Found', { status: 404 });
  };
  return { fetcher, calls };
}

test('frontmatter helpers: block values, rewrite keeps other keys, ids follow the spec', () => {
  assert.deepEqual(L.readFrontmatter('---\nname: x\ndescription: >-\n  Line one\n  line two.\nlicense: MIT\n---\nbody'), { name: 'x', description: 'Line one line two.', license: 'MIT' });
  assert.deepEqual(L.readFrontmatter("---\ndescription: 'It''s \"ok\"'\n---\n"), { description: `It's "ok"` });
  const md = L.withFrontmatter('---\nname: Old\ndescription: >-\n  a\n  b\nlicense: MIT\n---\n\n# Body', { name: 'new-one', description: 'Use when "x".' });
  assert.equal(md, `---\nname: new-one\ndescription: 'Use when "x".'\nlicense: MIT\n---\n\n# Body`);
  assert.equal(L.withFrontmatter('# Only body', { name: 'a', description: 'b' }), '---\nname: a\ndescription: "b"\n---\n\n# Only body');
  assert.equal(L.slug('Taste Skill: Frontend Désign!'), 'taste-skill-frontend-design');
  assert.equal(L.slug('***'), 'skill');
  assert.equal(L.summarize('# Title\n\n![badge](x)\n\nMakes **agents** design [better](http://x) pages, every time.\n\nMore.'), 'Makes agents design better pages, every time.');
});

test('GitHub: every SKILL.md folder becomes a skill with its text files; scripts only on request', async () => {
  const big = Buffer.alloc(600 * 1024, 'a');
  const f = githubFixture({
    'README.md': '# Repo',
    'skills/taste/SKILL.md': '---\nname: design-taste\ndescription: >-\n  Gives agents taste\n  for frontends.\n---\n# Taste',
    'skills/taste/references/colour.md': 'colours',
    'skills/taste/library/data.json': '{}',
    'skills/taste/library/huge.json': big,
    'skills/taste/scripts/draw.mjs': 'console.log(1)',
    'skills/plain/SKILL.md': '# Plain skill\n\nChecks deploys before release, step by step.',
    '.claude-plugin/skills/taste/SKILL.md': 'mirror',
    'node_modules/x/SKILL.md': 'vendored',
  });
  const scan = await L.scanGithub('https://github.com/fixture/repo', { fetcher: f.fetcher });
  assert.equal(scan.source.branch, 'main');
  assert.deepEqual(scan.skills.map((s) => [s.key, s.id]), [['skills/plain', 'plain'], ['skills/taste', 'design-taste']]);
  const taste = scan.skills[1];
  assert.equal(taste.description, 'Gives agents taste for frontends.');
  assert.equal(taste.repaired, false);
  assert.deepEqual(taste.files.map((x) => x.rel).sort(), ['library/data.json', 'references/colour.md']);
  assert.deepEqual(taste.skipped.sort(), ['library/huge.json (> 512 KB)', 'scripts/draw.mjs']);
  const plain = scan.skills[0];
  assert.equal(plain.repaired, true, 'SKILL.md without frontmatter is repaired');
  assert.match(plain.skillMd, /^---\nname: plain\ndescription: "Checks deploys before release, step by step\."\n---\n\n# Plain skill/);

  const withScripts = await L.scanGithub('https://github.com/fixture/repo', { fetcher: f.fetcher, includeScripts: true });
  assert.ok(withScripts.skills[1].files.some((x) => x.rel === 'scripts/draw.mjs'));
});

test('GitHub: a repo without SKILL.md gets one generated from its instructions', async () => {
  const f = githubFixture({
    'README.md': '# Cool rules\n\n[![ci](x)](y)\n\nRules that make the agent write tidy TypeScript.',
    'AGENTS.md': '# Agent rules\n\nAlways write tests first and keep functions small.',
    'docs/deep.md': 'not at root',
  }, 'master');
  const scan = await L.scanGithub('https://github.com/fixture/repo', { fetcher: f.fetcher });
  assert.ok(f.calls.some((u) => u.endsWith('/main')) && scan.source.branch === 'master', 'falls back from main to master');
  const [s] = scan.skills;
  assert.equal(s.generated, true);
  assert.equal(s.id, 'repo');
  assert.equal(s.description, 'Always write tests first and keep functions small.', 'AGENTS.md wins over README.md');
  assert.match(s.skillMd, /^---\nname: repo\ndescription: "Always write tests first and keep functions small\."\n---\n\n> Dibuat otomatis oleh SantriHub dari `AGENTS.md`/);
  assert.deepEqual(s.files.map((x) => x.rel), ['references/README.md']);
  await assert.rejects(L.scanGithub('https://github.com/fixture/repo', { fetcher: githubFixture({ 'src/a.js': 'x' }).fetcher }), /tidak punya SKILL\.md/);
});

test('library storage: atomic save, list, overwrite, remove; unsafe input refused', () => {
  const root = tmp();
  try {
    L.saveSkill(root, { id: 'demo', skillMd: '---\nname: demo\ndescription: "D"\n---\nhi', files: [{ rel: 'references/a.md', data: Buffer.from('A') }], meta: { type: 'markdown' } });
    assert.equal(fs.readFileSync(path.join(root, 'skills', 'demo', 'references', 'a.md'), 'utf8'), 'A');
    assert.deepEqual(L.listLibrary(root).map((s) => [s.id, s.name, s.description, s.type]), [['demo', 'demo', 'D', 'markdown']]);
    const first = L.readIndex(root).skills.demo.importedAt;
    L.saveSkill(root, { id: 'demo', skillMd: '---\nname: demo\ndescription: "D2"\n---\nhi', meta: { type: 'markdown' } });
    assert.ok(!fs.existsSync(path.join(root, 'skills', 'demo', 'references')), 'overwrite replaces the folder');
    assert.equal(L.readIndex(root).skills.demo.importedAt, first);
    for (const rel of ['../x.md', '/abs.md', 'a/../../b.md', '.hidden/x.md', 'C:x.md']) {
      assert.throws(() => L.saveSkill(root, { id: 'bad', skillMd: 'x', files: [{ rel, data: Buffer.from('') }], meta: {} }), /tidak aman/, rel);
    }
    assert.throws(() => L.saveSkill(root, { id: 'Bad_ID', skillMd: 'x', meta: {} }), /huruf kecil/);
    assert.deepEqual(L.removeSkill(root, 'demo'), { removed: true, id: 'demo' });
    assert.deepEqual(L.listLibrary(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Markdown skills: id/description from the text, references validated', () => {
  const s = L.markdownSkill({ content: '# Gaya Tulis Saya\n\nPakai bahasa santai dan contoh nyata saat menulis artikel.', references: [{ name: 'contoh.md', content: 'x' }] });
  assert.equal(s.id, 'gaya-tulis-saya');
  assert.equal(s.description, 'Pakai bahasa santai dan contoh nyata saat menulis artikel.');
  assert.deepEqual(s.files.map((f) => f.rel), ['references/contoh.md']);
  assert.equal(L.markdownSkill({ id: 'Custom ID', description: 'Kapan dipakai', content: '---\nname: x\n---\nbody' }).id, 'custom-id');
  assert.throws(() => L.markdownSkill({ content: '' }), /wajib/);
  assert.throws(() => L.markdownSkill({ content: '# T' }), /Deskripsi wajib/);
  assert.throws(() => L.markdownSkill({ content: '# T\n\nlong enough description here', references: [{ name: '.hidden.md', content: 'x' }] }), /tidak valid/);
  assert.throws(() => L.markdownSkill({ content: '# T\n\nlong enough description here', references: [{ name: 'run.sh', content: 'x' }] }), /tidak valid/);
});

test('dashboard: library API saves GitHub and Markdown skills, activates them per agent, updates and deletes', async () => {
  const http = require('node:http');
  const home = tmp();
  // Offline catalog: bundled sources already "fetched" into the cache used by sources.js.
  const { CACHE_ROOT } = require('../src/sources');
  for (const id of ['appscript', 'monorepo']) {
    fs.mkdirSync(path.join(CACHE_ROOT, id, 'skills', `cat-${id}`), { recursive: true });
    fs.writeFileSync(path.join(CACHE_ROOT, id, '.fetched'), 'x');
    fs.writeFileSync(path.join(CACHE_ROOT, id, 'skills', `cat-${id}`, 'SKILL.md'), '---\nname: c\ndescription: d\n---\n');
  }
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog') ? { success: true, sources: [], mcpServers: [] } : { success: true, token: 't', user: { name: 'M', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  let repo = { 'skills/taste/SKILL.md': '---\nname: taste\ndescription: v1\n---\nv1', 'skills/taste/references/a.md': 'A' };
  const githubFetch = async (url) => (String(url).endsWith('/main') ? new Response(tarball(repo)) : new Response('', { status: 404 }));
  const { createDashboardServer } = require('../src/dashboard');
  const server = createDashboardServer({ cwd: home, home, env: { ...process.env, APPDATA: path.join(home, 'AppData') }, githubFetch, apiUrl: `http://127.0.0.1:${remote.address().port}/api` });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    assert.equal((await fetch(base + '/api/library')).status, 401);
    const state = new URL((await post('/api/auth/login', {})).body.url).searchParams.get('state');
    const { csrf } = (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).body;
    assert.equal((await post('/api/library/markdown', { content: '# x\n\nlong enough description' })).status, 403, 'CSRF required');

    const preview = await post('/api/library/github/preview', { url: 'https://github.com/fixture/repo', _csrf: csrf });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.skills.map((s) => [s.key, s.id, s.files]), [['skills/taste', 'taste', ['references/a.md']]]);
    assert.equal((await post('/api/library/github/save', { previewId: preview.body.previewId, picks: [{ key: 'skills/taste', id: 'cat-appscript' }], _csrf: csrf })).status, 409, 'catalog ids are reserved');
    const saved = await post('/api/library/github/save', { previewId: preview.body.previewId, picks: [{ key: 'skills/taste', id: 'my-taste', description: 'Pakai saat mendesain halaman.' }], _csrf: csrf });
    assert.deepEqual(saved.body, { saved: ['my-taste'] });
    assert.match(fs.readFileSync(path.join(home, '.santrihub', 'library', 'skills', 'my-taste', 'SKILL.md'), 'utf8'), /^---\nname: my-taste\ndescription: "Pakai saat mendesain halaman\."\n---\n\nv1/);

    assert.deepEqual((await post('/api/library/markdown', { content: '# Gaya Saya\n\nPakai bahasa santai saat menulis artikel.', _csrf: csrf })).body, { saved: ['gaya-saya'], synced: [] });
    assert.equal((await post('/api/library/markdown', { content: '# Gaya Saya\n\nisi lain yang cukup panjang untuk deskripsi', _csrf: csrf })).status, 409, 'same id needs overwrite');
    const list = await (await fetch(base + '/api/library')).json();
    assert.deepEqual(list.skills.map((s) => [s.id, s.type]).sort(), [['gaya-saya', 'markdown'], ['my-taste', 'github']]);
    assert.ok(!JSON.stringify(list).includes(home), 'no local paths in the listing');

    // Library skills turn on per agent like catalog skills.
    assert.equal((await post('/api/harnesses/skill', { harness: 'claude-code', id: 'my-taste', enable: true, _csrf: csrf })).status, 200);
    const active = path.join(home, '.claude', 'skills', 'my-taste');
    assert.ok(fs.existsSync(path.join(active, 'references', 'a.md')));

    // Update: unchanged, then changed upstream -> library and the active copy follow.
    assert.equal((await post('/api/library/update', { id: 'my-taste', _csrf: csrf })).body.changed, false);
    repo = { 'skills/taste/SKILL.md': '---\nname: taste\ndescription: v2\n---\nv2 body', 'skills/taste/references/a.md': 'A2' };
    const upd = await post('/api/library/update', { id: 'my-taste', _csrf: csrf });
    assert.deepEqual(upd.body, { changed: true, id: 'my-taste', synced: ['Claude Code'] });
    assert.match(fs.readFileSync(path.join(active, 'SKILL.md'), 'utf8'), /description: "Pakai saat mendesain halaman\."[\s\S]*v2 body/, 'own description kept');
    assert.equal(fs.readFileSync(path.join(active, 'references', 'a.md'), 'utf8'), 'A2');
    assert.equal((await post('/api/library/update', { id: 'gaya-saya', _csrf: csrf })).status, 400);

    const del = await post('/api/library/delete', { id: 'my-taste', _csrf: csrf });
    assert.deepEqual(del.body, { removed: true, id: 'my-taste', deactivated: ['Claude Code'] });
    assert.ok(!fs.existsSync(active));
    assert.equal((await post('/api/library/delete', { id: 'my-taste', _csrf: csrf })).status, 404);
  } finally {
    server.closeAllConnections(); remote.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => remote.close(r))]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
