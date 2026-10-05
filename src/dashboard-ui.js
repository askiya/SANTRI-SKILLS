'use strict';
const $=s=>document.querySelector(s),show=(el,v=true)=>{el.hidden=!v},status=(t,err=false)=>{const el=$('#status');el.textContent=t;el.className=err?'error':t.startsWith('✓')?'success':''};
const scope=()=>document.querySelector('input[name=scope]:checked').value;
let catalog={skills:[],mcpServers:[]},csrf='',repoCache=null;

async function post(url,body={}){
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,_csrf:csrf})});
  const data=await res.json();if(!res.ok)throw new Error(data.error||'Gagal');return data;}

// ─ Auth ─
async function checkSession(){
  try{const res=await fetch('/api/auth/status');const data=await res.json();if(!res.ok)throw new Error(data.error);csrf=data.csrf;showMember(data.user);return true}catch{return false}}
function showMember(u){$('#identity').textContent=u.name+(u.email?' · '+u.email:'');show($('#locked'),false);show($('#member'));show($('#content'));status('Premium aktif. Katalog siap.')}
function showLocked(){show($('#locked'));show($('#member'),false);show($('#content'),false);status('Login untuk mengakses katalog premium.')}

$('#login').onclick=async()=>{$('#login').disabled=true;status('Membuka login…');try{const{url}=await post('/api/auth/login');location.href=url}catch(e){status(e.message,true);$('#login').disabled=false}};
$('#logout').onclick=async()=>{try{await post('/api/auth/logout');showLocked();status('Berhasil logout.')}catch(e){status(e.message,true)}};

// ─ Tabs ─
['skills','mcp'].forEach(t=>$('#tab-'+t).onclick=()=>{['skills','mcp'].forEach(x=>{$('#tab-'+x).setAttribute('aria-pressed',x===t);show($('#'+x+'-panel'),x===t)})});

// ─ Skills ─
function renderSkills(){const q=$('#search').value.toLowerCase();const rows=catalog.skills.filter(s=>`${s.id} ${s.description}`.toLowerCase().includes(q));
$('#skills').replaceChildren(...rows.map(s=>{const l=document.createElement('label');l.className='item';const b=Object.assign(document.createElement('input'),{type:'checkbox',value:s.id});const d=document.createElement('div');d.innerHTML=`<strong>${esc(s.id)}</strong><small>${esc(s.source)}</small><span class="muted">${esc(s.description)}</span>`;l.append(b,d);return l}));
if(!rows.length)$('#skills').textContent='Skill tidak ditemukan.';}
$('#search').addEventListener('input',renderSkills);

$('#install-skills').onclick=async()=>{const ids=[...document.querySelectorAll('#skills input:checked')].map(x=>x.value);if(!ids.length)return status('Pilih minimal satu skill.',true);
if(scope()==='global'&&!confirm('Install ke scope GLOBAL: semua project terdampak. Lanjutkan?'))return;$('#install-skills').disabled=true;show($('#progress'));status('Menginstal skill…');
try{const r=await post('/api/install',{scope:scope(),skillIds:ids,confirmGlobal:scope()==='global'});status(`✓ ${r.installed} salinan terpasang, ${r.skipped} dilewati. Reload Antigravity.`)}catch(e){status(e.message,true)}finally{$('#install-skills').disabled=false;show($('#progress'),false)}};

// ─ MCP ─
function renderMcp(){$('#mcp').replaceChildren(...catalog.mcpServers.map(m=>{const c=document.createElement('div');c.className='item';const b=Object.assign(document.createElement('button'),{type:'button',textContent:'Daftarkan',className:'secondary'});
b.onclick=async()=>{if(scope()==='global'&&!confirm('Daftarkan MCP ke scope GLOBAL?'))return;b.disabled=true;show($('#progress'));status('Mendaftarkan MCP…');
try{const r=await post('/api/mcp',{scope:scope(),id:m.id,confirm:true,confirmGlobal:scope()==='global'});status(`✓ ${r.message}`)}catch(e){status(e.message,true)}finally{b.disabled=false;show($('#progress'),false)}};
const d=document.createElement('div');d.innerHTML=`<strong>${esc(m.label||m.id)}</strong><small>${esc(m.id)}</small><span class="muted">${esc(m.description)}</span>`;c.append(d,b);return c}));}

// ─ Repo preview/install ─
$('#preview-repo').onclick=async()=>{const url=$('#repo-url').value.trim();if(!url)return status('Masukkan URL repo GitHub.',true);
$('#preview-repo').disabled=true;show($('#progress'));status('Mengunduh dan memindai repo…');repoCache=null;$('#repo-results').replaceChildren();show($('#install-repo'),false);
try{const r=await post('/api/repo/preview',{url,branch:$('#repo-branch').value.trim()||undefined});repoCache={url,branch:r.branch,skills:r.skills};
$('#repo-results').replaceChildren(...r.skills.map(s=>{const l=document.createElement('label');l.className='item';const b=Object.assign(document.createElement('input'),{type:'checkbox',value:s.id,checked:true});const d=document.createElement('div');d.innerHTML=`<strong>${esc(s.id)}</strong><small>${esc(s.relative)} · ${Math.ceil(s.bytes/1024)}KB</small><span class="muted">${esc(s.description)}</span><pre style="max-height:100px;overflow:auto;font-size:11px;opacity:.55;margin:6px 0 0">${esc(s.preview.slice(0,400))}</pre>`;l.append(b,d);return l}));
if(r.mcpNote)status(r.mcpNote);else status(`✓ ${r.skills.length} SKILL.md ditemukan.`);show($('#install-repo'),r.skills.length>0);
}catch(e){status(e.message,true)}finally{$('#preview-repo').disabled=false;show($('#progress'),false)}};

$('#install-repo').onclick=async()=>{if(!repoCache)return;const ids=[...document.querySelectorAll('#repo-results input:checked')].map(x=>x.value);if(!ids.length)return status('Pilih minimal satu skill.',true);
if(scope()==='global'&&!confirm('Install repo skill ke scope GLOBAL?'))return;$('#install-repo').disabled=true;show($('#progress'));status('Menginstal dari repo…');
try{const r=await post('/api/repo/install',{url:repoCache.url,branch:repoCache.branch,scope:scope(),skillIds:ids,confirmGlobal:scope()==='global'});status(`✓ ${r.installed} skill terpasang dari ${r.repo}@${r.branch}.`)}catch(e){status(e.message,true)}finally{$('#install-repo').disabled=false;show($('#progress'),false)}};

// ─ Catalog load ─
async function loadCatalog(){show($('#progress'));status('Memuat katalog…');
try{const res=await fetch('/api/catalog');const r=await res.json();if(!res.ok)throw new Error(r.error||'Katalog gagal dimuat');catalog=r;$('#workspace').textContent=r.cwd;renderSkills();renderMcp();status(`✓ ${r.skills.length} skill, ${r.mcpServers.length} MCP.`)}catch(e){status(e.message,true)}finally{show($('#progress'),false)}}

function esc(s){const d=document.createElement('span');d.textContent=s;return d.innerHTML}

// Boot
(async()=>{if(await checkSession()){await loadCatalog()}else showLocked()})();
