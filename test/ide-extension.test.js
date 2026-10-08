'use strict';
const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const Module = require('node:module');

const IDE = path.join(__dirname, '../ide-extension');
const { createPkce, connectUrl, safeEqual } = require('../ide-extension/src/pkce');
const { startLoopback } = require('../ide-extension/src/loopback');
const { createClient, ApiError, isAllowedBaseUrl } = require('../ide-extension/src/api');
const { followRun, progressLabel } = require('../ide-extension/src/chat-run');
const { parseDocuments, fileNameFor, draftDocument } = require('../ide-extension/src/documents');
const { createLogoResolver } = require('../ide-extension/src/logos');
const { formatContext, composeMessage, splitMessage, visibleEntry, MAX_MESSAGE } = require('../ide-extension/src/context');
const markdown = require('../ide-extension/media/markdown.js');
const { buildIdeExtension } = require('../scripts/build-ide-extension');

const realFetch = globalThis.fetch;
const STATE = 'a'.repeat(64);
const TICKET = 'T'.repeat(64);

function jsonResponse(status, body) {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('pkce', () => {
  test('verifier, S256 challenge and 64-hex state', () => {
    const p = createPkce();
    assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
    const expected = crypto.createHash('sha256').update(p.verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(p.challenge, expected);
    assert.match(p.state, /^[0-9a-f]{64}$/);
    assert.notEqual(createPkce().state, p.state);
  });

  test('connect URL asks for client=code with a canonical loopback callback', () => {
    const url = new URL(connectUrl('https://santriverse.my.id', { port: 51234, state: STATE, challenge: 'c'.repeat(43) }));
    assert.equal(url.origin + url.pathname, 'https://santriverse.my.id/skills/connect');
    assert.equal(url.searchParams.get('callback'), 'http://127.0.0.1:51234/auth/callback');
    assert.equal(url.searchParams.get('client'), 'code');
    assert.equal(url.searchParams.get('state'), STATE);
    assert.equal(url.searchParams.get('code_challenge'), 'c'.repeat(43));
  });

  test('safeEqual compares exactly', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual(undefined, ''), true);
  });
});

describe('loopback login receiver', () => {
  const post = (port, body, headers = {}) => realFetch(`http://127.0.0.1:${port}/auth/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...headers },
    body: JSON.stringify(body),
  });

  test('serves a CSP-locked callback page and exchanges a matching ticket once', async () => {
    const seen = [];
    const flow = await startLoopback({ state: STATE, appName: 'VS Code', returnUrl: 'vscode://santriverse.santri-code/connected', exchange: async (t) => { seen.push(t); return { token: 'tok', user: { name: 'Santri' } }; } });
    const page = await realFetch(`http://127.0.0.1:${flow.port}/auth/callback`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
    assert.match(html, /vscode:\/\/santriverse\.santri-code\/connected/);
    assert.equal(page.headers.get('cache-control'), 'no-store');

    assert.equal((await post(flow.port, { state: STATE, ticket: TICKET }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(flow.port, { state: 'b'.repeat(64), ticket: TICKET })).status, 400);
    assert.equal((await post(flow.port, { state: STATE, ticket: 'short' })).status, 400);
    const ok = await post(flow.port, { state: STATE, ticket: TICKET });
    assert.deepEqual(await ok.json(), { ok: true });
    assert.deepEqual(await flow.result, { token: 'tok', user: { name: 'Santri' } });
    assert.deepEqual(seen, [TICKET]);
  });

  test('rejects foreign Host headers (DNS rebinding)', async () => {
    const flow = await startLoopback({ state: STATE, exchange: async () => ({}) });
    const http = require('node:http');
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: flow.port, path: '/auth/callback', headers: { Host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(status, 421);
    flow.close();
    await assert.rejects(flow.result, { code: 'login_cancelled' });
  });

  test('exchange failure is reported to the page and the caller', async () => {
    const flow = await startLoopback({ state: STATE, exchange: async () => { throw new ApiError('Santri Code khusus member Premium Santriverse.', { status: 403, code: 'premium_required' }); } });
    const res = await post(flow.port, { state: STATE, ticket: TICKET });
    assert.deepEqual(await res.json(), { ok: false, message: 'Santri Code khusus member Premium Santriverse.' });
    await assert.rejects(flow.result, { code: 'premium_required' });
  });

  test('times out when the member never approves', async () => {
    const flow = await startLoopback({ state: STATE, exchange: async () => ({}), timeoutMs: 30 });
    await assert.rejects(flow.result, { code: 'login_timeout' });
  });
});

describe('api client', () => {
  test('only https (or local http) base URLs are accepted', () => {
    assert.equal(isAllowedBaseUrl('https://api.santriverse.my.id/api'), true);
    assert.equal(isAllowedBaseUrl('http://localhost:8000/api'), true);
    assert.equal(isAllowedBaseUrl('http://evil.example/api'), false);
    assert.equal(isAllowedBaseUrl('https://user:pw@evil.example'), false);
    assert.throws(() => createClient({ baseUrl: 'http://evil.example/api', getToken: async () => 't' }), /https/);
  });

  test('sends bearer + idempotency key; exchange is unauthenticated', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, init }); return jsonResponse(200, { ok: 1 }); };
    const api = createClient({ baseUrl: 'https://api.santriverse.my.id/api/', getToken: async () => 'secret-token', fetchImpl, version: '0.1.0' });
    await api.send('c/1', 'ide-key', { message: 'hai', model_config_id: 'm' });
    await api.exchange(TICKET, 'v'.repeat(43));
    assert.equal(calls[0].url, 'https://api.santriverse.my.id/api/code/chats/c%2F1/send');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'ide-key');
    assert.equal(calls[0].init.headers['X-Santri-Client'], 'santri-code/0.1.0');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[1].url, 'https://api.santriverse.my.id/api/code/session');
    assert.equal(calls[1].init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[1].init.body), { ticket: TICKET, code_verifier: 'v'.repeat(43) });
  });

  test('maps server errors to member-friendly messages', async () => {
    const reply = (status, body) => createClient({ baseUrl: 'https://api.example/api', getToken: async () => 't', fetchImpl: async () => jsonResponse(status, body) });
    await assert.rejects(reply(403, { code: 'premium_required' }).bootstrap(), { status: 403, code: 'premium_required', message: /Premium/ });
    await assert.rejects(reply(401, { message: 'Unauthorized' }).bootstrap(), { status: 401, message: /Login ulang/ });
    await assert.rejects(reply(429, { code: 'FLOW_DAILY_CREDIT_LIMIT', message: 'Batas kredit AI Flow Studio hari ini sudah tercapai.' }).usage(), { message: /Batas kredit/ });
    await assert.rejects(reply(422, { errors: { message: ['Pesan terlalu panjang.'] } }).usage(), { message: 'Pesan terlalu panjang.' });
    await assert.rejects(reply(500, { message: 'Server Error' }).usage(), { message: /sedang bermasalah \(500\)/ });
    const offline = createClient({ baseUrl: 'https://api.example/api', getToken: async () => 't', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(offline.usage(), { code: 'network', status: 0 });
    const signedOut = createClient({ baseUrl: 'https://api.example/api', getToken: async () => null, fetchImpl: async () => jsonResponse(200, {}) });
    await assert.rejects(signedOut.usage(), { status: 401, code: 'signed_out' });
  });
});

describe('chat run polling', () => {
  const noSleep = async () => {};

  test('posts once, then polls until completed', async () => {
    const replies = [{ run: { status: 'running' } }, { run: { status: 'completed' }, assistant_message: { content: 'ok' } }];
    let sends = 0;
    const client = { send: async () => { sends++; return { run: { status: 'queued' } }; }, run: async () => replies.shift() };
    const updates = [];
    const data = await followRun({ client, chatId: 'c', key: 'k', body: {}, sleep: noSleep, onUpdate: (d) => updates.push(d.run.status) });
    assert.equal(data.assistant_message.content, 'ok');
    assert.equal(sends, 1);
    assert.deepEqual(updates, ['queued', 'running', 'completed']);
  });

  test('accepted runs never re-send; network blips and 5xx keep polling', async () => {
    const replies = [
      { run: { status: 'running' } },
      new ApiError('offline', { status: 0, code: 'network' }),
      new ApiError('boom', { status: 502 }),
      { run: { status: 'completed' } },
    ];
    const client = {
      send: async () => assert.fail('must not send'),
      run: async () => { const next = replies.shift(); if (next instanceof Error) throw next; return next; },
    };
    const data = await followRun({ client, chatId: 'c', key: 'k', accepted: true, sleep: noSleep });
    assert.equal(data.run.status, 'completed');
    assert.equal(replies.length, 0);

    const forbidden = { send: async () => ({ run: { status: 'queued' } }), run: async () => { throw new ApiError('nope', { status: 403 }); } };
    await assert.rejects(followRun({ client: forbidden, chatId: 'c', key: 'k', body: {}, sleep: noSleep }), { status: 403 });
  });

  test('terminal failure throws with the server code; transient failure with retry_after keeps waiting', async () => {
    const failing = { send: async () => ({ run: { status: 'failed' }, code: 'CHAT_AI_PROVIDER_FAILED', message: 'Provider gagal.' }), run: async () => assert.fail() };
    await assert.rejects(followRun({ client: failing, chatId: 'c', key: 'k', body: {}, sleep: noSleep }), { code: 'CHAT_AI_PROVIDER_FAILED', message: 'Provider gagal.' });

    const waits = [];
    const retrying = {
      send: async () => ({ run: { status: 'failed', retry_after: '2026-10-08T05:00:00Z' }, code: 'CHAT_AI_RATE_LIMITED' }),
      run: async () => ({ run: { status: 'completed' } }),
    };
    await followRun({ client: retrying, chatId: 'c', key: 'k', body: {}, sleep: async (ms) => waits.push(ms) });
    assert.deepEqual(waits, [1500]);

    const cancelled = { send: async () => ({ run: { status: 'cancelled' } }), run: async () => assert.fail() };
    await assert.rejects(followRun({ client: cancelled, chatId: 'c', key: 'k', body: {}, sleep: noSleep }), { code: 'CHAT_RUN_CANCELLED' });
  });

  test('streams fast while a document section is being written', async () => {
    const waits = [];
    const replies = [{ run: { status: 'running' }, document_draft: { sections: [{ status: 'writing', content: 'x' }] } }, { run: { status: 'completed' } }];
    const client = { send: async () => ({ run: { status: 'queued' } }), run: async () => replies.shift() };
    await followRun({ client, chatId: 'c', key: 'k', body: {}, sleep: async (ms) => waits.push(ms) });
    assert.deepEqual(waits, [1000, 600]);
  });

  test('progress labels follow the run stage', () => {
    assert.equal(progressLabel({ run: { status: 'queued' } }), 'Mengantre…');
    assert.equal(progressLabel({ run: { status: 'running', stage: 'planning' } }), 'Menyusun kerangka dokumen…');
    assert.equal(progressLabel({ run: { status: 'running', stage: 'writing', sections_total: 5, sections_completed: 1, current_section_title: 'Scope' } }), 'Menulis “Scope” (2/5)…');
    assert.match(progressLabel({ run: { status: 'running', stage: 'retrying', retry_attempt: 1, retry_max: 3 } }), /mencoba lagi \(1\/3\)/);
    assert.equal(progressLabel({ run: { status: 'running' } }), 'Santri sedang berpikir…');
  });
});

describe('documents', () => {
  const answer = [
    'Berikut PRD-nya:',
    ':::document {"title":"PRD Aplikasi Kasir","kind":"prd","version":"1.0"}',
    '# PRD Aplikasi Kasir',
    '```md',
    ':::enddocument (inside a fence stays content)',
    '```',
    '## Scope',
    ':::enddocument',
    'Mau lanjut ke arsitektur?',
  ].join('\n');

  test('splits text and fenced-safe document blocks like the website', () => {
    const parsed = parseDocuments(answer);
    assert.equal(parsed.malformed, false);
    assert.deepEqual(parsed.segments.map((s) => s.type), ['text', 'document', 'text']);
    const doc = parsed.documents[0];
    assert.deepEqual(doc.metadata, { title: 'PRD Aplikasi Kasir', kind: 'prd', version: '1.0' });
    assert.match(doc.content, /inside a fence stays content/);
    assert.match(doc.content, /## Scope/);
  });

  test('malformed or unknown blocks stay visible as literal text', () => {
    const bad = parseDocuments(':::document {"title":"X","kind":"virus","version":"1"}\nisi\n:::enddocument');
    assert.equal(bad.malformed, true);
    assert.equal(bad.documents.length, 0);
    assert.equal(bad.segments[0].literal, true);
    assert.equal(parseDocuments('halo').segments[0].content, 'halo');
  });

  test('file names: agent-friendly names per kind, Windows-safe slug otherwise', () => {
    assert.equal(fileNameFor({ kind: 'prd', title: 'x' }), 'PRD.md');
    assert.equal(fileNameFor({ kind: 'architecture', title: 'x' }), 'ARCHITECTURE.md');
    assert.equal(fileNameFor({ kind: 'sdlc', title: 'x' }), 'SDLC.md');
    assert.equal(fileNameFor({ kind: 'design', title: 'x' }), 'DESIGN.md');
    assert.equal(fileNameFor({ kind: 'document', title: 'Rencana Rilis: Ãpp/v2?' }), 'rencana-rilis-app-v2.md');
    assert.equal(fileNameFor({ kind: 'document', title: 'CON' }), 'document-con.md');
    assert.equal(fileNameFor({ kind: 'document', title: '***' }), 'document.md');
  });

  test('draft preview shows only written sections', () => {
    const d = draftDocument({ title: 'PRD', kind: 'prd', version: '1', sections: [
      { title: 'A', status: 'completed', content: '## A\nisi' }, { title: 'B', status: 'pending', content: null },
    ] });
    assert.equal(d.content, '# PRD\n\n## A\nisi');
    assert.deepEqual(d.sections, [{ title: 'A', status: 'completed' }, { title: 'B', status: 'pending' }]);
  });
});

describe('markdown renderer', () => {
  test('escapes HTML and never links non-http URLs', () => {
    const html = markdown.render('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) **b**');
    assert.doesNotMatch(html, /<script|<img|href="javascript/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /<strong>b<\/strong>/);
    assert.doesNotMatch(markdown.render('[a](https://x.example/" onmouseover="alert(1))'), /onmouseover="/);
  });

  test('renders headings, code, tables, nested and task lists', () => {
    const html = markdown.render([
      '# Judul', '', 'Teks `kode <b>` dan [Santri](https://santriverse.my.id).', '',
      '```js', 'const a = "<x>";', '```', '',
      '| Kolom | Nilai |', '|:--|--:|', '| a | 1 |', '', 'a | b', '---', '',
      '- satu', '  - dua', '- [x] selesai', '', '1. pertama', '2. kedua',
    ].join('\n'));
    assert.match(html, /<h1>Judul<\/h1>/);
    assert.match(html, /<code>kode &lt;b&gt;<\/code>/);
    assert.match(html, /<a href="https:\/\/santriverse\.my\.id" data-external>Santri<\/a>/);
    assert.match(html, /<pre><code>const a = &quot;&lt;x&gt;&quot;;<\/code><\/pre>/);
    assert.match(html, /<th style="text-align:left">Kolom<\/th>/);
    assert.match(html, /<td style="text-align:right">1<\/td>/);
    assert.match(html, /<p>a \| b<\/p><hr>/, 'cell count mismatch is not a table');
    assert.match(html, /<ul><li>satu<ul><li>dua<\/li><\/ul><\/li><li class="task"><input type="checkbox" disabled checked> selesai<\/li><\/ul>/);
    assert.match(html, /<ol><li>pertama<\/li><li>kedua<\/li><\/ol>/);
  });

  test('handles unterminated fences and huge input without hanging', () => {
    assert.match(markdown.render('```\nkode tanpa penutup'), /kode tanpa penutup/);
    const big = Array.from({ length: 3000 }, (_, i) => `- item ${i} **x** _y_`).join('\n');
    const t = Date.now();
    markdown.render(big);
    assert.ok(Date.now() - t < 2000);
  });
});

describe('logos', () => {
  const resolve = createLogoResolver({
    siteUrl: 'https://santriverse.my.id', apiBaseUrl: 'https://api.santriverse.my.id/api',
    assets: [{ key: 'deepseek', file: 'deepseek-color.svg' }, { key: 'zhipu', file: 'zhipu.svg' }, { key: '../x', file: 'evil.svg' }],
  });
  test('resolves like the website', () => {
    assert.equal(resolve({ logo_key: 'deepseek' }), 'https://santriverse.my.id/ai-logos/deepseek-color.svg');
    assert.equal(resolve({ logo_key: 'flow-logos/santriman.webp' }), 'https://api.santriverse.my.id/storage/flow-logos/santriman.webp');
    assert.equal(resolve({ provider_model_id: 'glm-5.2' }), 'https://santriverse.my.id/ai-logos/zhipu.svg');
    assert.equal(resolve({ provider_model_id: 'amanai/deepseek-v4.1-flash' }), 'https://santriverse.my.id/ai-logos/deepseek-color.svg');
    assert.equal(resolve({ logo_key: 'zhipuai' }), 'https://santriverse.my.id/ai-logos/zhipu.svg');
    assert.equal(resolve({ logo_key: 'https://cdn.example/logo.png' }), 'https://cdn.example/logo.png');
    assert.equal(resolve({ logo_key: 'http://insecure.example/logo.png' }), null);
    assert.equal(resolve({ logo_key: '../x' }), null);
    assert.equal(resolve({ provider_model_id: 'unknown-model' }), null);
  });
});

describe('project context', () => {
  test('never lists secrets or heavy folders', () => {
    for (const name of ['.env', '.env.local', 'server.key', 'cert.pem', 'id_rsa', 'node_modules', '.git', 'vendor', 'dist']) assert.equal(visibleEntry(name), false, name);
    for (const name of ['src', 'package.json', 'README.md', '.github']) assert.equal(visibleEntry(name), true, name);
  });

  test('formats a bounded summary and composes within the server limit', () => {
    const ctx = formatContext({
      name: 'kasir', tree: ['src/', 'src/app.js'], activeFile: 'src/app.js',
      manifests: { 'package.json': JSON.stringify({ name: 'kasir', scripts: { dev: 'vite' }, dependencies: { react: '1' } }) },
      readme: 'x'.repeat(10000),
    });
    assert.match(ctx, /^\[Konteks project dari editor\]/);
    assert.match(ctx, /dependencies: react/);
    assert.ok(ctx.length <= 6000);
    const message = composeMessage('Buat PRD', ctx);
    assert.ok(message.length <= MAX_MESSAGE);
    assert.deepEqual(splitMessage(message), { text: 'Buat PRD', hasContext: true });
    assert.deepEqual(splitMessage('biasa'), { text: 'biasa', hasContext: false });
    assert.equal(composeMessage('y'.repeat(25000), ctx).length, MAX_MESSAGE);
  });
});

describe('VSIX package', () => {
  const unzip = (buf) => {
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let p = buf.readUInt32LE(end + 16);
    const files = new Map();
    for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
      const nameLen = buf.readUInt16LE(p + 28);
      const local = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      files.set(name, zlib.inflateRawSync(buf.subarray(start, start + buf.readUInt32LE(p + 20))));
      p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    }
    return files;
  };
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-vsix-'));
  after(() => fs.rmSync(outDir, { recursive: true, force: true }));

  test('has the VSIX layout, manifest identity and every contributed file', () => {
    const r = buildIdeExtension({ outDir });
    const files = unzip(fs.readFileSync(r.out));
    const pkg = JSON.parse(files.get('extension/package.json'));
    assert.equal(path.basename(r.out), `santri-code-${pkg.version}.vsix`);
    assert.ok(files.has('[Content_Types].xml'));
    const manifest = files.get('extension.vsixmanifest').toString();
    assert.match(manifest, new RegExp(`<Identity Language="en-US" Id="santri-code" Version="${pkg.version.replace(/\./g, '\\.')}" Publisher="santriverse" />`));
    for (const f of ['extension/extension.js', 'extension/media/main.js', 'extension/media/markdown.js', 'extension/media/main.css', 'extension/media/icon.png', 'extension/media/activity.svg', 'extension/README.md', 'extension/CHANGELOG.md', 'extension/LICENSE.txt']) assert.ok(files.has(f), f);
    for (const name of files.keys()) assert.doesNotMatch(name, /\.test\.js$|node_modules|\.vsix$/);
    for (const name of fs.readdirSync(path.join(IDE, 'src'))) assert.ok(files.has(`extension/src/${name}`), name);
  });

  test('every contributed command is registered and no remote code is loaded', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(IDE, 'package.json'), 'utf8'));
    const source = fs.readFileSync(path.join(IDE, 'extension.js'), 'utf8');
    for (const { command } of pkg.contributes.commands) assert.ok(source.includes(`registerCommand('${command}'`), command);
    for (const file of ['extension.js', 'media/main.js', 'media/markdown.js', ...fs.readdirSync(path.join(IDE, 'src')).map((f) => `src/${f}`)]) {
      const text = fs.readFileSync(path.join(IDE, file), 'utf8');
      assert.doesNotMatch(text, /\beval\s*\(|new Function\s*\(|<script[^>]+src="https?:/, file);
    }
    assert.equal(pkg.contributes.configuration.properties['santriCode.apiBaseUrl'].scope, 'application', 'workspace settings must not redirect the token');
    assert.equal(pkg.contributes.configuration.properties['santriCode.siteUrl'].scope, 'application');
  });
});

// ── extension host, end to end with a fake `vscode` ─────────────────────────
describe('extension host (fake vscode)', () => {
  function makeUri(fsPath) {
    const norm = path.resolve(fsPath);
    return { scheme: 'file', fsPath: norm, path: norm.replace(/\\/g, '/'), toString: () => `file://${norm.replace(/\\/g, '/')}` };
  }

  function fakeVscode(workspaceDir, log) {
    const secrets = new Map();
    const global = new Map();
    const handlers = { view: null, commands: new Map() };
    const vscode = {
      _secrets: secrets,
      _handlers: handlers,
      StatusBarAlignment: { Right: 2 },
      ViewColumn: { Beside: -2 },
      FileType: { File: 1, Directory: 2 },
      Uri: {
        file: makeUri,
        joinPath: (base, ...parts) => makeUri(path.join(base.fsPath, ...parts)),
        parse: (s) => ({ toString: () => s }),
      },
      env: {
        appName: 'Visual Studio Code', uriScheme: 'vscode',
        openExternal: async (uri) => { log.opened.push(uri.toString()); return true; },
        clipboard: { writeText: async (t) => { log.clipboard.push(t); } },
      },
      window: {
        createStatusBarItem: () => ({ show() {}, dispose() {}, text: '', tooltip: '' }),
        registerWebviewViewProvider: (id, provider) => { handlers.view = provider; return { dispose() {} }; },
        createWebviewPanel: () => assert.fail('not used'),
        showInformationMessage: async (m) => { log.info.push(m); },
        showWarningMessage: async (m, _o, ...choices) => { log.warn.push(m); return log.warnChoice ?? choices[0]; },
        setStatusBarMessage: () => ({ dispose() {} }),
        showTextDocument: async (doc) => { log.shown.push(doc.fsPath || doc.content); },
        showSaveDialog: async () => undefined,
        showWorkspaceFolderPick: async () => undefined,
        registerUriHandler: () => ({ dispose() {} }),
        activeTextEditor: undefined,
      },
      workspace: {
        workspaceFolders: [{ uri: makeUri(workspaceDir), name: 'kasir', index: 0 }],
        getConfiguration: () => ({ get: (k) => ({ siteUrl: 'https://santriverse.my.id', apiBaseUrl: 'https://api.santriverse.my.id/api', documentsFolder: log.documentsFolder || '' }[k]) }),
        asRelativePath: (uri) => path.relative(workspaceDir, uri.fsPath).replace(/\\/g, '/'),
        getWorkspaceFolder: () => undefined,
        openTextDocument: async (opts) => opts,
        onDidChangeConfiguration: () => ({ dispose() {} }),
        fs: {
          readFile: async (uri) => fs.readFileSync(uri.fsPath),
          writeFile: async (uri, data) => fs.writeFileSync(uri.fsPath, data),
          createDirectory: async (uri) => fs.mkdirSync(uri.fsPath, { recursive: true }),
          stat: async (uri) => fs.statSync(uri.fsPath),
          readDirectory: async (uri) => fs.readdirSync(uri.fsPath, { withFileTypes: true }).map((d) => [d.name, d.isDirectory() ? 2 : 1]),
        },
      },
      commands: {
        registerCommand: (id, fn) => { handlers.commands.set(id, fn); return { dispose() {} }; },
        executeCommand: async () => {},
      },
    };
    const context = {
      subscriptions: [],
      extensionUri: makeUri(IDE),
      extension: { id: 'santriverse.santri-code', packageJSON: { version: '0.1.0' } },
      secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); } },
      globalState: { get: (k, d) => (global.has(k) ? global.get(k) : d), update: async (k, v) => { global.set(k, v); } },
    };
    return { vscode, context };
  }

  function fakeApi(log) {
    const prd = [':::document {"title":"PRD Kasir","kind":"prd","version":"1.0"}', '# PRD Kasir', '## Tujuan', 'Kasir cepat.', ':::enddocument'].join('\n');
    return async (url, init = {}) => {
      if (String(url).startsWith('http://127.0.0.1')) return realFetch(url, init);
      const u = new URL(url);
      const method = init.method || 'GET';
      log.api.push(`${method} ${u.pathname}`);
      if (u.pathname === '/ai-logos/lobehub-manifest.json') return jsonResponse(200, { assets: [{ key: 'deepseek', file: 'deepseek-color.svg' }] });
      if (u.pathname === '/api/code/session' && method === 'POST') {
        const body = JSON.parse(init.body);
        assert.equal(body.ticket, TICKET);
        assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43}$/);
        return jsonResponse(200, { success: true, token: 'code-token', user: { name: 'Santri Uji', email: 's@example.test' } });
      }
      if (log.unauthorized) return jsonResponse(401, { message: 'Unauthorized' });
      assert.equal(init.headers.Authorization, 'Bearer code-token');
      if (u.pathname === '/api/code/bootstrap') {
        return jsonResponse(200, {
          models: [{ id: 'm1', display_name: 'deepseek-v4.1-flash', provider_model_id: 'amanai/deepseek-v4.1-flash', provider: 'amanai', provider_display_name: 'Amanai', credits_per_run: 1, is_default: true, logo_key: null }],
          usage: { credits_used: 0, credits_limit: 20, credits_remaining: 20 },
          profile: { name: 'Santri Uji' },
        });
      }
      if (u.pathname === '/api/code/chats' && method === 'GET') return jsonResponse(200, { conversations: [{ id: 'c1', title: 'PRD kasir', updated_at: '2026-10-08' }] });
      if (u.pathname === '/api/code/chats' && method === 'POST') return jsonResponse(201, { conversation: { id: 'c1', title: JSON.parse(init.body).title, messages: [] } });
      if (u.pathname === '/api/code/chats/c1/send') {
        log.sent = { key: init.headers['Idempotency-Key'], body: JSON.parse(init.body) };
        return jsonResponse(202, { run: { status: 'queued', idempotency_key: log.sent.key } });
      }
      if (u.pathname.startsWith('/api/code/chats/c1/runs/')) {
        return jsonResponse(200, {
          run: { status: 'completed' },
          user_message: { id: 'u1', role: 'user', content: log.sent.body.message },
          assistant_message: { id: 'a1', role: 'assistant', content: `Ini PRD-nya.\n${prd}`, model: 'amanai/deepseek-v4.1-flash' },
          usage: { credits_charged: 1 },
        });
      }
      if (u.pathname === '/api/code/usage') return jsonResponse(200, { usage: { credits_used: 1, credits_limit: 20, credits_remaining: 19 } });
      if (u.pathname === '/api/code/session' && method === 'DELETE') return jsonResponse(200, { success: true });
      return jsonResponse(404, { message: 'not found' });
    };
  }

  async function boot(log, { token } = {}) {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-ws-'));
    fs.writeFileSync(path.join(workspaceDir, 'package.json'), JSON.stringify({ name: 'kasir', dependencies: { react: '1' } }));
    fs.writeFileSync(path.join(workspaceDir, '.env'), 'APP_KEY=rahasia-jangan-dikirim');
    fs.mkdirSync(path.join(workspaceDir, 'src'));
    const { vscode, context } = fakeVscode(workspaceDir, log);
    if (token) vscode._secrets.set('santriCode.token', token);
    const originalLoad = Module._load;
    Module._load = function load(request, ...rest) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...rest); };
    delete require.cache[require.resolve('../ide-extension/extension.js')];
    let ext;
    try { ext = require('../ide-extension/extension.js'); } finally { Module._load = originalLoad; }
    globalThis.fetch = fakeApi(log);
    const app = ext.activate(context);
    const states = [];
    let listener;
    const webview = {
      options: {}, html: '', cspSource: 'vscode-resource:',
      asWebviewUri: (u) => `vscode-resource:${u.path}`,
      postMessage: async (m) => { if (m.type === 'state') states.push(JSON.parse(JSON.stringify(m.state))); return true; },
      onDidReceiveMessage: (fn) => { listener = fn; return { dispose() {} }; },
    };
    vscode._handlers.view.resolveWebviewView({ webview, onDidDispose: () => {} });
    const send = (msg) => listener(msg);
    const until = async (pred, label) => {
      for (let i = 0; i < 400; i++) {
        if (pred(app.state)) return app.state;
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail(`timeout waiting for ${label}: ${JSON.stringify({ phase: app.state.phase, error: app.state.error })}`);
    };
    return { app, vscode, webview, states, send, until, workspaceDir };
  }

  after(() => { globalThis.fetch = realFetch; });
  const newLog = () => ({ api: [], opened: [], info: [], warn: [], shown: [], clipboard: [] });

  test('webview HTML is CSP-locked to nonce scripts and Santriverse image origins', async () => {
    const log = newLog();
    const { webview, send, until } = await boot(log);
    await send({ type: 'ready' });
    await until((s) => s.phase === 'signedOut', 'signedOut');
    assert.match(webview.html, /default-src 'none'/);
    assert.match(webview.html, /script-src 'nonce-[A-Za-z0-9+/=]+'/);
    assert.match(webview.html, /img-src vscode-resource: https:\/\/santriverse\.my\.id https:\/\/api\.santriverse\.my\.id https:\/\/cdn\.simpleicons\.org data:/);
    assert.equal(webview.options.enableScripts, true);
  });

  test('browser login → loopback → code session → ready with models and credits', async () => {
    const log = newLog();
    const { vscode, send, until } = await boot(log);
    await send({ type: 'ready' });
    await until((s) => s.phase === 'signedOut', 'signedOut');
    const login = send({ type: 'login' });
    await until((s) => s.phase === 'waitingLogin', 'waitingLogin');
    const connect = new URL(log.opened[0]);
    assert.equal(connect.searchParams.get('client'), 'code');
    const callback = new URL(connect.searchParams.get('callback'));
    const res = await realFetch(new URL('/auth/complete', callback), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: callback.origin },
      body: JSON.stringify({ state: connect.searchParams.get('state'), ticket: TICKET }),
    });
    assert.deepEqual(await res.json(), { ok: true });
    await login;
    const state = await until((s) => s.phase === 'ready', 'ready');
    assert.equal(vscode._secrets.get('santriCode.token'), 'code-token');
    assert.equal(state.models[0].name, 'deepseek-v4.1-flash');
    assert.equal(state.models[0].logo, 'https://santriverse.my.id/ai-logos/deepseek-color.svg');
    assert.equal(state.modelId, 'm1');
    assert.deepEqual(state.usage, { used: 0, limit: 20, remaining: 20, unlimited: false, resetsAt: null });
    assert.equal(state.chats[0].id, 'c1');
    assert.match(log.info[0], /Santri Uji/);
  });

  test('send with project context → document card → save as PRD.md', async () => {
    const log = newLog();
    const { app, send, until, workspaceDir } = await boot(log, { token: 'code-token' });
    await send({ type: 'ready' });
    await until((s) => s.phase === 'ready', 'ready');
    await send({ type: 'toggleContext' });
    assert.equal(app.state.includeContext, true);

    await send({ type: 'send', text: 'Buat PRD aplikasi kasir' });
    const state = await until((s) => !s.pending && s.messages.length === 2, 'answer');
    assert.equal(log.sent.body.model_config_id, 'm1');
    assert.match(log.sent.key, /^ide-[0-9a-f-]{36}$/);
    assert.match(log.sent.body.message, /^Buat PRD aplikasi kasir\n\n---\n\[Konteks project dari editor\]/);
    assert.match(log.sent.body.message, /dependencies: react/);
    assert.doesNotMatch(log.sent.body.message, /\.env|rahasia-jangan-dikirim/);
    assert.deepEqual(state.messages[0], { id: 'u1', role: 'user', text: 'Buat PRD aplikasi kasir', hasContext: true });
    const doc = state.messages[1].segments.find((s) => s.type === 'document');
    assert.equal(doc.fileName, 'PRD.md');
    await until((s) => s.usage?.remaining === 19, 'usage refresh');

    await send({ type: 'saveDoc', ref: 'a1:0' });
    const saved = fs.readFileSync(path.join(workspaceDir, 'PRD.md'), 'utf8');
    assert.equal(saved, '# PRD Kasir\n## Tujuan\nKasir cepat.\n');
    assert.match(log.info.at(-1), /Tersimpan: PRD\.md/);

    log.warnChoice = 'Simpan sebagai file baru';
    await send({ type: 'saveDoc', ref: 'a1:0' });
    assert.ok(fs.existsSync(path.join(workspaceDir, 'PRD-2.md')));

    log.documentsFolder = '../luar';
    log.warnChoice = 'Timpa';
    await send({ type: 'saveDoc', ref: 'a1:0' });
    assert.match(log.warn.at(-2), /harus folder relatif/);
    assert.equal(fs.existsSync(path.join(workspaceDir, '..', 'luar')), false);

    await send({ type: 'copyDoc', ref: 'a1:0' });
    assert.match(log.clipboard.at(-1), /# PRD Kasir/);
    await send({ type: 'saveDoc', ref: 'nope:9' });
  });

  test('a 401 signs out and forgets the token', async () => {
    const log = { ...newLog(), unauthorized: true };
    const { vscode, send, until } = await boot(log, { token: 'code-token' });
    await send({ type: 'ready' });
    const state = await until((s) => s.phase === 'signedOut' && s.notice, 'signed out');
    assert.match(state.notice, /Login ulang/);
    assert.equal(vscode._secrets.has('santriCode.token'), false);
  });

  test('external links: only http(s) reach the browser', async () => {
    const log = newLog();
    const { send } = await boot(log);
    await send({ type: 'openExternal', url: 'javascript:alert(1)' });
    await send({ type: 'openExternal', url: 'file:///C:/Windows' });
    await send({ type: 'openExternal', url: 'https://santriverse.my.id/docs' });
    assert.deepEqual(log.opened, ['https://santriverse.my.id/docs']);
  });

  test('documentsFolder only accepts relative folders inside the workspace', () => {
    const originalLoad = Module._load;
    Module._load = function load(request, ...rest) { return request === 'vscode' ? {} : originalLoad.call(this, request, ...rest); };
    let documentSegments;
    try { ({ documentSegments } = require('../ide-extension/extension.js')); } finally { Module._load = originalLoad; }
    assert.deepEqual(documentSegments(''), []);
    assert.deepEqual(documentSegments(' docs\\plan/ '), ['docs', 'plan']);
    assert.equal(documentSegments('../x'), null);
    assert.equal(documentSegments('C:/x'), null);
    assert.equal(documentSegments('docs/./x'), null);
  });
});
