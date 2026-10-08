# Chrome Web Store — Santri Skills

Bahan siap salin untuk [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Paket dan gambar dibuat ulang dengan:

```bash
node scripts/build-extension.js      # dist/santri-skills-extension-<versi>.zip (tanpa "key")
node scripts/build-store-assets.js   # extension/store/*.png
```

## Urutan yang aman

1. **Deploy halaman privasi dulu.** `https://santriverse.my.id/docs/santri-skills-privacy` harus sudah bisa dibuka sebelum submit.
2. Dashboard → **Item baru** → upload `dist/santri-skills-extension-<versi>.zip`. Item tersimpan sebagai **draft** dan langsung mendapat ID 32 huruf.
3. Salin ID itu → Coolify (frontend Santriverse) → Environment Variables → `VITE_SKILLS_CHROME_EXTENSION_ID=<id-store>` → **Redeploy**.
   Tanpa langkah ini login extension versi Store (dan login reviewer) ditolak dengan "ID extension Chrome tidak cocok dengan allowlist." ID unpacked `fdhomioibdphiooncfcidjjbpoebfcep` tetap diizinkan.
4. Isi tab **Store listing**, **Privacy**, **Distribution**, dan **Test instructions** memakai teks di bawah.
5. **Submit for review** (dilakukan sendiri oleh pemilik akun developer).
6. Setelah lolos: bagikan link `https://chromewebstore.google.com/detail/<id-store>` ke member Premium.

Update berikutnya: naikkan `version` di `extension/manifest.json`, build ulang ZIP, lalu **Package → Upload new package** di item yang sama (ID tidak berubah).

## Store listing

| Kolom | Isi |
| --- | --- |
| Nama | Santri Skills (dari manifest) |
| Ringkasan (≤132 karakter) | Pasang Santriverse Skills ke Google Gemini dan ChatGPT dalam 2 klik (khusus Member Premium). (dari manifest) |
| Kategori | Productivity → Tools |
| Bahasa | Indonesian (bahasa utama); tambahkan English memakai deskripsi EN |
| Ikon | `extension/icons/icon-128.png` (sudah di dalam paket) |
| Screenshot (1280×800) | `screenshot-1-katalog.png`, `screenshot-2-chatgpt.png`, `screenshot-3-gemini.png`, `screenshot-4-aman.png` |
| Small promo tile (440×280) | `promo-small-440x280.png` |
| Homepage URL | https://santriverse.my.id |
| Support URL | https://santriverse.my.id/docs |

### Deskripsi (Indonesian)

```text
Santri Skills adalah pendamping resmi Santriverse untuk memasang Skill premium ke Google Gemini dan ChatGPT tanpa ribet download, ekstrak, dan upload manual.

CARA KERJA
1. Hubungkan akun Santriverse. Login terjadi di situs resmi santriverse.my.id — password tidak pernah diketik di extension.
2. Buka katalog Skill di side panel.
3. Klik "Pasang ke Gemini" atau "Pasang ke ChatGPT".
   • Gemini: paket disiapkan dan form upload Gemini Skills terisi otomatis. Kamu tinggal review lalu klik Buat.
   • ChatGPT: paket dibungkus menjadi plugin ChatGPT dan diunggah lewat menu "Unggah plugin". Kamu tinggal klik Instal Plugin.
4. Status "Terpasang" terdeteksi otomatis dari halaman Gemini/ChatGPT.

FITUR
• Katalog Skill premium Santriverse dalam satu panel
• Pemasangan berbantu ke Gemini Skills dan ChatGPT Plugins
• Setiap paket diverifikasi ukuran dan SHA-256 sebelum dipakai
• Download ZIP manual tetap tersedia sebagai cadangan
• Tema terang/gelap

KHUSUS MEMBER PREMIUM
Akses katalog dan unduhan diverifikasi oleh server Santriverse. Akun non-Premium akan diarahkan ke halaman upgrade.

PRIVASI
Extension hanya bekerja saat kamu menekan tombolnya, tidak membaca isi percakapan, tidak memakai iklan atau pelacak, dan tidak menjual data. Konfirmasi akhir (Buat / Instal Plugin) selalu kamu yang menekan.
Kebijakan privasi: https://santriverse.my.id/docs/santri-skills-privacy

Santri Skills dibuat oleh Santriverse dan tidak berafiliasi dengan Google maupun OpenAI.
```

### Description (English)

```text
Santri Skills is the official Santriverse companion for installing premium Skills into Google Gemini and ChatGPT — no manual downloading, unzipping, or uploading.

HOW IT WORKS
1. Connect your Santriverse account. Sign-in happens on the official santriverse.my.id site; your password is never typed into the extension.
2. Browse the Skill catalog in the side panel.
3. Click "Install to Gemini" or "Install to ChatGPT".
   • Gemini: the package is prepared and Gemini's Skills upload form is filled for you. Review it and click Create.
   • ChatGPT: the package is wrapped as a ChatGPT plugin and uploaded through "Upload plugin". Click Install plugin to finish.
4. The "Installed" status is detected automatically from the Gemini/ChatGPT page.

FEATURES
• Santriverse premium Skill catalog in one panel
• Assisted install to Gemini Skills and ChatGPT Plugins
• Every package is verified by size and SHA-256 before use
• Manual ZIP download as a fallback
• Light/dark theme

PREMIUM MEMBERS ONLY
Catalog and download access is verified by the Santriverse server. Non-Premium accounts are pointed to the upgrade page.

PRIVACY
The extension acts only when you press its buttons, never reads your conversations, has no ads or trackers, and never sells data. The final confirmation (Create / Install plugin) is always yours.
Privacy policy: https://santriverse.my.id/docs/santri-skills-privacy

Santri Skills is made by Santriverse and is not affiliated with Google or OpenAI.
```

## Privacy

### Single purpose

```text
Install the user's Santriverse premium Skills into Google Gemini Skills and ChatGPT Plugins from a side panel catalog, after verifying the user's Santriverse Premium membership.
```

### Permission justification

| Izin | Justifikasi (salin) |
| --- | --- |
| `sidePanel` | The extension's whole interface (sign-in, Skill catalog, install progress) lives in Chrome's side panel so it stays open next to the Gemini or ChatGPT tab during an install. |
| `storage` | Keeps the short-lived Santriverse session token in chrome.storage.session (cleared when the browser closes) and the per-Skill install status (Gemini/ChatGPT) in chrome.storage.local. No browsing data is stored. |
| `identity` | Uses chrome.identity.launchWebAuthFlow to sign the user in on the official santriverse.my.id page (OAuth-style PKCE with state). The password is never entered in the extension. |
| `https://santriverse.my.id/*` | Hosts the Santriverse sign-in/consent page opened by launchWebAuthFlow. |
| `https://api.santriverse.my.id/*` | Santriverse API: exchanges the sign-in code for a scoped session, verifies Premium access, lists the Skill catalog and downloads the Skill package the user picked. |
| `https://gemini.google.com/*` | Content scripts open Gemini's own Skills upload dialog, attach the Skill package the user chose and read the Skills list to show "Installed". They run only after the user clicks Install to Gemini; the user still presses Create. Conversations are not read. |
| `https://chatgpt.com/*` | Content script opens ChatGPT's own "Upload plugin" dialog on chatgpt.com/plugins, attaches the plugin ZIP the user chose and reads the plugin page to show "Installed". Runs only after the user clicks Install to ChatGPT; the user still presses Install plugin. Conversations are not read. |

### Remote code

**No, I am not using remote code.** Semua JavaScript ada di dalam paket. Yang diunduh dari API hanya file paket Skill (ZIP berisi Markdown/aset) — data, bukan kode yang dijalankan extension.

### Data usage

Centang:

- [x] **Personally identifiable information** — nama dan email akun Santriverse yang ditampilkan di panel.
- [x] **Authentication information** — token sesi Santriverse yang di-scope khusus Skills.

Jangan dicentang: health, financial and payment, personal communications, location, web history, user activity, website content. (Halaman Gemini/ChatGPT hanya dibaca di perangkat untuk menemukan tombol dan status terpasang; tidak ada yang dikirim keluar.)

Centang ketiga sertifikasi:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

Privacy policy URL: `https://santriverse.my.id/docs/santri-skills-privacy`

## Distribution

- Payments: **Free of charge** (akses Premium dibeli di santriverse.my.id, bukan lewat Web Store).
- Visibility: **Unlisted** — hanya orang dengan link yang bisa memasang; cocok untuk member Premium. Ganti ke Public kapan saja tanpa review ulang paket.
- Regions: All regions.

## Test instructions (untuk reviewer)

Buat akun Santriverse **khusus reviewer** dengan status Premium, lalu ketik username/password-nya **langsung di kolom Test instructions dashboard** — jangan simpan di repo, chat, atau file ini. Hapus/nonaktifkan akun itu setelah review selesai.

```text
1. Click the Santri Skills toolbar icon to open the side panel.
2. Click "Hubungkan akun Santriverse" and sign in on santriverse.my.id with the test account below, then approve the consent screen.
3. The Skill catalog appears. Click "Download ZIP" to verify package download, or:
   - "Pasang ke Gemini": opens gemini.google.com/skills (requires being signed in to a Google account with Gemini) and fills the upload form; click Create to finish.
   - "Pasang ke ChatGPT": opens chatgpt.com/plugins (requires a signed-in ChatGPT account) and uploads the plugin; click Install plugin to finish.
4. A non-Premium account sees "Khusus Member Premium" with an upgrade link — this is expected.

Test account (Premium): <isi di dashboard>
```
