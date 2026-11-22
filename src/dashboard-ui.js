'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Beranda',add:'1 · Tambah',collection:'2 · Koleksi',agents:'3 · Aktifkan',status:'4 · Cek & Tes',skills:'Skill terpasang (Antigravity)',mcp:'MCP terpasang (Antigravity)',library:'Skill Saya',repos:'Repositori',extensions:'Extensions',activity:'Riwayat'};
let catalog={skills:[],mcpServers:[]},csrf='',lastStatus=null;
let statusTimer=null,statusRequest=null,statusEpoch=0;
const selectedSkills=new Set();
const activity=[]; // ponytail: session-only memory log; persist server-side if audit history is needed.

function status(t,err=false){if($('#locked').open)$('#gate-feedback').textContent=err?t:'';const el=$('#status');el.textContent=t;el.className='save-toast '+(err?'error':t.startsWith('✓')?'success':'')}
function log(t,err=false){activity.unshift({t,err,at:new Date()});renderActivity();refreshBell()}
function done(t){status(t);log(t)}function fail(e){status(e.message,true);log(e.message,true)}
const scope=()=> 'global';
function esc(s){const d=document.createElement('span');d.textContent=s==null?'':String(s);return d.innerHTML}

// CSRF tokens live 15 minutes; an app left open gets a fresh one (premium re-checked) and retries once.
async function post(url,body={},signal,retried=false){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,_csrf:csrf}),signal});
  const data=await res.json();
  if(res.status===403&&/CSRF/i.test(data.error||'')&&!retried){try{csrf=(await getJson('/api/auth/status')).csrf}catch{throw new Error('Sesi berakhir. Login lagi.')}return post(url,body,signal,true)}if(!res.ok)throw Object.assign(new Error(data.error||'Gagal'),{forceRequired:data.forceRequired===true});return data}
async function getJson(url,signal){const res=await fetch(url,{signal});const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data}
async function busy(btn,msg,fn){btn.disabled=true;show($('#progress'));status(msg);try{await fn()}catch(e){fail(e)}finally{btn.disabled=false;show($('#progress'),false)}}
const confirmGlobal=what=>scope()!=='global'||confirm(`${what} ke scope GLOBAL: semua project terdampak. Lanjutkan?`);

// ─ Logo fallback: monogram jujur, bukan kotak kosong ─
$$('.logo-box img').forEach(img=>{const mark=()=>img.closest('.logo-box').classList.add('img-failed');
  img.addEventListener('error',mark);if(img.complete&&!img.naturalWidth)mark()});

// ─ Extensions: official store links from src/extensions.js via /api/extensions ─
let extensionsLoaded=false;
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
// Tile: logo, name, kind · version, one install button; the rest lives in the modal.
function renderExtensions(list){const host=$('#extension-list');
  if(!list.length){host.replaceChildren(el('p','muted','Belum ada extension.'));return}
  host.replaceChildren(...list.map(ext=>{const card=el('article','ext-tile');card.dataset.extension=ext.id;card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label','Detail '+ext.name);
    const main=el('span','collection-main'),meta=el('span','collection-meta');meta.append(el('span',null,ext.kind));if(ext.version)meta.append(el('span','lib-type','v'+ext.version));main.append(el('strong',null,ext.name),meta);
    card.append(extLogo('ext-tile-logo'),main);
    const first=(ext.stores||[])[0];if(first){const go=extStore(first,'ext-install');go.textContent='Pasang ↗';go.title=first.label+' · '+(first.for||'');go.onclick=e=>e.stopPropagation();card.append(go)}
    card.append(el('span','collection-go','›'));
    card.onclick=()=>openExtension(ext);card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openExtension(ext)}};return card}))}
const EXT_LOGO='/assets/santriverse-logo.webp';
function extLogo(cls){const logo=el('img',cls);logo.src=EXT_LOGO;logo.alt='';return logo}
function extStore(store,cls){const link=el('a',cls);link.href=store.url;link.target='_blank';link.rel='noopener noreferrer';link.dataset.external='';return link}
// Modal: tagline, store buttons, editor ID, install steps as a numbered flow.
function openExtension(ext){const dlg=$('#ext-dialog'),body=$('#ext-body');$('#ext-icon').replaceChildren(extLogo('ext-dlg-logo'));
  $('#ext-kind').textContent=(ext.kind+(ext.version?' · v'+ext.version:'')).toUpperCase();$('#ext-title').textContent=ext.name;
  const parts=[el('p','item-desc',ext.tagline||'')];
  if(ext.stores?.length){const stores=el('div','ext-stores-row');for(const store of ext.stores){const link=extStore(store,'ext-store-btn');link.append(el('strong',null,store.label),el('small',null,store.for||''),el('span','ext-arrow','↗'));stores.append(link)}parts.push(el('h3','ext-sub','Pasang dari'),stores)}
  if(ext.identifier){const row=el('div','ext-id-row');row.append(el('span',null,'ID editor'),el('code',null,ext.identifier));const copy=el('button','ck-btn','Salin');copy.type='button';
    copy.onclick=async()=>{try{await navigator.clipboard.writeText(ext.identifier);copy.textContent='Tersalin ✓';setTimeout(()=>{copy.textContent='Salin'},1400)}catch{fail(new Error('Clipboard tidak tersedia. Salin ID secara manual.'))}};row.append(copy);parts.push(row)}
  if(ext.steps?.length){const ol=el('ol','ext-flow');for(const step of ext.steps){const li=el('li');li.append(el('span',null,step));ol.append(li)}parts.push(el('h3','ext-sub','Cara pasang'),ol)}
  body.replaceChildren(...parts);if(!dlg.open)dlg.showModal()}
// Guides come from <template> blocks in the page, so their text stays in the HTML.
function openGuide(id){const t=$('#'+id),dlg=$('#ext-dialog');if(!t)return;const ic=el('span','ext-guide-ic'+(id==='guide-rules'?' warn':''),id==='guide-rules'?'!':id==='guide-agents'?'?':'↑');
  $('#ext-icon').replaceChildren(ic);$('#ext-kind').textContent=t.dataset.badge;$('#ext-title').textContent=t.dataset.title;$('#ext-body').replaceChildren(t.content.cloneNode(true));if(!dlg.open)dlg.showModal()}
for(const b of document.querySelectorAll('[data-guide]'))b.onclick=()=>openGuide(b.dataset.guide);
$('#ext-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$('#ext-dialog [data-close]').onclick=()=>$('#ext-dialog').close();
async function loadExtensions(){if(extensionsLoaded)return;try{const data=await getJson('/api/extensions');extensionsLoaded=true;renderExtensions(data.extensions||[])}catch(e){$('#extension-list').replaceChildren(el('p','muted','Daftar extension belum bisa dimuat. Coba lagi.'));fail(e)}}
if(location.hash==='#extensions')loadExtensions();

// ─ AI Agents: skills + MCP per harness via /api/harnesses (src/harnesses.js) ─
let agents=[],agentsBusy=false;
const GATEWAY_ID='santrihub-gateway';
function agentCell(h,kind,id){
  if(kind==='mcp'){const on=h.mcp.names.includes(id===GATEWAY_ID?'santrihub':id);return {on,state:on?'on':'off',note:h.mcp.valid===false?'config rusak':''}}
  const own=h.skills.find(s=>s.id===id);if(own)return own.managed?{on:true,state:'on'}:{on:true,state:'foreign',note:'milik Anda'};
  const via=h.skillsViaOtherFolders.find(s=>s.id===id);return via?{on:false,state:'via',note:'lewat folder lain'}:{on:false,state:'off'}}
// ── Aktifkan · Kabel: paket and the hub on the left, AI agents on the right. A cable is a paket (or
// the hub) active in that agent; dragging one connects, clicking one offers to disconnect.
let wirePending=null,wireFresh=null,wirePick=null;
const wireKey=(s,h)=>s+'>'+h,svgEl=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n};
function wireSources(){const items=allItems(),src=[{id:'hub',kind:'hub',title:'SantriHub Hub',meta:'MCP santrihub + skill pemandu'}];
  for(const p of paketList()){const own=items.filter(r=>r.paket.includes(p.id));if(!own.length)continue;const sk=own.filter(r=>r.kind==='skill').length,mc=own.length-sk;
    src.push({id:p.id,kind:'paket',title:p.short,icon:p.icon,color:p.color||'gray',meta:[sk&&sk+' skill',mc&&mc+' MCP'].filter(Boolean).join(' · '),items:own})}
  return src}
const usableIn=(s,h)=>s.items.filter(r=>agentCell(h,r.kind,r.id).state!=='foreign');
function wireState(s,h){if(s.kind==='hub')return hubOn(h)?'on':'off';const usable=usableIn(s,h);if(!usable.length)return 'off';
  const n=usable.filter(r=>agentCell(h,r.kind,r.id).on).length;return n===usable.length?'on':n?'partial':'off'}
function renderWireBoard(){const board=$('#wire-board');if(!board)return;const shown=agents.filter(h=>$('#agents-all').checked||h.detected);
  if(!agents.length){board.replaceChildren(el('p','muted','Mendeteksi AI agent…'));return}
  const left=el('div','wire-col sources'),right=el('div','wire-col targets'),mid=el('div','wire-mid');
  for(const s of wireSources()){const n=el('div','wire-node source'+(s.kind==='hub'?' hub':' paket-'+s.color)+(wirePick===s.id?' picked':'')),head=el('div','wire-node-head');n.dataset.src=s.id;
    if(s.kind==='hub'){const img=el('img');img.src='/assets/santriverse-logo.webp';img.alt='';head.append(img)}else head.append(el('span','paket-icon',s.icon));
    head.append(el('strong',null,s.title));const port=el('button','port out');port.type='button';port.dataset.src=s.id;port.setAttribute('aria-label','Tarik kabel dari '+s.title);
    n.append(head,el('small',null,s.meta),port);left.append(n)}
  for(const h of shown){const n=el('div','wire-node agent'+(h.detected?'':' missing')),head=el('div','wire-node-head');n.dataset.agent=h.id;
    head.append(agentAvatar(h,'agent-avatar sm'),el('strong',null,h.name));n.append(el('span','port in'),head,el('small',null,h.detected?`${look(h)[2]} · ${h.skills.length} skill · ${h.mcp.names.length} MCP`:'Belum terpasang'));
    if(!h.detected){const b=el('button','link-btn','Cara pasang →');b.type='button';b.onclick=()=>openInstall(h);n.append(b)}
    n.onclick=e=>{if(e.target.closest('button')||!wirePick)return;const s=wireSources().find(x=>x.id===wirePick);wirePick=null;if(s)connectWire(s,h);else renderWireBoard()};right.append(n)}
  if(!shown.length)right.append(el('p','muted wire-empty','Belum ada AI agent terdeteksi. Pasang dulu lewat Beranda → AI agent.'));
  mid.append(el('span','wire-hint',wirePick?'Sekarang klik AI agent tujuan':'Tarik kabel dari ● ke AI agent'));
  const legend=el('div','wire-legend');legend.append(el('span','lg on','Tersambung'),el('span','lg partial','Sebagian'),el('span','lg hint','Klik kabel untuk memutus'));
  board.replaceChildren(svgEl('svg',{class:'wire-layer','aria-hidden':'true'}),left,mid,right,legend);requestAnimationFrame(drawWires)}
const wireCurve=(x0,y0,x1,y1)=>{const dx=Math.max(48,Math.abs(x1-x0)*.5);return `M${x0} ${y0} C${x0+dx} ${y0} ${x1-dx} ${y1} ${x1} ${y1}`};
const portAt=(n,box)=>{const r=n.getBoundingClientRect();return {x:r.left+r.width/2-box.left,y:r.top+r.height/2-box.top}};
function drawWires(){const board=$('#wire-board'),svg=board?.querySelector('.wire-layer');if(!svg)return;const box=board.getBoundingClientRect();if(!box.width)return;
  svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);board.querySelectorAll('.wire-badge').forEach(b=>b.remove());board.querySelectorAll('.port.live').forEach(p=>p.classList.remove('live'));
  const groups=[];
  for(const s of wireSources()){const out=board.querySelector(`.port.out[data-src="${s.id}"]`);if(!out)continue;const a=portAt(out,box);
    for(const h of agents.filter(x=>x.detected)){const inn=board.querySelector(`.wire-node.agent[data-agent="${h.id}"] .port.in`);if(!inn)continue;
      const key=wireKey(s.id,h.id),pending=wirePending===key,state=wireState(s,h);if(state==='off'&&!pending)continue;
      const b=portAt(inn,box),d=wireCurve(a.x,a.y,b.x,b.y),g=svgEl('g'),fresh=wireFresh&&wireFresh.key===key&&Date.now()-wireFresh.at<2600;
      const hit=svgEl('path',{d,class:'wire-hit'});hit.addEventListener('click',ev=>wireMenu(s,h,ev));
      g.append(hit,svgEl('path',{d,class:'wire '+(pending?'pending':state)+(fresh?' fresh':'')}));if(state==='on'&&!pending)g.append(svgEl('path',{d,class:'wire-flow'}));groups.push(g);
      if(!pending&&state!=='off'){out.classList.add('live');inn.classList.add('live')}
      if(pending){const badge=el('span','wire-badge','Menyambungkan…');badge.style.left=(a.x+b.x)/2+'px';badge.style.top=(a.y+b.y)/2+'px';board.append(badge)}}}
  svg.replaceChildren(...groups)}
function startWireDrag(e){const port=e.target.closest('#wire-board .port.out');if(!port||e.button>0)return;e.preventDefault();
  const board=$('#wire-board'),svg=board.querySelector('.wire-layer'),src=port.dataset.src,box=board.getBoundingClientRect(),a=portAt(port,box),temp=svgEl('path',{class:'wire temp'});svg.append(temp);let moved=false;
  const over=ev=>document.elementFromPoint(ev.clientX,ev.clientY)?.closest('#wire-board .wire-node.agent');
  const move=ev=>{moved=true;temp.setAttribute('d',wireCurve(a.x,a.y,ev.clientX-box.left,ev.clientY-box.top));const t=over(ev);board.querySelectorAll('.wire-node.agent').forEach(n=>n.classList.toggle('drop',n===t))};
  const up=ev=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);temp.remove();board.querySelectorAll('.drop').forEach(n=>n.classList.remove('drop'));
    const s=wireSources().find(x=>x.id===src),t=moved&&over(ev);
    if(!t){wirePick=moved?null:(wirePick===src?null:src);renderWireBoard();return}
    const h=agents.find(x=>x.id===t.dataset.agent);if(s&&h)connectWire(s,h)};
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',up)}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function hubWire(h,enable){agentsBusy=true;show($('#progress'));status(`${enable?'Menghubungkan':'Memutus'} ${h.name} ${enable?'ke':'dari'} hub…`);
  try{const r=await post('/api/harnesses/connect',{harness:h.id,enable});done(enable?`✓ ${h.name} tersambung ke hub SantriHub. ${r.hint||''}`:`✓ ${h.name} diputus dari hub.`)}catch(e){fail(e)}finally{agentsBusy=false;show($('#progress'),false)}await loadAgents()}
async function connectWire(s,h){wirePick=null;if(!h.detected){status(`${h.name} belum terpasang di komputer ini.`,true);return renderWireBoard()}
  if(wireState(s,h)==='on'){status(`${s.title} sudah tersambung ke ${h.name}.`);return renderWireBoard()}
  if(agentsBusy)return;const key=wireKey(s.id,h.id),t0=Date.now();wirePending=key;renderWireBoard();
  try{if(s.kind==='hub')await hubWire(h,true);else await bulkToggle(h,usableIn(s,h),true);await pause(Math.max(0,1100-(Date.now()-t0)))}
  finally{wirePending=null;const now=agents.find(x=>x.id===h.id);wireFresh=now&&wireState(wireSources().find(x=>x.id===s.id)||s,now)!=='off'?{key,at:Date.now()}:null;renderWireBoard();
    setTimeout(()=>{if(wireFresh&&wireFresh.key===key){wireFresh=null;drawWires()}},2700)}}
function wireMenu(s,h,ev){ev.stopPropagation();const board=$('#wire-board');board.querySelector('.wire-menu')?.remove();const box=board.getBoundingClientRect(),m=el('div','wire-menu');
  m.style.left=(ev.clientX-box.left)+'px';m.style.top=(ev.clientY-box.top)+'px';m.append(el('strong',null,`${s.title} → ${h.name}`));
  const cut=el('button','secondary danger','Putuskan kabel'),no=el('button','secondary','Batal');cut.type=no.type='button';no.onclick=()=>m.remove();
  cut.onclick=async()=>{m.remove();if(agentsBusy)return;if(s.kind==='hub')await hubWire(h,false);else await bulkToggle(h,usableIn(s,h).filter(r=>agentCell(h,r.kind,r.id).on),false)};
  m.append(cut,no);board.append(m)}
$('#wire-board').addEventListener('pointerdown',startWireDrag);
document.addEventListener('click',e=>{const m=$('#wire-board .wire-menu');if(m&&!m.contains(e.target))m.remove()});
new ResizeObserver(()=>drawWires()).observe($('#wire-board'));
// Kabel or Tabel; the choice is kept per browser.
function setAgentsView(v){$$('[data-agents-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.agentsView===v)));show($('#orbit-view'),v==='orbit');show($('#wire-board'),v==='wires');show($('#agents-table-view'),v==='table');
  try{localStorage.setItem('santrihub-agents-view',v)}catch{}if(v==='wires')requestAnimationFrame(drawWires);if(v==='orbit'){orbitFitKey='';renderOrbit()}}
$$('[data-agents-view]').forEach(b=>b.onclick=()=>setAgentsView(b.dataset.agentsView));
// ── Peta: every detected AI agent together in the middle, each skill / MCP its own node on rings
// around them. A cable is an item active in one agent; pull one from a node's + onto any agent.
let orbitFilter='all',orbitPending=null,orbitCutting=null,orbitFresh=null,orbitFitKey='',orbitView={z:1,x:0,y:0},orbitFocus=null;
let orbitReload={};try{orbitReload=JSON.parse(localStorage.getItem('santrihub-reload')||'{}')||{}}catch{}
function markReload(id,on){if(on)orbitReload[id]=Date.now();else delete orbitReload[id];try{localStorage.setItem('santrihub-reload',JSON.stringify(orbitReload))}catch{}refreshBell()}
async function reloadAgents(list,btn){const ag=list.find(h=>h.id==='antigravity');
  if(ag){if(!confirm('Restart Google Antigravity sekarang? Simpan pekerjaan Anda di Antigravity dulu.'))return;
    await busy(btn,'Meminta restart Antigravity…',async()=>{await post('/api/antigravity/control',{action:'restart',confirmClose:true,force:false,confirmForce:false});markReload('antigravity',false);done('✓ Antigravity direstart. Buka chat Agent baru, lalu uji di Cek & Tes.')})}
  for(const h of list.filter(h=>h.id!=='antigravity'))markReload(h.id,false);renderOrbit()}
const ORBIT_W=156,ORBIT_H=38,AGENT_W=164,AGENT_H=96,orbitKey=r=>r.kind+':'+r.id,cableKey=(key,h)=>key+'>'+h.id;
const orbitAgents=()=>agents.filter(h=>h.detected||$('#agents-all').checked);
const cellOf=(r,h)=>r.kind==='hub'?{on:hubOn(h),state:hubOn(h)?'on':'off'}:agentCell(h,r.kind,r.id);
function orbitItems(list){const q=$('#orbit-search').value.trim().toLowerCase(),live=list.filter(h=>h.detected);
  let rows=[{kind:'hub',id:'santrihub',label:'SantriHub Hub',desc:'MCP santrihub + skill pemandu',paket:[]},...allItems()];
  rows=rows.map(r=>{const cells=Object.fromEntries(live.map(h=>[h.id,cellOf(r,h)]));return {...r,cells,lit:live.filter(h=>cells[h.id].on&&cells[h.id].state!=='foreign').length,via:live.some(h=>cells[h.id].state==='via')}});
  rows=rows.filter(r=>orbitFilter==='all'||(orbitFilter==='on'?r.lit||r.via:r.kind!=='hub'&&r.paket.includes(orbitFilter)));
  if(q)rows=rows.filter(r=>(r.label+' '+(r.desc||'')).toLowerCase().includes(q));
  const first=r=>r.kind==='hub'?-1:paketOrder(r.paket.find(p=>p!=='mine')||r.paket[0]||'zz'),lit=r=>r.lit||r.via?0:1;
  return rows.sort((a,b)=>lit(a)-lit(b)||first(a)-first(b)||a.label.localeCompare(b.label))}
// Agents in a small grid in the middle; returns offsets from the centre and the grid's half size.
function agentGrid(n){const cols=Math.max(1,Math.ceil(Math.sqrt(n))),rows=Math.max(1,Math.ceil(n/cols)),gx=AGENT_W+34,gy=AGENT_H+34,pos=[];
  for(let i=0;i<n;i++){const row=Math.floor(i/cols),inRow=Math.min(cols,n-row*cols),col=i%cols;pos.push({x:(col-(inRow-1)/2)*gx,y:(row-(rows-1)/2)*gy})}
  return {pos,hw:(cols*gx)/2,hh:(rows*gy)/2}}
// Rings of an ellipse around the agent grid. Nodes sit at equal steps of 'node-sized' arc length:
// a step counts a full node width horizontally but only a node height vertically.
function orbitLayout(groups,hw,hh){const pos=[],gx=ORBIT_W+22,gy=ORBIT_H+18;let ring=0;
  // Each group (connected, then the rest) starts on a fresh ring and is spread evenly around it.
  for(const n of [].concat(groups)){let left=n;
    while(left>0){const ry=hh+95+ring*100,rx=Math.max(ry*2.1,hw+ORBIT_W/2+130+ring*200),pts=[],S=720;let len=0,prev=null;
      for(let i=0;i<=S;i++){const t=-Math.PI/2+i*2*Math.PI/S,p={x:Math.cos(t)*rx,y:Math.sin(t)*ry};if(prev)len+=Math.hypot((p.x-prev.x)/gx,(p.y-prev.y)/gy);pts.push({...p,len});prev=p}
      const cap=Math.max(6,Math.floor(len)),count=Math.min(cap,left),shift=ring%2?.5:0;
      for(let k=0;k<count;k++){const want=(k+shift)*len/count;const p=pts.find(q=>q.len>=want)||pts[0];pos.push({x:p.x,y:p.y})}left-=count;ring++}}
  return pos}
function tidyAssign(rows,pos,list,grid){const at=Object.fromEntries(list.map((h,i)=>[h.id,grid.pos[i]])),idx=rows.map((_,i)=>i).filter(i=>rows[i].lit||rows[i].via);
  const slots=idx.map(i=>pos[i]),free=slots.map(()=>true),out=pos.slice(),diff=(a,b)=>Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  const aim=idx.map(i=>{const on=list.filter(h=>rows[i].cells[h.id]&&(rows[i].cells[h.id].on||rows[i].cells[h.id].state==='via')).map(h=>at[h.id]);if(!on.length)return null;
    const x=on.reduce((s,p)=>s+p.x,0)/on.length,y=on.reduce((s,p)=>s+p.y,0)/on.length;return Math.hypot(x,y)<1?null:Math.atan2(y,x)});
  // Nodes aimed at one agent choose first; nodes shared by every agent take what is left.
  const order=idx.map((_,k)=>k).sort((a,b)=>(aim[a]===null)-(aim[b]===null));
  for(const k of order){let best=-1,score=Infinity;for(let j=0;j<slots.length;j++){if(!free[j])continue;const sc=aim[k]===null?j:diff(aim[k],Math.atan2(slots[j].y,slots[j].x));if(sc<score){score=sc;best=j}}
    free[best]=false;out[idx[k]]=slots[best]}
  return out}
// Node positions the member dragged, as offsets from the middle; kept per browser.
let orbitPos={},orbitWobble={};try{orbitPos=JSON.parse(localStorage.getItem('santrihub-orbit-pos')||'{}')||{}}catch{}
const saveOrbitPos=()=>{try{localStorage.setItem('santrihub-orbit-pos',JSON.stringify(orbitPos))}catch{}};
function renderOrbit(){const canvas=$('#orbit-canvas'),board=$('#orbit-board');if(!canvas||$('#orbit-view').hidden)return;
  const list=orbitAgents(),live=list.filter(h=>h.detected);$('#orbit-board .orbit-reload')?.remove();
  if(!live.length&&!list.length){canvas.replaceChildren(el('p','orbit-empty','Belum ada AI agent terdeteksi di komputer ini. Pasang dulu lewat Beranda → AI agent, lalu klik Periksa ulang.'));canvas.style.cssText='inset:0;transform:none';return}
  const chips=$('#orbit-chips'),items=allItems(),mk=(id,label)=>{const c=el('button','orbit-chip'+(orbitFilter===id?' on':''),label);c.type='button';c.onclick=()=>{orbitFilter=id;orbitFitKey='';renderOrbit()};return c};
  chips.replaceChildren(mk('all','Semua'),mk('on','Tersambung'),...paketList().filter(p=>items.some(r=>r.paket.includes(p.id))).map(p=>mk(p.id,p.short)));
  const before=Object.fromEntries([...canvas.querySelectorAll('.orbit-node')].map(n=>[n.dataset.key,{x:n.style.left,y:n.style.top}]));
  const grid=agentGrid(list.length),rows=orbitItems(list),lit=rows.filter(r=>r.lit||r.via).length,pos=tidyAssign(rows,orbitLayout([lit,rows.length-lit],grid.hw,grid.hh),list,grid),pad=110;
  const maxX=Math.max(grid.hw+60,...pos.map(p=>Math.abs(p.x)+ORBIT_W/2))+pad,maxY=Math.max(grid.hh+60,...pos.map(p=>Math.abs(p.y)+ORBIT_H/2))+pad,W=maxX*2,H=maxY*2,cx=maxX,cy=maxY;
  canvas.style.width=W+'px';canvas.style.height=H+'px';canvas.dataset.cx=cx;canvas.dataset.cy=cy;
  const hubs=list.map((h,i)=>{const a=el('div','orbit-center'+(h.detected?'':' missing')+(orbitReload[h.id]?' needs-reload':'')+(orbitFocus===h.id?' focus':''));a.dataset.agent=h.id;
    a.style.left=cx+grid.pos[i].x+'px';a.style.top=cy+grid.pos[i].y+'px';
    const n=rows.filter(r=>r.cells[h.id]&&r.cells[h.id].on&&r.cells[h.id].state!=='foreign').length;a.append(agentAvatar(h,'agent-avatar'),el('strong',null,h.name),el('small',null,h.detected?`${n} tersambung`:'Belum terpasang'));
    if(!h.detected){const b=el('button','link-btn','Cara pasang →');b.type='button';b.onclick=()=>openInstall(h);a.append(b)}
    a.onmouseenter=()=>{canvas.dataset.hover=h.id};a.onmouseleave=()=>{delete canvas.dataset.hover};return a});
  // Changed on disk but not reloaded yet: one banner over the map.
  const stale=live.filter(h=>orbitReload[h.id]);
  if(stale.length){const box=el('div','orbit-reload'),btn=el('button','orbit-reload-btn',stale.some(h=>h.id==='antigravity')?'Restart Antigravity':'Sudah dimuat ulang');btn.type='button';btn.onclick=()=>reloadAgents(stale,btn);
    const test=el('button','link-btn','Uji di chat →');test.type='button';test.onclick=()=>go('status');
    box.append(el('span','orbit-reload-dot'),el('span',null,stale.map(h=>h.name).join(', ')+' perlu dimuat ulang agar sambungan baru benar-benar aktif.'),btn,test);board.append(box)}
  const nodes=rows.map((r,i)=>{const key=orbitKey(r),saved=orbitPos[key],p=saved||pos[i],states=Object.values(r.cells);
    const n=el('div','orbit-node'+(r.lit?' on':'')+(r.via&&!r.lit?' via':'')+(states.length&&states.every(c=>c.state==='foreign')?' foreign':'')+(r.kind==='hub'?' hub':''));
    n.dataset.key=key;const to={x:(cx+p.x)+'px',y:(cy+p.y)+'px'},from=before[key];n.style.left=from?from.x:to.x;n.style.top=from?from.y:to.y;n._to=to;
    if(orbitFresh&&orbitFresh.key===key&&Date.now()-orbitFresh.at<2600)n.classList.add('lit-now');
    const inAgents=live.filter(h=>r.cells[h.id].on&&r.cells[h.id].state!=='foreign').map(h=>h.name);n.title=r.label+(inAgents.length?' · aktif di '+inAgents.join(', '):' · belum tersambung')+' · tarik untuk memindah';
    const pk=r.paket.map(paketById).find(x=>x&&x.icon&&!x.custom&&x.id!=='mine');
    const ic=el('span','orbit-ic'+(pk?' paket-'+pk.color:'')+(r.kind==='mcp'?' mcp':''),r.kind==='hub'?'':r.kind==='mcp'?'MCP':pk?pk.icon:r.label.replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase());
    if(r.kind==='hub'){const img=el('img');img.src='/assets/santriverse-logo.webp';img.alt='';ic.append(img)}
    n.append(ic,el('strong',null,r.label));if(r.lit){const ok=el('span','orbit-check'+(r.lit>1?' many':''),r.lit>1?String(r.lit):'');ok.title=`Aktif di ${r.lit} agent`;n.append(ok)}
    // The + pulls a cable as long as some agent still lacks this item.
    const open=live.filter(h=>r.cells[h.id].state==='off'),port=el(open.length?'button':'span','orbit-port '+(open.length?'plus':r.lit?'live':'muted'),open.length?'+':'');
    if(open.length){port.type='button';port.setAttribute('aria-label',`Tarik kabel dari ${r.label} ke AI agent`);port.title='Tarik kabel ke AI agent (atau klik untuk memilih)'}
    const del=el('button','orbit-del');del.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';del.type='button';del.title=r.kind!=='hub'&&r.mine?'Hapus dari koleksi':'Lepas dari semua AI agent';del.setAttribute('aria-label',del.title+': '+r.label);del.onclick=e=>{e.stopPropagation();deleteItem(r,n)};
    n.onmouseenter=()=>canvas.querySelectorAll(`.orbit-cut[data-key="${key}"]`).forEach(b=>b.classList.add('show'));n.onmouseleave=()=>canvas.querySelectorAll('.orbit-cut.show').forEach(b=>b.classList.remove('show'));
    n.append(port,del);n._row=r;return n});
  canvas.replaceChildren(svgEl('svg',{class:'orbit-wires',width:W,height:H,viewBox:`0 0 ${W} ${H}`}),...hubs,...nodes);
  const moving=nodes.some(n=>n.style.left!==n._to.x||n.style.top!==n._to.y);
  if(moving)requestAnimationFrame(()=>{for(const n of nodes){n.style.left=n._to.x;n.style.top=n._to.y}setTimeout(drawOrbitWires,560)});
  const fitKey=[list.map(h=>h.id).join(','),orbitFilter,$('#orbit-search').value,rows.length,W,H].join('|');if(fitKey!==orbitFitKey){orbitFitKey=fitKey;orbitFit()}else orbitApply();
  drawOrbitWires()}
function orbitApply(){$('#orbit-canvas').style.transform=`translate(${orbitView.x}px,${orbitView.y}px) scale(${orbitView.z})`}
function orbitFit(){const board=$('#orbit-board'),c=$('#orbit-canvas'),bw=board.clientWidth,bh=board.clientHeight-30,cw=parseFloat(c.style.width)||1,ch=parseFloat(c.style.height)||1;if(!bw)return;
  const z=Math.min(1.1,bw/cw,bh/ch);orbitView={z,x:(bw-cw*z)/2,y:(bh-ch*z)/2};orbitApply()}
function orbitZoom(f){const board=$('#orbit-board'),bw=board.clientWidth/2,bh=board.clientHeight/2,z=Math.min(2.5,Math.max(.25,orbitView.z*f));
  orbitView={z,x:bw-(bw-orbitView.x)*z/orbitView.z,y:bh-(bh-orbitView.y)*z/orbitView.z};orbitApply()}
// A hanging cable: both control points drop under the straight line, more for longer cables.
// `wob` (−1…1) makes it swing a little after a node moves.
function orbitCable(x1,y1,x2,y2,wob=0){const len=Math.hypot(x2-x1,y2-y1),sag=Math.min(95,len*.24)*(1+wob),
  a={x:x1+(x2-x1)*.25,y:y1+(y2-y1)*.25+sag},b={x:x1+(x2-x1)*.75,y:y1+(y2-y1)*.75+sag},
  at=t=>{const u=1-t;return {x:u*u*u*x1+3*u*u*t*a.x+3*u*t*t*b.x+t*t*t*x2,y:u*u*u*y1+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*y2}};
  return {d:`M${x1} ${y1} C${a.x} ${a.y} ${b.x} ${b.y} ${x2} ${y2}`,at}}
const nodeAt=n=>({x:parseFloat(n._to?n._to.x:n.style.left),y:parseFloat(n._to?n._to.y:n.style.top)});
// Where a cable leaves a node (its port, on the side facing the agents) and where it meets an agent card.
function orbitPortAt(n,cx){const p=nodeAt(n),side=p.x<cx?1:-1;return {x:p.x+side*(ORBIT_W/2+5),y:p.y}}
function agentEdge(a,px,py){const cx=parseFloat(a.style.left),cy=parseFloat(a.style.top),hw=a.offsetWidth/2+4,hh=a.offsetHeight/2+4,dx=px-cx,dy=py-cy;
  const t=Math.min(dx?hw/Math.abs(dx):Infinity,dy?hh/Math.abs(dy):Infinity);return {x:cx+dx*t,y:cy+dy*t}}
function drawOrbitWires(){const canvas=$('#orbit-canvas'),svg=canvas?.querySelector('.orbit-wires');if(!svg)return;
  const cx=+canvas.dataset.cx,live=orbitAgents().filter(h=>h.detected);canvas.querySelectorAll('.orbit-cut,.wire-badge').forEach(b=>b.remove());const groups=[],now=Date.now();let swinging=false;
  for(const n of canvas.querySelectorAll('.orbit-node')){const r=n._row,key=n.dataset.key,port=n.querySelector('.orbit-port'),side=nodeAt(n).x<cx;
    if(port){port.classList.toggle('right',side);port.classList.toggle('left',!side)}
    const p=orbitPortAt(n,cx),dt=now-(orbitWobble[key]||0),wob=dt<1100?.5*Math.exp(-dt/260)*Math.sin(dt/70):0;if(dt<1100)swinging=true;
    for(const h of live){const ck=cableKey(key,h),cell=r.cells[h.id],pending=orbitPending===ck,cutting=orbitCutting===ck;
      if(!pending&&!cutting&&!cell.on&&cell.state!=='via')continue;const a=canvas.querySelector(`.orbit-center[data-agent="${h.id}"]`);if(!a)continue;
      const e=agentEdge(a,p.x,p.y),{d,at}=orbitCable(p.x,p.y,e.x,e.y,wob),mid=at(.35),fresh=orbitFresh&&orbitFresh.cable===ck&&now-orbitFresh.at<2600;
      const cls=pending?'pending':cutting?'cutting':cell.state==='via'?'partial':cell.state==='foreign'?'foreign':'on';
      const g=svgEl('g',{'data-agent':h.id});g.append(svgEl('path',{d,class:'wire cable '+cls+(fresh?' fresh':'')}));if(cls==='on')g.append(svgEl('path',{d,class:'wire-flow'}));groups.push(g);
      if(pending||cutting){const b=el('span','wire-badge'+(cutting?' cut':''),pending?'Menyambungkan…':'Memutus…');b.style.left=mid.x+'px';b.style.top=mid.y+'px';canvas.append(b)}
      else if(cls==='on'){const x2=el('button','orbit-cut','×');x2.type='button';x2.dataset.agent=h.id;x2.dataset.key=key;x2.style.left=mid.x+'px';x2.style.top=mid.y+'px';x2.setAttribute('aria-label',`Putuskan ${r.label} dari ${h.name}`);x2.title=`Putuskan dari ${h.name}`;x2.onclick=e=>{e.stopPropagation();orbitToggle(h,r,false)};canvas.append(x2)}}}
  svg.replaceChildren(...groups,...svg.querySelectorAll('.temp'));if(swinging)requestAnimationFrame(drawOrbitWires)}
// Connect / disconnect one item in one agent, then re-read the agent from disk: the map only shows what is really there.
async function orbitToggle(h,r,enable){if(agentsBusy)return;const key=orbitKey(r),ck=cableKey(key,h),t0=Date.now();if(enable)orbitPending=ck;else orbitCutting=ck;drawOrbitWires();
  agentsBusy=true;show($('#progress'));status(`${enable?'Menyambungkan':'Memutus'} ${r.label} ${enable?'ke':'dari'} ${h.name}…`);let err=null;
  try{r.kind==='hub'?await post('/api/harnesses/connect',{harness:h.id,enable}):await post(r.kind==='mcp'?'/api/harnesses/mcp':'/api/harnesses/skill',{harness:h.id,id:r.id,enable})}
  catch(e){err=e}finally{agentsBusy=false;show($('#progress'),false)}
  await pause(Math.max(0,(enable?1000:600)-(Date.now()-t0)));orbitPending=orbitCutting=null;await loadAgents();
  const now=agents.find(x=>x.id===h.id),cell=now?cellOf(r,now):null,where=r.kind==='skill'?[h.skillsDir,r.id,'SKILL.md'].join(h.skillsDir.includes(String.fromCharCode(92))?String.fromCharCode(92):'/'):r.kind==='hub'?'MCP santrihub + skill santrihub':h.mcp.file;
  if(err)fail(new Error(`${r.label} gagal ${enable?'disambungkan':'diputus'}: ${err.message}`));
  else if(!!cell?.on!==enable)fail(new Error(`Tidak terverifikasi: setelah dibaca ulang dari disk, ${r.label} ${enable?'belum ada':'masih ada'} di ${h.name}.`));
  else{markReload(h.id,true);if(enable)orbitFresh={key,cable:ck,at:Date.now()};done(`✓ ${r.label} ${enable?'terpasang di':'dilepas dari'} ${h.name} dan terverifikasi di disk (${where}). Muat ulang ${h.name} agar ${enable?'terbaca':'hilang'}.`);renderOrbit()}
  setTimeout(()=>{if(orbitFresh&&orbitFresh.key===key){orbitFresh=null;renderOrbit()}},2700)}
// Clicking + (without pulling) asks which agent.
function portMenu(n,ev){const canvas=$('#orbit-canvas'),r=n._row,open=orbitAgents().filter(h=>h.detected&&r.cells[h.id].state==='off');canvas.querySelector('.orbit-pick')?.remove();
  if(open.length===1)return orbitToggle(open[0],r,true);
  const m=el('div','orbit-pick'),p=orbitPortAt(n,+canvas.dataset.cx);m.style.left=p.x+'px';m.style.top=p.y+'px';m.append(el('strong',null,'Sambungkan '+r.label+' ke'));
  for(const h of open){const b=el('button','orbit-pick-item');b.type='button';b.append(agentAvatar(h,'agent-avatar sm'),el('span',null,h.name));b.onclick=e=>{e.stopPropagation();m.remove();orbitToggle(h,r,true)};m.append(b)}
  canvas.append(m)}
document.addEventListener('pointerdown',e=>{const m=$('#orbit-canvas .orbit-pick');if(m&&!m.contains(e.target))m.remove()},true);
// Pointer on the map: + pulls a cable, a node body moves the node, the background pans.
$('#orbit-board').addEventListener('pointerdown',e=>{if(e.button>0)return;const canvas=$('#orbit-canvas'),port=e.target.closest('.orbit-port.plus');
  if(!port&&e.target.closest('button,.orbit-zoom,.orbit-reload,.orbit-pick'))return;
  const node=e.target.closest('.orbit-node'),sx=e.clientX,sy=e.clientY;let moved=false;
  const off=(type,fn)=>document.removeEventListener(type,fn),on=(move,up)=>{document.addEventListener('pointermove',move);document.addEventListener('pointerup',up)};
  const at=ev=>{const b=canvas.getBoundingClientRect();return {x:(ev.clientX-b.left)/orbitView.z,y:(ev.clientY-b.top)/orbitView.z}};
  const agentUnder=ev=>{const a=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.orbit-center');return a&&agents.find(h=>h.id===a.dataset.agent&&h.detected)?a:null};
  const glow=ev=>{const a=ev&&agentUnder(ev);canvas.querySelectorAll('.orbit-center').forEach(x=>x.classList.toggle('drop',x===a))};
  if(!node){const start={...orbitView},move=ev=>{orbitView.x=start.x+ev.clientX-sx;orbitView.y=start.y+ev.clientY-sy;orbitApply()},up=()=>{off('pointermove',move);off('pointerup',up)};on(move,up);return}
  e.preventDefault();const r=node._row,cx=+canvas.dataset.cx;
  const connectTo=(a,ev)=>{const h=agents.find(x=>x.id===a.dataset.agent),cell=r.cells[h.id];
    if(cell.state==='foreign')return status(`${r.label} milik Anda di ${h.name}; SantriHub tidak mengubahnya.`,true);
    if(cell.on)return status(`${r.label} sudah tersambung ke ${h.name}.`);return orbitToggle(h,r,true)};
  if(port){// Pull a cable out of the port; drop it on an agent to connect, anywhere else and it springs back.
    const svg=canvas.querySelector('.orbit-wires'),from=orbitPortAt(node,cx),temp=svgEl('path',{class:'wire cable temp'});svg.append(temp);let tip=from;
    const move=ev=>{if(!moved&&Math.hypot(ev.clientX-sx,ev.clientY-sy)<4)return;moved=true;tip=at(ev);temp.setAttribute('d',orbitCable(from.x,from.y,tip.x,tip.y).d);glow(ev)};
    const up=ev=>{off('pointermove',move);off('pointerup',up);glow(null);const a=moved&&agentUnder(ev);
      if(!moved){temp.remove();return portMenu(node,ev)}
      if(a){temp.remove();return connectTo(a,ev)}
      const t0=performance.now(),start=tip,back=t=>{const k=Math.min(1,(t-t0)/260),ease=1-Math.pow(1-k,3);temp.setAttribute('d',orbitCable(from.x,from.y,start.x+(from.x-start.x)*ease,start.y+(from.y-start.y)*ease).d);if(k<1)requestAnimationFrame(back);else temp.remove()};requestAnimationFrame(back)};
    on(move,up);return}
  // Move the node; its cables follow. Dropping it on an agent connects it there.
  const start=nodeAt(node);let frame=0;
  const trash=$('#orbit-trash'),overTrash=ev=>{const t=trash.getBoundingClientRect();return ev.clientX>=t.left&&ev.clientX<=t.right&&ev.clientY>=t.top&&ev.clientY<=t.bottom};
  const move=ev=>{if(!moved&&Math.hypot(ev.clientX-sx,ev.clientY-sy)<4)return;if(!moved){moved=true;node.classList.add('dragging');node._to=null;show(trash)}trash.classList.toggle('hot',overTrash(ev));
    node.style.left=start.x+(ev.clientX-sx)/orbitView.z+'px';node.style.top=start.y+(ev.clientY-sy)/orbitView.z+'px';glow(ev);if(!frame)frame=requestAnimationFrame(()=>{frame=0;drawOrbitWires()})};
  const up=ev=>{off('pointermove',move);off('pointerup',up);node.classList.remove('dragging');glow(null);const binned=moved&&overTrash(ev);show(trash,false);trash.classList.remove('hot');
    if(!moved){if(r.kind!=='hub')openItem(r);return}
    if(binned){node.style.left=start.x+'px';node.style.top=start.y+'px';node._to={x:start.x+'px',y:start.y+'px'};drawOrbitWires();return deleteItem(r,node)}
    const key=node.dataset.key,p=nodeAt(node),a=agentUnder(ev);node._to={x:p.x+'px',y:p.y+'px'};
    if(a&&r.cells[a.dataset.agent]?.state==='off'){delete orbitPos[key];saveOrbitPos();return connectTo(a,ev)}
    orbitPos[key]={x:p.x-cx,y:p.y-(+canvas.dataset.cy)};saveOrbitPos();orbitWobble[key]=Date.now();drawOrbitWires()};
  on(move,up)});
$('#orbit-board').addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();orbitZoom(e.deltaY<0?1.12:1/1.12)},{passive:false});
$$('[data-zoom]').forEach(b=>b.onclick=()=>{const z=b.dataset.zoom;if(z==='reset'){orbitPos={};saveOrbitPos();renderOrbit();done('Posisi node dirapikan kembali.')}else if(z==='fit')orbitFit();else orbitZoom(z==='in'?1.2:1/1.2)});
$('#orbit-search').addEventListener('input',()=>renderOrbit());
$('#orbit-tidy').onclick=()=>{orbitPos={};saveOrbitPos();orbitFitKey='';renderOrbit();done('✨ Peta dirapikan: yang tersambung menghadap agent-nya, sisanya di lingkar luar.')};
// Own skills / MCP leave the collection (and every agent); catalog items can only leave the agents.
async function deleteItem(r,node){if(agentsBusy)return;const live=orbitAgents().filter(h=>h.detected),on=live.filter(h=>r.cells[h.id]?.on&&r.cells[h.id].state!=='foreign'),names=on.map(h=>h.name).join(', ');
  const own=r.kind!=='hub'&&r.mine;
  if(!own&&!on.length)return status(`${r.label} adalah ${r.kind==='hub'?'Hub SantriHub':'skill bawaan paket'}; tidak bisa dihapus dari koleksi dan belum tersambung ke agent mana pun.`,true);
  const ask=own?`Hapus ${r.kind==='mcp'?'MCP':'skill'} "${r.label}" dari koleksi Anda?${on.length?` Salinannya di ${names} ikut dilepas.`:''} Tindakan ini tidak bisa dibatalkan.`
    :`"${r.label}" adalah ${r.kind==='hub'?'Hub SantriHub':'skill bawaan paket'} dan tidak bisa dihapus dari koleksi. Lepas dari semua AI agent (${names})?`;
  if(!confirm(ask))return;node?.classList.add('removing');agentsBusy=true;show($('#progress'));status(own?`Menghapus ${r.label}…`:`Melepas ${r.label} dari ${names}…`);
  try{if(own){const x=await post(r.kind==='mcp'?'/api/mcp-library/delete':'/api/library/delete',{id:r.id});delete orbitPos[orbitKey(r)];saveOrbitPos();
      for(const h of on)markReload(h.id,true);done(`🗑 ${r.label} dihapus dari koleksi${x.deactivated?.length?` dan dilepas dari ${x.deactivated.join(', ')}`:''}.`)}
    else{const failed=[];for(const h of on){try{r.kind==='hub'?await post('/api/harnesses/connect',{harness:h.id,enable:false}):await post(r.kind==='mcp'?'/api/harnesses/mcp':'/api/harnesses/skill',{harness:h.id,id:r.id,enable:false});markReload(h.id,true)}catch(e){failed.push(h.name+': '+e.message)}}
      if(failed.length)fail(new Error('Sebagian gagal dilepas: '+failed.join(' · ')));else done(`✓ ${r.label} dilepas dari ${names}.`)}}
  catch(e){node?.classList.remove('removing');fail(e)}finally{agentsBusy=false;show($('#progress'),false)}
  await loadAgents()}
new ResizeObserver(()=>{if(!$('#orbit-view').hidden&&orbitFitKey)orbitFit()}).observe($('#orbit-board'));
try{const v=localStorage.getItem('santrihub-agents-view');if(v==='table'||v==='wires')setAgentsView(v)}catch{}
function renderAgents(){renderWireBoard();renderOrbit();const all=$('#agents-all').checked,shown=agents.filter(h=>all||h.detected),q=$('#agents-search').value.trim().toLowerCase();
  $('#agents-cards').replaceChildren(...(agents.length?agents.filter(h=>all||h.detected).map(h=>{const card=el('article','panel agent-card'+(h.detected?'':' undetected')),main=el('span','agent-card-main'),meta=el('small','agent-card-meta');
    meta.append(el('i','status-dot'+(h.detected?' on':'')),h.detected?`${h.skills.length} skill · ${h.mcp.names.length} MCP`:'Belum terdeteksi');main.append(el('strong',null,h.name),meta);
    card.title=h.skillsDir+(h.sharedWith.length?'\nFolder ini juga dibaca: '+h.sharedWith.join(', '):'');card.append(agentAvatar(h,'agent-avatar agent-card-av'),main);return card}):[el('p','muted','Tidak ada data.')]));
  if(!shown.length){$('#agents-matrix').replaceChildren(el('caption',null,'Belum ada AI agent terdeteksi. Centang "Tampilkan agent yang belum terdeteksi" untuk menyiapkan lebih dulu.'));return}
  const rows=allItems({gateway:true}).filter(r=>!q||(r.label+' '+(r.desc||'')+' '+paketById(r.paket[0]).short).toLowerCase().includes(q));
  const head=el('tr');head.append(el('th',null,'Skill / MCP'),...shown.map(h=>{const th=el('th',null,h.name);th.scope='col';return th}));
  const rowFor=r=>{const tr=el('tr');const name=el('th');name.scope='row';name.append(el('span','agent-kind '+r.kind+(r.mine?' mine':''),r.kind==='mcp'?'MCP':r.mine?'SAYA':'SKILL'),el('span',null,' '+r.label));if(r.desc)name.title=r.desc;tr.append(name);
    for(const h of shown){const c=agentCell(h,r.kind,r.id),td=el('td','agent-cell '+c.state),box=document.createElement('input');box.type='checkbox';box.checked=c.on;
      box.disabled=c.state==='foreign'||agentsBusy;box.setAttribute('aria-label',`${r.label} di ${h.name}`);box.onchange=()=>toggleAgent(h,r,box);td.append(box);if(c.note)td.append(el('small',null,c.note));tr.append(td)}
    return tr};
  const body=[];
  for(const id of [...new Set(rows.map(r=>r.paket[0]))].sort((a,b)=>paketOrder(a)-paketOrder(b))){const group=rows.filter(r=>r.paket[0]===id),p=paketById(id);
    const tr=el('tr','paket-row'),th=el('th');th.scope='rowgroup';th.append(paketPill(id),el('span',null,` ${p.label} · ${group.length}`));if(p.author)th.title='oleh '+p.author;tr.append(th);
    for(const h of shown){const usable=group.filter(r=>agentCell(h,r.kind,r.id).state!=='foreign'),onN=usable.filter(r=>agentCell(h,r.kind,r.id).on).length;
      const td=el('td','agent-cell paket-cell'),box=document.createElement('input');box.type='checkbox';box.checked=usable.length>0&&onN===usable.length;box.indeterminate=onN>0&&onN<usable.length;
      box.disabled=agentsBusy||!usable.length;box.setAttribute('aria-label',`Semua ${p.short} di ${h.name}`);box.onchange=()=>bulkToggle(h,usable,box.checked);td.append(box,el('small',null,`${onN}/${usable.length}`));tr.append(td)}
    body.push(tr,...group.map(rowFor))}
  $('#agents-matrix').replaceChildren(el('thead'),el('tbody'));$('#agents-matrix thead').append(head);$('#agents-matrix tbody').append(...body)}
async function loadAgents(){try{const [h,lib,gw,pr,mine,own]=await Promise.all([getJson('/api/harnesses'),getJson('/api/library'),getJson('/api/gateway'),getJson('/api/profiles'),getJson('/api/mcp-library'),getJson('/api/my-paket')]);agents=h.harnesses||[];myMcp=mine.servers||[];myPaket=own.paket||[];librarySkills=lib.skills||[];gatewayServers=gw.servers||[];profiles=pr.profiles||{};renderAgents();renderGateway();renderProfiles();renderFlow();renderHomeUploads();loadActivity()}catch(e){$('#agents-cards').replaceChildren(el('p','muted','AI agent belum bisa dideteksi.'));fail(e)}}
async function toggleAgent(h,r,box){const enable=box.checked;agentsBusy=true;$$('#agents-matrix input').forEach(i=>{i.disabled=true});show($('#progress'));status(`${enable?'Mengaktifkan':'Menonaktifkan'} ${r.label} di ${h.name}…`);
  try{const res=await post(r.kind==='mcp'?'/api/harnesses/mcp':'/api/harnesses/skill',{harness:h.id,id:r.id,enable});done(`✓ ${r.label} ${enable?'aktif':'nonaktif'} di ${h.name}. ${res.hint||''}`)}
  catch(e){fail(e)}finally{agentsBusy=false;show($('#progress'),false);await loadAgents()}}
// ─ Gateway + profiles (AI Agents page): /api/gateway, /api/profiles ─
$$('[data-extra]').forEach(b=>b.onclick=()=>$$('[data-extra]').forEach(x=>{const on=x===b;x.setAttribute('aria-selected',String(on));show(document.getElementById(x.dataset.extra),on)}));
let gatewayServers=[],profiles={};
function renderGateway(){const host=$('#gateway-list');
  const rows=[...catalog.mcpServers,...myMcp.filter(m=>m.kind==='stdio').map(m=>({id:m.id,label:m.name+' (milik saya)',description:m.summary}))];
  if(!rows.length){host.replaceChildren(el('p','muted','Katalog MCP kosong.'));return}
  host.replaceChildren(...rows.map(m=>{const name=m.id,row=el('label','gateway-row'),box=document.createElement('input');box.type='checkbox';box.checked=gatewayServers.includes(name);box.setAttribute('aria-label',`${m.label||m.id} lewat SantriHub Gateway`);
    box.onchange=async()=>{box.disabled=true;try{const r=await post('/api/gateway',{id:m.id,enable:box.checked});gatewayServers=r.servers;done(`✓ ${m.label||m.id} ${box.checked?'masuk':'keluar dari'} Gateway. ${r.hint}`)}catch(e){box.checked=!box.checked;fail(e)}finally{box.disabled=false}};
    row.append(box,el('strong',null,m.label||m.id),el('small','muted',m.description||''));return row}))}
function renderProfiles(){const sel=$('#profile-source'),keep=sel.value;sel.replaceChildren(...agents.filter(h=>h.detected).map(h=>{const o=el('option',null,h.name);o.value=h.id;return o}));if(keep)sel.value=keep;
  const names=Object.keys(profiles);
  if(!names.length){$('#profile-list').replaceChildren(el('p','muted','Belum ada profil.'));return}
  $('#profile-list').replaceChildren(...names.map(name=>{const p=profiles[name],row=el('div','profile-row');row.append(el('strong',null,name),el('small','muted',`${p.skills.length} skill · ${p.mcp.length} MCP`));row.title=[...p.skills,...p.mcp].join(', ');
    const target=document.createElement('select');target.setAttribute('aria-label',`Agent tujuan profil ${name}`);target.append(...agents.filter(h=>h.detected).map(h=>{const o=el('option',null,h.name);o.value=h.id;return o}));
    const apply=el('button','secondary','Terapkan');apply.type='button';apply.onclick=()=>busy(apply,`Menerapkan ${name}…`,async()=>{const r=await post('/api/profiles/apply',{name,harness:target.value});
      if(r.failed.length)fail(new Error(`${r.applied.length} diterapkan, ${r.failed.length} gagal: ${r.failed.map(f=>`${f.id} (${f.error})`).join('; ')}`));else done(`✓ Profil ${name} diterapkan (${r.applied.length} item). ${r.hint}`);await loadAgents()});
    const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus profil ${name}? Skill dan MCP di agent tidak berubah.`))return;busy(del,'Menghapus profil…',async()=>{await post('/api/profiles/delete',{name});done(`✓ Profil ${name} dihapus.`);await loadAgents()})};
    row.append(target,apply,del);return row}))}
$('#profile-save').onclick=()=>busy($('#profile-save'),'Menyimpan profil…',async()=>{const name=$('#profile-name').value.trim();if(!name)throw new Error('Isi nama profil.');
  const r=await post('/api/profiles/save',{name,harness:$('#profile-source').value});$('#profile-name').value='';done(`✓ Profil ${name} disimpan: ${r.skills.length} skill, ${r.mcp.length} MCP.`);await loadAgents()});
$('#profile-export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,profiles},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='santrihub-profil.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);done('✓ Profil diekspor ke santrihub-profil.json.')};
$('#profile-import').onchange=async()=>{const f=$('#profile-import').files[0];if(!f)return;try{const data=JSON.parse(await readFile(f));const r=await post('/api/profiles/import',{data});done(`✓ Diimpor: ${r.imported.join(', ')}.`);await loadAgents()}catch(e){fail(e instanceof SyntaxError?new Error('File bukan JSON valid.'):e)}finally{$('#profile-import').value=''}};

// ─ Skill Saya: the member's library via /api/library (src/library.js) ─
let librarySkills=[],libPreview=null,libraryLoaded=false;
const readFile=file=>new Promise((ok,no)=>{if(file.size>512*1024)return no(new Error(`${file.name} melebihi 512 KB.`));const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>no(new Error(`${file.name} tidak bisa dibaca.`));r.readAsText(file)});
function emptyState(text,label,action){const box=el('div','empty-state');box.append(el('p',null,text));if(label){const b=el('button','secondary',label);b.type='button';b.onclick=action;box.append(b)}return box}
const LIB_TYPE={github:'GitHub',upload:'Upload'};
function libRow(s){return allItems().find(r=>r.kind==='skill'&&r.mine&&r.id===s.id)||{kind:'skill',id:s.id,label:s.id,desc:s.description,mine:true,paket:['mine'],by:libraryOrigin(s)}}
function renderLibrary(){const host=$('#library-list');if(!libraryLoaded)return;
  if(!librarySkills.length){host.replaceChildren(emptyState('Belum ada skill milik Anda. Import dari GitHub atau buat dari Markdown.','+ Import dari GitHub',()=>$('#lib-open-github').click()));return}
  host.replaceChildren(...librarySkills.map(s=>{const r=libRow(s),on=activeIn('skill',s.id),card=el('button','collection-card compact lib-tile'+(on.length?' on':''));card.type='button';card.title=s.id;card.setAttribute('aria-label','Detail '+s.id);
    const main=el('span','collection-main'),meta=el('span','collection-meta');
    meta.append(el('i','status-dot'+(on.length?' on':'')),el('span',null,on.length?'Aktif di '+on.length+' agent':'Belum aktif'),el('span','lib-type',LIB_TYPE[s.type]||'Markdown'));
    main.append(el('strong',null,s.id),meta);card.append(itemIcon(r),main,el('span','collection-go','›'));card.onclick=()=>openItem(r);return card}))}
async function loadLibrary(){try{librarySkills=(await getJson('/api/library')).skills||[];libraryLoaded=true;renderLibrary();renderFlow()}catch(e){$('#library-list').replaceChildren(el('p','muted','Library belum bisa dimuat.'));fail(e)}}
function closeLibPanels(){show($('#lib-github'),false);show($('#lib-md'),false);libPreview=null;$('#lib-github-results').replaceChildren();show($('#lib-github-actions'),false)}
$('#lib-open-github').onclick=()=>{closeLibPanels();show($('#lib-github'));$('#lib-github-url').focus()};
$('#lib-open-md').onclick=()=>{closeLibPanels();show($('#lib-md'));$('#lib-md-content').focus()};
$('#lib-github-cancel').onclick=closeLibPanels;$('#lib-md-cancel').onclick=closeLibPanels;
$('#lib-github-form').onsubmit=e=>{e.preventDefault();busy($('#lib-github-scan'),'Membaca repository GitHub…',async()=>{
  libPreview=await post('/api/library/github/preview',{url:$('#lib-github-url').value.trim(),includeScripts:$('#lib-github-scripts').checked});
  $('#lib-github-results').replaceChildren(...libPreview.skills.map(s=>{const row=el('article','lib-pick');row.dataset.key=s.key;
    const top=el('label','lib-pick-head');const box=document.createElement('input');box.type='checkbox';box.checked=true;box.className='lib-pick-box';top.append(box,el('strong',null,s.key==='@generated'?'(seluruh repository)':s.key));
    if(s.generated)top.append(el('span','pill','SKILL.md DIBUAT OTOMATIS'));if(s.repaired)top.append(el('span','pill','FRONTMATTER DIPERBAIKI'));row.append(top);
    const id=el('label',null,'ID skill');const idIn=document.createElement('input');idIn.className='lib-pick-id';idIn.value=s.id;id.append(idIn);
    const desc=el('label',null,'Deskripsi (kapan agent memakainya)');const descIn=document.createElement('input');descIn.className='lib-pick-desc';descIn.value=s.description;desc.append(descIn);row.append(id,desc);
    row.append(el('small','muted',`${s.files.length} file pendukung${s.skipped.length?` · ${s.skipped.length} dilewati`:''}`));
    if(s.skipped.length){const d=el('details');d.append(el('summary',null,'File yang dilewati'),el('pre',null,s.skipped.join('\n')));row.append(d)}
    const md=el('details');md.append(el('summary',null,'Lihat SKILL.md'),el('pre',null,s.skillMd));row.append(md);return row}));
  show($('#lib-github-actions'));done(`✓ ${libPreview.skills.length} skill ditemukan di ${libPreview.source.repo} (${libPreview.source.branch}).`)})};
$('#lib-github-save').onclick=()=>busy($('#lib-github-save'),'Menyimpan ke library…',async()=>{if(!libPreview)throw new Error('Preview dulu.');
  const picks=$$('#lib-github-results .lib-pick').filter(r=>r.querySelector('.lib-pick-box').checked).map(r=>({key:r.dataset.key,id:r.querySelector('.lib-pick-id').value.trim(),description:r.querySelector('.lib-pick-desc').value.trim()}));
  if(!picks.length)throw new Error('Pilih minimal satu skill.');const r=await post('/api/library/github/save',{previewId:libPreview.previewId,picks});closeLibPanels();done(`✓ ${r.saved.join(', ')} tersimpan di library.`);await loadLibrary()});
$('#lib-md-file').onchange=async()=>{const f=$('#lib-md-file').files[0];if(!f)return;try{$('#lib-md-content').value=await readFile(f);if(!$('#lib-md-id').value)$('#lib-md-id').value=f.name.replace(/\.[^.]+$/,'')}catch(e){fail(e)}};
$('#lib-md-save').onclick=()=>busy($('#lib-md-save'),'Menyimpan skill…',async()=>{const refs=[];for(const f of $('#lib-md-refs').files)refs.push({name:f.name,content:await readFile(f)});
  const r=await post('/api/library/markdown',{id:$('#lib-md-id').value.trim(),description:$('#lib-md-desc').value.trim(),content:$('#lib-md-content').value,references:refs});
  for(const i of ['#lib-md-id','#lib-md-desc','#lib-md-content','#lib-md-file','#lib-md-refs'])$(i).value='';closeLibPanels();done(`✓ ${r.saved[0]} tersimpan di library.`);await loadLibrary()});

$('#agents-all').onchange=renderAgents;$('#agents-search').oninput=renderAgents;$('#agents-refresh').onclick=()=>busy($('#agents-refresh'),'Mendeteksi AI agent…',loadAgents);

// ─ Alur kerja: Beranda (langkah + agent), Tambah (sumber), Koleksi (katalog premium + milik Anda) ─
let collectionKind='skills',collectionPaket='all',myMcp=[],myPaket=[];
const detectedAgents=()=>agents.filter(h=>h.detected);
// Agents where a skill/MCP is on; MCP in the Gateway counts for every agent that has the Gateway.
function activeIn(kind,id){return detectedAgents().filter(h=>agentCell(h,kind,id).on||(kind==='mcp'&&gatewayServers.includes(id)&&agentCell(h,'mcp',GATEWAY_ID).on)).map(h=>h.name)}
function renderCollection(){const host=$('#collection-list');if(!host)return;const q=$('#collection-search').value.trim().toLowerCase(),items=allItems(),all={skills:items.filter(r=>r.kind==='skill'),mcp:items.filter(r=>r.kind==='mcp')};
  renderPaketCards(items);renderPaketFilters();renderPaketBulk(items.filter(r=>r.paket.includes(collectionPaket)));
  const keep=r=>(collectionPaket==='all'||r.paket.includes(collectionPaket))&&(!q||(r.label+' '+(r.desc||'')+' '+r.by+' '+r.paket.map(id=>paketById(id).short).join(' ')).toLowerCase().includes(q));
  const shown={skills:all.skills.filter(keep),mcp:all.mcp.filter(keep)};
  $('#collection-count-skills').textContent=shown.skills.length;$('#collection-count-mcp').textContent=shown.mcp.length;
  $$('[data-collection-kind]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.collectionKind===collectionKind)));
  const rows=shown[collectionKind];
  if(!rows.length){const empty=el('div','collection-empty');empty.append(el('p','muted',q?'Tidak ada yang cocok dengan pencarian.':collectionPaket==='mine'?'Belum ada skill atau MCP milik Anda. Tambahkan lewat impor pintar.':'Koleksi masih kosong.'));
    const add=el('button','home-create','+ Tambah skill / MCP');add.type='button';add.onclick=()=>go('add');empty.append(add);host.replaceChildren(empty);return}
  host.replaceChildren(...rows.map(r=>{const on=activeIn(r.kind,r.id),card=el('button','collection-card compact'+(r.mine?' mine':'')+(on.length?' on':''));card.type='button';card.setAttribute('aria-label','Detail '+r.label);card.title=r.label;
    const main=el('span','collection-main'),meta=el('span','collection-meta');
    meta.append(el('i','status-dot'+(on.length?' on':'')),el('span',null,on.length?'Aktif di '+on.length+' agent':'Belum aktif'));
    for(const id of r.paket.filter(x=>x!=='mine'))meta.append(el('span','dot-pill paket-'+paketById(id).color,paketById(id).short));
    main.append(el('strong',null,r.label),meta);card.append(itemIcon(r),main,el('span','collection-go','›'));card.onclick=()=>openItem(r);return card}))}
// Catalog items carry their paket icon and colour; own items show the initials of their name.
function itemIcon(r){const p=r.paket.map(paketById).find(x=>x&&x.icon&&!x.custom&&x.id!=='mine'),words=r.label.split(/[^a-z0-9]+/i).filter(Boolean);
  const i=el('span','item-icon '+(r.kind==='mcp'?'mcp':'skill')+(p?' paket-'+p.color:''),r.kind==='mcp'?'MCP':p?p.icon:(words.length>1?words[0][0]+words[1][0]:r.label.slice(0,2)).toUpperCase());i.setAttribute('aria-hidden','true');return i}
// Detail of one skill / MCP: description, origin, where it is active and every action.
function openItem(r){const dlg=$('#item-dialog'),body=$('#item-body');$('#item-icon').replaceWith(Object.assign(itemIcon(r),{id:'item-icon'}));
  $('#item-kind').textContent=r.kind==='mcp'?'MCP SERVER':'SKILL';$('#item-title').textContent=r.label;
  const pills=el('div','item-pills');pills.append(...r.paket.map(paketPill));if(r.starter)pills.append(el('span','pill starter','SKILL PEMBUKA'));
  const on=activeIn(r.kind,r.id),facts=el('dl','paket-facts');const fact=(k,v)=>{if(v)facts.append(el('dt',null,k),el('dd',null,v))};
  const lib=r.mine&&r.kind==='skill'?librarySkills.find(s=>s.id===r.id):null;
  fact('Asal',r.by);if(lib?.generated)fact('Catatan','SKILL.md dibuat otomatis');
  if(lib?.repo){const a=el('a','lib-source','github.com/'+lib.repo);a.href='https://github.com/'+lib.repo;a.target='_blank';a.rel='noopener noreferrer';const dd=el('dd');dd.append(a);facts.append(el('dt',null,'Repo'),dd)}
  fact('Aktif di',on.length?on.join(', '):agents.length?'Belum aktif di AI agent mana pun':'Status AI agent belum dimuat');if(r.gateway)fact('Lewat','SantriHub Gateway');
  const about=el('p','item-desc',r.desc||'(tanpa deskripsi)');
  const actions=el('div','collection-actions'),use=el('button','home-create',on.length?'Atur agent →':'Aktifkan →');use.type='button';
  use.onclick=()=>{dlg.close();$('#agents-search').value=r.id;go('agents');renderAgents()};actions.append(use);
  if(r.kind==='mcp'){const t=el('button','secondary','Tes koneksi');t.type='button';t.onclick=()=>testMcp(r.id,body,t);actions.append(t)}
  if(r.mine){const pk=el('button','secondary','Paket…');pk.type='button';pk.onclick=()=>paketChooser(r,body);actions.append(pk)}
  if(lib&&lib.type==='github'){const upd=el('button','secondary','Cek update');upd.type='button';upd.onclick=()=>busy(upd,`Mengecek ${lib.id} di GitHub…`,async()=>{const x=await post('/api/library/update',{id:lib.id});done(x.changed?`✓ ${lib.id} diperbarui${x.synced?.length?` (juga di ${x.synced.join(', ')})`:''}.`:`✓ ${lib.id} sudah versi terbaru.`);await loadLibrary()});actions.append(upd)}
  if(lib){const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus ${lib.id} dari library? Salinannya di AI agent juga dinonaktifkan.`))return;busy(del,`Menghapus ${lib.id}…`,async()=>{const x=await post('/api/library/delete',{id:lib.id});dlg.close();done(`✓ ${lib.id} dihapus${x.deactivated?.length?` dan dinonaktifkan di ${x.deactivated.join(', ')}`:''}.`);await loadLibrary();await loadAgents()})};actions.append(del)}
  if(r.mine&&r.kind==='mcp'){const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus MCP ${r.label} dari koleksi? Salinannya di AI agent juga dinonaktifkan.`))return;busy(del,`Menghapus ${r.label}…`,async()=>{const x=await post('/api/mcp-library/delete',{id:r.id});dlg.close();done(`✓ ${r.label} dihapus${x.deactivated.length?` dan dinonaktifkan di ${x.deactivated.join(', ')}`:''}.`);await loadAgents()})};actions.append(del)}
  body.replaceChildren(pills,about,facts,actions);if(!dlg.open)dlg.showModal()}
$('#item-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$('#item-dialog [data-close]').onclick=()=>$('#item-dialog').close();
function renderHomeSteps(){const host=$('#home-steps');if(!host)return;const found=detectedAgents();
  const items=catalog.skills.length+librarySkills.length+catalog.mcpServers.length;
  const active=found.reduce((n,h)=>n+h.skills.filter(s=>s.managed).length+h.mcp.names.length,0);
  const steps=[
    {page:'add',title:'Tambah ke Koleksi',done:items>0,detail:items?`${catalog.skills.length} skill premium · ${librarySkills.length} milik Anda · ${catalog.mcpServers.length} MCP`:'Ambil dari katalog, GitHub, atau Markdown'},
    {page:'agents',title:'Aktifkan di AI agent',done:active>0,detail:!found.length?'Belum ada AI agent terdeteksi':active?`${active} item aktif di ${found.length} agent`:`Pilih skill untuk ${found.map(h=>h.name).slice(0,3).join(', ')}`},
    {page:'status',title:'Cek & Tes di chat',done:false,detail:'Reload AI agent, lalu coba di chat'}];
  const next=steps.findIndex(s=>!s.done);
  host.replaceChildren(...steps.map((s,i)=>{const li=el('li','home-step'+(s.done?' done':'')+(i===next?' next':'')),b=el('button','home-step-btn');b.type='button';b.onclick=()=>go(s.page);
    b.append(el('span','home-step-num',s.done?'✓':String(i+1)),el('span','home-step-title',s.title),el('span','home-step-state',s.detail));if(i===next)b.append(el('span','home-step-badge','Mulai di sini'));
    li.append(b);return li}))}
const HUB_ACTION={hub_cari:'mencari skill',hub_skill:'memuat skill',get_skill:'memuat skill',hub_docs:'membaca pedoman',hub_alat:'mencari alat MCP',hub_pakai:'memakai alat MCP',hub_status:'cek status hub'};
function activityTime(at){const d=new Date(at);if(isNaN(d))return '';const t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toDateString()===new Date().toDateString()?t:d.toLocaleDateString([],{day:'numeric',month:'short'})+' '+t}
function renderHomeActivity(items){const host=$('#home-activity');if(!host)return;
  if(!items.length){host.replaceChildren(el('p','muted','Belum ada aktivitas. Muncul saat AI agent memakai skill lewat hub.'));return}
  const list=el('ol','activity-list');
  for(const a of items.slice(0,8)){const li=el('li','activity-row');li.append(el('strong',null,a.client),el('span',null,HUB_ACTION[a.tool]||a.tool),el('code',null,a.detail||'—'),el('time',null,activityTime(a.at)));if(a.detail)li.title=a.detail;list.append(li)}
  host.replaceChildren(list)}
async function loadActivity(){try{renderHomeActivity((await getJson('/api/activity')).items||[])}catch{/* not signed in yet: the list stays as it was */}}
setInterval(()=>{if(csrf&&!document.hidden&&$('#page-home')&&!$('#page-home').hidden)loadActivity()},15000);
// Fase 3 · Hubungkan: an agent is on the hub when it has the santrihub MCP and the santrihub skill.
const hubOn=h=>h.mcp.names.includes('santrihub')&&(!h.skillsDir||h.skills.some(x=>x.id==='santrihub'));
function connectAgent(h,enable,btn){return busy(btn,`${enable?'Menghubungkan':'Memutus'} ${h.name}…`,async()=>{const r=await post('/api/harnesses/connect',{harness:h.id,enable});
  done(enable?`✓ ${h.name} terhubung ke hub SantriHub. ${r.hint||''}`:`✓ ${h.name} diputus dari hub SantriHub.`);await loadAgents()})}
async function connectAll(list,btn){btn.disabled=true;show($('#progress'));const ok=[],bad=[];
  for(const h of list){status(`Menghubungkan ${h.name}…`);try{await post('/api/harnesses/connect',{harness:h.id,enable:true});ok.push(h.name)}catch(e){bad.push(`${h.name}: ${e.message}`)}}
  show($('#progress'),false);btn.disabled=false;if(ok.length)done(`✓ Terhubung ke hub: ${ok.join(', ')}. Muat ulang tiap agent agar hub terbaca.`);if(bad.length)fail(new Error(bad.join(' · ')));await loadAgents()}
const AGENT_LOOK={antigravity:['AG','#3b7cf5','IDE'],'claude-code':['CC','#d9774f','CLI'],codex:['CX','#2b2b33','CLI'],'gemini-cli':['GM','#6d5df5','CLI'],cursor:['CU','#4b4b57','IDE'],vscode:['VS','#1f8ad2','IDE'],windsurf:['WS','#14a39a','IDE']};
const look=h=>AGENT_LOOK[h.id]||[h.name.slice(0,2).toUpperCase(),'#6c6c7c','IDE'];
function agentAvatar(h,cls='agent-avatar'){const [ini,color]=look(h),a=el('span',cls,ini);a.style.setProperty('--ag',color);a.setAttribute('aria-hidden','true');return a}
// How to install each agent: official commands and download pages only.
const NODE_NOTE='Butuh Node.js 18 atau lebih baru (nodejs.org).';
const AGENT_INSTALL={
  'claude-code':{steps:[['Windows (PowerShell)','irm https://claude.ai/install.ps1 | iex'],['macOS / Linux','curl -fsSL https://claude.ai/install.sh | bash'],['Atau lewat npm','npm install -g @anthropic-ai/claude-code']],run:'claude',url:'https://docs.claude.com/en/docs/claude-code/setup'},
  codex:{steps:[['Lewat npm','npm install -g @openai/codex']],note:NODE_NOTE,run:'codex',url:'https://github.com/openai/codex'},
  'gemini-cli':{steps:[['Lewat npm','npm install -g @google/gemini-cli']],note:NODE_NOTE,run:'gemini',url:'https://github.com/google-gemini/gemini-cli'},
  antigravity:{app:'https://antigravity.google/download'},cursor:{app:'https://cursor.com/download'},
  vscode:{app:'https://code.visualstudio.com/download',note:'Setelah terpasang, aktifkan GitHub Copilot di VS Code.'},windsurf:{app:'https://windsurf.com/download'}};
function openInstall(h){const g=AGENT_INSTALL[h.id]||{},body=$('#agent-install-body'),parts=[];
  $('#agent-install-avatar').replaceWith(Object.assign(agentAvatar(h),{id:'agent-install-avatar'}));$('#agent-install-title').textContent=h.name;
  if(g.app){parts.push(el('p',null,h.name+' adalah aplikasi desktop. Unduh dari situs resminya, pasang, lalu buka sekali.'));const a=el('a','home-create install-link','Buka halaman unduhan ↗');a.href=g.app;a.target='_blank';a.rel='noopener noreferrer';parts.push(a)}
  else{parts.push(el('p',null,h.name+' adalah CLI. Jalankan salah satu perintah ini di terminal:'));const ol=el('ol','install-steps');
    for(const [label,cmd] of g.steps||[]){const li=el('li'),box=el('div','copy-example'),code=el('code',null,cmd),copy=el('button','copy-btn','Salin');copy.type='button';copy.onclick=()=>copyText(cmd,copy);box.append(code,copy);li.append(el('strong',null,label),box);ol.append(li)}
    parts.push(ol);if(g.run)parts.push(el('p','muted',`Lalu buka folder proyek di terminal dan jalankan ${g.run} untuk login pertama kali.`));
    if(g.url){const a=el('a','link-btn','Panduan resmi ↗');a.href=g.url;a.target='_blank';a.rel='noopener noreferrer';parts.push(a)}}
  if(g.note)parts.push(el('p','muted',g.note));
  const re=el('button','wizard-primary','Sudah terpasang · Periksa ulang');re.type='button';re.onclick=()=>busy(re,'Memeriksa AI agent…',async()=>{await loadAgents();const now=agents.find(x=>x.id===h.id);if(now?.detected){$('#agent-install').close();done(`✓ ${h.name} terdeteksi. Klik Hubungkan agar terhubung ke hub.`)}else status(`${h.name} belum terdeteksi. Selesaikan pemasangan, buka sekali, lalu periksa ulang.`,true)});
  parts.push(el('div','install-foot'),re);body.replaceChildren(...parts);$('#agent-install').showModal()}
function renderHomeAgents(){const host=$('#home-agents'),all=$('#connect-all');if(!host)return;
  if(!agents.length){host.replaceChildren(el('p','muted','AI agent belum bisa dideteksi.'));show(all,false);return}
  const found=detectedAgents(),missing=agents.filter(h=>!found.includes(h)),linked=found.filter(hubOn).length;
  const map=el('div','agent-map-inner'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','agent-links');svg.setAttribute('aria-hidden','true');
  const hub=el('div','hub-node'),logo=el('img');logo.src='/assets/santriverse-logo.webp';logo.alt='';hub.append(logo,el('strong',null,'SantriHub'),el('small',null,found.length?`${linked}/${found.length} agent terhubung`:'Belum ada agent'));
  const row=el('div','agent-row');
  for(const h of found){const on=hubOn(h),node=el('div','agent-node'+(on?' on':'')),open=el('button','agent-node-main');open.type='button';open.onclick=()=>go('agents');
    const meta=el('span','agent-node-meta');meta.append(el('span','agent-kind',look(h)[2]),el('span',null,`${h.skills.length} skill · ${h.mcp.names.length} MCP`));
    open.append(agentAvatar(h),el('strong',null,h.name),meta);node.append(open);
    if(on){const tag=el('span','agent-hub','✓ Terhubung'),cut=el('button','agent-cut','Putuskan');cut.type='button';cut.onclick=()=>connectAgent(h,false,cut);node.append(tag,cut)}
    else{const act=el('button','agent-connect','Hubungkan');act.type='button';act.title='Pasang MCP santrihub dan skill pemandunya di '+h.name;act.onclick=()=>connectAgent(h,true,act);node.append(act)}
    row.append(node)}
  if(!found.length)row.append(el('p','agent-empty','Belum ada AI agent terdeteksi di komputer ini. Pasang salah satu di bawah, lalu klik Periksa ulang.'));
  map.append(svg,hub,row);const parts=[map];
  if(missing.length){const sug=el('div','agent-suggest');sug.append(el('h3',null,found.length?'Belum terpasang di komputer ini':'Pasang AI agent dulu'));const list=el('div','agent-suggest-list');
    for(const h of missing){const b=el('button','agent-suggest-item');b.type='button';b.append(agentAvatar(h),el('strong',null,h.name),el('span','agent-kind',look(h)[2]),el('span','agent-suggest-go','Cara pasang →'));b.onclick=()=>openInstall(h);list.append(b)}
    sug.append(list);parts.push(sug)}
  host.replaceChildren(...parts);requestAnimationFrame(drawAgentLinks);
  const todo=found.filter(h=>!hubOn(h));show(all,todo.length>1);all.onclick=()=>connectAll(todo,all)}
// Curved links from SantriHub to every detected agent: solid when connected to the hub.
function drawAgentLinks(){const map=$('#home-agents .agent-map-inner');if(!map)return;const svg=map.querySelector('.agent-links'),hub=map.querySelector('.hub-node'),box=map.getBoundingClientRect();if(!box.width)return;
  const hb=hub.getBoundingClientRect(),x0=hb.left+hb.width/2-box.left,y0=hb.bottom-box.top,ns='http://www.w3.org/2000/svg';svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
  svg.replaceChildren(...[...map.querySelectorAll('.agent-node')].map(n=>{const r=n.getBoundingClientRect(),x1=r.left+r.width/2-box.left,y1=r.top-box.top,my=(y0+y1)/2,p=document.createElementNS(ns,'path');
    p.setAttribute('d',`M${x0} ${y0} C${x0} ${my} ${x1} ${my} ${x1} ${y1}`);if(n.classList.contains('on'))p.setAttribute('class','on');return p}))}
new ResizeObserver(()=>drawAgentLinks()).observe($('#home-agents'));
$('#agents-rescan').onclick=e=>busy(e.currentTarget,'Memeriksa AI agent di komputer ini…',async()=>{await loadAgents();done(`✓ ${detectedAgents().length} AI agent terdeteksi.`)});
// Upload history: own skills and MCP, newest first.
function renderHomeUploads(){const host=$('#home-uploads');if(!host)return;
  const rows=[...librarySkills.map(s=>({kind:'Skill',name:s.id,from:libraryOrigin(s),at:s.updatedAt||s.importedAt})),...myMcp.map(m=>({kind:'MCP',name:m.name,from:m.from?'dari '+m.from:'MCP Anda',at:m.addedAt}))]
    .filter(r=>r.at).sort((p,q)=>String(q.at).localeCompare(String(p.at))).slice(0,6);
  if(!rows.length){host.replaceChildren(el('p','muted','Belum ada upload. Klik Tambah untuk mengunggah skill atau MCP.'));return}
  const list=el('ol','activity-list feed-list');for(const r of rows){const li=el('li','activity-row upload-row');li.append(el('span','upload-kind '+(r.kind==='MCP'?'mcp':'skill'),r.kind),el('strong',null,r.name),el('code',null,r.from),el('time',null,activityTime(r.at)));li.title=r.from;list.append(li)}
  host.replaceChildren(list)}
$$('dialog [data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
for(const id of ['path-choice','path-info','agent-install'])$('#'+id).addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
// Beranda tabs jump to their section; Ctrl+K searches from any page.
$$('[data-home-jump]').forEach(b=>b.onclick=()=>{$$('[data-home-jump]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  const id=b.dataset.homeJump;if(id==='page-home')window.scrollTo({top:0,behavior:'smooth'});else document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!document.querySelector('dialog[open]')){e.preventDefault();if($('#page-home').hidden)go('home');$('#home-search').focus()}});
// Light (Zyvaro) by default; the choice is kept per browser.
function setTheme(t){document.documentElement.dataset.theme=t;try{localStorage.setItem('santrihub-theme',t)}catch{}
  const b=$('#theme-toggle');b.setAttribute('aria-pressed',String(t==='dark'));b.querySelector('.sr-only').textContent=t==='dark'?'Mode terang':'Mode gelap';b.title=t==='dark'?'Mode terang':'Mode gelap'}
setTheme(document.documentElement.dataset.theme==='dark'?'dark':'light');
$('#theme-toggle').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
function renderFlow(){renderHomeSteps();renderLibrary();renderHomePaths();renderHomeAgents();renderCollection();renderAgentChecks();$('#stat-library').textContent=librarySkills.length?`+ ${librarySkills.length} skill milik Anda`:'+ skill milik Anda'}
$$('[data-collection-kind]').forEach(b=>b.onclick=()=>{collectionKind=b.dataset.collectionKind;renderCollection()});
$('#collection-search').oninput=renderCollection;
const ADD_SOURCES={
  'catalog-skills':()=>openCatalog('skills'),'catalog-mcp':()=>openCatalog('mcp'),
  github:()=>{go('library');$('#lib-open-github').click()},markdown:()=>{go('library');$('#lib-open-md').click()},
  local:()=>{openCatalog('skills');$('#catalog-local').open=true},repos:()=>go('repos'),
  'mcp-wizard':()=>$('[data-add-kind=mcp]').click()};
$$('[data-add-source]').forEach(b=>b.onclick=()=>ADD_SOURCES[b.dataset.addSource]());

// ─ Paket: Apps Script, Monorepo, Umum (from /api/catalog) and the member's own ─
const PAKET_MINE={id:'mine',short:'Milik saya',label:'Milik saya',description:'Skill dan MCP yang Anda impor sendiri: ZIP, folder, GitHub, Markdown.',author:'Anda',color:'coral',icon:'☺',order:1000};
const paketList=()=>[...(catalog.paket||[]),...myPaket.map(p=>({...p,author:'Anda',custom:true,order:500})),PAKET_MINE];
const paketById=id=>paketList().find(p=>p.id===id)||{id,short:id,label:id,description:'',color:'gray',icon:'•',author:''};
const paketPill=id=>{const p=paketById(id);const pill=el('span','pill paket paket-'+p.color,p.short);pill.title=p.label;return pill};
const libraryOrigin=s=>s.type==='github'?`dari GitHub ${s.repo||''}`.trim():s.type==='upload'?`dari upload ${s.origin||''}`.trim():'ditulis sendiri (Markdown)';
// Every skill and MCP SantriHub knows, with its paket and who made it. Koleksi and the Aktifkan table both read this.
function allItems({gateway=false}={}){const premium=id=>{const p=paketById(id);return `${p.author?'oleh '+p.author+' · ':''}premium`};
  return [...librarySkills.map(s=>({kind:'skill',id:s.id,label:s.id,desc:s.description,mine:true,paket:[...(s.paket||[]),'mine'],by:libraryOrigin(s)})),
    ...catalog.skills.map(s=>({kind:'skill',id:s.id,label:s.id,desc:s.description,paket:[s.source],by:premium(s.source),starter:paketById(s.source).starter===s.id})),
    ...(gateway?[{kind:'mcp',id:GATEWAY_ID,label:'SantriHub Gateway',desc:'Satu MCP berisi MCP pilihan Anda di panel Gateway',paket:['umum'],by:'SantriHub'}]:[]),
    ...myMcp.map(m=>({kind:'mcp',id:m.id,label:m.name,desc:m.summary+(m.envKeys.length?` · env: ${m.envKeys.join(', ')}`:''),mine:true,paket:[...(m.paket||[]),'mine'],by:m.from?'dari '+m.from:'MCP Anda',gateway:gatewayServers.includes(m.id)})),
    ...catalog.mcpServers.map(m=>({kind:'mcp',id:m.id,label:m.label||m.id,desc:m.description,paket:m.paket||['umum'],by:'Santriverse · premium',gateway:gatewayServers.includes(m.id)}))]}
const paketOrder=id=>{const i=paketList().findIndex(p=>p.id===id);return i<0?999:i};
// One paket (or any set) on/off for one agent in a single request.
async function bulkToggle(h,items,enable){if(agentsBusy||!items.length)return;agentsBusy=true;$$('#agents-matrix input,#paket-bulk button,#paket-bulk select').forEach(i=>{i.disabled=true});show($('#progress'));
  status(`${enable?'Mengaktifkan':'Menonaktifkan'} ${items.length} item di ${h.name}…`);
  try{const r=await post('/api/harnesses/bulk',{harness:h.id,enable,skills:items.filter(x=>x.kind==='skill').map(x=>x.id),mcp:items.filter(x=>x.kind==='mcp').map(x=>x.id)});
    if(r.failed.length){status(`${r.done.length} berhasil, ${r.failed.length} gagal: ${r.failed.map(f=>`${f.id} (${f.error})`).join('; ')}`,true);log(`Sebagian gagal di ${h.name}: ${r.failed.map(f=>f.id).join(', ')}`,true)}
    else done(`✓ ${r.done.length} item ${enable?'aktif':'nonaktif'} di ${h.name}. ${r.hint||''}`)}
  catch(e){fail(e)}finally{agentsBusy=false;show($('#progress'),false);await loadAgents()}}
function renderPaketCards(items){const host=$('#paket-cards');
  host.replaceChildren(...paketList().map(p=>{const own=items.filter(r=>r.paket.includes(p.id)),sk=own.filter(r=>r.kind==='skill').length,mc=own.filter(r=>r.kind==='mcp').length;
    if(!own.length&&p.id!=='mine'&&!p.custom)return null;
    const card=el('button','paket-card paket-'+p.color+(collectionPaket===p.id?' on':''));card.type='button';card.setAttribute('aria-pressed',String(collectionPaket===p.id));
    card.onclick=()=>{collectionPaket=collectionPaket===p.id?'all':p.id;renderCollection()};
    const head=el('span','paket-card-head');head.append(el('span','paket-icon',p.icon),el('strong',null,p.short));card.title=p.description||'';
    card.append(head,el('span','paket-meta',[sk&&`${sk} skill`,mc&&`${mc} MCP`].filter(Boolean).join(' · ')||'Belum ada isi'));return card}).filter(Boolean),newPaketCard())}
function renderPaketFilters(){const host=$('#collection-filters');if(collectionPaket==='all'){host.replaceChildren();return}
  const p=paketById(collectionPaket),b=el('button','filter-chip paket-'+(p.color||'gray'));b.type='button';b.setAttribute('aria-label',`Hapus saringan paket ${p.short}`);
  b.append(el('span',null,'Paket: '+p.short),el('span',null,'×'));b.onclick=()=>{collectionPaket='all';renderCollection()};host.replaceChildren(b)}
function renderPaketBulk(items){const host=$('#paket-bulk'),found=detectedAgents(),p=paketById(collectionPaket);show(host,collectionPaket!=='all'&&(items.length>0||p.custom));if(host.hidden){host.replaceChildren();return}
  const remove=()=>{const b=el('button','secondary danger','Hapus paket');b.type='button';b.onclick=()=>deletePaket(p,b);return b};
  if(!items.length){host.replaceChildren(el('span','muted',`Paket ${p.short} masih kosong. Tandai skill milik Anda lewat tombol "Paket…" di kartunya.`),remove());return}
  const label=el('span',null,`Semua ${items.length} item `),sel=document.createElement('select');sel.setAttribute('aria-label','AI agent');label.append(paketPill(p.id),document.createTextNode(' di'));
  for(const h of found){const o=el('option',null,h.name);o.value=h.id;sel.append(o)}
  if(!found.length){host.replaceChildren(el('span','muted','Belum ada AI agent terdeteksi untuk memasang paket ini.'));return}
  const target=()=>agents.find(h=>h.id===sel.value);
  const on=el('button','home-create','Aktifkan semua');on.type='button';on.onclick=()=>bulkToggle(target(),items.filter(r=>agentCell(target(),r.kind,r.id).state!=='foreign'),true);
  const off=el('button','secondary','Nonaktifkan semua');off.type='button';off.onclick=()=>{if(confirm(`Nonaktifkan semua item ${p.short} di ${target().name}?`))bulkToggle(target(),items.filter(r=>agentCell(target(),r.kind,r.id).state!=='foreign'),false)};
  host.replaceChildren(label,sel,on,off,...(p.custom?[remove()]:[]))}

// ─ Tahap 4: own paket and tagging own skills/MCP; Tahap 5: "Pilih jalur proyek" on Beranda ─
const COLOR_NAMES={teal:'Hijau toska',purple:'Ungu',coral:'Oranye',blue:'Biru',amber:'Kuning',pink:'Merah muda',green:'Hijau',gray:'Abu-abu'};
function paketChooser(r,host){host.querySelector('.paket-chooser')?.remove();const box=el('div','paket-chooser'),list=el('div','paket-chooser-list'),current=new Set(r.paket);
  box.append(el('strong',null,'Tampilkan juga di paket'));
  for(const p of paketList().filter(p=>p.id!=='mine')){const l=el('label','check-line'),b=document.createElement('input');b.type='checkbox';b.value=p.id;b.checked=current.has(p.id);l.append(b,paketPill(p.id));list.append(l)}
  box.append(list,el('small','muted','Tetap ada di "Milik saya". Paket hanya mengelompokkan; isi skill tidak berubah.'));
  const save=el('button','home-create','Simpan');save.type='button';
  save.onclick=()=>busy(save,'Menyimpan paket…',async()=>{const paket=[...list.querySelectorAll('input:checked')].map(b=>b.value);await post(r.kind==='skill'?'/api/library/paket':'/api/mcp-library/paket',{id:r.id,paket});
    done(`✓ ${r.label} ${paket.length?'masuk paket '+paket.map(id=>paketById(id).short).join(', '):'hanya di Milik saya'}.`);await loadAgents()});
  const cancel=el('button','secondary','Batal');cancel.type='button';cancel.onclick=()=>box.remove();const bar=el('div','import-actions');bar.append(cancel,save);box.append(bar);host.append(box)}
function newPaketCard(){const card=el('div','paket-card paket-new paket-gray'),open=el('button','link-btn','+ Buat paket sendiri');open.type='button';
  open.onclick=()=>{card.replaceChildren();const name=document.createElement('input');name.placeholder='Nama paket, mis. Klien Sekolah';name.maxLength=40;name.setAttribute('aria-label','Nama paket');
    const color=document.createElement('select');color.setAttribute('aria-label','Warna paket');for(const [c,n] of Object.entries(COLOR_NAMES)){const o=el('option',null,n);o.value=c;color.append(o)}color.value='blue';
    const save=el('button','home-create','Buat');save.type='button';save.onclick=()=>busy(save,'Membuat paket…',async()=>{const r=await post('/api/my-paket/save',{short:name.value,color:color.value});
      collectionPaket=r.paket.id;done(`✓ Paket ${r.paket.short} dibuat. Tandai skill milik Anda lewat tombol "Paket…" di kartunya.`);await loadAgents()});
    name.onkeydown=e=>{if(e.key==='Enter')save.click()};const cancel=el('button','secondary','Batal');cancel.type='button';cancel.onclick=()=>renderCollection();
    const bar=el('div','import-actions');bar.append(cancel,save);card.append(name,color,bar);name.focus()};
  card.append(open,el('small','paket-desc','Kelompokkan skill dan MCP milik Anda, misalnya per klien, per kelas, atau per proyek.'));return card}
function deletePaket(p,btn){if(!confirm(`Hapus paket ${p.short}? Skill dan MCP di dalamnya tetap ada di "Milik saya".`))return;
  busy(btn,`Menghapus paket ${p.short}…`,async()=>{await post('/api/my-paket/delete',{id:p.id});collectionPaket='all';done(`✓ Paket ${p.short} dihapus.`);await loadAgents()})}
// Beranda shows each paket as icon + title only; everything else is in the paket dialog.
let openPaketId=null;
const homePaket=()=>(catalog.paket||[]).filter(p=>p.id!=='umum'&&(p.fit?.length||p.starter));
function renderHomePaths(){const host=$('#home-paths');if(!host)return;const paths=homePaket();
  if(!paths.length){host.replaceChildren(el('p','muted','Memuat paket…'));return}
  const found=detectedAgents(),card=el('div','path-hero'),add=el('button','path-add');add.type='button';add.id='path-add';
  const plus=el('span','path-add-ic');plus.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  add.append(plus,el('strong',null,'Mulai jalur proyek'),el('span',null,paths.map(p=>p.short).join(' atau ')));add.onclick=openPathChoice;
  const info=el('button','path-info','!');info.type='button';info.title='Apa bedanya '+paths.map(p=>p.short).join(' dan ')+'?';info.setAttribute('aria-label',info.title);info.onclick=openPathInfo;
  const chips=el('div','path-on');for(const p of paths){const own=allItems().filter(r=>r.paket.includes(p.id)),on=found.filter(h=>own.some(r=>agentCell(h,r.kind,r.id).on));
    if(on.length){const c=el('button','path-chip paket-'+p.color);c.type='button';c.append(el('span','paket-icon',p.icon),el('span',null,p.short+' · '+on.map(h=>h.name).join(', ')));c.onclick=()=>openPaket(p.id);chips.append(c)}}
  card.append(info,add);if(chips.children.length)card.append(chips);host.replaceChildren(card);
  if(openPaketId&&$('#paket-dialog').open)renderPaketDialog(openPaketId)}
function openPathChoice(){const body=$('#path-choice-body'),list=el('div','path-options');
  for(const p of homePaket()){const o=el('button','path-option paket-'+p.color);o.type='button';o.append(el('span','paket-icon',p.icon),el('strong',null,p.short),el('span',null,p.fit?.[0]||p.description||''));
    o.onclick=()=>{$('#path-choice').close();openPaket(p.id)};list.append(o)}
  const more=el('button','link-btn','Apa bedanya? →');more.type='button';more.onclick=()=>{$('#path-choice').close();openPathInfo()};
  body.replaceChildren(list,more);$('#path-choice').showModal()}
function openPathInfo(){const cols=homePaket().map(p=>{const col=el('section','path-info-col paket-'+p.color),head=el('div','path-info-head');head.append(el('span','paket-icon',p.icon),el('strong',null,p.short));
    col.append(head,el('p',null,p.description));if(p.fit?.length){const ul=el('ul','path-fit');for(const f of p.fit)ul.append(el('li',null,f));col.append(el('span','path-fit-label','Cocok jika'),ul)}
    if(p.starter)col.append(el('small','muted','Skill awal: '+p.starter));const go=el('button','secondary','Lihat paket '+p.short);go.type='button';go.onclick=()=>{$('#path-info').close();openPaket(p.id)};col.append(go);return col});
  const grid=el('div','path-info-grid');grid.append(...cols);$('#path-info-body').replaceChildren(grid);$('#path-info').showModal()}
function renderPaketDialog(id){const p=(catalog.paket||[]).find(x=>x.id===id);if(!p)return;
  const own=allItems().filter(r=>r.paket.includes(p.id)),found=detectedAgents(),body=$('#paket-body'),dlg=$('#paket-dialog');
  dlg.className='wizard-dialog paket-dialog paket-'+p.color;$('#paket-dialog-icon').textContent=p.icon||'';$('#paket-title').textContent=p.short;
  const parts=[el('p','paket-desc',p.description)];
  if(p.fit?.length){const ul=el('ul','path-fit');for(const f of p.fit)ul.append(el('li',null,f));parts.push(el('span','path-fit-label','Cocok jika'),ul)}
  const sk=own.filter(r=>r.kind==='skill'&&!r.mine).length,extra=own.filter(r=>r.kind==='skill'&&r.mine).length,mc=own.filter(r=>r.kind==='mcp').length;
  const facts=el('dl','paket-facts');const fact=(k,v)=>{if(v)facts.append(el('dt',null,k),el('dd',null,String(v)))};
  fact('Skill bawaan',sk);fact('Tambahan Anda',extra);fact('MCP',mc);fact('Skill awal',p.starter);fact('Oleh',p.author);
  const on=found.map(h=>[h,own.filter(r=>agentCell(h,r.kind,r.id).on).length]).filter(([,n])=>n);
  fact('Terpasang di',on.map(([h,n])=>`${h.name} (${n}/${own.length})`).join(', '));parts.push(facts);
  const bar=el('div','path-actions');
  if(found.length){const sel=document.createElement('select');sel.setAttribute('aria-label','AI agent untuk paket '+p.short);for(const h of found){const o=el('option',null,h.name);o.value=h.id;sel.append(o)}
    const install=el('button','home-create','Pasang paket');install.type='button';
    install.onclick=()=>{const h=agents.find(x=>x.id===sel.value);dlg.close();bulkToggle(h,own.filter(r=>agentCell(h,r.kind,r.id).state!=='foreign'),true)};bar.append(sel,install)}
  const view=el('button','secondary','Lihat isi');view.type='button';view.onclick=()=>{dlg.close();collectionPaket=p.id;go('collection');renderCollection()};bar.append(view);parts.push(bar);
  body.replaceChildren(...parts)}
function openPaket(id){openPaketId=id;renderPaketDialog(id);$('#paket-dialog').showModal()}
$('#paket-close').onclick=()=>$('#paket-dialog').close();
$('#paket-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$('#paket-dialog').addEventListener('close',()=>{openPaketId=null});

// ─ Tes koneksi MCP: /api/mcp/test starts the server like an agent would and lists its tools ─
function mcpTestView(r){const box=el('div','mcp-test '+(r.ok?'ok':'bad'));
  box.append(el('strong',null,r.ok?`✓ Terhubung${r.server?.name?` · ${r.server.name}${r.server.version?' '+r.server.version:''}`:''} · ${r.toolCount} tool · ${(r.ms/1000).toFixed(1)} dtk`:'✗ Gagal terhubung'));
  if(!r.ok)box.append(el('p',null,r.error||''));if(r.hint)box.append(el('p','note',r.hint));
  if(r.tools?.length){const d=el('details');d.append(el('summary',null,'Daftar tool'),el('pre',null,r.tools.map(t=>`${t.name}${t.description?' — '+t.description:''}`).join('\n')));box.append(d)}
  if(r.log){const d=el('details');d.append(el('summary',null,'Log server'),el('pre',null,r.log));box.append(d)}
  return box}
function testMcp(id,host,btn){host.querySelector('.mcp-test')?.remove();const wait=el('div','mcp-test','Menjalankan server dan meminta daftar tool… (pertama kali bisa sampai 1 menit)');host.append(wait);
  busy(btn,'Tes koneksi MCP…',async()=>{try{const r=await post('/api/mcp/test',{id});wait.replaceWith(mcpTestView(r));r.ok?done(`✓ ${r.name}: ${r.toolCount} tool siap.`):status(`${r.name}: ${r.error}`,true)}catch(e){wait.remove();throw e}})}

// ─ Cek per AI agent (Cek & Tes): reload steps per agent, MCP connection tests, prompts to paste in chat ─
const RELOAD={
  'antigravity':['Klik <b>Restart</b>, atau tutup lalu buka lagi Antigravity.','Buka chat Agent baru.'],
  'claude-code':['Keluar dari sesi Claude Code (<code>/exit</code>), lalu jalankan <code>claude</code> lagi.','Ketik <code>/mcp</code> untuk melihat MCP yang tersambung.'],
  'codex':['Tutup Codex, lalu jalankan <code>codex</code> lagi (atau buka ulang aplikasi Codex).','Ketik <code>/mcp</code> untuk melihat MCP dan tool-nya.'],
  'gemini-cli':['Keluar (<code>/quit</code>), lalu jalankan <code>gemini</code> lagi.','Ketik <code>/mcp</code> untuk melihat status MCP.'],
  'cursor':['<kbd>Ctrl+Shift+P</kbd> → <b>Developer: Reload Window</b>.','Buka <b>Settings → MCP</b>: titik hijau berarti server jalan.'],
  'vscode':['<kbd>Ctrl+Shift+P</kbd> → <b>Developer: Reload Window</b>.','<kbd>Ctrl+Shift+P</kbd> → <b>MCP: List Servers</b> untuk melihat statusnya. Pakai Copilot Chat mode <b>Agent</b>.'],
  'windsurf':['Buka panel Cascade → ikon <b>MCP</b> → <b>Refresh</b>, atau reload window.','Pastikan server tampil hijau di daftar MCP Cascade.']};
const skillPrompt=id=>`Gunakan skill "${id}". Jelaskan singkat kapan skill ini dipakai, lalu sebutkan langkah pertamanya untuk project ini.`;
const mcpPrompt=name=>`Sebutkan semua tool dari MCP "${name}" yang tersedia untukmu, lalu panggil satu tool yang hanya membaca data untuk membuktikan koneksinya.`;
// The collection id behind an MCP name in an agent config, when SantriHub knows it.
function mcpIdFor(name){if(name==='santrihub')return GATEWAY_ID;
  return catalog.mcpServers.some(m=>m.id===name)||myMcp.some(m=>m.id===name)?name:null}
async function copyText(text,btn){try{await navigator.clipboard.writeText(text);const old=btn.innerHTML;btn.classList.add('copied');btn.textContent=btn.classList.contains('ck-icon')?'✓':'Tersalin ✓';setTimeout(()=>{btn.innerHTML=old;btn.classList.remove('copied')},1400)}catch{const host=btn.closest('li')||btn.parentElement;host.querySelector('.copy-manual')?.remove();const pre=el('pre','copy-manual',text);host.append(pre);getSelection().selectAllChildren(pre);status('Clipboard diblokir: teks sudah diseleksi, tekan Ctrl+C.',true)}}
let checkAgent='',checkAll=false,checkKind='all',checkQuery='';const CHECK_LIMIT=10;
const CK_COPY='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>';
// One agent at a time: reload strip on top, then every skill / MCP with a copy-prompt (and MCP test) button.
function renderAgentChecks(){const host=$('#agent-checks');if(!host)return;const found=detectedAgents();
  if(!agents.length){host.replaceChildren(el('p','muted','AI agent belum dimuat.'));return}
  if(!found.length){host.replaceChildren(el('p','muted','Belum ada AI agent terdeteksi di komputer ini.'));return}
  if(!found.some(h=>h.id===checkAgent))checkAgent=found[0].id;const h=found.find(x=>x.id===checkAgent),known=Object.fromEntries(allItems({gateway:true}).map(r=>[r.kind+':'+r.id,r]));
  const tabs=el('div','ck-agents');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','AI agent');
  for(const x of found){const t=el('button','ck-agent');t.type='button';t.setAttribute('role','tab');t.setAttribute('aria-selected',String(x.id===checkAgent));
    t.append(agentAvatar(x,'ck-av'),el('span',null,x.name),el('span','ck-count',String(x.skills.length+x.mcp.names.length)));if(orbitReload[x.id]){const d=el('i','ck-dot');d.title='Perlu dimuat ulang';t.append(d)}
    t.onclick=()=>{checkAgent=x.id;checkAll=false;checkKind='all';checkQuery='';renderAgentChecks()};tabs.append(t)}
  const card=el('article','ck-card');card.setAttribute('role','tabpanel');card.setAttribute('aria-label',h.name);
  const mine=h.skills.filter(s=>s.managed).map(s=>s.id),others=h.skills.filter(s=>!s.managed).map(s=>s.id),stale=!!orbitReload[h.id];
  // Header: who, how many, and whether it still has to reload.
  const head=el('header','ck-head'),title=el('div','ck-title');title.append(el('strong',null,h.name),el('small',null,`${h.skills.length} skill · ${h.mcp.names.length} MCP`));
  head.append(agentAvatar(h,'ck-av lg'),title,el('span','ck-state'+(stale?' warn':' ok'),stale?'Perlu dimuat ulang':'Siap diuji'));card.append(head);
  if(h.mcp.valid===false)card.append(el('p','ck-warn','Config MCP tidak bisa dibaca (JSON/TOML rusak): '+h.mcp.file));
  // 1 · Reload.
  const reload=el('section','ck-step ck-reload'+(stale?' warn':'')),steps=el('ol','ck-steps');for(const s of RELOAD[h.id]||[`Reload ${h.name}.`]){const li=el('li');li.innerHTML=s;steps.append(li)}
  const rTxt=el('div','ck-step-main');rTxt.append(el('b',null,'Muat ulang'),steps);
  const rActs=el('div','ck-step-acts');
  if(h.id==='antigravity'){const r=el('button','ck-btn primary','Restart');r.type='button';r.onclick=async()=>{await reloadAgents([h],r);renderAgentChecks()};
    const p=el('button','ck-btn','Uji bukti');p.type='button';p.title='Cek & Tes Antigravity: bukti skill terbaca lewat callback MCP';p.onclick=()=>$('#check-test').click();rActs.append(r,p)}
  else if(stale){const r=el('button','ck-btn','Sudah ✓');r.type='button';r.title='Tandai '+h.name+' sudah dimuat ulang';r.onclick=()=>{markReload(h.id,false);renderOrbit();renderAgentChecks()};rActs.append(r)}
  reload.append(el('span','ck-num','1'),rTxt,rActs);
  // 2 · Test in chat.
  const rows=[...h.mcp.names.map(name=>({kind:'mcp',name,id:mcpIdFor(name),own:!mcpIdFor(name)})),...[...mine,...others].map(id=>({kind:'skill',name:id,id,own:!mine.includes(id)}))];
  const test=el('section','ck-step ck-test'),bar=el('div','ck-bar'),filt=el('div','ck-filter');filt.setAttribute('role','group');filt.setAttribute('aria-label','Jenis');
  const list=el('ul','ck-items'),more=el('button','ck-more');more.type='button';
  for(const [k,label] of [['all','Semua'],['skill','Skill'],['mcp','MCP']]){const n=k==='all'?rows.length:rows.filter(r=>r.kind===k).length;if(k!=='all'&&!n)continue;
    const b=el('button',null,label);b.type='button';b.append(el('small',null,String(n)));b.setAttribute('aria-pressed',String(checkKind===k));b.onclick=()=>{checkKind=k;checkAll=false;for(const x of filt.children)x.setAttribute('aria-pressed',String(x===b));fill()};filt.append(b)}
  const search=el('label','ck-search');search.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
  const q=el('input');q.type='search';q.placeholder='Cari…';q.value=checkQuery;q.setAttribute('aria-label','Cari skill atau MCP');q.oninput=()=>{checkQuery=q.value;checkAll=false;fill()};search.append(q);
  const twoHead=el('div','ck-step-main');twoHead.append(el('b',null,'Uji di chat'),el('small',null,'Salin prompt, tempel di chat '+h.name+'.'));
  bar.append(el('span','ck-num','2'),twoHead);if(rows.length)bar.append(filt,search);test.append(bar,list,more);
  const item=r=>{const li=el('li','ck-item'),row=known[r.kind+':'+(r.kind==='mcp'?r.id||r.name:r.id)]||{kind:r.kind,id:r.name,label:r.name,paket:[]};
    const name=el(known[r.kind+':'+(r.id||r.name)]?'button':'span','ck-name',r.name);name.title=r.name;if(name.tagName==='BUTTON'){name.type='button';name.onclick=()=>openItem(row)}
    const acts=el('span','ck-acts');li.append(itemIcon(row),name);if(r.own){li.classList.add('own');name.title=r.name+' · bukan dari SantriHub (tidak disentuh)'}
    if(r.kind==='mcp'&&r.id){const t=el('button','ck-btn','Tes');t.type='button';t.title='Tes koneksi MCP';t.onclick=()=>testMcp(r.id,li,t);acts.append(t)}
    const c=el('button','ck-icon');c.type='button';c.innerHTML=CK_COPY;c.title='Salin prompt uji';c.setAttribute('aria-label','Salin prompt uji '+r.name);
    c.onclick=()=>copyText(r.kind==='mcp'?mcpPrompt(r.name):skillPrompt(r.name),c);acts.append(c);li.append(acts);return li};
  function fill(){const term=checkQuery.trim().toLowerCase(),shown=rows.filter(r=>(checkKind==='all'||r.kind===checkKind)&&(!term||r.name.toLowerCase().includes(term)));
    if(!rows.length){const empty=el('li','ck-empty');const a=el('button','ck-btn primary','Aktifkan →');a.type='button';a.onclick=()=>go('agents');empty.append(el('span',null,'Belum ada skill atau MCP di agent ini.'),a);list.replaceChildren(empty)}
    else if(!shown.length)list.replaceChildren(el('li','ck-empty','Tidak ada yang cocok.'));
    else list.replaceChildren(...(checkAll?shown:shown.slice(0,CHECK_LIMIT)).map(item));
    more.hidden=shown.length<=CHECK_LIMIT;more.textContent=checkAll?'Lebih sedikit':`Tampilkan semua · ${shown.length}`;more.onclick=()=>{checkAll=!checkAll;fill()}}
  fill();card.append(reload,test);host.replaceChildren(tabs,card)}

// ─ Tur singkat: a spotlight walks the 4-step flow; the card sits next to what it explains. Shown once per browser, replay from Beranda or the profile menu ─
const TOUR_KEY='santrihub-tour-v1';
// target: selectors tried in order; the first one that is on screen wins, and all its visible matches are highlighted together.
const TOUR=[
  {page:'home',target:['.home-hero'],title:'Selamat datang di SantriHub',text:'Satu tempat untuk skill dan MCP semua AI agent Anda: Claude Code, Codex, Antigravity, Gemini CLI, Cursor, VS Code, dan Windsurf.',points:['Tur ini menunjukkan tiap bagian satu per satu. Kurang dari 1 menit.']},
  {page:'home',target:['.nav-flow','.sidebar-rail .rail-btn','#nav-toggle'],title:'4 langkah, dari atas ke bawah',text:'Semua pekerjaan mengikuti alur ini: Tambah → Koleksi → Aktifkan → Cek & Tes.',points:['Klik langkah kapan saja untuk pindah.']},
  {page:'home',target:['#home-paths'],title:'Pilih jalur proyek',text:'Paket Apps Script atau Monorepo berisi skill yang sudah disusun Santriverse.',points:['Klik + untuk memilih Apps Script atau Monorepo, lalu pasang ke AI agent. Tombol ! menjelaskan bedanya.']},
  {page:'add',target:['#drop-zone','.smart-import'],title:'1 · Tambah: impor pintar',text:'Tarik banyak ZIP, folder, atau file .md sekaligus ke kotak ini.',points:['SKILL.md dibuat otomatis bila belum ada.','Klik "Pindai & pratinjau" untuk melihat isinya sebelum disimpan.']},
  {page:'add',target:['#mcp-paste-box'],title:'Tempel MCP',text:'Buka bagian ini untuk menempel config MCP (JSON), perintah npx/uvx, atau URL MCP.',points:['API key hanya disimpan di komputer ini.']},
  {page:'collection',target:['#paket-cards'],title:'2 · Koleksi per paket',text:'Semua yang Anda tambahkan berkumpul di sini, bersama katalog premium Santriverse.',points:['Klik satu paket untuk melihat isinya dan menyalakannya sekaligus di satu agent.']},
  {page:'collection',target:['#collection-list'],title:'Kartu skill & MCP',text:'Tiap kartu menunjukkan di agent mana item itu sudah aktif.',points:['MCP punya tombol "Tes koneksi" untuk memastikan ia benar-benar jalan.']},
  {page:'agents',target:['#orbit-board','#wire-board','.agents-scroll'],title:'3 · Aktifkan per AI agent',text:'Centang tabel ini untuk menyalakan skill atau MCP di tiap agent.',points:['SantriHub hanya menyentuh file buatannya sendiri; config Anda yang lain aman.']},
  {page:'status',target:['.agent-checks-wrap'],title:'4 · Cek & Tes',text:'Pastikan semuanya benar-benar terbaca oleh AI agent.',points:['Tes MCP, muat ulang agent, lalu salin prompt uji ke chat.']}];
let tourIndex=0,tourEl=null,tourWatch=null,tourFrame=0;const tour=$('#tour'),tourSpot=$('#tour-spot');
function tourStorage(fn){try{return fn(localStorage)}catch{return null}}
// Off-canvas (closed mobile sidebar, collapsed rail) does not count; scrolled out of view does, since the tour scrolls to it.
function onScreen(e){const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&getComputedStyle(e).visibility!=='hidden'}
function tourTargets(s){for(const sel of s.target){const found=$$(sel).filter(onScreen);if(found.length)return found}return []}
function tourRect(els){if(!els.length)return null;const rs=els.map(e=>e.getBoundingClientRect()),pad=8;
  return {left:Math.min(...rs.map(r=>r.left))-pad,top:Math.min(...rs.map(r=>r.top))-pad,right:Math.max(...rs.map(r=>r.right))+pad,bottom:Math.max(...rs.map(r=>r.bottom))+pad}}
function tourScroll(els){const e=els[0];if(!e)return;if(e.closest('#sidebar,.sidebar-rail,.mobile-menu')){e.scrollIntoView({block:'nearest'});return}
  const head=$('main > header')?.getBoundingClientRect().bottom||0;window.scrollTo({top:Math.max(0,scrollY+e.getBoundingClientRect().top-head-24),behavior:'auto'})}
// Card goes beside the target (right, left, below, above); a target taller than the room left is cropped so the card fits below it.
function placeTour(){tourFrame=0;if(!tour.open)return;const vw=innerWidth,vh=innerHeight,m=12,gap=16,w=tour.offsetWidth,h=tour.offsetHeight;
  const clamp=(v,lo,hi)=>Math.min(Math.max(v,lo),Math.max(lo,hi)),els=tourTargets(TOUR[tourIndex]);let r=tourRect(els);
  // Page content scrolls under the sticky header, so only that part is cropped at the header's edge.
  if(r){const head=els[0].closest('main')&&!els[0].closest('main > header')?$('main > header').getBoundingClientRect().bottom:0;
    r={left:Math.max(r.left,4),right:Math.min(r.right,vw-4),top:Math.max(r.top,head+4),bottom:Math.min(r.bottom,vh-4)};if(r.bottom-r.top<12||r.right-r.left<12)r=null}
  let side='none',x=(vw-w)/2,y=(vh-h)/2;
  if(r){const fits={right:r.right+gap+w<=vw-m,left:r.left-gap-w>=m,bottom:r.bottom+gap+h<=vh-m,top:r.top-gap-h>=m};
    if(!fits.right&&!fits.left&&!fits.bottom&&!fits.top&&r.top+120+gap+h<=vh-m){r.bottom=vh-m-h-gap;fits.bottom=true}
    side=['right','left','bottom','top'].find(k=>fits[k])||'inside';
    if(side==='right'||side==='left'){x=side==='right'?r.right+gap:r.left-gap-w;y=clamp(r.top,m,vh-m-h)}
    else if(side==='bottom'||side==='top'){x=clamp(r.right-r.left>w?r.left:(r.left+r.right-w)/2,m,vw-m-w);y=side==='bottom'?r.bottom+gap:r.top-gap-h}
    else{x=vw-m-w;y=vh-m-h}
    const arrow=side==='right'||side==='left'?clamp((Math.max(r.top,y)+Math.min(r.bottom,y+h))/2-y,22,h-22):clamp((Math.max(r.left,x)+Math.min(r.right,x+w))/2-x,22,w-22);
    tour.style.setProperty('--arrow',arrow+'px');Object.assign(tourSpot.style,{left:r.left+'px',top:r.top+'px',width:r.right-r.left+'px',height:r.bottom-r.top+'px'})}
  else Object.assign(tourSpot.style,{left:vw/2+'px',top:vh/2+'px',width:'0px',height:'0px'});
  tourSpot.classList.toggle('empty',!r);tour.dataset.side=side;tour.style.left=Math.round(x)+'px';tour.style.top=Math.round(y)+'px'}
const queueTour=()=>{if(!tourFrame)tourFrame=requestAnimationFrame(placeTour)};
function showTourStep(){const s=TOUR[tourIndex];$('#tour-step').textContent=`${tourIndex+1} / ${TOUR.length}`;$('#tour-title').textContent=s.title;$('#tour-text').textContent=s.text;
  $('#tour-points').replaceChildren(...(s.points||[]).map(p=>el('li',null,p)));$('#tour-dots').replaceChildren(...TOUR.map((_,i)=>el('i',i===tourIndex?'on':'')));
  show($('#tour-back'),tourIndex>0);$('#tour-next').textContent=tourIndex===TOUR.length-1?'Mulai dari langkah 1 →':'Lanjut';
  if(location.hash.slice(1)!==s.page||$('#page-'+s.page).hidden)go(s.page);
  const els=tourTargets(s);tourScroll(els);tourWatch?.disconnect();tourWatch=new ResizeObserver(queueTour);tourWatch.observe(tour);for(const e of els)tourWatch.observe(e);
  // Pages fill in after their data loads; re-place once that settles.
  placeTour();for(const ms of [150,500,1200])setTimeout(()=>{if(TOUR[tourIndex]===s)placeTour()},ms)}
function openTour(){tourIndex=0;show(tourSpot);if(!tour.open)tour.showModal();addEventListener('resize',queueTour);addEventListener('scroll',queueTour,true);addEventListener('transitionend',queueTour,true);showTourStep();$('#tour-next').focus()}
function closeTour(){tourStorage(s=>s.setItem(TOUR_KEY,'done'));tourWatch?.disconnect();tourWatch=null;removeEventListener('resize',queueTour);removeEventListener('scroll',queueTour,true);removeEventListener('transitionend',queueTour,true);show(tourSpot,false);if(tour.open)tour.close()}
const tourSeen=()=>tourStorage(s=>s.getItem(TOUR_KEY))==='done';
function maybeTour(){if(!tourSeen()&&!$('#locked').open)setTimeout(()=>{if(!tourSeen()&&!document.querySelector('dialog[open]'))openTour()},600)}
const tourNext=()=>{if(tourIndex<TOUR.length-1){tourIndex++;showTourStep()}else{closeTour();go('add');scrollTo(0,0)}},tourBack=()=>{if(tourIndex>0){tourIndex--;showTourStep()}};
$('#tour-next').onclick=tourNext;$('#tour-back').onclick=tourBack;
tour.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();tourNext()}else if(e.key==='ArrowLeft'){e.preventDefault();tourBack()}});
$('#tour-skip').onclick=closeTour;tour.addEventListener('cancel',e=>{e.preventDefault();closeTour()});
$('#home-tour').onclick=openTour;$('#tour-replay').onclick=()=>{closeProfile();openTour()};

// ─ Impor pintar: drop ZIP / folder / files, paste MCP, preview everything, save and activate ─
let importQueue=[],importPreview=null;
const JUNK=/(^|\/)(node_modules|\.git|__MACOSX)\/|(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
const fmtSize=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
function queueFiles(list){for(const {path,file} of list){const p=path.replace(/\\/g,'/').replace(/^\/+/,'');if(!p||JUNK.test(p)||importQueue.some(q=>q.path===p))continue;importQueue.push({path:p,file})}renderQueue()}
function renderQueue(){const host=$('#import-queue');show(host,importQueue.length>0);if(!importQueue.length){host.replaceChildren();return}
  const total=importQueue.reduce((n,q)=>n+q.file.size,0),zips=importQueue.filter(q=>/\.zip$/i.test(q.path)).length,tops=new Set(importQueue.filter(q=>q.path.includes('/')).map(q=>q.path.split('/')[0]));
  const head=el('div','queue-head');head.append(el('strong',null,`${importQueue.length} file siap dipindai`),el('small','muted',[zips&&`${zips} ZIP`,tops.size&&`${tops.size} folder`,fmtSize(total)].filter(Boolean).join(' · ')));
  const clear=el('button','secondary','Kosongkan');clear.type='button';clear.onclick=()=>{importQueue=[];renderQueue()};head.append(clear);
  const chips=el('div','queue-chips');const groups=new Map();for(const q of importQueue){const k=q.path.includes('/')?q.path.split('/')[0]+'/':q.path;groups.set(k,(groups.get(k)||0)+1)}
  for(const [k,n] of groups){const c=el('span','queue-chip',n>1?`${k} (${n})`:k);const x=el('button',null,'×');x.type='button';x.setAttribute('aria-label','Hapus '+k);x.onclick=()=>{importQueue=importQueue.filter(q=>(q.path.includes('/')?q.path.split('/')[0]+'/':q.path)!==k);renderQueue()};c.append(x);chips.append(c)}
  host.replaceChildren(head,chips)}
// Folders dropped from Explorer/Finder arrive as entries; read them recursively.
async function walkEntry(entry,prefix=''){if(entry.isFile)return [{path:prefix+entry.name,file:await new Promise((ok,no)=>entry.file(ok,no))}];
  if(!entry.isDirectory)return [];const reader=entry.createReader(),out=[];let batch;
  do{batch=await new Promise((ok,no)=>reader.readEntries(ok,no));for(const e of batch)out.push(...await walkEntry(e,prefix+entry.name+'/'))}while(batch.length);return out}
const dropZone=$('#drop-zone');
['dragenter','dragover'].forEach(t=>dropZone.addEventListener(t,e=>{e.preventDefault();dropZone.classList.add('over')}));
['dragleave','drop'].forEach(t=>dropZone.addEventListener(t,()=>dropZone.classList.remove('over')));
dropZone.addEventListener('drop',async e=>{e.preventDefault();const entries=[...e.dataTransfer.items||[]].map(i=>i.webkitGetAsEntry&&i.webkitGetAsEntry()).filter(Boolean);
  try{if(entries.length){const all=[];for(const en of entries)all.push(...await walkEntry(en));queueFiles(all)}else queueFiles([...e.dataTransfer.files].map(f=>({path:f.name,file:f})))}catch(err){fail(err)}});
dropZone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#import-files').click()}});
$('#import-files').onchange=e=>{queueFiles([...e.target.files].map(f=>({path:f.name,file:f})));e.target.value=''};
$('#import-folder').onchange=e=>{queueFiles([...e.target.files].map(f=>({path:f.webkitRelativePath||f.name,file:f})));e.target.value=''};
const toBase64=file=>new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(String(r.result).replace(/^data:[^,]*,/,''));r.onerror=()=>no(new Error(`${file.name} tidak bisa dibaca.`));r.readAsDataURL(file)});
$('#import-scan').onclick=()=>busy($('#import-scan'),'Memindai file…',async()=>{
  const mcpText=$('#import-mcp-text').value;if(!importQueue.length&&!mcpText.trim())throw new Error('Tarik file/ZIP/folder dulu, atau tempel MCP.');
  const total=importQueue.reduce((n,q)=>n+q.file.size,0);if(total>40*1048576)throw new Error(`Total ${fmtSize(total)} melebihi 40 MB. Impor sebagian dulu.`);
  // Big non-ZIP files are never skills; leave them out instead of uploading them.
  const send=importQueue.filter(q=>/\.zip$/i.test(q.path)||q.file.size<=512*1024),left=importQueue.filter(q=>!send.includes(q));
  const items=[];for(const q of send)items.push({path:q.path,data:await toBase64(q.file)});
  importPreview=await post('/api/library/upload/preview',{items,mcpText,includeScripts:$('#import-scripts').checked});
  if(left.length)importPreview.problems.push({source:`${left.length} file besar`,error:'Dilewati (> 512 KB, bukan ZIP): '+left.map(q=>q.path).slice(0,5).join(', ')});
  renderImport();const n=importPreview.skills.length,m=importPreview.mcp.length;done(n||m?`✓ Ditemukan ${n} skill dan ${m} MCP. Periksa lalu simpan.`:'Tidak ada skill atau MCP yang dikenali.')});
function renderImport(){const host=$('#import-results'),p=importPreview;show(host,Boolean(p));if(!p){host.replaceChildren();return}
  const parts=[];
  if(p.problems.length){const box=el('div','import-problems');box.append(el('strong',null,'Perlu perhatian'));const ul=el('ul');for(const x of p.problems)ul.append(el('li',null,`${x.source}: ${x.error}`));box.append(ul);parts.push(box)}
  const pill=(t,c='')=>el('span','pill '+c,t);
  if(p.skills.length){parts.push(el('h3',null,`Skill (${p.skills.length})`));
    for(const s of p.skills){const row=el('article','import-row');row.dataset.key=s.key;row.dataset.kind='skill';
      const top=el('label','import-row-head'),box=document.createElement('input');box.type='checkbox';box.className='import-pick';box.checked=s.exists!=='catalog';top.append(box,el('strong',null,s.id),pill(s.source));
      if(s.generated)top.append(pill('SKILL.md DIBUAT OTOMATIS','premium'));if(s.repaired)top.append(pill('FRONTMATTER DIPERBAIKI'));
      if(s.exists)top.append(pill(s.exists==='catalog'?'ID DIPAKAI KATALOG':'SUDAH ADA DI KOLEKSI','warn'));row.append(top);
      const grid=el('div','import-fields');const id=el('label',null,'ID skill'),idIn=document.createElement('input');idIn.className='import-id';idIn.value=s.id;id.append(idIn);
      const desc=el('label',null,'Deskripsi (kapan agent memakainya)'),dIn=document.createElement('input');dIn.className='import-desc';dIn.value=s.description;desc.append(dIn);grid.append(id,desc);row.append(grid);
      row.append(el('small','muted',`${s.files.length} file pendukung${s.skipped.length?` · ${s.skipped.length} dilewati`:''}`));
      if(s.skipped.length){const d=el('details');d.append(el('summary',null,'File yang dilewati'),el('pre',null,s.skipped.join('\n')));row.append(d)}
      const md=el('details');md.append(el('summary',null,'Lihat SKILL.md'),el('pre',null,s.skillMd));row.append(md);parts.push(row)}}
  if(p.mcp.length){parts.push(el('h3',null,`MCP (${p.mcp.length})`));
    for(const m of p.mcp){const row=el('article','import-row');row.dataset.key=m.key;row.dataset.kind='mcp';
      const top=el('label','import-row-head'),box=document.createElement('input');box.type='checkbox';box.className='import-pick';box.checked=m.exists!=='catalog';top.append(box,el('strong',null,m.name),pill(m.kind==='http'?'URL':'COMMAND'));
      if(m.envKeys.length)top.append(pill('ENV: '+m.envKeys.join(', ')));if(m.exists)top.append(pill(m.exists==='catalog'?'NAMA DIPAKAI KATALOG':'SUDAH ADA','warn'));row.append(top);
      const grid=el('div','import-fields');const n=el('label',null,'Nama MCP di config agent'),nIn=document.createElement('input');nIn.className='import-id';nIn.value=m.name;n.append(nIn);grid.append(n,el('code','import-summary',m.summary));row.append(grid);
      row.append(el('small','muted','Dari '+m.from));parts.push(row)}}
  if(p.skills.length||p.mcp.length){const act=el('div','import-activate');act.append(el('strong',null,'Langsung aktifkan di (opsional)'));
    const found=detectedAgents();const list=el('div','import-agents');
    for(const h of found){const l=el('label','check-line'),b=document.createElement('input');b.type='checkbox';b.value=h.id;b.className='import-agent';l.append(b,document.createTextNode(' '+h.name));list.append(l)}
    if(!found.length)list.append(el('span','muted','Belum ada AI agent terdeteksi. Simpan dulu, aktifkan nanti di langkah 3.'));act.append(list);
    {const l=el('label','import-paket-line');l.append(document.createTextNode('Masukkan juga ke paket '));const sel=document.createElement('select');sel.className='import-paket';
      sel.append(Object.assign(el('option',null,'Hanya Milik saya'),{value:''}));for(const x of paketList().filter(x=>x.id!=='mine'))sel.append(Object.assign(el('option',null,x.short),{value:x.id}));l.append(sel);act.append(l)}
    if(p.skills.some(s=>s.exists==='library')||p.mcp.some(m=>m.exists==='mine')){const l=el('label','check-line'),b=document.createElement('input');b.type='checkbox';b.id='import-overwrite';l.append(b,document.createTextNode(' Timpa yang sudah ada di koleksi'));act.append(l)}
    const save=el('button','home-create','Simpan ke Koleksi');save.type='button';save.onclick=()=>saveImport(save);const cancel=el('button','secondary','Batal');cancel.type='button';cancel.onclick=()=>{importPreview=null;renderImport()};
    const bar=el('div','import-actions');bar.append(cancel,save);act.append(bar);parts.push(act)}
  host.replaceChildren(...parts)}
function saveImport(btn){busy(btn,'Menyimpan ke koleksi…',async()=>{const rows=$$('#import-results .import-row').filter(r=>r.querySelector('.import-pick').checked);
  const picks=rows.filter(r=>r.dataset.kind==='skill').map(r=>({key:r.dataset.key,id:r.querySelector('.import-id').value.trim(),description:r.querySelector('.import-desc').value.trim()}));
  const mcpPicks=rows.filter(r=>r.dataset.kind==='mcp').map(r=>({key:r.dataset.key,name:r.querySelector('.import-id').value.trim()}));
  if(!picks.length&&!mcpPicks.length)throw new Error('Centang minimal satu skill atau MCP.');
  const r=await post('/api/library/upload/save',{previewId:importPreview.previewId,picks,mcpPicks,overwrite:document.getElementById('import-overwrite')?.checked===true,paket:document.querySelector('.import-paket')?.value?[document.querySelector('.import-paket').value]:[]});
  // Optional: turn everything on in the chosen agents right away.
  const targets=$$('.import-agent').filter(b=>b.checked).map(b=>agents.find(h=>h.id===b.value)).filter(Boolean),failed=[];let on=0;
  for(const h of targets){for(const id of r.saved){status(`Mengaktifkan ${id} di ${h.name}…`);try{await post('/api/harnesses/skill',{harness:h.id,id,enable:true});on++}catch(e){failed.push(`${id} @ ${h.name}: ${e.message}`)}}
    for(const id of r.savedMcp){status(`Mengaktifkan MCP ${id} di ${h.name}…`);try{await post('/api/harnesses/mcp',{harness:h.id,id,enable:true});on++}catch(e){failed.push(`${id} @ ${h.name}: ${e.message}`)}}}
  importPreview=null;importQueue=[];$('#import-mcp-text').value='';renderQueue();await loadAgents();
  const host=$('#import-results');show(host);const ok=el('div','import-done');
  ok.append(el('strong',null,`✓ ${r.saved.length} skill dan ${r.savedMcp.length} MCP masuk Koleksi${on?`, ${on} aktivasi berhasil`:''}.`));
  if(failed.length){const ul=el('ul','import-problems');for(const f of failed)ul.append(el('li',null,f));ok.append(ul)}
  if(targets.length)ok.append(el('p','note',`Reload ${targets.map(h=>h.name).join(', ')} agar skill/MCP baru terbaca, lalu coba di chat (langkah 4).`));
  const bar=el('div','import-actions');const a=el('button','secondary','Lihat di Koleksi');a.type='button';a.onclick=()=>go('collection');
  const b=el('button','home-create',targets.length?'Lanjut: 4 · Cek & Tes →':'Lanjut: 3 · Aktifkan →');b.type='button';b.onclick=()=>go(targets.length?'status':'agents');bar.append(a,b);ok.append(bar);host.replaceChildren(ok);
  done(`✓ Impor selesai: ${r.saved.length} skill, ${r.savedMcp.length} MCP.`)})}

// ─ Update: /api/update compares this build with the latest GitHub release ─
let updateInfo=null;
const updateDialog=$('#update-dialog');
const selfUpdate=()=>document.documentElement.dataset.santrihubUpdate==='self';
async function checkUpdate(){try{updateInfo=await getJson('/api/update');const btn=$('#update-btn');
  if(updateInfo.available){btn.textContent='⬆ Update v'+updateInfo.latest;btn.title='SantriHub v'+updateInfo.latest+' tersedia (terpasang v'+updateInfo.current+')';btn.hidden=false}refreshBell()}catch{/* offline: no button */}}
function openUpdate(){if(!updateInfo)return;const self=selfUpdate();
  $('#update-current').textContent='v'+updateInfo.current;$('#update-latest').textContent='v'+updateInfo.latest;
  $('#update-notes').href=updateInfo.releaseUrl;$('#update-command').textContent=updateInfo.command;$('#update-feedback').textContent='';
  show($('#update-self'),self);show($('#update-manual'),!self);show($('#update-now'),self);$('#update-now').disabled=false;$('#update-now').textContent='Update sekarang';show($('#update-progress'),false);
  updateDialog.showModal()}
$('#update-btn').onclick=openUpdate;
$('#update-close').onclick=()=>updateDialog.close();
$('#update-copy').onclick=async()=>{try{await navigator.clipboard.writeText(updateInfo.command);done('✓ Perintah update disalin.')}catch{fail(new Error('Clipboard tidak tersedia. Salin perintah secara manual.'))}};
// Progress: the POST below runs the whole download; /__santrihub/update/status reports where it is.
// Steps: 0 Unduh (check, sums, download) · 1 Cek SHA-256 · 2 Pasang · 3 Buka ulang.
const UPDATE_STEP={check:0,sums:0,download:0,verify:1,install:2,restart:3};
let updateRunning=false,updateSpeed=null;
const mb=n=>(n/1048576).toLocaleString('id-ID',{minimumFractionDigits:1,maximumFractionDigits:1});
function renderUpdateProgress(s){const v='v'+(s.version||updateInfo?.latest||''),step=UPDATE_STEP[s.stage]??0,frac=s.total?Math.min(1,s.received/s.total):0;
  let pct={check:1,sums:3,verify:90,install:95,restart:100}[s.stage]??0,text='Menyiapkan…';
  if(s.stage==='check')text='Memeriksa versi terbaru…';
  if(s.stage==='sums')text='Mengambil daftar checksum resmi…';
  if(s.stage==='download'){pct=3+Math.round(frac*84);const now=performance.now();
    if(updateSpeed&&now>updateSpeed.at){const rate=(s.received-updateSpeed.received)/((now-updateSpeed.at)/1000);updateSpeed.rate=updateSpeed.rate?updateSpeed.rate*.7+rate*.3:rate}
    updateSpeed={at:now,received:s.received,rate:updateSpeed?.rate||0};
    text=`Mengunduh installer ${v} · ${mb(s.received)}${s.total?' / '+mb(s.total):''} MB${updateSpeed.rate>0?' · '+mb(updateSpeed.rate)+' MB/s':''}`}
  if(s.stage==='verify')text='Mencocokkan SHA-256 installer dengan rilis resmi…';
  if(s.stage==='install')text='Installer terverifikasi. Menyiapkan pemasangan…';
  if(s.stage==='restart')text=`SantriHub akan tertutup sebentar, memasang ${v}, lalu terbuka lagi sendiri.`;
  const prog=$('#update-progress');show(prog,true);prog.classList.toggle('waiting',s.stage==='download'&&!s.total||s.stage==='check'||s.stage==='sums');prog.classList.toggle('finishing',s.stage==='restart');
  $('#update-bar-fill').style.width=pct+'%';$('#update-bar').setAttribute('aria-valuenow',String(pct));$('#update-pct').textContent=pct+'%';$('#update-stage').textContent=text;
  $$('[data-update-step]').forEach(li=>{const i=Number(li.dataset.updateStep);li.className=i<step?'done':i===step?'active':''})}
async function pollUpdate(){try{const s=await getJson('/__santrihub/update/status');if(updateRunning&&s.stage!=='idle'&&s.stage!=='error')renderUpdateProgress(s)}catch{/* app closing */}}
updateDialog.addEventListener('cancel',e=>{if(updateRunning)e.preventDefault()});
$('#update-now').onclick=async()=>{const btn=$('#update-now'),fb=$('#update-feedback');btn.disabled=true;btn.textContent='Memperbarui…';$('#update-close').disabled=true;
  fb.textContent='';updateRunning=true;updateSpeed=null;renderUpdateProgress({stage:'check'});const timer=setInterval(pollUpdate,350);
  try{const res=await fetch('/__santrihub/update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Pembaruan gagal ('+res.status+').');
    clearInterval(timer);renderUpdateProgress({stage:'restart',version:data.version||updateInfo.latest});btn.textContent='Membuka ulang…';log('Pembaruan ke v'+(data.version||updateInfo.latest)+' dimulai.')}
  catch(e){clearInterval(timer);updateRunning=false;show($('#update-progress'),false);$('#update-close').disabled=false;btn.disabled=false;btn.textContent='Coba lagi';fb.textContent=e.message;fail(e)}};
checkUpdate();

// ─ Navigation ─
function go(page){if(!PAGES[page])page='home';$$('[data-rail-page]').forEach(b=>b.classList.toggle('active',b.dataset.railPage===page));$$('.strip-tab').forEach(b=>b.classList.toggle('active',page==='home'));$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='SantriHub / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();syncFx(page);stopStatusPoll();if(page==='status'&&csrf){loadStatus();loadTargets()}if(page==='repos'&&csrf)loadRepos();if(page==='extensions')loadExtensions();if(['agents','home','collection','status'].includes(page)&&csrf)loadAgents();if(page==='library'&&csrf)loadLibrary()}
$$('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
$$('[data-rail-page]').forEach(b=>b.onclick=()=>go(b.dataset.railPage));
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
const toggle=$('#nav-toggle');function closeNav(){document.body.classList.remove('nav-open');toggle.setAttribute('aria-expanded','false');show($('#nav-backdrop'),false)}
toggle.onclick=()=>{const open=document.body.classList.toggle('nav-open');toggle.setAttribute('aria-expanded',String(open));show($('#nav-backdrop'),open)};
$('#nav-backdrop').onclick=closeNav;$('#close-sidebar').onclick=closeNav;
// The panel next to the rail opens and closes like Zyvaro's; the choice is kept per browser.
function setPanel(open){document.body.classList.toggle('rail',!open);try{localStorage.setItem('santrihub-panel',open?'open':'closed')}catch{}}
const togglePanel=()=>setPanel(document.body.classList.contains('rail'));
try{if(localStorage.getItem('santrihub-panel')==='closed')document.body.classList.add('rail')}catch{}
$('#collapse-sidebar').onclick=()=>setPanel(false);$('#panel-open').onclick=()=>setPanel(true);$('#rail-toggle').onclick=()=>setPanel(true);
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='b'&&!document.querySelector('dialog[open]')){e.preventDefault();togglePanel()}});
// ⋯ menu: File, Edit, Tampilan, Jendela, Bantuan, each with a submenu, like a desktop app.
const appMenu=$('#app-menu'),appMenuBtn=$('#app-menu-btn');
function closeAppMenu(){show(appMenu,false);appMenuBtn.setAttribute('aria-expanded','false');$$('.app-submenu').forEach(m=>show(m,false));$$('[data-submenu]').forEach(b=>b.classList.remove('open'))}
function openSub(b){$$('[data-submenu]').forEach(x=>x.classList.toggle('open',x===b));$$('.app-submenu').forEach(m=>show(m,m.id==='app-sub-'+b.dataset.submenu));$('#app-sub-'+b.dataset.submenu).style.top=b.offsetTop+'px'}
appMenuBtn.onclick=e=>{e.stopPropagation();if(!appMenu.hidden)return closeAppMenu();show(appMenu);appMenuBtn.setAttribute('aria-expanded','true');openSub($('[data-submenu]'))};
$$('[data-submenu]').forEach(b=>{b.onmouseenter=()=>openSub(b);b.onclick=e=>{e.stopPropagation();openSub(b)}});
async function aboutHub(){try{const u=await getJson('/api/update');done(`SantriHub v${u.current}${u.available?` · versi baru v${u.latest} tersedia`:' · versi terbaru'}.`)}catch(e){fail(e)}}
async function railUpdate(){if(!$('#update-btn').hidden)return openUpdate();status('Mengecek pembaruan…');await checkUpdate();if(!$('#update-btn').hidden)openUpdate();else done('SantriHub sudah versi terbaru.')}
const APP_CMD={home:()=>go('home'),add:()=>go('add'),github:()=>$('#add-item').click(),scope:()=>$('#scope-toggle').click(),logout:()=>$('#logout').click(),
  search:()=>{if($('#page-home').hidden)go('home');$('#home-search').focus()},library:()=>go('library'),repos:()=>go('repos'),
  theme:()=>$('#theme-toggle').click(),panel:togglePanel,reload:()=>location.reload(),
  fullscreen:()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen().catch(()=>{})},agents:()=>go('agents'),check:()=>$('#check-test').click(),
  tour:()=>openTour(),update:railUpdate,about:aboutHub};
$$('[data-cmd]').forEach(b=>b.onclick=e=>{e.stopPropagation();closeAppMenu();setTimeout(()=>APP_CMD[b.dataset.cmd]?.(),0)});
document.addEventListener('click',e=>{if(!appMenu.hidden&&!appMenu.contains(e.target))closeAppMenu()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!appMenu.hidden){closeAppMenu();appMenuBtn.focus()}});
$('#rail-scope').onclick=e=>{e.stopPropagation();$('#scope-toggle').click()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNav();closeProfile();closeNotif();closeScope()}});
const scopeBtn=$('#scope-toggle');
function closeScope(){document.querySelector('.topbar').classList.remove('scope-open');scopeBtn.setAttribute('aria-expanded','false')}
scopeBtn.onclick=e=>{e.stopPropagation();const open=!document.querySelector('.topbar').classList.contains('scope-open');document.querySelector('.topbar').classList.toggle('scope-open',open);scopeBtn.setAttribute('aria-expanded',String(open))};
document.addEventListener('click',e=>{if(!e.target.closest('#scope-bar,#scope-toggle'))closeScope()});

// ─ Sidebar resize (210–420px seperti Notes) ─
$('#resize-handle').addEventListener('pointerdown',e=>{e.preventDefault();const move=ev=>{const w=Math.min(420,Math.max(210,ev.clientX));document.documentElement.style.setProperty('--sb-w',w+'px')};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up)};addEventListener('pointermove',move);addEventListener('pointerup',up)});

// ─ Rail popovers: bell (notifications) and Akun (profile menu + profile dialog) ─
let member=null,notifSeen=0;try{notifSeen=Number(localStorage.getItem('santrihub-notif-seen'))||0}catch{}
const profileBtn=$('#profile-trigger'),profileMenu=$('#profile-menu'),notifBtn=$('#rail-update'),notifPanel=$('#notif-panel');
// Next to the rail button, kept inside the window.
function placePop(pop,btn){const r=btn.getBoundingClientRect();pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,r.right+10))+'px';pop.style.top=Math.max(8,Math.min(innerHeight-pop.offsetHeight-8,r.bottom-pop.offsetHeight))+'px'}
function closeProfile(){show(profileMenu,false);profileBtn.setAttribute('aria-expanded','false')}
function closeNotif(){show(notifPanel,false);notifBtn.setAttribute('aria-expanded','false')}
function syncThemeItem(){const dark=document.documentElement.dataset.theme==='dark';$('#profile-theme').setAttribute('aria-checked',String(dark))}
profileBtn.onclick=e=>{e.stopPropagation();const open=profileMenu.hidden;closeNotif();show(profileMenu,open);profileBtn.setAttribute('aria-expanded',String(open));if(open){syncThemeItem();placePop(profileMenu,profileBtn)}};
document.addEventListener('click',e=>{if(!e.target.closest('#profile-menu,#profile-trigger'))closeProfile();if(!e.target.closest('#notif-panel,#rail-update'))closeNotif()});
addEventListener('resize',()=>{closeProfile();closeNotif()});
$('#profile-open').onclick=()=>{closeProfile();openProfile()};
$('#profile-activity').onclick=()=>{closeProfile();go('activity')};
$('#profile-theme').onclick=()=>{$('#theme-toggle').click();syncThemeItem()};
// Things that need the member: an update, agents still to reload. Recent activity follows.
function notifItems(){const out=[];
  if(updateInfo?.available)out.push({tone:'accent',icon:'↑',title:`SantriHub v${updateInfo.latest} tersedia`,text:`Terpasang v${updateInfo.current}`,act:'Update',run:openUpdate});
  for(const h of agents)if(orbitReload[h.id])out.push({tone:'warn',icon:'↻',title:`Muat ulang ${h.name}`,text:'Agar skill & MCP baru terbaca',act:'Cek',run:()=>go('status')});
  return out}
function refreshBell(){try{const n=notifItems().length,dot=$('#rail-update .rail-dot');show(dot,n>0||activity.some(a=>a.at>notifSeen));dot.classList.toggle('soft',!n)}catch{/* before the rail is wired */}}
function ago(d){const s=(Date.now()-d)/1000;return s<60?'Baru saja':s<3600?Math.floor(s/60)+' menit lalu':d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}
function renderNotif(){const rows=[];
  for(const n of notifItems()){const row=el('div','notif-item '+n.tone),copy=el('span','notif-copy'),b=el('button','ck-btn',n.act);b.type='button';b.onclick=()=>{closeNotif();n.run()};
    copy.append(el('strong',null,n.title),el('small',null,n.text));row.append(el('span','notif-ic',n.icon),copy,b);rows.push(row)}
  const recent=activity.slice(0,6);
  if(recent.length){rows.push(el('div','notif-label','Aktivitas terbaru'));for(const a of recent){const row=el('div','notif-item is-log'+(a.err?' bad':'')+(a.at>notifSeen?' new':'')),copy=el('span','notif-copy');
    copy.append(el('strong',null,a.t.replace(/^✓\s*/,'')),el('small',null,ago(a.at)));row.append(el('span','notif-ic',a.err?'!':'✓'),copy);rows.push(row)}}
  if(!rows.length){const e=el('div','notif-empty');e.append(el('span','notif-ic','✓'),el('strong',null,'Semua beres'),el('small',null,'Belum ada notifikasi di sesi ini.'));rows.push(e)}
  $('#notif-list').replaceChildren(...rows);
  $('#notif-ver').textContent=updateInfo?`SantriHub v${updateInfo.current}${updateInfo.available?'':' · terbaru'}`:''}
function openNotif(){renderNotif();show(notifPanel);notifBtn.setAttribute('aria-expanded','true');placePop(notifPanel,notifBtn);
  notifSeen=Date.now();try{localStorage.setItem('santrihub-notif-seen',String(notifSeen))}catch{}refreshBell()}
notifBtn.onclick=e=>{e.stopPropagation();closeProfile();if(!notifPanel.hidden)return closeNotif();openNotif()};
$('#notif-all').onclick=()=>{closeNotif();go('activity')};
$('#notif-check').onclick=e=>{e.stopPropagation();const b=e.currentTarget;b.disabled=true;b.textContent='Mengecek…';
  checkUpdate().finally(()=>{b.disabled=false;b.textContent='Cek pembaruan';if(!notifPanel.hidden){renderNotif();placePop(notifPanel,notifBtn)}if(updateInfo&&!updateInfo.available)status('SantriHub sudah versi terbaru.')})};
function openProfile(){const dlg=$('#profile-dialog'),u=member||{},name=u.name||'Member',items=allItems();
  $('#profile-avatar').textContent=(name.trim()[0]||'?').toUpperCase();$('#profile-title').textContent=name;
  const plan=el('div','profile-plan'+(u.premium?' on':''));plan.append(el('span','plan-pill'+(u.premium?'':' off'),u.premium?'Premium aktif':'Belum premium'),el('small',null,u.premium?'Katalog & pembaruan Skills Santriverse terbuka.':'Aktifkan premium di website Santriverse.'));
  const stats=el('div','profile-stats'),stat=(n,l)=>{const s=el('div','profile-stat');s.append(el('strong',null,String(n)),el('small',null,l));return s};
  stats.append(stat(items.filter(r=>r.kind==='skill').length,'Skill'),stat(items.filter(r=>r.kind==='mcp').length,'MCP'),stat(agents.filter(h=>h.detected).length,'AI agent'));
  const facts=el('dl','paket-facts'),fact=(k,v)=>facts.append(el('dt',null,k),el('dd',null,v));
  fact('Nama',name);fact('Email',u.email||'—');
  fact('Versi',updateInfo?`SantriHub v${updateInfo.current}${updateInfo.available?` · v${updateInfo.latest} tersedia`:' · terbaru'}`:'—');
  fact('Data','Tersimpan lokal di komputer ini');
  const actions=el('div','collection-actions'),tour=el('button','secondary','Tur singkat'),out=el('button','secondary danger','Keluar');tour.type=out.type='button';
  tour.onclick=()=>{dlg.close();openTour()};out.onclick=()=>{dlg.close();$('#logout').click()};actions.append(tour,out);
  if(updateInfo?.available){const up=el('button','home-create','Update ke v'+updateInfo.latest);up.type='button';up.onclick=()=>{dlg.close();openUpdate()};actions.append(up)}
  $('#profile-body').replaceChildren(plan,stats,facts,actions);dlg.showModal()}
$('#profile-dialog').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.close()});
$('#profile-dialog [data-close]').onclick=()=>$('#profile-dialog').close();

// ─ Typewriter sapaan (pola Home.tsx: type 58ms, erase 30ms, hold 1700ms) ─
function typewriter(el,phrases){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){el.textContent=phrases[0];return}
  let i=0,len=0,erasing=false;
  (function step(){const word=phrases[i%phrases.length];el.textContent=word.slice(0,len);
    if(!erasing&&len===word.length)return setTimeout(()=>{erasing=true;step()},1700);
    if(erasing&&len===0){erasing=false;i++;return step()}
    len+=erasing?-1:1;setTimeout(step,erasing?30:58)})()}

// ─ Auth ─
async function checkSession(){try{const data=await getJson('/api/auth/status');csrf=data.csrf;showMember(data.user);return true}catch{return false}}
function showMember(u){member=u||{};const name=(u&&u.name)||'Member',email=(u&&u.email)||'Akun Santriverse',initial=(name.trim()[0]||'?').toUpperCase();
  $('#identity').textContent=name;$('#identity-sub').textContent=email;$('#menu-name').textContent=name;$('#menu-email').textContent=email;
  $('#avatar').textContent=initial;$('#menu-avatar').textContent=initial;const plan=$('#menu-plan');plan.textContent=u?.premium===false?'Free':'Premium';plan.classList.toggle('off',u?.premium===false);refreshBell();
  typewriter($('#home-greeting'),[`Selamat datang, ${name.split(' ')[0]}.`,`Siap memasang skill, ${name.split(' ')[0]}?`,'Skill & MCP untuk semua AI agent.']);
  show($('#account'));$('#locked').close();document.body.classList.remove('auth-locked');show($('#content'));syncFx(location.hash.slice(1)||'home');status('Premium aktif. Katalog siap.');maybeTour()}
function closeCheckDialog(dialog,value='cancel'){if(!dialog.open||dialog.classList.contains('dialog-closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close(value);return}dialog.classList.add('dialog-closing');setTimeout(()=>{dialog.classList.remove('dialog-closing');if(dialog.open)dialog.close(value)},400)}
function closeCheck(){stopCheckPoll();checkEpoch++;checkRequest?.abort();checkRequest=null;checkBusy=false;for(const id of ['#restart-confirm','#force-confirm']){const d=$(id);d.returnValue='cancel';if(d.open)d.close()}const d=$('#check-panel');if(d.open)closeCheckDialog(d,'cancel')}
function showLocked(){stopStatusPoll();if($('#advanced-status').open)$('#advanced-status').close();if($('#repo-modal').open)$('#repo-modal').close();resetGithub();savedRepos=[];$('#saved-repos').replaceChildren();closeCheck();resetLocalSkills();resetLocalMcp();csrf='';lastStatus=null;selectedSkills.clear();activity.length=0;catalog={skills:[],mcpServers:[]};renderActivity();closeProfile();closeNotif();if($('#profile-dialog').open)$('#profile-dialog').close();document.body.classList.add('auth-locked');if(!$('#locked').open)$('#locked').showModal();show($('#account'),false);show($('#content'));syncFx('');status('Login untuk mengakses katalog premium.')}
$('#locked').addEventListener('cancel',e=>e.preventDefault());
document.body.classList.add('auth-locked');$('#locked').showModal();
$('#login').onclick=()=>busy($('#login'),'Membuka login…',async()=>{const{url}=await post('/api/auth/login');location.href=url});
$('#logout').onclick=()=>busy($('#logout'),'Logout…',async()=>{await post('/api/auth/logout');showLocked();status('Berhasil logout.')});
$$('input[name=scope]').forEach(r=>r.onchange=()=>{resetGithub();closeCheck();resetLocalSkills();resetLocalMcp();log('Scope diubah ke '+scope()+'.');loadStatus();loadTargets()});

// ─ Skills ─
function item(tag,html,ctrl){const el=document.createElement(tag);el.className='item';const d=document.createElement('div');d.innerHTML=html;ctrl&&el.append(ctrl);el.append(d);return el}
let catalogKind='skills',catalogCategory='Semua',catalogBusy=false,catalogTrigger=null;
const catalogDialog=$('#catalog-modal'),catalogConfirm=$('#catalog-confirm');
let catalogConfirmation=null,catalogConfirmClosing=false;
function lockCatalog(locked){for(const el of catalogDialog.children)if(el!==catalogConfirm)el.inert=locked}
function confirmCatalog(ids){
  const kind=catalogKind==='skills'?'Skills':'MCP Servers';
  $('#catalog-confirm-kind').textContent=kind+' · GLOBAL';$('#catalog-confirm-title').textContent=catalogKind==='skills'?'Install Skills?':'Daftarkan MCP Servers?';
  $('#catalog-confirm-summary').textContent=`${ids.length} ${kind} dipilih:`;
  $('#catalog-confirm-items').replaceChildren(...ids.map(id=>{const li=document.createElement('li');li.textContent=catalogRows().find(row=>row.id===id)?.label||id;return li}));
  $('#catalog-confirm-warning').innerHTML='<strong>GLOBAL · semua workspace</strong><br>Perubahan berlaku untuk semua project Antigravity.'+(catalogKind==='mcp'?' MCP dapat dijalankan IDE setelah reload. Pilih hanya sumber tepercaya.':'');
  $('#catalog-confirm-submit').textContent=catalogKind==='skills'?'Konfirmasi Install':'Konfirmasi Daftarkan';
  lockCatalog(true);show(catalogConfirm);$('#catalog-confirm-cancel').focus();
  return new Promise(resolve=>{catalogConfirmation={resolve,focus:$('#catalog-install')}})
}
function closeCatalogConfirm(confirmed=false){
  if(!catalogConfirmation||catalogConfirmClosing||catalogBusy)return;
  catalogConfirmClosing=true;const finish=()=>{const pending=catalogConfirmation;catalogConfirmation=null;catalogConfirmClosing=false;catalogConfirm.classList.remove('confirm-closing');show(catalogConfirm,false);lockCatalog(false);pending.focus.focus();pending.resolve(confirmed)};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)finish();else{catalogConfirm.classList.add('confirm-closing');setTimeout(finish,400)}
}
$('#catalog-confirm-cancel').onclick=()=>closeCatalogConfirm();$('#catalog-confirm-submit').onclick=()=>closeCatalogConfirm(true);
catalogDialog.addEventListener('keydown',e=>{if(catalogConfirm.hidden)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closeCatalogConfirm()}else if(e.key==='Tab'){e.preventDefault();const buttons=[$('#catalog-confirm-cancel'),$('#catalog-confirm-submit')];buttons[(buttons.indexOf(document.activeElement)+(e.shiftKey?-1:1)+2)%2].focus()}});
function catalogRows(){return catalogKind==='skills'?catalog.skills:catalog.mcpServers}
function catalogSource(row){return row.paket?row.paket.map(id=>paketById(id).short).join(', '):row.source?paketById(row.source).short:'Lainnya'}
function catalogCount(){const n=selectedSkills.size;$('#catalog-count').textContent=`${n} dipilih`;$('#catalog-install').textContent=(catalogKind==='skills'?'Install terpilih':'Daftarkan terpilih')+` (${n})`;$('#catalog-install').disabled=catalogBusy||!n}
function renderCategories(){const values=['Semua',...new Set(catalogRows().map(catalogSource))];$('#catalog-categories').replaceChildren(...values.map(value=>{const button=document.createElement('button');button.type='button';button.className='catalog-category';button.textContent=value;button.setAttribute('aria-pressed',String(catalogCategory===value));button.onclick=()=>{catalogCategory=value;renderCategories();renderCatalog()};return button}))}
function renderCatalog(){if(!catalogDialog.open)return;const q=$('#catalog-search').value.trim().toLowerCase(),installed=new Set(catalogKind==='skills'?(lastStatus?.skills||[]).map(row=>row.id):(lastStatus?.mcp.servers||[]).map(row=>row.name));const rows=catalogRows().filter(row=>!installed.has(catalogKind==='mcp'&&row.builtin?'santri-skills':row.id)&&(catalogCategory==='Semua'||catalogSource(row)===catalogCategory)&&`${row.id} ${row.label||''} ${row.description||''} ${catalogSource(row)}`.toLowerCase().includes(q));
  $('#catalog-items').replaceChildren(...rows.map(row=>{const card=document.createElement('label');card.className='catalog-card';const input=document.createElement('input');input.type='checkbox';input.value=row.id;input.setAttribute('aria-label',`Pilih ${row.label||row.id}`);input.checked=selectedSkills.has(row.id);input.onchange=()=>{input.checked?selectedSkills.add(row.id):selectedSkills.delete(row.id);catalogCount()};card.innerHTML=`<strong>${esc(row.label||row.id)}</strong><span class="pill paket paket-${paketById(row.paket?row.paket[0]:row.source).color}">${esc(catalogSource(row))}</span><small>${esc(row.description)}</small>`;card.prepend(input);return card}));
  if(!rows.length)$('#catalog-items').textContent=q||catalogCategory!=='Semua'?'Tidak ada kandidat yang cocok.':'Semua item katalog sudah terpasang.';catalogCount()}
function renderSkills(){if(catalogDialog.open&&catalogKind==='skills')renderCatalog()}
function renderMcp(){if(catalogDialog.open&&catalogKind==='mcp')renderCatalog()}
function openCatalog(kind,query=''){if(catalogDialog.open||catalogBusy)return;catalogKind=kind;catalogCategory='Semua';catalogTrigger=document.activeElement;selectedSkills.clear();$('#catalog-title').textContent=kind==='skills'?'Katalog Skills':'Katalog MCP Servers';$('#catalog-kind').textContent=(kind==='skills'?'SKILLS':'MCP SERVERS')+' · GLOBAL';$('#catalog-search').value=query;$('#catalog-local').open=false;$('#catalog-local').querySelectorAll('.local-import').forEach((panel,i)=>show(panel,i===(kind==='skills'?0:1)));catalogDialog.showModal();renderCategories();renderCatalog();$('#catalog-search').focus()}
function closeCatalog(){if(catalogConfirmation||catalogBusy||!catalogDialog.open||catalogDialog.classList.contains('dialog-closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){catalogDialog.close();return}catalogDialog.classList.add('dialog-closing');setTimeout(()=>{catalogDialog.classList.remove('dialog-closing');if(catalogDialog.open)catalogDialog.close()},400)}
$('#open-skills-catalog').onclick=()=>openCatalog('skills');$('#open-mcp-catalog').onclick=()=>openCatalog('mcp');
$('#catalog-close').onclick=closeCatalog;$('#catalog-cancel').onclick=closeCatalog;
catalogDialog.addEventListener('cancel',e=>{e.preventDefault();catalogConfirmation?closeCatalogConfirm():closeCatalog()});
catalogDialog.addEventListener('close',()=>{selectedSkills.clear();catalogTrigger?.focus()});
$('#catalog-search').addEventListener('input',renderCatalog);
$('#search').addEventListener('input',()=>window.renderInstalled?.());
$('#mcp-search').addEventListener('input',()=>window.renderInstalled?.());
for(const id of ['#side-search','#home-search'])$(id).addEventListener('change',e=>{$('#collection-search').value=e.target.value;e.target.value='';go('collection');renderCollection()});
$('#catalog-install').onclick=async()=>{if(catalogBusy||catalogConfirmation)return;const ids=[...selectedSkills];if(!ids.length)return status('Pilih minimal satu item.',true);if(!await confirmCatalog(ids))return;
  catalogBusy=true;catalogDialog.setAttribute('aria-busy','true');$('#catalog-install').disabled=true;$('#catalog-close').disabled=true;$('#catalog-cancel').disabled=true;
  busy($('#catalog-install'),'Memasang pilihan…',async()=>{try{if(catalogKind==='skills'){const r=await post('/api/install',{scope:scope(),skillIds:ids,confirmGlobal:true});done(`✓ ${r.installed} salinan terpasang, ${r.skipped} dilewati (${scope()}). Reload Antigravity.`)}else{for(const id of ids){const r=await post('/api/mcp',{scope:scope(),id,confirm:true,confirmGlobal:true});done('✓ '+r.message)}await loadTargets()}await loadStatus();catalogBusy=false;closeCatalog()}finally{catalogBusy=false;catalogDialog.setAttribute('aria-busy','false');$('#catalog-close').disabled=false;$('#catalog-cancel').disabled=false}})};
// ─ MCP ─

// ─ Status Config (read from disk by server) ─
function statusPollAllowed(){return Boolean(csrf)&&!document.hidden&&!$('#page-status').hidden&&!$('#locked').open}
function stopStatusPoll(){clearTimeout(statusTimer);statusTimer=null;statusEpoch++;statusRequest?.abort();statusRequest=null}
function queueStatusPoll(epoch){clearTimeout(statusTimer);if(statusPollAllowed()&&epoch===statusEpoch)statusTimer=setTimeout(()=>loadStatus(true,epoch),1500)}
async function loadStatus(poll=false,epoch=statusEpoch){
 if(!csrf||(poll&&!statusPollAllowed()))return false;if(statusRequest)return false;const requestedScope=scope(),requestCsrf=csrf;
 if(!poll&&!lastStatus){$('#stat-installed').textContent='—';$('#stat-config').textContent='Memeriksa config';$('#install-counts').innerHTML='<span>Skills <b>—</b></span><span>MCP <b>—</b></span>';$('#status-view').innerHTML='<div class="installation-column panel">Membaca Skills…</div><div class="installation-column panel">Membaca MCP…</div>'}
 statusRequest=new AbortController();const request=statusRequest,timeout=setTimeout(()=>request.abort(new Error('Pemeriksaan disk melewati batas 8 detik.')),8000);
 try{const result=await getJson('/api/status?scope='+encodeURIComponent(requestedScope),request.signal);if(epoch!==statusEpoch||csrf!==requestCsrf||scope()!==requestedScope||(poll&&!statusPollAllowed()))return false;lastStatus={...result,checkedAt:new Date().toLocaleTimeString()};renderStatus();$('#status-checked').textContent='Dicek '+lastStatus.checkedAt;return true}
 catch(e){if(epoch===statusEpoch&&csrf===requestCsrf&&(e.name!=='AbortError'||request.signal.reason?.message==='Pemeriksaan disk melewati batas 8 detik.')){$('#stat-config').textContent='Tidak diketahui';$('#status-checked').textContent='Status tidak diketahui · '+(request.signal.reason?.message||e.message);if(!lastStatus)$('#status-view').innerHTML='<div class="installation-column panel error-state">Status tidak tersedia. Coba periksa ulang.</div>'}return false}
 finally{clearTimeout(timeout);if(statusRequest===request)statusRequest=null;queueStatusPoll(epoch)}
}
function renderStatus(){const s=lastStatus;if(!s)return;const m=s.mcp,skillCount=s.skills.length,mcpCount=m.servers.length;
  const missingSkills=[...new Set(catalog.skills.filter(k=>!s.skills.some(x=>x.id===k.id)).map(k=>k.id))],missingMcp=[...new Set(catalog.mcpServers.map(k=>k.builtin?'santri-skills':k.id).filter(id=>!m.servers.some(x=>x.name===id)))];
  const join=(dir,tail)=>String(dir||'').replace(/[\\/]+$/,'')+(String(dir||'').includes('\\')?'\\':'/')+tail;
  const row=(name,paths,state,tone,note='')=>`<li class="disk-row"><div class="disk-head"><strong>${esc(name)}</strong><span class="pill ${tone}">${state}</span></div>${paths.map(x=>`<code>${esc(x)}</code>`).join('')}${note?`<small>${esc(note)}</small>`:''}</li>`;
  const skillRows=s.skills.map(k=>row(k.id,[join(k.dir,'SKILL.md')],'FILE ADA','ok',k.managed&&!k.markerValid?'Marker rusak; file tetap ada':k.managed?'':'Bukan milik santri-skills')).join('')
    +missingSkills.map(id=>row(id,s.skillTargets.map(t=>join(t.dir,join(id,'SKILL.md'))),'BELUM ADA','bad')).join('');
  const mcpRows=[...m.servers.map(x=>x.name),...missingMcp].map(name=>{const has=m.servers.some(x=>x.name===name);
    return row(name,[m.configFile],m.valid===false?'TIDAK DIKETAHUI':has?'CONFIG ADA':'BELUM ADA',m.valid===false?'':has?'ok':'bad','mcpServers.'+name)}).join('');
  const column=(kind,label,tone,items,help)=>`<article class="installation-column"><div class="installation-title"><span>${kind}</span><span class="pill ${tone}">${label}</span></div><ul class="disk-rows">${items||'<li>Tidak ada kandidat.</li>'}</ul><p>${help}</p></article>`;
  const html=column('Skills',skillCount?`TERPASANG · ${s.scope.toUpperCase()} · ${skillCount}`:'BELUM TERPASANG',skillCount?'ok':'bad',skillRows,'FILE ADA berarti SKILL.md ada di disk; runtime belum diverifikasi.')
    +column('MCP',m.valid===false?'JSON RUSAK':mcpCount?`DIKONFIGURASI · ${mcpCount}`:m.exists?'BELUM DIKONFIGURASI':'FILE BELUM ADA',m.valid===false||!mcpCount?'bad':'ok',mcpRows,'CONFIG ADA berarti nama ada di mcpServers; koneksi belum diuji.');
  if($('#status-view').innerHTML!==html)$('#status-view').innerHTML=html;
  const counts=`<span>Skills <b>${skillCount} terpasang · ${missingSkills.length} belum</b></span><span>MCP <b>${mcpCount} dikonfigurasi · ${m.valid===false?'?':missingMcp.length} belum</b></span>${s.checkedAt?`<span>Dicek <b>${esc(s.checkedAt)}</b></span>`:''}`;
  if($('#install-counts').innerHTML!==counts)$('#install-counts').innerHTML=counts;
  $('#stat-installed').textContent=skillCount;$('#stat-config').textContent=m.valid===false?'Config error':mcpCount?'MCP dikonfigurasi':'MCP belum dikonfigurasi';renderSkills();renderMcp()}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopStatusPoll();else if(statusPollAllowed())loadStatus()});
$('#refresh-status').onclick=()=>{loadStatus();loadAgents()};
const advanced=$('#advanced-status');let advancedTrigger=null;
$('#open-advanced').onclick=()=>{advancedTrigger=document.activeElement;advanced.showModal();$('#close-advanced').focus()};
$('#close-advanced').onclick=()=>closeCheckDialog(advanced);
advanced.addEventListener('cancel',e=>{e.preventDefault();closeCheckDialog(advanced)});
advanced.addEventListener('close',()=>{if(!$('#locked').open)advancedTrigger?.focus()});

$$('.copy-btn').forEach(btn=>btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);const old=btn.textContent;btn.textContent='Tersalin';setTimeout(()=>btn.textContent=old,1400)}catch{status('Gagal menyalin. Pilih teks lalu salin manual.',true)}});

// ─ Repositories ─
// One tile for every repo: GitHub mark, owner/repo, one meta line, small actions.
const GH_MARK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';
function repoTile(title,url,meta,tag){const card=el('article','catalog-card repo-tile'),ic=el('span','repo-ic'),main=el('div','repo-main'),head=el('span','repo-head'),actions=el('div','repo-actions');ic.innerHTML=GH_MARK;
  head.append(el('strong',null,title));if(tag)head.append(el('span','lib-type',tag));main.append(head,el('small','repo-meta',meta));main.title=url;
  const open=el('a','repo-act repo-open');open.innerHTML=REPO_IC.open;open.title='Buka di GitHub';open.href=url;open.target='_blank';open.rel='noopener noreferrer';open.dataset.external='';open.setAttribute('aria-label','Buka '+title+' di GitHub');
  actions.append(open);card.append(ic,main,actions);return {card,actions}}
// Small icon actions; the copy button says "Tersalin" for a moment after a copy.
const REPO_IC={copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg><span class="sr-only">Salin</span>',open:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',del:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg><span class="sr-only">Hapus</span>'};
function repoCopy(url,label,cls='repo-copy'){const b=el('button','repo-act '+cls);b.innerHTML=REPO_IC.copy;b.type='button';b.title='Salin URL';b.setAttribute('aria-label','Salin URL '+label);b.onclick=async()=>{try{await navigator.clipboard.writeText(url);b.textContent='Tersalin';b.classList.add('copied');setTimeout(()=>{b.innerHTML=REPO_IC.copy;b.classList.remove('copied')},1400)}catch{status('Gagal menyalin. Pilih teks lalu salin manual.',true)}};return b}
function renderSources(){const repos=[['MONOREPO-SKILLS','monorepo'],['GOOGLE-APPSCRIPT-SKILLS','appscript'],['SANTRI-SKILLS',null]];
 $('#repo-sources').replaceChildren(...repos.map(([name,source])=>{const url='https://github.com/askiya/'+name,count=source?catalog.skills.filter(s=>s.source===source).length:null;
  const {card,actions}=repoTile('askiya/'+name,url,count===null?'Penghubung katalog SantriHub':count+' skill di katalog');actions.prepend(repoCopy(url,'askiya/'+name));return card}));}



// Repository bookmarks: previews read only. No installation here.
let repoPreview=null,savedRepos=[],repoGeneration=0,repoBusy=false;
const repoModal=$('#repo-modal');
function resetGithub(){repoGeneration++;repoPreview=null;$('#repo-modal-save').disabled=repoBusy;show($('#repo-modal-preview'),false);$('#repo-modal-feedback').textContent='Tempel URL, lalu Simpan. Deteksi dilakukan otomatis.'}
function renderRepos(){const host=$('#saved-repos');$('#repo-count').textContent=savedRepos.length||'';if(!savedRepos.length){host.replaceChildren(emptyState('Belum ada repo tersimpan.','+ Tambah repositori',()=>$('#add-repo').click()));return}
 host.replaceChildren(...savedRepos.map(row=>{const {card,actions}=repoTile(row.repo,row.url,`Skills ${row.skills.length} · MCP ${row.mcp.length}`);card.querySelector('.repo-meta').title='Terdeteksi saat disimpan. Bukan bukti terpasang.';
 const copy=repoCopy(row.url,row.repo,'copy-btn');
 const del=el('button','repo-act repo-delete');del.innerHTML=REPO_IC.del;del.title='Hapus bookmark';del.type='button';del.setAttribute('aria-label','Hapus bookmark '+row.repo);del.onclick=()=>busy(del,'Menghapus bookmark…',async()=>{await post('/api/repos/delete',{url:row.url});savedRepos=savedRepos.filter(x=>x.url!==row.url);renderRepos();done('Bookmark dihapus.')});actions.prepend(copy);actions.append(del);return card}))}
async function loadRepos(){try{savedRepos=await getJson('/api/repos');renderRepos()}catch(e){fail(e)}}
function closeRepoModal(){if(!repoModal.open||repoModal.classList.contains('dialog-closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){repoModal.close();return}repoModal.classList.add('dialog-closing');setTimeout(()=>{repoModal.classList.remove('dialog-closing');if(repoModal.open)repoModal.close()},400)}
$('#add-repo').onclick=()=>{resetGithub();$('#repo-modal-url').value='';repoModal.showModal();$('#repo-modal-url').focus()};$('#repo-modal-close').onclick=closeRepoModal;
repoModal.addEventListener('cancel',e=>{e.preventDefault();closeRepoModal()});repoModal.addEventListener('close',()=>{resetGithub();if(!$('#locked').open)$('#add-repo').focus()});$('#repo-modal-url').addEventListener('input',resetGithub);
$('#repo-modal-url').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#repo-modal-preview-btn').click()}});
async function detectRepo(){resetGithub();const epoch=repoGeneration,url=$('#repo-modal-url').value.trim(),requestCsrf=csrf;
 const r=await post('/api/github/preview',{url,scope:scope()});if(epoch!==repoGeneration||csrf!==requestCsrf||!repoModal.open)throw new Error('URL/sesi berubah. Periksa ulang.');
 repoPreview=r;const names=r.mcp.flatMap(m=>m.names);$('#repo-modal-preview').textContent=`${r.repo||url} — Skills: ${r.skills.length} (${r.skills.map(s=>s.name).join(', ')||'tidak ada'}). MCP: ${names.length} (${names.join(', ')||'tidak ada'}). Hanya dibaca; tidak dipasang.`;show($('#repo-modal-preview'));$('#repo-modal-feedback').textContent=r.note||'Deteksi selesai.';
 if(!r.previewId)throw new Error(r.note||'Repository belum bisa dipindai.');return r;}
async function repoOperation(save){if(repoBusy)return;repoBusy=true;const btn=$('#repo-modal-save'),old=btn.textContent;for(const id of ['repo-modal-save','repo-modal-preview-btn','repo-modal-url'])$('#'+id).disabled=true;btn.textContent=save?'Memeriksa & menyimpan…':'Memeriksa…';
 try{const preview=repoPreview||await detectRepo();if(save){const epoch=repoGeneration,requestCsrf=csrf;const row=await post('/api/repos',{url:preview.sourceUrl,previewId:preview.previewId});if(epoch!==repoGeneration||csrf!==requestCsrf||!repoModal.open)return;savedRepos=[...savedRepos,row];renderRepos();closeRepoModal();done('Bookmark repository disimpan.')}}catch(e){$('#repo-modal-feedback').textContent=e.message;fail(e)}finally{repoBusy=false;btn.textContent=old;for(const id of ['repo-modal-save','repo-modal-preview-btn','repo-modal-url'])$('#'+id).disabled=false}}
$('#repo-modal-preview-btn').onclick=()=>repoOperation(false);
$('#repo-modal-save').onclick=()=>repoOperation(true);
// Independent check epochs: never reuse install-wizard proof state or timers.
let checkStep=0,checkEpoch=0,checkPollEpoch=0,checkTimer=null,checkRequest=null,checkBusy=false,checkInventory=null,checkVerified=false;
function stopCheckPoll(){clearTimeout(checkTimer);checkTimer=null;checkPollEpoch++;checkRequest?.abort();checkRequest=null}
function checkState(step,focus=true){
 checkStep=step;for(const [i,li] of $$('#check-panel .check-stepper li').entries()){i===step?li.setAttribute('aria-current','step'):li.removeAttribute('aria-current');li.classList.toggle('completed',i<step)}
 ['inventory','callback','result'].forEach((id,i)=>show($('#check-'+id),i===step));$('#check-stage').textContent=['Inventaris','Callback','Hasil'][step];show($('#check-back'),step===1);$('#check-finish').textContent=['Tes callback','Tutup tanpa verifikasi','Tutup'][step];$('#check-finish').className=step===1?'secondary':'wizard-primary';if(focus)$('#check-stage').focus();checkControls()
}
function checkControls(){
 $('#check-panel').setAttribute('aria-busy',String(checkBusy));
 for(const id of ['check-start','check-retry','open-antigravity','restart-antigravity','force-antigravity','check-back','check-finish'])$('#'+id).disabled=checkBusy;
 if(checkStep===0)$('#check-finish').disabled=checkBusy||!checkInventory;
 $('#check-start').disabled=checkBusy||!checkInventory?.mcp?.servers?.some(s=>s.name==='santri-skills'&&s.managed);
}
async function showCheck(){
 if($('#check-panel').open)return;stopCheckPoll();const epoch=++checkEpoch;checkBusy=true;checkInventory=null;checkVerified=false;checkRequest=new AbortController();const signal=checkRequest.signal;
 $('#check-summary').textContent='Memeriksa file dan konfigurasi global…';$('#check-results').innerHTML='';$('#check-counts').textContent='';$('#check-targets').textContent='';$('#check-proof').textContent='Belum ada callback.';$('#check-proof').classList.remove('proof-ok');proofLine('proof-mcp',false);proofLine('proof-skill',false);show($('#check-skill-list'),false);$('#check-outcome').classList.remove('proof-ok');$('#control-feedback').textContent='';show($('#force-antigravity'),false);show($('#check-retry'),false);$('#check-panel').showModal();checkState(0,false);
 try{const r=await post('/api/verify',{scope:'global',skillIds:[...selectedSkills]},signal);if(epoch===checkEpoch&&$('#check-panel').open){checkInventory=r;renderCheck(r)}}catch(e){if(epoch===checkEpoch&&e.name!=='AbortError')$('#check-summary').textContent='Pemeriksaan gagal: '+e.message}finally{if(epoch===checkEpoch){checkBusy=false;checkRequest=null;checkControls()}}
}
$('#check-test').onclick=showCheck;
function renderCheck(r){
 const skillRows=r.skillChecks||r.skills.map(s=>({...s,exists:true,path:s.dir+'/SKILL.md'})),mcpRows=r.mcpChecks||r.mcp.servers;
 const skillCount=skillRows.filter(s=>s.exists).length,configCount=mcpRows.filter(s=>s.configured).length;
 $('#check-summary').textContent='Global semua workspace · Inventaris disk, IDE BELUM TERVERIFIKASI. Config dan PATH bukan bukti koneksi IDE.';
 $('#check-targets').innerHTML=r.skillTargets.map(s=>`<code>Skills: ${esc(s.dir)}/&lt;id&gt;/SKILL.md</code>`).join('')+`<code>MCP: ${esc(r.mcp.configFile)}</code><p>Global Antigravity Library · semua workspace; salinan Project tidak masuk inventaris global.</p>`;
 $('#check-counts').innerHTML=`<span>Skills <b>${skillCount} file ada · ${skillRows.length-skillCount} belum terpasang</b></span><span>MCP <b>${configCount} config ada · ${mcpRows.length-configCount} belum terpasang</b></span>`;
 const pill=(text,ok=false)=>`<span class="pill ${ok?'ok':''}">${text}</span>`;
 const row=(name,badges,note)=>`<li><strong>${esc(name)}</strong><div>${badges}</div><small>${esc(note)}</small></li>`;
 const list=(title,rows)=>`<details class="check-accordion"><summary>${title}</summary><ul>${rows||'<li>Tidak ada kandidat.</li>'}</ul></details>`;
 $('#check-results').innerHTML=list(`Skills · ${skillCount} file ada / ${skillRows.length}`,skillRows.map(s=>row(s.id,pill(s.exists?'FILE ADA':'BELUM TERPASANG',s.exists),s.path)).join(''))+list(`MCP · ${configCount} config ada / ${mcpRows.length}`,`<li>${pill(r.mcp.valid===false?'JSON RUSAK':r.mcp.exists?'CONFIG ADA':'CONFIG BELUM ADA',r.mcp.exists&&r.mcp.valid)}<small>Runtime bukan bukti callback.</small></li>`+mcpRows.map(s=>row(s.name,pill(s.configured?'CONFIG ADA':'BELUM TERPASANG',s.configured)+pill(!s.configured?'RUNTIME BELUM DIUJI':s.available===true?'RUNTIME SIAP':s.available===false||s.launcherAvailable===false?'RUNTIME HILANG':'RUNTIME BELUM DIUJI'),(s.runtime||'')+' · '+(s.note||'Config dan PATH tidak membuktikan koneksi IDE.'))).join(''));
 const bridge=r.mcp.servers.some(s=>s.name==='santri-skills'&&s.managed);$('#check-bridge').textContent=bridge?'Bridge MCP santri-skills resmi terkonfigurasi global. Belum ada bukti callback.':'Bridge MCP santri-skills resmi belum terkonfigurasi global. Pasang bridge sebelum memulai tes callback.';$('#check-bridge').classList.toggle('missing',!bridge);
}
async function pollCheckProof(epoch=checkPollEpoch){
 if(!$('#check-panel').open||checkStep!==1||epoch!==checkPollEpoch)return;
 try{checkRequest=new AbortController();const proof=await getJson('/api/verification/status',checkRequest.signal);if(epoch!==checkPollEpoch||!$('#check-panel').open||checkStep!==1)return;checkRequest=null;
  checkVerified=proof.verified===true&&proof.evidence?.server==='santri-skills'&&proof.evidence?.level==='bridge-mcp-loaded'&&proof.evidence?.source==='local-capability-callback';
  const skill=proof.skillProof?.verified===true;proofLine('proof-mcp',checkVerified);proofLine('proof-skill',skill);
  if(skill){renderSkillProof(proof.skillProof);checkState(2);return}
  if(checkVerified){$('#check-proof').textContent='Callback asli diterima · bridge MCP santri-skills tersambung. Menunggu kode dari skill santrihub-cek: tempel kalimat di langkah 3 ke chat Agent baru.';$('#check-proof').classList.add('proof-ok');$('#check-finish').textContent='Lihat hasil (MCP saja)'}
  else $('#check-proof').textContent=proof.pending?'Menunggu callback asli bridge MCP santri-skills. '+(proof.expiresAt?'Batas server: '+new Date(proof.expiresAt).toLocaleTimeString()+'.':''):'Callback kedaluwarsa atau konfigurasi berubah. Belum terverifikasi; coba lagi.';
  show($('#check-retry'),!proof.pending);if(!proof.pending)return;
 }catch(e){if(epoch!==checkPollEpoch||e.name==='AbortError')return;checkRequest=null;$('#check-proof').textContent='Tes gagal: '+e.message;show($('#check-retry'));return}
 checkTimer=setTimeout(()=>pollCheckProof(epoch),1500);
}
function proofLine(id,ok){const el=$('#'+id);el.classList.toggle('ok',ok);el.querySelector('b').textContent=ok?'✓ terbukti':'menunggu'}
const BRIDGE_ONLY='Callback asli diterima · bridge MCP santri-skills saja. Identitas client tidak diautentikasi; MCP lain dan Skills belum terbukti dimuat IDE.';
function renderSkillProof(p){const all=p.seen.length+p.notSeen.length;
  $('#check-summary').textContent='Global semua workspace · Skill dimuat TERBUKTI lewat kode cek santrihub-cek. Identitas client tidak diautentikasi.';$('#check-outcome').classList.add('proof-ok');
  $('#check-outcome').textContent=`Skill dimuat · TERBUKTI. Agent membaca kode dari skill santrihub-cek di sesi ini dan mengirimnya lewat MCP santri-skills. ${p.seen.length} dari ${all} skill terpasang disebut agent. Identitas client tidak diautentikasi.`;
  const box=$('#check-skill-list'),row=(id,ok)=>{const li=el('li',ok?'ok':'warn');li.append(el('span','pill '+(ok?'ok':'warn'),ok?'DISEBUT':'TIDAK DISEBUT'),el('span',null,id));return li};
  const list=el('ul');list.append(...p.seen.map(id=>row(id,true)),...p.notSeen.map(id=>row(id,false)));
  box.replaceChildren(el('strong',null,'Skill yang dilaporkan agent'),list,el('small','muted',p.notSeen.length?'Tidak disebut belum tentu gagal: agent bisa merangkum. Tanyakan langsung di chat, misalnya "Gunakan skill <nama>".':'Semua skill di folder global disebut agent.'));show(box,all>0)}
async function startCheckProof(){
 if(checkBusy||checkStep!==1||!$('#check-panel').open||$('#check-start').disabled)return;stopCheckPoll();const epoch=checkEpoch,pollEpoch=checkPollEpoch;checkBusy=true;checkVerified=false;checkRequest=new AbortController();const signal=checkRequest.signal;show($('#check-retry'),false);$('#check-proof').textContent='Menyiapkan callback bridge…';checkControls();
 try{const r=await post('/api/verification/start',{scope:'global'},signal);if(r.prompt)$('#proof-prompt').textContent=r.prompt;proofLine('proof-mcp',false);proofLine('proof-skill',false);$('#check-finish').textContent='Tutup tanpa verifikasi';if(epoch===checkEpoch&&pollEpoch===checkPollEpoch)await pollCheckProof(pollEpoch)}catch(e){if(epoch===checkEpoch&&e.name!=='AbortError'){$('#check-proof').textContent='Tes gagal: '+e.message;show($('#check-retry'))}}finally{if(epoch===checkEpoch){checkBusy=false;checkControls()}}
}
$('#copy-proof-prompt').onclick=e=>copyText($('#proof-prompt').textContent,e.currentTarget);
$('#check-start').onclick=startCheckProof;$('#check-retry').onclick=startCheckProof;
$('#check-back').onclick=()=>{if(checkBusy)return;stopCheckPoll();checkVerified=false;checkState(0)};
$('#check-finish').onclick=()=>{if(checkBusy)return;if(checkStep===0){checkState(1);return}if(checkStep===1){stopCheckPoll();if(checkVerified){$('#check-outcome').textContent=BRIDGE_ONLY;$('#check-outcome').classList.remove('proof-ok');show($('#check-skill-list'),false);checkState(2);return}status('Tes ditutup tanpa verifikasi; belum ada callback asli.',true);closeCheck();return}closeCheck()};
$('#close-check').onclick=closeCheck;
$('#check-panel').addEventListener('cancel',e=>{e.preventDefault();closeCheck()});
$('#check-panel').addEventListener('close',()=>{stopCheckPoll();checkEpoch++;checkBusy=false;setTimeout(()=>{if(!$('#locked').open&&!document.querySelector('dialog[open]'))$('#check-test').focus()})});
async function checkControl(action,force=false){
 if(checkBusy||!$('#check-panel').open||checkStep!==1)return;const epoch=checkEpoch;checkBusy=true;checkControls();
 try{await post('/api/antigravity/control',action==='launch'?{action}:{action,confirmClose:true,force,confirmForce:force});if(epoch===checkEpoch){show($('#force-antigravity'),false);$('#control-feedback').textContent=action==='launch'?'Permintaan buka dikirim. Ini bukan bukti callback.':'Restart selesai. Buka chat Agent baru, lalu tempel kalimat di langkah 3. Restart sendiri bukan bukti.'}}catch(e){if(epoch===checkEpoch){if(!force&&e.forceRequired)show($('#force-antigravity'));$('#control-feedback').textContent=e.message;fail(e)}}finally{if(epoch===checkEpoch){checkBusy=false;checkControls()}}
}
$('#open-antigravity').onclick=()=>checkControl('launch');
$('#restart-antigravity').onclick=()=>{if(checkBusy||!$('#check-panel').open)return;$('#restart-confirm').returnValue='cancel';$('#restart-confirm').showModal()};
async function restartIde(force){if($('#check-panel').open)return checkControl('restart',force);if(!$('#install-wizard').open)return;await busy($('#wizard-restart-ide'),'Meminta restart Antigravity IDE…',async()=>{await post('/api/antigravity/control',{action:'restart',confirmClose:true,force,confirmForce:force});$('#wizard-proof').textContent='Restart selesai; belum ada bukti callback.'})}
$('#restart-confirm').addEventListener('close',()=>{if($('#restart-confirm').returnValue==='confirm')restartIde(false)});
$('#force-antigravity').onclick=()=>{if(checkBusy||$('#force-antigravity').hidden||!$('#check-panel').open)return;$('#force-confirm').returnValue='cancel';$('#force-confirm').showModal()};
$('#force-confirm').addEventListener('close',()=>{if($('#force-confirm').returnValue==='confirm')restartIde(true)});

// ─ Activity ─
var actFilter='all'; // var: log() may render before this line runs
function renderActivity(){const host=$('#activity-log'),bad=activity.filter(a=>a.err).length;
  $('#act-n-all').textContent=activity.length;$('#act-n-ok').textContent=activity.length-bad;$('#act-n-err').textContent=bad;$('#clear-activity').disabled=!activity.length;
  const f=actFilter||'all',rows=activity.filter(a=>f==='all'||(f==='err')===a.err);
  if(!rows.length){const e=el('li','act-empty');e.append(el('span','act-empty-ic','↺'),el('strong',null,activity.length?'Tidak ada yang cocok':'Belum ada aktivitas'),el('small',null,activity.length?'Coba saring yang lain.':'Impor, aktifkan, dan tes akan tercatat di sini.'));
    if(!activity.length){const b=el('button','secondary','+ Tambah skill');b.type='button';b.onclick=()=>go('add');e.append(b)}host.replaceChildren(e);return}
  host.replaceChildren(...rows.map(a=>{const li=el('li','act-row'+(a.err?' err':'')),time=el('time',null,a.at.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}));time.dateTime=a.at.toISOString();time.title=a.at.toLocaleString('id-ID');
    li.append(el('span','act-ic',a.err?'!':'✓'),el('span','act-text',a.t.replace(/^✓\s*/,'')),time);return li}))}
$$('[data-act]').forEach(b=>b.onclick=()=>{actFilter=b.dataset.act;$$('[data-act]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderActivity()});
$('#clear-activity').onclick=()=>{activity.length=0;renderActivity();refreshBell()};


// ─ Antigravity effect: Canvas 2D adaptation, runs only while Home is visible ─
let agFx=null;
(function(){const cv=$('#antigravity-canvas');if(!cv)return;
  if(typeof initAntigravity!=='function'||!cv.getContext||!cv.getContext('2d')){cv.remove();$('.collab-logos')&&$('.collab-logos').classList.add('fallback');return}
  agFx=initAntigravity(cv)})();
function syncFx(page){if(!agFx)return;page==='home'&&!$('#locked').open&&!$('#content').hidden?agFx.start():agFx.stop()}

// ─ Targets: detection, effective paths, custom override ─
let targets=null;
const pathRow=(label,value,extra='')=>`<div class="target-row"><strong>${esc(label)}</strong><div>${esc(value)}</div>${extra}</div>`;
async function loadTargets(){if(!csrf)return;const wanted=scope();try{const result=await getJson('/api/targets?scope='+encodeURIComponent(wanted));if(scope()!==wanted)return;targets=result;renderTargets();localTargetNote()}catch(e){$('#target-detection').textContent='Deteksi gagal: '+e.message}}
function setTargetPath(id,value,label){const el=$('#'+id);el.title=value;el.setAttribute('aria-label',label+': '+value);el.innerHTML='<span class="target-path-text">'+esc(value)+'</span>';measureTargetPaths()}
function measureTargetPaths(){for(const el of $$('.target-path')){const text=el.firstElementChild;if(!text)continue;const travel=Math.max(0,text.scrollWidth-el.clientWidth);el.toggleAttribute('data-overflow',travel>1);el.style.setProperty('--travel',-travel+'px')}}
new ResizeObserver(measureTargetPaths).observe($('.scope-bar'));
$('#copy-targets').onclick=async()=>{try{await navigator.clipboard.writeText($('#scope-destinations').textContent);status('Path target disalin.')}catch(e){status('Gagal menyalin path. Buka Status Config untuk path lengkap.',true)}};
function renderTargets(){const d=targets;if(!d)return;
  const badge=$('#target-badge');
  badge.textContent=d.antigravityDetected?'TERDETEKSI':'TIDAK TERDETEKSI';
  badge.className='pill '+(d.antigravityDetected?'ok':'bad');
  const app=d.applicationDetected?`Aplikasi Antigravity ditemukan di ${d.applicationEvidence.join(', ')}.`:'Aplikasi Antigravity tidak terlihat di lokasi install standar.';
  const cfg=d.configEvidence.length?('Bukti konfigurasi: '+d.configEvidence.join(' · ')):'Tidak ada bukti konfigurasi Antigravity di luar repo ini.';
  $('#target-detection').textContent=`${cfg} ${app}${d.envOverride?' Override env aktif: '+d.envOverride+'.':''}`;
  const eff=d.effective[scope()];
  setTargetPath('scope-skills',eff.skillsDirs.join(' | ')+'/<id>/SKILL.md','Skills');setTargetPath('scope-mcp',eff.mcpFile,'MCP');
  $('#scope-destinations').textContent=`Skills: ${eff.skillsDirs.join(' | ')}/<id>/SKILL.md · MCP: ${eff.mcpFile}`;
  $('#scope-warning').textContent=scope()==='project'?`Hanya dimuat ketika workspace ${d.cwd} dibuka di IDE. Bukan semua workspace.`:'Global Antigravity Library: tersedia untuk semua workspace; discovery IDE belum diverifikasi.';
  $('#target-effective').innerHTML=
    pathRow('Skills ('+scope()+')',eff.skillsDirs.join('  |  '))+
    pathRow('MCP config ('+scope()+')',eff.mcpFile)+
    d.candidates.filter(c=>c.recommended).map(c=>pathRow('Rekomendasi '+c.kind+' / '+c.scope,c.dir||c.file,
      `<small>${esc(c.evidence.join(' · '))} — confidence ${esc(c.confidence)}, ${c.writable?'writable':'tidak writable'}</small>`)).join('')+
    (d.manualSteps.length?`<div class="target-row"><strong>Langkah manual</strong><ol>${d.manualSteps.map(x=>`<li>${esc(x)}</li>`).join('')}</ol></div>`:'');
  const custom=d.custom||{};const active=custom.skillsDir||custom.mcpFile;
  show($('#custom-active'),Boolean(active));
  if(active)$('#custom-active-path').textContent=[custom.skillsDir&&('skills: '+custom.skillsDir),custom.mcpFile&&('mcp: '+custom.mcpFile)].filter(Boolean).join(' · ');
}
$('#validate-custom').onclick=()=>{const skillsDir=$('#custom-skills').value.trim(),mcpFile=$('#custom-mcp').value.trim();
  if(!skillsDir&&!mcpFile)return status('Tempel minimal satu path absolut.',true);
  busy($('#validate-custom'),'Memvalidasi path di server…',async()=>{stopStatusPoll();const r=await post('/api/targets/custom',{confirm:true,skillsDir:skillsDir||undefined,mcpFile:mcpFile||undefined});
    $('#target-checks').innerHTML=r.checks.map(c=>`<div class="check-row"><strong>${esc(c.kind)} · ${c.exists?'ADA':'BELUM ADA'} · ${c.writable?'WRITABLE':'TIDAK WRITABLE'}</strong><div>${esc(c.path)}</div><small>${esc(c.evidence.join(' · '))}</small></div>`).join('');
    done('✓ Target kustom aktif (hanya di memori proses).');await loadTargets();await loadStatus()})};
$('#reset-custom').onclick=()=>busy($('#reset-custom'),'Mereset target…',async()=>{stopStatusPoll();await post('/api/targets/custom',{confirm:true,reset:true});$('#target-checks').innerHTML='';done('✓ Target kembali ke hasil deteksi.');await loadTargets();await loadStatus()});
// Helper only: the browser never yields an absolute path, so this fills nothing automatically.
if(window.showOpenFilePicker){const btn=$('#choose-mcp');show(btn);
  btn.onclick=async()=>{try{const [h]=await window.showOpenFilePicker({types:[{description:'mcp_config.json',accept:{'application/json':['.json']}}]});
    const f=await h.getFile();let valid=null;try{JSON.parse(await f.text());valid=true}catch{valid=false}
    $('#chooser-note').textContent=`Dipilih: ${f.name} (${valid?'JSON valid':'JSON rusak'}). Ini hanya bantuan nama/isi — tempel path absolutnya di kolom di atas lalu klik Validasi.`}catch{}}}

// ─ Local import (sumber lokal ≠ target instalasi) ─
let localSkillPreview=null,localMcpPreview=null,localGeneration=0;
const localTargetNote=()=>{const eff=targets&&targets.effective&&targets.effective[scope()];
  $('#local-skills-target').textContent=eff?`Target instalasi (${scope()}): ${eff.skillsDirs.join('  |  ')||'belum terdeteksi'}`:'';
  $('#local-mcp-target').textContent=eff?`Target config (${scope()}): ${eff.mcpFile||'belum terdeteksi'}`:''};
function resetLocalSkills(){localGeneration++;localSkillPreview=null;$('#local-skills-results').replaceChildren();show($('#install-local-skills'),false)}
function resetLocalMcp(){localGeneration++;localMcpPreview=null;$('#local-mcp-results').replaceChildren();show($('#install-local-mcp'),false)}
$('#local-skills-source').addEventListener('input',resetLocalSkills);
$('#local-mcp-source').addEventListener('input',resetLocalMcp);
async function previewLocalSkills(src,scopeWanted){resetLocalSkills();const generation=localGeneration;const r=await post('/api/local/skills/preview',{source:src,scope:scopeWanted});if(generation!==localGeneration||scope()!==scopeWanted)throw new Error('Sumber/scope berubah. Preview ulang.');localSkillPreview={...r,scope:scopeWanted};
  $('#local-skills-results').replaceChildren(...r.skills.map(s=>item('label',`<strong>${esc(s.id)}</strong><small>${esc(s.name)} · ${s.files} file · ${Math.ceil(s.bytes/1024)}KB</small><span class="muted">${esc(s.description)}</span>`,Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:true}))));
  show($('#install-local-skills'),r.skills.length>0);return r}
async function installLocalSkills(ids){const p=localSkillPreview;if(!p||p.scope!==scope())throw new Error('Preview dulu sumber lokalnya.');
  const r=await post('/api/local/skills/install',{previewId:p.previewId,scope:p.scope,skillIds:ids,confirmGlobal:p.scope==='global'});
  resetLocalSkills();$('#local-skills-installed').textContent=`${r.installed} skill lokal terpasang ke ${r.targets.join(', ')}: ${r.ids.join(', ')||'—'} (${r.skipped} dilewati). Sumber: ${r.source}`;await loadStatus();return r}
async function previewLocalMcp(src,scopeWanted){resetLocalMcp();const generation=localGeneration;const r=await post('/api/local/mcp/preview',{source:src,scope:scopeWanted});if(generation!==localGeneration||scope()!==scopeWanted)throw new Error('Sumber/scope berubah. Preview ulang.');localMcpPreview={...r,scope:scopeWanted};
  $('#local-mcp-results').replaceChildren(...r.names.map(n=>item('label',`<strong>${esc(n)}</strong><small>nama server saja · command/env/header tidak ditampilkan</small>`,Object.assign(document.createElement('input'),{type:'checkbox',value:n,checked:false}))));
  show($('#install-local-mcp'),r.names.length>0);return r}
async function installLocalMcp(names){const p=localMcpPreview;if(!p||p.scope!==scope())throw new Error('Preview dulu sumber MCP lokalnya.');
  const r=await post('/api/local/mcp/install',{previewId:p.previewId,scope:p.scope,names,confirmGlobal:p.scope==='global'});
  resetLocalMcp();$('#local-mcp-installed').textContent=`${r.added.join(', ')} ditambahkan ke ${r.config}${r.backup?' (backup '+r.backup+')':' (file baru)'}. Total server: ${r.servers.length}.`;await loadStatus();await loadTargets();return r}
$('#preview-local-skills').onclick=()=>{const src=$('#local-skills-source').value.trim();if(!src)return status('Tempel path folder absolut.',true);resetLocalSkills();
  busy($('#preview-local-skills'),'Memindai folder lokal…',async()=>{const r=await previewLocalSkills(src,scope());done(`✓ ${r.skills.length} skill lokal terdeteksi di ${r.source}.`)})};
$('#install-local-skills').onclick=()=>{const ids=$$('#local-skills-results input:checked').map(x=>x.value);if(!ids.length)return status('Pilih minimal satu skill.',true);
  if(localSkillPreview&&localSkillPreview.scope==='global'&&!confirm('Install skill lokal ke scope GLOBAL: semua project terdampak. Lanjutkan?'))return;
  busy($('#install-local-skills'),'Menyalin skill lokal…',async()=>{const r=await installLocalSkills(ids);done(`✓ ${r.installed} skill lokal terpasang (${r.scope}). Reload Antigravity.`)})};
$('#preview-local-mcp').onclick=()=>{const src=$('#local-mcp-source').value.trim();if(!src)return status('Tempel path mcp_config.json absolut.',true);resetLocalMcp();
  busy($('#preview-local-mcp'),'Membaca mcp_config.json lokal…',async()=>{const r=await previewLocalMcp(src,scope());done(`✓ ${r.count} nama MCP terbaca dari ${r.source}. ${r.note}`)})};
$('#install-local-mcp').onclick=()=>{const names=$$('#local-mcp-results input:checked').map(x=>x.value);if(!names.length)return status('Pilih minimal satu MCP.',true);
  if(!confirm(`Daftarkan ${names.join(', ')} ke mcp_config.json (${localMcpPreview.scope})? Antigravity bisa menjalankannya setelah reload.`))return;
  busy($('#install-local-mcp'),'Menggabungkan mcp_config.json…',async()=>{const r=await installLocalMcp(names);done('✓ '+r.message)})};

// ─ Catalog ─
async function loadCatalog(){show($('#progress'));status('Memuat katalog…');
  try{catalog=await getJson('/api/catalog');$('#workspace').textContent=catalog.cwd;$('#stat-skills').textContent=catalog.skills.length;$('#stat-mcp').textContent=catalog.mcpServers.length;
  renderSkills();renderMcp();renderSources();if(location.hash==='#repos')await loadRepos();await loadAgents();if(location.hash==='#library')renderLibrary();await loadTargets();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1)||'home');if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
