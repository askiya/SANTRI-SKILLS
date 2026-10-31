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

// writeZip / crc32 live in zip.js (shared by every target).
const zipWriter = typeof module !== 'undefined' && typeof require === 'function' ? require('./zip.js') : globalThis;

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
  return { zip: zipWriter.writeZip(entries), manifest, fileName: `${skill.name}-${manifest.version}-chatgpt-plugin.zip` };
}

if (typeof module !== 'undefined') {
  module.exports = { writeZip: zipWriter.writeZip, crc32: zipWriter.crc32, pluginManifest, buildChatGptPlugin, firstSentence, PLUGIN_SCHEMA };
}
