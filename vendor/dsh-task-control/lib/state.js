/**
 * Task-control state machine: admission lock ownership, pending-work drain,
 * and generation bookkeeping. Pure module — no cordis imports — so the shell
 * can exercise it under plain `node --test`.
 */

import { randomUUID } from 'node:crypto';

export const LOCKED_CODE = 'dshd/admission-locked';

/**
 * One shared control record per Host process.
 * @returns {{
 *   hostGeneration: string,
 *   startedAt: number,
 *   lockEpoch: number,
 *   lock: null | { lockId: string, owner: string, kind: string, generation: number, acquiredAt: number, expiresAt: number },
 *   pending: Set<{ label: string, promise: Promise<unknown> }>,
 *   stopping: boolean,
 * }}
 */
export function createControlState() {
  return {
    hostGeneration: randomUUID(),
    startedAt: Date.now(),
    lockEpoch: 0,
    lock: null,
    pending: new Set(),
    stopping: false,
  };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {number} now
 */
function lockLive(state, now) {
  return state.lock !== null && state.lock.expiresAt > now;
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {number} now
 */
function pruneExpiredLock(state, now) {
  if (state.lock !== null && state.lock.expiresAt <= now) {
    state.lock = null;
    state.lockEpoch += 1;
  }
}

/**
 * Admit one unit of independent work while unlocked. Admitted work registers
 * in `pending` until `done()` runs; a lock acquire drains exactly this set, so
 * the admit check and the pending add stay synchronous/atomic. `label`
 * identifies the admission kind in drain-timeout diagnostics.
 * @param {ReturnType<typeof createControlState>} state
 * @param {string} [label]
 * @returns {{ accepted: true, done: () => void } | { accepted: false, code: string }}
 */
export function admit(state, label) {
  pruneExpiredLock(state, Date.now());
  if (state.stopping) return { accepted: false, code: 'dshd/host-stopping' };
  if (lockLive(state, Date.now())) return { accepted: false, code: LOCKED_CODE };
  /** @type {(value?: unknown) => void} */
  let settle = () => {};
  const entry = { label: String(label || '?'), promise: new Promise((resolve) => { settle = resolve; }) };
  state.pending.add(entry);
  let closed = false;
  return {
    accepted: true,
    done() {
      if (closed) return;
      closed = true;
      state.pending.delete(entry);
      settle();
    },
  };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {number} timeoutMs
 */
async function waitForDrain(state, timeoutMs) {
  const pending = [...state.pending];
  if (pending.length === 0) return { drained: true, count: 0 };
  const settled = Promise.allSettled(pending.map((entry) => entry.promise));
  if (!(timeoutMs > 0)) {
    await settled;
    return { drained: true, count: pending.length };
  }
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const winner = await Promise.race([settled.then(() => 'drained'), timeout]);
    const remaining = [...state.pending].map((entry) => entry.label);
    return { drained: winner === 'drained', count: pending.length, labels: remaining };
  } finally {
    clearTimeout(timer);
  }
}

/** @param {unknown} raw */
function parseDrainTimeoutMs(raw) {
  if (raw === undefined || raw === null || raw === '') return 30000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30000;
}

/**
 * Take the admission lock: refuse new work, drain previously admitted work,
 * and verify the lock was not superseded during the drain.
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ owner: string, kind?: string, ttlMs?: number, drainTimeoutMs?: number }} request
 */
export async function acquireLock(state, request) {
  const now = Date.now();
  pruneExpiredLock(state, now);
  if (state.stopping) return { ok: false, code: 'dshd/host-stopping' };
  const owner = String(request.owner || '').trim();
  if (!owner) return { ok: false, code: 'dshd/bad-owner' };
  const ttlMs = typeof request.ttlMs === 'number' && request.ttlMs > 0 ? request.ttlMs : 60000;
  let lock = state.lock;
  if (lock !== null && lock.expiresAt > now) {
    if (lock.owner !== owner) {
      return { ok: false, code: 'dshd/lock-held', owner: lock.owner };
    }
    // Same-owner re-acquire renews the held lockId while advancing generation so
    // concurrent re-entrant drainers cannot share a generation or release each
    // other's lock on timeout.
    lock.expiresAt = now + ttlMs;
    lock.generation = ++state.lockEpoch;
  } else {
    state.lock = lock = {
      lockId: randomUUID(),
      owner,
      kind: String(request.kind || 'generic'),
      generation: ++state.lockEpoch,
      acquiredAt: now,
      expiresAt: now + ttlMs,
    };
  }
  const generation = lock.generation;
  const drain = await waitForDrain(state, parseDrainTimeoutMs(request.drainTimeoutMs));
  if (state.stopping) {
    if (state.lock?.generation === generation) {
      releaseLock(state, { lockId: lock.lockId, owner, generation });
    }
    return { ok: false, code: 'dshd/host-stopping' };
  }
  // Expiry is lazy — prune BEFORE the generation check so a lock whose TTL
  // lapsed mid-drain reads as superseded rather than committing stale.
  pruneExpiredLock(state, Date.now());
  if (state.lock === null || state.lock.generation !== generation) {
    return { ok: false, code: 'dshd/lock-superseded' };
  }
  if (!drain.drained) {
    releaseLock(state, { lockId: lock.lockId, owner, generation });
    return { ok: false, code: 'dshd/drain-timeout', pendingCount: drain.count, pendingLabels: drain.labels };
  }
  return {
    ok: true,
    lockId: lock.lockId,
    owner,
    generation,
    hostGeneration: state.hostGeneration,
    expiresAt: lock.expiresAt,
    drainedPending: drain.count,
  };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ lockId: string, owner: string, generation?: number }} request
 */
export function releaseLock(state, request) {
  if (state.lock === null) return { ok: true, released: false };
  if (state.lock.lockId !== request.lockId || state.lock.owner !== request.owner) {
    return { ok: false, code: 'dshd/lock-mismatch' };
  }
  if (request.generation !== undefined && state.lock.generation !== request.generation) {
    return { ok: false, code: 'dshd/lock-mismatch' };
  }
  state.lock = null;
  state.lockEpoch += 1;
  return { ok: true, released: true };
}

/**
 * @param {ReturnType<typeof createControlState>} state
 * @param {{ lockId: string, owner: string, ttlMs?: number }} request
 */
export function renewLock(state, request) {
  if (state.lock === null) return { ok: false, code: 'dshd/no-lock' };
  if (state.lock.lockId !== request.lockId || state.lock.owner !== request.owner) {
    return { ok: false, code: 'dshd/lock-mismatch' };
  }
  const ttlMs = typeof request.ttlMs === 'number' && request.ttlMs > 0 ? request.ttlMs : 60000;
  state.lock.expiresAt = Date.now() + ttlMs;
  return { ok: true, expiresAt: state.lock.expiresAt };
}

/** Lock + pending snapshot for the `status` op.
 * @param {ReturnType<typeof createControlState>} state
 */
export function lockStatus(state) {
  const now = Date.now();
  pruneExpiredLock(state, now);
  return {
    locked: state.lock !== null,
    lock: state.lock === null ? null : { ...state.lock },
    pendingCount: state.pending.size,
    lockEpoch: state.lockEpoch,
    hostGeneration: state.hostGeneration,
    stopping: state.stopping,
  };
}
