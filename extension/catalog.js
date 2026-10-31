// extension/catalog.js – Catalog tabs, card rendering and status labels

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

/** Install targets, in tab order. `action` is the card button's data-action. */
const PLATFORMS = {
  gemini: { label: 'Gemini', action: 'install' },
  chatgpt: { label: 'ChatGPT', action: 'install-chatgpt' },
  claude: { label: 'Claude', action: 'install-claude' },
};
const PLATFORM_IDS = Object.keys(PLATFORMS);

/**
 * Platforms the admin ticked for a package. Older servers send no
 * `platforms`: skills then keep the Gemini + ChatGPT they always had.
 */
function platformsOf(item) {
  const kind = item?.kind || item?.type;
  if (kind === 'gem') return ['gemini'];
  const listed = Array.isArray(item?.platforms) ? PLATFORM_IDS.filter(p => item.platforms.includes(p)) : [];
  return listed.length ? listed : ['gemini', 'chatgpt'];
}

/** Status line for one platform: { text, cls }. */
function statusLine(status, platform = 'gemini', reported = false) {
  const label = PLATFORMS[platform]?.label || platform;
  if (status === 'detected') return { text: reported ? `✓ Ditandai terpasang di ${label}` : `✓ Terpasang di ${label}`, cls: 'detected' };
  if (status === 'update_available') return { text: `Update tersedia di ${label}`, cls: 'update_available' };
  return { text: `Belum dipasang di ${label}`, cls: 'not_installed' };
}

function installLabel(status, platform) {
  const label = PLATFORMS[platform].label;
  if (status === 'detected') return 'Pasang ulang';
  if (status === 'update_available') return `Update di ${label}`;
  return `Pasang ke ${label}`;
}

/** Tab bar; counts = { gemini: n, … } packages offered on each platform. */
function renderTabs(active, counts = {}) {
  return PLATFORM_IDS.map(id => {
    const selected = id === active;
    return `<button type="button" role="tab" class="ptab ptab-${id}" data-platform="${id}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${esc(PLATFORMS[id].label)}<span class="ptab-count">${Number(counts[id]) || 0}</span></button>`;
  }).join('');
}

/**
 * One card for one platform tab. item.status is that platform's status;
 * item.reported marks a status the member reported (no page detection).
 */
function renderCard(item, platform = 'gemini') {
  item = { ...item, name: item.title || item.name, type: item.kind || item.type };
  if (!PLATFORMS[platform]) platform = 'gemini';
  const status = item.status || 'not_installed';
  const isGem = item.type === 'gem';
  const id = esc(item.id);
  const label = PLATFORMS[platform].label;
  const zip = `<button class="btn btn-download btn-zip" data-action="download" data-target="${platform}" data-id="${id}" title="Download ZIP ${label}" aria-label="Download ZIP ${label}">⇩ ZIP</button>`;
  const buttons = isGem
    ? `<button class="btn btn-gem btn-main" data-action="open" data-id="${id}">Buka Gem</button>${item.file_size ? zip : ''}`
    : `<button class="btn btn-${platform} btn-main" data-action="${PLATFORMS[platform].action}" data-id="${id}">${installLabel(status, platform)}</button>${zip}`;
  const line = isGem ? { text: statusLabel(status), cls: status } : statusLine(status, platform, item.reported);
  return `<div class="skill-card" data-id="${id}" data-type="${esc(item.type || 'skill')}" data-platform="${platform}">
  <div class="card-header">
    <h3 class="card-title">${esc(item.name)}</h3>
    <span class="card-version">${esc(item.version || '')}</span>
  </div>
  <p class="card-desc" title="${esc(item.description)}">${esc(item.description)}</p>
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
  module.exports = { renderCard, renderTabs, statusLabel, statusLine, platformsOf, PLATFORMS, PLATFORM_IDS, STATUS_LABELS, esc };
}
