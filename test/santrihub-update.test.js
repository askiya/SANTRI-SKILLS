'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const update = require('../src/update');
const desktop = require('../src/desktop-host');
const { createDashboardServer } = require('../src/dashboard');

const ROOT = path.join(__dirname, '..');
const RELEASES = 'https://github.com/askiya/SANTRI-SKILLS/releases';

const redirectTo = (location) => async (url, init) => {
  assert.equal(url, `${RELEASES}/latest`);
  assert.equal(init.redirect, 'manual');
  return new Response(null, { status: 302, headers: location ? { location } : {} });
};

test('versions compare numerically', () => {
  assert.equal(update.compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(update.compareVersions('v0.3.0', '0.2.99'), 1);
  assert.equal(update.compareVersions('0.2.3', 'v0.2.3'), 0);
  assert.equal(update.compareVersions('0.2.3', '1.0.0'), -1);
  assert.equal(update.compareVersions('rusak', '0.2.3'), 0);
});

test('latest tag comes from the releases/latest redirect and only a vX.Y.Z tag counts', async () => {
  assert.equal(await update.latestTag({ fetchImpl: redirectTo(`${RELEASES}/tag/v0.2.4`) }), 'v0.2.4');
  assert.equal(await update.latestTag({ fetchImpl: redirectTo(`${RELEASES}/tag/v0.2.4-beta`) }), null);
  assert.equal(await update.latestTag({ fetchImpl: redirectTo(`${RELEASES}/tag/..%2F..%2Fevil`) }), null);
  assert.equal(await update.latestTag({ fetchImpl: redirectTo(null) }), null);
});

test('checker reports a newer release and caches (1 h ok, 10 min after a failure)', async () => {
  let calls = 0;
  let clock = 0;
  let location = `${RELEASES}/tag/v0.2.4`;
  const fetchImpl = async (...args) => { calls++; if (!location) throw new TypeError('offline'); return redirectTo(location)(...args); };
  const check = update.createUpdateChecker({ current: '0.2.3', fetchImpl, now: () => clock });
  assert.deepEqual(await check(), {
    current: '0.2.3', latest: '0.2.4', available: true,
    releaseUrl: `${RELEASES}/tag/v0.2.4`, command: 'npx santriverse-skills@latest dashboard',
  });
  clock += 59 * 60 * 1000;
  await check();
  assert.equal(calls, 1);
  clock += 2 * 60 * 1000;
  location = null;
  const offline = await check();
  assert.equal(offline.available, false);
  assert.equal(offline.latest, null);
  assert.equal(calls, 2);
  clock += 9 * 60 * 1000;
  await check();
  assert.equal(calls, 2, 'failure is retried after 10 minutes, not on every request');
  location = `${RELEASES}/tag/v0.2.3`;
  clock += 2 * 60 * 1000;
  assert.equal((await check()).available, false, 'same version is not an update');
});

test('installer download requires the SHA-256 from the same release', async () => {
  const exe = Buffer.from('MZ fake installer');
  const good = crypto.createHash('sha256').update(exe).digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-update-'));
  const fake = (sums, body = exe) => async (url) => {
    if (url === `${RELEASES}/download/v0.2.4/SHA256SUMS.txt`) return new Response(sums);
    if (url === `${RELEASES}/download/v0.2.4/SantriHub-Setup.exe`) return new Response(body);
    return new Response('nope', { status: 404 });
  };
  try {
    const file = await update.downloadInstaller('v0.2.4', dir, { fetchImpl: fake(`${'a'.repeat(64)}  SantriHub.exe\n${good}  SantriHub-Setup.exe\n`) });
    assert.equal(path.basename(file), 'SantriHub-Setup-v0.2.4.exe');
    assert.deepEqual(fs.readFileSync(file), exe);
    await assert.rejects(update.downloadInstaller('v0.2.4', dir, { fetchImpl: fake(`${good}  SantriHub-Setup.exe`, Buffer.from('tampered')) }), /Checksum installer tidak cocok/);
    await assert.rejects(update.downloadInstaller('v0.2.4', dir, { fetchImpl: fake(`${good}  Other.exe`) }), /tidak mencantumkan installer/);
    await assert.rejects(update.downloadInstaller('../evil', dir, { fetchImpl: fake('') }), /Versi rilis tidak valid/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runner closes the app window, installs silently and reopens SantriHub', () => {
  const script = update.runnerScript({ installer: "C:\\Users\\O'Neil\\up.exe", exe: 'C:\\Apps\\SantriHub.exe', pid: 4321, profile: 'C:\\Data\\EdgeProfile', log: 'C:\\Data\\santrihub.log' });
  assert.match(script, /Wait-Process -Id 4321/);
  assert.match(script, /'C:\\Users\\O''Neil\\up\.exe'/, 'single quotes escaped for PowerShell');
  assert.match(script, /'\/SILENT','\/SUPPRESSMSGBOXES','\/NORESTART','\/CLOSEAPPLICATIONS'/);
  assert.match(script, /Contains\('C:\\Data\\EdgeProfile'\)/);
  assert.match(script, /Start-Process -FilePath 'C:\\Apps\\SantriHub\.exe' -ArgumentList 'app'/);
});

test('release links are limited to this repository', () => {
  assert.equal(update.isReleaseLink(`${RELEASES}/tag/v0.2.4`), true);
  assert.equal(update.isReleaseLink(`${RELEASES}/latest/download/SantriHub-Setup.exe`), true);
  for (const bad of ['https://github.com/evil/repo/releases', 'http://github.com/askiya/SANTRI-SKILLS/releases', 'https://github.com/askiya/SANTRI-SKILLS/releasesX', 'https://x:y@github.com/askiya/SANTRI-SKILLS/releases']) {
    assert.equal(update.isReleaseLink(bad), false, bad);
  }
});

test('dashboard exposes the update status and UI', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'dashboard.html'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'src', 'dashboard-ui.js'), 'utf8');
  assert.match(html, /id="update-btn"[^>]*hidden/);
  assert.match(html, /id="update-dialog"/);
  assert.match(ui, /getJson\('\/api\/update'\)/);
  assert.match(ui, /'\/__santrihub\/update'/);

  const info = { current: '0.2.3', latest: '0.2.4', available: true, releaseUrl: `${RELEASES}/tag/v0.2.4`, command: 'npx santriverse-skills@latest dashboard' };
  const server = createDashboardServer({ cwd: ROOT, updateCheck: async () => info });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/update`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), info);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('app mode: one-click update only from the app window, and only when packaged', async () => {
  const start = async (opts) => {
    const server = desktop.attachBrowserLogin(createDashboardServer({ cwd: ROOT, updateCheck: async () => ({ available: false }) }), { open: () => {}, focus: () => {}, ...opts });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = (p, body = {}, headers = {}) => fetch(origin + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
    return { server, origin, post };
  };
  const stop = async ({ server }) => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); };

  let calls = 0;
  const opened = [];
  const app = await start({ update: async () => { calls++; return { version: '0.2.4' }; }, open: (u) => opened.push(u) });
  try {
    assert.match(await (await fetch(app.origin + '/__santrihub/desktop.js')).text(), /santrihubUpdate = 'self'/);
    assert.equal((await app.post('/__santrihub/update', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal(calls, 0);
    const ok = await app.post('/__santrihub/update');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, version: '0.2.4' });
    assert.equal(calls, 1);
    assert.equal((await app.post('/__santrihub/open-link', { url: `${RELEASES}/tag/v0.2.4` })).status, 200);
    assert.equal((await app.post('/__santrihub/open-link', { url: 'https://github.com/evil/repo/releases' })).status, 400);
    assert.deepEqual(opened, [`${RELEASES}/tag/v0.2.4`]);
  } finally { await stop(app); }

  const failing = await start({ update: async () => { throw Object.assign(new Error('SantriHub sudah versi terbaru.'), { status: 409 }); } });
  try {
    const res = await failing.post('/__santrihub/update');
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /sudah versi terbaru/);
  } finally { await stop(failing); }

  const dev = await start({}); // `node bin/cli.js app`: no self-update
  try {
    assert.doesNotMatch(await (await fetch(dev.origin + '/__santrihub/desktop.js')).text(), /santrihubUpdate = 'self'/);
    const res = await dev.post('/__santrihub/update');
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /SantriHub\.exe/);
  } finally { await stop(dev); }
});
