'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
test('detection is read-only, distinguishes workspace from application, and redacts config',()=>{
 const {detectTargets}=require('../src/detect');
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'santri-detect-'));
 try {
  const options={home,cwd:home,env:{},platform:'linux'};
  let d=detectTargets(options);assert.equal(d.antigravityDetected,false);assert.deepEqual(fs.readdirSync(home),[]);
  fs.mkdirSync(path.join(home,'.agents','skills'),{recursive:true});
  assert.equal(detectTargets(options).antigravityDetected,false);
  const root=path.join(home,'.gemini','config');fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,'mcp_config.json'),JSON.stringify({mcpServers:{example:{command:'SECRET_COMMAND',env:{TOKEN:'SECRET_TOKEN'}}}}));
  d=detectTargets(options);assert.equal(d.antigravityDetected,true);assert.equal(d.applicationDetected,false);
  const candidate=d.candidates.find(c=>c.file===path.join(root,'mcp_config.json'));
  assert.equal(candidate.confidence,'high');assert.equal(candidate.writable,true);assert.equal(candidate.recommended,true);
  assert.doesNotMatch(JSON.stringify(d),/SECRET_COMMAND|SECRET_TOKEN/);
 } finally {fs.rmSync(home,{recursive:true,force:true});}
});

test('resolver writes only chosen detected skill target and honors env overrides',()=>{
 const {resolveTargets,resolveForWrite}=require('../src/detect');const {installSkills,configStatus}=require('../src/install');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'santri-resolve-'));
 try {
  const chosen=path.join(base,'.agent','skills');fs.mkdirSync(path.join(chosen,'keep'),{recursive:true});fs.writeFileSync(path.join(chosen,'keep','SKILL.md'),'unchanged');
  const source=path.join(base,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'SKILL.md'),'fixture');
  const opts={cwd:base,home:base,env:{SANTRI_SKILLS_AG_HOME:path.join(base,'override')},repoRoot:path.resolve(__dirname,'..'),kind:'skills'};
  const r=resolveForWrite('project',opts);assert.deepEqual(r.skillsDirs,[chosen]);
  installSkills([{id:'fixture',dir:source,source:'fixture'}],r.skillsDirs);
  assert.equal(fs.readFileSync(path.join(chosen,'fixture','SKILL.md'),'utf8'),'fixture');assert.equal(fs.readFileSync(path.join(chosen,'keep','SKILL.md'),'utf8'),'unchanged');assert.equal(fs.existsSync(path.join(base,'.agents','skills')),false);
  assert.equal(configStatus('project',base,base,{skillTargets:r.skillsDirs,mcpFile:r.mcpFile}).skills.length,2);
  const g=resolveTargets('global',opts);assert.deepEqual(g.skillsDirs,[path.join(base,'override','skills')]);assert.equal(g.mcpFile,path.join(base,'override','mcp_config.json'));
  const custom=path.join(base,'custom');const other=path.join(base,'other');fs.mkdirSync(custom);fs.mkdirSync(other);
  opts.custom={skillsDir:path.join(custom,'skills')};resolveForWrite('project',opts);
  fs.rmdirSync(custom);fs.symlinkSync(other,custom,'junction');assert.throws(()=>resolveForWrite('project',opts),/symlink|junction/);
  opts.custom={};fs.rmSync(path.join(base,'.agent'),{recursive:true});fs.symlinkSync(other,path.join(base,'.agent'),'junction');fs.mkdirSync(path.join(other,'skills'));
  assert.throws(()=>resolveForWrite('project',opts),/symlink|junction/);
 } finally {fs.rmSync(base,{recursive:true,force:true});}
});
test('custom validation rejects junction/symlink ancestors, ADS, and device paths',()=>{
 const {validateCustomTargets}=require('../src/detect');
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'santri-custom-'));
 const repo=path.resolve(__dirname,'..');
 try {
  const real=path.join(base,'real');fs.mkdirSync(real);
  const link=path.join(base,'link');fs.symlinkSync(real,link,'junction');
  assert.throws(()=>validateCustomTargets({confirm:true,skillsDir:path.join(link,'skills')},{cwd:repo}),/symlink\/junction/);
  assert.throws(()=>validateCustomTargets({confirm:true,mcpFile:path.join(real,'mcp_config.json:evil')},{cwd:repo,platform:'win32'}),/ADS|mcp_config/);
  assert.throws(()=>validateCustomTargets({confirm:true,mcpFile:'\\\\?\\C:\\x\\mcp_config.json'},{cwd:repo}),/UNC|device|absolut/);
  assert.throws(()=>validateCustomTargets({confirm:true,mcpFile:path.join(real,'settings.json')},{cwd:repo}),/mcp_config/);
  const ok=validateCustomTargets({confirm:true,mcpFile:path.join(real,'mcp_config.json')},{cwd:repo});
  assert.equal(ok.checks[0].writable,true);assert.deepEqual(fs.readdirSync(real),[],'validation writes nothing');
 } finally {fs.rmSync(base,{recursive:true,force:true});}
});
