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

## Pasang ke Gemini (2 klik)

Gemini menerima Skill sebagai folder/ZIP dengan `SKILL.md` di folder utama (gemini.google.com/skills → Upload). Alur **Pasang ke Gemini**:

1. Cek Premium (`verifyPremium()`), unduh paket, verifikasi ukuran + SHA-256.
2. `zip.js` membaca ZIP di memori (`DecompressionStream`, tanpa library), membuka folder pembungkus tunggal, membuang `.DS_Store`/`__MACOSX`/`.pyc`, menolak path `..`, dan memastikan nama di `SKILL.md` kebab-case.
3. Panel membuka/memakai tab `gemini.google.com/skills` (tab chat tidak pernah diambil alih).
4. `gemini-skills.js` (content script) membuka dialog Upload milik Gemini; `gemini-skills-bridge.js` (MAIN world) menjatuhkan paket sebagai folder ke area upload. Area itu membaca drop lewat `webkitGetAsEntry()`, jadi bridge menjawab hanya untuk item miliknya sendiri lalu memulihkan API halaman.
5. Gemini menampilkan halaman Review. **Member yang menekan “Buat”** — extension tidak pernah menekannya.
6. Panel memantau daftar Skills; status **Terdeteksi di Gemini** hanya muncul setelah Gemini sendiri menampilkan nama skill dan halaman Review sudah tertutup. Versi yang terpasang dicatat di `chrome.storage.local` untuk menandai **Update tersedia**.

Jika satu langkah gagal (tampilan Gemini berubah, akun belum mendapat fitur Skills), panel menampilkan panduan manual: Download ZIP → Upload ZIP di Gemini Skills → Buat. ZIP tidak perlu diekstrak.

Gems tetap memakai `gem_url`/langkah manual.

## Test

Dari root repository:

```bash
node --test test/extension.test.js test/extension-security.test.js test/extension-member-flow.test.js test/extension-layout.test.js test/extension-gemini-install.test.js
```

Tidak ada runtime package tambahan, secret, build step, atau konfigurasi repository.
