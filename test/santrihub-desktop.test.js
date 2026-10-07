'use strict';
// SantriHub for Windows: app command, single-executable bootstrap, bundle,
// GUI subsystem patch, single-instance lock, installer and release workflow.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { normalizeArgs, ensureExtracted } = require('../scripts/santrihub-sea-main.js');
const { makeBundle, setGuiSubsystem } = require('../scripts/build-santrihub.js');
const desktop = require('../src/desktop-host.js');

test('CLI exposes the app command and documents it', () => {
  const cli = read('bin/cli.js');
  assert.match(cli, /command === 'app'\) return require\('\.\.\/src\/desktop-host'\)\.startDesktop/);
  assert.match(cli, /santriverse-skills app\s+Buka SantriHub/);
});

test('exe arguments: no args opens the app, dashboard MCP entries keep working after updates', () => {
  assert.deepEqual(normalizeArgs([]), ['app']);
  assert.deepEqual(normalizeArgs(['--version']), ['--version']);
  assert.deepEqual(normalizeArgs(['mcp-serve']), ['mcp-serve']);
  // install.js writes { command: process.execPath, args: [<root>/bin/cli.js, 'mcp-serve'] }
  assert.deepEqual(normalizeArgs(['C:\\Users\\x\\AppData\\Local\\SantriHub\\app-old\\bin\\cli.js', 'mcp-serve']), ['mcp-serve']);
  assert.deepEqual(normalizeArgs(['/opt/santrihub/bin/cli.js', 'list']), ['list']);
});

test('bundle carries exactly the runtime files and a content hash', () => {
  const bundle = makeBundle('9.9.9');
  const files = Object.keys(bundle.files);
  for (const need of ['package.json', 'registry.json', 'bin/cli.js', 'src/dashboard.js', 'src/dashboard.html', 'src/desktop-host.js', 'scripts/antigravity_control.py', 'assets/santriverse-logo.webp', 'assets/antigravity.svg']) {
    assert.ok(files.includes(need), `missing ${need}`);
  }
  for (const file of files) {
    assert.doesNotMatch(file, /^(test|extension|dist|installer|\.github)\//, file);
    assert.doesNotMatch(file, /banner\.png$|santrihub\.ico$|__pycache__|\.pyc$/, file);
  }
  assert.match(bundle.hash, /^[0-9a-f]{12}$/);
  assert.equal(makeBundle('9.9.9').hash, bundle.hash, 'hash is deterministic');
});

test('bootstrap extracts once, reuses the folder and drops older builds', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'santrihub-sea-'));
  try {
    fs.mkdirSync(path.join(base, 'app-0123456789ab'));
    const bundle = { version: '1.0.0', hash: 'aaaaaaaaaaaa', files: { 'bin/cli.js': Buffer.from('// cli').toString('base64'), 'src/x.txt': Buffer.from('x').toString('base64') } };
    const dir = ensureExtracted(bundle, base);
    assert.equal(dir, path.join(base, 'app-aaaaaaaaaaaa'));
    assert.equal(fs.readFileSync(path.join(dir, 'bin', 'cli.js'), 'utf8'), '// cli');
    assert.ok(!fs.existsSync(path.join(base, 'app-0123456789ab')), 'old build removed');
    fs.writeFileSync(path.join(dir, 'src', 'x.txt'), 'kept');
    assert.equal(ensureExtracted(bundle, base), dir);
    assert.equal(fs.readFileSync(path.join(dir, 'src', 'x.txt'), 'utf8'), 'kept', 'complete build is not rewritten');
    assert.throws(() => ensureExtracted({ version: '1', hash: 'bbbbbbbbbbbb', files: { '../evil.js': '' } }, base), /Invalid bundle path/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('GUI subsystem patch flips only the subsystem field of a PE image', () => {
  const original = fs.readFileSync(process.execPath);
  if (original.toString('latin1', 0, 2) !== 'MZ') return; // not a Windows host
  const pe = original.readUInt32LE(0x3c);
  assert.equal(original.readUInt16LE(pe + 24 + 68), 3, 'node.exe is a console program');
  const patched = setGuiSubsystem(Buffer.from(original));
  assert.equal(patched.readUInt16LE(pe + 24 + 68), 2);
  let diff = 0;
  for (let i = 0; i < original.length; i++) if (original[i] !== patched[i]) diff++;
  assert.equal(diff, 1);
  assert.throws(() => setGuiSubsystem(Buffer.alloc(256)), /PE/);
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

test('installer: per-user, Start Menu + optional Desktop shortcut, clean uninstall', () => {
  const iss = read('installer/santrihub.iss');
  assert.match(iss, /AppId=\{\{552379FB-5AEC-4663-8618-354F26FDF266\}/);
  assert.match(iss, /PrivilegesRequired=lowest/);
  assert.match(iss, /OutputBaseFilename=SantriHub-Setup/);
  assert.match(iss, /\{autoprograms\}\\SantriHub"; Filename: "\{app\}\\SantriHub\.exe"; Parameters: "app"/);
  assert.match(iss, /\{autodesktop\}\\SantriHub".*Tasks: desktopicon/);
  assert.match(iss, /UninstallDelete\]\s*\r?\n(;.*\r?\n)*Type: filesandordirs; Name: "\{localappdata\}\\SantriHub"/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'santrihub.ico')));
});

test('release workflow: tag must match version, assets keep a stable download name', () => {
  const yml = read('.github/workflows/release-santrihub.yml');
  assert.match(yml, /tags: \['v\*'\]/);
  assert.match(yml, /Tag .* != package\.json/);
  assert.match(yml, /gh release create \$tag dist\/SantriHub-Setup\.exe/);
  assert.match(yml, /releases\/latest\/download\/SantriHub-Setup\.exe/);
  assert.match(read('.gitignore'), /^dist\/$/m);
});
