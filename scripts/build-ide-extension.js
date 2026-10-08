#!/usr/bin/env node
'use strict';
// Packages ide-extension/ (Santri Code) as a VSIX without extra tooling:
//
//   node scripts/build-ide-extension.js   →  dist/santri-code-<version>.vsix
//
// Install: VS Code / Antigravity → Extensions → … → "Install from VSIX…",
// or `code --install-extension dist/santri-code-<version>.vsix`.
// The layout matches what `vsce package` produces, so the same file can be
// uploaded to Open VSX (Antigravity, Cursor, Windsurf) and the VS Marketplace.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { writeZip } = require('./build-extension');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'ide-extension');
const DIST = path.join(ROOT, 'dist');
const EXCLUDE = /(^|\/)(\.DS_Store|\.vscode|node_modules|test|\.preview)(\/|$)|\.test\.js$|\.vsix$/;
const CONTENT_TYPES = { '.json': 'application/json', '.js': 'application/javascript', '.css': 'text/css', '.md': 'text/markdown', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.vsixmanifest': 'text/xml' };

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

function listFiles(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((d) => {
    const rel = base ? `${base}/${d.name}` : d.name;
    return d.isDirectory() ? listFiles(path.join(dir, d.name), rel) : [rel];
  });
}

/** Files referenced by package.json that must ship. */
function requiredFiles(pkg) {
  const files = new Set(['package.json', pkg.main.replace(/^\.\//, ''), pkg.icon]);
  for (const container of pkg.contributes?.viewsContainers?.activitybar || []) files.add(container.icon);
  return [...files];
}

function vsixManifest(pkg) {
  const tags = [...new Set([...(pkg.keywords || []), 'santriverse'])].join(',');
  return `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${xml(pkg.name)}" Version="${xml(pkg.version)}" Publisher="${xml(pkg.publisher)}" />
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Tags>${xml(tags)}</Tags>
    <Categories>${xml((pkg.categories || []).join(','))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(pkg.engines.vscode)}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="${xml((pkg.extensionKind || ['workspace']).join(','))}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="${xml(pkg.repository.url)}" />
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="${xml(pkg.homepage)}" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/${xml(pkg.icon)}</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(pkg.icon)}" Addressable="true" />
  </Assets>
</PackageManifest>
`;
}

function contentTypes(names) {
  const exts = [...new Set(names.map((n) => path.extname(n).toLowerCase()).filter((e) => CONTENT_TYPES[e]))].sort();
  return `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${exts.map((e) => `<Default Extension="${e}" ContentType="${CONTENT_TYPES[e]}" />`).join('')}</Types>
`;
}

function buildIdeExtension({ outDir = DIST } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error(`Versi tidak valid: ${pkg.version}`);
  for (const key of ['name', 'publisher', 'displayName', 'description', 'main', 'icon', 'engines']) {
    if (!pkg[key]) throw new Error(`package.json belum punya "${key}"`);
  }
  const missing = requiredFiles(pkg).filter((f) => !fs.existsSync(path.join(SRC, f)));
  for (const doc of ['README.md', 'CHANGELOG.md']) if (!fs.existsSync(path.join(SRC, doc))) missing.push(doc);
  if (missing.length) throw new Error(`File wajib tidak ada: ${missing.join(', ')}`);

  const files = listFiles(SRC).filter((f) => !EXCLUDE.test(f));
  const entries = files.map((name) => ({ name: `extension/${name}`, data: fs.readFileSync(path.join(SRC, name)) }));
  entries.push({ name: 'extension/LICENSE.txt', data: fs.readFileSync(path.join(ROOT, 'LICENSE')) });
  const names = ['extension.vsixmanifest', ...entries.map((e) => e.name)];
  const all = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes(names)) },
    { name: 'extension.vsixmanifest', data: Buffer.from(vsixManifest(pkg)) },
    ...entries,
  ];
  const zip = writeZip(all);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${pkg.name}-${pkg.version}.vsix`);
  fs.writeFileSync(out, zip);
  return { out, pkg, files: all.map((e) => e.name), size: zip.length, sha256: crypto.createHash('sha256').update(zip).digest('hex') };
}

module.exports = { buildIdeExtension, vsixManifest, requiredFiles, EXCLUDE };

if (require.main === module) {
  try {
    const r = buildIdeExtension();
    console.log(`${path.relative(ROOT, r.out)} — ${r.files.length} file, ${(r.size / 1024).toFixed(1)} KB`);
    console.log(`${r.pkg.publisher}.${r.pkg.name} v${r.pkg.version} · VS Code ${r.pkg.engines.vscode}`);
    console.log(`SHA-256 ${r.sha256}`);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 1;
  }
}
