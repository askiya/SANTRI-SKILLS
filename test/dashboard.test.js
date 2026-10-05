'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDashboardServer } = require('../src/dashboard');
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
 for(const q of ['', '?scope=bad','?scope=project&scope=global','?scope=project&extra=1']) assert.equal((await fetch(base+'/api/status'+q)).status,400);
 const r=await fetch(base+'/api/status?scope=project');assert.equal(r.status,200);const s=await r.json();assert.equal(s.configured,false);assert.equal(s.runtime,'unverified');assert.deepEqual(fs.readdirSync(cwd),[]);
 setMode(403);assert.equal((await fetch(base+'/api/status?scope=global')).status,403);
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
 assert.equal((await fetch(base+'/api/targets?scope=project')).status,401);
 await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'});
 for(const q of ['','?scope=bad','?scope=project&scope=global','?scope=project&x=1']) assert.equal((await fetch(base+'/api/targets'+q)).status,400);
 const r=await fetch(base+'/api/targets?scope=project');assert.equal(r.status,200);
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
 const after=await(await fetch(base+'/api/targets?scope=project')).json();
 assert.deepEqual(after.effective.project.skillsDirs,[ok],'override drives later installs');
 assert.equal((await call({confirm:true,reset:true})).status,200);
 assert.equal((await(await fetch(base+'/api/targets?scope=project')).json()).custom.skillsDir,null);
}));
test('detected targets drive status and MCP writes; custom reset restores auto',()=>fixture(async({base,post,login,cwd})=>{
 const _csrf=(await (await post('/api/auth/callback',{state:await login(),ticket:'ticket_abc'})).json()).csrf;
 const chosen=path.join(cwd,'.agent','skills');fs.mkdirSync(path.join(chosen,'existing'),{recursive:true});fs.writeFileSync(path.join(chosen,'existing','SKILL.md'),'keep skill');
 const get=async route=>{const r=await fetch(base+route);assert.equal(r.status,200);return r.json()};
 const auto=await get('/api/targets?scope=project');assert.deepEqual(auto.effective.project.skillsDirs,[chosen]);
 assert.deepEqual((await get('/api/status?scope=project')).skills.map(s=>s.id),['existing']);
 const custom=path.join(cwd,'mcp_config.json');const original=JSON.stringify({other:{keep:42},mcpServers:{unrelated:{command:'fixture',args:[]}}});fs.writeFileSync(custom,original);
 assert.equal((await post('/api/targets/custom',{_csrf,confirm:true,mcpFile:custom})).status,200);
 assert.equal((await post('/api/mcp',{_csrf,scope:'project',id:'santri-skills',confirm:true})).status,200);
 const written=JSON.parse(fs.readFileSync(custom,'utf8'));assert.deepEqual(written.other,{keep:42});assert.deepEqual(written.mcpServers.unrelated,{command:'fixture',args:[]});assert.ok(written.mcpServers['santri-skills']);assert.equal(fs.readFileSync(custom+'.bak','utf8'),original);
 assert.equal((await get('/api/status?scope=project')).mcp.configFile,custom);
 assert.equal((await post('/api/targets/custom',{_csrf,confirm:true,reset:true})).status,200);
 assert.deepEqual((await get('/api/targets?scope=project')).effective,auto.effective);
 assert.equal((await post('/api/mcp',{_csrf,scope:'project',id:'santri-skills',confirm:true})).status,200);
 assert.ok(fs.existsSync(auto.effective.project.mcpFile));assert.equal((await get('/api/status?scope=project')).mcp.configFile,auto.effective.project.mcpFile);
}));
test('new brand asset and effect script are served with correct content types',()=>fixture(async({base})=>{
 for(const [url,type] of [['/assets/santriverse-logo-light.webp','image/webp'],['/assets/santriverse-logo.webp','image/webp'],['/antigravity.js','text/javascript']]){
  const r=await fetch(base+url);assert.equal(r.status,200,url);assert.equal(r.headers.get('content-type'),type);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 }
}));
