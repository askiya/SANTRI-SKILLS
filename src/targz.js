'use strict';

// Minimal tar.gz extractor: stdlib gunzip + ustar header walk.
// Avoids a `tar` dependency and the MSYS/Windows `tar -C C:\...` "Cannot connect to C:" path bug.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BLOCK = 512;
const str = (buf, off, len) => buf.toString('utf8', off, off + len).replace(/\0.*$/, '').trim();
const octal = (buf, off, len) => parseInt(str(buf, off, len) || '0', 8) || 0;

// Reject absolute paths and `..` traversal from the archive.
function safeJoin(dest, entryPath) {
  if (entryPath.split(/[\\/]/).some(s => s === '..') || /^[\\/]/.test(entryPath) || /[:]/.test(entryPath)) throw new Error('Path arsip tidak aman');
  const target = path.resolve(dest, entryPath);
  const root = path.resolve(dest);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Entry tar tidak aman: ${entryPath}`);
  let current = target;
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink target ditolak');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  return target;
}

function stripComponents(name, count) {
  const parts = name.split('/').filter(Boolean);
  return parts.slice(count).join('/');
}

function extractTarGz(buffer, dest, { strip = 0, maxBytes = 200 * 1024 * 1024 } = {}) {
  const tar = zlib.gunzipSync(buffer, { maxOutputLength: maxBytes });
  let offset = 0;
  let longName = null;
  let count = 0;
  let totalWritten = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break; // end-of-archive
    let name = str(header, 0, 100);
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]) || '0';
    const prefix = str(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (longName) {
      name = longName;
      longName = null;
    }
    offset += BLOCK;
    const dataEnd = offset + size;
    if (dataEnd > tar.length) throw new Error("Arsip terpotong");
    const data = tar.subarray(offset, dataEnd);
    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    if (type === 'K' || type === 'x' || type === 'g') continue; // long link / pax metadata
    // Validate raw archive name before stripping components; otherwise `/root/evil`
    // could become `evil` and hide that the source path was absolute.
    if (name.split(/[\\/]/).some((s) => s === '..') || /^[\\/]/.test(name) || /:/.test(name)) throw new Error(`Entry tar tidak aman: ${name}`);
    const rel = strip ? stripComponents(name, strip) : name;
    if (!rel) continue;

    if (type === '5' || name.endsWith('/')) {
      fs.mkdirSync(safeJoin(dest, rel), { recursive: true });
    } else if (type === '0' || type === '\0' || type === '' || type === '7') {
      const file = safeJoin(dest, rel);
      totalWritten += data.length;
      if (totalWritten > maxBytes) throw new Error(`Arsip melebihi batas ${maxBytes} byte setelah ekstraksi`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      count++;
    } else if (type === '1' || type === '2') {
      throw new Error(`Symlink/hardlink ditolak dalam arsip: ${name}`);
    }
  }
  return count;
}

module.exports = { extractTarGz };
