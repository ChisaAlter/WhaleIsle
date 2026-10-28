'use strict';

// Download routes for the managed DSHD runtime. Both mirrors carry the same
// release bytes; the signed catalog (C batch) is the version authority on top
// of these endpoints. Selecting a route must drive every fetch — metadata,
// installer, checksum — through that route's host only.
const update = require('../main/update');
const { systemFetch } = require('../main/system-proxy');
const deltaManifest = require('./delta/manifest');

const ROUTES = {
  github: {
    id: 'github',
    label: 'GitHub',
    detail: '国外线路 · GitHub Releases 直连',
    verified: true,
    apiBase: 'https://api.github.com/repos/ChisaAlter/WhaleIsle',
    page: update.RELEASES_PAGE,
  },
  cnb: {
    id: 'cnb',
    label: 'CNB',
    detail: '国内线路 · CNB 镜像',
    // Public metadata uses cnb.cool; api.cnb.cool requires a token.
    // v0.3.3 original attachments passed anonymous size and SHA512 parity.
    verified: true,
    apiBase: 'https://cnb.cool/ayasealter/WhaleIsle/-',
    page: 'https://cnb.cool/ayasealter/WhaleIsle/-/releases',
  },
};

function normalizeRoute(value) {
  const saved = String(value || '').trim().toLowerCase();
  const key = saved === 'gitee' ? 'cnb' : saved;
  return ROUTES[key] ? key : '';
}

// GitHub release hosts are often unreachable without a proxy in mainland China.
const CHINA_TIME_ZONES = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin',
  'Asia/Urumqi', 'Asia/Kashgar', 'PRC']);

function systemRegion() {
  try {
    const { app } = require('electron');
    if (!app?.isReady?.()) return null;
    return {
      locale: app.getSystemLocale?.() || app.getLocale?.() || '',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    };
  } catch {
    return null;
  }
}

/**
 * Route used until the user picks one: CNB on mainland-China systems
 * (Simplified Chinese locale or a China time zone), GitHub elsewhere and
 * outside a ready Electron app.
 */
function defaultRoute(region = systemRegion()) {
  if (!region) return 'github';
  return /^zh-(cn|hans)\b/i.test(region.locale || '') || CHINA_TIME_ZONES.has(region.timeZone) ? 'cnb' : 'github';
}

function listRoutes() {
  return Object.values(ROUTES).map(({ id, label, detail, verified, page }) => ({
    id,
    label,
    detail,
    verified,
    page,
  }));
}

async function cnbJson(url, timeoutMs = update.CHECK_TIMEOUT_MS, { signal } = {}) {
  let response;
  try {
    response = await systemFetch(url, {
      headers: {
        Accept: 'application/vnd.cnb.api+json',
        'User-Agent': `Deepseek-Harness-Desktop/${update.currentVersion()}`,
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`CNB 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw error;
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`CNB ${response.status}`);
  }
  return response.json();
}

function fetchJson(route, url, timeoutMs, options) {
  return route === 'cnb' ? cnbJson(url, timeoutMs, options) : update.githubJson(url, timeoutMs, options);
}

// Both providers expose GitHub-shaped release fields.
function normalizeAssets(release) {
  if (!release || !Array.isArray(release.assets)) {
    return release;
  }
  return {
    ...release,
    assets: release.assets.map((asset) => ({
      ...asset,
      browser_download_url: asset?.browser_download_url || asset?.download_url || '',
    })),
  };
}

// A release row is delta-eligible when it ships
// `<product>-delta-<installedVersion>-<toVersion>.zip`; install.js re-picks
// the same asset at apply time, so the row only carries display fields.
function deltaInfoForRow(release, installedVersion, toVersion) {
  const from = update.normalizeVersion(installedVersion || '');
  const to = update.normalizeVersion(toVersion || '');
  if (!from || !to || !Array.isArray(release?.assets)) {
    return null;
  }
  for (const asset of release.assets) {
    const parsed = deltaManifest.parseDeltaAssetName(asset?.name || '');
    if (parsed
      && update.normalizeVersion(parsed.from) === from
      && update.normalizeVersion(parsed.to) === to) {
      return {
        name: asset.name,
        from: parsed.from,
        to: parsed.to,
        size: typeof asset.size === 'number' ? asset.size : 0,
      };
    }
  }
  return null;
}

function summarizeForRoute(route, release, installedVersion) {
  const normalized = normalizeAssets(release);
  const summary = update.summarizeRelease(normalized, installedVersion || '');
  if (!summary) {
    return null;
  }
  const desc = ROUTES[route];
  // Prototype row meta needs the publish date + installer size; summarizeRelease
  // drops the assets, so re-locate the picked installer by its name.
  const installer = (Array.isArray(normalized?.assets) ? normalized.assets : []).find(
    (asset) => asset && asset.name === summary.assetName,
  );
  return {
    ...summary,
    delta: deltaInfoForRow(release, installedVersion, summary.tag || summary.version),
    publishedAt: release.published_at || release.created_at || '',
    assetSize: typeof installer?.size === 'number' ? installer.size : 0,
    htmlUrl: release.html_url || desc.page,
    route,
  };
}

function routeSnapshot(route, extra = {}) {
  const desc = ROUTES[route];
  return {
    route,
    repoUrl: desc.page.replace(/(?:\/-)?\/releases$/, ''),
    releasesUrl: desc.page,
    ...extra,
  };
}

// Raw release payload with assets intact (releaseFor's summary drops them).
// Mirror uploads are staged as prereleases. Select stable versions by version
// number so a later backfill of an older release does not become the update.
async function releaseRaw(route, tag, { timeoutMs, signal } = {}) {
  const desc = ROUTES[route];
  if (!desc) {
    return null;
  }
  if (tag) {
    const release = await fetchJson(
      route,
      `${desc.apiBase}/releases/tags/${encodeURIComponent(String(tag).trim())}`,
      timeoutMs,
      { signal },
    );
    return route === 'cnb' && (release?.draft || release?.prerelease) ? null : release;
  }
  if (route === 'cnb') {
    const list = await fetchJson(route, `${desc.apiBase}/releases?page_size=30`, timeoutMs, { signal });
    return (Array.isArray(list) ? list : [])
      .filter((row) => row && !row.draft && !row.prerelease)
      .sort((a, b) => update.compareVersions(b.tag_name, a.tag_name))[0] || null;
  }
  return fetchJson(route, `${desc.apiBase}/releases/latest`, timeoutMs, { signal });
}

async function latestFor(route, { installedVersion = '', timeoutMs, signal } = {}) {
  const desc = ROUTES[route];
  if (!desc) {
    return routeSnapshot('github', { status: 'error', message: 'unknown-route' });
  }
  try {
    const release = await releaseRaw(route, null, { timeoutMs, signal });
    if (!release) {
      return routeSnapshot(route, { status: 'none', latest: '', assetName: '', assetUrl: '', htmlUrl: desc.page });
    }
    const summary = summarizeForRoute(route, release, installedVersion);
    const newer = summary?.version ? update.compareVersions(summary.version, installedVersion || '0') > 0 : false;
    return routeSnapshot(route, {
      status: newer ? 'available' : 'current',
      current: installedVersion,
      latest: summary?.version || '',
      tag: summary?.tag || '',
      htmlUrl: summary?.htmlUrl || desc.page,
      notes: summary?.notes || '',
      assetName: summary?.assetName || '',
      assetUrl: summary?.assetUrl || '',
      checksumUrl: summary?.checksumUrl || '',
    });
  } catch (error) {
    return routeSnapshot(route, {
      status: 'error',
      latest: '',
      assetName: '',
      assetUrl: '',
      htmlUrl: desc.page,
      message: error.message || String(error),
    });
  }
}

async function listFor(route, { installedVersion = '', timeoutMs } = {}) {
  const desc = ROUTES[route];
  if (!desc) {
    return routeSnapshot('github', { status: 'error', releases: [], message: 'unknown-route' });
  }
  try {
    const list = await fetchJson(route, `${desc.apiBase}/releases?${route === 'cnb' ? 'page_size' : 'per_page'}=30`, timeoutMs);
    const releases = (Array.isArray(list) ? list : [])
      .filter((row) => route !== 'cnb' || (!row?.draft && !row?.prerelease))
      .map((row) => summarizeForRoute(route, row, installedVersion))
      .filter(Boolean);
    return routeSnapshot(route, { status: 'ok', releases });
  } catch (error) {
    return routeSnapshot(route, {
      status: 'error',
      releases: [],
      message: error.message || String(error),
    });
  }
}

async function releaseFor(route, tag, { installedVersion = '', timeoutMs, signal } = {}) {
  const release = await releaseRaw(route, tag, { timeoutMs, signal });
  return release ? summarizeForRoute(route, release, installedVersion) : null;
}

module.exports = {
  ROUTES,
  normalizeRoute,
  defaultRoute,
  listRoutes,
  normalizeAssets,
  latestFor,
  listFor,
  releaseFor,
  releaseRaw,
  summarizeForRoute,
};
