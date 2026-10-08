# Santri Code

**AI Flow Studio Santriverse di VS Code, Antigravity, Cursor, dan Windsurf.**

Diskusikan ide produk bersama AI Santriverse, lalu susun dokumen perencanaan dan simpan langsung ke project:

| Dokumen | Disimpan sebagai |
| --- | --- |
| PRD & Product Spec | `PRD.md` |
| System Architecture | `ARCHITECTURE.md` |
| SDLC Lifecycle Plan | `SDLC.md` |
| DESIGN.md Token System | `DESIGN.md` |

Dokumen di root project langsung bisa dibaca agent coding (Antigravity, Claude Code, Cursor, dan lainnya) sebagai acuan saat membangun aplikasi.

> Khusus **Member Premium Santriverse**. Kredit, model, dan batas harian sama dengan AI Flow Studio di website.

## Cara pakai

1. Buka panel **Santri Code** di sidebar kanan: tekan `Ctrl+Shift+Alt+S` (Mac `Ctrl+Cmd+S`), klik ikon ✨ di toolbar atas editor, atau klik **Santri** di status bar. Panel bisa diseret ke sisi lain bila perlu.
2. **Login dengan Santriverse**. Browser membuka santriverse.my.id; setujui koneksi, lalu kembali ke editor. Password tidak pernah diketik di editor.
3. Pilih model, klik salah satu starter (PRD, Architecture, DESIGN.md, SDLC) atau ketik sendiri.
4. Saat AI menulis dokumen, file (mis. `ARCHITECTURE.md`) **langsung dibuat di folder project dan diketik realtime di editor**, bagian demi bagian, lalu disimpan begitu selesai. File yang sudah kamu ubah tidak ditimpa — versi baru disimpan sebagai `ARCHITECTURE-2.md`.

Tombol **+ Konteks project** melampirkan (sekali di awal percakapan, tidak pada balasan seperti `ACC`) struktur folder, `package.json`/`composer.json`, dan cuplikan README supaya dokumen sesuai project yang sedang dibuka. File `.env`, kunci, dan isi kode sumber tidak pernah dikirim.

## Perintah

`Ctrl+Shift+P` → ketik **Santri Code**:

- Buka Chat · Buka di Tab Editor · Chat Baru
- Mulai PRD & Product Spec · Mulai System Architecture · Mulai DESIGN.md Token System · Mulai SDLC Lifecycle Plan
- Login Santriverse · Keluar

## Pengaturan

| Setting | Default | Keterangan |
| --- | --- | --- |
| `santriCode.documentsFolder` | *(kosong)* | Folder relatif tempat dokumen disimpan, mis. `docs`. Kosong = root workspace. |
| `santriCode.autoSaveDocuments` | `true` | Simpan dokumen final ke project otomatis. Matikan bila ingin menyimpan manual lewat tombol Simpan. |
| `santriCode.typingAnimation` | `true` | Ketik dokumen realtime di editor saat AI menulis. Matikan untuk menulis file sekaligus di akhir. |

## Privasi

- Sesi disimpan di SecretStorage editor (keychain OS), berlaku 30 hari, dan hanya bisa dipakai untuk chat AI Flow Studio.
- Pesan (dan konteks project bila diaktifkan) dikirim ke API Santriverse lalu ke provider AI yang dipilih admin Santriverse.
- Kebijakan privasi: https://santriverse.my.id/docs/santri-code-privacy
