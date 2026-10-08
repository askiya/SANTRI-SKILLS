'use strict';
// Paces text into a document so it reads as typed, while keeping up with the server.
// The target grows as sections stream in; every tick writes a slice of the backlog
// (bigger slices when far behind), and a rewritten prefix is truncated back to the
// common part and retyped instead of jumping. Pure: the caller supplies `write`.

const TICK_MS = 30;
const MIN_CHARS = 6;
const DRAIN_TICKS = 15; // a burst of text is fully typed in about DRAIN_TICKS ticks

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  // never stop between the halves of a surrogate pair
  if (i > 0 && i < a.length && a.charCodeAt(i - 1) >= 0xd800 && a.charCodeAt(i - 1) <= 0xdbff) i--;
  return i;
}

/** How many characters to type next from a backlog, never splitting a surrogate pair. */
function nextSlice(backlog, { min = MIN_CHARS, drain = DRAIN_TICKS } = {}) {
  if (!backlog) return '';
  let n = Math.min(backlog.length, Math.max(min, Math.ceil(backlog.length / drain)));
  const code = backlog.charCodeAt(n - 1);
  if (n < backlog.length && code >= 0xd800 && code <= 0xdbff) n++;
  return backlog.slice(0, n);
}

class Typewriter {
  /**
   * @param {object} o
   * @param {(op: {type: 'append', text: string} | {type: 'truncate', offset: number}) => Promise<boolean|void>} o.write
   *        applies one edit; returning false stops the typewriter (e.g. the member edited the file)
   * @param {string} [o.initial] text already in the document
   * @param {number} [o.tickMs]
   */
  constructor({ write, initial = '', tickMs = TICK_MS }) {
    this.write = write;
    this.written = initial;
    this.target = initial;
    this.tickMs = tickMs;
    this.stopped = false;
    this.busy = false;
    this.timer = null;
    this.waiters = [];
  }

  setTarget(text) {
    if (this.stopped) return;
    this.target = String(text);
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), this.tickMs);
      this.timer.unref?.();
    }
  }

  /** Types the rest up to `text` and resolves when the document holds exactly it (false if stopped). */
  finish(text) {
    if (this.stopped) return Promise.resolve(false);
    this.setTarget(text);
    if (this.written === this.target) {
      this.idle();
      return Promise.resolve(true);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  stop() {
    this.stopped = true;
    this.idle(false);
  }

  idle(result = true) {
    clearInterval(this.timer);
    this.timer = null;
    for (const resolve of this.waiters.splice(0)) resolve(result && !this.stopped);
  }

  async tick() {
    if (this.busy || this.stopped) return;
    if (this.written === this.target) {
      if (this.waiters.length) this.idle();
      return;
    }
    this.busy = true;
    try {
      let op;
      if (this.target.startsWith(this.written)) {
        op = { type: 'append', text: nextSlice(this.target.slice(this.written.length)) };
      } else {
        op = { type: 'truncate', offset: commonPrefix(this.written, this.target) };
      }
      const ok = await this.write(op);
      if (ok === false) return this.stop();
      this.written = op.type === 'append' ? this.written + op.text : this.written.slice(0, op.offset);
      if (this.written === this.target && this.waiters.length) this.idle();
    } catch {
      this.stop();
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { Typewriter, nextSlice, commonPrefix, TICK_MS };
