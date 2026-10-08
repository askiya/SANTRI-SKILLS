'use strict';
// SantriHub self-update from the official GitHub releases.
//
// check:  github.com/<repo>/releases/latest redirects to …/releases/tag/vX.Y.Z (no API
//         rate limit). Cached per process: 1 hour on success, 10 minutes on failure.
// apply:  (Windows app only) download SantriHub-Setup.exe of that tag, require its SHA-256
//         to match SHA256SUMS.txt of the same release, then a detached PowerShell runner
//         closes the app window, runs the installer silently and reopens SantriHub.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'askiya/SANTRI-SKILLS';
const RELEASES = `https://github.com/${REPO}/releases`;
const INSTALLER = 'SantriHub-Setup.exe';
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const OK_TTL = 60 * 60 * 1000;
const FAIL_TTL = 10 * 60 * 1000;
const MAX_INSTALLER = 300 * 1024 * 1024;

/** -1 / 0 / 1 for "a < b" / equal / "a > b"; versions as "0.2.3" or "v0.2.3". */
function compareVersions(a, b) {
  const parse = (v) => (String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (x.length !== 3 || y.length !== 3) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/** Tag of the latest release, read from the redirect of /releases/latest; null when unknown. */
async function latestTag({ fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(`${RELEASES}/latest`, {
    method: 'HEAD',
    redirect: 'manual',
    headers: { 'User-Agent': 'SantriHub' },
    signal: AbortSignal.timeout(8000),
  });
  const location = res.headers.get('location') || '';
  const tag = location.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
  return tag && TAG_RE.test(tag) ? tag : null;
}

function createUpdateChecker({ current, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let cached = null;
  return async function check() {
    if (cached && now() < cached.until) return cached.value;
    let tag = null;
    try { tag = await latestTag({ fetchImpl }); } catch { tag = null; }
    const value = {
      current,
      latest: tag ? tag.slice(1) : null,
      available: !!tag && compareVersions(tag, current) > 0,
      releaseUrl: tag ? `${RELEASES}/tag/${tag}` : `${RELEASES}/latest`,
      command: 'npx santriverse-skills@latest dashboard',
    };
    cached = { value, until: now() + (tag ? OK_TTL : FAIL_TTL) };
    return value;
  };
}

/** SHA-256 of `file` listed in a SHA256SUMS.txt body ("<hex>  <name>" per line). */
function sumFor(sums, file) {
  for (const line of String(sums).split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m && m[2].trim() === file) return m[1].toLowerCase();
  }
  return null;
}

/** Downloads the installer of `tag` into `dir` and returns its path once the hash matches. */
async function downloadInstaller(tag, dir, { fetchImpl = globalThis.fetch } = {}) {
  if (!TAG_RE.test(tag)) throw new Error('Versi rilis tidak valid.');
  const base = `${RELEASES}/download/${tag}`;
  const get = async (url, what) => {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'SantriHub' }, signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok) throw new Error(`Gagal mengunduh ${what} (${res.status}).`);
    return res;
  };
  const expected = sumFor(await (await get(`${base}/SHA256SUMS.txt`, 'SHA256SUMS.txt')).text(), INSTALLER);
  if (!expected) throw new Error('SHA256SUMS.txt rilis tidak mencantumkan installer.');
  const res = await get(`${base}/${INSTALLER}`, 'installer');
  const size = Number(res.headers.get('content-length') || 0);
  if (size > MAX_INSTALLER) throw new Error('Ukuran installer tidak wajar.');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_INSTALLER) throw new Error('Ukuran installer tidak wajar.');
  const actual = crypto.createHash('sha256').update(data).digest('hex');
  if (actual !== expected) throw new Error('Checksum installer tidak cocok. Pembaruan dibatalkan.');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `SantriHub-Setup-${tag}.exe`);
  fs.writeFileSync(file, data);
  return file;
}

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * PowerShell for the detached runner: wait for the app to exit, close its Edge window
 * (matched by the app's private Edge profile), install silently, reopen SantriHub.
 */
function runnerScript({ installer, exe, pid, profile, log }) {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$log = ${psQuote(log)}`,
    `Wait-Process -Id ${Number(pid)} -Timeout 30 -ErrorAction SilentlyContinue`,
    `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains(${psQuote(profile)}) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
    `$p = Start-Process -FilePath ${psQuote(installer)} -ArgumentList '/SILENT','/SUPPRESSMSGBOXES','/NORESTART','/CLOSEAPPLICATIONS' -Wait -PassThru`,
    "Add-Content -Path $log -Value (\"update installer exit \" + $p.ExitCode)",
    `Remove-Item -LiteralPath ${psQuote(installer)} -Force -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${psQuote(exe)} -ArgumentList 'app'`,
  ].join('\n');
}

/** Release pages and assets of this repository only (opened from the app in the browser). */
function isReleaseLink(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password
    && (url.pathname === `/${REPO}/releases` || url.pathname.startsWith(`/${REPO}/releases/`));
}

module.exports = { REPO, RELEASES, INSTALLER, compareVersions, latestTag, createUpdateChecker, sumFor, downloadInstaller, runnerScript, isReleaseLink };
