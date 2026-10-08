'use strict';
// Port of the website's chatProgress.ts + ChatStudio's ThoughtLattice label, so the
// IDE shows the same observed milestones ("Permintaan diterima server", "Menunggu
// giliran worker", "Menulis bagian 2/6 · …"). Never simulated reasoning.
// Keep in step with apps/frontend/src/components/flow/chatProgress.ts.

function retryWaitingState(progress = {}, now = Date.now()) {
  if (progress.stage !== 'retrying') return { waiting: false, seconds: null };
  const at = progress.retry_after ? Date.parse(progress.retry_after) : NaN;
  if (!Number.isFinite(at)) return { waiting: true, seconds: null };
  return { waiting: true, seconds: Math.max(0, Math.ceil((at - now) / 1000)) };
}

/** @returns {{text: string, done: boolean}[]} */
function pendingThoughtSteps(status, webSearch, prompt = '', progress = {}, now = Date.now()) {
  const completed = Math.max(0, progress.sections_completed ?? 0);
  const total = Math.max(0, progress.sections_total ?? 0);
  if (!status) return [{ text: 'Mengirim permintaan ke server', done: false }];
  const retryingFailure = status === 'failed' && progress.stage === 'retrying' && !!progress.retry_after;
  if ((status === 'queued' || status === 'running' || retryingFailure) && progress.stage) {
    const steps = [{ text: 'Permintaan diterima server', done: true }];
    if (progress.stage === 'planning') return [...steps, { text: 'Menyusun rencana dokumen', done: false }];
    steps.push({ text: `Rencana dokumen dibuat · ${total} bagian`, done: true });
    if (completed > 0) steps.push({ text: `Bagian 1–${completed} tersimpan`, done: true });
    if (progress.stage === 'assembling') {
      steps.push({ text: `Menyusun dokumen final · ${total} bagian`, done: false });
    } else {
      const title = progress.current_section_title ? ` · ${progress.current_section_title}` : '';
      if (progress.stage === 'retrying') {
        const wait = retryWaitingState(progress, now);
        steps.push({
          text: `Menunggu sebentar · mencoba kembali otomatis · Bagian ${completed + 1}/${total}${title}`
            + ` · Percobaan ${progress.retry_attempt ?? 1}/${progress.retry_max ?? 3}`
            + (wait.seconds != null ? ` · lanjut dalam ${wait.seconds}s` : ''),
          done: false,
        });
      } else {
        const waiting = status === 'queued' ? ' · menunggu worker' : '';
        steps.push({ text: `Menulis bagian ${completed + 1}/${total}${title}${waiting}`, done: false });
      }
    }
    return steps;
  }
  const target = /arsitektur|architecture/i.test(prompt) ? 'arsitektur' : /\bprd\b/i.test(prompt) ? 'PRD' : /\bsdlc\b/i.test(prompt) ? 'SDLC' : 'jawaban';
  return [
    { text: 'Permintaan diterima server', done: true },
    { text: status === 'running' ? 'Worker mengambil permintaan' : 'Menunggu giliran worker', done: status === 'running' },
    ...(status === 'running' ? [{ text: `Menunggu hasil ${target}${webSearch ? ' · pencarian web diminta' : ''}`, done: false }] : []),
  ];
}

/** Heading of the working lattice, as on the website. */
function thoughtLabel(run) {
  if (run?.stage === 'retrying') return 'Menunggu sebentar';
  if (run?.status === 'queued') return 'Permintaan dalam antrean…';
  if (run?.status === 'running') return 'Model sedang memproses…';
  return 'Mengirim permintaan…';
}

/** Lattice view model for a pending run update (or before the server answered). */
function thoughtView(update, prompt = '') {
  const run = update?.run;
  return { label: thoughtLabel(run), steps: pendingThoughtSteps(run?.status, false, prompt, run || {}) };
}

module.exports = { pendingThoughtSteps, retryWaitingState, thoughtLabel, thoughtView };
