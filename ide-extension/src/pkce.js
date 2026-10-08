'use strict';
// PKCE S256 + state for the Santriverse /skills/connect handoff (client=code).
const crypto = require('node:crypto');

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce() {
  const verifier = base64url(crypto.randomBytes(32)); // 43 chars
  return {
    verifier,
    challenge: base64url(crypto.createHash('sha256').update(verifier).digest()),
    state: crypto.randomBytes(32).toString('hex'), // 64 hex, as /skills/connect requires
  };
}

/** Browser URL that asks the member to approve Santri Code on santriverse.my.id. */
function connectUrl(siteUrl, { port, state, challenge }) {
  const url = new URL('/skills/connect', siteUrl);
  url.searchParams.set('callback', `http://127.0.0.1:${port}/auth/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('client', 'code');
  return url.toString();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { createPkce, connectUrl, safeEqual };
