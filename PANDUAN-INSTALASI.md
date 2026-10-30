# Panduan Instalasi SantriHub

SantriHub menghubungkan skill dan MCP Santriverse ke AI agent di komputer Anda. Pilih cara sesuai komputer Anda:

| Komputer | Cara |
|---|---|
| Windows 10/11 | [A. Installer](#a-windows-pakai-installer-disarankan) (paling mudah) |
| Windows yang menolak installer | [B. Lewat Node.js](#b-windows-lewat-nodejs-jika-installer-diblokir) |
| macOS | [C. macOS](#c-macos) |
| Linux | [D. Linux](#d-linux) |

Semua cara memakai akun **Member Premium Santriverse** untuk login.

---

## A. Windows: pakai installer (disarankan)

1. Download **SantriHub-Setup.exe**:
   https://github.com/askiya/SANTRI-SKILLS/releases/latest/download/SantriHub-Setup.exe
2. Buka file yang sudah terdownload.
3. Jika muncul layar biru **"Windows protected your PC"**, klik **More info**, lalu **Run anyway**.
   Peringatan ini muncul karena installer belum memakai sertifikat berbayar. Aplikasi yang terpasang berjalan di atas Node.js resmi yang sudah ditandatangani.
4. Klik **Next** sampai selesai. Tidak perlu hak administrator.
5. SantriHub terbuka otomatis. Selanjutnya buka dari **Start Menu → SantriHub** (atau ikon di Desktop jika dicentang saat instalasi).
6. Klik **Login**, masuk dengan akun Santriverse di browser, lalu kembali ke SantriHub.

Mendukung PC biasa (x64) dan laptop ARM (misalnya Snapdragon). Pembaruan cukup lewat tombol **Update** di dalam SantriHub.

> **Installer tidak mau jalan sama sekali?** Biasanya karena *Smart App Control* (Windows 11) atau kebijakan kantor/sekolah. Pakai cara B di bawah.

---

## B. Windows: lewat Node.js (jika installer diblokir)

Cara ini memakai Node.js resmi, jadi tetap jalan di komputer yang menolak installer.

### 1. Pasang Node.js (sekali saja)

1. Buka https://nodejs.org
2. Klik tombol download versi **LTS**, lalu pilih **Windows Installer (.msi)**.
3. Buka file `.msi`, klik **Next** terus dengan pilihan bawaan, lalu **Install**, lalu **Finish**.
   Jika ada centang *"Automatically install the necessary tools"*, biarkan **tidak** dicentang. Tidak dibutuhkan.
4. Cek: tekan tombol **Windows**, ketik `cmd`, tekan Enter. Di jendela hitam ketik:
   ```
   node -v
   ```
   Jika muncul angka versi (misalnya `v24.22.2`), Node.js sudah terpasang.
   Jika muncul *"not recognized"*, tutup jendela itu, buka lagi, dan coba ulang (atau restart komputer).

### 2. Jalankan SantriHub

Di jendela **Command Prompt** (`cmd`) ketik:

```
npx santriverse-skills@latest app
```

- Pertama kali, ketik `y` lalu Enter jika ditanya *"Ok to proceed?"*.
- Jendela SantriHub akan terbuka. Jendela Command Prompt boleh di-minimize.
- Untuk membuka lagi lain kali, jalankan perintah yang sama. `@latest` membuat Anda selalu memakai versi terbaru.

> Pakai **Command Prompt** (`cmd`), bukan PowerShell. Di PowerShell sering muncul error *"running scripts is disabled"*. Jika terpaksa pakai PowerShell, ketik `npx.cmd santriverse-skills@latest app`.

---

## C. macOS

Di macOS, SantriHub berjalan sebagai halaman **localhost** di browser Anda (Safari, Chrome, dll.).

### 1. Pasang Node.js (sekali saja)

1. Buka https://nodejs.org
2. Download versi **LTS** untuk macOS (**macOS Installer (.pkg)**). Installer ini cocok untuk Mac Intel maupun Apple Silicon (M1/M2/M3/M4).
3. Buka file `.pkg`, ikuti langkahnya sampai selesai.
4. Cek: buka **Terminal** (tekan `Cmd + Spasi`, ketik `Terminal`, Enter), lalu ketik:
   ```
   node -v
   ```
   Muncul angka versi berarti siap.

Sudah memakai Homebrew? Cukup `brew install node`.

### 2. Jalankan SantriHub

Di Terminal ketik:

```
npx santriverse-skills@latest app
```

- Ketik `y` lalu Enter jika ditanya *"Ok to proceed?"*.
- Browser terbuka di `http://127.0.0.1:4173`. Itulah SantriHub.
- **Biarkan jendela Terminal tetap terbuka** selama memakai SantriHub. Untuk berhenti, kembali ke Terminal dan tekan `Ctrl + C`.
- Lain kali, jalankan perintah yang sama lagi.

---

## D. Linux

Pasang Node.js LTS (lewat https://nodejs.org atau package manager distro Anda), lalu jalankan:

```
npx santriverse-skills@latest app
```

Browser default terbuka di `http://127.0.0.1:4173`. Biarkan terminal terbuka; `Ctrl + C` untuk berhenti.

---

## Setelah terpasang

1. **Login** dengan akun Member Premium Santriverse.
2. Pilih skill di halaman **Skills**, lalu klik pasang.
3. Daftarkan MCP di halaman **MCP Servers**.
4. **Reload** AI agent Anda (misalnya Google Antigravity) supaya skill dan MCP terbaca.

## Menghapus SantriHub

- **Windows (installer):** Settings → Apps → Installed apps → **SantriHub** → Uninstall.
- **Cara Node.js / macOS / Linux:** tidak ada yang terpasang permanen. Cukup berhenti menjalankan perintahnya.

Skill yang sudah terpasang ke AI agent tidak ikut terhapus. Hapus dari dalam SantriHub sebelum uninstall jika ingin bersih.

## Ada masalah?

**Windows:** download **SantriHub-Diagnosa.zip** dari https://github.com/askiya/SANTRI-SKILLS/releases/latest, ekstrak, lalu klik dua kali `diagnosa-santrihub.cmd`. Laporan `diagnosa-santrihub.txt` muncul di Desktop. Kirim file itu ke admin Santriverse. Skrip ini hanya membaca info sistem dan tidak mengubah apa pun.

**macOS/Linux:** kirim screenshot jendela Terminal ke admin Santriverse.
