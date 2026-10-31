// extension/chatgpt-plugins.js – content script for chatgpt.com.
//
// Assisted install: on chatgpt.com/plugins it opens ChatGPT's own
// "Add → Upload plugin archive" dialog and hands it the plugin ZIP the side
// panel built from the member's verified package. Since late Oct 2026 the
// dialog has its own "Add plugin" button: the member presses it, then
// "Install plugin" on the plugin page. Older dialogs that import as soon as a
// file is chosen ("Import successful" → "View plugin") are still followed.
// Detection reports only what ChatGPT shows on the plugin page.
'use strict';

const CGPT = {
  // Page menu trigger ("Add" as of 31 Oct 2026; "+" / "Tambahkan plugin" before).
  addButton: /^(add|tambah|tambahkan|add plugin|add a plugin|tambahkan plugin|\+)$/i,
  uploadItem: /^(unggah|upload)( a)? (arsip )?plugin( archive)?$/i,
  submit: /^(add plugin|tambahkan plugin|upload|unggah)$/i,
  imported: /(impor berhasil|import (was )?successful|import succeeded|imported successfully)/i,
  failed: /(gagal|tidak valid|failed|invalid|error|tidak didukung|not supported|too large|terlalu besar|couldn.t|could not)/i,
  viewPlugin: /^(lihat plugin|view plugin)$/i,
  installPlugin: /^(instal|install)( plugin)?$|^(add to chatgpt|tambahkan ke chatgpt)$/i,
};

const cgptSleep = (ms) => new Promise(r => setTimeout(r, ms));

async function cgptWaitFor(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await cgptSleep(stepMs);
  }
}

const cgptText = (el) => (el?.innerText || el?.textContent || '').trim();
const cgptLabel = (el) => (el?.getAttribute?.('aria-label') || cgptText(el)).trim();
const cgptButtons = (root = document) => [...root.querySelectorAll('button')];
const cgptLines = (el) => cgptText(el).split('\n').map(l => l.trim()).filter(Boolean);

/**
 * Radix-style menus open on pointerdown, and a following click can toggle them
 * shut again — observed both ways on chatgpt.com. Try each trigger in turn.
 */
function cgptPress(el, attempt) {
  const down = () => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', isPrimary: true }));
  if (attempt % 3 === 0) down();
  else if (attempt % 3 === 1) el.click();
  else { down(); el.click(); }
}

const cgptOnPluginsPage = () => location.pathname.replace(/\/+$/, '') === '/plugins';
const cgptDialog = () => document.querySelector('[role=dialog]');
// The page's menu trigger, never the dialog's own "Add plugin" button.
const cgptAddButton = () => cgptButtons().find(b => !b.closest('[role=dialog]') && CGPT.addButton.test(cgptLabel(b))
  && (b.getAttribute('aria-haspopup') === 'menu' || /plugin|\+/i.test(cgptLabel(b))));
const cgptUploadItem = () => [...document.querySelectorAll('[role=menuitem]')].find(m => CGPT.uploadItem.test(cgptText(m)));
const cgptFileInput = () => [...document.querySelectorAll('[role=dialog] input[type=file]')].find(i => /\.zip/i.test(i.accept || '.zip'));
const cgptSubmitButton = () => cgptButtons(cgptDialog() || document.createElement('div')).find(b => CGPT.submit.test(cgptText(b)));

/** Plugin page state: id from the URL, title, and whether "Install plugin" is still offered. */
function cgptPluginState() {
  const match = location.pathname.match(/^\/plugins\/(Plugin_[A-Za-z0-9]+)/);
  const main = document.querySelector('main') || document.body;
  const installOffered = cgptButtons(main).some(b => CGPT.installPlugin.test(cgptText(b)));
  const title = cgptText(main.querySelector('h1, h2'));
  // Installed row on /plugins: icon links labelled with the plugin name.
  const tiles = cgptOnPluginsPage() ? [...document.querySelectorAll('a[href^="/plugins/Plugin_"][aria-label]')]
    .map(a => ({ title: a.getAttribute('aria-label').trim(), pluginId: a.getAttribute('href').split('/')[2] })) : [];
  return { pluginId: match ? match[1] : null, installOffered, title, tiles };
}

/** After an import, ChatGPT may show "View plugin" in the dialog: open the plugin page. */
async function cgptFollowImported() {
  const view = cgptButtons(cgptDialog() || document).find(b => CGPT.viewPlugin.test(cgptText(b)));
  if (!view) return false;
  view.click();
  await cgptWaitFor(() => cgptPluginState().pluginId, 10000);
  return true;
}

function cgptFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function cgptAssistUpload({ fileName, data }) {
  if (!cgptOnPluginsPage()) return { ok: false, stage: 'navigate' };

  let input = cgptFileInput();
  if (!input) {
    const add = await cgptWaitFor(cgptAddButton, 15000);
    if (!add) return { ok: false, stage: 'add_button' };
    let item = null;
    for (let attempt = 0; attempt < 6 && !item; attempt++) {
      if (document.querySelector('[role=menu]')) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      cgptPress(add, attempt);
      item = await cgptWaitFor(cgptUploadItem, 1500);
    }
    if (!item) return { ok: false, stage: 'upload_menu' };
    item.click();
    input = await cgptWaitFor(cgptFileInput, 8000);
    if (!input) return { ok: false, stage: 'upload_dialog' };
  }

  // Static dialog text ("Only .zip … are supported") is not an error: only
  // lines that appear after the file is chosen count.
  const before = new Set(cgptLines(cgptDialog()));
  const file = new File([cgptFromBase64(data)], fileName, { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const outcome = await cgptWaitFor(() => {
    const dialog = cgptDialog();
    const fresh = cgptLines(dialog).filter(l => !before.has(l));
    if (fresh.some(l => CGPT.imported.test(l))) return 'imported';
    const bad = fresh.find(l => CGPT.failed.test(l) && !/mengunggah|uploading/i.test(l));
    if (bad) return { failed: bad };
    const submit = cgptSubmitButton();
    if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') return 'ready';
    return null;
  }, 60000, 400);

  if (outcome === 'ready') return { ok: true, stage: 'ready' };
  if (outcome !== 'imported') {
    return { ok: false, stage: outcome?.failed ? 'import_failed' : 'import_timeout', detail: (outcome?.failed || cgptText(cgptDialog())).slice(-240) };
  }
  await cgptFollowImported();
  return { ok: true, stage: 'imported', ...cgptPluginState() };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'chatgpt:state') {
    const reply = () => sendResponse({ onPluginsPage: cgptOnPluginsPage(), dialogOpen: !!cgptDialog(), ...cgptPluginState() });
    if (msg.follow && cgptOnPluginsPage()) { cgptFollowImported().then(reply, reply); return true; }
    reply();
    return false;
  }
  if (msg?.type === 'chatgpt:upload') {
    cgptAssistUpload(msg).then(sendResponse, (error) => sendResponse({ ok: false, stage: 'error', detail: String(error?.message || error) }));
    return true;
  }
  return false;
});

if (typeof module !== 'undefined') module.exports = { CGPT, cgptPluginState };
