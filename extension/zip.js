// extension/zip.js – Read a verified Skill package ZIP in memory and shape it
// the way Gemini's Skills upload expects (SKILL.md in the root folder,
// kebab-case name, no junk/binary leftovers). No third-party dependency:
// deflate is handled by the browser's DecompressionStream.
'use strict';

const ZIP_MAX_FILES = 500;
const ZIP_MAX_TOTAL = 100 * 1024 * 1024; // Gemini Skills upload limit
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JUNK_RE = /(^|\/)(__MACOSX|__pycache__|\.git)(\/|$)|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.pyc$/i;

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entries of a ZIP archive: [{ path, bytes }] (directories omitted). */
async function readZip(buffer) {
  const data = new Uint8Array(buffer);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End of central directory: scan back over a possible archive comment.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Paket bukan ZIP yang valid.');
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  if (count > ZIP_MAX_FILES) throw new Error('Paket berisi terlalu banyak file.');

  const decoder = new TextDecoder();
  const entries = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Struktur ZIP rusak.');
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const compressed = view.getUint32(ptr + 20, true);
    const size = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const local = view.getUint32(ptr + 42, true);
    const path = decoder.decode(data.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith('/')) continue;
    if (flags & 0x1) throw new Error('Paket terenkripsi tidak didukung.');
    total += size;
    if (total > ZIP_MAX_TOTAL) throw new Error('Paket melebihi batas 100 MB Gemini.');

    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Struktur ZIP rusak.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + compressed);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) bytes = await inflateRaw(raw);
    else throw new Error('Metode kompresi ZIP tidak didukung.');
    if (bytes.length !== size) throw new Error('Isi ZIP tidak utuh.');
    entries.push({ path, bytes });
  }
  return entries;
}

function cleanPath(path) {
  const parts = String(path).replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  if (parts[0] === '' || parts.some(p => p === '..' || p === '.')) throw new Error(`Path tidak aman di paket: ${path}`);
  return parts.join('/');
}

function skillNameOf(markdown) {
  // \s also matches a leading byte-order mark.
  const front = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const line = front && /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(front[1]);
  return line ? line[1].trim() : '';
}

/**
 * Shape ZIP entries into one Skill folder: { name, files: [{ path, bytes }] }
 * where paths are relative to the skill root and SKILL.md sits at the top.
 * A single wrapping folder (my-skill/SKILL.md) is unwrapped automatically.
 */
function prepareSkillPackage(entries) {
  let files = entries
    .map(e => ({ path: cleanPath(e.path), bytes: e.bytes }))
    .filter(e => !JUNK_RE.test(e.path));

  if (!files.some(f => f.path === 'SKILL.md')) {
    const tops = new Set(files.map(f => f.path.split('/')[0]));
    const [top] = tops;
    if (tops.size === 1 && files.some(f => f.path === `${top}/SKILL.md`)) {
      files = files.map(f => ({ path: f.path.slice(top.length + 1), bytes: f.bytes }));
    }
  }

  const skill = files.find(f => f.path === 'SKILL.md');
  if (!skill) throw new Error('SKILL.md tidak ditemukan di folder utama paket.');
  const name = skillNameOf(new TextDecoder().decode(skill.bytes));
  if (!SKILL_NAME_RE.test(name)) throw new Error('Nama skill di SKILL.md harus kebab-case (contoh: nama-skill).');
  return { name, files };
}

if (typeof module !== 'undefined') {
  module.exports = { readZip, prepareSkillPackage, skillNameOf, cleanPath, SKILL_NAME_RE };
}
