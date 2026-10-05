'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boundedFetch, previewGithub, publicPreview } = require('../src/github-import');
const { runControl } = require('../src/antigravity-control');
const json = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
function fixture(files) {
  const calls=[];
  const fetcher=async (url, options) => {
    assert.equal(options.redirect,'manual');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push(String(url));
    if(String(url)==='https://api.github.com/repos/fixture/repo')return json({default_branch:'main'});
    if(String(url)==='https://api.github.com/repos/fixture/repo/git/trees/main?recursive=1')return json({tree:Object.keys(files).map(path=>({path,type:'blob',mode:'100644'}))});
    const prefix='https://raw.githubusercontent.com/fixture/repo/main/';
    assert.ok(String(url).startsWith(prefix),String(url));
    const name=decodeURIComponent(String(url).slice(prefix.length));
    assert.ok(Object.hasOwn(files,name),name);
    return new Response(files[name]);
  };
  return {fetcher,calls};
}
test('GitHub preview reads only bounded metadata, SKILL.md, MCP config and README text',async()=>{
  const f=fixture({'skills/demo/SKILL.md':'---\nname: Demo\n---\nExample', 'configs/antigravity/mcp_config.json':JSON.stringify({mcpServers:{'context-mode':{command:'context-mode',env:{TOKEN:'private-fixture'}}}}), 'README.md':'```sh\nnpm install -g context-mode\n```', 'package.json':'{}','install.sh':'not executed'});
  const snap=await previewGithub('https://github.com/fixture/repo',{fetcher:f.fetcher,scope:'project',targets:{skillsDirs:['fixture/skills'],mcpFile:'fixture/mcp_config.json'}});
  assert.deepEqual(snap.skills.map(s=>s.id),['demo']);
  assert.deepEqual(snap.mcp[0].names,['context-mode']);
  assert.deepEqual(snap.installCommands,['npm install -g context-mode']);
  assert.equal(snap.hash.length,64);
  assert.doesNotMatch(JSON.stringify(publicPreview(snap)),/private-fixture|TOKEN|"command"/);
  assert.ok(!f.calls.some(url=>url.endsWith('/install.sh')||url.endsWith('/package.json')));
});
test('GitHub redirects reject foreign, credentialed and non-HTTPS destinations before fetch',async()=>{
  for(const location of ['http://github.com/a/b','https://example.com/','https://user@github.com/a/b','https://github.com:444/a/b']){
    let calls=0;
    await assert.rejects(boundedFetch('https://api.github.com/repos/a/b',{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location}})}}),/Host GitHub fetch ditolak/);
    assert.equal(calls,1);
  }
});
test('GitHub redirect count, MIME, declared and streamed response caps fail closed',async()=>{
  let calls=0;
  await assert.rejects(boundedFetch('https://github.com/a/b',{fetcher:async()=>{calls++;return new Response(null,{status:302,headers:{location:'/a/b'}})}}),/redirect/);
  assert.equal(calls,4);
  await assert.rejects(boundedFetch('https://api.github.com/a',{json:true,fetcher:async()=>new Response('{}',{headers:{'content-type':'text/html'}})}),/JSON/);
  for(const headers of [{},{'content-length':String(513*1024)}]) await assert.rejects(boundedFetch('https://raw.githubusercontent.com/a/b/main/a',{fetcher:async()=>new Response('x'.repeat(513*1024),{headers})}),/terlalu besar/);
});
test('GitHub oversized tree, unsafe tree path, duplicate skills and malformed MCP rejected',async()=>{
  for(const tree of [{truncated:true,tree:[]},{tree:Array.from({length:2001},(_,i)=>({path:String(i)}))},{tree:[{path:'../bad'}]}])await assert.rejects(previewGithub('https://github.com/fixture/repo/tree/main',{fetcher:async()=>json(tree)}));
  for(const files of [{'a/demo/SKILL.md':'a','b/demo/SKILL.md':'b'},{'mcp_config.json':'{"mcpServers":[]}'}])await assert.rejects(previewGithub('https://github.com/fixture/repo',{fetcher:fixture(files).fetcher}));
});
test('GitHub snapshot binds source, scope, targets and artifact bytes',async()=>{
  const snap=async(source,scope,targets,text)=>previewGithub(source,{scope,targets,fetcher:fixture({'SKILL.md':text}).fetcher});
  const base=await snap('https://github.com/fixture/repo','project',{mcpFile:'a'},'one');
  for(const args of [['https://github.com/fixture/repo/','project',{mcpFile:'a'},'one'],['https://github.com/fixture/repo','global',{mcpFile:'a'},'one'],['https://github.com/fixture/repo','project',{mcpFile:'b'},'one'],['https://github.com/fixture/repo','project',{mcpFile:'a'},'two']])assert.notEqual((await snap(...args)).hash,base.hash);
});
test('controller wrapper uses injected execFile and fixed argv, never real processes',async()=>{
  const calls=[];
  const result=await runControl('status',{}, {pythonCommand:()=>'/fixture/python',execFile:(file,args,options,callback)=>{calls.push({file,args,options});callback(null,'{"ok":true,"running":false}','')}});
  assert.equal(result.running,false);
  assert.equal(calls[0].file,'/fixture/python');
  assert.equal(calls[0].args.at(-1),'status');
  assert.equal(calls[0].options.shell,undefined);
  assert.equal(calls[0].options.timeout,15000);
  await assert.rejects(runControl('status',{}, {pythonCommand:()=>null,execFile:()=>assert.fail('must not execute')}),/tidak ditemukan/);
});
test('dashboard static DOM IDs are unique and literal ID selectors exist',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'duplicate DOM IDs');
  for(const m of ui.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),'missing '+m[1]);
  assert.doesNotMatch(ui,/if\s*\(false\)/);
});
test('terminal bare URL invokes preview only; shell command rejected without API writes',async()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
  const code=ui.slice(ui.indexOf('async function runTerminal(line)'),ui.indexOf("$('#terminal-form').addEventListener"));
  const calls=[];
  const context={previewGithubUi:async url=>calls.push(url),termWrite:text=>calls.push(text),post:()=>assert.fail('no API writes'),installGithubUi:()=>assert.fail('no installation')};
  vm.createContext(context);vm.runInContext(code,context);
  await context.runTerminal('https://github.com/fixture/repo');
  assert.equal(calls[0],'https://github.com/fixture/repo');
  assert.match(calls[1],/belum ada file ditulis/);
  await assert.rejects(context.runTerminal('npm install context-mode'),/tidak didukung/);
  await assert.rejects(context.runTerminal('https://github.com/fixture/repo; npm install x'),/Sintaks shell/);
});
