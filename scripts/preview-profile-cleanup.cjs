#!/usr/bin/env node
// Detached cleanup supervisor for a run-owned directory that its creator
// process cannot reclaim itself — primarily an Electron userData root that
// Chromium holds until the app fully exits. Owners do not spawn this file
// directly; `scripts/lib/owned-dir-supervisor.cjs` creates the directory,
// installs the ownership marker, and hands off to this process.
//
// The owner cannot clean up such a directory from inside Electron: an
// in-process `exit` hook fires while Chromium is still unwinding, so the
// directory is usually still locked, and an Electron parent that synchronously
// waits for an Electron child was measured to deadlock. This helper is a
// separate plain-Node process. It is spawned detached, survives the owner's
// exit, waits until the owning process is genuinely gone, and only then removes
// the exact directory it was told to remove.
//
// Contract:
//   argv[2]  absolute profile root to remove
//   argv[3]  positive pid of the process that owns that root
//   argv[4]  finite positive ms to wait for the owner to disappear
//   argv[5]  optional positive removal-attempt budget (default 40)
//   argv[6]  absolute cleanup receipt path outside the profile root
//   argv[7]  ownership token matching <root>/.dshd-cleanup-owner.json
//
// Exit codes:
//   0  removed (or already absent)
//   1  retained (timeout, unknown probe, invalid input, or ownership mismatch)
//   2  owner exited but removal failed: RETAINED, path and receipt reported
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeReceiptAtomic } = require('./lib/receipt-file.cjs');
const { constantTimeEqual } = require('../src/shared/secret.js');

const OWNER_MARKER_BASENAME = '.dshd-cleanup-owner.json';
const PROBE_ERROR_ENV = 'DSHD_PREVIEW_CLEANUP_PROBE_ERROR';
const FORCE_REMOVE_ERROR_ENV = 'DSHD_PREVIEW_CLEANUP_FORCE_REMOVE_ERROR';

const rawProfileRoot = process.argv[2];
const rawOwnerPid = process.argv[3];
const rawDeadlineMs = process.argv[4];
const rawRemovalAttempts = process.argv[5];
const rawReceiptPath = process.argv[6];
const ownershipToken = process.argv[7];

let profileRoot = typeof rawProfileRoot === 'string' && rawProfileRoot.length > 0
  ? rawProfileRoot
  : null;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function fallbackReceiptPath() {
  const base = isNonEmptyString(profileRoot)
    ? path.basename(path.resolve(profileRoot))
    : 'invalid-profile-root';
  const safeBase = String(base).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'profile';
  const filename = `dshd-preview-cleanup-rejected-${safeBase}-${process.pid}-${Date.now()}.json`;
  const effectiveRoot = isNonEmptyString(profileRoot) ? path.resolve(profileRoot) : null;
  const candidates = [
    os.tmpdir(),
    effectiveRoot ? path.dirname(effectiveRoot) : null,
    process.cwd(),
  ];
  for (const directory of candidates) {
    if (!directory) continue;
    const candidate = path.join(directory, filename);
    if (!effectiveRoot || !isPathInside(effectiveRoot, candidate)) return candidate;
  }
  return null;
}

function chooseReceiptPath(receiptArgument) {
  if (!isNonEmptyString(receiptArgument) || !path.isAbsolute(receiptArgument)) {
    return {
      path: fallbackReceiptPath(),
      invalid: true,
      detail: 'cleanup receipt path must be a non-empty absolute path',
    };
  }

  const resolved = path.resolve(receiptArgument);
  const effectiveRoot = isNonEmptyString(profileRoot) ? path.resolve(profileRoot) : null;
  if (effectiveRoot && isPathInside(effectiveRoot, resolved)) {
    return {
      path: fallbackReceiptPath(),
      invalid: true,
      detail: 'cleanup receipt path must live outside the profile root',
    };
  }

  return { path: resolved, invalid: false, detail: null };
}

/**
 * Publish one receipt through the shared atomic writer.
 *
 * The shared writer never unlinks an existing receipt, so a failed terminal
 * publication leaves the previous (for example `pending`) receipt readable
 * instead of destroying the only evidence of the run.
 */
function publishReceipt(receiptPath, receipt) {
  writeReceiptAtomic(receiptPath, receipt, {
    guard(candidatePath) {
      if (isNonEmptyString(profileRoot)
        && isPathInside(path.resolve(profileRoot), path.resolve(candidatePath))) {
        throw new Error('refusing to write the cleanup receipt inside the profile root');
      }
    },
  });
}

function buildReceipt(state, reason, detail, ownerPid) {
  return {
    version: 1,
    state,
    reason,
    profileRoot: isNonEmptyString(profileRoot) ? profileRoot : null,
    ownerPid: Number.isInteger(ownerPid) ? ownerPid : null,
    updatedAt: new Date().toISOString(),
    detail: detail === null || detail === undefined ? null : String(detail),
  };
}

/**
 * Probe the owner without ever terminating it. Only a confirmed ESRCH result
 * authorizes removal; permissions failures and malformed probe errors retain.
 */
function probeOwner(pid) {
  if (process.env[PROBE_ERROR_ENV] === '1') return 'unknown';

  try {
    // Signal 0 only probes for existence; it never terminates the target.
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    if (error?.code === 'EPERM') return 'alive';
    if (error?.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

function waitForOwner(pid, deadlineMs) {
  const deadlineAt = Date.now() + deadlineMs;
  for (;;) {
    const state = probeOwner(pid);
    if (state !== 'alive') return state;

    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) return 'timeout';
    // Atomics.wait gives a synchronous sleep without a busy loop.
    const sliceMs = Math.max(1, Math.min(100, Math.floor(remainingMs)));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sliceMs);
  }
}

function removeRoot() {
  if (process.env[FORCE_REMOVE_ERROR_ENV] === '1') {
    throw new Error('injected removal failure');
  }
  fs.rmSync(profileRoot, { recursive: true, force: true });
  return !fs.existsSync(profileRoot);
}

function removeWithRetries(removalAttempts) {
  let lastError = null;
  for (let attempt = 0; attempt < removalAttempts; attempt += 1) {
    if (!fs.existsSync(profileRoot)) {
      return { alreadyAbsent: true, error: null };
    }

    try {
      if (removeRoot()) return { alreadyAbsent: false, error: null };
      lastError = new Error('directory still present after removal');
    } catch (error) {
      lastError = error;
    }

    if (attempt < removalAttempts - 1) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }

  return { alreadyAbsent: false, error: lastError };
}

function isSaneOwnershipMarker(marker, expectedOwnerPid) {
  return Boolean(marker)
    && typeof marker === 'object'
    && !Array.isArray(marker)
    && marker.version === 1
    && isNonEmptyString(marker.token)
    && constantTimeEqual(marker.token, ownershipToken)
    && Number.isInteger(marker.ownerPid)
    && marker.ownerPid === expectedOwnerPid
    && isNonEmptyString(marker.createdAt)
    && Number.isFinite(Date.parse(marker.createdAt))
    && isNonEmptyString(marker.profileRoot)
    && path.isAbsolute(marker.profileRoot)
    && samePath(marker.profileRoot, profileRoot);
}

function main() {
  const parsedOwnerPid = parsePositiveInteger(rawOwnerPid);
  const deadlineMs = Number(rawDeadlineMs);
  const removalAttempts = rawRemovalAttempts === undefined
    ? 40
    : parsePositiveInteger(rawRemovalAttempts);
  const receiptSelection = chooseReceiptPath(rawReceiptPath);
  const receiptPath = receiptSelection.path;

  /**
   * Receipts are terminal and are written before every exit. If the requested
   * receipt path was invalid, the selected fallback is outside the profile
   * root. If no such fallback exists (for example, the root is a filesystem
   * root), the failure is still reported on stderr and the directory is retained.
   */
  const finish = (state, reason, exitCode, detail) => {
    let receiptWritten = false;
    if (receiptPath) {
      try {
        publishReceipt(receiptPath, buildReceipt(state, reason, detail, parsedOwnerPid));
        receiptWritten = true;
      } catch (error) {
        process.stderr.write(
          `preview-profile-cleanup: could not write receipt ${receiptPath}: `
          + `${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    } else {
      process.stderr.write(
        'preview-profile-cleanup: no receipt path outside the profile root is available\n',
      );
    }

    if (detail) process.stderr.write(`preview-profile-cleanup: ${detail}\n`);
    if (receiptSelection.invalid) {
      process.stderr.write(
        `preview-profile-cleanup: receipt redirected to ${receiptPath}; `
        + `${receiptSelection.detail}\n`,
      );
    }

    return receiptWritten || exitCode !== 0 ? exitCode : 2;
  };

  const reject = (reason, detail) => finish('retained', reason, 1, detail);

  try {
    if (!isNonEmptyString(rawProfileRoot) || !path.isAbsolute(rawProfileRoot)) {
      return reject('invalid-input', 'profile root must be a non-empty absolute path');
    }
    profileRoot = path.resolve(profileRoot);

    const filesystemRoot = path.parse(profileRoot).root;
    if (samePath(profileRoot, filesystemRoot) || samePath(profileRoot, os.tmpdir())) {
      return reject(
        'invalid-input',
        'profile root must not be a filesystem root or the OS temp directory itself',
      );
    }

    if (parsedOwnerPid === null) {
      return reject('invalid-input', 'owner pid must be a positive integer');
    }
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
      return reject('invalid-input', 'deadline must be a finite number greater than zero');
    }
    if (rawRemovalAttempts !== undefined && removalAttempts === null) {
      return reject('invalid-input', 'removal-attempt budget must be a positive integer');
    }
    if (receiptSelection.invalid) {
      return reject('invalid-input', receiptSelection.detail);
    }
    if (!isNonEmptyString(ownershipToken)) {
      return reject('ownership-mismatch', 'ownership token is required');
    }

    if (!fs.existsSync(profileRoot)) {
      return finish('removed', 'already-absent', 0, 'profile root was already absent');
    }

    const markerPath = path.join(profileRoot, OWNER_MARKER_BASENAME);
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    } catch (error) {
      return reject(
        'ownership-mismatch',
        `ownership marker could not be read (${error instanceof Error ? error.message : String(error)})`,
      );
    }

    if (!isSaneOwnershipMarker(marker, parsedOwnerPid)) {
      return reject('ownership-mismatch', 'ownership marker did not match the handoff');
    }

    const ownerState = waitForOwner(parsedOwnerPid, deadlineMs);
    if (ownerState === 'unknown') {
      return reject(
        'owner-probe-unknown',
        `owner ${parsedOwnerPid} probe returned an unknown result`,
      );
    }
    if (ownerState === 'timeout') {
      return reject(
        'owner-timeout',
        `profile root retained; owner ${parsedOwnerPid} still alive after ${deadlineMs}ms: `
        + `${profileRoot}`,
      );
    }

    // The owner process is gone, but Windows may release Chromium's file handles
    // a moment later, so retry briefly instead of failing on the first attempt.
    const removal = removeWithRetries(removalAttempts);
    if (!removal.error) {
      const reason = removal.alreadyAbsent ? 'already-absent' : 'removed';
      const detail = removal.alreadyAbsent ? 'profile root disappeared before removal' : null;
      return finish('removed', reason, 0, detail);
    }

    const message = removal.error instanceof Error
      ? removal.error.message
      : String(removal.error);
    return finish(
      'retained',
      'removal-failed',
      2,
      `profile root retained; removal failed (${message}): ${profileRoot}`,
    );
  } catch (error) {
    return finish(
      'retained',
      'removal-failed',
      2,
      `unexpected cleanup failure: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

process.exitCode = main();
