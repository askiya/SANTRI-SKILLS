'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {createDashboardServer}=require('./dashboard');
const data=path.join(process.env.LOCALAPPDATA||os.homedir(),'SantriHub'),lock=path.join(data,'desktop.lock'),profile=path.join(data,'EdgeProfile');
fs.mkdirSync(data,{recursive:true});
let fd;
try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid))}catch{process.exit(0)}
const edge=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if(!edge){fs.closeSync(fd);fs.rmSync(lock,{force:true});throw new Error('Microsoft Edge tidak ditemukan.')}
const server=createDashboardServer({cwd:process.cwd()});
let child,closing=false;
const close=()=>{if(closing)return;closing=true;server.closeAllConnections();server.close(()=>{try{fs.closeSync(fd)}catch{}fs.rmSync(lock,{force:true});process.exit(0)})};
process.on('SIGINT',close);process.on('SIGTERM',close);process.on('exit',()=>fs.rmSync(lock,{force:true}));
server.listen(0,'127.0.0.1',()=>{const url=`http://127.0.0.1:${server.address().port}`;child=spawn(edge,[`--app=${url}`,`--user-data-dir=${profile}`,'--no-first-run'],{stdio:'ignore'});child.once('error',close);child.once('exit',close)});
