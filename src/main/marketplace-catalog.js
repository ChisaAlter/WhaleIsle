const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { DROPPED, isDroppedPluginName } = require('./plugins');
const { isValidPackageName } = require('../host/install-dsh-plugin-client');
const { isAllowedMarketplaceSpec } = require('./marketplace-spec');
const { atomicWriteFileSync } = require('../shared/fs-safe');

const DEFAULT_REGISTRY_URL = 'https://awesome-dsh-plugin.com/plugins.json';
const CACHE_VERSION = 3;
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
// Upper bound on the registry download (the complete body, enforced while
// streaming): the live plugins.json is ~1–2 MB for ~2300 rows, so 8 MiB
// leaves headroom while a runaway or hostile endpoint cannot exhaust memory.
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const USER_AGENT = 'Deepseek-Harness-Desktop';
// Shipped offline fallback: a tiny curated subset of the registry so a
// first launch without network still shows a non-empty Discover tab. It is
// NOT a full registry mirror and is only served when both the live fetch
// and the on-disk cache are unavailable.
const SNAPSHOT_PATH = path.join(__dirname, 'marketplace-registry-snapshot.json');
const WARNING_FRESH_CACHE = '正在使用一小时内的本地插件目录。';
const WARNING_EMPTY = '无法加载插件目录。';

// Catalog entries come from the registry or its cached snapshot.

let memoryRegistry = null;
let memoryFetchedAt = 0;

function cachePath() {
  return path.join(app.getPath('userData'), 'marketplace-cache.json');
}

function registryUrl() {
  const fromEnv = process.env.DSHD_MARKETPLACE_REGISTRY_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return DEFAULT_REGISTRY_URL;
}

function isValidRegistry(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.plugins)
    && value.plugins.length > 0,
  );
}

function resolveLocale(locale) {
  const raw = String(locale || 'zh').trim();
  if (!raw || raw.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'en';
}

function pickLocalized(map, locale) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return '';
  }
  if (typeof map[locale] === 'string') {
    return map[locale];
  }
  if (typeof map.en === 'string') {
    return map.en;
  }
  return '';
}

function lastInstallToken(install) {
  const parts = String(install || '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function unquoteToken(value) {
  const token = String(value || '').trim();
  if (token.length >= 2) {
    const start = token[0];
    const end = token[token.length - 1];
    if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
      return token.slice(1, -1);
    }
  }
  return token;
}

function parseSourceUrl(url) {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\/tree\/[^/]+\/(.+?))?\/?$/i.exec(String(url || '').trim());
  if (!match) {
    return null;
  }
  const repo = match[1].replace(/\.git$/i, '');
  const [owner, name] = repo.split('/');
  if (!owner || !name || name.includes('#')) {
    return null;
  }
  const subpath = match[2] || '';
  if (subpath && (subpath.includes('..') || subpath.includes(':') || subpath.includes('\\'))) {
    return null;
  }
  return { owner, repo: name, subpath };
}

function allowedFallbackSpec(spec, plugin) {
  const item = { homepage: plugin?.url || '', npm: plugin?.npm || null };
  return isAllowedMarketplaceSpec(spec, item) ? spec : '';
}

/**
 * Resolve the CLI spec the way dsh-market `installTargetFor` does:
 * a valid npm name, else github / #path: from the GitHub URL,
 * else the last `install` token when `isAllowedMarketplaceSpec` accepts it.
 * @param {object} plugin
 * @returns {string}
 */
function resolveInstallSpec(plugin) {
  const npm = typeof plugin?.npm === 'string' ? plugin.npm.trim() : '';
  if (isValidPackageName(npm)) {
    return npm;
  }
  const source = parseSourceUrl(plugin?.url);
  if (source) {
    return source.subpath
      ? `github:${source.owner}/${source.repo}#path:/${source.subpath}`
      : `github:${source.owner}/${source.repo}`;
  }
  return allowedFallbackSpec(unquoteToken(lastInstallToken(plugin?.install)), plugin);
}

function starCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapPlugin(plugin, locale) {
  const owner = String(plugin?.owner || '');
  const name = String(plugin?.name || '');
  if (!owner || !name) {
    return null;
  }
  const npm = typeof plugin.npm === 'string' && plugin.npm ? plugin.npm : null;
  const deprecated = plugin.deprecated === true;
  return {
    id: `${owner}/${name}`,
    owner,
    repo: name,
    description: pickLocalized(plugin.description, locale),
    stars: starCount(plugin.stars),
    packageName: npm || '',
    homepage: plugin.url || '',
    installSpec: resolveInstallSpec(plugin),
    isBundle: !deprecated,
    category: plugin.category || '',
    added: typeof plugin.added === 'string' ? plugin.added.slice(0, 40) : '',
    deprecated: plugin.deprecated,
    replacement: plugin.replacement,
    screenshots: Array.isArray(plugin.screenshots) ? plugin.screenshots.filter(value => typeof value === 'string').slice(0, 12) : [],
    npm,
  };
}

function isDropped(item) {
  // Basename matching (isDroppedPluginName + the repo segment) closes the
  // rename bypass: a dropped plugin republished under a new npm scope or
  // GitHub owner (e.g. `@changfenhuang/dsh-genui`) stays hidden.
  return DROPPED.includes(item.id)
    || isDroppedPluginName(item.packageName)
    || isDroppedPluginName(item.repo);
}

function buildCategories(registry, items, locale) {
  const categories = registry?.categories && typeof registry.categories === 'object' && !Array.isArray(registry.categories)
    ? registry.categories
    : {};
  const counts = Object.create(null);
  for (const item of items) {
    counts[item.category] = (counts[item.category] || 0) + 1;
  }
  return [
    { id: 'all', label: locale === 'en' ? 'All' : '全部', count: items.length },
    ...Object.keys(categories).map((id) => ({
      id,
      label: pickLocalized(categories[id], locale) || id,
      count: counts[id] || 0,
    })),
  ];
}

function toPayload(registry, locale, extra) {
  const merged = registry || { plugins: [] };
  const mapped = (merged.plugins || []).map((plugin) => mapPlugin(plugin, locale)).filter(Boolean);
  const items = mapped.filter((item) => !isDropped(item));
  return {
    ok: true,
    items,
    categories: buildCategories(registry, items, locale),
    fetchedAt: extra.fetchedAt || 0,
    source: extra.source,
    warning: extra.warning || '',
  };
}

function emptyPayload(locale, warning) {
  return {
    ok: false,
    items: [],
    categories: [{ id: 'all', label: locale === 'en' ? 'All' : '全部', count: 0 }],
    fetchedAt: 0,
    source: '',
    warning: warning || WARNING_EMPTY,
  };
}

function cacheIsCurrent(fetchedAt) {
  return Date.now() - Number(fetchedAt || 0) < CACHE_TTL_MS;
}

function readDiskCache() {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (!cache || cache.version !== CACHE_VERSION || !isValidRegistry(cache.registry)) {
      return null;
    }
    return cache;
  } catch {
    // Missing or invalid cache files are a cache miss, not a crash.
    return null;
  }
}

function writeDiskCache(registry, fetchedAt) {
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
  atomicWriteFileSync(cachePath(), JSON.stringify({
    version: CACHE_VERSION,
    fetchedAt,
    registry,
  }, null, 2), { encoding: 'utf8' });
}

function readSnapshot() {
  try {
    const registry = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    return isValidRegistry(registry) ? registry : null;
  } catch {
    // A missing or invalid packed snapshot is treated as empty, not fatal.
    return null;
  }
}

function remember(registry, fetchedAt) {
  memoryRegistry = registry;
  memoryFetchedAt = fetchedAt;
}

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Read a fetch Response body as UTF-8 text, aborting as soon as the
 * accumulated bytes exceed maxBytes — the cap holds even when the server
 * sends no content-length (chunked responses).
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string>}
 */
async function readBodyCapped(response, maxBytes) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('插件目录响应过大');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('插件目录响应过大');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('插件目录响应过大');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function fetchRegistry() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(registryUrl(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`插件目录请求失败（${response.status}）`);
    }
    const text = await readBodyCapped(response, MAX_REGISTRY_BYTES);
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error('插件目录响应无效');
    }
    if (!isValidRegistry(body)) {
      throw new Error('插件目录为空');
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackPayload(locale, error) {
  const failed = error && error.name === 'AbortError'
    ? '插件目录请求超时'
    : (error && error.message) || WARNING_EMPTY;
  if (memoryRegistry) {
    return toPayload(memoryRegistry, locale, {
      source: 'cache',
      fetchedAt: memoryFetchedAt,
      warning: `${failed}，已使用本地缓存。`,
    });
  }
  const disk = readDiskCache();
  if (disk) {
    remember(disk.registry, disk.fetchedAt);
    return toPayload(disk.registry, locale, {
      source: 'cache',
      fetchedAt: disk.fetchedAt,
      warning: `${failed}，已使用本地缓存。`,
    });
  }
  const snapshot = readSnapshot();
  if (snapshot) {
    return toPayload(snapshot, locale, {
      source: 'snapshot',
      fetchedAt: 0,
      warning: `${failed}，已使用离线快照。`,
    });
  }
  return emptyPayload(locale, failed);
}

/**
 * List curated marketplace plugins from plugins.json.
 * @param {{ refresh?: boolean, locale?: string }} options
 */
async function listMarketplace(options = {}) {
  const locale = resolveLocale(options.locale);
  if (!options.refresh) {
    if (memoryRegistry && cacheIsCurrent(memoryFetchedAt)) {
      return toPayload(memoryRegistry, locale, {
        source: 'cache',
        fetchedAt: memoryFetchedAt,
        warning: WARNING_FRESH_CACHE,
      });
    }
    const disk = readDiskCache();
    if (disk && cacheIsCurrent(disk.fetchedAt)) {
      remember(disk.registry, disk.fetchedAt);
      return toPayload(disk.registry, locale, {
        source: 'cache',
        fetchedAt: disk.fetchedAt,
        warning: WARNING_FRESH_CACHE,
      });
    }
  }

  try {
    const registry = await fetchRegistry();
    const fetchedAt = Date.now();
    remember(registry, fetchedAt);
    writeDiskCache(registry, fetchedAt);
    return toPayload(registry, locale, { source: 'live', fetchedAt });
  } catch (error) {
    return fallbackPayload(locale, error);
  }
}

/**
 * Look up one registry plugin by id without fetching.
 * DROPPED rows are returned so install can reject them.
 * @param {string} id
 * @returns {object | null}
 */
function getMarketplacePlugin(id) {
  const wanted = String(id || '');
  if (!wanted) {
    return null;
  }
  const locale = resolveLocale('zh');
  const disk = memoryRegistry ? null : readDiskCache();
  const registry = memoryRegistry || disk?.registry || readSnapshot();
  const plugin = (registry.plugins || []).find((row) => row && `${row.owner}/${row.name}` === wanted);
  return plugin ? mapPlugin(plugin, locale) : null;
}

async function resolveCommitSha(owner, repo, ref, token, fetchImpl = globalThis.fetch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(url, {
      headers: {
        ...githubHeaders(token),
        Accept: 'application/vnd.github.sha',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return '';
    }
    const sha = (await response.text()).trim();
    return /^[0-9a-f]{7,40}$/i.test(sha) ? sha : '';
  } catch {
    // GitHub SHA lookup failed (network, abort, or non-JSON); keep the floating ref.
    return '';
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  readBodyCapped,
  MAX_REGISTRY_BYTES,
  listMarketplace,
  getMarketplacePlugin,
  resolveCommitSha,
};
