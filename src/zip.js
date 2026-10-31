'use strict';
// A small ZIP reader for uploaded skill archives (no dependencies). Reads the central
// directory, then each file (stored or deflated). Bounded: entry count, per-file and total
// uncompressed size; unsafe paths, encrypted entries and ZIP64 are refused or skipped.
const zlib = require('node:zlib');

const MAX_ENTRIES = 10000;

function findEnd(buf) {
  // End of central directory: 22 bytes + comment (≤ 65535), scanned from the back.
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('Bukan file ZIP yang valid.');
}

const safePath = (name) => Boolean(name) && name.length <= 1024 && !/^\//.test(name) && !/[\x00-\x1f:]/.test(name)
  && !name.split('/').some((x) => !x || x === '.' || x === '..');

/**
 * Files of a ZIP buffer as Map<path, Buffer>. Folders are left out; `skipped` lists entries
 * that were not read (unsafe path, encrypted, too big) with the reason.
 */
function readZip(buf, { maxFile = 512 * 1024, maxTotal = 20 * 1024 * 1024, want = () => true } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Bukan file ZIP yang valid.');
  const end = findEnd(buf);
  const count = buf.readUInt16LE(end + 10);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('ZIP64 belum didukung. Kompres ulang dengan ZIP biasa.');
  if (count > MAX_ENTRIES) throw new Error(`ZIP berisi ${count} entri (maks ${MAX_ENTRIES}).`);
  const files = new Map(), skipped = [];
  let total = 0;
  for (let i = 0, p = cdOffset; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Struktur ZIP rusak.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    // Bit 11: UTF-8 names. Older Windows zips use the OEM code page; latin1 keeps them readable enough.
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    const name = (flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1')).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (!safePath(name)) { skipped.push(`${name} (path tidak aman)`); continue; }
    if (/(^|\/)__MACOSX\//.test(name) || /(^|\/)\.DS_Store$/.test(name)) continue;
    if (!want(name)) continue;
    if (flags & 1) { skipped.push(`${name} (terenkripsi)`); continue; }
    if (usize > maxFile) { skipped.push(`${name} (> ${Math.round(maxFile / 1024)} KB)`); continue; }
    if ((total += usize) > maxTotal) throw new Error(`Isi ZIP melebihi ${Math.round(maxTotal / 1024 / 1024)} MB.`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error('Struktur ZIP rusak.');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    let out;
    if (method === 0) out = Buffer.from(data);
    else if (method === 8) out = zlib.inflateRawSync(data, { maxOutputLength: maxFile + 1 });
    else { skipped.push(`${name} (metode kompresi ${method} tidak didukung)`); continue; }
    if (out.length !== usize) throw new Error(`${name}: ukuran isi ZIP tidak cocok.`);
    files.set(name, out);
  }
  return { files, skipped };
}

module.exports = { readZip, MAX_ENTRIES };
