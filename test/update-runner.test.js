'use strict';
// The update runner with real processes: the app exits, the runner installs and reopens it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { windowCloseScript } = require('../src/update-runner');

const ROOT = path.join(__dirname, '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-runner-'));
const waitFor = async (check, ms = 20000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return true; await new Promise((r) => setTimeout(r, 200)); } return check(); };
// A parent that does what the app does, then exits at once (like SantriHub closing for an update).
const runParent = (code) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(err || `exit ${c}`))));
});

test('window close script targets only the SantriHub profile of the given browser', () => {
  const s = windowCloseScript("C:\\Users\\O'Neil\\SantriHub\\ChromeProfile", 'chrome.exe');
  assert.match(s, /Name='chrome\.exe'/);
  assert.match(s, /Contains\('C:\\Users\\O''Neil\\SantriHub\\ChromeProfile'\)/);
  assert.match(windowCloseScript('C:\\P', "x'; evil"), /Name='msedge\.exe'/, 'odd process names are not interpolated');
});

test('runner outlives the app: waits for it, runs the installer, logs, deletes it and reopens the app', async () => {
  const dir = tmp();
  try {
    const installer = path.join(dir, 'SantriHub-Setup-v9.9.9.exe');
    fs.copyFileSync(process.execPath, installer); // a real program standing in for the installer
    const log = path.join(dir, 'santrihub.log');
    const installed = path.join(dir, 'installed.txt');
    const reopened = path.join(dir, 'reopened.txt');
    const opts = {
      installer, exe: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(reopened)}, 'yes')`],
      profile: null, log,
      installerArgs: ['-e', `require('fs').writeFileSync(${JSON.stringify(installed)}, 'yes'); process.exit(3)`],
    };
    // The "app": starts the runner the way desktop-host does (pid = itself), then exits.
    await runParent(`
      const path = require('path'), { spawn } = require('child_process');
      const opts = ${JSON.stringify(opts)}; opts.pid = process.pid;
      spawn(process.execPath, [${JSON.stringify(path.join(ROOT, 'src', 'update-runner.js'))}, JSON.stringify(opts)], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
      setTimeout(() => process.exit(0), 300);`);
    assert.ok(await waitFor(() => fs.existsSync(reopened)), `app not reopened; log: ${fs.existsSync(log) && fs.readFileSync(log, 'utf8')}`);
    assert.ok(fs.existsSync(installed), 'installer ran');
    const text = fs.readFileSync(log, 'utf8');
    assert.match(text, /update runner started/);
    assert.match(text, /update installer exit 3/);
    assert.match(text, /SantriHub reopened/);
    assert.ok(await waitFor(() => !fs.existsSync(installer), 5000), 'downloaded installer removed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('startUpdateRunner launches the runner on this node.exe, detached', () => {
  const { startUpdateRunner } = require('../src/update');
  const calls = [];
  const fake = (cmd, args, options) => { calls.push({ cmd, args, options }); return { unref() {} }; };
  const opts = startUpdateRunner({ installer: 'C:\\u.exe', exe: 'C:\\n\\node.exe', args: ['C:\\a b\\cli.js', 'app'], pid: 42, profile: 'C:\\P', browserProcess: 'msedge.exe', log: 'C:\\l.log' }, fake);
  assert.equal(calls[0].cmd, process.execPath);
  assert.equal(calls[0].args[0], path.join(ROOT, 'src', 'update-runner.js'));
  assert.deepEqual(JSON.parse(calls[0].args[1]), opts);
  assert.deepEqual(opts.args, ['C:\\a b\\cli.js', 'app'], 'paths with spaces are passed as-is (no shell)');
  assert.equal(calls[0].options.detached, true);
});

test('PowerShell started for the app really runs, also after the app exited (Windows)', { skip: process.platform !== 'win32' }, async () => {
  const dir = tmp();
  try {
    const marker = path.join(dir, 'ran.txt');
    await runParent(`
      const { runPowerShellDetached } = require(${JSON.stringify(path.join(ROOT, 'src', 'desktop-host.js'))});
      runPowerShellDetached(${JSON.stringify(`Start-Sleep -Milliseconds 500; Set-Content -LiteralPath '${marker.replace(/'/g, "''")}' -Value 'ran'`)});
      process.exit(0);`);
    assert.ok(await waitFor(() => fs.existsSync(marker)), 'script ran after the parent exited');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no PowerShell is started detached directly any more (it would not run)', () => {
  for (const f of ['src/desktop-host.js', 'src/update.js', 'src/update-runner.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/spawn\(\s*'powershell\.exe'[^;]*?\)/gs)) {
      assert.doesNotMatch(m[0], /detached:\s*true/, `${f}: ${m[0].slice(0, 80)}`);
    }
  }
});
