'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_GATEWAY_PORT } = require('./platform');

/**
 * @param {string} file
 * @returns {any}
 */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

const EPHEMERAL_RUNTIME_ENTRIES = new Set([
  'gateway.json',
  'web-page.json',
  'gateway.key',
  'state.json',
  'cache',
  'component.log',
]);

/**
 * Whether `~/.config/magpie` already carries user Magpie config/accounts.
 * Any entry outside known ephemeral runtime markers counts as user data so
 * uninstall never wipes shared or unrecognized files.
 * @param {string} configDir
 * @returns {boolean}
 */
function hasSharedUserConfig(configDir) {
  if (!configDir) return false;
  let entries;
  try {
    entries = fs.readdirSync(configDir);
  } catch {
    return false;
  }
  for (const name of entries) {
    if (!EPHEMERAL_RUNTIME_ENTRIES.has(name) && !name.endsWith('.lock')) {
      return true;
    }
  }
  return false;
}

/**
 * Read `<configDir>/web-page.json` written by Magpie Desktop when Browser access is on.
 * @param {string} configDir
 * @returns {{ port: number, key: string, mode: string, url: string } | null}
 */
function readWebPageAccess(configDir) {
  const raw = readJsonSafe(path.join(configDir, 'web-page.json'));
  const port = Number(raw?.port);
  const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !key) {
    return null;
  }
  return {
    port,
    key,
    mode: typeof raw?.mode === 'string' ? raw.mode : 'local',
    url: `http://127.0.0.1:${port}/?k=${encodeURIComponent(key)}`,
  };
}

/**
 * Resolve candidate gateway address from `gateway.json`, `settings.json`, or default 3425.
 * @param {string} configDir
 * @returns {{ addr: string, gatewayFilePid: number | null }}
 */
function resolveGatewayCandidate(configDir) {
  const gw = readJsonSafe(path.join(configDir, 'gateway.json'));
  if (gw && typeof gw.addr === 'string' && gw.addr.trim()) {
    const pid = Number.isInteger(gw.pid) ? gw.pid : null;
    return { addr: gw.addr.trim(), gatewayFilePid: pid };
  }
  const settings = readJsonSafe(path.join(configDir, 'settings.json'));
  const port = Number(settings?.port);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    return { addr: `127.0.0.1:${port}`, gatewayFilePid: null };
  }
  return { addr: `127.0.0.1:${DEFAULT_GATEWAY_PORT}`, gatewayFilePid: null };
}

/**
 * Normalize a listen address such as `0.0.0.0:3425` or `:3425` to loopback connect host.
 * Rejects non-loopback hosts, userinfo, paths, queries, and fragments.
 * @param {string} addr
 * @returns {string}
 */
function toLoopbackHostPort(addr) {
  const raw = String(addr || '').trim();
  if (!raw) return `127.0.0.1:${DEFAULT_GATEWAY_PORT}`;
  const stripped = raw.replace(/^https?:\/\//i, '');
  const normalized = stripped.startsWith(':')
    ? `127.0.0.1${stripped}`
    : stripped.replace(/^0\.0\.0\.0(?=:|$)/, '127.0.0.1').replace(/^\[::\](?=:|$)/, '127.0.0.1');
  let parsed;
  try {
    parsed = new URL(`http://${normalized}`);
  } catch {
    throw new Error(`非法 Magpie 网关地址：${raw}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  if (!isLoopback || parsed.username || parsed.password || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error(`拒绝非回环 Magpie 网关地址：${raw}`);
  }
  const port = parsed.port || String(DEFAULT_GATEWAY_PORT);
  const formattedHost = (host === '::1' || host === '[::1]') ? '[::1]' : host;
  return `${formattedHost}:${port}`;
}

/**
 * @param {string} url
 * @param {(url: string, init?: RequestInit) => Promise<Response>} fetchImpl
 */
async function defaultFetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Probe `GET http://<addr>/` to confirm an active Magpie gateway and read its identity.
 * @param {string} addr
 * @param {{ fetchJson?: (url: string, init?: RequestInit) => Promise<any>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 */
async function probeGateway(addr, options = {}) {
  try {
    const target = toLoopbackHostPort(addr);
    const data = options.fetchJson
      ? await options.fetchJson(`http://${target}/`, { signal: AbortSignal.timeout(2500) })
      : await defaultFetchJson(`http://${target}/`, options.fetchImpl || fetch);
    if (data?.name !== 'magpie') return null;
    return {
      addr: target,
      pid: Number.isInteger(data.pid) ? data.pid : null,
      version: typeof data.version === 'string' ? data.version.replace(/^v/i, '') : '',
      serves: typeof data.serves === 'string' ? data.serves : '',
      draining: Boolean(data.draining),
    };
  } catch {
    return null;
  }
}

/**
 * Probe `GET http://<addr>/v1/magpie/concurrency` for active streams / waiting tool calls.
 * @param {string} addr
 * @param {{ fetchJson?: (url: string, init?: RequestInit) => Promise<any>, fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 * @returns {Promise<{ requests: number, waiting: number, tools: number } | null>}
 */
async function probeConcurrency(addr, options = {}) {
  try {
    const target = toLoopbackHostPort(addr);
    const data = options.fetchJson
      ? await options.fetchJson(`http://${target}/v1/magpie/concurrency`, { signal: AbortSignal.timeout(2500) })
      : await defaultFetchJson(`http://${target}/v1/magpie/concurrency`, options.fetchImpl || fetch);
    if (!data || typeof data !== 'object') return null;
    return {
      requests: Number(data.requests) || 0,
      waiting: Number(data.waiting) || 0,
      tools: Number(data.tools) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Check whether a loopback HTTP endpoint responds (2xx/3xx/401/403, rejecting 404).
 * @param {string} url
 * @param {{ fetchImpl?: (url: string, init?: RequestInit) => Promise<Response> }} [options]
 */
async function probeHttpReachable(url, options = {}) {
  const doFetch = options.fetchImpl || fetch;
  try {
    const response = await doFetch(url, { signal: AbortSignal.timeout(2000) });
    return (response.status >= 200 && response.status < 400)
      || response.status === 401
      || response.status === 403;
  } catch {
    return false;
  }
}

/**
 * Validate a recorded local process (`managedState` or `companionState`) against OS liveness and `/boot.js`.
 * @param {any} record
 * @param {{ isPidAlive?: (pid: number) => boolean, probeReachable?: (url: string) => Promise<boolean> }} options
 */
async function verifyWebProcessRecord(record, options) {
  if (!record || !Number.isInteger(record.pid) || !record.webUrl) return null;
  const alive = options.isPidAlive ? options.isPidAlive(record.pid) : true;
  if (!alive) return null;
  let parsed;
  try {
    parsed = new URL(record.webUrl);
  } catch {
    return null;
  }
  const bootUrl = `${parsed.origin}/boot.js`;
  const probe = options.probeReachable;
  const ok = typeof probe === 'function' ? await probe(bootUrl) : false;
  return ok ? record : null;
}

/**
 * Classify an active external gateway (`external` when its web UI is live, else `external-ui-companion`).
 * @param {string} configDir
 * @param {any} gateway
 * @param {any} liveCompanion
 * @param {(url: string) => Promise<boolean>} probeReachable
 */
async function classifyExternalGateway(configDir, gateway, liveCompanion, probeReachable) {
  const webAccess = readWebPageAccess(configDir);
  if (webAccess && await probeReachable(`http://127.0.0.1:${webAccess.port}/boot.js`)) {
    return {
      ownership: 'external',
      running: true,
      sharedConfig: true,
      gateway,
      webUrl: webAccess.url,
      managedPid: null,
      companionPid: null,
    };
  }
  return {
    ownership: 'external-ui-companion',
    running: true,
    sharedConfig: true,
    gateway,
    webUrl: liveCompanion?.webUrl || '',
    managedPid: null,
    companionPid: liveCompanion?.pid || null,
  };
}

/**
 * Detect which of the four ownership modes currently applies:
 * 1. `external`: another Magpie gateway is running AND its web UI is already reachable.
 * 2. `external-ui-companion`: another Magpie gateway is running without web UI; launcher may run a UI-only companion.
 * 3. `managed-shared-config`: no gateway running, `~/.config/magpie` already exists.
 * 4. `managed`: no gateway running and no pre-existing `~/.config/magpie` (or created by launcher).
 * @param {{
 *   configDir: string,
 *   managedState?: any,
 *   companionState?: any,
 *   installed?: any,
 *   fetchJson?: (url: string, init?: RequestInit) => Promise<any>,
 *   fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>,
 *   isPidAlive?: (pid: number) => boolean,
 *   probeReachable?: (url: string) => Promise<boolean>,
 * }} options
 */
async function detectMagpieState(options) {
  const { configDir, managedState, companionState, installed } = options;
  const sharedConfig = hasSharedUserConfig(configDir);
  const probeReachable = options.probeReachable
    || ((url) => probeHttpReachable(url, { fetchImpl: options.fetchImpl }));

  const liveManaged = await verifyWebProcessRecord(managedState, {
    isPidAlive: options.isPidAlive,
    probeReachable,
  });
  const liveCompanion = await verifyWebProcessRecord(companionState, {
    isPidAlive: options.isPidAlive,
    probeReachable,
  });

  const candidate = resolveGatewayCandidate(configDir);
  const gateway = await probeGateway(candidate.addr, {
    fetchJson: options.fetchJson,
    fetchImpl: options.fetchImpl,
  });

  if (gateway) {
    const ownedByManaged = Boolean(liveManaged && (!gateway.pid || gateway.pid === liveManaged.pid));
    if (!ownedByManaged) {
      return classifyExternalGateway(configDir, gateway, liveCompanion, probeReachable);
    }
    return {
      ownership: sharedConfig && !installed?.managedOnly ? 'managed-shared-config' : 'managed',
      running: true,
      sharedConfig,
      gateway,
      webUrl: liveManaged.webUrl,
      managedPid: liveManaged.pid,
      companionPid: null,
    };
  }

  return {
    ownership: sharedConfig && !installed?.managedOnly ? 'managed-shared-config' : 'managed',
    running: false,
    sharedConfig,
    gateway: null,
    webUrl: liveManaged?.webUrl || '',
    managedPid: liveManaged?.pid || null,
    companionPid: null,
  };
}

module.exports = {
  EPHEMERAL_RUNTIME_ENTRIES,
  hasSharedUserConfig,
  toLoopbackHostPort,
  resolveGatewayCandidate,
  probeGateway,
  probeConcurrency,
  probeHttpReachable,
  detectMagpieState,
};
