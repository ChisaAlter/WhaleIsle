'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createDshWatch } = require('./pet-dsh-watch');
const { normalizeDshState } = require('./pet-settings');

let persisted = {};
let pollNow = 0;
let visible = false;
let pollId = 0;
let effects = [];
let checkpoint = null;
const watch = createDshWatch({
  ...workerData,
  getDsh: () => persisted,
  now: () => pollNow,
  isPetVisible: () => visible,
  onEvent: (value) => effects.push({ kind: 'event', value }),
  onState: (value) => effects.push({ kind: 'state', value }),
  saveDsh: (next, outboxBefore) => new Promise((resolve, reject) => {
    checkpoint = { id: pollId, resolve, reject };
    parentPort.postMessage({ type: 'checkpoint', id: pollId, dsh: normalizeDshState(next), effects, outboxBefore });
    effects = [];
  }),
});

parentPort.on('message', async (msg) => {
  if (msg?.type === 'checkpoint-result') {
    if (!checkpoint || checkpoint.id !== msg.id) return;
    const pending = checkpoint;
    checkpoint = null;
    persisted = msg.persisted;
    if (msg.ok) pending.resolve({ outboxDeferred: msg.outboxDeferred });
    else {
      const error = new Error(msg.error || 'pet checkpoint failed');
      error.outboxDeferred = msg.outboxDeferred;
      pending.reject(error);
    }
    return;
  }
  if (msg?.type !== 'poll') return;
  pollId = msg.id;
  persisted = msg.dsh;
  pollNow = msg.now;
  visible = msg.visible;
  effects = [];
  let error;
  try {
    await watch.poll();
  } catch (cause) {
    error = String(cause?.message || cause);
  }
  parentPort.postMessage({ type: 'result', id: pollId, ok: !error, error, effects, runtime: watch.snapshot() });
  effects = [];
});
