'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
test('manifest public key matches callback allowlist',()=>{
 const manifest=require('../extension/manifest.json');
 const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join('');
 assert.equal(id,'fdhomioibdphiooncfcidjjbpoebfcep');
});
test('Chrome panel centers without overflow in dark and light themes',{skip:!chrome,timeout:45000},async()=>{
 const home=fs.mkdtempSync(path.join(process.env.TMPDIR||'C:/Users/Hype/AppData/Local/hermes/cache/scratch','skills-layout-'));
 const port=31000+Math.floor(Math.random()*1000),proc=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run',`--user-data-dir=${home}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});
 let ws;
 try{
  let page;
  for(let i=0;i<100&&!page;i++){try{page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p=>p.type==='page')}catch{}if(!page)await new Promise(r=>setTimeout(r,100));}
  assert.ok(page,'Chrome CDP ready');ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(m.error.message)):r(m.result)}};
  const call=(method,params={})=>new Promise((r,j)=>{pending.set(++id,[r,j]);ws.send(JSON.stringify({id,method,params}))});
  const run=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value};
  // UI fixture only: no production account, token, or server response simulated.
  await call('Page.addScriptToEvaluateOnNewDocument',{source:"window.chrome={storage:{session:{get:async()=>({}),remove:async()=>{}},local:{get:async()=>({}),set:async()=>{}}},runtime:{sendMessage:async()=>({})}}"});
  await call('Page.navigate',{url:pathToFileURL(path.resolve(__dirname,'../extension/sidepanel.html')).href});
  for(let i=0;i<100;i++){if(await run("document.querySelector('#login-section')&&document.styleSheets.length>0"))break;await new Promise(r=>setTimeout(r,50));}
  for(const width of [320,360,480])for(const theme of ['dark','light']){
   await call('Emulation.setDeviceMetricsOverride',{width,height:760,deviceScaleFactor:1,mobile:false});
   await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#notice').classList.add('hidden')`);
   const v=await run("(()=>{const b=document.querySelector('#login-section').getBoundingClientRect();return {w:innerWidth,scroll:document.documentElement.scrollWidth,left:b.left,right:b.right,center:b.left+b.width/2}})()");
   assert.equal(v.w,width);assert.ok(v.scroll<=width,JSON.stringify(v));assert.ok(v.left>=0&&v.right<=width,JSON.stringify(v));assert.ok(Math.abs(v.center-width/2)<=1,JSON.stringify(v));
   console.log(`${width}px ${theme}: centered, no overflow`);
   if(width===360){const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(path.dirname(home),`skills-panel-${theme}.png`),Buffer.from(shot.data,'base64'));}
  }
 }finally{ws?.close();proc.kill();}
});
