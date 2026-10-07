'use strict';
// SantriHub.exe entry point (Node.js Single Executable Application).
//
// The executable carries the whole app as one embedded asset. On launch it is
// extracted once to %LOCALAPPDATA%\SantriHub\app-<hash> (content hash, so an
// update gets a fresh folder) and the regular CLI runs from there unchanged —
// same dashboard, same Santriverse premium verification.
//
//   SantriHub.exe                 → open the SantriHub window (same as "app")
//   SantriHub.exe mcp-serve       → MCP stdio server for Antigravity
//   SantriHub.exe <...>\bin\cli.js mcp-serve
//                                 → MCP entries written by the dashboard
//                                   (process.execPath + cli.js); the path is
//                                   ignored so they keep working after updates.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

/** CLI arguments for the bundled cli.js, given the user-supplied argv tail. */
function normalizeArgs(args) {
  let rest = args.slice();
  if (rest[0] && /(^|[\\/])cli\.js$/i.test(rest[0])) rest = rest.slice(1);
  return rest.length ? rest : ['app'];
}

/** Extract the bundle unless this exact build is already in place; returns the app root. */
function ensureExtracted(bundle, base) {
  const dir = path.join(base, `app-${bundle.hash}`);
  if (fs.existsSync(path.join(dir, '.complete'))) return dir;
  const tmp = `${dir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [rel, b64] of Object.entries(bundle.files)) {
    const dest = path.join(tmp, rel);
    if (path.relative(tmp, dest).startsWith('..')) throw new Error(`Invalid bundle path: ${rel}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(path.join(tmp, '.complete'), bundle.version);
  try {
    fs.renameSync(tmp, dir);
  } catch (error) {
    // Another SantriHub process finished the same extraction first.
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!fs.existsSync(path.join(dir, '.complete'))) throw error;
  }
  // Older builds are dropped best-effort (a running MCP server may still hold one).
  for (const name of fs.readdirSync(base)) {
    if (/^app-[0-9a-f]+(\.tmp-\d+)?$/.test(name) && name !== path.basename(dir)) {
      try { fs.rmSync(path.join(base, name), { recursive: true, force: true }); } catch { /* in use */ }
    }
  }
  return dir;
}

function main() {
  const sea = require('node:sea');
  const bundle = JSON.parse(Buffer.from(sea.getAsset('app.json')).toString('utf8'));
  const base = path.join(process.env.LOCALAPPDATA || os.homedir(), 'SantriHub');
  fs.mkdirSync(base, { recursive: true });
  const root = ensureExtracted(bundle, base);
  const cli = path.join(root, 'bin', 'cli.js');
  // In a single executable argv[1] repeats the executable path; user args follow.
  process.argv = [process.execPath, cli, ...normalizeArgs(process.argv.slice(2))];
  createRequire(cli)(cli);
}

// Runs only inside SantriHub.exe; requiring this file from tests is side-effect free.
if (require('node:sea').isSea()) {
  try { main(); } catch (error) {
    try {
      const dir = path.join(process.env.LOCALAPPDATA || os.homedir(), 'SantriHub');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'santrihub.log'), `${new Date().toISOString()} startup: ${error?.stack || error}\n`);
    } catch { /* nothing else to do */ }
    process.exitCode = 1;
  }
}

module.exports = { normalizeArgs, ensureExtracted };
