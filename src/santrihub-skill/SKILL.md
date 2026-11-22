---
name: santrihub
description: Pakai di awal setiap tugas membuat, memperbaiki, mereview, atau mendeploy aplikasi (web app, Google Apps Script, monorepo, UI, database, API). Cari skill dan MCP yang cocok di SantriHub lewat tool hub_cari dari MCP santrihub, lalu muat yang relevan saja.
---

# SantriHub

SantriHub menyimpan semua skill dan MCP milik pengguna: paket Apps Script, paket Monorepo, dan skill buatannya sendiri. Semuanya tersedia lewat satu MCP bernama `santrihub`.

## Cara pakai

1. Di awal tugas, panggil tool `hub_cari` dari MCP `santrihub` dengan:
   - `tugas`: ringkasan tugas pengguna dalam satu kalimat;
   - `project_path`: path absolut folder proyek yang sedang dikerjakan, bila tahu.
2. Muat 1–3 skill paling relevan dari hasilnya dengan `hub_skill`, lalu ikuti instruksi skill itu. File pendukungnya dibaca dengan `hub_skill` + `path`.
3. Butuh alat luar seperti database, GitHub, atau deploy? Cari dengan `hub_alat`, jalankan dengan `hub_pakai`.
4. Butuh materi pedoman (bab kelas, paket arsitektur, checklist, template)? Pakai `hub_docs`.

## Aturan

- Jangan memuat semua skill sekaligus; pilih yang dibutuhkan tugas ini saja.
- Kalau tugas berubah arah (misalnya dari membangun ke deploy), panggil `hub_cari` lagi.
- Kalau MCP `santrihub` tidak tersedia, beri tahu pengguna: buka aplikasi SantriHub, tekan **Hubungkan** pada AI agent ini, lalu muat ulang agent.
