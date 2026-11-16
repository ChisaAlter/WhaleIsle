'use strict';

const fs = require('fs');
const path = require('path');
const { atomicWriteFileSync } = require('../shared/fs-safe');

/**
 * Journaled directory replacement: stages the new tree under a unique
 * `<dest>.import-tmp-<opId>` name, persists intent to a per-operation
 * journal file, renames the live destination to `<dest>.import-bak-<opId>`,
 * moves staging into place, records the commit, and only then removes the
 * backup. A crash at any point leaves at least one intact copy on disk and
 * enough journal state for `recoverImportTransactions()` to reconcile it.
 *
 * This replaces the older `copyDirAtomic()` which deleted the destination
 * before renaming staging: a crash inside that window left neither the old
 * nor the new tree, and the recovery sweep then deleted the only remaining
 * copy (the staging dir).
 */

const JOURNAL_VERSION = 1;
const TMP_SUFFIX = '.import-tmp';
const BAK_SUFFIX = '.import-bak';
const TXN_SUFFIX = '.import-txn';
// Shared zero-authorization inventory: callers that omit ownership context
// get this set so recovery fails closed (inspect/report only, never mutate).
const EMPTY_SET = new Set();
// Directory names the recovery sweep descends into even though they start
// with a dot (presets live under `.agent-presets`). Everything else hidden is
// still skipped.
const HIDDEN_SWEEP_DIRS = new Set(['.agent-presets']);

function tmpName(dest, opId) { return `${dest}${TMP_SUFFIX}-${opId}`; }
function bakName(dest, opId) { return `${dest}${BAK_SUFFIX}-${opId}`; }
function txnName(dest, opId) { return `${dest}${TXN_SUFFIX}-${opId}`; }

let opCounter = 0;
function nextOpId() {
  opCounter += 1;
  return `${Date.now().toString(36)}-${process.pid.toString(36)}-${opCounter.toString(36)}`;
}

function samePath(left, right) {
  const a = path.resolve(String(left || ''));
  const b = path.resolve(String(right || ''));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInside(root, child) {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Canonicalize a path's *existing* ancestor chain so junction/symlink
 * aliases are caught, not merely normalized lexically. `realpathSync` only
 * resolves existing components; walk up until something exists, resolve
 * that, then re-append the unresolved tail. Returns null when nothing on
 * the chain exists or resolution fails (a dangling/uncheckable parent is
 * not a safe write boundary).
 */
function canonicalParentChain(p) {
  let cursor = path.resolve(p);
  const tail = [];
  // Descend until we hit an existing ancestor.
  for (;;) {
    try {
      const real = fs.realpathSync(cursor);
      return path.join(real, ...tail.reverse());
    } catch (error) {
      // Only ENOENT means "this component does not exist yet" — keep walking
      // up to find an existing ancestor to anchor on. Any OTHER failure
      // (EACCES, EIO, ...) means the boundary could not be inspected, which
      // is not a safe write target: bail to null instead of reconstructing
      // the path lexically.
      if (error && error.code !== 'ENOENT') return null;
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      tail.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * True when `p`'s canonical location sits inside `root`'s canonical
 * location — the filesystem-level containment check, not a lexical one.
 * A junction/symlinked parent pointing outside `root` fails here.
 */
function isInsideCanonical(root, child) {
  const realRoot = canonicalParentChain(root);
  const realChild = canonicalParentChain(child);
  if (!realRoot || !realChild) return false;
  return isInside(realRoot, realChild);
}

/**
 * True when no component of `p` below `stopAt` is itself a symlink or
 * junction. Staging/replace/recovery may not traverse an aliased parent:
 * writing through a junction placed by imported content escapes the home.
 * The deepest existing parent is checked; missing leaves are fine.
 */
function parentChainIsLinkFree(p, stopAt) {
  let cursor = path.resolve(p);
  const stop = path.resolve(stopAt || '');
  while (cursor !== stop && cursor !== path.dirname(cursor)) {
    if (isLinkLike(cursor)) return false;
    cursor = path.dirname(cursor);
  }
  return !isLinkLike(cursor);
}

/**
 * A transaction journal only authorizes mutation of the exact tree it
 * recorded. Before any rename/delete during recovery we verify that the
 * journal's dest/tmp/bak resolve inside the sweep root and that the opId
 * embedded in the journal filename matches the journal's own opId. Anything
 * that fails this binding is reported as pending and never followed — an
 * imported payload file must not be able to pose as recovery metadata.
 */
function txnPathsOwned(root, txnFileName, journal) {
  if (!journal || typeof journal !== 'object') return false;
  const expectedName = txnName(journal.dest, journal.opId);
  if (path.basename(expectedName) !== path.basename(String(txnFileName || ''))) return false;
  for (const key of ['dest', 'tmp', 'bak']) {
    const p = journal[key];
    if (typeof p !== 'string' || !p) return false;
    const resolved = path.resolve(p);
    // tmp/bak must be siblings of dest; all three must live under root —
    // lexically AND through the real filesystem (junction aliases must not
    // place any of them outside the sweep root or inside the source tree).
    if (!isInside(root, resolved)) return false;
    if (!isInside(path.dirname(resolved), resolved)) return false;
    if (!isInsideCanonical(root, resolved)) return false;
  }
  const parent = path.dirname(journal.dest);
  // The txn journal file itself must physically sit next to `dest` — a
  // payload file dropped anywhere else inside the sweep root does not
  // authorize mutation of this tree even if its contents look right.
  return samePath(path.dirname(journal.tmp), parent)
    && samePath(path.dirname(journal.bak), parent)
    // Names must be the exact opId-derived transaction names, not a
    // prefix: `<dest>.import-tmp-<other>` must never be treated as owned.
    && samePath(journal.tmp, tmpName(journal.dest, journal.opId))
    && samePath(journal.bak, bakName(journal.dest, journal.opId));
}

/**
 * Physical-location check layered on {@link txnPathsOwned}: the journal
 * file found at `txnFilePath` must be the canonical `<dest>.import-txn-<op>`
 * file for the journal it carries. Callers walking a directory tree pass
 * the entry's absolute path; callers enumerating a dest's siblings pass
 * that sibling's path.
 */
function txnJournalOwnsPath(txnFilePath, root, journal) {
  const base = path.basename(String(txnFilePath || ''));
  if (!txnPathsOwned(root, base, journal)) return false;
  return samePath(path.resolve(txnFilePath), txnName(journal.dest, journal.opId));
}

/**
 * Detect whether an *existing* path inside staging/dest is a symlink or
 * junction before overlaying it — readdir's isSymbolicLink only covers the
 * source side. A stale destination link must never be followed during a
 * merge or the copy escapes the staging boundary.
 */
/**
 * Classify a path as a junction/symlink target. Four verdicts — 'link',
 * 'clean' (exists, not a link), 'missing', or 'error' — because "could not
 * inspect" is NOT the same as "confirmed symlink": `parentChainIsLinkFree`
 * fails closed on an error (uninspectable boundary is unsafe to write
 * through), while `overlayDir` must ABORT on an error instead of
 * interpreting it as a removable link (an inspection failure must never
 * authorize a recursive delete of destination-only data).
 */
function classifyLink(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isSymbolicLink() ? 'link' : 'clean';
  } catch (error) {
    if (error && error.code === 'ENOENT') return 'missing';
    return 'error';
  }
}

function isLinkLike(p) {
  // For the write/recovery boundary an uninspectable component fails closed:
  // treating 'error' as unsafe keeps junction-detection from ever authorizing
  // writes or cleanup through a path it could not classify. Only 'clean' and
  // 'missing' are provably not-a-link.
  const verdict = classifyLink(p);
  return verdict !== 'clean' && verdict !== 'missing';
}

function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFileSync(file, JSON.stringify(payload), { encoding: 'utf8' });
}

function readJson(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function pathExists(p) {
  try { await fs.promises.lstat(p); return true; } catch { return false; }
}

/**
 * Single decision table shared by the async and sync reconcilers so the
 * two recovery paths can never diverge. Given the journal's recorded
 * `state` and which of dest/tmp/bak currently exist on disk, it returns
 * either `{ pending: true, reason }` (leave everything in place, report)
 * or `{ pending: false, ops }` — an ordered symbolic op list the caller
 * executes with its own fs flavor.
 *
 * Op shapes: `{ rename: 'tmp->dest'|'bak->dest' }`, `{ rm: 'tmp'|'bak',
 * when: boolean }` (`when: false` skips the op).
 */
function decideTxnResolution(state, { destThere, tmpThere, bakThere }) {
  if (state === 'staging' || state === 'staged') {
    return { pending: false, ops: [{ rm: 'tmp', when: tmpThere }] };
  }
  if (state === 'replacing') {
    if (!destThere && tmpThere) {
      // Crash between the renames: finish the commit, then drop backup.
      return { pending: false, ops: [{ rename: 'tmp->dest' }, { rm: 'bak', when: bakThere }] };
    }
    if (!destThere && bakThere) {
      // tmp vanished (or rename to dest failed pre-crash): restore old.
      return { pending: false, ops: [{ rename: 'bak->dest' }, { rm: 'tmp', when: tmpThere }] };
    }
    if (destThere && bakThere) {
      // Commit landed before crash: drop the backup and any stray staging.
      return { pending: false, ops: [{ rm: 'bak', when: true }, { rm: 'tmp', when: tmpThere }] };
    }
    if (destThere && tmpThere) {
      return { pending: false, ops: [{ rm: 'tmp', when: true }] };
    }
    if (!destThere && !tmpThere && !bakThere) {
      return { pending: true, reason: 'all-copies-missing' };
    }
    return { pending: false, ops: [] };
  }
  if (state === 'committed') {
    if (!destThere) {
      if (bakThere) {
        // Journal claims commit but the destination is gone: the backup is
        // the last surviving copy — restore it instead of deleting it.
        return { pending: false, ops: [{ rename: 'bak->dest' }, { rm: 'tmp', when: tmpThere }] };
      }
      return { pending: true, reason: 'all-copies-missing' };
    }
    // dest exists: only then is removing `bak` safe.
    return { pending: false, ops: [{ rm: 'bak', when: bakThere }, { rm: 'tmp', when: tmpThere }] };
  }
  // needsRecovery / unknown — preserve, do not auto-resolve.
  return { pending: true, reason: state || 'unknown' };
}

/**
 * Copy `from` into `staging` file-by-file so that a destination tree can be
 * overlaid instead of replaced (used for the attachment merge).
 * @param {string} from
 * @param {string} staging
 * @param {{ overwrite?: boolean, preserve?: boolean }} [opts]
 *   `overwrite: false` keeps an existing staged file when the source has the
 *   same relative path. `preserve` is informational only.
 */
async function overlayDir(from, staging, { overwrite = true } = {}) {
  const entries = await fs.promises.readdir(from, { withFileTypes: true });
  await fs.promises.mkdir(staging, { recursive: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(staging, entry.name);
    // Never write through a symlink/junction already occupying the staged
    // destination path — copyFile/recursion would follow it outside the
    // staging boundary and mutate real data before commit.
    const linkVerdict = classifyLink(dst);
    // An inspection ERROR is not a confirmed link and must abort staging:
    // treating "could not inspect" as removable would recursively delete
    // destination-only data before commit. The throw propagates out of the
    // transaction so the merge never publishes an incomplete tree — the
    // live destination is untouched (staging is per-op scratch).
    if (linkVerdict === 'error') {
      const err = new Error(`overlay-inspection-failed: ${dst}`);
      err.needsRecovery = false;
      throw err;
    }
    if (linkVerdict === 'link') {
      if (overwrite) {
        await fs.promises.rm(dst, { recursive: true, force: true });
      } else {
        continue;
      }
    }
    if (entry.isDirectory()) {
      await overlayDir(src, dst, { overwrite });
    } else if (entry.isSymbolicLink()) {
      // Symlinked trees are skipped rather than silently followed outside the
      // attachment root; import sources are user homes, not trusted packages.
      continue;
    } else if (entry.isFile()) {
      const exists = await pathExists(dst);
      if (exists && !overwrite) continue;
      await fs.promises.copyFile(src, dst);
    }
  }
}

/**
 * Commit an already-staged directory into `dest` as the second half of the
 * journaled transaction: dest -> bak, staging -> dest, record commit,
 * drop backup. Callers that need a pre-populated staging tree (the
 * attachment merge) build it themselves and then call this.
 */
async function commitStagedDir(stagingDir, dest, { opId } = {}) {
  const id = opId || nextOpId();
  const tmp = stagingDir;
  const bak = bakName(dest, id);
  const txnFile = txnName(dest, id);
  const baseJournal = {
    version: JOURNAL_VERSION,
    opId: id,
    dest: path.resolve(dest),
    tmp: path.resolve(tmp),
    bak: path.resolve(bak),
    state: 'staged',
    startedAt: new Date().toISOString(),
  };
  const destParent = path.dirname(dest);
  if (!isInside(destParent, tmp) || !isInside(destParent, bak)) {
    return { ok: false, opId: id, error: 'unsafe-destination' };
  }
  // The write path must honor the same filesystem boundary the recovery
  // path checks: if any existing component of the destination's parent is a
  // junction/symlink, the dest/tmp/bak siblings would be written through the
  // alias into a different tree — possibly the read-only source or outside
  // the home entirely. Refuse rather than follow it.
  if (!parentChainIsLinkFree(destParent, path.parse(path.resolve(destParent)).root)) {
    return { ok: false, opId: id, error: 'unsafe-destination-link' };
  }
  // The staged source and destination must never alias — a staging tree that
  // is (or sits inside) the live destination would be renamed over itself.
  if (samePath(tmp, dest) || isInside(tmp, dest) || isInside(dest, tmp)) {
    return { ok: false, opId: id, error: 'source-dest-overlap' };
  }
  try {
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'staged' });
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'replacing' });
    const hadDest = await pathExists(dest);
    if (hadDest) {
      await fs.promises.rename(dest, bak);
    }
    try {
      await fs.promises.rename(tmp, dest);
    } catch (renameError) {
      if (hadDest) {
        try {
          await fs.promises.rename(bak, dest);
        } catch (restoreError) {
          writeJsonAtomic(txnFile, {
            ...baseJournal,
            state: 'needsRecovery',
            error: `rename failed and restore failed: ${renameError.message}; ${restoreError.message}`,
          });
          return { ok: false, opId: id, needsRecovery: true, error: renameError.message };
        }
      }
      writeJsonAtomic(txnFile, { ...baseJournal, state: 'rolledBack', error: renameError.message });
      await fs.promises.rm(txnFile, { force: true });
      return { ok: false, opId: id, error: renameError.message };
    }
    writeJsonAtomic(txnFile, { ...baseJournal, state: 'committed', hadDest });
    if (hadDest) {
      await fs.promises.rm(bak, { recursive: true, force: true });
    }
    await fs.promises.rm(txnFile, { force: true });
    return { ok: true, opId: id };
  } catch (error) {
    // Recording the recovery requirement is itself best-effort: if THIS
    // journal write also fails we must not let it throw past the
    // needsRecovery result, or the caller loses the very flag meant to
    // block further mutation.
    try {
      writeJsonAtomic(txnFile, {
        ...baseJournal,
        state: 'needsRecovery',
        error: error.message || String(error),
      });
    } catch {
      // Journal write failed too — still surface needsRecovery so the
      // importer latches the block even though the sidecar is absent.
    }
    return { ok: false, opId: id, needsRecovery: true, error: error.message || String(error) };
  }
}

/**
 * Transactionally replace the directory at `dest` with the contents of
 * `from`: stages `from` under the transaction tmp name first, then commits.
 */
async function replaceDirJournaled(from, dest, { opId } = {}) {
  const id = opId || nextOpId();
  const tmp = tmpName(dest, id);
  if (samePath(from, dest) || isInside(from, dest) || isInside(dest, from)) {
    return { ok: false, opId: id, error: 'source-dest-overlap' };
  }
  // Same write-time filesystem boundary as commitStagedDir: an aliased
  // destination parent would redirect the staged copy and the renames out of
  // the intended home (and possibly into the read-only source).
  if (!parentChainIsLinkFree(path.dirname(dest), path.parse(path.resolve(path.dirname(dest))).root)) {
    return { ok: false, opId: id, error: 'unsafe-destination-link' };
  }
  try {
    await fs.promises.rm(tmp, { recursive: true, force: true });
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.cp(from, tmp, { recursive: true, verbatimSymlinks: false });
  } catch (error) {
    await fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    return { ok: false, opId: id, error: error.message || String(error) };
  }
  return commitStagedDir(tmp, dest, { opId: id });
}

/**
 * Reconcile per-operation transaction journals left under `root`'s children.
 * Returns `{ recovered, pending, removedTmp }`; `pending` lists opIds whose
 * state could not be reconciled automatically and must block re-import.
 *
 * Rules:
 * - `staged`/`staging`: tmp still exists and dest untouched -> drop tmp.
 * - `replacing`: tmp may or may not have moved; prefer restoring `bak` when
 *   dest is missing, else keep committed dest and drop `bak`.
 * - `committed`: remove `bak` if still present.
 * - `needsRecovery` / unreadable: leave in place and report as pending.
 * - Bare `*.import-tmp` (legacy crash artifacts without a journal) are
 *   preserved: they may be the only surviving copy.
 */
async function recoverImportTransactions(root, { onPending, allowedOpIds, allowedTxnDests } = {}) {
  const recovered = [];
  const pending = [];
  const removedTmp = [];
  const parent = path.dirname(root.replace(/[\\/]+$/, ''));
  const destName = path.basename(root);
  let siblings;
  try {
    siblings = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return { recovered, pending, removedTmp };
  }
  const txnFiles = siblings.filter((e) => e.isFile() && e.name.startsWith(`${destName}${TXN_SUFFIX}-`));
  for (const entry of txnFiles) {
    const txnPath = path.join(parent, entry.name);
    const journal = readJson(txnPath);
    const opId = entry.name.slice(`${destName}${TXN_SUFFIX}-`.length);
    if (!journal || journal.version !== JOURNAL_VERSION) {
      pending.push({ opId, reason: 'unreadable-journal' });
      continue;
    }
    // Importer-owned inventory is MANDATORY, not opt-in: no ownership
    // evidence means no recovery mutation. Callers that omit context get the
    // default empty inventory — every journal is then unregistered and
    // preserved, never executed. An explicit empty set is the same zero
    // authorization. Only an opId the caller positively registered may be
    // followed.
    const opIds = allowedOpIds instanceof Set ? allowedOpIds : EMPTY_SET;
    if (!opIds.has(journal.opId)) {
      pending.push({ opId, reason: 'unregistered-journal' });
      continue;
    }
    // Destination binding is REQUIRED whenever the caller supplied an
    // ownership inventory (allowedOpIds as a Set — even empty). A registered
    // opId only authorizes the transaction when its own valid binding
    // matches the recorded destination: a missing map, missing key,
    // non-string value, or mismatched binding all leave the sidecar
    // preserved and unbound — an ID alone (older ID-only inventories) is
    // never enough to prove destination authority. When no inventory was
    // supplied at all (bare reconciler call outside import recovery), the
    // trust-boundary checks below remain the only gate.
    // ownership inventory (always true — omitted context yields the empty
    // set above). A registered opId only authorizes the transaction when its
    // own valid binding matches the recorded destination: a missing map,
    // missing key, non-string value, or mismatched binding all preserve the
    // sidecar unbound — an ID alone never proves destination authority.
    {
      const bound = (allowedTxnDests && typeof allowedTxnDests === 'object')
        ? allowedTxnDests[journal.opId]
        : undefined;
      if (typeof bound !== 'string' || !bound || !samePath(bound, journal.dest)) {
        pending.push({ opId, reason: 'unbound-destination' });
        continue;
      }
    }
    // Trust boundary: the journal only authorizes mutation of the tree it
    // recorded for its own opId. A foreign-path or mismatched-op journal is
    // preserved as suspicious input, never followed.
    // Ownership boundary is the destination's parent: dest/tmp/bak are all
    // siblings there. `root` is the destination itself.
    if (journal.opId !== opId || !samePath(journal.dest, root) || !txnJournalOwnsPath(txnPath, parent, journal)) {
      pending.push({ opId, reason: 'untrusted-journal' });
      continue;
    }
    const dest = journal.dest;
    const tmp = journal.tmp;
    const bak = journal.bak;
    try {
      const destThere = await pathExists(dest);
      const tmpThere = await pathExists(tmp);
      const bakThere = await pathExists(bak);
      const decision = decideTxnResolution(journal.state, { destThere, tmpThere, bakThere });
      if (decision.pending) {
        pending.push({ opId, reason: decision.reason });
        continue;
      }
      for (const op of decision.ops) {
        if (op.rename === 'tmp->dest') {
          await fs.promises.rename(tmp, dest);
        } else if (op.rename === 'bak->dest') {
          await fs.promises.rename(bak, dest);
        } else if (op.rm === 'tmp' && op.when) {
          await fs.promises.rm(tmp, { recursive: true, force: true });
          removedTmp.push(tmp);
        } else if (op.rm === 'bak' && op.when) {
          await fs.promises.rm(bak, { recursive: true, force: true });
        }
      }
      fs.rmSync(txnPath, { force: true });
      recovered.push(opId);
    } catch (error) {
      pending.push({ opId, reason: error.message || String(error) });
    }
  }
  // Legacy bare staging dirs (no journal): preserve rather than delete —
  // they may hold the only copy of the user's data.
  for (const entry of siblings) {
    if (entry.isDirectory() && entry.name.startsWith(`${destName}${TMP_SUFFIX}`)) {
      const hasTxn = txnFiles.some((t) => t.name === `${destName}${TXN_SUFFIX}-${entry.name.slice(destName.length + TMP_SUFFIX.length + 1)}`);
      if (!hasTxn) {
        pending.push({ opId: `legacy:${entry.name}`, reason: 'unjournaled-staging-preserved' });
      }
    }
    if (entry.isDirectory() && entry.name.startsWith(`${destName}${BAK_SUFFIX}`)) {
      pending.push({ opId: `legacy:${entry.name}`, reason: 'unjournaled-backup-preserved' });
    }
  }
  if (typeof onPending === 'function') {
    for (const p of pending) onPending(p);
  }
  return { recovered, pending, removedTmp };
}

/**
 * Synchronous twin of {@link recoverImportTransactions}, used by the
 * cold-start recovery path. Walks `root` recursively (sessions/skills/
 * attachments and the hidden `.agent-presets` tree), applies the same
 * trust-boundary check via {@link txnPathsOwned}, and preserves any
 * journal/dir it cannot prove ownership of.
 */
function reconcileImportTransactionsSync(root, { onPending, allowedOpIds, allowedTxnDests } = {}) {
  const recovered = [];
  const pending = [];
  const removedTmp = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      // A directory we cannot read may hold unresolved transactions; treat
      // the read failure itself as pending so recovery blocks instead of
      // silently looking clean. Root itself being unreadable is the same.
      pending.push({ opId: `unreadable:${dir}`, reason: error && error.code ? error.code : 'dir-unreadable', path: dir });
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs except the preset tree; staging/backup dirs are
        // reported (preserved) rather than recursed.
        const stagingMatch = entry.name.match(/^(.*)\.import-(tmp|bak)(?:-(.+))?$/);
        if (stagingMatch) {
          const opId = stagingMatch[3];
          const hasTxn = opId && entries.some((e2) => e2.isFile()
            && e2.name === `${stagingMatch[1]}${TXN_SUFFIX}-${opId}`);
          if (!hasTxn) {
            pending.push({ opId: `legacy:${entry.name}`, reason: 'unjournaled-staging-preserved', path: abs });
          }
          continue;
        }
        if (entry.name.startsWith('.') && !HIDDEN_SWEEP_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.includes(TXN_SUFFIX)) continue;
      const journal = (() => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } })();
      const opIdFromName = entry.name.slice(entry.name.lastIndexOf(`${TXN_SUFFIX}-`) + TXN_SUFFIX.length + 1);
      if (!journal || journal.version !== JOURNAL_VERSION) {
        pending.push({ opId: opIdFromName, reason: 'unreadable-journal', path: abs });
        continue;
      }
      // Importer-owned inventory is MANDATORY: no ownership evidence means
      // no recovery mutation. Callers that omit context get the default
      // empty inventory — every journal is then unregistered and preserved,
      // never executed. An explicit empty set is the same zero
      // authorization; only a positively registered opId may be followed.
      const opIds = allowedOpIds instanceof Set ? allowedOpIds : EMPTY_SET;
      if (!opIds.has(journal.opId)) {
        pending.push({ opId: opIdFromName, reason: 'unregistered-journal', path: abs });
        continue;
      }
      // Destination binding parity with the async reconciler: a registered
      // opId only authorizes the transaction when its own valid binding
      // matches the recorded destination. Missing map/key/non-string value
      // or a mismatched binding all preserve the sidecar unbound — an ID
      // alone never proves destination authority.
      const bound = (allowedTxnDests && typeof allowedTxnDests === 'object')
        ? allowedTxnDests[journal.opId]
        : undefined;
      if (typeof bound !== 'string' || !bound || !samePath(bound, journal.dest)) {
        pending.push({ opId: opIdFromName, reason: 'unbound-destination', path: abs });
        continue;
      }
      const destName = path.basename(journal.dest || '');
      const expectedFile = `${destName}${TXN_SUFFIX}-${journal.opId}`;
      if (journal.opId !== opIdFromName || expectedFile !== entry.name
        || !txnJournalOwnsPath(abs, root, journal)) {
        pending.push({ opId: opIdFromName, reason: 'untrusted-journal', path: abs });
        continue;
      }
      const { dest, tmp, bak, state } = journal;
      try {
        const destThere = fs.existsSync(dest);
        const tmpThere = fs.existsSync(tmp);
        const bakThere = fs.existsSync(bak);
        const decision = decideTxnResolution(state, { destThere, tmpThere, bakThere });
        if (decision.pending) {
          pending.push({ opId: journal.opId, reason: decision.reason, path: abs });
          continue;
        }
        for (const op of decision.ops) {
          if (op.rename === 'tmp->dest') {
            fs.renameSync(tmp, dest);
          } else if (op.rename === 'bak->dest') {
            fs.renameSync(bak, dest);
          } else if (op.rm === 'tmp' && op.when) {
            fs.rmSync(tmp, { recursive: true, force: true });
            removedTmp.push(tmp);
          } else if (op.rm === 'bak' && op.when) {
            fs.rmSync(bak, { recursive: true, force: true });
          }
        }
        fs.rmSync(abs, { force: true });
        recovered.push(journal.opId);
      } catch (error) {
        pending.push({ opId: journal.opId, reason: error.message || String(error), path: abs });
      }
    }
  }
  if (typeof onPending === 'function') {
    for (const p of pending) onPending(p);
  }
  return { recovered, pending, removedTmp };
}

module.exports = {
  replaceDirJournaled,
  commitStagedDir,
  recoverImportTransactions,
  reconcileImportTransactionsSync,
  overlayDir,
  nextOpId,
  decideTxnResolution,
  txnJournalOwnsPath,
  parentChainIsLinkFree,
  TMP_SUFFIX,
  BAK_SUFFIX,
  TXN_SUFFIX,
};
