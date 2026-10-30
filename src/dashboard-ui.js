'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Home',skills:'Skills',mcp:'MCP Servers',library:'Skill Saya',agents:'AI Agents',status:'Status Config',repos:'Repositories',extensions:'Extensions',activity:'Activity'};
let catalog={skills:[],mcpServers:[]},csrf='',lastStatus=null;
let statusTimer=null,statusRequest=null,statusEpoch=0;
const selectedSkills=new Set();
const activity=[]; // ponytail: session-only memory log; persist server-side if audit history is needed.

function status(t,err=false){if($('#locked').open)$('#gate-feedback').textContent=err?t:'';const el=$('#status');el.textContent=t;el.className='save-toast '+(err?'error':t.startsWith('✓')?'success':'')}
function log(t,err=false){activity.unshift({t,err,at:new Date()});renderActivity()}
function done(t){status(t);log(t)}function fail(e){status(e.message,true);log(e.message,true)}
const scope=()=> 'global';
function esc(s){const d=document.createElement('span');d.textContent=s==null?'':String(s);return d.innerHTML}

async function post(url,body={},signal){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,_csrf:csrf}),signal});
  const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||'Gagal'),{forceRequired:data.forceRequired===true});return data}
async function getJson(url,signal){const res=await fetch(url,{signal});const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data}
async function busy(btn,msg,fn){btn.disabled=true;show($('#progress'));status(msg);try{await fn()}catch(e){fail(e)}finally{btn.disabled=false;show($('#progress'),false)}}
const confirmGlobal=what=>scope()!=='global'||confirm(`${what} ke scope GLOBAL: semua project terdampak. Lanjutkan?`);

// ─ Logo fallback: monogram jujur, bukan kotak kosong ─
$$('.logo-box img').forEach(img=>{const mark=()=>img.closest('.logo-box').classList.add('img-failed');
  img.addEventListener('error',mark);if(img.complete&&!img.naturalWidth)mark()});

// ─ Extensions: official store links from src/extensions.js via /api/extensions ─
let extensionsLoaded=false;
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!=null)node.textContent=text;return node}
function renderExtensions(list){const host=$('#extension-list');
  if(!list.length){host.replaceChildren(el('p','muted','Belum ada extension.'));return}
  host.replaceChildren(...list.map(ext=>{const card=el('article','panel extension-card');card.dataset.extension=ext.id;
    const head=el('div','ext-head');const logo=el('img','ext-logo');logo.src='/assets/santriverse-logo.webp';logo.alt='';
    const title=el('div','ext-title');const name=el('h2',null,ext.name);const meta=el('div','ext-meta');meta.append(el('span','badge',ext.kind));if(ext.version)meta.append(el('span','muted','v'+ext.version));title.append(name,meta);head.append(logo,title);
    const stores=el('div','ext-stores');for(const store of ext.stores||[]){const link=el('a','ext-store');link.href=store.url;link.target='_blank';link.rel='noopener noreferrer';link.dataset.external='';
      link.append(el('strong',null,store.label),el('small',null,store.for||''));stores.append(link)}
    card.append(head,el('p','ext-tagline',ext.tagline||''),stores);
    if(ext.identifier){const row=el('div','ext-id');row.append(el('span','muted','ID editor'),el('code',null,ext.identifier));const copy=el('button','secondary','Salin ID');copy.type='button';
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(ext.identifier);done('✓ ID '+ext.identifier+' disalin.')}catch{fail(new Error('Clipboard tidak tersedia. Salin ID secara manual.'))}};row.append(copy);card.append(row)}
    if(ext.steps?.length){const how=el('details','ext-steps');how.append(el('summary',null,'Cara pasang'));const ol=el('ol');for(const step of ext.steps)ol.append(el('li',null,step));how.append(ol);card.append(how)}
    return card}))}
async function loadExtensions(){if(extensionsLoaded)return;try{const data=await getJson('/api/extensions');extensionsLoaded=true;renderExtensions(data.extensions||[])}catch(e){$('#extension-list').replaceChildren(el('p','muted','Daftar extension belum bisa dimuat. Coba lagi.'));fail(e)}}
if(location.hash==='#extensions')loadExtensions();

// ─ AI Agents: skills + MCP per harness via /api/harnesses (src/harnesses.js) ─
let agents=[],agentsBusy=false;
const GATEWAY_ID='santrihub-gateway';
function agentCell(h,kind,id){
  if(kind==='mcp'){const on=h.mcp.names.includes(id===GATEWAY_ID?'santrihub':id);return {on,state:on?'on':'off',note:h.mcp.valid===false?'config rusak':''}}
  const own=h.skills.find(s=>s.id===id);if(own)return own.managed?{on:true,state:'on'}:{on:true,state:'foreign',note:'milik Anda'};
  const via=h.skillsViaOtherFolders.find(s=>s.id===id);return via?{on:false,state:'via',note:'lewat folder lain'}:{on:false,state:'off'}}
function renderAgents(){const all=$('#agents-all').checked,shown=agents.filter(h=>all||h.detected),q=$('#agents-search').value.trim().toLowerCase();
  $('#agents-cards').replaceChildren(...(agents.length?agents.filter(h=>all||h.detected).map(h=>{const card=el('article','panel agent-card'+(h.detected?'':' undetected'));
    card.append(el('strong',null,h.name),el('span','pill '+(h.detected?'ok':''),h.detected?'TERDETEKSI':'BELUM ADA'),el('small','muted',`${h.skills.length} skill · ${h.mcp.names.length} MCP`));
    const path=el('code','agent-path',h.skillsDir);path.title=h.sharedWith.length?'Folder ini juga dibaca: '+h.sharedWith.join(', '):'';card.append(path);return card}):[el('p','muted','Tidak ada data.')]));
  if(!shown.length){$('#agents-matrix').replaceChildren(el('caption',null,'Belum ada AI agent terdeteksi. Centang "Tampilkan agent yang belum terdeteksi" untuk menyiapkan lebih dulu.'));return}
  const rows=[...librarySkills.map(s=>({kind:'skill',id:s.id,label:s.id,desc:s.description,mine:true})),...catalog.skills.map(s=>({kind:'skill',id:s.id,label:s.id,desc:s.description})),{kind:'mcp',id:GATEWAY_ID,label:'SantriHub Gateway',desc:'Satu MCP berisi MCP pilihan Anda di panel Gateway'},...catalog.mcpServers.map(m=>({kind:'mcp',id:m.id,label:m.label||m.id,desc:m.description}))]
    .filter(r=>!q||(r.label+' '+(r.desc||'')).toLowerCase().includes(q));
  const head=el('tr');head.append(el('th',null,'Skill / MCP'),...shown.map(h=>{const th=el('th',null,h.name);th.scope='col';return th}));
  const body=rows.map(r=>{const tr=el('tr');const name=el('th');name.scope='row';name.append(el('span','agent-kind '+r.kind+(r.mine?' mine':''),r.kind==='mcp'?'MCP':r.mine?'SAYA':'SKILL'),el('span',null,' '+r.label));if(r.desc)name.title=r.desc;tr.append(name);
    for(const h of shown){const c=agentCell(h,r.kind,r.id),td=el('td','agent-cell '+c.state),box=document.createElement('input');box.type='checkbox';box.checked=c.on;
      box.disabled=c.state==='foreign'||agentsBusy;box.setAttribute('aria-label',`${r.label} di ${h.name}`);box.onchange=()=>toggleAgent(h,r,box);td.append(box);if(c.note)td.append(el('small',null,c.note));tr.append(td)}
    return tr});
  $('#agents-matrix').replaceChildren(el('thead'),el('tbody'));$('#agents-matrix thead').append(head);$('#agents-matrix tbody').append(...body)}
async function loadAgents(){try{const [h,lib,gw,pr]=await Promise.all([getJson('/api/harnesses'),getJson('/api/library'),getJson('/api/gateway'),getJson('/api/profiles')]);agents=h.harnesses||[];librarySkills=lib.skills||[];gatewayServers=gw.servers||[];profiles=pr.profiles||{};renderAgents();renderGateway();renderProfiles()}catch(e){$('#agents-cards').replaceChildren(el('p','muted','AI agent belum bisa dideteksi.'));fail(e)}}
async function toggleAgent(h,r,box){const enable=box.checked;agentsBusy=true;$$('#agents-matrix input').forEach(i=>{i.disabled=true});show($('#progress'));status(`${enable?'Mengaktifkan':'Menonaktifkan'} ${r.label} di ${h.name}…`);
  try{const res=await post(r.kind==='mcp'?'/api/harnesses/mcp':'/api/harnesses/skill',{harness:h.id,id:r.id,enable});done(`✓ ${r.label} ${enable?'aktif':'nonaktif'} di ${h.name}. ${res.hint||''}`)}
  catch(e){fail(e)}finally{agentsBusy=false;show($('#progress'),false);await loadAgents()}}
// ─ Gateway + profiles (AI Agents page): /api/gateway, /api/profiles ─
let gatewayServers=[],profiles={};
function renderGateway(){const host=$('#gateway-list');
  if(!catalog.mcpServers.length){host.replaceChildren(el('p','muted','Katalog MCP kosong.'));return}
  host.replaceChildren(...catalog.mcpServers.map(m=>{const name=m.id,row=el('label','gateway-row'),box=document.createElement('input');box.type='checkbox';box.checked=gatewayServers.includes(name);box.setAttribute('aria-label',`${m.label||m.id} lewat SantriHub Gateway`);
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
let librarySkills=[],libPreview=null;
const readFile=file=>new Promise((ok,no)=>{if(file.size>512*1024)return no(new Error(`${file.name} melebihi 512 KB.`));const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>no(new Error(`${file.name} tidak bisa dibaca.`));r.readAsText(file)});
function renderLibrary(){const host=$('#library-list');
  if(!librarySkills.length){host.replaceChildren(el('p','muted','Library masih kosong. Import dari GitHub atau buat dari Markdown.'));return}
  host.replaceChildren(...librarySkills.map(s=>{const card=el('article','panel lib-card');const head=el('div','lib-card-head');head.append(el('strong',null,s.id),el('span','pill',s.type==='github'?'GITHUB':'MARKDOWN'));if(s.generated)head.append(el('span','pill','SKILL.md DIBUAT OTOMATIS'));
    const about=el('p',null,s.description||'(tanpa deskripsi)');about.title=s.description||'';card.append(head,about);
    if(s.repo){const link=el('a','lib-source','github.com/'+s.repo);link.href='https://github.com/'+s.repo;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}
    const actions=el('div','lib-actions');const use=el('button','secondary','Aktifkan di AI Agents');use.type='button';use.onclick=()=>{$('#agents-search').value=s.id;go('agents')};actions.append(use);
    if(s.type==='github'){const upd=el('button','secondary','Cek update');upd.type='button';upd.onclick=()=>busy(upd,`Mengecek ${s.id} di GitHub…`,async()=>{const r=await post('/api/library/update',{id:s.id});done(r.changed?`✓ ${s.id} diperbarui${r.synced?.length?` (juga di ${r.synced.join(', ')})`:''}.`:`✓ ${s.id} sudah versi terbaru.`);await loadLibrary()});actions.append(upd)}
    const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus ${s.id} dari library? Salinannya di AI agent juga dinonaktifkan.`))return;busy(del,`Menghapus ${s.id}…`,async()=>{const r=await post('/api/library/delete',{id:s.id});done(`✓ ${s.id} dihapus${r.deactivated?.length?` dan dinonaktifkan di ${r.deactivated.join(', ')}`:''}.`);await loadLibrary()})};actions.append(del);
    card.append(actions);return card}))}
async function loadLibrary(){try{librarySkills=(await getJson('/api/library')).skills||[];renderLibrary()}catch(e){$('#library-list').replaceChildren(el('p','muted','Library belum bisa dimuat.'));fail(e)}}
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

// ─ Update: /api/update compares this build with the latest GitHub release ─
let updateInfo=null;
const updateDialog=$('#update-dialog');
const selfUpdate=()=>document.documentElement.dataset.santrihubUpdate==='self';
async function checkUpdate(){try{updateInfo=await getJson('/api/update');const btn=$('#update-btn');
  if(updateInfo.available){btn.textContent='⬆ Update v'+updateInfo.latest;btn.title='SantriHub v'+updateInfo.latest+' tersedia (terpasang v'+updateInfo.current+')';btn.hidden=false}}catch{/* offline: no button */}}
function openUpdate(){if(!updateInfo)return;const self=selfUpdate();
  $('#update-current').textContent='v'+updateInfo.current;$('#update-latest').textContent='v'+updateInfo.latest;
  $('#update-notes').href=updateInfo.releaseUrl;$('#update-command').textContent=updateInfo.command;$('#update-feedback').textContent='';
  show($('#update-self'),self);show($('#update-manual'),!self);show($('#update-now'),self);$('#update-now').disabled=false;$('#update-now').textContent='Update sekarang';
  updateDialog.showModal()}
$('#update-btn').onclick=openUpdate;
$('#update-close').onclick=()=>updateDialog.close();
$('#update-copy').onclick=async()=>{try{await navigator.clipboard.writeText(updateInfo.command);done('✓ Perintah update disalin.')}catch{fail(new Error('Clipboard tidak tersedia. Salin perintah secara manual.'))}};
$('#update-now').onclick=async()=>{const btn=$('#update-now'),fb=$('#update-feedback');btn.disabled=true;btn.textContent='Mengunduh…';
  fb.textContent='Mengunduh installer resmi v'+updateInfo.latest+' dan memeriksa SHA-256…';
  try{const res=await fetch('/__santrihub/update',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Pembaruan gagal ('+res.status+').');
    btn.textContent='Memasang…';fb.textContent='Installer terverifikasi. SantriHub ditutup sebentar lalu terbuka lagi di v'+(data.version||updateInfo.latest)+'.';log('Pembaruan ke v'+(data.version||updateInfo.latest)+' dimulai.')}
  catch(e){btn.disabled=false;btn.textContent='Coba lagi';fb.textContent=e.message;fail(e)}};
checkUpdate();

// ─ Navigation ─
function go(page){if(!PAGES[page])page='home';$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='Workspace / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();syncFx(page);stopStatusPoll();if(page==='status'&&csrf){loadStatus();loadTargets()}if(page==='repos'&&csrf)loadRepos();if(page==='extensions')loadExtensions();if(page==='agents'&&csrf)loadAgents();if(page==='library'&&csrf)loadLibrary()}
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
  show($('#account'));$('#locked').close();document.body.classList.remove('auth-locked');show($('#content'));syncFx(location.hash.slice(1)||'home');status('Premium aktif. Katalog siap.')}
function closeCheckDialog(dialog,value='cancel'){if(!dialog.open||dialog.classList.contains('dialog-closing'))return;if(matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close(value);return}dialog.classList.add('dialog-closing');setTimeout(()=>{dialog.classList.remove('dialog-closing');if(dialog.open)dialog.close(value)},400)}
function closeCheck(){stopCheckPoll();checkEpoch++;checkRequest?.abort();checkRequest=null;checkBusy=false;for(const id of ['#restart-confirm','#force-confirm']){const d=$(id);d.returnValue='cancel';if(d.open)d.close()}const d=$('#check-panel');if(d.open)closeCheckDialog(d,'cancel')}
function showLocked(){stopStatusPoll();if($('#advanced-status').open)$('#advanced-status').close();if($('#repo-modal').open)$('#repo-modal').close();resetGithub();savedRepos=[];$('#saved-repos').replaceChildren();closeCheck();resetLocalSkills();resetLocalMcp();csrf='';lastStatus=null;selectedSkills.clear();activity.length=0;catalog={skills:[],mcpServers:[]};renderActivity();closeProfile();document.body.classList.add('auth-locked');if(!$('#locked').open)$('#locked').showModal();show($('#account'),false);show($('#content'));syncFx('');status('Login untuk mengakses katalog premium.')}
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
function catalogSource(row){return row.source||'Lainnya'}
function catalogCount(){const n=selectedSkills.size;$('#catalog-count').textContent=`${n} dipilih`;$('#catalog-install').textContent=(catalogKind==='skills'?'Install terpilih':'Daftarkan terpilih')+` (${n})`;$('#catalog-install').disabled=catalogBusy||!n}
function renderCategories(){const values=['Semua',...new Set(catalogRows().map(catalogSource))];$('#catalog-categories').replaceChildren(...values.map(value=>{const button=document.createElement('button');button.type='button';button.className='catalog-category';button.textContent=value;button.setAttribute('aria-pressed',String(catalogCategory===value));button.onclick=()=>{catalogCategory=value;renderCategories();renderCatalog()};return button}))}
function renderCatalog(){if(!catalogDialog.open)return;const q=$('#catalog-search').value.trim().toLowerCase(),installed=new Set(catalogKind==='skills'?(lastStatus?.skills||[]).map(row=>row.id):(lastStatus?.mcp.servers||[]).map(row=>row.name));const rows=catalogRows().filter(row=>!installed.has(catalogKind==='mcp'&&row.builtin?'santri-skills':row.id)&&(catalogCategory==='Semua'||catalogSource(row)===catalogCategory)&&`${row.id} ${row.label||''} ${row.description||''} ${catalogSource(row)}`.toLowerCase().includes(q));
  $('#catalog-items').replaceChildren(...rows.map(row=>{const card=document.createElement('label');card.className='catalog-card';const input=document.createElement('input');input.type='checkbox';input.value=row.id;input.setAttribute('aria-label',`Pilih ${row.label||row.id}`);input.checked=selectedSkills.has(row.id);input.onchange=()=>{input.checked?selectedSkills.add(row.id):selectedSkills.delete(row.id);catalogCount()};card.innerHTML=`<strong>${esc(row.label||row.id)}</strong><span class="pill">${esc(catalogSource(row))}</span><small>${esc(row.description)}</small>`;card.prepend(input);return card}));
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
$('#side-search').addEventListener('change',e=>openCatalog('skills',e.target.value));
$('#home-search').addEventListener('change',e=>openCatalog('skills',e.target.value));
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
$('#refresh-status').onclick=()=>loadStatus();
const advanced=$('#advanced-status');let advancedTrigger=null;
$('#open-advanced').onclick=()=>{advancedTrigger=document.activeElement;advanced.showModal();$('#close-advanced').focus()};
$('#close-advanced').onclick=()=>closeCheckDialog(advanced);
advanced.addEventListener('cancel',e=>{e.preventDefault();closeCheckDialog(advanced)});
advanced.addEventListener('close',()=>{if(!$('#locked').open)advancedTrigger?.focus()});

$$('.copy-btn').forEach(btn=>btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);const old=btn.textContent;btn.textContent='Tersalin';setTimeout(()=>btn.textContent=old,1400)}catch{status('Gagal menyalin. Pilih teks lalu salin manual.',true)}});

// ─ Repositories ─
function renderSources(){const repos=[['MONOREPO-SKILLS','monorepo'],['GOOGLE-APPSCRIPT-SKILLS','appscript'],['SANTRI-SKILLS',null]];
 $('#repo-sources').replaceChildren(...repos.map(([name,source])=>{const card=document.createElement('article');card.className='catalog-card';const url='https://github.com/askiya/'+name,count=source?catalog.skills.filter(s=>s.source===source).length:null;
 card.innerHTML=`<span class="pill">BAWAAN</span><strong>askiya/${esc(name)}</strong><small>${esc(url)}</small><small>${count===null?'Repository SantriHub · penghubung katalog':count+' Skills dalam katalog aktif'} · MCP belum diperiksa</small>`;
 const copy=document.createElement('button');copy.type='button';copy.className='secondary repo-copy';copy.textContent='Salin URL';copy.onclick=async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='Tersalin';setTimeout(()=>copy.textContent='Salin URL',1400)}catch(e){fail(e)}};card.append(copy);return card}));}



// Repository bookmarks: previews read only. No installation here.
let repoPreview=null,savedRepos=[],repoGeneration=0,repoBusy=false;
const repoModal=$('#repo-modal');
function resetGithub(){repoGeneration++;repoPreview=null;$('#repo-modal-save').disabled=repoBusy;show($('#repo-modal-preview'),false);$('#repo-modal-feedback').textContent='Tempel URL, lalu Simpan. Deteksi dilakukan otomatis.'}
function renderRepos(){const host=$('#saved-repos');if(!savedRepos.length){host.textContent='Belum ada repository tersimpan.';return}
 host.replaceChildren(...savedRepos.map(row=>{const card=document.createElement('article');card.className='catalog-card';card.innerHTML=`<strong>${esc(row.repo)}</strong><small>${esc(row.url)}</small><small>Terdeteksi: Skills ${row.skills.length} · MCP ${row.mcp.length}. Bukan bukti terpasang.</small>`;
 const actions=document.createElement('div');actions.className='repo-actions';const copy=document.createElement('button');copy.type='button';copy.className='copy-btn secondary';copy.textContent='Salin';copy.setAttribute('aria-label','Salin URL '+row.repo);copy.onclick=async()=>{try{await navigator.clipboard.writeText(row.url);copy.textContent='Tersalin';setTimeout(()=>copy.textContent='Salin',1400)}catch{status('Gagal menyalin. Pilih teks lalu salin manual.',true)}};
 const del=document.createElement('button');del.type='button';del.className='secondary repo-delete';del.textContent='Hapus';del.onclick=()=>busy(del,'Menghapus bookmark…',async()=>{await post('/api/repos/delete',{url:row.url});savedRepos=savedRepos.filter(x=>x.url!==row.url);renderRepos();done('Bookmark dihapus.')});actions.append(copy,del);card.append(actions);return card}))}
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
 $('#check-summary').textContent='Memeriksa file dan konfigurasi global…';$('#check-results').innerHTML='';$('#check-counts').textContent='';$('#check-targets').textContent='';$('#check-proof').textContent='Belum ada callback.';$('#check-proof').classList.remove('proof-ok');$('#control-feedback').textContent='';show($('#force-antigravity'),false);show($('#check-retry'),false);$('#check-panel').showModal();checkState(0,false);
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
  if(checkVerified){$('#check-proof').textContent='Callback asli diterima · bridge MCP santri-skills saja. Identitas client tidak diautentikasi; MCP lain dan Skills belum terbukti dimuat IDE.';$('#check-proof').classList.add('proof-ok');$('#check-outcome').textContent=$('#check-proof').textContent;checkState(2);return}
  $('#check-proof').textContent=proof.pending?'Menunggu callback asli bridge MCP santri-skills. '+(proof.expiresAt?'Batas server: '+new Date(proof.expiresAt).toLocaleTimeString()+'.':''):'Callback kedaluwarsa atau konfigurasi berubah. Belum terverifikasi; coba lagi.';
  show($('#check-retry'),!proof.pending);if(!proof.pending)return;
 }catch(e){if(epoch!==checkPollEpoch||e.name==='AbortError')return;checkRequest=null;$('#check-proof').textContent='Tes gagal: '+e.message;show($('#check-retry'));return}
 checkTimer=setTimeout(()=>pollCheckProof(epoch),1500);
}
async function startCheckProof(){
 if(checkBusy||checkStep!==1||!$('#check-panel').open||$('#check-start').disabled)return;stopCheckPoll();const epoch=checkEpoch,pollEpoch=checkPollEpoch;checkBusy=true;checkVerified=false;checkRequest=new AbortController();const signal=checkRequest.signal;show($('#check-retry'),false);$('#check-proof').textContent='Menyiapkan callback bridge…';checkControls();
 try{await post('/api/verification/start',{scope:'global'},signal);if(epoch===checkEpoch&&pollEpoch===checkPollEpoch)await pollCheckProof(pollEpoch)}catch(e){if(epoch===checkEpoch&&e.name!=='AbortError'){$('#check-proof').textContent='Tes gagal: '+e.message;show($('#check-retry'))}}finally{if(epoch===checkEpoch){checkBusy=false;checkControls()}}
}
$('#check-start').onclick=startCheckProof;$('#check-retry').onclick=startCheckProof;
$('#check-back').onclick=()=>{if(checkBusy)return;stopCheckPoll();checkVerified=false;checkState(0)};
$('#check-finish').onclick=()=>{if(checkBusy)return;if(checkStep===0){checkState(1);return}if(checkStep===1){stopCheckPoll();status('Tes ditutup tanpa verifikasi; belum ada callback asli.',true);closeCheck();return}closeCheck()};
$('#close-check').onclick=closeCheck;
$('#check-panel').addEventListener('cancel',e=>{e.preventDefault();closeCheck()});
$('#check-panel').addEventListener('close',()=>{stopCheckPoll();checkEpoch++;checkBusy=false;setTimeout(()=>{if(!$('#locked').open&&!document.querySelector('dialog[open]'))$('#check-test').focus()})});
async function checkControl(action,force=false){
 if(checkBusy||!$('#check-panel').open||checkStep!==1)return;const epoch=checkEpoch;checkBusy=true;checkControls();
 try{await post('/api/antigravity/control',action==='launch'?{action}:{action,confirmClose:true,force,confirmForce:force});if(epoch===checkEpoch){show($('#force-antigravity'),false);$('#control-feedback').textContent=action==='launch'?'Permintaan buka dikirim. Ini bukan bukti callback.':'Restart selesai. Panggil santrihub_status; restart bukan bukti callback.'}}catch(e){if(epoch===checkEpoch){if(!force&&e.forceRequired)show($('#force-antigravity'));$('#control-feedback').textContent=e.message;fail(e)}}finally{if(epoch===checkEpoch){checkBusy=false;checkControls()}}
}
$('#open-antigravity').onclick=()=>checkControl('launch');
$('#restart-antigravity').onclick=()=>{if(checkBusy||!$('#check-panel').open)return;$('#restart-confirm').returnValue='cancel';$('#restart-confirm').showModal()};
async function restartIde(force){if($('#check-panel').open)return checkControl('restart',force);if(!$('#install-wizard').open)return;await busy($('#wizard-restart-ide'),'Meminta restart Antigravity IDE…',async()=>{await post('/api/antigravity/control',{action:'restart',confirmClose:true,force,confirmForce:force});$('#wizard-proof').textContent='Restart selesai; belum ada bukti callback.'})}
$('#restart-confirm').addEventListener('close',()=>{if($('#restart-confirm').returnValue==='confirm')restartIde(false)});
$('#force-antigravity').onclick=()=>{if(checkBusy||$('#force-antigravity').hidden||!$('#check-panel').open)return;$('#force-confirm').returnValue='cancel';$('#force-confirm').showModal()};
$('#force-confirm').addEventListener('close',()=>{if($('#force-confirm').returnValue==='confirm')restartIde(true)});

// ─ Activity ─
function renderActivity(){$('#activity-log').innerHTML=activity.length?activity.map(a=>`<li class="${a.err?'error':''}"><time>${a.at.toLocaleTimeString()}</time> ${esc(a.t)}</li>`).join(''):'<li class="muted">Belum ada aktivitas di sesi ini.</li>'}
$('#clear-activity').onclick=()=>{activity.length=0;renderActivity()};


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
  renderSkills();renderMcp();renderSources();if(location.hash==='#repos')await loadRepos();if(location.hash==='#agents')await loadAgents();if(location.hash==='#library')await loadLibrary();await loadTargets();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1)||'home');if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
