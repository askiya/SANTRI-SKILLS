'use strict';
// Bounded local imports. Only explicitly named MCP config is read; no code runs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseFrontmatter } = require('./sources');
const MAX_SKILLS=100, MAX_DEPTH=6, MAX_NODES=2000, MAX_BYTES=8*1024*1024, MAX_FILE=512*1024;
const denied = /^(?:\..*|node_modules|windows|program files(?: \(x86\))?|etc|usr|bin|sbin|proc|sys|dev|credentials?|secrets?|tokens?|passwords?|id_rsa|id_ed25519)$/i;
const secret = /(?:credential|secret|token|password|passwd|id_rsa|id_ed25519)|\.(?:pem|key|pfx|p12|db|sqlite)$/i;
const safeId = s => typeof s==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(s) && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9]|constructor|prototype)$/i.test(s);
function assertNoLinks(p) {
  for(let cur=path.resolve(p);;cur=path.dirname(cur)) {
    try { if(fs.lstatSync(cur).isSymbolicLink()) throw new Error('symlink/junction ditolak.'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
    if(cur===path.dirname(cur)) break;
  }
}
function validateSource(source) {
  if(typeof source!=='string'||source.length>2048||!path.isAbsolute(source)||/[\x00-\x1f]/.test(source)) throw new Error('Sumber wajib path absolut.');
  if(/^[\\/]{2}/.test(source)||source.slice(path.parse(source).root.length).includes(':')||source.replace(/\\/g,'/').split('/').includes('..')) throw new Error('UNC/device/ADS/traversal ditolak.');
  const abs=path.resolve(source),parts=abs.slice(path.parse(abs).root.length).split(path.sep);
  if(abs===path.parse(abs).root||parts.some(p=>denied.test(p)||secret.test(p))) throw new Error('Lokasi sensitif/root ditolak.');
  assertNoLinks(abs);return abs;
}
function readBounded(file,budget) {
  assertNoLinks(file);
  const st=fs.lstatSync(file);
  if(!st.isFile()||st.nlink!==1) throw new Error('Hanya file biasa tanpa hardlink/symlink.');
  if(st.size>MAX_FILE||(budget.bytes+=st.size)>MAX_BYTES) throw new Error('Batas ukuran scan: 512 KB/file, 8 MB total.');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try {
    const opened=fs.fstatSync(fd);if(opened.ino!==st.ino||opened.dev!==st.dev||opened.size!==st.size) throw new Error('Sumber berubah; preview ulang.');
    const b=Buffer.alloc(st.size+1);let n=0,k;while(n<b.length&&(k=fs.readSync(fd,b,n,b.length-n,null))) n+=k;
    if(n!==st.size) throw new Error('Sumber berubah; preview ulang.');return b.subarray(0,n);
  }finally{fs.closeSync(fd)}
}
function skillSnapshot(source) {
  source=validateSource(source);
  if(!fs.lstatSync(source).isDirectory()) throw new Error('Sumber skills wajib folder.');
  const budget={bytes:0,nodes:0},skills=[],ids=new Set();
  function entries(dir,depth){
    if(depth>MAX_DEPTH)throw new Error('Batas kedalaman scan 6.');
    assertNoLinks(dir);const out=[];const d=fs.opendirSync(dir);
    try{let e;while((e=d.readSync())){if(++budget.nodes>MAX_NODES)throw new Error('Batas scan 2000 entri.');if(e.isSymbolicLink())throw new Error('symlink/junction ditolak.');if(!denied.test(e.name)&&!secret.test(e.name))out.push(e)}}finally{d.closeSync()}
    return out.sort((a,b)=>a.name.localeCompare(b.name));
  }
  function collect(dir,depth,files,prefix=''){
    for(const e of entries(dir,depth)){
      const full=path.join(dir,e.name),relative=prefix+e.name;
      if(e.isDirectory())collect(full,depth+1,files,relative+'/');
      // ponytail: only plain Markdown/text support files copied; scripts/assets need a future explicit allowlist.
      else if(e.isFile()&&/\.(md|txt)$/i.test(e.name))files.push({relative,data:readBounded(full,budget)});
    }
  }
  function walk(dir,depth){
    const es=entries(dir,depth);
    if(es.some(e=>e.name==='SKILL.md'&&e.isFile())){
      const id=path.basename(dir);if(!safeId(id))throw new Error('ID skill tidak aman.');
      if(ids.has(id.toLowerCase()))throw new Error('ID skill duplikat.');ids.add(id.toLowerCase());
      if(skills.length>=MAX_SKILLS)throw new Error('Batas scan 100 skills.');
      const files=[];collect(dir,depth,files);const text=files.find(f=>f.relative==='SKILL.md').data.toString('utf8'),meta=parseFrontmatter(text);
      skills.push({id,name:String(meta.name||id).slice(0,160),description:String(meta.description||'').slice(0,400),files,relative:path.relative(source,dir)});
    }else for(const e of es)if(e.isDirectory())walk(path.join(dir,e.name),depth+1);
  }
  walk(source,0);
  const hash=crypto.createHash('sha256');for(const s of skills){hash.update(JSON.stringify([s.id,s.relative]));for(const f of s.files){hash.update(f.relative);hash.update(f.data)}}
  return {source,skills,hash:hash.digest('hex')};
}
function scanLocalSkills(source){return skillSnapshot(source).skills.map(s=>({id:s.id,name:s.name,description:s.description,files:s.files.length,bytes:s.files.reduce((n,f)=>n+f.data.length,0)}))}
function mcpSnapshot(source){
  source=validateSource(source);if(fs.lstatSync(source).isDirectory())source=path.join(source,'mcp_config.json');
  if(path.extname(source).toLowerCase()!=='.json')throw new Error('Sumber wajib mcp_config.json atau file JSON eksplisit.');
  const raw=readBounded(source,{bytes:0});let cfg;try{cfg=JSON.parse(raw)}catch{throw new Error('mcp_config.json bukan JSON valid.')}
  const obj=x=>x&&typeof x==='object'&&!Array.isArray(x);
  if(!obj(cfg)||!obj(cfg.mcpServers))throw new Error('mcp_config.json wajib object mcpServers.');
  const names=Object.keys(cfg.mcpServers).sort();if(!names.length||names.length>100)throw new Error('MCP wajib 1–100 entri.');
  for(const n of names){const e=cfg.mcpServers[n];if(!safeId(n)||!obj(e))throw new Error('Nama/entri MCP invalid.');
    const command=typeof e.command==='string'&&e.command.trim(),url=typeof e.url==='string'&&/^https?:\/\//.test(e.url);
    if(!command&&!url||e.args!=null&&(!Array.isArray(e.args)||e.args.some(a=>typeof a!=='string'))||e.env!=null&&!obj(e.env)||e.headers!=null&&!obj(e.headers))throw new Error('Bentuk entri MCP invalid.');
  }
  return {source,names,entries:cfg.mcpServers,hash:crypto.createHash('sha256').update(raw).digest('hex')};
}
function scanLocalMcp(source){const m=mcpSnapshot(source);return {names:m.names,count:m.names.length}}
function hashDir(source){return skillSnapshot(source).hash}
function hashFile(source){return mcpSnapshot(source).hash}
module.exports={skillSnapshot,mcpSnapshot,scanLocalSkills,scanLocalMcp,hashDir,hashFile,assertNoLinks,validateSource,MAX_SKILLS,MAX_DEPTH};
