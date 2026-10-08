# Changelog

## 0.1.6

- Perbaikan: di Windows (file baru ber-EOL CRLF) pengetikan live di editor tidak lagi berhenti setelah baris pertama. File yang diketik dipindah ke LF, dan perbandingan isi mengabaikan perbedaan CRLF/LF sehingga revisi berikutnya tetap memperbarui file yang sama.

## 0.1.5

- Perbaikan: balasan `ACC` (dan "lanjut", "ok", …) kini terkirim apa adanya walau "Konteks project" aktif, sehingga AI Flow Studio langsung menulis dokumen fase 3 per bagian. Sebelumnya konteks yang ikut menempel membuat ACC tidak dikenali dan jawaban bisa macet.
- Konteks project dilampirkan sekali di awal percakapan, tidak di setiap pesan.

## 0.1.4

- Progres chat sama dengan AI Flow Studio di website: ✦ "Permintaan dalam antrean…" dengan timer, langkah "Permintaan diterima server", "Menunggu giliran worker", "Menulis bagian 2/6 · …", lalu "Jawaban selesai".
- Dokumen diketik langsung di editor secara realtime: file (mis. ARCHITECTURE.md) dibuat begitu AI mulai menulis dan isinya mengikuti setiap bagian; kartu dokumen di chat ikut mengetik. Bila run gagal atau dihentikan, file dikembalikan seperti semula.
- Setting baru `santriCode.typingAnimation`.

## 0.1.3

- Dokumen final langsung tersimpan ke project (mis. setelah ACC fase 3): PRD.md, ARCHITECTURE.md, SDLC.md, DESIGN.md muncul di Explorer dan terbuka di editor, tanpa klik Simpan.
- File yang sudah kamu ubah tidak pernah ditimpa; versi baru disimpan sebagai NAMA-2.md. Matikan lewat setting `santriCode.autoSaveDocuments`.

## 0.1.2

- Cara cepat membuka panel yang tertutup: ikon ✨ di toolbar atas editor, shortcut `Ctrl+Shift+Alt+S` (Mac `Ctrl+Cmd+S`), dan klik status bar "Santri".

## 0.1.1

- Panel Santri Code kini berada di sidebar kanan (Secondary Side Bar), berdampingan dengan editor. Editor lama yang belum mendukung sidebar kanan menampilkannya di Explorer.

## 0.1.0

- Rilis pertama: chat AI Flow Studio Santriverse di VS Code dan Antigravity.
- Login lewat browser (PKCE) dengan sesi khusus Santri Code.
- Kartu dokumen PRD / ARCHITECTURE / SDLC / DESIGN dengan progres per bagian, lalu simpan ke workspace.
- Opsi lampiran konteks project (struktur folder, manifest, README).
- Riwayat chat, pemilih model dengan logo, sisa kredit di panel dan status bar.
