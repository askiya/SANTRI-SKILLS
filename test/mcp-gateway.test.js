'use strict';
// SantriHub MCP Gateway: one stdio MCP in front of the servers chosen in SantriHub.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { readGateway } = require('../src/mcp-gateway');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

// A minimal MCP server: tools `echo` and a long-named one; exits on `crash`.
const FAKE = `
const rl = require('readline').createInterface({ input: process.stdin });
const name = process.argv[2];
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name } } });
  if (m.method === 'tools/list') return send({ id: m.id, result: { tools: [
    { name: 'echo', description: 'Echo back', inputSchema: { type: 'object' } },
    { name: 'a.very.long.tool.name.that.goes.on.and.on.and.on.forever', inputSchema: { type: 'object' } }] } });
  if (m.method === 'tools/call') {
    if (m.params.name === 'echo') return send({ id: m.id, result: { content: [{ type: 'text', text: name + ':' + JSON.stringify(m.params.arguments) }] } });
    return send({ id: m.id, error: { code: -32602, message: 'unknown ' + m.params.name } });
  }
});`;

function setup(servers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-gateway-'));
  fs.writeFileSync(path.join(dir, 'fake.js'), FAKE);
  const file = path.join(dir, 'gateway.json');
  fs.writeFileSync(file, JSON.stringify({ servers: servers(path.join(dir, 'fake.js')) }));
  return { dir, file };
}

function talk(file, messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'mcp-gateway'], { env: { ...process.env, SANTRIHUB_GATEWAY_FILE: file, SANTRIHUB_GATEWAY_TIMEOUT_MS: '5000' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = [];
    let buf = '', stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0;) { replies.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      if (replies.length >= messages.filter((m) => m.id !== undefined).length) { child.stdin.end(); }
    });
    child.on('exit', () => resolve({ replies, stderr, byId: (id) => replies.find((r) => r.id === id) }));
    child.on('error', reject);
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    setTimeout(() => child.kill(), 20000).unref();
  });
}

test('gateway file: only well-formed entries are used', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-gwfile-'));
  try {
    const file = path.join(dir, 'g.json');
    fs.writeFileSync(file, JSON.stringify({ servers: { ok: { command: 'node', args: ['x'] }, 'bad name': { command: 'x', args: [] }, 'a__b': { command: 'x', args: [] }, noargs: { command: 'x' }, num: { command: 'x', args: [1] } } }));
    assert.deepEqual(Object.keys(readGateway(file)), ['ok']);
    assert.deepEqual(readGateway(path.join(dir, 'missing.json')), {});
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


const call = (id, name, args) => ({ id, method: 'tools/call', params: { name, arguments: args } });
const textOf = (reply) => reply.result.content[0].text;
const HUB_TOOLS = ['hub_cari', 'hub_skill', 'hub_docs', 'hub_status', 'hub_mulai_proyek', 'hub_referensi', 'hub_alat', 'hub_pakai'];

test('hub: a short tool list; other MCP servers are found with hub_alat and run with hub_pakai', async () => {
  const { dir, file } = setup((fake) => ({
    alpha: { command: process.execPath, args: [fake, 'alpha'] },
    beta: { command: process.execPath, args: [fake, 'beta'] },
    broken: { command: path.join(path.dirname(fake), 'does-not-exist.exe'), args: [] },
    'santri-skills': { command: process.execPath, args: [fake, 'self'] },
  }));
  try {
    const { byId, stderr } = await talk(file, [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'claude-code' } } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      call(3, 'hub_alat', {}),
      call(4, 'hub_alat', { query: 'echo back' }),
      call(5, 'hub_pakai', { server: 'beta', tool: 'echo', arguments: { x: 1 } }),
      call(6, 'hub_pakai', { server: 'beta', tool: 'nope' }),
      call(7, 'hub_pakai', { server: 'santri-skills', tool: 'echo' }),
      { id: 8, method: 'tools/call', params: { name: 'beta__echo' } },
      { id: 9, method: 'prompts/list' },
      { id: 10, method: 'ping' },
    ]);
    const init = byId(1).result;
    assert.equal(init.protocolVersion, '2025-03-26');
    assert.match(init.instructions, /hub_cari/);
    assert.ok(init.capabilities.prompts);
    const names = byId(2).result.tools.map((t) => t.name);
    assert.deepEqual(names.sort(), [...HUB_TOOLS].sort(), 'other servers are not listed one tool at a time');
    for (const n of names) assert.match(n, /^[A-Za-z0-9_-]{1,64}$/);
    assert.match(textOf(byId(3)), /alpha: 2 tool/);
    assert.match(textOf(byId(3)), /broken: gagal dijalankan/);
    assert.doesNotMatch(textOf(byId(3)), /santri-skills|self/, 'santri-skills behind the hub would only repeat the hub');
    assert.match(textOf(byId(4)), /server: (alpha|beta) · tool: echo/);
    assert.match(textOf(byId(4)), /arguments: \{"type":"object"\}/);
    assert.equal(textOf(byId(5)), 'beta:{"x":1}', 'the other server answers as it is');
    assert.equal(byId(6).result.isError, true);
    assert.match(textOf(byId(6)), /Tool 'nope' tidak ada/);
    assert.equal(byId(7).result.isError, true);
    assert.equal(byId(8).error.code, -32602, 'old prefixed names are gone');
    assert.deepEqual(byId(9).result.prompts.map((p) => p.name), ['mulai', 'bangun']);
    assert.deepEqual(byId(10).result, {});
    assert.match(stderr, /broken/);

    const cache = JSON.parse(fs.readFileSync(path.join(dir, 'tool-cache.json'), 'utf8')).servers;
    assert.deepEqual(Object.keys(cache).sort(), ['alpha', 'beta']);
    const activity = fs.readFileSync(path.join(dir, 'activity.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(activity.map((a) => a.tool).sort(), ['hub_alat', 'hub_alat', 'hub_pakai']);
    const used = activity.find((a) => a.tool === 'hub_pakai');
    assert.equal(used.detail, 'beta/echo');
    assert.equal(used.client, 'claude-code');
    assert.doesNotMatch(JSON.stringify(activity), /"x"/, 'arguments are never logged');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub: known tools come from the cache, so a search does not start the server again', async () => {
  const { dir, file } = setup((fake) => ({ alpha: { command: process.execPath, args: [fake, 'alpha'] } }));
  try {
    await talk(file, [{ id: 1, method: 'initialize', params: {} }, call(2, 'hub_alat', {})]);
    fs.rmSync(path.join(dir, 'fake.js')); // the server can no longer start
    const { byId } = await talk(file, [{ id: 1, method: 'initialize', params: {} }, call(2, 'hub_alat', { query: 'echo' })]);
    assert.match(textOf(byId(2)), /server: alpha · tool: echo/);
    assert.doesNotMatch(textOf(byId(2)), /gagal/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub: long tool names are run with their original name', async () => {
  const { dir, file } = setup((fake) => ({ alpha: { command: process.execPath, args: [fake, 'alpha'] } }));
  try {
    const { byId } = await talk(file, [{ id: 1, method: 'initialize', params: {} },
      call(2, 'hub_pakai', { server: 'alpha', tool: 'a.very.long.tool.name.that.goes.on.and.on.and.on.forever' })]);
    assert.match(textOf(byId(2)), /unknown a\.very\.long\.tool\.name/, 'routed with the original name');
    assert.equal(byId(2).result.isError, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('hub with no other MCP servers still offers the hub tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-gw-empty-'));
  try {
    const { byId } = await talk(path.join(dir, 'none.json'), [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' }, call(3, 'hub_alat', { query: 'x' })]);
    assert.equal(byId(2).result.tools.length, HUB_TOOLS.length);
    assert.match(textOf(byId(3)), /Belum ada MCP lain/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
