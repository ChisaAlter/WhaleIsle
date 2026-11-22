'use strict';

/** @param {unknown} value */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Dotted-quad IPv4 with every octet in range, or the all-interfaces wildcard.
 * @param {string} value
 */
function isBindableIpv4(value) {
  if (value === '0.0.0.0') {
    return true;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    return false;
  }
  return value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

const ICE_SERVER_URL_RE = /^(?:stuns?|turns?):[^\s\r\n\0]{1,512}$/i;
const MAX_ICE_SERVERS = 16;
const MAX_URLS_PER_ICE_SERVER = 8;

/**
 * Validate and normalize an array of STUN/TURN ICE server configs.
 * Throws TypeError when `strict` is true and any entry is invalid; otherwise
 * drops invalid entries safely (for disk config normalization).
 * @param {unknown} value
 * @param {{ strict?: boolean }} [options]
 * @returns {Array<{ urls: string | string[], username?: string, credential?: string }>}
 */
function normalizeRemoteIceServers(value, options = {}) {
  const strict = options.strict === true;
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    if (strict) {
      throw new TypeError('remoteIceServers must be an array');
    }
    return [];
  }
  if (value.length > MAX_ICE_SERVERS) {
    if (strict) {
      throw new TypeError(`remoteIceServers supports at most ${MAX_ICE_SERVERS} entries`);
    }
  }
  const out = [];
  const limit = Math.min(value.length, MAX_ICE_SERVERS);
  for (let i = 0; i < limit; i += 1) {
    const entry = value[i];
    if (!isPlainObject(entry)) {
      if (strict) throw new TypeError('Each remoteIceServers entry must be an object');
      continue;
    }
    const rawUrls = entry.urls;
    let normalizedUrls;
    if (typeof rawUrls === 'string') {
      const trimmed = rawUrls.trim();
      if (!ICE_SERVER_URL_RE.test(trimmed)) {
        if (strict) throw new TypeError(`Invalid STUN/TURN URL: ${rawUrls}`);
        continue;
      }
      normalizedUrls = trimmed;
    } else if (Array.isArray(rawUrls) && rawUrls.length > 0 && rawUrls.length <= MAX_URLS_PER_ICE_SERVER) {
      const list = [];
      let bad = false;
      for (const u of rawUrls) {
        if (typeof u !== 'string' || !ICE_SERVER_URL_RE.test(u.trim())) {
          bad = true;
          if (strict) throw new TypeError(`Invalid STUN/TURN URL in array: ${String(u)}`);
          break;
        }
        list.push(u.trim());
      }
      if (bad || list.length === 0) continue;
      normalizedUrls = list;
    } else {
      if (strict) throw new TypeError('remoteIceServers entry urls must be a STUN/TURN URL string or non-empty array');
      continue;
    }

    /** @type {{ urls: string | string[], username?: string, credential?: string }} */
    const cleaned = { urls: normalizedUrls };
    if (entry.username !== undefined) {
      if (typeof entry.username !== 'string' || entry.username.length > 256 || /[\r\n\0]/.test(entry.username)) {
        if (strict) throw new TypeError('remoteIceServers username must be a valid string');
        continue;
      }
      if (entry.username.length > 0) cleaned.username = entry.username;
    }
    if (entry.credential !== undefined) {
      if (typeof entry.credential !== 'string' || entry.credential.length > 512 || /[\r\n\0]/.test(entry.credential)) {
        if (strict) throw new TypeError('remoteIceServers credential must be a valid string');
        continue;
      }
      if (entry.credential.length > 0) cleaned.credential = entry.credential;
    }
    out.push(cleaned);
  }
  return out;
}

/**
 * Accept only RemotePatch fields from the harness renderer.
 * Unknown keys fail closed so credentials and workspace cannot ride along.
 * @param {unknown} patch
 * @returns {{
 *   remoteEnabled?: boolean,
 *   remotePort?: number,
 *   remoteMode?: 'lan' | 'relay',
 *   remoteBindAddress?: string,
 *   remoteLanTls?: boolean,
 *   remoteRelayUrl?: string,
 *   remoteRelayUseTls?: boolean,
 *   remoteRelayToken?: string,
 *   remoteIceServers?: Array<{ urls: string | string[], username?: string, credential?: string }>,
 * }}
 */
function normalizeRemotePatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Remote patch must be an object');
  }
  /** @type {{ remoteEnabled?: boolean, remotePort?: number, remoteMode?: 'lan' | 'relay',
   *           remoteBindAddress?: string, remoteLanTls?: boolean, remoteRelayUrl?: string,
   *           remoteRelayUseTls?: boolean, remoteRelayToken?: string,
   *           remoteIceServers?: Array<{ urls: string | string[], username?: string, credential?: string }> }} */
  const next = {};
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (patch))) {
    if (key === 'remoteEnabled') {
      if (typeof value !== 'boolean') {
        throw new TypeError('remoteEnabled must be a boolean');
      }
      next.remoteEnabled = value;
      continue;
    }
    if (key === 'remoteLanTls') {
      if (typeof value !== 'boolean') {
        throw new TypeError('remoteLanTls must be a boolean');
      }
      next.remoteLanTls = value;
      continue;
    }
    if (key === 'remoteBindAddress') {
      if (typeof value !== 'string' || !isBindableIpv4(value.trim())) {
        throw new TypeError('remoteBindAddress must be 0.0.0.0 or an IPv4 address');
      }
      next.remoteBindAddress = value.trim();
      continue;
    }
    if (key === 'remoteMode') {
      if (value !== 'lan' && value !== 'relay') {
        throw new TypeError('remoteMode must be lan or relay');
      }
      next.remoteMode = value;
      continue;
    }
    if (key === 'remotePort') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65535) {
        throw new TypeError('remotePort must be an integer from 1024 to 65535');
      }
      next.remotePort = value;
      continue;
    }
    if (key === 'remoteRelayUrl') {
      if (typeof value !== 'string' || value.length > 2048) {
        throw new TypeError('remoteRelayUrl must be a valid string');
      }
      const relayUrl = value.trim();
      next.remoteRelayUrl = relayUrl;
      if (/^https:\/\//i.test(relayUrl)) {
        next.remoteRelayUseTls = true;
      } else if (/^http:\/\//i.test(relayUrl)) {
        next.remoteRelayUseTls = false;
      } else {
        next.remoteRelayUseTls = /:443(?:\/|$)/.test(relayUrl);
      }
      continue;
    }
    if (key === 'remoteRelayToken') {
      if (typeof value !== 'string' || value.length > 512) {
        throw new TypeError('remoteRelayToken must be a string up to 512 characters');
      }
      next.remoteRelayToken = value.trim();
      continue;
    }
    if (key === 'remoteIceServers') {
      next.remoteIceServers = normalizeRemoteIceServers(value, { strict: true });
      continue;
    }
    throw new Error(`Config field is not renderer-writable: ${key}`);
  }
  return next;
}

module.exports = { normalizeRemotePatch, normalizeRemoteIceServers };
