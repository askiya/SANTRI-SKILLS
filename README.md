<p align="center">
  <img src="https://raw.githubusercontent.com/askiya/SANTRI-SKILLS/main/assets/banner.png" alt="Santriverse Skills" width="100%">
</p>

<h1 align="center">Santriverse Skills</h1>

<p align="center">
  <img alt="Tested dengan node --test" src="https://img.shields.io/badge/tests-node%20--test-brightgreen">
  <img alt="Node.js 18.17 atau lebih baru" src="https://img.shields.io/badge/node-%3E%3D18.17-339933?logo=nodedotjs&logoColor=white">
  <a href="LICENSE"><img alt="Lisensi MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="npm belum dipublikasikan" src="https://img.shields.io/badge/npm-belum%20dipublikasikan-CB3837?logo=npm&logoColor=white">
</p>

CLI tanpa dependency runtime untuk memasang koleksi **Google Apps Script Skills** dan **Pedoman Monorepo Santriverse** ke Google Antigravity sebagai Agent Skills atau MCP server. Katalog bawaan berasal dari [`registry.json`](registry.json). Pengguna juga dapat memasang katalog lokal terverifikasi sendiri melalui `SANTRI_SKILLS_REGISTRY`; URL katalog jarak jauh sengaja belum diterima sampai tersedia signature/pinning agar daftar perintah MCP tidak menjadi celah supply-chain.

## Prasyarat

- Node.js **18.17 atau lebih baru**
- Git
- Koneksi internet saat katalog perlu diunduh atau diperbarui
- Google Antigravity untuk memakai skill hasil instalasi

## Instalasi

[![npm](https://img.shields.io/npm/v/santriverse-skills)](https://www.npmjs.com/package/santriverse-skills)

### Dari npm — direkomendasikan

```bash
# Jalankan tanpa instalasi global
npx santriverse-skills install

# Atau instal global
npm install --global santriverse-skills
santriverse-skills install
```

### Dari source

```bash
git clone https://github.com/askiya/SANTRI-SKILLS.git
cd SANTRI-SKILLS
npm install
node bin/cli.js install
```

`npm install` menyiapkan checkout lokal; CLI ini tidak memiliki dependency runtime. Untuk menyediakan perintah `santriverse-skills` secara lokal:

```bash
npm link
santriverse-skills --help
```

Tanpa clone permanen, jalankan paket langsung dari GitHub:

```bash
npx github:askiya/SANTRI-SKILLS install
```

## Dashboard premium lokal

Dashboard menyediakan katalog premium, preview repo GitHub, instalasi skill, katalog MCP, dan preset website React Bits lewat browser. Mode website bukan crawler: hanya URL persis `https://reactbits.dev/get-started/mcp` yang diterima. Preview tidak mengambil halaman dan tidak menjalankan `npx`:

```bash
npx santriverse-skills dashboard
# Dari source: node bin/cli.js dashboard
```

Buka `http://127.0.0.1:4173`. Port dapat diganti (gunakan ini bila 4173 sedang dipakai):

```bash
node bin/cli.js dashboard --port=5173
```

Klik **Login dengan Santriverse**. Dashboard membuat `state` acak dan PKCE verifier lokal, membuka halaman `/skills/connect`, lalu menukar ticket sekali pakai melalui API. State/login pending kedaluwarsa setelah 5 menit.

Token sesi hanya hidup di memori proses server lokal: token tidak ditulis ke disk, localStorage, cookie, HTML, respons browser, atau log. Restart dashboard selalu meminta login ulang. Setiap endpoint katalog, preview, install, dan MCP memverifikasi sesi premium ke API pada setiap panggilan; respons 401/403 dan kegagalan jaringan gagal tertutup sebelum penulisan file.

Dashboard hanya bind ke loopback `127.0.0.1`. Jangan proxy atau mengekspos port ini. Biarkan terminal berjalan selama dashboard dipakai; tekan `Ctrl+C` untuk berhenti.

### React Bits melalui preset website

1. Klik **Tambah Skills / MCP → MCP Servers → Website dikenal**. URL tetap `https://reactbits.dev/get-started/mcp`; URL lain ditolak, termasuk variasi query dan trailing slash.
2. Klik **Preview aman**, pilih `shadcn`, salin registry berikut dan **merge** dengan `components.json` pada **setiap project** (jangan mengganti konfigurasi lain):

```json
{"registries":{"@react-bits":"https://reactbits.dev/r/{name}.json"}}
```

3. Activation menampilkan risiko dan meminta persetujuan. Config global `~/.gemini/config/mcp_config.json` mendapat `"shadcn":{"command":"npx","args":["shadcn@latest","mcp"]}`. Ini konfigurasi manual dari [shadcn MCP](https://ui.shadcn.com/docs/mcp), bukan `mcp init --client claude` yang khusus Claude.
4. **Peringatan keamanan:** `@latest` tidak dipin; IDE dapat mengunduh dan menjalankan kode jaringan lewat `npx` ketika MCP dimuat. Node.js/npm dan jaringan diperlukan. Dashboard tidak menjalankan perintah ini. Belum ada versi pin yang dipilih atau diverifikasi.
5. Config ditulis atomik; server lain dipertahankan. Entri `shadcn` lama, bahkan identik, tidak diadopsi. Backup `.bak` yang sudah ada ditolak saat pemasangan preset agar tidak tertimpa; pindahkan manual setelah memeriksanya. Marker `mcp_config.json.santrihub.json` memungkinkan uninstall hanya selama config masih persis milik preset.
6. Refresh MCP di Antigravity. **Config ada bukan IDE terverifikasi.** Callback SantriHub hanya membuktikan bridge `santri-skills`, bukan `shadcn`. Registry project tidak ditulis otomatis dan config global saja belum membuat React Bits tersedia pada project.

### Endpoint remote

Default production:

```text
SANTRI_SKILLS_API_URL=https://api.santriverse.my.id/api
SANTRI_SKILLS_WEBSITE_URL=https://santriverse.my.id
```

Override untuk development lokal saja:

```bash
SANTRI_SKILLS_API_URL=http://127.0.0.1:8000/api \
SANTRI_SKILLS_WEBSITE_URL=http://127.0.0.1:3000 \
node bin/cli.js dashboard --port=5173
```

URL wajib HTTPS. HTTP hanya diterima untuk hostname loopback eksplisit (`127.0.0.1`, `::1`, atau `localhost`).

Kontrak backend:

- `POST /skills/session` menukar `{ticket, code_verifier}` menjadi `{success, token, user}`.
- `GET /skills/session` memverifikasi token dan premium.
- `DELETE /skills/session` mencabut sesi saat logout.
- `GET /skills/catalog` mengembalikan `{success, sources, mcpServers}` yang lolos validator registry ketat.

## SantriHub untuk Windows

Aplikasi desktop untuk member: tanpa Node.js, tanpa Git, tanpa terminal.

**Download:** [SantriHub-Setup.exe (versi terbaru)](https://github.com/askiya/SANTRI-SKILLS/releases/latest/download/SantriHub-Setup.exe) · [semua rilis](https://github.com/askiya/SANTRI-SKILLS/releases)

- Windows 10/11 x64. Dipasang per-user di `%LOCALAPPDATA%\Programs\SantriHub` (tanpa hak administrator), shortcut Start Menu + opsional Desktop, uninstall dari Settings → Apps.
- Jendelanya adalah dashboard yang sama di dalam Microsoft Edge mode aplikasi (bawaan Windows). Menutup jendela menghentikan server lokal; membuka SantriHub dua kali memakai instance yang sama.
- **Login tetap wajib Member Premium Santriverse.** Verifikasi berjalan ke API Santriverse pada setiap aksi, persis seperti `dashboard`.
- Installer belum ditandatangani sertifikat, jadi Windows SmartScreen dapat menampilkan peringatan: pilih **More info → Run anyway**. Cocokkan hash dengan `SHA256SUMS.txt` di halaman rilis.

Dari terminal (Node.js 18.17+), jendela yang sama:

```bash
npx github:askiya/SANTRI-SKILLS app
```

### Pembaruan otomatis

Saat rilis baru terbit, tombol **⬆ Update vX.Y.Z** muncul di top bar dashboard (dicek lewat redirect `releases/latest` GitHub, di-cache 1 jam).

- **SantriHub.exe:** klik **Update sekarang** → installer resmi rilis itu diunduh, SHA-256-nya wajib cocok dengan `SHA256SUMS.txt` rilis yang sama, lalu dipasang senyap dan SantriHub terbuka lagi otomatis. Skill dan pengaturan tidak tersentuh.
- **`npx santriverse-skills dashboard`:** dialog menampilkan perintah `npx santriverse-skills@latest dashboard` untuk disalin.

### Cara kerja `SantriHub.exe`

`SantriHub.exe` adalah [Node.js Single Executable Application](https://nodejs.org/api/single-executable-applications.html). Seluruh aplikasi (`bin/`, `src/`, `registry.json`, aset) ikut di dalam exe dan diekstrak sekali ke `%LOCALAPPDATA%\SantriHubpp-<hash>`; build baru mendapat folder baru dan folder lama dibersihkan. `SantriHub.exe mcp-serve` menjalankan MCP stdio server, sehingga entri MCP yang ditulis dashboard tetap berlaku setelah update. Exe bertipe aplikasi GUI, jadi tidak membuka jendela console.

### Membuat rilis

1. Naikkan `version` di `package.json` (misalnya `0.2.0`) dan commit.
2. Buat dan push tag yang sama persis: `git tag v0.2.0 && git push origin v0.2.0`.
3. Workflow [`release-santrihub.yml`](.github/workflows/release-santrihub.yml) di runner Windows menjalankan tes, membangun `SantriHub.exe`, smoke test (`--version` dan MCP stdio), membuat `SantriHub-Setup.exe` dengan Inno Setup, menguji install/uninstall diam-diam, lalu menerbitkan GitHub Release berisi installer, exe portable, dan `SHA256SUMS.txt`.

Build lokal (Windows x64): `npm run build:exe` → `dist/SantriHub.exe`; installer: `ISCC.exe /DAppVersion=0.2.0 installer\santrihub.iss` → `dist/SantriHub-Setup.exe`.

## Santri Code untuk VS Code dan Antigravity

Extension editor [`ide-extension/`](ide-extension/README.md): chat AI Flow Studio Santriverse di VS Code, Antigravity, Cursor, dan Windsurf untuk menyusun PRD, ARCHITECTURE.md, SDLC, dan DESIGN.md lalu menyimpannya langsung ke project. Khusus Member Premium; model, kredit, dan batas harian sama dengan AI Flow Studio di website.

- Login lewat browser (`/skills/connect?client=code`, PKCE, callback `127.0.0.1`). Token sesi khusus chat disimpan di SecretStorage editor, berlaku 30 hari.
- API: `/api/code/*` memakai controller chat AI Flow Studio yang sama, termasuk cek Premium dan kredit di server.

```bash
npm run build:ide   # dist/santri-code-<versi>.vsix
npm run test:ide
```

Pasang: **Extensions → ⋯ → Install from VSIX…** di VS Code atau Antigravity, atau `code --install-extension dist/santri-code-<versi>.vsix`.

### Rilis ke marketplace

1. Naikkan `version` di `ide-extension/package.json` dan tulis `ide-extension/CHANGELOG.md`.
2. `npm run package:ide` → `dist/santri-code-<versi>.vsix` (dikemas `@vscode/vsce` resmi).
3. **VS Code Marketplace** (publisher `santriverse`): https://marketplace.visualstudio.com/manage → item Santri Code → **⋯ → Update** → upload VSIX. Rilis pertama: **New extension → Visual Studio Code**.
4. **Open VSX** (Antigravity, Cursor, Windsurf): `npx ovsx publish dist/santri-code-<versi>.vsix -p <token>`. Token dibuat di open-vsx.org → Settings → Access Tokens, diketik langsung di terminal, tidak pernah disimpan di repo.

### Menu Extensions di dashboard

Halaman **Extensions** (dashboard dan SantriHub) menampilkan semua extension resmi beserta link tokonya. Daftarnya ada di satu file, [`src/extensions.js`](src/extensions.js): menambah extension baru cukup dengan menambah satu entri (nama, jenis, versi, deskripsi, link toko, langkah pasang). Di aplikasi SantriHub, link toko dibuka di browser default dan hanya URL yang tercantum di file itu yang diizinkan.

## Menambah repo skill dan MCP sendiri

Dashboard menyediakan kolom **Tambahkan repo GitHub**: masukkan URL `https://github.com/owner/repo`, preview semua `SKILL.md`, pilih skill, lalu install. Repo pihak ketiga tidak dapat menambah atau menjalankan MCP.

Untuk perintah CLI publik (`install`, `list`, `mcp-serve`) atau katalog MCP lokal, salin `registry.json`, tambahkan entri, lalu jalankan CLI dengan env `SANTRI_SKILLS_REGISTRY`. Override lokal ini tidak mengganti katalog premium dashboard; dashboard selalu memakai katalog tervalidasi dari API resmi.

```json
{
  "sources": [
    {
      "id": "skills-tim",
      "label": "Skills Internal Tim",
      "repo": "akun/REPO-SKILLS",
      "branch": "main",
      "skillsDir": "skills",
      "docsDirs": ["docs"]
    }
  ],
  "mcpServers": [
    {
      "id": "playwright",
      "label": "Playwright MCP",
      "description": "Automasi browser",
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  ]
}
```

```bash
SANTRI_SKILLS_REGISTRY=/path/katalog-saya.json node bin/cli.js dashboard
```

Dashboard menampilkan seluruh skill dan MCP dari katalog itu, dan tombol install menulis ke Antigravity sesuai scope pilihan. Validasi menolak id/repo/path tidak aman, perintah dengan metakarakter shell, duplikasi id, serta entri yang memuat token atau kredensial. Entri MCP asing di `mcp_config.json` tidak pernah ditimpa; tabrakan nama menjadi error.

## Perintah CLI

Perintah CLI berikut tetap publik dan **tidak memerlukan login** — cukup koneksi internet untuk mengunduh dari sumber yang terdaftar di `registry.json`:

```bash
node bin/cli.js install       # Pasang Agent Skills
node bin/cli.js update        # Ambil ulang sumber dan perbarui instalasi
node bin/cli.js list          # Tampilkan katalog skill
node bin/cli.js mcp-install   # Daftarkan MCP server santri-skills
node bin/cli.js mcp-serve     # Jalankan MCP server melalui stdio
node bin/cli.js uninstall     # Hapus instalasi yang dikelola CLI
```

Dashboard (memerlukan login premium via Santriverse):

```bash
node bin/cli.js dashboard     # Buka dashboard localhost
```

Semua contoh `node bin/cli.js ...` dapat diganti dengan `santriverse-skills ...` setelah `npm link`, atau `npx santriverse-skills ...` setelah paket tersedia di npm.

Opsi:

| Opsi | Nilai | Fungsi |
|---|---|---|
| `--scope` | `project` atau `global` | Tentukan target instalasi |
| `--sources` | `appscript,monorepo` | Pilih sumber dari `registry.json` |
| `--yes` | — | Mode noninteraktif; default scope `project` |
| `--force` | — | Timpa folder skill bernama sama |
| `--port` | nomor port | Port dashboard; default `4173` |
| `--help` | — | Tampilkan bantuan |
| `--version` | — | Tampilkan versi CLI |

Contoh CI/noninteraktif:

```bash
node bin/cli.js install --scope=project --sources=appscript,monorepo --yes
node bin/cli.js update --scope=global --yes
```

## Scope dan lokasi instalasi

| Scope | Agent Skills | Konfigurasi MCP |
|---|---|---|
| `project` | `<project>/.agents/skills/` | `<project>/.agents/mcp_config.json` |
| `global` | `~/.gemini/config/skills/` | `~/.gemini/config/mcp_config.json` |

Gunakan `project` untuk isolasi per repository. Gunakan `global` jika skill perlu tersedia bagi seluruh project Antigravity milik pengguna saat ini. Reload Antigravity setelah `install`, `update`, atau `mcp-install`.

Folder asing tidak dihapus atau ditimpa secara default. `uninstall` hanya menghapus folder yang memiliki marker `.santri-skills.json`. Perubahan konfigurasi MCP membuat backup `mcp_config.json.bak`.

## Mode MCP

```bash
node bin/cli.js mcp-install --scope=project
```

Installer menambahkan entry `santri-skills` tanpa menghapus MCP server lain. File config valid hanya membuktikan entry ada di disk, bukan bahwa IDE sudah memuat prosesnya. Sesudah reload, minta chat Antigravity memanggil tool `santrihub_status` dari server `santri-skills`. Hasil asli memuat `server`, `version`, `installationRoot`, dan `nodeExecutable`; tool tidak tersedia berarti runtime belum terbukti dimuat.

| Tool | Fungsi |
|---|---|
| `santrihub_status` | Bukti read-only proses MCP aktif dan identitas instalasinya; tanpa config/secret |
| `list_skills` | Daftar skill dan deskripsinya |
| `get_skill` | Baca isi lengkap satu `SKILL.md` |
| `search_docs` | Cari Markdown dari dua repository sumber |

Katalog MCP terbatas pada sumber dalam [`registry.json`](registry.json):

- [`askiya/GOOGLE-APPSCRIPT-SKILLS`](https://github.com/askiya/GOOGLE-APPSCRIPT-SKILLS)
- [`askiya/MONOREPO-SKILLS`](https://github.com/askiya/MONOREPO-SKILLS)

## Workflow pembaruan

### Isi skill berubah

Tidak perlu merilis paket npm.

1. Edit dan push skill ke repository sumber.
2. Jalankan `node bin/cli.js update` pada instalasi pengguna.
3. Reload Antigravity.

`update` mengambil branch `main` terbaru dari sumber terpilih lalu memasangnya kembali ke scope tujuan.

### Kode CLI berubah

Perubahan installer, dashboard, MCP server, atau metadata paket memerlukan rilis baru:

1. Ubah kode dan test.
2. Naikkan versi di `package.json`.
3. Verifikasi dengan `npm test` dan `npm pack --dry-run`.
4. Buat tag/release GitHub (`git tag vX.Y.Z && git push origin vX.Y.Z`).
5. Publish ke npm dari clone bersih tag tersebut, oleh pemilik akun npm `nasimulaskiya`:

```bash
git clone --depth 1 --branch vX.Y.Z https://github.com/askiya/SANTRI-SKILLS.git santriverse-skills-release
cd santriverse-skills-release
npm test
npm login
npm publish --access public
```

Cocokkan `shasum` yang dicetak `npm publish` dengan `npm view santriverse-skills dist.shasum`.

## Keamanan dan batasan

- Tinjau repository sumber sebelum instalasi. Skill dan dokumen jarak jauh adalah instruksi bagi agent, sehingga sumber yang disusupi dapat membawa instruksi berbahaya atau prompt injection.
- `update` mengambil konten branch `main`, bukan commit yang dipin. Hasil dapat berubah tanpa perubahan versi CLI.
- `--force` dapat menimpa folder bernama sama. Gunakan hanya setelah memeriksa target dan menyimpan perubahan lokal.
- Scope `global` memengaruhi semua project pengguna. Pilih scope `project` untuk membatasi dampak.
- MCP membaca katalog yang di-cache dari sumber terdaftar; ini bukan sandbox dan bukan mekanisme verifikasi tanda tangan konten.
- Dashboard memerlukan login premium Santriverse dan hanya listen di `127.0.0.1`. Jangan mem-proxy atau mengekspos port ke jaringan yang tidak tepercaya.
- **Batas lisensi yang jujur:** CLI ini open source. Siapa pun dapat membaca, fork, menghapus pemeriksaan login, atau menjalankan `install`/`update`/`mcp-serve` tanpa akun. Yang benar-benar dilindungi adalah **API resmi Santriverse** (`/skills/session`, `/skills/catalog`): endpoint itu menolak token non-premium di server. Kode sumber publik tidak dapat menegakkan lisensi offline, dan tidak ada klaim sebaliknya di sini.
- **Repo GitHub pihak ketiga:** hanya URL HTTPS bentuk `https://github.com/owner/repo` diterima. Host lain, SSH, subpath, kredensial dalam URL, dan redirect ditolak. Arsip dibatasi 25 MB terunduh / 80 MB terekstraksi; entri dengan `..`, path absolut, atau symlink/hardlink ditolak. Preview hanya **membaca** `SKILL.md` sebagai teks; tidak ada kode dari repo yang dijalankan, dan instalasi hanya terjadi setelah Anda memilih skill secara eksplisit.
- **MCP dari repo sembarangan tidak didukung.** MCP server berarti menjalankan perintah di mesin Anda, sehingga hanya katalog MCP terkurasi dari API resmi yang dapat didaftarkan. Dashboard menulis konfigurasi saja dan tidak pernah mengeksekusi perintah MCP.
- Scope `project` adalah default. Scope `global` memengaruhi semua project Antigravity dan memerlukan konfirmasi eksplisit di UI maupun flag `confirmGlobal` di API lokal.
- Backup MCP hanya satu file `.bak`; simpan backup terpisah sebelum perubahan penting.
- CLI tidak meminta API key. Jangan menaruh secret di skill, dokumen, argumen CLI, atau konfigurasi yang masuk version control.

## Development

```bash
npm install
npm test
node bin/cli.js list
npm pack --dry-run
```

## Lisensi

[MIT](LICENSE)

### Override lokasi Antigravity
Dashboard menghormati `SANTRI_SKILLS_AG_HOME` (prioritas) atau `ANTIGRAVITY_HOME` untuk memindahkan basis config global dari `~/.gemini/config`. Override hanya berlaku pada proses dashboard. Target kustom UI hanya disimpan di memori proses dan harus lolos validasi path aman.
