'use strict';
// Headless Chrome regression: topbar + scope bar stay pinned while the page scrolls,
// and never overlap page content. Skipped when no Chrome binary is present.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');

const CHROME=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean).find(p=>{try{return fs.statSync(p).isFile()}catch{return false}});

test('sticky topbar stays pinned and clear of content at desktop and mobile widths',{skip:CHROME?false:'Chrome not installed'},()=>{
 const src=path.resolve(__dirname,'..','src');
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR||os.tmpdir(),'santri-sticky-'));
 try{
  fs.copyFileSync(path.join(src,'dashboard.css'),path.join(root,'dashboard.css'));
  // Real markup, no app scripts: layout only, nothing network or auth bound.
  const html=fs.readFileSync(path.join(src,'dashboard.html'),'utf8')
    .replace(/<script[\s\S]*?<\/script>/g,'')
    .replace(/<link[^>]*rel="stylesheet"[^>]*>/,'<link rel="stylesheet" href="dashboard.css">')
    .replace(/<dialog id="locked"[\s\S]*?<\/dialog>/,'')
    .replace('<div id="content" hidden>','<div id="content">')
    +`<script>
      document.body.classList.remove('auth-locked');
      document.querySelectorAll('.page').forEach((p,i)=>{p.hidden=i!==1;p.style.minHeight='3000px'});
      const probe=()=>{
        const head=document.querySelector('main > header'),bar=document.querySelector('.scope-bar'),page=document.querySelector('.page:not([hidden])');
        scrollTo(0,1200);
        const h=head.getBoundingClientRect(),b=bar.getBoundingClientRect(),p=page.getBoundingClientRect();
        return {w:innerWidth,headPos:getComputedStyle(head).position,barPos:getComputedStyle(bar).position,
          headTop:Math.round(h.top),barTop:Math.round(b.top),
          overlap:Math.round(b.top-h.bottom),headZ:getComputedStyle(head).zIndex,barZ:getComputedStyle(bar).zIndex,
          headBg:getComputedStyle(head).backgroundColor,barBg:getComputedStyle(bar).backgroundColor,
          scrolled:Math.round(scrollY)};
      };
      document.title='PROBE '+JSON.stringify(probe());
    </script>`;
  fs.writeFileSync(path.join(root,'page.html'),html);
  const run=(w)=>{
   const dom=execFileSync(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--user-data-dir=${path.join(root,'profile'+w)}`,`--window-size=${w},800`,'--virtual-time-budget=3000','--dump-dom',`file:///${path.join(root,'page.html').replace(/\\/g,'/')}`],{encoding:'utf8',timeout:90000});
   const m=dom.match(/PROBE (\{.*?\})<\/title>/);assert.ok(m,'probe did not run');return JSON.parse(m[1]);
  };
  for(const width of [1280,380]){
   const r=run(width);
   assert.ok(r.scrolled>=1000,`page must scroll at ${width}px, scrolled ${r.scrolled}`);
   assert.equal(r.headPos,'sticky',`topbar position at ${width}px`);
   assert.equal(r.barPos,'sticky',`scope bar position at ${width}px`);
   assert.equal(r.headTop,0,`topbar must stay at viewport top at ${width}px`);
   assert.ok(r.barTop>=0&&r.barTop<=60,`scope bar must stay pinned under topbar at ${width}px, got ${r.barTop}`);
   assert.ok(r.overlap>=0,`scope bar must not overlap topbar at ${width}px, got ${r.overlap}`);
   // Content scrolls beneath pinned chrome by design; opaque backgrounds keep it unreadable-free.
   assert.match(r.headBg,/^rgb\(/,`topbar needs an opaque background at ${width}px, got ${r.headBg}`);
   assert.match(r.barBg,/^rgb\(/,`scope bar needs an opaque background at ${width}px, got ${r.barBg}`);
   assert.ok(Number(r.headZ)>=Number(r.barZ)&&Number(r.barZ)>0,`pinned chrome needs a stacking context at ${width}px`);
  }
 } finally {fs.rmSync(root,{recursive:true,force:true})}
});
