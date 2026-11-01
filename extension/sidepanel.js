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
    $('#premium-text').textContent = message || 'Akun ini belum Premium. Upgrade untuk memasang Skills Santriverse ke Gemini, ChatGPT, dan Claude.';
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
  // install_status (Gemini) / chatgpt_status (ChatGPT) / claude_status (Claude, member-reported):
  // { [packageId]: { name, version, status, reported? } }.
  const STATUS_KEYS = { gemini: 'install_status', chatgpt: 'chatgpt_status', claude: 'claude_status' };
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

  // ── Platform tabs ─────────────────────────────────────────────────────────
  let activePlatform = (() => { try { return localStorage.getItem('platform'); } catch { return null; } })();
  if (!PLATFORM_IDS.includes(activePlatform)) activePlatform = 'gemini';
  const PLATFORM_HOSTS = { 'gemini.google.com': 'gemini', 'chatgpt.com': 'chatgpt', 'claude.ai': 'claude' };
  /** Follow the page the member is on (URLs are visible only for our host permissions). */
  async function platformFromActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return PLATFORM_HOSTS[new URL(tab?.url || '').hostname] || null;
    } catch { return null; }
  }
  function selectPlatform(platform) {
    if (!PLATFORM_IDS.includes(platform)) return;
    activePlatform = platform;
    try { localStorage.setItem('platform', platform); } catch { /* storage blocked */ }
    renderCatalog();
  }
  $('#platform-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-platform]');
    if (tab) selectPlatform(tab.dataset.platform);
  });
  $('#platform-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const at = PLATFORM_IDS.indexOf(activePlatform);
    selectPlatform(PLATFORM_IDS[(at + (e.key === 'ArrowRight' ? 1 : PLATFORM_IDS.length - 1)) % PLATFORM_IDS.length]);
    $(`#platform-tabs [data-platform="${activePlatform}"]`)?.focus();
  });

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
      const fromTab = await platformFromActiveTab();
      if (fromTab) activePlatform = fromTab;
      await renderCatalog();
      refreshDetection();
    } catch (err) {
      grid.innerHTML = '';
      show(empty);
      handleAuthError(err, 'Gagal memuat katalog.');
    }
  }

  async function renderCatalog() {
    const platform = activePlatform;
    const stored = await readStatuses(platform);
    const counts = Object.fromEntries(PLATFORM_IDS.map(id => [id, catalogItems.filter(i => platformsOf(i).includes(id)).length]));
    $('#platform-tabs').innerHTML = renderTabs(platform, counts);
    const items = catalogItems.filter(i => platformsOf(i).includes(platform));
    $('#catalog-grid').innerHTML = items
      .map(item => renderCard({ ...item, status: statusFor(item, stored), reported: Boolean(stored[item.id]?.reported) }, platform))
      .join('');
    const empty = $('#empty-state');
    if (items.length) { hide(empty); return; }
    $('#empty-title').textContent = catalogItems.length ? `Belum ada skill untuk ${PLATFORMS[platform].label}` : 'Belum ada item';
    $('#empty-text').textContent = catalogItems.length ? 'Coba tab platform lain.' : 'Katalog premium belum tersedia.';
    show(empty);
  }

  /** If a Gemini or Claude Skills tab is already open, mark skills that page lists. */
  async function refreshDetection() {
    const detectors = { gemini: typeof detectListed === 'function' && detectListed, claude: typeof detectClaudeListed === 'function' && detectClaudeListed };
    let changed = false;
    for (const [target, detect] of Object.entries(detectors)) {
      if (!detect) continue;
      const stored = await readStatuses(target);
      const skills = catalogItems.filter(i => (i.kind || i.type) !== 'gem' && platformsOf(i).includes(target));
      const nameOf = (i) => stored[i.id]?.name || i.slug;
      const listed = await detect(skills.map(nameOf).filter(Boolean)).catch(() => null);
      if (!listed) continue;
      for (const item of skills) {
        if (listed.includes(nameOf(item)) && (!stored[item.id] || stored[item.id].reported)) {
          await writeStatus(item.id, { name: nameOf(item), version: stored[item.id]?.version || item.version, status: 'detected' }, target);
          changed = true;
        }
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
        showNotice('Plugin ChatGPT terunduh. Upload di chatgpt.com/plugins → Add → Upload plugin archive → Add plugin.', 'good');
      } else if (target === 'claude') {
        const pkg = buildClaudeZip(prepareSkillPackage(await readZip(await blob.arrayBuffer())), item);
        saveBytes(pkg.zip, pkg.fileName);
        showNotice(`ZIP Claude terunduh. Upload di claude.ai → Customize → Skills → + → Upload a skill.${pkg.warnings.length ? ' ' + pkg.warnings.join(' ') : ''}`, pkg.warnings.length ? 'warn' : 'good');
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
        navigate: 'Halaman Gemini Customize → Skills tidak terbuka.',
        busy: 'Tab Gemini masih menampilkan Review skill lain. Selesaikan atau batalkan dulu, lalu coba lagi.',
        create_menu: 'Tombol Create (Buat) di Gemini Skills tidak ditemukan (tampilan Gemini mungkin berubah, atau akun belum mendapat fitur Skills).',
        upload_item: 'Menu Upload (Unggah) di bawah Create tidak muncul.',
        upload_dialog: 'Dialog "Upload keahlian" Gemini tidak terbuka.',
        drop: 'Gemini menolak file yang dikirim.',
        review_timeout: 'Gemini belum menampilkan halaman Review.',
      },
      waitTitle: 'Tinggal satu klik',
      waitHint: 'Review isi skill di tab Gemini, lalu klik "Create" (Buat) di bagian atas. Panel ini mendeteksi otomatis begitu skill muncul.',
      pendingHint: 'Belum terdeteksi. Kalau sudah klik "Create", buka Gemini → Customize → Skills lalu tekan ↻ di katalog.',
      doneTitle: 'Terpasang di Gemini ✓',
      doneHint: (name) => `Pakai di chat Gemini dengan mengetik / lalu pilih "${name}".`,
    },
    chatgpt: {
      eyebrow: 'PASANG KE CHATGPT',
      steps: ['Cek akses Premium', 'Unduh & verifikasi paket', 'Bungkus jadi plugin ChatGPT', 'Buka ChatGPT Plugins', 'Isi form upload ChatGPT', 'Klik Add plugin & Install di ChatGPT'],
      failReasons: {
        navigate: 'Halaman ChatGPT Plugins tidak terbuka.',
        add_button: 'Tombol "Add" di halaman Plugins tidak ditemukan. Pastikan sudah login di chatgpt.com.',
        upload_menu: 'Menu "Upload plugin archive" tidak muncul (akun mungkin belum mendapat fitur upload plugin).',
        upload_dialog: 'Dialog unggah plugin tidak terbuka.',
        import_failed: 'ChatGPT menolak plugin.',
        import_timeout: 'Tombol "Add plugin" ChatGPT belum aktif setelah file dimasukkan.',
      },
      waitTitle: 'Tinggal satu klik',
      waitHint: 'ZIP sudah masuk ke form ChatGPT. Klik "Add plugin" di tab ChatGPT, buka plugin-nya, lalu klik "Install plugin" bila ditawarkan. Panel ini mendeteksi otomatis.',
      importedHint: 'Plugin sudah diimpor. Klik "Install plugin" di tab ChatGPT — panel ini mendeteksi otomatis.',
      pendingHint: 'Belum terdeteksi terpasang. Kalau sudah klik "Add plugin" dan "Install plugin", buka halaman plugin-nya di ChatGPT lalu tekan ↻ di katalog.',
      doneTitle: 'Terpasang di ChatGPT ✓',
      doneHint: (_name, title) => `Pakai di chat ChatGPT dengan mengetik @ lalu pilih "${title}".`,
    },
    // Newer catalog version of a plugin already in ChatGPT: upload over it, never add a duplicate.
    chatgptUpdate: {
      eyebrow: 'UPDATE DI CHATGPT',
      steps: ['Cek akses Premium', 'Unduh & verifikasi paket', 'Bungkus jadi plugin ChatGPT', 'Buka halaman plugin di ChatGPT', 'Upload versi baru', 'Konfirmasi versi di ChatGPT'],
      failReasons: {
        navigate: 'Halaman plugin ChatGPT tidak terbuka.',
        not_found: 'Plugin lama tidak ditemukan di ChatGPT (mungkin sudah dihapus). Tutup panel ini lalu klik "Pasang ke ChatGPT" lagi.',
        more_actions: 'Tombol ⋯ (More actions) di halaman plugin tidak ditemukan. Pastikan sudah login di chatgpt.com.',
        upload_menu: 'Menu "Upload new version" tidak muncul.',
        upload_dialog: 'Dialog "Upload new version" tidak terbuka.',
        import_failed: 'ChatGPT menolak versi baru.',
        import_timeout: 'ChatGPT belum menyelesaikan unggahan versi baru.',
      },
      waitTitle: 'Mengunggah versi baru',
      waitHint: 'ZIP versi baru sudah dimasukkan ke dialog "Upload new version" di tab ChatGPT. Bila ChatGPT meminta konfirmasi, klik di sana. Panel ini mendeteksi otomatis begitu versinya berganti.',
      pendingHint: 'Versi baru belum terlihat. Buka halaman plugin di ChatGPT, cek "Version" di bagian Information, lalu tekan ↻ di katalog.',
      doneTitle: 'Diperbarui di ChatGPT ✓',
      doneHint: (_name, title) => `Versi baru aktif. Pakai di chat ChatGPT dengan mengetik @ lalu pilih "${title}".`,
    },
    claude: {
      eyebrow: 'PASANG KE CLAUDE',
      steps: ['Cek akses Premium', 'Unduh & verifikasi paket', 'Siapkan ZIP Claude', 'Buka Upload skill Claude', 'Isi form upload Claude', 'Klik Upload di tab Claude'],
      failReasons: {
        navigate: 'Halaman "Upload a skill" Claude tidak terbuka.',
        upload_page: 'Form Upload skill tidak muncul. Pastikan sudah login di claude.ai.',
        upload_button: 'Tombol Upload Claude belum aktif setelah file dimasukkan.',
        rejected: 'Claude menolak file. Bila skill dengan nama sama sudah ada, hapus dulu di Customize → Skills → Yours (… → Delete), lalu pasang lagi.',
      },
      waitTitle: 'Tinggal satu klik',
      waitHint: 'ZIP sudah masuk ke form Claude. Klik "Upload" di tab Claude (Claude menjalankan security scan). Panel ini mendeteksi otomatis begitu skill muncul.',
      pendingHint: 'Belum terdeteksi. Kalau sudah klik "Upload", buka claude.ai → Customize → Skills → Yours lalu tekan ↻ di katalog.',
      doneTitle: 'Terpasang di Claude ✓',
      doneHint: () => 'Pastikan toggle skill menyala dan "Code execution" aktif (Settings → Capabilities). Claude memakainya otomatis saat relevan.',
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

  /** `updateOf`: pluginId of the older version already in ChatGPT (upload a new version over it). */
  async function installItem(item, target = 'gemini', { updateOf = null } = {}) {
    if (installing) return;
    installing = true;
    const update = target === 'chatgpt' && updateOf;
    const cfg = update ? TARGETS.chatgptUpdate : TARGETS[target];
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
      let claudePkg = null;
      try {
        if (target === 'chatgpt') ({ skill, plugin } = await chatGptPluginFrom(blob, item));
        else skill = prepareSkillPackage(await readZip(await blob.arrayBuffer()));
        if (target === 'claude') claudePkg = buildClaudeZip(skill, item);
      } catch (err) {
        return fail(2, err.message || 'Paket tidak sesuai format skill.');
      }
      step(2, 'done');

      step(3, 'active');
      let result;
      try {
        result = update ? await assistChatGptUpdate(plugin, updateOf, item.version)
          : target === 'chatgpt' ? await assistChatGptInstall(plugin)
            : target === 'claude' ? await assistClaudeInstall(claudePkg)
              : await assistInstall(skill);
      } catch (err) {
        return fail(3, err.message || 'Halaman tujuan tidak bisa dibuka.');
      }
      const pluginTitle = plugin?.manifest?.extensions?.['com.openai']?.interface?.displayName || item.title;
      if (!result?.ok) {
        // A deleted plugin: forget it so the next click adds it afresh.
        if (update && result?.stage === 'not_found') await writeStatus(item.id, null, 'chatgpt');
        const at = result?.stage === 'navigate' || result?.stage === 'not_found' ? 3 : 4;
        if (at === 4) step(3, 'done');
        const detail = result?.detail ? ` (${result.detail})` : '';
        return fail(at, `${cfg.failReasons[result?.stage] || 'Pengisian otomatis gagal.'}${detail} Gunakan cara manual.`);
      }
      step(3, 'done');
      step(4, 'done');
      if (update && result.stage === 'already') {
        // ChatGPT already has this version (e.g. uploaded by hand): just sync the panel.
        step(5, 'done');
        await writeStatus(item.id, { name: skill.name, version: item.version, status: 'detected', pluginId: updateOf }, target);
        $('#install-title').textContent = cfg.doneTitle;
        setHint(`ChatGPT sudah memakai versi ${item.version}; status di panel disinkronkan. ${cfg.doneHint(skill.name, pluginTitle)}`, 'good');
        renderCatalog();
        return;
      }
      const skippedNote = (result.skipped?.length ? ` File dilewati (tidak didukung ${PLATFORMS[target].label}): ${result.skipped.join(', ')}.` : '')
        + (claudePkg?.warnings?.length ? ` ${claudePkg.warnings.join(' ')}` : '');

      step(5, 'active');
      $('#install-title').textContent = cfg.waitTitle;
      setHint((result.stage === 'imported' && cfg.importedHint || cfg.waitHint) + skippedNote, 'info');
      const installed = update ? (await waitUntilChatGptVersion(result.tabId, updateOf, item.version) && updateOf)
        : target === 'chatgpt' ? await waitUntilChatGptInstalled(result.tabId, result.pluginId || null, { title: pluginTitle })
        : target === 'claude' ? await waitUntilClaudeInstalled(result.tabId, skill.name)
          : await waitUntilListed(result.tabId, skill.name);
      if (!installed) {
        step(5, 'wait');
        $('#install-title').textContent = 'Menunggu konfirmasi';
        setHint(cfg.pendingHint, 'warn');
        return;
      }
      step(5, 'done');
      await writeStatus(item.id, { name: skill.name, version: item.version, status: 'detected', pluginId: target === 'chatgpt' ? installed : null }, target);
      $('#install-title').textContent = cfg.doneTitle;
      setHint(cfg.doneHint(skill.name, pluginTitle), 'good');
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

    if (action === 'install' || action === 'install-chatgpt' || action === 'install-claude') {
      if (!item) return showNotice('Paket tidak tersedia.', 'warn');
      if (!item.file_size || !item.sha256) return showNotice('Paket belum tersedia untuk dipasang.', 'warn');
      if (action === 'install-chatgpt') {
        // Never add a duplicate plugin: same version → open it; newer version →
        // "Upload new version" on the existing plugin's page.
        const known = (await readStatuses('chatgpt'))[item.id];
        if (known?.status === 'detected' && known.pluginId) {
          if (known.version === item.version) {
            chrome.tabs.create({ url: `https://chatgpt.com/plugins/${encodeURIComponent(known.pluginId)}` });
            return showNotice('Plugin sudah terpasang di ChatGPT — membuka halamannya.', 'good');
          }
          return installItem(item, 'chatgpt', { updateOf: known.pluginId });
        }
      }
      installItem(item, { install: 'gemini', 'install-chatgpt': 'chatgpt', 'install-claude': 'claude' }[action]);
    }
    if (action === 'open') {
      if (type === 'gem' && item?.gem_url) {
        chrome.tabs.create({ url: item.gem_url });
        return;
      }
      showTutorial(type, id);
    }
    if (action === 'download') downloadItem(item, btn, btn.dataset.target || 'gemini');
  });

  // ── Tutorial (manual fallback) ────────────────────────────────────────────
  const TUTORIALS = {
    gemini: {
      title: 'Pasang di Gemini', download: 'Download ZIP', open: 'Buka Gemini Skills',
      honesty: 'Gemini menerima file ZIP langsung. Konfirmasi akhir (klik Create/Buat) selalu dilakukan member di Gemini.',
    },
    chatgpt: {
      title: 'Pasang di ChatGPT', download: 'Download ZIP ChatGPT', open: 'Buka ChatGPT Plugins',
      honesty: 'ChatGPT menerima ZIP plugin langsung. Konfirmasi akhir (klik Add plugin dan Install plugin) selalu dilakukan member di ChatGPT.',
    },
    claude: {
      title: 'Pasang di Claude', download: 'Download ZIP Claude', open: 'Buka Claude Skills',
      honesty: 'Claude menerima ZIP berisi folder skill. Konfirmasi akhir (klik Upload, lalu Claude menjalankan security scan) selalu dilakukan member di Claude. Skill butuh "Code execution" aktif.',
    },
  };

  function showTutorial(type, itemId, target = 'gemini') {
    if (type === 'gem' || !TUTORIALS[target]) target = 'gemini';
    const steps = target === 'chatgpt' && typeof getChatGptManualSteps === 'function' ? getChatGptManualSteps()
      : target === 'claude' && typeof getClaudeManualSteps === 'function' ? getClaudeManualSteps()
        : typeof getManualSteps === 'function' ? getManualSteps(type) : ['Buka Gemini, lalu pasang secara manual.'];
    const copy = TUTORIALS[target];
    $('#tutorial-steps').innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join('');
    tutorialSection.dataset.itemId = itemId;
    tutorialSection.dataset.itemType = type;
    tutorialSection.dataset.target = target;
    $('#tutorial-title').textContent = copy.title;
    $('#tutorial-download').textContent = copy.download;
    $('#tutorial-open').textContent = copy.open;
    $('#tutorial-honesty').textContent = copy.honesty;
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
    if (tutorialSection.dataset.target === 'claude' && typeof openClaudeSkillsPage === 'function') return openClaudeSkillsPage();
    if (typeof openGeminiPage === 'function') openGeminiPage(type);
    else chrome.tabs.create({ url: 'https://gemini.google.com/customize/skills' });
  });

  $('#member-confirm').addEventListener('click', async () => {
    // Claude has no page detection yet, so the member's report is what marks it installed
    // (and lets a newer catalog version show "Update tersedia").
    const item = catalogItems.find(p => String(p.id) === String(tutorialSection.dataset.itemId));
    if (item && tutorialSection.dataset.target === 'claude') {
      await writeStatus(item.id, { name: item.slug, version: item.version, status: 'detected', reported: true }, 'claude');
    }
    showNotice('Status dicatat sebagai laporan member. Bukan verifikasi otomatis.', 'info');
    only(catalogSection);
    renderCatalog();
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
