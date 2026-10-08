'use strict';
// Optional "konteks project" attached to a message so the PRD / architecture fits the
// open workspace. Only names, package metadata and a README excerpt — never .env or
// source files. Pure helpers; the extension supplies the file reads.

const IGNORED = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage', 'vendor', '.next', '.nuxt',
  '.turbo', '.cache', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'storage', 'bin', 'obj', 'target',
]);
const SECRET_NAME = /^\.env(\..*)?$|\.(pem|key|p12|pfx|keystore)$|^id_(rsa|ed25519)/i;
const MARKER = '[Konteks project dari editor]';
const MAX_MESSAGE = 20000; // server limit for one chat message

/** Directory entries to show; secrets are listed by nothing at all. */
function visibleEntry(name) {
  return !IGNORED.has(name) && !SECRET_NAME.test(name) && !name.startsWith('.DS_Store');
}

function packageSummary(raw) {
  try {
    const pkg = JSON.parse(raw);
    const deps = Object.keys({ ...(pkg.dependencies || {}) }).slice(0, 40);
    const devDeps = Object.keys({ ...(pkg.devDependencies || {}) }).slice(0, 25);
    return [
      pkg.name && `name: ${pkg.name}`,
      pkg.description && `description: ${String(pkg.description).slice(0, 200)}`,
      pkg.scripts && `scripts: ${Object.keys(pkg.scripts).slice(0, 20).join(', ')}`,
      deps.length && `dependencies: ${deps.join(', ')}`,
      devDeps.length && `devDependencies: ${devDeps.join(', ')}`,
    ].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

/**
 * @param {object} o
 * @param {string} o.name          workspace folder name
 * @param {string[]} o.tree        relative paths (dirs end with "/")
 * @param {Record<string,string>} o.manifests  e.g. {"package.json": raw, "composer.json": raw}
 * @param {string} [o.readme]      README text
 * @param {string} [o.activeFile]  relative path of the active editor
 * @param {number} [o.maxChars]
 */
function formatContext({ name, tree = [], manifests = {}, readme = '', activeFile = '', maxChars = 6000 }) {
  const parts = [MARKER, `Workspace: ${name || '(tanpa nama)'}`];
  if (activeFile) parts.push(`File aktif: ${activeFile}`);
  if (tree.length) parts.push(`Struktur folder:\n${tree.slice(0, 120).map((p) => `- ${p}`).join('\n')}`);
  for (const [file, raw] of Object.entries(manifests)) {
    const summary = file.endsWith('.json') ? packageSummary(raw) : String(raw).slice(0, 800);
    if (summary) parts.push(`${file}:\n${summary}`);
  }
  if (readme.trim()) parts.push(`README (cuplikan):\n${readme.trim().slice(0, 1800)}`);
  let text = parts.join('\n\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 20).trimEnd()}\n…(dipotong)`;
  return text;
}

/** The message actually sent: the member's text plus context, inside the server's limit. */
function composeMessage(text, context) {
  const body = String(text || '').trim();
  if (!context) return body.slice(0, MAX_MESSAGE);
  const room = MAX_MESSAGE - body.length - 8;
  if (room < 400) return body.slice(0, MAX_MESSAGE);
  return `${body}\n\n---\n${context.slice(0, room)}`;
}

/** What the member typed, without the attached context (for display). */
function splitMessage(content) {
  const raw = String(content ?? '');
  const at = raw.indexOf(`\n\n---\n${MARKER}`);
  return at < 0 ? { text: raw, hasContext: false } : { text: raw.slice(0, at), hasContext: true };
}

module.exports = { formatContext, composeMessage, splitMessage, visibleEntry, packageSummary, MARKER, MAX_MESSAGE };
