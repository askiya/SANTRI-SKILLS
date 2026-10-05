# Santriverse Skills

One-command installer untuk menghubungkan koleksi **Google Apps Script Skills** dan **Pedoman Monorepo Santriverse** ke Google Antigravity.

- 18+ Agent Skills dari dua repo GitHub.
- Dua mode: **Agent Skills** dan **MCP server**.
- Scope project atau global.
- Windows, macOS, Linux; Node.js >= 18.17.
- Tanpa API key dan tanpa dependency runtime.

## Quick start

Jalankan dari root project:

```bash
npx santriverse-skills install
```

Pilih `project` untuk menulis ke `.agents/skills/`, atau `global` agar tersedia di seluruh project Antigravity.

Reload Antigravity setelah instalasi. Skill akan muncul berdasarkan nama masing-masing, misalnya:

- `apps-script-architect`
- `apps-script-security`
- `apps-script-web-app`
- `santriverse-vibe-coding`
- `pre-deploy-gate`

## Mode MCP

```bash
npx santriverse-skills mcp-install
```

Installer merge entry `santri-skills` ke konfigurasi Antigravity tanpa menghapus MCP server lain. File lama dibackup sebagai `mcp_config.json.bak`.

MCP menyediakan:

| Tool | Fungsi |
|---|---|
| `list_skills` | Daftar seluruh skill dan deskripsi |
| `get_skill` | Baca isi lengkap satu `SKILL.md` |
| `search_docs` | Cari pedoman Markdown dari kedua repo |

## CLI

```bash
npx santriverse-skills install
npx santriverse-skills update
npx santriverse-skills list
npx santriverse-skills mcp-install
npx santriverse-skills uninstall
```

Untuk CI atau instalasi tanpa prompt:

```bash
npx santriverse-skills install --scope=project --sources=appscript,monorepo --yes
npx santriverse-skills update --scope=global --yes
```

Opsi:

- `--scope=project|global`
- `--sources=appscript,monorepo`
- `--yes`
- `--force` — timpa folder bernama sama yang bukan dibuat installer

## Sumber konten

Installer selalu mengambil branch `main` terbaru dari:

- [askiya/GOOGLE-APPSCRIPT-SKILLS](https://github.com/askiya/GOOGLE-APPSCRIPT-SKILLS)
- [askiya/MONOREPO-SKILLS](https://github.com/askiya/MONOREPO-SKILLS)

Alur update konten:

1. Edit dan push skill ke salah satu repo sumber.
2. Jalankan `npx santriverse-skills update`.
3. Reload Antigravity.

Perubahan **kode installer** membutuhkan bump versi dan `npm publish`; perubahan **isi skill** tidak.

## Lokasi instalasi Antigravity

| Scope | Agent Skills | MCP config |
|---|---|---|
| Project | `<project>/.agents/skills/` | `<project>/.agents/mcp_config.json` |
| Global IDE | `~/.gemini/config/skills/` | `~/.gemini/config/mcp_config.json` |
| Global CLI | `~/.gemini/antigravity-cli/skills/` | memakai config global |

Folder asing tidak dihapus atau ditimpa secara default. `uninstall` hanya menghapus folder dengan marker `.santri-skills.json`.

## Development

```bash
npm test
node bin/cli.js list
npm pack --dry-run
```

## License

MIT
