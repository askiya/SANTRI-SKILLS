const $ = (s) => document.querySelector(s);
let catalog = { skills: [], mcpServers: [] };
const scope = () => document.querySelector('input[name=scope]:checked').value;
const status = (text, error = false) => { $('#status').textContent = text; $('#status').className = error ? 'error' : ''; };
async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Gagal');
  return data;
}
function renderSkills() {
  const q = $('#search').value.toLowerCase();
  const rows = catalog.skills.filter((s) => `${s.id} ${s.description}`.toLowerCase().includes(q));
  $('#skills').replaceChildren(...rows.map((s) => {
    const label = document.createElement('label'); label.className = 'item';
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: s.id });
    const text = document.createElement('span');
    text.append(Object.assign(document.createElement('strong'), { textContent: s.id }), Object.assign(document.createElement('small'), { className: 'tag', textContent: s.source }), document.createElement('br'), Object.assign(document.createElement('span'), { className: 'muted', textContent: s.description }));
    label.append(box, text); return label;
  }));
  if (!rows.length) $('#skills').textContent = 'Skill tidak ditemukan.';
}
function renderMcp() {
  $('#mcp').replaceChildren(...catalog.mcpServers.map((m) => {
    const card = document.createElement('div'); card.className = 'item';
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Daftarkan MCP' });
    button.onclick = async () => {
      if (!confirm(`Daftarkan ${m.id} ke Antigravity ${scope()}? Config lama dibackup.`)) return;
      button.disabled = true; status('Mendaftarkan MCP…');
      try { const r = await post('/api/mcp', { scope: scope(), id: m.id, confirm: true }); status(r.message); } catch (e) { status(e.message, true); } finally { button.disabled = false; }
    };
    card.append(Object.assign(document.createElement('div'), { innerHTML: '' }), button);
    card.firstChild.append(Object.assign(document.createElement('strong'), { textContent: m.label || m.id }), Object.assign(document.createElement('small'), { className: 'tag', textContent: m.id }), document.createElement('br'), Object.assign(document.createElement('span'), { className: 'muted', textContent: m.description }));
    return card;
  }));
}
$('#search').addEventListener('input', renderSkills);
$('#install-skills').addEventListener('click', async () => {
  const skillIds = [...document.querySelectorAll('#skills input:checked')].map((x) => x.value);
  if (!skillIds.length) return status('Pilih minimal satu skill.', true);
  $('#install-skills').disabled = true; status('Menginstal skill…');
  try { const r = await post('/api/install', { scope: scope(), skillIds }); status(`${r.installed} salinan terpasang, ${r.skipped} dilewati. Reload Antigravity.`); } catch (e) { status(e.message, true); } finally { $('#install-skills').disabled = false; }
});
fetch('/api/catalog').then((r) => r.json()).then((data) => { catalog = data; $('#workspace').textContent = data.cwd; $('#install-skills').disabled = false; renderSkills(); renderMcp(); }).catch((e) => status(e.message, true));
