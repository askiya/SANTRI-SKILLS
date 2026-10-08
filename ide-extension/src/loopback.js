'use strict';
// One-shot login receiver on 127.0.0.1.
//
// Santriverse redirects the browser to http://127.0.0.1:<port>/auth/callback#ticket=..&state=..
// The fragment never reaches a server, so the callback page posts it to /auth/complete,
// where the ticket is exchanged (with the PKCE verifier) for a code-scoped session.
const http = require('node:http');
const crypto = require('node:crypto');
const { safeEqual } = require('./pkce');

const TICKET_RE = /^[A-Za-z0-9]{64}$/;
const MAX_BODY = 4096;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function callbackPage(nonce, appName, returnUrl) {
  const back = returnUrl ? `<a id="back" class="btn" href="${escapeHtml(returnUrl)}" hidden>Kembali ke ${escapeHtml(appName)}</a>` : '';
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'">
<title>Santri Code</title><style nonce="${nonce}">
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#f4f4f8;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
.card{max-width:420px;margin:24px;padding:32px;border-radius:24px;background:#13131a;border:1px solid #2a2a38;text-align:center;box-shadow:0 30px 90px #0008}
.eyebrow{font-size:11px;letter-spacing:.2em;font-weight:700;color:#a99bff}h1{font-size:22px;margin:10px 0 6px}p{color:#a3a3b5;margin:0 0 18px}
.btn{display:inline-block;padding:11px 20px;border-radius:12px;background:linear-gradient(135deg,#8b6cff,#5b8cff);color:#fff;font-weight:700;text-decoration:none}
.err h1{color:#ff8a8a}
</style></head><body><main class="card" id="card"><span class="eyebrow">SANTRI CODE</span><h1 id="title">Menyelesaikan login…</h1><p id="msg">Jangan tutup halaman ini.</p>${back}</main>
<script nonce="${nonce}">
(function(){
  var p=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',location.pathname);
  function show(ok,title,msg){document.getElementById('title').textContent=title;document.getElementById('msg').textContent=msg;
    if(!ok)document.getElementById('card').className='card err';var b=document.getElementById('back');if(b&&ok)b.hidden=false;}
  fetch('/auth/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:p.get('state'),ticket:p.get('ticket')})})
    .then(function(r){return r.json();})
    .then(function(d){d&&d.ok?show(true,'Berhasil terhubung','Santri Code siap dipakai. Kembali ke editor kamu — tab ini boleh ditutup.'):show(false,'Login gagal',(d&&d.message)||'Ulangi login dari editor.');})
    .catch(function(){show(false,'Login gagal','Editor tidak merespons. Ulangi login dari editor.');});
})();
</script></body></html>`;
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  });
  res.end(body);
}

const json = (res, status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

/**
 * Starts the receiver. `exchange(ticket)` performs the API exchange and returns the session.
 * Resolves `{ port, result, close }`; `result` settles once with the exchange outcome.
 */
function startLoopback({ state, exchange, appName = 'editor', returnUrl = '', timeoutMs = 5 * 60 * 1000 }) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    result.catch(() => {}); // the caller awaits it; never an unhandled rejection
    let finished = false;
    let timer;

    const server = http.createServer((req, res) => {
      const port = server.address().port;
      const origin = `http://127.0.0.1:${port}`;
      // DNS-rebinding guard: only our literal loopback host is served.
      if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 421, 'text/plain', 'Misdirected');
      const { pathname } = new URL(req.url, origin);

      if (req.method === 'GET' && pathname === '/auth/callback') {
        return send(res, 200, 'text/html; charset=utf-8', callbackPage(crypto.randomBytes(16).toString('base64'), appName, returnUrl));
      }
      if (req.method !== 'POST' || pathname !== '/auth/complete') return send(res, 404, 'text/plain', 'Not found');
      if (req.headers.origin !== origin) return json(res, 403, { ok: false, message: 'Asal permintaan tidak sah.' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { ok: false, message: 'Format tidak didukung.' });

      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(chunk);
      });
      req.on('end', async () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
        if (finished) return json(res, 409, { ok: false, message: 'Login ini sudah diproses. Ulangi dari editor bila perlu.' });
        if (!body || !safeEqual(body.state, state) || !TICKET_RE.test(String(body.ticket || ''))) {
          return json(res, 400, { ok: false, message: 'Permintaan login tidak cocok. Ulangi login dari editor.' });
        }
        finished = true;
        clearTimeout(timer);
        try {
          const session = await exchange(body.ticket);
          json(res, 200, { ok: true });
          settle.resolve(session);
        } catch (error) {
          json(res, 200, { ok: false, message: error?.message || 'Login gagal.' });
          settle.reject(error);
        } finally {
          setTimeout(() => server.close(), 250).unref?.();
        }
      });
    });

    server.on('error', rejectStart);
    server.listen(0, '127.0.0.1', () => {
      timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        server.close();
        settle.reject(Object.assign(new Error('Login kedaluwarsa. Ulangi dari editor.'), { code: 'login_timeout' }));
      }, timeoutMs);
      timer.unref?.();
      resolveStart({
        port: server.address().port,
        result,
        close() {
          if (!finished) {
            finished = true;
            clearTimeout(timer);
            settle.reject(Object.assign(new Error('Login dibatalkan.'), { code: 'login_cancelled' }));
          }
          server.close();
        },
      });
    });
  });
}

module.exports = { startLoopback, TICKET_RE };
