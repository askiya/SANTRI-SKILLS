'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { mcpKind } = require('./runtime-status');

const MARKER = '.santri-skills.json';

// Official Antigravity locations (antigravity.google/docs/skills, /docs/mcp).
function skillTargets(scope, cwd = process.cwd(), home = os.homedir()) {
  if (scope === 'project') return [path.join(cwd, '.agents', 'skills')];
  return [path.join(home, '.gemini', 'config', 'skills')];
}

function mcpConfigPath(scope, cwd = process.cwd(), home = os.homedir()) {
  return scope === 'project'
    ? path.join(cwd, '.agents', 'mcp_config.json')
    : path.join(home, '.gemini', 'config', 'mcp_config.json');
}

// Atomic per skill: stage a full copy beside the target, then swap. A failed copy
// (or a source without SKILL.md) never destroys the SKILL.md already installed.
function installSkills(skills, targets, { force = false } = {}) {
  const result = { installed: [], skipped: [] };
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    for (const skill of skills) {
      const dest = path.join(target, skill.id);
      const ours = fs.existsSync(path.join(dest, MARKER));
      if (fs.existsSync(dest) && !ours && !force) {
        result.skipped.push({ id: skill.id, dest, reason: 'folder sudah ada (bukan milik santri-skills), pakai --force' });
        continue;
      }
      if (!fs.existsSync(path.join(skill.dir, 'SKILL.md'))) throw new Error(`Sumber ${skill.id} tidak punya SKILL.md; instalasi dibatalkan, target tidak diubah.`);
      const staged = `${dest}.santri-staged`, backup = `${dest}.santri-bak`;
      fs.rmSync(staged, { recursive: true, force: true });
      fs.rmSync(backup, { recursive: true, force: true });
      try {
        fs.cpSync(skill.dir, staged, { recursive: true });
        fs.writeFileSync(path.join(staged, MARKER), JSON.stringify({ source: skill.source, installedAt: new Date().toISOString() }, null, 2));
        if (fs.existsSync(dest)) fs.renameSync(dest, backup);
        fs.renameSync(staged, dest);
        fs.rmSync(backup, { recursive: true, force: true });
      } catch (e) {
        if (!fs.existsSync(dest) && fs.existsSync(backup)) fs.renameSync(backup, dest);
        fs.rmSync(staged, { recursive: true, force: true });
        throw e;
      }
      result.installed.push({ id: skill.id, dest });
    }
  }
  return result;
}

function uninstallSkills(targets) {
  const removed = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    for (const d of fs.readdirSync(target, { withFileTypes: true })) {
      const dir = path.join(target, d.name);
      if (d.isDirectory() && fs.existsSync(path.join(dir, MARKER))) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
      }
    }
  }
  return removed;
}

const SERVER_NAME = 'santri-skills';
const SERVER_ENTRY = { command: 'npx', args: ['-y', 'santriverse-skills', 'mcp-serve'] };
const SHADCN_ENTRY = { command: 'npx', args: ['shadcn@latest', 'mcp'] };
const mcpMarkerFile = file => file + '.santrihub.json';
function websiteOwned(file,name,entry){
  if(name!=='shadcn'||!isDeepStrictEqual(entry,SHADCN_ENTRY))return false;
  try{const marker=JSON.parse(fs.readFileSync(mcpMarkerFile(file),'utf8'));return marker?.servers?.shadcn==='react-bits'}catch{return false}
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} bukan JSON valid. Perbaiki manual dulu, file tidak diubah.`);
  }
}

// Merge one server into mcp_config.json, keep everything else, back up the original once per run.
// Unknown entries under the same name are never replaced: collisions are rejected.
// santri-skills may be refreshed only when the existing entry is recognisably ours (npx package or local cli.js mcp-serve).
const { isDeepStrictEqual } = require('node:util');
const localEntry = { command: process.execPath, args: [path.resolve(__dirname, '../bin/cli.js'), 'mcp-serve'] };
const isOurs = (e) => isDeepStrictEqual(e, SERVER_ENTRY) || isDeepStrictEqual(e, localEntry);
function addMcpServer(file, entry = SERVER_ENTRY, name = SERVER_NAME, { preset = null } = {}) {
  if (preset) {
    if (preset !== 'react-bits' || name !== 'shadcn' || !isDeepStrictEqual(entry, SHADCN_ENTRY)) throw new Error('Preset invalid.');
    for (const target of [file, file + '.bak', mcpMarkerFile(file)]) {
      assertSafePath(target, path.dirname(file));
      if (fs.existsSync(target) && fs.lstatSync(target).nlink !== 1) throw new Error('Hardlink config/backup/marker ditolak.');
    }
    if (fs.existsSync(file+'.bak')) throw new Error('Backup mcp_config.json.bak sudah ada; pindahkan manual sebelum memasang. File tidak diubah.');
  }
  const config = readJson(file);
  // Shape check BEFORE any backup/write: a non-object root or non-object mcpServers
  // would otherwise be silently replaced and the user's data lost.
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} bukan object JSON (root harus object). File tidak diubah.`);
  if (Object.hasOwn(config, 'mcpServers') && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) throw new Error(`${file}: mcpServers harus object. File tidak diubah.`);
  const existing = config.mcpServers && config.mcpServers[name];
  const same = JSON.stringify(existing) === JSON.stringify(entry);
  // Website presets never adopt an entry we did not install, even an identical one.
  if (preset && existing && !websiteOwned(file, name, existing)) throw new Error(`MCP '${name}' sudah ada di ${file}. Hapus manual dulu, file tidak diubah.`);
  if (!preset && existing && !same && !(name === SERVER_NAME && isOurs(existing))) {
    throw new Error(`MCP '${name}' sudah ada di ${file} dengan konfigurasi lain. Hapus manual dulu, file tidak diubah.`);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  config.mcpServers = { ...(config.mcpServers || {}), [name]: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
  if (preset) {
    const marker = mcpMarkerFile(file);
    let meta = {}; try { meta = JSON.parse(fs.readFileSync(marker, 'utf8')) || {} } catch { meta = {} }
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) meta = {};
    atomicJson(marker, { ...meta, servers: { ...(meta.servers || {}), [name]: preset }, updatedAt: new Date().toISOString() });
  }
  return config;
}

function atomicJson(file, value) {
  const temp=`${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try { fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file); }
  finally { fs.rmSync(temp,{force:true}); }
}
function ownedMarker(dir){const marker=path.join(dir,MARKER);if(!fs.existsSync(marker)||fs.lstatSync(marker).isSymbolicLink())return false;try{const meta=JSON.parse(fs.readFileSync(marker,'utf8'));return Boolean(meta&&typeof meta==='object'&&!Array.isArray(meta)&&typeof meta.source==='string'&&meta.source&&typeof meta.installedAt==='string'&&!Number.isNaN(Date.parse(meta.installedAt)))}catch{return false}}
function removeInstalled({kind,id,skillsDir,mcpFile}) {
  if(typeof id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id))throw new Error('ID invalid.');
  if(kind==='skill'){
    const dir=path.join(skillsDir,id);assertSafePath(dir,skillsDir);
    if(!fs.existsSync(dir))return {removed:false};
    if(!ownedMarker(dir))throw new Error('Skill bukan milik SantriHub atau marker invalid; tidak dihapus.');
    const quarantine=`${dir}.santri-remove-${crypto.randomBytes(4).toString('hex')}`;fs.renameSync(dir,quarantine);
    try{fs.rmSync(quarantine,{recursive:true})}catch(e){if(!fs.existsSync(dir)&&fs.existsSync(quarantine))fs.renameSync(quarantine,dir);throw e}
    return {removed:true,kind,id};
  }
  if(kind==='mcp'){
    if(!fs.existsSync(mcpFile))return {removed:false};
    assertSafePath(mcpFile,path.dirname(mcpFile));const backup=mcpFile+'.bak';assertSafePath(backup,path.dirname(mcpFile));
    if(fs.lstatSync(mcpFile).nlink!==1||fs.existsSync(backup)&&fs.lstatSync(backup).nlink!==1)throw new Error('Hardlink config/backup ditolak.');
    const cfg=readJson(mcpFile),entry=cfg.mcpServers&&cfg.mcpServers[id];
    if(!entry)return {removed:false};
    if(!(id===SERVER_NAME&&isOurs(entry))&&!websiteOwned(mcpFile,id,entry))throw new Error('MCP bukan milik SantriHub atau konfigurasi tidak dikenal; tidak dihapus.');
    if(id==='shadcn'){const marker=mcpMarkerFile(mcpFile);assertSafePath(marker,path.dirname(mcpFile));if(fs.lstatSync(marker).nlink!==1)throw new Error('Hardlink marker ditolak.');}
    // Preserve install backup; use collision-resistant backup for preset uninstall.
    const saved=id==='shadcn'&&fs.existsSync(backup)?`${backup}-${crypto.randomBytes(8).toString('hex')}`:backup;
    fs.copyFileSync(mcpFile,saved,id==='shadcn'?fs.constants.COPYFILE_EXCL:0);delete cfg.mcpServers[id];atomicJson(mcpFile,cfg);
    if(id==='shadcn'){const marker=mcpMarkerFile(mcpFile),meta=JSON.parse(fs.readFileSync(marker,'utf8'));delete meta.servers[id];atomicJson(marker,meta);}
    return {removed:true,kind,id,backup:saved};
  }
  throw new Error('Jenis uninstall invalid.');
}
function assertSafePath(value,root){const resolved=path.resolve(value),base=path.resolve(root);if(resolved===base||!resolved.startsWith(base+path.sep))throw new Error('Path uninstall keluar target.');for(let cur=resolved;;cur=path.dirname(cur)){if(fs.existsSync(cur)&&fs.lstatSync(cur).isSymbolicLink())throw new Error('Symlink/junction ditolak.');if(path.dirname(cur)===cur)break;}}
function removeMcpServer(file) { return removeInstalled({kind:'mcp',id:SERVER_NAME,mcpFile:file,skillsDir:path.dirname(file)}).removed; }

// Read-only inspection. "configured" means valid files on disk only; it never
// claims an MCP runtime handshake or process connection.
function installedSkills(targets) {
  const out = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    for (const d of fs.readdirSync(target, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(target, d.name);
      const skillFile = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) continue;
      const marker = path.join(dir, MARKER);
      let managed = false, markerValid = false, source = null, installedAt = null;
      if (fs.existsSync(marker)) {
        managed = true;
        try {
          const meta = JSON.parse(fs.readFileSync(marker, 'utf8'));
          markerValid = Boolean(meta && typeof meta === 'object' && !Array.isArray(meta) && typeof meta.source === 'string' && meta.source && typeof meta.installedAt === 'string' && !Number.isNaN(Date.parse(meta.installedAt)));
          source = typeof meta.source === 'string' ? meta.source : null;
          installedAt = typeof meta.installedAt === 'string' && !Number.isNaN(Date.parse(meta.installedAt)) ? meta.installedAt : null;
        } catch { /* malformed marker stays visible, never makes a missing SKILL.md installed */ }
      }
      out.push({ id: d.name, dir, source, installedAt, managed, markerValid });
    }
  }
  return out;
}

function configStatus(scope, cwd = process.cwd(), home = os.homedir(), override = {}) {
  if (!['project', 'global'].includes(scope)) throw new Error('Scope invalid');
  const targets = override.skillTargets || skillTargets(scope, cwd, home);
  const skills = installedSkills(targets);
  const configFile = Object.hasOwn(override, 'mcpFile') ? override.mcpFile : mcpConfigPath(scope, cwd, home);
  let servers = [], configValid = true;
  if (fs.existsSync(configFile)) {
    try {
      const cfg = readJson(configFile);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Invalid config object');
      if (cfg.mcpServers != null && (typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers))) configValid = false;
      else servers = Object.entries(cfg.mcpServers || {}).flatMap(([name, entry]) => {
        const kind = mcpKind(entry);
        return kind ? [{ name, kind, configured: true, managed: name === SERVER_NAME && isOurs(entry) || websiteOwned(configFile,name,entry), runtime: 'unverified' }] : [];
      });
    } catch { configValid = false; }
  }
  return {
    scope,
    skillTargets: targets.map((dir) => ({ dir, exists: fs.existsSync(dir) })),
    skills,
    mcp: { configFile, exists: fs.existsSync(configFile), valid: configValid, servers, runtime: 'unverified' },
    configured: skills.length > 0 || servers.length > 0,
    runtime: 'unverified',
  };
}

module.exports = { SHADCN_ENTRY, removeInstalled, MARKER, SERVER_NAME, SERVER_ENTRY, skillTargets, mcpConfigPath, installSkills, uninstallSkills, addMcpServer, removeMcpServer, installedSkills, configStatus };
