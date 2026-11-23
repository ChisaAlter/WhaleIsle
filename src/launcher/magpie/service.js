'use strict';

const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { safeRemoveSync } = require('../../shared/fs-safe');
const { killProcessTree } = require('../../shared/process-tree');
const { isPidAlive, killPid } = require('../components/lifecycle');
const { compareVersions } = require('../components/registry');
const {
  MAGPIE_ID,
  platformAssetName,
  resolveMagpieConfigDir,
  setDirWritable,
} = require('./platform');
const { resolveLatestMagpieRelease } = require('./release');
const { detectMagpieState, probeConcurrency } = require('./detect');
const {
  detachMagpieDshChannels,
  readDshDefaultModel,
  remapDshDefaultModel,
  syncDshToMagpieGateway,
} = require('./dsh-sync');
const { detectLegacyWhaleBridge, migrateWhaleBridgeToMagpie } = require('./migrate');
const {
  pickWebPort,
  pruneVersions,
  quitWebProcess,
  readJsonSafe,
  spawnMagpieWeb,
  stageMagpieBinary,
  writeJsonSafe,
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

/**
 * @param {any} opts
 */
function buildCapabilities({ rec, detected, rel, supported, isExternal, updateAvailable }) {
  const canManage = !isExternal;
  const hasRec = Boolean(rec);
  const running = Boolean(detected.running);
  return {
    canInstall: !hasRec && !isExternal && supported,
    canStart: canManage && hasRec && !running,
    canStop: canManage && hasRec && running,
    canOpen: hasRec || isExternal,
    canUpdate: canManage && hasRec && updateAvailable,
    canRollback: canManage && Boolean(rec?.previous),
    canUninstall: canManage && hasRec,
    canDeleteData: canManage && hasRec && !detected.sharedConfig,
    externalUpdateUrl: isExternal && updateAvailable ? (rel?.releaseUrl || '') : '',
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
 * @param {{
 *   desktopStateDir?: string,
 *   root?: string,
 *   dshHome?: string,
 *   configDir?: string,
 *   devPackage?: string,
 *   platform?: NodeJS.Platform,
 *   arch?: string,
 *   isPidAlive?: (pid: number) => boolean,
 *   killPid?: (pid: number, opts?: { force?: boolean }) => boolean,
 *   killProcessTree?: (pid: number, opts?: any) => Promise<boolean>,
 *   spawn?: typeof spawn,
 *   execFile?: Function,
 *   fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
 *   fetchJson?: (url: string, init?: RequestInit) => Promise<any>,
 *   downloadFile?: (url: string, dest: string, onProgress?: (p: any) => void) => Promise<void>,
 *   pickPort?: (preferred?: number) => Promise<number>,
 *   readyTimeoutMs?: number,
 *   exitTimeoutMs?: number,
 * }} [deps]
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
  let pending = false;
  let lastNotice = '';
  /** @type {any} */
  let cachedDetected = null;

  const installed = () => readJsonSafe(installedFile);
  const emit = (/** @type {Function | undefined} */ fn, /** @type {string} */ phase, /** @type {number} */ percent, message = '') => {
    fn?.({ id: MAGPIE_ID, phase, percent, message });
  };

  /** @returns {Promise<any>} */
  async function inspect() {
    cachedDetected = await detectMagpieState({
      configDir,
      managedState: readJsonSafe(managedStateFile),
      companionState: readJsonSafe(companionStateFile),
      installed: installed(),
      fetchJson: deps.fetchJson,
      fetchImpl: deps.fetchImpl,
      isPidAlive: alive,
    });
    return cachedDetected;
  }

  async function refreshCatalog() {
    catalogError = '';
    if (!supported) return row();
    try {
      const release = await resolveLatestMagpieRelease({
        route: resolveDownloadRoute(),
        platform,
        arch,
        devPackage,
        fetchImpl: deps.fetchImpl,
      });
      catalog = { release, checkedAt: new Date().toISOString() };
      writeJsonSafe(catalogFile, catalog);
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
    }
    await inspect();
    return row();
  }

  function row() {
    const detected = cachedDetected || {
      ownership: 'managed', running: false, sharedConfig: false,
      gateway: null, webUrl: '', managedPid: null, companionPid: null,
    };
    return buildComponentRow({
      rec: installed(),
      detected,
      rel: catalog?.release,
      platform,
      arch,
      supported,
      catalogError,
      lastNotice,
      desktopState,
    });
  }

  async function locked(/** @type {() => Promise<any>} */ fn) {
    if (pending) return { ok: false, error: 'busy' };
    pending = true;
    let held = false;
    const lock = path.join(root, 'operation.lock');
    try {
      fs.mkdirSync(root, { recursive: true });
      if (fs.existsSync(lock)) {
        let owner = null;
        try { owner = readJsonSafe(lock); } catch { /* ignore half-written lock */ }
        if (owner?.pid && alive(owner.pid)) return { ok: false, error: 'busy' };
        if (!owner?.pid && Date.now() - fs.statSync(lock).mtimeMs < 10_000) return { ok: false, error: 'busy' };
        safeRemoveSync(lock);
      }
      fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
      held = true;
      return await fn();
    } catch (error) {
      const err = /** @type {NodeJS.ErrnoException} */ (error);
      return { ok: false, error: err.code === 'EEXIST' ? 'busy' : 'magpie-failed', message: err.message };
    } finally {
      if (held) safeRemoveSync(lock);
      pending = false;
    }
  }

  /** @param {string} gatewayAddr */
  async function assertIdleBeforeStop(gatewayAddr) {
    const busy = await probeConcurrency(gatewayAddr, { fetchJson: deps.fetchJson, fetchImpl: deps.fetchImpl });
    if (busy && (busy.requests > 0 || busy.waiting > 0 || busy.tools > 0)) {
      throw new Error('Magpie 正在处理请求或等待工具结果，请稍后再试');
    }
  }

  /** @param {Function | undefined} progress @param {{ allowSameOrOlder?: boolean }} [options] */
  async function stage(progress, options = {}) {
    await refreshCatalog();
    if (catalogError) throw new Error(catalogError);
    const rel = catalog?.release;
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
    await syncDshToMagpieGateway({ dshHome, gatewayAddr, fetchJson: deps.fetchJson });
    const prev = migrationResult?.previousDefault || readDshDefaultModel(dshHome);
    if (prev?.provider === 'whalebridge') {
      remapDshDefaultModel(dshHome, 'whalebridge', 'magpie');
    }
  }

  /** @param {Function} [progress] */
  function install(progress) {
    return locked(async () => {
      if (installed()) throw new Error('Magpie 已安装');
      if (!supported) throw new Error(`Magpie 暂不支持当前平台（${platform}-${arch}）`);
      const pre = await inspect();
      const migration = await runPendingMigrationIfNeeded(pre);
      const managedOnly = !pre.sharedConfig && !migration?.migrated;
      const version = await stage(progress, { allowSameOrOlder: true });
      writeJsonSafe(installedFile, { version, previous: null, managedOnly });
      const post = await inspect();
      if (post.ownership === 'external' || post.ownership === 'external-ui-companion') {
        await syncDshAndRemap(post.gateway.addr, migration);
        emit(progress, 'done', 100);
        return { ok: true, component: row() };
      }
      const rec = await spawnWeb(version, true, progress);
      await syncDshAndRemap(rec.gatewayAddr || '', migration);
      await inspect();
      emit(progress, 'done', 100);
      return { ok: true, component: row() };
    });
  }

  /** @param {Function} [progress] */
  function start(progress) {
    return locked(async () => {
      const pre = await inspect();
      const migration = await runPendingMigrationIfNeeded(pre);
      const afterMig = await inspect();
      if (afterMig.ownership === 'external') {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        emit(progress, 'done', 100);
        return { ok: true, url: afterMig.webUrl, ownership: afterMig.ownership, version: afterMig.gateway.version };
      }
      if (afterMig.ownership === 'external-ui-companion') {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        if (afterMig.webUrl) {
          emit(progress, 'done', 100);
          return { ok: true, url: afterMig.webUrl, ownership: afterMig.ownership, version: afterMig.gateway.version };
        }
        let rec = installed();
        if (!rec) {
          const version = await stage(progress, { allowSameOrOlder: true });
          writeJsonSafe(installedFile, { version, previous: null, managedOnly: false });
          rec = installed();
        }
        const comp = await spawnWeb(rec.version, false, progress);
        await inspect();
        emit(progress, 'done', 100);
        return { ok: true, url: comp.webUrl, ownership: 'external-ui-companion', version: afterMig.gateway.version };
      }
      const rec = installed();
      if (!rec) throw new Error('请先安装 Magpie');
      if (afterMig.running && afterMig.webUrl) {
        await syncDshAndRemap(afterMig.gateway.addr, migration);
        emit(progress, 'done', 100);
        return { ok: true, url: afterMig.webUrl, ownership: afterMig.ownership, version: rec.version };
      }
      const started = await spawnWeb(rec.version, true, progress);
      await syncDshAndRemap(started.gatewayAddr || '', migration);
      await inspect();
      emit(progress, 'done', 100);
      return { ok: true, url: started.webUrl, ownership: cachedDetected.ownership, version: rec.version };
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
      if (current.running && current.gateway?.addr) {
        await assertIdleBeforeStop(current.gateway.addr);
      }
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

  async function switchManagedVersion(/** @type {string} */ nextVersion, /** @type {string | null} */ previousVersion, /** @type {Function | undefined} */ progress) {
    const oldRec = installed();
    const detected = await inspect();
    const wasRunning = detected.running && (detected.ownership === 'managed' || detected.ownership === 'managed-shared-config');
    const managed = readJsonSafe(managedStateFile);
    const companion = readJsonSafe(companionStateFile);

    if (wasRunning && detected.gateway?.addr) {
      await assertIdleBeforeStop(detected.gateway.addr);
      emit(progress, 'stop', 70);
      await quitProcess(managed, managedStateFile);
    } else if (companion) {
      await quitProcess(companion, companionStateFile);
    }

    try {
      writeJsonSafe(installedFile, { ...oldRec, version: nextVersion, previous: previousVersion });
      if (wasRunning) {
        const started = await spawnWeb(nextVersion, true, progress);
        await syncDshAndRemap(started.gatewayAddr || '', null);
      }
    } catch (error) {
      const liveManaged = readJsonSafe(managedStateFile);
      if (liveManaged) await quitProcess(liveManaged, managedStateFile);
      writeJsonSafe(installedFile, oldRec);
      if (wasRunning && oldRec?.version) {
        await spawnWeb(oldRec.version, true);
      }
      await inspect();
      throw new Error(`更新未生效，已恢复原版本：${error instanceof Error ? error.message : String(error)}`);
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
      return switchManagedVersion(nextVersion, rec.version, progress);
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
      return switchManagedVersion(rec.previous, rec.version, progress);
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
      if (current.running && current.gateway?.addr) {
        await assertIdleBeforeStop(current.gateway.addr);
      }
      emit(progress, 'stop', 25);
      await quitProcess(readJsonSafe(managedStateFile), managedStateFile);
      await quitProcess(readJsonSafe(companionStateFile), companionStateFile);
      emit(progress, 'remove', 65);
      detachMagpieDshChannels(dshHome);
      safeRemoveSync(installedFile);
      const versionsDir = path.join(root, 'versions');
      setDirWritable(versionsDir);
      safeRemoveSync(versionsDir);
      if (options.removeData === true && !current.sharedConfig) {
        safeRemoveSync(configDir);
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
    const companion = readJsonSafe(companionStateFile);
    if (companion) {
      await quitProcess(companion, companionStateFile);
      await inspect();
    }
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

function resetMagpieServiceForTest() {
  singleton = null;
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
  resetMagpieServiceForTest,
};
