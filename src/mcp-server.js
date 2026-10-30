'use strict';

// Minimal MCP stdio server (JSON-RPC 2.0, protocol negotiated from SUPPORTED_PROTOCOLS).
// Tools: santrihub_status, list_skills, get_skill, get_skill_file, search_docs. No dashboard heartbeat or fake connection marker.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { loadCatalog, selectSources, CACHE_ROOT } = require('./sources');

// Newest first. Tools-only server: initialize/tools/list/tools/call are the same in these revisions.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
let protocol = SUPPORTED_PROTOCOLS[0];
const MAX_SKILL_FILE_BYTES = 512 * 1024;
const pkg = require('../package.json');
const {report}=require('./verification-bridge');

const TOOLS = [
  {
    name: 'santrihub_status',
    description: 'Bukti read-only bahwa runtime MCP santri-skills ini benar-benar dimuat klien: identitas server, versi, protocol, executable Node, dan root instalasi. Tidak membaca config atau secret.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
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
    name: 'get_skill_file',
    description: 'File pendukung sebuah skill (references/, templates/, scripts/, dst.). Tanpa path: daftar file. Dengan path: isi satu file teks.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id skill dari list_skills' },
        path: { type: 'string', description: 'path relatif di folder skill, contoh: references/release-checklist.md' },
      },
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
  // A failed load (offline, GitHub down) is not kept: the next tool call tries again.
  if (!catalogPromise) catalogPromise = loadCatalog().catch((err) => { catalogPromise = null; throw err; });
  return catalogPromise;
}

function findSkill(groups, id) {
  for (const g of groups) {
    const hit = g.skills.find((s) => s.id === id);
    if (hit) return hit;
  }
  throw new Error(`Skill '${id}' tidak ditemukan. Panggil list_skills dulu.`);
}

function* walkFiles(dir, root = dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walkFiles(p, root);
    else if (d.isFile() && d.name !== '.santri-skills.json') yield path.relative(root, p).split(path.sep).join('/');
  }
}

// Read-only and inside the skill folder only: no absolute path, no '..', no symlink, text up to 512 KB.
function readSkillFile(skill, rel) {
  if (rel === undefined || rel === '') {
    const files = [...walkFiles(skill.dir)].sort();
    return `${files.length} file di skill ${skill.id}:\n${files.map((f) => `- ${f}`).join('\n')}`;
  }
  if (typeof rel !== 'string' || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split(/[\\/]/).includes('..') || /[\x00-\x1f]/.test(rel)) {
    throw new Error('path harus relatif di dalam folder skill.');
  }
  const root = path.resolve(skill.dir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) throw new Error('path keluar dari folder skill.');
  for (let cur = file; cur !== root; cur = path.dirname(cur)) {
    if (fs.existsSync(cur) && fs.lstatSync(cur).isSymbolicLink()) throw new Error('Symlink ditolak.');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`File '${rel}' tidak ada di skill ${skill.id}. Panggil get_skill_file tanpa path untuk daftar file.`);
  if (fs.statSync(file).size > MAX_SKILL_FILE_BYTES) throw new Error('File melebihi 512 KB.');
  const data = fs.readFileSync(file);
  if (data.includes(0)) throw new Error('File biner tidak dikirim lewat MCP.');
  return data.toString('utf8');
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
  if (name === 'santrihub_status') {
    report('tool');
    // Identity + install location only. No config values, env, tokens or file contents.
    return JSON.stringify({
      server: 'santri-skills', version: pkg.version, protocolVersion: protocol,
      installationRoot: path.resolve(__dirname, '..'), nodeExecutable: process.execPath,
      toolNames: TOOLS.map((t) => t.name), skillCacheRoot: CACHE_ROOT, cacheExists: fs.existsSync(CACHE_ROOT),
      note: 'Proses bridge MCP aktif. Identitas IDE tidak diautentikasi; clientInfo bukan bukti identitas. Status tidak membuktikan MCP lain atau skill dimuat IDE.',
    }, null, 2);
  }
  const groups = await catalog();
  if (name === 'list_skills') {
    const rows = groups.flatMap((g) => g.skills.map((s) => `- [${s.source}] ${s.id}: ${s.description.slice(0, 180)}`));
    return `Total ${rows.length} skill:\n${rows.join('\n')}`;
  }
  if (name === 'get_skill') return fs.readFileSync(path.join(findSkill(groups, args.id).dir, 'SKILL.md'), 'utf8');
  if (name === 'get_skill_file') return readSkillFile(findSkill(groups, args.id), args.path);
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
function replyError(id, message, code = -32000) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
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
      return replyError(null, 'Parse error', -32700);
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return replyError(null, 'Invalid Request', -32600);
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications (initialized, cancelled, ...) never get a reply
    try {
      if (method === 'initialize') {
        report('initialize');
        const requested = params && params.protocolVersion;
        protocol = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
        reply(id, {
          protocolVersion: protocol,
          capabilities: { tools: {} },
          serverInfo: { name: 'santri-skills', version: pkg.version },
        });
      } else if (method === 'tools/list') {
        reply(id, { tools: TOOLS });
      } else if (method === 'tools/call') {
        const name = params && params.name;
        if (!TOOLS.some((t) => t.name === name)) return replyError(id, `Tool tidak dikenal: ${name}`, -32602);
        // Tool failures come back as a result with isError, so the agent can read the reason and recover.
        try {
          reply(id, { content: [{ type: 'text', text: await callTool(name, params.arguments || {}) }] });
        } catch (err) {
          reply(id, { content: [{ type: 'text', text: err.message }], isError: true });
        }
      } else if (method === 'ping') {
        reply(id, {});
      } else {
        replyError(id, `Method tidak didukung: ${method}`, -32601);
      }
    } catch (err) {
      replyError(id, err.message);
    }
  });
}

module.exports = { serve, callTool, TOOLS, SUPPORTED_PROTOCOLS };
