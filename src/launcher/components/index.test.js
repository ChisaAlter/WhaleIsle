'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createComponentsService } = require('./index');
const store = require('./store');
const lifecycle = require('./lifecycle');
const ipcComponents = require('../../main/ipc-components');
const { IPC_ROLES } = require('../../main/ipc-authorization');
const { IPC_CONTRACT } = require('../../shared/ipc-contract');

// Lane modules register through the contract-backed ctx handle: roles and
// argument validation now come from src/shared/ipc-contract.js (#436).
function contractRoles(channel) {
  return IPC_CONTRACT.find((entry) => entry.channel === channel && entry.kind === 'invoke')?.roles;
}

const SAMPLE_FIXTURES = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'components');

test('native PID query distinguishes absent, denied and unknown results without sending a signal', () => {
  let called = false;
  assert.equal(lifecycle.isPidAlive(-1, { processKill: () => { called = true; } }), false);
  assert.equal(called, false);
  const query = (code) => ({ processKill: (pid, signal) => {
    assert.equal(pid, 42);
    assert.equal(signal, 0);
    if (code) throw Object.assign(new Error(code), { code });
  } });
  assert.equal(lifecycle.isPidAlive(42, query()), true);
  assert.equal(lifecycle.isPidAlive(42, query('EPERM')), true);
  assert.equal(lifecycle.isPidAlive(42, query('ESRCH')), false);
  assert.throws(() => lifecycle.isPidAlive(42, query('EUNKNOWN')), { code: 'EUNKNOWN' });
});

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // tmp cleanup best effort
    }
  });
  return dir;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) {
      return true;
    }
    await sleep(25);
  }
  return cond();
}

function makeSample(root, id, version, extra = {}) {
  const dir = path.join(root, id, version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id,
    name: `Toy ${id}`,
    version,
    description: 'toy component',
    entry: 'entry.js',
    kind: 'service',
    ...extra,
  }));
  fs.writeFileSync(path.join(dir, 'entry.js'), `'use strict'; // ${version}\nsetInterval(() => {}, 60000);\n`);
  return dir;
}

// Fake child_process seam: an EventEmitter child + PID query/taskkill
// over a Set of live pids. Drive exits by emitting 'exit' on the child.
function fakeEnv(t, { samples } = {}) {
  const root = tmpDir(t, 'dshd-comp-svc-');
  const samplesRoot = samples || tmpDir(t, 'dshd-comp-src-');
  const spawned = [];
  const killed = [];
  const alive = new Set();
  let nextPid = 5000;
  const deps = {
    componentsRoot: root,
    samplesRoot,
    platform: 'win32',
    startGraceMs: 30,
    stateWaitMs: 30,
    restartBaseMs: 10,
    processKill: (pid, signal) => {
      assert.equal(signal, 0);
      if (!alive.has(pid)) throw Object.assign(new Error('absent'), { code: 'ESRCH' });
      return true;
    },
    spawn: (bin, args, options) => {
      const pid = nextPid += 1;
      alive.add(pid);
      const child = new EventEmitter();
      child.pid = pid;
      child.exitCode = null;
      child.stdout = null;
      child.stderr = null;
      child.unref = () => {};
      child.kill = () => {
        if (child.exitCode === null) {
          child.exitCode = 0;
          alive.delete(pid);
          setImmediate(() => child.emit('exit', 0));
        }
        return true;
      };
      spawned.push({ pid, bin, args, options, child });
      return child;
    },
    execFileSync: (bin, args, options) => {
      const text = args.join(' ');
      if (bin === 'tasklist') {
        const match = /PID eq (\d+)/.exec(text);
        const pid = match ? Number(match[1]) : 0;
        return alive.has(pid) ? `"node.exe","${pid}","Console","1","10 K"` : 'INFO: no tasks';
      }
      if (bin === 'taskkill') {
        return runTaskkill(args, options);
      }
      return '';
    },
    execFile: (bin, args, options, callback) => {
      if (bin === 'taskkill') {
        try {
          const out = runTaskkill(args, options);
          callback(null, out);
        } catch (error) {
          callback(error);
        }
        return;
      }
      callback(null, '');
    },
  };
  function runTaskkill(args, options) {
    const text = args.join(' ');
    const match = /\/PID\s+(\d+)/i.exec(text);
    const pid = match ? Number(match[1]) : 0;
    killed.push({ pid, args: args.slice(), options });
    // Mirror real Windows: a non-forced taskkill on a windowless child is
    // refused ("只能强制终止"), only /F actually kills.
    if (!args.includes('/F')) {
      throw new Error('refused: needs /F');
    }
    alive.delete(pid);
    const row = spawned.find((item) => item.pid === pid);
    if (row && row.child.exitCode === null) {
      row.child.exitCode = 0;
      setImmediate(() => row.child.emit('exit', 0));
    }
    return '';
  }
  return { deps, spawned, killed, alive, root, samplesRoot };
}

// --- catalog → list ----------------------------------------------------------

test('list shows catalog components as available with contract fields', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  const payload = svc.list();
  const row = payload.components.find((item) => item.id === 'toy');
  assert.ok(row);
  assert.equal(row.state, 'available');
  assert.equal(row.version, '1.0.0');
  assert.equal(row.installedVersion, '');
  assert.equal(row.source, 'bundled');
  assert.equal(row.description, 'toy component');
});

// --- install -----------------------------------------------------------------

test('install stages payload into versions/<v> and records the component', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  const progress = [];
  const result = await svc.install('toy', (p) => progress.push(p));
  assert.equal(result.ok, true);
  assert.equal(result.component.state, 'installed');
  assert.equal(result.component.installedVersion, '1.0.0');
  const vdir = store.versionDir(env.root, 'toy', '1.0.0');
  assert.equal(fs.existsSync(path.join(vdir, 'entry.js')), true);
  assert.equal(fs.existsSync(path.join(vdir, 'manifest.json')), true);
  assert.equal(fs.existsSync(store.dataDir(env.root, 'toy')), true);
  const rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.state, 'installed');
  assert.ok(progress.some((p) => p.phase === 'copy'));
  assert.ok(progress.some((p) => p.phase === 'verify'));
  assert.equal(progress[progress.length - 1].phase, 'done');
});

test('install rejects unknown ids, traversal ids and repeats', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  assert.equal((await svc.install('ghost')).error, 'unknown-component');
  assert.equal((await svc.install('../evil')).error, 'invalid-id');
  await svc.install('toy');
  assert.equal((await svc.install('toy')).error, 'already-installed');
  assert.equal((await svc.install({ id: 'toy', version: '9.9.9' })).error, 'already-installed');
});

// --- start / stop ------------------------------------------------------------

test('start spawns the entry, records pid, and stop taskkills the tree', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');

  const started = await svc.start('toy');
  assert.equal(started.ok, true);
  assert.equal(started.state, 'running');
  assert.ok(started.pid > 5000);
  assert.equal(env.spawned.length, 1);
  const call = env.spawned[0];
  assert.equal(call.bin, process.execPath);
  assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(call.options.env.LAUNCHER_COMPONENT_ID, 'toy');
  assert.equal(path.basename(call.args[0]), 'entry.js');

  // Idempotent while alive.
  const again = await svc.start('toy');
  assert.equal(again.ok, true);
  assert.equal(again.pid, started.pid);
  assert.equal(env.spawned.length, 1);

  const stopped = await svc.stop('toy');
  assert.equal(stopped.ok, true);
  assert.equal(stopped.state, 'stopped');
  const kill = env.killed.find((row) => row.pid === started.pid);
  assert.ok(kill, 'stop must run the shared tree kill');
  assert.ok(kill.args.includes('/T') && kill.args.includes('/F'), 'tree kill must walk the tree and be forced');
  assert.equal(kill.options.timeout, 2500, 'the shared taskkill timeout applies');
  assert.equal(store.loadRegistry(env.root).components.toy.state, 'stopped');
});

test('a component that exits during the start grace lands in error state', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  env.deps.spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.pid = 6100;
    child.stdout = null;
    child.stderr = null;
    child.unref = () => {};
    child.kill = () => true;
    Object.defineProperty(child, 'exitCode', { get: () => 1 });
    setImmediate(() => child.emit('exit', 1));
    return child;
  };
  const result = await svc.start('toy');
  assert.equal(result.ok, false);
  assert.equal(result.state, 'error');
  const row = svc.list().components.find((item) => item.id === 'toy');
  assert.equal(row.state, 'error');
  assert.match(row.message, /退出|失败/);
});

test('log stream open/write failures are reported once and never escape as uncaughtException', async (t) => {
  const env = fakeEnv(t);
  const warnings = [];
  const uncaught = [];
  const onUncaught = (error) => uncaught.push(error);
  process.once('uncaughtException', onUncaught);
  t.after(() => process.removeListener('uncaughtException', onUncaught));
  let logStream = null;
  // Deterministic async open failure: mkdir/stat succeed, the stream itself
  // reports ENOENT on a later tick — the same race CI hit when teardown
  // removed the data dir between createWriteStream and open.
  const brokenFs = {
    mkdirSync() {},
    statSync() { return { size: 0 }; },
    createWriteStream() {
      logStream = new EventEmitter();
      logStream.destroyed = false;
      logStream.end = () => {};
      logStream.destroy = () => { logStream.destroyed = true; };
      setImmediate(() => logStream.emit('error', Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })));
      return logStream;
    },
  };
  const child = lifecycle.spawnComponent({
    entryFile: 'entry.js',
    dir: env.root,
    dataDir: path.join(env.root, 'gone', 'data'),
    logFile: path.join(env.root, 'gone', 'data', 'component.log'),
    id: 'toy',
    version: '1.0.0',
  }, { ...env.deps, fs: brokenFs, log: (line) => warnings.push(line) });
  assert.ok(child, 'spawn still proceeds — log failure must not break supervision');
  assert.equal(await waitFor(() => logStream && logStream.destroyed), true, 'failed stream is dropped');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ENOENT/);
  // A follow-up error (e.g. end() after destroy) stays contained too.
  logStream.emit('error', Object.assign(new Error('write after destroy'), { code: 'ERR_STREAM_DESTROYED' }));
  await sleep(50);
  assert.equal(warnings.length, 1, 'subsequent stream errors are not re-reported');
  assert.deepEqual(uncaught, [], 'stream errors must not reach uncaughtException');
});

test('unexpected exits restart with bounded backoff then give up to error', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  env.deps.maxRestarts = 2;
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const started = await svc.start('toy');
  assert.equal(started.ok, true);
  // Crash generation 1 → restart (attempt 1)
  env.spawned[0].child.exitCode = 1;
  env.spawned[0].child.emit('exit', 1);
  assert.equal(await waitFor(() => env.spawned.length === 2), true, 'first restart');
  // Crash generation 2 → restart (attempt 2)
  env.spawned[1].child.exitCode = 1;
  env.spawned[1].child.emit('exit', 1);
  assert.equal(await waitFor(() => env.spawned.length === 3), true, 'second restart');
  // Crash generation 3 → attempts exhausted → error
  env.spawned[2].child.exitCode = 1;
  env.spawned[2].child.emit('exit', 1);
  assert.equal(await waitFor(() => {
    const rec = store.loadRegistry(env.root).components.toy;
    return rec && rec.state === 'error';
  }), true, 'record must land in error');
  const rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.pid, null);
  assert.match(rec.lastError, /code/);
  assert.equal(env.spawned.length, 3, 'no spawn past the restart cap');
  assert.equal(svc._internals.procs.has('toy'), false, 'give-up leaves no proc, child or restart timer behind');
});

test('reconcile adopts live pids and marks dead ones stopped', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const started = await svc.start('toy');
  // Simulate a launcher restart: fresh service over the same root, no procs.
  const svc2 = createComponentsService(env.deps);
  let row = svc2.list().components.find((item) => item.id === 'toy');
  assert.equal(row.state, 'running', 'live orphan pid is adopted as running');
  assert.equal(row.pid, started.pid);
  env.alive.delete(started.pid);
  row = svc2.list().components.find((item) => item.id === 'toy');
  assert.equal(row.state, 'stopped', 'dead orphan pid reconciles to stopped');
  assert.equal(row.pid, null);
});

// --- update / rollback --------------------------------------------------------

test('update swaps the payload, keeps N=1 previous, and rollback restores it', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  makeSample(env.samplesRoot, 'toy', '2.0.0');
  makeSample(env.samplesRoot, 'toy', '3.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install({ id: 'toy', version: '1.0.0' });

  const upd = await svc.update('toy');
  assert.equal(upd.ok, true);
  assert.equal(upd.from, '1.0.0');
  assert.equal(upd.to, '3.0.0');
  let rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.version, '3.0.0');
  assert.equal(rec.previous, '1.0.0');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '1.0.0')), true);
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '3.0.0')), true);

  const back = await svc.rollback('toy');
  assert.equal(back.ok, true);
  assert.equal(back.to, '1.0.0');
  rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.version, '1.0.0');
  assert.equal(rec.previous, '3.0.0', 'rolled-forward version stays redoable');

  const fwd = await svc.update('toy');
  assert.equal(fwd.to, '3.0.0');
  rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.previous, '1.0.0');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '1.0.0')), true);
});

test('update a second time drops the superseded previous payload', async (t) => {
  const env = fakeEnv(t);
  for (const v of ['1.0.0', '2.0.0', '3.0.0']) {
    makeSample(env.samplesRoot, 'toy', v);
  }
  const svc = createComponentsService(env.deps);
  await svc.install({ id: 'toy', version: '1.0.0' });
  // Seed previous=0.9.0 manually as if an older rollback existed.
  const reg = store.loadRegistry(env.root);
  reg.components.toy.previous = '0.9.0';
  store.saveRegistry(env.root, reg);
  fs.mkdirSync(store.versionDir(env.root, 'toy', '0.9.0'), { recursive: true });
  const svc2 = createComponentsService(env.deps);
  const upd = await svc2.update('toy');
  assert.equal(upd.to, '3.0.0');
  const rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.previous, '1.0.0');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '0.9.0')), false, 'superseded previous is dropped');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '1.0.0')), true);
});

test('update while running restarts on the new version', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  makeSample(env.samplesRoot, 'toy', '2.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install({ id: 'toy', version: '1.0.0' });
  const started = await svc.start('toy');
  const upd = await svc.update('toy');
  assert.equal(upd.ok, true);
  assert.equal(upd.to, '2.0.0');
  assert.ok(env.killed.some((row) => row.pid === started.pid), 'old pid is killed');
  assert.equal(env.spawned.length, 2, 'new version respawned');
  const rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.state, 'running');
  assert.equal(rec.version, '2.0.0');
  assert.notEqual(rec.pid, started.pid);
});

test('update without a newer version reports no-newer-version', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const result = await svc.update('toy');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-newer-version');
  assert.equal(result.to, '1.0.0');
});

test('rollback without a previous payload is refused', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const result = await svc.rollback('toy');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'nothing-to-rollback');
});

// --- uninstall / snapshot / locking ------------------------------------------

test('uninstall stops, removes payloads and the record, and keeps data', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const started = await svc.start('toy');
  fs.writeFileSync(path.join(store.dataDir(env.root, 'toy'), 'notes.json'), '[]');
  const result = await svc.uninstall('toy');
  assert.equal(result.ok, true);
  assert.ok(env.killed.some((row) => row.pid === started.pid));
  assert.equal(fs.existsSync(store.versionsDir(env.root, 'toy')), false);
  assert.equal(fs.existsSync(store.dataDir(env.root, 'toy')), true, 'data dir survives uninstall');
  assert.equal(store.loadRegistry(env.root).components.toy, undefined);
  const row = svc.list().components.find((item) => item.id === 'toy');
  assert.equal(row.state, 'available');
});

test('snapshot returns compact {id,state,version} rows only', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  assert.deepEqual(svc.snapshot(), []);
  await svc.install('toy');
  assert.deepEqual(svc.snapshot(), [{ id: 'toy', state: 'installed', version: '1.0.0' }]);
});

test('a second op on a busy component is refused', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const first = svc.start('toy');
  const second = await svc.stop('toy');
  assert.equal(second.ok, false);
  assert.equal(second.error, 'busy');
  assert.equal((await first).ok, true);
});

test('shutdown kills recorded running pids synchronously', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService(env.deps);
  await svc.install('toy');
  const started = await svc.start('toy');
  svc.shutdown();
  assert.ok(env.killed.some((row) => row.pid === started.pid));
  const rec = store.loadRegistry(env.root).components.toy;
  assert.equal(rec.state, 'stopped');
});

// --- ipc contract --------------------------------------------------------------

test('ipc-components mounts the frozen channel set with LAUNCHER_ONLY', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  ipcComponents._configureForTest(env.deps);
  const channels = new Map();
  const sent = [];
  const ctx = {
    LAUNCHER_ONLY: ['launcher'],
    IPC_ROLES,
    handle: (channel, listener) => {
      channels.set(channel, { listener });
    },
    send: (event, channel, payload) => {
      sent.push({ channel, payload });
    },
  };
  ipcComponents.register(ctx);
  const expected = [
    'shell:components-list',
    'shell:components-install',
    'shell:components-start',
    'shell:components-stop',
    'shell:components-update',
    'shell:components-rollback',
    'shell:components-uninstall',
    'shell:components-uninstall-info',
    'shell:components-open',
  ];
  for (const name of expected) {
    assert.ok(channels.has(name), `missing channel ${name}`);
    assert.deepEqual(contractRoles(name), [IPC_ROLES.LAUNCHER]);
  }
  for (const name of ['shell:whalebridge-status', 'shell:whalebridge-open']) {
    assert.equal(channels.has(name), false, `${name} is no longer exposed to the Harness`);
  }
  const list = await channels.get('shell:components-list').listener({});
  assert.ok(Array.isArray(list.components));
  const install = await channels.get('shell:components-install').listener({}, 'toy');
  assert.equal(install.ok, true);
  assert.ok(sent.some((row) => row.channel === 'shell:components-progress' && row.payload.id === 'toy'));
  const status = ipcComponents.contributeStatus();
  assert.ok(Array.isArray(status.components));
  assert.deepEqual(status.components, [{ id: 'toy', state: 'installed', version: '1.0.0' }]);
});

test('launcher Magpie open reuses the settings-window path without returning its URL', async (t) => {
  const env = fakeEnv(t);
  const url = 'http://127.0.0.1:3430/?k=' + 'a'.repeat(32);
  let outcome = { ok: true, url, ownership: 'managed', version: '0.1.4708' };
  const bridge = {
    id: 'magpie',
    row: () => ({ id: 'magpie', latest: '0.1.4708', capabilities: { externalUpdateUrl: '' } }),
    start: t.mock.fn(async (progress) => {
      progress({ phase: 'done', percent: 100 });
      return outcome;
    }),
  };
  const open = t.mock.method(require('../../main/magpie-window'), 'openMagpieWindow', () => {});
  ipcComponents._configureForTest({ ...env.deps, magpie: bridge });
  t.after(() => ipcComponents._configureForTest());
  const channels = new Map();
  const sent = [];
  ipcComponents.register({
    IPC_ROLES,
    LAUNCHER_ONLY: [IPC_ROLES.LAUNCHER],
    handle: (channel, listener) => channels.set(channel, { listener }),
    send: (event, channel, payload) => sent.push({ event, channel, payload }),
    onQuitCommit() {},
  });
  const launcher = channels.get('shell:components-open');
  assert.deepEqual(contractRoles('shell:components-open'), [IPC_ROLES.LAUNCHER]);
  const event = {};
  assert.deepEqual(await launcher.listener(event, 'magpie'), { ok: true });
  assert.equal(bridge.start.mock.callCount(), 1);
  assert.equal(open.mock.calls.length, 1);
  assert.equal(open.mock.calls[0].arguments[0].url, url);
  assert.equal(open.mock.calls[0].arguments[0].ownership, 'managed');
  assert.ok(sent.every((row) => row.channel === 'shell:components-progress'
    && row.payload.id === 'magpie' && !Object.hasOwn(row.payload, 'url')));

  for (const failure of [
    { ok: false, error: 'busy' },
    { ok: false, error: 'magpie-failed', message: 'Please install Magpie first' },
  ]) {
    outcome = failure;
    assert.deepEqual(await launcher.listener(event, 'magpie'), failure);
  }
  assert.equal(open.mock.callCount(), 1, 'failed starts must not open a settings window');
  assert.deepEqual(await launcher.listener(event, 'other-component'), { ok: false, error: 'unknown-component' });
  assert.equal(bridge.start.mock.callCount(), 3, 'unknown component must not start Magpie');
});

for (const operation of ['update', 'rollback', 'uninstall']) {
  test(`ipc-components Magpie ${operation} invalidates settings only after a successful or changed runtime`, async (t) => {
    const env = fakeEnv(t);
    const oldUrl = 'http://127.0.0.1:3430/?k=' + 'a'.repeat(32);
    const restoredUrl = 'http://127.0.0.1:3431/?k=' + 'b'.repeat(32);
    let live, nextLive, outcome;
    const bridge = {
      id: 'magpie',
      state: () => live,
      [operation]: t.mock.fn(async () => {
        live = nextLive;
        return outcome;
      }),
    };
    const close = t.mock.method(require('../../main/magpie-window'), 'closeMagpieWindow', () => {});
    ipcComponents._configureForTest({ ...env.deps, magpie: bridge });
    t.after(() => ipcComponents._configureForTest());
    const channels = new Map();
    ipcComponents.register({
      IPC_ROLES,
      LAUNCHER_ONLY: [IPC_ROLES.LAUNCHER],
      handle: (channel, listener) => channels.set(channel, { listener }),
      send() {},
      onQuitCommit() {},
    });
    const { listener } = channels.get(`shell:components-${operation}`);
    assert.deepEqual(contractRoles(`shell:components-${operation}`), [IPC_ROLES.LAUNCHER]);
    const cases = [
      { name: 'success retains existing close behavior', result: { ok: true }, after: oldUrl, closes: true },
      { name: 'failed switch restored at a new origin', result: { ok: false, error: 'magpie-failed' }, after: restoredUrl, closes: true },
      { name: 'failed switch restored with a new authentication key', result: { ok: false, error: 'magpie-failed' }, after: oldUrl.replace(/a{32}/, 'b'.repeat(32)), closes: true },
      { name: 'staging failed before the healthy runtime changed', result: { ok: false, error: 'magpie-failed', message: 'SHA256 mismatch' }, after: oldUrl, closes: false },
      { name: 'busy refusal retains the healthy window', result: { ok: false, error: 'busy' }, after: oldUrl, closes: false },
      { name: 'active request refusal retains the healthy window', result: { ok: false, error: 'magpie-failed', message: 'Active DSH request' }, after: oldUrl, closes: false },
    ];
    const argument = operation === 'uninstall' ? { id: 'magpie', removeData: false } : 'magpie';
    for (const scenario of cases) {
      live = { url: oldUrl };
      nextLive = { url: scenario.after };
      outcome = scenario.result;
      const before = close.mock.callCount();
      assert.equal(await listener({}, argument), outcome, scenario.name);
      assert.equal(close.mock.callCount() - before, Number(scenario.closes), scenario.name);
    }
    const call = bridge[operation].mock.calls[0].arguments;
    assert.equal(typeof call[operation === 'uninstall' ? 1 : 0], 'function');
    if (operation === 'uninstall') assert.equal(call[0], argument);
  });
}

// --- real end-to-end over the launcher-notes fixture ----------------------------
// Not faked: the tests/fixtures/components/launcher-notes payload is installed
// into a temp userData, spawned via real node, probed over real HTTP, updated
// v1→v2 while running, rolled back, stopped and uninstalled.

function getJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET' }, (res) => {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('launcher-notes walks the full real lifecycle v1 → v2 → rollback', async (t) => {
  assert.equal(fs.existsSync(SAMPLE_FIXTURES), true, 'component fixture must exist');
  const root = tmpDir(t, 'dshd-comp-e2e-');
  const svc = createComponentsService({
    componentsRoot: root,
    samplesRoot: SAMPLE_FIXTURES,
    stateWaitMs: 8000,
    restartBaseMs: 50,
  });
  const progress = [];
  const onProgress = (p) => progress.push(p);

  const install = await svc.install({ id: 'launcher-notes', version: '1.0.0' }, onProgress);
  assert.equal(install.ok, true);
  assert.equal(install.component.installedVersion, '1.0.0');

  const started = await svc.start('launcher-notes', onProgress);
  assert.equal(started.ok, true);
  assert.equal(started.state, 'running');
  assert.ok(started.pid > 0);
  assert.ok(started.url, 'cooperative component must publish its url');
  t.after(async () => {
    try {
      await svc.stop('launcher-notes');
    } catch {
      // already stopped
    }
  });

  const v1 = await getJson(started.url);
  assert.equal(v1.status, 200);
  assert.equal(v1.body.version, '1.0.0');
  const posted = await getJson(`${started.url}notes`, {
    method: 'POST',
    body: JSON.stringify({ text: 'survives the update' }),
  });
  assert.equal(posted.status, 201);

  // Heartbeat state file is real evidence the panel can show.
  const stateJson = lifecycle.readStateFile(store.stateFile(root, 'launcher-notes'));
  assert.equal(stateJson.version, '1.0.0');
  assert.equal(stateJson.pid, started.pid);

  const upd = await svc.update('launcher-notes', onProgress);
  assert.equal(upd.ok, true);
  assert.equal(upd.from, '1.0.0');
  assert.equal(upd.to, '2.0.0');
  const row = svc.list().components.find((item) => item.id === 'launcher-notes');
  assert.equal(row.state, 'running', 'running component restarts on the new version');
  assert.equal(row.version, '2.0.0');
  assert.notEqual(row.pid, started.pid);

  const v2 = await getJson(row.url);
  assert.equal(v2.body.version, '2.0.0');
  const stats = await getJson(`${row.url}stats`);
  assert.equal(stats.status, 200, 'v2-only endpoint answers');
  assert.equal(stats.body.notes, 1, 'data dir survives the update');

  const back = await svc.rollback('launcher-notes', onProgress);
  assert.equal(back.ok, true);
  assert.equal(back.to, '1.0.0');
  const backRow = svc.list().components.find((item) => item.id === 'launcher-notes');
  const backHome = await getJson(backRow.url);
  assert.equal(backHome.body.version, '1.0.0');
  assert.equal(backHome.body.notes.length, 1, 'note survives rollback');
  const statsGone = await getJson(`${backRow.url}stats`);
  assert.equal(statsGone.status, 404, 'v2 endpoint disappears on rollback');

  const stopped = await svc.stop('launcher-notes', onProgress);
  assert.equal(stopped.state, 'stopped');
  await assert.rejects(() => getJson(backRow.url), 'endpoint must die with the process');

  const removed = await svc.uninstall('launcher-notes', onProgress);
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(store.versionsDir(root, 'launcher-notes')), false);
  assert.equal(fs.existsSync(store.dataDir(root, 'launcher-notes')), true);
  const finalRow = svc.list().components.find((item) => item.id === 'launcher-notes');
  assert.equal(finalRow.state, 'available');
});

test('stopComponent fails closed when PID stays alive and blocks update/uninstall', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  makeSample(env.samplesRoot, 'toy', '2.0.0');
  env.deps.execFileSync = (bin) => {
    if (bin === 'taskkill') throw new Error('Access denied');
    return '';
  };
  env.deps.execFile = (bin, _args, _opts, cb) => {
    if (bin === 'taskkill') cb(new Error('Access denied'));
    else cb(null, '');
  };
  const svc = createComponentsService(env.deps);
  await svc.install({ id: 'toy', version: '1.0.0' });
  const started = await svc.start('toy');
  assert.equal(started.ok, true);

  const stopped = await svc.stop('toy');
  assert.equal(stopped.ok, false);
  assert.equal(stopped.error, 'stop-failed');

  const upd = await svc.update('toy');
  assert.equal(upd.ok, false);
  assert.equal(upd.error, 'stop-failed');
  assert.equal(store.loadRegistry(env.root).components.toy.version, '1.0.0');

  const uninst = await svc.uninstall('toy');
  assert.equal(uninst.ok, false);
  assert.equal(uninst.error, 'stop-failed');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '1.0.0')), true);

  env.alive.delete(started.pid);
});

test('update preserves oldPrevious and returns ok:false when new version fails to start', async (t) => {
  const env = fakeEnv(t);
  for (const v of ['1.0.0', '2.0.0', '3.0.0']) {
    makeSample(env.samplesRoot, 'toy', v);
  }
  const svc = createComponentsService(env.deps);
  await svc.install({ id: 'toy', version: '1.0.0' });
  const reg = store.loadRegistry(env.root);
  reg.components.toy.previous = '0.9.0';
  store.saveRegistry(env.root, reg);
  fs.mkdirSync(store.versionDir(env.root, 'toy', '0.9.0'), { recursive: true });

  const svc2 = createComponentsService(env.deps);
  await svc2.start('toy');
  const origSpawn = env.deps.spawn;
  env.deps.spawn = (bin, args, opts) => {
    if (String(args[0]).includes('3.0.0')) {
      const child = new EventEmitter();
      child.pid = 7777;
      child.stdout = null;
      child.stderr = null;
      child.unref = () => {};
      child.kill = () => true;
      Object.defineProperty(child, 'exitCode', { get: () => 1 });
      setImmediate(() => child.emit('exit', 1));
      return child;
    }
    return origSpawn(bin, args, opts);
  };

  const upd = await svc2.update('toy');
  assert.equal(upd.ok, false);
  assert.equal(upd.state, 'error');
  assert.equal(fs.existsSync(store.versionDir(env.root, 'toy', '0.9.0')), true);
});

test('lifecycle.removeDir retries transient EBUSY before succeeding', async (t) => {
  const dir = tmpDir(t, 'dshd-rm-retry-');
  let attempts = 0;
  const fakeFs = {
    promises: {
      rm: async (target, opts) => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        }
        return fs.promises.rm(target, opts);
      },
    },
  };
  const ok = await lifecycle.removeDir(dir, { fs: fakeFs, removeRetryMs: 1000 });
  assert.equal(ok, true);
  assert.equal(attempts, 3);
  assert.equal(fs.existsSync(dir), false);
});

test('ipc-components before-quit waits for stopCompanion before re-invoking app.quit', async (t) => {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const env = fakeEnv(t);
  let resolveStop;
  const stopPromise = new Promise((resolve) => { resolveStop = resolve; });
  let stopCalls = 0;
  let quitCalls = 0;
  const appMock = new EventEmitter();
  appMock.quit = () => { quitCalls += 1; };

  const ipcCompPath = require.resolve('../../main/ipc-components');
  delete require.cache[ipcCompPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return { app: appMock };
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[ipcCompPath];
  });

  const freshIpc = require('../../main/ipc-components');
  freshIpc._configureForTest({
    ...env.deps,
    magpie: {
      id: 'magpie',
      row: () => ({ id: 'magpie' }),
      stopCompanion: () => {
        stopCalls += 1;
        return stopPromise;
      },
    },
  });
  freshIpc.register({
    IPC_ROLES,
    LAUNCHER_ONLY: [IPC_ROLES.LAUNCHER],
    handle() {},
    send() {},
  });

  let prevented = false;
  appMock.emit('before-quit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(stopCalls, 1);
  assert.equal(quitCalls, 0);

  resolveStop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(quitCalls, 1);

  let preventedAgain = false;
  appMock.emit('before-quit', { preventDefault() { preventedAgain = true; } });
  assert.equal(preventedAgain, false);
});

test('start marks component error if process exits during waitForStateFile window', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService({ ...env.deps, stateWaitMs: 300 });
  await svc.install('toy');
  const starting = svc.start('toy');
  await waitFor(() => env.spawned.length === 1);
  // Wait past startGraceMs (30ms) so the process exits inside waitForStateFile, not grace.
  await sleep(60);
  const { child, pid } = env.spawned[0];
  env.alive.delete(pid);
  child.exitCode = 1;
  child.emit('exit', 1);
  const result = await starting;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'early-exit');
  assert.equal(result.state, 'error');
  const row = svc.list().components.find((item) => item.id === 'toy');
  assert.equal(row.state, 'error');
  assert.equal(row.pid, null);
});

test('start resets stale running record before spawn so early exit clears any restart timer across quick retry', async (t) => {
  const env = fakeEnv(t);
  makeSample(env.samplesRoot, 'toy', '1.0.0');
  const svc = createComponentsService({ ...env.deps, restartBaseMs: 30, startGraceMs: 20 });
  await svc.install('toy');

  // Seed stale 'running' state with a dead PID before calling start() directly (no list() reconcile).
  const reg = store.loadRegistry(env.root);
  reg.components.toy.state = 'running';
  reg.components.toy.pid = 99999;
  store.saveRegistry(env.root, reg);

  let failFirst = true;
  const origSpawn = env.deps.spawn;
  env.deps.spawn = (bin, args, options) => {
    if (failFirst) {
      failFirst = false;
      const child = new EventEmitter();
      child.pid = 6200;
      child.stdout = null;
      child.stderr = null;
      child.unref = () => {};
      child.kill = () => true;
      child.exitCode = 1;
      env.spawned.push({ pid: 6200, bin, args, options, child });
      setImmediate(() => child.emit('exit', 1));
      return child;
    }
    return origSpawn(bin, args, options);
  };
  const svc2 = createComponentsService({ ...env.deps, restartBaseMs: 30, startGraceMs: 20 });

  const first = await svc2.start('toy');
  assert.equal(first.ok, false);
  assert.equal(first.state, 'error');

  // Immediately retry and wait past restartBaseMs: no orphan timer from first attempt may spawn a duplicate.
  const second = await svc2.start('toy');
  assert.equal(second.ok, true);
  await sleep(100);
  assert.equal(env.spawned.length, 2, 'no duplicate spawn from stale restart timer');
});

test('ipc-components skips redundant reconcile after refreshCatalog and drops legacy whaleBridge fallback', async (t) => {
  const env = fakeEnv(t);
  let refreshCalls = 0;
  let reconcileCalls = 0;
  const bridge = {
    id: 'magpie',
    refreshCatalog: async () => { refreshCalls += 1; },
    reconcile: async () => { reconcileCalls += 1; },
    row: () => ({ id: 'magpie', state: 'available' }),
  };
  ipcComponents._configureForTest({ ...env.deps, magpie: bridge });
  t.after(() => ipcComponents._configureForTest());
  const channels = new Map();
  ipcComponents.register({
    IPC_ROLES,
    handle: (channel, listener) => channels.set(channel, { listener }),
    send() {},
    onQuitCommit() {},
  });
  const listListener = channels.get('shell:components-list').listener;

  await listListener({}, undefined);
  assert.equal(refreshCalls, 1);
  assert.equal(reconcileCalls, 0, 'first list uses refreshCatalog without redundant reconcile');

  await listListener({}, undefined);
  assert.equal(refreshCalls, 1);
  assert.equal(reconcileCalls, 1, 'subsequent non-refresh list reconciles without refreshCatalog');

  await listListener({}, { refresh: true });
  assert.equal(refreshCalls, 2);
  assert.equal(reconcileCalls, 1, 'explicit refresh skips redundant reconcile');

  // Legacy serviceDeps.whaleBridge is no longer read as a fallback
  const channelsNoMagpie = new Map();
  ipcComponents._configureForTest({ ...env.deps, whaleBridge: bridge });
  ipcComponents.register({
    IPC_ROLES,
    handle: (channel, listener) => channelsNoMagpie.set(channel, { listener }),
    send() {},
    onQuitCommit() {},
  });
  const withoutMagpie = await channelsNoMagpie.get('shell:components-list').listener({});
  assert.equal(withoutMagpie.components.some((c) => c.id === 'magpie'), false);
});
