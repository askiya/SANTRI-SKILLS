'use strict';
// SantriHub desktop window: the localhost dashboard inside a Microsoft Edge
// app window (no tabs, no address bar). Premium verification is unchanged —
// the dashboard still logs in through santriverse.my.id and checks every call.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const EDGE_PATHS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
// msedge.exe is a launcher that exits within milliseconds, so its exit says
// nothing about the window. SantriHub instead watches for visible windows of
// its own Edge profile and stops when the last one closes.
const WINDOW_POLL_SECONDS = 3;
const WINDOW_APPEAR_SECONDS = 60;
// Safety net if the watcher itself dies: stop once the UI goes quiet.
const IDLE_SHUTDOWN_MS = 15 * 60 * 1000;

const dataDir = (env = process.env) => path.join(env.LOCALAPPDATA || os.homedir(), 'SantriHub');

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/** Lock of a SantriHub that is still running, or null (stale locks are removed). */
function liveLock(file) {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { lock = null; }
  if (lock && isAlive(lock.pid) && /^http:\/\/127\.0\.0\.1:\d+$/.test(lock.url || '')) return lock;
  fs.rmSync(file, { force: true });
  return null;
}

const findEdge = (exists = fs.existsSync) => EDGE_PATHS.find(p => exists(p)) || null;

function log(message) {
  try { fs.appendFileSync(path.join(dataDir(), 'santrihub.log'), `${new Date().toISOString()} ${message}\n`); } catch { /* best effort */ }
}

/** Visible error even when SantriHub runs without a console window. */
function alertUser(message) {
  log(message);
  const text = message.replace(/'/g, "''");
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text}', 'SantriHub') | Out-Null`],
  { stdio: 'ignore', windowsHide: true, detached: true }).unref();
}

/** PowerShell loop printing "closed" once windows of this profile appeared and all closed ("nowindow" if none ever showed). */
function windowWatcherScript(profile) {
  const needle = profile.replace(/'/g, "''");
  return [
    '$seen = $false; $start = Get-Date',
    'while ($true) {',
    `  $ids = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { $_.ProcessId })`,
    '  $windows = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 }).Count',
    '  if ($windows -gt 0) { $seen = $true }',
    "  elseif ($seen) { 'closed'; break }",
    `  elseif (((Get-Date) - $start).TotalSeconds -gt ${WINDOW_APPEAR_SECONDS}) { 'nowindow'; break }`,
    `  Start-Sleep -Seconds ${WINDOW_POLL_SECONDS}`,
    '}',
  ].join('\n');
}

function watchWindows(profile, onEvent) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', windowWatcherScript(profile)],
    { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  let out = '';
  ps.stdout.on('data', (chunk) => {
    out += chunk;
    if (/closed/.test(out)) onEvent('closed');
    else if (/nowindow/.test(out)) onEvent('nowindow');
  });
  ps.once('error', () => onEvent('watcher-failed'));
  ps.once('exit', () => onEvent('watcher-exit'));
  return ps;
}

// ── Login in the member's own browser ───────────────────────────────────────
// The app window uses a private Edge profile, so the member is not signed in to
// Google/Santriverse there. In app mode the login button opens the default
// browser instead; Santriverse redirects back to 127.0.0.1:<port>/auth/callback,
// which the local server accepts from any browser (state + PKCE stay server-side).
const DEFAULT_WEBSITE = 'https://santriverse.my.id';
const websiteBase = (env = process.env) => String(env.SANTRI_SKILLS_WEBSITE_URL || DEFAULT_WEBSITE).replace(/\/+$/, '');

/** Only the Santriverse connect page that calls back to this very SantriHub may be opened. */
function isAllowedLoginUrl(raw, origin, website = websiteBase()) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  return `${url.origin}${url.pathname}` === `${website}/skills/connect`
    && url.searchParams.get('callback') === `${origin}/auth/callback`
    && !url.username && !url.password;
}

const APP_SCRIPT = `(() => {
  'use strict';
  document.cookie = 'santrihub_app=1; path=/; SameSite=Strict';
  const say = (text) => { const el = document.getElementById('gate-feedback'); if (el) el.textContent = text; };
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  };
  let poll = null;
  document.addEventListener('click', async (event) => {
    const button = event.target.closest && event.target.closest('#login');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.dataset.browserLogin === 'busy') return;
    button.dataset.browserLogin = 'busy';
    try {
      say('Membuka browser untuk login Santriverse…');
      const { url } = await post('/api/auth/login');
      await post('/__santrihub/open-login', { url });
      say('Selesaikan login di browser. SantriHub masuk otomatis setelah berhasil.');
      clearInterval(poll);
      const started = Date.now();
      poll = setInterval(async () => {
        if (Date.now() - started > 5 * 60 * 1000) { clearInterval(poll); say('Waktu login habis. Klik login lagi.'); return; }
        const res = await fetch('/api/auth/status').catch(() => null);
        if (res && res.ok) { clearInterval(poll); location.reload(); }
      }, 1500);
    } catch (error) {
      say(error.message || 'Gagal membuka browser.');
    } finally {
      setTimeout(() => { delete button.dataset.browserLogin; }, 3000);
    }
  }, true);
})();
`;

const CALLBACK_PAGE = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SantriHub</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#f4f6fb;font:16px/1.5 system-ui,sans-serif}main{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;margin:12px 0 8px}p{color:#a8b0c0;margin:0}.ok{color:#4dd69e}.err{color:#ff7b88}img{width:56px;height:70px;object-fit:contain}</style></head>
<body><main><img src="/assets/santriverse-logo.webp" alt=""><h1 id="title">Menghubungkan SantriHub…</h1><p id="text">Sebentar, sedang memverifikasi akun Premium.</p></main>
<script>(function(){
  var p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  var inApp = document.cookie.indexOf('santrihub_app=1') >= 0;
  function show(title, text, cls){ var t = document.getElementById('title'); t.textContent = title; t.className = cls || ''; document.getElementById('text').textContent = text; }
  fetch('/api/auth/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: p.get('state'), ticket: p.get('ticket') }) })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if (!r.ok) throw new Error(d.error || 'Login gagal.'); }); })
    .then(function(){
      if (inApp) { location.href = '/'; return; }
      show('Login berhasil ✓', 'Kembali ke aplikasi SantriHub. Tab ini boleh ditutup.', 'ok');
      fetch('/__santrihub/focus', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(function(){});
      setTimeout(function(){ window.close(); }, 1200);
    })
    .catch(function(e){ show('Login belum berhasil', (e && e.message ? e.message : 'Coba lagi dari aplikasi SantriHub.'), 'err'); });
})();</script></body></html>`;

/**
 * Wrap the dashboard's request handler with the app-mode login routes.
 * Every other request (and all premium checks) still goes to the dashboard.
 */
function attachBrowserLogin(server, { focus = () => {}, open = openExternal } = {}) {
  const dashboard = server.listeners('request');
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const pathname = (req.url || '').split(/[?#]/)[0];
    const sameOriginJson = () => req.headers.origin === origin && req.headers['content-type'] === 'application/json';
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

    if (req.method === 'GET' && pathname === '/__santrihub/desktop.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(APP_SCRIPT);
    }
    if (req.method === 'GET' && pathname === '/auth/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
      return res.end(CALLBACK_PAGE);
    }
    if (req.method === 'POST' && (pathname === '/__santrihub/open-login' || pathname === '/__santrihub/focus')) {
      if (!sameOriginJson()) return json(403, { error: 'Ditolak.' });
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; if (raw.length > 4096) req.destroy(); });
      req.on('end', () => {
        if (pathname === '/__santrihub/focus') { focus(); return json(200, { ok: true }); }
        let url;
        try { url = JSON.parse(raw).url; } catch { url = null; }
        if (!isAllowedLoginUrl(url, origin)) return json(400, { error: 'URL login tidak diizinkan.' });
        open(url);
        return json(200, { opened: true });
      });
      return undefined;
    }
    if (req.method === 'GET' && pathname === '/') {
      // Load the app-mode login script after the dashboard's own scripts.
      // (writeHead headers are not visible to getHeader, so capture them here.)
      let html = false;
      const writeHead = res.writeHead.bind(res);
      res.writeHead = (status, ...args) => {
        const headers = args.find(a => a && typeof a === 'object');
        if (headers) {
          for (const key of Object.keys(headers)) {
            if (/^content-type$/i.test(key)) html = /text\/html/i.test(String(headers[key]));
            if (/^content-length$/i.test(key)) delete headers[key]; // body grows by one tag
          }
        }
        return writeHead(status, ...args);
      };
      const end = res.end.bind(res);
      res.end = (chunk, ...rest) => {
        if (chunk && html) chunk = String(chunk).replace(/<\/body>/i, '<script src="/__santrihub/desktop.js"></script></body>');
        return end(chunk, ...rest);
      };
    }
    for (const handler of dashboard) handler.call(server, req, res);
    return undefined;
  });
  return server;
}

/** Default browser of the member (no shell: the URL is passed as one argument). */
function openExternal(url) {
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
}

/** Bring the SantriHub window to the front after a browser login. */
function focusWindow(profile) {
  const needle = profile.replace(/'/g, "''");
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${needle}') } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1`,
    'if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null }',
  ].join('\n');
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { stdio: 'ignore', windowsHide: true, detached: true }).unref();
}

function openWindow(edge, url, profile) {
  return spawn(edge, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore', windowsHide: false });
}

function startDesktop({ version = '' } = {}) {
  const data = dataDir();
  const lockFile = path.join(data, 'desktop.lock');
  const profile = path.join(data, 'EdgeProfile');
  fs.mkdirSync(data, { recursive: true });

  const edge = findEdge();
  if (!edge) {
    alertUser('Microsoft Edge tidak ditemukan. SantriHub membutuhkan Microsoft Edge (bawaan Windows 10/11).');
    process.exitCode = 1;
    return null;
  }

  // Second launch: bring up a window on the running instance instead of a new server.
  const running = liveLock(lockFile);
  if (running) {
    openWindow(edge, running.url, profile).unref();
    return null;
  }

  let fd;
  try { fd = fs.openSync(lockFile, 'wx'); } catch { return null; } // lost a launch race

  const { createDashboardServer } = require('./dashboard');
  const server = createDashboardServer({ cwd: process.cwd() });
  let lastRequest = Date.now();
  server.on('request', () => { lastRequest = Date.now(); });
  attachBrowserLogin(server, { focus: () => focusWindow(profile) });

  let closing = false;
  let watcher = null;
  const close = () => {
    if (closing) return;
    closing = true;
    try { watcher?.kill(); } catch { /* already gone */ }
    server.closeAllConnections?.();
    server.close(() => {
      try { fs.closeSync(fd); } catch { /* already closed */ }
      fs.rmSync(lockFile, { force: true });
      process.exit(0);
    });
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  process.on('exit', () => { try { fs.rmSync(lockFile, { force: true }); } catch { /* exiting */ } });
  process.on('uncaughtException', (error) => { log(`uncaught: ${error?.stack || error}`); close(); });

  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, url, version }));
    log(`SantriHub ${version} ${url}`);
    const child = openWindow(edge, url, profile);
    child.once('error', (error) => { alertUser(`Gagal membuka jendela SantriHub: ${error.message}`); close(); });
    child.unref();
    watcher = watchWindows(profile, (event) => {
      if (event === 'closed') return close();
      if (event === 'nowindow') { alertUser('Jendela SantriHub tidak muncul. Coba buka SantriHub lagi.'); return close(); }
      // Watcher unavailable: fall back to stopping once the dashboard goes quiet.
      log(`window watcher stopped (${event}); idle shutdown armed`);
      setInterval(() => { if (Date.now() - lastRequest > IDLE_SHUTDOWN_MS) close(); }, 60 * 1000).unref();
    });
  });
  return server;
}

module.exports = { startDesktop, liveLock, isAlive, findEdge, dataDir, windowWatcherScript, attachBrowserLogin, isAllowedLoginUrl, IDLE_SHUTDOWN_MS };

if (require.main === module) startDesktop();
