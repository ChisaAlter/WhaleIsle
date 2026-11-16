'use strict';

// Shared ownership handoff for directories that must outlive their creator
// process — primarily Electron userData roots that Chromium holds until the
// app fully exits. This module creates the directory, installs the ownership
// marker and pending receipt, and spawns the detached plain-Node supervisor
// (`scripts/preview-profile-cleanup.cjs`) that removes exactly that directory
// after the owning pid is gone.
//
// Used by `verify-preview-permissions.cjs` (its original home) and
// `qa-window-motion.cjs`; any Electron QA entry that sets its own userData
// should go through here instead of a raw mkdtemp.

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUniqueDir } = require('../../src/shared/fs-safe.js');
const { writeReceiptAtomic } = require('./receipt-file.cjs');

const OWNER_MARKER_BASENAME = '.dshd-cleanup-owner.json';
const CLEANUP_HELPER = path.join(__dirname, '..', 'preview-profile-cleanup.cjs');
const OWNER_WAIT_DEADLINE_MS = 60_000;
const REMOVAL_ATTEMPTS = 40;

// Receipt publication goes through the shared writer so the owner and the
// detached helper cannot drift; a failed replacement leaves the previous
// readable receipt intact instead of unlinking it first.
function writePendingReceipt(receiptPath, dirRoot, ownerPid) {
  writeReceiptAtomic(receiptPath, {
    version: 1,
    state: 'pending',
    reason: 'pending',
    profileRoot: dirRoot,
    ownerPid,
    updatedAt: new Date().toISOString(),
    detail: null,
  });
}

/**
 * Create a directory this process owns and prepare the supervisor handoff:
 * the ownership marker lands inside the directory before any supervisor can
 * start, and the pending receipt lives outside the directory that is
 * eventually removed. `receiptPrefix` names the caller so concurrent tools
 * cannot collide on a receipt path.
 */
function createSupervisedDir({ prefix, receiptPrefix }) {
  const root = createUniqueDir(os.tmpdir(), prefix);
  const ownerPid = process.pid;
  const token = crypto.randomBytes(24).toString('hex');
  const receiptPath = path.join(
    os.tmpdir(),
    `${receiptPrefix}${path.basename(root)}.json`,
  );
  const markerPath = path.join(root, OWNER_MARKER_BASENAME);

  fs.writeFileSync(markerPath, `${JSON.stringify({
    version: 1,
    token,
    ownerPid,
    createdAt: new Date().toISOString(),
    profileRoot: root,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  writePendingReceipt(receiptPath, root, ownerPid);

  return {
    root,
    createdHere: true,
    receiptPath,
    ownerPid,
    token,
    startFailure: null,
  };
}

/**
 * Record a supervisor start failure: the terminal `retained` receipt keeps
 * the exact path inspectable, and the write is synchronous because the owner
 * may exit immediately after startup.
 */
function recordSupervisorStartFailure(profile, detail) {
  profile.startFailure = detail;
  try {
    writeReceiptAtomic(profile.receiptPath, {
      version: 1,
      state: 'retained',
      reason: 'supervisor-start-failed',
      profileRoot: profile.root,
      ownerPid: profile.ownerPid,
      updatedAt: new Date().toISOString(),
      detail,
    });
  } catch (receiptError) {
    process.stderr.write(
      `profile cleanup receipt could not be written to ${profile.receiptPath}: `
      + `${receiptError instanceof Error ? receiptError.message : String(receiptError)}\n`,
    );
  }
  process.stderr.write(
    `profile root cleanup supervisor could not start (${detail}); `
    + `retained for inspection: ${profile.root}\n`,
  );
}

/**
 * Start the detached cleanup supervisor for a directory this process created.
 *
 * `detached` + `unref` let the helper outlive Electron, and passing `this`
 * process id is what makes the handoff exact: the helper removes the directory
 * only after the process that owns it is gone, and reports the path when it
 * cannot prove removal.
 *
 * options:
 *   executable      override for the spawned interpreter (test hooks)
 *   onStartFailure  callback invoked once after a start failure is recorded
 */
function startDirCleanupSupervisor(profile, options = {}) {
  let startFailureRecorded = false;
  let stderrText = '';

  const recordStartFailure = (detail) => {
    if (startFailureRecorded) return;
    startFailureRecorded = true;
    recordSupervisorStartFailure(profile, detail);
    if (typeof options.onStartFailure === 'function') options.onStartFailure(detail);
  };

  let child;
  try {
    child = spawn(
      options.executable || process.execPath,
      [
        CLEANUP_HELPER,
        profile.root,
        String(profile.ownerPid),
        String(OWNER_WAIT_DEADLINE_MS),
        String(REMOVAL_ATTEMPTS),
        profile.receiptPath,
        profile.token,
      ],
      {
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
        // Cleanup must never inherit the Electron-only mode of this process.
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
  } catch (error) {
    recordStartFailure(
      `synchronous spawn failure: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrText = `${stderrText}${chunk}`.slice(-16_384);
    });
  }
  child.once('error', (error) => {
    recordStartFailure(
      `spawn error: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  child.once('close', (code, signal) => {
    if (startFailureRecorded) return;

    let receipt = null;
    try {
      receipt = JSON.parse(fs.readFileSync(profile.receiptPath, 'utf8'));
    } catch {
      // A missing or unreadable terminal receipt is itself a start/cleanup
      // failure; the helper never exits without attempting one.
    }
    const terminal = receipt
      && (receipt.state === 'removed' || receipt.state === 'retained');
    if (terminal) return;

    recordStartFailure(
      `supervisor exited without a terminal receipt (code=${code}, signal=${signal}): `
      + (stderrText.trim() || 'no stderr'),
    );
  });

  if (!Number.isInteger(child.pid) || child.pid <= 0) {
    recordStartFailure('spawn did not return a child pid');
  }
  child.unref();
  return child;
}

module.exports = {
  OWNER_MARKER_BASENAME,
  OWNER_WAIT_DEADLINE_MS,
  REMOVAL_ATTEMPTS,
  createSupervisedDir,
  recordSupervisorStartFailure,
  startDirCleanupSupervisor,
};
