'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=path.join(__dirname,'..','src');
const ROOT=path.join(__dirname,'..');
const { EXTENSIONS, isExtensionLink } = require('../src/extensions');
const desktop = require('../src/desktop-host');
const { createDashboardServer } = require('../src/dashboard');

test('Extensions page is rendered from the catalog and keeps the distribution warning',()=>{
  const html=fs.readFileSync(path.join(src,'dashboard.html'),'utf8');
  const ui=fs.readFileSync(path.join(src,'dashboard-ui.js'),'utf8');
  assert.match(html,/data-page="extensions"/);
  assert.match(html,/id="page-extensions"/);
  assert.match(html,/id="extension-list"/);
  assert.match(html,/Dilarang membagikan/);
  assert.doesNotMatch(html,/Load unpacked|Belum dipublikasikan ke Chrome Web Store/,'members install from the official stores');
  assert.doesNotMatch(html,/Terpasang di Gemini/);
  assert.match(ui,/extensions:'Extensions'/);
  assert.match(ui,/dataset\.page===page/);
  assert.match(ui,/getJson\('\/api\/extensions'\)/);
  // Catalog text goes through textContent, never innerHTML.
  const render=ui.slice(ui.indexOf('function renderExtensions'),ui.indexOf('async function loadExtensions'));
  assert.doesNotMatch(render,/innerHTML/);
  assert.match(render,/rel='noopener noreferrer'/);
});

test('catalog lists every official extension with https store links',()=>{
  const ids=EXTENSIONS.map(e=>e.id);
  assert.deepEqual(ids,['santri-skills','santri-code']);
  assert.equal(new Set(ids).size,ids.length,'unique ids');
  for(const ext of EXTENSIONS){
    assert.ok(ext.name&&ext.kind&&ext.tagline,ext.id);
    assert.ok(ext.stores.length>0,ext.id);
    for(const store of ext.stores){
      assert.ok(store.label&&store.for,store.url);
      assert.equal(new URL(store.url).protocol,'https:');
      assert.equal(isExtensionLink(store.url),true,store.url);
    }
  }
  const skills=EXTENSIONS.find(e=>e.id==='santri-skills');
  assert.equal(skills.stores[0].url,'https://chromewebstore.google.com/detail/hcpecoheghikbjoeoaekcjfpeopcoboh');
  const code=EXTENSIONS.find(e=>e.id==='santri-code');
  assert.equal(code.identifier,'santriverse.santri-code');
  assert.deepEqual(code.stores.map(s=>s.label),['Open VSX','VS Code Marketplace']);
  // The editor extension's catalog version follows its manifest.
  assert.equal(code.version,require('../ide-extension/package.json').version);
});

test('only exact catalog store links are allowed out of the app',()=>{
  for(const bad of [
    'https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'http://open-vsx.org/extension/santriverse/santri-code',
    'https://user:pw@open-vsx.org/extension/santriverse/santri-code',
    'https://evil.example/extension/santriverse/santri-code',
    'https://open-vsx.org.evil.example/extension/santriverse/santri-code',
    'javascript:alert(1)',
    '',
    null,
  ])assert.equal(isExtensionLink(bad),false,String(bad));
});

test('dashboard serves the public extension catalog',async()=>{
  const server=createDashboardServer({cwd:ROOT});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const res=await fetch(origin+'/api/extensions');
    assert.equal(res.status,200);
    const body=await res.json();
    assert.deepEqual(body.extensions.map(e=>e.id),['santri-skills','santri-code']);
    assert.equal((await fetch(origin+'/api/extensions',{headers:{Origin:'https://evil.example'}})).status,403);
  }finally{
    server.closeAllConnections?.();
    await new Promise(r=>server.close(r));
  }
});

test('app mode opens catalog store links in the default browser only',async()=>{
  const opened=[];
  const server=desktop.attachBrowserLogin(createDashboardServer({cwd:ROOT}),{open:u=>opened.push(u),focus:()=>{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const post=(body,headers={})=>fetch(origin+'/__santrihub/open-link',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)});
  try{
    assert.match(await (await fetch(origin+'/__santrihub/desktop.js')).text(),/open-link/);
    const url=EXTENSIONS[1].stores[0].url;
    assert.equal((await post({url},{Origin:'https://evil.example'})).status,403);
    assert.equal((await post({url:'https://evil.example/'})).status,400);
    assert.equal((await post({url:'file:///C:/Windows/System32/calc.exe'})).status,400);
    assert.equal(opened.length,0);
    assert.equal((await post({url})).status,200);
    assert.deepEqual(opened,[url]);
  }finally{
    server.closeAllConnections?.();
    await new Promise(r=>server.close(r));
  }
});
