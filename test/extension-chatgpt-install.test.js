'use strict';
// "Pasang ke ChatGPT": plugin packaging, page detection, manifest wiring, and
// the real content script driven in headless Chrome against a fixture that
// mimics chatgpt.com/plugins (+ → Upload plugin → Import successful → View).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const plugin = require('../extension/chatgpt-plugin.js');
const zip = require('../extension/zip.js');

const enc = (s) => new TextEncoder().encode(s);
const SKILL = { name: 'demo-skill', files: [
  { path: 'SKILL.md', bytes: enc('---\nname: demo-skill\ndescription: Demo.\n---\n\n# Demo\n') },
  { path: 'references/spec.md', bytes: enc('# Spec\nPENANDA-123\n') },
] };
const ITEM = { title: 'Demo Skill', version: '1.2.0', description: 'Bantu merancang aplikasi lewat tiga fase. Kalimat kedua tidak masuk ringkasan.' };

test('plugin ZIP uses the portable layout ChatGPT imports', async () => {
  const logo = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const out = plugin.buildChatGptPlugin(SKILL, ITEM, logo);
  assert.equal(out.fileName, 'demo-skill-1.2.0-chatgpt-plugin.zip');
  const entries = await zip.readZip(out.zip);
  assert.deepEqual(entries.map(e => e.path), ['plugin.json', 'skills/demo-skill/SKILL.md', 'skills/demo-skill/references/spec.md', 'assets/logo.png']);
  const manifest = JSON.parse(new TextDecoder().decode(entries[0].bytes));
  assert.equal(manifest.$schema, plugin.PLUGIN_SCHEMA);
  assert.equal(manifest.name, 'demo-skill');
  assert.equal(manifest.version, '1.2.0');
  const ui = manifest.extensions['com.openai'].interface;
  assert.equal(ui.displayName, 'Demo Skill');
  assert.equal(ui.shortDescription, 'Bantu merancang aplikasi lewat tiga fase.');
  assert.equal(ui.developerName, 'Santriverse');
  assert.equal(ui.logo, './assets/logo.png');
  assert.equal(new TextDecoder().decode(entries[2].bytes), '# Spec\nPENANDA-123\n');
});

test('ZIP writer produces valid CRC-32 checksums', () => {
  for (const s of ['', 'a', 'Santriverse', 'x'.repeat(10000)]) assert.equal(plugin.crc32(enc(s)), zlib.crc32(Buffer.from(s)));
  const out = plugin.buildChatGptPlugin(SKILL, ITEM, null);
  // Local file header signature + no logo entry when none is supplied.
  assert.deepEqual([...out.zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(out.manifest.extensions['com.openai'].interface.logo, undefined);
});

test('manifest rejects non kebab-case names and clamps long descriptions', () => {
  assert.throws(() => plugin.pluginManifest({ name: 'Demo Skill', title: 'x' }), /kebab-case/);
  const long = plugin.pluginManifest({ name: 'demo', title: 'Demo', version: 'bad version!', description: 'x'.repeat(500) });
  assert.ok(long.description.length <= 100);
  assert.equal(long.version, '1.0.0');
});

function loadState(pathname, buttons) {
  let listener;
  const ctx = {
    module: { exports: {} }, console, setTimeout, clearTimeout, atob, URL, PointerEvent: class {}, Event: class {},
    location: { pathname },
    document: {
      body: {}, querySelector: (sel) => (sel === 'main' ? { querySelectorAll: () => buttons, querySelector: () => ({ innerText: 'Demo Skill' }) } : null),
      querySelectorAll: () => [],
    },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  };
  vm.runInNewContext(read('chatgpt-plugins.js'), ctx);
  return (msg) => new Promise(resolve => listener(msg, {}, resolve));
}

test('plugin page state: install offered until the member installs', async () => {
  const before = await loadState('/plugins/Plugin_abc123', [{ innerText: 'Instal Plugin' }])({ type: 'chatgpt:state' });
  assert.equal(before.pluginId, 'Plugin_abc123');
  assert.equal(before.installOffered, true);
  const after = await loadState('/plugins/Plugin_abc123', [{ innerText: 'Coba di chat' }])({ type: 'chatgpt:state' });
  assert.equal(after.installOffered, false);
  const english = await loadState('/plugins/Plugin_abc123', [{ innerText: 'Install plugin' }])({ type: 'chatgpt:state' });
  assert.equal(english.installOffered, true);
  const away = await loadState('/c/123', [])({ type: 'chatgpt:upload', fileName: 'x.zip', data: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(away)), { ok: false, stage: 'navigate' });
});

test('extension never presses "Install plugin" for the member', () => {
  const code = read('chatgpt-plugins.js');
  assert.doesNotMatch(code, /installPlugin[^\n]*\.click\(/);
  assert.doesNotMatch(read('chatgpt-adapter.js'), /\.click\(/);
});

test('manifest: ChatGPT host + content script, no extra Chrome permissions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.host_permissions.includes('https://chatgpt.com/*'));
  assert.ok(manifest.content_scripts.some(cs => cs.js.includes('chatgpt-plugins.js') && cs.matches.includes('https://chatgpt.com/*') && !cs.world));
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'identity', 'sidePanel', 'storage']);
  const html = read('sidepanel.html');
  assert.ok(html.indexOf('chatgpt-plugin.js') > html.indexOf('zip.js'));
  assert.ok(html.includes('chatgpt-adapter.js'));
});

test('side panel offers "Pasang ke ChatGPT" and verifies premium first', () => {
  const card = require('../extension/catalog.js').renderCard({ id: 1, title: 'Demo', type: 'skill', description: 'x' });
  assert.ok(card.includes('data-action="install-chatgpt"'));
  assert.ok(card.includes('Pasang ke ChatGPT'));
  const code = read('sidepanel.js');
  const install = code.slice(code.indexOf('async function installItem'));
  assert.ok(install.indexOf('verifyPremium()') < install.indexOf('downloadPackage('));
  assert.match(install, /assistChatGptInstall\(plugin\)/);
});

// ── Real content script in headless Chrome ─────────────────────────────────

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

const FIXTURE = `<!doctype html><html><body><main id="main">
<h1>Plugin</h1><button aria-label="Tambahkan plugin" id="add">+</button>
</main><div id="menu"></div><div id="dialog-host"></div>
<script>
window.__uploaded = null;
const add = document.getElementById('add');
add.addEventListener('pointerdown', () => {
  document.getElementById('menu').innerHTML = '<div role="menu"><div role="menuitem" id="create">Buat plugin</div><div role="menuitem" id="upload">Unggah plugin</div></div>';
  document.getElementById('upload').addEventListener('click', openDialog);
});
add.addEventListener('click', () => {}); // a real Radix trigger would toggle here
function openDialog() {
  document.getElementById('menu').innerHTML = '';
  document.getElementById('dialog-host').innerHTML = '<div role="dialog"><h2>Plugin Baru</h2><p>Hanya arsip .tar.gz, .tgz, dan .zip yang didukung.</p><input type="file" accept=".tar.gz,.tgz,.zip" style="display:none"><span id="status"></span></div>';
  const input = document.querySelector('[role=dialog] input');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    const bytes = new Uint8Array(await file.arrayBuffer());
    window.__uploaded = { name: file.name, size: bytes.length, pk: bytes[0] === 0x50 && bytes[1] === 0x4b, hasManifest: new TextDecoder().decode(bytes).includes('plugin.json') };
    document.getElementById('status').textContent = 'Mengunggah…';
    setTimeout(() => {
      document.getElementById('status').textContent = 'Impor berhasil';
      const view = document.createElement('button'); view.textContent = 'Lihat Plugin';
      view.addEventListener('click', () => {
        history.pushState({}, '', '/plugins/Plugin_abc123');
        document.getElementById('dialog-host').innerHTML = '';
        document.getElementById('main').innerHTML = '<h1>Demo Skill</h1><button id="install">Instal Plugin</button>';
        document.getElementById('install').addEventListener('click', () => { document.getElementById('install').textContent = 'Coba di chat'; });
      });
      document.querySelector('[role=dialog]').appendChild(view);
    }, 600);
  });
}
</script></body></html>`;

test('content script uploads through the dialog and lands on the plugin page', { skip: !CHROME, timeout: 60000 }, async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-chatgpt-'));
  const port = 33000 + Math.floor(Math.random() * 1000);
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
    await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/plugins` });
    for (let i = 0; i < 100 && !(await run("!!document.getElementById('add')")); i++) await new Promise(r => setTimeout(r, 50));
    // Load the real content script with a stub runtime that exposes its listener.
    await run(`(new Function('chrome', ${JSON.stringify(read('chatgpt-plugins.js'))}))({ runtime: { onMessage: { addListener(fn) { window.__listener = fn; } } } }); 'loaded'`);

    const built = plugin.buildChatGptPlugin(SKILL, ITEM, null);
    const data = Buffer.from(built.zip).toString('base64');
    const ask = (msg) => run(`new Promise(resolve => window.__listener(${JSON.stringify(msg)}, {}, resolve))`);

    const result = await ask({ type: 'chatgpt:upload', fileName: built.fileName, data });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.stage, 'imported');
    assert.equal(result.pluginId, 'Plugin_abc123');
    assert.equal(result.installOffered, true);
    const uploaded = await run('window.__uploaded');
    assert.deepEqual(uploaded, { name: 'demo-skill-1.2.0-chatgpt-plugin.zip', size: built.zip.length, pk: true, hasManifest: true });

    await run("document.getElementById('install').click()"); // the member's click
    const state = await ask({ type: 'chatgpt:state' });
    assert.equal(state.installOffered, false);
  } finally {
    ws?.close();
    proc.kill();
    server.close();
  }
});
