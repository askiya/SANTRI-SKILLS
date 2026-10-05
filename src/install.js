'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = '.santri-skills.json';

// Official Antigravity locations (antigravity.google/docs/skills, /docs/mcp).
function skillTargets(scope, cwd = process.cwd(), home = os.homedir()) {
  if (scope === 'project') return [path.join(cwd, '.agents', 'skills')];
  return [path.join(home, '.gemini', 'config', 'skills'), path.join(home, '.gemini', 'antigravity-cli', 'skills')];
}

function mcpConfigPath(scope, cwd = process.cwd(), home = os.homedir()) {
  return scope === 'project'
    ? path.join(cwd, '.agents', 'mcp_config.json')
    : path.join(home, '.gemini', 'config', 'mcp_config.json');
}

// Copy skills into each target. Folders we did not install are never overwritten unless force.
function installSkills(skills, targets, { force = false } = {}) {
  const result = { installed: [], skipped: [] };
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    for (const skill of skills) {
      const dest = path.join(target, skill.id);
      const ours = fs.existsSync(path.join(dest, MARKER));
      if (fs.existsSync(dest) && !ours && !force) {
        result.skipped.push({ id: skill.id, dest, reason: 'folder sudah ada (bukan milik santri-skills), pakai --force' });
        continue;
      }
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(skill.dir, dest, { recursive: true });
      fs.writeFileSync(path.join(dest, MARKER), JSON.stringify({ source: skill.source, installedAt: new Date().toISOString() }, null, 2));
      result.installed.push({ id: skill.id, dest });
    }
  }
  return result;
}

function uninstallSkills(targets) {
  const removed = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    for (const d of fs.readdirSync(target, { withFileTypes: true })) {
      const dir = path.join(target, d.name);
      if (d.isDirectory() && fs.existsSync(path.join(dir, MARKER))) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
      }
    }
  }
  return removed;
}

const SERVER_NAME = 'santri-skills';
const SERVER_ENTRY = { command: 'npx', args: ['-y', 'santriverse-skills', 'mcp-serve'] };

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} bukan JSON valid. Perbaiki manual dulu, file tidak diubah.`);
  }
}

// Merge one server into mcp_config.json, keep everything else, back up the original once per run.
// Unknown entries under the same name are never replaced: collisions are rejected.
// santri-skills may be refreshed only when the existing entry is recognisably ours (npx package or local cli.js mcp-serve).
const { isDeepStrictEqual } = require('node:util');
const localEntry = { command: process.execPath, args: [path.resolve(__dirname, '../bin/cli.js'), 'mcp-serve'] };
const isOurs = (e) => isDeepStrictEqual(e, SERVER_ENTRY) || isDeepStrictEqual(e, localEntry);
function addMcpServer(file, entry = SERVER_ENTRY, name = SERVER_NAME) {
  const config = readJson(file);
  // Shape check BEFORE any backup/write: a non-object root or non-object mcpServers
  // would otherwise be silently replaced and the user's data lost.
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`${file} bukan object JSON (root harus object). File tidak diubah.`);
  if (Object.hasOwn(config, 'mcpServers') && (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers))) throw new Error(`${file}: mcpServers harus object. File tidak diubah.`);
  const existing = config.mcpServers && config.mcpServers[name];
  const same = JSON.stringify(existing) === JSON.stringify(entry);
  if (existing && !same && !(name === SERVER_NAME && isOurs(existing))) {
    throw new Error(`MCP '${name}' sudah ada di ${file} dengan konfigurasi lain. Hapus manual dulu, file tidak diubah.`);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  config.mcpServers = { ...(config.mcpServers || {}), [name]: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return config;
}

function removeMcpServer(file) {
  if (!fs.existsSync(file)) return false;
  const config = readJson(file);
  if (!config.mcpServers || !config.mcpServers[SERVER_NAME]) return false;
  fs.copyFileSync(file, `${file}.bak`);
  delete config.mcpServers[SERVER_NAME];
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return true;
}

// Read-only inspection. "configured" means valid files on disk only; it never
// claims an MCP runtime handshake or process connection.
function installedSkills(targets) {
  const out = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    for (const d of fs.readdirSync(target, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(target, d.name);
      const skillFile = path.join(dir, 'SKILL.md');
      if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) continue;
      const marker = path.join(dir, MARKER);
      let managed = false, markerValid = false, source = null, installedAt = null;
      if (fs.existsSync(marker)) {
        managed = true;
        try {
          const meta = JSON.parse(fs.readFileSync(marker, 'utf8'));
          markerValid = Boolean(meta && typeof meta === 'object' && !Array.isArray(meta));
          source = typeof meta.source === 'string' ? meta.source : null;
          installedAt = typeof meta.installedAt === 'string' && !Number.isNaN(Date.parse(meta.installedAt)) ? meta.installedAt : null;
        } catch { /* malformed marker stays visible, never makes a missing SKILL.md installed */ }
      }
      out.push({ id: d.name, dir, source, installedAt, managed, markerValid });
    }
  }
  return out;
}

function configStatus(scope, cwd = process.cwd(), home = os.homedir(), override = {}) {
  if (!['project', 'global'].includes(scope)) throw new Error('Scope invalid');
  const targets = override.skillTargets || skillTargets(scope, cwd, home);
  const skills = installedSkills(targets);
  const configFile = Object.hasOwn(override, 'mcpFile') ? override.mcpFile : mcpConfigPath(scope, cwd, home);
  let servers = [], configValid = true;
  if (fs.existsSync(configFile)) {
    try {
      const cfg = readJson(configFile);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('Invalid config object');
      if (cfg.mcpServers != null && (typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers))) configValid = false;
      else servers = Object.entries(cfg.mcpServers || {}).flatMap(([name, entry]) => {
        const configured = Boolean(entry && typeof entry === 'object' && typeof entry.command === 'string' && entry.command.trim() && (entry.args == null || (Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === 'string'))));
        return configured ? [{ name, configured: true, managed: name === SERVER_NAME && isOurs(entry), runtime: 'unverified' }] : [];
      });
    } catch { configValid = false; }
  }
  return {
    scope,
    skillTargets: targets.map((dir) => ({ dir, exists: fs.existsSync(dir) })),
    skills,
    mcp: { configFile, exists: fs.existsSync(configFile), valid: configValid, servers, runtime: 'unverified' },
    configured: skills.length > 0 || servers.length > 0,
    runtime: 'unverified',
  };
}

module.exports = { MARKER, SERVER_NAME, SERVER_ENTRY, skillTargets, mcpConfigPath, installSkills, uninstallSkills, addMcpServer, removeMcpServer, installedSkills, configStatus };
