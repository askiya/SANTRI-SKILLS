'use strict';
// Guards the member path end to end: PKCE login, server consent, package download.
// Pure-module checks against real extension sources; no Chrome runtime required.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.join(__dirname,'..','extension');
const read=f=>fs.readFileSync(path.join(dir,f),'utf8');

function load(){
  const ctx={console,URL,URLSearchParams,TextEncoder,Blob,Error,btoa,AbortSignal,fetch:null,chrome:null,crypto:null,module:{exports:{}},globalThis:{}};
  ctx.globalThis=ctx;
  vm.createContext(ctx);
  for(const file of ['auth.js','consent.js']){
    const exports={};ctx.module={exports};
    vm.runInContext(read(file),ctx,{filename:file});
    Object.assign(ctx,ctx.module.exports);
  }
  return ctx;
}

test('login exchanges the PKCE ticket and stores only a session-scoped token',async()=>{
  const ctx=load();
  const store={};
  let authUrl='';
  const digest=new Uint8Array(32).fill(7);
  ctx.crypto={getRandomValues:a=>{a.fill(3);return a},subtle:{digest:async()=>digest.buffer}};
  ctx.chrome={runtime:{id:'a'.repeat(32)},identity:{
    getRedirectURL:()=>`https://${'a'.repeat(32)}.chromiumapp.org/`,
    launchWebAuthFlow:async({url,interactive})=>{authUrl=url;assert.equal(interactive,true);
      const state=new URL(url).searchParams.get('state');
      return `https://${'a'.repeat(32)}.chromiumapp.org/#state=${state}&ticket=${'T'.repeat(64)}`}},
    storage:{session:{set:async v=>Object.assign(store,v),get:async k=>Object.fromEntries(k.map(x=>[x,store[x]])),remove:async k=>k.forEach(x=>delete store[x])}}};
  let exchanged=null;
  ctx.fetch=async(url,init)=>{exchanged={url,body:JSON.parse(init.body)};
    return {ok:true,status:200,json:async()=>({success:true,token:'scoped-token',user:{name:'Member',is_premium:true}})}};

  const user=await ctx.login();
  assert.equal(user.premium,true);
  const sent=new URL(authUrl);
  assert.equal(sent.origin+sent.pathname,'https://santriverse.my.id/skills/connect');
  assert.equal(sent.searchParams.get('code_challenge_method'),'S256');
  assert.equal(exchanged.url,'https://api.santriverse.my.id/api/skills/session');
  assert.equal(exchanged.body.ticket,'T'.repeat(64));
  assert.match(exchanged.body.code_verifier,/^[A-Za-z0-9_-]+$/);
  assert.equal(store.auth_token,'scoped-token');
  assert.equal('auth_password' in store,false);
});

test('login refuses a ticket returned with a mismatched state',async()=>{
  const ctx=load();
  ctx.crypto={getRandomValues:a=>{a.fill(3);return a},subtle:{digest:async()=>new Uint8Array(32).buffer}};
  ctx.chrome={runtime:{id:'a'.repeat(32)},identity:{
    getRedirectURL:()=>`https://${'a'.repeat(32)}.chromiumapp.org/`,
    launchWebAuthFlow:async()=>`https://${'a'.repeat(32)}.chromiumapp.org/#state=deadbeef&ticket=${'T'.repeat(64)}`},
    storage:{session:{set:async()=>{},get:async()=>({}),remove:async()=>{}}}};
  ctx.fetch=async()=>{throw new Error('exchange must not run')};
  await assert.rejects(ctx.login(),/State login tidak cocok/);
});

test('consent acceptance is server owned and replays the server version',async()=>{
  const ctx=load();
  ctx.setConsent({version:'2026-10-07',required:true});
  let sent=null;
  ctx.fetch=async(url,init)=>{sent={url,body:JSON.parse(init.body),auth:init.headers.authorization};
    return {ok:true,status:200,json:async()=>({success:true,consent:{version:'2026-10-07',required:false}})}};
  const consent=await ctx.acceptConsent('scoped-token');
  assert.equal(sent.url,'https://api.santriverse.my.id/api/skills/consent');
  assert.deepEqual(sent.body,{version:'2026-10-07',accepted:true});
  assert.equal(sent.auth,'Bearer scoped-token');
  assert.equal(consent.required,false);
});

test('package download rejects tampered size or hash before handing bytes to the member',async()=>{
  const ctx=load();
  const bytes=new TextEncoder().encode('santriverse-package');
  const sha='8'.repeat(64);
  ctx.crypto={subtle:{digest:async()=>Uint8Array.from({length:32},()=>0x88).buffer}};
  ctx.fetch=async()=>({ok:true,status:200,arrayBuffer:async()=>bytes.buffer});
  const good=await ctx.downloadPackage({id:1,file_size:bytes.byteLength,sha256:sha},'scoped-token');
  assert.equal(good.type,'application/zip');
  await assert.rejects(ctx.downloadPackage({id:1,file_size:bytes.byteLength+1,sha256:sha},'t'),/Ukuran paket tidak cocok/);
  await assert.rejects(ctx.downloadPackage({id:1,file_size:bytes.byteLength,sha256:'0'.repeat(64)},'t'),/Hash paket tidak cocok/);
});

test('expired stored session is dropped instead of being reused',async()=>{
  const ctx=load();
  const store={auth_token:'old',auth_user:{name:'Member'},auth_expires:Date.now()-1};
  ctx.chrome={storage:{session:{set:async v=>Object.assign(store,v),get:async k=>Object.fromEntries(k.map(x=>[x,store[x]])),remove:async k=>k.forEach(x=>delete store[x])}}};
  assert.equal(await ctx.getSession(),null);
  assert.equal('auth_token' in store,false);
});
