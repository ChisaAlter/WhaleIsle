'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { normalizeDshState } = require('./pet-settings');

// One manager owns one watcher generation. Filesystem work and the existing
// parser run off-thread; only effects and durable config commits cross back.
function createDshWatchWorker(options) {
  const workerFile = path.join(__dirname, 'pet-dsh-watch-worker.js')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  let worker = null;
  let closed = false;
  let timer = null;
  let nextId = 0;
  let active = null;
  let runtime = null;
  let closing = null;

  const read = () => normalizeDshState(options.getDsh?.());
  function applyEffects(effects, allowOutbox = true) {
    let outboxDeferred = false;
    for (const effect of effects || []) {
      if (effect.kind === 'event') {
        const outbox = effect.value?.type === 'dshWhale';
        if (outbox && !allowOutbox) { outboxDeferred = true; continue; }
        if (options.onEvent?.(effect.value) === false && outbox) outboxDeferred = true;
      }
      else if (effect.kind === 'state') options.onState?.(effect.value);
    }
    return outboxDeferred;
  }
  function drop(w, error) {
    if (worker !== w) return;
    worker = null;
    const pending = active;
    active = null;
    pending?.reject(error);
  }
  function ensure() {
    if (worker) return worker;
    const w = new Worker(workerFile, { workerData: {
      sessionsDir: options.sessionsDir || '',
      outboxFile: options.outboxFile || '',
      usageFile: options.usageFile || '',
    } });
    worker = w;
    w.unref?.();
    w.on('message', (msg) => {
      if (closed || worker !== w || !active || active.id !== msg?.id) return;
      if (msg.type === 'checkpoint') {
        const next = normalizeDshState(msg.dsh);
        let outboxDeferred = Boolean(msg.outboxBefore && options.isPetVisible?.() === false);
        const restoreOutbox = () => {
          if (!msg.outboxBefore || !options.outboxFile) return;
          if (msg.outboxBefore.offset === undefined) delete next.files[options.outboxFile];
          else next.files[options.outboxFile] = msg.outboxBefore.offset;
          next.lastSeenAt = msg.outboxBefore.lastSeenAt;
        };
        if (outboxDeferred) restoreOutbox();
        runtime = next;
        let error;
        try {
          outboxDeferred = applyEffects(msg.effects, !outboxDeferred) || outboxDeferred;
          if (outboxDeferred) restoreOutbox();
          if (closed || worker !== w || active?.id !== msg.id) return;
          options.saveDsh?.(next);
        } catch (cause) {
          error = String(cause?.message || cause);
        }
        if (!closed && worker === w && active?.id === msg.id) {
          w.postMessage({ type: 'checkpoint-result', id: msg.id, ok: !error, error, persisted: read(), outboxDeferred });
        }
        return;
      }
      if (msg.type !== 'result') return;
      const pending = active;
      active = null;
      runtime = msg.runtime;
      try {
        applyEffects(msg.effects);
        if (msg.ok) pending.resolve(runtime);
        else pending.reject(new Error(msg.error || 'pet watcher poll failed'));
      } catch (error) {
        pending.reject(error);
      }
    });
    w.on('error', (error) => drop(w, error));
    w.on('exit', (code) => drop(w, new Error(`pet watcher worker exited (${code})`)));
    return w;
  }
  function poll() {
    if (closed) return Promise.reject(new Error('pet watcher closed'));
    if (active) return active.promise;
    const pending = { id: ++nextId };
    pending.promise = new Promise((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
    });
    active = pending;
    try {
      ensure().postMessage({ type: 'poll', id: pending.id, dsh: read(),
        now: options.now ? options.now() : Date.now(), visible: options.isPetVisible?.() !== false });
    } catch (error) {
      active = null;
      pending.reject(error);
    }
    return pending.promise;
  }
  function close() {
    if (closed) return closing || Promise.resolve();
    closed = true;
    clearInterval(timer);
    timer = null;
    // Keep the original stop-time sub-minute checkpoint synchronous. A late
    // worker response cannot write through an old manager after replacement.
    if (runtime && JSON.stringify(runtime) !== JSON.stringify(read())) {
      try { options.saveDsh?.(runtime); } catch { /* same best-effort stop checkpoint */ }
    }
    runtime = null;
    const w = worker;
    worker = null;
    active?.reject(new Error('pet watcher closed'));
    active = null;
    closing = w ? w.terminate().then(() => {}, () => {}) : Promise.resolve();
    return closing;
  }
  function start(intervalMs = 2000) {
    if (closed || timer) return;
    timer = setInterval(() => poll().catch(() => {}), intervalMs);
    timer.unref?.();
    return close;
  }
  return { poll, start, close };
}

module.exports = { createDshWatchWorker };
