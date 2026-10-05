'use strict';

// One runnable check for the non-trivial logic: catalog fetch, skill install, MCP config merge, MCP tools.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-skills-test-'));
process.env.SANTRI_SKILLS_CACHE = path.join(tmp, 'cache');

const { loadCatalog, parseFrontmatter } = require('../src/sources');
const { installSkills, uninstallSkills, addMcpServer, removeMcpServer, skillTargets, mcpConfigPath } = require('../src/install');

test('parseFrontmatter reads name and description', () => {
  const meta = parseFrontmatter('---\nname: demo\ndescription: Hello world\n---\n# Body');
  assert.equal(meta.name, 'demo');
  assert.equal(meta.description, 'Hello world');
});

test('target paths follow Antigravity docs', () => {
  const home = path.join(tmp, 'home');
  assert.deepEqual(skillTargets('project', path.join(tmp, 'proj'), home), [path.join(tmp, 'proj', '.agents', 'skills')]);
  assert.deepEqual(skillTargets('global', path.join(tmp, 'proj'), home), [
    path.join(home, '.gemini', 'config', 'skills'),
    path.join(home, '.gemini', 'antigravity-cli', 'skills'),
  ]);
  assert.equal(mcpConfigPath('project', path.join(tmp, 'proj'), home), path.join(tmp, 'proj', '.agents', 'mcp_config.json'));
});

test('mcp config merge keeps existing servers and backs up', () => {
  const file = path.join(tmp, 'mcp_config.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: 'node' } }, extra: 1 }, null, 2));
  const merged = addMcpServer(file);
  assert.ok(merged.mcpServers.other, 'server lain harus tetap ada');
  assert.equal(merged.extra, 1, 'key lain harus tetap ada');
  assert.equal(merged.mcpServers['santri-skills'].command, 'npx');
  assert.ok(fs.existsSync(`${file}.bak`), 'backup harus dibuat');
  assert.equal(removeMcpServer(file), true);
  assert.ok(!JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers['santri-skills']);
});

test('catalog downloads both repos and installs skills (network)', async () => {
  const groups = await loadCatalog(undefined, { refresh: true });
  assert.equal(groups.length, 2);
  const skills = groups.flatMap((g) => g.skills);
  assert.ok(skills.length >= 18, `harus >=18 skill, dapat ${skills.length}`);
  assert.ok(skills.every((s) => s.description.length > 0), 'semua skill harus punya description di frontmatter');
  assert.ok(skills.some((s) => s.id === 'apps-script-security'));
  assert.ok(skills.some((s) => s.id === 'pre-deploy-gate'));

  const target = path.join(tmp, 'proj', '.agents', 'skills');
  const res = installSkills(skills, [target]);
  assert.equal(res.installed.length, skills.length);
  assert.ok(fs.existsSync(path.join(target, 'apps-script-security', 'SKILL.md')));

  // idempotent: second install replaces our own folders, no skips
  const again = installSkills(skills, [target]);
  assert.equal(again.skipped.length, 0);

  // foreign folder is protected
  const foreign = path.join(target, 'not-ours');
  fs.mkdirSync(foreign, { recursive: true });
  fs.writeFileSync(path.join(foreign, 'SKILL.md'), 'x');
  const removed = uninstallSkills([target]);
  assert.equal(removed.length, skills.length);
  assert.ok(fs.existsSync(foreign), 'folder asing tidak boleh dihapus');

  const { callTool } = require('../src/mcp-server');
  assert.match(await callTool('list_skills'), /apps-script-security/);
  assert.match(await callTool('get_skill', { id: 'pre-deploy-gate' }), /---/);
  assert.ok((await callTool('search_docs', { query: 'monorepo', limit: 3 })).length > 10);
});
