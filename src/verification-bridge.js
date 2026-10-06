'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),crypto=require('node:crypto');
const bridgePath=()=>process.env.SANTRIHUB_BRIDGE_FILE||path.join(os.homedir(),'.santrihub','bridge.json');
// ponytail: same-user processes can read this capability; stronger IDE identity needs vendor-signed diagnostics.
function report(event){
 if(!['initialize','tool'].includes(event))return;
 let cfg;try{const file=bridgePath(),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)return;cfg=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return}
 if(!Number.isInteger(cfg.port)||cfg.port<1||cfg.port>65535||typeof cfg.token!=='string'||!/^[a-f0-9]{64}$/.test(cfg.token)||typeof cfg.challenge!=='string'||!/^[a-f0-9]{64}$/.test(cfg.challenge)||cfg.expires<=Date.now())return;
 const body=JSON.stringify({challenge:cfg.challenge,event});const req=http.request({hostname:'127.0.0.1',port:cfg.port,path:'/api/verification/bridge',method:'POST',timeout:1500,headers:{Host:`127.0.0.1:${cfg.port}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body),'X-Santrihub-Bridge':cfg.token}},res=>res.resume());req.on('error',()=>{});req.on('timeout',()=>req.destroy());req.end(body);
}
module.exports={bridgePath,report};
