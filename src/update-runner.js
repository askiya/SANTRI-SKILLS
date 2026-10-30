'use strict';
// Installs a downloaded SantriHub update after the app has exited, then reopens it.
//
//   node update-runner.js '<json>'   (started detached by src/update.js startUpdateRunner)
//
// A Node process, not PowerShell: powershell.exe started as a detached process (no
// console) exits without running its script, which is why the update of 0.2.x/0.3.2
// closed SantriHub and never installed anything. PowerShell is only used here as a
// short, non-detached child, and the installer and the reopened app are started
// detached so they outlive this runner.
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

const INSTALLER_ARGS = ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS'];
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** PowerShell that closes the app window (browser processes of SantriHub's private profile). */
function windowCloseScript(profile, browserProcess = 'msedge.exe') {
  const name = /^[\w-]+\.exe$/i.test(browserProcess || '') ? browserProcess : 'msedge.exe';
  return `Get-CimInstance Win32_Process -Filter "Name='${name}'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${psQuote(profile)}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(opts, { spawnImpl = spawn, spawnSyncImpl = spawnSync, now = Date.now } = {}) {
  const { installer, exe, args = ['app'], pid, profile, browserProcess, log, installerArgs = INSTALLER_ARGS } = opts;
  const note = (line) => { try { fs.appendFileSync(log, `${new Date().toISOString()} ${line}\n`); } catch { /* best effort */ } };
  note(`update runner started (waiting for pid ${pid})`);

  for (const until = now() + 30000; Number.isInteger(pid) && alive(pid) && now() < until;) await sleep(250);

  if (profile) {
    const enc = Buffer.from(windowCloseScript(profile, browserProcess), 'utf16le').toString('base64');
    spawnSyncImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { windowsHide: true, stdio: 'ignore', timeout: 30000 });
  }

  // Detached, so an app the installer opens is not killed when this runner exits.
  const code = await new Promise((resolve) => {
    let child;
    try { child = spawnImpl(installer, installerArgs, { detached: true, stdio: 'ignore', windowsHide: false }); } catch (e) { note(`update installer failed to start: ${e.message}`); return resolve(null); }
    child.once('error', (e) => { note(`update installer failed to start: ${e.message}`); resolve(null); });
    child.once('exit', (c) => resolve(c));
  });
  if (code !== null) note(`update installer exit ${code}`);
  try { fs.rmSync(installer, { force: true }); } catch { /* in use: removed by the next update */ }

  try { spawnImpl(exe, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(); note('SantriHub reopened'); } catch (e) { note(`reopen failed: ${e.message}`); }
  return code;
}

module.exports = { run, windowCloseScript, INSTALLER_ARGS };

if (require.main === module) {
  let opts;
  try { opts = JSON.parse(process.argv[2]); } catch { process.exit(2); }
  run(opts).then(() => process.exit(0), () => process.exit(1));
}
