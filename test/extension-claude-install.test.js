'use strict';
// Assisted Claude install: the content script fills claude.ai's own "Upload a
// skill" form and stops before Upload; detection reads Claude's skill list.
// The real-Chrome test uses a fixture mirroring claude.ai as inspected on
// 31 Oct 2026 (/customize/skills/new/upload).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');
const claude = require('../extension/claude-skill.js');
const adapter = require('../extension/claude-adapter.js');
const zip = require('../extension/zip.js');

const enc = (t) => new TextEncoder().encode(t);
const SKILL = { name: 'demo-skill', files: [
  { path: 'SKILL.md', bytes: enc('---\nname: demo-skill\ndescription: Builds demo web apps.\n---\n# Demo\n') },
  { path: 'references/spec.md', bytes: enc('# Spec') },
] };

test('panel goes straight to Claude\'s Upload skill page and reuses Skills tabs only', () => {
  assert.equal(adapter.CLAUDE_UPLOAD_URL, 'https://claude.ai/customize/skills/new/upload');
  assert.equal(adapter.CLAUDE_TABS, 'https://claude.ai/customize/skills*');
  assert.match(read('claude-adapter.js'), /chrome\.tabs\.query\(\{ url: CLAUDE_TABS \}\)/);
});

test('install wizard handles Claude: premium first, Claude ZIP, member presses Upload', () => {
  const code = read('sidepanel.js');
  const install = code.slice(code.indexOf('async function installItem'));
  assert.ok(install.indexOf('verifyPremium()') < install.indexOf('downloadPackage('));
  assert.match(install, /if \(target === 'claude'\) claudePkg = buildClaudeZip\(skill, item\)/);
  assert.match(install, /assistClaudeInstall\(claudePkg\)/);
  assert.match(install, /waitUntilClaudeInstalled\(result\.tabId, skill\.name\)/);
  assert.match(code, /'install-claude': 'claude'/);
  assert.match(code, /PASANG KE CLAUDE/);
});

test('extension never presses Claude\'s Upload button', () => {
  for (const file of ['claude-skills.js', 'claude-adapter.js', 'sidepanel.js']) {
    const code = read(file);
    assert.doesNotMatch(code, /claudeUploadButton\(\)\s*\??\.click/, file);
    assert.doesNotMatch(code, /button\.click\(\)/, file);
  }
});

test('Claude content script refuses bad payloads and stays quiet off the Skills pages', async () => {
  let listener;
  const ctx = {
    location: { pathname: '/chat/abc' },
    document: { querySelector: () => null, querySelectorAll: () => [], body: { innerText: '' } },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
    module: { exports: {} }, setTimeout, clearTimeout, atob,
  };
  require('node:vm').runInNewContext(read('claude-skills.js'), ctx);
  const ask = (msg) => new Promise(resolve => listener(msg, {}, resolve));
  assert.equal((await ask({ type: 'claude:upload', fileName: 'x.exe', data: 'UEs=' })).detail, 'payload');
  assert.deepEqual(JSON.parse(JSON.stringify(await ask({ type: 'claude:upload', fileName: 'a.zip', data: 'UEs=' }))), { ok: false, stage: 'navigate' });
  const state = await ask({ type: 'claude:state', names: ['demo-skill'] });
  assert.equal(state.onSkillsPages, false);
  assert.deepEqual([...state.present], []);
});

// ── Content script in real Chrome ───────────────────────────────────────────

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);

// Mirrors claude.ai's upload page: static hints that mention "must include",
// a hidden "Skill file" input, Upload disabled until a valid file is chosen,
// a visible error line for a bad file, and the Yours list after Upload.
const FIXTURE = `<!doctype html><body><main id="main">
<h1>Upload a skill</h1><p>Add a skill to your workspace. A security scan runs when you upload.</p>
<h2>Skill file</h2>
<button type="button" id="zone">Drag and drop skill files here, or browse — you can add several at once</button>
<input type="file" aria-label="Skill file" accept=".zip,.skill,.md" multiple hidden>
<ul><li>.md file must contain skill name and description formatted in YAML</li><li>.zip or .skill file must include a SKILL.md file</li></ul>
<div id="chosen"></div>
<p>Security scan</p><p>Runs when you upload</p>
<button type="button" id="upload" disabled>Upload</button><button type="button">Cancel</button>
<p id="hint">Choose a file to continue.</p>
</main>
<script>
const input = document.querySelector('input[type=file]');
input.addEventListener('change', async () => {
  const f = input.files[0];
  const bytes = new Uint8Array(await f.arrayBuffer());
  window.__chosen = { name: f.name, size: f.size, data: btoa(String.fromCharCode(...bytes)) };
  const ok = f.name.endsWith('.zip') && bytes[0] === 0x50 && bytes[1] === 0x4b && !f.name.startsWith('bad');
  document.getElementById('chosen').textContent = ok ? f.name : 'Invalid skill file: SKILL.md not found';
  document.getElementById('upload').disabled = !ok;
  document.getElementById('hint').textContent = ok ? '' : 'Choose a file to continue.';
});
document.getElementById('upload').addEventListener('click', () => {
  history.pushState({}, '', '/customize/skills/yours');
  document.getElementById('main').innerHTML = '<h1>Skills</h1><button aria-label="View demo-skill">demo-skill</button><button aria-label="View skill-creator">skill-creator</button>';
});
</script>`;

test('content script fills the Skill file input and stops at Claude\'s Upload button', { skip: !CHROME, timeout: 60000 }, async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(FIXTURE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-claude-'));
  const port = 35000 + Math.floor(Math.random() * 1000);
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
    const load = async () => {
      await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/customize/skills/new/upload` });
      for (let i = 0; i < 100 && !(await run("!!document.getElementById('upload')")); i++) await new Promise(r => setTimeout(r, 50));
      await run(`(new Function('chrome', ${JSON.stringify(read('claude-skills.js'))}))({ runtime: { onMessage: { addListener(fn) { window.__listener = fn; } } } }); 'loaded'`);
    };
    const ask = (msg) => run(`new Promise(resolve => window.__listener(${JSON.stringify(msg)}, {}, resolve))`);
    await call('Page.enable');

    // A file Claude rejects is reported as rejected, not as ready.
    await load();
    const bad = await ask({ type: 'claude:upload', fileName: 'bad-skill.zip', data: Buffer.from('PK not really').toString('base64') });
    assert.equal(bad.stage, 'rejected', JSON.stringify(bad));
    assert.match(bad.detail, /Invalid skill file/);

    // The real ZIP: the form is filled and the extension stops at Upload.
    await load();
    const pkg = claude.buildClaudeZip(SKILL, { version: '1.0.0' });
    const result = await ask({ type: 'claude:upload', fileName: pkg.fileName, data: Buffer.from(pkg.zip).toString('base64') });
    assert.deepEqual(result, { ok: true, stage: 'ready' });
    const chosen = await run('window.__chosen');
    assert.equal(chosen.name, 'demo-skill-1.0.0-claude.zip');
    const entries = await zip.readZip(Buffer.from(chosen.data, 'base64'));
    assert.deepEqual(entries.map(e => e.path), ['demo-skill/SKILL.md', 'demo-skill/references/spec.md']);
    assert.equal(await run("location.pathname"), '/customize/skills/new/upload', 'Upload not pressed');

    let state = await ask({ type: 'claude:state', names: ['demo-skill'] });
    assert.equal(state.onUploadPage, true);
    assert.deepEqual(state.present, []);

    await run("document.getElementById('upload').click()"); // the member's click
    state = await ask({ type: 'claude:state', names: ['demo-skill', 'other-skill'] });
    assert.equal(state.onUploadPage, false);
    assert.equal(state.onSkillsPages, true);
    assert.deepEqual(state.present, ['demo-skill']);
  } finally {
    ws?.close();
    proc.kill();
    server.close();
  }
});
