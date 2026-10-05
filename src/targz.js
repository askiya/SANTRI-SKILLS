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
  const target = path.resolve(dest, entryPath);
  const root = path.resolve(dest);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Entry tar tidak aman: ${entryPath}`);
  return target;
}

function stripComponents(name, count) {
  const parts = name.split('/').filter(Boolean);
  return parts.slice(count).join('/');
}

function extractTarGz(buffer, dest, { strip = 0 } = {}) {
  const tar = zlib.gunzipSync(buffer);
  let offset = 0;
  let longName = null;
  let count = 0;

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
    const data = tar.subarray(offset, dataEnd);
    offset = dataEnd + ((BLOCK - (size % BLOCK)) % BLOCK);

    if (type === 'L') {
      longName = data.toString('utf8').replace(/\0.*$/, '');
      continue;
    }
    if (type === 'K' || type === 'x' || type === 'g') continue; // long link / pax metadata
    const rel = strip ? stripComponents(name, strip) : name;
    if (!rel) continue;

    if (type === '5' || name.endsWith('/')) {
      fs.mkdirSync(safeJoin(dest, rel), { recursive: true });
    } else if (type === '0' || type === '\0' || type === '' || type === '7') {
      const file = safeJoin(dest, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
      count++;
    }
    // symlinks (type 1/2) are skipped: skill repos are plain files
  }
  return count;
}

module.exports = { extractTarGz };
