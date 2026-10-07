// extension/catalog.js – Catalog card rendering and status labels

const STATUS_LABELS = {
  not_installed: 'Belum dipasang',
  ready: 'Paket siap',
  pending_confirm: 'Menunggu konfirmasi',
  confirmed: 'Dikonfirmasi member',
  detected: 'Terdeteksi di Gemini',
  update_available: 'Update tersedia',
  adapter_failed: 'Gagal otomatis',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function renderCard(item) {
  item = { ...item, name: item.title || item.name, type: item.kind || item.type };
  const status = item.status || 'not_installed';
  const actionLabel = item.type === 'gem' ? 'Buka Gem' : 'Buka Gemini';
  const actionClass = item.type === 'gem' ? 'btn-gem' : 'btn-gemini';
  return `<div class="skill-card" data-id="${esc(item.id)}" data-type="${esc(item.type || 'skill')}">
  <div class="card-header">
    <h3 class="card-title">${esc(item.name)}</h3>
    <span class="card-version">${esc(item.version || '')}</span>
  </div>
  <p class="card-desc">${esc(item.description)}</p>
  <div class="card-footer">
    <span class="card-status status-${esc(status)}">${statusLabel(status)}</span>
    <button class="btn ${actionClass}" data-action="open" data-id="${esc(item.id)}">${actionLabel}</button>
    <button class="btn btn-download" data-action="download" data-id="${esc(item.id)}">Download Paket</button>
  </div>
</div>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

if (typeof module !== 'undefined') {
  module.exports = { renderCard, statusLabel, STATUS_LABELS, esc };
}
