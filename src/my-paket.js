'use strict';
// Paket the member makes for their own skills and MCP (~/.santrihub/paket.json), next to
// the catalog paket (Apps Script, Monorepo, …). Own skills/MCP can be tagged with any paket.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { slug } = require('./library');

const COLORS = ['teal', 'purple', 'coral', 'blue', 'amber', 'pink', 'green', 'gray'];
const MAX = 30;
const myPaketFile = (home = os.homedir()) => path.join(home, '.santrihub', 'paket.json');
const clean = (v, max) => String(v || '').replace(/[\x00-\x1f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function readMyPaket(file) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  return (Array.isArray(cfg && cfg.paket) ? cfg.paket : []).filter((p) => p && /^my-[a-z0-9-]{1,40}$/.test(p.id) && clean(p.short, 40))
    .map((p) => ({ id: p.id, short: clean(p.short, 40), label: clean(p.short, 40), description: clean(p.description, 200), color: COLORS.includes(p.color) ? p.color : 'blue', icon: '◇' }));
}
function writeMyPaket(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ version: 1, paket: list.map(({ id, short, description, color }) => ({ id, short, description, color })) }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}
/** Adds a paket named `short`; returns it. Ids are "my-<slug>", so they never meet catalog ids. */
function addMyPaket(file, { short, description, color }) {
  const name = clean(short, 40);
  if (name.length < 2) throw new Error('Nama paket minimal 2 huruf.');
  const list = readMyPaket(file);
  if (list.length >= MAX) throw new Error(`Maksimal ${MAX} paket sendiri.`);
  if (list.some((p) => p.short.toLowerCase() === name.toLowerCase())) throw new Error(`Paket "${name}" sudah ada.`);
  let id = `my-${slug(name).slice(0, 36)}`;
  for (let n = 2; list.some((p) => p.id === id); n++) id = `my-${slug(name).slice(0, 33)}-${n}`;
  const p = { id, short: name, description: clean(description, 200), color: COLORS.includes(color) ? color : 'blue' };
  writeMyPaket(file, [...list, p]);
  return readMyPaket(file).find((x) => x.id === id);
}
function removeMyPaket(file, id) {
  const list = readMyPaket(file);
  if (!list.some((p) => p.id === id)) return false;
  writeMyPaket(file, list.filter((p) => p.id !== id));
  return true;
}
/** Paket ids from untrusted input, limited to `known`, unique, without the implicit "mine". */
function paketIds(input, known) {
  if (input == null) return [];
  if (!Array.isArray(input) || input.length > 10 || input.some((x) => typeof x !== 'string')) throw new Error('Daftar paket tidak valid.');
  const unknown = input.filter((x) => x !== 'mine' && !known.has(x));
  if (unknown.length) throw new Error(`Paket tidak dikenal: ${unknown.join(', ')}`);
  return [...new Set(input.filter((x) => x !== 'mine'))];
}

module.exports = { myPaketFile, readMyPaket, addMyPaket, removeMyPaket, paketIds, COLORS };
