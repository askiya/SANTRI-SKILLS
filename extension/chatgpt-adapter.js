// extension/chatgpt-adapter.js – ChatGPT Plugins integration for the side panel.
//
// Assisted install: the extension builds a ChatGPT plugin ZIP from the verified
// package, opens chatgpt.com/plugins and uses ChatGPT's own "Upload plugin"
// dialog; the member then presses "Install plugin" in ChatGPT. If any step
// fails, the panel offers the plugin ZIP and these manual steps instead.

const CHATGPT_PLUGINS_URL = 'https://chatgpt.com/plugins';

function getChatGptManualSteps() {
  return [
    'Download plugin ChatGPT (klik "Download ZIP ChatGPT"). Tidak perlu diekstrak.',
    'Buka chatgpt.com/plugins (klik "Buka ChatGPT Plugins").',
    'Klik tombol + lalu pilih "Unggah plugin", pilih file ZIP tadi.',
    'Setelah "Impor berhasil", klik "Lihat Plugin" lalu "Instal Plugin".',
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

/** Wait until the member pressed "Install plugin" on the plugin page. */
async function waitUntilChatGptInstalled(tabId, pluginId, { timeoutMs = 5 * 60 * 1000 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const state = await chrome.tabs.sendMessage(tabId, { type: 'chatgpt:state' });
      if (state?.pluginId === pluginId && state.installOffered === false) return true;
    } catch { /* tab navigating or closed */ }
    await new Promise(r => setTimeout(r, 2500));
  }
  return false;
}

async function openChatGptPluginsPage() {
  return openChatGptPluginsTab();
}

if (typeof module !== 'undefined') {
  module.exports = { CHATGPT_PLUGINS_URL, getChatGptManualSteps, openChatGptPluginsTab, assistChatGptInstall, waitUntilChatGptInstalled, zipToBase64, openChatGptPluginsPage };
}
