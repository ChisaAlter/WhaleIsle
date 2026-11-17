'use strict';

// Shared process-tree stop primitive. POSIX: children spawned with
// spawnTreeOptions() lead their own process group, so a group signal reaches
// every descendant; a caller that did not start the child as a group leader
// gets the single-pid fallback. Windows: taskkill /T walks the tree.
const { execFile, execFileSync } = require('child_process');

const TASKKILL_TIMEOUT_MS = 2500;
const SIGNAL_TREE_TIMEOUT_MS = 5000;
const POLL_MS = 50;

/**
 * Spawn options that make the child a process-group leader on POSIX so
 * killProcessTree can signal the whole tree. Windows tree kills go through
 * taskkill and need no option. Callers merge this into their own options.
 * @param {NodeJS.Platform} [platform]
 * @returns {{ detached?: boolean }}
 */
function spawnTreeOptions(platform = process.platform) {
  return platform === 'win32' ? {} : { detached: true };
}

/**
 * @param {number} target
 * @param {number | string} signal
 * @returns {NodeJS.ErrnoException | null}
 */
function trySignal(target, signal) {
  try {
    process.kill(target, signal);
    return null;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error);
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function pidAlive(pid) {
  const error = trySignal(pid, 0);
  return error === null || error.code !== 'ESRCH';
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function groupAlive(pid) {
  const error = trySignal(-pid, 0);
  return error === null || error.code !== 'ESRCH';
}

// "Tree alive" = the leader or any group member. Without detached spawn the
// group check is ESRCH and the leader pid alone decides.
/**
 * @param {number} pid
 * @param {NodeJS.Platform} platform
 * @returns {boolean}
 */
function treeAlive(pid, platform) {
  return platform === 'win32' ? pidAlive(pid) : pidAlive(pid) || groupAlive(pid);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {typeof execFile} run
 * @returns {Promise<string>}
 */
function execTimed(command, args, timeoutMs, run) {
  return new Promise((resolve, reject) => {
    /** @type {import('node:child_process').ExecFileOptions & { stdio?: string[] }} */
    const options = {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    };
    run(command, args, options, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout ? String(stdout) : '');
    });
  });
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {number} pid
 * @param {NodeJS.Platform} platform
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitTreeDeath(pid, platform, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (treeAlive(pid, platform)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(POLL_MS);
  }
  return true;
}

/**
 * @param {number} pid
 * @param {Error | null | undefined} [cause]
 * @returns {Error & { code: string }}
 */
function treeStopError(pid, cause) {
  const error = Object.assign(
    new Error(`进程树未停止（pid ${pid}）${cause ? `：${cause.message}` : ''}`),
    { code: 'PROCESS_TREE_STOP_FAILED' },
  );
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Fire-and-forget tree kill for paths that cannot await (e.g. before-quit).
 * Sends the forced kill but does not wait for or confirm the exit.
 * @param {number} pid
 * @param {{ signal?: string, platform?: NodeJS.Platform, run?: typeof execFileSync }} [options]
 * @returns {boolean} whether the kill was delivered
 */
function signalProcessTree(pid, { signal = 'SIGTERM', platform = process.platform, run = execFileSync } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (platform === 'win32') {
    try {
      run('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: SIGNAL_TREE_TIMEOUT_MS });
      return true;
    } catch {
      return false;
    }
  }
  const error = trySignal(-pid, signal);
  if (error && error.code === 'ESRCH') {
    return trySignal(pid, signal) === null;
  }
  return error === null;
}

/**
 * Stop a process tree: POSIX signals the group (single-pid fallback when the
 * caller did not start a group leader), Windows runs taskkill /T /F. After
 * graceMs a still-live POSIX tree escalates to SIGKILL and is confirmed;
 * anything still alive throws PROCESS_TREE_STOP_FAILED. A failed taskkill on
 * an already-exited pid counts as stopped.
 * @param {number} pid - group leader / tree root
 * @param {object} [options]
 * @param {number} [options.graceMs=2000] - graceful window before SIGKILL
 * @param {string} [options.signal='SIGTERM'] - initial POSIX signal
 * @param {typeof execFile} [options.run] - taskkill command seam (tests)
 * @param {NodeJS.Platform} [options.platform]
 * @returns {Promise<boolean>} true when the tree stopped
 */
async function killProcessTree(pid, { graceMs = 2000, signal = 'SIGTERM', run = execFile, platform = process.platform } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (platform === 'win32') {
    try {
      await execTimed('taskkill', ['/pid', String(pid), '/T', '/F'], TASKKILL_TIMEOUT_MS, run);
    } catch (error) {
      if (!pidAlive(pid)) {
        return true;
      }
      throw treeStopError(pid, /** @type {Error} */ (error));
    }
    if (await waitTreeDeath(pid, platform, graceMs)) {
      return true;
    }
    throw treeStopError(pid);
  }
  let failure = trySignal(-pid, signal);
  if (failure && failure.code === 'ESRCH') {
    const fallback = trySignal(pid, signal);
    failure = fallback && fallback.code !== 'ESRCH' ? fallback : null;
  }
  if (await waitTreeDeath(pid, platform, graceMs)) {
    return true;
  }
  const killError = trySignal(-pid, 'SIGKILL');
  if (killError && killError.code === 'ESRCH') {
    trySignal(pid, 'SIGKILL');
  }
  if (await waitTreeDeath(pid, platform, graceMs)) {
    return true;
  }
  throw treeStopError(pid, failure);
}

module.exports = {
  spawnTreeOptions,
  signalProcessTree,
  killProcessTree,
};
