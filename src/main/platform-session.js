'use strict';

/**
 * Loopback PlatformSession client: per-boot Bearer token handed to the Host
 * child via env (same carrier as the task-control token), and the session
 * snapshot fetch used by DesktopPlatformView.
 */

const { randomBytes } = require('node:crypto');

/** @type {string | null} */
let processToken = null;

/** Per-shell-process Platform route credential handed to the Host child via env. */
function platformToken() {
  if (processToken === null) {
    processToken = randomBytes(24).toString('hex');
  }
  return processToken;
}

/**
 * Fetch the current PlatformSession from the Host publisher route.
 * @param {string} origin - Host loopback origin.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<unknown>} the session snapshot or null when absent/account missing.
 */
async function fetchPlatformSession(origin, fetchImpl = fetch) {
  const response = await fetchImpl(`${String(origin).replace(/\/$/, '')}/dshd-platform/session`, {
    headers: { authorization: `Bearer ${platformToken()}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return null;
  return body.session ?? null;
}

module.exports = { platformToken, fetchPlatformSession };
