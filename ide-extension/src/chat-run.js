'use strict';
// Sends one chat message and follows its server-side run until it finishes.
// Mirrors the website's chatRunPolling: a paid request is POSTed once (Idempotency-Key),
// afterwards only its status is read; transient faults keep polling, never re-send.
const { ApiError } = require('./api');

const TRANSIENT_CODES = new Set(['CHAT_AI_UNREACHABLE', 'CHAT_AI_UNAVAILABLE', 'CHAT_AI_RATE_LIMITED']);
const MAX_WAIT_MS = 3 * 60 * 60 * 1000;
const STREAMING_DELAY = 600;
const RETRY_DELAY = 1500;

const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('Dibatalkan.'), { name: 'AbortError' }));
  }, { once: true });
});

const isStreaming = (data) => !!data?.document_draft?.sections?.some((s) => s.status === 'writing' && s.content);
const isWaitingRetry = (data) => data?.run?.stage === 'retrying';
/** A failed run the backend will redispatch by itself (transient code + persisted next attempt). */
const isRetryingFailure = (data) => TRANSIENT_CODES.has(data?.code) && typeof data?.run?.retry_after === 'string' && data.run.retry_after.trim() !== '';

/** Human status line for the progress card. */
function progressLabel(data) {
  const run = data?.run || {};
  if (run.stage === 'retrying' || isRetryingFailure(data)) {
    return `Provider AI sibuk, mencoba lagi${run.retry_max ? ` (${Math.max(1, run.retry_attempt || 1)}/${run.retry_max})` : ''}…`;
  }
  if (run.status === 'queued') return 'Mengantre…';
  if (run.stage === 'planning') return 'Menyusun kerangka dokumen…';
  if (run.stage === 'writing') {
    const total = run.sections_total || 0;
    const title = run.current_section_title ? `“${run.current_section_title}”` : 'bagian berikutnya';
    return total ? `Menulis ${title} (${Math.min(run.sections_completed + 1, total)}/${total})…` : `Menulis ${title}…`;
  }
  if (run.stage === 'assembling') return 'Merapikan dokumen…';
  return 'Santri sedang berpikir…';
}

async function followRun({ client, chatId, key, body, accepted = false, onUpdate = () => {}, signal, sleep = defaultSleep, now = Date.now }) {
  let data = accepted ? await client.run(chatId, key, signal) : await client.send(chatId, key, body);
  let delay = 1000;
  const deadline = now() + MAX_WAIT_MS;
  for (;;) {
    onUpdate(data);
    const status = data?.run?.status;
    if (status === 'completed') return data;
    if ((status === 'failed' || status === 'cancelled') && !isRetryingFailure(data)) {
      throw new ApiError(data?.message || (status === 'cancelled' ? 'Permintaan dibatalkan.' : 'AI gagal menjawab. Kredit dikembalikan.'), {
        status: 200, code: data?.code || (status === 'cancelled' ? 'CHAT_RUN_CANCELLED' : 'CHAT_AI_PROVIDER_FAILED'), data,
      });
    }
    if (now() > deadline) throw new ApiError('Jawaban terlalu lama. Buka lagi chat ini nanti untuk melihat hasilnya.', { code: 'poll_timeout' });

    let wait = delay;
    if (isStreaming(data)) wait = STREAMING_DELAY;
    else if (isWaitingRetry(data) || isRetryingFailure(data)) wait = RETRY_DELAY;
    else delay = Math.min(delay * 2, 5000);
    await sleep(wait, signal);
    try {
      data = await client.run(chatId, key, signal);
    } catch (error) {
      // Network blips and 5xx are pauses: the paid run continues server-side.
      if (error?.name === 'AbortError') throw error;
      if (!(error instanceof ApiError) || !(error.status === 0 || error.status >= 500)) throw error;
    }
  }
}

module.exports = { followRun, progressLabel, isRetryingFailure };
