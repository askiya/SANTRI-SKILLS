'use strict';
// Port of the website's chatDocuments.ts: the AI Flow Studio answer wraps finished
// documents as
//   :::document {"title":"…","kind":"prd","version":"1.0"}
//   …markdown…
//   :::enddocument
// Keep this in step with apps/frontend/src/components/flow/chatDocuments.ts.

const KINDS = ['prd', 'architecture', 'sdlc', 'design', 'document'];
const OPENING = /^:::document ([^\r\n]+)(?:\r\n|\n|\r)?$/;
const CLOSING = /^:::enddocument(?:\r\n|\n|\r)?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** File names the IDE saves to; agents (Antigravity, Claude Code, …) look for these. */
const KIND_FILES = { prd: 'PRD.md', architecture: 'ARCHITECTURE.md', sdlc: 'SDLC.md', design: 'DESIGN.md' };

function metadataFromJson(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.title !== 'string' || value.title.trim().length < 1 || value.title.length > 160
      || typeof value.version !== 'string' || value.version.trim().length < 1 || value.version.length > 32
      || typeof value.kind !== 'string' || !KINDS.includes(value.kind)) return null;
    return { title: value.title.trim(), kind: value.kind, version: value.version.trim() };
  } catch {
    return null;
  }
}

const linesWithEndings = (source) => source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];

function findClosingLine(lines, start) {
  let fence = null;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = { marker: token[0], length: token.length };
      else if (token[0] === fence.marker && token.length >= fence.length && line.trim() === token) fence = null;
      continue;
    }
    if (!fence && line.startsWith(':::document')) return -1;
    if (!fence && CLOSING.test(line)) return index;
  }
  return -1;
}

// Heuristic fallback for long structured answers without markers (same rules as the website).
function structuredMarkdownFallback(source) {
  if (source.length < 2000) return null;
  let fence = null;
  let codeBlocks = 0;
  const prose = linesWithEndings(source).map((line) => {
    const token = line.match(FENCE)?.[1];
    if (token) {
      if (!fence) fence = { marker: token[0], length: token.length };
      else if (token[0] === fence.marker && token.length >= fence.length && line.trim() === token) {
        fence = null;
        codeBlocks++;
      }
      return '\n';
    }
    return fence ? '\n' : line;
  }).join('');
  if (fence) return null;
  const headings = prose.match(/^#{1,6}[ \t]+\S.*$/gm) ?? [];
  const sectionHeadings = prose.match(/^#{2,6}[ \t]+\S.*$/gm) ?? [];
  const structureSignals = [
    /^ {0,3}(?:[-*+] |\d+[.)] )\S/m.test(prose),
    codeBlocks > 0,
    /^\s*\|?.+\|.+$/m.test(prose) && /^\s*\|?\s*:?-{3,}/m.test(prose),
  ].filter(Boolean).length;
  if (headings.length < 8 || sectionHeadings.length < 4 || structureSignals < 2) return null;

  const title = [...prose.matchAll(/^#(?!#)[ \t]+(.+)$/gm)]
    .map((match) => match[1].replace(/\s+#+\s*$/, '').replace(/[*_`]/g, '').trim())
    .find((t) => /[\p{L}\p{N}]{3}/u.test(t))?.slice(0, 160).trim();
  if (!title) return null;
  const kind = [
    ['prd', /\bprd\b|product requirements?|kebutuhan produk/i],
    ['sdlc', /\bsdlc\b|software development life cycle|siklus hidup pengembangan/i],
    ['architecture', /\barchitecture\b|\barsitektur\b/i],
  ].find(([, pattern]) => pattern.test(title))?.[0];
  if (!kind || /\b(?:discovery|diskusi|pertanyaan|question)\b/i.test(title)) return null;
  const leading = source.slice(0, 2000).replace(/[*_`]/g, '');
  const version = leading.match(/\b(?:version|versi)\s*[:=-]\s*v?([0-9][\w.-]{0,31})/i)?.[1]
    ?? leading.match(/\bv(?:ersion)?\s*([0-9]+(?:\.[\w-]+){0,3})\b/i)?.[1] ?? '';
  return { id: `fallback:${kind}:${source.length}:${title}`, metadata: { title, kind, version }, content: source };
}

/** Splits an assistant answer into text and document segments. */
function parseDocuments(source) {
  const lines = linesWithEndings(String(source ?? ''));
  const segments = [];
  const documents = [];
  let text = '';
  let malformed = false;
  let fence = null;
  const flushText = () => {
    if (text) segments.push({ type: 'text', content: text });
    text = '';
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMatch = line.match(FENCE);
    if (fenceMatch) {
      const token = fenceMatch[1];
      if (!fence) fence = { marker: token[0], length: token.length };
      else if (token[0] === fence.marker && token.length >= fence.length && line.trim() === token) fence = null;
      text += line;
      continue;
    }
    const markerLine = line.trimStart();
    if (!fence && markerLine.startsWith(':::enddocument')) {
      flushText();
      segments.push({ type: 'text', content: lines.slice(index).join(''), literal: true });
      malformed = true;
      break;
    }
    const opening = !fence ? line.match(OPENING) : null;
    const metadata = opening ? metadataFromJson(opening[1]) : null;
    if (!opening || !metadata) {
      if (!fence && markerLine.startsWith(':::document')) {
        flushText();
        segments.push({ type: 'text', content: lines.slice(index).join(''), literal: true });
        malformed = true;
        break;
      }
      text += line;
      continue;
    }
    const closingIndex = findClosingLine(lines, index + 1);
    const content = closingIndex < 0 ? '' : lines.slice(index + 1, closingIndex).join('');
    if (closingIndex < 0 || !content.trim()) {
      flushText();
      segments.push({ type: 'text', content: lines.slice(index).join(''), literal: true });
      malformed = true;
      break;
    }
    flushText();
    const document = { id: `${index}:${closingIndex}:${metadata.kind}:${metadata.title}`, metadata, content };
    documents.push(document);
    segments.push({ type: 'document', document });
    index = closingIndex;
  }
  flushText();
  if (!malformed && documents.length === 0) {
    const fallback = structuredMarkdownFallback(String(source ?? ''));
    if (fallback) return { documents: [fallback], segments: [{ type: 'document', document: fallback }], malformed: false };
  }
  return { documents, segments, malformed };
}

/** Website's documentFilename(): slug of the title, Windows-safe. */
function slugFileName(metadata) {
  let stem = [...String(metadata.title).normalize('NFKD')]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return ' ';
      if (code >= 0x300 && code <= 0x36f) return '';
      return char;
    })
    .join('')
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  if (!stem) stem = metadata.kind || 'document';
  if (RESERVED_WINDOWS_NAME.test(stem)) stem = `document-${stem}`;
  return `${stem}.md`;
}

/** Workspace file name for a document: PRD.md, ARCHITECTURE.md, SDLC.md, DESIGN.md or a slug. */
function fileNameFor(metadata) {
  return KIND_FILES[metadata?.kind] || slugFileName(metadata || {});
}

/** Live preview of a document while the server is still writing its sections. */
function draftDocument(draft) {
  if (!draft?.sections) return null;
  const visible = draft.sections.filter((s) => (s.status === 'completed' || s.status === 'writing') && s.content?.trim());
  return {
    metadata: { title: draft.title, kind: draft.kind, version: draft.version },
    content: [`# ${draft.title}`, ...visible.map((s) => s.content.trim())].join('\n\n'),
    sections: draft.sections.map((s) => ({ title: s.title, status: s.status })),
  };
}

module.exports = { parseDocuments, fileNameFor, slugFileName, draftDocument, KIND_FILES, KINDS };
