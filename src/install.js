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

// Merge our server into mcp_config.json, keep everything else, back up the original once per run.
function addMcpServer(file, entry = SERVER_ENTRY) {
  const config = readJson(file);
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  config.mcpServers = { ...(config.mcpServers || {}), [SERVER_NAME]: entry };
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

module.exports = { MARKER, SERVER_NAME, SERVER_ENTRY, skillTargets, mcpConfigPath, installSkills, uninstallSkills, addMcpServer, removeMcpServer };
