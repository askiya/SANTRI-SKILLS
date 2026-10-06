'use strict';
const fs=require('node:fs'),path=require('node:path');
function resolveCommand(command,env=process.env){
 if(typeof command!=='string'||!command||/[\x00-\x1f]/.test(command))return null;
 const extensions=process.platform==='win32'?['','.exe','.cmd','.bat','.com']:[''];
 const key=Object.keys(env).find(k=>k.toLowerCase()==='path');
 const dirs=path.isAbsolute(command)?['']:(/[\\/]/.test(command)?[]:(env[key]||'').split(path.delimiter).filter(p=>path.isAbsolute(p)));
 for(const dir of dirs)for(const ext of extensions){const file=dir?path.join(dir,command+ext):command+ext;try{if(fs.statSync(file).isFile()){fs.accessSync(file,process.platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);return file}}catch{}}
 return null;
}
function mcpKind(entry){
 if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
 if(entry.args!=null&&(!Array.isArray(entry.args)||entry.args.some(a=>typeof a!=='string')))return null;
 for(const k of ['env','headers'])if(entry[k]!=null&&(!entry[k]||typeof entry[k]!=='object'||Array.isArray(entry[k])||Object.values(entry[k]).some(v=>typeof v!=='string')))return null;
 if(typeof entry.command==='string'&&entry.command.trim()&&!/[\x00-\x1f]/.test(entry.command))return 'stdio';
 if(['serverUrl','url','httpUrl'].some(k=>{
  if(typeof entry[k]!=='string'||!/^https?:\/\/[^\s]+$/i.test(entry[k]))return false;
  try{const u=new URL(entry[k]);return ['http:','https:'].includes(u.protocol)&&Boolean(u.hostname)}catch{return false}
 }))return 'remote';
 return null;
}
function mcpRuntimeStatus(entry,env=process.env){
 const kind=mcpKind(entry);
 if(!kind)return{runtime:'entri invalid',available:false};
 if(kind==='remote')return{runtime:'remote (tidak diuji)',available:null};
 const found=resolveCommand(entry.command,env),launcher=/^(npx|pnpm|yarn|uvx)(?:\.(cmd|exe))?$/i.test(path.basename(entry.command));
 if(launcher)return{runtime:'di-resolve saat runtime',available:null,launcherAvailable:!!found,note:found?'Launcher tersedia; paket, jaringan, dan koneksi MCP belum diuji.':'Launcher tidak ditemukan di PATH; server akan gagal sampai launcher dipasang sendiri.'};
 return{runtime:found?'tersedia':'tidak ditemukan di PATH',available:!!found,note:found?'Executable ditemukan; koneksi MCP belum diuji.':'Server akan gagal di Antigravity sampai binary dipasang sendiri dan tersedia di PATH.'};
}
module.exports={resolveCommand,mcpKind,mcpRuntimeStatus};
