'use strict';
const path=require('node:path');
const {execFile}=require('node:child_process');
const {resolveCommand}=require('./runtime-status');
function controlArgv(action,options={}){
 if(!['status','close','launch'].includes(action))throw new Error('Aksi Antigravity invalid.');
 if(options.force!==undefined&&typeof options.force!=='boolean')throw new Error('force wajib boolean.');
 const argv=[action];if(action==='close'&&options.force)argv.push('--force');
 if(action==='launch'&&options.executable){if(typeof options.executable!=='string'||/[\x00-\x1f]/.test(options.executable))throw new Error('Path executable invalid.');argv.push('--executable',options.executable)}
 return argv;
}
function pythonCommand(env=process.env){return resolveCommand(process.platform==='win32'?'python.exe':'python3',env)||resolveCommand('python',env)}
function runControl(action,options={},deps={}){
 const python=(deps.pythonCommand||pythonCommand)(deps.env||process.env);if(!python)return Promise.reject(new Error('python3/python tidak ditemukan di PATH. Kontrol Antigravity tidak dijalankan.'));
 const script=path.resolve(__dirname,'../scripts/antigravity_control.py'),argv=[script,...controlArgv(action,options)];
 return new Promise((resolve,reject)=>(deps.execFile||execFile)(python,argv,{windowsHide:true,timeout:15000,maxBuffer:128*1024},(e,stdout,stderr)=>{
  let data=null;try{data=JSON.parse(stdout)}catch{}
  if(e||!data||typeof data!=='object'||Array.isArray(data)||data.ok!==true)return reject(new Error(String(data&&data.error||(e&&(stderr||e.message))||'Output kontrol Antigravity invalid.').trim()));
  resolve(data);
 }));
}
module.exports={controlArgv,pythonCommand,runControl};
