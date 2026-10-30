'use strict';
// Profiles (named skill + MCP sets) and the gateway settings, through the dashboard API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Before sources.js loads: never touch the real ~/.santri-skills/cache.
process.env.SANTRI_SKILLS_CACHE = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-profiles-cache-'));
const P = require('../src/profiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-profiles-'));

test('profiles file: validated names and ids, import merges, broken entries ignored', () => {
  const dir = tmp();
  const file = path.join(dir, 'profiles.json');
  try {
    assert.deepEqual(P.readProfiles(file), {});
    P.saveProfile(file, 'Web dev', { skills: ['a', 'a', 'b'], mcp: ['santri-skills'] });
    assert.deepEqual(P.readProfiles(file)['Web dev'].skills, ['a', 'b'], 'duplicates dropped');
    for (const bad of ['', ' lead', 'x'.repeat(41), 'a/b', '../x']) assert.throws(() => P.saveProfile(file, bad, { skills: [] }), /Nama profil/, bad);
    assert.throws(() => P.saveProfile(file, 'X', { skills: ['../evil'] }), /tidak valid/);
    assert.throws(() => P.saveProfile(file, 'X', { mcp: 'santri-skills' }), /tidak valid/);
    assert.deepEqual(P.importProfiles(file, { profiles: { 'Apps Script': { skills: ['c'] }, 'Web dev': { mcp: ['x'] } } }), ['Apps Script', 'Web dev']);
    const all = P.readProfiles(file);
    assert.deepEqual(Object.keys(all).sort(), ['Apps Script', 'Web dev']);
    assert.deepEqual(all['Web dev'], { skills: [], mcp: ['x'], updatedAt: all['Web dev'].updatedAt }, 'same name replaced');
    assert.throws(() => P.importProfiles(file, { foo: 1 }), /bukan ekspor/);
    assert.throws(() => P.importProfiles(file, { profiles: { 'Ok': { skills: ['$bad'] } } }), /tidak valid/);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    raw.profiles.Broken = { skills: 5 };
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.ok(!('Broken' in P.readProfiles(file)));
    assert.equal(P.deleteProfile(file, 'Apps Script'), true);
    assert.equal(P.deleteProfile(file, 'Apps Script'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('dashboard: save a profile from one agent, apply it to another; gateway list and gateway entry', async () => {
  const http = require('node:http');
  const home = tmp();
  const { CACHE_ROOT } = require('../src/sources');
  for (const id of ['appscript', 'monorepo']) {
    fs.mkdirSync(path.join(CACHE_ROOT, id, 'skills', `cat-${id}`), { recursive: true });
    fs.writeFileSync(path.join(CACHE_ROOT, id, '.fetched'), 'x');
    fs.writeFileSync(path.join(CACHE_ROOT, id, 'skills', `cat-${id}`, 'SKILL.md'), '---\nname: c\ndescription: d\n---\n');
  }
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog')
      ? { success: true, sources: [], mcpServers: [{ id: 'cms', label: 'CMS', description: 'x', command: 'npx', args: ['-y', 'cms-mcp'] }] }
      : { success: true, token: 't', user: { name: 'M', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const { createDashboardServer } = require('../src/dashboard');
  const server = createDashboardServer({ cwd: home, home, env: { ...process.env, APPDATA: path.join(home, 'AppData'), CODEX_HOME: path.join(home, '.codex') }, apiUrl: `http://127.0.0.1:${remote.address().port}/api` });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  try {
    assert.equal((await fetch(base + '/api/profiles')).status, 401);
    assert.equal((await fetch(base + '/api/gateway')).status, 401);
    const state = new URL((await post('/api/auth/login', {})).body.url).searchParams.get('state');
    const { csrf } = (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).body;
    assert.equal((await post('/api/profiles/delete', { name: 'x' })).status, 403, 'CSRF required');

    // Gateway contents
    assert.deepEqual((await post('/api/gateway', { id: 'cms', enable: true, _csrf: csrf })).body.servers, ['cms']);
    assert.deepEqual((await post('/api/gateway', { id: 'santri-skills', enable: true, _csrf: csrf })).body.servers, ['cms', 'santri-skills']);
    const gw = readJson(path.join(home, '.santrihub', 'gateway.json')).servers;
    assert.deepEqual(gw.cms, { command: 'npx', args: ['-y', 'cms-mcp'] });
    assert.deepEqual(gw['santri-skills'].args.slice(-1), ['mcp-serve']);
    assert.deepEqual((await (await fetch(base + '/api/gateway')).json()).servers, ['cms', 'santri-skills']);
    assert.equal((await post('/api/gateway', { id: 'unknown', enable: true, _csrf: csrf })).status, 400);

    // Claude Code: one catalog skill, the cms MCP and the gateway.
    for (const [url, id] of [['/api/harnesses/skill', 'cat-appscript'], ['/api/harnesses/mcp', 'cms'], ['/api/harnesses/mcp', 'santrihub-gateway']]) {
      assert.equal((await post(url, { harness: 'claude-code', id, enable: true, _csrf: csrf })).status, 200, id);
    }
    const claudeMcp = readJson(path.join(home, '.claude.json')).mcpServers;
    assert.deepEqual(claudeMcp.santrihub.args.slice(-1), ['mcp-gateway'], 'gateway registered as one MCP named santrihub');

    // A folder the member made is never part of a profile.
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'own'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'own', 'SKILL.md'), 'mine');
    assert.equal((await post('/api/profiles/save', { name: 'Kosong', harness: 'cursor', _csrf: csrf })).status, 400, 'nothing active in Cursor yet');
    const saved = await post('/api/profiles/save', { name: 'Web dev', harness: 'claude-code', _csrf: csrf });
    assert.deepEqual([saved.body.skills, saved.body.mcp.sort()], [['cat-appscript'], ['cms', 'santrihub-gateway']]);

    const applied = await post('/api/profiles/apply', { name: 'Web dev', harness: 'codex', _csrf: csrf });
    assert.deepEqual(applied.body.failed, []);
    assert.deepEqual(applied.body.applied.sort(), ['cat-appscript', 'cms', 'santrihub-gateway']);
    assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'cat-appscript', 'SKILL.md')));
    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    assert.match(toml, /\[mcp_servers\.cms\]/);
    assert.match(toml, /\[mcp_servers\.santrihub\][\s\S]*"mcp-gateway"/);
    assert.equal((await post('/api/profiles/apply', { name: 'Nope', harness: 'codex', _csrf: csrf })).status, 404);

    // Export (GET) → import round trip.
    const exported = await (await fetch(base + '/api/profiles')).json();
    assert.deepEqual(Object.keys(exported.profiles), ['Web dev']);
    assert.ok(!JSON.stringify(exported).includes('npx'), 'ids only, no commands');
    assert.deepEqual((await post('/api/profiles/delete', { name: 'Web dev', _csrf: csrf })).body, { deleted: true });
    assert.deepEqual((await post('/api/profiles/import', { data: exported, _csrf: csrf })).body, { imported: ['Web dev'] });
    assert.equal((await post('/api/profiles/import', { data: { nope: 1 }, _csrf: csrf })).status, 400);
  } finally {
    server.closeAllConnections(); remote.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => remote.close(r))]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
