'use strict';

/**
 * Shell-side task-protection coordinator. Runs the inspect → acquire → drain →
 * inspect → confirm → commit sequence against the Host task-control plugin so
 * that quit/restart/stop/update never produce their first side effect before
 * the user confirms or the work check completes clean.
 *
 * All Electron/dialog/fetch surfaces are injected so the coordinator is
 * testable under `node --test`.
 */

const { randomBytes } = require('crypto');

const CONTROL_PREFIX = '/dshd-task-control';
const DEFAULT_INSPECT_TIMEOUT_MS = 5000;
const DEFAULT_ACQUIRE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DRAIN_TIMEOUT_MS = 30000;

let processToken = null;

/** Per-shell-process control token handed to the Host child via env. */
function taskControlToken() {
  if (processToken === null) {
    processToken = randomBytes(24).toString('hex');
  }
  return processToken;
}

/** For tests. */
function resetTaskControlToken() {
  processToken = null;
}

/** Coverage verdicts that do not block an unattended commit. */
const CLEAN_COVERAGE = new Set(['ok', 'intentional-disabled']);

/**
 * Work that ends by itself. The drain after the Host lock waits for in-flight
 * requests, so they never need the user's consent: a background connection
 * must not turn a Settings switch into a restart prompt.
 */
const SELF_ENDING_WORK = new Set(['request']);

function inspectionClean(inspection) {
  if (!inspection || inspection.ok !== true) return false;
  if (inspection.activeWork.some((item) => !SELF_ENDING_WORK.has(item?.kind))) return false;
  if (inspection.scheduledWork.length > 0) return false;
  return Object.values(inspection.coverage || {}).every((value) => CLEAN_COVERAGE.has(value));
}

/**
 * @param {{
 *   getBaseUrl?: () => string,
 *   hostRunning?: () => boolean,
 *   confirm?: (operation: string, inspection: object) => Promise<boolean>,
 *   shellWork?: () => Array<object>,
 *   commitCleanups?: Array<() => (void|Promise<void>)>,
 *   fetchImpl?: typeof fetch,
 *   log?: (message: string) => void,
 *   inspectTimeoutMs?: number,
 *   acquireTtlMs?: number,
 *   drainTimeoutMs?: number,
 * }} options
 */
function createTaskProtection(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const commitCleanups = [];
  let coordinating = null;
  let committed = false;
  let currentLock = null;
  /** @type {AbortController | null} */
  let activeAbort = null;
  /** @type {Promise<unknown> | null} */
  let activePromise = null;

  function baseUrl() {
    const value = typeof options.getBaseUrl === 'function' ? options.getBaseUrl() : '';
    const raw = typeof value === 'string' ? value.replace(/\/+$/, '') : '';
    if (!raw) return '';
    // The ready URL carries the launch token (`dsh web: <origin>/?token=…`);
    // appending the control prefix after that query would post to `/` and get
    // a 405, so the control surface pins the origin.
    try {
      return new URL(raw).origin;
    } catch {
      return raw;
    }
  }

  function hostRunning() {
    if (typeof options.hostRunning === 'function') {
      return options.hostRunning() === true;
    }
    return baseUrl() !== '';
  }

  async function controlOp(op, body, timeoutMs) {
    const url = baseUrl();
    if (!url || typeof fetchImpl !== 'function') {
      return { ok: false, code: 'dshd/unreachable' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_INSPECT_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${url}${CONTROL_PREFIX}/${op}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${taskControlToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });
      const parsed = await response.json().catch(() => null);
      if (!response.ok || parsed === null || typeof parsed !== 'object') {
        return { ok: false, code: `dshd/http-${response.status}` };
      }
      return parsed;
    } catch (error) {
      return { ok: false, code: 'dshd/unreachable', detail: error && error.message ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function inspect() {
    if (!hostRunning()) {
      return { ok: true, hostDown: true, activeWork: [], scheduledWork: [], coverage: {} };
    }
    const inspection = await controlOp('inspect', {}, options.inspectTimeoutMs);
    if (inspection.ok !== true) {
      return {
        ok: false,
        code: inspection.code || 'dshd/unreachable',
        detail: inspection.detail,
        activeWork: [],
        scheduledWork: [],
        coverage: { host: 'unavailable' },
      };
    }
    return inspection;
  }

  function mergedInspection(inspection) {
    const shell = typeof options.shellWork === 'function' ? options.shellWork() : [];
    const shellItems = Array.isArray(shell) ? shell : [];
    if (shellItems.length === 0) return inspection;
    return {
      ...inspection,
      activeWork: [...(inspection.activeWork || []), ...shellItems],
    };
  }

  async function confirmWithUser(operation, inspection, /** @type {AbortSignal | undefined} */ signal) {
    if (typeof options.confirm !== 'function' || signal?.aborted) return false;
    return (await /** @type {any} */ (options.confirm)(operation, inspection, { signal })) === true && !signal?.aborted;
  }

  async function runCommitCleanups() {
    const results = await Promise.allSettled(commitCleanups.splice(0)
      .map((cleanup) => Promise.resolve().then(cleanup)));
    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason;
        log(`task-protection cleanup failed: ${error && error.message ? error.message : String(error)}`);
      }
    }
  }

  async function release() {
    if (currentLock === null) return;
    const lock = currentLock;
    currentLock = null;
    const result = await controlOp('release', { lockId: lock.lockId, owner: lock.owner });
    if (result.ok !== true) {
      log(`task-protection release failed: ${result.code || 'unknown'}`);
    }
  }

  async function acquire(operation, drainTimeoutMs) {
    const drainMs = drainTimeoutMs || options.drainTimeoutMs || DEFAULT_DRAIN_TIMEOUT_MS;
    const result = await controlOp('acquire', {
      owner: `desktop-${operation}`,
      kind: operation,
      ttlMs: options.acquireTtlMs || DEFAULT_ACQUIRE_TTL_MS,
      drainTimeoutMs: drainMs,
    }, Math.max(options.inspectTimeoutMs || DEFAULT_INSPECT_TIMEOUT_MS, drainMs + 10000));
    if (result.ok === true) {
      currentLock = { lockId: result.lockId, owner: `desktop-${operation}` };
    }
    return result;
  }

  /**
   * Acquire the Host lock if running and re-confirm if work arrived in between.
   * @param {string} operation
   * @param {any} opts
   * @param {any} first
   * @param {AbortSignal} signal
   * @returns {Promise<{ proceed: true, forced: object | null } | { proceed: false, result: { proceeded: boolean, code?: string, detail?: string, pendingCount?: number, pendingLabels?: string[], inspection?: object } }>}
   */
  async function acquireAndReconfirm(operation, opts, first, signal) {
    if (!hostRunning() || opts.hostLock === false) return { proceed: true, forced: null };
    const acquired = await acquire(operation, opts.drainTimeoutMs);
    let forced = null;
    if (acquired.ok !== true) {
      const failure = {
        code: acquired.code || 'acquire-failed',
        detail: acquired.detail,
        pendingCount: acquired.pendingCount,
        pendingLabels: acquired.pendingLabels,
      };
      if (opts.force !== true) return { proceed: false, result: { proceeded: false, ...failure } };
      forced = failure;
      log(`task-protection ${operation}: proceeding without Host admission ${JSON.stringify(failure)}`);
    }
    const second = forced ? first : mergedInspection(await inspect());
    if (!forced && !inspectionClean(second) && inspectionClean(first) && opts.preConfirmed !== true) {
      // Work arrived between the first look and the lock — re-confirm
      // against the fresh picture rather than riding an obsolete prompt.
      if (!(await confirmWithUser(operation, second, signal))) {
        await release();
        return { proceed: false, result: { proceeded: false, code: 'cancelled', inspection: second } };
      }
    }
    return { proceed: true, forced };
  }

  async function runCoordinate(/** @type {string} */ operation, /** @type {any} */ opts, /** @type {AbortSignal} */ signal) {
    const first = mergedInspection(await inspect());
    if (!inspectionClean(first) && opts.preConfirmed !== true) {
      if (!(await confirmWithUser(operation, first, signal))) {
        return { proceeded: false, code: 'cancelled', inspection: first };
      }
    }
    const lockStep = await acquireAndReconfirm(operation, opts, first, signal);
    if (!lockStep.proceed) return lockStep.result;
    const { forced } = lockStep;
    if (signal?.aborted) {
      if (opts.hostLock !== false) await release();
      return { proceeded: false, code: 'cancelled' };
    }
    try {
      if (typeof opts.commit === 'function') {
        await opts.commit();
      }
    } catch (error) {
      // A failed commit must not freeze Host admissions for the TTL —
      // release before the error propagates.
      if (opts.hostLock !== false) await release();
      throw error;
    }
    // Keep supervised services and their cleanup registrations intact when
    // a terminal commit fails (for example, an installer rejected at spawn).
    // A successful terminal commit is followed by cleanup before app.quit.
    if (opts.terminal === true) await runCommitCleanups();
    if (opts.terminal === true) committed = true;
    else if (opts.hostLock !== false) {
      // The Host may have survived a failed non-terminal commit; release so
      // admissions are not frozen for the TTL.
      await release();
    }
    return forced ? { proceeded: true, forced } : { proceeded: true };
  }

  /**
   * Run one protected operation. `commit` is invoked only after the decision
   * is final; returning early leaves every side effect untouched.
   * @param {string} operation - quit | restart | reload | stop | update | install | delta
   * @param {{ commit?: () => (void|Promise<void>), terminal?: boolean, hostLock?: boolean, preConfirmed?: boolean, force?: boolean, drainTimeoutMs?: number }} [opts]
   *   `terminal` latches the committed flag — use for operations whose commit
   *   ends the process (quit/update); stop/restart keep coordinating.
   *   `hostLock: false` skips the Host acquire — reload keeps the Host alive,
   *   so a held lock would freeze admissions until its TTL.
   *   `preConfirmed: true` skips both user-confirm gates — callers carrying
   *   explicit consent (the launcher's stop button) must not prompt again.
   *   `force: true` commits even when the Host admission fails (drain
   *   timeout, unreachable Host): an explicit update or close is never held
   *   back by unfinished work. `drainTimeoutMs` shortens the drain wait.
   * @returns {Promise<{ proceeded: boolean, code?: string, detail?: string, pendingCount?: number, pendingLabels?: string[], forced?: object, inspection?: object, local?: boolean }>}
   */
  async function coordinate(operation, opts = {}) {
    if (committed) {
      // A committed protection decision is not re-coordinated — the shutdown
      // sequence it authorized is already running.
      if (typeof opts.commit === 'function') await opts.commit();
      return { proceeded: true };
    }
    if (coordinating !== null) {
      return { proceeded: false, code: 'busy', local: true };
    }
    coordinating = operation;
    activeAbort = new AbortController();
    const run = runCoordinate(operation, opts, activeAbort.signal);
    activePromise = run;
    try {
      return await run;
    } finally {
      coordinating = null;
      activeAbort = null;
      activePromise = null;
    }
  }

  async function cancelAndWait(timeoutMs = 5000) {
    if (activeAbort) activeAbort.abort();
    const pending = activePromise;
    if (!pending) return true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    try {
      return await Promise.race([
        pending.then(() => true, () => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    coordinate,
    cancelAndWait,
    isCommitted: () => committed,
    isCoordinating: () => coordinating !== null,
    /** Register cleanup that runs inside a terminal commit, after the
     * decision is final — never on stop/restart/reload commits. */
    onCommitCleanup(cleanup) {
      if (typeof cleanup === 'function') commitCleanups.push(cleanup);
    },
    // Explicit quit must also stop supervised services when Host inspection
    // or shutdown fails. Failed installer commits still preserve these hooks.
    cleanupAfterQuit: runCommitCleanups,
    /** Force-release a held lock (error paths). */
    release,
    controlOp,
    _internals: { inspectionClean, taskControlToken },
  };
}

/**
 * Process-wide coordinator installed by the desktop entry point. Modules
 * without a reference to it (update lanes, components lane) resolve it here;
 * before installation a pass-through coordinator keeps non-protected call
 * sites (unit tests, the slim launcher process) working — it never fabricates
 * a prompt and never reports a Host that does not exist.
 */
let installed = null;

function passThroughProtection() {
  return {
    coordinate: async (operation, opts = {}) => {
      if (typeof opts.commit === 'function') await opts.commit();
      return { proceeded: true };
    },
    cancelAndWait: async () => true,
    isCommitted: () => false,
    isCoordinating: () => false,
    onCommitCleanup: () => {},
    cleanupAfterQuit: async () => {},
    release: async () => {},
    controlOp: async () => ({ ok: false, code: 'dshd/no-protection' }),
    _internals: { inspectionClean, taskControlToken },
  };
}

function installTaskProtection(instance) {
  installed = instance;
  return installed;
}

function getTaskProtection() {
  return installed || passThroughProtection();
}

module.exports = {
  createTaskProtection,
  installTaskProtection,
  getTaskProtection,
  taskControlToken,
  inspectionClean,
  CONTROL_PREFIX,
};
