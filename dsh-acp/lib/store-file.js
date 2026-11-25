/**
 * Private on-disk state: JSON stores, diagnostic logs and plugin-owned
 * directories. Stores hold credentials (agent env), prompts and results, so
 * every file is owner-only, every replacement is atomic, and data that cannot
 * be read is preserved instead of being overwritten by the next save.
 */
import fs from 'node:fs';
import path from 'node:path';
import { redactSecrets } from './errors.js';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIR_MODE = 0o700;
export const MAX_LOG_BYTES = 1024 * 1024;

const POSIX = process.platform !== 'win32';
const WIN32 = process.platform === 'win32';
const WIN_RENAME_RETRIES = 6;
const WIN_RENAME_RETRY_MS = 20;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));
let tmpSequence = 0;
/** Stores that were unreadable at load, keyed by store path, for the settings UI. */
const issues = new Map();

function sleepSync(ms) {
  Atomics.wait(sleepArray, 0, 0, ms);
}

function isWindowsRenameLock(error) {
  const code = error?.code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}

function targetFileVersion(file) {
  try {
    const stat = fs.statSync(file);
    return {
      id: `${stat.ino}:${stat.size}:${stat.mtimeMs}`,
      readOnly: (stat.mode & 0o200) === 0,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { id: 'missing', readOnly: false };
    return null;
  }
}

function isSymbolicLinkPath(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

export function listStoreIssues(targetFiles) {
  const files = targetFiles ? [...new Set(targetFiles)].filter(Boolean) : [...issues.keys()];
  const result = [];
  for (const file of files) {
    refreshStoreIssues(file);
    result.push(...(issues.get(file) || []));
  }
  return result;
}

/** Restrict an existing plugin-owned file or directory that is group/world accessible. */
function tighten(target, mode) {
  if (!POSIX) return;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if ((stat.mode & 0o777) !== mode && stat.uid === process.getuid?.()) fs.chmodSync(target, mode);
  } catch { /* missing or not ours: nothing to tighten */ }
}

/** Create (or restrict) a directory owned by this plugin. */
export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  tighten(dir, PRIVATE_DIR_MODE);
  return dir;
}

/**
 * Create a directory that may be supplied by the user. New directories are
 * private; an existing directory's permissions are the user's choice.
 */
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  return dir;
}

/** Rebuild notices from preserved regular files, without reading or removing them. */
function refreshStoreIssues(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.corrupt-`;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { entries = []; }
  const previous = new Map((issues.get(file) || []).map((issue) => [issue.preservedAs, issue]));
  issues.set(file, entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix)
    && /^\d+$/.test(entry.name.slice(prefix.length))).map((entry) => {
    const preservedAs = path.join(dir, entry.name);
    return previous.get(preservedAs) || { file, preservedAs, reason: 'preserved after a previous read failure', at: Number(entry.name.slice(prefix.length)) };
  }));
}

/**
 * Read a JSON store. A missing file yields `fallback`. A file that cannot be
 * parsed, or whose shape `accept` rejects, is renamed aside (owner-only) so the
 * next save cannot overwrite the user's data; the issue is recorded for the
 * settings UI and `fallback` is returned.
 */
export function readJsonStore(file, { accept = () => true, fallback, warn = console.warn } = {}) {
  refreshStoreIssues(file);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
  tighten(file, PRIVATE_FILE_MODE);
  let reason;
  try {
    const parsed = JSON.parse(raw);
    if (accept(parsed)) {
      return parsed;
    }
    reason = 'unrecognized structure';
  } catch (error) { reason = error.message; }
  let at = Date.now();
  while (fs.existsSync(`${file}.corrupt-${at}`)) at++;
  const preservedAs = `${file}.corrupt-${at}`;
  fs.renameSync(file, preservedAs);
  tighten(preservedAs, PRIVATE_FILE_MODE);
  issues.get(file).push({ file, preservedAs, reason, at });
  warn(`[dsh-acp-agents] ${path.basename(file)} could not be read (${reason}). It was preserved as ${preservedAs}; starting with an empty store.`);
  return fallback;
}

/** Atomically replace a JSON store with an owner-only file. */
export function writeJsonStore(file, payload) {
  if (isSymbolicLinkPath(file)) {
    throw new Error(`Refusing to write store "${path.basename(file)}" through a symbolic link.`);
  }
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${++tmpSequence}`;
  const fd = fs.openSync(tmp, 'wx', PRIVATE_FILE_MODE);
  try {
    try {
      fs.writeFileSync(fd, payload, { encoding: 'utf8' });
      try { fs.fsyncSync(fd); } catch { /* best-effort durability */ }
    } finally {
      fs.closeSync(fd);
    }
    if (!WIN32) {
      fs.renameSync(tmp, file);
      return;
    }
    const before = targetFileVersion(file);
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (firstError) {
      if (!isWindowsRenameLock(firstError) || !before || before.readOnly) throw firstError;
      for (let attempt = 0; attempt < WIN_RENAME_RETRIES; attempt += 1) {
        sleepSync(WIN_RENAME_RETRY_MS);
        const current = targetFileVersion(file);
        if (!current || current.id !== before.id) break;
        try {
          fs.renameSync(tmp, file);
          return;
        } catch (retryError) {
          if (!isWindowsRenameLock(retryError)) throw retryError;
        }
      }
      throw firstError;
    }
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * Append to an owner-only diagnostic log with secrets redacted. When the log
 * exceeds `maxBytes` it is rotated to `<file>.1`, replacing the previous one.
 * Diagnostics never throw into the caller.
 */
export function appendPrivateLog(file, text, { maxBytes = MAX_LOG_BYTES } = {}) {
  try {
    if (isSymbolicLinkPath(file)) return;
    ensureDir(path.dirname(file));
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) return;
      if (stat.size >= maxBytes && !isSymbolicLinkPath(`${file}.1`)) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* no current log */ }
    if (isSymbolicLinkPath(file)) return;
    fs.appendFileSync(file, redactSecrets(text), { mode: PRIVATE_FILE_MODE });
    tighten(file, PRIVATE_FILE_MODE);
  } catch { /* diagnostics must never break the caller */ }
}

/** Optional stage tracing enabled by DSH_ACP_STAGE_LOG=<file path>. */
export function stageLog(msg) {
  const file = process.env.DSH_ACP_STAGE_LOG;
  if (!file) return;
  appendPrivateLog(file, `${new Date().toISOString()} ${msg}\n`);
}
