'use strict';
// Paket: catalog sources shown as Apps Script / Monorepo / Umum, and whole-paket activation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-paket-'));
const cache = tmp();
process.env.SANTRI_SKILLS_CACHE = cache; // offline catalog: the bundled sources, pre-fetched
for (const [id, skills] of [['appscript', ['apps-script-architect', 'apps-script-security']], ['monorepo', ['santriverse-vibe-coding']]]) {
  fs.mkdirSync(path.join(cache, id), { recursive: true });
  fs.writeFileSync(path.join(cache, id, '.fetched'), 'x');
  for (const s of skills) {
    fs.mkdirSync(path.join(cache, id, 'skills', s), { recursive: true });
    fs.writeFileSync(path.join(cache, id, 'skills', s, 'SKILL.md'), `---\nname: ${s}\ndescription: Use ${s} for this kind of project.\n---\nBody`);
  }
}
const { validateSource, validateMcpEntry, loadRegistry } = require('../src/registry');

test('paket metadata: bundled sources carry it; bad display fields are dropped, not fatal', () => {
  const reg = loadRegistry();
  assert.deepEqual(reg.sources.map((s) => [s.id, s.short, s.color, s.starter]), [['appscript', 'Apps Script', 'teal', 'apps-script-architect'], ['monorepo', 'Monorepo', 'purple', 'santriverse-vibe-coding']]);
  const base = { id: 'x', repo: 'o/r', branch: 'main', skillsDir: 'skills' };
  const s = validateSource({ ...base, short: '  Pendek  ', color: 'neon', icon: '<b>', starter: 'Bad Id', author: 'A'.repeat(200), description: 'ok', order: 1.5 });
  assert.equal(s.short, 'Pendek');
  assert.equal(s.author.length, 80);
  assert.equal(s.description, 'ok');
  for (const k of ['color', 'icon', 'starter', 'order']) assert.ok(!(k in s), k);
  assert.deepEqual(validateMcpEntry({ id: 'm', command: 'npx', args: [], paket: ['appscript', 'BAD ID', 3] }).paket, ['appscript']);
  assert.ok(!('paket' in validateMcpEntry({ id: 'm', command: 'npx', args: [] })));
});

test('dashboard: catalog lists paket with counts; a whole paket turns on and off for one agent', async () => {
  const home = tmp();
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog') ? { success: true, sources: [], mcpServers: [] } : { success: true, token: 't', user: { name: 'Member', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const { createDashboardServer } = require('../src/dashboard');
  const env = { ...process.env, APPDATA: path.join(home, 'AppData'), CODEX_HOME: path.join(home, '.codex') };
  const server = createDashboardServer({ cwd: home, home, env, apiUrl: `http://127.0.0.1:${remote.address().port}/api` });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  try {
    const state = new URL((await (await post('/api/auth/login', {})).json()).url).searchParams.get('state');
    const { csrf } = await (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).json();
    const cat = await (await fetch(base + '/api/catalog')).json();
    assert.deepEqual(cat.paket.map((p) => [p.id, p.short, p.skills, p.mcp, p.author]), [
      ['appscript', 'Apps Script', 2, 0, 'Askiya · Santriverse'], ['monorepo', 'Monorepo', 1, 0, 'Askiya · Santriverse'], ['umum', 'Umum', 0, 1, 'Santriverse']]);
    assert.equal(cat.paket[0].homepage, 'https://github.com/askiya/GOOGLE-APPSCRIPT-SKILLS');
    assert.deepEqual(cat.mcpServers.map((m) => [m.id, m.paket]), [['santri-skills', ['umum']]]);
    assert.deepEqual(cat.skills.find((s) => s.id === 'santriverse-vibe-coding').source, 'monorepo');

    const apps = cat.skills.filter((s) => s.source === 'appscript').map((s) => s.id);
    assert.equal((await post('/api/harnesses/bulk', { harness: 'claude-code', enable: true, skills: apps })).status, 403, 'CSRF required');
    assert.equal((await post('/api/harnesses/bulk', { harness: 'claude-code', enable: true, skills: [], _csrf: csrf })).status, 400);
    const on = await (await post('/api/harnesses/bulk', { harness: 'claude-code', enable: true, skills: [...apps, 'not-a-skill'], mcp: ['santri-skills'], _csrf: csrf })).json();
    assert.deepEqual(on.done, [...apps, 'santri-skills']);
    assert.deepEqual(on.failed.map((f) => f.id), ['not-a-skill']);
    for (const id of apps) assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', id, 'SKILL.md')), id);
    assert.ok(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['santri-skills']);
    // A folder the member made under the same name is never replaced, and is reported.
    fs.mkdirSync(path.join(home, '.agents', 'skills', 'apps-script-security'), { recursive: true });
    fs.writeFileSync(path.join(home, '.agents', 'skills', 'apps-script-security', 'SKILL.md'), '# mine');
    const codex = await (await post('/api/harnesses/bulk', { harness: 'codex', enable: true, skills: apps, _csrf: csrf })).json();
    assert.deepEqual(codex.done, ['apps-script-architect']);
    assert.match(codex.failed[0].error, /bukan milik SantriHub/);
    assert.equal(fs.readFileSync(path.join(home, '.agents', 'skills', 'apps-script-security', 'SKILL.md'), 'utf8'), '# mine');

    const off = await (await post('/api/harnesses/bulk', { harness: 'claude-code', enable: false, skills: apps, mcp: ['santri-skills'], _csrf: csrf })).json();
    assert.deepEqual(off.failed, []);
    for (const id of apps) assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', id)), id);
    assert.ok(!JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers['santri-skills']);
  } finally {
    server.close();
    remote.close();
  }
});

test('own paket: names become my-<slug> ids; paket lists are checked against known paket', () => {
  const myPaket = require('../src/my-paket');
  const file = path.join(tmp(), 'paket.json');
  const a = myPaket.addMyPaket(file, { short: '  Klien   Sekolah ', color: 'amber', description: 'Untuk <b>klien</b>' });
  assert.deepEqual(a, { id: 'my-klien-sekolah', short: 'Klien Sekolah', label: 'Klien Sekolah', description: 'Untuk b klien /b', color: 'amber', icon: '◇' });
  assert.throws(() => myPaket.addMyPaket(file, { short: 'klien sekolah' }), /sudah ada/);
  assert.throws(() => myPaket.addMyPaket(file, { short: 'x' }), /minimal 2/);
  assert.equal(myPaket.addMyPaket(file, { short: 'Kelas', color: 'neon' }).color, 'blue');
  const known = new Set(['appscript', 'my-klien-sekolah']);
  assert.deepEqual(myPaket.paketIds(['appscript', 'mine', 'appscript'], known), ['appscript']);
  assert.throws(() => myPaket.paketIds(['monorepo'], known), /tidak dikenal: monorepo/);
  assert.deepEqual(myPaket.paketIds(undefined, known), []);
  assert.ok(myPaket.removeMyPaket(file, 'my-kelas'));
  assert.deepEqual(myPaket.readMyPaket(file).map((p) => p.id), ['my-klien-sekolah']);
});

test('dashboard: Beranda gets "cocok jika"; own skills and MCP join paket at import and later; deleting a paket untags', async () => {
  const home = tmp();
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog') ? { success: true, sources: [], mcpServers: [] } : { success: true, token: 't', user: { name: 'Member', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const { createDashboardServer } = require('../src/dashboard');
  const env = { ...process.env, APPDATA: path.join(home, 'AppData'), CODEX_HOME: path.join(home, '.codex') };
  const server = createDashboardServer({ cwd: home, home, env, apiUrl: `http://127.0.0.1:${remote.address().port}/api` });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  const json = async (url, body) => (await post(url, body)).json();
  try {
    const state = new URL((await (await post('/api/auth/login', {})).json()).url).searchParams.get('state');
    const { csrf } = await (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).json();
    const cat = await (await fetch(base + '/api/catalog')).json();
    assert.equal(cat.paket[0].fit.length, 3);
    assert.deepEqual(cat.paket.find((p) => p.id === 'umum').fit, []);

    // Own paket
    assert.equal((await post('/api/my-paket/save', { short: 'Klien Sekolah' })).status, 403, 'CSRF required');
    const made = await json('/api/my-paket/save', { short: 'Klien Sekolah', color: 'amber', _csrf: csrf });
    assert.equal(made.paket.id, 'my-klien-sekolah');
    assert.deepEqual((await (await fetch(base + '/api/my-paket')).json()).paket.map((p) => p.id), ['my-klien-sekolah']);

    // Import straight into a paket
    const md = (t) => Buffer.from(`# ${t}\n\nPanduan ${t} untuk web app Apps Script sekolah.`).toString('base64');
    const pv = await json('/api/library/upload/preview', { items: [{ path: 'desain.md', data: md('Desain') }], mcpText: 'npx -y @x/sheets-mcp', _csrf: csrf });
    assert.equal((await post('/api/library/upload/save', { previewId: pv.previewId, picks: [{ key: pv.skills[0].key }], paket: ['nope'], _csrf: csrf })).status, 400, 'unknown paket');
    await json('/api/library/upload/save', { previewId: pv.previewId, picks: [{ key: pv.skills[0].key }], mcpPicks: [{ key: pv.mcp[0].key }], paket: ['appscript'], _csrf: csrf });
    assert.deepEqual((await (await fetch(base + '/api/library')).json()).skills.map((s) => [s.id, s.paket, s.origin]), [['desain', ['appscript'], 'desain.md']]);
    assert.deepEqual((await (await fetch(base + '/api/mcp-library')).json()).servers.map((s) => [s.id, s.paket]), [['sheets', ['appscript']]]);

    // Tag later, then delete the own paket: tags go, skills and MCP stay
    assert.deepEqual((await json('/api/library/paket', { id: 'desain', paket: ['appscript', 'my-klien-sekolah', 'mine'], _csrf: csrf })).paket, ['appscript', 'my-klien-sekolah']);
    assert.deepEqual((await json('/api/mcp-library/paket', { id: 'sheets', paket: ['my-klien-sekolah'], _csrf: csrf })).paket, ['my-klien-sekolah']);
    assert.equal((await post('/api/library/paket', { id: 'missing', paket: [], _csrf: csrf })).status, 404);
    assert.equal((await post('/api/mcp-library/paket', { id: 'sheets', paket: ['monorepo-x'], _csrf: csrf })).status, 400);
    assert.deepEqual(await json('/api/my-paket/delete', { id: 'my-klien-sekolah', _csrf: csrf }), { removed: 'my-klien-sekolah' });
    assert.deepEqual((await (await fetch(base + '/api/library')).json()).skills.map((s) => s.paket), [['appscript']]);
    assert.deepEqual((await (await fetch(base + '/api/mcp-library')).json()).servers.map((s) => s.paket), [[]]);
    assert.equal((await post('/api/my-paket/delete', { id: 'my-klien-sekolah', _csrf: csrf })).status, 404);
  } finally {
    server.close();
    remote.close();
  }
});
