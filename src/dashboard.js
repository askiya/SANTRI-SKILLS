'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSession, AuthError } = require('./auth');
const { fetchSource, listSkills } = require('./sources');
async function remoteSkills(reg) { const skills=[]; for(const source of reg.sources) { const root=await fetchSource(source); skills.push(...listSkills(source,root)); } return skills; }
const { mcpCatalog } = require('./registry');
const { installSkills, addMcpServer, configStatus } = require('./install');
const { previewRepo, installFromRepo, parseGithubRepo } = require('./repo');
const { skillSnapshot, mcpSnapshot, assertNoLinks } = require('./local-import');
const os = require('node:os');
const {previewGithub,publicPreview}=require('./github-import');
const {mcpRuntimeStatus}=require('./runtime-status');
const {runControl,pythonCommand}=require('./antigravity-control');
const publicLocalSkills = skills => skills.map(s => ({ id:s.id, name:s.name, description:s.description, files:s.files.length, bytes:s.files.reduce((n,f)=>n+f.data.length,0) }));
function copyLocalSkills(skills, targets) {
  for (const target of targets) for (const skill of skills) {
    assertNoLinks(path.join(target,skill.id));
    if (fs.existsSync(path.join(target,skill.id))) throw new Error('Folder skill sudah ada; tidak ditimpa.');
  }
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'santri-local-stage-'));
  try {
    const staged=skills.map(s=>{const dir=path.join(tmp,s.id);for(const f of s.files){const dest=path.join(dir,f.relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,f.data,{flag:'wx'});}return {id:s.id,dir,source:'local'};});
    return installSkills(staged,targets);
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
}
function mergeLocalMcp(file, entries) {
  assertNoLinks(file);assertNoLinks(file+'.bak');
  if(fs.existsSync(file)&&fs.lstatSync(file).nlink!==1)throw new Error('Hardlink target ditolak.');
  if(fs.existsSync(file+'.bak')&&fs.lstatSync(file+'.bak').nlink!==1)throw new Error('Hardlink backup ditolak.');
  let cfg={};if(fs.existsSync(file)){try{cfg=JSON.parse(fs.readFileSync(file,'utf8')||'{}')}catch{throw new Error('Target mcp_config.json bukan JSON valid. File tidak diubah.')}}
  if(!cfg||typeof cfg!=='object'||Array.isArray(cfg)||cfg.mcpServers!=null&&(!cfg.mcpServers||typeof cfg.mcpServers!=='object'||Array.isArray(cfg.mcpServers)))throw new Error('Target/mcpServers wajib object. File tidak diubah.');
  const bag=cfg.mcpServers||{};const collisions=Object.keys(entries).filter(n=>Object.hasOwn(bag,n));if(collisions.length)throw new Error(`MCP sudah ada: ${collisions.join(', ')}. File tidak diubah.`);
  const next={...cfg,mcpServers:{...bag,...entries}};fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file))fs.copyFileSync(file,file+'.bak');
  const temp=file+`.tmp-${process.pid}`;try{fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,file)}finally{fs.rmSync(temp,{force:true})}return Object.keys(next.mcpServers);
}
const { detectTargets, validateCustomTargets, resolveTargets, resolveForWrite, findAntigravityExecutable } = require('./detect');

const STATIC = {
  '/': { file: 'dashboard.html', type: 'text/html; charset=utf-8' },
  '/dashboard.css': { file: 'dashboard.css', type: 'text/css' },
  '/dashboard-ui.js': { file: 'dashboard-ui.js', type: 'text/javascript' },
  '/antigravity.js': { file: 'antigravity.js', type: 'text/javascript' },
  '/assets/santriverse-logo.webp': { file: '../assets/santriverse-logo.webp', type: 'image/webp' },
  '/assets/santriverse-logo-light.webp': { file: '../assets/santriverse-logo-light.webp', type: 'image/webp' },
  '/assets/antigravity.svg': { file: '../assets/antigravity.svg', type: 'image/svg+xml' },
};

const MAX_BODY = 16384;
// Names only; values (command/env/headers) never leave this helper.
function configStatusNames(file) { try { const c = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); return c && c.mcpServers && typeof c.mcpServers === 'object' && !Array.isArray(c.mcpServers) ? c.mcpServers : {}; } catch { return {}; } }

function createDashboardServer({ cwd = process.cwd(), home, env = process.env, apiUrl, websiteUrl, githubFetch = globalThis.fetch, controlRunner = runControl } = {}) {
  const session = createSession({ apiUrl, websiteUrl });
  const csrfTokens = new Map();
  let busy = false;
  // In-memory only. Preview tokens bind exact source + state + selected kind; expire after 10 min.
  const localPreviews = new Map();
  const githubPreviews = new Map();
  const putPreview = (kind, source, hash, scope) => {
    const id = crypto.randomBytes(24).toString('hex');
    localPreviews.set(id, { kind, source, hash, scope, target: JSON.stringify(resolveTargets(scope,targetOptions())), expires: Date.now() + 600_000 });
    for (const [k, v] of localPreviews) if (v.expires <= Date.now()) localPreviews.delete(k);
    while(localPreviews.size>20)localPreviews.delete(localPreviews.keys().next().value);
    return id;
  };
  const takePreview = (id, kind, scope) => {
    const p = localPreviews.get(id);
    if (!p || p.kind !== kind || p.expires <= Date.now()) throw new AuthError(409, 'Preview tidak ada atau kedaluwarsa. Preview ulang.');
    if (p.scope !== scope || p.target !== JSON.stringify(resolveTargets(scope,targetOptions()))) throw new AuthError(409, 'Scope berbeda dari preview. Preview ulang.');
    const current = kind === 'skills' ? skillSnapshot(p.source) : mcpSnapshot(p.source);
    if (current.hash !== p.hash) { localPreviews.delete(id); throw new AuthError(409, 'Sumber berubah sejak preview. Preview ulang.'); }
    localPreviews.delete(id);
    return current;
  };
  // In-memory only. Never persisted to disk, cleared when the process exits.
  let customTargets = { skillsDir: null, mcpFile: null };
  const targetOptions = () => ({ cwd, home, env, custom: customTargets, repoRoot: path.resolve(__dirname, '..') });

  function freshCsrf() {
    const tok = crypto.randomBytes(24).toString('hex');
    csrfTokens.set(tok, Date.now());
    // prune old tokens (>15 min)
    for (const [k, v] of csrfTokens) if (Date.now() - v > 900_000) csrfTokens.delete(k);
    return tok;
  }

  return http.createServer(async (req, res) => {
    const port = req.socket.localPort;
    const origin = `http://127.0.0.1:${port}`;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

    // Host / Origin protection on ALL requests
    if (req.headers.host !== `127.0.0.1:${port}`) return send(403, { error: 'Host ditolak' });
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin ditolak' });

    try {
      // ── Static assets (public) ──
      const stat = STATIC[req.url];
      if (req.method === 'GET' && stat) {
        const csp = stat.type.startsWith('text/html')
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'"
          : undefined;
        const headers = { 'Content-Type': stat.type, 'X-Content-Type-Options': 'nosniff' };
        if (csp) headers['Content-Security-Policy'] = csp;
        res.writeHead(200, headers);
        return res.end(fs.readFileSync(path.join(__dirname, stat.file)));
      }

      // ── Auth callback page (GET, public – receives hash fragment in browser) ──
      if (req.method === 'GET' && req.url.startsWith('/auth/callback')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`<!doctype html><html><body><script>
(function(){
  var h=location.hash.slice(1),p=new URLSearchParams(h);
  history.replaceState(null,'',location.pathname);
  fetch('/api/auth/callback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:p.get('state'),ticket:p.get('ticket')})}).then(function(r){return r.json().then(function(d){location.href='/'})}).catch(function(){location.href='/'});
})();
</script></body></html>`);
      }

      // ── POST body helper ──
      const readBody = async () => {
        if (req.headers['content-type'] !== 'application/json') throw new AuthError(400, 'Content-Type wajib application/json');
        if (req.headers.origin !== origin) throw new AuthError(403, 'Origin ditolak');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > MAX_BODY) throw new AuthError(400, 'Request terlalu besar'); }
        return JSON.parse(raw);
      };

      // ── Auth endpoints (POST only) ──
      if (req.method === 'POST' && req.url === '/api/auth/login') {
        await readBody();
        const result = session.startLogin(`${origin}/auth/callback`);
        return send(200, { url: result.url, expiresIn: result.expiresIn });
      }
      if (req.method === 'POST' && req.url === '/api/auth/callback') {
        const body = await readBody();
        const user = await session.completeLogin(body);
        return send(200, { user, csrf: freshCsrf() });
      }
      if (req.method === 'POST' && req.url === '/api/auth/logout') {
        await readBody();
        localPreviews.clear();githubPreviews.clear();csrfTokens.clear();
        await session.logout();
        return send(200, { message: 'Logged out' });
      }

      // ── Auth status (GET) ──
      if (req.method === 'GET' && req.url === '/api/auth/status') {
        if (!session.signedIn()) return send(401, { error: 'Belum login' });
        const user = await session.requirePremium();
        return send(200, { user, csrf: freshCsrf() });
      }

      // ── All further endpoints require premium (fail-closed) ──
      if (req.method === 'GET' && req.url.startsWith('/api/targets')) {
        await session.requirePremium();
        const u = new URL(req.url, origin);
        const scopes = u.searchParams.getAll('scope');
        if (u.pathname !== '/api/targets' || [...u.searchParams.keys()].some(k => k !== 'scope') || scopes.length !== 1 || !['project','global'].includes(scopes[0])) throw new AuthError(400, 'Parameter targets invalid.');
        const detection = detectTargets({ cwd, home, env });
        return send(200, { ...detection, custom: customTargets, effective: Object.fromEntries(['project','global'].map(s => [s, resolveTargets(s, { ...targetOptions(), detection })])) });
      }
      if (req.method === 'GET' && req.url.startsWith('/api/status')) {
        await session.requirePremium();
        const requestUrl = new URL(req.url, origin);
        if (requestUrl.pathname !== '/api/status' || [...requestUrl.searchParams.keys()].some((key) => key !== 'scope')) throw new AuthError(400, 'Parameter status invalid.');
        const scopes = requestUrl.searchParams.getAll('scope');
        if (scopes.length !== 1 || !['project', 'global'].includes(scopes[0])) throw new AuthError(400, 'Scope invalid.');
        const target = resolveTargets(scopes[0], targetOptions());
        return send(200, configStatus(scopes[0], cwd, home, { skillTargets: target.skillsDirs, mcpFile: target.mcpFile }));
      }

      if (req.method === 'GET' && req.url === '/api/catalog') {
        await session.requirePremium();
        const remoteCatalog = await session.catalog();
        const skills = await remoteSkills(remoteCatalog);
        const mcpServers = mcpCatalog(remoteCatalog).map(({ id, label, description }) => ({ id, label, description }));
        return send(200, {
          cwd,
          skills: skills.map(({ id, description, source }) => ({ id, description, source })),
          mcpServers,

        });
      }

      if (req.method !== 'POST') return send(404, { error: 'Tidak ditemukan' });
      await session.requirePremium();
      const input = await readBody();
      if (input.scope === 'global' && req.url !== '/api/verify' && !req.url.endsWith('/preview') && input.confirmGlobal !== true) throw new AuthError(400, 'Konfirmasi global wajib.');

      // CSRF on write operations
      if (['/api/install', '/api/mcp', '/api/repo/install', '/api/repo/preview', '/api/targets/custom',
           '/api/local/skills/preview', '/api/local/skills/install',
           '/api/local/mcp/preview', '/api/local/mcp/install', '/api/github/preview', '/api/github/install', '/api/verify', '/api/antigravity/control'].includes(req.url)) {
        if (!input._csrf || !csrfTokens.has(input._csrf) || Date.now()-csrfTokens.get(input._csrf)>900_000) return send(403, { error: 'Token CSRF tidak valid. Muat ulang halaman.' });
      }

      if (req.url === '/api/targets/custom') {
        const result = validateCustomTargets(input, { cwd: path.resolve(__dirname, '..') });
        customTargets = { skillsDir: result.skillsDir, mcpFile: result.mcpFile };localPreviews.clear();
        return send(200, { custom: customTargets, checks: result.checks, persisted: false });
      }

      if (req.url === '/api/repo/preview') {
        if (typeof input.url !== 'string') throw new AuthError(400, 'URL repo wajib.');
        parseGithubRepo(input.url); // validate early
        const result = await previewRepo(input.url, input.branch);
        return send(200, result);
      }

      if (req.url === '/api/repo/install') {
        if (typeof input.url !== 'string') throw new AuthError(400, 'URL repo wajib.');
        if (!['project', 'global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        const targets = () => resolveForWrite(input.scope, { ...targetOptions(), kind: 'skills' }).skillsDirs;
        const result = await installFromRepo(input.url, input.branch, input.skillIds, targets, { force: false });
        return send(200, result);
      }

      if (req.url === '/api/local/skills/preview') {
        const snap = skillSnapshot(input.source);
        if (!snap.skills.length) throw new AuthError(400, 'Tidak ada SKILL.md di folder sumber.');
        const scopeFor = ['project','global'].includes(input.scope) ? input.scope : null;
        if (!scopeFor) throw new AuthError(400, 'Scope invalid.');
        return send(200, { previewId: putPreview('skills', snap.source, snap.hash, scopeFor), source: snap.source, scope: scopeFor, skills: publicLocalSkills(snap.skills) });
      }
      if (req.url === '/api/local/skills/install') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        if (typeof input.previewId !== 'string') throw new AuthError(400, 'previewId wajib.');
        const ids = Array.isArray(input.skillIds) ? input.skillIds : [];
        if (!ids.length || ids.some(id => typeof id !== 'string')) throw new AuthError(400, 'Pilih minimal satu skill.');
        const snap = takePreview(input.previewId, 'skills', input.scope);
        const unknown = ids.filter(id => !snap.skills.some(s => s.id === id));
        if (unknown.length) throw new AuthError(400, `Skill tidak ada di sumber: ${unknown.join(', ')}`);
        const targets = resolveForWrite(input.scope, { ...targetOptions(), kind: 'skills' }).skillsDirs;
        const result = copyLocalSkills(snap.skills.filter(s => ids.includes(s.id)), targets);
        return send(200, { source: snap.source, scope: input.scope, installed: result.installed.length, skipped: result.skipped.length, targets, ids: result.installed.map(i => i.id) });
      }
      if (req.url === '/api/local/mcp/preview') {
        const snap = mcpSnapshot(input.source);
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        return send(200, { previewId: putPreview('mcp', snap.source, snap.hash, input.scope), source: snap.source, scope: input.scope, names: snap.names, count: snap.names.length,
          note: 'Hanya nama server ditampilkan. command/args/env/headers tidak pernah dikirim ke browser dan tidak dijalankan.' });
      }
      if (req.url === '/api/local/mcp/install') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        if (typeof input.previewId !== 'string') throw new AuthError(400, 'previewId wajib.');
        const names = Array.isArray(input.names) ? input.names : [];
        if (!names.length || names.some(n => typeof n !== 'string')) throw new AuthError(400, 'Pilih minimal satu MCP.');
        const snap = takePreview(input.previewId, 'mcp', input.scope);
        const unknown = names.filter(n => !snap.names.includes(n));
        if (unknown.length) throw new AuthError(400, `MCP tidak ada di sumber: ${unknown.join(', ')}`);
        const config = resolveForWrite(input.scope, { ...targetOptions(), kind: 'mcp' }).mcpFile;
        const existed = fs.existsSync(config);
        const servers = mergeLocalMcp(config, Object.fromEntries(names.map(n => [n, snap.entries[n]])));
        return send(200, { source: snap.source, scope: input.scope, config, added: names, servers, backup: existed ? `${config}.bak` : null, message: `${names.length} MCP lokal didaftarkan. Reload Antigravity.` });
      }

      if (req.url === '/api/github/preview') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        const targets = resolveTargets(input.scope, targetOptions());
        const snap = await previewGithub(input.url, { fetcher: githubFetch, scope: input.scope, targets: { skillsDirs: targets.skillsDirs, mcpFile: targets.mcpFile } });
        if (!snap.skills.length && !snap.mcp.length) throw new AuthError(400, 'Tidak ada SKILL.md atau mcp_config.json relevan di repo ini.');
        const id = crypto.randomBytes(24).toString('hex');
        githubPreviews.set(id, { snap, scope: input.scope, target: JSON.stringify(targets), expires: Date.now() + 600_000 });
        for (const [k, v] of githubPreviews) if (v.expires <= Date.now()) githubPreviews.delete(k);
        while (githubPreviews.size > 10) githubPreviews.delete(githubPreviews.keys().next().value);
        return send(200, { previewId: id, previewHash: snap.hash, sourceUrl: snap.source, scope: input.scope, ...publicPreview(snap),
          note: 'Preview saja. Tidak ada script repo yang dijalankan. Instalasi hanya menulis SKILL.md dan entri mcpServers setelah Anda konfirmasi.' });
      }
      if (req.url === '/api/github/install') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        if (typeof input.previewId !== 'string') throw new AuthError(400, 'previewId wajib.');
        if (input.confirm !== true) throw new AuthError(400, 'Konfirmasi instalasi wajib.');
        const held = githubPreviews.get(input.previewId);
        if (!held || held.expires <= Date.now()) throw new AuthError(409, 'Preview tidak ada atau kedaluwarsa. Preview ulang.');
        githubPreviews.delete(input.previewId);
        if (held.scope !== input.scope || held.target !== JSON.stringify(resolveTargets(input.scope, targetOptions()))) throw new AuthError(409, 'Scope/target berbeda dari preview. Preview ulang.');
        if (input.sourceUrl !== held.snap.source) throw new AuthError(409, 'URL berbeda dari preview. Preview ulang.');
        if (input.previewHash !== held.snap.hash) throw new AuthError(409, 'Preview sudah tidak sama. Preview ulang.');
        const current = await previewGithub(held.snap.source, {fetcher: githubFetch, scope: held.scope, targets: held.snap.targets});
        if(current.hash !== held.snap.hash) throw new AuthError(409, 'Sumber berubah sejak preview. Preview ulang.');
        const skillIds = Array.isArray(input.skillIds) ? input.skillIds : [];
        const mcpNames = Array.isArray(input.mcpNames) ? input.mcpNames : [];
        if (!skillIds.length && !mcpNames.length) throw new AuthError(400, 'Pilih minimal satu skill atau MCP.');
        if (skillIds.some(id => typeof id !== 'string') || mcpNames.some(n => typeof n !== 'string')) throw new AuthError(400, 'Pilihan invalid.');
        const unknownSkill = skillIds.filter(id => !held.snap.skills.some(s => s.id === id));
        if (unknownSkill.length) throw new AuthError(400, `Skill tidak ada di preview: ${unknownSkill.join(', ')}`);
        const entries = {};
        for (const name of mcpNames) {
          const file = held.snap.mcp.find(m => Object.hasOwn(m.entries, name));
          if (!file) throw new AuthError(400, `MCP tidak ada di preview: ${name}`);
          entries[name] = file.entries[name];
        }
        const result = { repo: held.snap.repo, branch: held.snap.branch, scope: input.scope, skills: null, mcp: null, installCommands: held.snap.installCommands };
        if (skillIds.length) {
          const dirs = resolveForWrite(input.scope, { ...targetOptions(), kind: 'skills' }).skillsDirs;
          const picked = held.snap.skills.filter(s => skillIds.includes(s.id)).map(s => ({ id: s.id, name: s.name, description: s.description, files: [{ relative: 'SKILL.md', data: s.data }] }));
          const copied = copyLocalSkills(picked, dirs);
          result.skills = { installed: copied.installed.length, skipped: copied.skipped.length, targets: dirs, ids: copied.installed.map(i => i.id) };
        }
        if (mcpNames.length) {
          const config = resolveForWrite(input.scope, { ...targetOptions(), kind: 'mcp' }).mcpFile;
          const existed = fs.existsSync(config);
          const servers = mergeLocalMcp(config, entries);
          result.mcp = { config, backup: existed ? `${config}.bak` : null, servers,
            added: mcpNames.map(name => ({ name, config: 'config ditulis', ...mcpRuntimeStatus(entries[name], env) })) };
          const missing = result.mcp.added.filter(a => a.available === false || a.launcherAvailable === false).map(a => a.name);
          result.partial = missing.length > 0;
          result.warning = missing.length
            ? `Config ditulis, TAPI binary untuk ${missing.join(', ')} tidak ditemukan di PATH. Server ini akan gagal di Antigravity sampai Anda memasang binary-nya sendiri. Perintah instalasi dari README hanya ditampilkan sebagai teks; dashboard tidak pernah menjalankannya.`
            : null;
        }
        return send(200, result);
      }
      if (req.url === '/api/verify') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        const target = resolveTargets(input.scope, targetOptions());
        const status = configStatus(input.scope, cwd, home, { skillTargets: target.skillsDirs, mcpFile: target.mcpFile });
        const raw = status.mcp.exists ? configStatusNames(status.mcp.configFile) : {};
        status.mcp.servers = status.mcp.servers.map(s => ({ ...s, ...mcpRuntimeStatus(raw[s.name], env) }));
        const python = pythonCommand(env);
        return send(200, { ...status, checkedAt: new Date().toISOString(), python: python ? 'tersedia' : 'python3/python tidak ditemukan di PATH',
          antigravityExecutable: findAntigravityExecutable({ home, env }),
          note: 'Status dari disk + resolusi PATH. Handshake MCP tidak diuji. Reload config di Antigravity dilakukan manual atau dengan restart aplikasi.' });
      }
      if (req.url === '/api/antigravity/control') {
        if (!['status','close','launch','restart'].includes(input.action)) throw new AuthError(400, 'Aksi invalid.');
        const closing = input.action === 'close' || input.action === 'restart';
        if (closing && input.confirmClose !== true) throw new AuthError(400, 'Konfirmasi wajib: menutup Antigravity dapat menghilangkan pekerjaan yang belum disimpan.');
        const force = input.force === true;
        try {
          if (input.action === 'status') return send(200, await controlRunner('status'));
          if (input.action === 'close') return send(200, await controlRunner('close', { force }));
          const executable = findAntigravityExecutable({ home, env });
          if(!executable)throw new Error('Binary Antigravity tidak ditemukan; tidak ada proses ditutup.');
          if (input.action === 'launch') return send(200, await controlRunner('launch', executable ? { executable } : {}));
          const closed = await controlRunner('close', { force });
          await new Promise(r => setTimeout(r, 1500));
          if((await controlRunner('status')).running)throw new Error('Antigravity masih berjalan; tutup dibatalkan atau belum selesai. Peluncuran dibatalkan.');
          return send(200, { closed, launched: await controlRunner('launch', executable ? { executable } : {}) });
        } catch (e) { throw new AuthError(502, e.message); }
      }

      if (!['/api/install', '/api/mcp'].includes(req.url)) return send(404, { error: 'Tidak ditemukan' });
      if (!['project', 'global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid');
      if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
      busy = true;
      try {
        if (req.url === '/api/mcp') {
          if (typeof input.id !== 'string' || input.confirm !== true) throw new Error('Konfirmasi MCP wajib');
          const entry = mcpCatalog(await session.catalog()).find((m) => m.id === input.id);
          if (!entry) throw new Error('MCP tidak terdaftar di katalog');
          const config = resolveForWrite(input.scope, { ...targetOptions(), kind: 'mcp' }).mcpFile;
          const before = fs.existsSync(config) ? Object.keys(configStatusNames(config)) : [];
          const existed = fs.existsSync(config);
          const name = entry.builtin ? 'santri-skills' : entry.id;
          const written = entry.builtin
            ? addMcpServer(config, { command: process.execPath, args: [path.resolve(__dirname, '../bin/cli.js'), 'mcp-serve'] })
            : addMcpServer(config, { command: entry.command, args: entry.args }, entry.id);
          const after = Object.keys(written.mcpServers || {});
          return send(200, { message: `MCP ${name} terdaftar. Reload Antigravity.`, config, backup: existed ? `${config}.bak` : null,
            added: after.filter((n) => !before.includes(n)), updated: before.includes(name) ? [name] : [], servers: after });
        }
        if (!Array.isArray(input.skillIds) || !input.skillIds.length || input.skillIds.some((id) => typeof id !== 'string')) throw new Error('Pilih skill');
        const skills = await remoteSkills(await session.catalog());
        if (input.skillIds.some((id) => !skills.some((s) => s.id === id))) throw new Error('Skill tidak terdaftar');
        const result = installSkills(skills.filter((s) => input.skillIds.includes(s.id)), resolveForWrite(input.scope, { ...targetOptions(), kind: 'skills' }).skillsDirs);
        send(200, { installed: result.installed.length, skipped: result.skipped.length });
      } finally {
        busy = false;
      }
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 400;
      send(status, { error: error.message || 'Terjadi kesalahan' });
    }
  });
}

module.exports = { createDashboardServer };
