// extension/claude-adapter.js – Claude (claude.ai) Skills integration for the side panel.
//
// Assisted install: opens claude.ai's "Upload a skill" page, hands the Claude
// ZIP (claude-skill.js) to Claude's own Skill file input, and waits for the
// member to press "Upload". If any step fails the panel falls back to the
// manual steps in claude-skill.js.
'use strict';

const CLAUDE_UPLOAD_URL = 'https://claude.ai/customize/skills/new/upload';
const CLAUDE_TABS = 'https://claude.ai/customize/skills*';

function claudeTabReady(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    function onUpdated(id, info) { if (id === tabId && info.status === 'complete') done(true); }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete' && !t.pendingUrl) done(true); }, () => done(false));
  });
}

/** Reuse a claude.ai Skills tab if one is open; never take over a chat tab. */
async function openClaudeUploadTab() {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TABS });
  const tab = tabs[0]
    ? await chrome.tabs.update(tabs[0].id, { url: CLAUDE_UPLOAD_URL, active: true })
    : await chrome.tabs.create({ url: CLAUDE_UPLOAD_URL, active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await claudeTabReady(tab.id);
  return tab;
}

async function sendToClaudeTab(tabId, message, attempts = 25) {
  for (let i = 0; i < attempts; i++) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, message);
      if (reply !== undefined) return reply;
    } catch { /* content script not ready yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Halaman Claude tidak merespons. Pastikan sudah login di claude.ai.');
}

function claudeZipToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** pkg: { zip, fileName } from buildClaudeZip(). Resolves once Claude's Upload button is enabled. */
async function assistClaudeInstall(pkg) {
  const tab = await openClaudeUploadTab();
  const reply = await sendToClaudeTab(tab.id, { type: 'claude:upload', fileName: pkg.fileName, data: claudeZipToBase64(pkg.zip) });
  return { ...reply, tabId: tab.id };
}

/** Wait until Claude lists the skill (the member pressed Upload). */
async function waitUntilClaudeInstalled(tabId, name, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { type: 'claude:state', names: [name] });
      if (state?.present?.includes(name) && !state.onUploadPage) return true;
    } catch { /* tab navigating or closed */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  return false;
}

/** Names Claude lists in an already-open Skills tab (no navigation). */
async function detectClaudeListed(names) {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TABS });
  for (const tab of tabs) {
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'claude:state', names });
      if (state?.onSkillsPages && !state.onUploadPage) return state.present || [];
    } catch { /* not ready */ }
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = { CLAUDE_UPLOAD_URL, CLAUDE_TABS, openClaudeUploadTab, assistClaudeInstall, waitUntilClaudeInstalled, detectClaudeListed, claudeZipToBase64 };
}
