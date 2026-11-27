'use strict';

const { GITHUB_OWNER, GITHUB_REPO, REPO_URL, currentVersion } = require('../update');
const { run: defaultRunCmd } = require('../git-exec');

const GITHUB_API_VERSION = '2022-11-28';
const GH_AUTH_TIMEOUT_MS = 4000;
const STAR_REQUEST_TIMEOUT_MS = 8000;
const STAR_API_URL = `https://api.github.com/user/starred/${GITHUB_OWNER}/${GITHUB_REPO}`;

/**
 * Resolve `config.githubToken` without throwing when Electron/config is unavailable.
 * @returns {string}
 */
function defaultGetConfigToken() {
  try {
    const tokenValue = require('../config').loadConfig()?.githubToken;
    return typeof tokenValue === 'string' ? tokenValue : '';
  } catch {
    return '';
  }
}

/**
 * Append a trimmed, single-line non-empty credential candidate if not already seen.
 * Uses a Set to avoid timing-sensitive string equality checks on credentials.
 * @param {string[]} candidates
 * @param {Set<string>} seen
 * @param {unknown} raw
 */
function pushCandidate(candidates, seen, raw) {
  if (typeof raw !== 'string') return;
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed) || seen.has(trimmed)) return;
  seen.add(trimmed);
  candidates.push(trimmed);
}

/**
 * Read a token from `gh auth token` with a bounded timeout, ignoring errors.
 * @param {typeof defaultRunCmd} runCmd
 * @returns {Promise<string>}
 */
async function readGhCliToken(runCmd) {
  try {
    const result = await runCmd('gh', ['auth', 'token'], process.cwd(), {
      timeoutMs: GH_AUTH_TIMEOUT_MS,
    });
    if (!result || result.timedOut || result.missing) return '';
    const exitCode = typeof result.code === 'number' ? result.code : result.exitCode;
    if (exitCode !== 0) return '';
    return typeof result.stdout === 'string' ? result.stdout : '';
  } catch {
    return '';
  }
}

/**
 * Collect deduplicated GitHub credential candidates in strict priority order:
 * 1. `config.githubToken`
 * 2. `gh auth token`
 * 3. `env.GH_TOKEN`
 * 4. `env.GITHUB_TOKEN`
 * @param {{
 *   getConfigToken?: () => string,
 *   runCmd?: typeof defaultRunCmd,
 *   env?: NodeJS.ProcessEnv,
 * }} [deps]
 * @returns {Promise<string[]>}
 */
async function resolveGithubCredentials(deps = {}) {
  const getConfigToken = typeof deps.getConfigToken === 'function'
    ? deps.getConfigToken
    : defaultGetConfigToken;
  const runCmd = typeof deps.runCmd === 'function' ? deps.runCmd : defaultRunCmd;
  const env = deps.env && typeof deps.env === 'object' ? deps.env : process.env;

  /** @type {string[]} */
  const candidates = [];
  /** @type {Set<string>} */
  const seen = new Set();

  try {
    pushCandidate(candidates, seen, getConfigToken());
  } catch {
    // Ignore config read errors and continue down the credential chain.
  }

  pushCandidate(candidates, seen, await readGhCliToken(runCmd));
  pushCandidate(candidates, seen, env.GH_TOKEN);
  pushCandidate(candidates, seen, env.GITHUB_TOKEN);

  return candidates;
}

/**
 * Build fixed GitHub REST headers for a credential without logging or exposing it.
 * @param {string} credential
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Record<string, string>}
 */
function buildStarHeaders(credential, extraHeaders = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${credential}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': `Deepseek-Harness-Desktop/${currentVersion()}`,
    ...extraHeaders,
  };
}

/**
 * Execute one GitHub Star API request with a bounded timeout and manual redirects.
 * @param {{
 *   method: 'GET' | 'PUT',
 *   credential: string,
 *   fetchImpl: typeof fetch,
 *   timeoutMs: number,
 *   extraHeaders?: Record<string, string>,
 * }} options
 * @returns {Promise<Response>}
 */
async function requestStarEndpoint({ method, credential, fetchImpl, timeoutMs, extraHeaders }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(STAR_API_URL, {
      method,
      headers: buildStarHeaders(credential, extraHeaders),
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Response} response
 * @returns {boolean}
 */
function isRedirectResponse(response) {
  return response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400);
}

/**
 * Check whether the authenticated GitHub user has starred `ChisaAlter/WhaleIsle`.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   runCmd?: typeof defaultRunCmd,
 *   getConfigToken?: () => string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 * }} [deps]
 * @returns {Promise<{ status: 'starred' | 'unstarred' | 'no-credentials' | 'auth-failed' | 'network-error' }>}
 */
async function checkStarStatus(deps = {}) {
  const candidates = await resolveGithubCredentials(deps);
  if (candidates.length === 0) {
    return { status: 'no-credentials' };
  }
  const fetchImpl = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : fetch;
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0
    ? deps.timeoutMs
    : STAR_REQUEST_TIMEOUT_MS;

  for (const credential of candidates) {
    let response;
    try {
      response = await requestStarEndpoint({
        method: 'GET',
        credential,
        fetchImpl,
        timeoutMs,
      });
    } catch {
      return { status: 'network-error' };
    }

    if (response.status === 204) return { status: 'starred' };
    if (response.status === 404) return { status: 'unstarred' };
    if (response.status === 401 || response.status === 403 || isRedirectResponse(response)) {
      continue;
    }
    return { status: 'network-error' };
  }

  return { status: 'auth-failed' };
}

/**
 * Star `ChisaAlter/WhaleIsle` using the highest-priority valid GitHub credential.
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   runCmd?: typeof defaultRunCmd,
 *   getConfigToken?: () => string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number,
 * }} [deps]
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'no-credentials' | 'auth-failed' | 'request-failed' }>}
 */
async function starRepository(deps = {}) {
  const candidates = await resolveGithubCredentials(deps);
  if (candidates.length === 0) {
    return { ok: false, reason: 'no-credentials' };
  }
  const fetchImpl = typeof deps.fetchImpl === 'function' ? deps.fetchImpl : fetch;
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0
    ? deps.timeoutMs
    : STAR_REQUEST_TIMEOUT_MS;

  for (const credential of candidates) {
    let response;
    try {
      response = await requestStarEndpoint({
        method: 'PUT',
        credential,
        fetchImpl,
        timeoutMs,
        extraHeaders: { 'Content-Length': '0' },
      });
    } catch {
      return { ok: false, reason: 'request-failed' };
    }

    if (response.status === 204 || response.status === 304) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      continue;
    }
    return { ok: false, reason: 'request-failed' };
  }

  return { ok: false, reason: 'auth-failed' };
}

module.exports = {
  GITHUB_OWNER,
  GITHUB_REPO,
  REPO_URL,
  STAR_API_URL,
  resolveGithubCredentials,
  checkStarStatus,
  starRepository,
};
