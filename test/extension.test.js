// test/extension.test.js – scoped unit tests for the Chrome MV3 extension
// Run: node --test test/extension.test.js
'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { webcrypto } = crypto;

const EXT = path.join(__dirname, '..', 'extension');

// ── Manifest ────────────────────────────────────────────────────────────────
describe('manifest.json', () => {
  let manifest;
  before(() => { manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')); });

  it('is MV3', () => assert.equal(manifest.manifest_version, 3));
  it('declares sidePanel permission', () => assert.ok(manifest.permissions.includes('sidePanel')));
  it('declares storage permission', () => assert.ok(manifest.permissions.includes('storage')));
  it('has service_worker background', () => assert.ok(manifest.background.service_worker));
  it('has side_panel default_path', () => assert.ok(manifest.side_panel.default_path));
  it('content_scripts targets gemini.google.com', () => {
    assert.ok(manifest.content_scripts.some(cs => cs.matches.some(m => m.includes('gemini.google.com'))));
  });
  it('host_permissions include santriverse API', () => {
    assert.ok(manifest.host_permissions.some(h => h.includes('api.santriverse.my.id')));
  });
  it('does not request cookies permission', () => {
    assert.ok(!manifest.permissions.includes('cookies'));
  });
});

// ── Auth module ─────────────────────────────────────────────────────────────
describe('auth.js (extension)', () => {
  // We test the pure functions by loading the module in a mock chrome env
  let auth;
  const mockStorage = {};
  const mockChrome = {
    storage: {
      session: {
        get: (keys) => Promise.resolve(
          Array.isArray(keys)
            ? Object.fromEntries(keys.map(k => [k, mockStorage[k]]))
            : typeof keys === 'string'
              ? { [keys]: mockStorage[keys] }
              : { ...mockStorage }
        ),
        set: (obj) => { Object.assign(mockStorage, obj); return Promise.resolve(); },
        remove: (keys) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete mockStorage[k]); return Promise.resolve(); },
      },
    },
    identity: {
      getRedirectURL: () => 'https://fake-ext-id.chromiumapp.org/',
      launchWebAuthFlow: () => Promise.resolve('https://fake-ext-id.chromiumapp.org/?state=abc&ticket=fake-ticket-12345678'),
    },
    runtime: { lastError: null, id: 'fake-ext-id' },
  };

  before(() => {
    // Load auth module in isolation with mock chrome global
    const code = fs.readFileSync(path.join(EXT, 'auth.js'), 'utf8');
    const module = { exports: {} };
    const fn = new Function('chrome', 'crypto', 'module', 'exports', code);
    fn(mockChrome, webcrypto, module, module.exports);
    auth = module.exports;
  });

  it('exports API_BASE and WEBSITE_BASE constants', () => {
    assert.equal(auth.API_BASE, 'https://api.santriverse.my.id/api');
    assert.equal(auth.WEBSITE_BASE, 'https://santriverse.my.id');
  });

  it('buildLoginURL returns URL with PKCE params', async () => {
    const { url, state, verifier } = await auth.buildLoginURL('https://fake-ext-id.chromiumapp.org/');
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/skills/connect');
    assert.ok(parsed.searchParams.has('state'));
    assert.ok(parsed.searchParams.has('code_challenge'));
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(parsed.searchParams.get('callback'), 'https://fake-ext-id.chromiumapp.org/');
    assert.equal(typeof state, 'string');
    assert.ok(state.length >= 32);
    assert.equal(typeof verifier, 'string');
    assert.ok(verifier.length >= 32);
  });

  it('code_challenge matches S256 of verifier', async () => {
    const { url, verifier } = await auth.buildLoginURL('https://fake-ext-id.chromiumapp.org/');
    const parsed = new URL(url);
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(parsed.searchParams.get('code_challenge'), expected);
  });

  it('isPremium checks multiple field shapes', () => {
    assert.ok(auth.isPremium({ is_premium: true }));
    assert.ok(auth.isPremium({ premium: true }));
    assert.ok(auth.isPremium({ isPremium: true }));
    assert.ok(!auth.isPremium({ is_premium: false }));
    assert.ok(!auth.isPremium(null));
    assert.ok(!auth.isPremium({}));
  });

  it('publicUser sanitizes and picks name', () => {
    const u = auth.publicUser({ name: 'Test', email: 'test@example.com', is_premium: true, secret: 'xyz' });
    assert.equal(u.name, 'Test');
    assert.equal(u.email, 'test@example.com');
    assert.equal(u.premium, true);
    assert.equal(u.secret, undefined);
  });

  it('publicUser defaults name to Member', () => {
    assert.equal(auth.publicUser({}).name, 'Member');
  });

  it('publicUser rejects oversized name/email', () => {
    const long = 'a'.repeat(300);
    const u = auth.publicUser({ name: long, email: long });
    assert.equal(u.name, 'Member');
    assert.equal(u.email, '');
  });
});

// ── Consent module ──────────────────────────────────────────────────────────
describe('consent.js (extension)', () => {
  let consent;
  const store = {};
  const mockChrome = {
    storage: {
      local: {
        get: (keys) => Promise.resolve(
          Array.isArray(keys)
            ? Object.fromEntries(keys.map(k => [k, store[k]]))
            : typeof keys === 'string'
              ? { [keys]: store[keys] }
              : { ...store }
        ),
        set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      },
    },
  };

  before(() => {
    const code = fs.readFileSync(path.join(EXT, 'consent.js'), 'utf8');
    const module = { exports: {} };
    const fn = new Function('chrome', 'module', 'exports', code);
    fn(mockChrome, module, module.exports);
    consent = module.exports;
  });

  it('defaults to unknown, never local acceptance', () => assert.equal(consent.getConsent(), null));
  it('uses server version and required state', () => {
    consent.setConsent({version:'2026-10-07',required:true});
    assert.equal(consent.getConsent().required,true);
    consent.setConsent({version:'2026-10-07',required:false});
    assert.equal(consent.getConsent().required,false);
    assert.deepEqual(store,{});
  });
});

// ── Catalog module ──────────────────────────────────────────────────────────
describe('catalog.js (extension)', () => {
  let catalog;
  const mockItems = [
    { id: 'skill-a', name: 'Skill A', description: 'Desc A', version: '1.0.0', type: 'skill' },
    { id: 'gem-b', name: 'Gem B', description: 'Desc B', version: '1.0.0', type: 'gem' },
  ];

  before(() => {
    const code = fs.readFileSync(path.join(EXT, 'catalog.js'), 'utf8');
    const module = { exports: {} };
    const fn = new Function('module', 'exports', code);
    fn(module, module.exports);
    catalog = module.exports;
  });

  it('renderCard returns HTML with name and description', () => {
    const html = catalog.renderCard(mockItems[0]);
    assert.ok(html.includes('Skill A'));
    assert.ok(html.includes('Desc A'));
  });

  it('renderCard uses Buka Gem for gem type', () => {
    const html = catalog.renderCard(mockItems[1]);
    assert.ok(html.includes('Buka Gem'));
  });

  it('renderCard offers one-click install for skill type', () => {
    const html = catalog.renderCard(mockItems[0]);
    assert.ok(html.includes('Pasang ke Gemini'));
    assert.ok(html.includes('data-action="install"'));
    assert.ok(html.includes('Download ZIP'));
  });

  it('renderCard reflects Gemini detection and updates', () => {
    assert.ok(catalog.renderCard({ ...mockItems[0], status: 'detected' }).includes('Pasang ulang'));
    assert.ok(catalog.renderCard({ ...mockItems[0], status: 'update_available' }).includes('Update di Gemini'));
  });

  it('statusLabel returns correct labels', () => {
    assert.equal(catalog.statusLabel('not_installed'), 'Belum dipasang');
    assert.equal(catalog.statusLabel('ready'), 'Paket siap');
    assert.equal(catalog.statusLabel('pending_confirm'), 'Menunggu konfirmasi');
    assert.equal(catalog.statusLabel('confirmed'), 'Dikonfirmasi member');
    assert.equal(catalog.statusLabel('detected'), 'Terdeteksi di Gemini');
    assert.equal(catalog.statusLabel('update_available'), 'Update tersedia');
    assert.equal(catalog.statusLabel('adapter_failed'), 'Gagal otomatis');
  });
});

// ── Gemini adapter ──────────────────────────────────────────────────────────
describe('gemini-adapter.js (extension)', () => {
  let adapter;

  before(() => {
    const code = fs.readFileSync(path.join(EXT, 'gemini-adapter.js'), 'utf8');
    const module = { exports: {} };
    const mockChrome = {
      tabs: {
        create: (opts) => Promise.resolve({ id: 1, url: opts.url }),
        query: () => Promise.resolve([]),
      },
    };
    const fn = new Function('chrome', 'module', 'exports', code);
    fn(mockChrome, module, module.exports);
    adapter = module.exports;
  });

  it('GEMINI_SKILLS_URL points to gemini.google.com', () => {
    assert.ok(adapter.GEMINI_SKILLS_URL.startsWith('https://gemini.google.com'));
  });

  it('GEMINI_GEMS_URL points to gemini.google.com/gems', () => {
    assert.ok(adapter.GEMINI_GEMS_URL.includes('/gems'));
  });

  it('getManualSteps returns non-empty array of strings', () => {
    const steps = adapter.getManualSteps('skill');
    assert.ok(Array.isArray(steps));
    assert.ok(steps.length >= 3);
    steps.forEach(s => assert.equal(typeof s, 'string'));
  });

  it('getManualSteps for gem returns different steps', () => {
    const skillSteps = adapter.getManualSteps('skill');
    const gemSteps = adapter.getManualSteps('gem');
    assert.notDeepEqual(skillSteps, gemSteps);
  });
});

// ── Content script ──────────────────────────────────────────────────────────
describe('content.js (extension)', () => {
  it('exists as a file', () => {
    assert.ok(fs.existsSync(path.join(EXT, 'content.js')));
  });

  it('does not assert installation from DOM', () => {
    const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
    // Must not claim skill is installed by reading DOM
    assert.ok(!code.includes('installed'));
    assert.ok(!code.includes('Installation complete'));
    assert.ok(!code.includes('berhasil dipasang'));
  });

  it('does not claim automatic file upload', () => {
    const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
    assert.ok(!code.includes('upload'));
    assert.ok(!code.includes('file.click'));
    assert.ok(!code.includes('input[type="file"]'));
  });

  it('uses message passing not direct DOM manipulation', () => {
    const code = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
    assert.ok(code.includes('chrome.runtime'));
  });
});

// ── Side panel HTML ─────────────────────────────────────────────────────────
describe('sidepanel.html', () => {
  let html;
  before(() => { html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8'); });

  it('references sidepanel.css', () => assert.ok(html.includes('sidepanel.css')));
  it('references sidepanel.js', () => assert.ok(html.includes('sidepanel.js')));
  it('has login section', () => assert.ok(html.includes('id="login-section"')));
  it('has catalog section', () => assert.ok(html.includes('id="catalog-section"')));
  it('has consent section', () => assert.ok(html.includes('id="consent-section"')));
  it('has theme toggle', () => assert.ok(html.includes('theme')));
});

// ── Side panel CSS ──────────────────────────────────────────────────────────
describe('sidepanel.css', () => {
  let css;
  before(() => { css = fs.readFileSync(path.join(EXT, 'sidepanel.css'), 'utf8'); });

  it('has dark theme variables', () => assert.ok(css.includes('[data-theme="dark"]') || css.includes(':root')));
  it('has light theme variables', () => assert.ok(css.includes('[data-theme="light"]')));
});

// ── Background script ───────────────────────────────────────────────────────
describe('background.js', () => {
  let code;
  before(() => { code = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'); });

  it('opens side panel on action click', () => {
    assert.ok(code.includes('action.onClicked') || code.includes('sidePanel'));
  });

  it('listens for messages', () => {
    assert.ok(code.includes('onMessage'));
  });
});

// ── README ──────────────────────────────────────────────────────────────────
describe('extension/README.md', () => {
  let readme;
  before(() => { readme = fs.readFileSync(path.join(EXT, 'README.md'), 'utf8'); });

  it('mentions chrome://extensions', () => assert.ok(readme.includes('chrome://extensions')));
  it('mentions Load unpacked', () => assert.ok(readme.toLowerCase().includes('load unpacked')));
  it('mentions Developer mode', () => assert.ok(readme.toLowerCase().includes('developer mode')));
});
