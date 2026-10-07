// extension/gemini-skills-bridge.js – runs in the Gemini page (MAIN world).
//
// Gemini's Skills upload area reads dropped folders through
// DataTransferItem.webkitGetAsEntry(), which returns null for files a script
// creates. This bridge drops the member's verified package as a folder entry
// so Gemini opens its normal Review screen. It never presses "Create": the
// member reviews and confirms inside Gemini.
//
// Only accepts messages from gemini-skills.js in the same window.
(() => {
  'use strict';
  if (window.__santriSkillsBridge) return;
  window.__santriSkillsBridge = true;

  const MIME = { md: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv', py: 'text/x-python', yaml: 'text/yaml', yml: 'text/yaml', html: 'text/html', css: 'text/css', svg: 'image/svg+xml', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

  function fileEntry(fullPath, file) {
    return {
      isFile: true, isDirectory: false, name: file.name, fullPath, filesystem: null,
      file(ok, fail) { setTimeout(() => { try { ok(file); } catch (e) { fail?.(e); } }, 0); },
    };
  }

  function dirEntry(fullPath, children) {
    return {
      isFile: false, isDirectory: true, name: fullPath.split('/').pop(), fullPath, filesystem: null,
      createReader() {
        let done = false;
        return { readEntries(ok) { setTimeout(() => { ok(done ? [] : children); done = true; }, 0); } };
      },
    };
  }

  /** files: [{ path: 'SKILL.md' | 'references/x.md', buffer: ArrayBuffer }] */
  function buildTree(root, files) {
    const node = { dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.path.split('/');
      let cur = node;
      for (const dir of parts.slice(0, -1)) {
        if (!cur.dirs.has(dir)) cur.dirs.set(dir, { dirs: new Map(), files: [] });
        cur = cur.dirs.get(dir);
      }
      const name = parts.at(-1);
      const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
      cur.files.push(new File([f.buffer], name, { type: MIME[ext] || '' }));
    }
    const toEntry = (n, path) => dirEntry(path, [
      ...[...n.dirs].map(([name, child]) => toEntry(child, `${path}/${name}`)),
      ...n.files.map(file => fileEntry(`${path}/${file.name}`, file)),
    ]);
    return toEntry(node, `/${root}`);
  }

  function dropFolder(area, root, files) {
    const entry = buildTree(root, files);
    // Chrome hands out fresh DataTransferItem wrappers, so the bridge's own item
    // is recognised by a one-off file name rather than object identity.
    const marker = `santri-skills-${crypto.randomUUID()}`;
    const transfer = new DataTransfer();
    transfer.items.add(new File([''], marker));
    const proto = DataTransferItem.prototype;
    const original = proto.webkitGetAsEntry;
    // Answer only for the item this bridge created; everything else is untouched.
    proto.webkitGetAsEntry = function () {
      const real = original.call(this);
      if (real) return real;
      return this.kind === 'file' && this.getAsFile()?.name === marker ? entry : real;
    };
    try {
      for (const type of ['dragenter', 'dragover', 'drop']) {
        area.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer }));
      }
    } finally {
      setTimeout(() => { proto.webkitGetAsEntry = original; }, 2000);
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'santri-skills' || msg.type !== 'drop') return;
    let reply;
    try {
      const area = document.querySelector(msg.areaSelector);
      if (!area) throw new Error('area');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(msg.root) || !Array.isArray(msg.files) || !msg.files.length) throw new Error('payload');
      dropFolder(area, msg.root, msg.files);
      reply = { ok: true };
    } catch (error) {
      reply = { ok: false, error: String(error?.message || error) };
    }
    window.postMessage({ source: 'santri-skills-bridge', type: 'dropped', id: msg.id, ...reply }, location.origin);
  });
})();
