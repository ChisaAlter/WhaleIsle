'use strict';

const { compareVersions } = require('../components/registry');
const { MAX_BINARY_BYTES, platformAssetName } = require('./platform');

const GITHUB_RELEASES = 'https://github.com/yetone/magpie/releases';
const CNB_TAG_PREFIX = 'magpie-v';
const MAGPIE_LICENSE = 'MIT License';

/**
 * Parse `SHA256SUMS` lines (`<64hex>  <filename>`) into a filename -> sha256 map.
 * Rejects malformed or duplicate entries.
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseSha256Sums(text) {
  const sums = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?([\w.-]+)$/.exec(line);
    if (!match) {
      throw new Error(`Magpie SHA256SUMS 格式无效：${line}`);
    }
    const name = match[2];
    const digest = match[1].toLowerCase();
    if (sums.has(name)) {
      throw new Error(`Magpie SHA256SUMS 存在重复条目：${name}`);
    }
    sums.set(name, digest);
  }
  if (sums.size === 0) {
    throw new Error('Magpie SHA256SUMS 为空');
  }
  return sums;
}

/**
 * @returns {(url: string, init?: RequestInit) => Promise<Response>}
 */
function defaultFetch() {
  try {
    const proxy = require('../../main/system-proxy');
    if (typeof proxy?.systemFetch === 'function') return proxy.systemFetch;
  } catch {
    // Unit tests outside Electron fall back to global fetch.
  }
  return (url, init) => fetch(url, init);
}

/**
 * @param {string} url
 * @param {{ fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>, headers?: Record<string, string>, redirect?: RequestRedirect }} [options]
 * @returns {Promise<Response>}
 */
async function httpGet(url, options = {}) {
  const doFetch = options.fetchImpl || defaultFetch();
  const response = await doFetch(url, {
    headers: options.headers,
    redirect: options.redirect || 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  return response;
}

/**
 * @param {string} text
 * @returns {string}
 */
function extractTagVersion(text) {
  const match = /\/releases\/tag\/v(\d+\.\d+\.\d+)\b/.exec(String(text || ''));
  return match ? match[1] : '';
}

/**
 * Resolve latest official Magpie release via GitHub web redirect (no REST API quota).
 * @param {{ asset: string, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} options
 */
async function resolveGithubLatest({ asset, fetchImpl }) {
  const latestResp = await httpGet(`${GITHUB_RELEASES}/latest`, {
    fetchImpl,
    redirect: 'manual',
    headers: { Accept: 'text/html' },
  });
  let version = '';
  if (latestResp.status >= 300 && latestResp.status < 400) {
    version = extractTagVersion(latestResp.headers.get('location') || '');
    await latestResp.body?.cancel?.().catch(() => { /* ignore unused redirect body */ });
  } else if (latestResp.ok) {
    version = extractTagVersion(latestResp.url || '');
    if (!version) {
      version = extractTagVersion(await latestResp.text());
    }
  } else {
    throw new Error(`检查 Magpie 最新版本失败：HTTP ${latestResp.status}`);
  }
  if (!version) {
    throw new Error('未能从 GitHub 发布页解析 Magpie 最新版本号');
  }
  const tag = `v${version}`;
  const sumsResp = await httpGet(`${GITHUB_RELEASES}/download/${tag}/SHA256SUMS`, { fetchImpl });
  if (!sumsResp.ok) {
    throw new Error(`下载 Magpie SHA256SUMS 失败：HTTP ${sumsResp.status}`);
  }
  const sums = parseSha256Sums(await sumsResp.text());
  const sha256 = sums.get(asset);
  if (!sha256) {
    throw new Error(`Magpie ${tag} 校验清单缺少平台资产 ${asset}`);
  }
  return {
    id: 'magpie',
    version,
    tag,
    asset,
    sha256,
    size: null,
    url: `${GITHUB_RELEASES}/download/${tag}/${asset}`,
    releaseUrl: `${GITHUB_RELEASES}/tag/${tag}`,
    route: 'github',
    license: MAGPIE_LICENSE,
  };
}

/**
 * Resolve latest mirrored Magpie release from CNB (`magpie-vX.Y.Z` tag scheme).
 * @param {{ asset: string, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} options
 */
async function resolveCnbLatest({ asset, fetchImpl }) {
  const source = require('../release-source');
  const apiBase = source.ROUTES.cnb.apiBase;
  const resp = await httpGet(`${apiBase}/releases?page_size=100`, {
    fetchImpl,
    headers: { Accept: 'application/vnd.cnb.api+json' },
  });
  if (!resp.ok) {
    throw new Error(`查询 CNB Magpie 发布列表失败：HTTP ${resp.status}`);
  }
  const releases = await resp.json();
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === 'string' && r.tag_name.startsWith(CNB_TAG_PREFIX))
    .map((r) => ({ release: r, version: r.tag_name.slice(CNB_TAG_PREFIX.length) }))
    .filter((item) => /^\d+\.\d+\.\d+$/.test(item.version))
    .sort((a, b) => compareVersions(b.version, a.version));
  if (candidates.length === 0) {
    throw new Error('Magpie 组件尚未同步到当前 CNB 线路');
  }
  const { release, version } = candidates[0];
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const sumsAsset = assets.find((/** @type {any} */ a) => a?.name === 'SHA256SUMS');
  const binAsset = assets.find((/** @type {any} */ a) => a?.name === asset);
  if (!sumsAsset || !binAsset) {
    throw new Error(`CNB Magpie ${release.tag_name} 缺少 SHA256SUMS 或平台资产 ${asset}`);
  }
  if (typeof binAsset.size === 'number' && (binAsset.size <= 0 || binAsset.size > MAX_BINARY_BYTES)) {
    throw new Error(`CNB Magpie 资产大小超出限制：${binAsset.size}`);
  }
  const sumsUrl = sumsAsset.browser_download_url || sumsAsset.download_url;
  const binUrl = binAsset.browser_download_url || binAsset.download_url;
  const sumsResp = await httpGet(sumsUrl, { fetchImpl });
  if (!sumsResp.ok) {
    throw new Error(`下载 CNB Magpie SHA256SUMS 失败：HTTP ${sumsResp.status}`);
  }
  const sums = parseSha256Sums(await sumsResp.text());
  const sha256 = sums.get(asset);
  if (!sha256) {
    throw new Error(`CNB Magpie ${release.tag_name} SHA256SUMS 缺少 ${asset}`);
  }
  return {
    id: 'magpie',
    version,
    tag: release.tag_name,
    asset,
    sha256,
    size: typeof binAsset.size === 'number' ? binAsset.size : null,
    url: binUrl,
    releaseUrl: `${GITHUB_RELEASES}/tag/v${version}`,
    route: 'cnb',
    license: MAGPIE_LICENSE,
  };
}

/**
 * Resolve local devPackage directory containing `SHA256SUMS` + binary + optional `VERSION`.
 * @param {{ devPackage: string, asset: string }} options
 */
function resolveDevPackage({ devPackage, asset }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const sumsFile = path.join(devPackage, 'SHA256SUMS');
  if (!fs.existsSync(sumsFile)) {
    return null;
  }
  const sums = parseSha256Sums(fs.readFileSync(sumsFile, 'utf8'));
  const sha256 = sums.get(asset);
  if (!sha256) {
    throw new Error(`本地 Magpie 开发包缺少平台资产 ${asset}`);
  }
  const versionFile = path.join(devPackage, 'VERSION');
  const version = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/i, '')
    : '0.0.0-dev';
  const binPath = path.join(devPackage, asset);
  if (!fs.existsSync(binPath)) {
    throw new Error(`本地 Magpie 开发包缺少二进制文件 ${asset}`);
  }
  const size = fs.statSync(binPath).size;
  if (size <= 0 || size > MAX_BINARY_BYTES) {
    throw new Error(`本地 Magpie 二进制大小无效：${size}`);
  }
  return {
    id: 'magpie',
    version,
    tag: `v${version}`,
    asset,
    sha256,
    size,
    localDir: devPackage,
    releaseUrl: `${GITHUB_RELEASES}/tag/v${version}`,
    route: 'development',
    license: MAGPIE_LICENSE,
  };
}

/**
 * @param {{ route?: string, platform?: string, arch?: string, devPackage?: string, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 */
async function resolveLatestMagpieRelease(options = {}) {
  const asset = platformAssetName(options.platform, options.arch);
  if (!asset) {
    throw new Error(`当前平台暂不支持 Magpie：${options.platform || process.platform}-${options.arch || process.arch}`);
  }
  if (options.devPackage) {
    const dev = resolveDevPackage({ devPackage: options.devPackage, asset });
    if (dev) return dev;
  }
  const route = options.route || 'github';
  if (route === 'cnb') {
    return resolveCnbLatest({ asset, fetchImpl: options.fetchImpl });
  }
  return resolveGithubLatest({ asset, fetchImpl: options.fetchImpl });
}

module.exports = {
  GITHUB_RELEASES,
  parseSha256Sums,
  resolveLatestMagpieRelease,
};
