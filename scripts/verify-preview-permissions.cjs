#!/usr/bin/env node
// Electron entry point for the preview-permission runner.
//
// In this toolchain, launching Electron directly on the `.mjs` entry was
// observed to leave `app.whenReady()` unsettled and exit silently with status
// 0. This CJS launcher gives the invocation one explicit startup path; that is
// an observed entry-point issue, not a claim that Electron cannot support an
// ESM main entry.
//
// Usage:
//   electron scripts/verify-preview-permissions.cjs [--json] [--positive-control]
//
// Profile-root ownership:
//   - `DSHD_PREVIEW_PROFILE_ROOT` set: the caller owns that directory and this
//     process never removes it.
//   - otherwise this process creates its own root and hands it to a detached
//     plain-Node cleanup supervisor (`preview-profile-cleanup.cjs`) that waits
//     for *this* process to fully exit before removing exactly that directory.
//     An in-process `exit` hook cannot do this safely (Chromium is still
//     unwinding and holds locks), and an Electron parent that synchronously
//     waits for an Electron child deadlocks, so the cleanup runs out of process.
'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');
const { writeReceiptAtomic } = require('./lib/receipt-file.cjs');

const PROFILE_ROOT_ENV = 'DSHD_PREVIEW_PROFILE_ROOT';
const PROFILE_RECEIPT_ENV = 'DSHD_PREVIEW_CLEANUP_RECEIPT';
const PROFILE_ROOT_OWNED_ENV = 'DSHD_PREVIEW_PROFILE_ROOT_OWNED';
const SUPERVISOR_START_FAILED_ENV = 'DSHD_PREVIEW_CLEANUP_START_FAILED';
const TEST_SCENARIO_ENV = 'DSHD_PREVIEW_PERMISSIONS_TEST_SCENARIO';
const ALLOW_TEST_SCENARIOS_ENV = 'DSHD_PREVIEW_PERMISSIONS_ALLOW_TEST_SCENARIOS';
const CLEANUP_EXECUTABLE_ENV = 'DSHD_PREVIEW_PERMISSIONS_CLEANUP_EXECUTABLE';
const OWNER_MARKER_BASENAME = '.dshd-cleanup-owner.json';
const OWNER_WAIT_DEADLINE_MS = 60_000;
const REMOVAL_ATTEMPTS = 40;
const runner = path.join(__dirname, 'verify-preview-permissions.mjs');
const cleanupHelper = path.join(__dirname, 'preview-profile-cleanup.cjs');

// Receipt publication goes through the shared writer so the launcher and the
// detached helper cannot drift; a failed replacement leaves the previous
// readable receipt intact instead of unlinking it first.
function writePendingReceipt(receiptPath, profileRoot, ownerPid) {
  writeReceiptAtomic(receiptPath, {
    version: 1,
    state: 'pending',
    reason: 'pending',
    profileRoot,
    ownerPid,
    updatedAt: new Date().toISOString(),
    detail: null,
  });
}

/**
 * Resolve the profile root for this Electron process.
 *
 * A caller-provided root belongs to the caller and is never removed here. A
 * standalone run creates its own and registers a detached supervisor for it.
 */
function establishProfileRoot() {
  const configured = process.env[PROFILE_ROOT_ENV];
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new Error(`${PROFILE_ROOT_ENV} must be an absolute path`);
    }
    const root = path.resolve(configured);
    fs.mkdirSync(root, { recursive: true });
    // A caller-owned root must never inherit a stale handoff from the caller.
    delete process.env[PROFILE_RECEIPT_ENV];
    delete process.env[PROFILE_ROOT_OWNED_ENV];
    delete process.env[SUPERVISOR_START_FAILED_ENV];
    return {
      root,
      createdHere: false,
      receiptPath: null,
      ownerPid: null,
      token: null,
      startFailure: null,
    };
  }

  // eslint-disable-next-line no-restricted-syntax -- Electron userData 由 detached cleanup supervisor 在宿主退出后回收（含归属标记与 receipt）
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-preview-permissions-'));
  const ownerPid = process.pid;
  const token = crypto.randomBytes(24).toString('hex');
  const receiptPath = path.join(
    os.tmpdir(),
    `dshd-preview-cleanup-${path.basename(root)}.json`,
  );
  const markerPath = path.join(root, OWNER_MARKER_BASENAME);

  // Install the ownership marker before the supervisor can be started, and
  // keep the pending receipt outside the directory that is eventually removed.
  fs.writeFileSync(markerPath, `${JSON.stringify({
    version: 1,
    token,
    ownerPid,
    createdAt: new Date().toISOString(),
    profileRoot: root,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  writePendingReceipt(receiptPath, root, ownerPid);

  process.env[PROFILE_ROOT_ENV] = root;
  process.env[PROFILE_RECEIPT_ENV] = receiptPath;
  process.env[PROFILE_ROOT_OWNED_ENV] = '1';
  process.env[SUPERVISOR_START_FAILED_ENV] = '0';
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
 * Start the detached cleanup supervisor for a root this process created.
 *
 * `detached` + `unref` let the helper outlive Electron, and passing `this`
 * process id is what makes the handoff exact: the helper removes the directory
 * only after the process that owns it is gone, and reports the path when it
 * cannot prove removal.
 */
function startProfileCleanupSupervisor(profile) {
  let startFailureRecorded = false;
  let stderrText = '';

  const recordStartFailure = (detail) => {
    if (startFailureRecorded) return;
    startFailureRecorded = true;
    process.env[SUPERVISOR_START_FAILED_ENV] = '1';
    profile.startFailure = detail;

    // This write is intentionally synchronous: the Electron owner may exit
    // immediately after startup, and the failure must remain inspectable.
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
  };

  const executable = process.env[CLEANUP_EXECUTABLE_ENV] || process.execPath;
  const child = spawn(
    executable,
    [
      cleanupHelper,
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

let profile;
try {
  profile = establishProfileRoot();
  // Electron reads these paths during initialization. Both assignments must
  // happen synchronously, before the ready event, or Chromium can already have
  // opened the default cookie/cache stores.
  app.setPath('userData', profile.root);
  app.setPath('sessionData', profile.root);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
}

if (profile?.createdHere) {
  try {
    startProfileCleanupSupervisor(profile);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.env[SUPERVISOR_START_FAILED_ENV] = '1';
    profile.startFailure = detail;
    try {
      writeReceiptAtomic(profile.receiptPath, {
        version: 1,
        state: 'retained',
        reason: 'supervisor-start-failed',
        profileRoot: profile.root,
        ownerPid: profile.ownerPid,
        updatedAt: new Date().toISOString(),
        detail: `synchronous spawn failure: ${detail}`,
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
}

const testScenario = process.env[ALLOW_TEST_SCENARIOS_ENV] === '1'
  ? process.env[TEST_SCENARIO_ENV] ?? ''
  : '';
if (testScenario === 'startup-crash') {
  // Used only by the runner's tests to prove that a pre-ready crash is a
  // failing launch, never a skipped success.
  process.abort();
}

app.whenReady()
  .then(async () => {
    const { main } = await import(pathToFileURL(runner).href);
    await main();
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    app.exit(1);
  });
