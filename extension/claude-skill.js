// extension/claude-skill.js – Claude (claude.ai) Skills packaging and manual steps.
//
// claude.ai → Customize → Skills → Add → Upload skill (/customize/skills/new/upload) takes a
// ZIP whose root is ONE folder named like the skill, with SKILL.md inside it.
// The panel's assisted install (claude-adapter.js) puts it into Claude's own
// form; the member presses "Upload". These manual steps are the fallback.
'use strict';

const CLAUDE_SKILLS_URL = 'https://claude.ai/customize/skills/new/upload';
const CLAUDE_NAME_MAX = 64;
// support.claude.com lists 200 characters; the Agent Skills spec allows 1024.
const CLAUDE_DESCRIPTION_SOFT_MAX = 200;
const CLAUDE_DESCRIPTION_MAX = 1024;

function getClaudeManualSteps() {
  return [
    'Download ZIP Claude (klik "Download ZIP Claude"). Jangan diekstrak.',
    'Di claude.ai buka Settings → Capabilities, pastikan "Code execution and file creation" aktif.',
    'Klik "Buka Claude Skills" (halaman Customize → Skills → Add → Upload skill).',
    'Pilih atau tarik ZIP tadi ke kotak "Skill file", lalu klik "Upload".',
    'Pastikan toggle skill menyala. Claude memakainya otomatis saat relevan.',
  ];
}

/** Single-line `description:` from SKILL.md frontmatter ('' when absent). */
function skillDescriptionOf(markdown) {
  const front = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  const line = front && /^description:\s*["']?(.*?)["']?\s*$/m.exec(front[1]);
  return line ? line[1].trim() : '';
}

/**
 * skill: { name, files } from prepareSkillPackage(); item: catalog entry.
 * Returns { zip, fileName, warnings: [text] } or throws when Claude would refuse it.
 */
function buildClaudeZip(skill, item) {
  if (skill.name.length > CLAUDE_NAME_MAX) throw new Error(`Nama skill lebih dari ${CLAUDE_NAME_MAX} karakter; Claude menolaknya.`);
  if (/(^|-)(claude|anthropic)(-|$)/.test(skill.name)) throw new Error('Nama skill tidak boleh memuat kata "claude" atau "anthropic".');
  const md = skill.files.find(f => f.path === 'SKILL.md');
  const description = skillDescriptionOf(new TextDecoder().decode(md.bytes));
  if (!description) throw new Error('SKILL.md belum punya "description:"; Claude mewajibkannya.');
  if (description.length > CLAUDE_DESCRIPTION_MAX) throw new Error(`Deskripsi di SKILL.md lebih dari ${CLAUDE_DESCRIPTION_MAX} karakter; Claude menolaknya.`);
  const warnings = description.length > CLAUDE_DESCRIPTION_SOFT_MAX
    ? [`Deskripsi SKILL.md ${description.length} karakter. Bila Claude menolak upload, ringkas jadi ≤${CLAUDE_DESCRIPTION_SOFT_MAX} karakter.`]
    : [];
  const write = typeof writeZip === 'function' ? writeZip : require('./zip.js').writeZip;
  const zip = write(skill.files.map(f => ({ path: `${skill.name}/${f.path}`, bytes: f.bytes })));
  return { zip, fileName: `${skill.name}-${item?.version || '1.0.0'}-claude.zip`, warnings };
}

function openClaudeSkillsPage() {
  return chrome.tabs.create({ url: CLAUDE_SKILLS_URL });
}

if (typeof module !== 'undefined') {
  module.exports = { CLAUDE_SKILLS_URL, getClaudeManualSteps, skillDescriptionOf, buildClaudeZip, openClaudeSkillsPage };
}
