'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const zlib=require('node:zlib');
const {Readable,Transform,Writable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {parseFrontmatter}=require('./sources');
const {mcpKind}=require('./runtime-status');
const HOSTS=new Set(['github.com','api.github.com','raw.githubusercontent.com','codeload.github.com']);
const MAX_TREE=6000,MAX_TREE_BYTES=4*1024*1024,MAX_ARCHIVE_ENTRIES=6000,MAX_FILE=512*1024,MAX_TOTAL=8*1024*1024,MAX_ARCHIVE=32*1024*1024,MAX_UNCOMPRESSED=96*1024*1024;
function parseIngestUrl(raw){
 if(typeof raw!=='string'||raw.length>2048)throw new Error('URL GitHub invalid.');
 if(/[\\\s]/.test(raw)||raw.split('/').some(x=>['.','..'].includes(decodeURIComponent(x))))throw new Error('Traversal URL ditolak.');
 let u;try{u=new URL(raw)}catch{throw new Error('URL GitHub invalid.')}
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash)throw new Error('Hanya URL HTTPS github.com publik yang didukung.');
 const p=u.pathname.split('/').filter(Boolean).map(x=>decodeURIComponent(x));
 if(p.length<2||p.some(x=>!x||x==='.'||x==='..'||/[\\\x00-\x1f]/.test(x))||!/^[-\w.]+$/.test(p[0])||!/^[-\w.]+$/.test(p[1]))throw new Error('Path repo GitHub invalid.');
 if(p.length===2)return{repo:`${p[0]}/${p[1].replace(/\.git$/,'')}`,branch:null,subdir:''};
 if(p[2]!=='tree'||p.length<4)throw new Error('URL hanya boleh repo atau /tree/<branch>/<subdir>.');
 return{repo:`${p[0]}/${p[1].replace(/\.git$/,'')}`,branch:p[3],subdir:p.slice(4).join('/')};
}
function allowedUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port||u.username||u.password)throw new Error('Host GitHub fetch ditolak.');return u}
function githubError(r,url,b){let message='';try{const m=JSON.parse(b.toString('utf8')).message;if(typeof m==='string')message=m.replace(/[\x00-\x1f<>]/g,' ').slice(0,300);}catch{}
 const rateLimited=new URL(url).hostname==='api.github.com'&&[403,429].includes(r.status)&&(r.headers.get('x-ratelimit-remaining')==='0'||/API rate limit exceeded/i.test(message));
 const e=new Error(`GitHub HTTP ${r.status}${rateLimited?' — batas API publik habis; fallback arsip publik tersedia':''}${message?': '+message:'.'}`);e.status=r.status;e.rateLimited=rateLimited;return e;
}
async function readBody(r,cap,tooLarge='Respons GitHub terlalu besar.'){
 const len=Number(r.headers.get('content-length')||0);if(len>cap)throw new Error(tooLarge);
 const chunks=[];let size=0;const reader=r.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>cap){await reader.cancel();throw new Error(tooLarge);}chunks.push(Buffer.from(value));}}finally{reader.releaseLock()}return Buffer.concat(chunks);
}
async function boundedFetch(url,{fetcher=globalThis.fetch,json=false,deadline,redirects=0,cap=MAX_FILE}={}){
 if(redirects>3)throw new Error('Terlalu banyak redirect GitHub.');
 allowedUrl(url);const signal=deadline||AbortSignal.timeout(30000);const r=await fetcher(url,{redirect:'manual',signal,headers:{accept:json?'application/vnd.github+json':'application/octet-stream','user-agent':'santriverse-skills/0.1'}});
 if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error('Redirect GitHub tanpa lokasi.');const next=new URL(loc,url);allowedUrl(next);return boundedFetch(next.href,{fetcher,json,deadline:signal,redirects:redirects+1,cap});}
 const b=await readBody(r,r.ok?cap:4096);if(!r.ok)throw githubError(r,url,b);
 if(json&&!/^application\/(?:json|[^;]+\+json)\b/i.test(r.headers.get('content-type')||''))throw new Error('GitHub tidak mengirim JSON.');
 return json?JSON.parse(b.toString('utf8')):b;
}
function safeArchivePath(name){return Boolean(name)&&name.length<=1024&&!/^[\/]/.test(name)&&!/[\\\x00-\x1f:]/.test(name)&&!name.split('/').some(x=>!x||x==='.'||x==='..');}
const relevantMcp=p=>{const n=p.toLowerCase();return /(^|\/)(mcp_config|mcp)\.json$/.test(n)&&(n.split('/').length===1||n.startsWith('.agents/')||n.startsWith('configs/antigravity/'))};
const relevantSkill=p=>(p==='SKILL.md'||p.endsWith('/SKILL.md'))&&(!p.startsWith('configs/')||p.startsWith('configs/antigravity/'))&&!/^\.(?!agents\/)[^/]+\//.test(p)&&!/(^|\/)(?:tests?|__tests__|fixtures)\//.test(p);
const preferredSkill=p=>p.startsWith('.agents/')||p.startsWith('configs/antigravity/');
const inSubdir=(p,s)=>!s||p===s||p.startsWith(s+'/');
function octal(header,start,length){const s=header.toString('ascii',start,start+length).replace(/\0.*$/,'').trim();if(!/^[0-7]+$/.test(s))throw new Error('Ukuran tar invalid.');const n=parseInt(s,8);if(!Number.isSafeInteger(n))throw new Error('Ukuran tar invalid.');return n;}
function parsePax(data){const out={};for(let p=0;p<data.length;){const space=data.indexOf(32,p),length=Number(data.toString('ascii',p,space));if(space<0||!Number.isSafeInteger(length)||length<=space-p+1||p+length>data.length||data[p+length-1]!==10)throw new Error('PAX invalid.');const record=data.toString('utf8',space+1,p+length-1),eq=record.indexOf('=');if(eq>0)out[record.slice(0,eq)]=record.slice(eq+1);p+=length;}return out;}
class TarCollector extends Writable{
 constructor(subdir=''){super();this.subdir=subdir;this.buffer=Buffer.alloc(0);this.remaining=0;this.padding=0;this.entry=null;this.entries=0;this.root=null;this.paxPath=null;this.longName=null;this.files=new Map();this.readmes=[];this.seen=new Set();this.total=0;this.artifacts=0;this.ended=false;}
 _write(chunk,encoding,done){try{this.buffer=Buffer.concat([this.buffer,chunk]);this.consume();done();}catch(e){done(e)}}
 consume(){for(;;){
  if(this.remaining){if(!this.buffer.length)return;const n=Math.min(this.remaining,this.buffer.length),part=this.buffer.subarray(0,n);this.buffer=this.buffer.subarray(n);if(this.entry.capture){this.entry.size+=n;if(this.entry.size>MAX_FILE)throw new Error(`Artefak arsip terlalu besar: ${this.entry.rel}`);this.entry.chunks.push(part);}this.remaining-=n;if(!this.remaining)this.finishEntry();continue;}
  if(this.padding){if(this.buffer.length<this.padding)return;this.buffer=this.buffer.subarray(this.padding);this.padding=0;continue;}
  if(this.ended){if(this.buffer.some(x=>x!==0))throw new Error('Data setelah akhir tar invalid.');this.buffer=Buffer.alloc(0);return;}
  if(this.buffer.length<512)return;const h=this.buffer.subarray(0,512);this.buffer=this.buffer.subarray(512);if(h.every(x=>x===0)){this.ended=true;continue;}
  if(++this.entries>MAX_ARCHIVE_ENTRIES)throw new Error(`Arsip melebihi ${MAX_ARCHIVE_ENTRIES} entri.`);
  const size=octal(h,124,12),type=String.fromCharCode(h[156]||48);let name=h.toString('utf8',0,100).split('\0')[0],prefix=h.toString('utf8',345,500).split('\0')[0];if(prefix)name=prefix+'/'+name;
  if(type==='x'||type==='g'||type==='L'){if(size>MAX_FILE)throw new Error('Metadata tar terlalu besar.');this.entry={type,capture:true,chunks:[],size:0};this.remaining=size;this.padding=(512-size%512)%512;if(!size)this.finishEntry();continue;}
  name=this.paxPath||this.longName||name;this.paxPath=null;this.longName=null;if(type==='5'&&name.endsWith('/'))name=name.slice(0,-1);if(!safeArchivePath(name))throw new Error('Path arsip tidak aman.');
  const parts=name.split('/');if(this.root===null)this.root=parts[0];if(parts[0]!==this.root)throw new Error('Root arsip berbeda.');
  if(type!=='0'&&type!=='\0'&&type!=='5')throw new Error('Symlink/hardlink/tipe arsip ditolak.');const rel=parts.slice(1).join('/');
  if(type==='5'){if(size)throw new Error('Direktori tar berisi data.');this.entry=null;continue;}if(!rel)throw new Error('Path arsip invalid.');
  const wanted=inSubdir(rel,this.subdir)&&(relevantSkill(rel)||relevantMcp(rel));const readme=inSubdir(rel,this.subdir)&&/(^|\/)README\.md$/i.test(rel)&&this.readmes.length<8;
  if(this.seen.has(rel))throw new Error('Path arsip duplikat/invalid.');this.seen.add(rel);if(wanted&&++this.artifacts>100)throw new Error('Lebih dari 100 artefak relevan.');if((wanted||readme)&&size>MAX_FILE)throw new Error(`Artefak arsip terlalu besar: ${rel}`);if(wanted||readme){this.total+=size;if(this.total>MAX_TOTAL)throw new Error('Artefak repo melebihi 8 MB.');}this.entry={rel,capture:wanted||readme,chunks:[],size:0,readme};this.remaining=size;this.padding=(512-size%512)%512;if(!size)this.finishEntry();
 }}
 finishEntry(){const e=this.entry;if(e.type){const data=Buffer.concat(e.chunks);if(e.type==='L')this.longName=data.toString('utf8').split('\0')[0];else{const pax=parsePax(data);if(pax.linkpath)throw new Error('Link arsip ditolak.');if(pax.path)this.paxPath=pax.path;}this.entry=null;return;}if(e.capture){this.files.set(e.rel,Buffer.concat(e.chunks));if(e.readme)this.readmes.push(e.rel);}this.entry=null;}
 _final(done){try{this.consume();if(this.remaining||this.padding||this.buffer.length&&!this.buffer.every(x=>x===0)||!this.ended)throw new Error('Arsip terpotong.');if(!this.files.size)throw new Error('Arsip tidak punya artefak relevan.');done();}catch(e){done(e)}}
}
async function archiveEntries(source,{subdir='',signal}={}){
 const collector=new TarCollector(subdir),compressed=new Transform({transform(chunk,encoding,done){this.size=(this.size||0)+chunk.length;done(this.size>MAX_ARCHIVE?new Error(`Arsip terkompresi melebihi ${MAX_ARCHIVE/1024/1024} MB.`):null,chunk)}}),expanded=new Transform({transform(chunk,encoding,done){this.size=(this.size||0)+chunk.length;done(this.size>MAX_UNCOMPRESSED?new Error(`Arsip setelah dekompresi melebihi ${MAX_UNCOMPRESSED/1024/1024} MB.`):null,chunk)}});
 const input=Buffer.isBuffer(source)?Readable.from(source):Readable.fromWeb(source);await pipeline(input,compressed,zlib.createGunzip(),expanded,collector,{signal});return{files:collector.files,readmes:collector.readmes,entries:collector.entries};
}
async function openArchive(url,{fetcher,signal,redirects=0,subdir=''}){
 if(redirects>3)throw new Error('Terlalu banyak redirect GitHub.');allowedUrl(url);const r=await fetcher(url,{redirect:'manual',signal,headers:{accept:'application/octet-stream','user-agent':'santriverse-skills/0.1'}});
 if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error('Redirect GitHub tanpa lokasi.');const next=new URL(loc,url);allowedUrl(next);return openArchive(next.href,{fetcher,signal,redirects:redirects+1,subdir});}
 if(!r.ok){const b=await readBody(r,4096);throw githubError(r,url,b);}const len=Number(r.headers.get('content-length')||0);if(len>MAX_ARCHIVE)throw new Error(`Arsip terkompresi melebihi ${MAX_ARCHIVE/1024/1024} MB.`);return archiveEntries(r.body,{subdir,signal});
}
function validateMcp(raw,file){let cfg;try{cfg=JSON.parse(raw)}catch{throw new Error(`${file} bukan JSON valid.`)}const bag=cfg&&cfg.mcpServers;if(!bag||typeof bag!=='object'||Array.isArray(bag))throw new Error(`${file} tidak punya object mcpServers.`);for(const [n,e]of Object.entries(bag)){if(!/^[\w-]{1,80}$/.test(n)||!mcpKind(e))throw new Error(`Entri MCP invalid di ${file}.`)}return bag}
async function previewGithub(raw,{scope,targets,fetcher=globalThis.fetch}={}){
 const src=parseIngestUrl(raw),api=`https://api.github.com/repos/${src.repo}`,deadline=AbortSignal.timeout(30000);let branch=src.branch,tree,archive=null;
 try{if(!branch){const meta=await boundedFetch(api,{fetcher,json:true,deadline});branch=meta.default_branch;if(typeof branch!=='string'||!branch)throw new Error('Default branch tidak ditemukan.');}tree=await boundedFetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`,{fetcher,json:true,deadline,cap:MAX_TREE_BYTES});}
 catch(e){if(!e.rateLimited)throw e;for(const candidate of branch?[branch]:['main','master']){try{archive=await openArchive(`https://codeload.github.com/${src.repo}/tar.gz/refs/heads/${encodeURIComponent(candidate)}`,{fetcher,signal:deadline,subdir:src.subdir});branch=candidate;break;}catch(a){if(a.status!==404)throw new Error(`${e.message} Fallback arsip gagal: ${a.message}`);}}if(!archive)throw new Error(`${e.message} Arsip main/master tidak ditemukan; gunakan URL /tree/<branch>.`);}
 let paths,wanted,readmes;if(archive){paths=[...archive.files.keys()].map(path=>({path,type:'blob',mode:'100644'}));wanted=paths.filter(x=>relevantSkill(x.path)||relevantMcp(x.path));readmes=archive.readmes.map(path=>({path}));}else{
  if(!tree||!Array.isArray(tree.tree)||tree.truncated||tree.tree.length>MAX_TREE)throw new Error('Tree repo terlalu besar/terpotong.');if(tree.tree.some(x=>!x||typeof x.path!=='string'||x.path.length>1024||x.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f:]/.test(x.path)))throw new Error('Path tree tidak aman.');paths=tree.tree.filter(x=>x.type==='blob'&&inSubdir(x.path,src.subdir));wanted=paths.filter(x=>(!x.mode||x.mode==='100644'||x.mode==='100755')&&(relevantSkill(x.path)||relevantMcp(x.path)));readmes=paths.filter(x=>/(^|\/)README\.md$/i.test(x.path)).slice(0,8);
 }
 if(wanted.length>100)throw new Error('Lebih dari 100 artefak relevan.');let total=0;const load=async p=>{const b=archive?archive.files.get(p):await boundedFetch(`https://raw.githubusercontent.com/${src.repo}/${encodeURIComponent(branch)}/${p.split('/').map(encodeURIComponent).join('/')}`,{fetcher,deadline});if(!b)throw new Error(`Artefak arsip hilang: ${p}`);total+=b.length;if(total>MAX_TOTAL)throw new Error('Artefak repo melebihi 8 MB.');return b};
 const skills=[],mcp=[];for(const x of wanted){const data=await load(x.path);if(relevantSkill(x.path)){const id=path.posix.basename(path.posix.dirname(x.path))==='.'?src.repo.split('/')[1]:path.posix.basename(path.posix.dirname(x.path));if(!/^[\w-]{1,80}$/.test(id))throw new Error(`Nama skill tidak aman: ${id}`);const meta=parseFrontmatter(data.toString('utf8'));skills.push({id,name:String(meta.name||id).slice(0,160),description:String(meta.description||'').slice(0,400),path:x.path,data});}else{const entries=validateMcp(data.toString('utf8'),x.path);mcp.push({path:x.path,names:Object.keys(entries).sort(),entries});}}
 let docs='';for(const x of readmes)docs+='\n'+(await load(x.path)).toString('utf8');const installCommands=[...new Set((docs.match(/(?:npm|pnpm|yarn|pipx?|uv tool|brew)\s+install[^\r\n`]*/gi)||[]).map(x=>x.trim().slice(0,300)))].slice(0,10);
 const preferredIds=new Set(skills.filter(s=>preferredSkill(s.path)).map(s=>s.id.toLowerCase())),skippedMirrors=skills.filter(s=>!preferredSkill(s.path)&&preferredIds.has(s.id.toLowerCase())).map(s=>s.path);
 for(let i=skills.length;i--;)if(skippedMirrors.includes(skills[i].path))skills.splice(i,1);
 if(new Set(skills.map(s=>s.id.toLowerCase())).size!==skills.length)throw new Error('ID skill duplikat.');const allNames=mcp.flatMap(m=>m.names);if(new Set(allNames).size!==allNames.length)throw new Error('Nama MCP duplikat antar file; gunakan URL /tree/<branch>/<subdir>.');
 const snapshot={source:raw,repo:src.repo,branch,subdir:src.subdir,scope,targets,skills,mcp,installCommands};snapshot.hash=crypto.createHash('sha256').update(JSON.stringify({source:raw,repo:src.repo,branch,subdir:src.subdir,scope,targets,skills:skills.map(x=>[x.path,x.data.toString('base64')]),mcp:mcp.map(x=>[x.path,x.entries])})).digest('hex');return snapshot;
}
function publicPreview(s){return{repo:s.repo,branch:s.branch,subdir:s.subdir,skills:s.skills.map(x=>({id:x.id,name:x.name,description:x.description,path:x.path})),mcp:s.mcp.map(x=>({path:x.path,names:x.names})),installCommands:s.installCommands,targets:s.targets};}
module.exports={parseIngestUrl,previewGithub,publicPreview,boundedFetch,MAX_TREE,archiveEntries};
