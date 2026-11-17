'use strict';

/**
 * Official DeepSeek host. Third-party OpenAI-compatible gateways (Ayase,
 * etc.) must not be written to DEEPSEEK_BASE_URL.
 */
const OFFICIAL_DEEPSEEK_HOST = 'api.deepseek.com';

/**
 * Official Messages-protocol root. Since dsh 0.1.6 the deepseek provider
 * defaults to the Messages protocol and POSTs `${baseURL}/v1/messages`, so a
 * bare `https://api.deepseek.com` (or the legacy `/v1` suffix) targets a path
 * the official host does not serve; the Messages root lives under
 * `/anthropic`.
 */
const OFFICIAL_DEEPSEEK_MESSAGES_URL = 'https://api.deepseek.com/anthropic';

/**
 * Normalize an official-host base URL for the Messages protocol: bare roots
 * and the legacy `/v1` suffix remap onto `/anthropic`; any other explicit
 * path (already `/anthropic`, or a deliberate subpath) passes through.
 * @param {string} baseUrl - trimmed https URL on api.deepseek.com
 * @returns {string}
 */
function normalizeOfficialDeepSeekBaseUrl(baseUrl) {
  const path = new URL(baseUrl).pathname.replace(/\/+$/, '');
  if (path === '' || path === '/v1') return OFFICIAL_DEEPSEEK_MESSAGES_URL;
  return baseUrl;
}

/**
 * True when the shell gateway is official DeepSeek: empty/whitespace (public
 * API default) or an https URL whose hostname is api.deepseek.com. Plain
 * http is rejected so credentials are never aliased onto a cleartext origin.
 * @param {unknown} baseUrl
 * @returns {boolean}
 */
function isOfficialDeepSeekBaseUrl(baseUrl) {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!raw) return true;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return parsed.hostname.toLowerCase() === OFFICIAL_DEEPSEEK_HOST;
}

/**
 * Copy shell credentials onto DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL only for
 * the official host. Custom providers keep their own settings; aliasing a
 * third-party gateway onto these names makes vision-fallback hit the wrong
 * origin with official model ids.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ apiKey?: string, baseUrl?: string }} [config]
 * @returns {NodeJS.ProcessEnv}
 */
function applyOfficialDeepSeekSpawnEnv(env, config = {}) {
  if (!isOfficialDeepSeekBaseUrl(config.baseUrl)) {
    return env;
  }
  if (config.apiKey) {
    env.DEEPSEEK_API_KEY = config.apiKey;
  }
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (baseUrl) {
    env.DEEPSEEK_BASE_URL = normalizeOfficialDeepSeekBaseUrl(baseUrl);
  }
  return env;
}

module.exports = {
  isOfficialDeepSeekBaseUrl,
  applyOfficialDeepSeekSpawnEnv,
};
