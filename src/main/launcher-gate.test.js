'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  shouldPromptUpdate,
  shouldAutoStartDesktop,
  shouldCloseLauncher,
  shouldCloseLauncherAfterDesktopStart,
  readLastDesktopStart,
  writeLastDesktopStart,
  kernelLogTail,
  recordLastDesktopStart,
  stickySkipActive,
  runColdStartGate,
  takeParkedUpdateCheck,
  parkUpdateCheck,
  peekParkedUpdateCheck,
  resetParkedUpdateCheck,
  createParkedUpdateDrainer,
  presentUpdateAsk,
} = require('./launcher-gate');

test('current-start evidence exports only the active attempt with the requested tail bound', () => {
  const historical = ['old-user-pack failed', 'listen EADDRINUSE'];
  const current = ['preparation started', { message: 'current-user-pack failed' }, { line: 'current failure ended' }];
  const dsh = { logs: historical.concat(current), currentStartLogs: () => current };
  assert.deepEqual(kernelLogTail(dsh, 2), ['current-user-pack failed', 'current failure ended']);
  assert.deepEqual(kernelLogTail({ logs: historical, currentStartLogs: () => [] }), []);
  assert.deepEqual(kernelLogTail({ logs: ['legacy last error'] }), ['legacy last error']);
});

test('shouldPromptUpdate asks only for a newer non-error check when the setting is on', () => {
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'available' } }), true);
  assert.equal(shouldPromptUpdate({ askOnUpdate: false, check: { status: 'available' } }), false);
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'current' } }), false);
  assert.equal(shouldPromptUpdate({ askOnUpdate: true, check: { status: 'error' } }), false);
});

test('shouldAutoStartDesktop yields to import hold, update flow hold, and last failure', () => {
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true }), true);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: false }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, holdForImport: true }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, updateFlowHold: true }), false);
  assert.equal(shouldAutoStartDesktop({ autoStartDesktop: true, lastStartFailed: true }), false);
});

test('stickySkipActive is live only for the same app version', () => {
  assert.equal(stickySkipActive(null), false);
  assert.equal(stickySkipActive({}), false);
  assert.equal(stickySkipActive({
    appVersion: '1.2.3',
    pluginRecovery: { skipUserPlugins: false, appVersion: '1.2.3' },
  }), false);
  assert.equal(stickySkipActive({
    appVersion: '1.2.3',
    pluginRecovery: { skipUserPlugins: true, appVersion: '1.2.3' },
  }), true);
  assert.equal(stickySkipActive({
    appVersion: '1.2.4',
    pluginRecovery: { skipUserPlugins: true, appVersion: '1.2.3' },
  }), false);
});

test('shouldCloseLauncher only after a successful desktop start when quit-after-start is on', () => {
  assert.equal(shouldCloseLauncher({ desktopReady: true, quitAfterStart: true }), true);
  assert.equal(shouldCloseLauncher({ desktopReady: true, quitAfterStart: false }), false);
  assert.equal(shouldCloseLauncher({ desktopReady: false, quitAfterStart: true }), false);
});

test('shouldCloseLauncherAfterDesktopStart blocks recovery and sticky skip', () => {
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: false,
    lastStartOk: true,
  }), true);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: true,
    recoveryLaunch: false,
    lastStartOk: true,
  }), false);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: true,
    lastStartOk: true,
  }), false);
  assert.equal(shouldCloseLauncherAfterDesktopStart({
    desktopReady: true,
    quitAfterStart: true,
    stickySkip: false,
    recoveryLaunch: false,
    lastStartOk: false,
  }), false);
});

test('last desktop start file uses tri-state ok and records failure for the next cold start', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-last-start-'));
  assert.equal(readLastDesktopStart(dir).ok, null);
  writeLastDesktopStart(dir, { ok: false, error: 'plugin tree' });
  const last = readLastDesktopStart(dir);
  assert.equal(last.ok, false);
  assert.equal(last.error, 'plugin tree');
  writeLastDesktopStart(dir, { ok: true });
  assert.equal(readLastDesktopStart(dir).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('recordLastDesktopStart writes ok:true on success and ok:false plus rethrow on failure', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-record-start-'));
  try {
    const value = await recordLastDesktopStart(dir, async () => 'started');
    assert.equal(value, 'started');
    assert.equal(readLastDesktopStart(dir).ok, true);
    await assert.rejects(
      () => recordLastDesktopStart(dir, async () => { throw new Error('spawn failed'); }),
      /spawn failed/,
    );
    const last = readLastDesktopStart(dir);
    assert.equal(last.ok, false);
    assert.equal(last.error, 'spawn failed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function gateDeps(overrides = {}) {
  const calls = { openLauncher: 0, startDesktop: 0, sent: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cold-gate-'));
  const deps = {
    config: { askOnUpdate: true, autoStartDesktop: true },
    userDataDir: dir,
    isPackaged: true,
    checkUpdate: async () => ({ status: 'current' }),
    confirmUpdate: async () => false,
    installUpdate: async () => ({ launched: true }),
    openLauncher: async () => { calls.openLauncher += 1; },
    sendToLauncher: (channel, payload) => { calls.sent.push({ channel, payload }); },
    recoverInterruptedImport: () => ({ recovered: false, removedTmp: [] }),
    probeImportHold: () => ({ destEmpty: true, sourceHasData: false, hold: false }),
    startDesktop: async () => { calls.startDesktop += 1; },
    ...overrides,
  };
  return { deps, calls, dir };
}

test('cold-start gate auto-starts the desktop when there is nothing to hold on', async () => {
  const { deps, calls, dir } = gateDeps();
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'desktop');
    assert.equal(calls.startDesktop, 1);
    assert.equal(calls.openLauncher, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate opens the launcher before the update prompt when it stays there', async () => {
  const order = [];
  const { deps, calls, dir } = gateDeps({
    // Auto-start off: the gate stays in the launcher, so the ask still runs and
    // must sit on a visible window.
    config: { askOnUpdate: true, autoStartDesktop: false },
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => {
      order.push('confirm');
      return false;
    },
  });
  deps.openLauncher = async () => {
    calls.openLauncher += 1;
    order.push('openLauncher');
  };
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.deepEqual(order, ['openLauncher', 'confirm']);
    assert.equal(calls.startDesktop, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate reports a returned desktop failure and drains a late update on the visible launcher', async () => {
  const drained = [];
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    startDesktop: async () => { calls.startDesktop += 1; return { ok: false, error: 'failed to start' }; },
    drainParkedUpdateCheck: async () => { drained.push(peekParkedUpdateCheck()?.latest); },
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.lastStartFailed, true);
    assert.equal(calls.openLauncher, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(drained, ['9.9.9']);
  } finally {
    resetParkedUpdateCheck();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate parks a late update result instead of blocking auto-start', async () => {
  const { deps, calls, dir } = gateDeps({
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => {
      throw new Error('auto-start must not prompt inside the gate');
    },
  });
  try {
    const result = await runColdStartGate(deps);
    // Auto-start proceeds without waiting for (or acting on) the update check.
    assert.equal(result.outcome, 'desktop');
    assert.equal(calls.startDesktop, 1);
    assert.equal(calls.openLauncher, 0, 'a late result must not open the launcher');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(takeParkedUpdateCheck()?.latest, '9.9.9');
  } finally {
    resetParkedUpdateCheck();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate starts the desktop before a deferred update check settles', async () => {
  let settle = null;
  const order = [];
  const { deps, calls, dir } = gateDeps({
    checkUpdate: () => new Promise((resolve) => {
      settle = resolve;
      order.push('checkStarted');
    }),
    startDesktop: async () => {
      calls.startDesktop += 1;
      order.push('startDesktop');
    },
  });
  try {
    const gate = runColdStartGate(deps);
    // Let the synchronous part of the gate run; the check stays pending.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settle !== null, true, 'update check must have started');
    assert.equal(calls.startDesktop, 1, 'desktop must start while the check is pending');
    assert.deepEqual(order, ['checkStarted', 'startDesktop']);
    settle({ status: 'available', latest: '9.9.9' });
    const result = await gate;
    assert.equal(result.outcome, 'desktop');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.startDesktop, 1, 'a late check must not start a second desktop');
    assert.equal(calls.openLauncher, 0);
  } finally {
    resetParkedUpdateCheck();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate falls back to the launcher home when the update download fails', async () => {
  const { deps, calls, dir } = gateDeps({
    config: { askOnUpdate: true, autoStartDesktop: false },
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => { throw new Error('下载超时（15 分钟）'); },
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.updateFlowHold, true);
    assert.equal(calls.startDesktop, 0, 'must not auto-start after a failed update flow');
    assert.ok(calls.openLauncher >= 1, 'launcher must be visible');
    const errorHint = calls.sent.find((row) => row.channel === 'shell:launcher-hint'
      && row.payload?.check?.status === 'error');
    assert.match(errorHint.payload.check.message, /下载超时/);
    const homeTab = calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.deepEqual(homeTab.payload, { tab: 'home' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate ends at the installer only when packaged and launched', async () => {
  const { deps, calls, dir } = gateDeps({
    config: { askOnUpdate: true, autoStartDesktop: false },
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => ({ launched: true }),
    isPackaged: true,
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'installer');
    assert.equal(calls.startDesktop, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cold-start gate stays on the launcher after a source-run installer launch', async () => {
  const { deps, calls, dir } = gateDeps({
    config: { askOnUpdate: true, autoStartDesktop: false },
    checkUpdate: async () => ({ status: 'available', latest: '9.9.9' }),
    confirmUpdate: async () => true,
    installUpdate: async () => ({ launched: true }),
    isPackaged: false,
  });
  try {
    const result = await runColdStartGate(deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(calls.startDesktop, 0);
    const hint = calls.sent.filter((row) => row.channel === 'shell:launcher-hint').at(-1);
    assert.match(hint.payload.check.message, /安装器已启动/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('available import data never redirects a normal cold start to import', async () => {
  const importCase = gateDeps({
    probeImportHold: () => ({ destEmpty: true, sourceHasData: true, hold: true }),
  });
  try {
    const result = await runColdStartGate(importCase.deps);
    assert.equal(result.outcome, 'desktop');
    assert.equal(result.holdForImport, false);
    assert.equal(importCase.calls.startDesktop, 1);
    const tab = importCase.calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.equal(tab, undefined);
  } finally {
    fs.rmSync(importCase.dir, { recursive: true, force: true });
  }

});

test('manual-start mode opens home without reading optional import sources', async () => {
  const fixture = gateDeps({
    config: { askOnUpdate: true, autoStartDesktop: false },
    probeImportHold: () => { throw new Error('optional source is unreadable'); },
  });
  try {
    const result = await runColdStartGate(fixture.deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(fixture.calls.startDesktop, 0);
    assert.deepEqual(fixture.calls.sent.find(row => row.channel === 'shell:show-tab').payload, { tab: 'home' });
  } finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
});

test('interrupted import recovery and unreadable journals still hold at import', async () => {
  for (const overrides of [
    { recoverInterruptedImport: () => ({ recovered: true, removedTmp: [] }) },
    { recoverInterruptedImport: () => ({ blocked: true }) },
    { recoverInterruptedImport: () => { throw new Error('recovery failed'); } },
    { readImportJournal: () => ({ unreadable: true }) },
  ]) {
    const fixture = gateDeps(overrides);
    try {
      const result = await runColdStartGate(fixture.deps);
      assert.equal(result.outcome, 'launcher');
      assert.equal(result.holdForImport, true);
      assert.equal(fixture.calls.startDesktop, 0);
      assert.deepEqual(fixture.calls.sent.find(row => row.channel === 'shell:show-tab').payload, { tab: 'import' });
    } finally { fs.rmSync(fixture.dir, { recursive: true, force: true }); }
  }
});

test('failed last start opens home even when optional import data exists', async () => {
  const failedCase = gateDeps({
    probeImportHold: () => ({ destEmpty: true, sourceHasData: true, hold: true }),
  });
  writeLastDesktopStart(failedCase.dir, { ok: false, error: 'plugin tree' });
  try {
    const result = await runColdStartGate(failedCase.deps);
    assert.equal(result.outcome, 'launcher');
    assert.equal(result.lastStartFailed, true);
    assert.equal(failedCase.calls.startDesktop, 0);
    assert.equal(failedCase.calls.openLauncher, 1);
    const tab = failedCase.calls.sent.find((row) => row.channel === 'shell:show-tab');
    assert.deepEqual(tab.payload, { tab: 'home' });
  } finally {
    fs.rmSync(failedCase.dir, { recursive: true, force: true });
  }
});

function drainerDeps(overrides = {}) {
  const state = { visible: true, quitting: false, generation: 'win-1', asked: [] };
  const deps = {
    readConfig: () => ({ askOnUpdate: true }),
    isVisible: () => state.visible,
    isQuitting: () => state.quitting,
    isCurrentGeneration: (generation) => generation === undefined || generation === state.generation,
    present: async (check) => {
      state.asked.push(check);
      return { updateFlowHold: true };
    },
    ...overrides,
  };
  return { deps, state };
}

test('a hidden launcher status poll does not consume the parked update check', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const { deps, state } = drainerDeps({ isVisible: () => false });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const result = await drainer.drain({ generation: 'win-1' });
    assert.equal(result.drained, false);
    assert.equal(result.reason, 'hidden');
    // Still parked: the user can still be asked when the window really opens.
    assert.equal(peekParkedUpdateCheck()?.latest, '9.9.9');
    assert.equal(state.asked.length, 0);
  } finally {
    resetParkedUpdateCheck();
  }
});

test('a visible drain asks exactly once per parked check', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const { deps, state } = drainerDeps();
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const first = await drainer.drain({ generation: 'win-1' });
    const second = await drainer.drain({ generation: 'win-1' });
    assert.equal(first.drained, true);
    assert.equal(second.drained, false);
    assert.equal(second.reason, 'none');
    assert.equal(state.asked.length, 1, 'the same check must not be asked twice');
  } finally {
    resetParkedUpdateCheck();
  }
});

test('concurrent drains share one in-flight ask', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  let release = null;
  const asked = [];
  const { deps } = drainerDeps({
    present: (check) => new Promise((resolve) => {
      asked.push(check);
      release = () => resolve({ updateFlowHold: true });
    }),
  });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const a = drainer.drain({ generation: 'win-1' });
    const b = drainer.drain({ generation: 'win-1' });
    assert.equal(asked.length, 1, 'the second drain joins the first');
    release();
    await Promise.all([a, b]);
    assert.equal(asked.length, 1);
  } finally {
    resetParkedUpdateCheck();
  }
});

test('askOnUpdate=false consumes the parked check without asking', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const { deps, state } = drainerDeps({ readConfig: () => ({ askOnUpdate: false }) });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const result = await drainer.drain({ generation: 'win-1' });
    assert.equal(result.drained, false);
    assert.equal(result.reason, 'not-promptable');
    assert.equal(state.asked.length, 0);
    assert.equal(peekParkedUpdateCheck(), null, 'the refused check must not resurface');
  } finally {
    resetParkedUpdateCheck();
  }
});

test('a drain abandoned by a stale launcher window re-parks the check', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const { deps } = drainerDeps({ isCurrentGeneration: () => false });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const result = await drainer.drain({ generation: 'win-closed' });
    assert.equal(result.drained, false);
    assert.equal(result.reason, 'stale');
    assert.equal(peekParkedUpdateCheck()?.latest, '9.9.9');
  } finally {
    resetParkedUpdateCheck();
  }
});

test('a window that closes mid-confirm abandons the flow instead of installing', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const state = { visible: true, quitting: false, generation: 'win-1', asked: [] };
  let installed = false;
  const { deps } = drainerDeps({
    isVisible: () => state.visible,
    isQuitting: () => state.quitting,
    isCurrentGeneration: () => state.generation === 'win-1',
    present: async (check, context) => presentUpdateAsk({
      config: { askOnUpdate: true },
      isPackaged: true,
      check,
      confirmUpdate: async () => {
        // User closes the launcher while the dialog is up.
        state.generation = 'win-2';
        state.visible = false;
        return true;
      },
      installUpdate: async () => {
        installed = true;
        return { launched: true };
      },
      openLauncher: async () => {},
      sendToLauncher: () => {},
      alreadyVisible: true,
      shouldContinue: () => !state.quitting && deps.isCurrentGeneration(context.generation),
    }),
  });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const result = await drainer.drain({ generation: 'win-1' });
    assert.equal(installed, false, 'a closed launcher must not install an update');
    assert.equal(result.reason, 'abandoned');
    assert.equal(peekParkedUpdateCheck()?.latest, '9.9.9');
  } finally {
    resetParkedUpdateCheck();
  }
});

test('presentUpdateAsk installs the exact release shown in its confirmation', async () => {
  const shown = { status: 'available', latest: '1.2.3', tag: 'v1.2.3', assetUrl: 'https://example.test/1.2.3.exe' };
  let installedCheck = null;
  await presentUpdateAsk({
    config: { askOnUpdate: true },
    isPackaged: true,
    check: shown,
    confirmUpdate: async () => true,
    installUpdate: async (_progress, check) => { installedCheck = check; return { launched: true }; },
    openLauncher: async () => {},
    sendToLauncher: () => {},
    alreadyVisible: true,
  });
  assert.equal(installedCheck, shown);
});

test('quitting abandons the drain before any ask', async () => {
  resetParkedUpdateCheck();
  parkUpdateCheck({ status: 'available', latest: '9.9.9' });
  const { deps, state } = drainerDeps({ isQuitting: () => true });
  try {
    const drainer = createParkedUpdateDrainer(deps);
    const result = await drainer.drain({ generation: 'win-1' });
    assert.equal(result.reason, 'quitting');
    assert.equal(state.asked.length, 0);
    assert.equal(peekParkedUpdateCheck()?.latest, '9.9.9');
  } finally {
    resetParkedUpdateCheck();
  }
});
