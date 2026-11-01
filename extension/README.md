# Santri Skills — Chrome MV3 extension

Side panel untuk member Santriverse: katalog premium, handoff ke Gemini, download paket manual, dan tutorial pemasangan.

## Load unpacked

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih direktori `extension/` ini.
5. Pin **Santri Skills**, lalu klik ikonnya untuk membuka side panel.

Chrome 114+ diperlukan (Side Panel API dan content script `world: "MAIN"`).

## Autentikasi dan konfigurasi callback

Manifest memuat `key`, jadi extension ID selalu `fdhomioibdphiooncfcidjjbpoebfcep` di setiap mesin — callback resmi menjadi `https://fdhomioibdphiooncfcidjjbpoebfcep.chromiumapp.org/`.

ID itu sudah di-allowlist di frontend (`SKILLS_EXTENSION_ID`), jadi tidak ada env wajib untuk load unpacked. Untuk paket Chrome Web Store dengan ID berbeda, override lewat build env `VITE_SKILLS_CHROME_EXTENSION_ID=<id-web-store>`.

Callback diterima hanya dalam dua bentuk: `https://<allowlisted-id>.chromiumapp.org/` (extension) dan `http://127.0.0.1:<port>/auth/callback` (SantriHub lokal). Bentuk lain ditolak halaman `/skills/connect`.

Catatan: perubahan allowlist baru berlaku setelah frontend Santriverse di-build dan di-deploy ulang.

Login memakai `chrome.identity.launchWebAuthFlow`, state + PKCE S256, lalu `POST /api/skills/session`. Token scoped Skills hanya di `chrome.storage.session`; panel memulihkan sesi via `GET /api/skills/session` dan Keluar memanggil `DELETE /api/skills/session`.

Persetujuan berasal dari server (`consent.version` di catalog, `POST /api/skills/consent`). Download memakai bearer scoped dan memverifikasi ukuran + SHA-256 katalog sebelum file disimpan.

## Verifikasi Premium

Hak akses dicek oleh API Santriverse, bukan oleh extension: setiap request `/api/skills/*` membaca ulang status premium member (`SkillsAuthMiddleware`). Sebelum memasang, panel memanggil `GET /api/skills/session` (`verifyPremium()`). Jawaban `403 premium_required` (membership berakhir, atau akun belum Premium saat login) menghapus sesi dan menampilkan halaman **Khusus Premium** dengan tombol upgrade ke `https://santriverse.my.id/checkout`.

## Tab platform (Gemini · ChatGPT · Claude)

Katalog dibagi tiga tab. Admin memilih platform tiap paket di `santriverse.my.id/admin/skills` (kolom `platforms` dari `/api/skills/catalog`); paket hanya muncul di tab yang dicentang. Server lama tanpa `platforms` → skill tampil di Gemini + ChatGPT, Gem hanya di Gemini (`platformsOf()` di `catalog.js`).

- Tab awal mengikuti tab browser aktif (gemini.google.com / chatgpt.com / claude.ai), lalu tab terakhir diingat di `localStorage`.
- Tiap kartu: satu tombol utama warna platform + **⇩ ZIP** dalam format platform itu (Gemini: paket asli · ChatGPT: plugin · Claude: folder `<nama>/SKILL.md`).
- Status per platform di `chrome.storage.local`: `install_status`, `chatgpt_status`, `claude_status`. Versi katalog lebih baru → **Update tersedia**.

## Pasang ke Claude

claude.ai: **Customize → Skills → Add → Upload skill** membuka `claude.ai/customize/skills/new/upload` dengan input tersembunyi `aria-label="Skill file"` (`.zip,.skill,.md`) dan tombol **Upload** yang aktif setelah file dipilih (terverifikasi 31 Okt 2026). Alur **Pasang ke Claude**:

1. Cek Premium, unduh paket, verifikasi ukuran + SHA-256.
2. `claude-skill.js` membuat ZIP Claude: satu folder bernama skill di root ZIP. Menolak nama yang memuat `claude`/`anthropic` atau `description` > 1024 karakter; peringatan bila > 200 karakter.
3. `claude-adapter.js` membuka/memakai tab `claude.ai/customize/skills…` dan mengarahkannya ke halaman Upload skill (tab chat tidak diambil alih).
4. `claude-skills.js` (content script) mengisi ZIP ke input **Skill file** dan menunggu tombol **Upload** aktif. Teks petunjuk halaman tidak dianggap error; hanya baris baru yang muncul setelah file dipilih.
5. **Member yang menekan “Upload”** — Claude lalu menjalankan security scan. Extension tidak pernah menekannya.
6. Panel menandai **Terpasang di Claude** setelah Claude menampilkan `View <nama>` di daftar Skills. Tab Skills Claude yang sudah terbuka juga dibaca saat katalog dimuat.

Fallback manual: **⇩ ZIP** Claude → Customize → Skills → Add → Upload skill → pilih ZIP → **Upload**. Tombol **Saya sudah menyelesaikan** mencatat status sebagai laporan member.

## Pasang ke Gemini (2 klik)

Sejak Oktober 2026 Skills Gemini ada di **Customize → Skills** (`gemini.google.com/customize/skills`; URL lama `/skills` di-redirect ke sana) dengan tombol **Create → Upload** yang menerima `SKILL.md`, folder, atau ZIP dengan `SKILL.md` di folder utama. Alur **Pasang ke Gemini**:

1. Cek Premium (`verifyPremium()`), unduh paket, verifikasi ukuran + SHA-256.
2. `zip.js` membaca ZIP di memori (`DecompressionStream`, tanpa library), membuka folder pembungkus tunggal, membuang `.DS_Store`/`__MACOSX`/`.pyc`, menolak path `..`, dan memastikan nama di `SKILL.md` kebab-case. `gemini-adapter.js` lalu melewati tipe file yang ditolak Gemini (arsip, audio/video, `.ts`, `.tsx`, `.php`, `.sql`, Office lama); file yang dilewati disebut di panel.
3. Panel membuka/memakai tab Customize → Skills (tab chat tidak pernah diambil alih).
4. `gemini-skills.js` (content script) membuka menu **Buat/Create** milik Gemini (tombol menu ber-`aria-haspopup`, bukan tombol Buat yang menyimpan), memilih **Upload**, lalu menunggu dialog **Upload keahlian**. `gemini-skills-bridge.js` (MAIN world) menjatuhkan paket sebagai folder ke `div.upload-area`. Area itu membaca drop hanya lewat `webkitGetAsEntry()` (terverifikasi 31 Okt 2026), jadi bridge menjawab hanya untuk item miliknya sendiri lalu memulihkan API halaman.
5. Gemini menampilkan halaman Review. **Member yang menekan “Create” (Buat)** — extension tidak pernah menekannya.
6. Halaman Review dikenali dari tombol simpan **Buat** (tanpa `aria-haspopup`, aria-label “Simpan keterampilan”) plus kolom `contenteditable`; tombol menu **Buat** di halaman daftar tidak dihitung. Panel memantau daftar Skills; status **Terdeteksi di Gemini** hanya muncul setelah Gemini sendiri menampilkan nama skill dan halaman Review sudah tertutup. Versi yang terpasang dicatat di `chrome.storage.local` untuk menandai **Update tersedia**.

Jika satu langkah gagal (tampilan Gemini berubah, akun belum mendapat fitur Skills), panel menampilkan panduan manual: Download ZIP → Customize → Skills → Create → Upload → Create. ZIP tidak perlu diekstrak. Untuk versi baru di Gemini: buka skill → **More → Replace skill**.

Gems tetap memakai `gem_url`/langkah manual.

## Pasang ke ChatGPT (Plugins)

ChatGPT menggantikan Custom GPT dengan **Plugins** (Custom GPT pensiun 11 Desember 2026). Plugin memuat skill dengan format `SKILL.md` yang sama, jadi paket Santriverse cukup dibungkus — tidak ditulis ulang. Alur **Pasang ke ChatGPT**:

1. Cek Premium (`verifyPremium()`), unduh paket, verifikasi ukuran + SHA-256.
2. `chatgpt-plugin.js` membungkus skill menjadi plugin portable (di memori, tanpa library):
   `plugin.json` (Agent Plugins schema + `extensions.com.openai.interface`: nama, deskripsi, Santriverse, logo) · `skills/<nama>/SKILL.md` · `skills/<nama>/references/…` · `assets/logo.png`.
3. Panel membuka/memakai tab `chatgpt.com/plugins` (tab chat tidak pernah diambil alih).
4. `chatgpt-plugins.js` (content script) membuka **Add → Upload plugin archive** (menu ber-`aria-haspopup`, terverifikasi 31 Okt 2026), mengisi ZIP ke dialog **New Plugin**, lalu berhenti saat tombol **Add plugin** aktif. Teks statis dialog tidak dianggap error; hanya baris baru setelah file dipilih. Dialog lama yang langsung mengimpor (**Impor berhasil → Lihat Plugin**) tetap diikuti.
5. **Member yang menekan “Add plugin” lalu “Install plugin”** — extension tidak pernah menekannya. Panel mencatat ID plugin dari halaman plugin, atau dari ikon baru berjudul sama di baris **Installed** (ikon yang sudah ada sebelumnya diabaikan).
6. Pakai di chat biasa dengan `@Nama Plugin` (teruji di akun Free; file referensi terbaca).

Extension tidak pernah mengunggah plugin duplikat: versi sama → membuka halaman plugin; versi baru (**Update di ChatGPT**) → membuka halaman plugin yang sudah ada, menekan **⋯ More actions → Upload new version** (terverifikasi 1 Nov 2026), lalu memasukkan ZIP versi baru ke dialog itu (dialog tidak punya tombol konfirmasi; memilih file langsung mengunggah). Panel menunggu sampai **Version** di bagian Information berganti. Bila ChatGPT sudah memakai versi itu, status panel cukup disinkronkan tanpa unggah ulang. Menu **Uninstall / Delete plugin** tidak pernah disentuh.

Fallback manual: **Download ZIP ChatGPT** → chatgpt.com/plugins → Add → Upload plugin archive → pilih ZIP → Add plugin → Install plugin.

## Test

Dari root repository:

```bash
node --test test/extension.test.js test/extension-security.test.js test/extension-member-flow.test.js test/extension-layout.test.js test/extension-gemini-install.test.js test/extension-chatgpt-install.test.js test/extension-platforms.test.js test/extension-claude-install.test.js test/extension-store-package.test.js
```

Tidak ada runtime package tambahan, secret, atau konfigurasi repository. Load unpacked tidak butuh build step.

## Chrome Web Store

```bash
npm run build:extension   # dist/santri-skills-extension-<versi>.zip, tanpa "key"
npm run store:assets      # extension/store/*.png (butuh Google Chrome)
```

Web Store menolak field `key` dan memberi ID baru, jadi ZIP dibuat tanpa `key`; folder `extension/` tetap memakai key untuk load unpacked. Teks listing, jawaban form privasi, justifikasi izin, dan urutan submit ada di [`store/LISTING.md`](store/LISTING.md). Kebijakan privasi: https://santriverse.my.id/docs/santri-skills-privacy
