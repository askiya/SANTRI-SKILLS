'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configStatus, skillTargets, mcpConfigPath, MARKER } = require('../src/install');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-status-'));
const writeSkill = (dir, id, { marker = '{}', skillMd = '# s' } = {}) => {
  const d = path.join(dir, id);
  fs.mkdirSync(d, { recursive: true });
  if (skillMd !== null) fs.writeFileSync(path.join(d, 'SKILL.md'), skillMd);
  if (marker !== null) fs.writeFileSync(path.join(d, MARKER), marker);
};

test('empty workspace is never reported configured', () => {
  const cwd = tmp();
  const s = configStatus('project', cwd, tmp());
  assert.equal(s.configured, false);
  assert.deepEqual(s.skills, []);
  assert.equal(s.mcp.exists, false);
  assert.equal(s.mcp.valid, true);
  assert.equal(s.runtime, 'unverified');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('folder without SKILL.md is not configured; valid skill is', () => {
  const cwd = tmp();
  const target = skillTargets('project', cwd)[0];
  writeSkill(target, 'empty-shell', { skillMd: null });
  let s = configStatus('project', cwd, tmp());
  assert.equal(s.skills.length, 0, 'marker alone must not count');
  assert.equal(s.configured, false);
  writeSkill(target, 'real-skill', { marker: JSON.stringify({ source: 'monorepo', installedAt: new Date().toISOString() }) });
  s = configStatus('project', cwd, tmp());
  assert.deepEqual(s.skills.map((k) => k.id), ['real-skill']);
  assert.equal(s.skills[0].managed, true);
  assert.equal(s.skills[0].markerValid, true);
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('malformed marker and stale timestamp stay visible but valid-flagged', () => {
  const cwd = tmp();
  const target = skillTargets('project', cwd)[0];
  writeSkill(target, 'broken', { marker: '{not json' });
  writeSkill(target, 'stale', { marker: JSON.stringify({ source: 1, installedAt: 'yesterday' }) });
  writeSkill(target, 'unmanaged', { marker: null });
  const s = configStatus('project', cwd, tmp());
  const by = Object.fromEntries(s.skills.map((k) => [k.id, k]));
  assert.equal(by.broken.markerValid, false);
  assert.equal(by.broken.managed, true);
  assert.equal(by.stale.installedAt, null, 'unparseable date must not be echoed');
  assert.equal(by.stale.source, null, 'non-string source must not be echoed');
  assert.equal(by.unmanaged.managed, false);
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('mcp config: malformed invalid, bad entries dropped, no secrets echoed', () => {
  const cwd = tmp();
  const file = mcpConfigPath('project', cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ broken');
  let s = configStatus('project', cwd, tmp());
  assert.equal(s.mcp.valid, false);
  assert.equal(s.configured, false, 'malformed config must never read as configured');

  fs.writeFileSync(file, JSON.stringify({ mcpServers: [] }));
  assert.equal(configStatus('project', cwd, tmp()).mcp.valid, false, 'array mcpServers is malformed');

  fs.writeFileSync(file, JSON.stringify({ mcpServers: {
    good: { command: 'npx', args: ['-y', 'pkg'], env: { TOKEN: 'SECRET_VALUE' } },
    blank: { command: '   ' },
    badargs: { command: 'npx', args: [{}] },
    nil: null,
  } }));
  s = configStatus('project', cwd, tmp());
  assert.deepEqual(s.mcp.servers.map((x) => x.name), ['good']);
  assert.deepEqual(Object.keys(s.mcp.servers[0]).sort(), ['configured', 'managed', 'name', 'runtime']);
  assert.equal(s.mcp.servers[0].runtime, 'unverified');
  assert.ok(!JSON.stringify(s).includes('SECRET_VALUE'), 'env/command secrets must not leave the helper');
  assert.ok(!JSON.stringify(s).includes('npx'));
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('scope is strictly validated', () => {
  for (const bad of ['', 'Project', 'both', null, undefined, 'global ']) assert.throws(() => configStatus(bad, tmp(), tmp()), /Scope invalid/);
  assert.equal(configStatus('global', tmp(), tmp()).scope, 'global');
});
