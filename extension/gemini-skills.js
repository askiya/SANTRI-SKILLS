// extension/gemini-skills.js – content script for gemini.google.com (isolated world).
//
// Assisted install: opens Gemini's own "Upload skill" dialog, hands the
// verified package to gemini-skills-bridge.js (page world) and waits until
// Gemini shows its Review screen. The member presses "Create" themselves.
// Detection only reports a skill name Gemini itself lists; it never asserts
// anything from the extension's side.
'use strict';

const CREATE_LABELS = ['Buat', 'Create'];
const AREA_SELECTORS = ['mat-dialog-container .upload-area', 'mat-dialog-container [class*="upload-area"]', '[role="dialog"] [class*="upload-area"]'];

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

const isSkillsPage = () => location.pathname.replace(/\/+$/, '') === '/skills';
const uploadButton = () => [...document.querySelectorAll('button[aria-label]')]
  .find(b => /upload/i.test(b.getAttribute('aria-label') || '') && !b.closest('mat-dialog-container'));
const areaSelector = () => AREA_SELECTORS.find(s => document.querySelector(s)) || null;
const reviewOpen = () => [...document.querySelectorAll('button')]
  .some(b => CREATE_LABELS.includes((b.innerText || '').trim()) && b.offsetParent !== null);
const dialogText = () => (document.querySelector('mat-dialog-container, [role="dialog"]')?.innerText || '').trim().slice(-240);

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

async function assistInstall({ root, files }) {
  if (!isSkillsPage()) return { ok: false, stage: 'navigate' };

  if (!areaSelector()) {
    const button = await waitFor(uploadButton, 15000);
    if (!button) return { ok: false, stage: 'upload_button' };
    button.click();
  }
  const selector = await waitFor(areaSelector, 10000);
  if (!selector) return { ok: false, stage: 'upload_dialog' };

  const dropped = await askBridge({ areaSelector: selector, root, files: files.map(f => ({ path: f.path, buffer: fromBase64(f.data) })) });
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

if (typeof module !== 'undefined') module.exports = { namesOnPage, CREATE_LABELS };
