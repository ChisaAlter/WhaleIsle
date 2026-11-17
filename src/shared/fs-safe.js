'use strict';

/**
 * Shared filesystem-safety primitives. One canonical implementation for each
 * operation so call sites cannot grow divergent ad-hoc copies:
 * - atomicWriteFile/atomicWriteFileSync: same-directory temp + fsync + rename,
 *   permission preservation, temp cleanup on failure. On Windows the rename
 *   step retries the transient sharing-violation codes for a bounded window.
 * - renameWithRetry/renameWithRetrySync: that bounded retry on its own, for
 *   callers that already staged their own temp file.
 * - safeRemove/safeRemoveSync: best-effort force removal that never throws.
 * - withOwnedTempDir: mkdtemp under os.tmpdir() with guarded teardown.
 * - createUniqueDir: mkdtemp under a caller-chosen parent for the cases that
 *   outlive one callback scope (teardown wired by the caller).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tempPathFor(file) {
  const random = crypto.randomBytes(8).toString('hex');
  return path.join(path.dirname(file), `${path.basename(file)}.${process.pid}.${random}.tmp`);
}

function modeForSync(file, options) {
  if (options.mode !== undefined) return options.mode;
  try {
    return fs.statSync(file).mode & 0o7777;
  } catch {
    return 0o666;
  }
}

async function modeFor(file, options) {
  if (options.mode !== undefined) return options.mode;
  try {
    return (await fs.promises.stat(file)).mode & 0o7777;
  } catch {
    return 0o666;
  }
}

// Windows refuses rename over a destination still held by another handle —
// a concurrent reader, indexer or antivirus scan — and reports the transient
// failure as EPERM/EACCES/EBUSY. Retry only those codes, only on win32, with
// a bounded exponential backoff; every other error and platform fails through
// immediately, and the last error is rethrown once the budget is spent.
const RENAME_RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_BUDGET_MS = 2000;
const RENAME_RETRY_DELAY_MS = 25;

const renameRetryWait = ms => new Promise(resolve => setTimeout(resolve, ms));
const renameRetryWaitSync = (() => {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  return ms => Atomics.wait(cell, 0, 0, ms);
})();

function renameRetryable(error, platform) {
  return platform === 'win32' && RENAME_RETRYABLE_CODES.has(error && error.code);
}

function renameRetryOptions(options) {
  return {
    platform: options.platform ?? process.platform,
    deadline: Date.now() + (options.budgetMs ?? RENAME_RETRY_BUDGET_MS),
    delayMs: RENAME_RETRY_DELAY_MS,
  };
}

/**
 * Rename `from` over `to`, tolerating transient Windows sharing violations
 * (see above). Test seams: `options.rename` supplies the rename call,
 * `options.platform` the platform gate, `options.sleep` the backoff wait and
 * `options.budgetMs` the total retry window. The vendored copy in
 * vendor/dsh-project/lib/files.js implements the same contract because the
 * plugin runtime is copied into profiles and cannot import this file; its
 * behavior is pinned by the cases in fs-safe.test.js.
 */
async function renameWithRetry(from, to, options = {}) {
  const rename = options.rename ?? fs.promises.rename.bind(fs.promises);
  const wait = options.sleep ?? renameRetryWait;
  const retry = renameRetryOptions(options);
  for (;;) {
    try {
      return await rename(from, to);
    } catch (error) {
      if (!renameRetryable(error, retry.platform) || Date.now() >= retry.deadline) throw error;
      await wait(retry.delayMs);
      retry.delayMs = Math.min(retry.delayMs * 2, 250);
    }
  }
}

function renameWithRetrySync(from, to, options = {}) {
  const rename = options.rename ?? fs.renameSync.bind(fs);
  const wait = options.sleep ?? renameRetryWaitSync;
  const retry = renameRetryOptions(options);
  for (;;) {
    try {
      return rename(from, to);
    } catch (error) {
      if (!renameRetryable(error, retry.platform) || Date.now() >= retry.deadline) throw error;
      wait(retry.delayMs);
      retry.delayMs = Math.min(retry.delayMs * 2, 250);
    }
  }
}

/**
 * Write `data` to `file` atomically: a uniquely named sibling temp file is
 * written and fsynced, then renamed over the target. An existing target keeps
 * its permission bits unless `options.mode` overrides them. On any failure the
 * temp file is removed and the original error is rethrown.
 */
async function atomicWriteFile(file, data, options = {}) {
  const tmp = tempPathFor(file);
  let handle;
  let renamed = false;
  try {
    handle = await fs.promises.open(tmp, 'w', await modeFor(file, options));
    await handle.writeFile(data, { encoding: options.encoding });
    if (options.fsync !== false) await handle.sync();
    await handle.close();
    handle = undefined;
    await renameWithRetry(tmp, file);
    renamed = true;
  } finally {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await fs.promises.unlink(tmp).catch(() => {});
  }
}

function atomicWriteFileSync(file, data, options = {}) {
  const tmp = tempPathFor(file);
  let fd;
  let renamed = false;
  try {
    fd = fs.openSync(tmp, 'w', modeForSync(file, options));
    fs.writeFileSync(fd, data, { encoding: options.encoding });
    if (options.fsync !== false) fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    renameWithRetrySync(tmp, file);
    renamed = true;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    }
  }
}

/**
 * Remove a file or directory tree without throwing. Intended for cleanup
 * paths where a removal failure must not overwrite an otherwise good result
 * or corrupt long-lived service state.
 */
async function safeRemove(target, options = {}) {
  try {
    await fs.promises.rm(target, { recursive: true, force: true });
    return { ok: true, error: null };
  } catch (error) {
    if (typeof options.log === 'function') options.log(target, error);
    return { ok: false, error };
  }
}

function safeRemoveSync(target, options = {}) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, error: null };
  } catch (error) {
    if (typeof options.log === 'function') options.log(target, error);
    return { ok: false, error };
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Run `fn` with a fresh directory created under os.tmpdir(). The directory is
 * recursively removed afterwards — but only while it is still the very same
 * directory this helper created: a resolved path that lands outside the
 * resolved os.tmpdir(), a symlink/junction, or a replaced entry is left
 * untouched so teardown can never follow a link into unowned data.
 *
 * `options.rmOptions` extends the guarded fs.promises.rm call (e.g.
 * `{ maxRetries, retryDelay }` for consumers that release handles a moment
 * after their process exits).
 */
async function withOwnedTempDir(prefix, fn, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), String(prefix)));
  const created = fs.lstatSync(dir);
  try {
    return await fn(dir);
  } finally {
    const current = lstatOrNull(dir);
    const owned = Boolean(current)
      && !current.isSymbolicLink()
      && current.isDirectory()
      && current.dev === created.dev
      && current.ino === created.ino;
    if (owned) {
      let real;
      try {
        real = fs.realpathSync(dir);
      } catch {
        real = null;
      }
      let tmpRoot;
      try {
        tmpRoot = fs.realpathSync(os.tmpdir());
      } catch {
        tmpRoot = path.resolve(os.tmpdir());
      }
      if (real && isInside(tmpRoot, real)) {
        await fs.promises.rm(dir, { recursive: true, force: true, ...options.rmOptions }).catch(() => {});
      }
    }
  }
}

/**
 * Create a uniquely named directory under `parent` and return its path.
 * Unlike withOwnedTempDir nothing removes it automatically — the caller owns
 * teardown, so use this only when the directory outlives one callback scope:
 * a fixture reclaimed by test teardown, a root handed to the detached cleanup
 * supervisor (scripts/lib/owned-dir-supervisor.cjs), or an explicitly retained
 * evidence directory under a non-temp parent.
 */
function createUniqueDir(parent, prefix) {
  return fs.mkdtempSync(path.join(String(parent), String(prefix)));
}

module.exports = {
  atomicWriteFile,
  atomicWriteFileSync,
  renameWithRetry,
  renameWithRetrySync,
  safeRemove,
  safeRemoveSync,
  withOwnedTempDir,
  createUniqueDir,
};
