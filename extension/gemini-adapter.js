// extension/gemini-adapter.js – Gemini Skills integration for the side panel.
//
// Assisted install: the extension opens Gemini's Customize → Skills page and
// hands the verified package to Gemini's own Create → Upload dialog;
// the member reviews and presses "Create" in Gemini. Detection reports only
// what Gemini lists. If any step fails, the panel falls back to the manual
// steps below.

const GEMINI_SKILLS_URL = 'https://gemini.google.com/customize/skills';
// gemini.google.com/skills redirects to the Customize page since Oct 2026.
const GEMINI_SKILLS_TABS = ['https://gemini.google.com/customize/skills*', 'https://gemini.google.com/skills*'];
const GEMINI_GEMS_URL = 'https://gemini.google.com/gems';

// File types Gemini Skills refuses (support.google.com/gemini/answer/17094296).
const GEMINI_UNSUPPORTED_RE = /\.(zip|rar|7z|tar|gz|tgz|doc|xls|ppt|raw|mp3|wav|m4a|ogg|flac|mp4|mov|avi|mkv|webm|ts|tsx|php|sql)$/i;

function getManualSteps(type) {
  if (type === 'gem') {
    return [
      'Buka halaman Gems di Gemini (klik "Buka Gem").',
      'Cari Gem berdasarkan nama di daftar Gems Anda.',
      'Jika belum ada, buat Gem baru dengan instruksi yang disediakan.',
      'Salin instruksi dari paket yang sudah didownload ke field Gem.',
      'Klik Simpan untuk menyimpan Gem.',
    ];
  }
  return [
    'Download paket ZIP (klik "Download ZIP"). Tidak perlu diekstrak.',
    'Buka Gemini → Customize → Skills (klik "Buka Gemini Skills").',
    'Klik Buat (Create) → Upload, lalu tarik file ZIP tadi ke kotak upload (bila ditolak: ekstrak, lalu pilih "folder").',
    'Review isinya, lalu klik Create (Buat) di bagian atas.',
  ];
}

function tabReady(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    function onUpdated(id, info) { if (id === tabId && info.status === 'complete') done(true); }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete' && !t.pendingUrl) done(true); }, () => done(false));
  });
}

/** Reuse a Gemini Skills tab if one is open; otherwise open a new one (never hijack a chat tab). */
async function openSkillsTab() {
  const tabs = await chrome.tabs.query({ url: GEMINI_SKILLS_TABS });
  const tab = tabs[0]
    ? await chrome.tabs.update(tabs[0].id, { url: GEMINI_SKILLS_URL, active: true })
    : await chrome.tabs.create({ url: GEMINI_SKILLS_URL, active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await tabReady(tab.id);
  return tab;
}

async function openGeminiPage(type) {
  if (type === 'gem') return chrome.tabs.create({ url: GEMINI_GEMS_URL });
  return openSkillsTab();
}

/** Content scripts load at document_idle; retry until they answer. */
async function sendToTab(tabId, message, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, message);
      if (reply !== undefined) return reply;
    } catch { /* not injected yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Halaman Gemini tidak merespons.');
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Skill files Gemini accepts, and the paths left out: { files, skipped }. */
function geminiFiles(skill) {
  const files = skill.files.filter(f => !GEMINI_UNSUPPORTED_RE.test(f.path));
  const skipped = skill.files.filter(f => GEMINI_UNSUPPORTED_RE.test(f.path)).map(f => f.path);
  return { files, skipped };
}

/**
 * Hand a prepared skill ({ name, files }) to Gemini's upload form.
 * Resolves { ok: true, tabId, skipped } once Gemini shows its Review screen.
 */
async function assistInstall(skill) {
  const { files, skipped } = geminiFiles(skill);
  const tab = await openSkillsTab();
  const reply = await sendToTab(tab.id, {
    type: 'skills:install',
    root: skill.name,
    files: files.map(f => ({ path: f.path, data: toBase64(f.bytes) })),
  });
  return { ...reply, tabId: tab.id, skipped };
}

/** Wait until Gemini lists the skill (member pressed Create). */
async function waitUntilListed(tabId, name, { timeoutMs = 5 * 60 * 1000, onTick } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { type: 'skills:detect', names: [name] });
      onTick?.(state);
      if (state?.present?.includes(name) && !state.reviewOpen) return true;
    } catch { /* tab navigating or closed */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  return false;
}

/** Names Gemini lists in an already-open Skills tab (no navigation). */
async function detectListed(names) {
  const tabs = await chrome.tabs.query({ url: GEMINI_SKILLS_TABS });
  for (const tab of tabs) {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'skills:detect', names });
      if (state?.onSkillsPage && !state.reviewOpen) return state.present || [];
    } catch { /* not ready */ }
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { GEMINI_SKILLS_URL, GEMINI_SKILLS_TABS, GEMINI_GEMS_URL, GEMINI_UNSUPPORTED_RE, geminiFiles, getManualSteps, openGeminiPage, openSkillsTab, assistInstall, waitUntilListed, detectListed, toBase64 };
}
