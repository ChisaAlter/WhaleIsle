'use strict';

/**
 * Broken-pipe hardening for the Electron main process (Touching: remote-settings).
 *
 * Desktop GUI processes routinely hold pipe-backed stdout/stderr whose other
 * end (installer, launcher, npm wrapper) exits early. Any later write to those
 * fds — pino-pretty fallbacks, Node's execSync stderr forwarding, stray
 * console output from the vendored ChisaCode daemon running in-process —
 * raises EPIPE. Without an 'error' listener on the stream that write escalates
 * to an uncaughtException and kills the whole app (observed: enabling 远程 →
 * dsh-agent `execSync("npm root -g")` → `EPIPE: broken pipe, write`).
 *
 * Two layers:
 * 1. `installStdioGuard` — attach 'error' listeners to process.stdout/stderr
 *    so log-fd failures never throw. A broken log pipe must never be fatal.
 * 2. `installUncaughtBrokenPipeGuard` — as long as the ChisaCode daemon runs
 *    in-process (phase 2 of the remote plan moves it to a child process),
 *    writes to already-dead provider child stdin surface as uncaught EPIPEs
 *    the stream guard cannot reach. Swallow only broken-pipe *write* errors;
 *    every other uncaught error is logged and handed to `report` (a crash
 *    report file). Registering a listener suppresses Electron's built-in
 *    "A JavaScript error occurred in the main process" box, and this guard
 *    deliberately never brings it back: a failure is not answered with a
 *    native popup, and the app keeps running as it did with that box.
 */

const STREAM_SWALLOWED_CODES = new Set(['EPIPE', 'EIO', 'EBADF', 'ERR_STREAM_DESTROYED']);
const UNCAUGHT_SWALLOWED_CODES = new Set(['EPIPE', 'EIO']);

/**
 * Stream-level 'error' events on stdio are benign for a GUI app.
 * @param {unknown} err
 * @returns {boolean}
 */
function isBrokenPipeStreamError(err) {
  const code = err && typeof err === 'object' ? String(err.code || '') : '';
  return STREAM_SWALLOWED_CODES.has(code);
}

/**
 * Uncaught-exception classifier: only broken-pipe *write* failures are safe to
 * swallow globally. Read-side EIO/EBADF may point at real fs bugs and must
 * stay visible.
 * @param {unknown} err
 * @returns {boolean}
 */
function shouldSwallowUncaught(err) {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const code = String(err.code || '');
  if (code === 'ERR_STREAM_DESTROYED') {
    return true;
  }
  if (!UNCAUGHT_SWALLOWED_CODES.has(code)) {
    return false;
  }
  return String(err.syscall || '').startsWith('write');
}

/**
 * @param {NodeJS.WriteStream | null | undefined} stream
 * @param {(message: string) => void} [log]
 */
function guardStream(stream, log) {
  if (!stream || typeof stream.on !== 'function' || stream.__dshStdioGuard) {
    return;
  }
  stream.__dshStdioGuard = true;
  stream.on('error', (err) => {
    if (isBrokenPipeStreamError(err)) {
      return;
    }
    if (log) {
      log(`stdio 流错误：${(err && err.message) || err}`);
    }
  });
}

/**
 * @param {{ log?: (message: string) => void }} [options]
 */
function installStdioGuard(options = {}) {
  guardStream(process.stdout, options.log);
  guardStream(process.stderr, options.log);
}

/**
 * Decide + act on one uncaught exception. Split from the listener for tests.
 * @param {Error} err
 * @param {{ log?: (message: string) => void, report?: (err: Error) => unknown }} deps
 * @returns {'swallowed' | 'reported'}
 */
function handleUncaughtException(err, deps = {}) {
  const log = deps.log || (() => {});
  if (shouldSwallowUncaught(err)) {
    log(`忽略断管写入异常：${(err && err.message) || err}`);
    return 'swallowed';
  }
  log(`主进程未捕获异常：${(err && err.stack) || err}`);
  // The report is a diagnostic aid: it may fail, but never into a second uncaught error.
  try {
    void Promise.resolve(deps.report?.(err)).catch(() => {});
  } catch {
    // Reporting failed synchronously; the error is already in the log.
  }
  return 'reported';
}

/**
 * @param {{ log?: (message: string) => void, report?: (err: Error) => unknown }} [options]
 */
function installUncaughtBrokenPipeGuard(options = {}) {
  if (process.__dshUncaughtBrokenPipeGuard) {
    return;
  }
  process.__dshUncaughtBrokenPipeGuard = true;
  process.on('uncaughtException', (err) => {
    handleUncaughtException(err, options);
  });
}

module.exports = {
  installStdioGuard,
  installUncaughtBrokenPipeGuard,
  guardStream,
  handleUncaughtException,
  isBrokenPipeStreamError,
  shouldSwallowUncaught,
};
