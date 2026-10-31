// extension/claude-skills.js – content script for claude.ai.
//
// Assisted install on Customize → Skills → Add → Upload skill: puts the ZIP
// the side panel built into Claude's own "Skill file" input and waits until
// Claude enables its Upload button. The member presses "Upload" themselves
// (Claude runs its security scan then). Detection reports only skill names
// Claude itself lists.
//
// claude.ai page shape (verified 31 Oct 2026):
//   upload: /customize/skills/new/upload — hidden <input type=file
//           aria-label="Skill file" accept=".zip,.skill,.md" multiple>,
//           <button>Upload</button> (disabled until a file is chosen), <button>Cancel</button>
//   lists:  /customize/skills, /customize/skills/yours — <button aria-label="View <name>">
'use strict';

const CLAUDE_UPLOAD_PATH = '/customize/skills/new/upload';
const CLAUDE_LABEL = { upload: /^upload$/i, error: /(invalid|error|failed|couldn.t|could not|must include|must contain|not supported|too large)/i };

const claudeSleep = (ms) => new Promise(r => setTimeout(r, ms));
async function claudeWaitFor(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() > end) return null;
    await claudeSleep(stepMs);
  }
}

const claudeText = (el) => (el?.innerText || el?.textContent || '').trim();
const claudeOnUploadPage = () => location.pathname.replace(/\/+$/, '') === CLAUDE_UPLOAD_PATH;
const claudeOnSkillsPages = () => /^\/customize\/skills(\/|$)/.test(location.pathname);
const claudeMain = () => document.querySelector('main') || document.body;
const claudeFileInput = () => document.querySelector('input[type="file"][aria-label="Skill file"]')
  || [...claudeMain().querySelectorAll('input[type="file"]')].find(i => /\.zip/i.test(i.accept || ''));
const claudeUploadButton = () => [...claudeMain().querySelectorAll('button')].find(b => CLAUDE_LABEL.upload.test(claudeText(b)));

/** Skill names (kebab-case) Claude lists on its Skills pages. */
function claudeNamesOnPage(names) {
  const views = new Set([...document.querySelectorAll('[aria-label^="View "]')].map(el => el.getAttribute('aria-label').slice(5).trim()));
  const headings = new Set([...claudeMain().querySelectorAll('h1, h2')].map(claudeText));
  return names.filter(name => views.has(name) || headings.has(name));
}

function claudeFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function claudeAssistUpload({ fileName, data }) {
  if (!claudeOnUploadPage()) return { ok: false, stage: 'navigate' };
  const input = await claudeWaitFor(claudeFileInput, 15000);
  if (!input) return { ok: false, stage: 'upload_page' };

  // The page's own hints ("…must include a SKILL.md file") are not errors: only judge lines that appear later.
  const lines = () => claudeText(claudeMain()).split('\n').map(l => l.trim()).filter(Boolean);
  const before = new Set(lines());
  const newLines = () => lines().filter(l => !before.has(l));

  const transfer = new DataTransfer();
  transfer.items.add(new File([claudeFromBase64(data)], fileName, { type: 'application/zip' }));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Ready once Claude enables its own Upload button for the chosen file.
  const outcome = await claudeWaitFor(() => {
    const added = newLines();
    if (added.some(l => CLAUDE_LABEL.error.test(l))) return 'rejected';
    const button = claudeUploadButton();
    if (button && !button.disabled) return 'ready';
    return null;
  }, 20000, 300);
  if (outcome === 'ready') return { ok: true, stage: 'ready' };
  return { ok: false, stage: outcome === 'rejected' ? 'rejected' : 'upload_button', detail: newLines().join(' ').slice(-240) };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'claude:state') {
    const names = Array.isArray(msg.names) ? msg.names.filter(n => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n)) : [];
    sendResponse({ onSkillsPages: claudeOnSkillsPages(), onUploadPage: claudeOnUploadPage(), present: claudeOnSkillsPages() && !claudeOnUploadPage() ? claudeNamesOnPage(names) : [] });
    return false;
  }
  if (msg?.type === 'claude:upload') {
    if (typeof msg.fileName !== 'string' || !/\.zip$/i.test(msg.fileName) || typeof msg.data !== 'string' || !msg.data) {
      sendResponse({ ok: false, stage: 'error', detail: 'payload' });
      return false;
    }
    claudeAssistUpload(msg).then(sendResponse, (error) => sendResponse({ ok: false, stage: 'error', detail: String(error?.message || error) }));
    return true;
  }
  return false;
});

if (typeof module !== 'undefined') module.exports = { claudeNamesOnPage, CLAUDE_UPLOAD_PATH };
