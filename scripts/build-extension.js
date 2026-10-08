#!/usr/bin/env node
'use strict';
// Packages extension/ for the Chrome Web Store:
//
//   node scripts/build-extension.js   →  dist/santri-skills-extension-<version>.zip
//
// - manifest.json at the ZIP root, without "key" (the Web Store rejects it and
//   assigns its own extension ID; the local unpacked build keeps the key).
// - Only runtime files: no README, store/ listing assets, or tests.
// - Every file the manifest and side panel reference must exist.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');
const EXCLUDE = /^(README\.md|store\/|\.preview\/)|(^|\/)\.DS_Store$|\.test\.js$/;

function listFiles(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((d) => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}

/** Files the extension needs at run time, read from manifest.json and sidepanel.html. */
function referencedFiles(manifest, sidepanelHtml) {
  const refs = new Set(['manifest.json', manifest.side_panel?.default_path, manifest.background?.service_worker]);
  for (const icon of Object.values(manifest.icons || {})) refs.add(icon);
  for (const icon of Object.values(manifest.action?.default_icon || {})) refs.add(icon);
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) refs.add(js);
  for (const m of sidepanelHtml.matchAll(/(?:src|href)="([^"#:]+)"/g)) refs.add(m[1]);
  refs.delete(undefined);
  return [...refs];
}

// Deflated ZIP writer (Node only; the extension's own writer is stored-only).
function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

function buildExtension({ outDir = DIST } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const storeManifest = { ...manifest };
  delete storeManifest.key;
  if (!/^\d+(\.\d+){0,3}$/.test(storeManifest.version)) throw new Error(`Versi manifest tidak valid untuk Web Store: ${storeManifest.version}`);

  const html = fs.readFileSync(path.join(EXT, manifest.side_panel.default_path), 'utf8');
  const missing = referencedFiles(manifest, html).filter((f) => !fs.existsSync(path.join(EXT, f)));
  if (missing.length) throw new Error(`File yang dirujuk tidak ada: ${missing.join(', ')}`);

  const files = listFiles(EXT).filter((f) => !EXCLUDE.test(f));
  const entries = files.map((name) => ({
    name,
    data: name === 'manifest.json' ? Buffer.from(`${JSON.stringify(storeManifest, null, 2)}\n`) : fs.readFileSync(path.join(EXT, name)),
  }));
  const zip = writeZip(entries);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `santri-skills-extension-${storeManifest.version}.zip`);
  fs.writeFileSync(out, zip);
  return { out, files, manifest: storeManifest, sha256: crypto.createHash('sha256').update(zip).digest('hex'), size: zip.length };
}

module.exports = { buildExtension, referencedFiles, EXCLUDE };

if (require.main === module) {
  try {
    const r = buildExtension();
    console.log(`${path.relative(ROOT, r.out)} — ${r.files.length} file, ${(r.size / 1024).toFixed(1)} KB`);
    console.log(`Versi ${r.manifest.version} · izin: ${r.manifest.permissions.join(', ')} · host: ${r.manifest.host_permissions.join(', ')}`);
    console.log(`SHA-256 ${r.sha256}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
