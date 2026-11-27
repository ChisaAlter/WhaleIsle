'use strict';

const { URL } = require('node:url');

/** Document navigations that must stay http(s) (or about:blank bootstrap for webviews). */
const FRAME_RESOURCE_TYPES = new Set(['mainFrame', 'subFrame']);

const IPV4_LOOPBACK_RE = /^127\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_MAPPED_LOOPBACK_RE = /^::ffff:(?:127\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)|7f[0-9a-f]{2}:[0-9a-f]{1,4}|0\.0\.0\.0|0:0)$/;

/**
 * True when `hostname` refers to the local machine via loopback or unspecified
 * bind aliases (`localhost`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `::1`, `::`,
 * or IPv4-mapped IPv6 equivalents).
 * @param {unknown} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  const raw = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (!raw) return false;
  if (raw === 'localhost' || raw.endsWith('.localhost')) return true;
  if (raw === '0.0.0.0' || raw === '::1' || raw === '::') return true;
  if (raw === '0:0:0:0:0:0:0:1' || raw === '0:0:0:0:0:0:0:0') return true;
  return IPV4_LOOPBACK_RE.test(raw) || IPV6_MAPPED_LOOPBACK_RE.test(raw);
}

function effectivePort(/** @type {URL} */ parsed) {
  if (parsed.port) return parsed.port;
  if (parsed.protocol === 'http:' || parsed.protocol === 'ws:') return '80';
  if (parsed.protocol === 'https:' || parsed.protocol === 'wss:') return '443';
  return '';
}

function defaultControlOrigins() {
  const urls = [];
  try {
    const { getHarnessOrigin } = require('./window');
    const origin = typeof getHarnessOrigin === 'function' ? getHarnessOrigin() : '';
    if (origin) urls.push(origin);
  } catch {
    // Window module unavailable in isolated tests.
  }
  try {
    const { desktopInstallEnv } = require('./desktop-install-control');
    const controlUrl = typeof desktopInstallEnv === 'function'
      ? desktopInstallEnv()?.DSH_DESKTOP_INSTALL_URL
      : '';
    if (controlUrl) urls.push(controlUrl);
  } catch {
    // Install control module unavailable in isolated tests.
  }
  return urls;
}

/**
 * True when `url` targets the same origin or loopback alias and port as `candidate`.
 * @param {URL} url
 * @param {unknown} candidate
 * @returns {boolean}
 */
function matchesControlOrigin(url, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return false;
  try {
    const host = new URL(candidate);
    if (effectivePort(url) !== effectivePort(host)) return false;
    const left = url.hostname.toLowerCase().replace(/\.+$/, '');
    const right = host.hostname.toLowerCase().replace(/\.+$/, '');
    return left === right || (isLoopbackHost(left) && isLoopbackHost(right));
  } catch {
    return false;
  }
}

/**
 * True when `url` hits any desktop control-plane origin (Harness loopback,
 * desktop install control server, or caller-supplied origins).
 * @param {URL} url
 * @param {{ blockedOrigins?: string[], getHarnessOrigin?: () => string | undefined }} [options]
 * @returns {boolean}
 */
function isBlockedControlUrl(url, options) {
  const origins = [
    ...defaultControlOrigins(),
    ...(Array.isArray(options?.blockedOrigins) ? options.blockedOrigins : []),
  ];
  if (typeof options?.getHarnessOrigin === 'function') {
    const origin = options.getHarnessOrigin();
    if (origin) origins.push(origin);
  }
  return origins.some((candidate) => matchesControlOrigin(url, candidate));
}

module.exports = {
  FRAME_RESOURCE_TYPES,
  isBlockedControlUrl,
};
