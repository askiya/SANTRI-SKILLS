chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
});
// No credential-bearing message bridge. Auth runs only inside extension side panel.
chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: false });
  return false;
});
