// extension/chatgpt-plugins.js – content script for chatgpt.com.
//
// Assisted install: on chatgpt.com/plugins it opens ChatGPT's own
// "+ → Upload plugin" dialog, hands it the plugin ZIP the side panel built
// from the member's verified package, waits for "Import successful" and opens
// the plugin page. The member presses "Install plugin" themselves.
// Detection reports only what ChatGPT shows on that plugin page.
'use strict';

const CGPT = {
  addButton: /^(tambahkan plugin|add plugin|add a plugin)$/i,
  uploadItem: /^(unggah plugin|upload plugin|upload a plugin)$/i,
  imported: /(impor berhasil|import (was )?successful|import succeeded|imported successfully)/i,
  failed: /(gagal|tidak valid|failed|invalid|error|tidak didukung|not supported)/i,
  viewPlugin: /^(lihat plugin|view plugin)$/i,
  installPlugin: /^(instal plugin|install plugin)$/i,
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
const cgptButtons = (root = document) => [...root.querySelectorAll('button')];

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
const cgptAddButton = () => cgptButtons().find(b => CGPT.addButton.test(b.getAttribute('aria-label') || cgptText(b)));
const cgptUploadItem = () => [...document.querySelectorAll('[role=menuitem]')].find(m => CGPT.uploadItem.test(cgptText(m)));
const cgptDialog = () => document.querySelector('[role=dialog]');
const cgptFileInput = () => [...document.querySelectorAll('[role=dialog] input[type=file]')].find(i => /\.zip/i.test(i.accept || '.zip'));

/** Plugin page state: id from the URL, and whether the "Install plugin" button is still offered. */
function cgptPluginState() {
  const match = location.pathname.match(/^\/plugins\/(Plugin_[A-Za-z0-9]+)/);
  const main = document.querySelector('main') || document.body;
  const installOffered = cgptButtons(main).some(b => CGPT.installPlugin.test(cgptText(b)));
  const title = cgptText(main.querySelector('h1, h2'));
  return { pluginId: match ? match[1] : null, installOffered, title };
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

  const file = new File([cgptFromBase64(data)], fileName, { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // ChatGPT uploads and imports as soon as a file is chosen.
  const outcome = await cgptWaitFor(() => {
    const text = cgptText(cgptDialog());
    if (CGPT.imported.test(text)) return 'imported';
    if (CGPT.failed.test(text) && !/mengunggah|uploading/i.test(text)) return 'failed';
    return null;
  }, 60000, 400);
  if (outcome !== 'imported') {
    return { ok: false, stage: outcome === 'failed' ? 'import_failed' : 'import_timeout', detail: cgptText(cgptDialog()).slice(-240) };
  }

  const view = cgptButtons(cgptDialog() || document).find(b => CGPT.viewPlugin.test(cgptText(b)));
  if (view) {
    view.click();
    await cgptWaitFor(() => cgptPluginState().pluginId, 10000);
  }
  return { ok: true, stage: 'imported', ...cgptPluginState() };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'chatgpt:state') {
    sendResponse({ onPluginsPage: cgptOnPluginsPage(), ...cgptPluginState() });
    return false;
  }
  if (msg?.type === 'chatgpt:upload') {
    cgptAssistUpload(msg).then(sendResponse, (error) => sendResponse({ ok: false, stage: 'error', detail: String(error?.message || error) }));
    return true;
  }
  return false;
});

if (typeof module !== 'undefined') module.exports = { CGPT, cgptPluginState };
