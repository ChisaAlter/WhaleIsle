'use strict';

// Wires the update center to the real release routes, downloader, delta
// updater and installer (docs/features/update-center.md).

const { gunzipSync } = require('zlib');
const { createUpdateCenter } = require('./service');

const BLOCKMAP_TIMEOUT_MS = 30_000;

async function fetchBlockmap(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(BLOCKMAP_TIMEOUT_MS) });
  if (!response.ok) throw Object.assign(new Error(`blockmap HTTP ${response.status}`), { code: `HTTP_ERROR_${response.status}` });
  return JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
}

/**
 * Exact bytes a differential download of `target` needs from the verified
 * local base: the same block plan electron-updater executes.
 */
async function planDelta(target, deps = {}) {
  const updater = deps.updater || require('../update-updater');
  const available = await updater.differentialAvailability({ ...target, latest: target.version });
  if (!available.ok) return { ok: false, reason: available.reason || 'unavailable', message: available.message };
  const fetchImpl = deps.fetch || require('../system-proxy').systemFetch;
  const [oldMap, newMap] = await Promise.all([
    fetchBlockmap(available.blockmapUrl, fetchImpl),
    fetchBlockmap(target.blockmapUrl, fetchImpl),
  ]);
  const { computeOperations, OperationKind } = deps.planBuilder
    || require('electron-updater/out/differentialDownloader/downloadPlanBuilder');
  const quiet = { info() {}, warn() {}, debug() {} };
  let downloadBytes = 0;
  for (const operation of computeOperations(oldMap, newMap, quiet)) {
    if (operation.kind === OperationKind.DOWNLOAD) downloadBytes += operation.end - operation.start;
  }
  return { ok: true, downloadBytes };
}

function createDesktopUpdateCenter({ app, loadConfig, saveConfig, taskProtection, log = () => {} }) {
  const update = require('../update');
  const updater = require('../update-updater');
  const releaseSource = require('../../launcher/release-source');
  const configuredRoute = () => releaseSource.normalizeRoute(loadConfig().downloadRoute);
  const info = (target) => ({ ...target, latest: target.version });
  return createUpdateCenter({
    userDataDir: app.getPath('userData'),
    currentVersion: () => update.currentVersion(),
    routes: releaseSource.listRoutes().map(({ id, label, detail }) => ({ id, label, detail })),
    getRoute: () => configuredRoute() || releaseSource.defaultRoute(),
    isRouteExplicit: () => Boolean(configuredRoute()),
    saveRoute: (route) => saveConfig({ downloadRoute: route }),
    getAutoDownload: () => loadConfig().autoDownloadUpdates !== false,
    saveAutoDownload: (enabled) => saveConfig({ autoDownloadUpdates: enabled }),
    resolveRelease: (route, tag) => releaseSource.releaseFor(route, tag || null, { installedVersion: update.currentVersion() }),
    planDelta: (target) => planDelta(target, { updater }),
    readChecksum: (name, url, options) => update.readAssetChecksum(name, url, options),
    downloadFile: (url, dest, onProgress, options) => update.downloadFile(url, dest, onProgress, options),
    verifyFile: (file, expected, options) => update.verifyFileChecksum(file, expected, options),
    downloadDelta: (target, onProgress, { signal }) => updater.downloadLatestViaUpdater(
      { timeoutMs: update.DOWNLOAD_TIMEOUT_MS, expectedCheck: info(target), signal }, onProgress),
    install: (target, file, { installerArgs }) => update.launchPreparedInstaller(info(target), file, () => {}, {
      taskProtection, quitAfterInstall: app.isPackaged, installerArgs,
    }),
    compareVersions: update.compareVersions,
    log,
  });
}

module.exports = { createDesktopUpdateCenter, planDelta };
