'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDashboardServer } = require('../src/dashboard');
test('MCP runtime status distinguishes PATH commands and npx runtime resolution',()=>{
 const {mcpRuntimeStatus}=require('../src/runtime-status');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'santri-path-'));try{const exe=path.join(dir,process.platform==='win32'?'present.cmd':'present');fs.writeFileSync(exe,process.platform==='win32'?'@exit /b 0':'#!/bin/sh\n');if(process.platform!=='win32')fs.chmodSync(exe,0o755);
  assert.equal(mcpRuntimeStatus({command:'present'},{PATH:dir}).runtime,'tersedia');
  assert.equal(mcpRuntimeStatus({command:'definitely-missing-santri'},{PATH:dir}).runtime,'tidak ditemukan di PATH');
  assert.equal(mcpRuntimeStatus({command:'npx',args:['-y','pkg']},{PATH:dir}).runtime,'di-resolve saat runtime');
  assert.deepEqual(mcpRuntimeStatus({serverUrl:'https://user:SECRET@example.test/mcp',headers:{Authorization:'SECRET'}},{PATH:dir}),{runtime:'remote (tidak diuji)',available:null});
  assert.equal(mcpRuntimeStatus({serverUrl:'file:///secret'},{PATH:dir}).available,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('Antigravity control builds fixed Python argv and separates graceful from force close',()=>{
 const {controlArgv}=require('../src/antigravity-control');
 assert.deepEqual(controlArgv('status'),['status']);assert.deepEqual(controlArgv('close'),['close']);assert.deepEqual(controlArgv('close',{force:true}),['close','--force']);assert.deepEqual(controlArgv('launch',{executable:'C:/AG/Antigravity.exe'}),['launch','--executable','C:/AG/Antigravity.exe']);assert.throws(()=>controlArgv('close',{force:'yes'}));
});

test('GitHub ingest parser accepts bounded repo/tree URLs and rejects foreign hosts and traversal',()=>{
 const {parseIngestUrl}=require('../src/github-import');
 assert.deepEqual(parseIngestUrl('https://github.com/askiya/context-mode'),{repo:'askiya/context-mode',branch:null,subdir:''});
 assert.deepEqual(parseIngestUrl('https://github.com/a/b/tree/main/configs/antigravity'),{repo:'a/b',branch:'main',subdir:'configs/antigravity'});
 for(const url of ['http://github.com/a/b','https://evil.example/a/b','https://github.com.evil/a/b','https://x@github.com/a/b','https://github.com:444/a/b','https://github.com/a/b/issues','https://github.com/a/b/tree/main/../x','https://github.com/a/b?token=x','https://github.com/a/b/tree/main/%2e%2e/x'])assert.throws(()=>parseIngestUrl(url));
});

test('project-only skill never appears globally installed or verified',()=>fixture(async({base,post,login,cwd})=>{
 const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 const project=path.join(cwd,'.agents','skills','demo');fs.mkdirSync(project,{recursive:true});fs.writeFileSync(path.join(project,'SKILL.md'),'project only');
 const read=async scope=>{const r=await fetch(base+'/api/status?scope='+scope);assert.equal(r.status,200);return r.json()};
 assert.equal((await fetch(base+'/api/status?scope=project')).status,400,'dashboard is global only');
 assert.deepEqual((await read('global')).skills,[]);
 const check=await post('/api/verify',{_csrf,scope:'global'});assert.equal(check.status,200);
 const result=await check.json();assert.equal(result.skillChecks.some(s=>s.id==='demo'&&s.exists),false);
 assert.equal(result.skillTargets[0].dir,path.join(cwd,'.gemini','config','skills'));
 assert.equal(result.mcp.configFile,path.join(cwd,'.gemini','config','mcp_config.json'));
}, {controlRunner:()=>assert.fail('read-only check must not touch IDE')}));
test('verify reads disk and missing PATH without invoking app controls',()=>fixture(async({post,login,cwd})=>{
 assert.equal((await post('/api/verify',{scope:'global'})).status,401);
 const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 assert.equal((await post('/api/verify',{scope:'global'})).status,403);
 const file=path.join(cwd,'.gemini','config','mcp_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});
 const original=JSON.stringify({mcpServers:{'context-mode':{command:'context-mode',env:{TOKEN:'fixture-secret'}}}});fs.writeFileSync(file,original);
 const response=await post('/api/verify',{_csrf,scope:'global'});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.mcp.servers[0].available,false);assert.match(result.mcp.servers[0].runtime,/tidak ditemukan/);assert.match(result.note,/Handshake MCP tidak diuji/);
 assert.doesNotMatch(JSON.stringify(result),/fixture-secret/);assert.equal(fs.readFileSync(file,'utf8'),original);assert.ok(!fs.existsSync(file+'.bak'));
 for(const action of ['close','restart'])assert.equal((await post('/api/antigravity/control',{_csrf,action})).status,400);
}, {controlRunner:()=>assert.fail('read/check or unconfirmed control must never invoke controller')}));

async function fixture(fn, serverOptions = {}) {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-auth-'));
 let mode = 200, exchanges = 0;
 const remote = http.createServer(async (req,res) => {
  if (mode === 503) return req.socket.destroy();
  res.setHeader('Content-Type','application/json'); res.statusCode = mode;
  if (req.method === 'POST' && req.url.endsWith('/skills/session')) { exchanges++; let raw=''; for await(const c of req) raw+=c; assert.match(JSON.parse(raw).code_verifier,/^[\w-]{43,128}$/); }
  res.end(JSON.stringify(req.url.endsWith('catalog') ? {success:true,sources:[],mcpServers:[]} : {success:mode===200, token:'PRIVATE_TEST_TOKEN', user:{name:'Member',is_premium:mode===200}}));
 });
 await new Promise(r=>remote.listen(0,'127.0.0.1',r));
 const server=createDashboardServer({cwd,home:cwd,env:{},...serverOptions,apiUrl:`http://127.0.0.1:${remote.address().port}/api`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(url,body={})=>fetch(base+url,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 const login=async()=>{const r=await post('/api/auth/login'); assert.equal(r.status,200);const {url}=await r.json(); const u=new URL(url); assert.match(u.searchParams.get('state'),/^[a-f0-9]{64}$/);assert.match(u.searchParams.get('code_challenge'),/^[\w-]{43}$/);return u.searchParams.get('state');};
 try {await fn({base,post,login,cwd,setMode:n=>mode=n,exchanges:()=>exchanges});} finally {server.closeAllConnections();remote.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>remote.close(r))]);fs.rmSync(cwd,{recursive:true,force:true});}
}
test('signed-out dashboard gates every data and write endpoint, no files',()=>fixture(async({base,post,cwd})=>{
 assert.equal((await fetch(base+'/')).status,200);
 for(const route of ['/api/catalog','/api/auth/status','/api/status?scope=project']) assert.equal((await fetch(base+route)).status,401);
 for(const route of ['/api/install','/api/mcp','/api/repo/preview','/api/repo/install']) assert.equal((await post(route)).status,401);
 assert.deepEqual(fs.readdirSync(cwd),[]);
}));
test('PKCE callback rejects mismatch and replay; token never reaches browser',()=>fixture(async({post,login,exchanges,base})=>{
 await login(); assert.equal((await post('/api/auth/callback',{state:'bad',ticket:'ticket_abc'})).status,400); const state=await login();
 const r=await post('/api/auth/callback',{state,ticket:'ticket_abc'});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('PRIVATE_TEST_TOKEN'));
 assert.equal((await post('/api/auth/callback',{state,ticket:'ticket_abc'})).status,400); assert.equal(exchanges(),1);
 assert.equal((await fetch(base+'/api/catalog')).status,200);
 assert.equal((await post('/api/auth/logout')).status,200);assert.equal((await fetch(base+'/api/catalog')).status,401);
}));
test('remote denial or outage fails closed before writes',()=>fixture(async({post,login,setMode,cwd,base})=>{
 await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'});
 for(const mode of [401,403,503]) {setMode(200);assert.equal((await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).status,200);setMode(mode);for(const route of ['/api/install','/api/mcp','/api/repo/preview','/api/repo/install']) assert.notEqual((await post(route,{scope:'project',skillIds:['x'],confirm:true})).status,200);assert.notEqual((await fetch(base+'/api/catalog')).status,200);}
 assert.deepEqual(fs.readdirSync(cwd),[]);
}));
test('auth writes require same-origin JSON; host protected',()=>fixture(async({base})=>{
 for(const route of ['/api/auth/login','/api/auth/logout','/api/auth/callback']) assert.equal((await fetch(base+route,{method:'POST',headers:{origin:'https://other.example','content-type':'application/json'},body:'{}'})).status,403);
 assert.equal(await new Promise(resolve => { const r=http.get(base+'/',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}); r.on('error',()=>resolve(0)); }),403);
}));

test('premium status read validates scope and discloses no commands',()=>fixture(async({base,post,login,cwd,setMode})=>{
 await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'});
 for(const q of ['', '?scope=bad','?scope=project','?scope=project&scope=global','?scope=global&extra=1']) assert.equal((await fetch(base+'/api/status'+q)).status,400);
 const r=await fetch(base+'/api/status?scope=global');assert.equal(r.status,200);const s=await r.json();assert.equal(s.configured,false);assert.equal(s.runtime,'unverified');assert.deepEqual(fs.readdirSync(cwd),[]);
 setMode(403);assert.equal((await fetch(base+'/api/status?scope=global')).status,403);
}));
test('global status and verify list remote MCP without leaking config values or project MCP',()=>fixture(async({base,post,login,cwd})=>{
 const csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 const global=path.join(cwd,'.gemini','config','mcp_config.json'),project=path.join(cwd,'.agents','mcp_config.json');
 fs.mkdirSync(path.dirname(global),{recursive:true});fs.mkdirSync(path.dirname(project),{recursive:true});
 fs.writeFileSync(global,JSON.stringify({mcpServers:{stdio:{command:'SECRET_COMMAND',args:['SECRET_ARG'],env:{TOKEN:'SECRET_TOKEN'}},remote:{serverUrl:'https://user:SECRET_PASSWORD@example.test/mcp',headers:{Authorization:'SECRET_HEADER'}},bad:{url:'file:///secret'}}}));
 fs.writeFileSync(project,JSON.stringify({mcpServers:{'santri-skills':{command:'project-only'}}}));
 const status=await (await fetch(base+'/api/status?scope=global')).text(),check=await (await post('/api/verify',{_csrf:csrf,scope:'global'})).text();
 for(const raw of [status,check]){
  const value=JSON.parse(raw);assert.deepEqual(value.mcp.servers.map(s=>[s.name,s.kind]),[['stdio','stdio'],['remote','remote']]);
  assert.equal(value.mcp.servers.length,2);assert.doesNotMatch(raw,/SECRET_COMMAND|SECRET_ARG|SECRET_TOKEN|SECRET_PASSWORD|SECRET_HEADER|example\\.test|project-only/);
  assert.equal(value.mcp.servers.some(s=>s.name==='santri-skills'),false);
 }
 const verified=JSON.parse(check);assert.equal(verified.mcp.servers[1].runtime,'remote (tidak diuji)');assert.equal(verified.mcp.servers[1].available,null);
 assert.equal(verified.mcpChecks.find(s=>s.name==='santri-skills').configured,false);
}));
test('brand assets explicitly served with correct content types',()=>fixture(async({base})=>{
 for(const [file,type] of [['santriverse-logo.webp','image/webp'],['antigravity.svg','image/svg+xml']]) { const r=await fetch(base+'/assets/'+file);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),type); }
 assert.equal((await fetch(base+'/assets/banner.png')).status,404);
}));
test('SantriHub shell references served logos and CSP allows same-origin images',()=>fixture(async({base})=>{
 const r=await fetch(base+'/');const html=await r.text();const csp=r.headers.get('content-security-policy');
 assert.match(html,/<title>SantriHub<\/title>/);assert.match(html,/class="workspace-name">SantriHub</);
 for(const src of new Set([...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(m=>m[1]))) { assert.match(src,/^\/assets\//); const a=await fetch(base+src); assert.equal(a.status,200,src); assert.match(a.headers.get('content-type'),/^image\//); }
 assert.ok(html.includes('/assets/santriverse-logo.webp')&&html.includes('/assets/antigravity.svg'));
 assert.match(csp,/default-src 'self'/);assert.doesNotMatch(csp,/img-src(?![^;]*'self')/);
}));

test('targets detection is premium-gated, scope-validated, and leaks no config values',()=>fixture(async({base,post,login,cwd})=>{
 assert.equal((await fetch(base+'/api/targets?scope=global')).status,401);
 await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'});
 for(const q of ['','?scope=bad','?scope=project','?scope=project&scope=global','?scope=global&x=1']) assert.equal((await fetch(base+'/api/targets'+q)).status,400);
 const r=await fetch(base+'/api/targets?scope=global');assert.equal(r.status,200);
 const d=await r.json();
 assert.equal(typeof d.antigravityDetected,'boolean');
 assert.equal(typeof d.applicationDetected,'boolean','installed app and config artifacts stay separate');
 assert.ok(Array.isArray(d.candidates)&&d.candidates.length);
 for(const c of d.candidates){assert.ok(['skills','mcp'].includes(c.kind));assert.ok(['high','medium','low'].includes(c.confidence));assert.equal(typeof c.writable,'boolean');assert.ok(Array.isArray(c.evidence)&&c.evidence.length);}
 assert.equal(d.custom.skillsDir,null);assert.equal(d.custom.mcpFile,null);
 assert.deepEqual(fs.readdirSync(cwd),[],'detection writes nothing');
}));
test('custom target validation rejects unsafe paths and never persists to disk',()=>fixture(async({base,post,login,cwd})=>{
 assert.equal((await post('/api/targets/custom',{confirm:true})).status,401);
 const r0=await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'});const csrf=(await r0.json()).csrf;
 const call=(body)=>post('/api/targets/custom',{_csrf:csrf,...body});
 assert.equal((await post('/api/targets/custom',{confirm:true,mcpFile:path.join(cwd,'mcp_config.json')})).status,403,'CSRF required');
 const sep=path.sep;
 const bad=[
  {confirm:true},                                                              // nothing to set
  {mcpFile:path.join(cwd,'mcp_config.json')},                                  // confirm missing
  {confirm:true,mcpFile:'relative/mcp_config.json'},                           // not absolute
  {confirm:true,mcpFile:path.join(cwd,'..','mcp_config.json')+sep+'..'},        // '..' segment
  {confirm:true,mcpFile:path.join(cwd,'notes.txt')},                           // not .json
  {confirm:true,mcpFile:path.join(cwd,'credentials.json')},                    // sensitive name
  {confirm:true,skillsDir:path.join(cwd,'node_modules','skills')},             // node_modules
  {confirm:true,skillsDir:path.parse(cwd).root},                               // drive root
  {confirm:true,skillsDir:path.join(path.resolve(__dirname,'..'),'skills')},   // this CLI repo
  {confirm:true,mcpFile:'\\\\server\\share\\mcp_config.json'},                     // UNC
 ];
 for(const body of bad){const res=await call(body);assert.equal(res.status,400,JSON.stringify(body));}
 const ok=path.join(cwd,'custom','skills');fs.mkdirSync(path.dirname(ok),{recursive:true});
 const good=await call({confirm:true,skillsDir:ok});
 assert.equal(good.status,200);const g=await good.json();
 assert.equal(g.custom.skillsDir,ok);assert.equal(g.persisted,false);
 assert.equal(g.checks[0].writable,true);assert.equal(g.checks[0].exists,false);
 const after=await(await fetch(base+'/api/targets?scope=global')).json();
 assert.deepEqual(after.effective.global.skillsDirs,[ok],'override drives later installs');
 assert.equal((await call({confirm:true,reset:true})).status,200);
 assert.equal((await(await fetch(base+'/api/targets?scope=global')).json()).custom.skillsDir,null);
}));
test('detected targets drive status and MCP writes; custom reset restores auto',()=>fixture(async({base,post,login,cwd})=>{
 const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 const chosen=path.join(cwd,'.gemini','config','skills');fs.mkdirSync(path.join(chosen,'existing'),{recursive:true});fs.writeFileSync(path.join(chosen,'existing','SKILL.md'),'keep skill');
 const get=async route=>{const r=await fetch(base+route);assert.equal(r.status,200);return r.json()};
 const auto=await get('/api/targets?scope=global');assert.deepEqual(auto.effective.global.skillsDirs,[chosen]);
 assert.deepEqual((await get('/api/status?scope=global')).skills.map(s=>s.id),['existing']);
 const custom=path.join(cwd,'mcp_config.json');const original=JSON.stringify({other:{keep:42},mcpServers:{unrelated:{command:'fixture',args:[]}}});fs.writeFileSync(custom,original);
 assert.equal((await post('/api/targets/custom',{_csrf,confirm:true,mcpFile:custom})).status,200);
 assert.equal((await post('/api/mcp',{_csrf,scope:'global',confirmGlobal:true,id:'santri-skills',confirm:true})).status,200);
 const written=JSON.parse(fs.readFileSync(custom,'utf8'));assert.deepEqual(written.other,{keep:42});assert.deepEqual(written.mcpServers.unrelated,{command:'fixture',args:[]});assert.ok(written.mcpServers['santri-skills']);assert.equal(fs.readFileSync(custom+'.bak','utf8'),original);
 assert.equal((await get('/api/status?scope=global')).mcp.configFile,custom);
 assert.equal((await post('/api/targets/custom',{_csrf,confirm:true,reset:true})).status,200);
 assert.deepEqual((await get('/api/targets?scope=global')).effective,auto.effective);
 assert.equal((await post('/api/mcp',{_csrf,scope:'global',confirmGlobal:true,id:'santri-skills',confirm:true})).status,200);
 assert.ok(fs.existsSync(auto.effective.global.mcpFile));assert.equal((await get('/api/status?scope=global')).mcp.configFile,auto.effective.global.mcpFile);
}));
test('new brand asset and effect script are served with correct content types',()=>fixture(async({base})=>{
 for(const [url,type] of [['/assets/santriverse-logo-light.webp','image/webp'],['/assets/santriverse-logo.webp','image/webp'],['/antigravity.js','text/javascript']]){
  const r=await fetch(base+url);assert.equal(r.status,200,url);assert.equal(r.headers.get('content-type'),type);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 }
}));
test('status renderer distinguishes missing, invalid and configured MCP with catalog counts',()=>{
 const vm=require('node:vm'), source=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
 const nodes={}; const context={ $:id=>nodes[id]||(nodes[id]={}), esc:x=>String(x??'').replaceAll('<','&lt;'), renderSkills(){},renderMcp(){},catalog:{skills:[{id:'wanted'}],mcpServers:[{id:'wanted-mcp'}]} };
 vm.createContext(context);
 const render=source.slice(source.indexOf('function renderStatus()'),source.indexOf("$('#refresh-status').onclick"));
 const run=mcp=>{context.lastStatus={scope:'project',skills:[{id:'unrelated',managed:false}],skillTargets:[{dir:'C:/project/.agents/skills',exists:true}],mcp};vm.runInContext(render+';renderStatus()',context);return nodes['#status-view'].innerHTML;};
 assert.match(run({exists:false,valid:true,servers:[],configFile:'C:/project/.agents/mcp_config.json'}),/FILE BELUM ADA/);
 assert.match(nodes['#install-counts'].innerHTML,/1 terpasang · 1 belum/);
 assert.match(run({exists:true,valid:false,servers:[],configFile:'config'}),/JSON RUSAK/);
 assert.match(run({exists:true,valid:true,servers:[{name:'wanted-mcp'}],configFile:'config'}),/DIKONFIGURASI · 1/);
 assert.match(nodes['#status-view'].innerHTML,/runtime belum diverifikasi/);
 assert.match(nodes['#install-counts'].innerHTML,/1 dikonfigurasi · 0 belum/);
});
test('scope UI defaults global, names exact official targets, and check modal avoids false pass claims',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
 assert.match(html,/name="scope" value="global" checked/);assert.match(html,/Global semua workspace/);assert.match(html,/Project saat ini/);
 assert.match(html,/~\/\.gemini\/config\/skills\/&lt;id&gt;\/SKILL\.md/);assert.match(html,/~\/\.gemini\/config\/mcp_config\.json/);assert.match(html,/&lt;project&gt;\/\.agents\/skills\/&lt;id&gt;\/SKILL\.md/);
 assert.doesNotMatch(html+ui,/\bLULUS\b/);assert.match(ui,/TERPASANG · /);assert.match(ui,/FILE ADA/);assert.match(ui,/IDE BELUM TERVERIFIKASI/);assert.match(ui,/RUNTIME (?:SIAP|HILANG)/);
 assert.doesNotMatch(html,/antigravity-ide\/(?:mcp|builtin|plugins)/);
});
test('status page shows unified install check and separate open/restart actions',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../src/dashboard.css'),'utf8');
 assert.match(css,/main\s*>\s*header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:/s);
 assert.match(css,/\.scope-bar\s*\{[^}]*position:\s*sticky/s);
 for(const id of ['status-view','install-counts','target-panel','custom-skills','custom-mcp','validate-custom','refresh-status','open-antigravity','restart-antigravity','force-antigravity','close-check','force-confirm']) assert.match(html,new RegExp(`id="${id}"`));
 assert.match(html,/<dialog id="check-panel"/,'Cek & Tes is a modal dialog, not an inline section');
 assert.match(html,/id="force-antigravity"[^>]*hidden/,'force restart stays hidden until graceful close fails');
 assert.match(html,/santrihub_status/,'check panel tells the user how to prove the IDE really loaded the server');
 assert.match(css,/\.check-panel::backdrop[^}]*backdrop-filter/);assert.match(css,/\.check-panel \{[^}]*overflow:auto/);
 assert.match(html,/id="open-antigravity"[^>]*>Buka Antigravity IDE</);
 assert.match(html,/id="restart-antigravity"[^>]*>Restart Antigravity IDE</);
 assert.match(html,/Pekerjaan belum disimpan dapat hilang/);
 assert.match(html,/Developer: Reload Window/);assert.match(html,/Manage MCP Servers/);assert.match(html,/~\/\.gemini\/antigravity\/mcp_config\.json/);
 assert.doesNotMatch(html,/id="reload-antigravity"/);assert.doesNotMatch(css,/1180px|1036px/);
});

test('force close needs its own consent and graceful failure surfaces a 409 recovery, never auto /F',()=>{
 const calls=[];
 return fixture(async({post,login,cwd})=>{
  const root=path.join(cwd,'AppData','Local','Programs','Antigravity IDE'),binary=path.join(root,'Antigravity IDE.exe');
  fs.mkdirSync(path.join(root,'resources','app'),{recursive:true});fs.writeFileSync(binary,'fixture');
  fs.writeFileSync(path.join(root,'resources','app','product.json'),JSON.stringify({nameShort:'Antigravity IDE',applicationName:'antigravity-ide'}));
  const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
  assert.equal((await post('/api/antigravity/control',{_csrf,action:'restart',confirmClose:true,force:true})).status,400,'force needs confirmForce');
  assert.equal((await post('/api/antigravity/control',{_csrf,action:'status',force:true,confirmForce:true})).status,400,'force only applies to close/restart');
  assert.deepEqual(calls,[]);
  const blocked=await post('/api/antigravity/control',{_csrf,action:'restart',confirmClose:true});
  assert.equal(blocked.status,409);const body=await blocked.json();
  assert.equal(body.forceRequired,true);assert.doesNotMatch(body.error,/FORCE_REQUIRED/);assert.match(body.warning,/hilang permanen/);
  assert.deepEqual(calls.map(c=>[c[0],c[1].force]),[['close',false]],'no launch and no force escalation after a failed graceful close');
  const forced=await post('/api/antigravity/control',{_csrf,action:'restart',confirmClose:true,force:true,confirmForce:true});
  assert.equal(forced.status,200);
  assert.deepEqual(calls.map(c=>[c[0],c[1].force]),[['close',false],['close',true],['status',undefined],['launch',undefined]]);
 }, {controlRunner:async(action,options)=>{calls.push([action,options]);
   if(action==='close'&&!options.force)throw new Error('FORCE_REQUIRED: Antigravity IDE menolak/belum selesai menutup (PID [1234]).');
   return {ok:true,action,running:false};}});
});

test('MCP exposes a read-only identity tool that proves the loaded runtime without secrets',async()=>{
 const {TOOLS,callTool}=require('../src/mcp-server');
 assert.ok(TOOLS.some(t=>t.name==='santrihub_status'));
 const data=JSON.parse(await callTool('santrihub_status'));
 assert.equal(data.server,'santri-skills');assert.equal(data.nodeExecutable,process.execPath);
 assert.equal(data.installationRoot,path.resolve(__dirname,'..'));
 assert.ok(data.toolNames.includes('list_skills'));
 assert.doesNotMatch(JSON.stringify(data),/TOKEN|password|secret|mcpServers/i);
});

test('open action launches without close confirm; close/restart demand confirm',()=>{
 const calls=[];
 return fixture(async({post,login,cwd})=>{
  const root=path.join(cwd,'AppData','Local','Programs','Antigravity IDE');
  const binary=path.join(root,'Antigravity IDE.exe');
  fs.mkdirSync(path.join(root,'resources','app'),{recursive:true});fs.writeFileSync(binary,'fixture');
  fs.writeFileSync(path.join(root,'resources','app','product.json'),JSON.stringify({nameShort:'Antigravity IDE',applicationName:'antigravity-ide'}));
  const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
  for(const action of ['close','restart'])assert.equal((await post('/api/antigravity/control',{_csrf,action})).status,400);
  assert.deepEqual(calls,[]);
  assert.equal((await post('/api/antigravity/control',{_csrf,action:'status'})).status,200);
  assert.deepEqual(calls.map(c=>c[0]),['status']);
  const launch=await post('/api/antigravity/control',{_csrf,action:'launch'});
  assert.equal(launch.status,200,JSON.stringify(await launch.json()));
  assert.deepEqual(calls.map(c=>c[0]),['status','launch']);
  assert.equal(calls[1][1].executable,binary);
  assert.ok(!calls.some(c=>c[0]==='close'),'open must never close the app');
  assert.equal((await post('/api/antigravity/control',{_csrf,action:'bogus'})).status,400);
 }, {controlRunner:async(action,options)=>{calls.push([action,options]);return {ok:true,action};}});
});

test('GitHub install requires exact source and hash before writes',()=>fixture(async({post,login,cwd})=>{
 const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 const preview=async()=> (await (await post('/api/github/preview',{_csrf,scope:'global',url:'https://github.com/fixture/repo/tree/main'})).json());
 for(const field of ['sourceUrl','previewHash'])for(const value of [undefined,null,42,'wrong']){
  const p=await preview();const body={_csrf,scope:'global',confirmGlobal:true,previewId:p.previewId,sourceUrl:p.sourceUrl,previewHash:p.previewHash,confirm:true,skillIds:['repo'],[field]:value};
  assert.equal((await post('/api/github/install',body)).status,409);
  assert.deepEqual(fs.readdirSync(cwd),[]);
 }
 const p=await preview();assert.equal((await post('/api/github/install',{_csrf,scope:'global',confirmGlobal:true,previewId:p.previewId,sourceUrl:p.sourceUrl,previewHash:p.previewHash,confirm:true,skillIds:['repo']})).status,200);
 assert.equal(fs.readFileSync(path.join(cwd,'.gemini','config','skills','repo','SKILL.md'),'utf8'),'safe');
},{githubFetch:async url=>String(url).includes('/git/trees/')?new Response(JSON.stringify({tree:[{path:'SKILL.md',type:'blob'}]}),{headers:{'content-type':'application/json'}}):new Response('safe')}));

test('local scanner bounds skills, rejects links, and exposes safe MCP names only',()=>{
 const {scanLocalSkills,scanLocalMcp}=require('../src/local-import');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'santri-local-'));
 try{
  const skill=path.join(root,'safe-skill');fs.mkdirSync(skill);fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: Safe\ndescription: Local fixture\n---\nBody');fs.writeFileSync(path.join(skill,'note.txt'),'ok');
  const skills=scanLocalSkills(root);assert.deepEqual(skills.map(x=>x.id),['safe-skill']);assert.equal(skills[0].name,'Safe');assert.equal(skills[0].files,2);
  fs.writeFileSync(path.join(root,'mcp_config.json'),JSON.stringify({mcpServers:{safe:{command:'secret-command',env:{TOKEN:'secret'}},other:{serverUrl:'https://x',headers:{Authorization:'secret'}}}}));
  const mcp=scanLocalMcp(path.join(root,'mcp_config.json'));assert.deepEqual(mcp.names,['other','safe']);assert.doesNotMatch(JSON.stringify(mcp),/secret-command|TOKEN|Authorization/);
  fs.writeFileSync(path.join(root,'bad.json'),'{');assert.throws(()=>scanLocalMcp(path.join(root,'bad.json')),/JSON valid/);
  try{fs.symlinkSync(skill,path.join(root,'linked'),'junction');assert.throws(()=>scanLocalSkills(path.join(root,'linked')),/symlink|junction/i)}catch(e){if(!/operation not permitted|privilege/i.test(e.message))throw e}
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});

test('local preview/install routes require auth and CSRF, bind preview, preserve config, reject collision',()=>fixture(async({base,post,login,cwd})=>{
 const skillRoot=path.join(cwd,'imports');const skill=path.join(skillRoot,'fixture-skill');fs.mkdirSync(skill,{recursive:true});fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: Fixture\ndescription: test\n---\nSafe');
 const mcpFile=path.join(cwd,'source','mcp_config.json');fs.mkdirSync(path.dirname(mcpFile),{recursive:true});fs.writeFileSync(mcpFile,JSON.stringify({mcpServers:{alpha:{command:'fixture',args:['serve']}}}));
 assert.equal((await post('/api/local/skills/preview',{source:skillRoot})).status,401);
 const auth=await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'}),csrf=(await auth.json()).csrf;
 assert.equal((await post('/api/local/skills/preview',{source:skillRoot})).status,403);
 const sp=await post('/api/local/skills/preview',{_csrf:csrf,scope:'global',source:skillRoot});assert.equal(sp.status,200);const s=await sp.json();assert.deepEqual(s.skills.map(x=>x.id),['fixture-skill']);
 fs.appendFileSync(path.join(skill,'SKILL.md'),'\nchanged');
 assert.equal((await post('/api/local/skills/install',{_csrf:csrf,previewId:s.previewId,scope:'global',confirmGlobal:true,skillIds:['fixture-skill']})).status,409,'stale source rejected');
 const fresh=await (await post('/api/local/skills/preview',{_csrf:csrf,scope:'global',source:skillRoot})).json();
 const installed=await post('/api/local/skills/install',{_csrf:csrf,previewId:fresh.previewId,scope:'global',confirmGlobal:true,skillIds:['fixture-skill']});assert.equal(installed.status,200);assert.ok(fs.existsSync(path.join(cwd,'.gemini','config','skills','fixture-skill','SKILL.md')));
 const mp=await post('/api/local/mcp/preview',{_csrf:csrf,scope:'global',source:mcpFile});assert.equal(mp.status,200);const m=await mp.json();assert.deepEqual(m.names,['alpha']);assert.doesNotMatch(JSON.stringify(m),/"fixture"|"serve"|command":/);
 const target=path.join(cwd,'.gemini','config','mcp_config.json');fs.writeFileSync(target,JSON.stringify({keep:42,mcpServers:{existing:{command:'keep'}}}));
 const mi=await post('/api/local/mcp/install',{_csrf:csrf,previewId:m.previewId,scope:'global',confirmGlobal:true,names:['alpha']});assert.equal(mi.status,200);const cfg=JSON.parse(fs.readFileSync(target));assert.equal(cfg.keep,42);assert.deepEqual(cfg.mcpServers.existing,{command:'keep'});assert.deepEqual(cfg.mcpServers.alpha,{command:'fixture',args:['serve']});
 fs.writeFileSync(mcpFile,JSON.stringify({mcpServers:{existing:{command:'other'}}}));const collision=await (await post('/api/local/mcp/preview',{_csrf:csrf,scope:'global',source:mcpFile})).json();assert.equal((await post('/api/local/mcp/install',{_csrf:csrf,previewId:collision.previewId,scope:'global',confirmGlobal:true,names:['existing']})).status,400);assert.deepEqual(JSON.parse(fs.readFileSync(target)).mcpServers.existing,{command:'keep'});
}));

test('dashboard removes terminal and project target, exposes centered wizard',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../src/dashboard.html'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../src/dashboard-ui.js'),'utf8');
 for(const id of ['add-chooser','install-wizard','wizard-next','wizard-close'])assert.match(html,new RegExp(`id="${id}"`));
 assert.doesNotMatch(html,/Terminal Instalasi|terminal-output|value="project"/);assert.doesNotMatch(ui,/runTerminal|termWrite|child_process|exec\(|spawn\(/);
});

test('local import rejects traversal, malformed MCP, oversized scan, sensitive files and stale scope',()=>fixture(async({post,login,cwd})=>{
 const csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf,call=(u,b)=>post(u,{_csrf:csrf,scope:'global',confirmGlobal:true,...b});
 for(const source of ['relative',path.join(cwd,'..','x'),'\\\\server\\share\\skills',path.join(cwd,'.ssh'),path.join(cwd,'secrets')]) assert.equal((await call('/api/local/skills/preview',{source})).status,400,source);
 const bad=path.join(cwd,'bad','mcp_config.json');fs.mkdirSync(path.dirname(bad),{recursive:true});
 for(const body of ['{','[]','{"mcpServers":[]}','{"mcpServers":{"x":{"args":[]}}}','{"mcpServers":{"../x":{"command":"a"}}}']){fs.writeFileSync(bad,body);assert.equal((await call('/api/local/mcp/preview',{source:bad})).status,400,body)}
 const big=path.join(cwd,'big','huge');fs.mkdirSync(big,{recursive:true});fs.writeFileSync(path.join(big,'SKILL.md'),'x'.repeat(513*1024));assert.equal((await call('/api/local/skills/preview',{source:path.dirname(big)})).status,400);
 const sk=path.join(cwd,'src2','one');fs.mkdirSync(sk,{recursive:true});fs.writeFileSync(path.join(sk,'SKILL.md'),'---\nname: One\n---\n');fs.writeFileSync(path.join(sk,'token.txt'),'SECRET');fs.writeFileSync(path.join(sk,'run.sh'),'rm -rf /');
 const pv=await (await call('/api/local/skills/preview',{source:path.dirname(sk)})).json();assert.equal(pv.skills[0].files,1);
 assert.equal((await post('/api/local/skills/install',{_csrf:csrf,scope:'global',previewId:pv.previewId,skillIds:['one']})).status,400,'global needs confirm');
 assert.equal((await post('/api/local/skills/install',{_csrf:csrf,scope:'project',previewId:pv.previewId,skillIds:['one']})).status,400,'project rejected');
 const ok=await call('/api/local/skills/install',{previewId:pv.previewId,skillIds:['one']});assert.equal(ok.status,200);
 const dest=path.join(cwd,'.gemini','config','skills','one');assert.ok(fs.existsSync(path.join(dest,'SKILL.md')));assert.ok(!fs.existsSync(path.join(dest,'token.txt')));assert.ok(!fs.existsSync(path.join(dest,'run.sh')));
 assert.equal((await call('/api/local/skills/install',{previewId:pv.previewId,skillIds:['one']})).status,409,'single-use preview');
 const again=await (await call('/api/local/skills/preview',{source:path.dirname(sk)})).json();assert.equal((await call('/api/local/skills/install',{previewId:again.previewId,skillIds:['one']})).status,400,'existing folder never overwritten');
 const status=await (await fetch(new URL('/api/status?scope=global',`http://127.0.0.1:${new URL(ok.url).port}`))).json();assert.ok(status.skills.some(s=>s.id==='one'&&s.source==='local'));
}));
