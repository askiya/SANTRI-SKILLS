// PKCE authentication and scoped Skills API client.
'use strict';
const API_BASE = 'https://api.santriverse.my.id/api';
const WEBSITE_BASE = 'https://santriverse.my.id';
const REMOTE_TIMEOUT_MS = 20000;

const b64url = (buf) => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const hex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const isChromeCallback = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.href === `https://${chrome.runtime.id}.chromiumapp.org/`;
  } catch { return false; }
};

async function buildLoginURL(callbackUrl) {
  if (!isChromeCallback(callbackUrl)) throw new Error('Callback Chrome tidak valid.');
  const state = hex(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const url = new URL(`${WEBSITE_BASE}/skills/connect`);
  url.searchParams.set('callback', callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', b64url(digest));
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.href, state, verifier };
}

const isPremium = (user) => Boolean(user && (user.is_premium === true || user.premium === true || user.isPremium === true));
function publicUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  const pick = (v) => (typeof v === 'string' && v.length <= 200 ? v : undefined);
  return { name: pick(u.name) || pick(u.username) || 'Member', email: pick(u.email) || '', premium: isPremium(u) };
}
async function saveSession(token, user, expiresAt) {
  const payload = { auth_token: token, auth_user: publicUser(user) };
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) payload.auth_expires = expiresAt;
  await chrome.storage.session.set(payload);
}
async function getSession() {
  const data = await chrome.storage.session.get(['auth_token', 'auth_user', 'auth_expires']);
  if (!data.auth_token) return null;
  if (Number.isFinite(data.auth_expires) && data.auth_expires <= Date.now()) {
    await clearSession();
    return null;
  }
  return { token: data.auth_token, user: data.auth_user };
}
async function clearSession() {
  await chrome.storage.session.remove(['auth_token', 'auth_user', 'auth_expires']);
}
async function callAPI(pathname, { method = 'GET', token, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${API_BASE}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'Sesi tidak valid.' : res.status === 403 ? 'Akses ditolak server.' : `Server error (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (!data || data.success !== true) throw new Error('Server menolak permintaan.');
  return data;
}
async function login() {
  const callback = chrome.identity.getRedirectURL();
  const pending = await buildLoginURL(callback);
  const result = await chrome.identity.launchWebAuthFlow({ url: pending.url, interactive: true });
  if (!result || !isChromeCallback(result.split(/[?#]/)[0])) throw new Error('Callback login tidak valid.');
  const returned = new URL(result);
  const params = new URLSearchParams(returned.hash.slice(1));
  if (params.get('state') !== pending.state) throw new Error('State login tidak cocok.');
  const ticket = params.get('ticket') || '';
  if (!/^[A-Za-z0-9]{64}$/.test(ticket)) throw new Error('Ticket login tidak valid.');
  const data = await callAPI('/skills/session', { method: 'POST', body: { ticket, code_verifier: pending.verifier } });
  await saveSession(data.token, data.user, data.expires_at ? Date.parse(data.expires_at) : undefined);
  return publicUser(data.user);
}
async function restoreSession() {
  const session = await getSession();
  if (!session) return null;
  try {
    const data = await callAPI('/skills/session', { token: session.token });
    await saveSession(session.token, data.user, data.expires_at ? Date.parse(data.expires_at) : undefined);
    return publicUser(data.user);
  } catch (error) {
    if (error.status === 401 || error.status === 403) await clearSession();
    throw error;
  }
}
async function revokeSession() {
  const session = await getSession();
  try { if (session) await callAPI('/skills/session', { method: 'DELETE', token: session.token }); }
  finally { await clearSession(); }
}
async function downloadPackage(pkg, token) {
  const res = await fetch(`${API_BASE}/skills/packages/${encodeURIComponent(pkg.id)}/download`, { headers: { authorization: `Bearer ${token}`, accept: 'application/zip' }, redirect: 'error', signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS) });
  if (!res.ok) { const error = new Error(`Download gagal (${res.status}).`); error.status = res.status; throw error; }
  const bytes = await res.arrayBuffer();
  if (!Number.isSafeInteger(pkg.file_size) || pkg.file_size < 1 || bytes.byteLength !== pkg.file_size || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Ukuran paket tidak cocok.');
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
  if (!/^[0-9a-f]{64}$/.test(pkg.sha256) || digest !== pkg.sha256.toLowerCase()) throw new Error('Hash paket tidak cocok.');
  return new Blob([bytes], { type: 'application/zip' });
}

globalThis.skillsAuth = { login };
if (typeof module !== 'undefined') module.exports = { API_BASE, WEBSITE_BASE, buildLoginURL, isPremium, publicUser, saveSession, getSession, clearSession, callAPI, login, restoreSession, revokeSession, downloadPackage };
