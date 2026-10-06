'use strict';
const chooser=document.querySelector('#add-chooser'),wizard=document.querySelector('#install-wizard');
const w=id=>document.querySelector('#'+id);
const REACT_BITS_URL='https://reactbits.dev/get-started/mcp';
let wizardSource='github',wizardKind='skills',wizardPreview=null,wizardStep=0,pollTimer=null,wizardBusy=false,wizardEpoch=0,proofEpoch=0,proofVerified=false;
function stopPoll(){clearTimeout(pollTimer);pollTimer=null;proofEpoch++}
function friendlyError(error){
  const message=String(error?.message||'Operasi gagal.');
  if(/github\.com|URL|HTTPS/i.test(message)&&!/fetch|connect|timeout/i.test(message))return 'Gunakan URL HTTPS github.com yang valid, lalu preview ulang.';
  if(/fetch|connect|timeout|ENOTFOUND|ECONN|alamat|private|loopback|DNS|IP|network/i.test(message))return 'Repository belum dapat diakses dengan aman. Periksa URL dan koneksi, lalu coba Preview lagi.';
  if(/preview|expired|kedaluwarsa|berubah|hash/i.test(message))return 'Preview tidak lagi valid. Kembali ke Configuration dan preview ulang sebelum memasang.';
  return message.replace(/https?:\/\/\S+|\b(?:\d{1,3}\.){3}\d{1,3}\b/g,'[alamat]').slice(0,220);
}
function feedback(message='',error=false,id='wizard-feedback'){const el=w(id);el.textContent=message;el.dataset.error=String(error)}
function selectedIds(){return [...document.querySelectorAll('#wizard-results input:checked')].map(x=>x.value)}
function syncWizard(){
  const count=selectedIds().length,total=document.querySelectorAll('#wizard-results input').length;
  w('wizard-count').textContent=`${count} dari ${total} dipilih`;
  w('wizard-selection').hidden=!total;
  wizard.querySelectorAll('button,input').forEach(el=>el.disabled=wizardBusy);
  w('wizard-next').disabled=wizardBusy||(wizardStep===0&&(!wizardPreview||!count))||(wizardStep===1&&(!wizardPreview||!count||!w('wizard-trust').checked));
  w('wizard-back').hidden=wizardStep!==1;
  w('wizard-cancel').hidden=wizardStep===3;
  w('wizard-all').disabled=wizardBusy||count===total;
  w('wizard-none').disabled=wizardBusy||count===0;
  wizard.setAttribute('aria-busy',String(wizardBusy));
}
function setWizardBusy(value,label=''){wizardBusy=value;w('wizard-loading').hidden=!value;w('wizard-loading-label').textContent=label;syncWizard()}
function wizardState(step,message='',focus=true){
  wizardStep=step;w('wizard-stage').textContent=['Configuration','Activation','Verification','Done'][step];feedback(message);
  w('wizard-next').textContent=['Activation','Install terkonfirmasi','Selesai tanpa klaim runtime','Tutup'][step];
  for(const [id,index] of [['wizard-config',0],['wizard-trust-row',1],['wizard-verify',2],['wizard-success',3]])w(id).hidden=step!==index;
  wizard.querySelectorAll('.wizard-stepper li').forEach((el,index)=>{const completed=index<step&&(index!==2||proofVerified);el.classList.toggle('completed',completed);index===step?el.setAttribute('aria-current','step'):el.removeAttribute('aria-current');el.querySelector('span').textContent=completed?'✓':String(index+1)});
  w('wizard-body').scrollTop=0;syncWizard();if(focus&&wizard.open)w('wizard-stage').focus();
}
function invalidatePreview(){wizardPreview=null;w('wizard-results').replaceChildren();w('wizard-registry').hidden=true;w('wizard-trust').checked=false;w('wizard-trust-hint').textContent='Install terkonfirmasi aktif setelah kotak ini dicentang.';syncWizard()}
// Website mode is a fixed allowlist preset: no arbitrary URL, no page fetch, no command run here.
function applySource(){
  const website=wizardSource==='website';invalidatePreview();feedback();
  w('wizard-url').readOnly=website;w('wizard-url').value=website?REACT_BITS_URL:'';
  w('wizard-source-note').textContent=website?'Preset resmi React Bits saja. Halaman web tidak diambil dan tidak ada perintah dijalankan saat preview.':'GitHub: preview tanpa menjalankan script repository.';
}
for(const value of ['github','website'])w('wizard-source-'+value).onchange=()=>{if(wizardBusy)return;wizardSource=value;applySource()};
function openWizard(kind){
  if(wizardBusy)return;wizardEpoch++;wizardKind=kind;stopPoll();proofVerified=false;chooser.close();invalidatePreview();
  wizardSource='github';w('wizard-source-github').checked=true;applySource();w('wizard-source-choice').hidden=kind!=='mcp';
  w('wizard-kind').textContent=(kind==='skills'?'SKILLS':'MCP SERVERS')+' · GLOBAL';w('wizard-title').textContent=kind==='skills'?'Tambah Skills':'Tambah MCP Servers';
  w('wizard-proof').textContent='Belum ada callback.';w('wizard-proof').classList.remove('proof-ok');wizardState(0,'',false);wizard.showModal();w('wizard-url').focus();
}
function closeWizard(){if(wizardBusy)return;wizard.close();w('add-item').focus()}
w('add-item').onclick=()=>chooser.showModal();document.querySelectorAll('[data-add-kind]').forEach(b=>b.onclick=()=>openWizard(b.dataset.addKind));w('close-chooser').onclick=()=>chooser.close();
w('wizard-close').onclick=closeWizard;w('wizard-cancel').onclick=closeWizard;
wizard.addEventListener('cancel',e=>{if(wizardBusy)e.preventDefault()});wizard.addEventListener('close',()=>{wizardEpoch++;stopPoll();w('add-item').focus()});
w('wizard-url').addEventListener('input',()=>{if(!wizardBusy){invalidatePreview();feedback()}});
w('wizard-results').addEventListener('change',()=>{w('wizard-trust').checked=false;syncWizard()});w('wizard-trust').addEventListener('change',syncWizard);
w('wizard-registry-copy').onclick=async()=>{try{await navigator.clipboard.writeText(w('wizard-registry-json').textContent);feedback('Registry disalin. Tempel/merge ke components.json pada setiap project.')}catch{feedback('Clipboard ditolak. Salin blok registry secara manual.',true)}};
for(const [id,checked] of [['wizard-all',true],['wizard-none',false]])w(id).onclick=()=>{if(wizardBusy)return;document.querySelectorAll('#wizard-results input').forEach(el=>el.checked=checked);w('wizard-trust').checked=false;syncWizard()};
w('wizard-back').onclick=()=>{if(!wizardBusy&&wizardStep===1)wizardState(0)};
w('wizard-source-form').onsubmit=async event=>{
  event.preventDefault();if(wizardBusy||wizardStep!==0)return;
  const epoch=wizardEpoch;invalidatePreview();feedback();setWizardBusy(true,'Membaca repository dan menyiapkan preview…');
  try{
    const website=wizardKind==='mcp'&&wizardSource==='website';
    const preview=website?await post('/api/website/preview',{url:w('wizard-url').value,scope:'global'}):await post('/api/github/preview',{url:w('wizard-url').value.trim(),scope:'global'});if(epoch!==wizardEpoch||!wizard.open)return;
    wizardPreview=preview;const rows=website?[{id:preview.name,path:preview.target}]:wizardKind==='skills'?preview.skills.map(s=>({id:s.id,path:s.path})):preview.mcp.flatMap(m=>m.names.map(id=>({id,path:m.path})));
    if(website){w('wizard-registry').hidden=false;w('wizard-registry-json').textContent=JSON.stringify(preview.registry,null,2);w('wizard-preset-config').textContent=JSON.stringify({mcpServers:{shadcn:preview.entry}},null,2);w('wizard-trust-hint').textContent=preview.warning;}
    w('wizard-results').innerHTML=rows.map(s=>`<label class="item"><input type="checkbox" value="${esc(s.id)}"><span><strong>${esc(s.id)}</strong><small>${esc(s.path)}</small></span></label>`).join('');
    feedback(rows.length?'Preview siap. Pilih item untuk melanjutkan.':'Tidak ada item jenis ini. Coba repository lain.');
  }catch(e){if(epoch===wizardEpoch)feedback(friendlyError(e),true)}finally{if(epoch===wizardEpoch)setWizardBusy(false)}
};
async function pollProof(epoch=proofEpoch){
  if(!wizard.open||wizardStep!==2||epoch!==proofEpoch)return;
  try{
    const proof=await getJson('/api/verification/status');if(!wizard.open||wizardStep!==2||epoch!==proofEpoch)return;
    proofVerified=proof.verified;w('wizard-proof').textContent=proof.verified?'Bridge MCP santri-skills dimuat · '+proof.evidence.event+' · identitas IDE tidak diautentikasi. MCP lain dan Skills belum terbukti dimuat IDE.':proof.pending?'Menunggu callback bridge MCP (maksimal 5 menit)…':'Callback kedaluwarsa / berubah. Mulai lagi.';
    w('wizard-proof').classList.toggle('proof-ok',proof.verified);if(!proof.pending)return;
  }catch(e){if(epoch===proofEpoch)w('wizard-proof').textContent=friendlyError(e);return}
  pollTimer=setTimeout(()=>pollProof(epoch),1500);
}
w('wizard-start-proof').onclick=async()=>{
  if(wizardBusy||wizardStep!==2)return;const epoch=wizardEpoch;stopPoll();proofVerified=false;w('wizard-proof').classList.remove('proof-ok');setWizardBusy(true,'Menyiapkan callback bridge…');
  try{await post('/api/verification/start',{scope:'global'});if(epoch===wizardEpoch)await pollProof()}catch(e){if(epoch===wizardEpoch)w('wizard-proof').textContent=friendlyError(e)}finally{if(epoch===wizardEpoch)setWizardBusy(false)}
};
w('wizard-open-ide').onclick=async()=>{
  if(wizardBusy)return;const epoch=wizardEpoch;setWizardBusy(true,'Meminta IDE dibuka…');
  try{await post('/api/antigravity/control',{action:'launch'});if(epoch===wizardEpoch)w('wizard-proof').textContent='Buka diminta. Bukan bukti koneksi.'}catch(e){if(epoch===wizardEpoch)w('wizard-proof').textContent=friendlyError(e)}finally{if(epoch===wizardEpoch)setWizardBusy(false)}
};
w('wizard-restart-ide').onclick=()=>{if(!wizardBusy){w('restart-confirm').returnValue='cancel';w('restart-confirm').showModal()}};
w('wizard-next').onclick=async()=>{
  if(wizardBusy||w('wizard-next').disabled)return;const epoch=wizardEpoch;
  try{
    if(wizardStep===0){if(!wizardPreview||!selectedIds().length)return;w('wizard-review').textContent=`${selectedIds().length} ${wizardKind==='skills'?'Skills':'MCP Servers'} dipilih · ${selectedIds().join(', ')}`;w('wizard-targets').textContent=wizardPreview.source==='website-preset'?'Target MCP global:\n'+wizardPreview.target:wizardKind==='skills'?'Target Skills global:\n'+wizardPreview.targets.skillsDirs.join('\n'):'Target MCP global:\n'+wizardPreview.targets.mcpFile;wizardState(1,wizardPreview.warning||'Hanya repo dipercaya. Semua workspace terdampak.');return}
    if(wizardStep===1){
      if(!wizardPreview||!w('wizard-trust').checked)return;setWizardBusy(true,'Memasang pilihan ke target global…');feedback();const ids=selectedIds(),p=wizardPreview;
      if(p.source==='website-preset')await post('/api/website/install',{scope:'global',url:p.url,previewId:p.previewId,confirm:true,confirmGlobal:true,consentNetworkExecution:true});
      else await post('/api/github/install',{scope:'global',confirm:true,confirmGlobal:true,previewId:p.previewId,previewHash:p.previewHash,sourceUrl:p.sourceUrl,skillIds:wizardKind==='skills'?ids:[],mcpNames:wizardKind==='mcp'?ids:[]});
      if(epoch!==wizardEpoch)return;
      // Installation already committed: never offer another install if status refresh fails.
      wizardState(2,'Config ditulis. File bukan bukti IDE memuatnya. Pasang MCP resmi santri-skills untuk callback.');await loadStatus();return;
    }
    if(wizardStep===2){stopPoll();w('wizard-success-proof').textContent=proofVerified?w('wizard-proof').textContent:'Runtime belum diverifikasi. Instalasi disk selesai; belum ada bukti callback bridge.';wizardState(3,'Operasi selesai. Status runtime hanya sesuai bukti callback, bukan keberhasilan menulis config.');return}
    closeWizard();
  }catch(e){if(epoch===wizardEpoch)feedback(friendlyError(e),true)}finally{if(epoch===wizardEpoch)setWizardBusy(false)}
};
const uninstallDialog=w('uninstall-dialog');let uninstallItem=null,uninstallBusy=false,uninstallEpoch=0,uninstallTrigger=null;
function uninstallState(step){uninstallDialog.querySelectorAll('.uninstall-steps li').forEach((el,index)=>index===step?el.setAttribute('aria-current','step'):el.removeAttribute('aria-current'))}
function askUninstall(kind,id){
  if(uninstallBusy)return;uninstallEpoch++;uninstallItem={kind,id};uninstallTrigger=document.activeElement;w('uninstall-title').textContent=`Uninstall ${kind==='skill'?'Skill':'MCP Server'}`;
  w('uninstall-description').textContent=`Hapus ${id} dari target GLOBAL? Semua workspace terdampak. File/config yang bukan milik SantriHub ditolak. Backup MCP dipertahankan.`;feedback('',false,'uninstall-feedback');uninstallState(0);uninstallDialog.showModal();w('uninstall-cancel').focus();
}
function closeUninstall(){if(!uninstallBusy)uninstallDialog.close()}
w('uninstall-cancel').onclick=closeUninstall;w('uninstall-close').onclick=closeUninstall;uninstallDialog.addEventListener('cancel',e=>{if(uninstallBusy)e.preventDefault()});
w('uninstall-confirm').onclick=async()=>{
  if(uninstallBusy||!uninstallItem||w('uninstall-confirm').hidden)return;const epoch=uninstallEpoch;uninstallBusy=true;uninstallState(1);uninstallDialog.setAttribute('aria-busy','true');uninstallDialog.querySelectorAll('button').forEach(el=>el.disabled=true);w('uninstall-loading').hidden=false;feedback('',false,'uninstall-feedback');
  try{
    const r=await post('/api/uninstall',{...uninstallItem,scope:'global',confirm:true,confirmGlobal:true});if(epoch!==uninstallEpoch)return;
    // Removal committed; refresh failure must not re-enable destructive submission.
    w('uninstall-confirm').hidden=true;w('uninstall-cancel').textContent='Done';uninstallState(2);feedback('Selesai. '+(r.backup?'Backup: '+r.backup:'Item milik SantriHub telah dihapus.'),false,'uninstall-feedback');await loadStatus();
  }catch(e){if(epoch===uninstallEpoch){uninstallState(0);feedback(friendlyError(e),true,'uninstall-feedback')}}finally{if(epoch===uninstallEpoch){uninstallBusy=false;uninstallDialog.setAttribute('aria-busy','false');w('uninstall-loading').hidden=true;uninstallDialog.querySelectorAll('button').forEach(el=>el.disabled=false);w('uninstall-cancel').focus()}}
};
uninstallDialog.addEventListener('close',()=>{uninstallEpoch++;uninstallItem=null;w('uninstall-confirm').hidden=false;w('uninstall-cancel').textContent='Batal';const target=uninstallTrigger?.isConnected?uninstallTrigger:w(uninstallTrigger?.closest('#installed-mcp')?'installed-mcp':'installed-skills').closest('.page').querySelector('h1');if(target.tagName==='H1')target.tabIndex=-1;requestAnimationFrame(()=>target.focus())});
function renderInstalled(){for(const [kind,selector,rows] of [['skill','#installed-skills',lastStatus?.skills||[]],['mcp','#installed-mcp',lastStatus?.mcp.servers||[]]]){const host=document.querySelector(selector);host.replaceChildren(...rows.map(row=>{const el=document.createElement('article');el.className='item';const text=document.createElement('div');text.textContent=(row.id||row.name)+' · '+(kind==='skill'?'File terpasang; IDE belum diketahui':'Config ada; runtime belum diketahui');el.append(text);if(row.managed&&(kind!=='skill'||row.markerValid)){const b=document.createElement('button');b.className='secondary';b.textContent='Uninstall';b.onclick=()=>askUninstall(kind,row.id||row.name);el.append(b)}return el}));if(!rows.length)host.textContent='Belum terpasang.'}}
const priorRenderStatus=renderStatus;renderStatus=function(){priorRenderStatus();renderInstalled()};
const priorShowLocked=showLocked;showLocked=function(){wizardEpoch++;uninstallEpoch++;stopPoll();wizardBusy=false;uninstallBusy=false;setWizardBusy(false);w('uninstall-loading').hidden=true;uninstallDialog.querySelectorAll('button').forEach(el=>el.disabled=false);if(wizard.open)wizard.close();if(chooser.open)chooser.close();if(uninstallDialog.open)uninstallDialog.close();uninstallItem=null;w('installed-skills').textContent='Belum terpasang.';w('installed-mcp').textContent='Belum terpasang.';priorShowLocked()};
