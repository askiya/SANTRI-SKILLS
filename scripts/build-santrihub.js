#!/usr/bin/env node
'use strict';
// Stages dist/SantriHub/ for the Windows installer (installer/santrihub.iss):
//
//   runtime/win-x64/node.exe     official Node.js, byte-for-byte as published, so its
//   runtime/win-arm64/node.exe   Authenticode signature (OpenJS Foundation) stays valid
//   app/                         the SantriHub app + santrihub-install.json marker
//   santrihub.ico
//
//   node scripts/build-santrihub.js
//
// Nothing is compiled or patched. Smart App Control and SmartScreen see a signed
// node.exe; the app itself is JavaScript that node.exe reads. (SantriHub.exe up to
// 0.2.5 was a patched node.exe, which dropped the signature and got blocked.)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'SantriHub');
const CACHE = path.join(DIST, '.cache');

// Pinned: a new Node.js release only ships after its hashes are updated here
// (from https://nodejs.org/dist/v<version>/SHASUMS256.txt).
const NODE_RUNTIME = {
  version: '24.22.2',
  sha256: {
    'win-x64': '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9',
    'win-arm64': 'e2d6e75a0bfe4c176316d7c732eb8def9d94570c759eaeab335473a015abb7ea',
  },
};

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

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Copies the payload to `dest` (replacing it) and writes the install marker. */
function stageApp(dest, version) {
  fs.rmSync(dest, { recursive: true, force: true });
  const files = PAYLOAD.flatMap(listFiles);
  for (const rel of files) {
    const target = path.join(dest, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), target);
  }
  // Marks an installed app: self-update, console-less relaunch (src/desktop-host.js).
  fs.writeFileSync(path.join(dest, 'santrihub-install.json'), JSON.stringify({ app: 'SantriHub', version, node: NODE_RUNTIME.version }, null, 2) + '\n');
  return files;
}

/** Path of the verified official node.exe for `arch` (downloaded once into the cache). */
async function fetchRuntime(arch, { cache = CACHE, fetchImpl = globalThis.fetch, runtime = NODE_RUNTIME } = {}) {
  const expected = runtime.sha256[arch];
  if (!expected) throw new Error(`Tidak ada hash Node.js untuk ${arch}.`);
  const file = path.join(cache, `node-v${runtime.version}-${arch}.exe`);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === expected) return file;
  const url = `https://nodejs.org/dist/v${runtime.version}/${arch}/node.exe`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (!res.ok) throw new Error(`Gagal mengunduh ${url} (HTTP ${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  const actual = sha256(data);
  if (actual !== expected) throw new Error(`SHA-256 ${url} tidak cocok: ${actual}`);
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

async function build() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = stageApp(path.join(STAGE, 'app'), version);
  for (const arch of Object.keys(NODE_RUNTIME.sha256)) {
    const target = path.join(STAGE, 'runtime', arch, 'node.exe');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(await fetchRuntime(arch), target);
  }
  fs.copyFileSync(path.join(ROOT, 'assets', 'santrihub.ico'), path.join(STAGE, 'santrihub.ico'));
  console.log(`dist/SantriHub ${version}: ${files.length} file aplikasi + Node.js ${NODE_RUNTIME.version} (${Object.keys(NODE_RUNTIME.sha256).join(', ')})`);
  return { stage: STAGE, version };
}

module.exports = { PAYLOAD, NODE_RUNTIME, listFiles, stageApp, fetchRuntime };

if (require.main === module) build().catch((error) => { console.error(`\n✗ ${error.message}`); process.exitCode = 1; });
