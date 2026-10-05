#!/usr/bin/env node
'use strict';

const readline = require('node:readline/promises');
const process = require('node:process');
const pkg = require('../package.json');
const { banner, c } = require('../src/banner');
const { REGISTRY, loadCatalog } = require('../src/sources');
const {
  skillTargets,
  mcpConfigPath,
  installSkills,
  uninstallSkills,
  addMcpServer,
  removeMcpServer,
} = require('../src/install');

function parse(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) positional.push(arg);
    else {
      const [key, ...rest] = arg.slice(2).split('=');
      flags[key] = rest.length ? rest.join('=') : true;
    }
  }
  return { command: positional[0] || 'help', flags };
}

const help = () => `
Penggunaan:
  npx santriverse-skills install       Install Agent Skills ke Antigravity
  npx santriverse-skills update        Download dan pasang versi terbaru
  npx santriverse-skills list          Daftar skill dari semua repo
  npx santriverse-skills mcp-install   Daftarkan MCP server ke Antigravity
  npx santriverse-skills mcp-serve     Jalankan MCP stdio server
  npx santriverse-skills uninstall     Hapus instalasi milik Santri Skills

Opsi:
  --scope=project|global               Target instalasi (default: tanya)
  --sources=appscript,monorepo         Pilih sumber (default: semua)
  --yes                                Non-interaktif; default project
  --force                              Timpa folder skill yang sudah ada
  --help, --version
`;

async function chooseScope(flags) {
  if (flags.scope) {
    if (!['project', 'global'].includes(flags.scope)) throw new Error('--scope harus project atau global');
    return flags.scope;
  }
  if (flags.yes) return 'project';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('  Target instalasi? [1] project  [2] global  (default 1): ')).trim();
  rl.close();
  return answer === '2' || answer.toLowerCase() === 'global' ? 'global' : 'project';
}

function sourceIds(flags) {
  return flags.sources ? String(flags.sources).split(',').map((x) => x.trim()).filter(Boolean) : undefined;
}

async function showList(flags) {
  console.log(c.dim('  Mengambil katalog terbaru...'));
  const groups = await loadCatalog(sourceIds(flags), { refresh: Boolean(flags.refresh) });
  let count = 0;
  for (const group of groups) {
    console.log(`\n  ${c.bold(group.source.label)} ${c.dim(`(${group.source.repo})`)}`);
    for (const skill of group.skills) {
      count++;
      console.log(`  ${c.gold('◆')} ${skill.id}${skill.description ? c.dim(` — ${skill.description.slice(0, 100)}`) : ''}`);
    }
  }
  console.log(`\n  ${c.green('✓')} ${count} skill ditemukan.\n`);
  return groups;
}

async function runInstall(flags, update = false) {
  const scope = await chooseScope(flags);
  console.log(c.dim(`  Download ${update ? 'update' : 'skills'} dari GitHub...`));
  const groups = await loadCatalog(sourceIds(flags), { refresh: true });
  const skills = groups.flatMap((g) => g.skills);
  const targets = skillTargets(scope);
  const result = installSkills(skills, targets, { force: Boolean(flags.force) });
  console.log(`\n  ${c.green('✓')} ${result.installed.length} salinan skill terpasang (${skills.length} skill × ${targets.length} target).`);
  for (const target of targets) console.log(`    ${c.dim(target)}`);
  for (const item of result.skipped) console.log(`  ${c.orange('!')} Lewati ${item.id}: ${item.reason}`);
  console.log(`\n  ${c.bold('Reload Antigravity, lalu buka Skills untuk memverifikasi.')}\n`);
}

async function runMcpInstall(flags) {
  const scope = await chooseScope(flags);
  // Prime cache so the MCP server works immediately/offline.
  await loadCatalog(sourceIds(flags), { refresh: true });
  const file = mcpConfigPath(scope);
  addMcpServer(file);
  console.log(`  ${c.green('✓')} MCP server '${c.bold('santri-skills')}' terdaftar.`);
  console.log(`    ${c.dim(file)}`);
  console.log(`  ${c.bold('Reload Antigravity, lalu cek MCP Servers.')}\n`);
}

async function runUninstall(flags) {
  const scope = await chooseScope(flags);
  const targets = skillTargets(scope);
  const removed = uninstallSkills(targets);
  const config = mcpConfigPath(scope);
  const mcpRemoved = removeMcpServer(config);
  console.log(`  ${c.green('✓')} ${removed.length} folder skill dihapus${mcpRemoved ? ', konfigurasi MCP dihapus' : ''}.`);
  console.log(`  Backup konfigurasi MCP (jika diubah): ${c.dim(`${config}.bak`)}\n`);
}

async function main() {
  const { command, flags } = parse(process.argv.slice(2));
  if (flags.version || command === 'version') return console.log(pkg.version);
  if (command === 'mcp-serve') return require('../src/mcp-server').serve(); // stdout must stay JSON-only

  console.log(banner(pkg.version));
  if (flags.help || command === 'help') return console.log(help());
  if (command === 'list') return showList(flags);
  if (command === 'install') return runInstall(flags, false);
  if (command === 'update') return runInstall(flags, true);
  if (command === 'mcp-install') return runMcpInstall(flags);
  if (command === 'uninstall') return runUninstall(flags);
  throw new Error(`Perintah tidak dikenal: ${command}\n${help()}`);
}

main().catch((err) => {
  console.error(`\n  ${c.red('✗')} ${err.message}\n`);
  process.exitCode = 1;
});
