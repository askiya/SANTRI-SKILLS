'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Home',skills:'Skills',mcp:'MCP Servers',status:'Status Config',repos:'Repositories',extensions:'Extensions',activity:'Activity'};
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

// ─ Navigation ─
function go(page){if(!PAGES[page])page='home';$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='Workspace / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();syncFx(page);stopStatusPoll();if(page==='status'&&csrf){loadStatus();loadTargets()}if(page==='repos'&&csrf)loadRepos()}
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
  renderSkills();renderMcp();renderSources();if(location.hash==='#repos')await loadRepos();await loadTargets();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1)||'home');if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
