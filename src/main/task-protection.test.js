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
  assert.equal(inspectionClean({ ...CLEAN_INSPECTION, coverage: { bots: 'intentional-disabled' } }), true);
  assert.equal(inspectionClean(DIRTY_INSPECTION), false);
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

test('production quit skips confirmation while retaining inspect, lock, cleanup and shutdown', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require('node:path').join(__dirname, 'index.js'), 'utf8');
  const start = source.indexOf('  async function finalizeQuit()');
  const end = source.indexOf("  app.on('window-all-closed'", start);
  assert.ok(start >= 0 && end > start);
  for (const failDrain of [false, true]) {
    const events = [];
    const { protection, calls } = makeProtection({
      inspection: DIRTY_INSPECTION,
      confirm: async () => { assert.fail('explicit quit must not ask again'); },
    }, failDrain ? { acquire: async () => ({ ok: false, code: 'dshd/drain-timeout' }) } : {});
    const quit = vm.runInNewContext(`${source.slice(start, end)}; finalizeQuit`, {
      taskProtection: protection, quitting: true, stoppingForQuit: false, closingOverlayActive: false,
      quitInProgress: false, dsh: { log: () => {} },
      stopDesktopInstallControl: () => events.push('control-stop'),
      taskControlPeer: { stop: async () => events.push('peer-stop') },
      cleanupDesktopResources: async () => events.push('cleanup'),
      getLive2dPet: () => ({ dispose: async () => events.push('pet-dispose') }),
      hideHarnessView: () => {}, getMainWindow: () => ({}), loadConfig: () => ({}),
      getHarnessWebContents: () => null, setTimeout, clearTimeout,
      showClosingOverlay: async () => {}, harness: { shutdown: async () => events.push('shutdown'), cancelShutdown: () => {} },
      app: { quit: () => events.push('quit'), exit: () => assert.fail('must not force exit') },
      firstVisibleWindow: () => null,
      confirmDialog: async () => { events.push('failure-notice'); return { response: 2 }; },
    });
    await quit();
    if (failDrain) {
      assert.deepEqual(events, ['failure-notice']);
      assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire']);
    } else {
      assert.deepEqual(events, ['shutdown', 'cleanup', 'pet-dispose', 'control-stop', 'peer-stop', 'quit']);
      assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect']);
    }
  }
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
  let beforeQuit;
  const context = {
    quitting: true, stoppingForQuit: false, closingOverlayActive: false, quitInProgress: false,
    dsh: { log: () => {} },
    stopDesktopInstallControl: () => {}, taskControlPeer: { stop: async () => {} },
    cleanupDesktopResources: async () => {}, hideHarnessView: () => {},
    getLive2dPet: () => null,
    getMainWindow: () => ({}), loadConfig: () => ({}), showClosingOverlay: async () => {},
    getHarnessWebContents: () => null,
    harness: { shutdown: async () => {} }, firstVisibleWindow: () => null,
    app: { quit: () => assert.fail('unexpected quit'), exit: () => assert.fail('unexpected force exit') },
    qaEnv: () => false, process,
    setTimeout, clearTimeout,
    ...overrides,
  };
  context.harness = { cancelShutdown: () => {}, ...context.harness };
  context.app.on = (name, handler) => { assert.equal(name, 'before-quit'); beforeQuit = handler; };
  const functions = vm.runInNewContext(`${source.slice(start, end)}\n${source.slice(requestStart, requestEnd)}; ({ quit: finalizeQuit, request: quitApp })`, context);
  return { ...functions, beforeQuit, context };
}

test('Retry repeats the protected quit and shuts down after the runtime recovers', async () => {
  let attempts = 0;
  let notices = 0;
  let shutdowns = 0;
  let exits = 0;
  const { protection, calls } = makeProtection({}, {
    acquire: async () => ++attempts === 1
      ? { ok: false, code: 'dshd/drain-timeout' }
      : { ok: true, lockId: 'retry-lock' },
  });
  const { quit } = productionQuit({
    taskProtection: protection,
    confirmDialog: async () => { notices++; return { response: 0 }; },
    harness: { shutdown: async () => { shutdowns++; } },
    app: { quit: () => { exits++; }, exit: () => assert.fail('Retry must use normal quit') },
  });
  await quit();
  assert.equal(notices, 1);
  assert.equal(shutdowns, 1);
  assert.equal(exits, 1);
  assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect', 'acquire', 'inspect']);
});

test('repeated tray quits share the failure prompt and cancelling permits a later quit', async () => {
  let notices = 0;
  let answer;
  const { quit, request, beforeQuit, context } = productionQuit({
    taskProtection: { coordinate: async () => ({ proceeded: false, code: 'dshd/unreachable' }) },
    confirmDialog: () => { notices++; return new Promise(resolve => { answer = resolve; }); },
  });
  const first = quit();
  await new Promise(setImmediate);
  request();
  let prevented = false;
  beforeQuit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(context.quitting, false);
  await quit();
  assert.equal(notices, 1);
  answer({ response: 2 });
  await first;
  assert.equal(context.quitting, false);
  const later = quit();
  await new Promise(setImmediate);
  assert.equal(notices, 2);
  answer({ response: 2 });
  await later;
});

test('force exit completes when either preview cleanup or runtime shutdown never settles', async () => {
  for (const blocked of ['cleanup', 'shutdown']) {
    let deadline;
    let timerCleared = false;
    let exits = 0;
    let shutdownStarted = false;
    const hanging = new Promise(() => {});
    const { quit } = productionQuit({
      taskProtection: { coordinate: async () => ({ proceeded: false, code: 'dshd/unreachable' }) },
      confirmDialog: async () => ({ response: 1 }),
      cleanupDesktopResources: () => blocked === 'cleanup' ? hanging : Promise.resolve(),
      harness: { shutdown: () => { shutdownStarted = true; return blocked === 'shutdown' ? hanging : Promise.resolve(); } },
      app: { exit: () => { exits++; }, quit: () => assert.fail('force exit must terminate directly') },
      setTimeout: (callback, ms) => { assert.ok(ms > 0 && ms <= 5000); deadline = callback; return 42; },
      clearTimeout: timer => { assert.equal(timer, 42); timerCleared = true; },
    });
    const pending = quit();
    await new Promise(setImmediate);
    assert.equal(exits, 0);
    assert.equal(shutdownStarted, true, blocked);
    deadline();
    await pending;
    assert.equal(exits, 1, blocked);
    assert.equal(timerCleared, true);
  }
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

test('failed shutdown offers recovery and cancelling removes the overlay without destroying the page', async () => {
  const { protection } = makeProtection();
  let dismissed = 0;
  let hidden = 0;
  let notices = 0;
  let petDisposed = false;
  const { quit, context } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: async () => { throw new Error('process still alive'); } },
    getLive2dPet: () => ({ dispose: async () => { petDisposed = true; } }),
    showClosingOverlay: async () => async () => { dismissed++; },
    hideHarnessView: () => { hidden++; },
    confirmDialog: async () => { notices++; return { response: 2 }; },
  });
  await quit();
  assert.equal(notices, 1);
  assert.equal(dismissed, 1);
  assert.equal(hidden, 0);
  assert.equal(petDisposed, false, 'cancelling a failed shutdown preserves the pet service');
  assert.equal(context.quitting, false);
  assert.equal(context.stoppingForQuit, false);
  assert.equal(context.closingOverlayActive, false);
  assert.equal(context.quitInProgress, false);
});

test('Retry can complete after a shutdown rejection and does not release a failed terminal commit as success', async () => {
  const { protection, calls } = makeProtection();
  let attempts = 0;
  let quits = 0;
  const { quit } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: async () => { if (++attempts === 1) throw new Error('taskkill denied'); } },
    confirmDialog: async () => ({ response: 0 }),
    app: { quit: () => { quits++; }, exit: () => assert.fail('Retry must stop normally') },
  });
  await quit();
  assert.equal(attempts, 2);
  assert.equal(quits, 1);
  assert.deepEqual(calls.map(call => call.op), ['inspect', 'acquire', 'inspect', 'release',
    'inspect', 'acquire', 'inspect']);
});

test('a hung normal shutdown reaches the recovery prompt and retains the page', async () => {
  const { protection } = makeProtection();
  let deadline;
  let hidden = false;
  let notices = 0;
  let finishShutdown;
  let petDisposed = false;
  const { quit, context } = productionQuit({
    taskProtection: protection,
    harness: { shutdown: () => new Promise(resolve => { finishShutdown = resolve; }) },
    getLive2dPet: () => ({ dispose: async () => { petDisposed = true; } }),
    hideHarnessView: () => { hidden = true; },
    confirmDialog: async () => { notices++; return { response: 2 }; },
    setTimeout: (callback, ms) => { assert.equal(ms, 30000); deadline = callback; return 1; },
    clearTimeout: timer => assert.equal(timer, 1),
  });
  const pending = quit();
  await new Promise(setImmediate);
  assert.equal(notices, 0);
  deadline();
  await pending;
  assert.equal(notices, 1);
  assert.equal(hidden, false);
  assert.equal(context.quitInProgress, false);
  finishShutdown();
  await new Promise(setImmediate);
  assert.equal(petDisposed, false, 'a late shutdown cannot dispose the pet after cancellation');
});

test('force exit still waits for the runtime when preview cleanup rejects', async () => {
  let deadline;
  let exited = false;
  const { quit } = productionQuit({
    taskProtection: { coordinate: async () => ({ proceeded: false, code: 'dshd/unreachable' }) },
    cleanupDesktopResources: async () => { throw new Error('preview teardown failed'); },
    harness: { shutdown: () => new Promise(() => {}) },
    confirmDialog: async () => ({ response: 1 }),
    app: { quit: () => assert.fail('must force exit'), exit: () => { exited = true; } },
    setTimeout: (callback, ms) => { assert.equal(ms, 5000); deadline = callback; return 1; },
    clearTimeout: () => {},
  });
  const pending = quit();
  await new Promise(setImmediate);
  assert.equal(exited, false);
  deadline();
  await pending;
  assert.equal(exited, true);
});
