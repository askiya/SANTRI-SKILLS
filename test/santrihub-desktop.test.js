'use strict';
// SantriHub for Windows: app command, staged app + official node.exe runtime,
// installed-app behaviour, single-instance lock, installer and release workflow.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { stageApp, fetchRuntime, NODE_RUNTIME } = require('../scripts/build-santrihub.js');
const desktop = require('../src/desktop-host.js');

test('CLI exposes the app command and documents it', () => {
  const cli = read('bin/cli.js');
  assert.match(cli, /process\.platform === 'win32'\) return require\('\.\.\/src\/desktop-host'\)\.startDesktop/);
  assert.match(cli, /return require\('\.\.\/src\/browser-app'\)\.startBrowserApp/);
  assert.match(cli, /santriverse-skills app\s+Buka SantriHub/);
});

test('staged app carries exactly the runtime files and the install marker', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-stage-'));
  try {
    fs.writeFileSync(path.join(dest, 'stale.js'), 'old');
    const files = stageApp(dest, '9.9.9');
    for (const need of ['package.json', 'registry.json', 'bin/cli.js', 'src/dashboard.js', 'src/dashboard.html', 'src/desktop-host.js', 'src/browser-app.js', 'scripts/antigravity_control.py', 'assets/santriverse-logo.webp', 'assets/antigravity.svg']) {
      assert.ok(files.includes(need), `missing ${need}`);
      assert.ok(fs.existsSync(path.join(dest, need)), `not copied ${need}`);
    }
    for (const file of files) {
      assert.doesNotMatch(file, /^(test|extension|dist|installer|support|\.github)\//, file);
      assert.doesNotMatch(file, /banner\.png$|santrihub\.ico$|__pycache__|\.pyc$/, file);
    }
    assert.ok(!fs.existsSync(path.join(dest, 'stale.js')), 'previous stage replaced');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dest, 'santrihub-install.json'), 'utf8')), { app: 'SantriHub', version: '9.9.9', node: NODE_RUNTIME.version });
    assert.equal(desktop.isInstalled(dest), true);
    assert.equal(desktop.isInstalled(ROOT), false, 'a checkout / npx run is not the installed app');
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('runtime is the official node.exe, pinned by SHA-256 and cached', async () => {
  assert.match(NODE_RUNTIME.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(NODE_RUNTIME.sha256).sort(), ['win-arm64', 'win-x64']);
  for (const h of Object.values(NODE_RUNTIME.sha256)) assert.match(h, /^[0-9a-f]{64}$/);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-rt-'));
  try {
    const good = Buffer.from('official node.exe');
    const runtime = { version: '1.2.3', sha256: { 'win-x64': crypto.createHash('sha256').update(good).digest('hex') } };
    const urls = [];
    const fake = (body) => async (url) => { urls.push(url); return { ok: true, arrayBuffer: async () => body }; };
    const file = await fetchRuntime('win-x64', { cache, runtime, fetchImpl: fake(good) });
    assert.deepEqual(urls, ['https://nodejs.org/dist/v1.2.3/win-x64/node.exe']);
    assert.ok(fs.readFileSync(file).equals(good));
    await fetchRuntime('win-x64', { cache, runtime, fetchImpl: fake(good) });
    assert.equal(urls.length, 1, 'verified cache is reused');
    fs.rmSync(file);
    await assert.rejects(fetchRuntime('win-x64', { cache, runtime, fetchImpl: fake(Buffer.from('tampered')) }), /SHA-256/);
    assert.ok(!fs.existsSync(file), 'a mismatching download is never kept');
    await assert.rejects(fetchRuntime('win-ia32', { cache, runtime, fetchImpl: fake(good) }), /hash/);
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('installed app relaunches without a console and cleans up the old single-executable build', () => {
  const host = read('src/desktop-host.js');
  assert.match(host, /if \(installed && relaunchWithoutConsole\(\)\) return null;/);
  assert.match(host, /detached: true, windowsHide: true, stdio: 'ignore', env: \{ \.\.\.env, SANTRIHUB_DETACHED: '1' \}/);
  assert.equal(desktop.relaunchWithoutConsole({ SANTRIHUB_DETACHED: '1' }), false, 'the relaunched copy runs the app itself');
  assert.match(host, /const update = installed \? async/, 'self-update only for the installed app');
  assert.match(host, /startUpdateRunner\(\{ installer, exe: process\.execPath, args: \[CLI, 'app'\]/);

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-data-'));
  try {
    for (const name of ['app-0123456789ab', 'app-0123456789ab.tmp-42', 'EdgeProfile', 'apps']) fs.mkdirSync(path.join(data, name));
    fs.writeFileSync(path.join(data, 'santrihub.log'), '');
    desktop.removeOldExtractions(data);
    assert.deepEqual(fs.readdirSync(data).sort(), ['EdgeProfile', 'apps', 'santrihub.log']);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

test('macOS/Linux: app opens the dashboard in the default browser', async () => {
  const { openCommand, startBrowserApp } = require('../src/browser-app.js');
  assert.deepEqual(openCommand('http://127.0.0.1:1', 'darwin'), ['open', ['http://127.0.0.1:1']]);
  assert.deepEqual(openCommand('http://127.0.0.1:1', 'linux'), ['xdg-open', ['http://127.0.0.1:1']]);
  assert.equal(openCommand('http://127.0.0.1:1', 'win32'), null);
  const opened = [];
  const lines = [];
  const server = startBrowserApp({ version: '9.9.9', port: 0, open: (u) => { opened.push(u); return true; }, log: (l) => lines.push(l) });
  try {
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    await new Promise((r) => setImmediate(r));
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(opened, [url]);
    assert.equal((await fetch(url)).status, 200);
    assert.match(lines.join('\n'), /Ctrl\+C/);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('single instance: live lock is reused, crashed lock is cleaned up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-lock-'));
  const file = path.join(dir, 'desktop.lock');
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, url: 'http://127.0.0.1:4173' }));
    assert.equal(desktop.liveLock(file).url, 'http://127.0.0.1:4173');
    fs.writeFileSync(file, JSON.stringify({ pid: 2147483646, url: 'http://127.0.0.1:4173' }));
    assert.equal(desktop.liveLock(file), null);
    assert.ok(!fs.existsSync(file), 'stale lock removed so SantriHub can start again');
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, url: 'http://evil.example' }));
    assert.equal(desktop.liveLock(file), null);
    fs.writeFileSync(file, 'garbage');
    assert.equal(desktop.liveLock(file), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('window watcher follows Edge windows of the SantriHub profile only', () => {
  const script = desktop.windowWatcherScript("C:\\Users\\O'Brien\\AppData\\Local\\SantriHub\\EdgeProfile");
  assert.match(script, /Contains\('C:\\Users\\O''Brien\\AppData\\Local\\SantriHub\\EdgeProfile'\)/);
  assert.match(script, /MainWindowHandle -ne 0/);
  assert.match(script, /'closed'/);
  assert.equal(desktop.findEdge(() => false), null);
});

test('Edge is found on another Windows drive and as a per-user install', () => {
  const edge = path.join('Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(desktop.findEdge((p) => p.startsWith('D:'), { PROGRAMFILES: 'D:\\Program Files' }), path.join('D:\\Program Files', edge));
  const local = 'C:\\Users\\u\\AppData\\Local';
  assert.equal(desktop.findEdge((p) => p.startsWith(local), { LOCALAPPDATA: local }), path.join(local, edge));
  // The default location still wins when it exists.
  assert.equal(desktop.findEdge((p) => p.includes('Edge'), { LOCALAPPDATA: local }), 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
});

test('without Edge the window comes from Chrome or Brave, else the default browser', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
  assert.equal(desktop.findBrowser((p) => /msedge|chrome|brave/.test(p), env).process, 'msedge.exe');
  const chrome = desktop.findBrowser((p) => p.endsWith('chrome.exe'), env);
  assert.deepEqual({ ...chrome, path: undefined }, { name: 'Google Chrome', path: undefined, process: 'chrome.exe', profile: 'ChromeProfile' });
  const brave = desktop.findBrowser((p) => p.startsWith(env.LOCALAPPDATA) && p.endsWith('brave.exe'), env);
  assert.equal(brave.path, path.join(env.LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'));
  assert.equal(brave.profile, 'BraveProfile');
  assert.equal(desktop.findBrowser(() => false, env), null);
  assert.match(desktop.windowWatcherScript('C:\\D\\ChromeProfile', 'chrome.exe'), /Name='chrome\.exe'/);

  const host = read('src/desktop-host.js');
  assert.doesNotMatch(host, /Microsoft Edge tidak ditemukan/, 'no Edge is not fatal any more');
  assert.match(host, /if \(!browser\) \{\s*openExternal\(url\);/);
  assert.match(host, /event === 'nowindow' && lastRequest > started/, 'a loaded dashboard is never closed as "no window"');
});

test('startup failures of the app tell the member what to do', () => {
  const { startupMessage } = desktop;
  assert.match(startupMessage(Object.assign(new Error('x'), { code: 'EPERM' }), 'C:\\D'), /EPERM[\s\S]*antivirus[\s\S]*C:\\D[\\/]santrihub\.log/);
  assert.match(startupMessage(Object.assign(new Error('x'), { code: 'ENOSPC' }), 'C:\\D'), /disk penuh/);
  assert.match(startupMessage(new Error('boom'), 'C:\\D'), /\(boom\)[\s\S]*kirim file log/);
  // Only `app` on Windows gets a message box; mcp-serve output belongs to the IDE.
  assert.match(read('bin/cli.js'), /process\.platform === 'win32' && process\.argv\[2\] === 'app'\) require\('\.\.\/src\/desktop-host'\)\.alertStartupFailure\(err\)/);
});

test('installer: per-user, official node.exe per CPU, shortcuts run the app, clean uninstall', () => {
  const iss = read('installer/santrihub.iss');
  assert.match(iss, /AppId=\{\{552379FB-5AEC-4663-8618-354F26FDF266\}/);
  assert.match(iss, /PrivilegesRequired=lowest/);
  assert.match(iss, /OutputBaseFilename=SantriHub-Setup/);
  assert.match(iss, /ArchitecturesAllowed=x64compatible or arm64/);
  assert.match(iss, /runtime\\win-x64\\node\.exe"; DestDir: "\{app\}\\runtime"; Check: not IsArm64/);
  assert.match(iss, /runtime\\win-arm64\\node\.exe"; DestDir: "\{app\}\\runtime"; Check: IsArm64/);
  assert.match(iss, /SantriHub\\app\\\*"; DestDir: "\{app\}\\app"; Flags: ignoreversion recursesubdirs createallsubdirs/);
  const shortcut = /Filename: "\{app\}\\runtime\\node\.exe"; Parameters: """\{app\}\\app\\bin\\cli\.js"" app"; WorkingDir: "\{app\}"; IconFilename: "\{app\}\\santrihub\.ico"; Flags: runminimized/;
  assert.match(iss, new RegExp(`\\{autoprograms\\}\\\\SantriHub"; ${shortcut.source}`));
  assert.match(iss, new RegExp(`\\{autodesktop\\}\\\\SantriHub"; ${shortcut.source}; Tasks: desktopicon`));
  assert.doesNotMatch(iss, /Source: .*SantriHub\.exe/, 'no unsigned program is installed');
  assert.match(iss, /InstallDelete\][\s\S]*Name: "\{app\}\\SantriHub\.exe"/, 'the old single executable is removed on upgrade');
  assert.match(iss, /Get-Process node .*\$_\.Path -like '\*\\SantriHub\\runtime\\node\.exe'/, 'uninstall stops only this node.exe');
  assert.match(iss, /UninstallDelete\]\s*\r?\n(;.*\r?\n)*Type: filesandordirs; Name: "\{localappdata\}\\SantriHub"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'santrihub.ico')));
});

test('installer reopens SantriHub after an in-app update from 0.2.x only', () => {
  const iss = read('installer/santrihub.iss');
  // 0.2.x runners reopen SantriHub.exe, which the upgrade deletes; the installer reopens the app instead.
  assert.match(iss, /Flags: nowait skipifnotsilent runminimized; Check: UpgradedFromSingleExe/);
  assert.match(iss, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;\s*begin\s*HadSingleExe := FileExists\(ExpandConstant\('\{app\}\\SantriHub\.exe'\)\);/);
  assert.match(iss, /function UpgradedFromSingleExe: Boolean;\s*begin\s*Result := HadSingleExe;/);
  const yml = read('.github/workflows/release-santrihub.yml');
  assert.match(yml, /A fresh silent install must not start SantriHub/);
  assert.match(yml, /SantriHub did not reopen after an upgrade from 0\.2\.x/);
});

test('release workflow: tag must match version, assets keep a stable download name', () => {
  const yml = read('.github/workflows/release-santrihub.yml');
  assert.match(yml, /tags: \['v\*'\]/);
  assert.match(yml, /Tag .* != package\.json/);
  assert.match(yml, /\$files = 'dist\/SantriHub-Setup\.exe'/);
  assert.match(yml, /gh release create \$tag @files/);
  assert.match(yml, /gh release upload \$tag @files --clobber/, 'a moved tag replaces the files of its release');
  assert.match(yml, /releases\/latest\/download\/SantriHub-Setup\.exe/);
  assert.match(read('.gitignore'), /^dist\/$/m);
});

test('release workflow: optional code signing before install test and checksums, diagnostics attached', () => {
  const yml = read('.github/workflows/release-santrihub.yml');
  const at = (re) => { const i = yml.search(re); assert.ok(i >= 0, String(re)); return i; };
  assert.match(yml, /id-token: write/);
  assert.equal((yml.match(/if: vars\.AZURE_SIGNING_ACCOUNT != ''/g) || []).length, 3, 'signing is skipped without configuration');
  assert.doesNotMatch(yml, /dist[\\/]+SantriHub\.exe/, 'no single executable is built or released any more');
  assert.ok(at(/name: Runtime is the signed, unmodified node\.exe/) < at(/name: Build installer/));
  assert.match(yml, /-notmatch 'OpenJS Foundation'/);
  assert.ok(at(/name: Build installer/) < at(/name: Sign SantriHub-Setup\.exe/));
  assert.ok(at(/name: Verify signatures/) < at(/name: Installer smoke test/));
  assert.ok(at(/name: Sign SantriHub-Setup\.exe/) < at(/name: Checksums/), 'SHA256SUMS describe the signed files');
  assert.match(yml, /\$files = .*'dist\/SantriHub-Diagnosa\.zip'/);
  for (const f of ['support/diagnosa-santrihub.cmd', 'support/diagnosa-santrihub.ps1']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.match(read('support/diagnosa-santrihub.cmd'), /-ExecutionPolicy Bypass -File "%~dp0diagnosa-santrihub\.ps1"/);
  // Windows PowerShell 5.1 reads BOM-less files as ANSI: keep the script ASCII.
  assert.doesNotMatch(read('support/diagnosa-santrihub.ps1'), /[^\x00-\x7f]/);
});

// ── Login through the member's own browser (app mode) ────────────────────────

test('only the Santriverse connect page calling back to this SantriHub may be opened', () => {
  const origin = 'http://127.0.0.1:5555';
  const good = `https://santriverse.my.id/skills/connect?callback=${encodeURIComponent(origin + '/auth/callback')}&state=x&code_challenge=y&code_challenge_method=S256`;
  assert.equal(desktop.isAllowedLoginUrl(good, origin, 'https://santriverse.my.id'), true);
  for (const bad of [
    good.replace('santriverse.my.id', 'evil.example'),
    good.replace('/skills/connect', '/skills/connect/../x'),
    good.replace('5555', '6666'),
    'https://user:pw@santriverse.my.id/skills/connect?callback=' + encodeURIComponent(origin + '/auth/callback'),
    'javascript:alert(1)', null, 42,
  ]) assert.equal(desktop.isAllowedLoginUrl(bad, origin, 'https://santriverse.my.id'), false, String(bad));
});

test('app mode opens login in the default browser and brings the window back', async () => {
  const { createDashboardServer } = require('../src/dashboard.js');
  const opened = [];
  let focused = 0;
  const server = desktop.attachBrowserLogin(createDashboardServer({ cwd: ROOT }), { open: (u) => opened.push(u), focus: () => { focused++; } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(origin + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body) });
  try {
    const page = await (await fetch(origin + '/')).text();
    assert.match(page, /<script src="\/__santrihub\/desktop\.js"><\/script><\/body>/);
    const script = await fetch(origin + '/__santrihub/desktop.js');
    assert.equal(script.status, 200);
    assert.match(await script.text(), /open-login/);

    const { url } = await (await post('/api/auth/login', {})).json();
    assert.equal(desktop.isAllowedLoginUrl(url, origin), true, url);

    assert.equal((await post('/__santrihub/open-login', { url }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/__santrihub/open-login', { url: 'https://evil.example/' })).status, 400);
    assert.equal(opened.length, 0);
    assert.equal((await post('/__santrihub/open-login', { url })).status, 200);
    assert.deepEqual(opened, [url]);

    const callback = await (await fetch(origin + '/auth/callback')).text();
    assert.match(callback, /Login berhasil/);
    assert.match(callback, /\/api\/auth\/callback/);
    assert.equal((await post('/__santrihub/focus', {})).status, 200);
    assert.equal(focused, 1);

    // Everything else still belongs to the dashboard (premium gate intact).
    assert.equal((await fetch(origin + '/api/auth/status')).status, 401);
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
  }
});
