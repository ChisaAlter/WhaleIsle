'use strict';

// Download routes for the managed DSHD runtime. Both mirrors carry the same
// release bytes; the signed catalog (C batch) is the version authority on top
// of these endpoints. Selecting a route must drive every fetch — metadata,
// installer, checksum — through that route's host only.
const update = require('../main/update');
const deltaManifest = require('./delta/manifest');

const ROUTES = {
  github: {
    id: 'github',
    label: 'GitHub',
    detail: '国外线路 · GitHub Releases 直连',
    verified: true,
    apiBase: 'https://api.github.com/repos/ChisaAlter/Deepseek-Harness-Desktop',
    page: update.RELEASES_PAGE,
  },
  gitee: {
    id: 'gitee',
    label: 'Gitee',
    detail: '国内线路 · Gitee 镜像',
    // Anonymous parity proven (docs/superpowers/evidence/gitee-parity.md):
    // release metadata, browser_download_url redirect chain and SHA512SUMS
    // manifest all resolve without credentials.
    verified: true,
    apiBase: 'https://gitee.com/api/v5/repos/ayase/Deepseek-Harness-Desktop',
    page: 'https://gitee.com/ayase/Deepseek-Harness-Desktop/releases',
  },
};

function normalizeRoute(value) {
  const key = String(value || '').trim().toLowerCase();
  return ROUTES[key] ? key : '';
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

async function giteeJson(url, timeoutMs = update.CHECK_TIMEOUT_MS) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `Deepseek-Harness-Desktop/${update.currentVersion()}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`Gitee 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw error;
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Gitee ${response.status}`);
  }
  return response.json();
}

function fetchJson(route, url, timeoutMs) {
  return route === 'gitee' ? giteeJson(url, timeoutMs) : update.githubJson(url, timeoutMs);
}

// Gitee release objects mirror GitHub's shape for the fields we use
// (tag_name, name, body, prerelease, assets[].browser_download_url); tolerate
// the alternate download_url key just in case.
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
    repoUrl: desc.page.replace(/\/releases$/, ''),
    releasesUrl: desc.page,
    ...extra,
  };
}

// Raw release payload with assets intact (releaseFor's summary drops them).
// Gitee's /releases/latest returns prereleases (GitHub's does not) — proven in
// the parity evidence — so on gitee the no-tag form picks the first non-draft
// non-prerelease row of the list instead of trusting /latest.
async function releaseRaw(route, tag, { timeoutMs } = {}) {
  const desc = ROUTES[route];
  if (!desc) {
    return null;
  }
  if (tag) {
    const release = await fetchJson(
      route,
      `${desc.apiBase}/releases/tags/${encodeURIComponent(String(tag).trim())}`,
      timeoutMs,
    );
    return route === 'gitee' && release?.prerelease ? null : release;
  }
  if (route === 'gitee') {
    const list = await fetchJson(route, `${desc.apiBase}/releases?per_page=30&direction=desc`, timeoutMs);
    return (Array.isArray(list) ? list : [])
      .filter((row) => row && !row.draft && !row.prerelease)
      .sort((a, b) => update.compareVersions(b.tag_name, a.tag_name))[0] || null;
  }
  return fetchJson(route, `${desc.apiBase}/releases/latest`, timeoutMs);
}

async function latestFor(route, { installedVersion = '', timeoutMs } = {}) {
  const desc = ROUTES[route];
  if (!desc) {
    return routeSnapshot('github', { status: 'error', message: 'unknown-route' });
  }
  try {
    const release = await releaseRaw(route, null, { timeoutMs });
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
    const list = await fetchJson(route, `${desc.apiBase}/releases?per_page=30${route === 'gitee' ? '&direction=desc' : ''}`, timeoutMs);
    const releases = (Array.isArray(list) ? list : [])
      .filter((row) => route !== 'gitee' || !row?.prerelease)
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

async function releaseFor(route, tag, { installedVersion = '', timeoutMs } = {}) {
  const release = await releaseRaw(route, tag, { timeoutMs });
  return release ? summarizeForRoute(route, release, installedVersion) : null;
}

module.exports = {
  ROUTES,
  normalizeRoute,
  listRoutes,
  latestFor,
  listFor,
  releaseFor,
  releaseRaw,
  summarizeForRoute,
};
