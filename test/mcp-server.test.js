'use strict';
// MCP stdio server (JSON-RPC handling, protocol negotiation, get_skill_file sandbox)
// and recognition of santri-skills entries written by any SantriHub build.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

// Offline cache with both registry sources marked as fetched.
function fakeCache() {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-mcp-'));
  for (const id of ['appscript', 'monorepo']) {
    const skill = path.join(cache, id, 'skills', `demo-${id}`);
    fs.mkdirSync(path.join(skill, 'references'), { recursive: true });
    fs.writeFileSync(path.join(cache, id, '.fetched'), 'x');
    fs.writeFileSync(path.join(skill, 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nhalo');
    fs.writeFileSync(path.join(skill, 'references', 'a.md'), 'REF');
    fs.writeFileSync(path.join(skill, 'bin.dat'), Buffer.from([1, 0, 2]));
  }
  fs.writeFileSync(path.join(cache, 'secret.txt'), 'SECRET');
  return cache;
}

// Runs one mcp-serve process over the given lines; replies keyed by id.
function serve(cache, lines) {
  const input = lines.map((m) => (typeof m === 'string' ? m : JSON.stringify({ jsonrpc: '2.0', ...m }))).join('\n') + '\n';
  const r = spawnSync(process.execPath, [CLI, 'mcp-serve'], {
    input, encoding: 'utf8', timeout: 15000,
    env: { ...process.env, SANTRI_SKILLS_CACHE: cache, SANTRIHUB_BRIDGE_FILE: path.join(cache, 'bridge.json') },
  });
  const replies = r.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { replies, byId: (id) => replies.find((x) => x.id === id) };
}
const call = (id, name, args) => ({ id, method: 'tools/call', params: { name, arguments: args } });
const text = (reply) => reply.result.content[0].text;

test('stdio: JSON-RPC errors, notifications, ping and protocol negotiation', () => {
  const cache = fakeCache();
  try {
    const { replies, byId } = serve(cache, [
      'not json',
      '[1]',
      { id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { method: 'notifications/initialized' },
      { id: 2, method: 'tools/list' },
      { id: 3, method: 'ping' },
      { id: 4, method: 'foo' },
      call(5, 'nope', {}),
    ]);
    assert.deepEqual(replies.filter((x) => x.id === null).map((x) => x.error.code).sort((a, b) => a - b), [-32700, -32600]);
    assert.equal(byId(1).result.protocolVersion, '2025-03-26');
    assert.equal(byId(1).result.serverInfo.name, 'santri-skills');
    assert.ok(byId(2).result.tools.some((t) => t.name === 'get_skill_file'));
    assert.deepEqual(byId(3).result, {});
    assert.equal(byId(4).error.code, -32601);
    assert.equal(byId(5).error.code, -32602);
    assert.equal(replies.length, 7, 'notification gets no reply');

    const old = serve(cache, [{ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }]).byId(1);
    assert.equal(old.result.protocolVersion, '2024-11-05');
    const unknown = serve(cache, [{ id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } }]).byId(1);
    assert.equal(unknown.result.protocolVersion, require('../src/mcp-server').SUPPORTED_PROTOCOLS[0]);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('get_skill_file lists and reads files inside the skill folder only', () => {
  const cache = fakeCache();
  try {
    const { byId } = serve(cache, [
      call(1, 'get_skill_file', { id: 'demo-appscript' }),
      call(2, 'get_skill_file', { id: 'demo-appscript', path: 'references/a.md' }),
      call(3, 'get_skill_file', { id: 'demo-appscript', path: '../../../secret.txt' }),
      call(4, 'get_skill_file', { id: 'demo-appscript', path: path.join(cache, 'secret.txt') }),
      call(5, 'get_skill_file', { id: 'demo-appscript', path: 'bin.dat' }),
      call(6, 'get_skill_file', { id: 'demo-appscript', path: 'references' }),
      call(7, 'get_skill_file', { id: 'demo-appscript', path: 5 }),
      call(8, 'get_skill', { id: 'missing' }),
    ]);
    assert.match(text(byId(1)), /3 file di skill demo-appscript:\n- SKILL\.md\n- bin\.dat\n- references\/a\.md/);
    assert.equal(text(byId(2)), 'REF');
    for (const id of [3, 4, 7]) {
      assert.equal(byId(id).result.isError, true);
      assert.match(text(byId(id)), /path harus relatif/);
    }
    assert.match(text(byId(5)), /biner/);
    assert.match(text(byId(6)), /tidak ada di skill/);
    // Tool failures are results with isError, not JSON-RPC errors.
    assert.equal(byId(8).result.isError, true);
    assert.match(text(byId(8)), /tidak ditemukan/);
    for (let id = 1; id <= 8; id++) assert.ok(!text(byId(id)).includes('SECRET'));
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('santri-skills entries of any SantriHub build are recognised; foreign ones are not', () => {
  const { isOurs, ownServerEntry, SERVER_ENTRY, addMcpServer } = require('../src/install');
  const exe = 'C:\\Program Files\\SantriHub\\SantriHub.exe';
  assert.deepEqual(ownServerEntry(exe), { command: exe, args: ['mcp-serve'] });
  assert.deepEqual(ownServerEntry('C:\\node\\node.exe').args.slice(-1), ['mcp-serve']);
  assert.match(ownServerEntry('C:\\node\\node.exe').args[0], /bin[\\/]cli\.js$/);

  assert.equal(isOurs(SERVER_ENTRY), true);
  assert.equal(isOurs({ command: exe, args: ['mcp-serve'] }), true);
  assert.equal(isOurs({ command: exe, args: ['C:\\Users\\x\\AppData\\Local\\SantriHub\\app-old\\bin\\cli.js', 'mcp-serve'] }), true);
  assert.equal(isOurs({ command: 'node', args: [path.join(__dirname, '..', 'bin', 'cli.js'), 'mcp-serve'] }), true);
  assert.equal(isOurs({ command: 'node', args: [path.join(os.tmpdir(), 'gone-santri', 'bin', 'cli.js'), 'mcp-serve'] }), true, 'moved/removed cli.js');

  const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-foreign-'));
  try {
    fs.mkdirSync(path.join(foreignRoot, 'bin'));
    fs.writeFileSync(path.join(foreignRoot, 'bin', 'cli.js'), '');
    fs.writeFileSync(path.join(foreignRoot, 'package.json'), JSON.stringify({ name: 'other-tool' }));
    assert.equal(isOurs({ command: 'node', args: [path.join(foreignRoot, 'bin', 'cli.js'), 'mcp-serve'] }), false);
    assert.equal(isOurs({ command: exe, args: ['mcp-serve'], env: { A: '1' } }), false);
    assert.equal(isOurs({ command: 'python', args: ['server.py'] }), false);
    assert.equal(isOurs({ command: exe, args: ['mcp-serve', '--x'] }), false);
    assert.equal(isOurs(null), false);

    // An entry from an older build is refreshed; a foreign one under the same name is left alone.
    const config = path.join(foreignRoot, 'mcp_config.json');
    const fresh = { command: exe, args: ['mcp-serve'] };
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { 'santri-skills': { command: exe, args: ['C:\\old\\app-1\\bin\\cli.js', 'mcp-serve'] } } }));
    addMcpServer(config, fresh);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers['santri-skills'], fresh);
    const foreign = { mcpServers: { 'santri-skills': { command: 'python', args: ['server.py'] } } };
    fs.writeFileSync(config, JSON.stringify(foreign));
    assert.throws(() => addMcpServer(config, fresh), /sudah ada/);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')), foreign);
  } finally {
    fs.rmSync(foreignRoot, { recursive: true, force: true });
  }
});

test('entries of SantriHub.exe ≤ 0.2.5 move to the installed node.exe; working or foreign ones stay', () => {
  const { migrateOwnEntry, SERVER_ENTRY } = require('../src/install');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-migrate-'));
  const config = path.join(dir, 'mcp_config.json');
  const installed = { command: 'C:\\Users\\u\\AppData\\Local\\Programs\\SantriHub\\runtime\\node.exe', args: [path.join(__dirname, '..', 'bin', 'cli.js'), 'mcp-serve'] };
  const write = (entry) => fs.writeFileSync(config, JSON.stringify({ mcpServers: { other: { command: 'x', args: [] }, 'santri-skills': entry } }));
  const entry = () => JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers['santri-skills'];
  const gone = (p) => !/SantriHub\.exe$/i.test(p) && fs.existsSync(p) || p === installed.command;
  try {
    assert.equal(migrateOwnEntry(config, installed, gone), false, 'no config: nothing to do');
    write({ command: 'C:\\Users\\u\\AppData\\Local\\Programs\\SantriHub\\SantriHub.exe', args: ['mcp-serve'] });
    assert.equal(migrateOwnEntry(config, installed, gone), true);
    assert.deepEqual(entry(), installed);
    assert.deepEqual(JSON.parse(fs.readFileSync(config, 'utf8')).mcpServers.other, { command: 'x', args: [] }, 'other servers untouched');
    assert.equal(migrateOwnEntry(config, installed, gone), false, 'already current');

    write({ command: 'C:\\Old\\SantriHub.exe', args: ['mcp-serve'] });
    assert.equal(migrateOwnEntry(config, installed, () => true), false, 'a working entry is left alone');
    write(SERVER_ENTRY);
    assert.equal(migrateOwnEntry(config, installed, gone), false, 'npx entry is left alone');
    write({ command: 'C:\\gone\\python.exe', args: ['server.py'] });
    assert.equal(migrateOwnEntry(config, installed, gone), false, 'foreign entry is left alone');
    assert.deepEqual(entry(), { command: 'C:\\gone\\python.exe', args: ['server.py'] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
