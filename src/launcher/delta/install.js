'use strict';

// Delta install orchestration for shell:install-delta: resolve the release
// through the configured download route, pick its `<product>-delta-<from>-
// <to>.zip` asset, download + SHA512SUMS-verify it, then apply onto the
// installed runtime directory. Failures remain in the selected delta lane;
// the user can explicitly choose a full download afterwards.
const fs = require('fs');
const path = require('path');
const update = require('../../main/update');
const releaseSource = require('../release-source');
const runtimeInstall = require('../runtime-install');
const { isLauncherPackage } = require('../product');
const apply = require('./apply');
const manifest = require('./manifest');

// Delta asset enumeration needs the raw assets[] list (releaseFor's summary
// only carries installer+checksum) — release-source's releaseRaw keeps the
// route-aware fetch (including cnb's prerelease-skipping latest) in one
// place.
function fetchRelease(route, tag, deps = {}) {
  if (typeof deps.fetchRelease === 'function') {
    return deps.fetchRelease(route, tag);
  }
  return releaseSource.releaseRaw(route, tag, { timeoutMs: deps.timeoutMs });
}

function assetUrl(asset) {
  return asset?.browser_download_url || asset?.download_url || '';
}

function pickDeltaAsset(assets, fromVersion, toVersion) {
  const from = update.normalizeVersion(fromVersion);
  const to = update.normalizeVersion(toVersion);
  for (const asset of Array.isArray(assets) ? assets : []) {
    const parsed = manifest.parseDeltaAssetName(asset?.name || '');
    if (!parsed) {
      continue;
    }
    if (update.normalizeVersion(parsed.from) === from
      && update.normalizeVersion(parsed.to) === to
      && assetUrl(asset)) {
      return asset;
    }
  }
  return null;
}

function pickChecksumUrl(assets) {
  const found = update.pickChecksumAsset(assets);
  return found ? assetUrl(found) : '';
}

function defaultDeltaDir() {
  if (process.env.DSHD_DELTA_DIR) {
    return process.env.DSHD_DELTA_DIR;
  }
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'deltas');
  } catch {
    return '';
  }
}

/**
 * @param {string} tag release tag to update to ('' resolves latest)
 * @param {Function} onProgress shell:update-progress payloads
 * @returns {Promise<{ok:boolean, mode:'delta', error?:string}>}
 */
async function installDelta(tag, onProgress, deps = {}) {
  const progress = (payload) => {
    if (typeof onProgress === 'function') {
      onProgress(payload);
    }
  };
  let resolvedTag = String(tag || '').trim();
  const failed = (error) => ({ ok: false, mode: 'delta', error });

  try {
    progress({ phase: 'resolve', percent: 0, delta: true });
    const launcherPackage = typeof deps.isLauncherPackage === 'function'
      ? deps.isLauncherPackage()
      : isLauncherPackage();
    if (!launcherPackage) {
      // The full package cannot patch its own running install dir — the
      // self-update installer path owns that case.
      return failed('unsupported-package');
    }
    const installed = typeof deps.installedInfo === 'function'
      ? await deps.installedInfo({ fresh: true })
      : runtimeInstall.installedInfo({ fresh: true });
    if (!installed?.registeredInstall || !installed.installPath) {
      return failed('no-installed-base');
    }

    const route = releaseSource.normalizeRoute(deps.route)
      || runtimeInstall.configuredRoute(deps)
      || 'github';
    const release = await fetchRelease(route, resolvedTag, deps);
    if (!release || release.draft) {
      return failed('release-not-found');
    }
    resolvedTag = release.tag_name || release.name || resolvedTag;
    const toVersion = update.normalizeVersion(release.tag_name || release.name);
    const asset = pickDeltaAsset(release.assets, installed.version, toVersion);
    if (!asset) {
      return failed('delta-asset-missing');
    }
    const checksumUrl = pickChecksumUrl(release.assets);
    if (!checksumUrl) {
      return failed('delta-unverified');
    }

    const deltaDir = deps.deltaDir || defaultDeltaDir();
    if (!deltaDir) {
      return failed('no-delta-dir');
    }
    fs.mkdirSync(deltaDir, { recursive: true });
    const safeName = path.basename(asset.name).replace(/[^\w.\-]+/g, '_');
    const dest = path.join(deltaDir, safeName);

    const updateMod = deps.update || update;
    await updateMod.downloadFile(assetUrl(asset), dest, (payload) => {
      progress({ ...payload, phase: 'download', differential: true });
    }, { signal: deps.signal });
    progress({ phase: 'verify' });
    await updateMod.verifyAssetChecksum(dest, asset.name, checksumUrl);
    try {
      // Sidecar lets contributeStatus report the tag the cached artifact
      // belongs to (the filename only carries from/to versions).
      fs.writeFileSync(`${dest}.json`, JSON.stringify({ tag: resolvedTag, from: installed.version, to: toVersion }));
    } catch { /* status nicety only */ }

    const applied = await (deps.applyFile || apply.applyDeltaFile)(
      dest,
      installed.installPath,
      {
        onProgress: progress,
        expectedFromVersion: installed.version,
        expectedToVersion: toVersion,
        expectedProduct: asset.name.slice(0, asset.name.toLowerCase().lastIndexOf('-delta-')),
        beforeApply: deps.beforeApply,
      },
      deps,
    );
    if (applied?.ok === false) {
      return { ...applied, mode: 'delta' };
    }
    // A consumed artifact must not re-list as 'available' in status.
    try { fs.unlinkSync(dest); } catch { /* already gone */ }
    try { fs.unlinkSync(`${dest}.json`); } catch { /* none written */ }
    return {
      ok: true,
      mode: 'delta',
      tag: resolvedTag,
      from: installed.version,
      to: toVersion,
      applied: applied.applied,
    };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { ok: false, mode: 'delta', error: 'cancelled', cancelled: true };
    }
    return failed(error?.code || error?.message || 'delta-failed');
  }
}

module.exports = { installDelta, pickDeltaAsset, pickChecksumUrl, fetchRelease };
