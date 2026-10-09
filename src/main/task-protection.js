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

function inspectionClean(inspection) {
  if (!inspection || inspection.ok !== true) return false;
  if (inspection.activeWork.length > 0 || inspection.scheduledWork.length > 0) return false;
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

  async function confirmWithUser(operation, inspection) {
    if (typeof options.confirm !== 'function') return false;
    return (await options.confirm(operation, inspection)) === true;
  }

  async function runCommitCleanups() {
    for (const cleanup of commitCleanups.splice(0)) {
      try {
        await cleanup();
      } catch (error) {
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

  async function acquire(operation) {
    const result = await controlOp('acquire', {
      owner: `desktop-${operation}`,
      kind: operation,
      ttlMs: options.acquireTtlMs || DEFAULT_ACQUIRE_TTL_MS,
      drainTimeoutMs: options.drainTimeoutMs || DEFAULT_DRAIN_TIMEOUT_MS,
    }, Math.max(options.inspectTimeoutMs || DEFAULT_INSPECT_TIMEOUT_MS,
      (options.drainTimeoutMs || DEFAULT_DRAIN_TIMEOUT_MS) + 10000));
    if (result.ok === true) {
      currentLock = { lockId: result.lockId, owner: `desktop-${operation}` };
    }
    return result;
  }

  /**
   * Run one protected operation. `commit` is invoked only after the decision
   * is final; returning early leaves every side effect untouched.
   * @param {string} operation - quit | restart | reload | stop | update | install | delta
   * @param {{ commit?: () => (void|Promise<void>), terminal?: boolean }} [opts]
   *   `terminal` latches the committed flag — use for operations whose commit
   *   ends the process (quit/update); stop/restart keep coordinating.
   *   `hostLock: false` skips the Host acquire — reload keeps the Host alive,
   *   so a held lock would freeze admissions until its TTL.
   *   `preConfirmed: true` skips both user-confirm gates — callers carrying
   *   explicit consent (the launcher's stop button) must not prompt again.
   * @returns {Promise<{ proceeded: boolean, code?: string, inspection?: object }>}
   */
  async function coordinate(operation, opts = {}) {
    if (committed) {
      // A committed protection decision is not re-coordinated — the shutdown
      // sequence it authorized is already running.
      if (typeof opts.commit === 'function') await opts.commit();
      return { proceeded: true };
    }
    if (coordinating !== null) {
      return { proceeded: false, code: 'busy' };
    }
    coordinating = operation;
    try {
      const first = mergedInspection(await inspect());
      if (!inspectionClean(first) && opts.preConfirmed !== true) {
        if (!(await confirmWithUser(operation, first))) {
          return { proceeded: false, code: 'cancelled', inspection: first };
        }
      }
      if (hostRunning() && opts.hostLock !== false) {
        const acquired = await acquire(operation);
        if (acquired.ok !== true) {
          return {
            proceeded: false,
            code: acquired.code || 'acquire-failed',
            detail: acquired.detail,
            pendingCount: acquired.pendingCount,
            pendingLabels: acquired.pendingLabels,
          };
        }
        const second = mergedInspection(await inspect());
        if (!inspectionClean(second) && inspectionClean(first) && opts.preConfirmed !== true) {
          // Work arrived between the first look and the lock — re-confirm
          // against the fresh picture rather than riding an obsolete prompt.
          if (!(await confirmWithUser(operation, second))) {
            await release();
            return { proceeded: false, code: 'cancelled', inspection: second };
          }
        }
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
      return { proceeded: true };
    } finally {
      coordinating = null;
    }
  }

  return {
    coordinate,
    isCommitted: () => committed,
    isCoordinating: () => coordinating !== null,
    /** Register cleanup that runs inside a terminal commit, after the
     * decision is final — never on stop/restart/reload commits. */
    onCommitCleanup(cleanup) {
      if (typeof cleanup === 'function') commitCleanups.push(cleanup);
    },
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
    isCommitted: () => false,
    isCoordinating: () => false,
    onCommitCleanup: () => {},
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
  resetTaskControlToken,
  inspectionClean,
  CONTROL_PREFIX,
};
