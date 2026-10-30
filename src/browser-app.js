'use strict';
// `app` outside Windows (macOS, Linux): the same dashboard on localhost, opened in
// the default browser. The terminal stays open; Ctrl+C stops SantriHub.
const { spawn } = require('node:child_process');

/** Command that opens `url` in the default browser; null when the platform has none. */
function openCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]];
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') return ['xdg-open', [url]];
  return null;
}

function openBrowser(url, platform = process.platform) {
  const cmd = openCommand(url, platform);
  if (!cmd) return false;
  try {
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true });
    child.once('error', () => {}); // no xdg-open: the URL is printed anyway
    child.unref();
    return true;
  } catch { return false; }
}

/** Starts the dashboard on 127.0.0.1 (port 4173, or a free one) and opens it. */
function startBrowserApp({ version = '', port = 4173, open = openBrowser, log = console.log } = {}) {
  const { createDashboardServer } = require('./dashboard');
  const server = createDashboardServer({ cwd: process.cwd() });
  const ready = () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    log(`\n  SantriHub ${version} aktif: ${url}`);
    log(open(url) ? '  Browser dibuka. Biarkan terminal ini terbuka selama memakai SantriHub.' : '  Buka alamat di atas di browser.');
    log('  Tekan Ctrl+C untuk berhenti.\n');
  };
  server.once('error', (error) => {
    if (error.code !== 'EADDRINUSE' || port === 0) throw error;
    server.listen(0, '127.0.0.1', ready); // 4173 taken (another dashboard): any free port
  });
  server.listen(port, '127.0.0.1', ready);
  return server;
}

module.exports = { openCommand, openBrowser, startBrowserApp };
