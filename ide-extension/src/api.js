'use strict';
// Santriverse API client for the code-scoped session (/api/code/*).
// No vscode dependency so it can be unit-tested with a fake fetch.

class ApiError extends Error {
  constructor(message, { status = 0, code = null, data = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function messageFor(status, data) {
  if (data?.code === 'premium_required') return 'Santri Code khusus member Premium Santriverse.';
  if (data?.code === 'FLOW_DAILY_CREDIT_LIMIT') return data.message || 'Kredit AI hari ini sudah habis.';
  if (status === 401) return 'Sesi Santri Code berakhir. Login ulang ke Santriverse.';
  if (status === 429) return 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.';
  const firstError = data?.errors && Object.values(data.errors).flat()[0];
  const message = (typeof firstError === 'string' && firstError) || (typeof data?.message === 'string' && data.message);
  if (message && message !== 'Server Error') return message.slice(0, 300);
  return status >= 500 ? `Server Santriverse sedang bermasalah (${status}). Coba lagi sebentar.` : `Permintaan ditolak server (${status}).`;
}

/** True when the URL is https, or http only for a local development host. */
function isAllowedBaseUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createClient({ baseUrl, getToken, fetchImpl = globalThis.fetch, version = '0' }) {
  if (!isAllowedBaseUrl(baseUrl)) throw new ApiError('Alamat API Santriverse tidak valid (harus https).', { code: 'bad_config' });
  const root = baseUrl.replace(/\/+$/, '');

  async function request(method, path, { body, headers = {}, auth = true, timeoutMs = 20000, signal } = {}) {
    const token = auth ? await getToken() : null;
    if (auth && !token) throw new ApiError('Belum login ke Santriverse.', { status: 401, code: 'signed_out' });
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(root + path, {
        method,
        headers: {
          Accept: 'application/json',
          'X-Santri-Client': `santri-code/${version}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (signal?.aborted) throw Object.assign(new Error('Dibatalkan.'), { name: 'AbortError' });
      throw new ApiError(controller.signal.aborted ? 'Server Santriverse tidak merespons.' : 'Tidak bisa terhubung ke Santriverse. Periksa koneksi internet.', { code: 'network' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) throw new ApiError(messageFor(response.status, data), { status: response.status, code: data?.code ?? null, data });
    return data;
  }

  const enc = encodeURIComponent;
  return {
    request,
    exchange: (ticket, verifier) => request('POST', '/code/session', { auth: false, body: { ticket, code_verifier: verifier } }),
    session: () => request('GET', '/code/session'),
    logout: () => request('DELETE', '/code/session'),
    bootstrap: () => request('GET', '/code/bootstrap'),
    usage: () => request('GET', '/code/usage'),
    chats: () => request('GET', '/code/chats'),
    chat: (id) => request('GET', `/code/chats/${enc(id)}`),
    createChat: (body) => request('POST', '/code/chats', { body }),
    send: (id, key, body) => request('POST', `/code/chats/${enc(id)}/send`, { body, headers: { 'Idempotency-Key': key } }),
    run: (id, key, signal) => request('GET', `/code/chats/${enc(id)}/runs/${enc(key)}`, { signal }),
    cancel: (id, key) => request('POST', `/code/chats/${enc(id)}/runs/${enc(key)}/cancel`, { body: {} }),
  };
}

module.exports = { ApiError, createClient, messageFor, isAllowedBaseUrl };
