'use strict';

// Apply a verified delta zip to an installed-runtime directory.
//   1. artifact sha512 (the SHA512SUMS.txt gate) when expectedSha512 given
//   2. manifest parse + per-payload sha256/size verification into a staging
//      dir INSIDE the target tree (same volume → atomic renames)
//   3. base-hash preflight on every file being patched/deleted — a drifted
//      base aborts before a single target byte is touched
//   4. commit by rename with rollback, then drop staging.
const fs = require('fs');
const path = require('path');
const { checkInstallSpace } = require('../../main/install-space');
const { renameWithRetrySync } = require('../../shared/fs-safe');
const manifest = require('./manifest');
const zip = require('./zip');

const STAGING_PREFIX = '.dshd-delta-';
const JOURNAL_FILE = 'journal.json';

class DeltaApplyError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    /** @type {boolean | undefined} */
    this.rollbackIncomplete = undefined;
    if (detail !== undefined) {
      this.detail = detail;
    }
  }
}

function resolveTarget(targetDir, rel) {
  const full = path.resolve(targetDir, ...rel.split('/'));
  const root = path.resolve(targetDir);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new DeltaApplyError('manifest-invalid', `path escapes target dir: ${rel}`);
  }
  return full;
}

async function extractPayloads(zipFile, entries, files, stagingDir, deps, onProgress) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const writes = files.filter((row) => row.op === 'add' || row.op === 'patch');
  const staged = new Map();
  for (let i = 0; i < writes.length; i += 1) {
    const row = writes[i];
    const entry = byName.get(row.payload);
    if (!entry) {
      throw new DeltaApplyError('payload-missing', `payload ${row.payload} not in archive`);
    }
    const dest = path.join(stagingDir, 'new', String(i));
    await zip.extractEntryTo(zipFile, entry, dest, deps);
    const actual = await manifest.sha256File(dest, deps);
    if (actual !== row.sha256) {
      throw new DeltaApplyError('payload-mismatch', `payload sha256 mismatch for ${row.path}`, row.path);
    }
    staged.set(row.path, dest);
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'verify', percent: Math.round(((i + 1) / writes.length) * 100) });
    }
  }
  return staged;
}

async function baseFileHash(target, rel, deps) {
  try {
    return await manifest.sha256File(target, deps);
  } catch (error) {
    // A slot that cannot be hashed (e.g. a directory where the manifest
    // expects a file) never holds the expected bytes — refuse like a missing
    // or drifted base instead of leaking the raw errno.
    throw new DeltaApplyError('base-mismatch', `base unreadable: ${rel} (${error.code || error.message})`, rel);
  }
}

async function preflightBase(targetDir, files, deps = {}) {
  const fsx = deps.fs || fs;
  const skip = new Set();
  for (const row of files) {
    const target = resolveTarget(targetDir, row.path);
    const exists = fsx.existsSync(target);
    if (row.op === 'add') {
      if (exists) {
        const actual = await baseFileHash(target, row.path, deps);
        if (actual === row.sha256) {
          skip.add(row.path);
        } else {
          throw new DeltaApplyError('base-mismatch', `add target already exists with other content: ${row.path}`, row.path);
        }
      }
      continue;
    }
    if (!exists) {
      if (row.op === 'delete') {
        skip.add(row.path); // already absent — delete is a no-op
        continue;
      }
      throw new DeltaApplyError('base-mismatch', `base file missing: ${row.path}`, row.path);
    }
    const actual = await baseFileHash(target, row.path, deps);
    if (row.op === 'patch' && actual === row.sha256) {
      skip.add(row.path); // already at target content — re-apply is a no-op
      continue;
    }
    if (actual !== row.baseSha256) {
      throw new DeltaApplyError('base-mismatch', `base file drifted: ${row.path}`, row.path);
    }
  }
  return skip;
}

function pruneEmptyDirs(targetDir, relPath, deps = {}) {
  const fsx = deps.fs || fs;
  let dir = path.dirname(resolveTarget(targetDir, relPath));
  const root = path.resolve(targetDir);
  while (dir.startsWith(root + path.sep)) {
    try {
      fsx.rmdirSync(dir);
    } catch {
      break; // non-empty or locked — stop climbing this chain
    }
    dir = path.dirname(dir);
  }
}

/**
 * @param {string} from
 * @param {string} to
 * @param {any} fsx
 * @param {any} [deps]
 */
function renameSyncWithRetry(from, to, fsx, deps = {}) {
  return renameWithRetrySync(from, to, {
    rename: fsx.renameSync.bind(fsx),
    sleep: deps.sleep,
  });
}

/**
 * @param {string} journalPath
 * @param {any} journal
 * @param {any} fsx
 */
function writeJournalSync(journalPath, journal, fsx) {
  const tmp = `${journalPath}.tmp`;
  fsx.writeFileSync(tmp, JSON.stringify(journal), 'utf8');
  fsx.renameSync(tmp, journalPath);
}

/**
 * @param {string} candidate
 * @param {string} parentDir
 */
function isInsideDir(candidate, parentDir) {
  const resolved = path.resolve(candidate);
  const root = path.resolve(parentDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * @param {string} rolledBackDir
 * @param {string} target
 * @param {string} opPath
 * @param {number} index
 * @param {any} fsx
 * @param {any} deps
 */
function tryUnplaceTarget(rolledBackDir, target, opPath, index, fsx, deps) {
  try {
    fsx.mkdirSync(rolledBackDir, { recursive: true });
    renameSyncWithRetry(target, path.join(rolledBackDir, String(index)), fsx, deps);
    return null;
  } catch (err) {
    return { path: opPath, step: 'unplace', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {string} backup
 * @param {string} target
 * @param {string} opPath
 * @param {any} fsx
 * @param {any} deps
 */
function tryRestoreBackup(backup, target, opPath, fsx, deps) {
  try {
    fsx.mkdirSync(path.dirname(target), { recursive: true });
    renameSyncWithRetry(backup, target, fsx, deps);
    return null;
  } catch (err) {
    return { path: opPath, step: 'restore', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * @param {string} targetDir
 * @param {string} stagingDir
 * @param {string} rolledBackDir
 * @param {any} op
 * @param {number} index
 * @param {any} fsx
 * @param {any} deps
 */
function rollbackOneOp(targetDir, stagingDir, rolledBackDir, op, index, fsx, deps) {
  if (!op || typeof op.path !== 'string') return [];
  let target;
  try {
    target = resolveTarget(targetDir, op.path);
  } catch (err) {
    return [{ path: op.path, step: 'validate', error: err instanceof Error ? err.message : String(err) }];
  }
  const backup = typeof op.backup === 'string' && isInsideDir(op.backup, stagingDir) ? op.backup : null;
  const hasBackup = Boolean(backup && fsx.existsSync(backup));
  if ((op.op === 'add' || op.op === 'patch') && fsx.existsSync(target) && (op.op === 'add' || hasBackup)) {
    const err = tryUnplaceTarget(rolledBackDir, target, op.path, index, fsx, deps);
    if (err) return [err];
  }
  if ((op.op === 'patch' || op.op === 'delete') && hasBackup && backup && !fsx.existsSync(target)) {
    const err = tryRestoreBackup(backup, target, op.path, fsx, deps);
    if (err) return [err];
  }
  return [];
}

/**
 * @param {string} targetDir
 * @param {string} stagingDir
 * @param {any} journal
 * @param {any} fsx
 * @param {any} [deps]
 */
function rollbackJournal(targetDir, stagingDir, journal, fsx, deps = {}) {
  const errors = [];
  const ops = Array.isArray(journal?.ops) ? journal.ops : [];
  const rolledBackDir = path.join(stagingDir, 'rolledback');
  for (let i = ops.length - 1; i >= 0; i -= 1) {
    errors.push(...rollbackOneOp(targetDir, stagingDir, rolledBackDir, ops[i], i, fsx, deps));
  }
  return errors;
}

/**
 * @param {string} targetDir
 * @param {string} stagingDir
 * @param {any} journal
 * @param {any} fsx
 * @param {any} deps
 */
function finalizeCommittedStaging(targetDir, stagingDir, journal, fsx, deps) {
  for (const op of Array.isArray(journal.ops) ? journal.ops : []) {
    if (op?.op === 'delete' && typeof op.path === 'string') {
      try { pruneEmptyDirs(targetDir, op.path, deps); } catch { /* non-fatal */ }
    }
  }
  try { fsx.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
}

/**
 * @param {string} targetDir
 * @param {string} stagingDir
 * @param {any} fsx
 * @param {any} deps
 */
function recoverSingleStagingDir(targetDir, stagingDir, fsx, deps) {
  const journalPath = path.join(stagingDir, JOURNAL_FILE);
  if (!fsx.existsSync(journalPath)) {
    try { fsx.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
    return null;
  }
  let journal;
  try {
    journal = JSON.parse(fsx.readFileSync(journalPath, 'utf8'));
  } catch (err) {
    return { stagingDir, errors: [{ path: JOURNAL_FILE, step: 'parse', error: err instanceof Error ? err.message : String(err) }] };
  }
  if (journal?.phase === 'committed') {
    finalizeCommittedStaging(targetDir, stagingDir, journal, fsx, deps);
    return null;
  }
  const errors = rollbackJournal(targetDir, stagingDir, journal, fsx, deps);
  if (errors.length === 0) {
    try { fsx.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
    return null;
  }
  return { stagingDir, errors };
}

/**
 * Scan `targetDir` for interrupted `.dshd-delta-*` staging directories and
 * roll back or finalize them using their persisted `journal.json`. Preserves
 * any staging directory whose rollback could not complete so backups survive.
 * @param {string} targetDir
 * @param {any} [deps]
 */
function recoverPendingDeltas(targetDir, deps = {}) {
  const fsx = deps.fs || fs;
  if (!targetDir || !fsx.existsSync(targetDir)) return { recovered: 0, failed: [] };
  let names = [];
  try { names = fsx.readdirSync(targetDir); } catch { return { recovered: 0, failed: [] }; }
  let recovered = 0;
  const failed = [];
  for (const name of names) {
    if (typeof name !== 'string' || !name.startsWith(STAGING_PREFIX)) continue;
    const stagingDir = path.join(targetDir, name);
    try { if (!fsx.statSync(stagingDir).isDirectory()) continue; } catch { continue; }
    const failure = recoverSingleStagingDir(targetDir, stagingDir, fsx, deps);
    if (failure) failed.push(failure);
    else recovered += 1;
  }
  if (failed.length > 0) {
    throw new DeltaApplyError(
      'apply-failed',
      `delta recovery incomplete (${failed.length} staging dir(s) retained)`,
      { rollbackIncomplete: true, failed },
    );
  }
  return { recovered, failed };
}

/**
 * @param {string} targetDir
 * @param {string} stagingDir
 * @param {any[]} files
 * @param {Set<string>} skip
 * @param {Map<string, string>} staged
 */
function buildJournalOps(targetDir, stagingDir, files, skip, staged) {
  let backupIdx = 0;
  const ops = [];
  for (const row of files) {
    if (skip.has(row.path)) continue;
    const target = resolveTarget(targetDir, row.path);
    const backup = (row.op === 'patch' || row.op === 'delete')
      ? path.join(stagingDir, 'old', String(backupIdx++))
      : null;
    ops.push({ path: row.path, op: row.op, target, backup, staged: staged.get(row.path) || null });
  }
  return ops;
}

/**
 * @param {string} targetDir
 * @param {any[]} files
 * @param {any} fsx
 * @param {any} deps
 */
function checkDeltaInstallSpace(targetDir, files, fsx, deps) {
  const checkSpace = deps.checkInstallSpace || checkInstallSpace;
  const requiredBytes = files.reduce(
    (/** @type {number} */ sum, /** @type {any} */ row) => sum + ((row.op === 'add' || row.op === 'patch') ? row.size : 0),
    0,
  );
  try {
    checkSpace(targetDir, requiredBytes, { statfs: fsx.statfsSync, reserve: deps.spaceReserve });
  } catch (error) {
    if (error instanceof DeltaApplyError) throw error;
    const err = /** @type {any} */ (error);
    throw new DeltaApplyError('apply-failed', err?.message || String(error), err?.code);
  }
}

/** @param {unknown} value */
function normalizeDeltaVersion(value) {
  return String(value || '').trim().replace(/^v/i, '');
}

/** @param {{ op?: string, path: string }} row */
function isTopLevelProductExeDelete(row) {
  return row.op === 'delete'
    && !row.path.includes('/')
    && /\.exe$/i.test(row.path)
    && !/^uninstall(?: |\.)/i.test(row.path);
}

/**
 * @param {{ fromVersion?: string, toVersion?: string, product?: string, files: Array<{ op?: string, path: string }> }} doc
 * @param {{ expectedFromVersion?: string, expectedToVersion?: string, expectedProduct?: string }} [options]
 */
function assertManifestCompatible(doc, options = {}) {
  if ((options.expectedFromVersion && normalizeDeltaVersion(doc.fromVersion) !== normalizeDeltaVersion(options.expectedFromVersion))
    || (options.expectedToVersion && normalizeDeltaVersion(doc.toVersion) !== normalizeDeltaVersion(options.expectedToVersion))
    || (options.expectedProduct
      && manifest.deltaAssetName(doc.product, '', '') !== manifest.deltaAssetName(options.expectedProduct, '', ''))) {
    throw new DeltaApplyError('manifest-target-mismatch', 'delta manifest does not match the selected product and versions');
  }
  const deletedTopExe = doc.files.find(isTopLevelProductExeDelete);
  if (deletedTopExe) {
    throw new DeltaApplyError(
      'executable-renamed',
      `delta removes top-level executable (${deletedTopExe.path}); full installer required`,
      deletedTopExe.path,
    );
  }
}

/**
 * @returns {Promise<{ok:true, fromVersion, toVersion, applied:{added,patched,deleted,skipped}}|{ok:false}>}
 * @throws {DeltaApplyError} code ∈ artifact-sha512-mismatch | bad-zip |
 *   manifest-invalid | base-mismatch | payload-* | apply-failed — no partial
 *   tree is accepted after an error.
 */
async function applyDeltaFile(zipFile, targetDir, options = {}, deps = {}) {
  const fsx = deps.fs || fs;
  const onProgress = options.onProgress;
  if (!targetDir || !fsx.existsSync(targetDir)) {
    throw new DeltaApplyError('target-missing', `target dir does not exist: ${targetDir}`);
  }
  recoverPendingDeltas(targetDir, deps);
  if (options.expectedSha512) {
    const actual = await manifest.sha512File(zipFile, deps);
    if (actual !== String(options.expectedSha512).toLowerCase()) {
      throw new DeltaApplyError('artifact-sha512-mismatch', 'delta artifact sha512 mismatch');
    }
  }
  let entries;
  try {
    entries = zip.readZip(zipFile, deps);
  } catch (error) {
    throw new DeltaApplyError('bad-zip', error.message || String(error));
  }
  const manifestEntry = entries.find((entry) => entry.name === manifest.MANIFEST_ENTRY);
  if (!manifestEntry) {
    throw new DeltaApplyError('manifest-invalid', 'manifest.json missing from archive');
  }
  let doc;
  try {
    doc = manifest.validateManifest(zip.readEntry(zipFile, manifestEntry, deps).toString('utf8'));
  } catch (error) {
    if (error instanceof DeltaApplyError) {
      throw error;
    }
    throw new DeltaApplyError(error.code === 'manifest-invalid' ? 'manifest-invalid' : 'bad-zip',
      error.message || String(error));
  }

  assertManifestCompatible(doc, options);

  const skip = await preflightBase(targetDir, doc.files, deps);
  checkDeltaInstallSpace(targetDir, doc.files, fsx, deps);
  if (typeof options.beforeApply === 'function') {
    // Reject an invalid target or drifted base while the desktop stays live.
    // The protected shutdown owns the last boundary before any target write.
    const admitted = await options.beforeApply();
    if (admitted?.ok === false) {
      return admitted;
    }
  }

  const stagingDir = path.join(targetDir, `${STAGING_PREFIX}${process.pid}-${Date.now().toString(36)}`);
  const journalPath = path.join(stagingDir, JOURNAL_FILE);
  let journal = null;
  const applied = { added: 0, patched: 0, deleted: 0, skipped: 0 };
  try {
    fsx.mkdirSync(stagingDir, { recursive: true });
    const staged = await extractPayloads(zipFile, entries, doc.files, stagingDir, deps, onProgress);
    applied.skipped = skip.size;

    const ops = buildJournalOps(targetDir, stagingDir, doc.files, skip, staged);
    const nextJournal = {
      version: 1,
      phase: 'committing',
      fromVersion: doc.fromVersion,
      toVersion: doc.toVersion,
      ops,
    };
    writeJournalSync(journalPath, nextJournal, fsx);
    journal = nextJournal;

    if (typeof onProgress === 'function') {
      onProgress({ phase: 'apply', percent: 0 });
    }
    let step = 0;
    const total = ops.length || 1;
    for (const op of ops) {
      if ((op.op === 'patch' || op.op === 'delete') && op.backup && fsx.existsSync(op.target)) {
        fsx.mkdirSync(path.dirname(op.backup), { recursive: true });
        renameSyncWithRetry(op.target, op.backup, fsx);
      }
      if ((op.op === 'add' || op.op === 'patch') && op.staged) {
        fsx.mkdirSync(path.dirname(op.target), { recursive: true });
        renameSyncWithRetry(op.staged, op.target, fsx);
      }
      applied[op.op === 'add' ? 'added' : op.op === 'patch' ? 'patched' : 'deleted'] += 1;
      step += 1;
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'apply', percent: Math.round((step / total) * 100) });
      }
    }
    journal.phase = 'committed';
    writeJournalSync(journalPath, journal, fsx);
    for (const op of ops) {
      if (op.op === 'delete') {
        pruneEmptyDirs(targetDir, op.path, deps);
      }
    }
  } catch (error) {
    // Roll back using persisted journal + retryable renames. Preserve stagingDir
    // whenever rollback fails so backups are never destroyed.
    if (journal) {
      journal.phase = 'rolling-back';
      try { writeJournalSync(journalPath, journal, fsx); } catch { /* best effort */ }
      const rollbackErrors = rollbackJournal(targetDir, stagingDir, journal, fsx, deps);
      if (rollbackErrors.length > 0) {
        const baseMsg = error instanceof Error ? error.message : String(error);
        const err = new DeltaApplyError(
          'apply-failed',
          `${baseMsg}; rollback incomplete (${rollbackErrors.length} error(s)), backup preserved`,
          { rollbackIncomplete: true, stagingDir, errors: rollbackErrors },
        );
        err.rollbackIncomplete = true;
        throw err;
      }
    }
    try { fsx.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* shell cleans */ }
    if (error instanceof DeltaApplyError) {
      throw error;
    }
    throw new DeltaApplyError('apply-failed', error.message || String(error));
  }
  try { fsx.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* non-fatal */ }
  return {
    ok: true,
    fromVersion: doc.fromVersion,
    toVersion: doc.toVersion,
    applied,
  };
}

module.exports = { applyDeltaFile, recoverPendingDeltas, DeltaApplyError };
