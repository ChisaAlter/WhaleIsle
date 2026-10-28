'use strict';

// The explicit NSIS differential channel. update.js owns whole-file downloads,
// SHA512 verification and the protected installation commit. This wrapper must
// never substitute a whole-file transfer when the user selected incremental.

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { app } = require('electron');

const requestFailures = new WeakMap();
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60_000;
const checkedBases = new Map();
const preparingBases = new Map();

async function removeBlockmap(file) {
  try { await fs.promises.unlink(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function assertConfirmedTarget(updateInfoAndProvider, expectedCheck) {
  const info = updateInfoAndProvider?.info;
  const exactVersion = (value) => String(value || '').trim().replace(/^v/i, '');
  const expectedVersion = exactVersion(expectedCheck?.tag || expectedCheck?.latest || expectedCheck?.version);
  if (!expectedVersion || exactVersion(info?.version) !== expectedVersion) {
    throw Object.assign(new Error('更新清单版本已变化，请重新检查更新。'), { code: 'release-changed' });
  }
  // Use the pinned library's own architecture selection, just like NsisUpdater.
  const { findFile } = require('electron-updater/out/providers/Provider');
  const provider = updateInfoAndProvider.provider;
  const fileInfo = provider && findFile(provider.resolveFiles(info), 'exe');
  const basename = fileInfo && path.posix.basename(decodeURIComponent(fileInfo.url.pathname));
  const actualUrl = fileInfo && new URL(fileInfo.url);
  const expectedUrl = expectedCheck?.assetUrl && new URL(expectedCheck.assetUrl);
  // Query strings can be cache busters or signed URLs. The confirmed asset's
  // origin and path must still match, including after a cancelled route switch.
  const sameAsset = actualUrl && expectedUrl && actualUrl.origin === expectedUrl.origin
    && decodeURIComponent(actualUrl.pathname) === decodeURIComponent(expectedUrl.pathname);
  if (basename !== expectedCheck.assetName || !sameAsset || fileInfo.packageInfo) {
    throw Object.assign(new Error('更新清单安装包与确认的版本不一致，请重新检查更新。'), { code: 'asset-changed' });
  }
}

/** electron-updater 6.8.9 returns true when its differential path failed. */
function strictNsisUpdaterClass(NsisUpdater) {
  return class StrictNsisUpdater extends NsisUpdater {
    async doDownloadUpdate(options) {
      // Bind again at the actual library boundary, before a cache or transfer
      // can be selected from its mutable updateInfoAndProvider field.
      assertConfirmedTarget(options.updateInfoAndProvider, this.confirmedDownloadTarget);
      const helper = await this.getOrCreateDownloadHelper();
      // A valid pending installer bypasses differentialDownloadInstaller, but
      // 6.8.9 would still promote its anonymous map in executeDownload.done().
      await removeBlockmap(path.join(helper.cacheDirForPendingUpdate, 'current.blockmap'));
      await removeBlockmap(path.join(helper.cacheDir, 'current.blockmap'));
      return super.doDownloadUpdate({
        ...options, disableWebInstaller: true, disableDifferentialDownload: false,
      });
    }

    async differentialDownloadInstaller(...args) {
      const helper = await this.getOrCreateDownloadHelper();
      // 6.8.9 promotes the new map as soon as download finishes, before NSIS
      // replaces installer.exe. Always fetch the old release's map for our
      // verified base, and prevent that premature promotion on this channel.
      await removeBlockmap(path.join(helper.cacheDir, 'current.blockmap'));
      try {
        const needsFullDownload = await super.differentialDownloadInstaller(...args);
        if (needsFullDownload) {
          // 6.8.9 swallows differential errors to select its full-file fallback.
          // Preserve the request's actionable error without enabling fallback.
          const failure = requestFailures.get(this.httpExecutor);
          if (failure) throw failure;
          throw Object.assign(new Error('增量更新失败，已停止下载。请重新选择完全下载。'), {
            code: 'ERR_UPDATER_DIFFERENTIAL_FAILED',
          });
        }
        return false;
      } finally {
        await removeBlockmap(path.join(helper.cacheDirForPendingUpdate, 'current.blockmap'));
      }
    }
  };
}

function getStrictUpdater(deps) {
  if (deps.autoUpdater) return deps.autoUpdater;
  // The library single-flights checks/downloads inside each updater. A stopped
  // operation must not donate a late GitHub result to a new CNB confirmation.
  const { NsisUpdater } = require('electron-updater');
  const updater = new (strictNsisUpdaterClass(NsisUpdater))();
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = false;
  return updater;
}

/** Cancel requests and enforce budgets without Electron's absent socket event. */
function bindUpdaterRequests(executor, signal, deps = {}) {
  if (!executor?.createRequest) return () => {};
  const createRequest = executor.createRequest;
  const setTimer = deps.requestSetTimeout || setTimeout;
  const clearTimer = deps.requestClearTimeout || clearTimeout;
  const active = new Set();
  requestFailures.delete(executor);
  const cancelledError = () => Object.assign(new Error('下载已取消'), { name: 'AbortError' });
  const close = ({ request, response }, error) => {
    response?.destroy?.(error);
    if (request.abort) request.abort();
    else request.destroy?.(error);
  };
  const fail = (entry, error) => {
    entry.cleanup();
    // Single-range requests in 6.8.9 are not directly bound to the token.
    // Their registered error handler must settle the downloader before cleanup.
    entry.request.emit('error', error);
    close(entry, error);
  };
  const abort = () => {
    for (const entry of [...active]) fail(entry, cancelledError());
  };
  executor.createRequest = function (options, callback) {
    if (signal.aborted) {
      // The pinned downloader may call from its 100-range delay, outside a
      // Promise executor. Return the small request API it uses, then reject
      // asynchronously after addErrorAndTimeoutHandlers has attached listeners.
      const request = new EventEmitter();
      request.end = request.abort = () => request;
      queueMicrotask(() => request.emit('error', cancelledError()));
      return request;
    }
    const entry = {};
    let timer;
    let expectedBytes;
    let receivedBytes = 0;
    const cleanup = () => {
      clearTimer(timer);
      timer = undefined;
      entry.response?.removeListener('data', onData);
      active.delete(entry);
    };
    const arm = (ms) => {
      clearTimer(timer);
      timer = setTimer(() => {
        const error = Object.assign(new Error(ms === 20_000 ? '连接或响应头等待超时' : '下载无数据超时'), { code: 'ETIMEDOUT' });
        requestFailures.set(executor, error);
        fail(entry, error);
      }, ms);
    };
    const onData = (chunk) => {
      receivedBytes += chunk.length;
      if (expectedBytes !== undefined && receivedBytes > expectedBytes) {
        entry.response.unpipe?.();
        const error = Object.assign(new Error('增量下载响应超过请求的字节范围'), { code: 'ERR_UPDATER_INVALID_RANGE' });
        requestFailures.set(executor, error);
        fail(entry, error);
        return;
      }
      if (chunk.length > 0) arm(45_000);
    };
    entry.cleanup = cleanup;
    const request = createRequest.call(this, options, (response) => {
      entry.response = response;
      response.once('end', cleanup);
      response.once('error', cleanup);
      response.once('aborted', cleanup);
      const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers?.range || '');
      if (response.statusCode >= 400) {
        const { createHttpError } = require('builder-util-runtime');
        const error = createHttpError(response);
        requestFailures.set(executor, error);
        fail(entry, error);
        return;
      }
      if (range) {
        const header = response.headers?.['content-range'];
        const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(Array.isArray(header) ? header[0] : header || '');
        expectedBytes = Number(range[2]) - Number(range[1]) + 1;
        const lengthHeader = response.headers?.['content-length'];
        const declaredLength = Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader;
        if (response.statusCode !== 206 || !contentRange
          || Number(contentRange[1]) !== Number(range[1]) || Number(contentRange[2]) !== Number(range[2])
          || Number(contentRange[3]) <= Number(range[2]) || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0
          || (declaredLength !== undefined && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expectedBytes))) {
          const error = Object.assign(new Error('增量下载响应与请求的字节范围不一致'), { code: 'ERR_UPDATER_INVALID_RANGE' });
          requestFailures.set(executor, error);
          fail(entry, error);
          return;
        }
      }
      arm(45_000);
      response.on('data', onData);
      callback(response);
    });
    entry.request = request;
    active.add(entry);
    // Electron closes the writable request before the response arrives.
    // Only abort/error or the response's terminal events clear its watchdog.
    request.once('error', (error) => {
      requestFailures.set(executor, error);
      cleanup();
      entry.response?.destroy?.(error);
    });
    request.once('abort', cleanup);
    arm(20_000);
    return request;
  };
  signal.addEventListener('abort', abort, { once: true });
  return (settled) => {
    signal.removeEventListener('abort', abort);
    // Error statuses can reject the downloader before their body ends.
    for (const entry of [...active]) {
      entry.cleanup();
      close(entry);
    }
    requestFailures.delete(executor);
    // A discarded metadata check can wake late; keep its executor closed.
    if (!signal.aborted || settled) executor.createRequest = createRequest;
  };
}

/** Use the confirmed release directory for both mirrors, including renamed repos. */
function feedFor(info) {
  if (!info?.updaterMetadataUrl) return null;
  // Both providers serve latest.yml and its assets in this exact directory.
  // CNB supports single ranges only; GitHub release assets also use one range.
  return { provider: 'generic', url: new URL('.', info.updaterMetadataUrl).href, useMultipleRangeRequest: false };
}

function readPackagedFlag(deps) {
  if (deps && deps.isPackaged !== undefined) {
    return deps.isPackaged;
  }
  try {
    return app.isPackaged;
  } catch {
    return false;
  }
}

async function cachedInstallerPath(autoUpdater) {
  // Let the installed app-update.yml and ElectronAppAdapter select the cache.
  // The product display name does not necessarily equal updaterCacheDirName.
  const helper = await autoUpdater.getOrCreateDownloadHelper();
  if (!helper?.cacheDir) throw new Error('updater cache unavailable');
  const { CURRENT_APP_INSTALLER_FILE_NAME } = require('builder-util-runtime');
  return path.join(helper.cacheDir, CURRENT_APP_INSTALLER_FILE_NAME);
}

function installerStat(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('安装包缓存不是文件');
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Recover only a verified installer for the version that is actually running. */
async function prepareDifferentialBase(autoUpdater, info, deps = {}) {
  const update = require('./update');
  const { signal } = deps;
  const checkCancelled = () => { if (signal?.aborted) throw update.cancelledError(); };
  checkCancelled();
  const installer = await cachedInstallerPath(autoUpdater);
  const version = String(autoUpdater.app?.version || '').trim().replace(/^v/i, '');
  if (!version) throw new Error('无法读取当前运行版本');
  const key = `${info.route || 'github'}:${version}:${installer}`;
  const stat = installerStat(installer);
  const checked = checkedBases.get(key);
  if (checked && checked.stat === stat
    && (!checked.sources || checked.sources.every(source => installerStat(source.path) === source.stat))
    && (!checked.pendingInfo || installerStat(checked.pendingInfo.path) === checked.pendingInfo.stat)) return checked.result;
  if (preparingBases.has(key)) return preparingBases.get(key);
  deps.onBasePreparation?.();
  const pending = (async () => {
    const resolveRelease = deps.resolveCurrentRelease || require('../launcher/release-source').releaseFor;
    const release = await resolveRelease(info.route || 'github', `v${version}`, { installedVersion: version, signal });
    checkCancelled();
    if (!release?.assetName || !release.checksumUrl || !release.blockmapUrl
      || String(release.tag || '').replace(/^v/i, '') !== version) {
      return { ok: false, reason: 'missing-base-release', message: `当前版本 v${version} 未提供可校验的增量基底，请选择完全下载。` };
    }
    const expected = await update.readAssetChecksum(release.assetName, release.checksumUrl, { signal });
    checkCancelled();
    const sizeMatches = (file) => !release.assetSize || fs.statSync(file).size === release.assetSize;
    if (stat && sizeMatches(installer)) {
      const before = installerStat(installer);
      const matches = await update.sha512HexOfFile(installer, signal) === expected;
      checkCancelled();
      if (before !== installerStat(installer)) throw new Error('安装包缓存已变化，请重新检查更新');
      if (matches) {
        const result = { ok: true, blockmapUrl: release.blockmapUrl };
        checkedBases.set(key, { stat: before, result });
        return result;
      }
    }
    // Whole downloads already live here. NSIS may finish successfully even
    // when its best-effort cache copy fails. Do not overwrite the current base
    // until a new process actually runs that downloaded version.
    const full = update.fullInstallerPath(release, { userDataDir: autoUpdater.app.userDataPath });
    const sources = [{ path: full, stat: installerStat(full) }];
    const helper = await autoUpdater.getOrCreateDownloadHelper();
    checkCancelled();
    let pendingInfo;
    const rememberFailure = (result) => {
      checkedBases.set(key, { stat, sources, pendingInfo, result });
      return result;
    };
    for (let index = 0; index < 2; index++) {
      if (index === 1) {
        const pendingInfoPath = helper.getUpdateInfoFile?.();
        pendingInfo = pendingInfoPath ? { path: pendingInfoPath, stat: installerStat(pendingInfoPath) } : undefined;
        if (!pendingInfo?.stat) break;
        const pending = JSON.parse(await fs.promises.readFile(pendingInfo.path, 'utf8'));
        checkCancelled();
        // Only this exact running release may be recovered. A future installer
        // waiting in pending is not the currently installed differential base.
        if (pending.fileName !== release.assetName || path.basename(pending.fileName) !== pending.fileName) break;
        const file = path.join(helper.cacheDirForPendingUpdate, pending.fileName);
        sources.push({ path: file, stat: installerStat(file) });
      }
      const source = sources[index];
      if (!source.stat || !sizeMatches(source.path)) continue;
      await fs.promises.mkdir(path.dirname(installer), { recursive: true });
      checkCancelled();
      const staged = `${installer}.preparing-${process.pid}`;
      try {
        await fs.promises.copyFile(source.path, staged);
        checkCancelled();
        const before = installerStat(staged);
        if (await update.sha512HexOfFile(staged, signal) !== expected) continue;
        checkCancelled();
        if (before !== installerStat(staged)) throw new Error('本地安装包已变化，请重新检查更新');
        await fs.promises.rename(staged, installer);
        const recovered = installerStat(installer);
        // Rename can update ctime, but must preserve the verified inode/size/mtime.
        if (recovered?.split(':').slice(0, 4).join(':') !== before.split(':').slice(0, 4).join(':')) {
          throw new Error('安装包缓存已变化，请重新检查更新');
        }
        await removeBlockmap(path.join(path.dirname(installer), 'current.blockmap'));
        const result = { ok: true, blockmapUrl: release.blockmapUrl };
        checkedBases.set(key, { stat: recovered, result });
        return result;
      } finally {
        try { await fs.promises.unlink(staged); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    const mismatch = Boolean(stat || sources.some(source => source.stat));
    return rememberFailure({ ok: false, reason: mismatch ? 'base-installer-mismatch' : 'missing-cached-installer',
      message: mismatch ? `本地安装包缓存与当前版本 v${version} 的正式安装包不一致，请选择完全下载。`
        : '未找到当前版本的安装包缓存，请选择完全下载。' });
  })();
  preparingBases.set(key, pending);
  try { return await pending; } finally { preparingBases.delete(key); }
}

async function differentialAvailability(info, deps = {}) {
  if (!readPackagedFlag(deps)) {
    return { ok: false, reason: 'not-packaged', message: '源码运行暂不支持增量更新，请选择完全下载。' };
  }
  if ((deps.platform || process.platform) !== 'win32') {
    return { ok: false, reason: 'not-windows', message: '当前平台仅支持完全下载。' };
  }
  if (!info?.assetUrl || !/\.exe$/i.test(info.assetName || '')
    || !info.checksumUrl || !info.blockmapUrl || !info.updaterMetadataUrl) {
    return { ok: false, reason: 'missing-delta-metadata', message: '此版本未提供增量更新所需文件，请选择完全下载。' };
  }
  try {
    const autoUpdater = getStrictUpdater(deps);
    const prepared = await (deps.prepareDifferentialBase || prepareDifferentialBase)(autoUpdater, info, deps);
    if (!prepared.ok) return prepared;
    return { ok: true, autoUpdater, blockmapUrl: prepared.blockmapUrl };
  } catch (error) {
    if (deps.signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    return { ok: false, reason: error.code || 'updater-config-unavailable',
      message: `无法准备增量更新缓存：${error.message || String(error)}。请选择完全下载。` };
  }
}

/**
 * Parse the differential downloader's own report line
 * ("Full: 636 MB, To download: 44 MB (7%)") for the real download share.
 * A pending verified installer can also be reused without any transfer.
 */
function makeDifferentialTracker() {
  const tracker = { differential: false, downloadPercent: null };
  tracker.log = (message) => {
    const match = /To download:\s*[\d.,]+\s*\w+\s*\((\d+)%\)/.exec(String(message || ''));
    if (match) {
      tracker.differential = true;
      tracker.downloadPercent = Number.parseInt(match[1], 10);
    }
  };
  tracker.finish = () => tracker;
  return tracker;
}

/**
 * Logger shim: forwards updater internals to the tracker so the real
 * differential percentage is observable without depending on event shapes.
 */
function makeLogger(tracker, sink) {
  return {
    info: (m) => { tracker.log(m); if (sink && sink.info) sink.info(m); },
    warn: (m) => { if (sink && sink.warn) sink.warn(m); },
    error: (m) => { if (sink && sink.error) sink.error(m); },
    debug: () => {},
  };
}

/**
 * Download the confirmed release differentially. Installation belongs
 * to update.js, where child-process spawn can be observed inside a commit.
 *
 * @param {object} args
 * @param {object} args.expectedCheck - main-owned target shown in confirmation.
 * @param {number} args.timeoutMs - wall-clock budget for the whole download.
 * @param {function} [onProgress] - receives `{phase:'download'|'install', percent, differential}`.
 * @param {object} [deps] - test seams: `autoUpdater`, `isPackaged`,
 *   `prepareDifferentialBase`, `CancellationToken`, `logger`, `setTimeout`/`clearTimeout`,
 *   `requestSetTimeout`/`requestClearTimeout` (per-request watchdog clock).
 * @returns {Promise<{ok:true, installer:string, differential:boolean, version:string}|{ok:false, reason:string}>}
 *   `ok:false` stops this action; only another explicit full choice may retry.
 */
async function downloadLatestViaUpdater({ timeoutMs, expectedCheck, signal } = {}, onProgress, deps = {}) {
  const CancellationToken = deps.CancellationToken || require('builder-util-runtime').CancellationToken;
  const tracker = makeDifferentialTracker();
  let autoUpdater;
  let releaseRequests;
  let restoreBlockmapFiles;
  let pendingPreparation;
  let pendingCheck;
  let pendingTransfer;

  const onProgressEvent = (progress) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    const percent = Math.max(0, Math.min(99, Math.round(Number(progress && progress.percent) || 0)));
    const metrics = {};
    for (const [source, target] of [['transferred', 'received'], ['total', 'total'], ['bytesPerSecond', 'bytesPerSecond']]) {
      const value = progress?.[source];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) metrics[target] = value;
    }
    onProgress({ phase: 'download', percent, differential: true, ...metrics });
  };
  const onErrorEvent = () => {};
  const setTimeoutFn = deps.setTimeout || setTimeout;
  const clearTimeoutFn = deps.clearTimeout || clearTimeout;
  const timeoutSentinel = Symbol('updater-timeout');
  let cancelled = false;
  let timeoutHandle;
  const token = new CancellationToken();
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const abortSentinel = Symbol('updater-cancelled');
  let resolveAbort;
  const abortPromise = new Promise((resolve) => { resolveAbort = resolve; });
  const onAbort = () => {
    token.cancel();
    resolveAbort(abortSentinel);
  };
  requestSignal.addEventListener('abort', onAbort, { once: true });
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      cancelled = true;
      controller.abort();
      try {
        token.cancel();
      } catch {
        // a stuck token must not block the timeout result
      }
      resolve(timeoutSentinel);
    }, Math.max(1_000, Number(timeoutMs) || DEFAULT_DOWNLOAD_TIMEOUT_MS));
  });
  // Metadata checks have no caller-supplied token. Race cancellation too;
  // the request binding closes their sockets and prevents late requests.
  const timed = async (pending) => {
    const result = await Promise.race([pending, timeoutPromise, abortPromise]);
    if (result === abortSentinel) throw Object.assign(new Error('下载已取消'), { name: 'AbortError' });
    return result;
  };
  const timeoutOutcome = () => ({
    ok: false,
    reason: 'timeout',
    message: `下载超时（${Math.round((Number(timeoutMs) || DEFAULT_DOWNLOAD_TIMEOUT_MS) / 60_000)} 分钟）`,
  });

  try {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    pendingPreparation = differentialAvailability(expectedCheck, { ...deps, signal: requestSignal });
    const available = await timed(pendingPreparation);
    if (available === timeoutSentinel || cancelled) return timeoutOutcome();
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    if (!available.ok) return available;
    autoUpdater = available.autoUpdater;
    releaseRequests = bindUpdaterRequests(autoUpdater.httpExecutor, requestSignal, deps);
    const feed = feedFor(expectedCheck);
    // electron-updater 6.8.9 rebuilds its client from app-update.yml when this is null.
    if (feed) autoUpdater.setFeedURL(feed); else autoUpdater.clientPromise = null;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.disableDifferentialDownload = false;
    autoUpdater.logger = makeLogger(tracker, deps.logger || null);
    autoUpdater.on('download-progress', onProgressEvent);
    // Keep EventEmitter errors observed; promise rejections carry the failure.
    autoUpdater.on('error', onErrorEvent);
    pendingCheck = autoUpdater.checkForUpdates();
    const check = await timed(pendingCheck);
    if (check === timeoutSentinel) {
      return timeoutOutcome();
    }
    const info = check && (check.updateInfo
      || (check.updateInfoAndProvider && check.updateInfoAndProvider.info)
      || null);
    if (!info || !info.version) {
      return { ok: false, reason: 'no-update-in-manifest' };
    }
    const updateInfoAndProvider = autoUpdater.updateInfoAndProvider;
    assertConfirmedTarget({ ...updateInfoAndProvider, info }, expectedCheck);
    assertConfirmedTarget(updateInfoAndProvider, expectedCheck);
    if (available.blockmapUrl) {
      // The old asset may have a different product name or release directory.
      // Use the release whose installer bytes were verified during preparation.
      const provider = updateInfoAndProvider.provider;
      const getBlockMapFiles = provider.getBlockMapFiles;
      provider.getBlockMapFiles = () => [new URL(available.blockmapUrl), new URL(expectedCheck.blockmapUrl)];
      restoreBlockmapFiles = () => { provider.getBlockMapFiles = getBlockMapFiles; };
    }
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    autoUpdater.confirmedDownloadTarget = expectedCheck;
    pendingTransfer = autoUpdater.downloadUpdate(token);
    const downloaded = await timed(pendingTransfer);
    if (downloaded === timeoutSentinel) {
      return timeoutOutcome();
    }
    const installer = Array.isArray(downloaded) && downloaded.find((file) => typeof file === 'string' && /\.exe$/i.test(file));
    if (!installer) return { ok: false, reason: 'missing-downloaded-installer' };
    const result = tracker.finish();
    return {
      ok: true,
      installer,
      differential: result.differential,
      downloadPercent: result.downloadPercent,
      version: String(info.version),
    };
  } catch (error) {
    if (cancelled) {
      return timeoutOutcome();
    }
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    return { ok: false, reason: error?.code || 'updater-error', message: `${error?.message || String(error)} 增量下载已停止，可重新选择完全下载。` };
  } finally {
    // Destroyed Range requests must finish library cleanup before an explicit
    // retry can reuse its pending directory. Late metadata stays on this
    // operation's discarded updater instance.
    if (requestSignal.aborted) {
      await pendingPreparation?.catch(() => {});
      if (autoUpdater?.httpExecutor?.createRequest) await pendingCheck?.catch(() => {});
      await pendingTransfer?.catch(() => {});
    }
    releaseRequests?.(Boolean(pendingTransfer || autoUpdater?.httpExecutor?.createRequest));
    restoreBlockmapFiles?.();
    requestSignal.removeEventListener('abort', onAbort);
    if (autoUpdater) autoUpdater.confirmedDownloadTarget = undefined;
    clearTimeoutFn(timeoutHandle);
    try {
      autoUpdater?.removeListener('download-progress', onProgressEvent);
      autoUpdater?.removeListener('error', onErrorEvent);
    } catch {
      // listener cleanup must never mask the result
    }
  }
}

module.exports = {
  downloadLatestViaUpdater,
  feedFor,
  differentialAvailability,
  strictNsisUpdaterClass,
  cachedInstallerPath,
  prepareDifferentialBase,
  makeDifferentialTracker,
};
