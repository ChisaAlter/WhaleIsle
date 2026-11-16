'use strict';

/**
 * Shared filesystem-safety primitives. One canonical implementation for each
 * operation so call sites cannot grow divergent ad-hoc copies:
 * - atomicWriteFile/atomicWriteFileSync: same-directory temp + fsync + rename,
 *   permission preservation, temp cleanup on failure.
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
    await fs.promises.rename(tmp, file);
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
    fs.renameSync(tmp, file);
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
  safeRemove,
  safeRemoveSync,
  withOwnedTempDir,
  createUniqueDir,
};
