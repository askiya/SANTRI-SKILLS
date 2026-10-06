'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],show=(el,v=true)=>{el.hidden=!v};
const PAGES={home:'Home',skills:'Skills',mcp:'MCP Servers',status:'Status Config',repos:'Repositories',activity:'Activity'};
let catalog={skills:[],mcpServers:[]},csrf='',repoCache=null,lastStatus=null;
const selectedSkills=new Set();
const activity=[]; // ponytail: session-only memory log; persist server-side if audit history is needed.

function status(t,err=false){if($('#locked').open)$('#gate-feedback').textContent=err?t:'';const el=$('#status');el.textContent=t;el.className='save-toast '+(err?'error':t.startsWith('✓')?'success':'')}
function log(t,err=false){activity.unshift({t,err,at:new Date()});renderActivity()}
function done(t){status(t);log(t)}function fail(e){status(e.message,true);log(e.message,true)}
const scope=()=> 'global';
function esc(s){const d=document.createElement('span');d.textContent=s==null?'':String(s);return d.innerHTML}

async function post(url,body={}){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,_csrf:csrf})});
  const data=await res.json();if(!res.ok)throw Object.assign(new Error(data.error||'Gagal'),{forceRequired:data.forceRequired===true});return data}
async function getJson(url){const res=await fetch(url);const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data}
async function busy(btn,msg,fn){btn.disabled=true;show($('#progress'));status(msg);try{await fn()}catch(e){fail(e)}finally{btn.disabled=false;show($('#progress'),false)}}
const confirmGlobal=what=>scope()!=='global'||confirm(`${what} ke scope GLOBAL: semua project terdampak. Lanjutkan?`);

// ─ Logo fallback: monogram jujur, bukan kotak kosong ─
$$('.logo-box img').forEach(img=>{const mark=()=>img.closest('.logo-box').classList.add('img-failed');
  img.addEventListener('error',mark);if(img.complete&&!img.naturalWidth)mark()});

// ─ Navigation ─
function go(page){if(!PAGES[page])page='home';$$('[data-page]').forEach(b=>b.dataset.page===page?b.setAttribute('aria-current','page'):b.removeAttribute('aria-current'));
  Object.keys(PAGES).forEach(p=>show($('#page-'+p),p===page));$('#crumb').textContent='Workspace / '+PAGES[page];
  if(location.hash!=='#'+page)history.replaceState(null,'','#'+page);closeNav();syncFx(page);if(page==='status'&&csrf){loadStatus();loadTargets()}}
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
function closeCheck(){for(const id of ['#restart-confirm','#force-confirm']){const d=$(id);d.returnValue='cancel';if(d.open)d.close()}if($('#check-panel').open)$('#check-panel').close()}
function showLocked(){resetGithub();closeCheck();resetLocalSkills();resetLocalMcp();csrf='';lastStatus=null;selectedSkills.clear();activity.length=0;repoCache=null;catalog={skills:[],mcpServers:[]};renderActivity();closeProfile();document.body.classList.add('auth-locked');if(!$('#locked').open)$('#locked').showModal();show($('#account'),false);show($('#content'));syncFx('');status('Login untuk mengakses katalog premium.')}
$('#locked').addEventListener('cancel',e=>e.preventDefault());
document.body.classList.add('auth-locked');$('#locked').showModal();
$('#login').onclick=()=>busy($('#login'),'Membuka login…',async()=>{const{url}=await post('/api/auth/login');location.href=url});
$('#logout').onclick=()=>busy($('#logout'),'Logout…',async()=>{await post('/api/auth/logout');showLocked();status('Berhasil logout.')});
$$('input[name=scope]').forEach(r=>r.onchange=()=>{resetGithub();closeCheck();resetLocalSkills();resetLocalMcp();repoCache=null;log('Scope diubah ke '+scope()+'.');loadStatus();loadTargets()});

// ─ Skills ─
function item(tag,html,ctrl){const el=document.createElement(tag);el.className='item';const d=document.createElement('div');d.innerHTML=html;ctrl&&el.append(ctrl);el.append(d);return el}
function renderSkills(){const q=$('#search').value.toLowerCase(),installed=new Set((lastStatus&&lastStatus.scope===scope()&&lastStatus.skills||[]).map(s=>s.id));
  const rows=catalog.skills.filter(s=>`${s.id} ${s.description} ${s.source}`.toLowerCase().includes(q));
  $('#skills').replaceChildren(...rows.map(s=>item('label',`<strong>${esc(s.id)}</strong>${installed.has(s.id)?'<span class="pill ok">TERPASANG · '+esc(lastStatus.scope.toUpperCase())+'</span>':'<span class="pill">BELUM TERPASANG · '+esc(scope().toUpperCase())+'</span>'}<small>${esc(s.source)}</small><span class="muted">${esc(s.description)}</span>`,Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:selectedSkills.has(s.id),onchange:e=>e.target.checked?selectedSkills.add(s.id):selectedSkills.delete(s.id)}))));
  if(!rows.length)$('#skills').textContent='Skill tidak ditemukan.'}
$('#search').addEventListener('input',renderSkills);
$('#side-search').addEventListener('input',e=>{$('#search').value=e.target.value;go('skills');renderSkills()});
$('#home-search').addEventListener('input',e=>{$('#search').value=e.target.value;renderSkills()});
$('#home-search').addEventListener('change',()=>go('skills'));
$('#install-skills').onclick=()=>{const ids=[...selectedSkills];if(!ids.length)return status('Pilih minimal satu skill.',true);if(!confirmGlobal('Install skill'))return;
  busy($('#install-skills'),'Menginstal skill…',async()=>{const r=await post('/api/install',{scope:scope(),skillIds:ids,confirmGlobal:scope()==='global'});done(`✓ ${r.installed} salinan terpasang, ${r.skipped} dilewati (${scope()}). Reload Antigravity.`);await loadStatus()})};

// ─ MCP ─
function renderMcp(){const conf=new Set((lastStatus&&lastStatus.scope===scope()&&lastStatus.mcp.servers||[]).map(s=>s.name));
  $('#mcp').replaceChildren(...catalog.mcpServers.map(m=>{const b=Object.assign(document.createElement('button'),{type:'button',textContent:'Daftarkan',className:'secondary'});
  b.onclick=()=>{if(!confirmGlobal('Daftarkan MCP '+m.id))return;busy(b,'Mendaftarkan MCP…',async()=>{const r=await post('/api/mcp',{scope:scope(),id:m.id,confirm:true,confirmGlobal:scope()==='global'});
    const diff=$('#mcp-diff');if(diff){diff.innerHTML=`<strong>Perubahan mcp_config.json</strong><div>${esc(r.config)}</div><small>Ditambahkan: ${esc((r.added||[]).join(', ')||'—')}${r.updated&&r.updated.length?' · diperbarui: '+esc(r.updated.join(', ')):''} · total server: ${esc(String((r.servers||[]).length))}${r.backup?' · backup: '+esc(r.backup):' · file baru, tanpa backup'}</small>`;show(diff)}
    done('✓ '+r.message);await loadStatus();await loadTargets()})};
  const el=item('div',`<strong>${esc(m.label||m.id)}</strong>${conf.has(m.builtin?'santri-skills':m.id)?'<span class="pill ok">CONFIG ADA · '+esc(lastStatus.scope.toUpperCase())+'</span>':'<span class="pill">BELUM TERPASANG · '+esc(scope().toUpperCase())+'</span>'}<small>${esc(m.id)} · runtime belum diverifikasi</small><span class="muted">${esc(m.description)}</span>`);el.append(b);return el}));
  if(!catalog.mcpServers.length)$('#mcp').textContent='Tidak ada MCP di katalog.'}

// ─ Status Config (read from disk by server) ─
async function loadStatus(){if(!csrf)return;const requestedScope=scope();lastStatus=null;$('#stat-installed').textContent='—';$('#stat-config').textContent='Memeriksa config';$('#install-counts').innerHTML='<span>Skills <b>—</b></span><span>MCP <b>—</b></span>';$('#status-view').innerHTML='<div class="installation-column">Membaca Skills…</div><div class="installation-column">Membaca MCP…</div>';renderSkills();renderMcp();try{const result=await getJson('/api/status?scope='+encodeURIComponent(requestedScope));if(scope()!==requestedScope)return;lastStatus=result;renderStatus();return true}catch(e){$('#stat-config').textContent='Tidak diketahui';$('#status-view').innerHTML='<div class="installation-column error-state">Status tidak tersedia. Coba periksa ulang.</div>';fail(e);return false}}
function renderStatus(){const s=lastStatus;if(!s)return;const m=s.mcp,skillCount=s.skills.length,mcpCount=m.servers.length;
  const missingSkills=new Set(catalog.skills.filter(k=>!s.skills.some(x=>x.id===k.id)).map(k=>k.id)).size,missingMcp=catalog.mcpServers.filter(k=>!m.servers.some(x=>x.name===k.id)).length;
  const skillState=skillCount?`TERPASANG · ${s.scope.toUpperCase()} · ${skillCount}`:'BELUM TERPASANG';
  const mcpState=m.valid===false?'JSON RUSAK':mcpCount?`DIKONFIGURASI · ${mcpCount}`:m.exists?'BELUM DIKONFIGURASI':'FILE BELUM ADA';
  const column=(kind,label,tone,paths,items,help)=>`<article class="installation-column"><div class="installation-title"><span>${kind}</span><span class="pill ${tone}">${label}</span></div><div class="install-paths">${paths}</div>${items?`<ul>${items}</ul>`:''}<p>${help}</p></article>`;
  $('#status-view').innerHTML=
    column('Skills',skillState,skillCount?'ok':'bad',s.skillTargets.map(t=>`<code>${esc(t.dir)}</code><small>${t.exists?'Folder ditemukan':'Folder belum ada'}</small>`).join(''),
      s.skills.map(k=>`<li>${esc(k.id)}${k.managed&&!k.markerValid?' <em class="warn">marker rusak</em>':''}${k.managed?'':' <em>bukan milik santri-skills</em>'}</li>`).join(''),'Terpasang berarti SKILL.md ditemukan pada target scope aktif.')+
    column('MCP',mcpState,m.valid===false||!mcpCount?'bad':'ok',`<code>${esc(m.configFile)}</code><small>${m.exists?(m.valid===false?'File ditemukan, tetapi JSON tidak valid':'File konfigurasi ditemukan'):'File akan dibuat saat MCP didaftarkan'}</small>`,
      m.servers.map(x=>`<li>${esc(x.name)} <em>dikonfigurasi, runtime belum diverifikasi</em></li>`).join(''),'Dikonfigurasi berarti nama server ada di mcpServers; koneksi belum diuji.');
  $('#install-counts').innerHTML=`<span>Skills <b>${skillCount} terpasang · ${missingSkills} belum</b></span><span>MCP <b>${mcpCount} dikonfigurasi · ${missingMcp} belum</b></span>`;
  $('#stat-installed').textContent=skillCount;$('#stat-config').textContent=m.valid===false?'Config error':mcpCount?'MCP dikonfigurasi':'MCP belum dikonfigurasi';renderSkills();renderMcp()}
$('#refresh-status').onclick=()=>busy($('#refresh-status'),'Membaca status dari disk…',async()=>{if(await loadStatus())done('✓ Status '+scope()+' diperbarui.')});

$$('.copy-btn').forEach(btn=>btn.onclick=async()=>{try{await navigator.clipboard.writeText(btn.dataset.copy);const old=btn.textContent;btn.textContent='Tersalin';setTimeout(()=>btn.textContent=old,1400)}catch{status('Gagal menyalin. Pilih teks lalu salin manual.',true)}});

// ─ Repositories ─
function renderSources(){const by={};catalog.skills.forEach(s=>by[s.source]=(by[s.source]||0)+1);
  $('#repo-sources').replaceChildren(...Object.entries(by).map(([k,n])=>item('div',`<strong>${esc(k)}</strong><small>${n} skill</small>`)));
  if(!Object.keys(by).length)$('#repo-sources').textContent='Belum ada sumber.'}


// GitHub preview uses immutable server-held bytes; never executes repository code.
let githubGeneration=0;
function resetGithub(){githubGeneration++;repoCache=null;$('#repo-results').replaceChildren();show($('#install-repo'),false)}
$('#repo-url').addEventListener('input',resetGithub);
async function previewGithubUi(url){resetGithub();const generation=githubGeneration,wanted=scope();const r=await post('/api/github/preview',{url,scope:wanted});if(generation!==githubGeneration||scope()!==wanted)throw new Error('Sumber/scope berubah. Preview ulang.');repoCache=r;
 $('#repo-targets').textContent=`${r.repo}@${r.branch} — ${r.scope}. Skills: ${r.targets.skillsDirs.join(', ')}. MCP: ${r.targets.mcpFile}`;
 const rows=[...r.skills.map(s=>({kind:'skill',id:s.id,name:s.name,path:s.path,dest:r.targets.skillsDirs.map(d=>d+'/'+s.id+'/SKILL.md').join(', ')})),...r.mcp.flatMap(m=>m.names.map(n=>({kind:'mcp',id:n,name:n,path:m.path,dest:r.targets.mcpFile})))];
 $('#repo-results').replaceChildren(...rows.map(s=>{const cb=Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:false});cb.dataset.kind=s.kind;return item('label',`<strong>${esc(s.kind)} · ${esc(s.name)}</strong><small>${esc(s.path)}</small><small>Ditulis ke: ${esc(s.dest)}</small>`,cb)}));
 $('#repo-install-docs').textContent='Perintah README — teks saja, tinjau sebelum menyalin; tidak pernah dijalankan otomatis.\n'+(r.installCommands.join('\n')||'Perintah install tidak ditemukan. Baca README repo.');show($('#repo-install-docs'));show($('#install-repo'));go('repos');return r;
}
$('#preview-repo').onclick=()=>busy($('#preview-repo'),'Membaca GitHub…',()=>previewGithubUi($('#repo-url').value.trim()));
async function installGithubUi(skillIds,mcpNames){const p=repoCache;if(!p||p.scope!==scope())throw new Error('Preview ulang pada scope aktif.');if(!skillIds.length&&!mcpNames.length)throw new Error('Pilih minimal satu item.');if(!confirm(`Install ${skillIds.join(', ')} ${mcpNames.join(', ')} pada scope ${p.scope}? Config MCP dapat dijalankan oleh Antigravity setelah reload. Hanya pilih repo yang dipercaya.`))return;if(!confirmGlobal('Install repo'))return;
 const r=await post('/api/github/install',{previewId:p.previewId,previewHash:p.previewHash,sourceUrl:p.sourceUrl,scope:p.scope,skillIds,mcpNames,confirm:true,confirmGlobal:p.scope==='global'});resetGithub();
 const report=[r.skills?`${r.skills.installed} SKILL.md ditulis.`:'',...(r.mcp?r.mcp.added.map(s=>`${s.name}: ${s.config}; runtime ${s.runtime}. ${s.note}`):[]),r.warning||'',r.installCommands.length?'Perintah README (TEKS SAJA): '+r.installCommands.join(' | '):'Perintah install tidak ditemukan; baca README repo.'].filter(Boolean).join('\n');$('#repo-installed').textContent=report;status(r.partial?'Config ditulis; runtime belum siap.':'File ditulis; koneksi MCP belum diuji.',!!r.partial);await loadStatus();return r;
}
$('#install-repo').onclick=()=>busy($('#install-repo'),'Menulis pilihan…',()=>installGithubUi($$('#repo-results input:checked').filter(x=>x.dataset.kind==='skill').map(x=>x.value),$$('#repo-results input:checked').filter(x=>x.dataset.kind==='mcp').map(x=>x.value)));
$('#check-test').onclick=()=>busy($('#check-test'),'Memeriksa disk dan PATH…',async()=>{const wanted=scope(),dlg=$('#check-panel');$('#check-summary').textContent='Memeriksa scope '+wanted+'…';$('#check-results').innerHTML='';$('#check-targets').textContent='';$('#check-counts').textContent='';show($('#force-antigravity'),false);$('#control-feedback').textContent='';dlg.showModal();let r;try{r=await post('/api/verify',{scope:wanted,skillIds:[...selectedSkills]})}catch(e){$('#check-summary').textContent='Pemeriksaan gagal: '+e.message;throw e}if(scope()!==wanted)return closeCheck();renderCheck(r);});
function renderCheck(r){
 const skillRows=r.skillChecks||r.skills.map(s=>({...s,exists:true,path:s.dir+'/SKILL.md'})),mcpRows=r.mcpChecks||r.mcp.servers;
 const skillCount=skillRows.filter(s=>s.exists).length,configCount=mcpRows.filter(s=>s.configured).length;
 $('#check-summary').textContent=`${r.scope==='global'?'Global semua workspace':'Project saat ini'} · IDE BELUM TERVERIFIKASI · Python ${r.python}. ${r.note}`;
 $('#check-targets').innerHTML=`<strong>Target aktif · ${esc(r.scope.toUpperCase())}</strong>${r.skillTargets.map(s=>`<code>Skills: ${esc(s.dir)}/&lt;id&gt;/SKILL.md</code>`).join('')}<code>MCP: ${esc(r.mcp.configFile)}</code><p>${r.scope==='project'?`Hanya dimuat ketika workspace ${esc(r.workspace)} dibuka di IDE. Bukan semua workspace.`:'Global Antigravity Library · semua workspace. santri-skills hanya muncul jika terpasang pada scope Global; salinan .agents Project tidak masuk daftar global IDE.'}</p>`;
 $('#check-counts').innerHTML=`<span>Skills <b>${skillCount} file ada · ${skillRows.length-skillCount} belum terpasang</b></span><span>MCP <b>${configCount} config ada · ${mcpRows.length-configCount} belum terpasang</b></span><span>IDE <b>0 terverifikasi</b></span>`;
 const pill=(text,ok=false)=>`<span class="pill ${ok?'ok':''}">${text}</span>`;
 const row=(name,badges,note)=>`<li><strong>${esc(name)}</strong><div>${badges}${pill('IDE BELUM TERVERIFIKASI')}</div><small>${esc(note)}</small></li>`;
 $('#check-results').innerHTML=`<article class="installation-column"><h3>Skills · ${skillRows.length}</h3><ul>${skillRows.map(s=>row(s.id,pill(s.exists?'FILE ADA':'BELUM TERPASANG',s.exists),s.path)).join('')||'<li>Tidak ada kandidat Skills.</li>'}</ul></article><article class="installation-column"><h3>MCP · ${mcpRows.length}</h3><p>${pill(r.mcp.valid===false?'JSON RUSAK':r.mcp.exists?'CONFIG ADA':'CONFIG BELUM ADA',r.mcp.exists&&r.mcp.valid)}</p><ul>${mcpRows.map(s=>row(s.name,pill(s.configured?'CONFIG ADA':'BELUM TERPASANG',s.configured)+pill(!s.configured?'RUNTIME BELUM DIUJI':s.available===true?'RUNTIME SIAP':s.available===false||s.launcherAvailable===false?'RUNTIME HILANG':'RUNTIME BELUM DIUJI',s.configured&&s.available===true),(s.kind?`${s.kind} · `:'')+(s.runtime||'')+' · '+(s.note||'Config dan PATH tidak membuktikan koneksi IDE.'))).join('')||'<li>Tidak ada kandidat MCP.</li>'}</ul></article>`;
}
$('#close-check').onclick=closeCheck;
$('#open-antigravity').onclick=()=>busy($('#open-antigravity'),'Membuka Antigravity IDE…',async()=>{await post('/api/antigravity/control',{action:'launch'});$('#control-feedback').textContent='Permintaan buka berhasil.';done('Permintaan buka dikirim; periksa Antigravity IDE.')});
$('#restart-antigravity').onclick=()=>{$('#restart-confirm').returnValue='cancel';$('#restart-confirm').showModal()};
async function restartIde(force){const button=force?$('#force-antigravity'):$('#restart-antigravity');await busy(button,force?'Memaksa restart Antigravity IDE…':'Meminta restart Antigravity IDE…',async()=>{try{await post('/api/antigravity/control',{action:'restart',confirmClose:true,force,confirmForce:force});show($('#force-antigravity'),false);$('#control-feedback').textContent='Restart selesai. Verifikasi runtime dengan memanggil santrihub_status di chat IDE.';done('Restart selesai; verifikasi tool MCP di IDE.')}catch(e){if(!force&&e.forceRequired){show($('#force-antigravity'));$('#control-feedback').textContent=e.message+' Paksa restart tersedia hanya setelah kegagalan graceful.';}throw e}})}
$('#restart-confirm').addEventListener('close',()=>{if($('#restart-confirm').returnValue==='confirm')restartIde(false)});
$('#force-antigravity').onclick=()=>{$('#force-confirm').returnValue='cancel';$('#force-confirm').showModal()};
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
function renderTargets(){const d=targets;if(!d)return;
  const badge=$('#target-badge');
  badge.textContent=d.antigravityDetected?'TERDETEKSI':'TIDAK TERDETEKSI';
  badge.className='pill '+(d.antigravityDetected?'ok':'bad');
  const app=d.applicationDetected?`Aplikasi Antigravity ditemukan di ${d.applicationEvidence.join(', ')}.`:'Aplikasi Antigravity tidak terlihat di lokasi install standar.';
  const cfg=d.configEvidence.length?('Bukti konfigurasi: '+d.configEvidence.join(' · ')):'Tidak ada bukti konfigurasi Antigravity di luar repo ini.';
  $('#target-detection').textContent=`${cfg} ${app}${d.envOverride?' Override env aktif: '+d.envOverride+'.':''}`;
  const eff=d.effective[scope()];
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
  busy($('#validate-custom'),'Memvalidasi path di server…',async()=>{const r=await post('/api/targets/custom',{confirm:true,skillsDir:skillsDir||undefined,mcpFile:mcpFile||undefined});
    $('#target-checks').innerHTML=r.checks.map(c=>`<div class="check-row"><strong>${esc(c.kind)} · ${c.exists?'ADA':'BELUM ADA'} · ${c.writable?'WRITABLE':'TIDAK WRITABLE'}</strong><div>${esc(c.path)}</div><small>${esc(c.evidence.join(' · '))}</small></div>`).join('');
    done('✓ Target kustom aktif (hanya di memori proses).');await loadTargets();await loadStatus()})};
$('#reset-custom').onclick=()=>busy($('#reset-custom'),'Mereset target…',async()=>{await post('/api/targets/custom',{confirm:true,reset:true});$('#target-checks').innerHTML='';done('✓ Target kembali ke hasil deteksi.');await loadTargets();await loadStatus()});
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
  renderSkills();renderMcp();renderSources();await loadTargets();done(`✓ ${catalog.skills.length} skill, ${catalog.mcpServers.length} MCP.`);await loadStatus()}catch(e){fail(e)}finally{show($('#progress'),false)}}

(async()=>{renderActivity();go(location.hash.slice(1)||'home');if(await checkSession()){log('Login terverifikasi.');await loadCatalog()}else showLocked()})();
