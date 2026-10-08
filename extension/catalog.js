// extension/catalog.js – Catalog card rendering and status labels

const STATUS_LABELS = {
  not_installed: 'Belum dipasang',
  ready: 'Paket siap',
  installing: 'Menyiapkan di Gemini…',
  pending_confirm: 'Menunggu konfirmasi',
  confirmed: 'Dikonfirmasi member',
  detected: 'Terdeteksi di Gemini',
  update_available: 'Update tersedia',
  adapter_failed: 'Gagal otomatis',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

const INSTALL_LABELS = {
  detected: 'Pasang ulang',
  update_available: 'Update di Gemini',
};

const CHATGPT_LABELS = {
  not_installed: 'Pasang ke ChatGPT',
  detected: 'Pasang ulang ChatGPT',
  update_available: 'Update di ChatGPT',
};

/** One status line per target, e.g. "✓ Gemini · ✓ ChatGPT" or "Belum dipasang". */
function statusLine(gemini, chatgpt) {
  const parts = [];
  if (gemini === 'detected') parts.push('✓ Terdeteksi di Gemini');
  else if (gemini === 'update_available') parts.push('Gemini: update tersedia');
  if (chatgpt === 'detected') parts.push('✓ Terpasang di ChatGPT');
  else if (chatgpt === 'update_available') parts.push('ChatGPT: update tersedia');
  if (!parts.length) return { text: statusLabel(gemini), cls: gemini };
  const cls = [gemini, chatgpt].includes('update_available') ? 'update_available' : 'detected';
  return { text: parts.join(' · '), cls };
}

function renderCard(item) {
  item = { ...item, name: item.title || item.name, type: item.kind || item.type };
  const status = item.status || 'not_installed';
  const chatgptStatus = item.chatgptStatus || 'not_installed';
  const isGem = item.type === 'gem';
  const id = esc(item.id);
  const buttons = isGem
    ? `<button class="btn btn-gem" data-action="open" data-id="${id}">Buka Gem</button>
    <button class="btn btn-download" data-action="download" data-id="${id}">Download Paket</button>`
    : `<button class="btn btn-gemini" data-action="install" data-id="${id}">${INSTALL_LABELS[status] || 'Pasang ke Gemini'}</button>
    <button class="btn btn-chatgpt" data-action="install-chatgpt" data-id="${id}">${CHATGPT_LABELS[chatgptStatus] || CHATGPT_LABELS.not_installed}</button>
    <button class="btn btn-download wide" data-action="download" data-id="${id}">Download ZIP</button>`;
  const line = isGem ? { text: statusLabel(status), cls: status } : statusLine(status, chatgptStatus);
  return `<div class="skill-card" data-id="${id}" data-type="${esc(item.type || 'skill')}">
  <div class="card-header">
    <h3 class="card-title">${esc(item.name)}</h3>
    <span class="card-version">${esc(item.version || '')}</span>
  </div>
  <p class="card-desc">${esc(item.description)}</p>
  <div class="card-footer">
    <span class="card-status status-${esc(line.cls)}">${esc(line.text)}</span>
    ${buttons}
  </div>
</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (typeof module !== 'undefined') {
  module.exports = { renderCard, statusLabel, statusLine, STATUS_LABELS, esc };
}
