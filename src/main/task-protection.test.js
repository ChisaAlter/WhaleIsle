'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTaskProtection, inspectionClean, CONTROL_PREFIX } = require('./task-protection');

const CLEAN_INSPECTION = {
  ok: true,
  hostGeneration: 'gen-1',
  activeWork: [],
  scheduledWork: [],
  coverage: { agents: 'ok', jobs: 'ok', schedule: 'ok' },
};

const DIRTY_INSPECTION = {
  ...CLEAN_INSPECTION,
  activeWork: [{ kind: 'agent', id: 'a1', detail: 'running' }],
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Fake fetch that routes control ops to scripted handlers. */
function fetchScript(handlers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const op = url.slice(url.indexOf(CONTROL_PREFIX) + CONTROL_PREFIX.length + 1);
    const body = JSON.parse(init.body || '{}');
    calls.push({ op, body });
    const handler = handlers[op] || (async () => ({ ok: false, code: 'unhandled' }));
    return jsonResponse(await handler(body));
  };
  return { fetchImpl, calls };
}

function makeProtection(overrides = {}, handlers = {}) {
  const { fetchImpl, calls } = fetchScript({
    inspect: async () => overrides.inspection || CLEAN_INSPECTION,
    acquire: async () => ({ ok: true, lockId: 'lock-1', owner: 'desktop-quit', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
    ...handlers,
  });
  const protection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:9',
    hostRunning: () => overrides.hostDown !== true,
    confirm: overrides.confirm,
    fetchImpl,
    ...overrides.options,
  });
  return { protection, calls };
}

test('a token-carrying ready URL still posts to the control prefix', async () => {
  // The `dsh web:` line advertises <origin>/?token=…; appending the control
  // route after that query used to post `/` and fail with http-405.
  const urls = [];
  const { fetchImpl, calls } = fetchScript({
    inspect: async () => CLEAN_INSPECTION,
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-stop', generation: 1 }),
    release: async () => ({ ok: true, released: true }),
  });
  const recordingFetch = async (url, init) => {
    urls.push(String(url));
    return fetchImpl(url, init);
  };
  const protection = createTaskProtection({
    getBaseUrl: () => 'http://127.0.0.1:3080/?token=launch-secret',
    hostRunning: () => true,
    fetchImpl: recordingFetch,
  });
  const result = await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(result.proceeded, true);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
  for (const url of urls) {
    assert.match(url, /^http:\/\/127\.0\.0\.1:3080\/dshd-task-control\//);
    assert.ok(!url.includes('token='), `control URL leaked the launch token: ${url}`);
  }
});

test('clean inspection proceeds to commit without prompting or locking early', async () => {
  let committed = false;
  let prompted = false;
  const { protection, calls } = makeProtection({ confirm: async () => { prompted = true; return true; } });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
  assert.equal(prompted, false);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('active work prompts; declined cancels before any side effect', async () => {
  let committed = false;
  const { protection, calls } = makeProtection({
    inspection: DIRTY_INSPECTION,
    confirm: async () => false,
  });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'cancelled');
  assert.equal(committed, false);
  // No lock acquire on cancel — admission was never frozen.
  assert.deepEqual(calls.map((c) => c.op), ['inspect']);
});

test('preConfirmed skips the user-confirm gates but keeps the lock sequencing', async () => {
  let prompted = false;
  let committed = false;
  const { protection, calls } = makeProtection({
    inspection: DIRTY_INSPECTION,
    confirm: async () => { prompted = true; return false; },
  });
  const result = await protection.coordinate('stop', {
    preConfirmed: true,
    commit: async () => { committed = true; },
  });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
  assert.equal(prompted, false, 'a launcher-confirmed stop must never prompt');
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('preConfirmed also skips the second-inspection re-confirm', async () => {
  let n = 0;
  let committed = false;
  const { protection } = makeProtection({
    confirm: async () => false,
  }, {
    inspect: async () => (n++ === 0 ? CLEAN_INSPECTION : DIRTY_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-stop', generation: 3 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('stop', {
    preConfirmed: true,
    commit: async () => { committed = true; },
  });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
});

test('dirty first inspect prompts once; clean second inspect proceeds', async () => {
  let inspections = 0;
  const confirmations = [];
  const { protection } = makeProtection({
    confirm: async (_op, inspection) => {
      confirmations.push(inspection.activeWork.length);
      return true;
    },
  }, {
    inspect: async () => (inspections++ === 0 ? DIRTY_INSPECTION : CLEAN_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-restart', generation: 2 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('restart', {});
  assert.equal(result.proceeded, true);
  assert.deepEqual(confirmations, [1]);
});

test('fresh work after acquire re-confirms against the second picture', async () => {
  const seen = [];
  let committed = false;
  let n = 0;
  const { protection, calls } = makeProtection({
    confirm: async (_op, inspection) => {
      seen.push(inspection.activeWork.length);
      return false;
    },
  }, {
    inspect: async () => (n++ === 0 ? CLEAN_INSPECTION : DIRTY_INSPECTION),
    acquire: async () => ({ ok: true, lockId: 'l', owner: 'desktop-quit', generation: 3 }),
    release: async () => ({ ok: true, released: true }),
  });
  const result = await protection.coordinate('quit', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'cancelled');
  assert.equal(committed, false);
  assert.deepEqual(seen, [1]);
  // The lock is released so Host admissions are not frozen on cancel.
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('drain timeout blocks unattended commit (fail closed)', async () => {
  let committed = false;
  const { protection } = makeProtection({}, {
    acquire: async () => ({ ok: false, code: 'dshd/drain-timeout', pendingCount: 2 }),
  });
  const result = await protection.coordinate('update', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, false);
  assert.equal(result.code, 'dshd/drain-timeout');
  assert.equal(committed, false);
});

test('forced operations commit through a drain timeout or an unreachable Host', async () => {
  for (const code of ['dshd/drain-timeout', 'dshd/unreachable']) {
    let committed = 0;
    const logs = [];
    const { protection, calls } = makeProtection({ options: { log: line => logs.push(line) } }, {
      acquire: async () => ({ ok: false, code, pendingCount: 66, pendingLabels: ['resolveAgent'] }),
    });
    const result = await protection.coordinate('update', {
      terminal: true, preConfirmed: true, force: true, drainTimeoutMs: 10_000,
      commit: async () => { committed++; },
    });
    assert.equal(result.proceeded, true, code);
    assert.equal(result.forced.code, code);
    assert.equal(committed, 1);
    assert.equal(protection.isCommitted(), true);
    // No second look and no release: there is no lock to give back.
    assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire']);
    assert.equal(calls[1].body.drainTimeoutMs, 10_000);
    assert.ok(logs.some(line => line.includes(code) && line.includes('resolveAgent')));
  }
});

test('a throwing commit releases the Host lock', async () => {
  const { protection, calls } = makeProtection();
  await assert.rejects(protection.coordinate('stop', {
    commit: async () => { throw new Error('commit-boom'); },
  }), /commit-boom/);
  assert.deepEqual(calls.map((c) => c.op), ['inspect', 'acquire', 'inspect', 'release']);
});

test('concurrent operations get busy; a host-down run skips the lock', async () => {
  const { protection } = makeProtection({ hostDown: true });
  let committed = false;
  const result = await protection.coordinate('restart', { commit: async () => { committed = true; } });
  assert.equal(result.proceeded, true);
  assert.equal(committed, true);
});

test('terminal commits latch; follow-up coordinates run commit without re-inspecting', async () => {
  let commits = 0;
  const { protection, calls } = makeProtection();
  const first = await protection.coordinate('quit', { terminal: true, commit: async () => { commits++; } });
  assert.equal(first.proceeded, true);
  const before = calls.length;
  const second = await protection.coordinate('quit', { commit: async () => { commits++; } });
  assert.equal(second.proceeded, true);
  assert.equal(commits, 2);
  assert.equal(calls.length, before);
});

test('non-terminal commits release the lock after success', async () => {
  const { protection, calls } = makeProtection();
  const result = await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(result.proceeded, true);
  assert.equal(calls.at(-1).op, 'release');
});

test('commit cleanups run on terminal ops only, never on stop/restart', async () => {
  let cleanups = 0;
  const { protection } = makeProtection();
  protection.onCommitCleanup(() => { cleanups++; });
  await protection.coordinate('stop', { commit: async () => {} });
  assert.equal(cleanups, 0);
  await protection.coordinate('quit', { terminal: true, commit: async () => {} });
  assert.equal(cleanups, 1);
});

test('inspectionClean treats unknown coverage as blocking', () => {
  assert.equal(inspectionClean(CLEAN_INSPECTION), true);
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, coverage: { jobs: 'unavailable' } }), false);
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, coverage: { schedule: 'intentional-disabled' } }), true);
  assert.equal(inspectionClean(DIRTY_INSPECTION), false);
  // In-flight requests are drained after the lock, never confirmed.
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, activeWork: [{ kind: 'request', id: 'pending-requests', count: 2 }] }), true);
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, activeWork: [{ kind: 'request', id: 'pending-requests', count: 2 }, DIRTY_INSPECTION.activeWork[0]] }), false);
});

test('failed terminal commit preserves services and cleanup hooks until a successful commit', async () => {
  const events = [];
  const { protection, calls } = makeProtection();
  protection.onCommitCleanup(() => { events.push('cleanup'); });
  await assert.rejects(protection.coordinate('update', { terminal: true, preConfirmed: true,
    commit: async () => { events.push('failed-launch'); throw new Error('spawn denied'); } }), /spawn denied/);
  assert.deepEqual(events, ['failed-launch']);
  assert.equal(protection.isCommitted(), false);
  assert.equal(calls.at(-1).op, 'release');
  await protection.coordinate('quit', { terminal: true, preConfirmed: true,
    commit: async () => { events.push('shutdown'); } });
  assert.deepEqual(events, ['failed-launch', 'shutdown', 'cleanup']);
  assert.equal(protection.isCommitted(), true);
});

function productionQuit(overrides = {}) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf("  app.on('before-quit'");
  const end = source.indexOf("  app.on('window-all-closed'", start);
  assert.ok(start >= 0 && end > start);
  const requestStart = source.indexOf('function quitApp()');
  const requestEnd = source.indexOf('function ignoreFailure(', requestStart);
  const appEvents = new (require('node:events').EventEmitter)();
  const closeStart = source.indexOf('function bindMainClose(');
  const closeEnd = source.indexOf('async function openLauncher(', closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  const context = {
    quitting: true, stoppingForQuit: false, closingOverlayActive: false, quitInProgress: false, nativeQuitReady: false,
    dsh: { log: () => {} },
    stopDesktopInstallControl: () => {}, taskControlPeer: { stop: async () => {} },
    cleanupDesktopResources: async () => {},
    getLive2dPet: () => null,
    getMainWindow: () => ({}), loadConfig: () => ({}), showClosingOverlay: async () => {},
    getHarnessWebContents: () => null,
    harness: { shutdown: async () => {}, cancelShutdown: () => assert.fail('explicit quit must not be cancelled') },
    firstVisibleWindow: () => null,
    confirmDialog: async () => assert.fail('explicit quit must never open a second confirmation'),
    app: { quit: () => assert.fail('unexpected quit'), exit: () => assert.fail('unexpected force exit') },
    qaEnv: () => false, process,
    mainCloseBound: new WeakSet(), launcherCloseBound: new WeakSet(),
    hideOnClose: require('./close-behavior').hideOnClose,
    setTimeout, clearTimeout,
    ...overrides,
  };
  context.app.on = appEvents.on.bind(appEvents);
  context.app.once = appEvents.once.bind(appEvents);
  const functions = vm.runInNewContext(source.slice(start, end) + '\n' + source.slice(requestStart, requestEnd)
    + '\n' + source.slice(closeStart, closeEnd)
    + '; ({ quit: finalizeQuit, request: quitApp, bindMainClose, bindLauncherClose })', context);
  return { ...functions, beforeQuit: event => appEvents.emit('before-quit', event), appEvents, context };
}

test('production quit skips all prompts and retains inspection, lock and all resource cleanup', async () => {
  const events = [];
  const { protection, calls } = makeProtection({
    inspection: DIRTY_INSPECTION,
    confirm: async () => assert.fail('explicit quit must not ask again'),
  });
  protection.onCommitCleanup(() => events.push('services-stop'));
  const { quit, appEvents } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: async () => events.push('shutdown') },
    cleanupDesktopResources: async () => events.push('cleanup'),
    getLive2dPet: () => ({ dispose: async () => events.push('pet-dispose') }),
    stopDesktopInstallControl: () => events.push('control-stop'),
    taskControlPeer: { stop: async () => events.push('peer-stop') },
    app: { quit: () => { events.push('quit'); appEvents.emit('quit', {}, 0); }, exit: () => assert.fail('healthy shutdown uses app.quit') },
  });
  await quit();
  assert.deepEqual(events, ['shutdown', 'cleanup', 'pet-dispose', 'control-stop', 'peer-stop', 'services-stop', 'quit']);
  assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect']);
  assert.equal(protection.isCommitted(), true);
});

function nativeQuitLifecycle({ blocked = '', pendingShutdown = false } = {}) {
  const { EventEmitter } = require('node:events');
  const clock = fakeQuitTimers();
  const windows = ['main', 'launcher'].map(name => Object.assign(new EventEmitter(), { name }));
  const events = [];
  const { protection } = makeProtection();
  let finishShutdown;
  let shutdowns = 0;
  let fixture;
  const app = {
    quit() {
      events.push('app.quit');
      const event = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
      const before = event();
      fixture.appEvents.emit('before-quit', before);
      if (before.defaultPrevented) return;
      if (blocked === 'unresponsive') return;
      for (const win of windows) {
        const close = event();
        win.emit('close', close);
        if (blocked === 'close-veto') close.preventDefault();
        if (close.defaultPrevented) return;
      }
      if (blocked === 'beforeunload-veto') return;
      const willQuit = event();
      fixture.appEvents.emit('will-quit', willQuit);
      if (blocked === 'will-quit-veto') willQuit.preventDefault();
      if (willQuit.defaultPrevented) return;
      events.push('quit');
      fixture.appEvents.emit('quit', {}, 0);
    },
    exit(code) {
      assert.equal(code, 0);
      events.push('app.exit');
      fixture.appEvents.emit('quit', {}, code);
    },
  };
  fixture = productionQuit({
    quitting: false,
    taskProtection: protection,
    getMainWindow: () => windows[0],
    harness: { shutdown: () => {
      shutdowns++;
      return pendingShutdown ? new Promise(resolve => { finishShutdown = resolve; }) : Promise.resolve();
    } },
    app,
    dsh: { log: message => events.push(message) },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  fixture.bindMainClose(windows[0]);
  fixture.bindLauncherClose(windows[1]);
  const { trayMenuTemplate } = require('./tray-menu');
  const clickQuit = trayMenuTemplate({ onQuit: fixture.request }).find(item => item.label === '退出').click;
  return { ...fixture, clock, events, windows, clickQuit, get shutdowns() { return shutdowns; }, finishShutdown: () => finishShutdown() };
}

test('one tray click closes main and launcher after cleanup; repeated clicks do not restart quit', async () => {
  const fixture = nativeQuitLifecycle({ pendingShutdown: true });
  fixture.clickQuit();
  await new Promise(setImmediate);
  fixture.clickQuit();
  const close = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  fixture.windows[0].emit('close', close);
  assert.equal(close.defaultPrevented, true, 'windows remain until cleanup completes');
  assert.equal(fixture.shutdowns, 1);
  fixture.finishShutdown();
  await new Promise(setImmediate);
  assert.deepEqual(fixture.events, ['app.quit', 'app.quit', 'quit']);
  assert.equal(fixture.context.quitInProgress, true, 'one explicit attempt stays latched through native exit');
  assert.equal(fixture.clock.timers.size, 0, 'actual quit clears the final deadline');
});

test('a vetoed or unresponsive final native close exits automatically without another tray click', async () => {
  for (const blocked of ['close-veto', 'beforeunload-veto', 'will-quit-veto', 'unresponsive']) {
    const fixture = nativeQuitLifecycle({ blocked });
    fixture.clickQuit();
    await new Promise(setImmediate);
    assert.equal(fixture.shutdowns, 1, blocked);
    assert.equal(fixture.context.quitInProgress, true, blocked);
    assert.equal(fixture.context.nativeQuitReady, true, blocked);
    assert.equal(fixture.clock.timers.size, 1, blocked);
    const deadline = fixture.clock.timers.get(5000);
    assert.equal(typeof deadline, 'function', blocked);
    fixture.clickQuit();
    fixture.clickQuit();
    assert.equal(fixture.clock.timers.get(5000), deadline, 'repeated clicks must not postpone exit');
    assert.equal(fixture.events.filter(event => event === 'app.quit').length, 2, blocked);
    deadline();
    assert.equal(fixture.events.filter(event => event === 'app.exit').length, 1, blocked);
    assert.equal(fixture.clock.timers.size, 0, blocked);
  }
});

test('failed Host admission automatically cleans supervised services and exits without a prompt', async () => {
  for (const code of ['dshd/drain-timeout', 'dshd/unreachable', 'busy']) {
    const events = [];
    const diagnostics = [];
    const { protection, calls } = makeProtection({}, {
      acquire: async () => ({ ok: false, code, pendingCount: 2, pendingLabels: ['http POST /api', 'resolveAgent'] }),
    });
    protection.onCommitCleanup(() => events.push('services-stop'));
    const { quit, context } = productionQuit({
      taskProtection: protection,
      dsh: { log: message => diagnostics.push(message) },
      harness: { shutdown: async () => events.push('shutdown') },
      cleanupDesktopResources: async () => events.push('cleanup'),
      getLive2dPet: () => ({ dispose: async () => events.push('pet-dispose') }),
      stopDesktopInstallControl: () => events.push('control-stop'),
      taskControlPeer: { stop: async () => events.push('peer-stop') },
      app: { quit: () => assert.fail('failed admission must finish directly'), exit: code => { assert.equal(code, 0); events.push('exit'); } },
    });
    await quit();
    assert.deepEqual(events, ['shutdown', 'cleanup', 'pet-dispose', 'control-stop', 'peer-stop', 'services-stop', 'exit'], code);
    assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire']);
    assert.ok(diagnostics[0].includes('resolveAgent'));
    assert.equal(context.quitting, true);
    assert.equal(context.quitInProgress, false);
  }
});

test('repeated tray quits share one automatic cleanup without duplicate shutdown', async () => {
  let finishShutdown;
  let shutdowns = 0;
  let exits = 0;
  const { protection } = makeProtection({}, { acquire: async () => ({ ok: false, code: 'dshd/unreachable' }) });
  const { quit, request, beforeQuit, context } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: () => { shutdowns++; return new Promise(resolve => { finishShutdown = resolve; }); } },
    app: { quit: () => assert.fail('repeated quit should be ignored'), exit: () => { exits++; } },
  });
  const first = quit();
  await new Promise(setImmediate);
  request();
  let prevented = false;
  beforeQuit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  await quit();
  assert.equal(shutdowns, 1);
  assert.equal(context.quitting, true);
  finishShutdown();
  await first;
  assert.equal(exits, 1);
});

test('a rejected shutdown still cleans other resources and does not retry or reopen confirmation', async () => {
  const { protection, calls } = makeProtection();
  let shutdowns = 0;
  const events = [];
  protection.onCommitCleanup(() => events.push('services-stop'));
  const { quit } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: async () => { shutdowns++; throw new Error('taskkill denied'); } },
    cleanupDesktopResources: async () => events.push('cleanup'),
    getLive2dPet: () => ({ dispose: async () => events.push('pet-dispose') }),
    app: { quit: () => assert.fail('rejected shutdown must complete directly'), exit: () => events.push('exit') },
  });
  await quit();
  assert.equal(shutdowns, 1);
  assert.deepEqual(events, ['cleanup', 'pet-dispose', 'services-stop', 'exit']);
  assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect', 'release']);
});

function fakeQuitTimers() {
  const timers = new Map();
  return {
    timers,
    setTimeout: (callback, ms) => { assert.ok(ms === 30000 || ms === 5000); timers.set(ms, callback); return ms; },
    clearTimeout: timer => timers.delete(timer),
  };
}

test('hung shutdown, preview or service cleanup reaches the deadline while other cleanup starts', async () => {
  for (const blocked of ['shutdown', 'preview', 'service']) {
    const { protection } = makeProtection();
    const clock = fakeQuitTimers();
    const hanging = new Promise(() => {});
    const events = [];
    protection.onCommitCleanup(() => { events.push('first-service'); return blocked === 'service' ? hanging : undefined; });
    protection.onCommitCleanup(() => events.push('second-service'));
    let shutdowns = 0;
    let exits = 0;
    const { quit } = productionQuit({
      taskProtection: protection,
      harness: { shutdown: () => { shutdowns++; return blocked === 'shutdown' ? hanging : Promise.resolve(); } },
      cleanupDesktopResources: () => { events.push('preview'); return blocked === 'preview' ? hanging : Promise.resolve(); },
      getLive2dPet: () => ({ dispose: () => events.push('pet-dispose') }),
      app: { quit: () => assert.fail('hung cleanup must complete directly'), exit: () => { exits++; } },
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    });
    const pending = quit();
    await new Promise(setImmediate);
    assert.ok(events.includes('second-service'), blocked);
    assert.ok(events.includes('pet-dispose'), blocked);
    assert.equal(exits, 0);
    clock.timers.get(30000)();
    await new Promise(setImmediate);
    assert.equal(exits, 0);
    clock.timers.get(5000)();
    await pending;
    assert.equal(shutdowns, 1, blocked);
    assert.equal(exits, 1, blocked);
    assert.equal(clock.timers.size, 0);
  }
});

test('an inspection that never settles cannot indefinitely block explicit quit', async () => {
  const clock = fakeQuitTimers();
  const { protection } = makeProtection({}, { inspect: () => new Promise(() => {}) });
  let cleaned = 0;
  let exits = 0;
  protection.onCommitCleanup(() => { cleaned++; });
  const { quit } = productionQuit({
    taskProtection: protection,
    app: { quit: () => assert.fail('blocked inspection completes directly'), exit: () => { exits++; } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  const pending = quit();
  await new Promise(setImmediate);
  clock.timers.get(30000)();
  await pending;
  assert.equal(cleaned, 1);
  assert.equal(exits, 1);
  assert.equal(clock.timers.size, 0);
});

test('a preview rejection does not skip waiting for an unsettled runtime shutdown', async () => {
  const clock = fakeQuitTimers();
  const { protection } = makeProtection({}, { acquire: async () => ({ ok: false, code: 'dshd/unreachable' }) });
  let exited = false;
  const { quit } = productionQuit({
    taskProtection: protection,
    cleanupDesktopResources: async () => { throw new Error('preview teardown failed'); },
    harness: { shutdown: () => new Promise(() => {}) },
    app: { quit: () => assert.fail('must exit directly'), exit: () => { exited = true; } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  const pending = quit();
  await new Promise(setImmediate);
  assert.equal(exited, false);
  clock.timers.get(5000)();
  await pending;
  assert.equal(exited, true);
  assert.equal(clock.timers.size, 0);
});

test('drain failure preserves the blocked work diagnostics', async () => {
  const { protection } = makeProtection({}, {
    acquire: async () => ({ ok: false, code: 'dshd/drain-timeout',
      pendingCount: 2, pendingLabels: ['http POST /api', 'resolveAgent'] }),
  });
  const result = await protection.coordinate('quit', { preConfirmed: true });
  assert.equal(result.pendingCount, 2);
  assert.deepEqual(result.pendingLabels, ['http POST /api', 'resolveAgent']);
});
