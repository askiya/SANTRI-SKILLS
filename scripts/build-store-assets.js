#!/usr/bin/env node
'use strict';
// Renders Chrome Web Store listing images from the real side panel CSS and
// catalog cards (headless Chrome):
//
//   node scripts/build-store-assets.js  →  extension/store/*.png
//
// Screenshots 1280×800 and the small promo tile 440×280, as the Web Store asks.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, 'store');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find(fs.existsSync);

const { renderCard } = require(path.join(EXT, 'catalog.js'));
const css = pathToFileURL(path.join(EXT, 'sidepanel.css')).href;
const icon = (size) => pathToFileURL(path.join(EXT, 'icons', `icon-${size}.png`)).href;

const ARCHON = { id: 1, title: 'Archon System Architect', version: '1.0.0', type: 'skill',
  description: 'ARCHON — Senior Full Stack & System Architect yang mengubah ide aplikasi menjadi blueprint siap dibangun lewat 3 fase: Discovery, Gambaran Sistem, dan Full Architecture Prompt.' };
const GAS = { id: 2, title: 'Santriman Gas Webapp Builder', version: '1.0.0', type: 'skill',
  description: 'Build, audit, and repair secure Google Apps Script web apps.', status: 'detected', chatgptStatus: 'detected' };

const topbar = `<header class="topbar"><div class="brand"><span class="brand-mark"><img src="${icon(32)}" alt=""></span><div><strong>Santri Skills</strong><small>Gemini &amp; ChatGPT companion</small></div></div><button class="icon-btn">☼</button></header>`;

function steps(labels, doneUntil, active) {
  return `<ol class="install-steps">${labels.map((l, i) => {
    const st = i < doneUntil ? 'done' : i === active ? 'active' : 'wait';
    const mark = st === 'done' ? '✓' : st === 'active' ? '•' : '';
    return `<li class="step step-${st}"><span class="step-icon">${mark}</span><span>${l}</span></li>`;
  }).join('')}</ol>`;
}

const PANELS = {
  catalog: `<section id="catalog-section"><div class="catalog-head"><div><span class="eyebrow">KATALOG</span><h2>Skills &amp; Gems</h2></div><button class="icon-btn">↻</button></div><div class="catalog-grid">${renderCard(ARCHON)}${renderCard(GAS)}</div></section>`,
  chatgpt: `<section class="panel"><span class="eyebrow">PASANG KE CHATGPT</span><h2>Tinggal satu klik</h2>${steps(['Cek akses Premium', 'Unduh &amp; verifikasi paket', 'Bungkus jadi plugin ChatGPT', 'Buka ChatGPT Plugins', 'Unggah plugin ke ChatGPT', 'Klik Instal Plugin di ChatGPT'], 5, 5)}<p class="install-hint" data-level="info">Plugin sudah diimpor. Klik "Instal Plugin" di tab ChatGPT — panel ini mendeteksi otomatis.</p></section>`,
  gemini: `<section class="panel"><span class="eyebrow">PASANG KE GEMINI</span><h2>Terpasang di Gemini ✓</h2>${steps(['Cek akses Premium', 'Unduh &amp; verifikasi paket', 'Siapkan file skill', 'Buka Gemini Skills', 'Isi form upload Gemini', 'Klik Buat di tab Gemini'], 6, -1)}<p class="install-hint" data-level="good">Pakai di chat Gemini dengan mengetik / lalu pilih "archon-system-architect".</p></section>`,
  login: `<section class="panel" id="login-section" style="text-align:center"><span class="login-mark"><img src="${icon(128)}" alt=""></span><span class="eyebrow">SANTRIVERSE SKILLS</span><h1>Skills kamu,<br>siap di Gemini &amp; ChatGPT.</h1><p>Hubungkan akun Premium melalui Santriverse. Password tetap di situs resmi, bukan di extension.</p><button class="btn btn-primary">Hubungkan akun Santriverse</button><p class="security-note">Sesi hanya disimpan selama browser terbuka.</p></section>`,
};

const SHOTS = [
  { file: 'screenshot-1-katalog.png', panel: 'catalog', eyebrow: 'SANTRI SKILLS', title: 'Skill Santriverse,<br>langsung ke Gemini &amp; ChatGPT', points: ['Katalog Skill premium dalam satu panel', 'Satu klik pasang — tanpa ekstrak ZIP', 'Status terpasang terdeteksi otomatis'] },
  { file: 'screenshot-2-chatgpt.png', panel: 'chatgpt', eyebrow: 'CHATGPT PLUGINS', title: 'Jadi plugin ChatGPT<br>dalam hitungan detik', points: ['Paket dibungkus otomatis menjadi plugin', 'Form "Unggah plugin" ChatGPT terisi sendiri', 'Kamu cukup klik Instal Plugin'] },
  { file: 'screenshot-3-gemini.png', panel: 'gemini', eyebrow: 'GEMINI SKILLS', title: 'Pasang ke Gemini<br>tanpa repot', points: ['Upload ke Gemini Skills otomatis', 'Review lalu klik Buat di Gemini', 'Pakai dengan / di chat Gemini'] },
  { file: 'screenshot-4-aman.png', panel: 'login', eyebrow: 'AMAN & KHUSUS PREMIUM', title: 'Login lewat Santriverse,<br>akses diverifikasi server', points: ['Password tidak pernah masuk extension', 'Setiap paket diverifikasi SHA-256', 'Konfirmasi akhir selalu oleh kamu'] },
];

function shotHtml({ panel, eyebrow, title, points }) {
  return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><link rel="stylesheet" href="${css}"><style>
html,body{margin:0;width:1280px;height:800px;overflow:hidden}
body{min-height:0;display:flex;align-items:center;gap:64px;padding:0 84px;box-sizing:border-box;background:radial-gradient(circle at 18% 22%,rgba(139,108,255,.28),transparent 42%),radial-gradient(circle at 85% 85%,rgba(31,143,106,.22),transparent 40%),#07080d}
.copy{flex:1;color:#f6f7fb}.copy .eyebrow{font-size:14px;letter-spacing:.22em}
.copy h1{font-size:52px;line-height:1.08;letter-spacing:-.04em;margin:18px 0 26px}
.copy ul{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.copy li{font-size:20px;color:#c9cede;display:flex;gap:12px;align-items:center}
.copy li::before{content:'✓';display:grid;place-items:center;width:28px;height:28px;border-radius:50%;background:#4dd69e;color:#04150d;font-weight:800;font-size:15px;flex:none}
.brandline{display:flex;align-items:center;gap:12px;margin-bottom:22px;font-weight:800;font-size:18px}
.brandline img{width:40px;height:40px;border-radius:11px}
.frame{width:400px;height:690px;flex:none;border-radius:26px;overflow:hidden;border:1px solid #2a2e3c;box-shadow:0 40px 90px rgba(0,0,0,.55);background:var(--bg);display:flex;flex-direction:column}
.frame main{min-height:0;flex:1;padding:22px 16px;display:block;overflow:hidden}
.frame .panel{width:100%}
</style></head><body>
<div class="copy"><div class="brandline"><img src="${icon(128)}" alt="">Santri Skills · Santriverse</div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><ul>${points.map(p => `<li>${p}</li>`).join('')}</ul></div>
<div class="frame">${topbar}<main>${PANELS[panel]}</main></div>
</body></html>`;
}

const PROMO = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:440px;height:280px;overflow:hidden;font-family:Inter,system-ui,sans-serif}
body{display:flex;flex-direction:column;justify-content:center;gap:14px;padding:0 34px;box-sizing:border-box;color:#f6f7fb;background:radial-gradient(circle at 15% 20%,rgba(139,108,255,.45),transparent 50%),radial-gradient(circle at 90% 90%,rgba(31,143,106,.4),transparent 45%),#07080d}
.row{display:flex;align-items:center;gap:14px}img{width:62px;height:62px;border-radius:16px}
b{font-size:30px;letter-spacing:-.03em}small{display:block;font-size:13px;color:#a3a9b8;letter-spacing:.14em;font-weight:700}
p{margin:0;font-size:19px;line-height:1.3;color:#dfe3ee}.chips{display:flex;gap:8px}
.chips span{font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;background:#1b1e29;border:1px solid #2f3446}
</style></head><body><div class="row"><img src="${icon(128)}" alt=""><div><b>Santri Skills</b><small>SANTRIVERSE</small></div></div>
<p>Pasang Skill premium ke Gemini &amp; ChatGPT dalam 2 klik.</p><div class="chips"><span>Gemini Skills</span><span>ChatGPT Plugins</span></div></body></html>`;

function render(html, file, width, height) {
  const tmp = path.join(os.tmpdir(), `santri-store-${process.pid}-${file}.html`);
  fs.writeFileSync(tmp, html);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'santri-store-profile-'));
  try {
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`, `--screenshot=${path.join(OUT, file)}`, pathToFileURL(tmp).href], { stdio: 'ignore' });
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (!CHROME) { console.error('✗ Google Chrome tidak ditemukan.'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  for (const shot of SHOTS) render(shotHtml(shot), shot.file, 1280, 800);
  render(PROMO, 'promo-small-440x280.png', 440, 280);
  for (const f of fs.readdirSync(OUT).filter(f => f.endsWith('.png'))) console.log(`extension/store/${f}`);
}

module.exports = { SHOTS };
