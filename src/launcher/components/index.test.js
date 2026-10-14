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

const SAMPLE_FIXTURES = path.resolve(__dirname, '..', '..', '..', 'tests', 'fixtures', 'components');

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

// Fake child_process seam: an EventEmitter child + win32 tasklist/taskkill
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
    execFileSync: (bin, args) => {
      const text = args.join(' ');
      if (bin === 'tasklist') {
        const match = /PID eq (\d+)/.exec(text);
        const pid = match ? Number(match[1]) : 0;
        return alive.has(pid) ? `"node.exe","${pid}","Console","1","10 K"` : 'INFO: no tasks';
      }
      if (bin === 'taskkill') {
        const match = /\/PID\s+(\d+)/i.exec(text);
        const pid = match ? Number(match[1]) : 0;
        killed.push({ pid, args: args.slice() });
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
      return '';
    },
  };
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
  assert.ok(env.killed.some((row) => row.pid === started.pid && !row.args.includes('/F')),
    'graceful taskkill attempted first');
  const kill = env.killed.find((row) => row.pid === started.pid && row.args.includes('/F'));
  assert.ok(kill, 'a refused graceful kill must escalate to force');
  assert.ok(kill.args.includes('/T') && kill.args.includes('/F'), 'tree kill must be forced');
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
    IPC_ROLES: { LAUNCHER: 'launcher' },
    handle: (channel, roles, listener) => {
      channels.set(channel, { roles, listener });
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
  ];
  for (const name of expected) {
    assert.ok(channels.has(name), `missing channel ${name}`);
    assert.deepEqual(channels.get(name).roles, ['launcher']);
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
