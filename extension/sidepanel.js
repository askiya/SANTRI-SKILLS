// sidepanel.js — Side panel controller: auth, premium gate, catalog, assisted Gemini install
'use strict';
(function () {
  const $ = (s) => document.querySelector(s);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ── Theme ─────────────────────────────────────────────────────────────────
  const toggle = $('#theme-toggle');
  const saved = localStorage.getItem('theme');
  if (saved) document.documentElement.dataset.theme = saved;
  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    toggle.textContent = next === 'dark' ? '☼' : '☽';
  });

  // ── Sections ──────────────────────────────────────────────────────────────
  const loginSection = $('#login-section');
  const consentSection = $('#consent-section');
  const premiumSection = $('#premium-section');
  const catalogSection = $('#catalog-section');
  const tutorialSection = $('#tutorial');
  const installSection = $('#install');
  const notice = $('#notice');
  const PANELS = [loginSection, consentSection, premiumSection, catalogSection, tutorialSection, installSection];
  const only = (el) => PANELS.forEach(p => (p === el ? show(p) : hide(p)));

  function showNotice(msg, level) {
    notice.textContent = msg;
    notice.style.borderColor = level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--good)';
    show(notice);
    clearTimeout(showNotice._t);
    if (level !== 'error') showNotice._t = setTimeout(() => hide(notice), 8000);
  }

  let currentSession = null;

  // ── Premium gate (server-verified) ───────────────────────────────────────
  function showPremiumGate(message) {
    currentSession = null;
    catalogItems = [];
    hide($('#logout-btn'));
    $('#premium-text').textContent = message || 'Akun ini belum Premium. Upgrade untuk memasang Skills Santriverse langsung ke Gemini.';
    only(premiumSection);
  }
  function handleAuthError(error, fallback) {
    if (error?.code === 'premium_required') { showPremiumGate(); return; }
    if (error?.status === 401) {
      currentSession = null;
      hide($('#logout-btn'));
      only(loginSection);
      showNotice('Sesi berakhir. Hubungkan ulang akun Santriverse.', 'warn');
      return;
    }
    showNotice(error?.message || fallback, 'error');
  }
  $('#upgrade-btn').addEventListener('click', () => chrome.tabs.create({ url: typeof UPGRADE_URL === 'string' ? UPGRADE_URL : 'https://santriverse.my.id/checkout' }));
  $('#premium-recheck').addEventListener('click', () => $('#login-btn').click());

  // ── Login ─────────────────────────────────────────────────────────────────
  $('#login-btn').addEventListener('click', async () => {
    const button = $('#login-btn');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Menunggu persetujuan…';
    button.setAttribute('aria-busy', 'true');
    showNotice('Login di situs resmi, lalu pilih Izinkan koneksi.', 'info');
    try {
      const user = await login();
      currentSession = await getSession();
      onAuthenticated(user);
    } catch (err) {
      handleAuthError(err, 'Login gagal.');
    } finally {
      button.disabled = false;
      button.textContent = 'Hubungkan akun Santriverse';
      button.removeAttribute('aria-busy');
    }
  });

  // Try session restore on load
  (async () => {
    try {
      const user = await restoreSession();
      if (user) {
        currentSession = await getSession();
        onAuthenticated(user);
      }
    } catch (error) { handleAuthError(error, 'Gagal memeriksa sesi.'); }
  })();

  function onAuthenticated(user) {
    if (!user?.premium) { showPremiumGate(); return; }
    hide(loginSection);
    show($('#logout-btn'));
    showNotice(`Selamat datang, ${user?.name || 'Member'}! Akses Premium terverifikasi.`, 'good');
    loadCatalog();
  }

  // ── Install status (local, non-sensitive) ─────────────────────────────────
  // What each target showed after the last assisted install:
  // install_status (Gemini) / chatgpt_status (ChatGPT): { [packageId]: { name, version, status } }.
  const STATUS_KEYS = { gemini: 'install_status', chatgpt: 'chatgpt_status' };
  async function readStatuses(target = 'gemini') {
    const key = STATUS_KEYS[target];
    try { return (await chrome.storage.local.get(key))[key] || {}; } catch { return {}; }
  }
  async function writeStatus(id, value, target = 'gemini') {
    const all = await readStatuses(target);
    all[id] = value;
    await chrome.storage.local.set({ [STATUS_KEYS[target]]: all });
  }
  function statusFor(item, stored) {
    const s = stored[item.id];
    if (!s || s.status !== 'detected') return 'not_installed';
    return s.version === item.version ? 'detected' : 'update_available';
  }

  // ── Catalog (packages from server, not sources) ───────────────────────────
  let catalogItems = [];
  let catalogConsent = null;

  async function loadCatalog() {
    const grid = $('#catalog-grid');
    const empty = $('#empty-state');
    grid.innerHTML = '<p style="color:var(--muted)">Memuat katalog…</p>';
    try {
      if (!currentSession?.token) {
        grid.innerHTML = '';
        show(empty);
        return;
      }
      const data = await callAPI('/skills/catalog', { token: currentSession.token });
      catalogItems = data?.packages || [];
      catalogConsent = typeof setConsent === 'function' ? setConsent(data?.consent) : data?.consent;
      if (catalogConsent?.required) {
        only(consentSection);
        return;
      }
      only(catalogSection);
      if (!catalogItems.length) { grid.innerHTML = ''; show(empty); return; }
      hide(empty);
      await renderCatalog();
      refreshDetection();
    } catch (err) {
      grid.innerHTML = '';
      show(empty);
      handleAuthError(err, 'Gagal memuat katalog.');
    }
  }

  async function renderCatalog() {
    const [gemini, chatgpt] = await Promise.all([readStatuses('gemini'), readStatuses('chatgpt')]);
    $('#catalog-grid').innerHTML = catalogItems
      .map(item => renderCard({ ...item, status: statusFor(item, gemini), chatgptStatus: statusFor(item, chatgpt) }))
      .join('');
  }

  /** If a Gemini Skills tab is already open, mark skills Gemini lists there. */
  async function refreshDetection() {
    if (typeof detectListed !== 'function') return;
    const stored = await readStatuses('gemini');
    const skills = catalogItems.filter(i => (i.kind || i.type) !== 'gem');
    const nameOf = (i) => stored[i.id]?.name || i.slug;
    const listed = await detectListed(skills.map(nameOf).filter(Boolean)).catch(() => null);
    if (!listed) return;
    let changed = false;
    for (const item of skills) {
      if (listed.includes(nameOf(item)) && !stored[item.id]) {
        await writeStatus(item.id, { name: nameOf(item), version: item.version, status: 'detected' }, 'gemini');
        changed = true;
      }
    }
    if (changed) renderCatalog();
  }

  // ── Consent (server-versioned) ──────────────────────────────────────────
  const consentCheck = $('#consent-check');
  const consentBtn = $('#consent-btn');
  consentCheck.addEventListener('change', () => { consentBtn.disabled = !consentCheck.checked; });
  consentBtn.addEventListener('click', async () => {
    if (!currentSession?.token) return;
    try {
      if (typeof acceptConsent === 'function') {
        await acceptConsent(currentSession.token);
      }
      only(catalogSection);
      loadCatalog();
    } catch (err) {
      handleAuthError(err, 'Gagal menerima persetujuan.');
    }
  });

  $('#refresh-btn').addEventListener('click', loadCatalog);

  // ── ChatGPT plugin packaging ───────────────────────────────────────────────
  async function extensionLogo() {
    try { return new Uint8Array(await (await fetch(chrome.runtime.getURL('icons/icon-128.png'))).arrayBuffer()); } catch { return null; }
  }
  async function chatGptPluginFrom(blob, item) {
    const skill = prepareSkillPackage(await readZip(await blob.arrayBuffer()));
    return { skill, plugin: buildChatGptPlugin(skill, item, await extensionLogo()) };
  }
  function saveBytes(bytes, fileName) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Download (manual fallback) ─────────────────────────────────────────────
  async function downloadItem(item, btn, target = 'gemini') {
    if (!item || !currentSession?.token) {
      showNotice('Sesi atau paket tidak tersedia.', 'warn');
      return;
    }
    if (!item.file_size || !item.sha256) {
      showNotice(item.gem_url ? 'Gem ini menggunakan URL langsung, tidak perlu download.' : 'Paket belum tersedia untuk download.', item.gem_url ? 'info' : 'warn');
      return;
    }
    const label = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Mengunduh…'; }
    try {
      const blob = await downloadPackage(item, currentSession.token);
      if (target === 'chatgpt') {
        const { plugin } = await chatGptPluginFrom(blob, item);
        saveBytes(plugin.zip, plugin.fileName);
        showNotice('Plugin ChatGPT terunduh. Upload di chatgpt.com/plugins → + → Unggah plugin.', 'good');
      } else {
        saveBytes(new Uint8Array(await blob.arrayBuffer()), `${item.slug}-${item.version}.zip`);
        showNotice('ZIP terunduh dan terverifikasi. Upload langsung ke Gemini, tidak perlu diekstrak.', 'good');
      }
    } catch (err) {
      handleAuthError(err, 'Gagal mengunduh paket.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ── Assisted install (Gemini Skills or ChatGPT Plugins) ─────────────────────
  const TARGETS = {
    gemini: {
      eyebrow: 'PASANG KE GEMINI',
      steps: ['Cek akses Premium', 'Unduh & verifikasi paket', 'Siapkan file skill', 'Buka Gemini Skills', 'Isi form upload Gemini', 'Klik Buat di tab Gemini'],
      failReasons: {
        navigate: 'Halaman Gemini Skills tidak terbuka.',
        upload_button: 'Tombol Upload Gemini tidak ditemukan (tampilan Gemini mungkin berubah, atau akun belum mendapat fitur Skills).',
        upload_dialog: 'Dialog upload Gemini tidak terbuka.',
        drop: 'Gemini menolak file yang dikirim.',
        review_timeout: 'Gemini belum menampilkan halaman Review.',
      },
      waitTitle: 'Tinggal satu klik',
      waitHint: 'Review isi skill di tab Gemini, lalu klik "Buat". Panel ini mendeteksi otomatis begitu skill muncul.',
      pendingHint: 'Belum terdeteksi. Kalau sudah klik "Buat", buka gemini.google.com/skills lalu tekan ↻ di katalog.',
      doneTitle: 'Terpasang di Gemini ✓',
      doneHint: (name) => `Pakai di chat Gemini dengan mengetik / lalu pilih "${name}".`,
    },
    chatgpt: {
      eyebrow: 'PASANG KE CHATGPT',
      steps: ['Cek akses Premium', 'Unduh & verifikasi paket', 'Bungkus jadi plugin ChatGPT', 'Buka ChatGPT Plugins', 'Unggah plugin ke ChatGPT', 'Klik Instal Plugin di ChatGPT'],
      failReasons: {
        navigate: 'Halaman ChatGPT Plugins tidak terbuka.',
        add_button: 'Tombol + di halaman Plugin tidak ditemukan. Pastikan sudah login di chatgpt.com.',
        upload_menu: 'Menu "Unggah plugin" tidak muncul (akun mungkin belum mendapat fitur upload plugin).',
        upload_dialog: 'Dialog unggah plugin tidak terbuka.',
        import_failed: 'ChatGPT menolak plugin.',
        import_timeout: 'ChatGPT belum menyelesaikan impor.',
      },
      waitTitle: 'Tinggal satu klik',
      waitHint: 'Plugin sudah diimpor. Klik "Instal Plugin" di tab ChatGPT — panel ini mendeteksi otomatis.',
      pendingHint: 'Belum terdeteksi terpasang. Kalau sudah klik "Instal Plugin", tekan ↻ di katalog.',
      doneTitle: 'Terpasang di ChatGPT ✓',
      doneHint: (_name, title) => `Pakai di chat ChatGPT dengan mengetik @ lalu pilih "${title}".`,
    },
  };
  let installing = false;
  let currentSteps = TARGETS.gemini.steps;

  function renderSteps(states) {
    const icon = { done: '✓', active: '•', fail: '!', wait: '' };
    $('#install-steps').innerHTML = currentSteps.map((label, i) => {
      const st = states[i] || 'wait';
      return `<li class="step step-${st}"><span class="step-icon" aria-hidden="true">${icon[st]}</span><span>${esc(label)}</span></li>`;
    }).join('');
  }
  function setHint(text, level) {
    const hint = $('#install-hint');
    hint.textContent = text;
    hint.dataset.level = level || 'info';
    text ? show(hint) : hide(hint);
  }

  async function installItem(item, target = 'gemini') {
    if (installing) return;
    installing = true;
    const cfg = TARGETS[target];
    currentSteps = cfg.steps;
    const states = [];
    const step = (i, state) => { states[i] = state; renderSteps(states); };
    const fail = (i, message) => {
      step(i, 'fail');
      $('#install-title').textContent = 'Belum berhasil otomatis';
      setHint(message, 'error');
      show($('#install-manual'));
    };
    installSection.dataset.itemId = item.id;
    installSection.dataset.target = target;
    $('#install-eyebrow').textContent = cfg.eyebrow;
    $('#install-title').textContent = item.title || item.name || 'Skill';
    hide($('#install-manual'));
    setHint('');
    only(installSection);

    try {
      step(0, 'active');
      try {
        currentSession = await verifyPremium();
      } catch (err) {
        installing = false;
        handleAuthError(err, 'Gagal memverifikasi akses Premium.');
        return;
      }
      step(0, 'done');

      step(1, 'active');
      let blob;
      try { blob = await downloadPackage(item, currentSession.token); } catch (err) {
        if (err?.code === 'premium_required' || err?.status === 401) { installing = false; handleAuthError(err); return; }
        return fail(1, err.message || 'Paket gagal diunduh.');
      }
      step(1, 'done');

      step(2, 'active');
      let skill;
      let plugin = null;
      try {
        if (target === 'chatgpt') ({ skill, plugin } = await chatGptPluginFrom(blob, item));
        else skill = prepareSkillPackage(await readZip(await blob.arrayBuffer()));
      } catch (err) {
        return fail(2, err.message || 'Paket tidak sesuai format skill.');
      }
      step(2, 'done');

      step(3, 'active');
      let result;
      try { result = target === 'chatgpt' ? await assistChatGptInstall(plugin) : await assistInstall(skill); } catch (err) {
        return fail(3, err.message || 'Halaman tujuan tidak bisa dibuka.');
      }
      if (!result?.ok) {
        const at = result?.stage === 'navigate' ? 3 : 4;
        if (at === 4) step(3, 'done');
        const detail = result?.detail ? ` (${result.detail})` : '';
        return fail(at, `${cfg.failReasons[result?.stage] || 'Pengisian otomatis gagal.'}${detail} Gunakan cara manual.`);
      }
      step(3, 'done');
      step(4, 'done');

      step(5, 'active');
      $('#install-title').textContent = cfg.waitTitle;
      setHint(cfg.waitHint, 'info');
      const installed = target === 'chatgpt'
        ? await waitUntilChatGptInstalled(result.tabId, result.pluginId)
        : await waitUntilListed(result.tabId, skill.name);
      if (!installed) {
        step(5, 'wait');
        $('#install-title').textContent = 'Menunggu konfirmasi';
        setHint(cfg.pendingHint, 'warn');
        return;
      }
      step(5, 'done');
      await writeStatus(item.id, { name: skill.name, version: item.version, status: 'detected', pluginId: result.pluginId || null }, target);
      $('#install-title').textContent = cfg.doneTitle;
      setHint(cfg.doneHint(skill.name, plugin?.manifest?.extensions?.['com.openai']?.interface?.displayName || item.title), 'good');
      renderCatalog();
    } finally {
      installing = false;
    }
  }

  $('#install-close').addEventListener('click', () => { only(catalogSection); renderCatalog(); });
  $('#install-manual').addEventListener('click', () => showTutorial('skill', installSection.dataset.itemId, installSection.dataset.target || 'gemini'));

  // ── Card actions (event delegation) ───────────────────────────────────────
  $('#catalog-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const card = btn.closest('.skill-card');
    const type = card?.dataset.type || 'skill';
    const item = catalogItems.find(p => String(p.id) === String(id));

    if (action === 'install' || action === 'install-chatgpt') {
      if (!item) return showNotice('Paket tidak tersedia.', 'warn');
      if (!item.file_size || !item.sha256) return showNotice('Paket belum tersedia untuk dipasang.', 'warn');
      if (action === 'install-chatgpt') {
        // ChatGPT keeps uploaded personal plugins (no delete), so never upload a duplicate:
        // same version → open it; newer version → guide to "Upload new version".
        const known = (await readStatuses('chatgpt'))[item.id];
        if (known?.status === 'detected' && known.pluginId) {
          chrome.tabs.create({ url: `https://chatgpt.com/plugins/${encodeURIComponent(known.pluginId)}` });
          if (known.version === item.version) return showNotice('Plugin sudah terpasang di ChatGPT — membuka halamannya.', 'good');
          await downloadItem(item, btn, 'chatgpt');
          return showNotice(`Versi ${item.version} siap. Di halaman plugin: Tindakan plugin → Unggah versi baru → pilih ZIP yang baru diunduh.`, 'warn');
        }
      }
      installItem(item, action === 'install-chatgpt' ? 'chatgpt' : 'gemini');
    }
    if (action === 'open') {
      if (type === 'gem' && item?.gem_url) {
        chrome.tabs.create({ url: item.gem_url });
        return;
      }
      showTutorial(type, id);
    }
    if (action === 'download') downloadItem(item, btn);
  });

  // ── Tutorial (manual fallback) ────────────────────────────────────────────
  function showTutorial(type, itemId, target = 'gemini') {
    const chatgpt = target === 'chatgpt' && type !== 'gem';
    const steps = chatgpt && typeof getChatGptManualSteps === 'function'
      ? getChatGptManualSteps()
      : typeof getManualSteps === 'function' ? getManualSteps(type) : ['Buka Gemini, lalu pasang secara manual.'];
    $('#tutorial-steps').innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join('');
    tutorialSection.dataset.itemId = itemId;
    tutorialSection.dataset.itemType = type;
    tutorialSection.dataset.target = chatgpt ? 'chatgpt' : 'gemini';
    $('#tutorial-title').textContent = chatgpt ? 'Pasang di ChatGPT' : 'Pasang di Gemini';
    $('#tutorial-download').textContent = chatgpt ? 'Download ZIP ChatGPT' : 'Download ZIP';
    $('#tutorial-open').textContent = chatgpt ? 'Buka ChatGPT Plugins' : 'Buka Gemini Skills';
    $('#tutorial-honesty').textContent = chatgpt
      ? 'ChatGPT menerima ZIP plugin langsung. Konfirmasi akhir (klik Instal Plugin) selalu dilakukan member di ChatGPT.'
      : 'Gemini menerima file ZIP langsung. Konfirmasi akhir (klik Buat) selalu dilakukan member di Gemini.';
    type === 'gem' ? hide($('#tutorial-download')) : show($('#tutorial-download'));
    only(tutorialSection);
  }

  $('#tutorial-close').addEventListener('click', () => only(catalogSection));
  $('#tutorial-download').addEventListener('click', (e) => {
    const item = catalogItems.find(p => String(p.id) === String(tutorialSection.dataset.itemId));
    downloadItem(item, e.currentTarget, tutorialSection.dataset.target || 'gemini');
  });
  $('#tutorial-open').addEventListener('click', () => {
    const type = tutorialSection.dataset.itemType || 'skill';
    if (tutorialSection.dataset.target === 'chatgpt' && typeof openChatGptPluginsPage === 'function') return openChatGptPluginsPage();
    if (typeof openGeminiPage === 'function') openGeminiPage(type);
    else chrome.tabs.create({ url: 'https://gemini.google.com/skills' });
  });

  $('#member-confirm').addEventListener('click', () => {
    showNotice('Status dicatat sebagai laporan member. Bukan verifikasi otomatis.', 'info');
    only(catalogSection);
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  $('#logout-btn').addEventListener('click', async () => {
    try { await revokeSession(); } catch { /* best effort */ }
    currentSession = null;
    catalogItems = [];
    hide($('#logout-btn'));
    only(loginSection);
    showNotice('Sesi berakhir.', 'info');
  });
})();
