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
  // What Gemini listed after the last assisted install: { [packageId]: { name, version, status } }.
  async function readStatuses() {
    try { return (await chrome.storage.local.get('install_status')).install_status || {}; } catch { return {}; }
  }
  async function writeStatus(id, value) {
    const all = await readStatuses();
    all[id] = value;
    await chrome.storage.local.set({ install_status: all });
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
    const stored = await readStatuses();
    $('#catalog-grid').innerHTML = catalogItems.map(item => renderCard({ ...item, status: statusFor(item, stored) })).join('');
  }

  /** If a Gemini Skills tab is already open, mark skills Gemini lists there. */
  async function refreshDetection() {
    if (typeof detectListed !== 'function') return;
    const stored = await readStatuses();
    const skills = catalogItems.filter(i => (i.kind || i.type) !== 'gem');
    const nameOf = (i) => stored[i.id]?.name || i.slug;
    const listed = await detectListed(skills.map(nameOf).filter(Boolean)).catch(() => null);
    if (!listed) return;
    let changed = false;
    for (const item of skills) {
      if (listed.includes(nameOf(item)) && !stored[item.id]) {
        await writeStatus(item.id, { name: nameOf(item), version: item.version, status: 'detected' });
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

  // ── Download (manual fallback) ─────────────────────────────────────────────
  async function downloadItem(item, btn) {
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${item.slug}-${item.version}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showNotice('ZIP terunduh dan terverifikasi. Upload langsung ke Gemini, tidak perlu diekstrak.', 'good');
    } catch (err) {
      handleAuthError(err, 'Gagal mengunduh paket.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }

  // ── Assisted install ───────────────────────────────────────────────────────
  const STEPS = [
    'Cek akses Premium',
    'Unduh & verifikasi paket',
    'Siapkan file skill',
    'Buka Gemini Skills',
    'Isi form upload Gemini',
    'Klik Buat di tab Gemini',
  ];
  const FAIL_REASONS = {
    navigate: 'Halaman Gemini Skills tidak terbuka.',
    upload_button: 'Tombol Upload Gemini tidak ditemukan (tampilan Gemini mungkin berubah, atau akun belum mendapat fitur Skills).',
    upload_dialog: 'Dialog upload Gemini tidak terbuka.',
    drop: 'Gemini menolak file yang dikirim.',
    review_timeout: 'Gemini belum menampilkan halaman Review.',
  };
  let installing = false;

  function renderSteps(states) {
    const icon = { done: '✓', active: '•', fail: '!', wait: '' };
    $('#install-steps').innerHTML = STEPS.map((label, i) => {
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

  async function installItem(item) {
    if (installing) return;
    installing = true;
    const states = [];
    const step = (i, state) => { states[i] = state; renderSteps(states); };
    const fail = (i, message) => {
      step(i, 'fail');
      $('#install-title').textContent = 'Belum berhasil otomatis';
      setHint(message, 'error');
      show($('#install-manual'));
    };
    installSection.dataset.itemId = item.id;
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
      try { skill = prepareSkillPackage(await readZip(await blob.arrayBuffer())); } catch (err) {
        return fail(2, err.message || 'Paket tidak sesuai format Gemini Skills.');
      }
      step(2, 'done');

      step(3, 'active');
      let result;
      try { result = await assistInstall(skill); } catch (err) {
        return fail(3, err.message || 'Gemini tidak bisa dibuka.');
      }
      if (!result?.ok) {
        const at = result?.stage === 'navigate' ? 3 : 4;
        if (at === 4) step(3, 'done');
        return fail(at, `${FAIL_REASONS[result?.stage] || 'Pengisian otomatis gagal.'} Gunakan cara manual: upload ZIP langsung.`);
      }
      step(3, 'done');
      step(4, 'done');

      step(5, 'active');
      $('#install-title').textContent = 'Tinggal satu klik';
      setHint('Review isi skill di tab Gemini, lalu klik "Buat". Panel ini mendeteksi otomatis begitu skill muncul.', 'info');
      const listed = await waitUntilListed(result.tabId, skill.name);
      if (!listed) {
        step(5, 'wait');
        $('#install-title').textContent = 'Menunggu konfirmasi';
        setHint('Belum terdeteksi. Kalau sudah klik "Buat", buka gemini.google.com/skills lalu tekan ↻ di katalog.', 'warn');
        return;
      }
      step(5, 'done');
      await writeStatus(item.id, { name: skill.name, version: item.version, status: 'detected' });
      $('#install-title').textContent = 'Terpasang di Gemini ✓';
      setHint(`Pakai di chat Gemini dengan mengetik / lalu pilih "${skill.name}".`, 'good');
      renderCatalog();
    } finally {
      installing = false;
    }
  }

  $('#install-close').addEventListener('click', () => { only(catalogSection); renderCatalog(); });
  $('#install-manual').addEventListener('click', () => showTutorial('skill', installSection.dataset.itemId));

  // ── Card actions (event delegation) ───────────────────────────────────────
  $('#catalog-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const card = btn.closest('.skill-card');
    const type = card?.dataset.type || 'skill';
    const item = catalogItems.find(p => String(p.id) === String(id));

    if (action === 'install') {
      if (!item) return showNotice('Paket tidak tersedia.', 'warn');
      if (!item.file_size || !item.sha256) return showNotice('Paket belum tersedia untuk dipasang.', 'warn');
      installItem(item);
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
  function showTutorial(type, itemId) {
    const steps = typeof getManualSteps === 'function' ? getManualSteps(type) : ['Buka Gemini, lalu pasang secara manual.'];
    $('#tutorial-steps').innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join('');
    tutorialSection.dataset.itemId = itemId;
    tutorialSection.dataset.itemType = type;
    type === 'gem' ? hide($('#tutorial-download')) : show($('#tutorial-download'));
    only(tutorialSection);
  }

  $('#tutorial-close').addEventListener('click', () => only(catalogSection));
  $('#tutorial-download').addEventListener('click', (e) => {
    const item = catalogItems.find(p => String(p.id) === String(tutorialSection.dataset.itemId));
    downloadItem(item, e.currentTarget);
  });
  $('#tutorial-open').addEventListener('click', () => {
    const type = tutorialSection.dataset.itemType || 'skill';
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
