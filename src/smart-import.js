'use strict';
// Smart import: whatever the member drops in (several ZIPs, a folder, loose .md / SKILL.md
// files, MCP JSON configs, a pasted MCP command) becomes a reviewable list of skills and
// MCP servers. Each ZIP and each top folder is one source; a source with SKILL.md folders
// gives those skills, one without gets a SKILL.md generated from its Markdown.
const path = require('node:path');
const { readZip } = require('./zip');
const { scanFiles } = require('./library');
const { parseMcpText, looksLikeMcpConfig } = require('./mcp-library');

const MAX_ITEMS = 500;
const MAX_UPLOAD_SKILLS = 150; // per source; the member picks which to keep
const MAX_FILE = 512 * 1024;
const MAX_ZIP = 25 * 1024 * 1024;
const MAX_TOTAL = 40 * 1024 * 1024;

const safeRel = (p) => typeof p === 'string' && p.length <= 1024 && !/[\x00-\x1f:]/.test(p) && !p.startsWith('/')
  && p.split('/').every((x) => x && x !== '.' && x !== '..');
const isJunk = (rel) => /(^|\/)(__MACOSX|\.git|node_modules)\//.test(rel) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(rel);
const baseName = (file) => path.posix.basename(file).replace(/\.[^.]+$/, '');

/** Drops one folder that wraps everything (`skill-x/…` in skill-x.zip): returns [files, folder]. */
function unwrap(files) {
  const tops = new Set([...files.keys()].map((rel) => rel.split('/')[0]));
  const [top] = tops;
  if (tops.size !== 1 || ![...files.keys()].every((rel) => rel.startsWith(top + '/'))) return [files, null];
  return [new Map([...files].map(([rel, data]) => [rel.slice(top.length + 1), data])), top];
}

/**
 * Uploaded items ([{ path, data: Buffer }], path relative with "/") as sources:
 * [{ label, name, files: Map, skipped }]. A ZIP is a source; files under one top folder are a
 * source; loose files are one source each, or together when one of them is SKILL.md.
 */
function groupUploads(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Pilih file, folder, atau ZIP dulu.');
  if (items.length > MAX_ITEMS) throw new Error(`Maksimal ${MAX_ITEMS} file sekaligus.`);
  let total = 0;
  const sources = [], folders = new Map(), loose = [], looseSkipped = [];
  const folder = (top) => folders.get(top) || folders.set(top, { files: new Map(), skipped: [] }).get(top);
  for (const item of items) {
    const rel = String(item.path || '').replace(/\\/g, '/');
    if (!safeRel(rel)) throw new Error(`Nama file tidak aman: ${rel}`);
    if (isJunk(rel)) continue;
    if ((total += item.data.length) > MAX_TOTAL) throw new Error(`Total upload melebihi ${MAX_TOTAL / 1024 / 1024} MB.`);
    if (/\.zip$/i.test(rel)) {
      if (item.data.length > MAX_ZIP) throw new Error(`${rel} melebihi ${MAX_ZIP / 1024 / 1024} MB.`);
      let zip;
      try { zip = readZip(item.data, { maxFile: MAX_FILE, want: (r) => !isJunk(r) }); } catch (e) { sources.push({ label: rel, name: baseName(rel), files: new Map(), skipped: [], error: e.message }); continue; }
      const [files, top] = unwrap(zip.files);
      sources.push({ label: path.posix.basename(rel), name: top || baseName(rel), files, skipped: zip.skipped });
      continue;
    }
    if (item.data.length > MAX_FILE) { (rel.includes('/') ? folder(rel.split('/')[0]).skipped : looseSkipped).push(`${rel} (> 512 KB)`); continue; }
    if (rel.includes('/')) { const top = rel.split('/')[0]; folder(top).files.set(rel.slice(top.length + 1), item.data); }
    else loose.push({ rel, data: item.data });
  }
  for (const [top, f] of folders) sources.push({ label: `${top}/`, name: top, files: f.files, skipped: f.skipped });
  if (loose.some((x) => x.rel === 'SKILL.md')) {
    sources.push({ label: 'file terpilih', name: 'skill', files: new Map(loose.map((x) => [x.rel, x.data])), skipped: looseSkipped });
  } else {
    for (const x of loose) sources.push({ label: x.rel, name: baseName(x.rel), files: new Map([[x.rel, x.data]]), skipped: [] });
    if (looseSkipped.length) sources.push({ label: 'file terpilih', name: 'skill', files: new Map(), skipped: looseSkipped, error: 'File terlalu besar.' });
  }
  return sources;
}

/**
 * Skills and MCP servers in uploaded items and/or pasted MCP text.
 * { skills: [{ key, source, ...scanFiles skill }], mcp: [{ key, name, entry, from }], problems: [{ source, error }] }
 */
function scanUploads(items = [], { mcpText = '', includeScripts = false } = {}) {
  const out = { skills: [], mcp: [], problems: [] };
  const sources = items.length ? groupUploads(items) : [];
  sources.forEach((src, i) => {
    if (src.error) { out.problems.push({ source: src.label, error: src.error }); return; }
    // MCP configs travel in uploads too (mcp.json, .mcp.json, mcp_config.json …).
    const mcpFiles = [...src.files].filter(([rel, data]) => /\.json$/i.test(rel) && data.length < 256 * 1024 && looksLikeMcpConfig(data.toString('utf8')));
    for (const [rel, data] of mcpFiles) {
      try { for (const m of parseMcpText(data.toString('utf8'), `${src.label === rel ? rel : `${src.label} › ${rel}`}`)) out.mcp.push({ key: `m${out.mcp.length}`, ...m }); }
      catch (e) { out.problems.push({ source: `${src.label} › ${rel}`, error: e.message }); }
    }
    const rest = new Map([...src.files].filter(([rel]) => !mcpFiles.some(([m]) => m === rel)));
    if (!rest.size) { if (!mcpFiles.length) out.problems.push({ source: src.label, error: 'Tidak ada file yang bisa dipakai.' }); return; }
    try {
      for (const s of scanFiles(rest, { name: src.name, label: src.label, origin: `upload ${src.label}`, includeScripts, maxSkills: MAX_UPLOAD_SKILLS, tooMany: ' Ekstrak dulu, lalu tarik hanya folder skill yang Anda mau.' })) {
        out.skills.push({ ...s, key: `${i}:${s.key}`, source: src.label, skipped: [...src.skipped, ...s.skipped] });
      }
    } catch (e) {
      if (!mcpFiles.length) out.problems.push({ source: src.label, error: e.message });
    }
  });
  if (String(mcpText).trim()) {
    try { for (const m of parseMcpText(mcpText, 'teks yang ditempel')) out.mcp.push({ key: `m${out.mcp.length}`, ...m }); }
    catch (e) { out.problems.push({ source: 'MCP yang ditempel', error: e.message }); }
  }
  // Same id twice (two zips of one skill): later ones get -2, -3 … so all can be saved.
  const ids = new Set();
  for (const s of out.skills) { let id = s.id; for (let n = 2; ids.has(id); n++) id = `${s.id.slice(0, 60)}-${n}`; ids.add(id); s.id = id; }
  const names = new Set();
  for (const m of out.mcp) { let name = m.name; for (let n = 2; names.has(name); n++) name = `${m.name.slice(0, 36)}-${n}`; names.add(name); m.name = name; }
  return out;
}

module.exports = { groupUploads, scanUploads, unwrap, MAX_TOTAL, MAX_ITEMS };
