'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSession, AuthError } = require('./auth');
const { registry, fetchSource, listSkills } = require('./sources');
const { mcpCatalog, validateRegistry, UMUM } = require('./registry');
function mergedCatalog(remote) {
  const bundled = registry(), sources = [], mcpServers = [];
  for (const source of [...bundled.sources, ...remote.sources]) {
    if (!sources.some(s => s.id === source.id || s.repo.toLowerCase() === source.repo.toLowerCase())) sources.push(source);
  }
  for (const entry of [...bundled.mcpServers, ...remote.mcpServers]) {
    if (!mcpServers.some(m => m.id === entry.id)) mcpServers.push(entry);
  }
  return validateRegistry({ sources, mcpServers });
}
async function remoteSkills(reg, sourceFetch) {
  const skills = new Map();
  for (const source of reg.sources) {
    const root = await sourceFetch(source);
    for (const skill of listSkills(source, root)) {
      const previous = skills.get(skill.id);
      if (previous && (previous.source !== skill.source || previous.dir !== skill.dir)) throw new Error(`ID skill katalog ambigu: ${skill.id}`);
      skills.set(skill.id, skill);
    }
  }
  return [...skills.values()];
}
const { installSkills, addMcpServer, mergeMcpEntries, configStatus, removeInstalled, SHADCN_ENTRY, ownServerEntry, ownedMarker } = require('./install');
const REACT_BITS_URL='https://reactbits.dev/get-started/mcp';
function reactBitsSource(value){
  if(typeof value!=='string')return null;
  try{
    const u=new URL(value.trim());
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;
    const host=u.hostname.toLowerCase(),sourcePath=u.pathname.replace(/\/$/,'');
    if(host==='reactbits.dev'&&(sourcePath===''||sourcePath==='/get-started/mcp'))return REACT_BITS_URL;
    if((host==='github.com'||host==='www.github.com')&&/^\/davidhdev\/react-bits(?:\.git)?$/i.test(sourcePath))return REACT_BITS_URL;
  }catch{}
  return null;
}
const REACT_BITS_REGISTRY={registries:{'@react-bits':'https://reactbits.dev/r/{name}.json'}};
const WEBSITE_WARNING='shadcn@latest tidak dipin. Antigravity dapat menjalankan npx dan mengunduh kode jaringan saat MCP dimuat; hanya lanjut jika mempercayai paket dan jaringan. Runtime IDE belum diverifikasi.';
const { previewRepo, installFromRepo, parseGithubRepo } = require('./repo');
const { skillSnapshot, mcpSnapshot, assertNoLinks } = require('./local-import');
const os = require('node:os');
const {previewGithub,publicPreview}=require('./github-import');
const {mcpKind,mcpRuntimeStatus}=require('./runtime-status');
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
function mergeLocalMcp(file,entries){const result=mergeMcpEntries(file,entries);return {servers:Object.keys(result.mcpServers||{}),backup:result.backup}}
const { detectTargets, validateCustomTargets, resolveTargets, resolveForWrite, findAntigravityExecutable } = require('./detect');
const { harnessDefs, findHarness, harnessStatus, setSkill, setMcp } = require('./harnesses');
const library = require('./library');
const gateway = require('./mcp-gateway');
const profiles = require('./profiles');
const mcpLibrary = require('./mcp-library');
const { scanUploads } = require('./smart-import');
const { probeMcp } = require('./mcp-probe');
const myPaket = require('./my-paket');
// The SantriHub MCP Gateway as an MCP entry: this runtime with `mcp-gateway` instead of `mcp-serve`.
const GATEWAY_ID = 'santrihub-gateway', GATEWAY_NAME = 'santrihub';
const gatewayEntry = () => { const e = ownServerEntry(); return { command: e.command, args: e.args.map((a) => (a === 'mcp-serve' ? 'mcp-gateway' : a)) }; };
const { EXTENSIONS } = require('./extensions');
const { createUpdateChecker } = require('./update');
const APP_VERSION = require('../package.json').version;

const STATIC = {
  '/': { file: 'dashboard.html', type: 'text/html; charset=utf-8' },
  '/dashboard.css': { file: 'dashboard.css', type: 'text/css' },
  '/dashboard-ui.js': { file: 'dashboard-ui.js', type: 'text/javascript' },
  '/wizard.js': { file: 'wizard.js', type: 'text/javascript' },
  '/antigravity.js': { file: 'antigravity.js', type: 'text/javascript' },
  '/assets/santriverse-logo.webp': { file: '../assets/santriverse-logo.webp', type: 'image/webp' },
  '/assets/santriverse-logo-light.webp': { file: '../assets/santriverse-logo-light.webp', type: 'image/webp' },
  '/assets/antigravity.svg': { file: '../assets/antigravity.svg', type: 'image/svg+xml' },
};

const MAX_BODY = 16384;
const MAX_UPLOAD_BODY = 56 * 1024 * 1024; // smart import: 40 MB of files as base64
// Private entries for PATH checks; only safe metadata is sent in API responses.
function configStatusNames(file) { try { const c = JSON.parse(fs.readFileSync(file, 'utf8') || '{}'); return c && c.mcpServers && typeof c.mcpServers === 'object' && !Array.isArray(c.mcpServers) ? Object.fromEntries(Object.entries(c.mcpServers).filter(([,entry])=>mcpKind(entry))) : {}; } catch { return {}; } }

function createDashboardServer({ cwd = process.cwd(), home, env = process.env, apiUrl, websiteUrl, githubFetch = globalThis.fetch, sourceFetch = fetchSource, controlRunner = runControl, bridgeFile, updateCheck = createUpdateChecker({ current: APP_VERSION }), probe = probeMcp } = {}) {
  const session = createSession({ apiUrl, websiteUrl });
  const capabilityFile=bridgeFile||path.join(home||os.homedir(),'.santrihub','bridge.json');
  const reposFile=path.join(home||os.homedir(),'.santrihub','repos.json');
  function canonicalRepo(url){
    // GitHub owner/repo case-insensitive; store lowercase so paste dari browser tetap bisa disimpan.
    if(typeof url==='string')url=url.trim().toLowerCase();
    if(typeof url!=='string'||url.length>256||!/^https:\/\/github\.com\/[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(url)||url.endsWith('.git')||['.','..'].includes(url.split('/').pop()))throw new AuthError(400,'URL wajib: https://github.com/owner/repo (tanpa tree/query).');
    return url;
  }
  function readRepos(){
    assertNoLinks(reposFile);if(!fs.existsSync(reposFile))return [];
    if(fs.statSync(reposFile).size>2*1024*1024)throw new Error('File bookmark terlalu besar.');
    const rows=JSON.parse(fs.readFileSync(reposFile,'utf8'));
    if(!Array.isArray(rows)||rows.length>50)throw new Error('File bookmark invalid.');
    return rows.map(row=>{const url=canonicalRepo(row.url);for(const names of [row.skills,row.mcp])if(!Array.isArray(names)||names.length>100||names.some(n=>typeof n!=='string'||n.length>160))throw new Error('Deteksi bookmark invalid.');return {url,repo:url.slice(19),skills:row.skills,mcp:row.mcp}});
  }
  function writeRepos(rows){
    assertNoLinks(reposFile);fs.mkdirSync(path.dirname(reposFile),{recursive:true,mode:0o700});
    const tmp=reposFile+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
    try{fs.writeFileSync(tmp,JSON.stringify(rows),{flag:'wx',mode:0o600});fs.renameSync(tmp,reposFile)}finally{fs.rmSync(tmp,{force:true})}
  }
  let verification=null;
  // Skill proof: a managed skill "santrihub-cek" holds a code that exists nowhere else. An agent that
  // sends it back through santrihub_verify has read that SKILL.md in its current session.
  const CHECK_SKILL='santrihub-cek',CHECK_PROMPT='Gunakan skill santrihub-cek untuk mengecek SantriHub.';
  const checkSkillMd=(code,expires)=>['---','name: '+CHECK_SKILL,'description: Cek SantriHub. Pakai skill ini hanya saat pengguna meminta cek SantriHub atau menyebut santrihub-cek.','---','','# Cek SantriHub','','1. Panggil tool MCP `santrihub_verify` dari server `santri-skills` dengan:','   - `code`: "'+code+'"','   - `skills`: daftar nama (id) semua skill yang tersedia untukmu di sesi ini, termasuk santrihub-cek.','2. Sampaikan jawaban tool itu apa adanya kepada pengguna.','','Kode ini dibuat SantriHub untuk satu kali cek dan berlaku sampai '+new Date(expires).toLocaleTimeString('id-ID')+'.',''].join('\n');
  function writeCheckSkill(dir,code,expires){
    const dest=path.join(dir,CHECK_SKILL),marker=path.join(dest,'.santri-skills.json');assertNoLinks(dest);
    if(fs.existsSync(dest)&&!fs.existsSync(marker))throw new AuthError(409,'Folder skill santrihub-cek sudah ada dan bukan buatan SantriHub. Ganti namanya dulu.');
    fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'SKILL.md'),checkSkillMd(code,expires));
    fs.writeFileSync(marker,JSON.stringify({source:CHECK_SKILL,installedAt:new Date().toISOString()},null,2));
  }
  // Compares the skills found on disk at start with the names the agent reported.
  const skillProof=()=>{const p=verification&&verification.skillProof;if(!p)return null;const said=new Set(p.reported);
    return {verified:true,observedAt:p.observedAt,skill:CHECK_SKILL,seen:verification.skillsAtStart.filter(id=>said.has(id.toLowerCase())),notSeen:verification.skillsAtStart.filter(id=>!said.has(id.toLowerCase())),reportedCount:p.reported.length};};
  const clearVerification=()=>{verification=null;assertNoLinks(capabilityFile);fs.rmSync(capabilityFile,{force:true});};
  const binding=()=>{const t=resolveTargets('global',targetOptions());const hash=crypto.createHash('sha256').update(JSON.stringify(t));for(const file of [t.mcpFile,...t.skillsDirs.flatMap(dir=>fs.existsSync(dir)?fs.readdirSync(dir).map(id=>path.join(dir,id,'SKILL.md')):[])]){assertNoLinks(file);hash.update(file);if(fs.existsSync(file)&&fs.statSync(file).isFile())hash.update(fs.readFileSync(file));}return hash.digest('hex');};
  const evidence=()=>{if(verification&&(verification.expires<=Date.now()||verification.binding!==binding()))clearVerification();return {verified:Boolean(verification&&verification.evidence),pending:Boolean(verification&&!(verification.evidence&&verification.skillProof)),expiresAt:verification?verification.expires:null,evidence:verification?verification.evidence:null,skillProof:skillProof(),prompt:verification?CHECK_PROMPT:null,note:'Bukti hanya bridge santri-skills. MCP lain belum diketahui; file Skills bukan bukti dimuat IDE. Identitas IDE tidak diautentikasi.'};};
  const csrfTokens = new Map();
  let busy = false;
  const libRoot = library.libraryRoot(home || os.homedir());
  const libraryPreviews = new Map(); // in-memory GitHub scans awaiting the member's review (10 min)
  const gatewayPath = gateway.gatewayFile(home || os.homedir(), env);
  const profilesPath = profiles.profilesFile(home || os.homedir());
  const harnessStateFile = path.join(home || os.homedir(), '.santrihub', 'harness-mcp.json');
  const mcpLibPath = mcpLibrary.mcpLibraryFile(home || os.homedir());
  const myPaketPath = myPaket.myPaketFile(home || os.homedir());
  // Paket an own skill/MCP may be tagged with: catalog paket, "umum" and the member's own.
  const knownPaket = async () => new Set([...mergedCatalog(await session.catalog()).sources.map((x) => x.id), UMUM.id, ...myPaket.readMyPaket(myPaketPath).map((p) => p.id)]);
  // Names a member's own MCP may not take: catalog ids and the names SantriHub writes.
  const reservedMcp = async () => new Set([GATEWAY_ID, GATEWAY_NAME, 'santri-skills', ...mcpCatalog(mergedCatalog(await session.catalog())).map((m) => m.id)]);
  // A skill to activate: catalog first, then the member's library.
  async function resolveSkill(id) {
    const skill = (await remoteSkills(mergedCatalog(await session.catalog()), sourceFetch)).find((s) => s.id === id) || library.listLibrary(libRoot).find((s) => s.id === id);
    if (!skill) throw new Error(`Skill ${id} tidak ada di katalog maupun library Anda.`);
    return skill;
  }
  // An MCP to register: { name in the agent config, base entry }.
  async function resolveMcp(id) {
    if (id === GATEWAY_ID) return { name: GATEWAY_NAME, base: gatewayEntry() };
    const entry = mcpCatalog(mergedCatalog(await session.catalog())).find((m) => m.id === id);
    if (entry) return entry.builtin ? { name: 'santri-skills', base: ownServerEntry() } : { name: entry.id, base: { command: entry.command, args: entry.args } };
    const own = mcpLibrary.readMcpLibrary(mcpLibPath)[id];
    if (own) return { name: id, base: own.entry, mine: true };
    throw new Error(`MCP ${id} tidak ada di katalog maupun MCP milik Anda.`);
  }
  // In-memory only. Preview tokens bind exact source + state + selected kind; expire after 10 min.
  const localPreviews = new Map();
  const githubPreviews = new Map();
  const websitePreviews = new Map();
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

  const server=http.createServer(async (req, res) => {
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

      // Public catalog of official extensions (store links only, no member data).
      if (req.method === 'GET' && req.url === '/api/extensions') return send(200, { extensions: EXTENSIONS });
      // Public: is a newer SantriHub release out? (cached; never blocks the dashboard)
      if (req.method === 'GET' && req.url === '/api/update') return send(200, await updateCheck());

      if(req.method==='POST'&&req.url==='/api/verification/bridge'){
        await session.requirePremium();
        if(req.socket.remoteAddress!=='127.0.0.1')throw new AuthError(403,'Callback hanya loopback.');
        if(req.headers.origin||req.headers['content-type']!=='application/json')throw new AuthError(403,'Callback ditolak.');
        let raw='';for await(const c of req){raw+=c;if(Buffer.byteLength(raw)>32*1024)throw new AuthError(400,'Callback terlalu besar.');}
        const body=JSON.parse(raw),token=req.headers['x-santrihub-bridge'];evidence();
        if(!verification||typeof token!=='string'||token.length!==64||!crypto.timingSafeEqual(Buffer.from(token),Buffer.from(verification.token))||body.challenge!==verification.challenge||!['initialize','tool','verify'].includes(body.event))throw new AuthError(403,'Callback invalid atau kedaluwarsa.');
        if(body.event==='verify'){
          if(verification.skillProof)throw new AuthError(409,'Kode cek sudah dipakai. Buat kode baru di SantriHub.');
          const code=typeof body.code==='string'?body.code.trim().toUpperCase():'';
          if(code.length!==verification.code.length||!crypto.timingSafeEqual(Buffer.from(code),Buffer.from(verification.code)))throw new AuthError(403,'Kode cek tidak cocok. Buat kode baru di SantriHub, muat ulang agent, lalu coba lagi.');
          const reported=Array.isArray(body.skills)?[...new Set(body.skills.filter(s=>typeof s==='string').map(s=>s.trim().toLowerCase().slice(0,160)).filter(Boolean))].slice(0,500):[];
          verification.skillProof={observedAt:new Date().toISOString(),reported};
          if(!verification.evidence)verification.evidence={server:'santri-skills',level:'bridge-mcp-loaded',source:'local-capability-callback',event:'verify',observedAt:new Date().toISOString(),identityAuthenticated:false};
          const p=skillProof();
          return send(200,{accepted:true,seen:p.seen.length,total:verification.skillsAtStart.length,notSeen:p.notSeen.slice(0,20)});
        }
        if(verification.evidence)throw new AuthError(409,'Callback sudah dipakai.');
        verification.evidence={server:'santri-skills',level:'bridge-mcp-loaded',source:'local-capability-callback',event:body.event,observedAt:new Date().toISOString(),identityAuthenticated:false};
        return send(200,{accepted:true});
      }
      if(req.method==='GET'&&req.url==='/api/verification/status'){await session.requirePremium();return send(200,evidence());}

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
      const readBody = async (limit = MAX_BODY) => {
        if (req.headers['content-type'] !== 'application/json') throw new AuthError(400, 'Content-Type wajib application/json');
        if (req.headers.origin !== origin) throw new AuthError(403, 'Origin ditolak');
        const chunks = [];
        let size = 0;
        for await (const chunk of req) { if ((size += chunk.length) > limit) throw new AuthError(400, 'Request terlalu besar'); chunks.push(chunk); }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
        clearVerification();localPreviews.clear();githubPreviews.clear();websitePreviews.clear();csrfTokens.clear();
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
        if (u.pathname !== '/api/targets' || [...u.searchParams.keys()].some(k => k !== 'scope') || scopes.length !== 1 || scopes[0]!=='global') throw new AuthError(400, 'Parameter targets invalid.');
        const detection = detectTargets({ cwd, home, env });
        return send(200, { ...detection, custom: customTargets, effective: Object.fromEntries(['global'].map(s => [s, resolveTargets(s, { ...targetOptions(), detection })])) });
      }
      if (req.method === 'GET' && req.url.startsWith('/api/status')) {
        await session.requirePremium();
        const requestUrl = new URL(req.url, origin);
        if (requestUrl.pathname !== '/api/status' || [...requestUrl.searchParams.keys()].some((key) => key !== 'scope')) throw new AuthError(400, 'Parameter status invalid.');
        const scopes = requestUrl.searchParams.getAll('scope');
        if (scopes.length !== 1 || scopes[0]!=='global') throw new AuthError(400, 'Scope invalid.');
        const target = resolveTargets(scopes[0], targetOptions());
        return send(200, configStatus(scopes[0], cwd, home, { skillTargets: target.skillsDirs, mcpFile: target.mcpFile }));
      }

      if(req.method==='GET'&&req.url==='/api/repos'){await session.requirePremium();return send(200,readRepos())}
      if (req.method === 'GET' && req.url === '/api/catalog') {
        await session.requirePremium();
        const catalog = mergedCatalog(await session.catalog());
        const skills = await remoteSkills(catalog, sourceFetch);
        // Each source is a paket (Apps Script, Monorepo, …); MCP servers without one go to "umum".
        const mcpServers = mcpCatalog(catalog).map(({ id, label, description, paket }) => ({ id, label, description, paket: paket && paket.length ? paket : [UMUM.id] }));
        const paket = [...catalog.sources.map(({ id, label, short, description, author, color, icon, starter, order, fit, repo }) => ({ id, label, short: short || label, description: description || '', author: author || '', color: color || 'blue', icon: icon || '✦', starter: starter || null, order: order ?? 100, fit: fit || [], homepage: `https://github.com/${repo}` })), { ...UMUM, starter: null, fit: [], homepage: null }]
          .map((p) => ({ ...p, skills: skills.filter((s) => s.source === p.id).length, mcp: mcpServers.filter((m) => m.paket.includes(p.id)).length }))
          .filter((p) => p.skills || p.mcp)
          .sort((a, b) => a.order - b.order);
        return send(200, {
          cwd,
          skills: skills.map(({ id, description, source }) => ({ id, description, source })),
          mcpServers,
          paket,
        });
      }

      // AI agents (harnesses) on this machine: where skills/MCP live and what is active. Names only.
      if (req.method === 'GET' && req.url === '/api/harnesses') {
        await session.requirePremium();
        return send(200, { harnesses: harnessStatus({ home: home || os.homedir(), env }) });
      }
      // The member's own skills (GitHub imports and Markdown), see src/library.js.
      if (req.method === 'GET' && req.url === '/api/library') {
        await session.requirePremium();
        return send(200, { skills: library.listLibrary(libRoot).map(({ dir, ...s }) => s) });
      }
      // Which catalog MCP servers run behind the SantriHub MCP Gateway.
      if (req.method === 'GET' && req.url === '/api/gateway') {
        await session.requirePremium();
        return send(200, { servers: Object.keys(gateway.readGateway(gatewayPath)) });
      }
      // The member's own MCP servers: names, kind and a short summary; env values never leave the PC.
      if (req.method === 'GET' && req.url === '/api/mcp-library') {
        await session.requirePremium();
        return send(200, { servers: Object.entries(mcpLibrary.readMcpLibrary(mcpLibPath)).map(([name, row]) => ({ id: name, name, from: row.from, addedAt: row.addedAt, ...mcpLibrary.publicEntry(row.entry), paket: row.paket })) });
      }
      if (req.method === 'GET' && req.url === '/api/my-paket') {
        await session.requirePremium();
        return send(200, { paket: myPaket.readMyPaket(myPaketPath) });
      }
      if (req.method === 'GET' && req.url === '/api/profiles') {
        await session.requirePremium();
        return send(200, { version: 1, profiles: profiles.readProfiles(profilesPath) });
      }

      if (req.method !== 'POST') return send(404, { error: 'Tidak ditemukan' });
      await session.requirePremium();
      const input = await readBody(req.url === '/api/library/upload/preview' ? MAX_UPLOAD_BODY : MAX_BODY);
      if(input.scope!=null&&input.scope!=='global')throw new AuthError(400,'Dashboard hanya scope global.');
      if(['/api/verification/start','/api/uninstall'].includes(req.url)){
        if(!input._csrf||!csrfTokens.has(input._csrf)||Date.now()-csrfTokens.get(input._csrf)>900_000)throw new AuthError(403,'Token CSRF invalid.');
        if(req.url==='/api/uninstall'){if(input.confirm!==true||input.confirmGlobal!==true)throw new AuthError(400,'Konfirmasi uninstall global wajib.');const target=resolveForWrite('global',{...targetOptions(),kind:input.kind==='skill'?'skills':'mcp'});const result=removeInstalled({kind:input.kind,id:input.id,skillsDir:target.skillsDirs[0],mcpFile:target.mcpFile});clearVerification();return send(200,result);}
        clearVerification();const target=resolveTargets('global',targetOptions());const status=configStatus('global',cwd,home,{skillTargets:target.skillsDirs,mcpFile:target.mcpFile});
        if(!status.mcp.servers.some(s=>s.name==='santri-skills'&&s.managed))throw new AuthError(409,'Pasang bridge MCP santri-skills resmi sebelum verifikasi callback.');
        const expires=Date.now()+600000,code='SH-'+crypto.randomBytes(5).toString('hex').toUpperCase().replace(/^(.{5})/,'$1-');
        writeCheckSkill(resolveForWrite('global',{...targetOptions(),kind:'skills'}).skillsDirs[0],code,expires);
        const skillsAtStart=[...new Set(status.skills.map(s=>s.id).filter(id=>id&&id!==CHECK_SKILL))];
        const challenge=crypto.randomBytes(32).toString('hex');verification={challenge,token:crypto.randomBytes(32).toString('hex'),binding:binding(),expires,evidence:null,code,skillsAtStart,skillProof:null};
        assertNoLinks(capabilityFile);fs.mkdirSync(path.dirname(capabilityFile),{recursive:true,mode:0o700});fs.writeFileSync(capabilityFile,JSON.stringify({port,token:verification.token,challenge,expires:verification.expires}),{flag:'wx',mode:0o600});
        return send(200,{challenge,expiresAt:verification.expires,skill:CHECK_SKILL,prompt:CHECK_PROMPT,note:'Kode cek ada di skill santrihub-cek. Restart Antigravity, buka chat Agent baru, lalu tempel prompt. Callback MCP saja hanya membuktikan bridge santri-skills.'});
      }
      if (input.scope === 'global' && req.url !== '/api/verify' && !req.url.endsWith('/preview') && input.confirmGlobal !== true) throw new AuthError(400, 'Konfirmasi global wajib.');

      // CSRF on write operations
      if (['/api/install', '/api/mcp', '/api/repo/install', '/api/repo/preview', '/api/targets/custom',
           '/api/local/skills/preview', '/api/local/skills/install',
           '/api/local/mcp/preview', '/api/local/mcp/install', '/api/github/preview', '/api/github/install', '/api/repos', '/api/repos/delete', '/api/website/preview', '/api/website/install', '/api/verify', '/api/antigravity/control',
           '/api/harnesses/skill', '/api/harnesses/mcp', '/api/harnesses/bulk',
           '/api/library/github/preview', '/api/library/github/save', '/api/library/markdown', '/api/library/delete', '/api/library/update',
           '/api/library/upload/preview', '/api/library/upload/save', '/api/mcp-library/delete', '/api/mcp/test',
           '/api/library/paket', '/api/mcp-library/paket', '/api/my-paket/save', '/api/my-paket/delete',
           '/api/gateway', '/api/profiles/save', '/api/profiles/apply', '/api/profiles/delete', '/api/profiles/import'].includes(req.url)) {
        if (!input._csrf || !csrfTokens.has(input._csrf) || Date.now()-csrfTokens.get(input._csrf)>900_000) return send(403, { error: 'Token CSRF tidak valid. Muat ulang halaman.' });
      }

      if(['/api/repos','/api/repos/delete'].includes(req.url)){
        const url=canonicalRepo(input.url),rows=readRepos();
        if(req.url.endsWith('/delete')){writeRepos(rows.filter(row=>row.url!==url));return send(200,{saved:false})}
        if(rows.some(row=>row.url===url))throw new AuthError(409,'Repository sudah disimpan.');
        if(rows.length>=50)throw new AuthError(400,'Maksimal 50 repository.');
        const held=githubPreviews.get(input.previewId);
        if(!held||held.expires<=Date.now()||held.snap.source.trim().toLowerCase()!==url)throw new AuthError(409,'Preview repository wajib. Preview ulang.');
        const row={url,repo:url.slice(19),skills:held.snap.skills.map(s=>s.name),mcp:held.snap.mcp.flatMap(m=>m.names)};
        writeRepos([...rows,row]);return send(200,row);
      }
      if (req.url === '/api/targets/custom') {
        const result = validateCustomTargets(input, { cwd: path.resolve(__dirname, '..') });
        clearVerification();customTargets = { skillsDir: result.skillsDir, mcpFile: result.mcpFile };localPreviews.clear();
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
        const merged = mergeLocalMcp(config, Object.fromEntries(names.map(n => [n, snap.entries[n]])));
        return send(200, { source: snap.source, scope: input.scope, config, added: names, servers: merged.servers, backup: merged.backup, message: `${names.length} MCP lokal didaftarkan. Reload Antigravity.` });
      }

      if (req.url === '/api/website/preview') {
        if(!reactBitsSource(input.url))throw new AuthError(400,'Preset website tidak dikenal. Hanya URL React Bits resmi atau repo DavidHDev/react-bits yang didukung.');
        if(input.scope!=='global')throw new AuthError(400,'Scope invalid.');
        const target=resolveTargets('global',targetOptions()),previewId=crypto.randomBytes(24).toString('hex');
        for(const [id,p] of websitePreviews)if(p.expires<=Date.now())websitePreviews.delete(id);
        while(websitePreviews.size>=10)websitePreviews.delete(websitePreviews.keys().next().value);
        websitePreviews.set(previewId,{url:REACT_BITS_URL,target:JSON.stringify(target),expires:Date.now()+600000});
        return send(200,{previewId,source:'website-preset',url:REACT_BITS_URL,name:'shadcn',entry:SHADCN_ENTRY,target:target.mcpFile,registry:REACT_BITS_REGISTRY,registryInstruction:'Salin blok registries ke components.json pada SETIAP project yang memakai React Bits. Konfigurasi global tidak dapat menggantikannya.',warning:WEBSITE_WARNING,recognition:'React Bits dikenali · menggunakan shadcn MCP',runtime:'unverified',fetched:false});
      }
      if (req.url === '/api/website/install') {
        if(!reactBitsSource(input.url))throw new AuthError(409,'Sumber berbeda dari preview. Preview ulang.');
        if(input.confirm!==true||input.consentNetworkExecution!==true)throw new AuthError(400,'Konfirmasi risiko eksekusi jaringan wajib.');
        const held=websitePreviews.get(input.previewId);
        if(!held||held.expires<=Date.now()||held.url!==reactBitsSource(input.url)||held.target!==JSON.stringify(resolveTargets('global',targetOptions())))throw new AuthError(409,'Preview tidak ada, kedaluwarsa, atau target berubah. Preview ulang.');
        const config=resolveForWrite('global',{...targetOptions(),kind:'mcp'}).mcpFile;
        // Token consumed only after the write commits: failed validation/collision keeps the preview correctable.
        const written=addMcpServer(config,SHADCN_ENTRY,'shadcn',{preset:'react-bits'});websitePreviews.delete(input.previewId);clearVerification();
        return send(200,{name:'shadcn',config,backup:written.backup,verified:true,runtime:'unverified',warning:WEBSITE_WARNING,registry:REACT_BITS_REGISTRY});
      }

      if (req.url === '/api/github/preview') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        const targets = resolveTargets(input.scope, targetOptions());
        let snap;try { snap = await previewGithub(input.url, { fetcher: githubFetch, scope: input.scope, targets: { skillsDirs: targets.skillsDirs, mcpFile: targets.mcpFile } }); } catch(error) {
          if(!error.tooLarge&&!error.unscannable)throw error;
          return send(200,{classification:error.unscannable?'unscannable':'too-large',sourceUrl:input.url,scope:input.scope,targets,skills:[],mcp:[],installCommands:[],note:error.unscannable?'Repository valid, tetapi struktur arsip tidak dapat dipindai aman. Tidak ada item yang dipasang.':'Repository valid, tetapi terlalu besar untuk dipindai dengan aman; tidak ada yang dapat dipasang otomatis.'});

        }
        const classification = snap.skills.length || snap.mcp.length ? 'installable' : 'empty';
        const id = crypto.randomBytes(24).toString('hex');
        githubPreviews.set(id, { snap, scope: input.scope, target: JSON.stringify(targets), expires: Date.now() + 600_000 });
        for (const [k, v] of githubPreviews) if (v.expires <= Date.now()) githubPreviews.delete(k);
        while (githubPreviews.size > 10) githubPreviews.delete(githubPreviews.keys().next().value);
        return send(200, { previewId: id, previewHash: snap.hash, sourceUrl: snap.source, scope: input.scope, ...publicPreview(snap),
          classification, note: classification === 'empty' ? 'Repository valid, tetapi tidak menyediakan SKILL.md atau konfigurasi MCP yang dapat dipasang.' : 'Preview saja. Tidak ada script repo yang dijalankan. Instalasi hanya menulis SKILL.md dan entri mcpServers setelah Anda konfirmasi.' });
      }
      if (req.url === '/api/github/install') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        if (typeof input.previewId !== 'string') throw new AuthError(400, 'previewId wajib.');
        if (input.confirm !== true) throw new AuthError(400, 'Konfirmasi instalasi wajib.');
        const held = githubPreviews.get(input.previewId);
        if (!held || held.expires <= Date.now()) throw new AuthError(409, 'Preview tidak ada atau kedaluwarsa. Preview ulang.');
        if (held.scope !== input.scope || held.target !== JSON.stringify(resolveTargets(input.scope, targetOptions()))) throw new AuthError(409, 'Scope/target berbeda dari preview. Preview ulang.');
        if (input.sourceUrl !== held.snap.source) throw new AuthError(409, 'URL berbeda dari preview. Preview ulang.');
        if (input.previewHash !== held.snap.hash) throw new AuthError(409, 'Preview sudah tidak sama. Preview ulang.');
        if (held.installing) throw new AuthError(409, 'Instalasi sedang berjalan.');
        held.installing = true;
        try {
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
          const merged = mergeLocalMcp(config, entries);
          result.mcp = { config, backup: merged.backup, servers: merged.servers,
            added: mcpNames.map(name => ({ name, config: 'config ditulis', ...mcpRuntimeStatus(entries[name], env) })) };
          const missing = result.mcp.added.filter(a => a.available === false || a.launcherAvailable === false).map(a => a.name);
          result.partial = missing.length > 0;
          result.warning = missing.length
            ? `Config ditulis, TAPI binary untuk ${missing.join(', ')} tidak ditemukan di PATH. Server ini akan gagal di Antigravity sampai Anda memasang binary-nya sendiri. Perintah instalasi dari README hanya ditampilkan sebagai teks; dashboard tidak pernah menjalankannya.`
            : null;
        }
        githubPreviews.delete(input.previewId);
        return send(200, result);
        } finally { held.installing = false; }
      }
      if (req.url === '/api/verify') {
        if (!['project','global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid.');
        const target = resolveTargets(input.scope, targetOptions());
        const status = configStatus(input.scope, cwd, home, { skillTargets: target.skillsDirs, mcpFile: target.mcpFile });
        const raw = status.mcp.exists ? configStatusNames(status.mcp.configFile) : {};
        status.mcp.servers = status.mcp.servers.map(s => ({ ...s, ...mcpRuntimeStatus(raw[s.name], env) }));
        const catalog = mergedCatalog(await session.catalog());
        const skillsCatalog = await remoteSkills(catalog, sourceFetch);
        const mcpCandidates = mcpCatalog(catalog);
        if (input.skillIds != null && (!Array.isArray(input.skillIds) || input.skillIds.length > 1000 || input.skillIds.some(id=>typeof id !== 'string' || !skillsCatalog.some(s=>s.id===id)))) throw new AuthError(400, 'Kandidat skill invalid.');
        const skillIds = [...new Set([...status.skills.map(s=>s.id), ...(input.skillIds||[])])];
        const skillChecks = skillIds.map(id=>{const found=status.skills.find(s=>s.id===id);return {id,exists:Boolean(found),path:found?path.join(found.dir,'SKILL.md'):path.join(target.skillsDirs[0],id,'SKILL.md')};});
        const mcpIds = [...new Set([...status.mcp.servers.map(s=>s.name), ...mcpCandidates.map(m=>m.builtin?'santri-skills':m.id)])];
        const mcpChecks = mcpIds.map(name=>status.mcp.servers.find(s=>s.name===name)||{name,configured:false,runtime:'belum terpasang',available:null});
        const python = pythonCommand(env);
        return send(200, { ...status, skillChecks, mcpChecks, workspace: cwd, checkedAt: new Date().toISOString(), python: python ? 'tersedia' : 'python3/python tidak ditemukan di PATH',
          antigravityExecutable: findAntigravityExecutable({ home, env }),
          verification:evidence(), note: 'Status dari disk + resolusi PATH. Handshake MCP tidak diuji oleh dashboard. Callback bridge terpisah; MCP lain tetap tidak diketahui.' });
      }
      if (req.url === '/api/antigravity/control') {
        if (!['status','close','launch','restart'].includes(input.action)) throw new AuthError(400, 'Aksi invalid.');
        const closing = input.action === 'close' || input.action === 'restart';
        if (closing && input.confirmClose !== true) throw new AuthError(400, 'Konfirmasi wajib: menutup Antigravity dapat menghilangkan pekerjaan yang belum disimpan.');
        const force = input.force === true;
        // Force never escalates automatically: it needs its own explicit consent on top of confirmClose.
        if (force && (!closing || input.confirmForce !== true)) throw new AuthError(400, 'Paksa tutup wajib konfirmasi terpisah (confirmForce) dan hanya untuk close/restart.');
        // One verified executable for status/close/launch: never a sibling Antigravity product.
        const executable = findAntigravityExecutable({ home, env });
        if(!executable)throw new Error('Executable Antigravity IDE terverifikasi tidak ditemukan (atau ambigu); tidak ada proses dibuka/ditutup.');
        const forceRequired = (e) => /^FORCE_REQUIRED:/.test(e.message || '');
        try {
          if (input.action === 'status') return send(200, await controlRunner('status', { executable }));
          if (input.action === 'close') return send(200, await controlRunner('close', { force, executable }));
          if (input.action === 'launch') return send(200, await controlRunner('launch', { executable }));
          const closed = await controlRunner('close', { force, executable });
          if((await controlRunner('status', { executable })).running)throw new Error('Antigravity IDE masih berjalan; tutup dibatalkan atau belum selesai. Peluncuran dibatalkan.');
          return send(200, { closed, launched: await controlRunner('launch', { executable }) });
        } catch (e) {
          if (forceRequired(e)) return send(409, { error: e.message.replace(/^FORCE_REQUIRED:\s*/, ''), forceRequired: true, action: input.action,
            warning: 'Paksa berhenti akan menutup Antigravity IDE tanpa menyimpan. Pekerjaan yang belum disimpan hilang permanen.' });
          throw new AuthError(502, e.message);
        }
      }

      // ── Skill library ──
      if (req.url.startsWith('/api/library/')) {
        if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
        busy = true;
        try {
          const defs = harnessDefs({ home: home || os.homedir(), env });
          const catalogIds = async () => new Set((await remoteSkills(mergedCatalog(await session.catalog()), sourceFetch)).map((s) => s.id));
          const index = library.readIndex(libRoot);
          const assertFree = async (id, allowSame) => {
            if (!library.ID_RE.test(id)) throw new AuthError(400, 'ID skill wajib huruf kecil, angka, dan tanda hubung (maks 64).');
            if ((await catalogIds()).has(id)) throw new AuthError(409, `ID ${id} sudah dipakai skill katalog Santriverse. Pilih ID lain.`);
            if (index.skills[id] && !allowSame(index.skills[id])) throw new AuthError(409, `Skill ${id} sudah ada di library. Hapus dulu atau pakai tombol Update.`);
          };
          // Copies of a library skill that are active in some AI agent follow its new content.
          const syncActive = (id) => {
            const dir = path.join(libRoot, 'skills', id);
            return defs.filter((h) => ownedMarker(path.join(h.skillsDir, id))).map((h) => { installSkills([{ id, dir, source: 'library' }], [h.skillsDir]); return h.name; });
          };

          if (req.url === '/api/library/github/preview') {
            const scan = await library.scanGithub(input.url, { fetcher: githubFetch, includeScripts: input.includeScripts === true });
            const previewId = crypto.randomBytes(24).toString('hex');
            libraryPreviews.set(previewId, { scan, includeScripts: input.includeScripts === true, expires: Date.now() + 600_000 });
            for (const [k, v] of libraryPreviews) if (v.expires <= Date.now()) libraryPreviews.delete(k);
            return send(200, { previewId, source: scan.source, skills: scan.skills.map((s) => ({ key: s.key, id: s.id, description: s.description, generated: s.generated, repaired: s.repaired,
              files: s.files.map((f) => f.rel), skipped: s.skipped, skillMd: s.skillMd.slice(0, 6000) })) });
          }
          if (req.url === '/api/library/github/save') {
            const held = libraryPreviews.get(input.previewId);
            if (!held || held.expires <= Date.now()) throw new AuthError(409, 'Preview kedaluwarsa. Preview ulang.');
            if (!Array.isArray(input.picks) || !input.picks.length || input.picks.length > 20) throw new AuthError(400, 'Pilih minimal satu skill.');
            const saved = [];
            for (const pick of input.picks) {
              const s = held.scan.skills.find((x) => x.key === pick.key);
              if (!s) throw new AuthError(400, 'Skill tidak ada di preview.');
              const id = String(pick.id || s.id), description = String(pick.description || s.description).replace(/\s+/g, ' ').trim().slice(0, 1024);
              if (!description) throw new AuthError(400, `Deskripsi ${id} wajib.`);
              await assertFree(id, () => false);
              library.saveSkill(libRoot, { id, skillMd: library.withFrontmatter(s.skillMd, { name: id, description }), files: s.files,
                meta: { type: 'github', ...held.scan.source, key: s.key, generated: s.generated, includeScripts: held.includeScripts, sourceHash: s.sourceHash, description } });
              saved.push(id);
            }
            libraryPreviews.delete(input.previewId);
            return send(200, { saved });
          }
          if (req.url === '/api/library/markdown') {
            const skill = library.markdownSkill({ id: input.id, description: input.description, content: input.content, references: input.references || [] });
            await assertFree(skill.id, (meta) => meta.type === 'markdown' && input.overwrite === true);
            library.saveSkill(libRoot, { id: skill.id, skillMd: skill.skillMd, files: skill.files, meta: { type: 'markdown', description: skill.description } });
            return send(200, { saved: [skill.id], synced: syncActive(skill.id) });
          }
          // Smart import: ZIPs, folders, files and MCP configs/commands, reviewed before saving.
          if (req.url === '/api/library/upload/preview') {
            const items = input.items == null ? [] : input.items;
            if (!Array.isArray(items) || items.some((x) => !x || typeof x.path !== 'string' || typeof x.data !== 'string')) throw new AuthError(400, 'Format upload tidak valid.');
            if (!items.length && !String(input.mcpText || '').trim()) throw new AuthError(400, 'Pilih file, folder, ZIP, atau tempel MCP dulu.');
            const scan = scanUploads(items.map((x) => ({ path: x.path, data: Buffer.from(x.data, 'base64') })), { mcpText: String(input.mcpText || ''), includeScripts: input.includeScripts === true });
            const previewId = crypto.randomBytes(24).toString('hex');
            libraryPreviews.set(previewId, { upload: scan, expires: Date.now() + 600_000 });
            for (const [k, v] of libraryPreviews) if (v.expires <= Date.now()) libraryPreviews.delete(k);
            const taken = await catalogIds(), reserved = await reservedMcp(), mine = mcpLibrary.readMcpLibrary(mcpLibPath);
            return send(200, { previewId, problems: scan.problems,
              skills: scan.skills.map((s) => ({ key: s.key, source: s.source, id: s.id, description: s.description, generated: s.generated, repaired: s.repaired,
                files: s.files.map((f) => f.rel), skipped: s.skipped, skillMd: s.skillMd.slice(0, 6000), exists: taken.has(s.id) ? 'catalog' : index.skills[s.id] ? 'library' : null })),
              mcp: scan.mcp.map((m) => ({ key: m.key, name: m.name, from: m.from, ...mcpLibrary.publicEntry(m.entry), exists: reserved.has(m.name) ? 'catalog' : mine[m.name] ? 'mine' : null })) });
          }
          if (req.url === '/api/library/upload/save') {
            const held = libraryPreviews.get(input.previewId);
            if (!held || !held.upload || held.expires <= Date.now()) throw new AuthError(409, 'Preview kedaluwarsa. Pilih file lagi.');
            const picks = Array.isArray(input.picks) ? input.picks : [], mcpPicks = Array.isArray(input.mcpPicks) ? input.mcpPicks : [];
            if (!picks.length && !mcpPicks.length) throw new AuthError(400, 'Pilih minimal satu skill atau MCP.');
            if (picks.length > 150 || mcpPicks.length > 50) throw new AuthError(400, 'Terlalu banyak pilihan sekaligus.');
            const reserved = await reservedMcp(), mine = mcpLibrary.readMcpLibrary(mcpLibPath);
            let paket;
            try { paket = myPaket.paketIds(input.paket, await knownPaket()); } catch (e) { throw new AuthError(400, e.message); }
            // Check everything first: either all picks are saved or none.
            const skillRows = [];
            for (const pick of picks) {
              const s = held.upload.skills.find((x) => x.key === pick.key);
              if (!s) throw new AuthError(400, 'Skill tidak ada di preview.');
              const id = String(pick.id || s.id), description = String(pick.description || s.description).replace(/\s+/g, ' ').trim().slice(0, 1024);
              if (!description) throw new AuthError(400, `Deskripsi ${id} wajib.`);
              if (skillRows.some((r) => r.id === id)) throw new AuthError(400, `ID ${id} dipilih dua kali.`);
              await assertFree(id, (meta) => input.overwrite === true && meta.type === 'upload');
              skillRows.push({ s, id, description });
            }
            const mcpRows = [];
            for (const pick of mcpPicks) {
              const m = held.upload.mcp.find((x) => x.key === pick.key);
              if (!m) throw new AuthError(400, 'MCP tidak ada di preview.');
              const name = String(pick.name || m.name);
              if (!mcpLibrary.NAME_RE.test(name)) throw new AuthError(400, `Nama MCP "${name}" wajib huruf, angka, - atau _ (maks 40).`);
              if (reserved.has(name)) throw new AuthError(409, `Nama ${name} dipakai MCP katalog. Pilih nama lain.`);
              if (mine[name] && input.overwrite !== true) throw new AuthError(409, `MCP ${name} sudah ada di koleksi Anda. Ganti nama atau centang "timpa".`);
              if (mcpRows.some((r) => r.name === name)) throw new AuthError(400, `Nama ${name} dipilih dua kali.`);
              mcpRows.push({ m, name });
            }
            const saved = [], savedMcp = [], synced = [];
            for (const { s, id, description } of skillRows) {
              library.saveSkill(libRoot, { id, skillMd: library.withFrontmatter(s.skillMd, { name: id, description }), files: s.files,
                meta: { type: 'upload', source: s.source, key: s.key, generated: s.generated, sourceHash: s.sourceHash, description, paket } });
              saved.push(id);
              synced.push(...syncActive(id).map((h) => `${id} @ ${h}`));
            }
            for (const { m, name } of mcpRows) savedMcp.push(mcpLibrary.saveMcp(mcpLibPath, name, m.entry, m.from, paket));
            libraryPreviews.delete(input.previewId);
            return send(200, { saved, savedMcp, synced });
          }
          if (typeof input.id !== 'string' || !index.skills[input.id]) throw new AuthError(404, 'Skill tidak ada di library.');
          if (req.url === '/api/library/paket') {
            let paket;
            try { paket = myPaket.paketIds(input.paket, await knownPaket()); } catch (e) { throw new AuthError(400, e.message); }
            return send(200, { id: input.id, paket: library.setLibraryPaket(libRoot, input.id, paket) });
          }
          if (req.url === '/api/library/delete') {
            // Its SantriHub copies in the AI agents go too; folders the member made stay.
            const deactivated = defs.filter((h) => ownedMarker(path.join(h.skillsDir, input.id))).map((h) => { removeInstalled({ kind: 'skill', id: input.id, skillsDir: h.skillsDir }); return h.name; });
            return send(200, { ...library.removeSkill(libRoot, input.id), deactivated });
          }
          if (req.url === '/api/library/update') {
            const meta = index.skills[input.id];
            if (meta.type !== 'github') throw new AuthError(400, 'Hanya skill dari GitHub yang bisa dicek update.');
            const scan = await library.scanGithub(meta.url, { fetcher: githubFetch, includeScripts: meta.includeScripts === true });
            const s = scan.skills.find((x) => x.key === meta.key) || (scan.skills.length === 1 ? scan.skills[0] : null);
            if (!s) throw new AuthError(409, 'Skill ini tidak lagi ditemukan di repository.');
            if (s.sourceHash === meta.sourceHash) return send(200, { changed: false, id: input.id });
            library.saveSkill(libRoot, { id: input.id, skillMd: library.withFrontmatter(s.skillMd, { name: input.id, description: meta.description || s.description }), files: s.files,
              meta: { ...meta, ...scan.source, key: s.key, generated: s.generated, sourceHash: s.sourceHash } });
            return send(200, { changed: true, id: input.id, synced: syncActive(input.id) });
          }
          return send(404, { error: 'Tidak ditemukan' });
        } finally {
          busy = false;
        }
      }

      // "Tes koneksi": start one MCP server like an agent would and list its tools.
      if (req.url === '/api/mcp/test') {
        if (typeof input.id !== 'string') throw new AuthError(400, 'id wajib.');
        const m = await resolveMcp(input.id);
        const result = await probe(m.base, { env: input.id === GATEWAY_ID ? { ...env, SANTRIHUB_GATEWAY_FILE: gatewayPath } : env });
        if (input.id === GATEWAY_ID && result.ok && !result.toolCount) {
          result.hint = Object.keys(gateway.readGateway(gatewayPath)).length
            ? 'Gateway jalan, tapi MCP di dalamnya belum menawarkan tool. Tes koneksi tiap MCP di Koleksi untuk melihat yang gagal.'
            : 'Gateway masih kosong. Pilih MCP di panel Gateway pada langkah 3 · Aktifkan.';
        }
        return send(200, { id: input.id, name: m.name, ...result });
      }
      if (req.url === '/api/mcp-library/paket') {
        if (typeof input.id !== 'string' || !mcpLibrary.readMcpLibrary(mcpLibPath)[input.id]) throw new AuthError(404, 'MCP tidak ada di koleksi Anda.');
        let paket;
        try { paket = myPaket.paketIds(input.paket, await knownPaket()); } catch (e) { throw new AuthError(400, e.message); }
        return send(200, { id: input.id, paket: mcpLibrary.setMcpPaket(mcpLibPath, input.id, paket) });
      }
      if (req.url === '/api/my-paket/save') {
        try { return send(200, { paket: myPaket.addMyPaket(myPaketPath, input) }); } catch (e) { throw new AuthError(400, e.message); }
      }
      // Deleting an own paket untags its skills and MCP; the skills and MCP themselves stay.
      if (req.url === '/api/my-paket/delete') {
        if (typeof input.id !== 'string' || !myPaket.removeMyPaket(myPaketPath, input.id)) throw new AuthError(404, 'Paket tidak ditemukan.');
        for (const s of library.listLibrary(libRoot)) if (s.paket.includes(input.id)) library.setLibraryPaket(libRoot, s.id, s.paket.filter((p) => p !== input.id));
        for (const [name, row] of Object.entries(mcpLibrary.readMcpLibrary(mcpLibPath))) if (row.paket.includes(input.id)) mcpLibrary.setMcpPaket(mcpLibPath, name, row.paket.filter((p) => p !== input.id));
        return send(200, { removed: input.id });
      }
      // Removes one of the member's own MCP servers, and SantriHub's copies of it in the agents.
      if (req.url === '/api/mcp-library/delete') {
        const own = mcpLibrary.readMcpLibrary(mcpLibPath)[input.id];
        if (typeof input.id !== 'string' || !own) throw new AuthError(404, 'MCP tidak ada di koleksi Anda.');
        if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
        busy = true;
        try {
          const deactivated = [], kept = [];
          for (const h of harnessDefs({ home: home || os.homedir(), env })) {
            try { if (setMcp(h, input.id, own.entry, false, { stateFile: harnessStateFile }).removed) deactivated.push(h.name); } catch { kept.push(h.name); }
          }
          if (gateway.readGateway(gatewayPath)[input.id]) gateway.setGatewayServer(gatewayPath, input.id, null);
          mcpLibrary.removeMcp(mcpLibPath, input.id);
          return send(200, { removed: true, id: input.id, deactivated, kept });
        } finally { busy = false; }
      }

      if (req.url === '/api/gateway') {
        if (typeof input.id !== 'string' || typeof input.enable !== 'boolean') throw new AuthError(400, 'id dan enable wajib.');
        if (input.id === GATEWAY_ID) throw new AuthError(400, 'Gateway tidak bisa berisi dirinya sendiri.');
        const m = await resolveMcp(input.id).catch(() => { throw new AuthError(400, 'MCP tidak terdaftar di katalog maupun koleksi Anda.'); });
        if (input.enable && m.base.url) throw new AuthError(400, 'MCP lewat URL tidak bisa masuk Gateway. Aktifkan langsung per AI agent.');
        const servers = gateway.setGatewayServer(gatewayPath, m.name, input.enable ? m.base : null);
        return send(200, { servers, hint: 'Reload AI agent yang memakai SantriHub Gateway agar daftar tool diperbarui.' });
      }

      // Turn one catalog skill / MCP server on or off for one harness.
      if (req.url === '/api/harnesses/skill' || req.url === '/api/harnesses/mcp') {
        if (typeof input.harness !== 'string' || typeof input.id !== 'string' || typeof input.enable !== 'boolean') throw new AuthError(400, 'harness, id dan enable wajib.');
        const h = findHarness(harnessDefs({ home: home || os.homedir(), env }), input.harness);
        if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
        busy = true;
        try {
          clearVerification();
          const result = req.url === '/api/harnesses/skill'
            ? setSkill(h, input.enable ? await resolveSkill(input.id) : { id: input.id }, input.enable)
            : await (async () => { const m = await resolveMcp(input.id); return setMcp(h, m.name, m.base, input.enable, { stateFile: harnessStateFile }); })();
          return send(200, { ...result, harness: h.id, hint: h.restartHint || `Reload ${h.name} agar perubahan terbaca.` });
        } finally {
          busy = false;
        }
      }
      // A whole paket (or any set) on or off for one harness in one go; each item reports alone.
      if (req.url === '/api/harnesses/bulk') {
        const ids = (v) => (v == null ? [] : v);
        const skills = ids(input.skills), mcp = ids(input.mcp);
        if (typeof input.harness !== 'string' || typeof input.enable !== 'boolean' || !Array.isArray(skills) || !Array.isArray(mcp)
          || [...skills, ...mcp].some((x) => typeof x !== 'string') || !skills.length && !mcp.length || skills.length + mcp.length > 200) throw new AuthError(400, 'harness, enable dan daftar skills/mcp wajib.');
        const h = findHarness(harnessDefs({ home: home || os.homedir(), env }), input.harness);
        if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
        busy = true;
        const done = [], failed = [];
        try {
          clearVerification();
          for (const id of skills) {
            try { setSkill(h, input.enable ? await resolveSkill(id) : { id }, input.enable); done.push(id); } catch (e) { failed.push({ id, error: e.message }); }
          }
          for (const id of mcp) {
            try { const m = await resolveMcp(id); setMcp(h, m.name, m.base, input.enable, { stateFile: harnessStateFile }); done.push(id); } catch (e) { failed.push({ id, error: e.message }); }
          }
        } finally {
          busy = false;
        }
        return send(200, { done, failed, harness: h.id, hint: h.restartHint || `Reload ${h.name} agar perubahan terbaca.` });
      }

      // ── Profiles: named sets of skills + MCP applied to an agent in one go ──
      if (req.url.startsWith('/api/profiles/')) {
        if (req.url === '/api/profiles/delete') return send(200, { deleted: profiles.deleteProfile(profilesPath, input.name) });
        if (req.url === '/api/profiles/import') return send(200, { imported: profiles.importProfiles(profilesPath, input.data) });
        const h = findHarness(harnessDefs({ home: home || os.homedir(), env }), input.harness);
        if (req.url === '/api/profiles/save') {
          // What SantriHub turned on in this agent becomes the profile.
          const st = harnessStatus({ home: home || os.homedir(), env }).find((x) => x.id === h.id);
          const known = new Set([...(await remoteSkills(mergedCatalog(await session.catalog()), sourceFetch)).map((s) => s.id), ...library.listLibrary(libRoot).map((s) => s.id)]);
          const mcpIds = new Map([[GATEWAY_NAME, GATEWAY_ID], ...mcpCatalog(mergedCatalog(await session.catalog())).map((m) => [m.builtin ? 'santri-skills' : m.id, m.id]),
            ...Object.keys(mcpLibrary.readMcpLibrary(mcpLibPath)).map((n) => [n, n])]);
          const p = { skills: st.skills.filter((s) => s.managed && known.has(s.id)).map((s) => s.id), mcp: st.mcp.names.filter((n) => mcpIds.has(n)).map((n) => mcpIds.get(n)) };
          if (!p.skills.length && !p.mcp.length) throw new AuthError(400, `Belum ada skill atau MCP dari SantriHub yang aktif di ${h.name}.`);
          return send(200, { name: input.name, ...profiles.saveProfile(profilesPath, input.name, p) });
        }
        if (req.url === '/api/profiles/apply') {
          const p = profiles.readProfiles(profilesPath)[input.name];
          if (!p) throw new AuthError(404, 'Profil tidak ditemukan.');
          if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
          busy = true;
          const applied = [], failed = [];
          try {
            clearVerification();
            // Add-only: items outside the profile stay as they are.
            for (const id of p.skills) { try { setSkill(h, await resolveSkill(id), true); applied.push(id); } catch (e) { failed.push({ id, error: e.message }); } }
            for (const id of p.mcp) { try { const m = await resolveMcp(id); setMcp(h, m.name, m.base, true, { stateFile: harnessStateFile }); applied.push(id); } catch (e) { failed.push({ id, error: e.message }); } }
          } finally { busy = false; }
          return send(200, { applied, failed, harness: h.id, hint: h.restartHint || `Reload ${h.name} agar perubahan terbaca.` });
        }
        return send(404, { error: 'Tidak ditemukan' });
      }

      if (!['/api/install', '/api/mcp'].includes(req.url)) return send(404, { error: 'Tidak ditemukan' });
      if (!['project', 'global'].includes(input.scope)) throw new AuthError(400, 'Scope invalid');
      if (busy) return send(409, { error: 'Instalasi sedang berjalan' });
      busy = true;
      try {
        if (req.url === '/api/mcp') {
          if (typeof input.id !== 'string' || input.confirm !== true) throw new Error('Konfirmasi MCP wajib');
          const entry = mcpCatalog(mergedCatalog(await session.catalog())).find((m) => m.id === input.id);
          if (!entry) throw new Error('MCP tidak terdaftar di katalog');
          const config = resolveForWrite(input.scope, { ...targetOptions(), kind: 'mcp' }).mcpFile;
          const before = fs.existsSync(config) ? Object.keys(configStatusNames(config)) : [];
          const name = entry.builtin ? 'santri-skills' : entry.id;
          const written = entry.builtin
            ? addMcpServer(config, ownServerEntry())
            : addMcpServer(config, { command: entry.command, args: entry.args }, entry.id);
          const after = Object.keys(written.mcpServers || {});
          return send(200, { message: `MCP ${name} terdaftar. Reload Antigravity.`, config, backup: written.backup,
            added: after.filter((n) => !before.includes(n)), updated: before.includes(name) ? [name] : [], servers: after });
        }
        if (!Array.isArray(input.skillIds) || !input.skillIds.length || input.skillIds.some((id) => typeof id !== 'string')) throw new Error('Pilih skill');
        const skills = await remoteSkills(mergedCatalog(await session.catalog()), sourceFetch);
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
  server.on('close',()=>{if(verification)clearVerification();});
  return server;
}

module.exports = { createDashboardServer };
