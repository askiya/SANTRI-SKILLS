'use strict';
// Run: node test/browser-fixture.js. Loopback fixture; Ctrl+C removes temp data.
// Auth/GitHub/control are mocked. Real dashboard writes ONLY inside temp root.
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDashboardServer}=require('../src/dashboard');
const scratch=process.env.TMPDIR||os.tmpdir();
const root=fs.mkdtempSync(path.join(scratch,'santri-browser-'));
const calls=[];
const binary=path.join(root,'.antigravity',process.platform==='win32'?'Antigravity.exe':process.platform==='darwin'?'Contents/MacOS/Antigravity':'antigravity');
fs.mkdirSync(path.dirname(binary),{recursive:true});fs.writeFileSync(binary,'NOT EXECUTABLE: fixture only');
const files={'skills/demo/SKILL.md':'---\nname: Demo\n---\nBrowser fixture','skills/unselected/SKILL.md':'Do not install','mcp_config.json':JSON.stringify({mcpServers:{demo:{command:'never-run-fixture'}}}),'README.md':'npm install never-run-fixture'};
const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
const githubFetch=async url=>{
 calls.push({github:String(url)});
 if(String(url)==='https://api.github.com/repos/fixture/repo')return json({default_branch:'main'});
 if(String(url)==='https://api.github.com/repos/fixture/repo/git/trees/main?recursive=1')return json({tree:Object.keys(files).map(path=>({path,type:'blob'}))});
 const prefix='https://raw.githubusercontent.com/fixture/repo/main/';
 if(!String(url).startsWith(prefix)||!Object.hasOwn(files,String(url).slice(prefix.length)))throw new Error('Unexpected fixture URL');
 return new Response(files[String(url).slice(prefix.length)]);
};
const remote=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.endsWith('catalog')?{success:true,sources:[],mcpServers:[]}:{success:true,token:'fixture-only',user:{name:'Fixture User',is_premium:true}}))});
let server;
remote.listen(0,'127.0.0.1',()=>{
 server=createDashboardServer({cwd:root,home:root,env:{PROGRAMFILES:root},githubFetch,controlRunner:async(action,options)=>{calls.push({control:action,options});console.log('MOCK CONTROL',action);return {ok:true,action,running:false}},apiUrl:`http://127.0.0.1:${remote.address().port}/api`});
 server.on('request',req=>{if(req.url.startsWith('/api/'))calls.push({request:req.method+' '+req.url})});
 server.listen(0,'127.0.0.1',async()=>{
  const base=`http://127.0.0.1:${server.address().port}`,post=(u,b={})=>fetch(base+u,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(b)});
  const state=new URL((await (await post('/api/auth/login')).json()).url).searchParams.get('state');
  const auth=await post('/api/auth/callback',{state,ticket:'fixture_ticket'});if(!auth.ok)throw new Error('Fixture auth failed');
  console.log(JSON.stringify({base,root,report:path.join(root,'report.json')}));
 });
});
const report=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({calls,installed:fs.existsSync(path.join(root,'.agents/skills/demo/SKILL.md')),unselected:fs.existsSync(path.join(root,'.agents/skills/unselected/SKILL.md')),mcp:fs.existsSync(path.join(root,'.agents/mcp_config.json'))},null,2));
const timer=setInterval(report,250);
process.on('SIGINT',()=>{clearInterval(timer);report();console.log(fs.readFileSync(path.join(root,'report.json'),'utf8'));server.closeAllConnections();server.close();remote.closeAllConnections();remote.close();fs.rmSync(root,{recursive:true,force:true})});
