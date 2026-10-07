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

module.exports = { startDesktop, liveLock, isAlive, findEdge, dataDir, windowWatcherScript, IDLE_SHUTDOWN_MS };

if (require.main === module) startDesktop();
