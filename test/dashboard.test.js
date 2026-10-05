'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDashboardServer } = require('../src/dashboard');
async function fixture(fn) {
 const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-auth-'));
 let mode = 200, exchanges = 0;
 const remote = http.createServer(async (req,res) => {
  if (mode === 503) return req.socket.destroy();
  res.setHeader('Content-Type','application/json'); res.statusCode = mode;
  if (req.method === 'POST' && req.url.endsWith('/skills/session')) { exchanges++; let raw=''; for await(const c of req) raw+=c; assert.match(JSON.parse(raw).code_verifier,/^[\w-]{43,128}$/); }
  res.end(JSON.stringify(req.url.endsWith('catalog') ? {success:true,sources:[],mcpServers:[]} : {success:mode===200, token:'PRIVATE_TEST_TOKEN', user:{name:'Member',is_premium:mode===200}}));
 });
 await new Promise(r=>remote.listen(0,'127.0.0.1',r));
 const server=createDashboardServer({cwd,apiUrl:`http://127.0.0.1:${remote.address().port}/api`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(url,body={})=>fetch(base+url,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
 const login=async()=>{const r=await post('/api/auth/login'); assert.equal(r.status,200);const {url}=await r.json(); const u=new URL(url); assert.match(u.searchParams.get('state'),/^[a-f0-9]{64}$/);assert.match(u.searchParams.get('code_challenge'),/^[\w-]{43}$/);return u.searchParams.get('state');};
 try {await fn({base,post,login,cwd,setMode:n=>mode=n,exchanges:()=>exchanges});} finally {server.closeAllConnections();remote.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>remote.close(r))]);fs.rmSync(cwd,{recursive:true,force:true});}
}
test('signed-out dashboard gates every data and write endpoint, no files',()=>fixture(async({base,post,cwd})=>{
 assert.equal((await fetch(base+'/')).status,200);
 for(const route of ['/api/catalog','/api/auth/status']) assert.equal((await fetch(base+route)).status,401);
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
