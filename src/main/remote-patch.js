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
 * }}
 */
function normalizeRemotePatch(patch) {
  if (!isPlainObject(patch)) {
    throw new TypeError('Remote patch must be an object');
  }
  /** @type {{ remoteEnabled?: boolean, remotePort?: number, remoteMode?: 'lan' | 'relay',
   *           remoteBindAddress?: string, remoteLanTls?: boolean, remoteRelayUrl?: string,
   *           remoteRelayUseTls?: boolean, remoteRelayToken?: string }} */
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
    throw new Error(`Config field is not renderer-writable: ${key}`);
  }
  return next;
}

module.exports = { normalizeRemotePatch };
