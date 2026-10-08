// extension/chatgpt-plugin.js – Wrap a prepared Santriverse skill into a
// ChatGPT plugin package (portable Agent Plugins layout), entirely in memory:
//
//   plugin.json                       manifest + extensions.com.openai.interface
//   skills/<skill-name>/SKILL.md      the Santriverse skill, unchanged
//   skills/<skill-name>/references/…  its reference files
//   assets/logo.png                   icon shown in the ChatGPT plugin directory
//
// Verified against chatgpt.com/plugins "Upload plugin": the import succeeds,
// the skill runs in regular chat and reads its reference files.
'use strict';

const PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PLUGIN_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Minimal ZIP writer (stored entries, CRC-32) ─────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: [{ path, bytes: Uint8Array }] → Uint8Array (ZIP, no compression). */
function writeZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    const name = encoder.encode(path);
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, bytes);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, bytes.length, true);
    entry.setUint32(24, bytes.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(38, (0o100644 << 16) >>> 0, true); // regular file
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + bytes.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ── Plugin manifest ──────────────────────────────────────────────────────────
function firstSentence(text, max = 100) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] || clean;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1).trimEnd()}…`;
}

function pluginManifest({ name, title, version, description }) {
  if (!PLUGIN_NAME_RE.test(name)) throw new Error('Nama plugin harus kebab-case.');
  const displayName = String(title || name).trim().slice(0, 60);
  const shortDescription = firstSentence(description) || displayName;
  return {
    $schema: PLUGIN_SCHEMA,
    name,
    version: /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(String(version || '')) ? String(version) : '1.0.0',
    description: shortDescription,
    author: { name: 'Santriverse', url: 'https://santriverse.my.id' },
    homepage: 'https://santriverse.my.id',
    extensions: {
      'com.openai': {
        interface: {
          displayName,
          shortDescription,
          longDescription: String(description || shortDescription).trim().slice(0, 2000),
          developerName: 'Santriverse',
          category: 'Productivity',
          websiteURL: 'https://santriverse.my.id',
          defaultPrompt: [`Gunakan ${displayName} untuk membantu saya.`],
          brandColor: '#0E7CF0',
          logo: './assets/logo.png',
          composerIcon: './assets/logo.png',
        },
      },
    },
  };
}

/**
 * skill: { name, files: [{ path, bytes }] } from prepareSkillPackage();
 * item: catalog entry { title, version, description }; logo: PNG bytes or null.
 */
function buildChatGptPlugin(skill, item, logo) {
  const manifest = pluginManifest({ name: skill.name, title: item.title || item.name, version: item.version, description: item.description });
  const hasLogo = Boolean(logo && logo.length);
  if (!hasLogo) {
    delete manifest.extensions['com.openai'].interface.logo;
    delete manifest.extensions['com.openai'].interface.composerIcon;
  }
  const encoder = new TextEncoder();
  const entries = [{ path: 'plugin.json', bytes: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`) }];
  for (const file of skill.files) entries.push({ path: `skills/${skill.name}/${file.path}`, bytes: file.bytes });
  if (hasLogo) entries.push({ path: 'assets/logo.png', bytes: logo });
  return { zip: writeZip(entries), manifest, fileName: `${skill.name}-${manifest.version}-chatgpt-plugin.zip` };
}

if (typeof module !== 'undefined') {
  module.exports = { writeZip, crc32, pluginManifest, buildChatGptPlugin, firstSentence, PLUGIN_SCHEMA };
}
