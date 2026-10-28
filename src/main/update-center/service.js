'use strict';

// The single owner of update state and of the one download/install job
// (docs/features/update-center.md). The launcher, desktop settings, tray and
// the update center overlay render `snapshot()` and send `command()` here.
// Every network, file and installer effect is injected so the state machine
// runs under `node --test`.

const fs = require('fs');
const path = require('path');

const STATE_FILE = 'update-center.json';
const AUTO_FIRST_CHECK_MS = 60_000;
const AUTO_INTERVAL_MS = 6 * 60 * 60_000;
const AUTO_RETRY_MS = 15 * 60_000;
// Delta only pays off when it saves a real share of the full download.
const DELTA_WORTH_RATIO = 0.8;
const PERSIST_INTERVAL_MS = 2000;
const DELTA_INSTALLER_ARGS = ['--updated', '/S', '--force-run'];

const BUSY = new Set(['checking', 'downloading', 'verifying', 'installing']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH',
  'EHOSTUNREACH', 'ENOTFOUND', 'ERR_PROXY_TUNNEL', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);

function isNetworkError(error) {
  const code = error?.code || error?.cause?.code;
  if (NETWORK_CODES.has(code) || /^HTTP_ERROR_5\d\d$/.test(String(code || ''))) return true;
  return /超时|中断|timed? ?out|ECONN|ENOTFOUND|net::ERR_|fetch failed|socket/i.test(String(error?.message || ''));
}

function safeName(name) {
  return path.basename(String(name || 'Whale-Isle-Setup.exe')).replace(/[^\w.\-]+/g, '_');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return -1; }
}

/** Release summary (release-source) → the fields a job needs. */
function toTarget(release, route) {
  return {
    version: release.version,
    tag: release.tag || `v${release.version}`,
    route,
    publishedAt: release.publishedAt || '',
    notes: release.notes || '',
    htmlUrl: release.htmlUrl || '',
    assetName: release.assetName || '',
    assetUrl: release.assetUrl || '',
    assetSize: Number(release.assetSize) || 0,
    checksumUrl: release.checksumUrl || '',
    blockmapUrl: release.blockmapUrl || '',
    updaterMetadataUrl: release.updaterMetadataUrl || '',
  };
}

function sameArtifact(a, b) {
  return Boolean(a && b && a.version === b.version && a.assetName === b.assetName);
}

function createUpdateCenter(deps) {
  const {
    userDataDir,
    currentVersion,
    routes = [],
    getRoute,
    isRouteExplicit = () => false,
    saveRoute = () => {},
    getAutoDownload = () => true,
    saveAutoDownload = () => {},
    resolveRelease,
    planDelta = async () => ({ ok: false, reason: 'unsupported' }),
    readChecksum,
    downloadFile,
    verifyFile,
    downloadDelta = async () => ({ ok: false, reason: 'unsupported' }),
    install,
    compareVersions,
    platform = process.platform,
    now = () => Date.now(),
    timers = { setTimeout, clearTimeout },
    log = () => {},
  } = deps;
  const updatesDir = path.join(userDataDir, 'updates');
  const stateFile = path.join(userDataDir, STATE_FILE);
  const listeners = new Set();

  // Durable: target, plan and the job (resume state or a verified installer).
  let saved = { version: 1, target: null, plan: null, job: null };
  // Live: what the UI renders.
  const model = { phase: 'idle', checkedAt: 0, progress: null, error: null, explicit: false };
  let controller = null;
  let abortReason = null;
  let running = null;
  let lastPersist = 0;
  let autoTimer = null;

  function snapshot() {
    const target = saved.target;
    return {
      phase: model.phase,
      current: currentVersion(),
      checkedAt: model.checkedAt,
      route: getRoute(),
      routeExplicit: isRouteExplicit(),
      routes,
      autoDownload: getAutoDownload(),
      target: target ? {
        version: target.version, tag: target.tag, route: target.route, publishedAt: target.publishedAt,
        notes: target.notes, htmlUrl: target.htmlUrl,
      } : null,
      plan: saved.plan ? { ...saved.plan } : null,
      progress: model.progress ? { ...model.progress } : null,
      error: model.error ? { ...model.error } : null,
      explicit: model.explicit,
      userPaused: Boolean(saved.job?.userPaused),
      platform,
    };
  }

  function emit() {
    const view = snapshot();
    for (const listener of listeners) {
      try { listener(view); } catch (error) { log(`update-center listener failed: ${error.message}`); }
    }
  }

  function set(patch) {
    Object.assign(model, patch);
    emit();
  }

  function persist(force = true) {
    if (!force && now() - lastPersist < PERSIST_INTERVAL_MS) return;
    lastPersist = now();
    try { writeJsonAtomic(stateFile, saved); } catch (error) { log(`update-center persist failed: ${error.message}`); }
  }

  function paths(target) {
    const final = path.join(updatesDir, safeName(target.assetName));
    return { final, partial: `${final}.part` };
  }

  /** Only the current job's files stay; earlier installers are removed. */
  function cleanup() {
    if (BUSY.has(model.phase)) return;
    const keep = new Set();
    if (saved.target) {
      const { final, partial } = paths(saved.target);
      keep.add(final);
      keep.add(partial);
    }
    if (saved.job?.ready?.file) keep.add(saved.job.ready.file);
    let names = [];
    try { names = fs.readdirSync(updatesDir); } catch { return; }
    for (const name of names) {
      const file = path.join(updatesDir, name);
      if (keep.has(file) || !/\.(exe|dmg|part)$/i.test(name)) continue;
      try { fs.rmSync(file, { force: true }); log(`update-center removed ${name}`); } catch { /* in use */ }
    }
  }

  function discardJob() {
    if (saved.target) {
      const { final, partial } = paths(saved.target);
      for (const file of [partial, final]) fs.rmSync(file, { force: true });
    }
    saved.job = null;
  }

  function fail(operation, error, extra = {}) {
    const route = extra.route || getRoute();
    const network = isNetworkError(error);
    const other = routes.map((row) => row.id).find((id) => id !== route);
    set({
      phase: 'error',
      progress: operation === 'download' ? model.progress : null,
      error: {
        operation,
        message: error?.message || String(error),
        code: error?.code || '',
        network,
        suggestRoute: network && other ? other : '',
        canResume: operation === 'download' && Boolean(saved.job?.resume?.total),
      },
    });
    persist();
    if (!model.explicit) scheduleAuto(AUTO_RETRY_MS);
    return snapshot();
  }

  async function makePlan(target) {
    const full = { method: 'full', downloadBytes: target.assetSize, fullBytes: target.assetSize };
    if (platform !== 'win32' || !target.blockmapUrl || !target.updaterMetadataUrl) return full;
    try {
      const delta = await planDelta(target);
      if (delta?.ok && target.assetSize > 0 && delta.downloadBytes < target.assetSize * DELTA_WORTH_RATIO) {
        return { method: 'delta', downloadBytes: delta.downloadBytes, fullBytes: target.assetSize };
      }
      log(`update-center delta not used: ${delta?.ok ? `saves too little (${delta.downloadBytes}/${target.assetSize})` : delta?.reason || 'unavailable'}`);
    } catch (error) {
      log(`update-center delta plan failed: ${error.message}`);
    }
    return full;
  }

  async function resolveWithFallback(tag) {
    const route = getRoute();
    try {
      return { release: await resolveRelease(route, tag), route };
    } catch (error) {
      const other = routes.map((row) => row.id).find((id) => id !== route);
      // A route the user picked stays picked; the default may fall back once.
      if (isRouteExplicit() || !other || !isNetworkError(error)) throw Object.assign(error, { route });
      log(`update-center ${route} unreachable (${error.message}); trying ${other}`);
      return { release: await resolveRelease(other, tag), route: other };
    }
  }

  async function check({ manual = false } = {}) {
    if (BUSY.has(model.phase)) return snapshot();
    set({ phase: 'checking', error: null, explicit: manual });
    let resolved;
    try {
      resolved = await resolveWithFallback(null);
    } catch (error) {
      return fail('check', error, { route: error.route });
    }
    model.checkedAt = now();
    const { release, route } = resolved;
    if (!release?.version || compareVersions(release.version, currentVersion()) <= 0) {
      discardJob();
      saved.target = null;
      saved.plan = null;
      persist();
      set({ phase: 'current', progress: null });
      cleanup();
      return snapshot();
    }
    const target = toTarget(release, route);
    if (!target.assetUrl || !target.checksumUrl) {
      return fail('check', Object.assign(new Error(`v${target.version} 没有适用于本机的安装包`), { code: 'no-installer' }), { route });
    }
    if (!sameArtifact(saved.target, target)) {
      discardJob();
      saved.plan = null;
    }
    saved.target = target;
    if (saved.job?.ready && fileSize(saved.job.ready.file) > 0) {
      persist();
      set({ phase: 'ready', progress: null });
      cleanup();
      return snapshot();
    }
    if (!saved.plan) saved.plan = await makePlan(target);
    persist();
    const { partial } = paths(target);
    const resumable = saved.job?.resume?.total > 0 && fileSize(partial) > 0;
    set({
      phase: resumable ? 'paused' : 'available',
      progress: resumable ? { received: fileSize(partial), total: saved.job.resume.total } : null,
    });
    cleanup();
    // A download the user paused stays paused until they resume it.
    if (getAutoDownload() && !saved.job?.userPaused) startDownload({ explicit: manual });
    return snapshot();
  }

  function onProgress(resumedFrom) {
    return (payload = {}) => {
      if (payload.phase === 'resolve') return;
      const received = Number(payload.received) || 0;
      const total = Number(payload.total) || saved.plan?.downloadBytes || 0;
      const speed = Number(payload.bytesPerSecond) || 0;
      model.progress = {
        received,
        total,
        bytesPerSecond: speed,
        etaSeconds: speed > 0 && total > received ? Math.round((total - received) / speed) : null,
        resumedFrom,
        retrying: payload.retrying === true ? { attempt: payload.attempt, maxAttempts: payload.maxAttempts } : null,
      };
      emit();
      if (saved.job?.resume) persist(false);
    };
  }

  async function runFull(target, signal) {
    const expected = await readChecksum(target.assetName, target.checksumUrl, { signal });
    const { final, partial } = paths(target);
    fs.mkdirSync(updatesDir, { recursive: true });
    if (fileSize(final) > 0) {
      try {
        await verifyFile(final, expected, { signal });
        return { file: final, expected, installerArgs: [] };
      } catch (error) {
        if (signal.aborted) throw error;
        fs.rmSync(final, { force: true });
      }
    }
    let resume = saved.job?.method === 'full' && saved.job.expected === expected ? saved.job.resume : null;
    const onDisk = fileSize(partial);
    if (resume && resume.total > 0 && onDisk > 0 && onDisk < resume.total) {
      resume.offset = onDisk;
      // Another host serves the same bytes under different validators; the
      // final SHA512 decides, so resume without If-Range across routes.
      if (resume.route !== target.route) resume.validator = null;
    } else {
      fs.rmSync(partial, { force: true });
      resume = { offset: 0, total: 0, validator: null };
    }
    resume.route = target.route;
    saved.job = { method: 'full', expected, resume };
    persist();
    await downloadFile(target.assetUrl, partial, onProgress(resume.offset), {
      resume: true, resumeState: resume, keepPartial: true, signal,
    });
    set({ phase: 'verifying' });
    await verifyFile(partial, expected, { signal });
    fs.renameSync(partial, final);
    return { file: final, expected, installerArgs: [] };
  }

  async function runDelta(target, signal) {
    const outcome = await downloadDelta(target, onProgress(0), { signal });
    if (signal.aborted) throw Object.assign(new Error('下载已取消'), { name: 'AbortError' });
    if (!outcome?.ok) {
      throw Object.assign(new Error(outcome?.message || '增量下载未完成'), { code: outcome?.reason || 'delta-failed' });
    }
    const expected = await readChecksum(target.assetName, target.checksumUrl, { signal });
    set({ phase: 'verifying' });
    await verifyFile(outcome.installer, expected, { signal });
    return { file: outcome.installer, expected, installerArgs: DELTA_INSTALLER_ARGS };
  }

  function startDownload({ full = false, explicit = true, installWhenReady = false } = {}) {
    if (BUSY.has(model.phase) || !saved.target) return snapshot();
    const target = saved.target;
    if (saved.job) saved.job.userPaused = false;
    controller = new AbortController();
    abortReason = null;
    const { signal } = controller;
    set({ phase: 'downloading', error: null, explicit });
    running = (async () => {
      let method = full ? 'full' : saved.plan?.method || 'full';
      try {
        let ready;
        if (method === 'delta') {
          try {
            ready = await runDelta(target, signal);
          } catch (error) {
            if (signal.aborted) throw error;
            // Delta is an optimisation; its failure never needs a user decision.
            log(`update-center delta failed (${error.code || ''} ${error.message}); continuing with the full installer`);
            method = 'full';
            saved.plan = { method: 'full', downloadBytes: target.assetSize, fullBytes: target.assetSize };
            set({ phase: 'downloading', progress: null });
            ready = await runFull(target, signal);
          }
        } else {
          ready = await runFull(target, signal);
        }
        saved.job = { method, expected: ready.expected, ready };
        persist();
        set({ phase: 'ready', progress: null });
        cleanup();
        if (installWhenReady) await installNow();
      } catch (error) {
        if (signal.aborted && abortReason === 'pause') {
          if (saved.job) saved.job.userPaused = true;
          persist();
          set({ phase: 'paused' });
        } else if (signal.aborted) {
          discardJob();
          persist();
          set({ phase: 'available', progress: null });
        } else {
          fail('download', error, { route: target.route });
        }
      } finally {
        controller = null;
        running = null;
      }
    })();
    return snapshot();
  }

  async function stopActive(reason) {
    if (!controller) return;
    abortReason = reason;
    controller.abort();
    await running?.catch(() => {});
  }

  async function installNow() {
    if (model.phase !== 'ready' || !saved.job?.ready) return snapshot();
    const { file, expected, installerArgs } = saved.job.ready;
    set({ phase: 'verifying', error: null });
    try {
      await verifyFile(file, expected, {});
    } catch (error) {
      discardJob();
      persist();
      return fail('install', error);
    }
    set({ phase: 'installing' });
    try {
      const result = await install(saved.target, file, { installerArgs });
      if (result?.launched) return snapshot();
      if (result?.manualInstall) {
        set({ phase: 'ready', error: { operation: 'install', message: result.message || '', manual: true } });
        return snapshot();
      }
      return fail('install', Object.assign(new Error(result?.message || result?.code || '安装未启动'), { code: result?.code }));
    } catch (error) {
      return fail('install', error);
    }
  }

  async function installVersion(tag) {
    if (BUSY.has(model.phase)) return snapshot();
    set({ phase: 'checking', error: null, explicit: true });
    let resolved;
    try {
      resolved = await resolveWithFallback(String(tag || ''));
    } catch (error) {
      return fail('check', error, { route: error.route });
    }
    if (!resolved.release?.assetUrl) return fail('check', new Error(`版本 ${tag} 没有适用于本机的安装包`));
    const target = toTarget(resolved.release, resolved.route);
    if (!sameArtifact(saved.target, target)) discardJob();
    saved.target = target;
    saved.plan = { method: 'full', downloadBytes: target.assetSize, fullBytes: target.assetSize };
    persist();
    model.phase = 'available';
    return startDownload({ full: true, explicit: true, installWhenReady: true });
  }

  function scheduleAuto(delay) {
    if (autoTimer) timers.clearTimeout(autoTimer);
    autoTimer = timers.setTimeout(async () => {
      autoTimer = null;
      if (!BUSY.has(model.phase)) await check({ manual: false }).catch(() => {});
      if (!autoTimer) scheduleAuto(AUTO_INTERVAL_MS);
    }, delay);
    autoTimer?.unref?.();
  }

  function restore() {
    const loaded = readJson(stateFile);
    if (loaded?.version === 1 && loaded.target?.version
        && compareVersions(loaded.target.version, currentVersion()) > 0) {
      saved = { version: 1, target: loaded.target, plan: loaded.plan || null, job: loaded.job || null };
      const { partial } = paths(saved.target);
      if (saved.job?.ready && fileSize(saved.job.ready.file) > 0) model.phase = 'ready';
      else if (saved.job?.resume?.total > 0 && fileSize(partial) > 0) {
        model.phase = 'paused';
        model.progress = { received: fileSize(partial), total: saved.job.resume.total };
      } else {
        saved.job = null;
        model.phase = 'available';
      }
    } else {
      saved = { version: 1, target: null, plan: null, job: null };
      persist();
    }
    cleanup();
  }

  const commands = {
    check: () => check({ manual: true }),
    download: () => startDownload({ explicit: true }),
    downloadFull: async () => {
      await stopActive('cancel');
      if (model.phase === 'error' || model.phase === 'paused') model.phase = 'available';
      return startDownload({ full: true, explicit: true });
    },
    pause: async () => { await stopActive('pause'); return snapshot(); },
    resume: () => {
      if (model.phase === 'error' || model.phase === 'paused') model.phase = 'available';
      return startDownload({ explicit: true });
    },
    cancel: async () => {
      if (controller) await stopActive('cancel');
      else if (['paused', 'ready', 'error'].includes(model.phase)) {
        discardJob();
        persist();
        set({ phase: saved.target ? 'available' : 'idle', progress: null, error: null });
      }
      return snapshot();
    },
    install: () => installNow(),
    installVersion: (tag) => installVersion(tag),
    setRoute: async (route) => {
      if (!routes.some((row) => row.id === route)) throw new Error(`unknown route ${route}`);
      const wasDownloading = Boolean(controller);
      if (wasDownloading) await stopActive('pause');
      await saveRoute(route);
      if (saved.job) saved.job.userPaused = !wasDownloading && Boolean(saved.job.userPaused);
      if (model.phase === 'paused' || model.phase === 'error') model.phase = 'available';
      return check({ manual: true });
    },
    setAutoDownload: async (enabled) => {
      await saveAutoDownload(enabled === true);
      if (enabled === true && model.phase === 'available') return startDownload({ explicit: false });
      emit();
      return snapshot();
    },
  };

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async command(action, arg) {
      const run = Object.prototype.hasOwnProperty.call(commands, action) ? commands[action] : null;
      if (typeof run !== 'function') throw new Error(`unknown update command ${action}`);
      return run(arg);
    },
    /** Restore the persisted job and start the background schedule. */
    start({ firstCheckMs = AUTO_FIRST_CHECK_MS } = {}) {
      restore();
      emit();
      scheduleAuto(firstCheckMs);
    },
    stop() {
      if (autoTimer) timers.clearTimeout(autoTimer);
      autoTimer = null;
      return stopActive('pause');
    },
    // Tests.
    _internals: { paths, isNetworkError, DELTA_WORTH_RATIO },
  };
}

module.exports = { createUpdateCenter, isNetworkError, STATE_FILE, AUTO_INTERVAL_MS, AUTO_FIRST_CHECK_MS };
