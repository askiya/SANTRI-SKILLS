'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const root = path.join(__dirname, '../extension');

function load(name, chrome = {}) {
  const module = { exports: {} };
  new Function('chrome', 'crypto', 'module', fs.readFileSync(path.join(root, name), 'utf8'))(chrome, webcrypto, module);
  return module.exports;
}

test('expired browser session clears token',async()=>{let removed=false;const auth=load('auth.js',{storage:{session:{get:async()=>({auth_token:'test',auth_expires:Date.now()-1}),remove:async()=>{removed=true}}}});assert.equal(await auth.getSession(),null);assert.equal(removed,true);});

test('browser WebCrypto produces real S256', async () => {
  const auth = load('auth.js', {runtime:{id:'abc'}});
  const x = await auth.buildLoginURL('https://abc.chromiumapp.org/');
  assert.equal(
    new URL(x.url).searchParams.get('code_challenge'),
    createHash('sha256').update(x.verifier).digest('base64url')
  );
});

test('login exchanges PKCE ticket and restores server session', async () => {
  const stored = {};
  const chrome = {runtime:{id:'a'.repeat(32)},storage:{session:{set:async x=>Object.assign(stored,x),get:async()=>stored,remove:async keys=>keys.forEach(k=>delete stored[k])}},identity:{getRedirectURL:()=>`https://${'a'.repeat(32)}.chromiumapp.org/`,launchWebAuthFlow:async ({url})=>{const u=new URL(url);return `${u.searchParams.get('callback')}#state=${u.searchParams.get('state')}&ticket=${'t'.repeat(64)}`;}}};
  const calls=[];
  const module={exports:{}};
  new Function('chrome','crypto','fetch','module',fs.readFileSync(path.join(root,'auth.js'),'utf8'))(chrome,webcrypto,async (url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({success:true,token:'scoped-test-token',user:{name:'Member',is_premium:true}})};},module);
  const auth=module.exports;
  assert.equal((await auth.login()).premium,true);
  assert.equal(stored.auth_token,'scoped-test-token');
  const body=JSON.parse(calls[0].opts.body);
  assert.equal(body.ticket,'t'.repeat(64));
  assert.match(body.code_verifier,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await auth.restoreSession()).premium,true);
  await auth.revokeSession();
  assert.equal(calls.at(-1).opts.method,'DELETE');
  assert.equal(stored.auth_token,undefined);
});

test('background rejects messages from Gemini content scripts', async () => {
  let listener;
  const requests = [];
  const chrome = {
    runtime: {
      id: 'abc',
      getURL: p => 'chrome-extension://abc/' + p,
      onInstalled: { addListener() {} },
      onMessage: { addListener(fn) { listener = fn; } },
    },
    action: { onClicked: { addListener() {} } },
    sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
    tabs: { create: async x => ({ id: 1, url: x.url }) },
  };
  // vm sandbox needs globals that background.js uses
  const sandbox = { chrome, URL, AbortSignal, fetch: async (url) => { requests.push(url); return { status: 401 }; }, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), sandbox);

  const result = await new Promise(resolve => listener({ type: 'auth_start' }, { id: 'abc', url: 'chrome-extension://abc/sidepanel.html' }, resolve));
  assert.equal(result.ok, false);
  assert.equal(requests.length, 0);
});

test('content script only reports navigation, never claims package state', () => {
  let listener;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'content.js'), 'utf8'), {
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    location: { href: 'https://gemini.google.com/app' },
    document: { title: 'Gemini' },
  });
  let reply;
  listener({ type: 'get_page_info' }, {}, x => reply = x);
  assert.deepEqual(Object.keys(reply).sort(), ['title', 'url']);
});

test('panel reports unavailable package endpoint rather than fabricating download',()=>{const code=fs.readFileSync(path.join(root,'sidepanel.js'),'utf8');assert.match(code,/Paket belum tersedia/);assert.match(code,/downloadPackage/);assert.doesNotMatch(code,/github\.com/);});

test('Gemini URL uses /app and manual steps are honest', () => {
  const adapter = load('gemini-adapter.js');
  assert.equal(adapter.GEMINI_SKILLS_URL, 'https://gemini.google.com/app');
  const steps = adapter.getManualSteps('skill');
  assert.ok(steps.length >= 3);
  // No step should claim automatic upload
  const joined = steps.join(' ');
  assert.ok(!joined.includes('otomatis'));
  assert.ok(joined.includes('manual') || joined.includes('Download') || joined.includes('Review'));
});
