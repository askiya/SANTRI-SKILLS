// sidepanel.js — Side panel controller with working auth, catalog, download
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
  const catalogSection = $('#catalog-section');
  const tutorialSection = $('#tutorial');
  const notice = $('#notice');

  function showNotice(msg, level) {
    notice.textContent = msg;
    notice.style.borderColor = level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--good)';
    show(notice);
    clearTimeout(showNotice._t);
    if (level !== 'error') showNotice._t = setTimeout(() => hide(notice), 8000);
  }

  let currentSession = null;

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
      showNotice(err?.message || 'Login gagal.', 'error');
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
    } catch (error) { showNotice(error.message || 'Gagal memeriksa sesi.', 'error'); }
  })();

  function onAuthenticated(user) {
    hide(loginSection);
    show($('#logout-btn'));
    showNotice(`Selamat datang, ${user?.name || 'Member'}!`, 'good');
    loadCatalog();
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
        hide(catalogSection);
        show(consentSection);
        return;
      }
      hide(consentSection);
      show(catalogSection);
      if (!catalogItems.length) { grid.innerHTML = ''; show(empty); return; }
      hide(empty);
      grid.innerHTML = catalogItems.map(item => renderCard(item)).join('');
    } catch (err) {
      grid.innerHTML = '';
      show(empty);
      showNotice(err.message || 'Gagal memuat katalog.', 'error');
    }
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
      hide(consentSection);
      show(catalogSection);
      loadCatalog();
    } catch (err) {
      showNotice(err.message || 'Gagal menerima persetujuan.', 'error');
    }
  });

  $('#refresh-btn').addEventListener('click', loadCatalog);

  // ── Card actions (event delegation) ───────────────────────────────────────
  $('#catalog-grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const card = btn.closest('.skill-card');
    const type = card?.dataset.type || 'skill';

    if (action === 'open') {
      const item = catalogItems.find(p => String(p.id) === String(id));
      if (type === 'gem' && item?.gem_url) {
        chrome.tabs.create({ url: item.gem_url });
        return;
      }
      showTutorial(type, id);
    }
    if (action === 'download') {
      const item = catalogItems.find(p => String(p.id) === String(id));
      if (!item || !currentSession?.token) {
        showNotice('Sesi atau paket tidak tersedia.', 'warn');
        return;
      }
      if (!item.file_size || !item.sha256) {
        if (item.gem_url) {
          showNotice('Gem ini menggunakan URL langsung, tidak perlu download.', 'info');
        } else {
          showNotice('Paket belum tersedia untuk download.', 'warn');
        }
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Mengunduh…';
      try {
        const blob = await downloadPackage(item, currentSession.token);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${item.slug}-${item.version}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showNotice('Paket berhasil diunduh. Hash dan ukuran terverifikasi.', 'good');
      } catch (err) {
        showNotice(err.message || 'Gagal mengunduh paket.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Download Paket';
      }
    }
  });

  // ── Tutorial ──────────────────────────────────────────────────────────────
  function showTutorial(type, itemId) {
    const steps = typeof getManualSteps === 'function' ? getManualSteps(type) : ['Buka Gemini, lalu pasang secara manual.'];
    const ol = $('#tutorial-steps');
    ol.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
    show(tutorialSection);
    hide(catalogSection);
    tutorialSection.dataset.itemId = itemId;
    tutorialSection.dataset.itemType = type;
  }

  $('#tutorial-close').addEventListener('click', () => {
    hide(tutorialSection);
    show(catalogSection);
  });

  $('#tutorial-open').addEventListener('click', () => {
    const type = tutorialSection.dataset.itemType || 'skill';
    if (typeof openGeminiPage === 'function') openGeminiPage(type);
    else chrome.tabs.create({ url: 'https://gemini.google.com/app' });
  });

  $('#member-confirm').addEventListener('click', () => {
    showNotice('Status dicatat sebagai laporan member. Bukan verifikasi otomatis.', 'info');
    hide(tutorialSection);
    show(catalogSection);
  });

  // ── Logout ────────────────────────────────────────────────────────────────
  $('#logout-btn').addEventListener('click', async () => {
    try { await revokeSession(); } catch { /* best effort */ }
    currentSession = null;
    catalogItems = [];
    hide(catalogSection);
    hide(consentSection);
    hide(tutorialSection);
    hide($('#logout-btn'));
    show(loginSection);
    showNotice('Sesi berakhir.', 'info');
  });
})();
