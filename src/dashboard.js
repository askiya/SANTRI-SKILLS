'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadCatalog, registry } = require('./sources');
const { mcpCatalog } = require('./registry');
const { installSkills, skillTargets, mcpConfigPath, addMcpServer } = require('./install');

function createDashboardServer({ cwd = process.cwd() } = {}) {
  let busy = false;
  return http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${req.socket.localPort}`;
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
    if (req.headers.host !== `127.0.0.1:${req.socket.localPort}`) return send(403, { error: 'Host ditolak' });
    if (req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'Origin ditolak' });
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
      }
      if (req.method === 'GET' && ['/dashboard.css', '/dashboard-ui.js'].includes(req.url)) {
        res.writeHead(200, { 'Content-Type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, req.url.slice(1))));
      }
      if (req.method === 'GET' && req.url === '/api/catalog') {
        const groups = await loadCatalog();
        // Only id/label/description reach the browser; commands stay server-side.
        const mcpServers = mcpCatalog(registry()).map(({ id, label, description }) => ({ id, label, description }));
        return send(200, { cwd, skills: groups.flatMap(g => g.skills.map(({ id, description, source }) => ({ id, description, source }))), mcpServers });
      }
      if (req.method !== 'POST' || !['/api/install', '/api/mcp'].includes(req.url)) return send(404, { error: 'Tidak ditemukan' });
      if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return send(403, { error: 'Origin dan JSON wajib' });
      if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
      busy = true;
      try {
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) throw new Error('Request terlalu besar'); }
        const input = JSON.parse(raw);
        if (!['project', 'global'].includes(input.scope)) throw new Error('Scope invalid');
        if (req.url === '/api/mcp') {
          if (typeof input.id !== 'string' || input.confirm !== true) throw new Error('Konfirmasi MCP wajib');
          const entry = mcpCatalog(registry()).find(m => m.id === input.id);
          if (!entry) throw new Error('MCP tidak terdaftar di katalog');
          const config = mcpConfigPath(input.scope, cwd);
          // Built-in: stable local executable, works before npm publication. Catalog entries: config write only, never executed here.
          if (entry.builtin) addMcpServer(config, { command: process.execPath, args: [path.resolve(__dirname, '../bin/cli.js'), 'mcp-serve'] });
          else addMcpServer(config, { command: entry.command, args: entry.args }, entry.id);
          return send(200, { message: `MCP ${entry.id} terdaftar. Reload Antigravity.`, config });
        }
        if (!Array.isArray(input.skillIds) || !input.skillIds.length || input.skillIds.some(id => typeof id !== 'string')) throw new Error('Pilih skill');
        const skills = (await loadCatalog()).flatMap(g => g.skills);
        if (input.skillIds.some(id => !skills.some(s => s.id === id))) throw new Error('Skill tidak terdaftar');
        const result = installSkills(skills.filter(s => input.skillIds.includes(s.id)), skillTargets(input.scope, cwd));
        send(200, { installed: result.installed.length, skipped: result.skipped.length });
      } finally { busy = false; }
    } catch (error) { send(400, { error: error.message }); }
  });
}
module.exports = { createDashboardServer };
