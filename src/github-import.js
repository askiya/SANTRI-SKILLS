'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const {parseFrontmatter}=require('./sources');
const HOSTS=new Set(['github.com','api.github.com','raw.githubusercontent.com']);
const MAX_TREE=2000,MAX_FILE=512*1024,MAX_TOTAL=8*1024*1024;
function parseIngestUrl(raw){
 if(typeof raw!=='string'||raw.length>2048)throw new Error('URL GitHub invalid.');
 if(/[\\\s]/.test(raw)||raw.split('/').some(x=>['.','..'].includes(decodeURIComponent(x))))throw new Error('Traversal URL ditolak.');
 let u;try{u=new URL(raw)}catch{throw new Error('URL GitHub invalid.')}
 if(u.protocol!=='https:'||u.hostname!=='github.com'||u.port||u.username||u.password||u.search||u.hash)throw new Error('Hanya URL HTTPS github.com publik yang didukung.');
 const p=u.pathname.split('/').filter(Boolean).map(x=>decodeURIComponent(x));
 if(p.length<2||p.some(x=>!x||x==='.'||x==='..'||/[\\\x00-\x1f]/.test(x))||!/^[\w.-]+$/.test(p[0])||!/^[\w.-]+$/.test(p[1]))throw new Error('Path repo GitHub invalid.');
 if(p.length===2)return{repo:`${p[0]}/${p[1].replace(/\.git$/,'')}`,branch:null,subdir:''};
 if(p[2]!=='tree'||p.length<4)throw new Error('URL hanya boleh repo atau /tree/<branch>/<subdir>.');
 return{repo:`${p[0]}/${p[1].replace(/\.git$/,'')}`,branch:p[3],subdir:p.slice(4).join('/')};
}
function allowedUrl(raw){const u=new URL(raw);if(u.protocol!=='https:'||!HOSTS.has(u.hostname)||u.port||u.username||u.password)throw new Error('Host GitHub fetch ditolak.');return u}
async function boundedFetch(url,{fetcher=globalThis.fetch,json=false,deadline,redirects=0}={}){
 if(redirects>3)throw new Error('Terlalu banyak redirect GitHub.');
 allowedUrl(url);const signal=deadline||AbortSignal.timeout(10000);const r=await fetcher(url,{redirect:'manual',signal,headers:{accept:json?'application/vnd.github+json':'application/octet-stream','user-agent':'santriverse-skills/0.1'}});
 if(r.status>=300&&r.status<400){const loc=r.headers.get('location');if(!loc)throw new Error('Redirect GitHub tanpa lokasi.');const next=new URL(loc,url);allowedUrl(next);return boundedFetch(next.href,{fetcher,json,deadline:signal,redirects:redirects+1});}
 if(!r.ok)throw new Error(`GitHub HTTP ${r.status}.`);
 const len=Number(r.headers.get('content-length')||0);if(len>MAX_FILE)throw new Error('Respons GitHub terlalu besar.');
 const chunks=[];let size=0;const reader=r.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE){await reader.cancel();throw new Error('Respons GitHub terlalu besar.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock()}
 const b=Buffer.concat(chunks);
 if(json&&!/^application\/(?:json|[^;]+\+json)\b/i.test(r.headers.get('content-type')||''))throw new Error('GitHub tidak mengirim JSON.');
 return json?JSON.parse(b.toString('utf8')):b;
}
const relevantMcp=p=>{const n=p.toLowerCase();return /(^|\/)(mcp_config|mcp)\.json$/.test(n)&&(n.split('/').length===1||n.startsWith('.agents/')||n.startsWith('configs/antigravity/'))};
const inSubdir=(p,s)=>!s||p===s||p.startsWith(s+'/');
function validateMcp(raw,file){let cfg;try{cfg=JSON.parse(raw)}catch{throw new Error(`${file} bukan JSON valid.`)}const bag=cfg&&cfg.mcpServers;if(!bag||typeof bag!=='object'||Array.isArray(bag))throw new Error(`${file} tidak punya object mcpServers.`);for(const [n,e]of Object.entries(bag)){if(!/^[\w-]{1,80}$/.test(n)||!e||typeof e!=='object'||Array.isArray(e)||typeof e.command!=='string'&&typeof e.url!=='string')throw new Error(`Entri MCP invalid di ${file}.`)}return bag}
async function previewGithub(raw,{scope,targets,fetcher=globalThis.fetch}={}){
 const src=parseIngestUrl(raw),api=`https://api.github.com/repos/${src.repo}`;let branch=src.branch;
 if(!branch){const meta=await boundedFetch(api,{fetcher,json:true});branch=meta.default_branch;if(typeof branch!=='string'||!branch)throw new Error('Default branch tidak ditemukan.');}
 const tree=await boundedFetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`,{fetcher,json:true});
 if(!tree||!Array.isArray(tree.tree)||tree.truncated||tree.tree.length>MAX_TREE)throw new Error('Tree repo terlalu besar/terpotong.');
 if(tree.tree.some(x=>!x||typeof x.path!=='string'||x.path.length>1024||x.path.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f:]/.test(x.path)))throw new Error('Path tree tidak aman.');
 const paths=tree.tree.filter(x=>x&&x.type==='blob'&&typeof x.path==='string'&&inSubdir(x.path,src.subdir));
 const wanted=paths.filter(x=>(!x.mode||x.mode==='100644'||x.mode==='100755')&&(x.path.endsWith('/SKILL.md')||x.path==='SKILL.md'||relevantMcp(x.path)));
 if(wanted.length>100)throw new Error('Lebih dari 100 artefak relevan.');
 let total=0;const load=async p=>{const b=await boundedFetch(`https://raw.githubusercontent.com/${src.repo}/${encodeURIComponent(branch)}/${p.split('/').map(encodeURIComponent).join('/')}`,{fetcher});total+=b.length;if(total>MAX_TOTAL)throw new Error('Artefak repo melebihi 8 MB.');return b};
 const skills=[],mcp=[];
 for(const x of wanted){const data=await load(x.path);if(/(^|\/)SKILL\.md$/.test(x.path)){const id=path.posix.basename(path.posix.dirname(x.path))==='.'?src.repo.split('/')[1]:path.posix.basename(path.posix.dirname(x.path));if(!/^[\w-]{1,80}$/.test(id))throw new Error(`Nama skill tidak aman: ${id}`);const meta=parseFrontmatter(data.toString('utf8'));skills.push({id,name:String(meta.name||id).slice(0,160),description:String(meta.description||'').slice(0,400),path:x.path,data});}else{const entries=validateMcp(data.toString('utf8'),x.path);mcp.push({path:x.path,names:Object.keys(entries).sort(),entries});}}
 const readmes=paths.filter(x=>/(^|\/)README\.md$/i.test(x.path)).slice(0,8);let docs='';for(const x of readmes){docs+='\n'+(await load(x.path)).toString('utf8')}
 const installCommands=[...new Set((docs.match(/(?:npm|pnpm|yarn|pipx?|uv tool|brew)\s+install[^\r\n`]*/gi)||[]).map(x=>x.trim().slice(0,300)))].slice(0,10);
 if(new Set(skills.map(s=>s.id.toLowerCase())).size!==skills.length)throw new Error('ID skill duplikat.');
 const allNames=mcp.flatMap(m=>m.names);if(new Set(allNames).size!==allNames.length)throw new Error('Nama MCP duplikat antar file; gunakan URL /tree/<branch>/<subdir>.');
 const snapshot={source:raw,repo:src.repo,branch,subdir:src.subdir,scope,targets,skills,mcp,installCommands};
 snapshot.hash=crypto.createHash('sha256').update(JSON.stringify({source:raw,repo:src.repo,branch,subdir:src.subdir,scope,targets,skills:skills.map(x=>[x.path,x.data.toString('base64')]),mcp:mcp.map(x=>[x.path,x.entries])})).digest('hex');
 return snapshot;
}
function publicPreview(s){return{repo:s.repo,branch:s.branch,subdir:s.subdir,skills:s.skills.map(x=>({id:x.id,name:x.name,description:x.description,path:x.path})),mcp:s.mcp.map(x=>({path:x.path,names:x.names})),installCommands:s.installCommands,targets:s.targets};}
module.exports={parseIngestUrl,previewGithub,publicPreview,boundedFetch,MAX_TREE};
