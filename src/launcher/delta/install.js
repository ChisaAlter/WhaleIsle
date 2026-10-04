'use strict';

// Delta install orchestration for shell:install-delta: resolve the release
// through the configured download route, pick its `<product>-delta-<from>-
// <to>.zip` asset, download + SHA512SUMS-verify it, then apply onto the
// installed runtime directory. ANY delta-side failure routes to the same
// full-installer path as a normal install and reports mode:'full' — the
// renderer never has to distinguish a delta shortfall from a regular update.
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

function fullFallbackOk(result) {
  return Boolean(result) && (result.ok === true
    || result.launched === true
    || result.status === 'installed'
    || result.status === 'waiting'
    || result.status === 'quit-pending');
}

function defaultDeltaDir() {
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
 * @returns {Promise<{ok:boolean, mode:'delta'|'full', error?:string}>}
 */
async function installDelta(tag, onProgress, deps = {}) {
  const progress = (payload) => {
    if (typeof onProgress === 'function') {
      onProgress(payload);
    }
  };
  const fullInstall = typeof deps.fullInstall === 'function'
    ? deps.fullInstall
    : async () => ({ ok: false, error: 'no-full-installer' });
  let resolvedTag = String(tag || '').trim();
  const fallback = async (reason) => {
    progress({ phase: 'install', percent: 0, deltaFallback: reason });
    let result;
    try {
      result = await fullInstall(resolvedTag, progress);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    const ok = fullFallbackOk(result);
    return {
      ...(result && typeof result === 'object' ? result : {}),
      ok,
      mode: 'full',
      deltaFallback: reason,
      ...(ok ? {} : { error: result?.error || result?.message || reason }),
    };
  };

  try {
    progress({ phase: 'resolve', percent: 0, delta: true });
    const launcherPackage = typeof deps.isLauncherPackage === 'function'
      ? deps.isLauncherPackage()
      : isLauncherPackage();
    if (!launcherPackage) {
      // The full package cannot patch its own running install dir — the
      // self-update installer path owns that case.
      return fallback('unsupported-package');
    }
    const installed = typeof deps.installedInfo === 'function'
      ? await deps.installedInfo({ fresh: true })
      : runtimeInstall.installedInfo({ fresh: true });
    if (!installed?.registeredInstall || !installed.installPath) {
      return fallback('no-installed-base');
    }
    const probe = typeof deps.probeDesktopRunning === 'function'
      ? deps.probeDesktopRunning
      : () => runtimeInstall.probeDesktopRunning();
    if (probe()) {
      const stop = typeof deps.stopDesktop === 'function'
        ? deps.stopDesktop
        : () => runtimeInstall.stopExternalDesktop();
      const stopResult = await stop();
      if (probe()) {
        // The desktop declined or could not exit — the full-installer path
        // would just re-prompt through the same handshake, so report the
        // outcome directly instead of falling back.
        return {
          ok: false,
          mode: 'delta',
          error: stopResult?.error || 'runtime-busy',
          cancelled: stopResult?.cancelled === true,
          message: stopResult?.message,
        };
      }
    }

    const route = releaseSource.normalizeRoute(deps.route)
      || runtimeInstall.configuredRoute(deps)
      || 'github';
    const release = await fetchRelease(route, resolvedTag, deps);
    if (!release || release.draft) {
      return fallback('release-not-found');
    }
    resolvedTag = release.tag_name || release.name || resolvedTag;
    const toVersion = update.normalizeVersion(release.tag_name || release.name);
    const asset = pickDeltaAsset(release.assets, installed.version, toVersion);
    if (!asset) {
      return fallback('delta-asset-missing');
    }
    const checksumUrl = pickChecksumUrl(release.assets);
    if (!checksumUrl) {
      return fallback('delta-unverified');
    }

    const deltaDir = deps.deltaDir || defaultDeltaDir();
    if (!deltaDir) {
      return fallback('no-delta-dir');
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
      { onProgress: progress },
      deps,
    );
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
    return fallback(error?.code || error?.message || 'delta-failed');
  }
}

module.exports = { installDelta, pickDeltaAsset, pickChecksumUrl, fetchRelease };
