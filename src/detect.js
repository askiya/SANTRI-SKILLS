'use strict';
// Read-only Antigravity target detection. Writes nothing, ever.
//
// Only locations Google documents are offered as install targets:
//   skills  : <workspace>/.agents/skills, <workspace>/.agent/skills (documented back-compat),
//             ~/.gemini/config/skills                        (antigravity.google/docs/skills)
//   mcp     : <workspace>/.agents/mcp_config.json,
//             ~/.gemini/config/mcp_config.json               (antigravity.google/docs/mcp)
// ~/.gemini/antigravity holds mcp_oauth_tokens.json per the MCP docs: it is read as
// EVIDENCE that Antigravity ran here, never offered as a skills/MCP write target.
// Application install dirs are evidence only too — an installed app and a config
// artifact are reported separately and never conflated.
//
// Env overrides (documented in README/UI): SANTRI_SKILLS_AG_HOME, ANTIGRAVITY_HOME
// relocate the user-level config base (the ~/.gemini equivalent).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const writable = (p) => { // nearest existing ancestor must accept writes
  let dir = p;
  for (;;) {
    if (fs.existsSync(dir)) { try { fs.accessSync(dir, fs.constants.W_OK); return true; } catch { return false; } }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
};

function countSkills(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'SKILL.md'))).length;
  } catch { return 0; }
}

// Returns shape only — never command/env/header/token values from the config.
function inspectMcp(file) {
  if (!fs.existsSync(file)) return { exists: false, valid: null, serverNames: [] };
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8') || '{}');
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { exists: true, valid: false, serverNames: [] };
    const bag = cfg.mcpServers;
    if (Object.hasOwn(cfg, 'mcpServers') && (!bag || typeof bag !== 'object' || Array.isArray(bag))) return { exists: true, valid: false, serverNames: [] };
    return { exists: true, valid: true, serverNames: Object.keys(bag || {}) };
  } catch { return { exists: true, valid: false, serverNames: [] }; }
}

function configBase(home, env) {
  const override = env.SANTRI_SKILLS_AG_HOME || env.ANTIGRAVITY_HOME;
  return { dir: override ? path.resolve(override) : path.join(home, '.gemini', 'config'), overridden: Boolean(override) };
}

function appEvidence(home, env, platform) {
  // User-requested cross-OS install candidates. Evidence only: none become write targets.
  const dirs = platform === 'win32'
    ? [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity'),
       path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Antigravity'),
       path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Antigravity'),
       path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Antigravity'), path.join(home, '.antigravity')]
    : platform === 'darwin'
      ? ['/Applications/Antigravity.app', path.join(home, 'Applications', 'Antigravity.app'),
         path.join(home, 'Library', 'Application Support', 'Antigravity'), path.join(home, '.antigravity')]
      : ['/usr/share/antigravity', '/opt/antigravity', path.join(home, '.local', 'share', 'antigravity'),
         path.join(home, '.config', 'Antigravity'), path.join(home, '.antigravity')];
  return dirs.filter((d) => fs.existsSync(d));
}

function detectTargets({ home = os.homedir(), cwd = process.cwd(), env = process.env, platform = process.platform } = {}) {
  const base = configBase(home, env);
  const candidates = [];
  const add = (c) => { candidates.push(c); return c; };

  const skillsDirs = [
    { dir: path.join(cwd, '.agents', 'skills'), scope: 'project', documented: true, note: 'workspace default (.agents/skills)' },
    { dir: path.join(cwd, '.agent', 'skills'), scope: 'project', documented: true, note: 'workspace back-compat (.agent/skills)' },
    { dir: path.join(base.dir, 'skills'), scope: 'global', documented: true, note: base.overridden ? 'global skills via env override' : 'global skills (~/.gemini/config/skills)' },
    ...(!base.overridden ? ['antigravity', 'antigravity-cli'].map(surface => ({ dir: path.join(home, '.gemini', surface, 'skills'), scope: 'global', documented: true, note: `skills ${surface} (surface-specific)` })) : []),
  ];
  for (const s of skillsDirs) {
    const exists = fs.existsSync(s.dir);
    const n = exists ? countSkills(s.dir) : 0;
    const evidence = [s.note + (s.documented ? ' — documented by Google' : '')];
    if (exists) evidence.push(n ? `folder skills berisi ${n} SKILL.md` : 'folder ada tapi belum berisi SKILL.md');
    else evidence.push('folder belum ada; akan dibuat saat instalasi');
    add({ kind: 'skills', scope: s.scope, dir: s.dir, exists, writable: writable(s.dir), skillCount: n,
      evidence, confidence: n > 0 ? 'high' : exists ? 'medium' : 'low', recommended: false });
  }

  const mcpFiles = [
    { file: path.join(cwd, '.agents', 'mcp_config.json'), scope: 'project', note: 'workspace mcp_config.json (.agents/mcp_config.json)' },
    { file: path.join(base.dir, 'mcp_config.json'), scope: 'global', note: base.overridden ? 'global mcp_config.json via env override' : 'global mcp_config.json (~/.gemini/config/mcp_config.json)' },
  ];
  for (const m of mcpFiles) {
    const info = inspectMcp(m.file);
    const evidence = [m.note + ' — documented by Google'];
    if (!info.exists) evidence.push('file belum ada; akan dibuat saat pendaftaran');
    else if (info.valid === false) evidence.push('file ada tetapi BUKAN JSON valid — tidak akan ditulis sampai diperbaiki');
    else evidence.push(`mcp_config.json valid JSON, ${info.serverNames.length} server terdaftar`);
    add({ kind: 'mcp', scope: m.scope, file: m.file, exists: info.exists, writable: writable(m.file),
      valid: info.valid, serverNames: info.serverNames, evidence,
      confidence: info.valid && info.serverNames.length ? 'high' : info.exists ? 'medium' : 'low', recommended: false });
  }

  // Pick one recommendation per kind+scope: highest confidence that is writable.
  const rank = { high: 3, medium: 2, low: 1 };
  for (const kind of ['skills', 'mcp']) for (const scope of ['project', 'global']) {
    const pool = candidates.filter((c) => c.kind === kind && c.scope === scope && c.writable);
    const best = pool.sort((a, b) => rank[b.confidence] - rank[a.confidence])[0];
    if (best) best.recommended = true;
  }

  // Evidence that Antigravity itself is present — config artifacts outside this repo only.
  const oauthTokens = path.join(home, '.gemini', 'antigravity', 'mcp_oauth_tokens.json');
  const configEvidence = [];
  if (fs.existsSync(base.dir)) configEvidence.push(`folder konfigurasi Antigravity ditemukan: ${base.dir}`);
  for (const c of candidates) {
    if (c.scope !== 'global') continue; // this repo's generated .agents is never proof
    if (c.kind === 'mcp' && c.exists) configEvidence.push(`${c.file} ada (${c.valid ? 'JSON valid' : 'JSON rusak'})`);
    if (c.kind === 'skills' && c.skillCount > 0) configEvidence.push(`${c.dir} berisi ${c.skillCount} SKILL.md`);
  }
  if (fs.existsSync(oauthTokens)) configEvidence.push('~/.gemini/antigravity/mcp_oauth_tokens.json ada (Antigravity pernah dipakai)');
  const appDirs = appEvidence(home, env, platform);

  return {
    platform, home, cwd,
    configBase: base.dir,
    envOverride: base.overridden ? (env.SANTRI_SKILLS_AG_HOME ? 'SANTRI_SKILLS_AG_HOME' : 'ANTIGRAVITY_HOME') : null,
    antigravityDetected: configEvidence.length > 0,
    applicationDetected: appDirs.length > 0,
    applicationEvidence: appDirs,
    configEvidence,
    candidates,
    manualSteps: configEvidence.length ? [] : [
      'Buka Antigravity → Settings → Customizations → Installed MCP Servers → Manage MCP Servers → View raw config untuk melihat path mcp_config.json yang dipakai.',
      'Global ada di ~/.gemini/config/mcp_config.json; per-workspace di <project>/.agents/mcp_config.json.',
      'Skills global ada di ~/.gemini/config/skills/, per-workspace di <project>/.agents/skills/.',
      'Kalau pathnya berbeda, tempel path absolutnya di kolom Target kustom lalu klik Validasi.',
    ],
  };
}

function validateCustomTargets(input, { cwd = process.cwd(), platform = process.platform, allowMissingParent = false, allowRepo = false } = {}) {
  if (!input || input.confirm !== true) throw new Error('Konfirmasi target kustom wajib.');
  if (input.reset === true) return { reset: true, skillsDir: null, mcpFile: null, checks: [] };
  const values = [['skillsDir', input.skillsDir], ['mcpFile', input.mcpFile]].filter(([, v]) => v != null && v !== '');
  if (!values.length) throw new Error('Isi minimal skillsDir atau mcpFile.');
  const repo = fs.realpathSync.native(cwd);
  const checks = [];
  for (const [kind, raw] of values) {
    if (typeof raw !== 'string' || !path.isAbsolute(raw)) throw new Error(`${kind} wajib path absolut.`);
    if (raw.startsWith('\\\\') || raw.startsWith('\\\\?\\') || raw.startsWith('\\\\.\\')) throw new Error(`${kind}: UNC/device path ditolak.`);
    const parts = raw.replace(/\\/g, '/').split('/');
    if (parts.includes('..')) throw new Error(`${kind}: segmen '..' ditolak.`);
    if (platform === 'win32' && raw.slice(2).includes(':')) throw new Error(`${kind}: alternate data stream (ADS) ditolak.`);
    const abs = path.resolve(raw);
    if (kind === 'mcpFile' && (path.extname(abs).toLowerCase() !== '.json' || path.basename(abs).toLowerCase() !== 'mcp_config.json')) throw new Error('mcpFile wajib bernama mcp_config.json.');
    if (kind === 'skillsDir' && path.basename(abs).toLowerCase() !== 'skills') throw new Error('skillsDir wajib folder bernama skills.');
    const root = path.parse(abs).root;
    if (abs === root) throw new Error(`${kind}: root filesystem/drive ditolak.`);
    const norm = abs.replace(/\\/g, '/').toLowerCase();
    const dangerous = platform === 'win32'
      ? ['/windows/', '/program files/', '/program files (x86)/', '/node_modules/']
      : ['/etc/', '/usr/', '/bin/', '/sbin/', '/var/', '/node_modules/'];
    if (dangerous.some((x) => `${norm}/`.includes(x))) throw new Error(`${kind}: lokasi sistem/node_modules ditolak.`);
    const relRepo = path.relative(repo, abs);
    if (!allowRepo && (relRepo === '' || (!relRepo.startsWith('..') && !path.isAbsolute(relRepo)))) throw new Error(`${kind}: folder repo CLI sendiri ditolak.`);
    if (kind === 'mcpFile' && /(?:credential|secret|token|password|passwd|id_rsa|id_ed25519)/i.test(path.basename(abs))) throw new Error('File kredensial sensitif ditolak.');

    // Existing ancestors may not be symlinks/junctions. realpath mismatch catches Windows junctions too.
    if (!allowMissingParent && (!fs.existsSync(path.dirname(abs)) || !fs.statSync(path.dirname(abs)).isDirectory())) throw new Error(`${kind}: parent tidak ada.`);
    if (fs.existsSync(abs) && (kind === 'skillsDir' ? !fs.statSync(abs).isDirectory() : !fs.statSync(abs).isFile())) throw new Error(`${kind}: tipe target salah.`);
    let cur = fs.existsSync(abs) ? abs : path.dirname(abs);
    while (allowMissingParent && !fs.existsSync(cur) && path.dirname(cur) !== cur) cur = path.dirname(cur);
    if (!fs.existsSync(cur)) throw new Error(`${kind}: parent tidak ada.`);
    let walk = cur;
    for (;;) {
      const st = fs.lstatSync(walk);
      if (st.isSymbolicLink()) throw new Error(`${kind}: symlink/junction ancestor ditolak.`);
      let real;
      try { real = fs.realpathSync.native(walk); } catch { real = walk; }
      if (path.resolve(real).toLowerCase() !== path.resolve(walk).toLowerCase()) throw new Error(`${kind}: symlink/junction ancestor ditolak.`);
      const up = path.dirname(walk); if (up === walk) break; walk = up;
    }
    const canWrite = writable(abs);
    if (!canWrite) throw new Error(`${kind}: parent tidak writable.`);
    const exists = fs.existsSync(abs);
    const check = { kind: kind === 'skillsDir' ? 'skills' : 'mcp', path: abs, exists, writable: canWrite,
      evidence: [exists ? 'target ada' : 'target belum ada; parent ada dan writable', 'path absolut tervalidasi', 'tanpa symlink/junction ancestor'] };
    if (kind === 'mcpFile') {
      const mcp = inspectMcp(abs); check.valid = mcp.valid; check.serverNames = mcp.serverNames;
      if (exists) check.evidence.push(mcp.valid ? `JSON valid, ${mcp.serverNames.length} server` : 'JSON rusak; operasi tulis akan ditolak');
    }
    checks.push(check);
  }
  return {
    reset: false,
    skillsDir: values.some(([k]) => k === 'skillsDir') ? path.resolve(input.skillsDir) : null,
    mcpFile: values.some(([k]) => k === 'mcpFile') ? path.resolve(input.mcpFile) : null,
    checks,
  };
}

// Single resolver: what detection recommends (or the validated manual override) is
// what every endpoint reads AND writes. Application install dirs are never candidates
// here, so they can never become write targets.
function resolveTargets(scope, { home = os.homedir(), cwd = process.cwd(), env = process.env, platform = process.platform, custom = {}, detection } = {}) {
  if (!['project', 'global'].includes(scope)) throw new Error('Scope invalid');
  const det = detection || detectTargets({ home, cwd, env, platform });
  const pick = (kind) => det.candidates.find((c) => c.kind === kind && c.scope === scope && c.recommended);
  const skills = pick('skills');
  const mcp = pick('mcp');
  return {
    scope,
    skillsDirs: custom.skillsDir ? [custom.skillsDir] : skills ? [skills.dir] : [],
    mcpFile: custom.mcpFile || (mcp ? mcp.file : null),
    source: { skills: custom.skillsDir ? 'custom' : skills ? 'detected' : 'none', mcp: custom.mcpFile ? 'custom' : mcp ? 'detected' : 'none' },
  };
}

// Writes only after a fresh validation: a custom path may have become a symlink,
// changed type, or lost write permission since it was selected.
function resolveForWrite(scope, opts = {}) {
  const custom = opts.custom || {};
  if (custom.skillsDir || custom.mcpFile) {
    validateCustomTargets({ confirm: true, skillsDir: custom.skillsDir || undefined, mcpFile: custom.mcpFile || undefined }, { cwd: opts.repoRoot || process.cwd(), platform: opts.platform });
  }
  const r = resolveTargets(scope, opts);
  if (opts.kind === 'skills' && !r.skillsDirs.length) throw new Error('Tidak ada folder skills writable yang terdeteksi. Tempel target kustom lalu Validasi.');
  if (opts.kind === 'mcp' && !r.mcpFile) throw new Error('Tidak ada mcp_config.json writable yang terdeteksi. Tempel target kustom lalu Validasi.');
  const fresh = opts.kind === 'skills' ? { skillsDir: r.skillsDirs[0] } : { mcpFile: r.mcpFile };
  validateCustomTargets({ confirm: true, ...fresh }, { cwd: opts.repoRoot || process.cwd(), platform: opts.platform, allowMissingParent: true, allowRepo: true });
  return r;
}

function findAntigravityExecutable({home=os.homedir(),env=process.env,platform=process.platform}={}) {
  const candidates=appEvidence(home,env,platform).map(d=>path.join(d,platform==='win32'?'Antigravity.exe':platform==='darwin'?'Contents/MacOS/Antigravity':'antigravity'));
  return candidates.find(f=>{try{return fs.statSync(f).isFile()}catch{return false}})||null;
}
module.exports = { detectTargets, validateCustomTargets, resolveTargets, resolveForWrite, findAntigravityExecutable };
if(require.main===module)process.stdout.write(JSON.stringify({executable:findAntigravityExecutable()}));
