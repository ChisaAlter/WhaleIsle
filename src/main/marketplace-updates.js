'use strict';

const fs = require('fs');
const path = require('path');
const { listMarketplace, getMarketplacePlugin, resolveCommitSha } = require('./marketplace-catalog');
const { listInstalledPlugins, listInstalledPluginsAsync, webProfileDir } = require('./plugins');
const { GITHUB_PATH_SPEC, githubIdentity } = require('./marketplace-spec');

const UPDATES_TTL_MS = 30 * 60 * 1000;
const USER_AGENT = 'Deepseek-Harness-Desktop';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

let updatesCache = null;

function parseSemver(value) {
  const match = SEMVER.exec(String(value || '').trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Semver precedence comparator, or null for undecidable inputs. */
function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) return Number(x) - Number(y);
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** True only when latest is a semantically newer release. */
function isUpgrade(installed, latest) {
  if (!installed || !latest) return false;
  const comparison = compareVersions(latest, installed);
  return comparison !== null && comparison > 0;
}

/** @param {string} raw */
function parseInstalledVersion(raw) {
  const manifest = JSON.parse(raw);
  return typeof manifest.version === 'string' ? manifest.version : null;
}

/** @param {string} lock */
function parseLockCommits(lock) {
  const commits = new Map();
  for (const match of lock.matchAll(/codeload\.github\.com\/([^/\s]+\/[^/\s]+)\/tar\.gz\/([0-9a-f]{40})/g)) {
    const repository = match[1].toLowerCase();
    const commit = match[2].toLowerCase();
    commits.set(repository, commits.has(repository) && commits.get(repository) !== commit ? null : commit);
  }
  return commits;
}

/** @param {string} name */
function readInstalledVersion(name) {
  try {
    return parseInstalledVersion(fs.readFileSync(path.join(webProfileDir(), 'node_modules', name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readLockCommits() {
  try {
    return parseLockCommits(fs.readFileSync(path.join(webProfileDir(), 'pnpm-lock.yaml'), 'utf8'));
  } catch {
    return new Map();
  }
}

/** @param {string} name */
async function readInstalledVersionAsync(name) {
  try {
    return parseInstalledVersion(await fs.promises.readFile(path.join(webProfileDir(), 'node_modules', name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function readLockCommitsAsync() {
  try {
    return parseLockCommits(await fs.promises.readFile(path.join(webProfileDir(), 'pnpm-lock.yaml'), 'utf8'));
  } catch {
    return new Map();
  }
}

async function listInstalledPluginsSafeAsync() {
  return typeof listInstalledPluginsAsync === 'function' ? listInstalledPluginsAsync() : listInstalledPlugins();
}

function pinnedCommit(spec) {
  const value = String(spec || '');
  const direct = /#([0-9a-f]{7,40})$/i.exec(value);
  if (direct) return direct[1];
  const keyed = /#(?:commit=)?([0-9a-f]{7,40})(?:&|$)/i.exec(value);
  return keyed ? keyed[1] : null;
}

function installedNameFor(plugin, installed) {
  if (plugin.packageName && plugin.installSpec === plugin.packageName) {
    const row = installed.find(item => item.name === plugin.packageName);
    // A matching name is not proof of registry provenance (private git collision).
    return row && isRegistryDependency(row.spec) ? row.name : null;
  }
  const expected = githubIdentity(plugin.installSpec);
  if (!expected) return null;
  const match = installed.find((row) => {
    const actual = githubIdentity(row.spec);
    return actual === expected;
  });
  return match ? match.name : null;
}

function isRegistryDependency(spec) {
  const value = String(spec || '').trim();
  return value.length > 0 && !/[:/@\\]/.test(value)
    && /^[a-z0-9*^~<>=| .+-]+$/i.test(value);
}

async function fetchNpmLatest(name, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body?.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

function currentCommit(plugin, installedRow, lockCommits) {
  const repository = githubIdentity(plugin.installSpec).split('#path:')[0];
  // Multiple locked versions from one repo cannot be attributed to a row by repo alone.
  if (lockCommits.has(repository) && lockCommits.get(repository) === null) return null;
  return lockCommits.get(repository) || pinnedCommit(installedRow.spec);
}

/** Check one installed catalog row against its authoritative source. */
async function checkMarketplacePluginUpdate(plugin, installed, options = {}) {
  if (plugin.deprecated === true) return null;
  const packageName = installedNameFor(plugin, installed);
  if (!packageName) return null;
  const installedRow = installed.find(row => row.name === packageName);
  if (!installedRow) return null;
  if (/^(?:link:|file:|workspace:)/.test(installedRow.spec)) {
    return {
      id: plugin.id,
      packageName,
      kind: 'linked',
      current: await readInstalledVersionAsync(packageName),
      latest: null,
      updateAvailable: false,
      checkFailed: false,
    };
  }
  if (plugin.packageName && plugin.installSpec === plugin.packageName) {
    const current = await readInstalledVersionAsync(packageName);
    const latest = await fetchNpmLatest(packageName, options.fetchImpl);
    return {
      id: plugin.id,
      packageName,
      kind: 'npm',
      current,
      latest,
      updateAvailable: isUpgrade(current, latest),
      checkFailed: latest === null,
    };
  }
  const identity = githubIdentity(plugin.installSpec);
  if (!identity) {
    return {
      id: plugin.id,
      packageName,
      kind: 'unknown',
      current: null,
      latest: null,
      updateAvailable: false,
      checkFailed: false,
    };
  }
  const repository = identity.split('#path:')[0];
  const [owner, repo] = repository.split('/');
  const current = currentCommit(plugin, installedRow, options.lockCommits || await readLockCommitsAsync());
  const latest = await resolveCommitSha(owner, repo, 'HEAD', options.token, options.fetchImpl);
  return {
    id: plugin.id,
    packageName,
    kind: 'github',
    current,
    latest: latest || null,
    updateAvailable: Boolean(current && latest && !latest.toLowerCase().startsWith(current.toLowerCase())),
    checkFailed: !latest,
  };
}

function invalidateMarketplaceUpdates() {
  updatesCache = null;
}

/** Check all installed plugins that still have a curated catalog row. */
async function checkMarketplaceUpdates(options = {}) {
  const catalog = await listMarketplace({ refresh: Boolean(options.refresh), locale: 'zh' });
  const installed = (await listInstalledPluginsSafeAsync()).plugins || [];
  const lockCommits = await readLockCommitsAsync();
  const versions = await Promise.all(installed.map(row => readInstalledVersionAsync(row.name)));
  const installedKey = installed
    .map((row, index) => `${row.name}:${row.spec}:${versions[index] || ''}`)
    .sort()
    .join(',');
  const commitsKey = [...lockCommits].sort(([left], [right]) => left.localeCompare(right)).join(',');
  const cacheKey = `${webProfileDir()}\0${catalog.fetchedAt}\0${installedKey}\0${commitsKey}`;
  if (!options.force && updatesCache?.key === cacheKey && Date.now() - updatesCache.at < UPDATES_TTL_MS) {
    return updatesCache.payload;
  }
  const statuses = await Promise.all((catalog.items || []).map(plugin => (
    checkMarketplacePluginUpdate(plugin, installed, { ...options, lockCommits })
  )));
  const updates = Object.fromEntries(statuses.filter(Boolean).map(status => [status.id, status]));
  const payload = {
    ok: catalog.ok !== false && !statuses.some(status => status?.checkFailed),
    updates,
    checkedAt: Date.now(),
    warning: catalog.warning || '',
  };
  updatesCache = { key: cacheKey, at: Date.now(), payload };
  return payload;
}

/** Resolve and force-refresh one catalog row before a profile update. */
async function resolveMarketplaceUpdate(id, options = {}) {
  const plugin = getMarketplacePlugin(id);
  if (!plugin) return { plugin: null, status: null };
  const installed = (await listInstalledPluginsSafeAsync()).plugins || [];
  const status = await checkMarketplacePluginUpdate(plugin, installed, options);
  return { plugin, status };
}

function marketplaceUpdateTarget(plugin, status) {
  if (!status?.latest) return '';
  if (status.kind === 'npm') return `${status.packageName}@${status.latest}`;
  if (status.kind !== 'github') return '';
  if (GITHUB_PATH_SPEC.test(plugin.installSpec)) return plugin.installSpec;
  return plugin.owner && plugin.repo
    ? `github:${plugin.owner}/${plugin.repo}#${status.latest}`
    : '';
}

function readMarketplaceCurrent(plugin, status) {
  if (status.kind === 'npm') return readInstalledVersion(status.packageName);
  if (status.kind === 'github') {
    const row = (listInstalledPlugins().plugins || []).find(item => item.name === status.packageName);
    return row ? currentCommit(plugin, row, readLockCommits()) : null;
  }
  return null;
}

module.exports = {
  compareVersions,
  isUpgrade,
  checkMarketplacePluginUpdate,
  checkMarketplaceUpdates,
  resolveMarketplaceUpdate,
  marketplaceUpdateTarget,
  readMarketplaceCurrent,
  invalidateMarketplaceUpdates,
};
