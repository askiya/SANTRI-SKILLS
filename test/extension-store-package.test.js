'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { buildExtension, referencedFiles, EXCLUDE } = require('../scripts/build-extension.js');
const { SHOTS } = require('../scripts/build-store-assets.js');

const ext = path.join(__dirname, '../extension');

/** Reads every entry back through the central directory, inflating and checking CRC. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(zlib.crc32(data), crc, `CRC ${name}`);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const built = (() => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-ext-'));
  const result = buildExtension({ outDir });
  return { ...result, files: unzip(fs.readFileSync(result.out)), outDir };
})();
process.on('exit', () => fs.rmSync(built.outDir, { recursive: true, force: true }));

test('store ZIP has manifest.json at its root without the unpacked key', () => {
  const manifest = JSON.parse(built.files.get('manifest.json'));
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'))).version);
  assert.match(path.basename(built.out), new RegExp(`^santri-skills-extension-${manifest.version.replace(/\./g, '\\.')}\\.zip$`));
});

test('the local manifest keeps its key so the unpacked ID stays stable', () => {
  assert.ok(JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'))).key);
});

test('store ZIP ships every referenced runtime file byte-for-byte', () => {
  const manifest = JSON.parse(built.files.get('manifest.json'));
  const html = built.files.get(manifest.side_panel.default_path).toString('utf8');
  for (const file of referencedFiles(manifest, html)) {
    assert.ok(built.files.has(file), `missing ${file}`);
    if (file !== 'manifest.json') assert.deepEqual(built.files.get(file), fs.readFileSync(path.join(ext, file)), file);
  }
});

test('store ZIP leaves out docs, listing assets and tests', () => {
  for (const name of built.files.keys()) assert.doesNotMatch(name, EXCLUDE, name);
  assert.equal(built.files.has('README.md'), false);
  assert.equal([...built.files.keys()].some((n) => n.startsWith('store/')), false);
});

test('store package asks only for the permissions the listing justifies', () => {
  const manifest = JSON.parse(built.files.get('manifest.json'));
  assert.deepEqual([...manifest.permissions].sort(), ['identity', 'sidePanel', 'storage']);
  assert.deepEqual([...manifest.host_permissions].sort(), [
    'https://api.santriverse.my.id/*',
    'https://chatgpt.com/*',
    'https://gemini.google.com/*',
    'https://santriverse.my.id/*',
  ]);
});

test('store package loads no remote code', () => {
  for (const [name, data] of built.files) {
    if (!/\.(js|html)$/.test(name)) continue;
    const text = data.toString('utf8');
    assert.doesNotMatch(text, /<script[^>]+src="https?:/i, name);
    assert.doesNotMatch(text, /\beval\s*\(|new Function\s*\(|importScripts\s*\(\s*['"]https?:/, name);
  }
});

test('listing documents every permission and links the live privacy policy', () => {
  const listing = fs.readFileSync(path.join(ext, 'store/LISTING.md'), 'utf8');
  const manifest = JSON.parse(built.files.get('manifest.json'));
  for (const perm of [...manifest.permissions, ...manifest.host_permissions]) assert.ok(listing.includes(`\`${perm}\``), perm);
  assert.ok(listing.includes('https://santriverse.my.id/docs/santri-skills-privacy'));
  for (const shot of SHOTS) assert.ok(fs.existsSync(path.join(ext, 'store', shot.file)), shot.file);
  assert.ok(fs.existsSync(path.join(ext, 'store/promo-small-440x280.png')));
});
