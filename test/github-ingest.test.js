'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boundedFetch, previewGithub, publicPreview, MAX_TREE } = require('../src/github-import');
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
test('oversized GitHub tree is tagged, without archive fallback',async()=>{
 for(const tree of [{truncated:true,tree:[]},{tree:Array.from({length:MAX_TREE+1},(_,i)=>({path:String(i)}))}]){
  const calls=[];await assert.rejects(previewGithub('https://github.com/fixture/repo/tree/main',{fetcher:async url=>{calls.push(String(url));return json(tree)}}),e=>e.tooLarge===true);
  assert.equal(calls.length,1);
 }
 for(const headers of [{},{'content-length':String(4*1024*1024+1)}]){
  const calls=[];await assert.rejects(previewGithub('https://github.com/fixture/repo/tree/main',{fetcher:async url=>{calls.push(String(url));return new Response(' '.repeat(4*1024*1024+1),{headers:{'content-type':'application/json',...headers}})}}),e=>e.tooLarge===true);
  assert.equal(calls.length,1);
 }
});
test('GitHub oversized tree, unsafe tree path, duplicate skills and malformed MCP rejected',async()=>{
  for(const tree of [{truncated:true,tree:[]},{tree:Array.from({length:MAX_TREE+1},(_,i)=>({path:String(i)}))},{tree:[{path:'../bad'}]}])await assert.rejects(previewGithub('https://github.com/fixture/repo/tree/main',{fetcher:async()=>json(tree)}));
  for(const files of [{'a/demo/SKILL.md':'a','b/demo/SKILL.md':'b'},{'mcp_config.json':'{"mcpServers":[]}'}])await assert.rejects(previewGithub('https://github.com/fixture/repo',{fetcher:fixture(files).fetcher}));
});
test('GitHub API rate-limit 403 falls back to bounded public archive',async()=>{
 const files={'context-mode-main/SKILL.md':'---\nname: Context Mode\n---\nsafe','context-mode-main/mcp_config.json':JSON.stringify({mcpServers:{'context-mode':{command:'context-mode'}}})};
 const blocks=[];for(const [name,text]of Object.entries(files)){const b=Buffer.from(text),h=Buffer.alloc(512);h.write(name);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h[156]=48;blocks.push(h,b,Buffer.alloc((512-b.length%512)%512));}const archive=require('node:zlib').gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));
 const calls=[];
 const fetcher=async url=>{calls.push(String(url));if(String(url).startsWith('https://api.github.com/'))return new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'content-type':'application/json','x-ratelimit-remaining':'0','x-ratelimit-reset':'1791246714'}});if(String(url)==='https://codeload.github.com/askiya/context-mode/tar.gz/refs/heads/main')return new Response(archive,{headers:{'content-type':'application/x-gzip'}});return new Response('missing',{status:404});};
 const snap=await previewGithub('https://github.com/askiya/context-mode',{fetcher,scope:'project',targets:{}});
 assert.equal(snap.branch,'main');assert.deepEqual(snap.skills.map(x=>x.id),['context-mode']);assert.deepEqual(snap.mcp[0].names,['context-mode']);assert.ok(calls.some(x=>x.startsWith('https://codeload.github.com/')));
});
test('GitHub non-rate-limit 403 reports safe upstream message and does not use archive fallback',async()=>{
 let calls=0;await assert.rejects(previewGithub('https://github.com/a/b',{fetcher:async()=>{calls++;return new Response(JSON.stringify({message:'Repository access blocked'}),{status:403,headers:{'content-type':'application/json','x-ratelimit-remaining':'12'}})}}),/Repository access blocked/);assert.equal(calls,1);
});
test('streaming archive rejects traversal, links and decompression bombs',async()=>{
 const {archiveEntries}=require('../src/github-import'),zlib=require('node:zlib');
 const tar=entries=>{const blocks=[];for(const [name,type='0',data=Buffer.from('safe')]of entries){const h=Buffer.alloc(512);h.write(name);h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h[156]=type.charCodeAt(0);blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));}return zlib.gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)]));};
 for(const name of ['repo/../bad','/repo/bad','repo/C:bad','repo/a\\bad'])await assert.rejects(archiveEntries(tar([[name]])),/tidak aman/);
 for(const type of ['1','2'])await assert.rejects(archiveEntries(tar([['repo/file',type]])),/ditolak/);
 await assert.rejects(archiveEntries(zlib.gzipSync(Buffer.alloc(97*1024*1024))),e=>e.tooLarge===true&&/setelah dekompresi melebihi 96 MB/.test(e.message));
});
test('streaming archive scans large skipped media but retains only bounded relevant files',async()=>{
 const {archiveEntries}=require('../src/github-import'),zlib=require('node:zlib'),blocks=[];
 for(const [name,data]of [['repo/media/video.bin',Buffer.alloc(40*1024*1024)],['repo/skills/demo/SKILL.md',Buffer.from('---\nname: Demo\n---\n')]]){const h=Buffer.alloc(512);h.write(name);h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h[156]=48;blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));}
 const result=await archiveEntries(zlib.gzipSync(Buffer.concat([...blocks,Buffer.alloc(1024)])));
 assert.deepEqual([...result.files.keys()],['skills/demo/SKILL.md']);assert.equal(result.entries,2);
});
test('archive redirects reject foreign destinations before second fetch',async()=>{
 const fetcher=async()=>new Response(null,{status:302,headers:{location:'https://codeload.github.com.evil/a'}});
 await assert.rejects(previewGithub('https://github.com/a/b',{fetcher}),/Host GitHub/);
});
test('rate-limited preview still enforces compressed archive ceiling',async()=>{
 const rate=new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'content-type':'application/json','x-ratelimit-remaining':'0'}});
 const fetcher=async url=>String(url).startsWith('https://api.github.com/')?rate.clone():new Response(require('node:zlib').gzipSync(Buffer.alloc(16)),{headers:{'content-length':String(33*1024*1024)}});
 await assert.rejects(previewGithub('https://github.com/a/b',{fetcher}),e=>e.tooLarge===true&&/terkompresi melebihi 32 MB/.test(e.message));
});
test('archive structure tags only parser link/type failures, not network or 404',async()=>{
 const rate=()=>new Response(JSON.stringify({message:'API rate limit exceeded'}),{status:403,headers:{'content-type':'application/json','x-ratelimit-remaining':'0'}});
 for(const type of ['1','2','3']){
  const h=Buffer.alloc(512);h.write('repo/file');h.write('00000000000\0',124);h[156]=type.charCodeAt(0);
  await assert.rejects(previewGithub('https://github.com/a/b/tree/main',{fetcher:async url=>String(url).startsWith('https://api.github.com/')?rate():new Response(require('node:zlib').gzipSync(Buffer.concat([h,Buffer.alloc(1024)])))}),e=>e.unscannable===true&&/ditolak/.test(e.message));
 }
 for(const failure of ['network','404'])await assert.rejects(previewGithub('https://github.com/a/b/tree/main',{fetcher:async url=>{if(String(url).startsWith('https://api.github.com/'))return rate();if(failure==='network')throw new Error('getaddrinfo ENOTFOUND');return new Response('{}',{status:404});}}),e=>!e.unscannable&&!e.tooLarge);
});
test('duplicate skill mirrors across client dirs collapse to the preferred .agents copy',async()=>{
 const snap=await previewGithub('https://github.com/fixture/repo',{fetcher:fixture({'.agents/skills/demo/SKILL.md':'---\nname: Demo\n---\ncanonical','.grok/skills/demo/SKILL.md':'mirror','plugin/skills/demo/SKILL.md':'mirror','tests/oracle/skills/demo/SKILL.md':'fixture'}).fetcher});
 assert.deepEqual(snap.skills.map(x=>x.path),['.agents/skills/demo/SKILL.md']);
});
test('multi-client repository excludes alternate client skills from IDE preview',async()=>{
 const snap=await previewGithub('https://github.com/fixture/repo',{fetcher:fixture({'skills/context-mode/SKILL.md':'safe','configs/antigravity-cli/skills/context-mode/SKILL.md':'cli','configs/copilot-cli/skills/context-mode/SKILL.md':'other','configs/antigravity/mcp_config.json':'{"mcpServers":{"context-mode":{"command":"context-mode"}}}'}).fetcher});
 assert.deepEqual(snap.skills.map(x=>x.id),['context-mode']);assert.deepEqual(snap.mcp[0].names,['context-mode']);
});
test('GitHub README fetch errors, including size caps, fail preview closed',async()=>{
  const files={'SKILL.md':'safe','README.md':'x'.repeat(513*1024)};
  await assert.rejects(previewGithub('https://github.com/fixture/repo',{fetcher:fixture(files).fetcher}),/terlalu besar/);
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
test('controller rejects malformed async output and controller failures',async()=>{
  for(const output of ['not JSON','null','[]','{}','{"ok":false,"error":"fixture failure"}']){
    let callback; const pending=runControl('status',{}, {pythonCommand:()=>'/fixture/python',execFile:(f,a,o,cb)=>{callback=cb}});
    const rejected=assert.rejects(pending);
    assert.doesNotThrow(()=>callback(null,output,''));
    await rejected;
  }
});
test('dashboard static DOM IDs are unique and literal ID selectors exist',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'duplicate DOM IDs');
  for(const m of ui.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),'missing '+m[1]);
  assert.doesNotMatch(ui,/if\s*\(false\)/);
});
test('terminal UI and execution code are removed',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
  assert.doesNotMatch(html,/terminal-input|terminal-output|Terminal Instalasi/);
  assert.doesNotMatch(ui,/runTerminal|termWrite|child_process|exec\(|spawn\(/);
});
