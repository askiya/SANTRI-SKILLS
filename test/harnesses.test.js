'use strict';
// Harness adapters: where each AI agent reads skills/MCP, and safe on/off per harness.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../src/harnesses');

const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-harness-'));
const byId = (defs, id) => defs.find((h) => h.id === id);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('documented user-level locations per harness and OS', () => {
  const home = 'C:\\Users\\u';
  const win = H.harnessDefs({ home, env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, platform: 'win32' });
  assert.deepEqual(win.map((h) => h.id), ['antigravity', 'claude-code', 'codex', 'gemini-cli', 'cursor', 'vscode', 'windsurf']);
  const j = (...p) => path.join(home, ...p);
  assert.equal(byId(win, 'antigravity').skillsDir, j('.gemini', 'config', 'skills'));
  assert.equal(byId(win, 'antigravity').mcp.file, j('.gemini', 'config', 'mcp_config.json'));
  assert.equal(byId(win, 'claude-code').skillsDir, j('.claude', 'skills'));
  assert.equal(byId(win, 'claude-code').mcp.file, j('.claude.json'));
  assert.equal(byId(win, 'codex').skillsDir, j('.agents', 'skills'));
  assert.equal(byId(win, 'codex').mcp.file, j('.codex', 'config.toml'));
  assert.equal(byId(win, 'codex').mcp.format, 'toml');
  assert.equal(byId(win, 'gemini-cli').mcp.file, j('.gemini', 'settings.json'));
  assert.equal(byId(win, 'cursor').mcp.file, j('.cursor', 'mcp.json'));
  assert.equal(byId(win, 'vscode').mcp.file, path.join('C:\\Users\\u\\AppData\\Roaming', 'Code', 'User', 'mcp.json'));
  assert.equal(byId(win, 'vscode').mcp.key, 'servers');
  assert.equal(byId(win, 'windsurf').mcp.file, j('.codeium', 'windsurf', 'mcp_config.json'));
  assert.ok(byId(win, 'cursor').reads.includes(j('.claude', 'skills')), 'Cursor also reads Claude skills');

  const mac = H.harnessDefs({ home: '/Users/u', env: {}, platform: 'darwin' });
  assert.equal(byId(mac, 'vscode').mcp.file, path.join('/Users/u', 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
  const custom = H.harnessDefs({ home: '/h', env: { CODEX_HOME: '/cx', SANTRI_SKILLS_AG_HOME: '/ag' }, platform: 'linux' });
  assert.equal(byId(custom, 'codex').mcp.file, path.join(path.resolve('/cx'), 'config.toml'));
  assert.equal(byId(custom, 'antigravity').skillsDir, path.join(path.resolve('/ag'), 'skills'));
});

test('status: detection by evidence, shared skill folders, names only', () => {
  const home = tmpHome();
  try {
    const env = { APPDATA: path.join(home, 'AppData') };
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'mine'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'mine', 'SKILL.md'), '# mine');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { secret: { command: 'x', env: { TOKEN: 'shh' } } } }));
    const status = H.harnessStatus({ home, env, platform: 'win32' });
    const claude = byId(status, 'claude-code');
    assert.equal(claude.detected, true);
    assert.deepEqual(claude.skills, [{ id: 'mine', managed: false }]);
    assert.deepEqual(claude.sharedWith.sort(), ['Cursor', 'VS Code (Copilot)']);
    const cursor = byId(status, 'cursor');
    assert.equal(cursor.detected, true);
    assert.deepEqual(cursor.mcp.names, ['secret']);
    assert.ok(cursor.skillsViaOtherFolders.some((s) => s.id === 'mine'), 'Cursor sees the Claude skill');
    assert.ok(!JSON.stringify(status).includes('shh'), 'no config values leak');
    assert.equal(byId(status, 'windsurf').detected, false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('skills: on/off per harness, a foreign folder is never replaced or removed', () => {
  const home = tmpHome();
  try {
    const defs = H.harnessDefs({ home, env: {}, platform: 'linux' });
    const src = path.join(home, 'src', 'demo');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: demo\n---\nhi');
    const codex = byId(defs, 'codex');
    H.setSkill(codex, { id: 'demo', dir: src, source: 'test' }, true);
    assert.ok(fs.existsSync(path.join(home, '.agents', 'skills', 'demo', 'SKILL.md')));
    assert.deepEqual(H.setSkill(codex, { id: 'demo' }, false), { removed: true, kind: 'skill', id: 'demo' });
    assert.ok(!fs.existsSync(path.join(home, '.agents', 'skills', 'demo')));

    const claude = byId(defs, 'claude-code');
    fs.mkdirSync(path.join(claude.skillsDir, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(claude.skillsDir, 'demo', 'SKILL.md'), 'user-made');
    assert.throws(() => H.setSkill(claude, { id: 'demo', dir: src, source: 'test' }, true), /bukan milik SantriHub/);
    assert.throws(() => H.setSkill(claude, { id: 'demo' }, false), /bukan milik SantriHub/);
    assert.equal(fs.readFileSync(path.join(claude.skillsDir, 'demo', 'SKILL.md'), 'utf8'), 'user-made');
    assert.throws(() => H.setSkill(claude, { id: '../x' }, false), /invalid/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('MCP JSON harnesses: own entries added/removed, others and foreign entries untouched', () => {
  const home = tmpHome();
  try {
    const env = { APPDATA: path.join(home, 'AppData') };
    const defs = H.harnessDefs({ home, env, platform: 'win32' });
    const stateFile = path.join(home, '.santrihub', 'harness-mcp.json');
    const base = { command: 'npx', args: ['-y', 'cms-mcp'] };

    const vscode = byId(defs, 'vscode');
    fs.mkdirSync(path.dirname(vscode.mcp.file), { recursive: true });
    fs.writeFileSync(vscode.mcp.file, JSON.stringify({ servers: { other: { type: 'stdio', command: 'o' } }, inputs: [] }));
    assert.equal(H.setMcp(vscode, 'cms', base, true, { stateFile }).added, true);
    let cfg = readJson(vscode.mcp.file);
    assert.deepEqual(cfg.servers.cms, { type: 'stdio', command: 'npx', args: ['-y', 'cms-mcp'] }, 'VS Code: servers key + type stdio');
    assert.deepEqual(cfg.servers.other, { type: 'stdio', command: 'o' });
    assert.deepEqual(cfg.inputs, []);
    assert.equal(H.setMcp(vscode, 'cms', base, true, { stateFile }).added, false, 'idempotent');
    assert.equal(H.setMcp(vscode, 'cms', base, false, { stateFile }).removed, true);
    cfg = readJson(vscode.mcp.file);
    assert.equal(cfg.servers.cms, undefined);
    assert.deepEqual(cfg.servers.other, { type: 'stdio', command: 'o' });

    const claude = byId(defs, 'claude-code');
    fs.writeFileSync(claude.mcp.file, JSON.stringify({ numStartups: 3, projects: { a: {} }, mcpServers: { cms: { command: 'mine' } } }));
    assert.throws(() => H.setMcp(claude, 'cms', base, true, { stateFile }), /konfigurasi lain/);
    assert.throws(() => H.setMcp(claude, 'cms', base, false, { stateFile }), /bukan milik SantriHub/);
    assert.deepEqual(readJson(claude.mcp.file).mcpServers.cms, { command: 'mine' });
    // The santri-skills bridge is recognised as ours even without a state record.
    const bridge = { command: 'npx', args: ['-y', 'santriverse-skills', 'mcp-serve'] };
    H.setMcp(claude, 'santri-skills', bridge, true, { stateFile: path.join(home, 'other-state.json') });
    assert.equal(readJson(claude.mcp.file).numStartups, 3, 'other Claude Code state is kept');
    assert.equal(H.setMcp(claude, 'santri-skills', bridge, false, { stateFile: path.join(home, 'fresh-state.json') }).removed, true);

    const cursor = byId(defs, 'cursor');
    H.setMcp(cursor, 'santri-skills', bridge, true, { stateFile });
    assert.deepEqual(readJson(cursor.mcp.file).mcpServers['santri-skills'], { type: 'stdio', ...bridge });
    assert.equal(H.setMcp(cursor, 'santri-skills', bridge, false, { stateFile: path.join(home, 'fresh2.json') }).removed, true, 'bridge with type stdio still ours');

    const ws = byId(defs, 'windsurf');
    fs.mkdirSync(path.dirname(ws.mcp.file), { recursive: true });
    fs.writeFileSync(ws.mcp.file, '{ broken');
    assert.throws(() => H.setMcp(ws, 'cms', base, true, { stateFile }), /JSON valid/);
    assert.equal(fs.readFileSync(ws.mcp.file, 'utf8'), '{ broken');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('Codex TOML: one [mcp_servers.<name>] table managed, the rest kept byte for byte', () => {
  const home = tmpHome();
  try {
    const codex = byId(H.harnessDefs({ home, env: {}, platform: 'win32' }), 'codex');
    const stateFile = path.join(home, 'state.json');
    fs.mkdirSync(path.dirname(codex.mcp.file), { recursive: true });
    const original = '# my settings\nmodel = "gpt"\n\n[windows]\nsandbox = "elevated"\n\n[mcp_servers.other]\ncommand = "o"\n';
    fs.writeFileSync(codex.mcp.file, original);
    const base = { command: 'C:\\Program Files\\SantriHub\\runtime\\node.exe', args: ['C:\\x\\"q"\\cli.js', 'mcp-serve'] };
    assert.equal(H.setMcp(codex, 'santri-skills', base, true, { stateFile }).added, true);
    const text = fs.readFileSync(codex.mcp.file, 'utf8');
    assert.ok(text.startsWith(original.trimEnd()), 'existing content kept');
    assert.ok(text.endsWith('\n\n' + String.raw`[mcp_servers.santri-skills]
command = "C:\\Program Files\\SantriHub\\runtime\\node.exe"
args = ["C:\\x\\\"q\"\\cli.js", "mcp-serve"]
`), text);
    assert.deepEqual(H.tomlServers(text).names, ['other', 'santri-skills']);
    assert.equal(H.setMcp(codex, 'santri-skills', base, true, { stateFile }).added, false, 'idempotent');

    // Updated path (same name, ours): replaced in place, not duplicated.
    H.setMcp(codex, 'santri-skills', { ...base, command: 'D:\\node.exe' }, true, { stateFile });
    assert.equal((fs.readFileSync(codex.mcp.file, 'utf8').match(/\[mcp_servers\.santri-skills\]/g) || []).length, 1);
    assert.equal(H.setMcp(codex, 'santri-skills', base, false, { stateFile }).removed, true);
    assert.equal(fs.readFileSync(codex.mcp.file, 'utf8').trimEnd(), original.trimEnd());

    assert.throws(() => H.setMcp(codex, 'other', base, true, { stateFile }), /konfigurasi lain/);
    assert.throws(() => H.setMcp(codex, 'other', base, false, { stateFile }), /bukan milik SantriHub/);
    // Sub-tables of a server go with it.
    assert.equal(H.tomlWithout('[mcp_servers.a]\ncommand = "x"\n[mcp_servers.a.env]\nK = "v"\n[b]\nc = 1\n', 'a'), '[b]\nc = 1');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('dashboard: harness API is premium-gated and turns MCP on for one harness', async () => {
  const http = require('node:http');
  const home = tmpHome();
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog')
      ? { success: true, sources: [], mcpServers: [] }
      : { success: true, token: 'session-token', user: { name: 'Member', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const { createDashboardServer } = require('../src/dashboard');
  const env = { ...process.env, APPDATA: path.join(home, 'AppData'), CODEX_HOME: path.join(home, '.codex') };
  const server = createDashboardServer({ cwd: home, home, env, apiUrl: `http://127.0.0.1:${remote.address().port}/api` });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/api/harnesses')).status, 401);
    assert.equal((await post('/api/harnesses/mcp', { harness: 'cursor', id: 'santri-skills', enable: true })).status, 401);
    const state = new URL((await (await post('/api/auth/login', {})).json()).url).searchParams.get('state');
    const { csrf } = await (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).json();

    const list = await (await fetch(base + '/api/harnesses')).json();
    assert.equal(list.harnesses.length, 7);
    assert.equal((await post('/api/harnesses/mcp', { harness: 'cursor', id: 'santri-skills', enable: true })).status, 403, 'CSRF required');
    assert.equal((await post('/api/harnesses/mcp', { harness: 'nope', id: 'santri-skills', enable: true, _csrf: csrf })).status, 400);
    assert.equal((await post('/api/harnesses/mcp', { harness: 'cursor', id: 'unknown', enable: true, _csrf: csrf })).status, 400);
    const ok = await post('/api/harnesses/mcp', { harness: 'cursor', id: 'santri-skills', enable: true, _csrf: csrf });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).hint, /Cursor/);
    const entry = readJson(path.join(home, '.cursor', 'mcp.json')).mcpServers['santri-skills'];
    assert.equal(entry.type, 'stdio');
    assert.deepEqual(entry.args.slice(-1), ['mcp-serve']);
    const after = await (await fetch(base + '/api/harnesses')).json();
    assert.deepEqual(byId(after.harnesses, 'cursor').mcp.names, ['santri-skills']);
    assert.equal((await post('/api/harnesses/mcp', { harness: 'cursor', id: 'santri-skills', enable: false, _csrf: csrf })).status, 200);
    assert.deepEqual(readJson(path.join(home, '.cursor', 'mcp.json')).mcpServers, {});
  } finally {
    server.closeAllConnections(); remote.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => remote.close(r))]);
    fs.rmSync(home, { recursive: true, force: true });
  }
});
