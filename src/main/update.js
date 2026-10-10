const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');
const { downloadLatestViaUpdater, differentialAvailability } = require('./update-updater');
const { UpdateJournal } = require('./update-journal');
const { checkInstallSpace } = require('./install-space');
const { setTimeout: delay } = require('node:timers/promises');
const installDetect = require('../launcher/install-detect');
const { currentVersion, getInstalledAppInfo } = installDetect;

const GITHUB_OWNER = 'ChisaAlter';
const GITHUB_REPO = 'Deepseek-Harness-Desktop';
const RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_LIST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
/** API check budget: a hung GitHub must not stall the cold-start gate. */
const CHECK_TIMEOUT_MS = 10_000;
/** Whole-download budget for one Setup asset (hundreds of MB on slow links). */
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60_000;
/**
 * Release asset with `sha512sum` lines for every installer. Releases that
 * carry it get mandatory post-download verification; older releases without
 * it install unverified (documented limitation, not an error).
 */
const CHECKSUM_ASSET_NAME = 'SHA512SUMS.txt';

/**
 * Lazy shell `config.githubToken` source, injected by src/main/index.js so
 * this module stays loadable outside Electron (unit tests). The token is only
 * ever placed in an Authorization header toward GitHub hosts; it must never
 * be logged or embedded in error messages.
 */
let githubTokenProvider = null;

function setGithubTokenProvider(provider) {
  githubTokenProvider = typeof provider === 'function' ? provider : null;
}

function githubToken() {
  if (!githubTokenProvider) {
    return '';
  }
  try {
    const token = githubTokenProvider();
    return typeof token === 'string' ? token.trim() : '';
  } catch {
    return '';
  }
}

/** Hosts allowed to receive the Authorization header (never signed CDN redirects). */
function isGithubHost(url) {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    return host === 'api.github.com' || host === 'github.com' || host === 'www.github.com';
  } catch {
    return false;
  }
}

function githubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': `Deepseek-Harness-Desktop/${currentVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = githubToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function normalizeVersion(value) {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0];
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const delta = (a[i] || 0) - (b[i] || 0);
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function pickInstaller(assets, { platform = process.platform, arch = process.arch } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  if (platform === 'darwin') {
    const dmgs = list.filter((asset) => typeof asset?.name === 'string'
      && /\.dmg$/i.test(asset.name) && typeof asset.browser_download_url === 'string');
    const matchesArch = (asset) => new RegExp(`(?:^|[-_.])${arch}(?:[-_.]|$)`, 'i').test(asset.name);
    return dmgs.find(matchesArch)
      || dmgs.find((asset) => /(?:^|[-_.])universal(?:[-_.]|$)/i.test(asset.name))
      || dmgs.find((asset) => !/(?:^|[-_.])(?:arm64|aarch64|x64|x86_64|ia32)(?:[-_.]|$)/i.test(asset.name))
      || null;
  }
  if (platform !== 'win32') return null;
  const exes = list.filter((asset) => typeof asset?.name === 'string'
    && /\.exe$/i.test(asset.name)
    && !/\.blockmap$/i.test(asset.name)
    && typeof asset.browser_download_url === 'string');
  return exes.find((asset) => /setup|nsis|installer/i.test(asset.name)) || null;
}

function pickChecksumAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((asset) => typeof asset?.name === 'string'
    && asset.name.toLowerCase() === CHECKSUM_ASSET_NAME.toLowerCase()
    && typeof asset.browser_download_url === 'string') || null;
}

function installerMetadata(assets, asset) {
  const list = Array.isArray(assets) ? assets : [];
  const namedUrl = (name) => list.find((row) => row?.name === name)?.browser_download_url || '';
  return {
    assetSize: Number(asset?.size) || 0,
    blockmapUrl: asset ? namedUrl(`${asset.name}.blockmap`) : '',
    updaterMetadataUrl: namedUrl('latest.yml'),
  };
}

async function updateDownloadMethods(info, deps) {
  const available = await differentialAvailability(info, deps);
  return [
    {
      id: 'delta', label: '增量更新', description: '只下载发生变化的部分，节省流量。',
      ...(!available.ok ? { disabledReason: available.message } : {}),
    },
    { id: 'full', label: '完全下载', description: '下载完整安装包，适合修复或重新安装。' },
  ];
}

/**
 * Parse `sha512sum` output: one `<128-hex>  <filename>` line per asset
 * (`*` binary-mode marker tolerated).
 * @param {string} text
 * @returns {Map<string, string>} filename -> lower-case hex digest
 */
function parseSha512Sums(text) {
  const sums = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{128})\s+\*?(.+?)\s*$/);
    if (match) {
      sums.set(match[2], match[1].toLowerCase());
    }
  }
  return sums;
}

function sha512HexOfFile(file, signal) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file, { signal });
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Mandatory verification once a release carries SHA512SUMS.txt: any failure
 * (manifest fetch, missing entry, digest mismatch) throws so the installer
 * is never launched from a partial or tampered download.
 * @param {string} dest - downloaded installer path.
 * @param {string} assetName - original release asset name (manifest key).
 * @param {string} checksumUrl - browser_download_url of SHA512SUMS.txt.
 */
async function verifyAssetChecksum(dest, assetName, checksumUrl, { signal } = {}) {
  if (signal?.aborted) throw cancelledError();
  let response;
  try {
    response = await fetch(checksumUrl, {
      headers: downloadHeaders(true, checksumUrl),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CHECK_TIMEOUT_MS)]) : AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (error) {
    if (signal?.aborted) throw cancelledError();
    if (isTimeoutError(error)) {
      throw new Error('校验清单下载超时');
    }
    throw new Error(`校验清单下载失败：${error.message || String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`校验清单下载失败（${response.status}）`);
  }
  const sums = parseSha512Sums(await response.text());
  const expected = sums.get(assetName);
  if (!expected) {
    throw new Error(`校验清单缺少 ${assetName} 的条目`);
  }
  const actual = await sha512HexOfFile(dest, signal);
  if (actual !== expected) {
    throw Object.assign(new Error('安装包校验失败（sha512 不匹配）'), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
  }
}

function isTimeoutError(error) {
  return error instanceof Error
    && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function githubJson(url, timeoutMs = CHECK_TIMEOUT_MS) {
  let response;
  try {
    response = await fetch(url, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`GitHub 请求超时（${Math.round(timeoutMs / 1000)}s）`);
    }
    throw error;
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`GitHub ${response.status}`);
  }
  return response.json();
}

function snapshot(extra = {}) {
  return {
    current: currentVersion(),
    repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    repoUrl: REPO_URL,
    releasesUrl: RELEASES_PAGE,
    ...extra,
  };
}

/**
 * In-flight single-flight for the cold-start gate: the gate no longer waits for
 * this request, so a user opening the launcher while the first check is still
 * running must not start a second one. Settled results are NOT cached here —
 * an explicit refresh always issues a fresh request.
 */
let checkUpdateInFlight = null;

async function runUpdateCheck() {
  try {
    const release = await githubJson(RELEASES_LATEST);
    if (!release) {
      return snapshot({
        status: 'none',
        latest: '',
        htmlUrl: RELEASES_PAGE,
        assetName: '',
        assetUrl: '',
      });
    }
    const latest = normalizeVersion(release.tag_name || release.name);
    const asset = pickInstaller(release.assets);
    const checksum = pickChecksumAsset(release.assets);
    const newer = latest && compareVersions(latest, currentVersion()) > 0;
    return snapshot({
      status: newer ? 'available' : 'current',
      latest,
      tag: release.tag_name || latest,
      htmlUrl: release.html_url || RELEASES_PAGE,
      notes: typeof release.body === 'string' ? release.body : '',
      assetName: asset?.name || '',
      assetUrl: asset?.browser_download_url || '',
      checksumUrl: checksum?.browser_download_url || '',
      ...installerMetadata(release.assets, asset),
    });
  } catch (error) {
    return snapshot({
      status: 'error',
      latest: '',
      htmlUrl: RELEASES_PAGE,
      assetName: '',
      assetUrl: '',
      message: error.message || String(error),
    });
  }
}

/** Optional presentation sink (in-app status indicator); unset in tests. */
let stateSink;
function setUpdateStateSink(sink) { stateSink = typeof sink === 'function' ? sink : undefined; }
function publishState(state) {
  try { stateSink?.(state); } catch { /* presentation only */ }
}

/** Opt-out-free evidence journal; failures never block the update flow. */
let updateJournal;
function journal() {
  if (updateJournal === undefined) {
    try {
      updateJournal = new UpdateJournal(
        path.join(app.getPath('userData'), 'update-journal'),
        currentVersion(),
      );
    } catch (error) {
      console.warn('dshd update: evidence journal unavailable', error);
      updateJournal = null;
    }
  }
  return updateJournal;
}

async function checkUpdate() {
  if (checkUpdateInFlight) {
    return checkUpdateInFlight;
  }
  try { journal()?.action('check-requested'); } catch { /* evidence only */ }
  publishState({ phase: 'checking' });
  const pending = runUpdateCheck().then((info) => {
    if (info.status === 'available') publishState({ phase: 'available', version: info.latest });
    else if (info.status === 'error') publishState({ phase: 'error', failedOperation: 'check', message: info.message });
    else publishState({ phase: 'idle' });
    return info;
  });
  checkUpdateInFlight = pending;
  try {
    return await pending;
  } finally {
    if (checkUpdateInFlight === pending) {
      checkUpdateInFlight = null;
    }
  }
}

function downloadHeaders(firstHop, url) {
  const headers = {
    'User-Agent': `Deepseek-Harness-Desktop/${currentVersion()}`,
  };
  if (firstHop) {
    headers.Accept = 'application/octet-stream';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
    // First hop only, GitHub hosts only: redirect targets are signed CDN
    // URLs that reject requests carrying both a signature and an auth header.
    const token = githubToken();
    if (token && isGithubHost(url)) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

function cleanupPartial(dest) {
  try {
    fs.unlinkSync(dest);
  } catch {
    // ignore missing partials
  }
}

function cancelledError() {
  const error = new Error('下载已取消');
  error.name = 'AbortError';
  return error;
}

async function downloadFile(url, dest, onProgress, options = {}) {
  const { timeoutMs = DOWNLOAD_TIMEOUT_MS, signal, maxAttempts = 3, retryDelayMs = 1000 } = options;
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw cancelledError();
    try {
      return await downloadFileOnce(url, dest,
        (progress) => onProgress?.({ ...progress, attempt, maxAttempts }),
        { ...options, signal, timeoutMs: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      if (!error.retryable || attempt === maxAttempts || Date.now() >= deadline) throw error;
      onProgress?.({ phase: 'download', retrying: true, attempt: attempt + 1, maxAttempts, percent: null });
      try {
        await delay(Math.min(retryDelayMs * attempt, Math.max(1, deadline - Date.now())), undefined, { signal });
      } catch { throw cancelledError(); }
    }
  }
  throw new Error('下载重试次数无效');
}

function downloadFileOnce(url, dest, onProgress, {
  timeoutMs = DOWNLOAD_TIMEOUT_MS, signal, idleTimeoutMs = 45_000, connectionTimeoutMs = 20_000,
} = {}) {
  if (signal?.aborted) {
    return Promise.reject(cancelledError());
  }
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    let settled = false;
    let activeRequest = null;
    let activeResponse = null;
    let inactivityTimer;
    const started = Date.now();
    const armInactivity = (ms, message) => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => fail(Object.assign(new Error(message), { retryable: true, code: 'ETIMEDOUT' })), ms);
    };
    const onAbort = () => fail(cancelledError());
    const releaseSignal = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(inactivityTimer);
      releaseSignal();
      activeResponse?.unpipe?.(file);
      activeResponse?.destroy?.();
      if (activeRequest) {
        activeRequest.destroy();
      }
      file.once('close', () => {
        cleanupPartial(dest);
        reject(error);
      });
      file.destroy();
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    // One wall-clock budget for the whole download (all redirect hops): a
    // stalled connection must not park the launcher on "下载 0%" forever.
    const deadline = setTimeout(() => {
      fail(new Error(`下载超时（${Math.round(timeoutMs / 60_000)} 分钟）`));
    }, timeoutMs);
    const visit = (target, hops) => {
      if (settled) return;
      if (hops > 8) {
        fail(new Error('Too many redirects'));
        return;
      }
      armInactivity(connectionTimeoutMs, '下载连接超时，请检查网络或切换下载线路');
      let request;
      try { request = https.get(target, {
        headers: downloadHeaders(hops === 0, target),
      }, (response) => {
        if (settled) { response.resume(); return; }
        activeResponse = response;
        response.on('error', (error) => {
          fail(Object.assign(new Error(`下载连接中断：${error.message || String(error)}`), { retryable: true }));
        });
        response.on('aborted', () => {
          fail(Object.assign(new Error('下载连接中断（服务器提前断开）'), { retryable: true }));
        });
        const location = response.headers.location;
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
          response.resume();
          try { visit(new URL(location, target).href, hops + 1); } catch (error) { fail(error); }
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          fail(Object.assign(new Error(`下载失败（HTTP ${response.statusCode}）`), {
            retryable: [408, 429, 500, 502, 503, 504].includes(response.statusCode),
          }));
          return;
        }
        const total = Number(response.headers['content-length']) || 0;
        try { if (total > 0) checkInstallSpace(path.dirname(dest), total); } catch (error) { fail(error); return; }
        armInactivity(idleTimeoutMs, '下载连接长时间无数据，请检查网络或切换下载线路');
        let received = 0;
        let lastProgressAt = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          armInactivity(idleTimeoutMs, '下载连接长时间无数据，请检查网络或切换下载线路');
          received += chunk.length;
          const now = Date.now();
          if (typeof onProgress === 'function' && (now - lastProgressAt >= 250 || received === total)) {
            lastProgressAt = now;
            onProgress({
              phase: 'download',
              percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null,
              received,
              total,
              bytesPerSecond: received / Math.max(1, (Date.now() - started) / 1000),
            });
          }
        });
        response.once('end', () => clearTimeout(inactivityTimer));
        response.pipe(file);
        file.on('finish', () => {
          if (settled) {
            return;
          }
          if (total > 0 && received !== total) {
            fail(Object.assign(new Error(`下载不完整（${received}/${total} 字节），已删除未完成文件`), { retryable: true }));
            return;
          }
          settled = true;
          clearTimeout(deadline);
          clearTimeout(inactivityTimer);
          releaseSignal();
          file.close(() => resolve(dest));
        });
      }); } catch (error) { fail(error); return; }
      activeRequest = request;
      request.on('error', (error) => {
        error.retryable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND'].includes(error.code);
        fail(error);
      });
    };
    file.on('error', fail);
    visit(url, 0);
  });
}

function launchInstaller(file, { spawn: spawnFn = spawn, installerArgs = [] } = {}) {
  const child = spawnFn(file, installerArgs, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

function summarizeRelease(release, current) {
  if (!release || release.draft) {
    return null;
  }
  // Component releases share the repository, but are not desktop versions.
  const versionTag = String(release.tag_name || release.name || '').trim();
  if (!/^v?\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?$/i.test(versionTag)) {
    return null;
  }
  const asset = pickInstaller(release.assets);
  const checksum = pickChecksumAsset(release.assets);
  const version = normalizeVersion(release.tag_name || release.name);
  const compared = version ? compareVersions(version, current) : 0;
  return {
    tag: release.tag_name || '',
    version,
    prerelease: Boolean(release.prerelease),
    htmlUrl: release.html_url || RELEASES_PAGE,
    notes: typeof release.body === 'string' ? release.body : '',
    current: Boolean(version) && compared === 0,
    newer: Boolean(version) && compared > 0,
    older: Boolean(version) && compared < 0,
    assetName: asset?.name || '',
    assetUrl: asset?.browser_download_url || '',
    checksumUrl: checksum?.browser_download_url || '',
    ...installerMetadata(release.assets, asset),
    installable: Boolean(asset),
  };
}

async function listReleases() {
  try {
    const list = await githubJson(RELEASES_LIST);
    const current = currentVersion();
    const releases = (Array.isArray(list) ? list : [])
      .map((row) => summarizeRelease(row, current))
      .filter(Boolean);
    return snapshot({ status: 'ok', releases, installed: getInstalledAppInfo() });
  } catch (error) {
    return snapshot({
      status: 'error',
      releases: [],
      installed: getInstalledAppInfo(),
      message: error.message || String(error),
    });
  }
}

async function installFromAsset(info, onProgress, options = {}) {
  const downloadMode = options.downloadMode === undefined ? 'full' : options.downloadMode;
  if (downloadMode !== 'delta' && downloadMode !== 'full') {
    throw new Error('更新方式无效，请重新选择增量更新或完全下载。');
  }
  if (!info?.assetUrl) {
    if (info?.htmlUrl) {
      await shell.openExternal(info.htmlUrl);
    }
    return { ...info, launched: false, openedPage: Boolean(info?.htmlUrl) };
  }
  if (!info.checksumUrl && downloadMode === 'full') {
    // No SHA512SUMS.txt on this release: never install unverified silently.
    // The caller must supply a user confirmation; absent or declined, the
    // download does not even start (fail closed).
    const confirm = options.confirmUnverified;
    const confirmed = typeof confirm === 'function' ? await confirm(info) : false;
    if (confirmed !== true) {
      return {
        ...info,
        launched: false,
        openedPage: false,
        unverified: true,
        declined: true,
        message: '该版本未提供 SHA512SUMS.txt 校验清单，已取消未校验安装',
      };
    }
  }
  try { journal()?.action('download-requested'); } catch { /* evidence only */ }
  const version = info.latest || info.version;
  const journalProgress = (progress) => {
    let state;
    if (progress && progress.phase === 'download') {
      state = { phase: 'downloading', version, percent: progress.percent ?? 0 };
    } else if (progress && progress.phase === 'verify') {
      state = { phase: 'verifying', version };
    } else if (progress && progress.phase === 'install') {
      state = { phase: 'installing', version };
    }
    if (state) {
      try { journal()?.state(state); } catch { /* evidence only */ }
      publishState(state);
    }
    if (typeof onProgress === 'function') onProgress(progress);
  };
  let dest;
  let partial;
  let preparedOptions = options;
  let extra = { downloadMode };
  try {
    journalProgress({ phase: 'download', percent: 0 });
    if (downloadMode === 'delta') {
      const outcome = await downloadLatestViaUpdater(
        { timeoutMs: 15 * 60_000, expectedCheck: info, signal: options.signal },
        journalProgress, options.updaterDeps,
      );
      if (!outcome.ok) {
        throw Object.assign(new Error(outcome.message || '增量更新未完成，请重新选择完全下载。'), {
          code: outcome.reason,
        });
      }
      dest = outcome.installer;
      journalProgress({ phase: 'verify' });
      await verifyAssetChecksum(dest, info.assetName, info.checksumUrl, options);
      preparedOptions = { ...options, installerArgs: ['--updated', '/S', '--force-run'] };
      extra = { ...extra, updater: true, differential: Boolean(outcome.differential), downloadPercent: outcome.downloadPercent ?? null };
    } else {
      const dir = path.join(options.userDataDir || app.getPath('userData'), 'updates');
      const safeName = path.basename(info.assetName || 'Whale-Isle-Setup.exe').replace(/[^\w.\-]+/g, '_');
      dest = path.join(dir, safeName);
      partial = `${dest}.part`;
      // Completed downloads survive a cancelled wizard. Reuse only after checking
      // this release's current manifest again; file name/existence is not trust.
      let cached = false;
      fs.mkdirSync(dir, { recursive: true });
      if (info.checksumUrl && fs.existsSync(dest)) {
        journalProgress({ phase: 'verify', cached: true });
        try {
          await verifyAssetChecksum(dest, info.assetName, info.checksumUrl, options);
          cached = true;
        } catch (error) {
          if (error.code !== 'ERR_UPDATER_CHECKSUM_MISMATCH') throw error;
          cleanupPartial(dest);
        }
      }
      if (!cached) {
        await downloadFile(info.assetUrl, partial, journalProgress, { signal: options.signal });
        if (info.checksumUrl) {
          journalProgress({ phase: 'verify' });
          await verifyAssetChecksum(partial, info.assetName, info.checksumUrl, options);
        }
        if (options.signal?.aborted) throw cancelledError();
        fs.renameSync(partial, dest);
      }
    }
  } catch (error) {
    if (partial) cleanupPartial(partial);
    const state = { phase: 'error', version, failedOperation: 'download', message: `${error.code || ''} ${error.message}` };
    try { journal()?.state(state); } catch { /* evidence only */ }
    publishState(state);
    throw error;
  }
  return launchPreparedInstaller(info, dest, journalProgress, preparedOptions, extra);
}

async function launchPreparedInstaller(info, dest, onProgress, options = {}, extra = {}) {
  try {
    const result = await commitPreparedInstaller(info, dest, onProgress, options, extra);
    if (result.cancelled) {
      publishState(result.code === 'cancelled'
        ? { phase: 'available', version: info.latest || info.version }
        : { phase: 'error', version: info.latest || info.version, failedOperation: 'install', message: result.code || result.message });
    }
    return result;
  } catch (error) {
    const state = { phase: 'error', version: info.latest || info.version, failedOperation: 'install', message: error.message || String(error) };
    try { journal()?.state(state); } catch { /* evidence only */ }
    publishState(state);
    throw error;
  }
}

async function commitPreparedInstaller(info, dest, onProgress, options = {}, extra = {}) {
  if (options.signal?.aborted) {
    throw cancelledError();
  }
  if ((options.platform || process.platform) === 'darwin') {
    if (!/\.dmg$/i.test(info.assetName || dest)) throw new Error('该版本没有适用于 macOS 的安装映像');
    const error = await (options.openPath || shell.openPath)(dest);
    if (error) throw new Error(`无法打开安装映像：${error}`);
    onProgress?.({ phase: 'manual-install', percent: 100 });
    publishState({ phase: 'available', version: info.latest || info.version });
    return { ...info, ...extra, launched: false, installer: dest, openedInstaller: true, manualInstall: true,
      message: '已打开安装映像，请将 Whale Isle 拖入 Applications 完成更新' };
  }
  onProgress?.({ phase: 'install', percent: 100, differential: extra.differential });
  // Caller-side gate (launcher runtime installs stop the managed desktop
  // first) and the task-protection check both run AFTER download + verify —
  // the download itself is not a destructive side effect.
  if (typeof options.beforeInstall === 'function') {
    const gate = await options.beforeInstall({ dest });
    if (gate && gate.ok === false) {
      return {
        ...info,
        launched: false,
        cancelled: gate.cancelled === true,
        code: gate.code || 'install-gated',
        message: gate.message,
      };
    }
  }
  const protection = options.taskProtection;
  const quitAfterInstall = options.quitAfterInstall !== undefined
    ? Boolean(options.quitAfterInstall)
    : app.isPackaged;
  const launch = async () => {
    if (options.signal?.aborted) throw cancelledError();
    const child = launchInstaller(dest, options);
    // Wire lifecycle observation at launch; the UAC parent can exit early.
    if (typeof options.onInstallerLaunch === 'function') {
      try { options.onInstallerLaunch(child); } catch { /* evidence only */ }
    }
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    try { journal()?.action('install-confirmed'); } catch { /* evidence only */ }
  };
  if (protection && typeof protection.coordinate === 'function') {
    // Every entry into this lane is already an explicit user action (update
    // ask, version-install card, 「在线安装」 button), so the inspect/
    // acquire/drain sequencing stays but the confirm gate is skipped —
    // asking again would double-prompt one click.
    // The launch belongs inside commit so a rejected spawn releases Host
    // admission and never latches the coordinator into a shutdown state.
    const result = await protection.coordinate('update', { terminal: quitAfterInstall, preConfirmed: true, commit: launch });
    if (!result.proceeded) {
      return { ...info, launched: false, cancelled: true, code: result.code || 'cancelled' };
    }
  } else await launch();
  // Self-update semantics quit the packaged app so the installer can replace
  // it. A runtime install (slim launcher → desktop) must keep the launcher
  // alive to report progress, so callers opt out explicitly.
  if (quitAfterInstall) {
    setTimeout(() => app.quit(), 800);
  }
  return { ...info, ...extra, launched: true, installer: dest };
}

async function installRelease(tag, onProgress, options = {}) {
  const raw = String(tag || '').trim();
  if (!raw) {
    return snapshot({ status: 'error', message: 'missing-tag', launched: false });
  }
  try {
    const release = await githubJson(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(raw)}`,
    );
    if (!release) {
      return snapshot({ status: 'error', message: 'release-not-found', launched: false });
    }
    const summary = summarizeRelease(release, currentVersion());
    if (!summary) {
      return snapshot({ status: 'error', message: 'release-not-found', launched: false });
    }
    if (!summary.installable) {
      return snapshot({ ...summary, status: 'error', message: 'no-installer', launched: false });
    }
    return installFromAsset(summary, onProgress, options);
  } catch (error) {
    return snapshot({
      status: 'error',
      message: error.message || String(error),
      launched: false,
    });
  }
}

async function installUpdate(onProgress, options = {}) {
  // A confirmation already showed this exact release to the user. Do not
  // query /releases/latest again or let latest.yml move to a newer target.
  const confirmedCheck = options.expectedCheck;
  const info = confirmedCheck || await checkUpdate();
  if (info.status === 'error') {
    return { ...info, launched: false, openedPage: false };
  }
  if (confirmedCheck && info.status !== 'available') {
    return { ...info, launched: false, openedPage: false, status: 'error', message: 'confirmed-release-unavailable' };
  }
  return installFromAsset({
    ...info,
    assetUrl: info.assetUrl,
    assetName: info.assetName,
    checksumUrl: info.checksumUrl,
    htmlUrl: info.htmlUrl,
  }, onProgress, options);
}

module.exports = {
  setGithubTokenProvider,
  GITHUB_OWNER,
  GITHUB_REPO,
  REPO_URL,
  RELEASES_PAGE,
  CHECK_TIMEOUT_MS,
  DOWNLOAD_TIMEOUT_MS,
  CHECKSUM_ASSET_NAME,
  checkUpdate,
  installUpdate,
  updateDownloadMethods,
  setUpdateStateSink,
  summarizeRelease,
  listReleases,
  installRelease,
  installFromAsset,
  downloadFile,
  launchInstaller,
  cleanupPartial,
  cancelledError,
  parseSha512Sums,
  verifyAssetChecksum,
  // Release-source (GitHub/CNB mirror routes) builds on these primitives.
  githubJson,
  githubHeaders,
  normalizeVersion,
  compareVersions,
  pickInstaller,
  pickChecksumAsset,
  // Install detection moved to src/launcher/install-detect.js; re-exported so
  // existing consumers (index.js, ipc.js, tests) keep one import surface.
  ...installDetect,
};
