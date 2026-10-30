'use strict';
// Profiles: named sets of skills and MCP servers ("Web dev", "Apps Script") the member
// applies to an AI agent in one click (src/dashboard.js). Stored in
// ~/.santrihub/profiles.json; exported/imported as the same JSON to move them between PCs.
// Only ids are stored (catalog, library, or the gateway), never commands or secrets.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,39}$/u;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_PROFILES = 50, MAX_ITEMS = 200;

const profilesFile = (home = os.homedir()) => path.join(home, '.santrihub', 'profiles.json');

/** A clean { skills, mcp } or an error naming what is wrong. */
function validProfile(name, p) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`Nama profil tidak valid: ${String(name).slice(0, 40)}`);
  if (!p || typeof p !== 'object') throw new Error(`Profil ${name} tidak valid.`);
  const list = (v, what) => {
    if (v == null) return [];
    if (!Array.isArray(v) || v.length > MAX_ITEMS || v.some((x) => typeof x !== 'string' || !ID_RE.test(x))) throw new Error(`Daftar ${what} di profil ${name} tidak valid.`);
    return [...new Set(v)];
  };
  return { skills: list(p.skills, 'skill'), mcp: list(p.mcp, 'MCP') };
}

function readProfiles(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = {};
    for (const [name, p] of Object.entries((raw && raw.profiles) || {})) {
      try { out[name] = { ...validProfile(name, p), updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : null }; } catch { /* skip a broken entry */ }
    }
    return out;
  } catch { return {}; }
}

function writeProfiles(file, profiles) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify({ version: 1, profiles }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
}

function saveProfile(file, name, p) {
  const profiles = readProfiles(file);
  if (!profiles[name] && Object.keys(profiles).length >= MAX_PROFILES) throw new Error(`Maksimal ${MAX_PROFILES} profil.`);
  profiles[name] = { ...validProfile(name, p), updatedAt: new Date().toISOString() };
  writeProfiles(file, profiles);
  return profiles[name];
}

function deleteProfile(file, name) {
  const profiles = readProfiles(file);
  if (!profiles[name]) return false;
  delete profiles[name];
  writeProfiles(file, profiles);
  return true;
}

/** Merges an exported file ({ profiles: {...} }); same names are replaced. Returns the imported names. */
function importProfiles(file, data) {
  const incoming = data && typeof data === 'object' && data.profiles && typeof data.profiles === 'object' ? data.profiles : null;
  if (!incoming || Array.isArray(incoming)) throw new Error('File bukan ekspor profil SantriHub.');
  const profiles = readProfiles(file);
  const names = Object.keys(incoming);
  if (!names.length) throw new Error('File tidak berisi profil.');
  for (const name of names) profiles[name] = { ...validProfile(name, incoming[name]), updatedAt: new Date().toISOString() };
  if (Object.keys(profiles).length > MAX_PROFILES) throw new Error(`Maksimal ${MAX_PROFILES} profil.`);
  writeProfiles(file, profiles);
  return names;
}

module.exports = { profilesFile, readProfiles, saveProfile, deleteProfile, importProfiles, validProfile };
