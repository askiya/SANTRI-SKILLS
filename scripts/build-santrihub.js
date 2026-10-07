#!/usr/bin/env node
'use strict';
// Builds dist/SantriHub.exe — a Node.js Single Executable Application that
// carries the SantriHub app, so members need neither Node.js nor Git.
//
//   node scripts/build-santrihub.js
//
// Windows x64 only (the window is Microsoft Edge in app mode). The installer
// (dist/SantriHub-Setup.exe) is made from this exe by installer/santrihub.iss.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const TOOLS = path.join(DIST, '.tools');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const TOOL_VERSIONS = ['rcedit@4.0.1', 'postject@1.0.0-alpha.6'];

// Runtime payload: everything bin/cli.js reads at run time, nothing else.
const PAYLOAD = ['package.json', 'LICENSE', 'registry.json', 'bin', 'src', 'scripts/antigravity_control.py',
  'assets/santriverse-logo.webp', 'assets/santriverse-logo-light.webp', 'assets/antigravity.svg', 'assets/CREDITS.md'];
const SKIP = /(^|\/)(__pycache__|\.DS_Store)(\/|$)|\.pyc$/;

function listFiles(rel) {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return SKIP.test(rel) ? [] : [rel];
  return fs.readdirSync(abs).sort().flatMap(name => listFiles(`${rel}/${name}`));
}

/** { version, hash, files: { 'src/x.js': base64 } } — hash covers paths and contents. */
function makeBundle(version) {
  const files = {};
  const hash = crypto.createHash('sha256');
  for (const rel of PAYLOAD.flatMap(listFiles)) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    files[rel] = data.toString('base64');
    hash.update(rel).update('\0').update(data).update('\0');
  }
  return { version, hash: hash.digest('hex').slice(0, 12), files };
}

/** Mark a PE image as a Windows GUI program so launching it opens no console. */
function setGuiSubsystem(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Not a PE executable.');
  const optional = pe + 24;
  const magic = buf.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error('Unknown PE optional header.');
  buf.writeUInt16LE(2, optional + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI (same offset for PE32 and PE32+)
  return buf;
}

function tools() {
  const has = (name) => fs.existsSync(path.join(TOOLS, 'node_modules', name, 'package.json'));
  if (!has('rcedit') || !has('postject')) {
    fs.mkdirSync(TOOLS, { recursive: true });
    // npm's JS entry through node itself: no shell, so paths with spaces stay intact.
    const npmCli = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
      .find(p => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));
    if (!npmCli) throw new Error('npm-cli.js tidak ditemukan di instalasi Node.js.');
    execFileSync(process.execPath, [npmCli, 'install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--prefix', '.', ...TOOL_VERSIONS], { cwd: TOOLS, stdio: 'inherit' });
  }
  return {
    rcedit: require(path.join(TOOLS, 'node_modules', 'rcedit')),
    postject: require(path.join(TOOLS, 'node_modules', 'postject')),
  };
}

async function build() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('SantriHub.exe dibangun di Windows x64.');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;
  const winVersion = `${version.replace(/[^0-9.].*$/, '')}.0`.split('.').slice(0, 4).join('.');
  fs.mkdirSync(DIST, { recursive: true });

  const bundle = makeBundle(version);
  const bundleFile = path.join(DIST, 'app-bundle.json');
  fs.writeFileSync(bundleFile, JSON.stringify(bundle));
  const seaConfig = path.join(DIST, 'sea-config.json');
  const blob = path.join(DIST, 'sea-prep.blob');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: path.join(ROOT, 'scripts', 'santrihub-sea-main.js'),
    output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { 'app.json': bundleFile },
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const exe = path.join(DIST, 'SantriHub.exe');
  fs.copyFileSync(process.execPath, exe);
  const { rcedit, postject } = tools();
  await rcedit(exe, {
    icon: path.join(ROOT, 'assets', 'santrihub.ico'),
    'file-version': winVersion,
    'product-version': winVersion,
    'version-string': {
      ProductName: 'SantriHub',
      FileDescription: 'SantriHub — Santriverse Skills untuk Antigravity',
      CompanyName: 'Santriverse',
      LegalCopyright: `© ${new Date().getFullYear()} Santriverse`,
      OriginalFilename: 'SantriHub.exe',
      InternalName: 'SantriHub',
    },
  });
  await postject.inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: SEA_FUSE, overwrite: true });
  fs.writeFileSync(exe, setGuiSubsystem(fs.readFileSync(exe)));

  for (const temp of [bundleFile, seaConfig, blob]) fs.rmSync(temp, { force: true });
  const sha = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  console.log(`\nSantriHub.exe ${version} (bundle ${bundle.hash}) — ${(fs.statSync(exe).size / 1048576).toFixed(1)} MB`);
  console.log(`SHA-256 ${sha}`);
  return { exe, version, sha };
}

module.exports = { makeBundle, setGuiSubsystem, PAYLOAD };

if (require.main === module) build().catch((error) => { console.error(`\n✗ ${error.message}`); process.exitCode = 1; });
