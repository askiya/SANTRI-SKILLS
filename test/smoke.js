'use strict';
// Manual smoke check (not part of npm test): boots a mock remote + the real dashboard
// on a free port and exercises the live HTTP surface. Run: node test/smoke.js
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDashboardServer } = require('../src/dashboard');

const DASH_PORT = Number(process.argv[2]) || 5199;
const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ' — ' + extra : ''}`);

(async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-smoke-'));
  const remote = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') { for await (const _ of req) { /* drain */ } }
    res.end(JSON.stringify(req.url.endsWith('catalog')
      ? { success: true, sources: [], mcpServers: [{ id: 'cms', label: 'CMS MCP', description: 'Curated', command: 'npx', args: ['-y', 'santriverse-cms-mcp'] }] }
      : { success: true, token: 'smoke-token', user: { name: 'Smoke Member', email: 'member@example.test', is_premium: true } }));
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${remote.address().port}/api`;

  const server = createDashboardServer({ cwd, apiUrl: api, websiteUrl: 'http://127.0.0.1:3000' });
  await new Promise((r) => server.listen(DASH_PORT, '127.0.0.1', r));
  const base = `http://127.0.0.1:${DASH_PORT}`;
  console.log(`dashboard  ${base}\nmock api   ${api}\nworkspace  ${cwd}\n`);

  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  try {
    const page = await fetch(base + '/');
    const html = await page.text();
    ok('GET / serves the dashboard shell', page.status === 200 && html.includes('Santri Skills Dashboard'));
    ok('GET / sets a CSP', Boolean(page.headers.get('content-security-policy')));
    ok('GET /dashboard.css', (await fetch(base + '/dashboard.css')).status === 200);
    ok('GET /dashboard-ui.js', (await fetch(base + '/dashboard-ui.js')).status === 200);
    const cb = await fetch(base + '/auth/callback');
    const cbHtml = await cb.text();
    ok('callback page strips the hash before fetching', cb.status === 200 && cbHtml.includes('history.replaceState') && cbHtml.indexOf('history.replaceState') < cbHtml.indexOf('fetch('));

    ok('GET /api/catalog is 401 signed out', (await fetch(base + '/api/catalog')).status === 401);
    ok('POST /api/install is 401 signed out', (await post('/api/install', { scope: 'project', skillIds: ['x'] })).status === 401);
    ok('no files written while signed out', fs.readdirSync(cwd).length === 0);

    const login = await (await post('/api/auth/login', {})).json();
    const u = new URL(login.url);
    ok('login URL targets /skills/connect', u.pathname === '/skills/connect');
    ok('state is 64 hex chars', /^[a-f0-9]{64}$/.test(u.searchParams.get('state')));
    ok('code_challenge is 43 chars base64url', /^[\w-]{43}$/.test(u.searchParams.get('code_challenge')));
    ok('callback points back at this loopback port', u.searchParams.get('callback') === `${base}/auth/callback`);

    const cbRes = await post('/api/auth/callback', { state: u.searchParams.get('state'), ticket: 'smoke_ticket_value' });
    const cbBody = await cbRes.text();
    ok('callback exchange succeeds', cbRes.status === 200);
    ok('token never reaches the browser', !cbBody.includes('smoke-token'));
    const { csrf, user } = JSON.parse(cbBody);
    ok('member identity returned', user.name === 'Smoke Member' && user.premium === true);

    const cat = await (await fetch(base + '/api/catalog')).json();
    ok('catalog lists curated MCP entries', cat.mcpServers.some((m) => m.id === 'cms'));
    ok('MCP commands stay server-side', !JSON.stringify(cat.mcpServers).includes('npx'));

    ok('write without CSRF is refused', (await post('/api/mcp', { scope: 'project', id: 'cms', confirm: true })).status === 403);
    ok('global scope without confirmation is refused', (await post('/api/mcp', { scope: 'global', id: 'cms', confirm: true, _csrf: csrf })).status === 400);
    ok('project MCP registration succeeds', (await post('/api/mcp', { scope: 'project', id: 'cms', confirm: true, _csrf: csrf })).status === 200);
    ok('mcp_config.json written in the workspace', fs.existsSync(path.join(cwd, '.agents', 'mcp_config.json')));

    const badRepo = await post('/api/repo/preview', { url: 'https://evil.example/a/b', _csrf: csrf });
    ok('non-GitHub repo URL rejected', badRepo.status === 400);
    const sshRepo = await post('/api/repo/preview', { url: 'git@github.com:a/b.git', _csrf: csrf });
    ok('SSH repo URL rejected', sshRepo.status === 400);

    ok('logout succeeds', (await post('/api/auth/logout', {})).status === 200);
    ok('catalog closed again after logout', (await fetch(base + '/api/catalog')).status === 401);
  } finally {
    server.closeAllConnections();
    remote.closeAllConnections();
    await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => remote.close(r))]);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
})();
