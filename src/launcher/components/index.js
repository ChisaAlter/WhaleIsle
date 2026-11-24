'use strict';

// Launcher components platform — composition root. Owns the installed
// registry, payload staging/switching, and per-component process supervision
// (bounded backoff restart on unexpected exit). The component op lock is a
// per-id map here — deliberately separate from the DSHD runtime install lock
// so a stuck component can never block download/install/start paths.
const path = require('path');
const store = require('./store');
const registry = require('./registry');
const lifecycle = require('./lifecycle');
const { renameWithRetry } = require('../../shared/fs-safe');

const START_GRACE_MS = 1500;
const START_POLL_MS = 150;
const STOP_GRACE_MS = 4000;
const STATE_WAIT_MS = 4000;
const MAX_RESTARTS = 3;

/** @typedef {{ componentsRoot?: string, userDataDir?: string, samplesRoot?: string, fs?: typeof import('fs'), readFileSync?: typeof import('fs').readFileSync, renameSync?: typeof import('fs').renameSync, platform?: NodeJS.Platform, processKill?: (pid: number, signal?: any) => boolean, execFileSync?: typeof import('child_process').execFileSync, execFile?: typeof import('child_process').execFile, spawn?: typeof import('child_process').spawn, execPath?: string, log?: (message: string) => void, maxRestarts?: number, restartBaseMs?: number, startGraceMs?: number, stateWaitMs?: number }} ComponentsDeps */

/** @param {ComponentsDeps} [deps] */
function createComponentsService(deps = {}) {
  const root = store.componentsRoot(deps);
  const procs = new Map();
  const busy = new Set();
  let generation = 0;

  // Registry cache: loaded once, rewritten by ops; snapshot() must stay a
  // cheap sync read for the shared status contributor.
  const cache = { loaded: false, data: /** @type {{ components: Record<string, any> }} */ ({ components: {} }) };

  function readRegistry() {
    if (!cache.loaded) {
      cache.data = store.loadRegistry(root, deps);
      cache.loaded = true;
    }
    return cache.data;
  }

  function writeRegistry() {
    store.saveRegistry(root, cache.data, deps);
  }

  /** @param {string} id */
  function recordFor(id) {
    return readRegistry().components[id] || null;
  }

  /** @param {string} id */
  function catalogEntry(id) {
    return registry.scanCatalog({ samplesRoot: deps.samplesRoot }, deps)
      .find((/** @type {any} */ row) => row.id === id) || null;
  }

  /**
   * @param {any} onProgress
   * @param {any} payload
   */
  function emit(onProgress, payload) {
    if (typeof onProgress === 'function') {
      try {
        onProgress(payload);
      } catch {
        // progress listeners must never break an op
      }
    }
  }

  /**
   * @param {string} id
   * @param {() => Promise<any>} fn
   */
  function withLock(id, fn) {
    if (busy.has(id)) {
      return Promise.resolve({ ok: false, error: 'busy', id });
    }
    busy.add(id);
    return Promise.resolve()
      .then(fn)
      .finally(() => busy.delete(id));
  }

  // Reconcile persisted 'running' records with reality — a pid written by a
  // previous launcher process survives in the registry and is adopted here;
  // a dead pid marks the component stopped with evidence in lastError.
  function reconcile() {
    const reg = readRegistry();
    let dirty = false;
    for (const rec of Object.values(reg.components)) {
      if (rec.state !== 'running') {
        continue;
      }
      if (procs.has(rec.id)) {
        continue;
      }
      if (lifecycle.isPidAlive(rec.pid, deps)) {
        continue;
      }
      rec.state = 'stopped';
      rec.pid = null;
      rec.url = '';
      rec.lastError = '进程已退出（启动器重启或外部终止）。';
      dirty = true;
    }
    if (dirty) {
      writeRegistry();
    }
  }

  /**
   * @param {any} cat
   * @param {any} rec
   */
  function listRow(cat, rec) {
    const updateAvailable = Boolean(rec && cat && cat.latest
      && registry.compareVersions(cat.latest, rec.version) > 0);
    return {
      id: cat ? cat.id : rec.id,
      name: cat ? cat.name : (rec.name || rec.id),
      version: cat ? cat.latest : rec.version,
      latest: cat ? cat.latest : rec.version,
      installedVersion: rec ? rec.version : '',
      state: rec ? rec.state : 'available',
      description: cat ? cat.description : '',
      source: cat ? cat.source : (rec.source || 'installed'),
      kind: cat ? cat.kind : 'service',
      pid: rec && rec.state === 'running' ? rec.pid : null,
      url: rec && rec.state === 'running' ? rec.url : '',
      previousVersion: rec ? (rec.previous || '') : '',
      updateAvailable,
      orphan: !cat,
      message: rec ? (rec.lastError || '') : '',
    };
  }

  function list() {
    reconcile();
    const catalog = registry.scanCatalog({ samplesRoot: deps.samplesRoot }, deps);
    const reg = readRegistry();
    const seen = new Set();
    const components = [];
    for (const cat of catalog) {
      seen.add(cat.id);
      components.push(listRow(cat, reg.components[cat.id] || null));
    }
    for (const rec of Object.values(reg.components)) {
      if (!seen.has(rec.id)) {
        components.push(listRow(null, rec));
      }
    }
    return { components };
  }

  /** @param {string} id */
  function row(id) {
    return list().components.find((/** @type {any} */ row) => row.id === id) || null;
  }

  // Stage payload → verify staged manifest → swap into versions/<v>. A broken
  // stage never touches the active dir.
  /**
   * @param {string} id
   * @param {any} manifest
   * @param {any} onProgress
   * @param {string} op
   */
  async function stagePayload(id, manifest, onProgress, op) {
    const staging = store.stagingDir(root, id);
    const target = store.versionDir(root, id, manifest.version);
    emit(onProgress, { id, op, phase: 'copy', percent: 30 });
    await lifecycle.removeDir(staging, deps);
    await lifecycle.copyDir(manifest.dir, staging, deps);
    emit(onProgress, { id, op, phase: 'verify', percent: 55 });
    const staged = registry.readManifest(staging, deps);
    if (!staged || staged.id !== manifest.id || staged.version !== manifest.version || !staged.entryFile) {
      await lifecycle.removeDir(staging, deps);
      throw Object.assign(new Error('staged payload failed manifest verification'), { code: 'bad-payload' });
    }
    emit(onProgress, { id, op, phase: 'switch', percent: 75 });
    if (!store.validComponentId(id)) {
      throw Object.assign(new Error('invalid component id'), { code: 'invalid-id' });
    }
    if (!await lifecycle.removeDir(target, deps)) {
      await lifecycle.removeDir(staging, deps);
      throw Object.assign(new Error(`cannot replace ${target}`), { code: 'switch-failed' });
    }
    const fsp = (deps.fs || require('fs')).promises;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try {
      await renameWithRetry(staging, target, { rename: fsp.rename.bind(fsp) });
    } catch (error) {
      await lifecycle.removeDir(staging, deps);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: 'switch-failed' });
    }
    return { dir: target, manifest: staged };
  }

  /**
   * @param {string} id
   * @param {any} rec
   */
  function activePayload(id, rec) {
    const dir = store.versionDir(root, id, rec.version);
    const manifest = registry.readManifest(dir, deps);
    return manifest ? { dir, manifest } : null;
  }

  /**
   * @param {string} id
   * @param {any} child
   * @param {number} gen
   * @param {any} onProgress
   */
  function attachSupervision(id, child, gen, onProgress) {
    /** @type {{ child: any, pid: any, gen: number, expectedExit: boolean, attempts: number, timer: any, spawnError?: any }} */
    const proc = { child, pid: child.pid, gen, expectedExit: false, attempts: 0, timer: null };
    procs.set(id, proc);
    if (typeof child.once === 'function') {
      child.once('error', (/** @type {any} */ error) => {
        proc.spawnError = error;
      });
      child.once('exit', (/** @type {any} */ code) => {
        onChildExit(id, gen, code, onProgress);
      });
    }
    return proc;
  }

  // Unexpected exit while marked running → bounded backoff restart; give up
  // into 'error' after MAX_RESTARTS so a crash-looping component is visible
  // instead of silently respawning forever.
  /**
   * @param {string} id
   * @param {number} gen
   * @param {any} code
   * @param {any} onProgress
   */
  function onChildExit(id, gen, code, onProgress) {
    const proc = procs.get(id);
    if (!proc || proc.gen !== gen || proc.expectedExit) {
      return;
    }
    const rec = recordFor(id);
    if (!rec || rec.state !== 'running') {
      procs.delete(id);
      return;
    }
    const maxRestarts = deps.maxRestarts ?? MAX_RESTARTS;
    if (proc.attempts >= maxRestarts) {
      procs.delete(id);
      rec.state = 'error';
      rec.pid = null;
      rec.url = '';
      rec.lastError = `组件进程反复退出（code ${code ?? '?'}），已达重试上限。`;
      writeRegistry();
      emit(onProgress, { id, op: 'supervise', phase: 'error', percent: 100, message: rec.lastError });
      return;
    }
    proc.attempts += 1;
    const delay = (deps.restartBaseMs ?? 500) * 2 ** (proc.attempts - 1);
    emit(onProgress, { id, op: 'supervise', phase: 'retry', percent: 0, message: `进程退出（code ${code ?? '?'}），${delay}ms 后重启` });
    proc.timer = setTimeout(() => {
      const current = recordFor(id);
      const payload = current && current.state === 'running' ? activePayload(id, current) : null;
      if (!payload) {
        procs.delete(id);
        if (current) {
          current.state = 'error';
          current.lastError = '组件负载缺失，无法重启。';
          writeRegistry();
        }
        return;
      }
      const child = lifecycle.spawnComponent({
        entryFile: payload.manifest.entryFile,
        dir: payload.dir,
        dataDir: store.dataDir(root, id),
        logFile: store.logFile(root, id),
        id,
        version: current.version,
      }, deps);
      const next = attachSupervision(id, child, generation += 1, onProgress);
      next.attempts = proc.attempts;
      current.pid = child.pid || null;
      writeRegistry();
    }, delay);
    if (proc.timer && typeof proc.timer.unref === 'function') {
      proc.timer.unref();
    }
  }

  /**
   * @param {number} pid
   * @param {number} [graceMs]
   */
  async function waitStopped(pid, graceMs = STOP_GRACE_MS) {
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!lifecycle.isPidAlive(pid, deps)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(200, Math.max(0, deadline - Date.now()))));
    }
    return !lifecycle.isPidAlive(pid, deps);
  }

  /**
   * @param {string} id
   * @param {any} onProgress
   * @param {string} op
   */
  async function stopComponent(id, onProgress, op) {
    const rec = recordFor(id);
    if (!rec) {
      return { ok: false, error: 'not-installed', id };
    }
    const proc = procs.get(id);
    const pid = proc?.pid || rec.pid;
    if (rec.state !== 'running' && !proc) {
      return { ok: true, state: rec.state, id };
    }
    emit(onProgress, { id, op, phase: 'stop', percent: 40 });
    if (proc) {
      proc.expectedExit = true;
      if (proc.timer) {
        clearTimeout(proc.timer);
      }
    }
    if (pid) {
      try {
        await lifecycle.killPidTree(pid, { graceMs: 1500 }, deps);
      } catch {
        await waitStopped(pid, STOP_GRACE_MS);
      }
      if (lifecycle.isPidAlive(pid, deps)) {
        if (proc) {
          proc.expectedExit = false;
        }
        rec.lastError = `无法结束组件进程（PID ${pid} 仍在运行），请关闭后重试。`;
        writeRegistry();
        return { ok: false, error: 'stop-failed', state: rec.state, id, pid, message: rec.lastError };
      }
    }
    procs.delete(id);
    rec.state = 'stopped';
    rec.pid = null;
    rec.url = '';
    rec.lastError = '';
    writeRegistry();
    return { ok: true, state: 'stopped', id };
  }

  /**
   * @param {string} id
   * @param {any} onProgress
   * @param {string} [op]
   */
  async function startComponent(id, onProgress, op = 'start') {
    const rec = recordFor(id);
    if (!rec) {
      return { ok: false, error: 'not-installed', id };
    }
    if (rec.state === 'running' && rec.pid && lifecycle.isPidAlive(rec.pid, deps)) {
      return { ok: true, state: 'running', id, pid: rec.pid, url: rec.url };
    }
    const payload = activePayload(id, rec);
    if (!payload) {
      rec.state = 'error';
      rec.lastError = '组件负载缺失（versions 目录被移除或损坏）。';
      writeRegistry();
      return { ok: false, error: 'payload-missing', id, state: 'error' };
    }
    emit(onProgress, { id, op, phase: 'spawn', percent: 40 });
    let child;
    try {
      child = lifecycle.spawnComponent({
        entryFile: payload.manifest.entryFile,
        dir: payload.dir,
        dataDir: store.dataDir(root, id),
        logFile: store.logFile(root, id),
        id,
        version: rec.version,
      }, deps);
    } catch (error) {
      rec.state = 'error';
      rec.lastError = `启动失败：${error instanceof Error ? error.message : String(error)}`;
      writeRegistry();
      emit(onProgress, { id, op, phase: 'error', percent: 100, message: rec.lastError });
      return { ok: false, error: 'spawn-failed', id, state: 'error', message: rec.lastError };
    }
    const gen = generation += 1;
    const proc = attachSupervision(id, child, gen, onProgress);

    // Alive grace: a spawn that dies instantly (bad entry, missing runtime)
    // must not report ok — mirror the desktop runtime's grace verdict.
    const graceDeadline = Date.now() + (deps.startGraceMs ?? START_GRACE_MS);
    while (Date.now() < graceDeadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(START_POLL_MS, Math.max(0, graceDeadline - Date.now()))));
      if (proc.spawnError) {
        procs.delete(id);
        rec.state = 'error';
        rec.lastError = `启动失败：${proc.spawnError.message || proc.spawnError}`;
        writeRegistry();
        emit(onProgress, { id, op, phase: 'error', percent: 100, message: rec.lastError });
        return { ok: false, error: 'spawn-failed', id, state: 'error', message: rec.lastError };
      }
      if (child.exitCode !== null && child.exitCode !== undefined) {
        procs.delete(id);
        rec.state = 'error';
        rec.lastError = `组件进程启动即退出（code ${child.exitCode}）。`;
        writeRegistry();
        emit(onProgress, { id, op, phase: 'error', percent: 100, message: rec.lastError });
        return { ok: false, error: 'early-exit', id, state: 'error', message: rec.lastError };
      }
    }
    emit(onProgress, { id, op, phase: 'wait', percent: 70 });
    const liveState = await lifecycle.waitForStateFile(store.stateFile(root, id), {
      timeoutMs: deps.stateWaitMs ?? STATE_WAIT_MS,
      isDead: () => (child.exitCode !== null && child.exitCode !== undefined) || Boolean(proc.spawnError),
    }, deps);
    rec.state = 'running';
    rec.pid = child.pid || rec.pid;
    rec.url = typeof liveState?.url === 'string' && liveState.url
      ? liveState.url
      : (liveState?.port ? `http://127.0.0.1:${liveState.port}/` : '');
    rec.lastError = '';
    writeRegistry();
    emit(onProgress, { id, op, phase: 'done', percent: 100 });
    return { ok: true, state: 'running', id, pid: rec.pid, url: rec.url };
  }

  /** @param {any} arg */
  function normalizeTarget(arg) {
    if (typeof arg === 'string') {
      return { id: arg.trim(), version: '' };
    }
    if (arg && typeof arg === 'object') {
      return {
        id: typeof arg.id === 'string' ? arg.id.trim() : '',
        version: typeof arg.version === 'string' ? arg.version.trim() : '',
      };
    }
    return { id: '', version: '' };
  }

  /**
   * @param {any} arg
   * @param {any} onProgress
   */
  function install(arg, onProgress) {
    const target = normalizeTarget(arg);
    if (!store.validComponentId(target.id)) {
      return Promise.resolve({ ok: false, error: 'invalid-id', id: target.id });
    }
    const id = target.id;
    return withLock(id, async () => {
      if (recordFor(id)) {
        return { ok: false, error: 'already-installed', id };
      }
      const cat = catalogEntry(id);
      if (!cat) {
        return { ok: false, error: 'unknown-component', id };
      }
      const picked = registry.resolveCatalogVersion(cat, target.version);
      if (!picked) {
        return { ok: false, error: 'unknown-version', id, version: target.version };
      }
      try {
        const staged = await stagePayload(id, picked, onProgress, 'install');
        const fsp = (deps.fs || require('fs')).promises;
        await fsp.mkdir(store.dataDir(root, id), { recursive: true });
        const now = new Date().toISOString();
        readRegistry().components[id] = {
          id,
          name: cat.name,
          version: picked.version,
          previous: null,
          state: 'installed',
          pid: null,
          url: '',
          source: picked.source,
          installedAt: now,
          updatedAt: now,
          lastError: '',
        };
        writeRegistry();
        emit(onProgress, { id, op: 'install', phase: 'done', percent: 100 });
        return { ok: true, component: row(id) };
      } catch (error) {
        const err = /** @type {any} */ (error);
        emit(onProgress, { id, op: 'install', phase: 'error', percent: 100, message: err.message });
        return { ok: false, error: err.code || 'install-failed', id, message: err.message };
      }
    });
  }

  /**
   * @param {any} id
   * @param {any} onProgress
   */
  function start(id, onProgress) {
    id = typeof id === 'string' ? id.trim() : '';
    return withLock(id, () => startComponent(id, onProgress));
  }

  /**
   * @param {any} id
   * @param {any} onProgress
   */
  function stop(id, onProgress) {
    id = typeof id === 'string' ? id.trim() : '';
    return withLock(id, () => stopComponent(id, onProgress, 'stop')
      .then((result) => {
        emit(onProgress, {
          id,
          op: 'stop',
          phase: result.ok ? 'done' : 'error',
          percent: 100,
          message: result.ok ? '' : (result.error || ''),
        });
        return result;
      }));
  }

  /**
   * @param {any} id
   * @param {any} onProgress
   */
  function update(id, onProgress) {
    id = typeof id === 'string' ? id.trim() : '';
    return withLock(id, async () => {
      const rec = recordFor(id);
      if (!rec) {
        return { ok: false, error: 'not-installed', id };
      }
      const cat = catalogEntry(id);
      const latest = cat ? registry.resolveCatalogVersion(cat) : null;
      if (!latest) {
        return { ok: false, error: 'unknown-component', id };
      }
      const from = rec.version;
      if (registry.compareVersions(latest.version, from) <= 0) {
        return { ok: false, error: 'no-newer-version', id, from, to: from };
      }
      const wasRunning = rec.state === 'running' && rec.pid && lifecycle.isPidAlive(rec.pid, deps);
      if (wasRunning) {
        emit(onProgress, { id, op: 'update', phase: 'stop', percent: 10 });
        const stopped = await stopComponent(id, onProgress, 'update');
        if (!stopped.ok) {
          emit(onProgress, { id, op: 'update', phase: 'error', percent: 100, message: stopped.message });
          return { ok: false, error: stopped.error || 'stop-failed', id, from, to: from, message: stopped.message };
        }
      }
      try {
        await stagePayload(id, latest, onProgress, 'update');
      } catch (error) {
        const err = /** @type {any} */ (error);
        emit(onProgress, { id, op: 'update', phase: 'error', percent: 100, message: err.message });
        return { ok: false, error: err.code || 'update-failed', id, from, to: from, message: err.message };
      }
      // Keep exactly one rollback payload: the superseded previous dir goes
      // only after the new version starts cleanly (when it was running).
      const oldPrevious = rec.previous;
      rec.previous = from;
      rec.version = latest.version;
      rec.name = cat.name;
      rec.state = 'installed';
      rec.pid = null;
      rec.url = '';
      rec.lastError = '';
      rec.updatedAt = new Date().toISOString();
      writeRegistry();
      if (wasRunning) {
        const restarted = await startComponent(id, onProgress, 'update');
        if (!restarted.ok) {
          emit(onProgress, { id, op: 'update', phase: 'error', percent: 100, message: restarted.message });
          return { ok: false, error: restarted.error || 'start-failed', from, to: latest.version, id, state: 'error', message: restarted.message };
        }
      }
      if (oldPrevious && oldPrevious !== rec.previous && oldPrevious !== rec.version) {
        await lifecycle.removeDir(store.versionDir(root, id, oldPrevious), deps);
      }
      emit(onProgress, { id, op: 'update', phase: 'done', percent: 100 });
      return { ok: true, from, to: latest.version, id };
    });
  }

  /**
   * @param {any} id
   * @param {any} onProgress
   */
  function rollback(id, onProgress) {
    id = typeof id === 'string' ? id.trim() : '';
    return withLock(id, async () => {
      const rec = recordFor(id);
      if (!rec) {
        return { ok: false, error: 'not-installed', id };
      }
      if (!rec.previous) {
        return { ok: false, error: 'nothing-to-rollback', id, to: rec.version };
      }
      const target = rec.previous;
      const fsp = deps.fs || require('fs');
      try {
        if (!fsp.statSync(store.versionDir(root, id, target)).isDirectory()) {
          return { ok: false, error: 'rollback-payload-missing', id, to: rec.version };
        }
      } catch {
        return { ok: false, error: 'rollback-payload-missing', id, to: rec.version };
      }
      const wasRunning = rec.state === 'running' && rec.pid && lifecycle.isPidAlive(rec.pid, deps);
      if (wasRunning) {
        emit(onProgress, { id, op: 'rollback', phase: 'stop', percent: 15 });
        const stopped = await stopComponent(id, onProgress, 'rollback');
        if (!stopped.ok) {
          emit(onProgress, { id, op: 'rollback', phase: 'error', percent: 100, message: stopped.message });
          return { ok: false, error: stopped.error || 'stop-failed', id, to: rec.version, message: stopped.message };
        }
      }
      emit(onProgress, { id, op: 'rollback', phase: 'switch', percent: 60 });
      // After rollback the rolled-forward version becomes the previous one —
      // the user can redo the update without re-staging.
      rec.previous = rec.version;
      rec.version = target;
      rec.state = 'installed';
      rec.pid = null;
      rec.url = '';
      rec.lastError = '';
      rec.updatedAt = new Date().toISOString();
      writeRegistry();
      if (wasRunning) {
        const restarted = await startComponent(id, onProgress, 'rollback');
        if (!restarted.ok) {
          emit(onProgress, { id, op: 'rollback', phase: 'error', percent: 100, message: restarted.message });
          return { ok: false, error: restarted.error || 'start-failed', to: target, id, state: 'error', message: restarted.message };
        }
      }
      emit(onProgress, { id, op: 'rollback', phase: 'done', percent: 100 });
      return { ok: true, to: target, id };
    });
  }

  /**
   * @param {any} id
   * @param {any} onProgress
   */
  function uninstall(id, onProgress) {
    id = typeof id === 'string' ? id.trim() : '';
    return withLock(id, async () => {
      const rec = recordFor(id);
      if (!rec) {
        return { ok: false, error: 'not-installed', id };
      }
      if (rec.state === 'running' || procs.has(id)) {
        emit(onProgress, { id, op: 'uninstall', phase: 'stop', percent: 20 });
        const stopped = await stopComponent(id, onProgress, 'uninstall');
        if (!stopped.ok) {
          emit(onProgress, { id, op: 'uninstall', phase: 'error', percent: 100, message: stopped.message });
          return { ok: false, error: stopped.error || 'stop-failed', id, message: stopped.message };
        }
      }
      emit(onProgress, { id, op: 'uninstall', phase: 'remove', percent: 60 });
      await lifecycle.removeDir(store.versionsDir(root, id), deps);
      // Per feature card the data dir is the user's choice surface; v1 keeps
      // <id>/data/ (notes/state/logs) so uninstall never destroys user data.
      delete readRegistry().components[id];
      writeRegistry();
      emit(onProgress, { id, op: 'uninstall', phase: 'done', percent: 100 });
      return { ok: true, id };
    });
  }

  function snapshot() {
    const reg = readRegistry();
    return Object.values(reg.components)
      .map((rec) => ({ id: rec.id, state: rec.state, version: rec.version }));
  }

  // Quit path (before-quit): synchronous tree kill of every component this
  // process still supervises or has recorded running. Never async here.
  function shutdown() {
    const reg = readRegistry();
    for (const rec of Object.values(reg.components)) {
      const proc = procs.get(rec.id);
      if (proc) {
        proc.expectedExit = true;
        if (proc.timer) {
          clearTimeout(proc.timer);
        }
      }
      if (rec.state === 'running' && rec.pid) {
        lifecycle.killPid(rec.pid, { force: true }, deps);
        rec.state = 'stopped';
        rec.pid = null;
        rec.url = '';
      }
    }
    procs.clear();
    try {
      writeRegistry();
    } catch {
      // quitting — never block app exit
    }
  }

  return {
    list,
    install,
    start,
    stop,
    update,
    rollback,
    uninstall,
    snapshot,
    shutdown,
    // Test/introspection seam — not part of the IPC contract.
    _internals: { procs, readRegistry, reconcile },
  };
}

module.exports = { createComponentsService };
