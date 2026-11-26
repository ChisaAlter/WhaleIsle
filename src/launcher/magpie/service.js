'use strict';

const { execFile, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { safeRemoveSync } = require('../../shared/fs-safe');
const { killProcessTree, sameProcessStartTime, windowsProcessStartTime } = require('../../shared/process-tree');
const { isPidAlive, killPid } = require('../components/lifecycle');
const { compareVersions } = require('../components/registry');
const {
  MAGPIE_ID, platformAssetName, resolveMagpieConfigDir,
} = require('./platform');
const { resolveLatestMagpieRelease } = require('./release');
const { EPHEMERAL_RUNTIME_ENTRIES, detectMagpieState, hasSharedUserConfig, probeConcurrency } = require('./detect');
const {
  detachMagpieDshChannels, readDshDefaultModel, remapDshDefaultModel, syncDshToMagpieGateway,
} = require('./dsh-sync');
const migrate = require('./migrate');
const { detectLegacyWhaleBridge, migrateWhaleBridgeToMagpie } = migrate;
const {
  pickWebPort, pruneVersions, quitWebProcess, readJsonSafe,
  removeDirWithRetry, spawnMagpieWeb, stageMagpieBinary, writeJsonSafe,
} = require('./runtime');

function defaultPaths() {
  const { app } = require('electron');
  const { desktopStateDir } = require('../product');
  const { desktopDshHomeFromUserData, tryGetDesktopDshHome } = require('../../shared/dsh-home');
  const desktop = desktopStateDir(app);
  return {
    desktopStateDir: desktop,
    root: path.join(desktop, 'components', MAGPIE_ID),
    dshHome: tryGetDesktopDshHome() || desktopDshHomeFromUserData(desktop),
    configDir: resolveMagpieConfigDir(process.env),
    devPackage: app.isPackaged ? '' : path.resolve(__dirname, '../../../.tmp/magpie-package'),
  };
}

/** @returns {string} */
function resolveDownloadRoute() {
  try {
    const source = require('../release-source');
    const saved = require('../../main/config').loadConfig().downloadRoute;
    return source.normalizeRoute(saved) || source.defaultRoute();
  } catch {
    return 'github';
  }
}

/**
 * @param {NodeJS.Platform} platform
 * @param {string} arch
 */
function buildUnsupportedRow(platform, arch) {
  return {
    id: MAGPIE_ID,
    name: 'Magpie',
    description: '复用或托管官方 Magpie 网关，统一管理多供应商、订阅账号、路由与 DSH 接入。',
    version: '', installedVersion: '', latest: '', previousVersion: '',
    state: 'unsupported', ownership: 'managed', source: 'official', kind: 'service',
    pid: null, url: '', updateAvailable: false, configurable: false,
    message: `Magpie 暂不支持当前平台（${platform}-${arch}）。`,
    capabilities: {
      canInstall: false, canStart: false, canStop: false, canOpen: false,
      canUpdate: false, canRollback: false, canUninstall: false, canDeleteData: false,
      externalUpdateUrl: '',
    },
  };
}

/** @param {any} opts */
function buildCapabilities({ rec, detected, rel, supported, isExternal, updateAvailable }) {
  const hasRec = Boolean(rec);
  const running = Boolean(detected.running);
  if (isExternal) {
    return {
      canInstall: false, canStart: false, canStop: false, canOpen: true,
      canUpdate: false, canRollback: false, canUninstall: false, canDeleteData: false,
      externalUpdateUrl: updateAvailable ? (rel?.releaseUrl || '') : '',
    };
  }
  return {
    canInstall: !hasRec && supported,
    canStart: hasRec && !running,
    canStop: hasRec && running,
    canOpen: hasRec,
    canUpdate: hasRec && updateAvailable,
    canRollback: Boolean(rec?.previous),
    canUninstall: hasRec,
    canDeleteData: hasRec && (!detected.sharedConfig || Boolean(rec?.managedOnly)),
    externalUpdateUrl: '',
  };
}

/**
 * @param {any} rec
 * @param {any} detected
 * @param {string} desktopState
 */
function resolveLegacyHint(rec, detected, desktopState) {
  if (rec || detected.ownership === 'external' || detected.ownership === 'external-ui-companion') return '';
  return detectLegacyWhaleBridge(desktopState)?.needsMigration
    ? '检测到旧版鲸桥配置，安装时将自动迁移至 Magpie。'
    : '';
}

/**
 * @param {any} rec
 * @param {any} detected
 * @param {any} rel
 * @param {boolean} isExternal
 */
function resolveRowVersions(rec, detected, rel, isExternal) {
  const gwVer = detected.gateway ? detected.gateway.version : '';
  const recVer = rec ? rec.version : '';
  const currentVersion = (isExternal ? gwVer : '') || recVer || '';
  const latestVersion = rel ? (rel.version || '') : '';
  const updateAvailable = Boolean(currentVersion && latestVersion && compareVersions(latestVersion, currentVersion) > 0);
  return { currentVersion, latestVersion, updateAvailable };
}

/** @param {any} ctx */
function buildComponentRow(ctx) {
  const { rec, detected, rel, platform, arch, supported, catalogError, lastNotice, desktopState } = ctx;
  const isExternal = detected.ownership === 'external' || detected.ownership === 'external-ui-companion';
  if (!rec && !isExternal && !supported) return buildUnsupportedRow(platform, arch);

  const { currentVersion, latestVersion, updateAvailable } = resolveRowVersions(rec, detected, rel, isExternal);
  const gwPid = detected.gateway ? detected.gateway.pid : null;
  return {
    id: MAGPIE_ID,
    name: 'Magpie',
    description: '复用或托管官方 Magpie 网关，统一管理多供应商、订阅账号、路由与 DSH 接入。',
    version: latestVersion || currentVersion || '0.0.0',
    installedVersion: currentVersion,
    latest: latestVersion,
    previousVersion: isExternal || !rec ? '' : (rec.previous || ''),
    state: detected.running ? 'running' : (rec ? 'stopped' : 'available'),
    ownership: detected.ownership,
    source: 'official',
    kind: 'service',
    pid: gwPid ?? detected.managedPid ?? null,
    companionPid: detected.companionPid ?? null,
    url: detected.webUrl || '',
    updateAvailable,
    configurable: Boolean(rec || isExternal),
    message: catalogError || lastNotice || resolveLegacyHint(rec, detected, desktopState),
    capabilities: buildCapabilities({ rec, detected, rel, supported, isExternal, updateAvailable }),
  };
}

/** @param {string} file @param {string[]} args @param {any} opts */
async function defaultRunTool(file, args, opts) {
  return (await promisify(execFile)(file, args, opts)).stdout;
}

/** @param {any} deps */
function resolveServiceConfig(deps) {
  const defaults = deps.root ? null : defaultPaths();
  const pick = (/** @type {any} */ a, /** @type {any} */ b, /** @type {any} */ c = '') => a ?? b ?? c;
  const root = /** @type {string} */ (pick(deps.root, defaults?.root));
  const platform = deps.platform || process.platform;
  const arch = deps.arch || process.arch;
  const assetName = platformAssetName(platform, arch);
  return {
    root,
    desktopState: pick(deps.desktopStateDir, defaults?.desktopStateDir, path.dirname(path.dirname(root))),
    dshHome: /** @type {string} */ (pick(deps.dshHome, defaults?.dshHome)),
    configDir: /** @type {string} */ (pick(deps.configDir, defaults?.configDir, resolveMagpieConfigDir(process.env))),
    devPackage: pick(deps.devPackage, defaults?.devPackage),
    platform,
    arch,
    assetName,
    supported: Boolean(assetName),
    alive: deps.isPidAlive || isPidAlive,
    kill: deps.killPid || killPid,
    killTree: deps.killProcessTree || killProcessTree,
    run: deps.spawn || spawn,
    runTool: deps.execFile || defaultRunTool,
    selectPort: deps.pickPort || pickWebPort,
  };
}

/**
 * Create the Magpie runtime lifecycle service.
 * @param {Record<string, any>} [deps]
 */
function createMagpieService(deps = {}) {
  const {
    root, desktopState, dshHome, configDir, devPackage,
    platform, arch, assetName, supported,
    alive, kill, killTree, run, runTool, selectPort,
  } = resolveServiceConfig(deps);

  const installedFile = path.join(root, 'installed.json');
  const catalogFile = path.join(root, 'catalog.json');
  const managedStateFile = path.join(root, 'managed-state.json');
  const companionStateFile = path.join(root, 'companion-state.json');
  const logFile = path.join(root, 'logs', 'magpie.log');

  let catalog = readJsonSafe(catalogFile);
  let catalogError = '';
  let catalogGen = 0;
  let inspectGen = 0;
  let pending = false;
  /** @type {Promise<void> | null} */
  let activeLockPromise = null;
  let lastNotice = '';
  /** @type {any} */
  let cachedDetected = null;

  const installed = () => readJsonSafe(installedFile);
  const emit = (/** @type {Function | undefined} */ fn, /** @type {string} */ phase, /** @type {number} */ percent, message = '') => {
    fn?.({ id: MAGPIE_ID, phase, percent, message });
  };

  /** @returns {Promise<any>} */
  async function inspect() {
    const gen = ++inspectGen;
    const detected = await detectMagpieState({
      configDir,
      managedState: readJsonSafe(managedStateFile),
      companionState: readJsonSafe(companionStateFile),
      installed: installed(),
      fetchJson: deps.fetchJson,
      fetchImpl: deps.fetchImpl,
      isPidAlive: alive,
    });
    if (gen === inspectGen) {
      cachedDetected = detected;
      return detected;
    }
    return cachedDetected || detected;
  }

  /** @returns {Promise<{ release: any, error: string }>} */
  async function fetchLatestCatalog() {
    const gen = ++catalogGen;
    if (!supported) {
      if (gen === catalogGen) catalogError = '';
      return { release: null, error: '' };
    }
    try {
      const release = await resolveLatestMagpieRelease({
        route: resolveDownloadRoute(),
        platform,
        arch,
        devPackage,
        fetchImpl: deps.fetchImpl,
      });
      if (gen === catalogGen) {
        catalog = { release, checkedAt: new Date().toISOString() };
        catalogError = '';
        writeJsonSafe(catalogFile, catalog);
      }
      return { release, error: '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (gen === catalogGen) catalogError = message;
      return { release: null, error: message };
    }
  }

  async function reconcileLegacyDirSafe() {
    try {
      const legacyRoot = path.join(desktopState, 'components', 'whalebridge');
      await migrate.reconcileLegacyWhaleBridgeDir?.({ legacyRoot, desktopStateDir: desktopState });
    } catch {
      // Legacy WhaleBridge cleanup must never block main Magpie flows.
    }
  }

  async function refreshCatalog() {
    if (!supported) {
      catalogError = '';
      return row();
    }
    await fetchLatestCatalog();
    await inspect();
    await reconcileLegacyDirSafe();
    return row();
  }

  function liveManagedFallback(/** @type {any} */ managed, /** @type {boolean} */ managedAlive, /** @type {any} */ companion, /** @type {boolean} */ companionAlive) {
    const sharedConfig = hasSharedUserConfig(configDir);
    return {
      ownership: sharedConfig && !installed()?.managedOnly ? 'managed-shared-config' : 'managed',
      running: managedAlive,
      sharedConfig,
      gateway: null,
      webUrl: managedAlive ? (managed.webUrl || '') : '',
      managedPid: managedAlive ? managed.pid : null,
      companionPid: companionAlive ? companion.pid : null,
    };
  }

  function liveCompanionDetected(/** @type {any} */ base, /** @type {any} */ companion, /** @type {boolean} */ companionAlive) {
    const compPid = companionAlive
      ? companion.pid
      : (base.companionPid && alive(base.companionPid) ? base.companionPid : null);
    return { ...base, companionPid: compPid, webUrl: compPid ? (companion?.webUrl || base.webUrl || '') : '' };
  }

  function liveRowDetected() {
    const managed = readJsonSafe(managedStateFile);
    const companion = readJsonSafe(companionStateFile);
    const managedAlive = Boolean(managed?.pid && alive(managed.pid));
    const companionAlive = Boolean(companion?.pid && alive(companion.pid));
    const base = cachedDetected;
    if (!base) return liveManagedFallback(managed, managedAlive, companion, companionAlive);
    if (base.ownership === 'external') return base;
    if (base.ownership === 'external-ui-companion') return liveCompanionDetected(base, companion, companionAlive);
    const knownPid = base.gateway?.pid ?? base.managedPid;
    if (base.running && knownPid && !alive(knownPid) && !managedAlive) {
      return { ...base, running: false, gateway: null, webUrl: '', managedPid: null, companionPid: null };
    }
    if (!base.running && managedAlive) {
      return { ...base, running: true, webUrl: managed.webUrl || base.webUrl || '', managedPid: managed.pid };
    }
    return base;
  }

  function row() {
    return buildComponentRow({
      rec: installed(),
      detected: liveRowDetected(),
      rel: catalog?.release,
      platform,
      arch,
      supported,
      catalogError,
      lastNotice,
      desktopState,
    });
  }

  function isLockOwnerAlive(/** @type {any} */ owner) {
    if (!owner?.pid || !alive(owner.pid)) return false;
    if (owner.startTime) {
      const currentStartTime = windowsProcessStartTime(owner.pid);
      if (currentStartTime && !sameProcessStartTime(currentStartTime, owner.startTime)) {
        return false;
      }
    }
    return true;
  }

  async function locked(/** @type {() => Promise<any>} */ fn) {
    if (pending) return { ok: false, error: 'busy' };
    pending = true;
    let resolveLock = /** @type {(() => void) | undefined} */ (undefined);
    activeLockPromise = new Promise((resolve) => { resolveLock = resolve; });
    let held = false;
    const lock = path.join(root, 'operation.lock');
    try {
      fs.mkdirSync(root, { recursive: true });
      if (fs.existsSync(lock)) {
        let owner = null;
        let stat = null;
        try { owner = readJsonSafe(lock); } catch { /* ignore half-written lock */ }
        try { stat = fs.statSync(lock); } catch { /* removed concurrently */ }
        if (stat) {
          if (isLockOwnerAlive(owner)) return { ok: false, error: 'busy' };
          if (!owner?.pid && Date.now() - stat.mtimeMs < 10_000) return { ok: false, error: 'busy' };
          const staleLock = path.join(root, `lock.stale.${process.pid}.${randomBytes(4).toString('hex')}`);
          try {
            fs.renameSync(lock, staleLock);
            safeRemoveSync(staleLock);
          } catch (renameErr) {
            if (/** @type {NodeJS.ErrnoException} */ (renameErr)?.code !== 'ENOENT') {
              return { ok: false, error: 'busy' };
            }
          }
        }
      }
      fs.writeFileSync(lock, JSON.stringify({
        pid: process.pid,
        startTime: windowsProcessStartTime(process.pid),
        createdAt: new Date().toISOString(),
      }), { flag: 'wx' });
      held = true;
      return await fn();
    } catch (error) {
      const err = /** @type {NodeJS.ErrnoException} */ (error);
      return { ok: false, error: err.code === 'EEXIST' ? 'busy' : 'magpie-failed', message: err.message };
    } finally {
      if (held) safeRemoveSync(lock);
      pending = false;
      activeLockPromise = null;
      resolveLock?.();
    }
  }

  /** @param {string} gatewayAddr */
  async function assertIdleBeforeStop(gatewayAddr) {
    const busy = await probeConcurrency(gatewayAddr, { fetchJson: deps.fetchJson, fetchImpl: deps.fetchImpl });
    if (!busy) {
      throw new Error('无法确认 Magpie 并发状态（探测超时或异常），已拒绝停机');
    }
    if (busy.requests > 0 || busy.waiting > 0 || busy.tools > 0) {
      throw new Error('Magpie 正在处理请求或等待工具结果，请稍后再试');
    }
  }

  /** @param {Function | undefined} progress @param {{ allowSameOrOlder?: boolean }} [options] */
  async function stage(progress, options = {}) {
    const { release: rel, error } = await fetchLatestCatalog();
    if (error) throw new Error(error);
    if (!rel?.version || !rel?.asset || !/^[a-f0-9]{64}$/.test(rel.sha256 || '')) {
      throw new Error('Magpie 发布清单无效');
    }
    const rec = installed();
    if (!options.allowSameOrOlder && rec && compareVersions(rel.version, rec.version) <= 0) {
      throw new Error('已是最新版本');
    }
    return stageMagpieBinary({
      root,
      release: rel,
      platform,
      progress,
      emit,
      downloadFile: deps.downloadFile,
    });
  }

  /** @param {string} version @param {boolean} expectGateway @param {Function} [progress] */
  function spawnWeb(version, expectGateway, progress) {
    return spawnMagpieWeb({
      root, configDir, dshHome, assetName, platform, version, expectGateway,
      progress, deps, managedStateFile, companionStateFile, logFile,
      selectPort, alive, kill, run, emit,
    });
  }

  function quitProcess(/** @type {any} */ stateRecord, /** @type {string} */ stateFilePath) {
    return quitWebProcess(stateRecord, stateFilePath, {
      fetchImpl: deps.fetchImpl,
      alive,
      killTree,
      exitTimeoutMs: deps.exitTimeoutMs,
    });
  }

  async function runPendingMigrationIfNeeded(/** @type {any} */ detected) {
    const legacy = detectLegacyWhaleBridge(desktopState);
    if (!legacy.needsMigration) return null;
    /** @type {any} */
    const result = await migrateWhaleBridgeToMagpie({
      desktopStateDir: desktopState,
      dshHome,
      targetConfigDir: configDir,
      externalRunning: Boolean(detected?.running && (detected.ownership === 'external' || detected.ownership === 'external-ui-companion')),
      runTool,
      stopLegacyBridge: async (/** @type {any} */ info) => {
        if (info.state?.pid && alive(info.state.pid)) {
          await killTree(info.state.pid, { graceMs: 1500 });
        }
      },
    });
    if (result?.notice) lastNotice = result.notice;
    return result;
  }

  async function syncDshAndRemap(/** @type {string} */ gatewayAddr, /** @type {any} */ migrationResult) {
    if (!dshHome) return;
    await syncDshToMagpieGateway({ dshHome, gatewayAddr, fetchJson: deps.fetchJson, fetchImpl: deps.fetchImpl });
    const prev = migrationResult?.previousDefault || readDshDefaultModel(dshHome);
    if (prev?.provider === 'whalebridge') {
      remapDshDefaultModel(dshHome, 'whalebridge', 'magpie');
    }
  }

  async function ensureIdleForManagedStop(/** @type {any} */ current, /** @type {any} */ managed) {
    const managedAlive = Boolean(managed?.pid && alive(managed.pid));
    const stopGatewayAddr = current?.gateway?.addr || (managedAlive ? managed?.gatewayAddr : '');
    if (current?.running || managedAlive) {
      if (!stopGatewayAddr) {
        throw new Error('无法确认 Magpie 并发状态（网关地址缺失），已拒绝停机');
      }
      await assertIdleBeforeStop(stopGatewayAddr);
    }
  }

  /** @param {Function} [progress] */
  function install(progress) {
    return locked(async () => {
      if (installed()) throw new Error('Magpie 已安装');
      if (!supported) throw new Error(`Magpie 暂不支持当前平台（${platform}-${arch}）`);
      const pre = await inspect();
      const preSharedConfig = Boolean(pre.sharedConfig || hasSharedUserConfig(configDir));
      const migration = await runPendingMigrationIfNeeded(pre);
      const managedOnly = !preSharedConfig && !migration?.migrated;
      const version = await stage(progress, { allowSameOrOlder: true });
      writeJsonSafe(installedFile, { version, previous: null, managedOnly, sharedConfig: preSharedConfig });
      const post = await inspect();
      if (post.ownership === 'external' || post.ownership === 'external-ui-companion') {
        try {
          await syncDshAndRemap(post.gateway.addr, migration);
        } catch (syncError) {
          const msg = syncError instanceof Error ? syncError.message : String(syncError);
          await inspect();
          throw new Error(`Magpie 已安装，但桌面端模型渠道同步失败：${msg}`);
        }
        await reconcileLegacyDirSafe();
        emit(progress, 'done', 100);
        return { ok: true, component: row() };
      }
      const rec = await spawnWeb(version, true, progress);
      try {
        await syncDshAndRemap(rec.gatewayAddr || '', migration);
      } catch (syncError) {
        const msg = syncError instanceof Error ? syncError.message : String(syncError);
        const liveManaged = readJsonSafe(managedStateFile);
        if (liveManaged) {
          await quitProcess(liveManaged, managedStateFile).catch(() => { /* Preserve original DSH sync error if stop cleanup fails. */ });
        }
        await inspect();
        throw new Error(`Magpie 已安装，但桌面端模型渠道同步失败（已停止刚启动的进程，请重试启动）：${msg}`);
      }
      await inspect();
      await reconcileLegacyDirSafe();
      emit(progress, 'done', 100);
      return { ok: true, component: row() };
    });
  }

  /** @param {Function} [progress] */
  function start(progress) {
    const finishStart = async (/** @type {string} */ url, /** @type {string} */ ownership, /** @type {string} */ version) => {
      await reconcileLegacyDirSafe();
      emit(progress, 'done', 100);
      return { ok: true, url, ownership, version };
    };
    return locked(async () => {
      const pre = await inspect();
      const migration = await runPendingMigrationIfNeeded(pre);
      const afterMig = await inspect();
      if (afterMig.ownership === 'external') {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        return finishStart(afterMig.webUrl, afterMig.ownership, afterMig.gateway.version);
      }
      if (afterMig.ownership === 'external-ui-companion') {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        if (afterMig.webUrl) return finishStart(afterMig.webUrl, afterMig.ownership, afterMig.gateway.version);
        let rec = installed();
        if (!rec) {
          const version = await stage(progress, { allowSameOrOlder: true });
          writeJsonSafe(installedFile, { version, previous: null, managedOnly: false, sharedConfig: true });
          rec = installed();
        }
        const comp = await spawnWeb(rec.version, false, progress);
        await inspect();
        return finishStart(comp.webUrl, 'external-ui-companion', afterMig.gateway.version);
      }
      const rec = installed();
      if (!rec) throw new Error('请先安装 Magpie');
      if (afterMig.running && afterMig.webUrl) {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        return finishStart(afterMig.webUrl, afterMig.ownership, rec.version);
      }
      const started = await spawnWeb(rec.version, true, progress);
      await syncDshAndRemap(started.gatewayAddr || '', migration);
      await inspect();
      return finishStart(started.webUrl, cachedDetected.ownership, rec.version);
    });
  }

  /** @param {Function} [progress] */
  function stop(progress) {
    return locked(async () => {
      const current = await inspect();
      if (current.ownership === 'external' || current.ownership === 'external-ui-companion') {
        throw new Error('正在复用本机外部 Magpie，请在原 Magpie 应用中停止');
      }
      const managed = readJsonSafe(managedStateFile);
      await ensureIdleForManagedStop(current, managed);
      emit(progress, 'stop', 40);
      await quitProcess(managed, managedStateFile);
      await inspect();
      let message = '';
      try {
        detachMagpieDshChannels(dshHome);
      } catch (error) {
        message = `Magpie 已停止，但未能清理桌面端模型渠道：${error instanceof Error ? error.message : String(error)}`;
      }
      emit(progress, 'done', 100);
      return { ok: true, ...(message ? { message } : {}) };
    });
  }

  async function stopProcessesForSwitch(/** @type {any} */ detected, /** @type {Function | undefined} */ progress) {
    const managed = readJsonSafe(managedStateFile);
    const companion = readJsonSafe(companionStateFile);
    const managedAlive = Boolean(managed?.pid && alive(managed.pid));
    const companionAlive = Boolean(companion?.pid && alive(companion.pid));
    const wasRunning = (detected.running && (detected.ownership === 'managed' || detected.ownership === 'managed-shared-config')) || managedAlive;
    await ensureIdleForManagedStop(detected, managed);
    if (wasRunning || managedAlive || companionAlive) emit(progress, 'stop', 70);
    if (managed) await quitProcess(managed, managedStateFile);
    if (companion) await quitProcess(companion, companionStateFile);
    return wasRunning;
  }

  async function restoreSwitchFallback(/** @type {any} */ oldRec, /** @type {boolean} */ wasRunning) {
    const liveManaged = readJsonSafe(managedStateFile);
    if (liveManaged) await quitProcess(liveManaged, managedStateFile);
    writeJsonSafe(installedFile, oldRec);
    if (!wasRunning || !oldRec?.version) return '';
    try {
      const restored = await spawnWeb(oldRec.version, true);
      await syncDshAndRemap(restored.gatewayAddr || '', null);
      return '';
    } catch (rollbackError) {
      return `（恢复原版本失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}）`;
    }
  }

  async function switchManagedVersion(
    /** @type {string} */ nextVersion,
    /** @type {string | null} */ previousVersion,
    /** @type {Function | undefined} */ progress,
    /** @type {'update' | 'rollback'} */ op = 'update',
  ) {
    const oldRec = installed();
    const detected = await inspect();
    const wasRunning = await stopProcessesForSwitch(detected, progress);
    const opLabel = op === 'rollback' ? '回滚' : '更新';
    try {
      writeJsonSafe(installedFile, { ...oldRec, version: nextVersion, previous: previousVersion });
      if (wasRunning) {
        const started = await spawnWeb(nextVersion, true, progress);
        await syncDshAndRemap(started.gatewayAddr || '', null);
      }
    } catch (error) {
      const rollbackNote = await restoreSwitchFallback(oldRec, wasRunning);
      await inspect();
      throw new Error(`${opLabel}未生效，已恢复原版本${rollbackNote}：${error instanceof Error ? error.message : String(error)}`);
    }
    pruneVersions(root, [nextVersion, ...(previousVersion ? [previousVersion] : [])]);
    await inspect();
    emit(progress, 'done', 100);
    return { ok: true, component: row() };
  }

  /** @param {Function} [progress] */
  function update(progress) {
    return locked(async () => {
      const current = await inspect();
      if (current.ownership === 'external' || current.ownership === 'external-ui-companion') {
        return { ok: true, externalUrl: catalog?.release?.releaseUrl || '' };
      }
      const rec = installed();
      if (!rec) throw new Error('请先安装 Magpie');
      const nextVersion = await stage(progress);
      return switchManagedVersion(nextVersion, rec.version, progress, 'update');
    });
  }

  /** @param {Function} [progress] */
  function rollback(progress) {
    return locked(async () => {
      const current = await inspect();
      if (current.ownership === 'external' || current.ownership === 'external-ui-companion') {
        throw new Error('正在复用本机外部 Magpie，无法回滚外部进程');
      }
      const rec = installed();
      if (!rec?.previous) throw new Error('没有可回滚版本');
      const prevDir = path.join(root, 'versions', rec.previous);
      if (!fs.existsSync(path.join(prevDir, assetName)) || !fs.existsSync(path.join(prevDir, 'manifest.json'))) {
        throw new Error(`回滚版本 ${rec.previous} 文件缺失，无法回滚`);
      }
      return switchManagedVersion(rec.previous, rec.version, progress, 'rollback');
    });
  }

  /** @param {string | { id?: string, removeData?: boolean }} [arg] @param {Function} [progress] */
  function uninstall(arg = {}, progress) {
    const options = typeof arg === 'object' && arg ? arg : {};
    return locked(async () => {
      const current = await inspect();
      if (current.ownership === 'external' || current.ownership === 'external-ui-companion') {
        throw new Error('正在复用本机外部 Magpie，不能从启动器卸载外部应用');
      }
      const rec = installed();
      if (!rec) throw new Error('Magpie 未安装');
      const managed = readJsonSafe(managedStateFile);
      await ensureIdleForManagedStop(current, managed);
      emit(progress, 'stop', 25);
      await quitProcess(managed, managedStateFile);
      await quitProcess(readJsonSafe(companionStateFile), companionStateFile);
      emit(progress, 'remove', 65);
      const versionsDir = path.join(root, 'versions');
      removeDirWithRetry(versionsDir);
      detachMagpieDshChannels(dshHome);
      safeRemoveSync(installedFile);
      if (options.removeData === true && ((!current.sharedConfig && !hasSharedUserConfig(configDir)) || rec.managedOnly)) {
        for (const name of EPHEMERAL_RUNTIME_ENTRIES) {
          safeRemoveSync(path.join(configDir, name));
        }
        try {
          for (const name of fs.readdirSync(configDir)) {
            if (name.endsWith('.lock')) safeRemoveSync(path.join(configDir, name));
          }
          fs.rmdirSync(configDir);
        } catch {
          // Non-empty or already absent; never rm -rf unknown user files.
        }
      }
      await inspect();
      emit(progress, 'done', 100);
      return { ok: true };
    });
  }

  async function uninstallInfo() {
    const current = await inspect();
    const def = readDshDefaultModel(dshHome);
    const defaultModel = Boolean(def && /^magpie(?:-responses|-anthropic)?$/i.test(def.provider));
    return { defaultModel, sharedConfig: Boolean(current.sharedConfig) };
  }

  async function stopCompanion() {
    while (pending && activeLockPromise) {
      await activeLockPromise.catch(() => { /* Wait for in-flight lock release; caller owns its error. */ });
    }
    return locked(async () => {
      const companion = readJsonSafe(companionStateFile);
      if (companion) {
        await quitProcess(companion, companionStateFile);
        await inspect();
      }
      return { ok: true };
    });
  }

  return {
    id: MAGPIE_ID,
    row,
    inspect,
    refreshCatalog,
    reconcile: inspect,
    install,
    start,
    stop,
    update,
    rollback,
    uninstall,
    uninstallInfo,
    stopCompanion,
    syncExternalDsh: () => locked(async () => {
      const pre = await inspect();
      if (!pre.gateway?.addr) return { ok: false, error: 'not-running' };
      const migration = await runPendingMigrationIfNeeded(pre);
      await inspect();
      await syncDshAndRemap(pre.gateway.addr, migration);
      return { ok: true };
    }),
    installed,
    state: () => {
      const managed = readJsonSafe(managedStateFile);
      if (managed?.pid && alive(managed.pid)) return { ...managed, url: managed.webUrl };
      const companion = readJsonSafe(companionStateFile);
      if (companion?.pid && alive(companion.pid)) return { ...companion, url: companion.webUrl };
      if (cachedDetected?.webUrl) return { url: cachedDetected.webUrl, pid: cachedDetected.gateway?.pid || null };
      return null;
    },
  };
}

/** @type {ReturnType<typeof createMagpieService> | null} */
let singleton = null;

function magpieService() {
  return singleton || (singleton = createMagpieService());
}

async function ensureMagpieRuntime() {
  const svc = magpieService();
  const detected = await svc.inspect();
  if (detected.ownership === 'external' || detected.ownership === 'external-ui-companion') {
    const result = await svc.syncExternalDsh();
    if (!result.ok) throw new Error(result.message || 'Magpie 接入失败');
    return;
  }
  if (svc.installed()) {
    const result = await svc.start();
    if (!result.ok) throw new Error(result.message || 'Magpie 启动失败');
  }
}

module.exports = {
  createMagpieService,
  magpieService,
  ensureMagpieRuntime,
};
