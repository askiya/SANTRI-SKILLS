'use strict';
// Assisted Gemini install: ZIP shaping, live premium verification, Gemini
// detection, and the page bridge exercised in real headless Chrome against a
// fixture that reads drops exactly like Gemini's Skills upload area.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { webcrypto } = require('node:crypto');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const zip = require('../extension/zip.js');

/** Minimal ZIP writer for fixtures: [{ path, data, store?, dir? }]. */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.path);
    const data = Buffer.from(f.data || '');
    const method = f.dir || f.store ? 0 : 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const SKILL = '---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n';
const text = (bytes) => new TextDecoder().decode(bytes);

// ── ZIP → Gemini Skill folder ──────────────────────────────────────────────

test('reads deflated and stored entries and keeps the folder layout', async () => {
  const archive = makeZip([
    { path: 'SKILL.md', data: SKILL },
    { path: 'references/', dir: true },
    { path: 'references/spec.md', data: '# Spec\n'.repeat(500) },
    { path: 'notes.txt', data: 'plain', store: true },
  ]);
  const pkg = zip.prepareSkillPackage(await zip.readZip(archive));
  assert.equal(pkg.name, 'demo-skill');
  assert.deepEqual(pkg.files.map(f => f.path).sort(), ['SKILL.md', 'notes.txt', 'references/spec.md']);
  assert.equal(text(pkg.files.find(f => f.path === 'references/spec.md').bytes), '# Spec\n'.repeat(500));
});

test('unwraps a single top folder and drops OS junk Gemini rejects', async () => {
  const archive = makeZip([
    { path: 'demo-skill/SKILL.md', data: SKILL },
    { path: 'demo-skill/references/a.md', data: 'A' },
    { path: 'demo-skill/.DS_Store', data: 'x' },
    { path: 'demo-skill/tool.pyc', data: 'x' },
    { path: '__MACOSX/demo-skill/._SKILL.md', data: 'x' },
  ]);
  const pkg = zip.prepareSkillPackage(await zip.readZip(archive));
  assert.deepEqual(pkg.files.map(f => f.path).sort(), ['SKILL.md', 'references/a.md']);
});

test('rejects unsafe paths, missing SKILL.md and non kebab-case names', async () => {
  await assert.rejects(async () => zip.prepareSkillPackage(await zip.readZip(makeZip([{ path: 'SKILL.md', data: SKILL }, { path: '../evil.md', data: 'x' }]))), /Path tidak aman/);
  await assert.rejects(async () => zip.prepareSkillPackage(await zip.readZip(makeZip([{ path: 'README.md', data: 'x' }]))), /SKILL\.md tidak ditemukan/);
  await assert.rejects(async () => zip.prepareSkillPackage(await zip.readZip(makeZip([{ path: 'SKILL.md', data: '---\nname: My Skill\n---\n' }]))), /kebab-case/);
  await assert.rejects(zip.readZip(Buffer.from('not a zip at all, definitely not')), /ZIP yang valid/);
});

// ── Premium verification (Santriverse API) ─────────────────────────────────

function loadAuth(fetchImpl, store) {
  const chrome = { runtime: { id: 'a'.repeat(32) }, storage: { session: {
    get: async keys => Object.fromEntries(keys.map(k => [k, store[k]])),
    set: async v => Object.assign(store, v),
    remove: async keys => keys.forEach(k => delete store[k]),
  } } };
  const module = { exports: {} };
  new Function('chrome', 'crypto', 'fetch', 'module', read('auth.js'))(chrome, webcrypto, fetchImpl, module);
  return module.exports;
}

test('verifyPremium asks the API and accepts a premium member', async () => {
  const store = { auth_token: 'scoped' };
  const calls = [];
  const auth = loadAuth(async (url, init) => { calls.push({ url, auth: init.headers.authorization }); return { ok: true, json: async () => ({ success: true, user: { name: 'Santri', is_premium: true } }) }; }, store);
  const session = await auth.verifyPremium();
  assert.equal(session.user.premium, true);
  assert.equal(calls[0].url, 'https://api.santriverse.my.id/api/skills/session');
  assert.equal(calls[0].auth, 'Bearer scoped');
});

test('verifyPremium blocks a lapsed membership and drops the session', async () => {
  const store = { auth_token: 'scoped' };
  const auth = loadAuth(async () => ({ ok: true, json: async () => ({ success: true, user: { name: 'Santri', is_premium: false } }) }), store);
  await assert.rejects(auth.verifyPremium(), e => e.code === 'premium_required');
  assert.equal(store.auth_token, undefined);
});

test('server premium_required responses surface as a premium gate, not a generic error', async () => {
  const store = { auth_token: 'scoped' };
  const auth = loadAuth(async () => ({ ok: false, status: 403, json: async () => ({ success: false, code: 'premium_required' }) }), store);
  await assert.rejects(auth.callAPI('/skills/catalog', { token: 'scoped' }), e => e.code === 'premium_required' && /Premium/.test(e.message));
  await assert.rejects(auth.downloadPackage({ id: 1, file_size: 1, sha256: '0'.repeat(64) }, 'scoped'), e => e.code === 'premium_required');
  await assert.rejects(auth.verifyPremium(), e => e.code === 'premium_required');
  assert.equal(store.auth_token, undefined);
});

test('install flow verifies premium before downloading anything', () => {
  const code = read('sidepanel.js');
  const install = code.slice(code.indexOf('async function installItem'));
  assert.ok(install.indexOf('verifyPremium()') > 0);
  assert.ok(install.indexOf('verifyPremium()') < install.indexOf('downloadPackage('));
});

// ── Gemini page scripts ─────────────────────────────────────────────────────

function loadDetector({ pathname = '/skills', body = '', inputs = [], buttons = [] } = {}) {
  let listener;
  const ctx = {
    module: { exports: {} }, console, setTimeout, clearTimeout, crypto: webcrypto, atob, URL,
    location: { pathname, origin: 'https://gemini.google.com' },
    window: { addEventListener() {}, removeEventListener() {}, postMessage() {} },
    document: {
      body: { innerText: body },
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'input, textarea' ? inputs : sel === 'button' ? buttons : []),
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  };
  vm.runInNewContext(read('gemini-skills.js'), ctx);
  const ask = (msg) => new Promise(resolve => listener(msg, {}, resolve));
  return { ask, exports: ctx.module.exports };
}

test('detection reports only exact skill names Gemini lists', async () => {
  const { ask } = loadDetector({ body: 'Aktif\nsantriman-gas-webapp-builder\nBuild...\ndemo-skill-pro\nDisarankan' });
  const state = await ask({ type: 'skills:detect', names: ['santriman-gas-webapp-builder', 'demo-skill', 'Bad Name'] });
  assert.deepEqual([...state.present], ['santriman-gas-webapp-builder']);
  assert.equal(state.onSkillsPage, true);
  assert.equal(state.reviewOpen, false);
});

test('a skill still under review is not reported as created', async () => {
  const create = { innerText: 'Buat', offsetParent: {} };
  const { ask } = loadDetector({ inputs: [{ value: 'demo-skill' }], buttons: [create] });
  const state = await ask({ type: 'skills:detect', names: ['demo-skill'] });
  assert.deepEqual([...state.present], ['demo-skill']);
  assert.equal(state.reviewOpen, true);
});

test('detection is silent outside the Skills page and install refuses to run there', async () => {
  const { ask } = loadDetector({ pathname: '/app', body: 'demo-skill' });
  assert.deepEqual(JSON.parse(JSON.stringify((await ask({ type: 'skills:detect', names: ['demo-skill'] })).present)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(await ask({ type: 'skills:install', root: 'demo-skill', files: [] }))), { ok: false, stage: 'navigate' });
});

test('extension never presses Create for the member', () => {
  for (const file of ['gemini-skills.js', 'gemini-skills-bridge.js', 'gemini-adapter.js', 'sidepanel.js']) {
    const code = read(file);
    assert.doesNotMatch(code, /CREATE_LABELS[^;\n]*\.click\(/, file);
    assert.doesNotMatch(code, /['"](Buat|Create)['"]\)?\.click/, file);
  }
  assert.doesNotMatch(read('gemini-skills-bridge.js'), /\.click\(/);
});

test('manifest runs the bridge in the page world on Gemini only, with no new permissions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const bridge = manifest.content_scripts.find(cs => cs.js.includes('gemini-skills-bridge.js'));
  assert.equal(bridge.world, 'MAIN');
  assert.deepEqual(bridge.matches, ['https://gemini.google.com/*']);
  assert.deepEqual(manifest.permissions.sort(), ['identity', 'sidePanel', 'storage']);
  assert.ok(manifest.content_scripts.some(cs => cs.js.includes('gemini-skills.js') && !cs.world));
});

// ── Bridge in real Chrome ───────────────────────────────────────────────────

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

// Reads a drop the way Gemini's upload area does: webkitGetAsEntry + recursive readers.
const FIXTURE = `<!doctype html><body><mat-dialog-container><div class="upload-area" style="width:300px;height:200px"></div></mat-dialog-container>
<script>
window.__received = null;
const area = document.querySelector('.upload-area');
area.addEventListener('dragover', e => e.preventDefault());
area.addEventListener('drop', async e => {
  e.preventDefault();
  const roots = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry());
  const out = [];
  async function walk(entry) {
    if (!entry) return;
    if (entry.isFile) { const f = await new Promise((ok, no) => entry.file(ok, no)); out.push([entry.fullPath, await f.text(), f.type]); return; }
    const reader = entry.createReader();
    for (;;) { const batch = await new Promise(ok => reader.readEntries(ok)); if (!batch.length) break; for (const c of batch) await walk(c); }
  }
  for (const r of roots) await walk(r);
  window.__received = out.sort();
});
</script>`;

test('bridge drops a whole skill folder that a Gemini-style reader accepts', { skip: !CHROME, timeout: 60000 }, async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-bridge-'));
  const port = 32000 + Math.floor(Math.random() * 1000);
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${home}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(p => p.type === 'page'); } catch {}
      if (!page) await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(page, 'Chrome CDP ready');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { const [r, j] = pending.get(m.id); pending.delete(m.id); m.error ? j(new Error(m.error.message)) : r(m.result); } };
    const call = (method, params = {}) => new Promise((r, j) => { pending.set(++id, [r, j]); ws.send(JSON.stringify({ id, method, params })); });
    const run = async (expression) => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value; };

    await call('Page.enable');
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/skills` });
    for (let i = 0; i < 100 && !(await run("!!document.querySelector('.upload-area')")); i++) await new Promise(r => setTimeout(r, 50));
    await run(read('gemini-skills-bridge.js'));

    const send = (payload) => run(`new Promise(resolve => {
      addEventListener('message', function on(e) { if (e.data && e.data.source === 'santri-skills-bridge' && e.data.id === ${JSON.stringify(payload.id)}) { removeEventListener('message', on); resolve(e.data); } });
      const enc = s => new TextEncoder().encode(s).buffer;
      postMessage({ source: 'santri-skills', type: 'drop', id: ${JSON.stringify(payload.id)}, areaSelector: 'mat-dialog-container .upload-area', root: ${JSON.stringify(payload.root)},
        files: ${JSON.stringify(payload.files)}.map(f => ({ path: f[0], buffer: enc(f[1]) })) }, location.origin);
    })`);

    const reply = await send({ id: 'ok-1', root: 'demo-skill', files: [['SKILL.md', SKILL], ['references/spec.md', '# Spec'], ['references/deep/x.txt', 'deep']] });
    assert.equal(reply.ok, true);
    let received;
    for (let i = 0; i < 100 && !(received = await run('window.__received')); i++) await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(received, [
      ['/demo-skill/SKILL.md', SKILL, 'text/markdown'],
      ['/demo-skill/references/deep/x.txt', 'deep', 'text/plain'],
      ['/demo-skill/references/spec.md', '# Spec', 'text/markdown'],
    ]);

    const bad = await send({ id: 'bad-1', root: '../escape', files: [['SKILL.md', SKILL]] });
    assert.equal(bad.ok, false);

    await new Promise(r => setTimeout(r, 2300));
    assert.equal(await run("DataTransferItem.prototype.webkitGetAsEntry.toString().includes('[native code]')"), true, 'page API restored');
  } finally {
    ws?.close();
    proc.kill();
    server.close();
  }
});
