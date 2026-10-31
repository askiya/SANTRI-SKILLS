// extension/chatgpt-adapter.js – ChatGPT Plugins integration for the side panel.
//
// Assisted install: the extension builds a ChatGPT plugin ZIP from the verified
// package, opens chatgpt.com/plugins and fills ChatGPT's own "Add → Upload
// plugin archive" dialog; the member then presses "Add plugin" and "Install
// plugin" in ChatGPT. If any step fails, the panel offers the plugin ZIP and
// these manual steps instead.

const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

function getChatGptManualSteps() {
  return [
    'Download plugin ChatGPT (klik "Download ZIP ChatGPT"). Tidak perlu diekstrak.',
    'Buka chatgpt.com/plugins (klik "Buka ChatGPT Plugins").',
    'Klik "Add" (pojok kanan atas) lalu "Upload plugin archive", pilih file ZIP tadi, lalu klik "Add plugin".',
    'Buka plugin yang baru ditambahkan, lalu klik "Install plugin" bila ditawarkan.',
    'Pakai di chat dengan mengetik @ lalu nama plugin.',
  ];
}

function chatGptTabReady(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = (ok) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpdated); resolve(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    function onUpdated(id, info) { if (id === tabId && info.status === 'complete') done(true); }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(t => { if (t.status === 'complete' && !t.pendingUrl) done(true); }, () => done(false));
  });
}

/** Reuse a ChatGPT Plugins tab if one is open; otherwise open a new one (never hijack a chat tab). */
async function openChatGptPluginsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://chatgpt.com/plugins*' });
  const tab = tabs[0]
    ? await chrome.tabs.update(tabs[0].id, { url: CHATGPT_PLUGINS_URL, active: true })
    : await chrome.tabs.create({ url: CHATGPT_PLUGINS_URL, active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await chatGptTabReady(tab.id);
  return tab;
}

async function sendToChatGptTab(tabId, message, attempts = 25) {
  for (let i = 0; i < attempts; i++) {
    try {
      const reply = await chrome.tabs.sendMessage(tabId, message);
      if (reply !== undefined) return reply;
    } catch { /* content script not ready yet */ }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('Halaman ChatGPT tidak merespons. Pastikan sudah login di chatgpt.com.');
}

function zipToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Upload a built plugin ({ zip, fileName }) through ChatGPT's dialog. */
async function assistChatGptInstall(plugin) {
  const tab = await openChatGptPluginsTab();
  const reply = await sendToChatGptTab(tab.id, { type: 'chatgpt:upload', fileName: plugin.fileName, data: zipToBase64(plugin.zip) });
  return { ...reply, tabId: tab.id };
}

/**
 * Wait until the member installed the plugin. With a known pluginId (old
 * dialogs import on file choice) only that page counts; otherwise the member
 * first presses "Add plugin" and the plugin page whose title matches counts.
 * Resolves with the pluginId, or null on timeout.
 */
async function waitUntilChatGptInstalled(tabId, pluginId, { title = '', timeoutMs = 5 * 60 * 1000 } = {}) {
  const want = String(title).trim().toLowerCase();
  const end = Date.now() + timeoutMs;
  let known = null; // plugins already in the Installed row before the member pressed "Add plugin"
  while (Date.now() < end) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { type: 'chatgpt:state', follow: !pluginId });
      const matches = pluginId ? state?.pluginId === pluginId
        : !!state?.pluginId && (!want || state.title.trim().toLowerCase() === want);
      if (matches && state.title && state.installOffered === false) return state.pluginId;
      if (!pluginId && state?.onPluginsPage) {
        if (!known) known = new Set((state.tiles || []).map(t => t.pluginId));
        const added = (state.tiles || []).find(t => !known.has(t.pluginId) && (!want || t.title.toLowerCase() === want));
        if (added) return added.pluginId;
      }
    } catch { /* tab navigating or closed */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  return null;
}

async function openChatGptPluginsPage() {
  return openChatGptPluginsTab();
}

if (typeof module !== 'undefined') {
  module.exports = { CHATGPT_PLUGINS_URL, getChatGptManualSteps, openChatGptPluginsTab, assistChatGptInstall, waitUntilChatGptInstalled, zipToBase64, openChatGptPluginsPage };
}
