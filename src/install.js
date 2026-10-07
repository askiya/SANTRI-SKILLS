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
// Cooperative exclusive lock plus pre-rename snapshot check: never merge stale data.
function safeMcpFile(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||file.split(/[\\/]/).includes('..')||/[\x00-\x1f]/.test(file)||/^\\\\/.test(file)||process.platform==='win32'&&file.slice(2).includes(':'))throw new Error('Path config invalid.');
  assertSafePath(file,path.dirname(file));
  let stat;try{stat=fs.lstatSync(file)}catch(e){if(e.code!=='ENOENT')throw e}
  if(stat&&!stat.isFile())throw new Error('Config/backup/marker wajib file regular.');
  if(stat&&stat.nlink!==1)throw new Error('Hardlink config/backup/marker ditolak.');
}
function mutateMcp(file, change) {
  file=path.resolve(file);safeMcpFile(file);safeMcpFile(file+'.bak');safeMcpFile(file+'.santri-lock');
  fs.mkdirSync(path.dirname(file),{recursive:true});safeMcpFile(file);
  const lock=file+'.santri-lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600)}catch(e){if(e.code==='EEXIST')throw new Error('Config sedang ditulis. Coba lagi; file tidak diubah.');throw e}
  let backup=null;
  try{
    const original=fs.existsSync(file)?fs.readFileSync(file):null;
    let cfg={};try{if(original)cfg=JSON.parse(original.toString('utf8'))}catch{throw new Error(`${file} bukan JSON valid. File tidak diubah.`)}
    if(!cfg||typeof cfg!=='object'||Array.isArray(cfg))throw new Error('Root config harus object. File tidak diubah.');
    if(Object.hasOwn(cfg,'mcpServers')&&(!cfg.mcpServers||typeof cfg.mcpServers!=='object'||Array.isArray(cfg.mcpServers)))throw new Error('mcpServers harus object. File tidak diubah.');
    const before=JSON.stringify(cfg);change(cfg);
    if(JSON.stringify(cfg)!==before){
      if(original){
        backup=file+'.bak';if(fs.existsSync(backup))backup+=`-${crypto.randomUUID()}`;safeMcpFile(backup);
        fs.writeFileSync(backup,original,{flag:'wx',mode:0o600});
      }
      const temp=`${file}.tmp-${crypto.randomUUID()}`;let staged=false;
      try{
        fs.writeFileSync(temp,JSON.stringify(cfg,null,2)+'\n',{flag:'wx',mode:0o600});staged=true;
        safeMcpFile(file);safeMcpFile(temp);
        const current=fs.existsSync(file)?fs.readFileSync(file):null;
        if(original? !current||!current.equals(original):current!==null)throw new Error('Config berubah saat menulis. File tidak ditimpa; backup dipertahankan.');
        fs.renameSync(temp,file);staged=false;
        safeMcpFile(file);if(!isDeepStrictEqual(JSON.parse(fs.readFileSync(file,'utf8')),cfg))throw new Error('Read-back config gagal; backup dipertahankan.');
      }finally{if(staged)fs.rmSync(temp,{force:true})}
    }
    Object.defineProperty(cfg,'backup',{value:backup,enumerable:false});return cfg;
  }catch(e){if(backup)e.backup=backup;throw e}finally{fs.closeSync(fd);fs.unlinkSync(lock)}
}
function mergeMcpEntries(file, entries) {
  return mutateMcp(file,cfg=>{
    const bag=cfg.mcpServers||{},collisions=Object.keys(entries).filter(n=>Object.hasOwn(bag,n));
    if(collisions.length)throw new Error(`MCP sudah ada: ${collisions.join(', ')}. File tidak diubah.`);
    cfg.mcpServers={...bag,...entries};
  });
}
function addMcpServer(file, entry = SERVER_ENTRY, name = SERVER_NAME, { preset = null } = {}) {
  if(preset&&(preset!=='react-bits'||name!=='shadcn'||!isDeepStrictEqual(entry,SHADCN_ENTRY)))throw new Error('Preset invalid.');
  if(preset)safeMcpFile(mcpMarkerFile(file));
  const config=mutateMcp(file,cfg=>{
    const existing=cfg.mcpServers&&cfg.mcpServers[name];
    if(preset&&existing&&!websiteOwned(file,name,existing))throw new Error(`MCP '${name}' sudah ada di ${file}. Hapus manual dulu, file tidak diubah.`);
    if(!preset&&existing&&!isDeepStrictEqual(existing,entry)&&!(name===SERVER_NAME&&isOurs(existing)))throw new Error(`MCP '${name}' sudah ada di ${file} dengan konfigurasi lain. Hapus manual dulu, file tidak diubah.`);
    if(!isDeepStrictEqual(existing,entry))cfg.mcpServers={...(cfg.mcpServers||{}),[name]:entry};
  });
  if(preset){
    const marker=mcpMarkerFile(file);let meta={};try{meta=JSON.parse(fs.readFileSync(marker,'utf8'))||{}}catch{}
    if(!meta||typeof meta!=='object'||Array.isArray(meta))meta={};
    if(meta.servers?.[name]!==preset)atomicJson(marker,{...meta,servers:{...(meta.servers||{}),[name]:preset},updatedAt:new Date().toISOString()});
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
    if(id==='shadcn'){const marker=mcpMarkerFile(mcpFile);safeMcpFile(marker);}
    // Install backups are never overwritten: each effective write gets its own unique backup.
    const written=mutateMcp(mcpFile,next=>{if(next.mcpServers)delete next.mcpServers[id]});
    if(id==='shadcn'){const marker=mcpMarkerFile(mcpFile),meta=JSON.parse(fs.readFileSync(marker,'utf8'));delete meta.servers[id];atomicJson(marker,meta);}
    return {removed:true,kind,id,backup:written.backup};
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

module.exports = { SHADCN_ENTRY, removeInstalled, mergeMcpEntries, MARKER, SERVER_NAME, SERVER_ENTRY, skillTargets, mcpConfigPath, installSkills, uninstallSkills, addMcpServer, removeMcpServer, installedSkills, configStatus };
