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
//   - otherwise this process creates its own root through the shared
//     supervised-directory tool (`lib/owned-dir-supervisor.cjs`) and hands it
//     to a detached plain-Node cleanup supervisor
//     (`preview-profile-cleanup.cjs`) that waits for *this* process to fully
//     exit before removing exactly that directory.
//     An in-process `exit` hook cannot do this safely (Chromium is still
//     unwinding and holds locks), and an Electron parent that synchronously
//     waits for an Electron child deadlocks, so the cleanup runs out of process.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');
const {
  createSupervisedDir,
  startDirCleanupSupervisor,
} = require('./lib/owned-dir-supervisor.cjs');

const PROFILE_ROOT_ENV = 'DSHD_PREVIEW_PROFILE_ROOT';
const PROFILE_RECEIPT_ENV = 'DSHD_PREVIEW_CLEANUP_RECEIPT';
const PROFILE_ROOT_OWNED_ENV = 'DSHD_PREVIEW_PROFILE_ROOT_OWNED';
const SUPERVISOR_START_FAILED_ENV = 'DSHD_PREVIEW_CLEANUP_START_FAILED';
const TEST_SCENARIO_ENV = 'DSHD_PREVIEW_PERMISSIONS_TEST_SCENARIO';
const ALLOW_TEST_SCENARIOS_ENV = 'DSHD_PREVIEW_PERMISSIONS_ALLOW_TEST_SCENARIOS';
const CLEANUP_EXECUTABLE_ENV = 'DSHD_PREVIEW_PERMISSIONS_CLEANUP_EXECUTABLE';
const runner = path.join(__dirname, 'verify-preview-permissions.mjs');

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

  const profile = createSupervisedDir({
    prefix: 'dshd-preview-permissions-',
    receiptPrefix: 'dshd-preview-cleanup-',
  });
  process.env[PROFILE_ROOT_ENV] = profile.root;
  process.env[PROFILE_RECEIPT_ENV] = profile.receiptPath;
  process.env[PROFILE_ROOT_OWNED_ENV] = '1';
  process.env[SUPERVISOR_START_FAILED_ENV] = '0';
  return profile;
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
  startDirCleanupSupervisor(profile, {
    executable: process.env[CLEANUP_EXECUTABLE_ENV],
    onStartFailure: () => { process.env[SUPERVISOR_START_FAILED_ENV] = '1'; },
  });
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
