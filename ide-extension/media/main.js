// Santri Code webview. Renders state pushed by the extension host and posts user
// intents back. Every dynamic string is escaped; Markdown goes through SantriMarkdown.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const md = window.SantriMarkdown;
  const esc = md.escape;
  const $ = (sel) => document.querySelector(sel);
  const LOGO = document.body.dataset.logo;

  const ICONS = {
    history: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    send: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="3"/></svg>',
    chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    save: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M5 21h14"/></svg>',
  };
  const KIND_LABEL = { prd: 'PRD', architecture: 'ARCH', sdlc: 'SDLC', design: 'DSGN', document: 'DOC' };

  let state = null;
  let showHistory = false;
  let showModels = false;
  const openDocs = new Set();
  const saved = vscode.getState() || {};

  const post = (type, payload = {}) => vscode.postMessage({ type, ...payload });

  // ── Static shell ──────────────────────────────────────────────
  document.getElementById('app').innerHTML = `
    <header class="top">
      <div class="brand"><img src="${esc(LOGO)}" alt=""><div><strong>Santri Code</strong><small id="who">AI Flow Studio Santriverse</small></div></div>
      <div class="top-actions" id="topActions">
        <button class="icon-btn" id="historyBtn" title="Riwayat chat" aria-pressed="false">${ICONS.history}</button>
        <button class="icon-btn" id="newBtn" title="Chat baru">${ICONS.plus}</button>
      </div>
    </header>
    <section class="history" id="history" hidden></section>
    <main class="thread" id="thread" aria-live="polite"></main>
    <section class="gate" id="gate" hidden></section>
    <footer class="composer-wrap" id="composerWrap">
      <div class="composer">
        <textarea id="input" rows="2" placeholder="Tanya, diskusikan ide, atau minta PRD / ARCHITECTURE.md / SDLC / DESIGN.md…" aria-label="Pesan"></textarea>
        <div class="composer-row">
          <button class="pill" id="modelBtn" aria-haspopup="listbox"><span id="modelName">Pilih model</span>${ICONS.chevron}</button>
          <button class="ctx" id="ctxBtn" aria-pressed="false" title="Sertakan struktur folder, package.json dan README agar dokumen sesuai project ini">+ Konteks project</button>
          <button class="send" id="sendBtn" title="Kirim (Enter)">${ICONS.send}</button>
        </div>
        <div class="model-menu" id="modelMenu" role="listbox" hidden></div>
      </div>
      <div class="meta"><span>AI dapat membuat kesalahan. Periksa informasi penting.</span><span class="credits" id="credits"></span></div>
    </footer>`;

  const input = $('#input');
  input.value = saved.draft || '';

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  }

  function modelLogo(model, cls = 'model-logo') {
    if (model?.logo) return `<img class="${cls}" src="${esc(model.logo)}" alt="">`;
    return `<span class="${cls} fallback">${esc((model?.name || '?').slice(0, 1).toUpperCase())}</span>`;
  }

  function creditsText(usage) {
    if (!usage) return '';
    if (usage.unlimited) return 'Kredit tanpa batas';
    if (usage.limit == null) return '';
    return `${usage.remaining} / ${usage.limit} kredit tersisa`;
  }

  // ── Renderers ─────────────────────────────────────────────────
  function renderGate() {
    const gate = $('#gate');
    const phase = state.phase;
    const card = (body) => `<div class="gate-card"><img src="${esc(LOGO)}" alt="">${body}</div>`;
    if (phase === 'loading') {
      gate.innerHTML = card('<span class="eyebrow">SANTRI CODE</span><div class="spinner" style="margin-top:16px"></div><p>Menghubungkan ke Santriverse…</p>');
    } else if (phase === 'waitingLogin') {
      gate.innerHTML = card(`<span class="eyebrow">MENUNGGU PERSETUJUAN</span><h1>Lanjutkan di browser</h1><div class="spinner"></div>
        <p>Login dan setujui koneksi <strong>Santri Code</strong> di santriverse.my.id, lalu kembali ke ${esc(state.appName)}.</p>
        <button class="btn primary" data-act="reopenLogin">Buka lagi halaman login</button>
        <button class="btn ghost" data-act="cancelLogin">Batal</button>`);
    } else if (phase === 'premium') {
      gate.innerHTML = card(`<span class="eyebrow">KHUSUS PREMIUM</span><h1>Santri Code untuk Member Premium</h1>
        <p>${esc(state.error || 'Akun ini belum Premium. Upgrade untuk memakai AI Flow Studio langsung dari editor.')}</p>
        <button class="btn primary" data-act="upgrade">Upgrade ke Premium</button>
        <button class="btn" data-act="login">Sudah upgrade? Login ulang</button>`);
    } else {
      gate.innerHTML = card(`<span class="eyebrow">SANTRI CODE</span><h1>AI Flow Studio di editor kamu</h1>
        <p>Susun PRD, ARCHITECTURE.md, SDLC, dan DESIGN.md bersama AI Santriverse, lalu simpan langsung ke project.</p>
        ${state.notice ? `<p class="note">${esc(state.notice)}</p>` : ''}
        ${state.error ? `<p class="note" style="color:var(--sv-bad)">${esc(state.error)}</p>` : ''}
        <button class="btn primary" data-act="login">Login dengan Santriverse</button>
        <p class="note">Khusus Member Premium · password tetap di santriverse.my.id</p>`);
    }
  }

  function renderHistory() {
    const el = $('#history');
    el.hidden = !showHistory;
    $('#historyBtn').setAttribute('aria-pressed', String(showHistory));
    if (!showHistory) return;
    const chats = state.chats || [];
    el.innerHTML = `<h3>Riwayat percakapan</h3>${chats.length ? chats.map((c) =>
      `<button data-act="openChat" data-id="${esc(c.id)}" class="${c.id === state.chatId ? 'active' : ''}" title="${esc(c.title)}">${esc(c.title || 'Chat baru')}</button>`).join('')
      : '<div class="empty">Belum ada percakapan.</div>'}`;
  }

  function docCard(doc, ref, live) {
    const key = ref || 'live';
    const open = openDocs.has(key);
    const kind = KIND_LABEL[doc.kind] || 'DOC';
    const sections = doc.sections?.length
      ? `<ul class="sections">${doc.sections.map((s) => `<li class="${esc(s.status)}">${esc(s.title)}</li>`).join('')}</ul>` : '';
    const actions = live ? '' : `<div class="doc-actions">
        <button class="btn primary" data-act="saveDoc" data-ref="${esc(ref)}" title="Simpan ke workspace">${ICONS.save}Simpan ${esc(doc.fileName)}</button>
        <button class="btn" data-act="openDoc" data-ref="${esc(ref)}">Buka di editor</button>
        <button class="btn ghost" data-act="copyDoc" data-ref="${esc(ref)}">Salin</button>
        <button class="btn ghost" data-act="toggleDoc" data-key="${esc(key)}">${open ? 'Ringkas' : 'Lihat semua'}</button>
      </div>`;
    return `<div class="doc">
      <div class="doc-head"><span class="doc-icon">${kind}</span><div class="doc-title"><strong>${esc(doc.title)}</strong>
        <small>${live ? 'Sedang ditulis…' : `${esc(doc.fileName)}${doc.version ? ` · v${esc(doc.version)}` : ''}`}</small></div></div>
      ${sections}
      <div class="doc-body ${open ? 'open' : ''}"><div class="md">${md.render(doc.content)}</div></div>
      ${actions}
    </div>`;
  }

  function renderMessage(m) {
    if (m.role === 'user') {
      return `<div class="msg user"><div class="bubble">${esc(m.text)}</div>${m.hasContext ? '<div class="ctx-tag">+ konteks project terlampir</div>' : ''}</div>`;
    }
    const model = (state.models || []).find((x) => x.name === m.model || x.providerModelId === m.model);
    const who = `<div class="who">${model ? modelLogo(model) : ''}<span>${esc(model?.name || m.model || 'Santri')}</span></div>`;
    const body = (m.segments || []).map((s) => (s.type === 'document'
      ? docCard(s, `${m.id}:${s.index}`)
      : s.literal ? `<div class="md"><pre>${esc(s.content)}</pre></div>` : `<div class="md">${md.render(s.content)}</div>`)).join('');
    return `<div class="msg assistant">${who}${body}</div>`;
  }

  function renderThread() {
    const thread = $('#thread');
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    const banners = [
      state.error ? `<div class="banner error"><span>${esc(state.error)}</span><button data-act="dismiss" title="Tutup">${ICONS.close}</button></div>` : '',
      state.notice ? `<div class="banner notice"><span>${esc(state.notice)}</span><button data-act="dismiss" title="Tutup">${ICONS.close}</button></div>` : '',
    ].join('');
    let body;
    if (state.loadingChat) {
      body = '<div class="thinking"><span class="lattice"><i></i><i></i><i></i></span>Memuat percakapan…</div>';
    } else if (!state.messages?.length && !state.pending) {
      body = `<div class="hero"><img src="${esc(LOGO)}" alt=""><h2>Apa yang ingin Anda rancang hari ini?</h2>
        <p>Diskusikan ide, lalu minta dokumen. Hasilnya bisa disimpan langsung sebagai PRD.md, ARCHITECTURE.md, SDLC.md, atau DESIGN.md.</p>
        <div class="chips">${(state.suggested || []).map((s) =>
          `<button class="chip" data-act="suggest" data-id="${esc(s.id)}"><strong>${esc(s.title)}</strong><span>${esc(s.desc)}</span></button>`).join('')}</div></div>`;
    } else {
      body = (state.messages || []).map(renderMessage).join('');
      if (state.pending) {
        const p = state.pending;
        const secs = Math.max(0, Math.round((Date.now() - p.startedAt) / 1000));
        body += `<div class="msg assistant">${p.draft ? docCard({ ...p.draft.metadata, content: p.draft.content, sections: p.draft.sections, fileName: '' }, '', true) : ''}
          <div class="thinking"><span class="lattice"><i></i><i></i><i></i></span><span>${esc(p.label || 'Santri sedang berpikir…')}</span><time data-started="${p.startedAt}">${secs}s</time></div></div>`;
      }
    }
    thread.innerHTML = banners + body;
    if (nearBottom || state.pending) thread.scrollTop = thread.scrollHeight;
  }

  function renderComposer() {
    const model = (state.models || []).find((m) => m.id === state.modelId);
    $('#modelBtn').innerHTML = `${model ? modelLogo(model) : ''}<span id="modelName">${esc(model?.name || 'Pilih model')}</span>${ICONS.chevron}`;
    $('#ctxBtn').setAttribute('aria-pressed', String(!!state.includeContext));
    $('#ctxBtn').textContent = state.includeContext ? '✓ Konteks project' : '+ Konteks project';
    const send = $('#sendBtn');
    send.classList.toggle('stop', !!state.pending);
    send.innerHTML = state.pending ? ICONS.stop : ICONS.send;
    send.title = state.pending ? 'Hentikan' : 'Kirim (Enter)';
    send.disabled = !state.pending && !input.value.trim();
    const credits = $('#credits');
    credits.textContent = creditsText(state.usage);
    credits.classList.toggle('low', !!state.usage && !state.usage.unlimited && state.usage.limit != null && state.usage.remaining <= 3);
    const menu = $('#modelMenu');
    menu.hidden = !showModels;
    if (showModels) {
      menu.innerHTML = `<h4>PILIH MODEL</h4>${(state.models || []).map((m) => `
        <button class="model-opt ${m.id === state.modelId ? 'active' : ''}" role="option" aria-selected="${m.id === state.modelId}" data-act="model" data-id="${esc(m.id)}">
          ${modelLogo(m)}<div><strong>${esc(m.name)}</strong><small>${esc(m.provider)}</small></div><em>${esc(String(m.credits))} kredit</em></button>`).join('')
        || '<div class="empty" style="padding:8px">Belum ada model aktif.</div>'}`;
    }
  }

  function render() {
    if (!state) return;
    const ready = state.phase === 'ready';
    $('#gate').hidden = ready;
    $('#thread').hidden = !ready;
    $('#composerWrap').hidden = !ready;
    $('#topActions').hidden = !ready;
    $('#who').textContent = ready && state.user ? state.user.name : 'AI Flow Studio Santriverse';
    if (!ready) {
      showHistory = false;
      $('#history').hidden = true;
      renderGate();
      return;
    }
    renderHistory();
    renderThread();
    renderComposer();
  }

  // ── Intents ──────────────────────────────────────────────────
  function submit() {
    if (state?.pending) return post('cancel');
    const text = input.value.trim();
    if (!text) return;
    post('send', { text });
    input.value = '';
    vscode.setState({ ...saved, draft: '' });
    autosize();
    renderComposer();
  }

  input.addEventListener('input', () => {
    autosize();
    vscode.setState({ ...saved, draft: input.value });
    if (state) $('#sendBtn').disabled = !state.pending && !input.value.trim();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });
  $('#sendBtn').addEventListener('click', submit);
  $('#modelBtn').addEventListener('click', (e) => { e.stopPropagation(); showModels = !showModels; renderComposer(); });
  $('#ctxBtn').addEventListener('click', () => post('toggleContext'));
  $('#historyBtn').addEventListener('click', () => { showHistory = !showHistory; if (showHistory) post('loadChats'); renderHistory(); });
  $('#newBtn').addEventListener('click', () => { showHistory = false; post('newChat'); input.focus(); });
  document.addEventListener('click', (e) => {
    if (showModels && !e.target.closest('#modelMenu') && !e.target.closest('#modelBtn')) { showModels = false; renderComposer(); }
    const link = e.target.closest('a[data-external]');
    if (link) { e.preventDefault(); post('openExternal', { url: link.getAttribute('href') }); return; }
    const copy = e.target.closest('[data-copy-code]');
    if (copy) { post('copy', { text: copy.closest('.md-code').querySelector('code').textContent }); copy.textContent = 'Tersalin'; setTimeout(() => { copy.textContent = 'Salin'; }, 1200); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'model') { showModels = false; post('selectModel', { id: el.dataset.id }); return; }
    if (act === 'openChat') { showHistory = false; post('openChat', { id: el.dataset.id }); return; }
    if (act === 'suggest') {
      const s = (state.suggested || []).find((x) => x.id === el.dataset.id);
      if (s) { input.value = s.prompt; autosize(); input.focus(); renderComposer(); }
      return;
    }
    if (act === 'toggleDoc') { const k = el.dataset.key; openDocs.has(k) ? openDocs.delete(k) : openDocs.add(k); renderThread(); return; }
    if (act === 'saveDoc' || act === 'openDoc' || act === 'copyDoc') { post(act, { ref: el.dataset.ref }); return; }
    post(act);
  });
  // Broken logo → hide it (inline onerror handlers are blocked by the CSP).
  document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && showModels) { showModels = false; renderComposer(); } });

  setInterval(() => {
    const t = document.querySelector('time[data-started]');
    if (t) t.textContent = `${Math.max(0, Math.round((Date.now() - Number(t.dataset.started)) / 1000))}s`;
  }, 1000);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'state') { state = msg.state; render(); }
    if (msg?.type === 'prefill' && typeof msg.text === 'string') { input.value = msg.text; autosize(); input.focus(); if (state) renderComposer(); }
  });

  autosize();
  post('ready');
})();
