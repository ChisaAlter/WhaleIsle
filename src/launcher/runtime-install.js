'use strict';

// Managed-runtime install layer: resolves a release through the selected
// download route, runs the verified download→install pipeline, then waits for
// the desktop registration to settle — without quitting the launcher. The
// slim package is the primary consumer, but the dev full package exercises
// the same path via DSHD_LAUNCHER_PACKAGE=1 (shared userData).
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { app } = require('electron');
const update = require('../main/update');
const { loadConfig } = require('../main/config');
const installDetect = require('./install-detect');
const releaseSource = require('./release-source');
const forensicsLog = require('./forensics-log');
const { isLauncherPackage, runtimeTarget, desktopStateDir } = require('./product');
const peerClient = require('./task-control-client');

const INSTALL_WAIT_MS = 8 * 60_000;
const INSTALL_POLL_MS = 2500;
const INSTALLED_CACHE_MS = 3000;

/** Strip a leading `v` so registry/tag/exe version strings compare equal. */
function normalizeVersionString(v) {
  return String(v || '').trim().replace(/^v/i, '');
}

let installedCache = { at: 0, value: null };

function resolveInstalledInfo(deps = {}) {
  return typeof deps.installedInfo === 'function' ? deps.installedInfo : installedInfo;
}

function installedInfo({ fresh = false, deps = {} } = {}) {
  if (typeof deps.installedInfo === 'function') {
    return deps.installedInfo({ fresh });
  }
  const now = Date.now();
  if (!fresh && installedCache.value && now - installedCache.at < INSTALLED_CACHE_MS) {
    return installedCache.value;
  }
  const value = installDetect.getInstalledAppInfo({ target: runtimeTarget() });
  installedCache = { at: now, value };
  return value;
}

function invalidateInstalledCache() {
  installedCache = { at: 0, value: null };
}

function configuredRoute(deps = {}) {
  try {
    const config = typeof deps.loadConfig === 'function' ? deps.loadConfig() : loadConfig();
    // No explicit pick yet → behave as if GitHub were selected, matching the
    // prototype's default-checked line card and the seg control.
    return releaseSource.normalizeRoute(config.downloadRoute) || 'github';
  } catch {
    return 'github';
  }
}

function isLauncherPackageNow(deps = {}) {
  return typeof deps.isLauncherPackage === 'function'
    ? deps.isLauncherPackage()
    : isLauncherPackage();
}

function isPackagedNow(deps = {}) {
  if (deps.isPackaged !== undefined) {
    return Boolean(deps.isPackaged);
  }
  try {
    return Boolean(app.isPackaged);
  } catch {
    return false;
  }
}

function runtimeTargetName(deps = {}) {
  const target = deps.target !== undefined ? deps.target : runtimeTarget();
  return (target || installDetect.DESKTOP_TARGET).productName;
}

function runtimeExePath(info, deps = {}) {
  const exists = typeof deps.existsSync === 'function' ? deps.existsSync : fs.existsSync;
  return installDetect
    .desktopExeCandidates(info?.installPath, runtimeTargetName(deps))
    .find((candidate) => exists(candidate)) || '';
}

function runtimeExeStamp(info, deps = {}) {
  const exe = runtimeExePath(info, deps);
  if (!exe) {
    return 0;
  }
  const statSync = typeof deps.statSync === 'function' ? deps.statSync : fs.statSync;
  try {
    return statSync(exe).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Wait for the installer to finish and the desktop registration to settle.
 * NSIS re-launches elevated under UAC so the spawned child can exit long
 * before the install completes — completion is detected by the registry
 * record plus a changed/new main exe, not by the child alone.
 */
/**
 * `childDone` is the lifecycle record populated by the installer-launch
 * callback (attached at launch time so no already-emitted event is missed).
 * It is passed in rather than subscribed here because the initial child may
 * have exited before installFromAsset resolves.
 */
function waitForInstall(child, baseline, signal, onProgress, deps = {}, targetVersion = '', childDone) {
  const waitMs = deps.waitMs || INSTALL_WAIT_MS;
  const pollMs = deps.pollMs || INSTALL_POLL_MS;
  return new Promise((resolve) => {
    // A signal aborted before the wait even begins must not hang the whole
    // polling loop until timeout — surface the cancel immediately.
    if (signal && signal.aborted === true) {
      resolve('aborted');
      return;
    }
    let done = false;
    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(cap);
      clearInterval(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve(value);
    };
    const onAbort = () => finish('aborted');
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    // Lifecycle record. When the caller did not supply one (no child handle
    // was captured at launch), synthesize a "not fired" record — we must not
    // subscribe now or we'd miss events the child already emitted.
    const observeChild = !childDone;
    childDone = childDone || { fired: false, code: null, failed: false };
    if (observeChild && child && typeof child.once === 'function') {
      // Attach only if the launch callback didn't already — attach-once so
      // late subscriptions don't double-handle, and an already-ended child
      // is reflected via its recorded state rather than a fresh listener.
      if (childDone.fired !== true) {
        child.once('exit', (code) => {
          childDone.fired = true;
          childDone.code = typeof code === 'number' ? code : null;
          childDone.failed = code !== 0 && code !== null;
        });
        child.once('error', (error) => {
          childDone.fired = true;
          childDone.failed = true;
          childDone.message = error.message;
        });
      }
    }
    const cap = setTimeout(() => finish('timeout'), waitMs);
    const started = Date.now();
    const timer = setInterval(() => {
      // A failed launch must win over registration left by a partial install.
      if (childDone.failed) { finish('installer-failed'); return; }
      let info = null;
      try {
        info = installedInfo({ fresh: true, deps });
      } catch {
        // keep polling
      }
      const exe = runtimeExePath(info, deps);
      // Both sides are normalized so the registry's "v1.2.3", the tag's
      // "1.2.3", and the exe's file version compare on equal footing;
      // prerelease identity is preserved.
      const observedVersion = typeof info?.version === 'string'
        ? normalizeVersionString(info.version)
        : '';
      // Success requires the observed registry version to match the
      // requested target exactly. A changed timestamp or child exit alone
      // cannot prove completion — a cancelled/failed install or an unrelated
      // repair must not read as success.
      //
      // - Empty target: fail closed. The release contract always resolves a
      //   version; an empty one means the target could not be bound, so no
      //   observed state may be accepted as success.
      // - Same-version request (repair/downgrade-to-equal): version match
      //   was already true before the installer ran, so it is no evidence.
      //   Neither mtime nor the UAC parent's exit proves a completed repair.
      let settled = false;
      if (targetVersion !== '' && observedVersion === targetVersion) {
        const registered = Boolean(info?.registeredInstall && exe);
        if (!registered) {
          settled = false;
        } else if (!baseline.registeredInstall) {
          // No registration at baseline: the newly appearing registration at
          // exactly the target version is itself the proof.
          settled = true;
        } else if (observedVersion !== baseline.version) {
          // Upgrade/downgrade to a different version: registration match is
          // sufficient evidence.
          settled = true;
        } else {
          // Same version AND already registered at baseline: an unchanged
          // registration carries no reliable completion signal for THIS
          // install — the version was already correct before it ran, an
          // elevated installer's initial child may exit before it finishes,
          // and a touched mtime only proves a file changed (a cancelled or
          // partially-failed rewrite also touches it). Without a trustworthy
          // terminal signal this layer cannot prove completion. Return an
          // explicit unconfirmed result once the parent exits,
          // rather than spinning for eight minutes with no possible success.
          if (childDone.fired) { finish('unconfirmed'); return; }
          settled = false;
        }
      }
      if (settled) {
        finish(info);
        return;
      }
      if (typeof onProgress === 'function') {
        onProgress({ phase: 'install-wait', installerDone: childDone.fired, elapsedMs: Date.now() - started });
      }
    }, pollMs);
  });
}

let runtimeAbort = null;

function cancelRuntimeInstall() {
  if (!runtimeAbort) {
    return { ok: false };
  }
  runtimeAbort.abort();
  return { ok: true };
}

/**
 * Download + install the managed desktop runtime through a route.
 * `deps.confirmUnverified` gates releases without a checksum manifest.
 * Returns plain IPC-safe objects only — the installer child handle is
 * consumed internally and never crosses the wire.
 */
async function installRuntime(options = {}, onProgress, deps = {}) {
  if (runtimeAbort) {
    return { ok: false, status: 'error', error: 'install-in-progress', message: '已有安装任务进行中' };
  }
  const updateMod = deps.update || update;
  const source = deps.releaseSource || releaseSource;
  const ensureExited = typeof deps.ensureDesktopExited === 'function'
    ? deps.ensureDesktopExited
    : () => ensureExternalDesktopExited(deps);
  const route = source.normalizeRoute(options.route)
    || configuredRoute(deps)
    || 'github';
  const tag = typeof options.tag === 'string' ? options.tag.trim() : '';
  const controller = new AbortController();
  runtimeAbort = controller;
  try {
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'resolve', percent: 0 });
    }
    const installed = installedInfo({ fresh: true, deps });
    const info = tag
      ? await source.releaseFor(route, tag, { installedVersion: installed.version })
      : await source.latestFor(route, { installedVersion: installed.version });
    if (!info || info.status === 'error') {
      return {
        ok: false,
        status: 'error',
        route,
        message: info?.message || '获取版本信息失败',
        htmlUrl: source.ROUTES?.[route]?.page || '',
      };
    }
    if (!info.assetUrl) {
      return { ok: false, status: 'error', route, message: 'no-installer', htmlUrl: info.htmlUrl || '' };
    }
    // Freeze the resolved target BEFORE the installer runs. Prefer the tag
    // (it carries prerelease identity that `summarizeRelease`'s normalized
    // `version` strips) so a beta/rc target binds to its exact registry
    // string, falling back to `info.version`. The baseline version is
    // normalized on the same footing so a registered "v1.2.3" vs target
    // "1.2.3" never misreads as a different-version success.
    const targetVersion = normalizeVersionString(info?.tag) || normalizeVersionString(info?.version);
    // An unbound/empty target must never reach installation side effects.
    // The release contract always resolves a version; an empty one means the
    // target could not be bound, so no observed state may be treated as its
    // completion. Refuse here — before installFromAsset runs — rather than
    // letting the wait loop inherit an unprovable target.
    if (!targetVersion) {
      return {
        ok: false,
        status: 'error',
        route,
        message: '无法确定目标版本，已取消安装',
        error: 'unbound-target-version',
      };
    }
    const baseline = {
      registeredInstall: Boolean(installed.registeredInstall),
      version: normalizeVersionString(installed.version),
      stamp: runtimeExeStamp(installed, deps),
    };
    let installerChild = null;
    // Capture the installer child's lifecycle AT launch time — subscribing
    // here (not inside waitForInstall after installFromAsset resolves) means
    // an exit/error the child emits early is recorded, never missed.
    const installerChildDone = { fired: false, code: null, failed: false };
    const result = await updateMod.installFromAsset(info, onProgress, {
      signal: controller.signal,
      // The slim launcher must survive the install it is driving; the full
      // package keeps self-update semantics (quit when packaged).
      quitAfterInstall: isPackagedNow(deps) && !isLauncherPackageNow(deps),
      confirmUnverified: deps.confirmUnverified,
      // Between verify and installer launch: the managed desktop must have
      // exited (peer handshake → task-protected quit, or graceful close).
      beforeInstall: async () => {
        const exited = await ensureExited();
        return exited.ok === true
          ? { ok: true }
          : { ok: false, code: exited.code || 'desktop-still-running', cancelled: exited.cancelled === true };
      },
      onInstallerLaunch: (child) => {
        installerChild = child;
        if (child && typeof child.once === 'function') {
          child.once('exit', (code) => {
            installerChildDone.fired = true;
            installerChildDone.code = typeof code === 'number' ? code : null;
            installerChildDone.failed = code !== 0 && code !== null;
          });
          child.once('error', (error) => {
            installerChildDone.fired = true;
            installerChildDone.failed = true;
            installerChildDone.message = error.message;
          });
        }
      },
      userDataDir: deps.userDataDir,
    });
    if (!result || result.launched !== true) {
      return { ok: false, route, ...(result || {}) };
    }
    // A packaged self-update quits this process — nothing left to adopt.
    if (isPackagedNow(deps) && !isLauncherPackageNow(deps)) {
      return { ok: true, route, status: 'quit-pending', installer: result.installer };
    }
    if (typeof onProgress === 'function') {
      onProgress({ phase: 'install-wait', percent: 100 });
    }
    // No unbound/empty target may reach waitForInstall — an empty one used to
    // activate a fallback that accepted any changed version as success.
    const found = await waitForInstall(installerChild, baseline, controller.signal, onProgress, deps, targetVersion, installerChildDone);
    invalidateInstalledCache();
    if (found === 'installer-failed') {
      return {
        ok: false, route, status: 'error', error: 'installer-failed',
        message: `安装程序未能完成：${installerChildDone.message || `退出码 ${installerChildDone.code}`}。请检查安装向导或系统安全提示后重试。`,
      };
    }
    if (found === 'unconfirmed') {
      return {
        ok: false, route, status: 'waiting',
        message: '已检测到同版本桌面端，但无法确认本次修复是否完成。请完成安装向导（可能需要系统授权），再刷新状态；不要重复启动安装。',
      };
    }
    if (found === 'aborted') {
      return {
        ok: false,
        route,
        cancelled: true,
        status: 'waiting',
        message: '已停止等待安装结果；安装程序仍在运行，完成后会被识别，也可手动刷新。',
      };
    }
    if (found === 'timeout' || found === null) {
      return {
        ok: false,
        route,
        status: 'waiting',
        message: '等待安装结果已超时，尚未确认安装完成。请检查安装向导、系统授权或安全提示，完成后刷新状态；不要重复启动安装。',
      };
    }
    return {
      ok: true,
      route,
      status: 'installed',
      installer: result.installer,
      installed: found,
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { ok: false, route, cancelled: true, status: 'cancelled', message: '已取消下载' };
    }
    return { ok: false, route, status: 'error', message: error?.message || String(error) };
  } finally {
    if (runtimeAbort === controller) {
      runtimeAbort = null;
    }
  }
}

/**
 * Update snapshot for the managed runtime. When nothing is installed the
 * install card — not the cold-start update ask — is the right surface, so an
 * 'available' result is clamped to 'none' (there is nothing to update).
 */
async function checkDesktopUpdate({ route, timeoutMs } = {}, deps = {}) {
  const source = deps.releaseSource || releaseSource;
  const resolved = source.normalizeRoute(route) || configuredRoute(deps) || 'github';
  const installed = installedInfo({ fresh: true, deps });
  const snapshot = await source.latestFor(resolved, {
    installedVersion: installed.version,
    timeoutMs,
  });
  if (!installed.registeredInstall && snapshot.status === 'available') {
    return { ...snapshot, status: 'none' };
  }
  return snapshot;
}

// --- External process control (slim package owns no in-process runtime) ----

function probeDesktopRunning(deps = {}) {
  const target = deps.target !== undefined ? deps.target : runtimeTarget();
  return installDetect.probeDesktopProcess({ ...deps, target });
}

const START_ALIVE_MS = 12_000;
const START_POLL_MS = 400;

async function startExternalDesktop(argv = [], deps = {}) {
  const info = installedInfo({ fresh: true, deps });
  if (!info.registeredInstall || !info.installPath) {
    return { ok: false, error: 'runtime-not-installed' };
  }
  const exe = runtimeExePath(info, deps);
  if (!exe) {
    return { ok: false, error: 'runtime-exe-missing', installPath: info.installPath };
  }
  const args = ['--dshd-from-launcher', ...argv];
  const doSpawn = deps.spawn || spawn;
  const child = doSpawn(exe, args, {
    detached: true,
    // stdout/stderr are piped (stdin stays ignored) so a plugin-caused crash
    // leaves attributable lines in the bounded boot log; the child drains via
    // the log writer, so a full pipe buffer can never stall the runtime.
    // ELECTRON_ENABLE_LOGGING forwards the GUI app's console output (which is
    // where cordis loader/compose errors land) onto stderr — without it a
    // packaged runtime emits nothing on these pipes.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  const logMod = deps.forensicsLog || forensicsLog;
  let bootLogPath = '';
  try {
    const stateDir = typeof deps.stateDir === 'function' ? deps.stateDir() : desktopStateDir(app);
    bootLogPath = stateDir ? logMod.bootLogPath(stateDir) : '';
  } catch {
    bootLogPath = '';
  }
  const bootLog = logMod.attachBootLog(child, bootLogPath);
  bootLog.line(`spawning external runtime: ${exe} ${args.join(' ')}`);
  // A rejected spawn reports through the error event on the next tick; an
  // unhandled 'error' on a ChildProcess would take the whole launcher down.
  let spawnError = null;
  child.on('error', (error) => {
    spawnError = error;
  });
  // Exit after the grace window still lands in the log — a crash at second 30
  // is as attributable as one at second 1.
  child.on('exit', (code, signal) => {
    bootLog.line(`external runtime exited code ${code === null ? 'null' : code}${signal ? ` signal ${signal}` : ''}`);
  });
  child.unref();
  // A successful spawn only proves a child existed for a moment: a runtime
  // that loses its own single-instance race or crashes on boot exits within
  // a second, and reporting ok here would leave the launcher hidden with no
  // working surface. Hold the verdict until the process is still alive at
  // the end of a short grace window.
  const aliveMs = deps.aliveMs ?? START_ALIVE_MS;
  const pollMs = deps.pollMs ?? START_POLL_MS;
  const probe = () => probeDesktopRunning({ ...deps });
  const deadline = Date.now() + aliveMs;
  let seen = false;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
    if (spawnError) {
      bootLog.line(`launcher verdict: spawn failed (${spawnError.message || 'runtime-spawn-failed'})`);
      await bootLog.flush?.();
      return { ok: false, error: spawnError.message || 'runtime-spawn-failed', exe };
    }
    const alive = probe();
    if (alive) {
      seen = true;
      continue;
    }
    if (seen) {
      // Appeared in the process table then vanished before the grace ended.
      bootLog.line('launcher verdict: runtime-exited inside alive grace');
      await bootLog.flush?.();
      return { ok: false, error: 'runtime-exited', exe };
    }
  }
  const alive = probe();
  bootLog.line(`launcher verdict: ${alive ? 'launched' : seen ? 'runtime-exited' : 'runtime-never-started'}`);
  await bootLog.flush?.();
  return alive
    ? { ok: true, launched: true, external: true, exe }
    : { ok: false, error: seen ? 'runtime-exited' : 'runtime-never-started', exe };
}

async function stopExternalDesktop(deps = {}) {
  const target = deps.target !== undefined ? deps.target : (runtimeTarget() || installDetect.DESKTOP_TARGET);
  // Product renames change the exe image name — installed runtimes carry
  // whichever name they were built with, so kill every known image name.
  const images = installDetect.productNames
    ? installDetect.productNames(target.productName)
    : [target.productName];
  const exec = deps.execFileSync || execFileSync;
  const probe = () => probeDesktopRunning({ ...deps, target });
  if (!probe()) {
    return { ok: true, stopped: false };
  }
  // Prefer the task-control handshake: a new desktop runs its own protection
  // (prompt/lock/drain) before it stops — the launcher never force-kills it.
  const handshake = await requestPeerStop('stop-desktop', deps);
  if (handshake.ok === true) {
    await waitUntilGone(probe, deps.exitWaitMs ?? 30000);
    return { ok: !probe(), stopped: !probe(), ...(probe() ? { error: 'desktop-still-running' } : {}) };
  }
  if (handshake.code === 'peer-cancelled' || handshake.code === 'busy') {
    return { ok: false, cancelled: handshake.code === 'peer-cancelled', error: handshake.code, stopped: false };
  }
  // Legacy desktop (no peer file): WM_CLOSE is the graceful normal exit —
  // a tray-parked app may stay alive; report instead of force-killing.
  for (const name of images) {
    try {
      exec('taskkill', ['/IM', `${name}.exe`], { windowsHide: true });
    } catch {
      // already gone between probe and close
    }
  }
  const grace = deps.stopGraceMs ?? 15000;
  await waitUntilGone(probe, grace);
  if (probe()) {
    return {
      ok: false,
      stopped: false,
      error: 'desktop-still-running',
      message: '桌面端仍在运行，请从托盘退出后重试',
    };
  }
  return { ok: true, stopped: true };
}

async function waitUntilGone(probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (probe() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))));
  }
  return !probe();
}

/**
 * Ask the running desktop's peer endpoint to run one protected operation.
 * @returns {{ ok: boolean, code?: string }} — `no-peer`/`peer-unreachable`
 *   when no handshake exists, `peer-cancelled` when the user declined.
 */
async function requestPeerStop(op, deps = {}) {
  const stateDir = typeof deps.stateDir === 'function'
    ? deps.stateDir()
    : (typeof deps.stateDir === 'string' ? deps.stateDir : '');
  if (!stateDir) {
    try {
      const { app } = require('electron');
      const resolved = require('./product').desktopStateDir(app);
      return requestPeerStop(op, { ...deps, stateDir: resolved });
    } catch {
      return { ok: false, code: 'no-peer' };
    }
  }
  const { peer, code } = peerClient.resolvePeer(stateDir, deps);
  if (!peer) {
    return { ok: false, code };
  }
  const result = await peerClient.callPeer(peer, op, deps.peerBody || {}, deps);
  if (result.ok === true) {
    return { ok: true };
  }
  if (result.code === 'cancelled' || result.cancelled === true) {
    return { ok: false, code: 'peer-cancelled' };
  }
  return { ok: false, code: result.code || 'peer-failed' };
}

/**
 * For install/delta flows: ensure the managed desktop process has exited —
 * peer handshake (desktop coordinates its own protection and quits) when the
 * target supports it, otherwise a graceful WM_CLOSE plus confirmation that
 * the process is really gone. Never force-kills; a desktop still running
 * blocks the install.
 */
async function ensureExternalDesktopExited(deps = {}) {
  const probe = () => probeDesktopRunning({ ...deps });
  if (!probe()) {
    return { ok: true, wasRunning: false };
  }
  const handshake = await requestPeerStop('prepare-install', deps);
  if (handshake.ok === true) {
    const gone = await waitUntilGone(probe, deps.exitWaitMs ?? 30000);
    return gone
      ? { ok: true, wasRunning: true, via: 'peer' }
      : { ok: false, code: 'desktop-still-running' };
  }
  if (handshake.code === 'peer-cancelled' || handshake.code === 'busy') {
    return { ok: false, code: handshake.code === 'peer-cancelled' ? 'cancelled' : 'busy', cancelled: handshake.code === 'peer-cancelled' };
  }
  const stop = await stopExternalDesktop(deps);
  if (stop.ok !== true || probe()) {
    return {
      ok: false,
      code: stop.error || 'desktop-still-running',
      cancelled: stop.cancelled === true,
    };
  }
  return { ok: true, wasRunning: true, via: 'graceful' };
}

module.exports = {
  installedInfo,
  invalidateInstalledCache,
  configuredRoute,
  checkDesktopUpdate,
  installRuntime,
  cancelRuntimeInstall,
  startExternalDesktop,
  stopExternalDesktop,
  ensureExternalDesktopExited,
  requestPeerStop,
  probeDesktopRunning,
  waitForInstall,
};
