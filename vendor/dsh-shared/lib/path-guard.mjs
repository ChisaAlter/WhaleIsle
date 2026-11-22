/**
 * Zero-dependency shared filesystem boundary and atomic write helpers for
 * first-party vendored plugins (`dsh-whale`, `dsh-project`, `dsh-task-control`).
 */
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const identity = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);

/**
 * Canonical lexical comparison key treating Windows drive/path casing and
 * separator styles consistently.
 * @param {unknown} value
 * @returns {string}
 */
export function comparablePath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return identity(path.resolve(trimmed));
}

/**
 * Compare two paths for equivalence using platform-appropriate case rules.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function samePath(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!a.trim() || !b.trim()) return a.trim() === b.trim();
  return comparablePath(a) === comparablePath(b);
}

/**
 * Return true when `target` is identical to or lexically contained inside `root`.
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
export function withinPath(root, target) {
  const rel = path.relative(identity(path.resolve(root)), identity(path.resolve(target)));
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/**
 * Best-effort `realpathSync.native` on `candidate`, returning '' when missing.
 * @param {string} candidate
 * @returns {string}
 */
export function canonicalIfExists(candidate) {
  try {
    return fsSync.realpathSync.native(path.resolve(candidate));
  } catch {
    return '';
  }
}

/**
 * Resolve the deepest existing ancestor of `declared` via `realpathSync.native`
 * and re-append any non-existent trailing path segments.
 * @param {string} declared
 * @returns {string}
 */
export function canonicalExistingPath(declared) {
  const missing = [];
  let cursor = path.resolve(declared);
  while (true) {
    try {
      const real = fsSync.realpathSync.native(cursor);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (/** @type {any} */ error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return cursor;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

const RENAME_RETRYABLE_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_BUDGET_MS = 2000;
const RENAME_RETRY_DELAY_MS = 25;

/**
 * Rename with bounded exponential retry for transient Windows sharing
 * violations (`EPERM`, `EACCES`, `EBUSY`). Mirrors `src/shared/fs-safe.js`.
 * @param {string} from
 * @param {string} to
 * @param {{
 *   rename?: (a: string, b: string) => Promise<void> | void,
 *   sleep?: (ms: number) => Promise<void> | void,
 *   platform?: string,
 *   budgetMs?: number,
 * }} [options]
 */
export async function renameWithRetry(from, to, options = {}) {
  const rename = options.rename ?? fs.rename;
  const wait = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const platform = options.platform ?? process.platform;
  const deadline = Date.now() + (options.budgetMs ?? RENAME_RETRY_BUDGET_MS);
  let delayMs = RENAME_RETRY_DELAY_MS;
  for (;;) {
    try {
      return await rename(from, to);
    } catch (/** @type {any} */ error) {
      if (platform !== 'win32' || !RENAME_RETRYABLE_CODES.has(error?.code) || Date.now() >= deadline) {
        throw error;
      }
      await wait(delayMs);
      delayMs = Math.min(delayMs * 2, 250);
    }
  }
}

/**
 * Write UTF-8 text atomically via same-directory temporary file + retryable
 * rename, removing the temporary file if creation or rename fails.
 * @param {string} targetPath
 * @param {string} text
 * @param {Parameters<typeof renameWithRetry>[2]} [options]
 */
export async function atomicWriteText(targetPath, text, options = {}) {
  const temporary = `${targetPath}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await renameWithRetry(temporary, targetPath, options);
    renamed = true;
  } finally {
    if (!renamed) {
      await fs.unlink(temporary).catch(() => {
        /* Preserve original failure when temporary file is already absent. */
      });
    }
  }
}
