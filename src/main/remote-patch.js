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
 * @typedef {{ urls: string | string[], username?: string, credential?: string }} IceServerEntry
 * @typedef {{
 *   remoteEnabled?: boolean,
 *   remotePort?: number,
 *   remoteMode?: 'lan' | 'relay',
 *   remoteBindAddress?: string,
 *   remoteLanTls?: boolean,
 *   remoteRelayUrl?: string,
 *   remoteRelayUseTls?: boolean,
 *   remoteRelayToken?: string,
 *   remoteIceServers?: IceServerEntry[],
 * }} RemotePatch
 */

/**
 * Normalize the `urls` field of one ICE server entry.
 * @param {unknown} rawUrls
 * @param {boolean} strict
 * @returns {string | string[] | null}
 */
function normalizeIceServerUrls(rawUrls, strict) {
  if (typeof rawUrls === 'string') {
    const trimmed = rawUrls.trim();
    if (ICE_SERVER_URL_RE.test(trimmed)) return trimmed;
    if (strict) throw new TypeError(`Invalid STUN/TURN URL: ${rawUrls}`);
    return null;
  }
  if (!Array.isArray(rawUrls) || rawUrls.length === 0 || rawUrls.length > MAX_URLS_PER_ICE_SERVER) {
    if (strict) throw new TypeError('remoteIceServers entry urls must be a STUN/TURN URL string or non-empty array');
    return null;
  }
  /** @type {string[]} */
  const list = [];
  for (const item of rawUrls) {
    const trimmed = typeof item === 'string' ? item.trim() : '';
    if (!trimmed || !ICE_SERVER_URL_RE.test(trimmed)) {
      if (strict) throw new TypeError(`Invalid STUN/TURN URL in array: ${String(item)}`);
      return null;
    }
    list.push(trimmed);
  }
  return list;
}

/**
 * Validate an optional string credential field on an ICE server entry.
 * @param {Record<string, unknown>} entry
 * @param {'username' | 'credential'} field
 * @param {number} maxLength
 * @param {boolean} strict
 * @returns {{ ok: boolean, value?: string }}
 */
function normalizeOptionalIceField(entry, field, maxLength, strict) {
  const value = entry[field];
  if (value === undefined) return { ok: true };
  if (typeof value !== 'string' || value.length > maxLength || /[\r\n\0]/.test(value)) {
    if (strict) throw new TypeError(`remoteIceServers ${field} must be a valid string`);
    return { ok: false };
  }
  return value.length > 0 ? { ok: true, value } : { ok: true };
}

/**
 * Validate and normalize one STUN/TURN ICE server entry.
 * @param {unknown} entry
 * @param {boolean} strict
 * @returns {IceServerEntry | null}
 */
function normalizeIceServerEntry(entry, strict) {
  if (!isPlainObject(entry)) {
    if (strict) throw new TypeError('Each remoteIceServers entry must be an object');
    return null;
  }
  const record = /** @type {Record<string, unknown>} */ (entry);
  const urls = normalizeIceServerUrls(record.urls, strict);
  if (!urls) return null;
  const username = normalizeOptionalIceField(record, 'username', 256, strict);
  if (!username.ok) return null;
  const credential = normalizeOptionalIceField(record, 'credential', 512, strict);
  if (!credential.ok) return null;
  /** @type {IceServerEntry} */
  const cleaned = { urls };
  if (username.value !== undefined) cleaned.username = username.value;
  if (credential.value !== undefined) cleaned.credential = credential.value;
  return cleaned;
}

/**
 * Validate and normalize an array of STUN/TURN ICE server configs.
 * Throws TypeError when `strict` is true and any entry is invalid; otherwise
 * drops invalid entries safely (for disk config normalization).
 * @param {unknown} value
 * @param {{ strict?: boolean }} [options]
 * @returns {IceServerEntry[]}
 */
function normalizeRemoteIceServers(value, options = {}) {
  const strict = options.strict === true;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    if (strict) throw new TypeError('remoteIceServers must be an array');
    return [];
  }
  if (strict && value.length > MAX_ICE_SERVERS) {
    throw new TypeError(`remoteIceServers supports at most ${MAX_ICE_SERVERS} entries`);
  }
  /** @type {IceServerEntry[]} */
  const out = [];
  const limit = Math.min(value.length, MAX_ICE_SERVERS);
  for (let i = 0; i < limit; i += 1) {
    const cleaned = normalizeIceServerEntry(value[i], strict);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function expectBoolean(value, field) {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`);
  return value;
}

/**
 * @param {unknown} value
 * @param {RemotePatch} next
 */
function applyRelayUrlPatch(value, next) {
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
}

/** @type {Record<string, (value: unknown, next: RemotePatch) => void>} */
const REMOTE_PATCH_HANDLERS = {
  remoteEnabled: (value, next) => {
    next.remoteEnabled = expectBoolean(value, 'remoteEnabled');
  },
  remoteLanTls: (value, next) => {
    next.remoteLanTls = expectBoolean(value, 'remoteLanTls');
  },
  remoteBindAddress: (value, next) => {
    if (typeof value !== 'string' || !isBindableIpv4(value.trim())) {
      throw new TypeError('remoteBindAddress must be 0.0.0.0 or an IPv4 address');
    }
    next.remoteBindAddress = value.trim();
  },
  remoteMode: (value, next) => {
    if (value !== 'lan' && value !== 'relay') {
      throw new TypeError('remoteMode must be lan or relay');
    }
    next.remoteMode = value;
  },
  remotePort: (value, next) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1024 || value > 65535) {
      throw new TypeError('remotePort must be an integer from 1024 to 65535');
    }
    next.remotePort = value;
  },
  remoteRelayUrl: applyRelayUrlPatch,
  remoteRelayToken: (value, next) => {
    if (typeof value !== 'string' || value.length > 512) {
      throw new TypeError('remoteRelayToken must be a string up to 512 characters');
    }
    next.remoteRelayToken = value.trim();
  },
  remoteIceServers: (value, next) => {
    next.remoteIceServers = normalizeRemoteIceServers(value, { strict: true });
  },
};

/**
 * Accept only RemotePatch fields from the harness renderer.
 * Unknown keys fail closed so credentials and workspace cannot ride along.
 * @param {unknown} patch
 * @returns {RemotePatch}
 */
function normalizeRemotePatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Remote patch must be an object');
  }
  /** @type {RemotePatch} */
  const next = {};
  for (const [key, value] of Object.entries(/** @type {Record<string, unknown>} */ (patch))) {
    const handler = Object.prototype.hasOwnProperty.call(REMOTE_PATCH_HANDLERS, key)
      ? REMOTE_PATCH_HANDLERS[key]
      : null;
    if (!handler) {
      throw new Error(`Config field is not renderer-writable: ${key}`);
    }
    handler(value, next);
  }
  return next;
}

module.exports = { normalizeRemotePatch, normalizeRemoteIceServers };
