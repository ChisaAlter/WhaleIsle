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

/** @type {{ openProcess: any, getProcessTimes: any, closeHandle: any } | null} */
let nativeProcessTimesApi = null;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const FILETIME_EPOCH_DIFF_100NS = 116444736000000000n;

/**
 * Read a Windows process creation timestamp via Win32 GetProcessTimes without
 * spawning PowerShell. Returns '' when the pid does not exist or cannot be opened.
 * @param {number} pid
 * @returns {string}
 */
function windowsProcessStartTime(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0 || pid > 0xFFFFFFFF) {
    return '';
  }
  if (!nativeProcessTimesApi) {
    const kernel32 = require('koffi').load('kernel32.dll');
    nativeProcessTimesApi = {
      openProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t, int32_t, uint32_t)'),
      getProcessTimes: kernel32.func(
        'int32_t __stdcall GetProcessTimes(intptr_t, _Out_ uint64_t *, _Out_ uint64_t *, _Out_ uint64_t *, _Out_ uint64_t *)',
      ),
      closeHandle: kernel32.func('int32_t __stdcall CloseHandle(intptr_t)'),
    };
  }
  const handle = nativeProcessTimesApi.openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (!handle) return '';
  try {
    const creation = [0n];
    const exit = [0n];
    const kernel = [0n];
    const user = [0n];
    if (!nativeProcessTimesApi.getProcessTimes(handle, creation, exit, kernel, user)) return '';
    const ticks = BigInt(creation[0]) - FILETIME_EPOCH_DIFF_100NS;
    const ms = Number(ticks / 10000n);
    const subMs = String(Number(((ticks % 10000n) + 10000n) % 10000n)).padStart(4, '0');
    return new Date(ms).toISOString().replace(/Z$/, `${subMs}Z`);
  } finally {
    nativeProcessTimesApi.closeHandle(handle);
  }
}

const ISO_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const WINFT_TIMESTAMP_RE = /^winft:(\d+)$/;

/**
 * Normalize an ISO-8601 timestamp or Windows FILETIME `winft:<100ns>` token to
 * a timezone-independent `<wholeEpochMs>:<7-digit-100ns-fraction>` key.
 * @param {string} value
 * @returns {string | null}
 */
function canonicalIsoInstant(value) {
  const raw = String(value);
  const winft = WINFT_TIMESTAMP_RE.exec(raw);
  if (winft) {
    const unixTicks = BigInt(winft[1]) - FILETIME_EPOCH_DIFF_100NS;
    const rem = ((unixTicks % 10_000_000n) + 10_000_000n) % 10_000_000n;
    const wholeSec = (unixTicks - rem) / 10_000_000n;
    const wholeMs = Number(wholeSec * 1000n);
    if (!Number.isFinite(wholeMs)) return null;
    return `${wholeMs}:${String(Number(rem)).padStart(7, '0')}`;
  }
  const match = ISO_TIMESTAMP_RE.exec(raw);
  if (!match) return null;
  const wholeMs = Date.parse(`${match[1]}${match[3]}`);
  if (!Number.isFinite(wholeMs)) return null;
  const frac = (match[2] || '').padEnd(7, '0').slice(0, 7);
  return `${wholeMs}:${frac}`;
}

/**
 * Cross-platform synchronous process start-time token for lock-owner identity.
 * @param {number} pid
 * @returns {string}
 */
function readProcessStartTimeSync(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return '';
  if (process.platform === 'win32') return windowsProcessStartTime(pid);
  if (process.platform === 'linux') {
    try {
      const stat = require('node:fs').readFileSync(`/proc/${pid}/stat`, 'utf8');
      const end = stat.lastIndexOf(')');
      if (end < 0) return '';
      const fields = stat.slice(end + 2).trim().split(/\s+/);
      return fields[19] ? `proc:${fields[19]}` : '';
    } catch {
      return '';
    }
  }
  try {
    const out = require('node:child_process').execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out;
  } catch {
    return '';
  }
}

/**
 * Compare two OS process start timestamps. Matches identical strings directly
 * and equates ISO-8601 and `winft:` timestamps representing the same 100ns
 * instant across UTC (`Z`) and local-offset (`±HH:MM`) encodings.
 * @param {string} current
 * @param {string} recorded
 * @returns {boolean}
 */
function sameProcessStartTime(current, recorded) {
  if (!current || !recorded) return false;
  if (current === recorded) return true;
  const a = canonicalIsoInstant(current);
  const b = canonicalIsoInstant(recorded);
  return a !== null && a === b;
}

module.exports = {
  spawnTreeOptions,
  signalProcessTree,
  killProcessTree,
  windowsProcessStartTime,
  readProcessStartTimeSync,
  sameProcessStartTime,
};
