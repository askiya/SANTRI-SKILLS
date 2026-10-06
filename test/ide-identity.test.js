'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {findAntigravityExecutable}=require('../src/detect');
test('IDE product metadata selects IDE, rejects desktop variant and fails closed on ambiguous IDEs',()=>{
 const home=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'santri-identity-'));
 const opts={home,env:{LOCALAPPDATA:path.join(home,'local'),APPDATA:path.join(home,'roaming'),PROGRAMFILES:path.join(home,'programs')},platform:'win32'};
 const make=(root,product)=>{fs.mkdirSync(path.join(root,'resources','app'),{recursive:true});fs.writeFileSync(path.join(root,'resources','app','product.json'),JSON.stringify(product));const exe=path.join(root,'Antigravity IDE.exe');fs.writeFileSync(exe,'fixture only');return exe;};
 const ide={nameShort:'Antigravity IDE',nameLong:'Antigravity IDE',applicationName:'antigravity-ide'};
 try{
  const desktop=make(path.join(opts.env.LOCALAPPDATA,'Programs','Antigravity'),{nameShort:'Antigravity',applicationName:'antigravity'});
  assert.equal(findAntigravityExecutable(opts),null,'folder and filename cannot prove IDE');
  const correct=make(path.join(opts.env.LOCALAPPDATA,'Programs','Antigravity IDE'),ide);
  assert.equal(findAntigravityExecutable(opts),correct);
  make(path.join(opts.env.PROGRAMFILES,'Antigravity IDE'),ide);
  assert.equal(findAntigravityExecutable(opts),null,'multiple verified IDEs require disambiguation');
  assert.notEqual(correct,desktop);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
