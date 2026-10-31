'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Beranda',add:'1 · Tambah',collection:'2 · Koleksi',agents:'3 · Aktifkan',status:'4 · Cek & Tes',skills:'Skill terpasang (Antigravity)',mcp:'MCP terpasang (Antigravity)',library:'Skill Saya',repos:'Repositori',extensions:'Extensions',activity:'Riwayat'};
let catalog={skills:[],mcpServers:[]},csrf='',lastStatus=null;
let statusTimer=null,statusRequest=null,statusEpoch=0;
const selectedSkills=new Set();
const activity=[]; // ponytail: session-only memory log; persist server-side if audit history is needed.

function status(t,err=false){if($('#locked').open)$('#gate-feedback').textContent=err?t:'';const el=$('#status');el.textContent=t;el.className='save-toast '+(err?'error':t.startsWith('✓')?'success':'')}
function log(t,err=false){activity.unshift({t,err,at:new Date()});renderActivity()}
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
async function loadAgents(){try{const [h,lib,gw,pr,mine,own]=await Promise.all([getJson('/api/harnesses'),getJson('/api/library'),getJson('/api/gateway'),getJson('/api/profiles'),getJson('/api/mcp-library'),getJson('/api/my-paket')]);agents=h.harnesses||[];myMcp=mine.servers||[];myPaket=own.paket||[];librarySkills=lib.skills||[];gatewayServers=gw.servers||[];profiles=pr.profiles||{};renderAgents();renderGateway();renderProfiles();renderFlow()}catch(e){$('#agents-cards').replaceChildren(el('p','muted','AI agent belum bisa dideteksi.'));fail(e)}}
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
let librarySkills=[],libPreview=null;
const readFile=file=>new Promise((ok,no)=>{if(file.size>512*1024)return no(new Error(`${file.name} melebihi 512 KB.`));const r=new FileReader();r.onload=()=>ok(String(r.result));r.onerror=()=>no(new Error(`${file.name} tidak bisa dibaca.`));r.readAsText(file)});
function emptyState(text,label,action){const box=el('div','empty-state');box.append(el('p',null,text));if(label){const b=el('button','secondary',label);b.type='button';b.onclick=action;box.append(b)}return box}
function renderLibrary(){const host=$('#library-list');
  if(!librarySkills.length){host.replaceChildren(emptyState('Belum ada skill milik Anda. Import dari GitHub atau buat dari Markdown.','+ Import dari GitHub',()=>$('#lib-open-github').click()));return}
  host.replaceChildren(...librarySkills.map(s=>{const card=el('article','panel lib-card');const head=el('div','lib-card-head');head.append(el('strong',null,s.id),el('span','pill',({github:'GITHUB',upload:'UPLOAD'})[s.type]||'MARKDOWN'));if(s.generated)head.append(el('span','pill','SKILL.md DIBUAT OTOMATIS'));
    const about=el('p',null,s.description||'(tanpa deskripsi)');about.title=s.description||'';card.append(head,about);
    if(s.repo){const link=el('a','lib-source','github.com/'+s.repo);link.href='https://github.com/'+s.repo;link.target='_blank';link.rel='noopener noreferrer';card.append(link)}
    const actions=el('div','lib-actions');const use=el('button','secondary','Aktifkan di AI Agents');use.type='button';use.onclick=()=>{$('#agents-search').value=s.id;go('agents')};actions.append(use);
    if(s.type==='github'){const upd=el('button','secondary','Cek update');upd.type='button';upd.onclick=()=>busy(upd,`Mengecek ${s.id} di GitHub…`,async()=>{const r=await post('/api/library/update',{id:s.id});done(r.changed?`✓ ${s.id} diperbarui${r.synced?.length?` (juga di ${r.synced.join(', ')})`:''}.`:`✓ ${s.id} sudah versi terbaru.`);await loadLibrary()});actions.append(upd)}
    const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus ${s.id} dari library? Salinannya di AI agent juga dinonaktifkan.`))return;busy(del,`Menghapus ${s.id}…`,async()=>{const r=await post('/api/library/delete',{id:s.id});done(`✓ ${s.id} dihapus${r.deactivated?.length?` dan dinonaktifkan di ${r.deactivated.join(', ')}`:''}.`);await loadLibrary()})};actions.append(del);
    card.append(actions);return card}))}
async function loadLibrary(){try{librarySkills=(await getJson('/api/library')).skills||[];renderLibrary();renderFlow()}catch(e){$('#library-list').replaceChildren(el('p','muted','Library belum bisa dimuat.'));fail(e)}}
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
  host.replaceChildren(...rows.map(r=>{const card=el('article','collection-card'+(r.mine?' mine':''));const head=el('div','collection-card-head');
    head.append(el('strong',null,r.label),...r.paket.map(paketPill));if(r.starter)head.append(el('span','pill starter','SKILL PEMBUKA'));card.append(head,el('small','collection-by',r.by));
    const about=el('p',null,r.desc||'(tanpa deskripsi)');about.title=r.desc||'';card.append(about);
    const on=activeIn(r.kind,r.id),where=el('small','collection-active'+(on.length?' on':''));
    where.textContent=on.length?'Aktif di '+on.join(', '):agents.length?'Belum aktif di AI agent mana pun':'Status AI agent belum dimuat';
    if(r.gateway)where.textContent+=' · lewat Gateway';card.append(where);
    const actions=el('div','collection-actions'),use=el('button','home-create',on.length?'Atur agent →':'Aktifkan →');use.type='button';
    use.onclick=()=>{$('#agents-search').value=r.id;go('agents');renderAgents()};actions.append(use);
    if(r.kind==='mcp'){const t=el('button','secondary','Tes koneksi');t.type='button';t.onclick=()=>testMcp(r.id,card,t);actions.append(t)}
    if(r.mine){const pk=el('button','secondary','Paket…');pk.type='button';pk.onclick=()=>paketChooser(r,card);actions.append(pk)}
    if(r.mine&&r.kind==='skill'){const manage=el('button','secondary','Kelola');manage.type='button';manage.onclick=()=>go('library');actions.append(manage)}
    if(r.mine&&r.kind==='mcp'){const del=el('button','secondary danger','Hapus');del.type='button';del.onclick=()=>{if(!confirm(`Hapus MCP ${r.label} dari koleksi? Salinannya di AI agent juga dinonaktifkan.`))return;busy(del,`Menghapus ${r.label}…`,async()=>{const x=await post('/api/mcp-library/delete',{id:r.id});done(`✓ ${r.label} dihapus${x.deactivated.length?` dan dinonaktifkan di ${x.deactivated.join(', ')}`:''}.`);await loadAgents()})};actions.append(del)}
    card.append(actions);return card}))}
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
function renderHomeAgents(){const host=$('#home-agents');if(!host)return;const found=detectedAgents();
  if(!agents.length){host.replaceChildren(el('span','muted','AI agent belum bisa dideteksi.'));return}
  const chips=found.map(h=>{const b=el('button','agent-chip');b.type='button';b.onclick=()=>go('agents');
    b.append(el('i','agent-dot'),el('strong',null,h.name),el('small',null,`${h.skills.length} skill · ${h.mcp.names.length} MCP`));return b});
  if(!found.length)chips.push(el('span','muted','Belum ada AI agent terdeteksi. Pasang Claude Code, Codex, Gemini CLI, Cursor, atau Antigravity dulu.'));
  const rest=agents.length-found.length;if(rest){const more=el('button','agent-chip ghost',`+${rest} agent bisa disiapkan`);more.type='button';more.onclick=()=>{$('#agents-all').checked=true;go('agents');renderAgents()};chips.push(more)}
  host.replaceChildren(...chips)}
function renderFlow(){renderHomeSteps();renderHomePaths();renderHomeAgents();renderCollection();renderAgentChecks();$('#stat-library').textContent=librarySkills.length?`+ ${librarySkills.length} skill milik Anda`:'+ skill milik Anda'}
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
    const head=el('span','paket-card-head');head.append(el('span','paket-icon',p.icon),el('strong',null,p.short));card.append(head,el('small','paket-desc',p.description));
    card.append(el('span','paket-meta',[sk&&`${sk} skill`,mc&&`${mc} MCP`].filter(Boolean).join(' · ')||'Belum ada isi'),el('span','paket-by',p.author?'oleh '+p.author:''));
    if(p.starter)card.append(el('span','paket-starter','Mulai dari: '+p.starter));return card}).filter(Boolean),newPaketCard())}
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
function renderHomePaths(){const host=$('#home-paths');if(!host)return;const items=allItems(),paths=(catalog.paket||[]).filter(p=>p.id!=='umum'&&(p.fit?.length||p.starter));
  if(!paths.length){host.replaceChildren(el('p','muted','Memuat paket…'));return}
  const found=detectedAgents();
  host.replaceChildren(...paths.map(p=>{const own=items.filter(r=>r.paket.includes(p.id)),card=el('article','path-card paket-'+p.color),head=el('div','paket-card-head');
    head.append(el('span','paket-icon',p.icon),el('strong',null,p.short));card.append(head,el('p','paket-desc',p.description));
    if(p.fit?.length){const ul=el('ul','path-fit');for(const f of p.fit)ul.append(el('li',null,f));card.append(el('span','path-fit-label','Cocok jika'),ul)}
    const sk=own.filter(r=>r.kind==='skill').length,mc=own.filter(r=>r.kind==='mcp').length;
    card.append(el('span','paket-meta',[`${sk} skill`,mc&&`${mc} MCP`,p.author&&`oleh ${p.author}`].filter(Boolean).join(' · ')));
    if(p.starter)card.append(el('span','paket-starter',`Setelah dipasang, mulai di chat dengan skill ${p.starter}`));
    const on=found.map(h=>[h,own.filter(r=>agentCell(h,r.kind,r.id).on).length]).filter(([,n])=>n);
    if(on.length)card.append(el('small','collection-active on','Terpasang di '+on.map(([h,n])=>`${h.name} (${n}/${own.length})`).join(', ')));
    const bar=el('div','path-actions');
    if(found.length){const sel=document.createElement('select');sel.setAttribute('aria-label','AI agent untuk paket '+p.short);for(const h of found){const o=el('option',null,h.name);o.value=h.id;sel.append(o)}
      const install=el('button','home-create','Pasang paket');install.type='button';
      install.onclick=()=>{const h=agents.find(x=>x.id===sel.value);bulkToggle(h,own.filter(r=>agentCell(h,r.kind,r.id).state!=='foreign'),true)};bar.append(sel,install)}
    const view=el('button','secondary','Lihat isi');view.type='button';view.onclick=()=>{collectionPaket=p.id;go('collection');renderCollection()};bar.append(view);card.append(bar);return card}))}

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
  'antigravity':['Klik <b>Cek &amp; Tes</b> di kanan atas lalu <b>Restart Antigravity</b>, atau tutup dan buka lagi Antigravity.','Buka chat Agent baru (skill dibaca saat sesi dimulai).'],
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
async function copyText(text,btn){try{await navigator.clipboard.writeText(text);const old=btn.textContent;btn.textContent='Tersalin ✓';setTimeout(()=>{btn.textContent=old},1400)}catch{const host=btn.closest('li')||btn.parentElement;host.querySelector('.copy-manual')?.remove();const pre=el('pre','copy-manual',text);host.append(pre);getSelection().selectAllChildren(pre);status('Clipboard diblokir: teks sudah diseleksi, tekan Ctrl+C.',true)}}
let checkAgent='',checkAll=false;const CHECK_LIMIT=6;
function renderAgentChecks(){const host=$('#agent-checks');if(!host)return;const found=detectedAgents();
  if(!agents.length){host.replaceChildren(el('p','muted','AI agent belum dimuat.'));return}
  if(!found.length){host.replaceChildren(el('p','muted','Belum ada AI agent terdeteksi di komputer ini.'));return}
  if(!found.some(h=>h.id===checkAgent))checkAgent=found[0].id;const h=found.find(x=>x.id===checkAgent);
  const tabs=el('div','agent-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','AI agent');
  for(const x of found){const t=el('button','agent-tab');t.type='button';t.setAttribute('role','tab');t.setAttribute('aria-selected',String(x.id===checkAgent));
    t.append(el('span',null,x.name),el('span','count',String(x.skills.length+x.mcp.names.length)));t.onclick=()=>{checkAgent=x.id;checkAll=false;renderAgentChecks()};tabs.append(t)}
  const card=el('article','agent-check');card.setAttribute('role','tabpanel');card.setAttribute('aria-label',h.name);
  const mine=h.skills.filter(s=>s.managed).map(s=>s.id),others=h.skills.filter(s=>!s.managed).map(s=>s.id);
  if(h.mcp.valid===false)card.append(el('p','agent-check-warn','Config MCP agent ini tidak bisa dibaca (JSON/TOML rusak). Perbaiki file-nya dulu: '+h.mcp.file));
  const stepHead=(n,text)=>{const t=el('h3');t.append(el('i',null,n),document.createTextNode(text));return t};
  const reload=el('section','agent-check-step'),steps=el('ol','agent-check-steps');for(const s of RELOAD[h.id]||[`Reload ${h.name}.`]){const li=el('li');li.innerHTML=s;steps.append(li)}
  reload.append(stepHead('1','Muat ulang '+h.name),el('p',null,'Agent membaca skill dan MCP saat mulai, jadi muat ulang setelah mengaktifkan.'),steps);
  if(h.id==='antigravity'){const b=el('button','secondary','Buka Cek & Tes Antigravity');b.type='button';b.onclick=()=>$('#check-test').click();reload.append(b)}
  const test=el('section','agent-check-step'),list=el('ul','agent-check-items');
  test.append(stepHead('2','Coba di chat'),el('p',null,`Tes koneksi MCP di sini, atau salin prompt uji lalu tempel di chat ${h.name}.`));
  const rows=[];
  for(const name of h.mcp.names){const li=el('li','agent-check-item'),id=mcpIdFor(name);li.append(el('span','agent-kind mcp','MCP'),el('span','agent-check-name',name));
    const acts=el('span','agent-check-actions');
    if(id){const t=el('button','secondary','Tes koneksi');t.type='button';t.onclick=()=>testMcp(id,li,t);acts.append(t)}
    else acts.append(el('small','muted','bukan dari SantriHub'));
    const c=el('button','secondary','Salin prompt');c.type='button';c.onclick=()=>copyText(mcpPrompt(name),c);acts.append(c);li.append(acts);rows.push(li)}
  for(const id of [...mine,...others]){const li=el('li','agent-check-item'),name=el('span','agent-check-name',id+(mine.includes(id)?'':' (milik Anda)'));name.title=id;
    li.append(el('span','agent-kind skill'+(mine.includes(id)?'':' mine'),'SKILL'),name);
    const acts=el('span','agent-check-actions'),c=el('button','secondary','Salin prompt');c.type='button';c.onclick=()=>copyText(skillPrompt(id),c);acts.append(c);li.append(acts);rows.push(li)}
  if(!rows.length){const empty=el('li','muted','Belum ada skill atau MCP di agent ini. ');const a=el('button','secondary','Aktifkan dulu →');a.type='button';a.onclick=()=>go('agents');empty.append(a);rows.push(empty)}
  list.append(...(checkAll?rows:rows.slice(0,CHECK_LIMIT)));test.append(list);
  if(rows.length>CHECK_LIMIT){const more=el('button','secondary',checkAll?'Tampilkan lebih sedikit':`Tampilkan semua (${rows.length})`);more.type='button';more.onclick=()=>{checkAll=!checkAll;renderAgentChecks()};test.append(more)}
  card.append(reload,test);host.replaceChildren(tabs,card)}

// ─ Tur singkat: a spotlight walks the 4-step flow; the card sits next to what it explains. Shown once per browser, replay from Beranda or the profile menu ─
const TOUR_KEY='santrihub-tour-v1';
// target: selectors tried in order; the first one that is on screen wins, and all its visible matches are highlighted together.
const TOUR=[
  {page:'home',target:['.home-hero'],title:'Selamat datang di SantriHub',text:'Satu tempat untuk skill dan MCP semua AI agent Anda: Claude Code, Codex, Antigravity, Gemini CLI, Cursor, VS Code, dan Windsurf.',points:['Tur ini menunjukkan tiap bagian satu per satu. Kurang dari 1 menit.']},
  {page:'home',target:['.nav-flow','.sidebar-rail .rail-step','#nav-toggle'],title:'4 langkah, dari atas ke bawah',text:'Semua pekerjaan mengikuti alur ini: Tambah → Koleksi → Aktifkan → Cek & Tes.',points:['Klik nomor langkah kapan saja untuk pindah.']},
  {page:'home',target:['#home-paths'],title:'Pilih jalur proyek',text:'Paket Apps Script atau Monorepo berisi skill yang sudah disusun Santriverse.',points:['Pilih AI agent, lalu klik "Pasang paket". Semua isinya aktif sekaligus.']},
  {page:'add',target:['#drop-zone','.smart-import'],title:'1 · Tambah: impor pintar',text:'Tarik banyak ZIP, folder, atau file .md sekaligus ke kotak ini.',points:['SKILL.md dibuat otomatis bila belum ada.','Klik "Pindai & pratinjau" untuk melihat isinya sebelum disimpan.']},
  {page:'add',target:['#mcp-paste-box'],title:'Tempel MCP',text:'Buka bagian ini untuk menempel config MCP (JSON), perintah npx/uvx, atau URL MCP.',points:['API key hanya disimpan di komputer ini.']},
  {page:'collection',target:['#paket-cards'],title:'2 · Koleksi per paket',text:'Semua yang Anda tambahkan berkumpul di sini, bersama katalog premium Santriverse.',points:['Klik satu paket untuk melihat isinya dan menyalakannya sekaligus di satu agent.']},
  {page:'collection',target:['#collection-list'],title:'Kartu skill & MCP',text:'Tiap kartu menunjukkan di agent mana item itu sudah aktif.',points:['MCP punya tombol "Tes koneksi" untuk memastikan ia benar-benar jalan.']},
  {page:'agents',target:['.agents-scroll','#agents-cards'],title:'3 · Aktifkan per AI agent',text:'Centang tabel ini untuk menyalakan skill atau MCP di tiap agent.',points:['SantriHub hanya menyentuh file buatannya sendiri; config Anda yang lain aman.']},
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
  if(updateInfo.available){btn.textContent='⬆ Update v'+updateInfo.latest;btn.title='SantriHub v'+updateInfo.latest+' tersedia (terpasang v'+updateInfo.current+')';btn.hidden=false}}catch{/* offline: no button */}}
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
function go(page){if(!PAGES[page])page='home';$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='SantriHub / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();syncFx(page);stopStatusPoll();if(page==='status'&&csrf){loadStatus();loadTargets()}if(page==='repos'&&csrf)loadRepos();if(page==='extensions')loadExtensions();if(['agents','home','collection','status'].includes(page)&&csrf)loadAgents();if(page==='library'&&csrf)loadLibrary()}
$$('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));
$$('[data-rail-page]').forEach(b=>b.onclick=()=>{document.body.classList.remove('rail');go(b.dataset.railPage)});
$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
window.addEventListener('hashchange',()=>go(location.hash.slice(1)));
const toggle=$('#nav-toggle');function closeNav(){document.body.classList.remove('nav-open');toggle.setAttribute('aria-expanded','false');show($('#nav-backdrop'),false)}
toggle.onclick=()=>{const open=document.body.classList.toggle('nav-open');toggle.setAttribute('aria-expanded',String(open));show($('#nav-backdrop'),open)};
$('#nav-backdrop').onclick=closeNav;$('#close-sidebar').onclick=closeNav;
$('#collapse-sidebar').onclick=()=>document.body.classList.add('rail');
$('#rail-toggle').onclick=()=>document.body.classList.remove('rail');
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeNav();closeProfile();closeScope()}});
const scopeBtn=$('#scope-toggle');
function closeScope(){document.querySelector('.topbar').classList.remove('scope-open');scopeBtn.setAttribute('aria-expanded','false')}
scopeBtn.onclick=e=>{e.stopPropagation();const open=!document.querySelector('.topbar').classList.contains('scope-open');document.querySelector('.topbar').classList.toggle('scope-open',open);scopeBtn.setAttribute('aria-expanded',String(open))};
document.addEventListener('click',e=>{if(!e.target.closest('#scope-bar,#scope-toggle'))closeScope()});

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
  typewriter($('#home-greeting'),[`Selamat datang, ${name.split(' ')[0]}.`,`Siap memasang skill, ${name.split(' ')[0]}?`,'Skill & MCP untuk semua AI agent.']);
  show($('#account'));$('#locked').close();document.body.classList.remove('auth-locked');show($('#content'));syncFx(location.hash.slice(1)||'home');status('Premium aktif. Katalog siap.');maybeTour()}
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
function renderSources(){const repos=[['MONOREPO-SKILLS','monorepo'],['GOOGLE-APPSCRIPT-SKILLS','appscript'],['SANTRI-SKILLS',null]];
 $('#repo-sources').replaceChildren(...repos.map(([name,source])=>{const card=document.createElement('article');card.className='catalog-card';const url='https://github.com/askiya/'+name,count=source?catalog.skills.filter(s=>s.source===source).length:null;
 card.innerHTML=`<span class="pill">BAWAAN</span><strong>askiya/${esc(name)}</strong><small>${esc(url)}</small><small>${count===null?'Repository SantriHub · penghubung katalog':count+' Skills dalam katalog aktif'} · MCP belum diperiksa</small>`;
 const copy=document.createElement('button');copy.type='button';copy.className='secondary repo-copy';copy.textContent='Salin URL';copy.onclick=async()=>{try{await navigator.clipboard.writeText(url);copy.textContent='Tersalin';setTimeout(()=>copy.textContent='Salin URL',1400)}catch(e){fail(e)}};card.append(copy);return card}));}



// Repository bookmarks: previews read only. No installation here.
let repoPreview=null,savedRepos=[],repoGeneration=0,repoBusy=false;
const repoModal=$('#repo-modal');
function resetGithub(){repoGeneration++;repoPreview=null;$('#repo-modal-save').disabled=repoBusy;show($('#repo-modal-preview'),false);$('#repo-modal-feedback').textContent='Tempel URL, lalu Simpan. Deteksi dilakukan otomatis.'}
function renderRepos(){const host=$('#saved-repos');if(!savedRepos.length){host.replaceChildren(emptyState('Belum ada repositori tersimpan. Simpan repo favorit supaya cepat dipakai lagi.','+ Tambah repositori',()=>$('#add-repo').click()));return}
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
function renderActivity(){$('#activity-log').innerHTML=activity.length?activity.map(a=>`<li class="${a.err?'error':''}"><time>${a.at.toLocaleTimeString()}</time> ${esc(a.t)}</li>`).join(''):'<li class="empty-state">Belum ada aktivitas di sesi ini.</li>'}
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
  renderSkills();renderMcp();renderSources();if(location.hash==='#repos')await loadRepos();await loadAgents();if(location.hash==='#library')renderLibrary();await loadTargets();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1)||'home');if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
