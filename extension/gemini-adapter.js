// extension/gemini-adapter.js – Honest Gemini integration
// Opens Gemini tabs for manual Skill/Gem management.
// Does NOT claim automatic file upload or DOM-verified installation.

const GEMINI_SKILLS_URL = 'https://gemini.google.com/app';
const GEMINI_GEMS_URL = 'https://gemini.google.com/gems';

function getManualSteps(type) {
  if (type === 'gem') {
    return [
      'Buka halaman Gems di Gemini (klik "Buka Gem").',
      'Cari Gem berdasarkan nama di daftar Gems Anda.',
      'Jika belum ada, buat Gem baru dengan instruksi yang disediakan.',
      'Salin instruksi dari paket yang sudah didownload ke field Gem.',
      'Klik Simpan untuk menyimpan Gem.',
    ];
  }
  return [
    'Download paket Skill terlebih dahulu (klik "Download Paket").',
    'Buka halaman Skills di Gemini (klik "Buka Gemini").',
    'Cari pengelolaan Skills atau Gems di akun Gemini, jika tersedia. Tampilan dan rollout dapat berbeda.',
    'Pilih file SKILL.md dari folder paket yang sudah didownload.',
    'Review konten Skill, lalu klik konfirmasi untuk memasang.',
    'Setelah berhasil, konfirmasi pemasangan di panel extension ini.',
  ];
}

async function openGeminiPage(type) {
  const url = type === 'gem' ? GEMINI_GEMS_URL : GEMINI_SKILLS_URL;
  // Reuse existing Gemini tab if available
  const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { url, active: true });
    return tabs[0];
  }
  return chrome.tabs.create({ url });
}

if (typeof module !== 'undefined') {
  module.exports = { GEMINI_SKILLS_URL, GEMINI_GEMS_URL, getManualSteps, openGeminiPage };
}
