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
const manifest = require('./manifest');
const zip = require('./zip');

class DeltaApplyError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
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

async function preflightBase(targetDir, files, deps = {}) {
  const fsx = deps.fs || fs;
  const skip = new Set();
  for (const row of files) {
    const target = resolveTarget(targetDir, row.path);
    const exists = fsx.existsSync(target);
    if (row.op === 'add') {
      if (exists) {
        const actual = await manifest.sha256File(target, deps);
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
    const actual = await manifest.sha256File(target, deps);
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

  const version = (value) => String(value || '').trim().replace(/^v/i, '');
  if ((options.expectedFromVersion && version(doc.fromVersion) !== version(options.expectedFromVersion))
    || (options.expectedToVersion && version(doc.toVersion) !== version(options.expectedToVersion))
    || (options.expectedProduct
      && manifest.deltaAssetName(doc.product, '', '') !== manifest.deltaAssetName(options.expectedProduct, '', ''))) {
    throw new DeltaApplyError('manifest-target-mismatch', 'delta manifest does not match the selected product and versions');
  }

  const skip = await preflightBase(targetDir, doc.files, deps);
  if (typeof options.beforeApply === 'function') {
    // Reject an invalid target or drifted base while the desktop stays live.
    // The protected shutdown owns the last boundary before any target write.
    const admitted = await options.beforeApply();
    if (admitted?.ok === false) {
      return admitted;
    }
  }

  const stagingDir = path.join(targetDir, `.dshd-delta-${process.pid}-${Date.now().toString(36)}`);
  const backups = []; // { target, backup } — rename-restorable
  const placed = [];  // { target } — committed adds/patches
  const applied = { added: 0, patched: 0, deleted: 0, skipped: 0 };
  try {
    fsx.mkdirSync(stagingDir, { recursive: true });
    const staged = await extractPayloads(zipFile, entries, doc.files, stagingDir, deps, onProgress);
    applied.skipped = skip.size;
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'apply', percent: 0 });
    }
    let step = 0;
    const total = doc.files.length - skip.size || 1;
    for (const row of doc.files) {
      if (skip.has(row.path)) {
        continue;
      }
      const target = resolveTarget(targetDir, row.path);
      if ((row.op === 'patch' || row.op === 'delete') && fsx.existsSync(target)) {
        const backup = path.join(stagingDir, 'old', String(backups.length));
        fsx.mkdirSync(path.dirname(backup), { recursive: true });
        fsx.renameSync(target, backup);
        backups.push({ target, backup });
      }
      if (row.op === 'add' || row.op === 'patch') {
        fsx.mkdirSync(path.dirname(target), { recursive: true });
        fsx.renameSync(staged.get(row.path), target);
        placed.push({ target });
      }
      applied[row.op === 'add' ? 'added' : row.op === 'patch' ? 'patched' : 'deleted'] += 1;
      step += 1;
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'apply', percent: Math.round((step / total) * 100) });
      }
    }
    for (const row of doc.files) {
      if (row.op === 'delete' && !skip.has(row.path)) {
        pruneEmptyDirs(targetDir, row.path, deps);
      }
    }
  } catch (error) {
    // Roll back: un-place committed writes, restore backups — a locked exe
    // or an ACL denial mid-commit must leave the OLD tree, not a hybrid.
    try { fsx.mkdirSync(path.join(stagingDir, 'rolledback'), { recursive: true }); } catch { /* best effort */ }
    for (let i = placed.length - 1; i >= 0; i -= 1) {
      try {
        if (fsx.existsSync(placed[i].target)) {
          fsx.renameSync(placed[i].target, path.join(stagingDir, 'rolledback', String(i)));
        }
      } catch { /* best effort */ }
    }
    for (let i = backups.length - 1; i >= 0; i -= 1) {
      try {
        if (!fsx.existsSync(backups[i].target) && fsx.existsSync(backups[i].backup)) {
          fsx.renameSync(backups[i].backup, backups[i].target);
        }
      } catch { /* best effort */ }
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

module.exports = { applyDeltaFile, DeltaApplyError };
