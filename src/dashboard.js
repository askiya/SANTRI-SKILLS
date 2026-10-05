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
const { detectTargets, validateCustomTargets, resolveTargets, resolveForWrite } = require('./detect');

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

function createDashboardServer({ cwd = process.cwd(), home, env = process.env, apiUrl, websiteUrl } = {}) {
  const session = createSession({ apiUrl, websiteUrl });
  const csrfTokens = new Map();
  let busy = false;
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
      if (input.scope === 'global' && input.confirmGlobal !== true) throw new AuthError(400, 'Konfirmasi global wajib.');

      // CSRF on write operations
      if (['/api/install', '/api/mcp', '/api/repo/install', '/api/targets/custom'].includes(req.url)) {
        if (!input._csrf || !csrfTokens.has(input._csrf)) return send(403, { error: 'Token CSRF tidak valid. Muat ulang halaman.' });
      }

      if (req.url === '/api/targets/custom') {
        const result = validateCustomTargets(input, { cwd: path.resolve(__dirname, '..') });
        customTargets = { skillsDir: result.skillsDir, mcpFile: result.mcpFile };
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
