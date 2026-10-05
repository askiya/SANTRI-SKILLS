# SantriHub — acuan parity Notes

Sumber read-only: `apps/notes/src/styles/index.css` (seluruh 468 baris), `Sidebar.tsx`, `Home.tsx`. Dashboard vanilla tanpa build/CDN. Notes tidak punya `--bg`/`--text`: nama aslinya `--canvas`/`--ink`.

| Notes (nilai eksak) | Dashboard |
|---|---|
| dark canvas `25 25 27`, panel `31 31 34` | body/canvas dan sidebar identik, dark default |
| ink `238 237 234`, muted `160 157 151` | teks utama/sekunder identik |
| line `57 57 61`, accent `147 130 255` | border `1px solid rgb(var(--line))`; focus/aksen `rgb(var(--accent))` |
| font `Inter, ui-sans-serif, system-ui, sans-serif` | stack identik; tanpa Google Fonts eksternal; Inter hanya bila terpasang lokal |
| sidebar min 210px / max 420px; fallback `--sb-w:260px`; rail 52px | default 260px, rail 52px; resize 210–420px |
| sidebar transition `.3s cubic-bezier(.22,.8,.3,1)` untuk transform/width/margin-right | collapse/drawer identik |
| workspace-head min-height 62px, gap 10px, padding 11px 12px | identik |
| logo 31px, radius 9px | workspace dan rail; fallback SV bila gagal |
| workspace name 13px/650/-.01em; subtitle 10px | SantriHub / Workspace lokal |
| sidebar-scroll padding 3px 8px; nav gap 2px | identik |
| nav height 33px, gap 9px, padding 0 9px, radius 7px, 13px/500 | tombol nav berikon inline SVG |
| hover/aktif `rgb(var(--line) / .7)` | identik |
| nav-section margin-top 20px; label height 26px, padding 0 6px 0 9px, 10px/650/.055em uppercase | identik |
| new-page 38px, margin 8px, padding 0 11px, dashed border, radius 8px, 12px | aksi katalog sidebar |
| user-card 58px, gap 9px, padding 8px 10px; avatar 31px / 50% | profil akun Santriverse, inisial |
| user-copy 11px/600, email 9px; dropup radius 14px, bottom calc(100% + 9px), shadow 0 18px 50px rgb(0 0 0 / .18) | profil dan logout; Notes tidak memiliki keyframes dropup |
| rail button 36px/radius 8px; logo toggle radius 9px | rail collapsed |
| rail logo opacity .16s ease, transform .2s cubic-bezier(.22,.8,.3,1) | identik |
| home width min(100%,1180px), padding 52px clamp(24px,5vw,72px) 80px | halaman utama dan ritme halaman katalog |
| banner margin-bottom 48px; marquee 10px/650/.11em; padding 8px 0 | teks integrasi Skills + MCP ke Antigravity |
| home-marquee 26s linear infinite, translateX(-50%) | identik; dua salinan aria-hidden |
| h1 clamp(32px,4vw,54px)/650/-.052em, line-height 1.05 | sapaan member |
| typewriter greeting type 58ms, erase 30ms, hold 1700ms | identik; reduced-motion statis |
| caret 2px × .9em; margin-left 4px; 1s step-end infinite; opacity 1 pada 0/100%, 0 pada 50% | identik |
| home-actions gap 11px, margin-top 32px | search + aksi utama |
| search 46px / radius 13px / panel .65, border-color .16s, box-shadow .16s | identik |
| create 46px / radius 12px / 12px/650 / ink background | identik |
| home-section margin 42px 0 15px, 13px/650 | ringkasan |
| grid auto-fill minmax(205px,1fr), gap 14px | kartu ringkasan |
| card min-height178px, padding20px, radius16px; tint border22% / bg8%; transform/border/shadow .18s ease | identik |
| card hover translateY(-2px), shadow 0 12px 30px rgb(0 0 0 / .07) | identik |
| card icon37px/radius10px; title14px/650, margin24px; meta10px/padding-top13px | identik |
| empty min-height230px/gap12px/dashed/radius16px | state kosong |
| gate card width420px/padding40px/radius18px; dark shadow 0 20px 70px rgb(0 0 0 / .4) | login premium terkunci |
| toast padding10px 14px/radius10px/12px/600, shadow 0 10px 32px rgb(0 0 0 / .18) | status operasi |
| toast-in .2s cubic-bezier(.22,.8,.3,1), opacity0/y8px ke opacity1/y0; toast-out .18s ease, y0 ke y5px | toast masuk; status terakhir tetap tersedia |
| label marquee 4s linear, translateX(calc(-50% - 1rem)), gap2rem | dicatat; nav pendek tidak perlu label marquee |
| focus-visible outline2px solid accent, offset2px | semua tombol/input/link |
| scrollbar: toolbar none; tab-scroll thin; tidak ada global scrollbar custom | main/sidebar native thin; tanpa pseudo scrollbar dekoratif |
| breakpoint tunggal max-width720px; sidebar min(84vw,310px), shadow14px 0 45px rgb(0 0 0 / .2); backdrop black .36 blur2px | drawer mobile + backdrop |
| mobile home padding66px 20px 72px, banner margin30px, actions column; grid min150px gap11px; card min152px padding16px | identik |
| reduced-motion semua transition/animation .01ms, iteration1, scroll auto | identik + timer typewriter statis |

## Struktur sumber

Sidebar: `sidebar-rail > rail-brand-toggle + rail-btn + rail-spacer + rail-bottom-actions`; `sidebar > workspace-head + sidebar-scroll (main-nav + sidebar-search + nav-section/section-label) + new-page + user-card/ProfileMenu + resize-handle`. ProfileMenu menutup lewat klik luar/Escape; nama dan email aman via textContent. MarqueeText menduplikasi teks hanya saat hover overflow, salinan aria-hidden.

Home: `home > home-banner/home-marquee + home-head/typewriter/type-caret + home-actions/home-search/home-create + home-section + home-grid/home-card`; home-empty ketika kosong.

## Root cause logo

Port 5199: PID 29432, command `node bin/cli.js dashboard --port=5199`, mulai 2026-10-05 17:10:56. `src/dashboard.js` diubah 17:46:47, HTML 17:47:26. HTTP logo 404 `application/json`, `/api/status?scope=project` 404 `Tidak ditemukan`. Proses lama menyimpan STATIC/routes lama tetapi membaca HTML baru dari disk. `default-src 'self'` sudah mengizinkan gambar same-origin; CSP bukan penyebab. Port 5200 tidak berjalan saat audit. Solusi: jalankan proses terbaru pada 5200; jangan memakai tab 5199 lama. Fallback teks mencegah kotak kosong bila asset gagal.

## Batas parity

Tidak menyalin React/Tailwind, editor, modal share, atau font remote. Nama package/bin dan ID MCP tetap kompatibel; nama UI SantriHub. Halaman premium tidak dibypass. Bukti browser dan gate dicatat setelah verifikasi nyata.
