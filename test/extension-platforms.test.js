'use strict';
// Platform tabs in the side panel (Gemini · ChatGPT · Claude): which packages
// show on which tab, the card for each platform, and the Claude ZIP layout.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const catalog = require('../extension/catalog.js');
const claude = require('../extension/claude-skill.js');
const zip = require('../extension/zip.js');

const enc = (t) => new TextEncoder().encode(t);
const skillWith = (front, name = 'demo-skill') => ({ name, files: [
  { path: 'SKILL.md', bytes: enc(`---\nname: ${name}\n${front}---\n# Demo\n`) },
  { path: 'references/spec.md', bytes: enc('# Spec') },
] });

test('packages follow the platforms the admin ticked; older servers keep Gemini + ChatGPT', () => {
  assert.deepEqual(catalog.platformsOf({ kind: 'skill', platforms: ['claude', 'gemini'] }), ['gemini', 'claude']);
  assert.deepEqual(catalog.platformsOf({ kind: 'skill', platforms: ['copilot'] }), ['gemini', 'chatgpt']);
  assert.deepEqual(catalog.platformsOf({ kind: 'skill' }), ['gemini', 'chatgpt']);
  assert.deepEqual(catalog.platformsOf({ kind: 'gem', platforms: ['claude'] }), ['gemini']);
});

test('tabs list the three platforms with counts and mark the active one', () => {
  const html = catalog.renderTabs('chatgpt', { gemini: 2, chatgpt: 1, claude: 0 });
  assert.deepEqual([...html.matchAll(/data-platform="(\w+)"/g)].map(m => m[1]), ['gemini', 'chatgpt', 'claude']);
  assert.match(html, /data-platform="chatgpt" aria-selected="true"/);
  assert.match(html, /data-platform="gemini" aria-selected="false"/);
  assert.match(html, /ChatGPT<span class="ptab-count">1<\/span>/);
});

test('each platform card has one install button and a ZIP in that platform format', () => {
  const item = { id: 7, title: 'Demo', kind: 'skill', description: 'x', version: '1.0.0' };
  for (const [platform, action, label] of [['gemini', 'install', 'Pasang ke Gemini'], ['chatgpt', 'install-chatgpt', 'Pasang ke ChatGPT'], ['claude', 'install-claude', 'Pasang ke Claude']]) {
    const html = catalog.renderCard(item, platform);
    assert.equal((html.match(/btn-main/g) || []).length, 1, platform);
    assert.ok(html.includes(`data-action="${action}"`), platform);
    assert.ok(html.includes(label), platform);
    assert.ok(html.includes(`data-action="download" data-target="${platform}"`), platform);
    assert.ok(html.includes(`Belum dipasang di ${catalog.PLATFORMS[platform].label}`), platform);
    for (const other of Object.values(catalog.PLATFORMS)) if (other.action !== action) assert.ok(!html.includes(`data-action="${other.action}"`), `${platform} has ${other.action}`);
  }
  assert.ok(catalog.renderCard({ ...item, status: 'update_available' }, 'claude').includes('Update di Claude'));
  assert.ok(catalog.renderCard({ ...item, status: 'detected', reported: true }, 'claude').includes('Ditandai terpasang di Claude'));
  assert.ok(catalog.renderCard({ ...item, status: 'detected' }, 'gemini').includes('✓ Terpasang di Gemini'));
});

test('Claude ZIP has one folder named like the skill at its root', async () => {
  const out = claude.buildClaudeZip(skillWith('description: Builds Apps Script web apps.\n'), { version: '1.2.0' });
  assert.equal(out.fileName, 'demo-skill-1.2.0-claude.zip');
  assert.deepEqual(out.warnings, []);
  const entries = await zip.readZip(out.zip);
  assert.deepEqual(entries.map(e => e.path), ['demo-skill/SKILL.md', 'demo-skill/references/spec.md']);
  // The extension's own reader unwraps it back to the same skill.
  assert.equal(zip.prepareSkillPackage(entries).name, 'demo-skill');
});

test('Claude ZIP refuses what claude.ai rejects and warns on long descriptions', () => {
  assert.throws(() => claude.buildClaudeZip(skillWith(''), {}), /description/);
  assert.throws(() => claude.buildClaudeZip(skillWith('description: x\n', 'claude-helper'), {}), /claude/);
  assert.throws(() => claude.buildClaudeZip(skillWith('description: x\n', 'my-anthropic-tool'), {}), /anthropic/);
  assert.throws(() => claude.buildClaudeZip(skillWith(`description: ${'x'.repeat(1025)}\n`), {}), /1024/);
  const long = claude.buildClaudeZip(skillWith(`description: ${'x'.repeat(450)}\n`), {});
  assert.match(long.warnings[0], /450 karakter/);
});

test('side panel loads Claude packaging without asking for claude.ai access', () => {
  const html = read('sidepanel.html');
  assert.ok(html.indexOf('claude-skill.js') > html.indexOf('zip.js'));
  assert.ok(html.indexOf('claude-skill.js') < html.indexOf('sidepanel.js'));
  assert.ok(html.includes('id="platform-tabs"'));
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(!manifest.host_permissions.some(h => h.includes('claude.ai')));
  assert.deepEqual(manifest.permissions.sort(), ['identity', 'sidePanel', 'storage']);
  const code = read('sidepanel.js');
  assert.match(code, /claude: 'claude_status'/);
  assert.match(code, /catalogItems\.filter\(i => platformsOf\(i\)\.includes\(platform\)\)/);
  assert.match(code, /buildClaudeZip\(prepareSkillPackage/);
});
