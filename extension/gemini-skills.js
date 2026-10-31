// extension/gemini-skills.js – content script for gemini.google.com (isolated world).
//
// Assisted install on Customize → Skills: opens Gemini's own "Create → Upload"
// dialog, hands the verified package to gemini-skills-bridge.js (page world)
// and waits until Gemini shows its Review screen. The member presses "Create"
// themselves. Detection only reports a skill name Gemini itself lists; it
// never asserts anything from the extension's side.
//
// Gemini page shape (verified 31 Oct 2026, id + en UI):
//   list:   <button aria-haspopup="menu">Buat</button> → [role=menuitem] "Upload"
//   upload: mat-dialog-container "Upload keahlian" with div.upload-area (reads
//           drops only through DataTransferItem.webkitGetAsEntry)
//   review: name <input>, description/instructions [contenteditable], and the
//           saving <button aria-label="Simpan keterampilan">Buat</button>
'use strict';

const CREATE_LABELS = ['Buat', 'Create'];
const LABEL = {
  create: /^(buat|create)$/i,
  upload: /^(upload|unggah)$/i,
};
const DIALOG = 'mat-dialog-container, [role="dialog"]';
const AREA_SELECTORS = ['mat-dialog-container .upload-area', 'mat-dialog-container [class*="upload-area"]', '[role="dialog"] [class*="upload-area"]'];
const EDITABLE = 'textarea, [contenteditable]:not([contenteditable="false"])';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await sleep(stepMs);
  }
}

const textOf = (el) => (el?.innerText || el?.textContent || '').trim();
const labelOf = (el) => textOf(el) || (el?.getAttribute?.('aria-label') || '').trim();
const isVisible = (el) => Boolean(el && el.offsetParent !== null);
const inDialog = (el) => Boolean(el?.closest?.(DIALOG));
const buttons = () => [...document.querySelectorAll('button')];

// Skills used to live at /skills; Gemini now serves them under /customize/skills.
const isSkillsPage = () => /^\/(customize\/)?skills(\/|$)/.test(location.pathname);

/**
 * The "Create" that opens Gemini's Create menu (a menu trigger, aria-haspopup),
 * never the "Create" that saves a reviewed skill.
 */
const createMenuButton = () => buttons()
  .find(b => LABEL.create.test(labelOf(b)) && b.hasAttribute('aria-haspopup') && !inDialog(b) && isVisible(b));
/** Older layout: an Upload icon button straight on the page. */
const directUploadButton = () => buttons()
  .find(b => /upload|unggah/i.test(b.getAttribute('aria-label') || '') && !b.hasAttribute('aria-haspopup') && !inDialog(b));
const uploadMenuItem = () => [...document.querySelectorAll('[role="menuitem"]')].find(m => LABEL.upload.test(textOf(m)));
const areaSelector = () => AREA_SELECTORS.find(s => document.querySelector(s)) || null;

/** Gemini's Review screen: the saving "Create" (no menu) next to editable skill fields. */
const reviewOpen = () => buttons()
  .some(b => CREATE_LABELS.includes(textOf(b)) && !b.hasAttribute('aria-haspopup') && isVisible(b))
  && [...document.querySelectorAll(EDITABLE)].some(isVisible);
const dialogText = () => textOf(document.querySelector(DIALOG)).slice(-240);

/** Names (kebab-case) Gemini currently shows in its list or in a skill editor. */
function namesOnPage(names) {
  const text = document.body?.innerText || '';
  const values = [...document.querySelectorAll('input, textarea')].map(el => el.value || '');
  return names.filter(name => {
    const re = new RegExp(`(^|[^a-z0-9-])${name.replace(/[-]/g, '\\-')}($|[^a-z0-9-])`, 'm');
    return re.test(text) || values.includes(name);
  });
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function askBridge(payload) {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => { window.removeEventListener('message', onReply); resolve({ ok: false, error: 'bridge_timeout' }); }, 4000);
    function onReply(event) {
      const msg = event.data;
      if (event.source !== window || !msg || msg.source !== 'santri-skills-bridge' || msg.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      resolve(msg);
    }
    window.addEventListener('message', onReply);
    const buffers = payload.files.map(f => f.buffer);
    window.postMessage({ source: 'santri-skills', type: 'drop', id, ...payload }, location.origin, buffers);
  });
}

/** Open Create → Upload until Gemini's upload dialog shows its drop area. */
async function openUpload() {
  if (areaSelector()) return true;
  const trigger = await waitFor(() => createMenuButton() || directUploadButton(), 15000);
  if (!trigger) return 'create_menu';
  if (trigger.hasAttribute('aria-haspopup')) {
    let item = null;
    // Material menus can toggle shut on a repeated click; re-check before each try.
    for (let attempt = 0; attempt < 3 && !item; attempt++) {
      if (!uploadMenuItem()) trigger.click();
      item = await waitFor(uploadMenuItem, 2000);
    }
    if (!item) return 'upload_item';
    item.click();
  } else {
    trigger.click();
  }
  return (await waitFor(areaSelector, 10000)) ? true : 'upload_dialog';
}

async function assistInstall({ root, files }) {
  if (!isSkillsPage()) return { ok: false, stage: 'navigate' };
  if (reviewOpen()) return { ok: false, stage: 'busy' };

  const opened = await openUpload();
  if (opened !== true) return { ok: false, stage: opened };

  const dropped = await askBridge({ areaSelector: areaSelector(), root, files: files.map(f => ({ path: f.path, buffer: fromBase64(f.data) })) });
  if (!dropped.ok) return { ok: false, stage: 'drop', detail: dropped.error };

  const outcome = await waitFor(() => (reviewOpen() ? 'review' : null), 45000, 300);
  if (outcome) return { ok: true, stage: 'review' };
  return { ok: false, stage: 'review_timeout', detail: dialogText() };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'skills:detect') {
    const names = Array.isArray(msg.names) ? msg.names.filter(n => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)) : [];
    sendResponse({ onSkillsPage: isSkillsPage(), reviewOpen: reviewOpen(), present: isSkillsPage() ? namesOnPage(names) : [] });
    return false;
  }
  if (msg?.type === 'skills:install') {
    assistInstall(msg).then(sendResponse, (error) => sendResponse({ ok: false, stage: 'error', detail: String(error?.message || error) }));
    return true;
  }
  return false;
});

if (typeof module !== 'undefined') module.exports = { namesOnPage, CREATE_LABELS, isSkillsPage };
