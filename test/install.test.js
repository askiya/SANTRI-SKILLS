'use strict';
const { test } = require('node:test');
test('failed skill replacement preserves prior SKILL.md',()=>{
 const {installSkills,MARKER}=require('../src/install');
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'santri-atomic-'));
 try {const target=path.join(root,'target'),dest=path.join(target,'demo'),source=path.join(root,'source');
  fs.mkdirSync(dest,{recursive:true});fs.mkdirSync(source);fs.writeFileSync(path.join(dest,'SKILL.md'),'old');fs.writeFileSync(path.join(dest,MARKER),'{}');
  assert.throws(()=>installSkills([{id:'demo',dir:source,source:'test'}],[target]),/SKILL.md/);
  assert.equal(fs.readFileSync(path.join(dest,'SKILL.md'),'utf8'),'old');
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configStatus, skillTargets, mcpConfigPath, MARKER } = require('../src/install');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'santri-status-'));
const writeSkill = (dir, id, { marker = '{}', skillMd = '# s' } = {}) => {
  const d = path.join(dir, id);
  fs.mkdirSync(d, { recursive: true });
  if (skillMd !== null) fs.writeFileSync(path.join(d, 'SKILL.md'), skillMd);
  if (marker !== null) fs.writeFileSync(path.join(d, MARKER), marker);
};

test('empty workspace is never reported configured', () => {
  const cwd = tmp();
  const s = configStatus('project', cwd, tmp());
  assert.equal(s.configured, false);
  assert.deepEqual(s.skills, []);
  assert.equal(s.mcp.exists, false);
  assert.equal(s.mcp.valid, true);
  assert.equal(s.runtime, 'unverified');
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('folder without SKILL.md is not configured; valid skill is', () => {
  const cwd = tmp();
  const target = skillTargets('project', cwd)[0];
  writeSkill(target, 'empty-shell', { skillMd: null });
  let s = configStatus('project', cwd, tmp());
  assert.equal(s.skills.length, 0, 'marker alone must not count');
  assert.equal(s.configured, false);
  writeSkill(target, 'real-skill', { marker: JSON.stringify({ source: 'monorepo', installedAt: new Date().toISOString() }) });
  s = configStatus('project', cwd, tmp());
  assert.deepEqual(s.skills.map((k) => k.id), ['real-skill']);
  assert.equal(s.skills[0].managed, true);
  assert.equal(s.skills[0].markerValid, true);
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('malformed marker and stale timestamp stay visible but valid-flagged', () => {
  const cwd = tmp();
  const target = skillTargets('project', cwd)[0];
  writeSkill(target, 'broken', { marker: '{not json' });
  writeSkill(target, 'stale', { marker: JSON.stringify({ source: 1, installedAt: 'yesterday' }) });
  writeSkill(target, 'unmanaged', { marker: null });
  const s = configStatus('project', cwd, tmp());
  const by = Object.fromEntries(s.skills.map((k) => [k.id, k]));
  assert.equal(by.broken.markerValid, false);
  writeSkill(target, 'incomplete', { marker: '{}' });
  assert.equal(configStatus('project', cwd, tmp()).skills.find(x => x.id === 'incomplete').markerValid, false);
  assert.equal(by.broken.managed, true);
  assert.equal(by.stale.installedAt, null, 'unparseable date must not be echoed');
  assert.equal(by.stale.source, null, 'non-string source must not be echoed');
  assert.equal(by.unmanaged.managed, false);
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('mcp config: malformed invalid, bad entries dropped, no secrets echoed', () => {
  const cwd = tmp();
  const file = mcpConfigPath('project', cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ broken');
  let s = configStatus('project', cwd, tmp());
  assert.equal(s.mcp.valid, false);
  assert.equal(s.configured, false, 'malformed config must never read as configured');

  fs.writeFileSync(file, JSON.stringify({ mcpServers: [] }));
  assert.equal(configStatus('project', cwd, tmp()).mcp.valid, false, 'array mcpServers is malformed');

  fs.writeFileSync(file, JSON.stringify({ mcpServers: {
    good: { command: 'npx', args: ['-y', 'pkg'], env: { TOKEN: 'SECRET_VALUE' } },
    blank: { command: '   ' },
    badargs: { command: 'npx', args: [{}] },
    nil: null,
  } }));
  s = configStatus('project', cwd, tmp());
  assert.deepEqual(s.mcp.servers.map((x) => x.name), ['good']);
  assert.deepEqual(Object.keys(s.mcp.servers[0]).sort(), ['configured', 'kind', 'managed', 'name', 'runtime']);
  assert.equal(s.mcp.servers[0].runtime, 'unverified');
  assert.ok(!JSON.stringify(s).includes('SECRET_VALUE'), 'env/command secrets must not leave the helper');
  assert.ok(!JSON.stringify(s).includes('npx'));
  assert.equal(s.configured, true);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('mcp config lists stdio and remote entries by kind without exposing secrets', () => {
  const cwd = tmp(), file = mcpConfigPath('project', cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ mcpServers: {
    stdio: { command: 'SECRET_COMMAND', args: ['SECRET_ARG'], env: { TOKEN: 'SECRET_TOKEN' } },
    remote: { serverUrl: 'https://user:SECRET_PASSWORD@example.test/mcp', headers: { Authorization: 'SECRET_HEADER' } },
    legacy: { httpUrl: 'http://example.test/mcp' },
    invalid: { serverUrl: 'file:///secret' },
  } }));
  const status = configStatus('project', cwd, tmp());
  assert.deepEqual(status.mcp.servers.map(({ name, kind }) => ({ name, kind })), [
    { name: 'stdio', kind: 'stdio' }, { name: 'remote', kind: 'remote' }, { name: 'legacy', kind: 'remote' },
  ]);
  assert.equal(status.mcp.servers.length, 3);
  assert.doesNotMatch(JSON.stringify(status), /SECRET_COMMAND|SECRET_ARG|SECRET_TOKEN|SECRET_PASSWORD|SECRET_HEADER|example\.test/);
  fs.rmSync(cwd, { recursive: true, force: true });
});

test('invalid MCP object shapes never change config or backup', () => {
 const {addMcpServer}=require('../src/install');const cwd=tmp();const file=path.join(cwd,'mcp_config.json');
 try {for(const raw of ['[]','null','42','{"mcpServers":[]}','{"mcpServers":null}']) {
  fs.writeFileSync(file,raw);fs.writeFileSync(file+'.bak','keep backup');
  assert.throws(()=>addMcpServer(file),/object|objek/i);assert.equal(fs.readFileSync(file,'utf8'),raw);assert.equal(fs.readFileSync(file+'.bak','utf8'),'keep backup');
 }} finally {fs.rmSync(cwd,{recursive:true,force:true});}
});
test('preset reuses existing backup safely and returns real unique backup on repeated effective write', () => {
 const {addMcpServer,SHADCN_ENTRY}=require('../src/install'),root=tmp(),file=path.join(root,'mcp_config.json');
 try {const original=JSON.stringify({other:{token:'SECRET_FIXTURE'},mcpServers:{other:{command:'keep',env:{KEY:'SECRET_FIXTURE'}}}});fs.writeFileSync(file,original);fs.writeFileSync(file+'.bak','old recovery');
  const first=addMcpServer(file,SHADCN_ENTRY,'shadcn',{preset:'react-bits'});
  assert.equal(fs.readFileSync(file+'.bak','utf8'),'old recovery');assert.notEqual(first.backup,file+'.bak');assert.equal(fs.readFileSync(first.backup,'utf8'),original);
  assert.equal(JSON.parse(fs.readFileSync(file)).other.token,'SECRET_FIXTURE');
  const before=fs.readFileSync(file,'utf8'),again=addMcpServer(file,SHADCN_ENTRY,'shadcn',{preset:'react-bits'});
  assert.equal(again.backup,null);assert.equal(fs.readFileSync(file,'utf8'),before);
  const removed=require('../src/install').removeInstalled({kind:'mcp',id:'shadcn',mcpFile:file});assert.notEqual(removed.backup,first.backup);assert.equal(fs.readFileSync(first.backup,'utf8'),original);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('MCP merge rejects malformed, foreign collisions, symlink, hardlink and device without writing',()=>{
 const {mergeMcpEntries,SHADCN_ENTRY}=require('../src/install'),root=tmp(),file=path.join(root,'mcp_config.json');
 try {for(const raw of ['{','[]','{"mcpServers":null}']){fs.writeFileSync(file,raw);assert.throws(()=>mergeMcpEntries(file,{shadcn:SHADCN_ENTRY}));assert.equal(fs.readFileSync(file,'utf8'),raw)}
  const raw=JSON.stringify({mcpServers:{shadcn:{command:'foreign'}}});fs.writeFileSync(file,raw);assert.throws(()=>mergeMcpEntries(file,{shadcn:SHADCN_ENTRY}),/sudah ada/);assert.equal(fs.readFileSync(file,'utf8'),raw);
  const linked=path.join(root,'hard.json');fs.linkSync(file,linked);assert.throws(()=>mergeMcpEntries(file,{other:SHADCN_ENTRY}),/Hardlink/);assert.equal(fs.readFileSync(file,'utf8'),raw);fs.unlinkSync(linked);
  try{const alias=path.join(root,'alias.json');fs.symlinkSync(file,alias);assert.throws(()=>mergeMcpEntries(alias,{other:SHADCN_ENTRY}),/Symlink|junction/i)}catch(e){if(!/operation not permitted|privilege/i.test(e.message))throw e}
  fs.mkdirSync(path.join(root,'device.json'));assert.throws(()=>mergeMcpEntries(path.join(root,'device.json'),{other:SHADCN_ENTRY}));
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test('failed atomic rename retains current bytes and recovery backup, cleans temps and lock',()=>{
 const {addMcpServer}=require('../src/install'),root=tmp(),file=path.join(root,'mcp_config.json'),rename=fs.renameSync;
 try{fs.writeFileSync(file,'{"secret":"keep"}');fs.writeFileSync(file+'.bak','older');fs.renameSync=(from,to)=>{if(to===file)throw new Error('fixture rename failure');return rename(from,to)};
  assert.throws(()=>addMcpServer(file),/fixture rename failure/);assert.equal(fs.readFileSync(file,'utf8'),'{"secret":"keep"}');assert.equal(fs.readFileSync(file+'.bak','utf8'),'older');
  const backups=fs.readdirSync(root).filter(x=>x.startsWith('mcp_config.json.bak-'));assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(root,backups[0]),'utf8'),'{"secret":"keep"}');assert.ok(!fs.readdirSync(root).some(x=>/tmp-|santri-lock/.test(x)));
 }finally{fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true})}
});
test('MCP writer rejects concurrent cooperative writer and concurrent snapshot change',()=>{
 const {addMcpServer}=require('../src/install'),root=tmp(),file=path.join(root,'mcp_config.json'),write=fs.writeFileSync;
 try{fs.writeFileSync(file,'{}');fs.writeFileSync(file+'.santri-lock','locked');assert.throws(()=>addMcpServer(file),/sedang ditulis/);assert.equal(fs.readFileSync(file,'utf8'),'{}');fs.unlinkSync(file+'.santri-lock');
  fs.writeFileSync=(target,...args)=>{const r=write(target,...args);if(String(target).includes('.tmp-'))write(file,'{"concurrent":true}');return r};assert.throws(()=>addMcpServer(file),/berubah saat menulis/);assert.equal(fs.readFileSync(file,'utf8'),'{"concurrent":true}');assert.equal(fs.readFileSync(file+'.bak','utf8'),'{}');
 }finally{fs.writeFileSync=write;fs.rmSync(root,{recursive:true,force:true})}
});
test('scope is strictly validated', () => {
  for (const bad of ['', 'Project', 'both', null, undefined, 'global ']) assert.throws(() => configStatus(bad, tmp(), tmp()), /Scope invalid/);
  assert.equal(configStatus('global', tmp(), tmp()).scope, 'global');
});
