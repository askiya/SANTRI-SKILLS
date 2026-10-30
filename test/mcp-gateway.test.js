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

test('gateway: tools of all servers under one MCP, calls routed back, broken servers left out', async () => {
  const { dir, file } = setup((fake) => ({
    alpha: { command: process.execPath, args: [fake, 'alpha'] },
    beta: { command: process.execPath, args: [fake, 'beta'] },
    broken: { command: path.join(path.dirname(fake), 'does-not-exist.exe'), args: [] },
  }));
  try {
    const { byId, stderr } = await talk(file, [
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'tools/call', params: { name: 'beta__echo', arguments: { x: 1 } } },
      { id: 4, method: 'tools/call', params: { name: 'nope__echo' } },
      { id: 5, method: 'ping' },
    ]);
    assert.equal(byId(1).result.protocolVersion, '2025-03-26');
    assert.equal(byId(1).result.serverInfo.name, 'santrihub-gateway');
    const names = byId(2).result.tools.map((t) => t.name);
    assert.ok(names.includes('alpha__echo') && names.includes('beta__echo'));
    assert.ok(!names.some((n) => n.startsWith('broken')), 'a server that cannot start is left out');
    for (const n of names) assert.match(n, /^[A-Za-z0-9_-]{1,64}$/, 'names valid for every agent');
    assert.equal(byId(2).result.tools.find((t) => t.name === 'alpha__echo').description, '[alpha] Echo back');
    assert.deepEqual(byId(3).result.content[0].text, 'beta:{"x":1}');
    assert.equal(byId(4).error.code, -32602);
    assert.deepEqual(byId(5).result, {});
    assert.match(stderr, /broken/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gateway: long tool names are shortened and still reach the right tool', async () => {
  const { dir, file } = setup((fake) => ({ alpha: { command: process.execPath, args: [fake, 'alpha'] } }));
  try {
    const first = await talk(file, [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' }]);
    const long = first.byId(2).result.tools.find((t) => t.name !== 'alpha__echo').name;
    assert.ok(long.length <= 64);
    const second = await talk(file, [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/call', params: { name: long } }]);
    assert.match(second.byId(2).result.content[0].text, /unknown a\.very\.long\.tool\.name/, 'routed with the original name');
    assert.equal(second.byId(2).result.isError, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('gateway with nothing configured answers with no tools', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-gw-empty-'));
  try {
    const { byId } = await talk(path.join(dir, 'none.json'), [{ id: 1, method: 'initialize', params: {} }, { id: 2, method: 'tools/list' }]);
    assert.deepEqual(byId(2).result.tools, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
