const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');
const { downloadLatestViaUpdater, differentialAvailability } = require('./update-updater');
const { UpdateJournal } = require('./update-journal');
const { agentFor, systemFetch } = require('./system-proxy');
const { checkInstallSpace } = require('./install-space');
const { setTimeout: delay } = require('node:timers/promises');
const installDetect = require('../launcher/install-detect');
const { currentVersion, getInstalledAppInfo } = installDetect;

const GITHUB_OWNER = 'ChisaAlter';
const GITHUB_REPO = 'WhaleIsle';
const RELEASES_LATEST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const RELEASES_LIST = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;
const REPO_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
/** API check budget: a hung GitHub must not stall the cold-start gate. */
const CHECK_TIMEOUT_MS = 10_000;
/** Whole-download budget for one Setup asset (hundreds of MB on slow links). */
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60_000;
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED',
  'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'ERR_PROXY_TUNNEL']);
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

/**
 * Lazy shell `config.downloadRoute` source, injected by src/main/index.js.
 * Unpicked means the region default (release-source defaultRoute); outside
 * Electron (tests, source tools) that is GitHub.
 */
let routeProvider = null;

function setUpdateRouteProvider(provider) {
  routeProvider = typeof provider === 'function' ? provider : null;
}

function updateRoute() {
  try {
    const releaseSource = require('../launcher/release-source');
    return releaseSource.normalizeRoute(routeProvider?.()) || releaseSource.defaultRoute();
  } catch {
    return 'github';
  }
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
  let preparing = false;
  try {
    const available = await differentialAvailability(info, { ...deps, onBasePreparation: () => {
      preparing = true;
      publishState({ phase: 'checking' });
    } });
    return [
      {
        id: 'delta', label: '增量更新', description: '只下载发生变化的部分，节省流量。',
        ...(!available.ok ? { disabledReason: available.message } : {}),
      },
      { id: 'full', label: '完全下载', description: '下载完整安装包，适合修复或重新安装。' },
    ];
  } finally {
    if (preparing) publishState({ phase: 'available', version: info.latest || info.version });
  }
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
 * Read one exact SHA512SUMS.txt entry. Base validation and recovery share
 * this manifest rather than fetching it again for each local candidate.
 * @param {string} assetName - original release asset name (manifest key).
 * @param {string} checksumUrl - browser_download_url of SHA512SUMS.txt.
 */
async function readAssetChecksum(assetName, checksumUrl, {
  signal, maxAttempts = 3, retryDelayMs = 1000, attemptTimeoutMs = CHECK_TIMEOUT_MS, onRetry,
} = {}) {
  return runDownloadAttempts(async (_attempt, remainingMs) => {
    const requestSignal = AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, remainingMs)));
    let response;
    let text;
    try {
      response = await systemFetch(checksumUrl, {
        headers: downloadHeaders(true, checksumUrl),
        signal: signal ? AbortSignal.any([signal, requestSignal]) : requestSignal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Object.assign(new Error(`校验清单下载失败（HTTP ${response.status}）`), {
          code: `HTTP_ERROR_${response.status}`, retryable: RETRYABLE_HTTP_STATUSES.has(response.status),
        });
      }
      // The same per-attempt deadline covers both headers and the complete body.
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      if (String(error.code || '').startsWith('HTTP_ERROR_')) throw error;
      const code = error.code || error.cause?.code;
      const timedOut = requestSignal.aborted || isTimeoutError(error)
        || ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code);
      throw Object.assign(new Error(timedOut ? '校验清单下载超时' : `校验清单下载失败：${error.message || String(error)}`), {
        code: timedOut ? 'ETIMEDOUT' : code || 'ERR_UPDATER_CHECKSUM_FETCH_FAILED',
        retryable: timedOut || RETRYABLE_NETWORK_CODES.has(code),
      });
    }
    if (signal?.aborted) throw cancelledError();
    const expected = parseSha512Sums(text).get(assetName);
    if (!expected) {
      throw Object.assign(new Error(`校验清单缺少 ${assetName} 的条目`), { code: 'ERR_UPDATER_CHECKSUM_ENTRY_MISSING' });
    }
    return expected;
  }, {
    signal, maxAttempts, retryDelayMs,
    timeoutMs: maxAttempts * attemptTimeoutMs + retryDelayMs * maxAttempts * (maxAttempts - 1) / 2,
    onRetry,
  });
}

/** Hash the local bytes against the checksum pinned for this one operation. */
async function verifyFileChecksum(dest, expected, { signal } = {}) {
  if (signal?.aborted) throw cancelledError();
  let actual;
  try {
    actual = await sha512HexOfFile(dest, signal);
  } catch (error) {
    if (signal?.aborted) throw cancelledError();
    throw error;
  }
  if (signal?.aborted) throw cancelledError();
  if (actual !== expected) {
    throw Object.assign(new Error('安装包校验失败（sha512 不匹配）'), { code: 'ERR_UPDATER_CHECKSUM_MISMATCH' });
  }
}

/** Reject an incomplete or tampered download before the installer can launch. */
async function verifyAssetChecksum(dest, assetName, checksumUrl, options = {}) {
  const expected = await readAssetChecksum(assetName, checksumUrl, options);
  return verifyFileChecksum(dest, expected, options);
}

/** Shared by desktop Setup/DMG installs and standalone launcher delta assets. */
async function downloadReleaseAsset(info, dest, onProgress, options = {}) {
  info = { ...info };
  const { signal } = options;
  let expected;
  if (signal?.aborted) throw cancelledError();
  if (info.checksumUrl) {
    const checksumProgress = (retry = {}) => onProgress?.({ phase: 'resolve', stage: 'checksum', ...retry });
    checksumProgress();
    // Resolve before transferring the large asset. A successful operation does
    // not depend on a second network request after all bytes have arrived.
    expected = await readAssetChecksum(info.assetName, info.checksumUrl, { signal, onRetry: checksumProgress });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.part`;
  let complete = fs.existsSync(partial);
  const verify = async (file, cached) => {
    onProgress?.({ phase: 'verify', stage: 'checksum', cached });
    await verifyFileChecksum(file, expected, { signal });
  };
  try {
    onProgress?.({ phase: 'download', percent: 0 });
    if (expected) {
      for (const candidate of [dest, partial]) {
        if (!fs.existsSync(candidate)) continue;
        try {
          await verify(candidate, true);
          if (candidate === partial) fs.renameSync(partial, dest);
          return dest;
        } catch (error) {
          if (error.code !== 'ERR_UPDATER_CHECKSUM_MISMATCH') throw error;
          cleanupPartial(candidate);
        }
      }
    }
    complete = false;
    await downloadFile(info.assetUrl, partial, onProgress, { signal, resume: Boolean(expected) });
    complete = true;
    if (expected) await verify(partial, false);
    if (signal?.aborted) throw cancelledError();
    fs.renameSync(partial, dest);
    return dest;
  } catch (error) {
    // Never append across operations. Retain completed bytes only for a fresh
    // full SHA512 check on the next explicit attempt; they are not installable yet.
    if (!complete || !expected || error.code === 'ERR_UPDATER_CHECKSUM_MISMATCH') cleanupPartial(partial);
    throw error;
  }
}

function fullInstallerPath(info, { userDataDir } = {}) {
  const dir = path.join(userDataDir || app.getPath('userData'), 'updates');
  const safeName = path.basename(info.assetName || 'Whale-Isle-Setup.exe').replace(/[^\w.\-]+/g, '_');
  return path.join(dir, safeName);
}

function isTimeoutError(error) {
  return error instanceof Error
    && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

async function githubJson(url, timeoutMs = CHECK_TIMEOUT_MS, { signal } = {}) {
  let response;
  try {
    response = await systemFetch(url, {
      headers: githubHeaders(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
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
    const remaining = response.headers?.get('x-ratelimit-remaining');
    const retryAfter = response.headers?.get('retry-after');
    if (response.status === 429 || (response.status === 403 && (remaining === '0' || retryAfter))) {
      const reset = Number(response.headers?.get('x-ratelimit-reset'));
      const minutes = Math.ceil((reset * 1000 - Date.now()) / 60_000);
      const recovery = Number.isFinite(minutes) && minutes > 0 ? `，预计 ${minutes} 分钟后恢复` : '';
      throw Object.assign(new Error(`GitHub 请求已限流（HTTP ${response.status}）${recovery}；请稍后重试，或配置 GitHub Token／手动选择 CNB 线路`), {
        code: 'GITHUB_RATE_LIMIT',
      });
    }
    if (response.status === 403) {
      throw Object.assign(new Error('GitHub 拒绝访问（HTTP 403）；请检查 GitHub Token 权限，或手动选择 CNB 线路'), {
        code: 'GITHUB_FORBIDDEN',
      });
    }
    throw new Error(`GitHub ${response.status}`);
  }
  return response.json();
}

function snapshot(extra = {}, route = 'github') {
  const page = route === 'github' ? RELEASES_PAGE : require('../launcher/release-source').ROUTES[route].page;
  return {
    current: currentVersion(),
    repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    repoUrl: route === 'github' ? REPO_URL : page.replace(/\/-\/releases$/, ''),
    releasesUrl: page,
    route,
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

/** The selected route's newest stable release, assets in GitHub shape. */
async function latestRelease(route) {
  if (route === 'github') return githubJson(RELEASES_LATEST);
  const releaseSource = require('../launcher/release-source');
  return releaseSource.normalizeAssets(await releaseSource.releaseRaw(route, null));
}

async function runUpdateCheck() {
  const route = updateRoute();
  const page = snapshot({}, route).releasesUrl;
  try {
    const release = await latestRelease(route);
    if (!release) {
      return snapshot({
        status: 'none',
        latest: '',
        htmlUrl: page,
        assetName: '',
        assetUrl: '',
      }, route);
    }
    const latest = normalizeVersion(release.tag_name || release.name);
    const asset = pickInstaller(release.assets);
    const checksum = pickChecksumAsset(release.assets);
    const newer = latest && compareVersions(latest, currentVersion()) > 0;
    return snapshot({
      status: newer ? 'available' : 'current',
      latest,
      tag: release.tag_name || latest,
      htmlUrl: release.html_url || page,
      notes: typeof release.body === 'string' ? release.body : '',
      assetName: asset?.name || '',
      assetUrl: asset?.browser_download_url || '',
      checksumUrl: checksum?.browser_download_url || '',
      ...installerMetadata(release.assets, asset),
    }, route);
  } catch (error) {
    return snapshot({
      status: 'error',
      latest: '',
      htmlUrl: page,
      assetName: '',
      assetUrl: '',
      message: error.message || String(error),
    }, route);
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
  error.code = 'ERR_UPDATER_CANCELLED';
  return error;
}

async function runDownloadAttempts(run, {
  timeoutMs, signal, maxAttempts = 3, retryDelayMs = 1000, onRetry,
}) {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw cancelledError();
    try {
      return await run(attempt, Math.max(1, deadline - Date.now()));
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      if (!error.retryable || attempt === maxAttempts || Date.now() >= deadline) throw error;
      onRetry?.({ retrying: true, attempt: attempt + 1, maxAttempts });
      try {
        await delay(Math.min(retryDelayMs * attempt, Math.max(1, deadline - Date.now())), undefined, { signal });
      } catch { throw cancelledError(); }
    }
  }
  throw new Error('下载重试次数无效');
}

async function downloadFile(url, dest, onProgress, options = {}) {
  const { timeoutMs = DOWNLOAD_TIMEOUT_MS, signal, maxAttempts = 3 } = options;
  // Only checksum-backed release downloads may reuse bytes. This state belongs
  // to this exact operation/URL, never an unverified partial from an earlier
  // run — unless the caller owns a persisted state for the same checksum
  // (update center), whose bytes are verified as a whole at the end.
  const resumeState = options.resumeState || (options.resume ? { offset: 0, total: 0, validator: null } : null);
  try {
    // Redirect hops (GitHub -> signed asset host) reuse the first hop's proxy decision.
    let agent = options.agent === undefined ? await agentFor(url) : options.agent;
    return await runDownloadAttempts((attempt, remainingMs) => downloadFileOnce(url, dest,
      (progress) => onProgress?.({ ...progress, attempt, maxAttempts }),
      { ...options, agent, resumeState, signal, timeoutMs: remainingMs }).catch((error) => {
      // A dead or refusing system proxy must not block a reachable direct route.
      if (agent && error.proxyFailure) {
        agent = null;
        error.retryable = true;
      }
      throw error;
    }), {
      ...options, timeoutMs, signal, maxAttempts,
      onRetry: (retry) => onProgress?.({ phase: 'download', ...retry, percent: null,
        received: resumeState?.offset || 0, total: resumeState?.total || 0 }),
    });
  } catch (error) {
    // keepPartial: a paused or failed transfer keeps its written bytes for a
    // later resume; the caller owns cleanup.
    if (!(options.keepPartial && resumeState?.offset > 0)) cleanupPartial(dest);
    throw error;
  }
}

function downloadFileOnce(url, dest, onProgress, {
  timeoutMs = DOWNLOAD_TIMEOUT_MS, signal, idleTimeoutMs = 45_000, connectionTimeoutMs = 20_000, resumeState, agent,
  keepPartial = false,
} = {}) {
  if (signal?.aborted) {
    return Promise.reject(cancelledError());
  }
  return new Promise((resolve, reject) => {
    const offset = resumeState?.offset || 0;
    let file;
    let settled = false;
    let failureError;
    // True only while queued writes drain for a resume (file.end()); a stream
    // destroyed on purpose reports its pending writes as ERR_STREAM_DESTROYED.
    let draining = false;
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
      failureError = error;
      clearTimeout(deadline);
      clearTimeout(inactivityTimer);
      releaseSignal();
      if (file) activeResponse?.unpipe?.(file);
      activeResponse?.destroy?.();
      activeRequest?.destroy();
      const finish = () => {
        // Wait until writes close: network data events can be ahead of the
        // actual file. The next Range starts at bytes safely written to disk.
        const keepBytes = keepPartial ? failureError.retryable || signal?.aborted : failureError.retryable && !signal?.aborted;
        if (resumeState && keepBytes && resumeState.total > 0) {
          try { resumeState.offset = fs.statSync(dest).size; } catch { resumeState.offset = 0; }
          if (resumeState.offset >= resumeState.total) resumeState.offset = 0;
        } else if (resumeState) resumeState.offset = 0;
        if (!resumeState?.offset) cleanupPartial(dest);
        reject(failureError);
      };
      if (file) {
        file.once('close', finish);
        if (resumeState && error.retryable && !file.destroyed) {
          draining = true;
          file.end();
        } else file.destroy();
      } else finish();
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
      const headers = downloadHeaders(hops === 0, target);
      headers['Accept-Encoding'] = 'identity';
      if (offset > 0) {
        headers.Range = `bytes=${offset}-`;
        if (resumeState.validator) headers['If-Range'] = resumeState.validator;
      }
      try { request = https.get(target, {
        headers,
        ...(agent && /^https:/i.test(target) ? { agent } : {}),
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
        const resumed = offset > 0 && response.statusCode === 206;
        if (response.statusCode !== 200 && !resumed) {
          fail(Object.assign(new Error(`下载失败（HTTP ${response.statusCode}）`), {
            code: `HTTP_ERROR_${response.statusCode}`, retryable: RETRYABLE_HTTP_STATUSES.has(response.statusCode),
          }));
          return;
        }
        let total = Number(response.headers['content-length']) || 0;
        if (resumed) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
          if (!range || Number(range[1]) !== offset || Number(range[3]) !== resumeState.total
            || Number(range[2]) !== resumeState.total - 1
            || (total && total !== resumeState.total - offset)
            || (resumeState.validator && response.headers[resumeState.validatorHeader]
              && response.headers[resumeState.validatorHeader] !== resumeState.validator)) {
            fail(Object.assign(new Error('下载续传响应与原文件不一致'), { code: 'ERR_UPDATER_INVALID_RANGE' }));
            return;
          }
          total = resumeState.total;
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          fail(Object.assign(new Error('下载服务器返回了压缩的安装包传输'), { code: 'ERR_UPDATER_INVALID_RANGE' }));
          return;
        }
        // A server ignoring Range (or a changed If-Range validator) returns a
        // fresh 200. Truncate before writing rather than concatenate two files.
        const initial = resumed ? offset : 0;
        if (resumeState) {
          resumeState.offset = initial;
          resumeState.total = total;
          // A 206 may omit validators. Keep the validator for the original
          // representation across every retry; only a fresh 200 may replace it.
          if (!resumed) {
            const etag = response.headers.etag;
            resumeState.validatorHeader = etag && !etag.startsWith('W/') ? 'etag' : 'last-modified';
            resumeState.validator = response.headers[resumeState.validatorHeader] || null;
          }
        }
        try { if (total > 0) checkInstallSpace(path.dirname(dest), total - initial); } catch (error) { fail(error); return; }
        file = fs.createWriteStream(dest, { flags: resumed ? 'a' : 'w' });
        file.on('error', (error) => {
          // A network failure may already be draining queued writes for resume.
          // Disk failure during that drain is terminal and must replace the
          // retryable transport error before close decides whether to retry.
          if (!failureError) fail(error);
          else if (draining) failureError = error;
        });
        armInactivity(idleTimeoutMs, '下载连接长时间无数据，请检查网络或切换下载线路');
        let received = initial;
        let lastProgressAt = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          armInactivity(idleTimeoutMs, '下载连接长时间无数据，请检查网络或切换下载线路');
          received += chunk.length;
          if (total > 0 && received > total) {
            fail(Object.assign(new Error('下载响应超出声明的文件大小'), { code: 'ERR_UPDATER_INVALID_RANGE' }));
            return;
          }
          const now = Date.now();
          if (typeof onProgress === 'function' && (now - lastProgressAt >= 250 || received === total)) {
            lastProgressAt = now;
            onProgress({
              phase: 'download',
              percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : null,
              received,
              total,
              bytesPerSecond: (received - initial) / Math.max(1, (Date.now() - started) / 1000),
              resumed: initial > 0,
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
        error.retryable = RETRYABLE_NETWORK_CODES.has(error.code);
        fail(error);
      });
    };
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
  const route = updateRoute();
  const current = currentVersion();
  if (route !== 'github') {
    const result = await require('../launcher/release-source').listFor(route, { installedVersion: current });
    return snapshot({ ...result, installed: getInstalledAppInfo() }, route);
  }
  try {
    const list = await githubJson(RELEASES_LIST);
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
  // Keep main's confirmed version, route and asset URLs together throughout
  // asynchronous checksum preparation, transfer and installation.
  info = { ...info };
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
  const context = { route: info.route || 'github', downloadMode };
  let stage = 'checksum';
  const journalProgress = (progress) => {
    let state;
    if (progress?.phase === 'resolve') {
      stage = 'checksum';
      state = { phase: 'checking', version };
    } else if (progress?.phase === 'download') {
      stage = 'transfer';
      state = { phase: 'downloading', version, percent: progress.percent ?? 0 };
    } else if (progress?.phase === 'verify') {
      stage = 'verification';
      state = { phase: 'verifying', version };
    } else if (progress?.phase === 'install') {
      stage = 'installation';
      state = { phase: 'installing', version };
    }
    if (state) state = { ...state, ...context, stage };
    if (state) {
      try { journal()?.state(state); } catch { /* evidence only */ }
      publishState(state);
    }
    if (typeof onProgress === 'function') onProgress(progress);
  };
  let dest;
  let preparedOptions = options;
  let extra = { downloadMode };
  try {
    if (downloadMode === 'delta') {
      journalProgress({ phase: 'resolve', stage: 'checksum' });
      const expected = await readAssetChecksum(info.assetName, info.checksumUrl, {
        signal: options.signal,
        onRetry: (retry) => journalProgress({ phase: 'resolve', stage: 'checksum', ...retry }),
      });
      journalProgress({ phase: 'download', percent: 0 });
      const outcome = await downloadLatestViaUpdater(
        { timeoutMs: DOWNLOAD_TIMEOUT_MS, expectedCheck: info, signal: options.signal },
        journalProgress, options.updaterDeps,
      );
      if (!outcome.ok) {
        if (outcome.reason === 'cancelled') throw cancelledError();
        throw Object.assign(new Error(outcome.message || '增量更新未完成，请重新选择完全下载。'), {
          code: outcome.reason === 'timeout' ? 'ETIMEDOUT' : outcome.reason,
        });
      }
      dest = outcome.installer;
      journalProgress({ phase: 'verify' });
      try {
        await verifyFileChecksum(dest, expected, options);
      } catch (error) {
        // The pinned updater skips hashing a same-process pending cache hit.
        // Remove rejected bytes so the next explicit attempt can reconstruct.
        if (error.code === 'ERR_UPDATER_CHECKSUM_MISMATCH') cleanupPartial(dest);
        throw error;
      }
      preparedOptions = { ...options, installerArgs: ['--updated', '/S', '--force-run'] };
      extra = { ...extra, updater: true, differential: Boolean(outcome.differential), downloadPercent: outcome.downloadPercent ?? null };
    } else {
      dest = await downloadReleaseAsset(info, fullInstallerPath(info, options), journalProgress, options);
    }
  } catch (error) {
    const state = { phase: 'error', version, ...context, stage, failedOperation: 'download', message: `${error.code || ''} ${error.message}` };
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
    // Unfinished work gets a short drain, then the update proceeds anyway:
    // nothing running may hold back an update the user confirmed.
    const result = await protection.coordinate('update', {
      terminal: quitAfterInstall, preConfirmed: true, force: true, drainTimeoutMs: 10_000, commit: launch,
    });
    if (!result.proceeded) {
      return {
        ...info,
        launched: false,
        cancelled: true,
        code: result.code || 'cancelled',
        ...(result.code === 'busy' ? { message: '另一个退出或更新操作正在进行，请稍候。' } : {}),
      };
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
  const route = updateRoute();
  try {
    let summary;
    if (route === 'github') {
      const release = await githubJson(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(raw)}`,
      );
      summary = release && summarizeRelease(release, currentVersion());
    } else {
      summary = await require('../launcher/release-source').releaseFor(route, raw, { installedVersion: currentVersion() });
    }
    if (!summary) {
      return snapshot({ status: 'error', message: 'release-not-found', launched: false }, route);
    }
    if (!summary.installable) {
      return snapshot({ ...summary, status: 'error', message: 'no-installer', launched: false }, route);
    }
    return installFromAsset({ ...summary, route }, onProgress, options);
  } catch (error) {
    return snapshot({
      status: 'error',
      message: error.message || String(error),
      launched: false,
    }, route);
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
  setUpdateRouteProvider,
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
  launchPreparedInstaller,
  downloadFile,
  launchInstaller,
  cleanupPartial,
  cancelledError,
  parseSha512Sums,
  verifyAssetChecksum,
  readAssetChecksum,
  verifyFileChecksum,
  downloadReleaseAsset,
  sha512HexOfFile,
  fullInstallerPath,
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
