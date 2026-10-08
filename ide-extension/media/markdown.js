// Escape-first Markdown renderer for the Santri Code webview (no dependencies).
// Every piece of text is HTML-escaped before formatting is applied, so model output
// can never inject markup or script. Links are limited to http(s) and opened by the
// extension host, never navigated inside the webview.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SantriMarkdown = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

  const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/;
  const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const QUOTE = /^ {0,3}>[ \t]?/;
  const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
  const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  function emphasis(s) {
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  }

  function inline(src) {
    const slots = [];
    const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = String(src).replace(/\u0000/g, '');
    s = s.replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code) => keep(`<code>${esc(code.replace(/^ ([\s\S]*) $/, '$1'))}</code>`));
    s = s.replace(/\[([^\]\n]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/g,
      (_, text, url) => keep(`<a href="${esc(url)}" data-external>${emphasis(esc(text))}</a>`));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g, (_, lead, url) => `${lead}${keep(`<a href="${esc(url)}" data-external>${esc(url)}</a>`)}`);
    s = emphasis(esc(s));
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
  }

  const isFenceClose = (line, fence) => {
    const t = line.trim();
    return t.length >= fence.length && t === fence[0].repeat(t.length);
  };
  // GFM: a header row followed by a delimiter row with the same number of cells.
  const isTableStart = (line, next) => line.includes('|') && next !== undefined && TABLE_SEP.test(next)
    && cells(line).length === cells(next).length;
  const isBlockStart = (line, next) => FENCE_OPEN.test(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST.test(line) || isTableStart(line, next);

  function cells(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  function table(lines, i) {
    const head = cells(lines[i]);
    const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
    const attr = (k) => (align[k] ? ` style="text-align:${align[k]}"` : '');
    let html = `<div class="md-table"><table><thead><tr>${head.map((c, k) => `<th${attr(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
    i += 2;
    while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
      const row = cells(lines[i]);
      html += `<tr>${head.map((_, k) => `<td${attr(k)}>${inline(row[k] ?? '')}</td>`).join('')}</tr>`;
      i++;
    }
    return { html: `${html}</tbody></table></div>`, i };
  }

  function listItem(itemLines) {
    let [first, ...rest] = itemLines;
    let box = '';
    const task = first.match(/^\[([ xX])\][ \t]+(.*)$/);
    if (task) {
      box = `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> `;
      first = task[2];
    }
    const tail = rest.some((l) => l.trim()) ? blocks(rest) : '';
    return `<li${task ? ' class="task"' : ''}>${box}${inline(first)}${tail}</li>`;
  }

  function list(lines, i) {
    const m0 = lines[i].match(LIST);
    const base = m0[1].replace(/\t/g, '    ').length;
    const ordered = /\d/.test(m0[2]);
    const start = ordered ? parseInt(m0[2], 10) : 1;
    const items = [];
    let current = null;
    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(LIST);
      const indent = (line.match(/^[ \t]*/)[0]).replace(/\t/g, '    ').length;
      if (m && indent <= base + 1) {
        if (/\d/.test(m[2]) !== ordered) break;
        current = [m[3]];
        items.push(current);
        i++;
        continue;
      }
      if (!line.trim()) {
        const next = lines[i + 1];
        const nextIndent = next ? (next.match(/^[ \t]*/)[0]).replace(/\t/g, '    ').length : -1;
        if (next !== undefined && next.trim() && (nextIndent > base || (LIST.test(next) && nextIndent <= base + 1))) {
          current?.push('');
          i++;
          continue;
        }
        break;
      }
      if (current && indent > base) {
        current.push(line.replace(new RegExp(`^[ \\t]{0,${base + 4}}`), ''));
        i++;
        continue;
      }
      if (current && !isBlockStart(line, lines[i + 1])) { // lazy continuation
        current[current.length - 1] += `\n${line.trim()}`;
        i++;
        continue;
      }
      break;
    }
    const tag = ordered ? 'ol' : 'ul';
    const startAttr = ordered && start !== 1 ? ` start="${start}"` : '';
    return { html: `<${tag}${startAttr}>${items.map(listItem).join('')}</${tag}>`, i };
  }

  function blocks(lines) {
    let html = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = line.match(FENCE_OPEN))) {
        const fence = m[1];
        const lang = m[2];
        const body = [];
        i++;
        while (i < lines.length && !isFenceClose(lines[i], fence)) body.push(lines[i++]);
        i++;
        html += `<div class="md-code"><div class="md-code-head"><span>${esc(lang || 'kode')}</span><button type="button" class="md-copy" data-copy-code>Salin</button></div><pre><code>${esc(body.join('\n'))}</code></pre></div>`;
        continue;
      }
      if ((m = line.match(HEADING))) {
        const level = m[1].length;
        html += `<h${level}>${inline(m[2])}</h${level}>`;
        i++;
        continue;
      }
      if (HR.test(line)) { html += '<hr>'; i++; continue; }
      if (QUOTE.test(line)) {
        const inner = [];
        while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !isBlockStart(lines[i], lines[i + 1]))) inner.push(lines[i++].replace(QUOTE, ''));
        html += `<blockquote>${blocks(inner)}</blockquote>`;
        continue;
      }
      if (isTableStart(line, lines[i + 1])) {
        const t = table(lines, i);
        html += t.html;
        i = t.i;
        continue;
      }
      if (LIST.test(line)) {
        const l = list(lines, i);
        html += l.html;
        i = l.i;
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i], lines[i + 1]))) para.push(lines[i++].trim());
      html += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`;
    }
    return html;
  }

  function render(markdown) {
    return blocks(String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n'));
  }

  return { render, inline, escape: esc };
});
