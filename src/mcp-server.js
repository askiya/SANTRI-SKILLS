'use strict';

// Minimal MCP stdio server (JSON-RPC 2.0, protocol 2024-11-05).
// Tools: list_skills, get_skill, search_docs. Reads from the local cache populated by `install`/`update`.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { REGISTRY, loadCatalog, selectSources, CACHE_ROOT } = require('./sources');

const PROTOCOL = '2024-11-05';
const pkg = require('../package.json');

const TOOLS = [
  {
    name: 'list_skills',
    description: 'Daftar semua skill Santriverse (Apps Script + Monorepo) beserta deskripsinya.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_skill',
    description: 'Ambil isi SKILL.md lengkap untuk satu skill berdasarkan id dari list_skills.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id skill, contoh: apps-script-security' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_docs',
    description: 'Cari teks di seluruh dokumen markdown pedoman (docs, checklists, templates) kedua repo. Kembalikan potongan yang cocok.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'kata kunci, dicocokkan case-insensitive' },
        limit: { type: 'number', description: 'maksimal hasil, default 10' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

let catalogPromise;
function catalog() {
  if (!catalogPromise) catalogPromise = loadCatalog();
  return catalogPromise;
}

function* walkMarkdown(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walkMarkdown(p);
    else if (d.name.toLowerCase().endsWith('.md')) yield p;
  }
}

async function callTool(name, args = {}) {
  const groups = await catalog();
  if (name === 'list_skills') {
    const rows = groups.flatMap((g) => g.skills.map((s) => `- [${s.source}] ${s.id}: ${s.description.slice(0, 180)}`));
    return `Total ${rows.length} skill:\n${rows.join('\n')}`;
  }
  if (name === 'get_skill') {
    for (const g of groups) {
      const hit = g.skills.find((s) => s.id === args.id);
      if (hit) return fs.readFileSync(path.join(hit.dir, 'SKILL.md'), 'utf8');
    }
    throw new Error(`Skill '${args.id}' tidak ditemukan. Panggil list_skills dulu.`);
  }
  if (name === 'search_docs') {
    const q = String(args.query || '').toLowerCase();
    if (!q) throw new Error('query kosong');
    const limit = Math.min(Number(args.limit) || 10, 50);
    const out = [];
    for (const source of selectSources()) {
      const root = path.join(CACHE_ROOT, source.id);
      for (const sub of [source.skillsDir, ...(source.docsDirs || [])]) {
        for (const file of walkMarkdown(path.join(root, sub))) {
          const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              out.push(`${source.id}:${path.relative(root, file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (out.length >= limit) return out.join('\n');
              break; // one hit per file keeps results diverse
            }
          }
        }
      }
    }
    return out.length ? out.join('\n') : `Tidak ada hasil untuk '${args.query}'.`;
  }
  throw new Error(`Tool tidak dikenal: ${name}`);
}

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function replyError(id, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }) + '\n');
}

function serve() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') {
        reply(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'santri-skills', version: pkg.version },
        });
      } else if (method === 'tools/list') {
        reply(id, { tools: TOOLS });
      } else if (method === 'tools/call') {
        const text = await callTool(params.name, params.arguments);
        reply(id, { content: [{ type: 'text', text }] });
      } else if (id !== undefined) {
        reply(id, {}); // notifications/initialized etc.
      }
    } catch (err) {
      if (id !== undefined) replyError(id, err.message);
    }
  });
}

module.exports = { serve, callTool, TOOLS };
