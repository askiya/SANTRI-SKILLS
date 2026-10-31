'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const bridgePath=()=>process.env.SANTRIHUB_BRIDGE_FILE||path.join(os.homedir(),'.santrihub','bridge.json');
// ponytail: same-user processes can read this capability; stronger IDE identity needs vendor-signed diagnostics.
function capability(){
 let cfg;try{const file=bridgePath(),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)return null;cfg=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null}
 if(!Number.isInteger(cfg.port)||cfg.port<1||cfg.port>65535||typeof cfg.token!=='string'||!/^[a-f0-9]{64}$/.test(cfg.token)||typeof cfg.challenge!=='string'||!/^[a-f0-9]{64}$/.test(cfg.challenge)||cfg.expires<=Date.now())return null;
 return cfg;
}
function send(cfg,payload,onDone=()=>{}){
 const body=JSON.stringify({challenge:cfg.challenge,...payload});
 const req=http.request({hostname:'127.0.0.1',port:cfg.port,path:'/api/verification/bridge',method:'POST',timeout:3000,headers:{Host:`127.0.0.1:${cfg.port}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Santrihub-Bridge':cfg.token}},res=>{let raw='';res.setEncoding('utf8');res.on('data',c=>{if(raw.length<8192)raw+=c});res.on('end',()=>{let data={};try{data=JSON.parse(raw)}catch{}onDone({status:res.statusCode,data})})});
 req.on('error',()=>onDone({status:0,data:{}}));req.on('timeout',()=>req.destroy());req.end(body);
}
function report(event){
 if(!['initialize','tool'].includes(event))return;
 const cfg=capability();if(cfg)send(cfg,{event});
}
// Skill proof: the agent read the code from the santrihub-cek skill; the dashboard checks it.
function verify(code,skills){
 return new Promise(resolve=>{
  const cfg=capability();if(!cfg)return resolve({status:0,data:{error:'Tidak ada cek aktif di SantriHub.'}});
  const list=Array.isArray(skills)?skills.filter(s=>typeof s==='string').slice(0,500).map(s=>s.slice(0,160)):[];
  send(cfg,{event:'verify',code:String(code||'').slice(0,40),skills:list},resolve);
 });
}
module.exports={bridgePath,report,verify};
