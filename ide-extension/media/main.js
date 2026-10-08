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
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
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
          <button class="ctx" id="ctxBtn" aria-pressed="false" title="Lampirkan struktur folder, package.json dan README (sekali di awal percakapan) agar dokumen sesuai project ini">+ Konteks project</button>
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
    const savedPath = !live && ref ? state.saved?.[ref] : null;
    const primary = savedPath
      ? `<button class="btn primary" data-act="openSaved" data-ref="${esc(ref)}" title="Buka file di editor">${ICONS.check}Buka ${esc(savedPath)}</button>
        <button class="btn" data-act="saveDoc" data-ref="${esc(ref)}" title="Simpan ulang atau sebagai file baru">Simpan ulang</button>`
      : `<button class="btn primary" data-act="saveDoc" data-ref="${esc(ref)}" title="Simpan ke workspace">${ICONS.save}Simpan ${esc(doc.fileName)}</button>
        <button class="btn" data-act="openDoc" data-ref="${esc(ref)}">Buka di editor</button>`;
    const actions = live ? '' : `<div class="doc-actions">
        ${primary}
        <button class="btn ghost" data-act="copyDoc" data-ref="${esc(ref)}">Salin</button>
        <button class="btn ghost" data-act="toggleDoc" data-key="${esc(key)}">${open ? 'Ringkas' : 'Lihat semua'}</button>
      </div>`;
    return `<div class="doc">
      <div class="doc-head"><span class="doc-icon">${kind}</span><div class="doc-title"><strong>${esc(doc.title)}</strong>
        <small>${live ? 'Sedang ditulis…' : savedPath ? `<span class="saved">✓ Tersimpan di ${esc(savedPath)}</span>${doc.version ? ` · v${esc(doc.version)}` : ''}` : `${esc(doc.fileName)}${doc.version ? ` · v${esc(doc.version)}` : ''}`}</small></div></div>
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
    const lattice = Number.isFinite(m.latencyMs) ? doneLattice(m.latencyMs) : '';
    return `<div class="msg assistant">${who}${lattice}${body}</div>`;
  }

  // ── ThoughtLattice (same look and wording as the website's AI chat) ──
  const STAR = '<svg class="tl-star" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>';
  const formatElapsed = (ms) => {
    const s = Math.max(0, ms) / 1000;
    return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(1)}s`;
  };
  let latticeOpen = true;
  const seenSteps = new Set();

  function stepHtml(step, index, key) {
    const id = `${key}|${step.text}`;
    const fresh = !seenSteps.has(id);
    seenSteps.add(id);
    return `<div class="tl-step${fresh ? ' tl-enter' : ''}" ${step.done ? 'data-done' : ''} style="--tl-delay:${fresh ? Math.min(index, 10) * 90 : 0}ms">
      ${step.done ? `<span class="tl-check">${ICONS.check}</span>` : '<span class="tl-pending"></span>'}<span>${esc(step.text)}</span></div>`;
  }

  function doneLattice(latencyMs) {
    return `<div class="tl" data-status="done"><div class="tl-head">${STAR}<span class="tl-label">Jawaban selesai</span>
      <span class="tl-timer">${formatElapsed(latencyMs)}</span></div></div>`;
  }

  // ── Live document card: types the streamed draft like the website canvas ──
  let liveDoc = null; // { key, target, shown }
  function typeLiveDoc() {
    if (!liveDoc) return;
    const body = document.querySelector('#pendingBox .doc-body .md');
    if (!body) return;
    const backlog = liveDoc.target.length - liveDoc.shown;
    if (backlog <= 0) return;
    liveDoc.shown = Math.min(liveDoc.target.length, liveDoc.shown + Math.max(4, Math.ceil(backlog / 12)));
    body.innerHTML = `${md.render(liveDoc.target.slice(0, liveDoc.shown))}<span class="caret"></span>`;
    const box = body.closest('.doc-body');
    box.scrollTop = box.scrollHeight;
    followBottom();
  }

  function followBottom() {
    const thread = $('#thread');
    if (thread.dataset.stick === '1') thread.scrollTop = thread.scrollHeight;
  }

  let messagesSig = '';
  function renderThread(force = false) {
    const thread = $('#thread');
    thread.dataset.stick = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80 || state.pending ? '1' : '0';
    if (!thread.firstElementChild) thread.innerHTML = '<div id="banners"></div><div id="msgs"></div><div id="pendingBox"></div>';

    $('#banners').innerHTML = [
      state.error ? `<div class="banner error"><span>${esc(state.error)}</span><button data-act="dismiss" title="Tutup">${ICONS.close}</button></div>` : '',
      state.notice ? `<div class="banner notice"><span>${esc(state.notice)}</span><button data-act="dismiss" title="Tutup">${ICONS.close}</button></div>` : '',
    ].join('');

    const hero = !state.loadingChat && !state.messages?.length && !state.pending;
    const sig = JSON.stringify([state.loadingChat, hero, (state.messages || []).map((m) => m.id), state.saved, state.models?.length]);
    if (force || sig !== messagesSig) {
      messagesSig = sig;
      if (state.loadingChat) {
        $('#msgs').innerHTML = `<div class="tl" data-status="working"><div class="tl-head">${STAR}<span class="tl-label shimmer">Memuat percakapan…</span></div></div>`;
      } else if (hero) {
        $('#msgs').innerHTML = `<div class="hero"><img src="${esc(LOGO)}" alt=""><h2>Apa yang ingin Anda rancang hari ini?</h2>
          <p>Diskusikan ide, lalu minta dokumen. Saat AI menulis, file PRD.md, ARCHITECTURE.md, SDLC.md, atau DESIGN.md langsung diketik di project.</p>
          <div class="chips">${(state.suggested || []).map((s) =>
            `<button class="chip" data-act="suggest" data-id="${esc(s.id)}"><strong>${esc(s.title)}</strong><span>${esc(s.desc)}</span></button>`).join('')}</div></div>`;
      } else {
        $('#msgs').innerHTML = (state.messages || []).map(renderMessage).join('');
      }
    }
    renderPending();
    followBottom();
  }

  function renderPending() {
    const box = $('#pendingBox');
    const p = state.pending;
    if (!p) {
      box.innerHTML = '';
      box.dataset.key = '';
      liveDoc = null;
      return;
    }
    if (box.dataset.key !== p.key) {
      box.dataset.key = p.key;
      liveDoc = null;
      box.innerHTML = `<div class="msg assistant"><div class="live-slot"></div>
        <div class="tl" data-status="working"><button type="button" class="tl-head" data-act="toggleLattice">${STAR}
          <span class="tl-label shimmer"></span><span class="tl-timer" data-started="${Number(p.startedAt) || Date.now()}"></span>
          <svg class="tl-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
          <div class="tl-trace"><div class="tl-steps"><span class="tl-line"></span><div class="tl-list"></div></div></div></div></div>`;
    }
    const label = box.querySelector('.tl-label');
    if (label.textContent !== p.label) label.textContent = p.label || 'Mengirim permintaan…';
    box.querySelector('.tl').toggleAttribute('data-open', latticeOpen);
    const list = box.querySelector('.tl-list');
    const stepsSig = JSON.stringify(p.steps || []);
    if (list.dataset.sig !== stepsSig) {
      list.dataset.sig = stepsSig;
      list.innerHTML = (p.steps || []).map((s, i) => stepHtml(s, i, p.key)).join('');
    }

    const slot = box.querySelector('.live-slot');
    if (!p.draft) {
      if (slot.innerHTML) slot.innerHTML = '';
      liveDoc = null;
      return;
    }
    const sectionsHtml = (p.draft.sections || []).map((s) => `<li class="${esc(s.status)}">${esc(s.title)}</li>`).join('');
    if (!slot.firstElementChild) {
      slot.innerHTML = `<div class="doc live"><div class="doc-head"><span class="doc-icon">${KIND_LABEL[p.draft.metadata.kind] || 'DOC'}</span>
        <div class="doc-title"><strong>${esc(p.draft.metadata.title)}</strong><small>Sedang ditulis langsung ke project…</small></div></div>
        <ul class="sections"></ul><div class="doc-body open-live"><div class="md"></div></div></div>`;
    }
    const ul = slot.querySelector('.sections');
    if (ul.innerHTML !== sectionsHtml) ul.innerHTML = sectionsHtml;
    if (!liveDoc) liveDoc = { target: '', shown: 0 };
    if (!p.draft.content.startsWith(liveDoc.target.slice(0, liveDoc.shown))) liveDoc.shown = 0;
    liveDoc.target = p.draft.content;
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
    if (act === 'toggleDoc') { const k = el.dataset.key; openDocs.has(k) ? openDocs.delete(k) : openDocs.add(k); renderThread(true); return; }
    if (act === 'toggleLattice') { latticeOpen = !latticeOpen; el.closest('.tl').toggleAttribute('data-open', latticeOpen); return; }
    if (act === 'saveDoc' || act === 'openDoc' || act === 'copyDoc' || act === 'openSaved') { post(act, { ref: el.dataset.ref }); return; }
    post(act);
  });
  // Broken logo → hide it (inline onerror handlers are blocked by the CSP).
  document.addEventListener('error', (e) => { if (e.target?.tagName === 'IMG') e.target.style.visibility = 'hidden'; }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && showModels) { showModels = false; renderComposer(); } });

  setInterval(() => {
    const t = document.querySelector('.tl-timer[data-started]');
    if (t) t.textContent = formatElapsed(Date.now() - Number(t.dataset.started));
  }, 100);
  setInterval(typeLiveDoc, 40);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg?.type === 'state') { state = msg.state; render(); }
    if (msg?.type === 'prefill' && typeof msg.text === 'string') { input.value = msg.text; autosize(); input.focus(); if (state) renderComposer(); }
  });

  autosize();
  post('ready');
})();
