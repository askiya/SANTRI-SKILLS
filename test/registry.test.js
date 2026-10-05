'use strict';

// Offline checks for registry loading/validation, MCP catalog merge and collision rejection.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-registry-test-'));
process.env.SANTRI_SKILLS_CACHE = path.join(tmp, 'cache');

function writeRegistry(name, data) {
  const file = path.join(tmp, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

const { loadRegistry, validateSource, validateMcpEntry, mcpCatalog, BUILTIN_MCP } = require('../src/registry');

test('bundled registry loads and exposes both sources', () => {
  const reg = loadRegistry();
  assert.deepEqual(reg.sources.map((s) => s.id), ['appscript', 'monorepo']);
  assert.ok(Array.isArray(reg.mcpServers));
});

test('SANTRI_SKILLS_REGISTRY overrides the bundled catalog', () => {
  const file = writeRegistry('local', {
    sources: [{ id: 'local', label: 'Local', repo: 'askiya/LOCAL-SKILLS', branch: 'main', skillsDir: 'skills', docsDirs: ['docs'] }],
    mcpServers: [{ id: 'santriverse-cms', label: 'CMS', description: 'Vetted CMS tools', command: 'npx', args: ['-y', 'santriverse-cms-mcp'] }],
  });
  const reg = loadRegistry({ file });
  assert.deepEqual(reg.sources.map((s) => s.id), ['local']);
  assert.equal(reg.mcpServers[0].id, 'santriverse-cms');
});

test('missing override file fails loudly instead of silently falling back', () => {
  assert.throws(() => loadRegistry({ file: path.join(tmp, 'nope.json') }), /SANTRI_SKILLS_REGISTRY/);
});

test('unsafe sources are rejected', () => {
  for (const bad of [
    { id: '../evil', repo: 'a/b', branch: 'main', skillsDir: 'skills' },
    { id: 'ok', repo: 'a/b;rm -rf', branch: 'main', skillsDir: 'skills' },
    { id: 'ok', repo: 'a/b', branch: 'main', skillsDir: '../../etc' },
    { id: 'ok', repo: 'a/b', branch: 'main', skillsDir: 'skills', docsDirs: ['/abs'] },
    { id: 'ok', repo: 'a/b', branch: 'main', skillsDir: 'skills', docsDirs: ['docs/../..'] },
  ]) {
    assert.throws(() => validateSource(bad), /invalid/i, `harus ditolak: ${JSON.stringify(bad)}`);
  }
  assert.ok(validateSource({ id: 'ok', repo: 'a/b', branch: 'main', skillsDir: 'skills', docsDirs: ['docs'] }));
});

test('registry rejects malformed schema, duplicate IDs and reserved paths', () => {
  for (const data of [null, {}, { sources: 'bad' }, { sources: [], mcpServers: {} },
    { sources: [], mcpServers: [{ id: 'santri-skills', label: 'x', description: 'x', command: 'node', args: [] }] }]) {
    assert.throws(() => loadRegistry({ file: writeRegistry('invalid', data) }));
  }
  const source = { id: 'safe', repo: 'a/b', branch: 'main', skillsDir: 'skills' };
  for (const override of [{ id: 'con' }, { repo: '../b' }, { branch: '../main' }, { skillsDir: 'skills/.' }, { docsDirs: 'docs' }]) {
    assert.throws(() => validateSource({ ...source, ...override }));
  }
  assert.throws(() => loadRegistry({ file: writeRegistry('duplicate', { sources: [source, source] }) }));
});

test('built-in MCP collisions preserve unknown config', () => {
  const { addMcpServer } = require('../src/install');
  const file = path.join(tmp, 'collision.json');
  const original = JSON.stringify({ mcpServers: { 'santri-skills': { command: 'foreign' } } });
  fs.writeFileSync(file, original);
  assert.throws(() => addMcpServer(file), /sudah ada/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('staged cache replacement restores old cache when activation fails', () => {
  const { replaceCache } = require('../src/sources');
  const live = path.join(tmp, 'live-cache');
  const staged = path.join(tmp, 'staged-cache');
  fs.mkdirSync(live, { recursive: true });
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(live, 'old'), 'kept');
  fs.writeFileSync(path.join(staged, 'new'), 'candidate');
  assert.throws(() => replaceCache(staged, live, () => { throw new Error('activation failed'); }), /activation failed/);
  assert.equal(fs.readFileSync(path.join(live, 'old'), 'utf8'), 'kept');
  assert.ok(fs.existsSync(path.join(staged, 'new')));
});

test('oversized streamed download aborts and keeps old cache', async () => {
  const sources = require('../src/sources');
  const source = { id: 'big', repo: 'a/b', branch: 'main', skillsDir: 'skills' };
  const live = path.join(sources.CACHE_ROOT, 'big');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'old'), 'kept');
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(c) { sent += 1; c.enqueue(new Uint8Array(1024 * 1024)); },
  }));
  try {
    await assert.rejects(sources.fetchSource(source, { refresh: true }), /50 MB/);
    assert.ok(sent <= 52, `stream harus berhenti dini, dapat ${sent} chunk`);
    assert.equal(fs.readFileSync(path.join(live, 'old'), 'utf8'), 'kept');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('mcp entries must be declarative and secret-free', () => {
  for (const bad of [
    { id: 'x y', command: 'npx', args: [] },
    { id: 'x', command: 'sh -c "curl evil"', args: [] },
    { id: 'x', command: 'npx', args: ['a && rm -rf /'] },
    { id: 'x', command: 'npx', args: [1] },
    { id: 'x', command: 'npx', args: [], env: { TOKEN: 'abc' } },
    { id: 'x', command: 'npx', args: [], apiKey: 'abc' },
  ]) {
    assert.throws(() => validateMcpEntry(bad), /invalid|rahasia/i, `harus ditolak: ${JSON.stringify(bad)}`);
  }
  const ok = validateMcpEntry({ id: 'cms', label: 'CMS', description: 'd', command: 'npx', args: ['-y', 'pkg@1.2.3'] });
  assert.equal(ok.id, 'cms');
});

test('mcp catalog always contains the built-in santri-skills entry first', () => {
  const file = writeRegistry('cat', {
    sources: [{ id: 'local', repo: 'a/b', branch: 'main', skillsDir: 'skills' }],
    mcpServers: [{ id: 'cms', label: 'CMS', description: 'd', command: 'npx', args: ['-y', 'cms'] }],
  });
  const list = mcpCatalog(loadRegistry({ file }));
  assert.equal(list[0].id, BUILTIN_MCP.id);
  assert.equal(list[0].builtin, true);
  assert.deepEqual(list.map((m) => m.id), ['santri-skills', 'cms']);
  assert.ok(!('command' in list[1]) === false, 'catalog keeps command for install');
});

test('addMcpServer supports a custom name and refuses to clobber a foreign entry', () => {
  const { addMcpServer } = require('../src/install');
  const file = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { cms: { command: 'other' } } }));

  assert.throws(() => addMcpServer(file, { command: 'npx', args: ['-y', 'cms'] }, 'cms'), /sudah ada/i);

  const merged = addMcpServer(file, { command: 'npx', args: ['-y', 'docs'] }, 'docs-mcp');
  assert.equal(merged.mcpServers['docs-mcp'].command, 'npx');
  assert.equal(merged.mcpServers.cms.command, 'other', 'entri asing tetap utuh');
});

test('dashboard catalog exposes registry mcp entries and installs them by id', async () => {
  const file = writeRegistry('dash', {
    sources: [],
    mcpServers: [{ id: 'cms', label: 'CMS', description: 'Vetted', command: 'npx', args: ['-y', 'santriverse-cms-mcp'] }],
  });
  process.env.SANTRI_SKILLS_REGISTRY = file;
  const { createDashboardServer } = require('../src/dashboard');
  const cwd = path.join(tmp, 'ws');
  const server = createDashboardServer({ cwd });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const catalog = await (await fetch(base + '/api/catalog')).json();
    assert.deepEqual(catalog.mcpServers.map((m) => m.id), ['santri-skills', 'cms']);
    assert.ok(!JSON.stringify(catalog).includes('npx'), 'command tidak dibocorkan ke browser');

    const res = await fetch(base + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ scope: 'project', id: 'cms', confirm: true }),
    });
    assert.equal(res.status, 200);
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.agents', 'mcp_config.json'), 'utf8'));
    assert.deepEqual(cfg.mcpServers.cms, { command: 'npx', args: ['-y', 'santriverse-cms-mcp'] });

    const missing = await fetch(base + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ scope: 'project', id: 'unknown', confirm: true }),
    });
    assert.equal(missing.status, 400);

    const unconfirmed = await fetch(base + '/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ scope: 'project', id: 'cms' }),
    });
    assert.equal(unconfirmed.status, 400);
  } finally {
    await new Promise((r) => server.close(r));
    delete process.env.SANTRI_SKILLS_REGISTRY;
  }
});
