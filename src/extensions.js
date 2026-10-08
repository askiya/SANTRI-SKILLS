'use strict';
// Official Santriverse extensions shown on the SantriHub "Extensions" page.
// Add a new extension by adding one entry here: the page, the /api/extensions
// response and the desktop app's "open in browser" allowlist all read this list.

const EXTENSIONS = [
  {
    id: 'santri-skills',
    name: 'Santri Skills',
    kind: 'Chrome extension',
    version: '0.3.0',
    tagline: 'Pasang Skill premium Santriverse ke Gemini dan ChatGPT dalam 2 klik, langsung dari side panel Chrome.',
    stores: [
      {
        label: 'Chrome Web Store',
        for: 'Chrome · Edge · Brave',
        url: 'https://chromewebstore.google.com/detail/hcpecoheghikbjoeoaekcjfpeopcoboh',
      },
    ],
    steps: [
      'Buka Chrome Web Store, klik Tambahkan ke Chrome.',
      'Pin ikon Santri Skills, lalu klik untuk membuka side panel.',
      'Hubungkan akun Premium melalui login resmi Santriverse.',
      'Pilih Skill, lalu Pasang ke Gemini atau Pasang ke ChatGPT. Konfirmasi akhir (Buat / Instal Plugin) tetap kamu yang menekan.',
    ],
  },
  {
    id: 'santri-code',
    name: 'Santri Code',
    kind: 'Editor extension',
    version: '0.1.6',
    tagline: 'AI Flow Studio Santriverse di editor: PRD, ARCHITECTURE.md, SDLC, dan DESIGN.md diketik langsung ke project.',
    identifier: 'santriverse.santri-code',
    stores: [
      {
        label: 'Open VSX',
        for: 'Antigravity · Cursor · Windsurf',
        url: 'https://open-vsx.org/extension/santriverse/santri-code',
      },
      {
        label: 'VS Code Marketplace',
        for: 'Visual Studio Code',
        url: 'https://marketplace.visualstudio.com/items?itemName=santriverse.santri-code',
      },
    ],
    steps: [
      'Di Antigravity atau VS Code buka Extensions (Ctrl+Shift+X), cari "Santri Code", lalu Install.',
      'Buka panel di sidebar kanan: Ctrl+Shift+Alt+S atau klik "Santri" di status bar.',
      'Login dengan Santriverse, pilih model, lalu mulai PRD, Architecture, SDLC, atau DESIGN.md.',
    ],
  },
];

const STORE_HOSTS = new Set(['chromewebstore.google.com', 'open-vsx.org', 'marketplace.visualstudio.com']);

/** True only for a store link listed above (exact URL, https, known store host). */
function isExtensionLink(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || !STORE_HOSTS.has(url.hostname)) return false;
  return EXTENSIONS.some((ext) => ext.stores.some((store) => store.url === url.href));
}

module.exports = { EXTENSIONS, isExtensionLink };
