'use strict';

// Remote-verified premium session. The token lives ONLY in this process' memory:
// never written to disk, never serialised to the browser. Restart = login again.

const crypto = require('node:crypto');

const DEFAULT_API = 'https://api.santriverse.my.id/api';
const DEFAULT_WEBSITE = 'https://santriverse.my.id';
const PENDING_TTL_MS = 5 * 60 * 1000;
const REMOTE_TIMEOUT_MS = Number(process.env.SANTRI_SKILLS_TIMEOUT_MS) || 20000;
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// HTTPS everywhere; plain http only for an explicit loopback development server.
function safeBase(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AuthError(500, `${label} bukan URL valid`);
  }
  if (url.username || url.password || url.search || url.hash) throw new AuthError(500, `${label} tidak boleh berisi kredensial/query/fragment`);
  const loopback = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !loopback) throw new AuthError(500, `${label} harus HTTPS (http hanya untuk loopback development)`);
  return url.href.replace(/\/+$/, '');
}

const b64url = (buf) => buf.toString('base64url');
const challengeOf = (verifier) => b64url(crypto.createHash('sha256').update(verifier).digest());

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Error text is derived from status only: a remote body could echo a token.
function remoteMessage(status) {
  if (status === 401) return 'Sesi Santriverse tidak valid. Login ulang.';
  if (status === 403) return 'Akun ini belum premium.';
  if (status === 429) return 'Terlalu banyak permintaan ke server Santriverse. Coba lagi nanti.';
  return `Server Santriverse menolak permintaan (HTTP ${status}).`;
}

async function callRemote(base, pathname, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${base}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
  } catch {
    throw new AuthError(502, 'Tidak bisa menghubungi server Santriverse. Periksa koneksi.');
  }
  if (!res.ok) throw new AuthError(res.status === 403 ? 403 : res.status === 401 ? 401 : 502, remoteMessage(res.status));
  let data;
  try {
    data = await res.json();
  } catch {
    throw new AuthError(502, 'Respons server Santriverse bukan JSON.');
  }
  if (!data || typeof data !== 'object' || data.success !== true) throw new AuthError(502, 'Server Santriverse menolak permintaan.');
  return data;
}

const isPremium = (user) => Boolean(user && (user.is_premium === true || user.premium === true || user.isPremium === true));

function publicUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  const pick = (v) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  return { name: pick(u.name) || pick(u.username) || 'Member', email: pick(u.email) || '', premium: isPremium(u) };
}

function createSession({ apiUrl = process.env.SANTRI_SKILLS_API_URL || DEFAULT_API, websiteUrl = process.env.SANTRI_SKILLS_WEBSITE_URL || DEFAULT_WEBSITE } = {}) {
  const api = safeBase(apiUrl, 'SANTRI_SKILLS_API_URL');
  const website = safeBase(websiteUrl, 'SANTRI_SKILLS_WEBSITE_URL');
  let pending = null; // one pending login at a time
  let token = null;
  let user = null;

  return {
    api,
    website,
    signedIn: () => Boolean(token),

    // Fresh state + verifier per click; the previous pending login is discarded.
    startLogin(callbackUrl) {
      const state = crypto.randomBytes(32).toString('hex');
      const verifier = b64url(crypto.randomBytes(32));
      pending = { state, verifier, expires: Date.now() + PENDING_TTL_MS };
      const url = new URL(`${website}/skills/connect`);
      url.searchParams.set('callback', callbackUrl);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challengeOf(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      return { url: url.href, expiresIn: Math.floor(PENDING_TTL_MS / 1000) };
    },

    // Single-use: pending is cleared before the exchange, so a replayed callback
    // (or a mismatched state) can never reach the remote a second time.
    async completeLogin({ state, ticket } = {}) {
      const attempt = pending;
      pending = null;
      if (!attempt || attempt.expires <= Date.now()) throw new AuthError(400, 'Login kedaluwarsa atau tidak diminta. Klik login lagi.');
      if (typeof state !== 'string' || state.length !== attempt.state.length || !sameSecret(state, attempt.state)) throw new AuthError(400, 'State login tidak cocok. Login dibatalkan.');
      if (typeof ticket !== 'string' || ticket.length < 8 || ticket.length > 512 || !/^[\w.~-]+$/.test(ticket)) throw new AuthError(400, 'Ticket login tidak valid.');
      const data = await callRemote(api, '/skills/session', { method: 'POST', body: { ticket, code_verifier: attempt.verifier } });
      if (typeof data.token !== 'string' || !data.token) throw new AuthError(502, 'Server tidak mengembalikan token sesi.');
      if (!isPremium(data.user)) throw new AuthError(403, 'Akun ini belum premium.');
      token = data.token;
      user = publicUser(data.user);
      return user;
    },

    // Fail-closed gate: every protected call re-verifies with the remote.
    async requirePremium() {
      if (!token) throw new AuthError(401, 'Belum login.');
      let data;
      try {
        data = await callRemote(api, '/skills/session', { token });
      } catch (error) {
        if (error.status === 401) {
          token = null;
          user = null;
        }
        throw error;
      }
      user = publicUser(data.user);
      if (!user.premium) throw new AuthError(403, 'Akun ini belum premium.');
      return user;
    },

    async catalog() {
      if (!token) throw new AuthError(401, 'Belum login.');
      const data = await callRemote(api, '/skills/catalog', { token });
      return require('./registry').validateRegistry(data);
    },

    async logout() {
      const current = token;
      token = null;
      user = null;
      pending = null;
      if (!current) return;
      try {
        await callRemote(api, '/skills/session', { method: 'DELETE', token: current });
      } catch {
        /* local session is already gone; remote revocation is best effort */
      }
    },
  };
}

module.exports = { createSession, AuthError, safeBase, challengeOf, publicUser, DEFAULT_API, DEFAULT_WEBSITE, PENDING_TTL_MS };
