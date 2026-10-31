'use strict';
// Smart import (ZIP / folder / files / MCP text), the member's own MCP servers, the MCP
// connection test, and their dashboard endpoints.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-smart-'));
process.env.SANTRI_SKILLS_CACHE = tmp(); // never touch the real skill cache

const { readZip } = require('../src/zip');
const { scanUploads, groupUploads } = require('../src/smart-import');
const mcpLib = require('../src/mcp-library');
const { entryFor, harnessDefs, tomlBlock } = require('../src/harnesses');
const { probeMcp } = require('../src/mcp-probe');
const { ownServerEntry } = require('../src/install');

// ── A tiny ZIP writer for fixtures ──
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function makeZip(files, { flags = 0 } = {}) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), deflate = data.length > 20, body = deflate ? zlib.deflateRawSync(data) : data, nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags | 0x800, 6); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags | 0x800, 8); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const SKILL = (name, desc = `Use ${name} when the task needs it.`) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nSteps for the agent, long enough to be a real skill body.`;

test('zip: stored and deflated files, folders left out, unsafe and encrypted entries skipped', () => {
  const zip = makeZip({ 'a/SKILL.md': SKILL('a'), 'a/x.txt': 'hi', 'a/': '', '../evil.md': 'no', '__MACOSX/a/._SKILL.md': 'junk' });
  const { files, skipped } = readZip(zip);
  assert.deepEqual([...files.keys()], ['a/SKILL.md', 'a/x.txt']);
  assert.equal(files.get('a/SKILL.md').toString(), SKILL('a'));
  assert.deepEqual(skipped, ['../evil.md (path tidak aman)']);
  assert.match(readZip(makeZip({ 's.md': 'secret secret secret secret' }, { flags: 1 })).skipped[0], /terenkripsi/);
  assert.throws(() => readZip(Buffer.from('not a zip at all, sorry')), /Bukan file ZIP/);
  assert.match(readZip(makeZip({ 'big.md': 'x'.repeat(2000) }), { maxFile: 1000 }).skipped[0], /big\.md \(> 1 KB\)/);
});

test('smart import: ZIPs, a folder, loose files and MCP configs become reviewable skills and MCP', () => {
  const items = [
    // a ZIP wrapping one skill folder (like ui-ux-pro-max.zip), with a reference file and a script
    { path: 'ui-kit.zip', data: makeZip({ 'ui-kit/SKILL.md': SKILL('ui-kit'), 'ui-kit/references/rules.md': '# rules', 'ui-kit/scripts/run.py': 'print(1)', 'ui-kit/logo.png': 'PNG' }) },
    // a ZIP with several skills and an MCP config
    { path: 'pack.zip', data: makeZip({ 'skills/one/SKILL.md': SKILL('one'), 'skills/two/SKILL.md': SKILL('two'), '.mcp.json': JSON.stringify({ mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } }) }) },
    // a folder without SKILL.md: one skill generated from its README
    { path: 'catatan/README.md', data: Buffer.from('# Catatan\n\nPanduan menulis caption jualan untuk Instagram dan WhatsApp.') },
    { path: 'catatan/contoh.md', data: Buffer.from('contoh caption') },
    // loose Markdown: one skill per file
    { path: 'resep.md', data: Buffer.from('# Resep\n\nKumpulan resep prompt untuk materi dakwah singkat.') },
    { path: 'Thumbs.db', data: Buffer.from('junk') },
  ];
  const r = scanUploads(items, { mcpText: 'claude mcp add github -e GITHUB_TOKEN=abc -- npx -y @modelcontextprotocol/server-github' });
  assert.deepEqual(r.problems, []);
  const byId = Object.fromEntries(r.skills.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['catatan', 'one', 'resep', 'two', 'ui-kit']);
  assert.deepEqual(byId['ui-kit'].files.map((f) => f.rel), ['references/rules.md']);
  assert.ok(byId['ui-kit'].skipped.includes('scripts/run.py') && byId['ui-kit'].skipped.includes('logo.png (bukan file teks)'));
  assert.equal(byId['ui-kit'].generated, false);
  assert.equal(byId.catatan.generated, true);
  assert.match(byId.catatan.skillMd, /^---\nname: catatan\ndescription: "Panduan menulis caption jualan untuk Instagram dan WhatsApp\."/);
  assert.deepEqual(byId.catatan.files.map((f) => f.rel), ['references/contoh.md']);
  assert.equal(byId.resep.source, 'resep.md');
  assert.deepEqual(r.mcp.map((m) => m.name), ['context7', 'github']);
  assert.deepEqual(r.mcp[1].entry, { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'abc' } });
  // with scripts allowed, the script travels along
  assert.ok(scanUploads(items.slice(0, 1), { includeScripts: true }).skills[0].files.some((f) => f.rel === 'scripts/run.py'));
});

test('smart import: same skill twice gets a new id, loose SKILL.md keeps its references, bad input is reported', () => {
  const r = scanUploads([
    { path: 'a.zip', data: makeZip({ 'SKILL.md': SKILL('dup') }) },
    { path: 'b.zip', data: makeZip({ 'SKILL.md': SKILL('dup') }) },
    { path: 'broken.zip', data: Buffer.from('nope, not a zip file at all') },
    { path: 'empty/notes.bin', data: Buffer.from([1, 2, 3]) },
  ]);
  assert.deepEqual(r.skills.map((s) => s.id), ['dup', 'dup-2']);
  assert.deepEqual(r.problems.map((p) => p.source), ['broken.zip', 'empty/']);
  const loose = groupUploads([{ path: 'SKILL.md', data: Buffer.from(SKILL('mine')) }, { path: 'guide.md', data: Buffer.from('# g') }]);
  assert.equal(loose.length, 1);
  assert.equal(scanUploads([{ path: 'SKILL.md', data: Buffer.from(SKILL('mine')) }, { path: 'guide.md', data: Buffer.from('# g') }]).skills[0].files[0].rel, 'guide.md');
  assert.throws(() => groupUploads([{ path: '../x.md', data: Buffer.from('x') }]), /tidak aman/);
  assert.throws(() => groupUploads([]), /Pilih file/);
});

test('MCP text: JSON configs, one server, command lines, claude mcp add, URLs and names', () => {
  const p = (t) => mcpLib.parseMcpText(t);
  assert.deepEqual(p('npx -y @modelcontextprotocol/server-filesystem C:\\Users\\me\\docs')[0], { name: 'filesystem', entry: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\me\\docs'] }, from: 'teks' });
  assert.equal(p('npx -y @playwright/mcp@latest')[0].name, 'playwright');
  assert.equal(p('uvx mcp-server-fetch')[0].name, 'fetch');
  assert.equal(p('{"command":"npx","args":["-y","shadcn@latest","mcp"]}')[0].name, 'shadcn');
  assert.deepEqual(p('node "C:\\my tools\\notes-server.js" --port 3')[0].entry.args, ['C:\\my tools\\notes-server.js', '--port', '3']);
  assert.deepEqual(p('API_KEY=k1 npx -y \\\n  some-mcp')[0].entry, { command: 'npx', args: ['-y', 'some-mcp'], env: { API_KEY: 'k1' } });
  assert.deepEqual(p('{"mcpServers":{"a":{"command":"x"},"b":{"url":"https://h.example/mcp"}},}').map((m) => [m.name, m.entry]), [['a', { command: 'x', args: [] }], ['b', { url: 'https://h.example/mcp' }]]);
  assert.deepEqual(p('{"servers":{"vs":{"type":"stdio","command":"y","args":["1"]}}}')[0].entry, { command: 'y', args: ['1'] });
  assert.deepEqual(p('https://mcp.context7.com/mcp')[0], { name: 'context7', entry: { url: 'https://mcp.context7.com/mcp' }, from: 'teks' });
  assert.deepEqual(p('claude mcp add --transport http ctx https://mcp.context7.com/mcp')[0].entry, { url: 'https://mcp.context7.com/mcp' });
  assert.throws(() => p('{"mcpServers":{"x":{"url":"http://evil.example"}}}'), /https/);
  assert.deepEqual(p('{"mcpServers":{"x":{"url":"http://localhost:3000/mcp"}}}')[0].entry, { url: 'http://localhost:3000/mcp' });
  assert.throws(() => p('{"mcpServers":{"x":{"url":"https://a.example","headers":{"Authorization":"t"}}}}'), /header/);
  assert.throws(() => p('{"hello":1}'), /tidak berisi MCP/);
  assert.throws(() => p('{bad json'), /JSON MCP tidak valid/);
  assert.throws(() => p('claude mcp add x'), /tanpa command/);
  assert.deepEqual(p('   '), []);
  assert.ok(mcpLib.looksLikeMcpConfig('{"mcpServers":{"a":{"command":"x"}}}'));
  assert.ok(!mcpLib.looksLikeMcpConfig('{"name":"pkg","version":"1"}'));
});

test('own MCP store: saved privately, the browser sees env names and no URL query', () => {
  const file = path.join(tmp(), 'mcp-library.json');
  mcpLib.saveMcp(file, 'gh', { command: 'npx', args: ['-y', '@x/gh'], env: { GITHUB_TOKEN: 'secret-token' } }, 'teks');
  mcpLib.saveMcp(file, 'remote', { url: 'https://h.example/mcp?key=secret-key' });
  const all = mcpLib.readMcpLibrary(file);
  assert.equal(all.gh.entry.env.GITHUB_TOKEN, 'secret-token');
  const shown = JSON.stringify([mcpLib.publicEntry(all.gh.entry), mcpLib.publicEntry(all.remote.entry)]);
  assert.doesNotMatch(shown, /secret/);
  assert.deepEqual(mcpLib.publicEntry(all.gh.entry), { kind: 'stdio', summary: 'npx @x/gh', envKeys: ['GITHUB_TOKEN'] });
  assert.equal(mcpLib.publicEntry(all.remote.entry).summary, 'https://h.example/mcp');
  assert.throws(() => mcpLib.saveMcp(file, 'bad name', { command: 'x' }), /Nama MCP/);
  assert.ok(mcpLib.removeMcp(file, 'gh'));
  assert.ok(!mcpLib.removeMcp(file, 'gh'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'private file');
});

test('agents get env and remote URLs in their own format (JSON keys per vendor, Codex TOML)', () => {
  const defs = Object.fromEntries(harnessDefs({ home: tmp(), env: {} }).map((h) => [h.id, h]));
  const remote = { url: 'https://h.example/mcp' };
  assert.deepEqual(entryFor(defs['claude-code'], remote), { type: 'http', url: remote.url });
  assert.deepEqual(entryFor(defs.antigravity, remote), { serverUrl: remote.url });
  assert.deepEqual(entryFor(defs['gemini-cli'], remote), { httpUrl: remote.url });
  assert.deepEqual(entryFor(defs.vscode, remote), { type: 'http', url: remote.url });
  assert.deepEqual(entryFor(defs.cursor, remote), { url: remote.url });
  assert.deepEqual(entryFor(defs.windsurf, remote), { serverUrl: remote.url });
  assert.deepEqual(entryFor(defs.cursor, { command: 'npx', args: ['a'], env: { K: 'v' } }), { type: 'stdio', command: 'npx', args: ['a'], env: { K: 'v' } });
  assert.deepEqual(entryFor(defs['claude-code'], { command: 'npx', args: [] }), { command: 'npx', args: [] }, 'no empty env');
  assert.equal(tomlBlock('gh', { command: 'npx', args: ['-y'], env: { GITHUB_TOKEN: 'a"b', 'odd-key': 'x' } }), '[mcp_servers.gh]\ncommand = "npx"\nargs = ["-y"]\nenv = { GITHUB_TOKEN = "a\\"b", odd-key = "x" }\n');
  assert.equal(tomlBlock('r', remote), '[mcp_servers.r]\nurl = "https://h.example/mcp"\n');
});

test('MCP connection test: the bundled server answers with its tools; failures explain themselves', { timeout: 60000 }, async () => {
  const ok = await probeMcp(ownServerEntry(), { timeout: 30000 });
  assert.equal(ok.ok, true, ok.error || ok.log);
  assert.equal(ok.server.name, 'santri-skills');
  assert.ok(ok.tools.some((t) => t.name === 'santrihub_status'));
  const missing = await probeMcp({ command: 'santrihub-no-such-program', args: [] }, { timeout: 5000 });
  assert.equal(missing.ok, false);
  assert.match(missing.hint, /tidak ditemukan/);
  const crash = await probeMcp({ command: process.execPath, args: ['-e', 'console.error("need API_KEY");process.exit(2)'] }, { timeout: 5000 });
  assert.equal(crash.ok, false);
  assert.match(crash.hint, /langsung berhenti/);
  assert.match(crash.log, /need API_KEY/);
  const silent = await probeMcp({ command: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)'] }, { timeout: 800 });
  assert.match(silent.error, /tidak dijawab/);
  // Streamable HTTP: JSON and SSE answers, session header carried along.
  const seen = [];
  const fakeFetch = async (url, init) => {
    const msg = JSON.parse(init.body);
    seen.push([msg.method, init.headers['Mcp-Session-Id'] || null]);
    if (msg.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { serverInfo: { name: 'remote', version: '1' } } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
    if (!('id' in msg)) return new Response(null, { status: 202 });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'search' }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const http = await probeMcp({ url: 'https://h.example/mcp' }, { fetchImpl: fakeFetch });
  assert.equal(http.ok, true);
  assert.deepEqual(http.tools.map((t) => t.name), ['search']);
  assert.deepEqual(seen, [['initialize', null], ['notifications/initialized', 's1'], ['tools/list', 's1']]);
  const denied = await probeMcp({ url: 'https://h.example/mcp' }, { fetchImpl: async () => new Response('no', { status: 401 }) });
  assert.match(denied.hint, /login atau token/);
});

test('dashboard: upload preview/save, own MCP in agents and Gateway, connection test, delete', async () => {
  const http = require('node:http');
  const home = tmp();
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog') ? { success: true, sources: [], mcpServers: [] } : { success: true, token: 't', user: { name: 'Member', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const { createDashboardServer } = require('../src/dashboard');
  const env = { ...process.env, APPDATA: path.join(home, 'AppData'), CODEX_HOME: path.join(home, '.codex') };
  const probed = [];
  const probe = async (entry) => { probed.push(entry); return { ok: true, ms: 5, server: { name: 'fake', version: '1' }, tools: [{ name: 't' }], toolCount: 1, error: null, hint: '', log: '' }; };
  const server = createDashboardServer({ cwd: home, home, env, apiUrl: `http://127.0.0.1:${remote.address().port}/api`, probe });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/library/upload/preview', {})).status, 401);
    const state = new URL((await (await post('/api/auth/login', {})).json()).url).searchParams.get('state');
    const { csrf } = await (await post('/api/auth/callback', { state, ticket: 'ticket_abc' })).json();
    const zip = makeZip({ 'kit/SKILL.md': SKILL('kit'), 'kit/mcp.json': JSON.stringify({ mcpServers: { gh: { command: 'npx', args: ['-y', '@x/gh'], env: { GITHUB_TOKEN: 'secret-token' } } } }) });
    const items = [{ path: 'kit.zip', data: zip.toString('base64') }];
    assert.equal((await post('/api/library/upload/preview', { items })).status, 403, 'CSRF required');
    // Bigger than the normal 16 KB body limit: uploads have their own limit.
    const big = [...items, { path: 'notes.md', data: Buffer.from('# Notes\n\n' + 'Catatan panjang untuk agent. '.repeat(1500)).toString('base64') }];
    const pv = await (await post('/api/library/upload/preview', { items: big, mcpText: 'https://mcp.example.com/mcp', _csrf: csrf })).json();
    assert.deepEqual(pv.skills.map((s) => s.id), ['kit', 'notes']);
    assert.deepEqual(pv.mcp.map((m) => [m.name, m.kind, m.envKeys]), [['gh', 'stdio', ['GITHUB_TOKEN']], ['example', 'http', []]]);
    assert.doesNotMatch(JSON.stringify(pv), /secret-token/);
    assert.equal((await post('/api/library/upload/save', { previewId: pv.previewId, picks: [], mcpPicks: [{ key: pv.mcp[0].key, name: 'santrihub' }], _csrf: csrf })).status, 409, 'reserved name');
    const saved = await (await post('/api/library/upload/save', { previewId: pv.previewId, picks: [{ key: pv.skills[0].key }], mcpPicks: pv.mcp.map((m) => ({ key: m.key })), _csrf: csrf })).json();
    assert.deepEqual(saved, { saved: ['kit'], savedMcp: ['gh', 'example'], synced: [] });
    assert.equal((await post('/api/library/upload/save', { previewId: pv.previewId, picks: [{ key: pv.skills[1].key }], _csrf: csrf })).status, 409, 'preview used up');
    const lib = await (await fetch(base + '/api/library')).json();
    assert.deepEqual(lib.skills.map((s) => [s.id, s.type]), [['kit', 'upload']]);
    const mine = await (await fetch(base + '/api/mcp-library')).json();
    assert.deepEqual(mine.servers.map((s) => [s.id, s.kind]), [['gh', 'stdio'], ['example', 'http']]);
    assert.doesNotMatch(JSON.stringify(mine), /secret-token/);

    // Turn the own MCP on in Codex (TOML with env) and Claude Code (remote URL).
    assert.equal((await post('/api/harnesses/mcp', { harness: 'codex', id: 'gh', enable: true, _csrf: csrf })).status, 200);
    assert.match(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.gh\]\ncommand = "npx"\nargs = \["-y", "@x\/gh"\]\nenv = \{ GITHUB_TOKEN = "secret-token" \}/);
    assert.equal((await post('/api/harnesses/mcp', { harness: 'claude-code', id: 'example', enable: true, _csrf: csrf })).status, 200);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers.example, { type: 'http', url: 'https://mcp.example.com/mcp' });
    // Gateway takes stdio servers only.
    assert.equal((await post('/api/gateway', { id: 'example', enable: true, _csrf: csrf })).status, 400);
    assert.deepEqual((await (await post('/api/gateway', { id: 'gh', enable: true, _csrf: csrf })).json()).servers, ['gh']);

    // Connection test runs the real entry (with env) through the probe.
    const t = await (await post('/api/mcp/test', { id: 'gh', _csrf: csrf })).json();
    assert.equal(t.ok, true);
    assert.equal(probed[0].env.GITHUB_TOKEN, 'secret-token');
    assert.equal((await post('/api/mcp/test', { id: 'nope', _csrf: csrf })).status, 400);

    // Delete: gone from the store, the agents and the Gateway.
    const del = await (await post('/api/mcp-library/delete', { id: 'gh', _csrf: csrf })).json();
    assert.deepEqual(del.deactivated, ['Codex']);
    assert.doesNotMatch(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), /mcp_servers\.gh/);
    assert.deepEqual((await (await fetch(base + '/api/gateway')).json()).servers, []);
    assert.deepEqual((await (await fetch(base + '/api/mcp-library')).json()).servers.map((s) => s.id), ['example']);
  } finally {
    server.close();
    remote.close();
  }
});
