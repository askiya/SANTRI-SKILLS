// extension/content.js – Minimal content script for gemini.google.com
// Navigation information only. No package-state inference or file manipulation.
// Only provides message bridge between side panel and the Gemini page.
'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ping') {
    // Side panel checks if content script is active on a Gemini tab
    sendResponse({ active: true, url: location.href });
    return true;
  }
  if (msg.type === 'get_page_info') {
    // Return basic page info — no DOM installation assertions
    sendResponse({
      url: location.href,
      title: document.title,
    });
    return true;
  }
  return false;
});
