// A2: real controller, launcher service, task coordinator and shared import guard.
// Only external process, UI, config and import I/O are replaced by isolated dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
'use strict';
const path = require('node:path');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const repo = path.resolve(__dirname, '../..');
const { HarnessController } = require(path.join(repo, 'src/main/harness-controller.js'));
const importGuard = require(path.join(repo, 'src/main/import-guard.js'));
const { createTaskProtection } = require(path.join(repo, 'src/main/task-protection.js'));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function settle() { return new Promise(r => setImmediate(r)); }
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout: ' + label)), 2500); })]); }
  finally { clearTimeout(timer); }
}
function fixture(initialConfig = {}, extra = {}) {
  const events = [];
  const record = (type, data = {}) => events.push({ seq: events.length + 1, type, ...data });
  let config = { workspace: 'fixture-only', harnessAutoRestart: true, harnessRestartMaxAttempts: 3,
    harnessRestartBaseDelayMs: 1000, pluginRecovery: { skipUserPlugins: false }, ...initialConfig };
  const clock = { next: 1, timers: new Map(), now: 10000,
    set(fn, ms) { const id = this.next++; this.timers.set(id, { fn, ms }); return id; },
    clear(id) { this.timers.delete(id); } };
  class FakeDsh extends EventEmitter {
    constructor() { super(); this.state = 'idle'; this.error = ''; this.failure = null; this.baseUrl = ''; this.logs = []; this.starts = []; this.stopCalls = 0; this.startFailures = []; }
    snapshot() { return { state: this.state, error: this.error, failure: this.failure, baseUrl: this.baseUrl, logs: this.logs.slice(-80) }; }
    setState(state, extra = {}) { Object.assign(this, extra, { state }); record('state', { state }); this.emit('state', this.snapshot()); }
    log(message, source = 'app') { const line = `[${source}] ${message}`; this.logs.push(line); this.emit('log', line); }
    async start(options) {
      this.starts.push({ skipUserPlugins: options.skipUserPlugins });
      record('dsh.start', { count: this.starts.length, skipUserPlugins: options.skipUserPlugins, maintenanceOwner: importGuard.maintenanceOwner()?.kind || null });
      if (this.startFailures.length) { const err = new Error(this.startFailures.shift()); this.setState('error', { error: err.message, failure: { phase: 'startup', message: err.message } }); throw err; }
      this.setState('ready', { error: '', failure: null, baseUrl: 'http://fixture.invalid:3080' }); return this.baseUrl;
    }
    async stop() { this.stopCalls++; record('dsh.stop', { count: this.stopCalls }); this.setState('idle', { error: '', failure: null, baseUrl: '' }); }
    crash(message) { this.setState('error', { error: message, failure: { phase: 'runtime', message, code: 1 } }); }
  }
  const dsh = new FakeDsh();
  const boot = deferred(); const bootEntered = deferred(); let holdBoot = false;
  const win = { webContents: { openDevTools: () => record('openDevTools') } };
  const controller = new HarnessController({
    dsh, loadConfig: () => config, saveConfig: patch => { config = { ...config, ...patch }; record('saveConfig', { patch }); },
    appVersion: 'fixture-1', createMainWindow: () => win, getMainWindow: () => win,
    showBoot: async () => { record('showBoot.enter', { held: holdBoot }); if (holdBoot) { bootEntered.resolve(); await boot.promise; } record('showBoot.exit'); },
    showHarness: async () => record('showHarness'), sendToBoot: () => {}, resolveLaunchTarget: async () => ({ port: 3080 }),
    stripDroppedPlugins: () => {}, ensureWorkspace: async () => {}, remote: { sync: async () => {}, stopDaemon: async () => {} },
    setTimer: clock.set.bind(clock), clearTimer: clock.clear.bind(clock), now: () => clock.now,
    ...extra,
  });
  return { controller, dsh, events, record, clock, config: () => config,
    holdBoot: () => { holdBoot = true; }, releaseBoot: () => boot.resolve(), bootEntered: bootEntered.promise };
}
function launcherFixture(f, { readImportJournal = () => null } = {}) {
  const entered = deferred(); const gate = deferred(); let importPending = false;
  const servicePath = path.join(repo, 'src/launcher/launcher-service.js');
  const realLoad = Module._load;
  const mocks = {
    electron: { app: { getPath: () => __dirname }, dialog: {} },
    '../main/window': { getLauncherWindow: () => null, getMainWindow: () => null, dismissMainWindow: () => f.record('dismissMainWindow') },
    '../main/update': {},
    '../main/data-import': {
      readImportJournal, journalIsBlocked: journal => Boolean(journal?.phase === 'blocked' || journal?.unreadable), probeImportHold: () => ({ hold: false }),
      runImport: async options => { importPending = true; f.record('dataImport.enter', { state: f.dsh.state, selectedRels: options.selectedRels, maintenanceOwner: importGuard.maintenanceOwner()?.kind }); entered.resolve(); await gate.promise; importPending = false; f.record('dataImport.exit'); return { ok: true }; },
    },
    '../main/marketplace-install': {}, '../main/plugins': { OFFICIAL_TEMPLATE_BUNDLES: new Set() },
    '../main/profile-ops': { kernelIsRunning: dsh => dsh.state !== 'idle' },
    '../main/plugin-forensics': {},
    '../main/config': { loadConfig: f.config, saveConfig: () => { throw new Error('unexpected service config mutation'); } },
    './release-source': {}, './runtime-install': {}, './forensics-log': {},
    './product': { isLauncherPackage: () => false, desktopStateDir: () => __dirname },
  };
  let createLauncherService;
  const cachedService = require.cache[require.resolve(servicePath)];
  try {
    Module._load = function(id, parent, isMain) {
      if (parent?.filename === servicePath && Object.hasOwn(mocks, id)) return mocks[id];
      return realLoad.call(this, id, parent, isMain);
    };
    delete require.cache[require.resolve(servicePath)];
    ({ createLauncherService } = require(servicePath));
  } finally {
    Module._load = realLoad;
    if (cachedService) require.cache[require.resolve(servicePath)] = cachedService;
    else delete require.cache[require.resolve(servicePath)];
  }
  const protection = createTaskProtection({ hostRunning: () => false, getBaseUrl: () => '',
    fetchImpl: async () => { throw new Error('unexpected network request'); }, confirm: async () => true });
  const service = createLauncherService({ dsh: f.dsh, harness: f.controller, taskProtection: protection,
    startHarness: () => { throw new Error('unexpected manual restart'); },
    startDesktop: () => { throw new Error('unexpected manual start'); },
    stopDesktopCleanup: async () => f.record('cleanup'), configPayload: x => x });
  return { service, entered: entered.promise, release: () => gate.resolve(), pending: () => importPending };
}


async function readyThenFailure(f, message) {
  await bounded(f.controller.start(), 'initial real controller.start');
  assert.equal(f.dsh.state, 'ready'); assert.equal(f.dsh.starts.length, 1);
  f.holdBoot(); f.dsh.crash(message);
  await bounded(f.bootEntered, 'injected showBoot dependency');
}
test('A2: stopDesktop must invalidate delayed plugin recovery', async () => {
  const f = fixture();
  try {
    await readyThenFailure(f, 'plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask; assert.ok(pending);
    const stop = await bounded(f.controller.stopDesktop(), 'stopDesktop');
    f.record('stopDesktop.resolved', { state: stop.state, starts: f.dsh.starts.length, pluginRecoveryPending: !!f.controller.pluginRecoveryTask });
    assert.equal(stop.state, 'idle'); assert.equal(f.dsh.starts.length, 1);
    f.releaseBoot(); await bounded(pending, 'stale plugin recovery');
    assert.equal(f.dsh.starts.length, 1, 'no dsh.start after stopDesktop already resolved');
  } finally { f.releaseBoot(); await f.controller.shutdown(); }
});
test('A2-import: real launcher service must remain quiescent while fixture import is pending', async () => {
  const f = fixture(); let lf; let importing;
  try {
    await readyThenFailure(f, 'plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    lf = launcherFixture(f);
    importing = lf.service.runImport({ opId: 'a2-isolated', selectedRels: ['fixture-session'] });
    await bounded(lf.entered, 'real runImportTask stop-before-import');
    assert.equal(f.dsh.state, 'idle'); assert.equal(f.dsh.starts.length, 1);
    assert.equal(importGuard.maintenanceOwner()?.kind, 'import');
    const manualStart = await lf.service.startDesktop();
    assert.equal(manualStart.ok, false);
    f.record('manualStart.refused', manualStart);
    f.releaseBoot(); await bounded(pending, 'plugin recovery during import');
    assert.equal(lf.pending(), true);
    assert.equal(f.dsh.starts.length, 1, 'no autonomous dsh.start while import owns maintenance');
  } finally { lf?.release(); if (importing) await importing; f.releaseBoot(); await f.controller.shutdown(); }
});
test('negative control: delayed generic recovery is invalidated by stopDesktop', async () => {
  const f = fixture();
  try {
    await readyThenFailure(f, 'host exited with code 1');
    const pending = f.controller.recoveryTask; assert.ok(pending);
    await bounded(f.controller.stopDesktop(), 'generic stop'); f.releaseBoot(); await bounded(pending, 'generic recovery');
    assert.equal(f.dsh.starts.length, 1); assert.equal(f.dsh.state, 'idle'); assert.equal(f.clock.timers.size, 0);
  } finally { f.releaseBoot(); await f.controller.shutdown(); }
});
test('negative control: shutdown prevents delayed plugin recovery', async () => {
  const f = fixture();
  await readyThenFailure(f, 'plugin tree failed to load');
  const pending = f.controller.pluginRecoveryTask;
  const outcome = pending.catch(err => err.code);
  await bounded(f.controller.shutdown(), 'shutdown'); f.releaseBoot();
  const code = await bounded(outcome, 'shutdown cancellation');
  assert.equal(code, 'HARNESS_OPERATION_CANCELLED'); assert.equal(f.dsh.starts.length, 1);
});

test('plugin recovery refuses an already-held import slot before config or navigation writes', async () => {
  const f = fixture();
  await f.controller.start();
  const token = importGuard.acquireMaintenance('import');
  try {
    const before = f.events.length;
    f.dsh.crash('plugin tree failed to load');
    await bounded(f.controller.pluginRecoveryTask, 'refused recovery');
    assert.equal(f.dsh.starts.length, 1);
    assert.equal(f.config().pluginRecovery.skipUserPlugins, false);
    assert.equal(f.events.slice(before).some(e => ['saveConfig', 'showBoot.enter', 'dsh.stop'].includes(e.type)), false);
    assert.equal(importGuard.maintenanceOwner(), token);
  } finally { importGuard.releaseMaintenance(token); await f.controller.shutdown(); }
});

for (const verdict of ['blocked', 'unreadable', 'read-error']) {
  test(`launcher journal admission rejects plugin recovery: ${verdict}`, async () => {
    const f = fixture();
    let refuse = false;
    launcherFixture(f, { readImportJournal: () => {
      if (!refuse) return null;
      if (verdict === 'read-error') throw new Error('EACCES');
      return verdict === 'blocked' ? { phase: 'blocked' } : { unreadable: true };
    } });
    try {
      await readyThenFailure(f, 'plugin tree failed to load');
      const pending = f.controller.pluginRecoveryTask;
      refuse = true;
      f.releaseBoot();
      await bounded(pending, 'journal refusal');
      assert.equal(f.dsh.starts.length, 1);
      assert.equal(f.config().pluginRecovery.skipUserPlugins, false);
      assert.equal(importGuard.isMaintenanceHeld(), false);
    } finally { f.releaseBoot(); await f.controller.shutdown(); }
  });
}

test('plugin recovery holds the real guard through start; real launcher import refuses, then succeeds', async () => {
  const f = fixture();
  const lf = launcherFixture(f);
  const gate = deferred();
  const entered = deferred();
  let importing;
  try {
    await f.controller.start();
    f.controller.ensureUsagePanelPlugin = async () => { entered.resolve(); await gate.promise; };
    f.dsh.crash('plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    await bounded(entered.promise, 'recovery overlay preparation');
    assert.equal(importGuard.maintenanceOwner()?.kind, 'plugin-recovery');
    const refused = await lf.service.runImport({ selectedRels: ['fixture-session'] });
    assert.deepEqual(refused, { ok: false, error: 'import-in-progress' });
    assert.equal(lf.pending(), false);
    assert.equal(f.events.some(e => e.type === 'dataImport.enter'), false);
    gate.resolve();
    await bounded(pending, 'successful plugin recovery');
    assert.equal(f.dsh.starts.length, 2);
    assert.equal(f.dsh.starts[1].skipUserPlugins, true);
    assert.equal(f.dsh.state, 'ready');
    assert.equal(importGuard.isMaintenanceHeld(), false);
    importing = lf.service.runImport({ selectedRels: ['fixture-session'] });
    await bounded(lf.entered, 'later admitted import');
    assert.equal(f.dsh.state, 'idle');
    assert.equal(importGuard.maintenanceOwner()?.kind, 'import');
    lf.release();
    assert.equal((await importing).ok, true);
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally {
    gate.resolve(); lf.release();
    if (importing) await importing;
    await f.controller.shutdown();
  }
});

// Suspend each awaited external dependency in the real recovery/start chain.
// Cancellation must stop both successful AND failed late completions; log-only
// cleanup errors must not swallow cancellation and fall through to another write.
const recoverySteps = [
  'resolveLaunchTarget', 'ensureTaskControlPlugin', 'ensureDesktopPlatformSession',
  'ensureDesktopOfficeRuntime', 'removeDshMarketPreset', 'ensureUsagePanelPlugin',
  'ensureDshImPlugin', 'ensureDesktopMarket', 'removeLegacyDshbotPreset',
  'ensureDshbotPlugin', 'ensureDshProjectPlugin', 'ensureDshWhalePlugin', 'ensureDshRemotePlugin',
  'ensureWorkspace', 'showHarness',
];
for (const step of recoverySteps) {
  for (const rejects of [false, true]) {
    test(`cancel plugin recovery at ${step}, late ${rejects ? 'failure' : 'success'} has no follow-up effects`, async () => {
      const f = fixture();
      const gate = deferred();
      const entered = deferred();
      const effects = [];
      try {
        await f.controller.start();
        for (const name of [...recoverySteps, 'stripDroppedPlugins', 'ensureDesktopInstallPlugin', 'applyDisabledBundles']) {
          const original = f.controller[name].bind(f.controller);
          f.controller[name] = name === step ? async (...args) => {
            effects.push(name); entered.resolve(); await gate.promise;
            if (rejects) throw new Error('late injected failure');
            return original(...args);
          } : (...args) => { effects.push(name); return original(...args); };
        }
        const originalSync = f.controller.remote.sync;
        f.controller.remote.sync = async () => { effects.push('remote.sync'); return originalSync(); };
        f.dsh.crash('plugin tree failed to load');
        const pending = f.controller.pluginRecoveryTask;
        await bounded(entered.promise, step);
        f.controller.cancelRecovery();
        const before = effects.slice();
        const writes = f.events.filter(e => e.type === 'saveConfig').length;
        const starts = f.dsh.starts.length;
        gate.resolve();
        await bounded(pending, 'cancelled recovery');
        assert.deepEqual(effects, before);
        assert.equal(f.dsh.starts.length, starts);
        assert.equal(f.events.filter(e => e.type === 'saveConfig').length, writes);
        assert.equal(f.controller.snapshot().recovery.status, 'cancelled');
        assert.equal(importGuard.isMaintenanceHeld(), false);
      } finally { gate.resolve(); await f.controller.shutdown(); }
    });
  }
}

test('stop during replacement stop cannot revive the old plugin recovery', async () => {
  const f = fixture();
  const entered = deferred();
  const gate = deferred();
  const originalStop = f.dsh.stop.bind(f.dsh);
  try {
    await f.controller.start();
    let first = true;
    f.dsh.stop = async () => {
      if (first) { first = false; entered.resolve(); await gate.promise; }
      await originalStop();
    };
    f.dsh.crash('plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    await bounded(entered.promise, 'replacement stop');
    await bounded(f.controller.stopDesktop(), 'user stop');
    assert.equal(f.dsh.state, 'idle');
    gate.resolve();
    await bounded(pending, 'stale replacement');
    assert.equal(f.dsh.starts.length, 1);
    assert.equal(f.dsh.state, 'idle');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally { gate.resolve(); await f.controller.shutdown(); }
});

test('startup fallback checks cancellation after stopping and before persisting sticky skip', async () => {
  const f = fixture();
  const entered = deferred();
  const gate = deferred();
  const originalStop = f.dsh.stop.bind(f.dsh);
  try {
    f.dsh.startFailures.push('plugin tree failed to load');
    f.dsh.stop = async () => { entered.resolve(); await gate.promise; return originalStop(); };
    const starting = f.controller.start();
    const rejected = assert.rejects(starting, { code: 'HARNESS_OPERATION_CANCELLED' });
    await bounded(entered.promise, 'startup fallback stop');
    const stopped = f.controller.stopDesktop();
    gate.resolve();
    await bounded(Promise.all([stopped, rejected]), 'cancel startup fallback');
    assert.equal(f.dsh.starts.length, 1);
    assert.equal(f.config().pluginRecovery.skipUserPlugins, false);
    assert.equal(f.dsh.state, 'idle');
  } finally { gate.resolve(); await f.controller.shutdown(); }
});

test('immediate stop cancels plugin recovery before queued boot navigation is dispatched', async () => {
  const f = fixture();
  try {
    await f.controller.start();
    const before = f.events.length;
    f.dsh.crash('plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    await f.controller.stopDesktop();
    await bounded(pending, 'undispatched recovery');
    assert.equal(f.events.slice(before).some(e => ['showBoot.enter', 'saveConfig'].includes(e.type)), false);
    assert.equal(f.dsh.state, 'idle');
    assert.equal(f.dsh.starts.length, 1);
  } finally { await f.controller.shutdown(); }
});

test('cancelled delayed recovery does not suppress a fresh plugin failure or clear its task', async () => {
  const f = fixture();
  const entered = deferred();
  const gate = deferred();
  try {
    await readyThenFailure(f, 'plugin tree failed to load');
    const stale = f.controller.pluginRecoveryTask;
    await f.controller.stopDesktop();
    f.controller.ensureUsagePanelPlugin = async () => { entered.resolve(); await gate.promise; };
    f.dsh.crash('plugin tree failed to load again');
    const fresh = f.controller.pluginRecoveryTask;
    assert.ok(fresh);
    assert.notEqual(fresh, stale);
    f.releaseBoot();
    await bounded(Promise.all([stale, entered.promise]), 'stale cleanup while fresh recovery is pending');
    assert.equal(f.controller.pluginRecoveryTask, fresh, 'old finally must not clear the new task');
    assert.equal(importGuard.maintenanceOwner()?.kind, 'plugin-recovery', 'old finally must not release the new owner');
    gate.resolve();
    await bounded(fresh, 'fresh recovery');
    assert.equal(f.dsh.starts.length, 2);
    assert.equal(f.dsh.state, 'ready');
    assert.equal(f.controller.pluginRecoveryTask, null);
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally { gate.resolve(); f.releaseBoot(); await f.controller.shutdown(); }
});

test('failed plugin recovery releases its maintenance token without scheduling another start', async () => {
  const f = fixture();
  try {
    await f.controller.start();
    f.controller.ensureUsagePanelPlugin = async () => { throw new Error('broken built-in'); };
    f.dsh.crash('plugin tree failed to load');
    await assert.rejects(f.controller.pluginRecoveryTask, /broken built-in/);
    assert.equal(f.dsh.starts.length, 1);
    assert.equal(f.dsh.state, 'error');
    assert.equal(importGuard.isMaintenanceHeld(), false);
    assert.equal(f.clock.timers.size, 0);
  } finally { await f.controller.shutdown(); }
});

test('stop during plugin preparation drains the start and blocks late fallback writes', async () => {
  const f = fixture();
  const entered = deferred();
  const gate = deferred();
  try {
    await f.controller.start();
    f.controller.removeDshMarketPreset = async () => {
      entered.resolve(); await gate.promise; throw new Error('plugin tree failed to load');
    };
    f.dsh.crash('plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    await bounded(entered.promise, 'plugin cleanup');
    const writes = f.events.filter(e => e.type === 'saveConfig').length;
    const stopped = f.controller.stopDesktop();
    gate.resolve();
    await bounded(Promise.all([stopped, pending]), 'stop drains preparation');
    assert.equal(f.dsh.state, 'idle');
    assert.equal(f.dsh.starts.length, 1);
    assert.equal(f.events.filter(e => e.type === 'saveConfig').length, writes);
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally { gate.resolve(); await f.controller.shutdown(); }
});

for (const interrupt of ['none', 'stop', 'cancel', 'blocked-journal']) {
  test(`maintenance ownership survives deferred dsh.start (${interrupt}) until recovery settles`, async () => {
    const f = fixture();
    let blocked = false;
    const lf = launcherFixture(f, { readImportJournal: () => blocked ? { phase: 'blocked' } : null });
    const entered = deferred();
    const gate = deferred();
    let stopping;
    try {
      await f.controller.start();
      const originalStart = f.dsh.start.bind(f.dsh);
      f.dsh.start = async options => {
        // The start side effect has begun; completion remains pending just as
        // a real child may wait for its readiness handshake.
        const url = await originalStart(options);
        entered.resolve();
        await gate.promise;
        return url;
      };
      f.dsh.crash('plugin tree failed to load');
      const pending = f.controller.pluginRecoveryTask;
      await bounded(entered.promise, 'deferred dsh.start');
      const token = importGuard.maintenanceOwner();
      assert.equal(token?.kind, 'plugin-recovery');
      const shows = f.events.filter(e => e.type === 'showHarness').length;
      if (interrupt === 'stop') stopping = f.controller.stopDesktop();
      if (interrupt === 'cancel') f.controller.cancelRecovery();
      if (interrupt === 'blocked-journal') blocked = true;
      const refused = await lf.service.runImport({ selectedRels: ['fixture-session'] });
      assert.deepEqual(refused, { ok: false, error: 'import-in-progress' });
      assert.equal(importGuard.maintenanceOwner(), token);
      assert.equal(lf.pending(), false);
      gate.resolve();
      await bounded(Promise.all([pending, stopping]), 'settled dsh.start');
      assert.equal(importGuard.isMaintenanceHeld(), false);
      assert.equal(f.dsh.starts.length, 2, 'no replacement after cancellation');
      assert.equal(f.events.filter(e => e.type === 'showHarness').length, shows + (interrupt === 'none' ? 1 : 0));
      if (interrupt === 'stop') assert.equal(f.dsh.state, 'idle');
    } finally { gate.resolve(); lf.release(); if (stopping) await stopping; await f.controller.shutdown(); }
  });
}

test('maintenance ownership includes asynchronous remote setup after the child becomes ready', async () => {
  const f = fixture({ openDevTools: true });
  const lf = launcherFixture(f);
  const entered = deferred();
  const gate = deferred();
  try {
    await f.controller.start();
    f.controller.remote.sync = async () => { entered.resolve(); await gate.promise; };
    f.dsh.crash('plugin tree failed to load');
    const pending = f.controller.pluginRecoveryTask;
    await bounded(entered.promise, 'remote setup');
    assert.equal(f.dsh.state, 'ready');
    assert.equal(importGuard.maintenanceOwner()?.kind, 'plugin-recovery');
    assert.equal((await lf.service.runImport({ selectedRels: ['fixture-session'] })).ok, false);
    const stopping = f.controller.stopDesktop();
    gate.resolve();
    await bounded(Promise.all([pending, stopping]), 'stop during remote setup');
    assert.equal(f.dsh.state, 'idle');
    assert.equal(f.events.filter(e => e.type === 'openDevTools').length, 1, 'cancelled recovery must not open devtools after remote setup');
    assert.equal(importGuard.isMaintenanceHeld(), false);
  } finally { gate.resolve(); lf.release(); await f.controller.shutdown(); }
});
