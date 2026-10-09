'use strict';

// The explicit NSIS differential channel. update.js owns whole-file downloads,
// SHA512 verification and the protected installation commit. This wrapper must
// never substitute a whole-file transfer when the user selected incremental.

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let strictUpdater;

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
  if (basename !== expectedCheck.assetName || fileInfo.packageInfo) {
    throw Object.assign(new Error('更新清单安装包与确认的版本不一致，请重新检查更新。'), { code: 'asset-changed' });
  }
}

/** electron-updater 6.8.9 returns true when its differential path failed. */
function strictNsisUpdaterClass(NsisUpdater) {
  return class StrictNsisUpdater extends NsisUpdater {
    doDownloadUpdate(options) {
      // Bind again at the actual library boundary, before a cache or transfer
      // can be selected from its mutable updateInfoAndProvider field.
      assertConfirmedTarget(options.updateInfoAndProvider, this.confirmedDownloadTarget);
      return super.doDownloadUpdate({
        ...options, disableWebInstaller: true, disableDifferentialDownload: false,
      });
    }

    async differentialDownloadInstaller(...args) {
      const needsFullDownload = await super.differentialDownloadInstaller(...args);
      if (needsFullDownload) {
        throw Object.assign(new Error('增量更新失败，已停止下载。请重新选择完全下载。'), {
          code: 'ERR_UPDATER_DIFFERENTIAL_FAILED',
        });
      }
      return false;
    }
  };
}

function getStrictUpdater(deps) {
  if (deps.autoUpdater) return deps.autoUpdater;
  if (!strictUpdater) {
    const { NsisUpdater } = require('electron-updater');
    strictUpdater = new (strictNsisUpdaterClass(NsisUpdater))();
    strictUpdater.autoDownload = false;
    strictUpdater.autoInstallOnAppQuit = false;
    strictUpdater.disableWebInstaller = true;
    strictUpdater.disableDifferentialDownload = false;
  }
  return strictUpdater;
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
    const cachedInstaller = await cachedInstallerPath(autoUpdater);
    if (!(deps.existsSync || fs.existsSync)(cachedInstaller)) {
      return { ok: false, reason: 'missing-cached-installer', message: '未找到当前版本的安装包缓存，请选择完全下载。' };
    }
    return { ok: true, autoUpdater };
  } catch {
    return { ok: false, reason: 'updater-config-unavailable', message: '无法读取增量更新配置，请选择完全下载。' };
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
 *   `existsSync`, `CancellationToken`, `logger`, `setTimeout`/`clearTimeout`.
 * @returns {Promise<{ok:true, installer:string, differential:boolean, version:string}|{ok:false, reason:string}>}
 *   `ok:false` stops this action; only another explicit full choice may retry.
 */
async function downloadLatestViaUpdater({ timeoutMs, expectedCheck, signal } = {}, onProgress, deps = {}) {
  const available = await differentialAvailability(expectedCheck, deps);
  if (!available.ok) return available;
  const autoUpdater = available.autoUpdater;
  const CancellationToken = deps.CancellationToken || require('builder-util-runtime').CancellationToken;
  const tracker = makeDifferentialTracker();
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.logger = makeLogger(tracker, deps.logger || null);

  const onProgressEvent = (progress) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    const percent = Math.max(0, Math.min(99, Math.round(Number(progress && progress.percent) || 0)));
    onProgress({ phase: 'download', percent, differential: true });
  };
  const onErrorEvent = () => {};
  autoUpdater.on('download-progress', onProgressEvent);
  // 'error' must have a listener or EventEmitter throws unhandled; the
  // checkForUpdates/downloadUpdate rejections carry the real failure.
  autoUpdater.on('error', onErrorEvent);

  const setTimeoutFn = deps.setTimeout || setTimeout;
  const clearTimeoutFn = deps.clearTimeout || clearTimeout;
  const timeoutSentinel = Symbol('updater-timeout');
  let cancelled = false;
  let timeoutHandle;
  const token = new CancellationToken();
  const onAbort = () => token.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeoutFn(() => {
      cancelled = true;
      try {
        token.cancel();
      } catch {
        // a stuck token must not block the timeout result
      }
      resolve(timeoutSentinel);
    }, Math.max(1_000, Number(timeoutMs) || 15 * 60_000));
  });
  // checkForUpdates has no cancellation-token parameter — only the
  // race guarantees the wall-clock budget when the manifest fetch stalls.
  const timed = (pending) => Promise.race([pending, timeoutPromise]);
  const timeoutOutcome = () => ({
    ok: false,
    reason: 'timeout',
    message: `下载超时（${Math.round((Number(timeoutMs) || 15 * 60_000) / 60_000)} 分钟）`,
  });

  try {
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    const check = await timed(autoUpdater.checkForUpdates());
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
    if (signal?.aborted) return { ok: false, reason: 'cancelled', message: '下载已取消' };
    autoUpdater.confirmedDownloadTarget = expectedCheck;
    const downloaded = await timed(autoUpdater.downloadUpdate(token));
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
    signal?.removeEventListener('abort', onAbort);
    autoUpdater.confirmedDownloadTarget = undefined;
    clearTimeoutFn(timeoutHandle);
    try {
      autoUpdater.removeListener('download-progress', onProgressEvent);
      autoUpdater.removeListener('error', onErrorEvent);
    } catch {
      // listener cleanup must never mask the result
    }
  }
}

module.exports = {
  downloadLatestViaUpdater,
  differentialAvailability,
  strictNsisUpdaterClass,
  cachedInstallerPath,
  makeDifferentialTracker,
};
