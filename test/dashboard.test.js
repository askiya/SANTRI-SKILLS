'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-dashboard-test-'));
process.env.SANTRI_SKILLS_CACHE = path.join(tmp, 'cache');

const { createDashboardServer } = require('../src/dashboard');

async function withServer(fn) {
  const server = createDashboardServer({ cwd: path.join(tmp, 'workspace') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('dashboard serves accessible HTML and registry catalog', async () => {
  await withServer(async (base) => {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Santri Skills Dashboard/);
    assert.match(html, /<main/);

    const response = await fetch(base + '/api/catalog');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.skills.length >= 18);
    assert.ok(body.mcpServers.some((server) => server.id === 'santri-skills'));
  });
});

test('dashboard installs selected skills only into its workspace', async () => {
  await withServer(async (base) => {
    await fetch(base + '/api/catalog');
    const response = await fetch(base + '/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ scope: 'project', skillIds: ['apps-script-security'] }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.installed, 1);
    assert.ok(fs.existsSync(path.join(tmp, 'workspace', '.agents', 'skills', 'apps-script-security', 'SKILL.md')));
    assert.ok(!fs.existsSync(path.join(tmp, 'workspace', '.agents', 'skills', 'apps-script-architect')));
  });
});

test('dashboard rejects cross-origin writes', async () => {
  await withServer(async (base) => {
    const response = await fetch(base + '/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ scope: 'project', skillIds: [] }),
    });
    assert.equal(response.status, 403);
  });
});
