'use strict';

/**
 * DshManager 生命周期单测（node:test）。
 * 全部使用 fake child（EventEmitter）+ 依赖注入，不启动真实进程、不依赖 Electron。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { DshManager, missingDesktopForkPackages, harnessSpawnPlan } = require('./dsh');
const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');
const { readPin } = require('../shared/harness-upstream');
const { isUnpublishedHarnessNpm } = require('./harness-browser-auth');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

const EXPECTED_URL = 'http://127.0.0.1:3080';
const CHILD_PID = 4242;

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 3000, interval = 2 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fn()) {
      return;
    }
    await tick(interval);
  }
  throw new Error(`waitFor 超时：${fn.toString()}`);
}

function makeFakeChild(pid = CHILD_PID) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    return true;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function emitExit(child, code, signal = null) {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('exit', code, signal);
}

/**
 * 构造注入全部依赖的 manager。返回：
 *  - manager: DshManager 实例
 *  - spawned: 每次 spawnHarness 产生的 fake child
 *  - calls:   { writePid, clearPid, killTree, readPid } 调用记录
 *  - setReachable(v): 控制 isReachable 结果
 *  - lastChild(): 最近 spawn 的 child
 */
function makeHarness(overrides = {}) {
  const spawned = [];
  const calls = {
    writePid: [],
    clearPid: 0,
    killTree: [],
    readPid: 0,
    spawn: null,
  };
  let reachable = false;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-test-'));
  const desktopHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-home-'));
  setDesktopDshHome(desktopHome);
  const deps = {
    loadConfig: () => ({ workspace, host: '127.0.0.1', port: 3080 }),
    ensurePackagedHarness: async () => null,
    buildLaunch: (config) => ({
      command: 'node',
      args: ['web', '--host', config.host || '127.0.0.1', '--port', String(config.port || 3080), '--no-open'],
      nodeBin: null,
      kind: 'dsh',
      host: config.host || '127.0.0.1',
      port: Number(config.port) || 3080,
      workspace: config.workspace,
    }),
    spawnHarness: (command, args, options) => {
      calls.spawn = { command, args, options };
      const pid = overrides.childPid !== undefined ? overrides.childPid : CHILD_PID;
      const child = makeFakeChild(pid);
      spawned.push(child);
      if (reachable && overrides.announceReady !== false) {
        queueMicrotask(() => child.stdout.emit('data', Buffer.from(`dsh web: ${EXPECTED_URL}\n`)));
      }
      return child;
    },
    isReachable: async () => reachable,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 2))),
    readPidFile: () => {
      calls.readPid += 1;
      return null;
    },
    writePidFile: (pid) => {
      calls.writePid.push(pid);
    },
    clearPidFile: () => {
      calls.clearPid += 1;
    },
    killTree: (pid) => {
      calls.killTree.push(pid);
    },
    ...overrides.deps,
  };
  const manager = new DshManager(deps);
  const cleanup = () => {
    clearDesktopDshHome();
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(desktopHome, { recursive: true, force: true });
  };
  return {
    manager,
    spawned,
    calls,
    workspace,
    cleanup,
    setReachable: (value, announceReady = overrides.announceReady !== false) => {
      reachable = value;
      if (value && announceReady) {
        const child = spawned[spawned.length - 1];
        if (child) child.stdout.emit('data', Buffer.from(`dsh web: ${EXPECTED_URL}\n`));
      }
    },
    lastChild: () => spawned[spawned.length - 1],
  };
}

/** 给 promise 提前挂处理器，避免取消路径产生 unhandledRejection。 */
function settle(promise) {
  return promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
}

test('current-start evidence keeps history separate before an attempt and after ring rotation', () => {
  const manager = new DshManager();
  for (let index = 0; index < 410; index += 1) manager.log(`history-${index}`);
  assert.deepEqual(manager.currentStartLogs(), [], 'initialization logs are not an attempted boot');
  assert.equal(manager.logs.length, 400);
  manager.beginStartLog();
  manager.log('current failure');
  assert.deepEqual(manager.currentStartLogs(), ['[app] current failure']);
  assert.ok(manager.logs.includes('[app] history-409'), 'history stays available for export');

  const lines = ['[app] current failure'];
  for (let index = 0; index < 410; index += 1) {
    manager.log(`attempt-${index}`);
    lines.push(`[app] attempt-${index}`);
  }
  assert.deepEqual(manager.currentStartLogs(), lines.slice(-400));
  assert.equal(manager.logs.length, 400);
  manager.beginStartLog();
  manager.log('second attempt');
  assert.deepEqual(manager.currentStartLogs(), ['[app] second attempt']);
  assert.ok(manager.logs.includes('[app] attempt-409'));
});

test('正常启动：reachable 后进入 ready、清 failure、写 PID、返回 URL', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const states = [];
  let lastSnapshot = null;
  h.manager.on('state', (snapshot) => {
    states.push(snapshot.state);
    lastSnapshot = snapshot;
  });

  const p = h.manager.start();
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true);
  const url = await p;

  assert.equal(url, EXPECTED_URL);
  assert.equal(h.manager.state, 'ready');
  assert.equal(h.manager.baseUrl, EXPECTED_URL);
  assert.equal(h.manager.failure, null);
  assert.deepEqual(h.calls.writePid, [CHILD_PID]);
  assert.ok(states.includes('starting'));
  assert.ok(states.includes('ready'));
  // snapshot 保留现有字段并增加 failure
  assert.ok(lastSnapshot && typeof lastSnapshot === 'object');
  for (const key of ['state', 'error', 'baseUrl', 'attached', 'logs', 'failure']) {
    assert.ok(key in lastSnapshot, `snapshot 应包含 ${key}`);
  }
});

test('Project peer mount waits for packaged runtime preparation and reaches launch patches', async (t) => {
  const order = [], preparedRoot = 'C:/prepared/runtime';
  let launchConfig;
  const h = makeHarness({ deps: {
    ensurePackagedHarness: async () => { order.push('runtime'); return preparedRoot; },
  } });
  t.after(h.cleanup);
  const build = h.manager._deps.buildLaunch;
  h.manager._deps.buildLaunch = (config) => { order.push('launch'); launchConfig = config; return build(config); };
  h.setReachable(true);
  await h.manager.start({ patchFiles: ['C:/desktop.patch.yml'], prepareProjectPlugin: async ({ harnessRoot }) => {
    assert.equal(harnessRoot, preparedRoot);
    assert.deepEqual(order, ['runtime']);
    order.push('project');
    return { overlayFile: 'C:/project.patch.yml' };
  } });
  assert.deepEqual(order, ['runtime', 'project', 'launch']);
  assert.deepEqual(launchConfig.patchFiles, ['C:/desktop.patch.yml', 'C:/project.patch.yml']);
  await h.manager.stop();
});

test('stop during Project mounting prevents stale packaged launch', async (t) => {
  let releaseMount, enteredMount;
  const gate = new Promise(resolve => { releaseMount = resolve; });
  const entered = new Promise(resolve => { enteredMount = resolve; });
  const h = makeHarness();
  t.after(h.cleanup);
  const outcome = settle(h.manager.start({ prepareProjectPlugin: async () => {
    enteredMount(); await gate; return { overlayFile: 'C:/project.patch.yml' };
  } }));
  await entered;
  await h.manager.stop();
  releaseMount();
  const result = await outcome;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DSH_CANCELLED');
  assert.equal(h.spawned.length, 0);
  assert.equal(h.manager.state, 'idle');
});

test('P2A: a probe that resolves after stop() cannot write a stale session cookie', async (t) => {
  let releaseProbe;
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  let probeStarted;
  const startedProbe = new Promise((resolve) => { probeStarted = resolve; });
  const h = makeHarness();
  t.after(h.cleanup);
  // Drive the REAL `DshManager.isReachable` (not a stub) and only inject the
  // low-level probe, so the post-await guard is genuinely under test.
  h.manager._deps.isReachable = (url, guard) => h.manager.isReachable(url, guard);
  h.manager._deps.probeHarnessReady = async () => {
    probeStarted();
    await probeGate;
    return { ok: true, cookie: 'dsh-auth-stale=secret' };
  };

  const p = h.manager.start();
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true);
  await startedProbe;

  // Stop while the readiness probe is still in flight, then let it resolve.
  const stopping = h.manager.stop();
  releaseProbe();
  const outcome = await settle(p);
  await stopping;

  assert.equal(outcome.ok, false, 'the cancelled start must reject');
  assert.equal(outcome.error?.code, 'DSH_CANCELLED');
  assert.equal(h.manager.state, 'idle', 'stop() must own the final state');
  assert.equal(h.manager.sessionCookie, '', 'a stale probe must not publish a cookie');
});

test('P2A: production cookie publication obeys the probe guard', async (t) => {
  let releaseOld;
  const oldProbe = new Promise((resolve) => { releaseOld = resolve; });
  let oldStarted;
  const oldStartedProbe = new Promise((resolve) => { oldStarted = resolve; });
  let probeCount = 0;
  const h = makeHarness();
  t.after(h.cleanup);
  h.manager._deps.isReachable = (url, guard) => h.manager.isReachable(url, guard);
  h.manager._deps.probeHarnessReady = async () => {
    probeCount += 1;
    if (probeCount === 1) {
      oldStarted();
      await oldProbe;
      return { ok: true, cookie: 'dsh-auth-old=old' };
    }
    return { ok: true, cookie: 'dsh-auth-new=new' };
  };

  const first = h.manager.start();
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true);
  await oldStartedProbe;

  const stopping = h.manager.stop();
  releaseOld();
  const firstOutcome = await settle(first);
  await stopping;
  assert.equal(firstOutcome.ok, false);
  assert.equal(firstOutcome.error?.code, 'DSH_CANCELLED');
  assert.equal(h.manager.sessionCookie, '', 'stale probe must not publish the old cookie');

  const second = await h.manager.start();
  assert.equal(second, EXPECTED_URL);
  assert.equal(h.manager.sessionCookie, 'dsh-auth-new=new', 'a current probe still publishes its cookie');
});

test('P2A: a stale helper completion cannot clobber the current generation URL or cookie', async (t) => {
  const OLD_URL = 'http://127.0.0.1:3091';
  let releaseOldProbe;
  const oldProbeGate = new Promise((resolve) => {
    releaseOldProbe = resolve;
  });
  let oldProbeStarted;
  const oldStartedProbe = new Promise((resolve) => {
    oldProbeStarted = resolve;
  });
  let probeCount = 0;
  const h = makeHarness({ announceReady: false });
  t.after(h.cleanup);
  // First call deliberately ignores its guard (a reachability implementation
  // that resolves `true` for a cancelled generation); only waitUntilReady's own
  // post-await recheck can reject that stale helper completion.
  h.manager._deps.isReachable = (url, guard) => {
    probeCount += 1;
    if (probeCount === 1) {
      oldProbeStarted();
      return oldProbeGate.then(() => true);
    }
    return h.manager.isReachable(url, guard);
  };
  h.manager._deps.probeHarnessReady = async () => ({ ok: true, cookie: 'dsh-auth-new=new' });

  const first = h.manager.start();
  await waitFor(() => h.spawned.length === 1);
  h.lastChild().stdout.emit('data', Buffer.from(`dsh web: ${OLD_URL}\n`));
  await oldStartedProbe;

  const stopping = h.manager.stop();
  await stopping;

  // The new generation becomes fully ready while the stale probe is still
  // parked, so the old continuation resumes after the new URL/cookie exist.
  const second = h.manager.start();
  await waitFor(() => h.spawned.length === 2);
  h.lastChild().stdout.emit('data', Buffer.from(`dsh web: ${EXPECTED_URL}\n`));
  assert.equal(await second, EXPECTED_URL);
  assert.equal(h.manager.state, 'ready');
  assert.equal(h.manager.baseUrl, EXPECTED_URL);
  assert.equal(h.manager.sessionCookie, 'dsh-auth-new=new');

  releaseOldProbe();
  const firstOutcome = await settle(first);
  await tick(10);

  assert.equal(firstOutcome.ok, false, 'the cancelled start must reject');
  assert.equal(firstOutcome.error?.code, 'DSH_CANCELLED');
  assert.equal(h.manager.baseUrl, EXPECTED_URL, 'stale helper must not clobber the current URL');
  assert.equal(h.manager.sessionCookie, 'dsh-auth-new=new', 'stale helper must not clobber the current cookie');
  assert.equal(h.manager.state, 'ready', 'the current generation must stay ready');
  assert.equal(probeCount, 2, 'the current generation still succeeds after the stale one');
});

test('HTTP 探活单独不能标记 ready，必须等 dsh web 行', async (t) => {
  const h = makeHarness({ announceReady: false });
  t.after(h.cleanup);
  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true, false);
  await tick(20);
  assert.equal(h.manager.state, 'starting');
  h.lastChild().stdout.emit('data', Buffer.from(`dsh web: ${EXPECTED_URL}\n`));
  const result = await outcome;
  assert.equal(result.ok, true);
  assert.equal(h.manager.state, 'ready');
});

test('单飞：并发 start 只 spawn 一次；ready 后再 start 直接返回', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);

  const p1 = h.manager.start();
  const p2 = h.manager.start();
  const p3 = h.manager.start();
  h.setReachable(true);
  const [u1, u2, u3] = await Promise.all([p1, p2, p3]);

  assert.equal(h.spawned.length, 1, '并发 start 应复用同一个 in-flight');
  assert.equal(u1, EXPECTED_URL);
  assert.equal(u2, EXPECTED_URL);
  assert.equal(u3, EXPECTED_URL);

  const u4 = await h.manager.start();
  assert.equal(u4, EXPECTED_URL);
  assert.equal(h.spawned.length, 1, 'ready 后再 start 不应重新 spawn');
});

test('运行期退出：结构化 failure phase=runtime，清 child 与 PID', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();

  const clearBefore = h.calls.clearPid;
  emitExit(h.lastChild(), 1, 'SIGTERM');

  assert.equal(h.manager.state, 'error');
  assert.equal(h.manager.child, null);
  assert.ok(h.manager.error.includes('code 1'));
  const failure = h.manager.failure;
  assert.ok(failure, '应记录结构化 failure');
  assert.equal(failure.phase, 'runtime');
  assert.equal(failure.code, 1);
  assert.equal(failure.signal, 'SIGTERM');
  assert.ok(failure.message.includes('code 1'));
  assert.equal(typeof failure.occurredAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(failure.occurredAt)), 'occurredAt 应为合法时间戳');
  assert.ok(h.calls.clearPid > clearBefore, '当前 child 退出应清 PID');
});

test('spawn error 快速失败：保留真实错误对象、phase=startup、不等超时', async (t) => {
  const h = makeHarness({ childPid: null });
  t.after(h.cleanup);
  const spawnError = Object.assign(new Error('ENOENT：spawn node ENOENT'), { code: 'ENOENT' });

  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  const started = Date.now();
  h.lastChild().emit('error', spawnError);

  const result = await outcome;
  assert.equal(result.ok, false);
  assert.equal(result.error, spawnError, '应保留真实错误对象');
  assert.ok(Date.now() - started < 5000, '应快速失败而不是等 180 秒');
  assert.equal(h.manager.state, 'error');
  assert.equal(h.manager.failure.phase, 'startup');
  assert.equal(h.manager.failure.message, spawnError.message);
  assert.equal(h.manager.failure.code, null);
  assert.equal(h.manager.failure.signal, null);
  assert.deepEqual(h.calls.killTree, [], 'spawn 失败（无 pid）不应 killTree');
});

test('error + exit 双事件：首个事件定状态，迟到 exit 被忽略', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  const spawnError = new Error('双事件错误');

  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  const child = h.lastChild();
  child.emit('error', spawnError);
  emitExit(child, 1); // 迟到的 exit

  const result = await outcome;
  assert.equal(result.ok, false);
  assert.equal(result.error, spawnError);
  assert.equal(h.manager.state, 'error');
  assert.equal(h.manager.child, null);
  assert.equal(h.manager.failure.phase, 'startup');
  assert.equal(h.manager.failure.message, '双事件错误');
});

test('启动期 exit 快速失败：phase=startup、保留退出码、清 PID', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);

  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  const started = Date.now();
  emitExit(h.lastChild(), 3);

  const result = await outcome;
  assert.equal(result.ok, false);
  assert.ok(result.error.message.includes('code 3'));
  assert.ok(Date.now() - started < 5000, '启动期 exit 应快速失败而不是等 180 秒');
  assert.equal(h.manager.state, 'error');
  assert.equal(h.manager.failure.phase, 'startup');
  assert.equal(h.manager.failure.code, 3);
  assert.equal(h.manager.failure.signal, null);
  assert.ok(h.calls.clearPid >= 1, '启动期 exit 也应清 PID');
});

test('旧 child 迟到事件无效：generation 与身份校验', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start(); // gen 1, child A
  const childA = h.lastChild();

  await h.manager.stop(); // 结束 gen 1
  await h.manager.start(); // gen 2, child B
  const childB = h.lastChild();
  assert.equal(h.manager.state, 'ready');

  const clearBefore = h.calls.clearPid;
  const killBefore = h.calls.killTree.length;
  emitExit(childA, 9, 'SIGKILL'); // 旧 child 迟到 exit
  childA.emit('error', new Error('旧错误')); // 旧 child 迟到 error

  assert.equal(h.manager.state, 'ready');
  assert.equal(h.manager.child, childB);
  assert.equal(h.manager.failure, null);
  assert.equal(h.manager.error, '');
  assert.equal(h.calls.clearPid, clearBefore, '旧 child 退出不应清 PID');
  assert.equal(h.calls.killTree.length, killBefore, '旧 child 事件不应触发 killTree');
  await tick(10);
  assert.equal(h.manager.state, 'ready', '旧事件不得影响新状态');
});

test('stop 取消 in-flight start：最后 idle，绝不被旧 catch 改 error，可重新启动', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);

  const outcome = settle(h.manager.start()); // 永不 reachable 的 in-flight start
  await waitFor(() => h.spawned.length === 1);

  await h.manager.stop();

  const result = await outcome;
  assert.equal(result.ok, false);
  assert.equal(result.error && result.error.code, 'DSH_CANCELLED');
  assert.equal(h.manager.state, 'idle');
  assert.equal(h.manager.child, null);
  assert.equal(h.manager.failure, null);
  assert.deepEqual(h.calls.killTree, [CHILD_PID]);
  assert.ok(h.calls.clearPid >= 1);

  // 旧 catch 不得在 stop 之后把状态翻回 error
  await tick(10);
  assert.equal(h.manager.state, 'idle');

  // 取消后可重新启动并正常 ready
  h.setReachable(true);
  const url = await h.manager.start();
  assert.equal(url, EXPECTED_URL);
  assert.equal(h.manager.state, 'ready');
  assert.equal(h.spawned.length, 2);
});

test('stop during runtime preparation cancels the stale generation before spawn', async (t) => {
  let releasePreparation;
  let preparationSignal;
  const h = makeHarness({
    deps: {
      ensurePackagedHarness: (_log, { signal }) => new Promise((resolve) => {
        preparationSignal = signal;
        releasePreparation = resolve;
      }),
    },
  });
  t.after(h.cleanup);

  const outcome = settle(h.manager.start());
  await waitFor(() => typeof releasePreparation === 'function');
  await h.manager.stop();
  assert.equal(preparationSignal.aborted, true, 'stop must signal the extractor to stop writing');
  releasePreparation();

  const result = await outcome;
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'DSH_CANCELLED');
  assert.equal(h.spawned.length, 0, '过期 generation 不得继续 spawn');
  assert.equal(h.manager.state, 'idle');
  assert.equal(h.manager.child, null);
});

test('start 与 stop 重叠不死锁：start 等待 stop 完成后新起一代', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);

  const p1 = h.manager.start();
  await waitFor(() => h.spawned.length === 1);

  const stopPromise = h.manager.stop(); // 不 await，立即发起下一次 start
  const p2 = h.manager.start();
  h.setReachable(true);

  await Promise.race([
    Promise.allSettled([p1, p2, stopPromise]),
    tick(5000).then(() => {
      throw new Error('start/stop 重叠死锁');
    }),
  ]);

  assert.equal(h.manager.state, 'ready');
  assert.equal(h.spawned.length, 2);

  const [r1, r2, rStop] = await Promise.allSettled([p1, p2, stopPromise]);
  assert.equal(r1.status, 'rejected', '旧 start 应被取消');
  assert.equal(r1.reason && r1.reason.code, 'DSH_CANCELLED');
  assert.equal(r2.status, 'fulfilled', 'stop 之后的 start 应成功');
  assert.equal(r2.value, EXPECTED_URL);
  assert.equal(rStop.status, 'fulfilled');
});

test('Windows tree cleanup yields during process lookup and termination, preserving image guards', { skip: process.platform !== 'win32' }, async () => {
  const { killTree } = require('./dsh');
  const calls = [];
  let complete;
  const run = (command, args, options, callback) => {
    calls.push({ command, args, options });
    complete = callback;
  };
  let settled = false;
  const pending = killTree(CHILD_PID, run).then(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(calls[0].command, 'tasklist');
  assert.equal(calls[0].options.windowsHide, true);
  complete(null, '"node.exe","4242"');
  await tick();
  assert.equal(calls[1].command, 'taskkill');
  assert.deepEqual(calls[1].args, ['/pid', '4242', '/T', '/F']);
  assert.equal(settled, false);
  complete(null, '');
  await pending;
  for (const name of ['electron.exe', 'Whale Isle.exe', 'unrelated.exe', '']) {
    const commands = [];
    await killTree(CHILD_PID, (command, args, options, callback) => {
      commands.push(command);
      callback(null, name ? `"${name}","4242"` : '');
    });
    assert.deepEqual(commands, ['tasklist']);
  }
  await killTree(process.pid, () => assert.fail('must not query or kill itself'));
});

test('stop awaits asynchronous process cleanup before clearing pid and allowing another start', async (t) => {
  let releaseKill;
  const pendingKill = new Promise((resolve) => { releaseKill = resolve; });
  const h = makeHarness({ deps: { killTree: () => pendingKill } });
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();
  const clears = h.calls.clearPid;
  const stop = h.manager.stop();
  await tick(10);
  const stateDuringKill = h.manager.state;
  const clearsDuringKill = h.calls.clearPid;
  const next = h.manager.start();
  await tick(10);
  const spawnsDuringKill = h.spawned.length;
  releaseKill();
  await Promise.all([stop, next]);
  assert.equal(stateDuringKill, 'stopping');
  assert.equal(clearsDuringKill, clears);
  assert.equal(spawnsDuringKill, 1);
  assert.equal(h.spawned.length, 2);
});

test('正常 stop：stopping→idle、killTree/clearPid 被调用、幂等', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();

  const states = [];
  h.manager.on('state', (snapshot) => states.push(snapshot.state));

  await h.manager.stop();
  assert.equal(h.manager.state, 'idle');
  assert.equal(h.manager.child, null);
  assert.deepEqual(h.calls.killTree, [CHILD_PID]);
  assert.ok(h.calls.clearPid >= 1);
  assert.ok(states.includes('stopping'));
  assert.ok(states.includes('idle'));

  // 再次 stop 幂等，不抛错
  await h.manager.stop();
  assert.equal(h.manager.state, 'idle');
});

test('运行时失败后重新 start：新一次 ready 清除旧 failure', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();
  emitExit(h.lastChild(), 1);
  assert.equal(h.manager.failure.phase, 'runtime');

  await h.manager.stop();
  assert.equal(h.manager.state, 'idle');

  await h.manager.start();
  assert.equal(h.manager.state, 'ready');
  assert.equal(h.manager.failure, null, 'ready 应清除 failure');
  assert.equal(h.manager.baseUrl, EXPECTED_URL);
});

test('npx fallback pins @deepseek-ai/dsh to pin.npm', () => {
  const pin = readPin(path.join(__dirname, '..', '..'));
  const manager = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => null,
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
    readPin: () => pin,
  });
  if (isUnpublishedHarnessNpm(pin.npm)) {
    assert.throws(
      () => manager.buildLaunch({ host: '127.0.0.1', port: 3080 }),
      /尚未发布|npx/,
    );
    return;
  }
  const launch = manager.buildLaunch({ host: '127.0.0.1', port: 3080 });
  assert.equal(launch.kind, 'npx');
  assert.ok(launch.args.includes(`@deepseek-ai/dsh@${pin.npm}`));
  assert.equal(launch.args.includes('@deepseek-ai/dsh'), false);
  assert.equal(launch.args.some((arg) => String(arg).includes('@latest')), false);
});

test('npx fallback refuses an unpublished alpha pin', () => {
  const manager = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => null,
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
    readPin: () => ({
      repo: 'https://github.com/deepseek-ai/deepseek-harness.git',
      ref: 'dsh-v0.1.2-alpha.1',
      sha: 'cd5ef8148158c3a752a658978873241fdf8e2bbc',
      npm: '0.1.2-alpha.1',
    }),
  });
  assert.throws(
    () => manager.buildLaunch({ host: '127.0.0.1', port: 3080 }),
    /尚未发布|npx/,
  );
});

test('launcher recovery flags stay before host and port', () => {
  const manager = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => 'dsh',
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
  });
  const launch = manager.buildLaunch({
    host: '127.0.0.1',
    port: 3080,
    skipUserPlugins: true,
    patchFiles: ['C:/desktop-install.yml'],
  });
  assert.deepEqual(launch.args, [
    'web', '--skip-user-plugins', '--patch', 'C:/desktop-install.yml',
    '--host', '127.0.0.1', '--port', '3080', '--no-open',
  ]);
});

/**
 * Launcher-owned flag set of the vendored args.ts profile launcher:
 * flag → whether it declares a value. Fail-loud extraction — the walk in the
 * contract tests would silently pass on an empty set.
 */
function extractWebLauncherFlags() {
  const argsTs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness', 'apps', 'cli', 'src', 'args.ts'),
    'utf8',
  );
  const webStart = argsTs.indexOf('const program: Command');
  const webEnd = argsTs.indexOf("if (first === 'plugin')");
  assert.ok(webStart !== -1 && webEnd > webStart, 'args.ts profile launcher block not found');
  assert.match(argsTs, /\['--profile', \.\.\.argv\]/, 'named profile shorthand was removed');
  const webBlock = argsTs.slice(webStart, webEnd);
  const launcherFlags = new Map();
  const optionPattern = /\.option\('(--[a-z-]+)( <[^>]+>)?'/g;
  for (let match = optionPattern.exec(webBlock); match; match = optionPattern.exec(webBlock)) {
    launcherFlags.set(match[1], Boolean(match[2]));
  }
  // The profile launcher must still declare the two flags every desktop start
  // relies on (a silent empty set would turn the walk into a no-op).
  assert.equal(launcherFlags.get('--skip-user-plugins'), false, 'web alias lost --skip-user-plugins');
  assert.equal(launcherFlags.get('--patch'), true, 'web alias lost --patch <path>');
  return launcherFlags;
}

/** Walk argv exactly as the CLI does: launcher flags end at the first unknown token. */
function grammarPrefixFlags(launcherFlags, args) {
  assert.equal(args[0], 'web');
  let index = 1;
  const inPrefix = new Set();
  while (index < args.length && launcherFlags.has(args[index])) {
    inPrefix.add(args[index]);
    index += launcherFlags.get(args[index]) ? 2 : 1;
  }
  return { inPrefix, appArgs: args.slice(index) };
}

test('skip argv keeps launcher-owned flags inside the CLI grammar prefix (args.ts contract)', () => {
  // The CLI parser consumes launcher flags until the FIRST token it does not
  // recognize; everything from there on is app args (passThroughOptions). A
  // skip flag that drifts behind `--host` would be silently swallowed by the
  // app — a start WITH user plugins the desktop believes is skipped. Derive
  // the launcher-owned flag set from the vendored args.ts profile launcher so
  // this test tracks the real grammar instead of a copy of today's argv.
  const launcherFlags = extractWebLauncherFlags();
  const manager = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => 'dsh',
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
  });
  const launch = manager.buildLaunch({
    host: '127.0.0.1',
    port: 3080,
    skipUserPlugins: true,
    patchFiles: ['C:/desktop-install.yml', 'C:/extra.yml'],
  });
  const { inPrefix, appArgs } = grammarPrefixFlags(launcherFlags, launch.args);
  assert.ok(inPrefix.has('--skip-user-plugins'), '--skip-user-plugins fell into app args — the CLI would ignore it');
  assert.ok(inPrefix.has('--patch'), '--patch fell into app args — the overlay would never mount');
  assert.equal(appArgs.includes('--skip-user-plugins'), false);
  assert.equal(appArgs.includes('--patch'), false);
});

test('full-start argv keeps the desktop overlay --patch inside the CLI grammar prefix', () => {
  // Since the single-overlay convergence, EVERY start (not only skip) rides
  // `--patch`; a drift behind `--host` would silently drop the install
  // plugin from full starts too.
  const launcherFlags = extractWebLauncherFlags();
  const manager = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => 'dsh',
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
  });
  const launch = manager.buildLaunch({
    host: '127.0.0.1',
    port: 3080,
    patchFiles: [
      'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml',
      'C:/profiles/web/desktop-plugins/dsh-usage-panel/desktop-usage-panel.patch.yml',
    ],
  });
  const { inPrefix, appArgs } = grammarPrefixFlags(launcherFlags, launch.args);
  assert.ok(inPrefix.has('--patch'), '--patch fell into app args — desktop overlays would never mount');
  assert.equal(appArgs.includes('--patch'), false);
  assert.equal(launch.args.includes('--skip-user-plugins'), false);
});

test('harnessSpawnPlan quotes whitespace-bearing args under the Windows .cmd shell', () => {
  const overlay = 'C:\\Users\\John Doe\\AppData\\Roaming\\dshd\\desktop-install.patch.yml';
  const plan = harnessSpawnPlan('C:\\Program Files\\nodejs\\dsh.cmd', ['web', '--patch', overlay], true);
  assert.equal(plan.shell, true);
  assert.equal(plan.command, '"C:\\Program Files\\nodejs\\dsh.cmd"');
  // Under shell:true Node joins args verbatim — an unquoted path with spaces
  // splits into tokens and the CLI sees a truncated overlay path.
  assert.deepEqual(plan.args, ['web', '--patch', `"${overlay}"`]);

  // Non-shell spawn (node binary, all packaged/source starts) stays verbatim.
  const direct = harnessSpawnPlan('C:\\Program Files\\nodejs\\node.exe', ['bin.js', 'web', '--patch', overlay], true);
  assert.equal(direct.shell, false);
  assert.deepEqual(direct.args, ['bin.js', 'web', '--patch', overlay]);

  // Non-Windows never shells out.
  const posix = harnessSpawnPlan('/usr/bin/dsh.cmd', ['web'], false);
  assert.equal(posix.shell, false);
});

function makeSourceLaunchManager(overrides = {}) {
  return new DshManager({
    sourceHarnessStatus: () => ({
      present: true,
      installed: true,
      built: true,
      root: 'C:/harness',
      bin: 'C:/harness/apps/cli/lib/bin.js',
    }),
    resolveNodeBin: () => process.execPath,
    ensureGhosttyAssetsInHarness: () => ({ ok: true, roots: ['C:/harness'], detail: 'complete' }),
    ...overrides,
  });
}

test('every launch kind passes --no-open so dsh web does not open the OS browser', () => {
  const source = makeSourceLaunchManager();
  const sourceLaunch = source.buildLaunch({ host: '127.0.0.1', port: 3080 });
  assert.equal(sourceLaunch.kind, 'source');
  assert.equal(sourceLaunch.args.includes('--no-open'), true);

  const dsh = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => 'dsh',
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
  });
  const dshLaunch = dsh.buildLaunch({ host: '127.0.0.1', port: 3080 });
  assert.equal(dshLaunch.kind, 'dsh');
  assert.equal(dshLaunch.args.includes('--no-open'), true);

  const pin = readPin(path.join(__dirname, '..', '..'));
  const npx = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => null,
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
    readPin: () => pin,
  });
  if (isUnpublishedHarnessNpm(pin.npm)) {
    assert.throws(
      () => npx.buildLaunch({ host: '127.0.0.1', port: 3080 }),
      /尚未发布|npx/,
    );
  } else {
    const npxLaunch = npx.buildLaunch({ host: '127.0.0.1', port: 3080 });
    assert.equal(npxLaunch.kind, 'npx');
    assert.equal(npxLaunch.args.includes('--no-open'), true);
  }
  const publishedNpx = new DshManager({
    sourceHarnessStatus: () => ({ present: false }),
    resolveDshBin: () => null,
    resolveNpx: () => 'npx',
    resolveNodeBin: () => process.execPath,
    readPin: () => ({
      repo: pin.repo,
      ref: pin.ref,
      sha: pin.sha,
      npm: '0.1.1-rc.1',
    }),
  });
  const publishedLaunch = publishedNpx.buildLaunch({ host: '127.0.0.1', port: 3080 });
  assert.equal(publishedLaunch.kind, 'npx');
  assert.equal(publishedLaunch.args.includes('--no-open'), true);
});

test('source launch copies Ghostty assets beside client.js', () => {
  let ensuredRoot;
  const manager = makeSourceLaunchManager({
    ensureGhosttyAssetsInHarness: (root) => {
      ensuredRoot = root;
      return { ok: true, roots: [root], detail: 'complete' };
    },
  });
  const launch = manager.buildLaunch({ host: '127.0.0.1', port: 3080 });
  assert.equal(launch.kind, 'source');
  assert.equal(ensuredRoot, 'C:/harness');
});

test('source launch refuses when in-box desktop fork packages are missing', () => {
  const manager = makeSourceLaunchManager({
    missingDesktopForkPackages: () => ['@deepseek-ai/dsh-client-ui-settings-market'],
  });
  assert.throws(
    () => manager.buildLaunch({ host: '127.0.0.1', port: 3080 }),
    (error) => {
      assert.match(String(error.message), /dsh-client-ui-settings-market/);
      assert.match(String(error.message), /setup:harness/);
      assert.match(String(error.message), /跳过用户插件/);
      return true;
    },
  );
});

test('missingDesktopForkPackages resolves flattened and bundle-nested layouts', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writePkg = (dir, name) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name })}\n`);
  };
  writePkg(path.join(root, 'apps', 'cli'), '@deepseek-ai/dsh');
  const nm = path.join(root, 'node_modules');
  writePkg(path.join(nm, '@deepseek-ai', 'dsh-base'), '@deepseek-ai/dsh-base');
  writePkg(path.join(nm, '@deepseek-ai', 'dsh-web-app'), '@deepseek-ai/dsh-web-app');
  // Anchor without any fork packages: every registered name is missing.
  assert.deepEqual(
    missingDesktopForkPackages(root),
    DESKTOP_PACKAGES.map((pkg) => pkg.name),
  );
  // Flattened (packaged) layout: fork packages beside the bundles.
  for (const pkg of DESKTOP_PACKAGES.slice(1)) {
    writePkg(path.join(nm, ...pkg.name.split('/')), pkg.name);
  }
  // Isolated (pnpm dev) layout: the remaining package resolves only through
  // the web-app bundle's own node_modules, mirroring the runtime's anchors.
  const nested = DESKTOP_PACKAGES[0];
  writePkg(
    path.join(nm, '@deepseek-ai', 'dsh-web-app', 'node_modules', ...nested.name.split('/')),
    nested.name,
  );
  assert.deepEqual(missingDesktopForkPackages(root), []);
  // A root without the CLI anchor cannot be probed and never blocks launch.
  assert.deepEqual(missingDesktopForkPackages(path.join(root, 'nowhere')), []);
});

test('missingDesktopForkPackages reports declared entries that were never built', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-fork-entries-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writePkg = (dir, manifest) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest)}\n`);
  };
  writePkg(path.join(root, 'apps', 'cli'), { name: '@deepseek-ai/dsh' });
  const nm = path.join(root, 'node_modules');
  for (const pkg of DESKTOP_PACKAGES) {
    const dir = path.join(nm, ...pkg.name.split('/'));
    writePkg(dir, { name: pkg.name, main: 'lib/index.js' });
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export {}\n');
  }
  assert.deepEqual(missingDesktopForkPackages(root), []);
  // Vendor pull without setup:harness: the manifest resolves but lib/ was
  // never rebuilt — the Loader dies in ESM exactly like an absent package.
  const stale = DESKTOP_PACKAGES.find((pkg) => pkg.name.endsWith('ui-settings-market'));
  fs.rmSync(path.join(nm, ...stale.name.split('/'), 'lib', 'index.js'), { force: true });
  assert.deepEqual(missingDesktopForkPackages(root), [`${stale.name}/lib/index.js`]);
});

test('source launch refuses when Ghostty assets are incomplete', () => {
  const manager = makeSourceLaunchManager({
    ensureGhosttyAssetsInHarness: () => ({ ok: false, roots: [], detail: 'missing source' }),
  });
  assert.throws(
    () => manager.buildLaunch({ host: '127.0.0.1', port: 3080 }),
    (error) => {
      assert.match(String(error.message), /Ghostty/);
      assert.match(String(error.message), /setup:harness/);
      assert.match(String(error.message), /missing source/);
      return true;
    },
  );
});

test('source launch refuses when harness root is missing', () => {
  const manager = makeSourceLaunchManager({
    sourceHarnessStatus: () => ({
      present: true,
      installed: true,
      built: true,
      bin: 'C:/harness/apps/cli/lib/bin.js',
    }),
    ensureGhosttyAssetsInHarness: () => {
      throw new Error('ensure must not run without root');
    },
  });
  assert.throws(
    () => manager.buildLaunch({ host: '127.0.0.1', port: 3080 }),
    (error) => {
      assert.match(String(error.message), /Ghostty|setup:harness/);
      return true;
    },
  );
});

test('restart 不死锁：stop→start 完整往返，新 child 就绪', async (t) => {
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();
  const childA = h.lastChild();

  await h.manager.restart();

  assert.equal(h.manager.state, 'ready');
  assert.equal(h.spawned.length, 2);
  assert.notEqual(h.lastChild(), childA);
  assert.equal(h.manager.baseUrl, EXPECTED_URL);
});

test('spawnEnv does not alias a third-party gateway as DEEPSEEK_BASE_URL', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-home-'));
  const previousHome = process.env.DSH_HOME;
  const previousBase = process.env.DEEPSEEK_BASE_URL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  setDesktopDshHome(home);
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const env = new DshManager({ loadConfig: () => ({}) }).spawnEnv({
      apiKey: 'ayase-key',
      baseUrl: 'https://ayase.cn/v1',
    }, null);
    assert.equal(env.DEEPSEEK_BASE_URL, undefined);
    assert.equal(env.DEEPSEEK_API_KEY, undefined);
  } finally {
    clearDesktopDshHome();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousBase === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('spawnEnv writes official DeepSeek key and base URL', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-home-'));
  const previousHome = process.env.DSH_HOME;
  const previousBase = process.env.DEEPSEEK_BASE_URL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  setDesktopDshHome(home);
  delete process.env.DEEPSEEK_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const env = new DshManager({ loadConfig: () => ({}) }).spawnEnv({
      apiKey: 'sk-official',
      baseUrl: 'https://api.deepseek.com',
    }, null);
    assert.equal(env.DEEPSEEK_API_KEY, 'sk-official');
    // dsh 0.1.6+ 官方端点归一到 Messages 协议根 https://api.deepseek.com/anthropic
    assert.equal(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com/anthropic');
  } finally {
    clearDesktopDshHome();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousBase === undefined) delete process.env.DEEPSEEK_BASE_URL;
    else process.env.DEEPSEEK_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('start passes desktop DSH_HOME to spawnHarness even when dsh_home is inherited', async (t) => {
  const inherited = path.join(os.homedir(), '.dsh');
  const previous = process.env.dsh_home;
  process.env.dsh_home = inherited;
  t.after(() => {
    if (previous === undefined) delete process.env.dsh_home;
    else process.env.dsh_home = previous;
  });
  const h = makeHarness();
  t.after(h.cleanup);
  h.setReachable(true);
  await h.manager.start();
  const { getDesktopDshHome } = require('../shared/dsh-home');
  assert.equal(h.calls.spawn.options.env.DSH_HOME, getDesktopDshHome());
  assert.equal('dsh_home' in h.calls.spawn.options.env, false);
});

test('spawnEnv overwrites inherited DSH_HOME with the desktop home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-desktop-home-'));
  const previous = process.env.DSH_HOME;
  setDesktopDshHome(home);
  process.env.DSH_HOME = path.join(os.homedir(), '.dsh');
  try {
    const env = new DshManager({ loadConfig: () => ({}) }).spawnEnv({}, null);
    assert.equal(env.DSH_HOME, path.resolve(home));
  } finally {
    clearDesktopDshHome();
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('ensureOwnedPort 不击杀未经 pid 文件确认的占用者，改跳端口', async (t) => {
  const http = require('node:http');
  const { ensureOwnedPort } = require('./dsh');
  // 冒充一个「像 dsh 一样 HTTP 就绪」的第三方服务：即便 httpReady 也不得击杀。
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { connection: 'close' });
    res.end('ok');
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const wanted = server.address().port;
  const logs = [];
  const port = await ensureOwnedPort('127.0.0.1', wanted, (line) => logs.push(line));
  assert.notEqual(port, wanted, '被占端口应改跳，不得抢占');
  assert.equal(server.listening, true, '未确认归属的占用者绝不能被击杀');
  assert.ok(logs.some((line) => line.includes('改用')), '应记录跳端口');
});

test('dsh.js 不再包含按进程名扫描端口的兜底击杀', () => {
  const source = fs.readFileSync(path.join(__dirname, 'dsh.js'), 'utf8');
  assert.doesNotMatch(source, /killOwnedListeners/);
  assert.doesNotMatch(source, /listeningPids/);
  assert.doesNotMatch(source, /netstat/);
  assert.doesNotMatch(source, /lsof/);
});

// ---------------------------------------------------------------------------
// L-2：就绪探测尊重 config.host（不再硬编码 127.0.0.1|localhost）
// ---------------------------------------------------------------------------

test('connectHost 将通配绑定归一为回环，具体地址原样保留', () => {
  const { connectHost } = require('./dsh');
  assert.equal(connectHost('0.0.0.0'), '127.0.0.1');
  assert.equal(connectHost('::'), '127.0.0.1');
  assert.equal(connectHost('[::]'), '127.0.0.1');
  assert.equal(connectHost('*'), '127.0.0.1');
  assert.equal(connectHost(''), '127.0.0.1');
  assert.equal(connectHost(undefined), '127.0.0.1');
  assert.equal(connectHost('127.0.0.1'), '127.0.0.1');
  assert.equal(connectHost('localhost'), 'localhost');
  assert.equal(connectHost('192.168.1.5'), '192.168.1.5');
});

test('readyUrlPattern 接受配置 host、回环与 localhost，拒绝无关主机', () => {
  const { readyUrlPattern } = require('./dsh');
  const custom = readyUrlPattern('192.168.1.5');
  assert.ok(custom.test('dsh web: http://192.168.1.5:3080'));
  assert.ok(custom.test('dsh web: http://127.0.0.1:3080'));
  assert.ok(custom.test('dsh web: http://localhost:3080'));
  assert.match('dsh web: http://127.0.0.1:3080/?token=launch'.match(custom)[1], /\?token=launch/);
  assert.equal(custom.test('dsh web: http://192.168.1.50:3080'), false, '正则须转义点号，禁止前缀误配');
  assert.equal(custom.test('dsh web: http://evil.example:3080'), false);

  const wildcard = readyUrlPattern('0.0.0.0');
  assert.ok(wildcard.test('dsh web: http://0.0.0.0:3080'));
  assert.ok(wildcard.test('dsh web: http://127.0.0.1:3080'));

  const ipv6 = readyUrlPattern('::');
  assert.ok(ipv6.test('dsh web: http://[::]:3080'));
  assert.ok(ipv6.test('dsh web: http://127.0.0.1:3080'));
});

test('L-2：config.host 为具体地址时，就绪行按该 host 匹配并进入 ready', async (t) => {
  const HOST = '192.168.1.5';
  const URL_ON_HOST = `http://${HOST}:3080`;
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-host-ws-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const h = makeHarness({
    announceReady: false,
    deps: {
      loadConfig: () => ({ workspace, host: HOST, port: 3080 }),
    },
  });
  t.after(h.cleanup);
  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true, false);
  await tick(20);
  assert.equal(h.manager.state, 'starting', '旧正则会在此永远等不到就绪行');
  h.lastChild().stdout.emit('data', Buffer.from(`dsh web: ${URL_ON_HOST}\n`));
  const result = await outcome;
  assert.equal(result.ok, true);
  assert.equal(h.manager.baseUrl, URL_ON_HOST);
  assert.equal(h.manager.state, 'ready');
});

test('L-2：通配 host 0.0.0.0 的就绪 URL 归一为可连接的 127.0.0.1', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wild-ws-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const h = makeHarness({
    announceReady: false,
    deps: {
      loadConfig: () => ({ workspace, host: '0.0.0.0', port: 3080 }),
    },
  });
  t.after(h.cleanup);
  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  assert.equal(
    h.manager.baseUrl,
    'http://127.0.0.1:3080',
    'expectedUrl 应使用可连接地址而非 0.0.0.0',
  );
  h.setReachable(true, false);
  h.lastChild().stdout.emit('data', Buffer.from('dsh web: http://0.0.0.0:3080\n'));
  const result = await outcome;
  assert.equal(result.ok, true);
  assert.equal(h.manager.baseUrl, 'http://127.0.0.1:3080', '就绪 URL 中的通配主机应重写为回环');
  assert.equal(h.manager.state, 'ready');
});

test('就绪行带 token 时 baseUrl 保留 query', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-ws-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const h = makeHarness({
    announceReady: false,
    deps: {
      loadConfig: () => ({ workspace, host: '127.0.0.1', port: 3080 }),
    },
  });
  t.after(h.cleanup);
  const outcome = settle(h.manager.start());
  await waitFor(() => h.spawned.length === 1);
  h.setReachable(true, false);
  h.lastChild().stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:3080/?token=launch\n'));
  const result = await outcome;
  assert.equal(result.ok, true);
  assert.match(h.manager.baseUrl, /\?token=launch/);
});

test('probePort/findFreePort 对通配 host 归一探测地址', async () => {
  const http = require('node:http');
  const { probePort: probe, findFreePort: findFree } = require('./dsh');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { connection: 'close' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const result = await probe('0.0.0.0', port);
    assert.equal(result.inUse, true, '通配 host 探测应命中回环上的监听');
    assert.equal(result.host, '127.0.0.1');
    const free = await findFree('0.0.0.0', port);
    assert.notEqual(free, port, 'findFreePort 归一后应看到端口被占');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Windows 保留端口段：段内没有监听者，connect 探测看不见，必须真实 bind 试探
// ---------------------------------------------------------------------------

test('canBindPort：空闲端口可绑定，被占用端口不可绑定', async () => {
  const http = require('node:http');
  const { canBindPort } = require('./dsh');
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const held = server.address().port;
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const released = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  try {
    assert.equal(await canBindPort('127.0.0.1', held), false, '被占用端口应判定不可绑定');
    assert.equal(await canBindPort('127.0.0.1', released), true, '刚释放的端口应判定可绑定');
  } finally {
    server.close();
  }
});

test('ensureOwnedPort 遇系统保留端口（bind EACCES）时改用相邻可绑定端口', async () => {
  const http = require('node:http');
  const { ensureOwnedPort } = require('./dsh');
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const wanted = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  // 模拟 Windows 保留段：wanted~wanted+2 无监听者，但 bind 会 EACCES。
  const reserved = new Set([wanted, wanted + 1, wanted + 2]);
  const logs = [];
  const port = await ensureOwnedPort('127.0.0.1', wanted, (line) => logs.push(line), {
    bindable: async (host, candidate) => !reserved.has(candidate),
  });
  assert.ok(!reserved.has(port), '不得落在保留段内');
  assert.ok(port > wanted, '应改跳到保留段之外');
  assert.ok(
    logs.some((line) => line.includes('被系统保留') && line.includes('改用')),
    '应记录保留原因：' + JSON.stringify(logs),
  );
});

test('findFreePort 跳过不可绑定的保留端口', async () => {
  const http = require('node:http');
  const { findFreePort } = require('./dsh');
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const begin = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const reserved = new Set([begin, begin + 1]);
  const port = await findFreePort('127.0.0.1', begin, {
    bindable: async (host, candidate) => !reserved.has(candidate),
  });
  assert.ok(!reserved.has(port), '保留端口不得当选');
  assert.ok(port > begin, '应跳到保留段之外');
});

test('ensureOwnedPort 不把无效绑定地址误归因于系统保留端口', async () => {
  const { ensureOwnedPort } = require('./dsh');
  await assert.rejects(
    () => ensureOwnedPort('192.0.2.1', 3080, () => {}, {
      bindableStatus: async () => ({ ok: false, errorCode: 'EADDRNOTAVAIL' }),
    }),
    (error) => {
      assert.equal(error.code, 'EADDRNOTAVAIL');
      assert.match(error.message, /EADDRNOTAVAIL/);
      return true;
    },
  );
});
