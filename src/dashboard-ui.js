'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Home',skills:'Skills',mcp:'MCP Servers',status:'Status Config',repos:'Repositories',activity:'Activity'};
let catalog={skills:[],mcpServers:[]},csrf='',repoCache=null,lastStatus=null;
const selectedSkills=new Set();
const activity=[]; // ponytail: session-only memory log; persist server-side if audit history is needed.

function status(t,err=false){const el=$('#status');el.textContent=t;el.className='save-toast '+(err?'error':t.startsWith('✓')?'success':'')}
function log(t,err=false){activity.unshift({t,err,at:new Date()});renderActivity()}
function done(t){status(t);log(t)}function fail(e){status(e.message,true);log(e.message,true)}
const scope=()=>$('input[name=scope]:checked').value;
function esc(s){const d=document.createElement('span');d.textContent=s==null?'':String(s);return d.innerHTML}

async function post(url,body={}){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,_csrf:csrf})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data}
async function getJson(url){const res=await fetch(url);const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data}
async function busy(btn,msg,fn){btn.disabled=true;show($('#progress'));status(msg);try{await fn()}catch(e){fail(e)}finally{btn.disabled=false;show($('#progress'),false)}}
const confirmGlobal=what=>scope()!=='global'||confirm(`${what} ke scope GLOBAL: semua project terdampak. Lanjutkan?`);

// ─ Logo fallback: monogram jujur, bukan kotak kosong ─
$$('.logo-box img').forEach(img=>{const mark=()=>img.closest('.logo-box').classList.add('img-failed');
  img.addEventListener('error',mark);if(img.complete&&!img.naturalWidth)mark()});

// ─ Navigation ─
function go(page){if(!PAGES[page])page='home';$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='Workspace / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();if(page==='status'&&csrf)loadStatus()}
$$('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
$$('[data-rail-page]').forEach(b=>b.onclick=()=>{document.body.classList.remove('rail');go(b.dataset.railPage)});
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
const toggle=$('#nav-toggle');function closeNav(){document.body.classList.remove('nav-open');toggle.setAttribute('aria-expanded','false');show($('#nav-backdrop'),false)}
toggle.onclick=()=>{const open=document.body.classList.toggle('nav-open');toggle.setAttribute('aria-expanded',String(open));show($('#nav-backdrop'),open)};
$('#nav-backdrop').onclick=closeNav;$('#close-sidebar').onclick=closeNav;
$('#collapse-sidebar').onclick=()=>document.body.classList.add('rail');
$('#rail-toggle').onclick=()=>document.body.classList.remove('rail');
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNav();closeProfile()}});

// ─ Sidebar resize (210–420px seperti Notes) ─
$('#resize-handle').addEventListener('pointerdown',e=>{e.preventDefault();const move=ev=>{const w=Math.min(420,Math.max(210,ev.clientX));document.documentElement.style.setProperty('--sb-w',w+'px')};
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up)};addEventListener('pointermove',move);addEventListener('pointerup',up)});

// ─ Profile drop-up ─
const profileBtn=$('#profile-trigger'),profileMenu=$('#profile-menu');
function closeProfile(){show(profileMenu,false);profileBtn.setAttribute('aria-expanded','false')}
profileBtn.onclick=e=>{e.stopPropagation();const open=profileMenu.hidden;show(profileMenu,open);profileBtn.setAttribute('aria-expanded',String(open))};
document.addEventListener('click',e=>{if(!e.target.closest('.user-card'))closeProfile()});

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
function showMember(u){const name=(u&&u.name)||'Member',email=(u&&u.email)||'Premium aktif',initial=(name.trim()[0]||'?').toUpperCase();
  $('#identity').textContent=name;$('#identity-sub').textContent=email;$('#menu-name').textContent=name;$('#menu-email').textContent=email;
  $('#avatar').textContent=initial;$('#menu-avatar').textContent=initial;$('.rail-avatar').textContent=initial;
  typewriter($('#home-greeting'),[`Selamat datang, ${name.split(' ')[0]}.`,`Siap memasang skill, ${name.split(' ')[0]}?`,'Skills + MCP untuk Antigravity.']);
  show($('#account'));show($('#locked'),false);show($('#content'));status('Premium aktif. Katalog siap.')}
function showLocked(){csrf='';lastStatus=null;selectedSkills.clear();activity.length=0;repoCache=null;catalog={skills:[],mcpServers:[]};renderActivity();closeProfile();show($('#locked'));show($('#account'),false);show($('#content'),false);status('Login untuk mengakses katalog premium.')}
$('#login').onclick=()=>busy($('#login'),'Membuka login…',async()=>{const{url}=await post('/api/auth/login');location.href=url});
$('#logout').onclick=()=>busy($('#logout'),'Logout…',async()=>{await post('/api/auth/logout');showLocked();status('Berhasil logout.')});
$$('input[name=scope]').forEach(r=>r.onchange=()=>{log('Scope diubah ke '+scope()+'.');loadStatus()});

// ─ Skills ─
function item(tag,html,ctrl){const el=document.createElement(tag);el.className='item';const d=document.createElement('div');d.innerHTML=html;ctrl&&el.append(ctrl);el.append(d);return el}
function renderSkills(){const q=$('#search').value.toLowerCase(),installed=new Set((lastStatus&&lastStatus.skills||[]).map(s=>s.id));
  const rows=catalog.skills.filter(s=>`${s.id} ${s.description} ${s.source}`.toLowerCase().includes(q));
  $('#skills').replaceChildren(...rows.map(s=>item('label',`<strong>${esc(s.id)}</strong>${installed.has(s.id)?'<span class="pill ok">TERPASANG</span>':''}<small>${esc(s.source)}</small><span class="muted">${esc(s.description)}</span>`,Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:selectedSkills.has(s.id),onchange:e=>e.target.checked?selectedSkills.add(s.id):selectedSkills.delete(s.id)}))));
  if(!rows.length)$('#skills').textContent='Skill tidak ditemukan.'}
$('#search').addEventListener('input',renderSkills);
$('#side-search').addEventListener('input',e=>{$('#search').value=e.target.value;go('skills');renderSkills()});
$('#home-search').addEventListener('input',e=>{$('#search').value=e.target.value;renderSkills()});
$('#home-search').addEventListener('change',()=>go('skills'));
$('#install-skills').onclick=()=>{const ids=[...selectedSkills];if(!ids.length)return status('Pilih minimal satu skill.',true);if(!confirmGlobal('Install skill'))return;
  busy($('#install-skills'),'Menginstal skill…',async()=>{const r=await post('/api/install',{scope:scope(),skillIds:ids,confirmGlobal:scope()==='global'});done(`✓ ${r.installed} salinan terpasang, ${r.skipped} dilewati (${scope()}). Reload Antigravity.`);await loadStatus()})};

// ─ MCP ─
function renderMcp(){const conf=new Set((lastStatus&&lastStatus.mcp.servers||[]).map(s=>s.name));
  $('#mcp').replaceChildren(...catalog.mcpServers.map(m=>{const b=Object.assign(document.createElement('button'),{type:'button',textContent:'Daftarkan',className:'secondary'});
  b.onclick=()=>{if(!confirmGlobal('Daftarkan MCP '+m.id))return;busy(b,'Mendaftarkan MCP…',async()=>{const r=await post('/api/mcp',{scope:scope(),id:m.id,confirm:true,confirmGlobal:scope()==='global'});done('✓ '+r.message);await loadStatus()})};
  const el=item('div',`<strong>${esc(m.label||m.id)}</strong>${conf.has(m.id)?'<span class="pill ok">CONFIGURED</span>':''}<small>${esc(m.id)} · runtime belum diverifikasi</small><span class="muted">${esc(m.description)}</span>`);el.append(b);return el}));
  if(!catalog.mcpServers.length)$('#mcp').textContent='Tidak ada MCP di katalog.'}

// ─ Status Config (read from disk by server) ─
async function loadStatus(){if(!csrf)return;const requestedScope=scope();lastStatus=null;$('#stat-installed').textContent='—';$('#stat-config').textContent='Memeriksa config';$('#status-view').textContent='Membaca disk…';renderSkills();renderMcp();try{const result=await getJson('/api/status?scope='+encodeURIComponent(requestedScope));if(scope()!==requestedScope)return;lastStatus=result;renderStatus();return true}catch(e){$('#stat-config').textContent='Tidak diketahui';$('#status-view').textContent='Status tidak tersedia. Coba refresh.';fail(e);return false}}
function renderStatus(){const s=lastStatus;if(!s)return;const m=s.mcp;
  const card=(title,ok,label,body)=>`<div class="item"><div><strong>${title}</strong><span class="pill ${ok?'ok':ok===false?'bad':''}">${label}</span>${body}</div></div>`;
  $('#status-view').innerHTML=
    card('Skills ('+esc(s.scope)+')',s.skills.length>0,s.skills.length?`TERPASANG · ${s.skills.length}`:'KOSONG',
      s.skillTargets.map(t=>`<small>${esc(t.dir)} ${t.exists?'':'(belum ada)'}</small>`).join('')+(s.skills.length?`<ul>${s.skills.map(k=>`<li>${esc(k.id)}${k.managed&&!k.markerValid?' <em class="warn">marker rusak</em>':''}${k.managed?'':' <em>bukan milik santri-skills</em>'}</li>`).join('')}</ul>`:''))+
    card('MCP config',m.valid?(m.servers.length>0):false,!m.valid?'JSON RUSAK':m.servers.length?`CONFIGURED · ${m.servers.length}`:m.exists?'TANPA SERVER':'BELUM ADA',
      `<small>${esc(m.configFile)}</small>`+(m.servers.length?`<ul>${m.servers.map(x=>`<li>${esc(x.name)} <em>runtime belum diverifikasi</em></li>`).join('')}</ul>`:''));
  $('#stat-installed').textContent=s.skills.length;$('#stat-config').textContent=!m.valid?'Config error':s.configured?'Config terpasang':'Config kosong';renderSkills();renderMcp()}
$('#refresh-status').onclick=()=>busy($('#refresh-status'),'Membaca status dari disk…',async()=>{if(await loadStatus())done('✓ Status '+scope()+' diperbarui.')});

// ─ Repositories ─
function renderSources(){const by={};catalog.skills.forEach(s=>by[s.source]=(by[s.source]||0)+1);
  $('#repo-sources').replaceChildren(...Object.entries(by).map(([k,n])=>item('div',`<strong>${esc(k)}</strong><small>${n} skill</small>`)));
  if(!Object.keys(by).length)$('#repo-sources').textContent='Belum ada sumber.'}
$('#preview-repo').onclick=()=>{const url=$('#repo-url').value.trim();if(!url)return status('Masukkan URL repo GitHub.',true);repoCache=null;$('#repo-results').replaceChildren();show($('#install-repo'),false);
  busy($('#preview-repo'),'Mengunduh dan memindai repo…',async()=>{const r=await post('/api/repo/preview',{url,branch:$('#repo-branch').value.trim()||undefined});repoCache={url,branch:r.branch};
  $('#repo-results').replaceChildren(...r.skills.map(s=>item('label',`<strong>${esc(s.id)}</strong><small>${esc(s.relative)} · ${Math.ceil(s.bytes/1024)}KB</small><span class="muted">${esc(s.description)}</span><pre>${esc(String(s.preview||'').slice(0,400))}</pre>`,Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:true}))));
  done(r.mcpNote||`✓ Preview ${url}: ${r.skills.length} SKILL.md ditemukan.`);show($('#install-repo'),r.skills.length>0)})};
$('#install-repo').onclick=()=>{if(!repoCache)return;const ids=$$('#repo-results input:checked').map(x=>x.value);if(!ids.length)return status('Pilih minimal satu skill.',true);if(!confirmGlobal('Install skill repo'))return;
  busy($('#install-repo'),'Menginstal dari repo…',async()=>{const r=await post('/api/repo/install',{url:repoCache.url,branch:repoCache.branch,scope:scope(),skillIds:ids,confirmGlobal:scope()==='global'});done(`✓ ${r.installed} skill terpasang dari ${r.repo}@${r.branch}.`);await loadStatus()})};

// ─ Activity ─
function renderActivity(){$('#activity-log').innerHTML=activity.length?activity.map(a=>`<li class="${a.err?'error':''}"><time>${a.at.toLocaleTimeString()}</time> ${esc(a.t)}</li>`).join(''):'<li class="muted">Belum ada aktivitas di sesi ini.</li>'}
$('#clear-activity').onclick=()=>{activity.length=0;renderActivity()};

// ─ Catalog ─
async function loadCatalog(){show($('#progress'));status('Memuat katalog…');
  try{catalog=await getJson('/api/catalog');$('#workspace').textContent=catalog.cwd;$('#stat-skills').textContent=catalog.skills.length;$('#stat-mcp').textContent=catalog.mcpServers.length;
  renderSkills();renderMcp();renderSources();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1));if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
