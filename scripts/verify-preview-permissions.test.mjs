import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const runner = path.join(here, 'verify-preview-permissions.mjs');
const launcher = path.join(here, 'verify-preview-permissions.cjs');
const cleanupHelper = path.join(here, 'preview-profile-cleanup.cjs');
const supervisorModule = path.join(here, 'lib', 'owned-dir-supervisor.cjs');
// Under plain Node `require('electron')` returns the binary path.
const electronBinary = require('electron');
const { shouldDisableElectronSandbox } = require('./lib/electron-sandbox.cjs');
const runnerSource = fs.readFileSync(runner, 'utf8');
const launcherSource = fs.readFileSync(launcher, 'utf8');
const cleanupHelperSource = fs.readFileSync(cleanupHelper, 'utf8');
const supervisorSource = fs.readFileSync(supervisorModule, 'utf8');

const PROFILE_ROOT_ENV = 'DSHD_PREVIEW_PROFILE_ROOT';
const TEST_SCENARIO_ENV = 'DSHD_PREVIEW_PERMISSIONS_TEST_SCENARIO';
const ALLOW_TEST_SCENARIOS_ENV = 'DSHD_PREVIEW_PERMISSIONS_ALLOW_TEST_SCENARIOS';
const OWNER_MARKER_BASENAME = '.dshd-cleanup-owner.json';
const PROBE_ERROR_ENV = 'DSHD_PREVIEW_CLEANUP_PROBE_ERROR';
const FORCE_REMOVE_ERROR_ENV = 'DSHD_PREVIEW_CLEANUP_FORCE_REMOVE_ERROR';
const CLEANUP_EXECUTABLE_ENV = 'DSHD_PREVIEW_PERMISSIONS_CLEANUP_EXECUTABLE';

function samePath(left, right) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function parseReport(stdout) {
  const line = String(stdout ?? '')
    .split(/\r?\n/)
    .filter((entry) => entry.trim().startsWith('{'))
    .at(-1);
  if (!line) return { line: null, report: null, malformed: false };
  try {
    return { line, report: JSON.parse(line), malformed: false };
  } catch {
    return { line, report: null, malformed: true };
  }
}

function assertReportMatchesExitCode(report, status, detail) {
  assert.ok(report, detail);
  assert.equal(
    status,
    report.ok === true ? 0 : 1,
    `report.ok=${report.ok} disagreed with process exit ${status}: ${JSON.stringify(report)}`,
  );
}

/**
 * Render the runner's own diagnostics into an assertion message.
 *
 * A real-Electron acceptance failure is only actionable if the failing
 * assertion names what broke. `stderr` alone is not enough: the runner writes
 * its structured report to stdout, so an exit-status mismatch previously failed
 * with an empty message and no failed check list, no browser outcomes, and no
 * runtime identity. This renders those fields directly into the message.
 */
function describeResult(result) {
  const report = result.report;
  if (!report) {
    return [
      `no JSON report; status=${result.status} signal=${result.signal ?? 'null'}`,
      `stderr=${JSON.stringify(String(result.stderr ?? '').slice(0, 2_000))}`,
      `stdout=${JSON.stringify(String(result.stdout ?? '').slice(-2_000))}`,
    ].join('\n');
  }
  const failedChecks = (report.checks ?? [])
    .filter((entry) => entry.ok !== true)
    .map((entry) => entry.name);
  const diagnostics = {
    ok: report.ok,
    mode: report.mode,
    status: result.status,
    signal: result.signal ?? null,
    failedChecks,
    failureSummary: report.failureSummary,
    error: report.error,
    positiveControlObserved: report.positiveControlObserved ?? null,
    runtime: report.runtime,
    timings: report.timings,
    profileRoot: result.profileRoot,
    userData: report.userData,
    sessionData: report.sessionData,
    checks: report.checks,
    handlerDecisions: report.handlerDecisions,
    permissionChecks: report.permissionChecks,
    browserOutcomes: report.browserOutcomes,
  };
  return [
    `runner diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
    `stderr: ${String(result.stderr ?? '')}`,
  ].join('\n');
}

/**
 * Spawn one real Electron run with a parent-owned profile root. A known exit
 * status lets the parent remove exactly the directory it created; an unknown
 * status preserves the directory so the path can be inspected.
 */
function runElectron(t, options = {}) {
  const {
    args = [],
    scenario = null,
    timeout = 180_000,
  } = options;
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-preview-permissions-test-'));
  const env = { ...process.env };
  // Devin Desktop exports this; it turns electron.exe into plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  env[PROFILE_ROOT_ENV] = profileRoot;
  delete env[CLEANUP_EXECUTABLE_ENV];
  if (scenario) {
    env[TEST_SCENARIO_ENV] = scenario;
    env[ALLOW_TEST_SCENARIOS_ENV] = '1';
  } else {
    delete env[TEST_SCENARIO_ENV];
    delete env[ALLOW_TEST_SCENARIOS_ENV];
  }

  if (shouldDisableElectronSandbox(electronBinary)) {
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }
  const electronArgs = [launcher, '--json', ...args];
  const result = spawnSync(electronBinary, electronArgs, {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout,
    windowsHide: true,
  });
  const parsed = parseReport(result.stdout);
  let profileEntries = [];
  let profileRootExisted = false;
  try {
    profileRootExisted = fs.statSync(profileRoot).isDirectory();
    profileEntries = fs.readdirSync(profileRoot);
  } catch {
    profileRootExisted = false;
  }

  const statusKnown = result.status !== null && result.status !== undefined;
  let profilePreserved = !statusKnown;
  let cleanupError = null;
  if (statusKnown) {
    try {
      fs.rmSync(profileRoot, { recursive: true, force: true });
      profilePreserved = fs.existsSync(profileRoot);
    } catch (error) {
      cleanupError = error;
      profilePreserved = true;
    }
  }
  if (profilePreserved) {
    t.diagnostic(`profile root preserved for inspection: ${profileRoot}`);
  }

  return {
    ...parsed,
    cleanupError,
    profileEntries,
    profilePreserved,
    profileRoot,
    profileRootExisted,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function assertProfileContract(result, report) {
  assert.equal(result.profileRootExisted, true, 'the parent-owned profile root must be used');
  assert.equal(result.profilePreserved, false, 'a known exit must release the temporary profile');
  assert.equal(result.cleanupError, null);
  assert.ok(report.profileRoot, 'the report must echo profileRoot');
  assert.ok(report.userData, 'the report must echo effective userData');
  assert.ok(report.sessionData, 'the report must echo effective sessionData');
  assert.equal(samePath(report.profileRoot, result.profileRoot), true);
  assert.equal(samePath(report.userData, result.profileRoot), true);
  assert.equal(samePath(report.sessionData, result.profileRoot), true);
  assert.equal(report.profileCleanup?.state, 'not-owned');
  assert.equal(report.profileCleanup?.receiptPath, null);
  assert.equal(samePath(report.profileCleanup?.profileRoot, result.profileRoot), true);
}

function createOwnedFixture(t, prefix, ownerPid = deadPidFromObservedExit()) {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const ownerPidValue = ownerPid === 'self' ? process.pid : ownerPid;
  const markerPath = path.join(profileRoot, OWNER_MARKER_BASENAME);
  const receiptPath = path.join(
    os.tmpdir(),
    `${path.basename(profileRoot)}.receipt.json`,
  );
  const token = `test-token-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(
    markerPath,
    `${JSON.stringify({
      version: 1,
      token,
      ownerPid: ownerPidValue,
      createdAt: new Date().toISOString(),
      profileRoot,
    })}\n`,
  );
  t.after(() => {
    fs.rmSync(profileRoot, { recursive: true, force: true });
    fs.rmSync(receiptPath, { force: true });
  });
  return { profileRoot, receiptPath, token, ownerPid: ownerPidValue };
}

function runHelper(fixture, options = {}) {
  const {
    args,
    env = {},
    timeout = 30_000,
  } = options;
  const argv = args ?? [
    cleanupHelper,
    fixture.profileRoot,
    String(fixture.ownerPid),
    '1000',
    '1',
    fixture.receiptPath,
    fixture.token,
  ];
  return spawnSync(process.execPath, argv, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout,
  });
}

function readReceipt(receiptPath) {
  assert.equal(fs.existsSync(receiptPath), true, `receipt missing: ${receiptPath}`);
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

function readReceiptIfPresent(receiptPath) {
  try {
    return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Poll until the receipt reaches a terminal publication for the expected run.
 *
 * The launcher publishes `pending` before the supervisor starts, so "the file
 * exists" is not evidence that cleanup finished. This waits for a terminal
 * state that matches this root and owner, and keeps the last observation in the
 * failure message so a missing, unreadable, and still-pending receipt stay
 * distinguishable.
 */
async function waitForTerminalReceipt(receiptPath, expectation, deadlineMs = 30_000) {
  const deadline = Date.now() + deadlineMs;
  const observations = [];
  for (;;) {
    let raw = null;
    try {
      raw = fs.readFileSync(receiptPath, 'utf8');
    } catch (error) {
      observations.push(`unreadable: ${error.code ?? error.message}`);
    }
    if (raw !== null) {
      let receipt = null;
      let parseError = null;
      try {
        receipt = JSON.parse(raw);
      } catch (error) {
        parseError = error;
      }
      if (parseError) {
        observations.push(`unparseable: ${parseError.message}`);
      } else {
        observations.push(receipt.state);
        const terminal = receipt.state === 'removed' || receipt.state === 'retained';
        const matches = expectation.profileRoot === undefined
          || samePath(receipt.profileRoot, expectation.profileRoot);
        const ownerMatches = expectation.ownerPid === undefined
          || receipt.ownerPid === expectation.ownerPid;
        if (terminal && matches && ownerMatches) return receipt;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `receipt never reached a matching terminal state within ${deadlineMs}ms: `
        + `${receiptPath}; observed=${JSON.stringify(observations.slice(-12))}`,
      );
    }
    await new Promise((resolve) => { setTimeout(resolve, 50); });
  }
}

/**
 * Spawn a real child, observe its exit, and return its now-dead pid.
 *
 * Cleanup tests must key the helper to a process that is *known* to have
 * exited. An assumed-dead constant risks hitting an unrelated live process,
 * which would divert the run into `owner-timeout` instead of exercising the
 * branch under test. The pid is reused only after this process observed the
 * child's exit event.
 */
function deadPidFromObservedExit() {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' });
  assert.equal(child.status, 0, `the fixture child did not exit cleanly: ${child.stderr}`);
  // spawnSync only returns after the child has exited, so this pid is confirmed
  // gone at this point. Reuse is never asserted; the helper's tri-state probe
  // still decides, and any reuse is reported as a retained run rather than a
  // silent deletion.
  return child.pid;
}

test('launcher installs userData and sessionData synchronously before ready', () => {
  const userData = launcherSource.indexOf("app.setPath('userData'");
  const sessionData = launcherSource.indexOf("app.setPath('sessionData'");
  // The header comment also mentions app.whenReady(); use the actual call.
  const ready = launcherSource.lastIndexOf('app.whenReady()');
  assert.ok(userData >= 0, 'the launcher must set userData');
  assert.ok(sessionData > userData, 'the launcher must also set sessionData');
  assert.ok(ready > sessionData, 'both paths must be installed before app.whenReady()');
  // The launcher delegates run-owned roots to the shared supervised-directory
  // tool instead of creating them itself.
  assert.doesNotMatch(launcherSource, /mkdtempSync/);
  assert.match(launcherSource, /createSupervisedDir/);
  assert.match(launcherSource, new RegExp(PROFILE_ROOT_ENV));
  // The shared owner-side module is what creates the directory, writes the
  // ownership marker, and spawns the detached helper.
  assert.match(supervisorSource, /createUniqueDir/);
  assert.match(supervisorSource, /preview-profile-cleanup\.cjs/);
  assert.match(supervisorSource, /detached:\s*true/);
  assert.match(supervisorSource, /randomBytes\(24\)/);
  assert.match(supervisorSource, /\.dshd-cleanup-owner\.json/);
  assert.match(supervisorSource, /state:\s*'pending'/);
  // The ESM runner must reuse the launcher's root instead of creating a later
  // second profile or mutating Electron paths after ready.
  assert.doesNotMatch(runnerSource, /fs\.mkdtempSync/);
  assert.doesNotMatch(runnerSource, /app\.setPath\(/);
  // Ownership must be handed to an out-of-process supervisor rather than an
  // in-Electron `exit` hook: that hook runs while Chromium still holds the
  // profile locks, which is what left directories behind.
  // The cleanup handoff must carry the marker token and a receipt outside the
  // directory that the helper eventually removes.
  assert.match(launcherSource, /DSHD_PREVIEW_CLEANUP_RECEIPT/);
  assert.doesNotMatch(
    launcherSource,
    /process\.once\('exit'/,
    'cleanup must not run from an in-Electron exit hook',
  );
  assert.doesNotMatch(
    launcherSource,
    /rmSync/,
    'the Electron process must not remove the profile itself',
  );
});

test('profile cleanup supervisor is detached, owner-pid bound, and fail-closed', () => {
  // A cleanup helper must not be an Electron child of the runner: an Electron
  // parent that waits on an Electron child was measured to deadlock.
  assert.match(supervisorSource, /env:\s*\{[^}]*ELECTRON_RUN_AS_NODE/s);
  assert.match(supervisorSource, /unref\(\)/);
  // The helper removes exactly one directory, keyed to the owning pid.
  assert.match(cleanupHelperSource, /process\.argv\[2\]/);
  assert.match(cleanupHelperSource, /process\.argv\[3\]/);
  assert.match(cleanupHelperSource, /process\.kill\(pid,\s*0\)/);
  assert.match(cleanupHelperSource, /fs\.rmSync\(profileRoot/);
  // Unknown/uncertain outcomes retain the directory and name its path.
  assert.match(cleanupHelperSource, /profile root retained/);
  assert.match(cleanupHelperSource, /case 'unknown'|state !== 'alive'/);
});

test('profile cleanup supervisor removes an exited owner\'s root', (t) => {
  const owner = spawnSync(process.execPath, ['-e', 'process.exit(0)'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(owner.status, 0, owner.stderr);
  const fixture = createOwnedFixture(t, 'dshd-cleanup-success-', owner.pid);
  fs.writeFileSync(path.join(fixture.profileRoot, 'marker.txt'), 'x');

  const removed = runHelper(fixture, { args: [
    cleanupHelper,
    fixture.profileRoot,
    String(fixture.ownerPid),
    '3000',
    '2',
    fixture.receiptPath,
    fixture.token,
  ] });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(fs.existsSync(fixture.profileRoot), false, 'a gone owner must release its root');
  const receipt = readReceipt(fixture.receiptPath);
  assert.equal(receipt.state, 'removed');
  assert.equal(receipt.reason, 'removed');
  assert.equal(receipt.profileRoot, fixture.profileRoot);
});

test('profile cleanup supervisor retains a live owner past the deadline', (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-timeout-', 'self');
  const retained = runHelper(fixture, { args: [
    cleanupHelper,
    fixture.profileRoot,
    String(fixture.ownerPid),
    '1000',
    '1',
    fixture.receiptPath,
    fixture.token,
  ] });
  assert.equal(retained.status, 1, `expected a fail-closed timeout, got ${retained.status}`);
  assert.match(retained.stderr, /profile root retained/);
  assert.ok(retained.stderr.includes(fixture.profileRoot), 'the retained path must be reported');
  assert.equal(fs.existsSync(fixture.profileRoot), true, 'a live owner must retain the root');
  const receipt = readReceipt(fixture.receiptPath);
  assert.equal(receipt.state, 'retained');
  assert.equal(receipt.reason, 'owner-timeout');
});

test('an unexpected owner probe error retains the root', (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-probe-unknown-');
  const result = runHelper(fixture, { env: { [PROBE_ERROR_ENV]: '1' } });
  assert.equal(result.status, 1, result.stderr);
  const receipt = readReceipt(fixture.receiptPath);
  assert.equal(receipt.state, 'retained');
  assert.equal(receipt.reason, 'owner-probe-unknown');
  assert.equal(fs.existsSync(fixture.profileRoot), true);
});

test('invalid ownership or input retains the root and keeps an adjacent sentinel', (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-invalid-');
  const sentinelRoot = `${fixture.profileRoot}.sentinel`;
  fs.mkdirSync(sentinelRoot);
  fs.writeFileSync(path.join(sentinelRoot, 'sentinel.txt'), 'sentinel-body');
  t.after(() => fs.rmSync(sentinelRoot, { recursive: true, force: true }));

  const relative = runHelper(fixture, { args: [
    cleanupHelper,
    'relative-profile-root',
    String(fixture.ownerPid),
    '1000',
    '1',
    fixture.receiptPath,
    fixture.token,
  ] });
  assert.equal(relative.status, 1, relative.stderr);
  assert.equal(readReceipt(fixture.receiptPath).reason, 'invalid-input');

  fs.rmSync(fixture.receiptPath, { force: true });
  const badPid = runHelper(fixture, { args: [
    cleanupHelper,
    fixture.profileRoot,
    '0',
    '1000',
    '1',
    fixture.receiptPath,
    fixture.token,
  ] });
  assert.equal(badPid.status, 1, badPid.stderr);
  assert.equal(readReceipt(fixture.receiptPath).reason, 'invalid-input');

  fs.rmSync(fixture.receiptPath, { force: true });
  const mismatched = runHelper(fixture, { args: [
    cleanupHelper,
    fixture.profileRoot,
    String(fixture.ownerPid),
    '1000',
    '1',
    fixture.receiptPath,
    'wrong-token',
  ] });
  assert.equal(mismatched.status, 1, mismatched.stderr);
  assert.equal(readReceipt(fixture.receiptPath).reason, 'ownership-mismatch');

  assert.equal(fs.existsSync(fixture.profileRoot), true);
  assert.equal(fs.readFileSync(path.join(sentinelRoot, 'sentinel.txt'), 'utf8'), 'sentinel-body');
});

test('a deterministic removal failure is reported and retained', (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-removal-failed-');
  const blocked = runHelper(fixture, { env: { [FORCE_REMOVE_ERROR_ENV]: '1' } });
  assert.equal(blocked.status, 2, `expected a reported failure, got ${blocked.status}`);
  assert.match(blocked.stderr, /retained/);
  assert.ok(blocked.stderr.includes(fixture.profileRoot), 'the retained path must be reported');
  assert.equal(fs.existsSync(fixture.profileRoot), true);
  const receipt = readReceipt(fixture.receiptPath);
  assert.equal(receipt.state, 'retained');
  assert.equal(receipt.reason, 'removal-failed');
});

test('a failed receipt replacement preserves the previous readable receipt', (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-receipt-replace-');

  // Publish a valid pending receipt first, exactly as the launcher does.
  const { writeReceiptAtomic, FORCE_REPLACE_FAILURE_ENV } = require('./lib/receipt-file.cjs');
  const previous = {
    version: 1,
    state: 'pending',
    reason: 'pending',
    profileRoot: fixture.profileRoot,
    ownerPid: fixture.ownerPid,
    updatedAt: new Date().toISOString(),
    detail: null,
  };
  writeReceiptAtomic(fixture.receiptPath, previous);
  const beforeBytes = fs.readFileSync(fixture.receiptPath, 'utf8');

  // An adjacent, unowned file must stay untouched by the failed publication.
  const sentinelPath = path.join(path.dirname(fixture.receiptPath), `${path.basename(fixture.receiptPath)}.sentinel`);
  fs.writeFileSync(sentinelPath, 'sentinel-body');
  t.after(() => { fs.rmSync(sentinelPath, { force: true }); });

  // The helper's terminal publication must fail, and it must not delete the
  // previous receipt to make room for the replacement.
  const blocked = runHelper(fixture, {
    env: { [FORCE_REMOVE_ERROR_ENV]: '1', [FORCE_REPLACE_FAILURE_ENV]: '1' },
  });
  assert.notEqual(blocked.status, 0, 'a failed terminal publication must not report success');
  assert.match(blocked.stderr, /receipt|publication|publish/i);

  assert.equal(fs.existsSync(fixture.receiptPath), true, 'the previous receipt must survive');
  assert.equal(
    fs.readFileSync(fixture.receiptPath, 'utf8'),
    beforeBytes,
    'the previous receipt must be byte-for-byte unchanged',
  );
  assert.equal(readReceipt(fixture.receiptPath).state, 'pending');
  assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'sentinel-body');
  assert.equal(fs.existsSync(fixture.profileRoot), true, 'a failed publication must retain the root');
});

test('an observer waits for terminal publication, not mere file existence', async (t) => {
  const fixture = createOwnedFixture(t, 'dshd-cleanup-receipt-observe-');
  const { writeReceiptAtomic } = require('./lib/receipt-file.cjs');

  writeReceiptAtomic(fixture.receiptPath, {
    version: 1,
    state: 'pending',
    reason: 'pending',
    profileRoot: fixture.profileRoot,
    ownerPid: fixture.ownerPid,
    updatedAt: new Date().toISOString(),
    detail: null,
  });

  // Removal happens before the terminal write in production; simulate that
  // ordering explicitly and publish the terminal receipt only after a delay.
  fs.rmSync(fixture.profileRoot, { recursive: true, force: true });
  const publish = new Promise((resolve) => {
    setTimeout(() => {
      writeReceiptAtomic(fixture.receiptPath, {
        version: 1,
        state: 'removed',
        reason: 'removed',
        profileRoot: fixture.profileRoot,
        ownerPid: fixture.ownerPid,
        updatedAt: new Date().toISOString(),
        detail: null,
      });
      resolve();
    }, 400);
  });

  // A naive "does the receipt exist?" check would already pass here and read
  // `pending`. The correct observer must keep waiting.
  const early = readReceiptIfPresent(fixture.receiptPath);
  assert.equal(early.state, 'pending', 'the fixture must start from a published pending receipt');

  const terminal = await waitForTerminalReceipt(
    fixture.receiptPath,
    { profileRoot: fixture.profileRoot, ownerPid: fixture.ownerPid },
    5_000,
  );
  await publish;
  assert.equal(terminal.state, 'removed');

  // A terminal result that never arrives must fail within its own bounded
  // deadline while preserving the last observed state.
  const neverPath = path.join(os.tmpdir(), `dshd-cleanup-never-${process.pid}-${Date.now()}.json`);
  writeReceiptAtomic(neverPath, {
    version: 1,
    state: 'pending',
    reason: 'pending',
    profileRoot: fixture.profileRoot,
    ownerPid: fixture.ownerPid,
    updatedAt: new Date().toISOString(),
    detail: null,
  });
  t.after(() => { fs.rmSync(neverPath, { force: true }); });
  await assert.rejects(
    () => waitForTerminalReceipt(neverPath, {}, 300),
    /never reached a matching terminal state/,
  );
  assert.equal(readReceiptIfPresent(neverPath).state, 'pending', 'the last observed state must remain readable');
});

test('a failed supervisor start writes a retained receipt through the launcher', (t) => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env[PROFILE_ROOT_ENV];
  delete env[TEST_SCENARIO_ENV];
  delete env[ALLOW_TEST_SCENARIOS_ENV];
  env[CLEANUP_EXECUTABLE_ENV] = path.join(
    os.tmpdir(),
    `dshd-missing-cleanup-executable-${process.pid}-${Date.now()}`,
  );
  if (shouldDisableElectronSandbox(electronBinary)) {
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }

  const result = spawnSync(electronBinary, [launcher, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 180_000,
    windowsHide: true,
  });
  const { report } = parseReport(result.stdout);
  assert.ok(report, `runner produced no JSON report; stderr: ${result.stderr}`);
  assert.equal(result.status, 0, describeResult({ ...result, report }));
  assert.equal(report.ok, true);
  assert.equal(report.profileCleanup?.state, 'retained');
  assert.ok(path.isAbsolute(report.profileCleanup.receiptPath));
  assert.equal(samePath(report.profileCleanup.profileRoot, report.profileRoot), true);

  const receipt = readReceipt(report.profileCleanup.receiptPath);
  assert.equal(receipt.state, 'retained');
  assert.equal(receipt.reason, 'supervisor-start-failed');
  assert.equal(fs.existsSync(report.profileRoot), true);
  t.after(() => {
    fs.rmSync(report.profileRoot, { recursive: true, force: true });
    fs.rmSync(report.profileCleanup.receiptPath, { force: true });
  });
});

test('standalone run cleans up only the root it created, after the owner exited', { timeout: 180_000 }, async (t) => {
  // No `DSHD_PREVIEW_PROFILE_ROOT`: the launcher becomes the owner, creates its
  // own root, and hands it to the detached supervisor. The directory must be
  // gone only after this Electron process has fully exited.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env[PROFILE_ROOT_ENV];
  delete env[TEST_SCENARIO_ENV];
  delete env[ALLOW_TEST_SCENARIOS_ENV];
  if (shouldDisableElectronSandbox(electronBinary)) {
    env.ELECTRON_DISABLE_SANDBOX = '1';
  }

  const result = spawnSync(electronBinary, [launcher, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: 180_000,
    windowsHide: true,
  });
  const { report } = parseReport(result.stdout);
  assert.ok(report, `standalone run produced no JSON report; stderr: ${result.stderr}`);
  assert.equal(result.status, 0, describeResult({ ...result, report }));
  assert.equal(report.ok, true);
  assert.equal(report.profileCleanup?.state, 'pending');
  assert.equal(path.isAbsolute(report.profileCleanup?.receiptPath), true);
  assert.equal(samePath(report.profileCleanup?.profileRoot, report.profileRoot), true);

  // The runner names the root it owned, and it must not be a directory this
  // test created: cleanup is scoped to the runner's own root.
  assert.ok(report.profileRoot, 'a standalone run must report its run-owned root');
  assert.equal(path.isAbsolute(report.profileRoot), true);
  assert.notEqual(samePath(report.profileRoot, root), true);
  assert.equal(
    samePath(path.dirname(report.profileRoot), os.tmpdir()),
    true,
    `the run-owned root must live directly under the OS temp directory: ${report.profileRoot}`,
  );

  // The supervisor is a separate process, so removal is not synchronous with the
  // owner's exit. The launcher already published `pending` before the supervisor
  // started, and the helper removes the root *before* writing its terminal
  // receipt — so "the file exists" or "the root is gone" would both race the
  // publication. Wait for a terminal receipt that matches this root and owner.
  const receipt = await waitForTerminalReceipt(
    report.profileCleanup.receiptPath,
    { profileRoot: report.profileRoot, ownerPid: report.profileCleanup.ownerPid },
    30_000,
  );
  const stillPresent = fs.existsSync(report.profileRoot);
  if (stillPresent) {
    t.diagnostic(`standalone profile root not removed: ${report.profileRoot}`);
    fs.rmSync(report.profileRoot, { recursive: true, force: true });
  }
  assert.ok(
    receipt.state === 'removed' || receipt.state === 'retained',
    `standalone cleanup receipt did not reach a terminal state: ${JSON.stringify(receipt)}`,
  );
  if (stillPresent) {
    assert.equal(receipt.state, 'retained');
  } else {
    assert.equal(receipt.state, 'removed');
  }
  fs.rmSync(report.profileCleanup.receiptPath, { force: true });
  assert.equal(
    stillPresent,
    false,
    `a known exit must let the owning supervisor remove the run-owned root: ${report.profileRoot}`,
  );
});

test('runner refuses to pass under plain Node and keeps the production wiring', () => {
  const result = spawnSync(process.execPath, [runner], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const { report } = parseReport(result.stdout);
  assert.ok(report, `runner produced no JSON report; stderr: ${result.stderr}`);
  assert.equal(result.status, 1);
  assert.equal(report.ok, false);
  assert.equal(report.mode, 'unsupported-runtime');
  assert.equal(report.profileRoot, null);
  assert.equal(report.userData, null);
  assert.equal(report.sessionData, null);
  assert.match(report.error ?? '', /must run under Electron/);
  assert.match(runnerSource, /configurePreviewSession/);
  assert.match(runnerSource, /createPreviewSessionCache/);
  assert.doesNotMatch(runnerSource, /setPermissionRequestHandler\s*\(\s*\(.*\)\s*=>\s*\{[^}]*callback\(true\)/s);
  assert.doesNotMatch(runnerSource, /\bdialog\b/);
});

test('default-deny reports success and exits 0 under real Electron', { timeout: 180_000 }, (t) => {
  const result = runElectron(t);
  assert.ok(result.report, `runner produced no JSON report; stderr: ${result.stderr}`);
  const diagnostics = describeResult(result);
  assertReportMatchesExitCode(result.report, result.status, diagnostics);
  assert.equal(result.status, 0, diagnostics);
  assert.equal(result.report.mode, 'default-deny');
  assert.equal(result.report.allowListSize, 0);
  assert.equal(result.report.positiveControlObserved, null);
  assertProfileContract(result, result.report);
  assert.ok(result.profileEntries.length > 0, 'Chromium must have written session data into the run-owned root');
  assert.ok(result.report.runtime, 'the report must name the runtime that produced it');
  assert.ok(result.report.runtime.electron, 'the report must name the Electron version');
  assert.ok(result.report.runtime.chrome, 'the report must name the Chromium version');
  assert.equal(result.report.runtime.platform, process.platform);
  assert.ok(result.report.timings, 'the report must carry per-stage timings');
  for (const stage of ['startCrossServerMs', 'startMainServerMs', 'loadMs', 'probeResultsMs']) {
    assert.equal(typeof result.report.timings[stage], 'number', `missing timing: ${stage}`);
  }
  assert.equal(result.report.failureSummary, undefined, 'a passing run carries no failure summary');

  const failed = result.report.checks.filter((entry) => entry.ok !== true);
  assert.deepEqual(failed, []);
  assert.ok(result.report.handlerDecisions.length > 0, 'no real permission request reached the handler');
  assert.ok(result.report.permissionChecks.length > 0, 'no real permission check reached the handler');
  const exactStateCheck = result.report.checks.find(
    (entry) => entry.name === 'required permission probes report their exact expected state',
  );
  assert.ok(exactStateCheck, 'the required probes must be asserted exactly, not by absence');
  assert.deepEqual(exactStateCheck.detail.queryStateFailures, []);
  assert.equal(
    result.report.checks.some((entry) => entry.name === 'permissions.query reports denied for every frame'),
    false,
    'the loose "not denied means observed" check must not remain',
  );
  // Default-deny must observe no grant at all, from any probe.
  const defaultDenyGrantCheck = result.report.checks.find(
    (entry) => entry.name === 'only the mode-declared permission outcomes were granted',
  );
  assert.ok(defaultDenyGrantCheck, 'the grant set must be asserted in default-deny mode');
  assert.equal(defaultDenyGrantCheck.ok, true, JSON.stringify(defaultDenyGrantCheck.detail));
  assert.deepEqual(defaultDenyGrantCheck.detail.expectedGrants, []);
  assert.deepEqual(defaultDenyGrantCheck.detail.grantedObservations, []);
  assert.deepEqual(defaultDenyGrantCheck.detail.unexpectedGrants, []);
  for (const decision of result.report.handlerDecisions) {
    assert.equal(decision.decision, false, JSON.stringify(decision));
    assert.equal(decision.callbackCount, 1);
    assert.equal(decision.synchronous, true);
    assert.equal(decision.threw, null);
  }
  for (const check of result.report.permissionChecks) {
    assert.equal(check.allowed, false);
    assert.equal(check.threw, null);
  }
  for (const [frameId, frame] of Object.entries(result.report.browserOutcomes)) {
    for (const [probe, outcome] of Object.entries(frame.outcomes)) {
      assert.ok(
        !String(outcome).startsWith('granted'),
        `${frameId}.${probe} was granted: ${outcome}`,
      );
      if (probe.startsWith('query_') && outcome !== 'unsupported') {
        assert.equal(outcome, 'denied', `${frameId}.${probe}`);
      }
    }
  }
});

test('positive control succeeds under its declared semantics and exits 0', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { args: ['--positive-control'] });
  assert.ok(result.report, `positive control produced no JSON report; stderr: ${result.stderr}`);
  const diagnostics = describeResult(result);
  assertReportMatchesExitCode(result.report, result.status, diagnostics);
  assert.equal(result.status, 0, diagnostics);
  assert.equal(result.report.mode, 'positive-control');
  assert.equal(result.report.allowListSize, 1);
  assert.equal(result.report.positiveControlObserved, true);
  assertProfileContract(result, result.report);
  const failed = result.report.checks.filter((entry) => entry.ok !== true);
  assert.deepEqual(failed, []);
  // The allow-listed probe must be observable in a trusted frame while the
  // cross-origin loopback frame stays denied by the production binding seam.
  assert.equal(result.report.browserOutcomes.main.outcomes.query_geolocation, 'granted');
  assert.equal(result.report.browserOutcomes.same.outcomes.query_geolocation, 'granted');
  assert.equal(result.report.browserOutcomes.cross.outcomes.query_geolocation, 'denied');
  assert.ok(
    result.report.checks.some((entry) => entry.name === 'positive control observed the allow-listed permission'),
  );
  assert.equal(
    result.report.positiveControlObserved,
    true,
    'the allow-listed permission must be observed as exactly `granted`',
  );
  // The positive-control run is asserted with the same exact-state contract as
  // the negative run, so an `unsupported`/`timeout`/`threw:` probe cannot be
  // mistaken for an observed grant.
  const exactStateCheck = result.report.checks.find(
    (entry) => entry.name === 'required permission probes report their exact expected state',
  );
  assert.ok(exactStateCheck, 'the exact per-frame state check must run in positive-control mode');
  assert.equal(exactStateCheck.ok, true, JSON.stringify(exactStateCheck.detail));
  assert.deepEqual(exactStateCheck.detail.queryStateFailures, []);
  assert.equal(
    result.report.checks.some((entry) => entry.name === 'production allow-list is empty'),
    false,
    'the default-deny-only assertion must not be evaluated in positive-control mode',
  );
  // The positive control may not wave grants through: the only permitted grants
  // are the allow-listed geolocation query in the two trusted frames. A grant
  // observed through any other probe -- or in the cross-origin frame -- is an
  // unexpected permission and must fail the run.
  const grantCheck = result.report.checks.find(
    (entry) => entry.name === 'only the mode-declared permission outcomes were granted',
  );
  assert.ok(grantCheck, 'the grant set must be asserted in positive-control mode too');
  assert.equal(grantCheck.ok, true, JSON.stringify(grantCheck.detail));
  assert.deepEqual(grantCheck.detail.expectedGrants, ['main.query_geolocation', 'same.query_geolocation']);
  assert.deepEqual(grantCheck.detail.unexpectedGrants, []);
  assert.deepEqual(
    [...grantCheck.detail.grantedObservations].sort(),
    ['main.query_geolocation', 'same.query_geolocation'],
  );
});

test('an injected assertion failure reports ok:false and exits 1', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { scenario: 'assertion-failure' });
  assert.ok(result.report, `runner produced no JSON report; stderr: ${result.stderr}`);
  assertReportMatchesExitCode(result.report, result.status, result.stderr);
  assert.equal(result.status, 1);
  assert.equal(result.report.ok, false);
  assert.equal(result.report.mode, 'default-deny');
  assertProfileContract(result, result.report);
  assert.ok(result.report.checks.some((entry) => (
    entry.name === 'test-injected assertion failure' && entry.ok === false
  )));
  // A failing run must be diagnosable from the report alone: the exact failed
  // check names, the failure surface, timings, and runtime identity.
  assert.ok(result.report.failureSummary, 'a failing run must carry a failure summary');
  assert.ok(
    result.report.failureSummary.failedChecks.includes('test-injected assertion failure'),
    JSON.stringify(result.report.failureSummary),
  );
  assert.ok(
    result.report.failureSummary.failedCheckDetails.some((entry) => entry.ok !== true),
    'the failure summary must retain the failed check details',
  );
  assert.ok(result.report.runtime?.electron, 'a failing run must still name the runtime');
  assert.ok(result.report.timings, 'a failing run must still carry timings');
});

test('a runner exception reports ok:false and exits 1', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { scenario: 'runner-error' });
  assert.ok(result.report, `runner produced no JSON report; stderr: ${result.stderr}`);
  assertReportMatchesExitCode(result.report, result.status, result.stderr);
  assert.equal(result.status, 1);
  assert.equal(result.report.ok, false);
  assert.match(result.report.error ?? '', /test-injected runner failure/);
  assertProfileContract(result, result.report);
});

test('a missing JSON report is a failing launch', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { scenario: 'missing-report' });
  assert.equal(result.report, null);
  assert.equal(result.malformed, false);
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.profileRootExisted, true, 'the runner must use the parent-owned profile root');
  assert.equal(result.profilePreserved, false);
  assert.equal(result.cleanupError, null);
});

test('a malformed JSON report is a failing launch', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { scenario: 'malformed-report' });
  assert.equal(result.report, null);
  assert.equal(result.malformed, true);
  assert.equal(result.line, '{"ok":');
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.profileRootExisted, true, 'the runner must use the parent-owned profile root');
  assert.equal(result.profilePreserved, false);
  assert.equal(result.cleanupError, null);
});

test('a startup crash is never treated as a skipped success', { timeout: 180_000 }, (t) => {
  const result = runElectron(t, { scenario: 'startup-crash' });
  assert.equal(result.report, null);
  assert.notEqual(result.status, 0, `startup crash unexpectedly exited ${result.status}`);
  if (result.status === null) {
    assert.equal(result.profilePreserved, true, 'an unknown exit status must preserve the profile');
  } else {
    assert.equal(result.profilePreserved, false);
    assert.equal(result.cleanupError, null);
  }
});
