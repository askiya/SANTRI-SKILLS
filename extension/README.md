# Santri Skills — Chrome MV3 extension

Side panel untuk member Santriverse: katalog premium, handoff ke Gemini, download paket manual, dan tutorial pemasangan.

## Load unpacked

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih direktori `extension/` ini.
5. Pin **Santri Skills**, lalu klik ikonnya untuk membuka side panel.

Chrome 114+ diperlukan untuk Side Panel API.

## Autentikasi dan konfigurasi callback

Manifest memuat `key`, jadi extension ID selalu `fdhomioibdphiooncfcidjjbpoebfcep` di setiap mesin — callback resmi menjadi `https://fdhomioibdphiooncfcidjjbpoebfcep.chromiumapp.org/`.

ID itu sudah di-allowlist di frontend (`SKILLS_EXTENSION_ID`), jadi tidak ada env wajib untuk load unpacked. Untuk paket Chrome Web Store dengan ID berbeda, override lewat build env `VITE_SKILLS_CHROME_EXTENSION_ID=<id-web-store>`.

Callback diterima hanya dalam dua bentuk: `https://<allowlisted-id>.chromiumapp.org/` (extension) dan `http://127.0.0.1:<port>/auth/callback` (SantriHub lokal). Bentuk lain ditolak halaman `/skills/connect`.

Catatan: perubahan allowlist baru berlaku setelah frontend Santriverse di-build dan di-deploy ulang.

Login memakai `chrome.identity.launchWebAuthFlow`, state + PKCE S256, lalu `POST /api/skills/session`. Token scoped Skills hanya di `chrome.storage.session`; panel memulihkan sesi via `GET /api/skills/session` dan Keluar memanggil `DELETE /api/skills/session`.

Persetujuan berasal dari server (`consent.version` di catalog, `POST /api/skills/consent`). Download memakai bearer scoped dan memverifikasi ukuran + SHA-256 katalog sebelum file disimpan. Upload ke Gemini tetap manual.

## Gemini adapter

Adapter hanya membuka halaman Gems/Skills dan menampilkan langkah manual. Extension tidak menyatakan pemasangan berdasarkan DOM dan tidak mengklaim upload file otomatis. Status “Dikonfirmasi member” adalah laporan member, bukan verifikasi versi/aktivasi di Gemini.

## Test

Dari root repository:

```bash
node --test test/extension.test.js test/extension-security.test.js test/extension-member-flow.test.js
```

Tidak ada runtime package tambahan, secret, build step, atau konfigurasi repository.
