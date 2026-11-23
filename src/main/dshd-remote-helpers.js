'use strict';

/**
 * Pure configuration, environment, pairing-helper, and child-process helpers
 * extracted from `src/main/dshd-remote.js` to stay within structure limits.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { applyOfficialDeepSeekSpawnEnv } = require('../shared/official-deepseek-env');
const {
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_ENDPOINT,
  DEFAULT_RELAY_USE_TLS,
  listLanAddresses,
  normalizePublicAppBaseUrl,
  preferredLanIp,
  publicUrl,
} = require('../shared/lan');
const { MOBILE_WEB_PORT } = require('./mobile-web-server');
const { normalizeRemoteIceServers } = require('./remote-patch');

function resolveVendorRoot() {
  // Packaged: extraResources -> resources/vendor/dshd-remote
  // Dev: upstream source tree remains vendor/chisacode-remote.
  try {
    const { app } = require('electron');
    if (app && app.isPackaged) {
      return path.join(process.resourcesPath, 'vendor', 'dshd-remote');
    }
  } catch {
    // electron unavailable in plain node tests
  }
  return path.join(__dirname, '..', '..', 'vendor', 'chisacode-remote');
}

const VENDOR_ROOT = resolveVendorRoot();
const SERVER_EXPORT = path.join(
  VENDOR_ROOT,
  'node_modules',
  '@chisacode',
  'server',
  'dist',
  'server',
  'server',
  'exports.js',
);
const SERVER_DIR = path.dirname(SERVER_EXPORT);
// Narrow main-process entries next to the barrel (see loadServerApi).
const PAIRING_OFFER_EXPORT = path.join(SERVER_DIR, 'pairing-offer.js');
const DEVICE_STORE_EXPORT = path.join(SERVER_DIR, 'relay-device-credential-store.js');
const PAIRING_LINK_STORE_EXPORT = path.join(SERVER_DIR, 'relay-pairing-link-store.js');

/**
 * Plain-node children cannot read app.asar; the runner ships via asarUnpack.
 * @param {string} file
 * @returns {string}
 */
function unpackedPath(file) {
  return file.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
}

const RUNNER_PATH = unpackedPath(path.join(__dirname, 'dshd-daemon-runner.mjs'));

/** Ready wait for the daemon child (cold dist import + port bind). */
const DAEMON_READY_TIMEOUT_MS = 30_000;
/** Graceful-stop wait before the child is force-killed. */
const DAEMON_STOP_TIMEOUT_MS = 5_000;
/** Startup stderr kept for the failure message. */
const DAEMON_STDERR_TAIL_LIMIT = 8_192;

function defaultHarnessRoot() {
  try {
    // Packaged: extracted harness runtime; dev: repo vendor tree.
    return require('./paths').harnessRoot();
  } catch {
    // Plain-node tests: same fallback shape as resolveVendorRoot above.
    return path.join(__dirname, '..', '..', 'vendor', 'deepseek-harness');
  }
}

/**
 * Bundled-harness plugin tree that can serve as `CHISACODE_DSH_VENDOR_DIR`.
 * Complete only when every dsh vendor package is present AND built
 * (`lib/index.js` — the managed cordis.yml points plugin URLs there, so a
 * source-only checkout must not qualify).
 * @param {{ root?: string, packages?: readonly string[] | null }} [options]
 * @returns {string | null}
 */
function desktopDshVendorDir(options = {}) {
  const packages = options.packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    return null;
  }
  const root = options.root || defaultHarnessRoot();
  const candidate = path.join(root, 'node_modules', '@deepseek-ai');
  const complete = packages.every((pkg) => fs.existsSync(path.join(candidate, pkg, 'lib', 'index.js')));
  return complete ? candidate : null;
}

/**
 * Product Away defaults — always from hardcoded `lan.js` constants so Setup.exe
 * works with zero user config (no reliance on defaults.json surviving the pack).
 */
function readDefaults() {
  return {
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: DEFAULT_RELAY_USE_TLS,
    relayEnabled: true,
    // Documented default origin only — never used as QR SPA landing.
    appBaseUrl: '',
    listen: '127.0.0.1:6767',
  };
}

/**
 * Mirror of upstream `DSH_VENDOR_PACKAGES` (vendored
 * `packages/server/src/server/agent/providers/dsh-agent.ts`). Importing that
 * module pulls the provider graph into the main process; a parity test in
 * dshd-remote.test.js pins this list to the vendored source.
 */
const DSH_VENDOR_PACKAGES = [
  'dsh-llm-deepseek',
  'dsh-sandbox-local',
  'dsh-sandbox-policy',
  'dsh-subprocess-local',
  'dsh-bash-sandbox',
  'dsh-user-approval',
  'dsh-fs-sandbox',
  'dsh-fs-observation-policy',
  'dsh-tool-fs',
  'dsh-token-meter',
  'dsh-compaction-basic',
  'dsh-repeat-tool-reminder',
];

/**
 * Load the narrow dshd-remote slice of @chisacode/server: pairing offers and
 * the device store are file-backed against the same chisacode home (the
 * upstream `daemon pair` shape). `SERVER_EXPORT` is the whole daemon graph —
 * tens of thousands of ESM modules loaded synchronously on the calling
 * thread, which freezes the Electron main process on a cold install. It
 * stays the completeness canary and the daemon child's entry; never import
 * it here.
 * @returns {Promise<{ generateLocalPairingOffer: Function, RelayDeviceCredentialStore: Function, RelayPairingLinkStore: Function, DSH_VENDOR_PACKAGES: readonly string[] }>}
 */
async function loadServerApi() {
  if (!fs.existsSync(SERVER_EXPORT)) {
    throw new Error(
      `dshd remote runtime missing at ${SERVER_EXPORT}. Run vendor sync / build packages/server.`,
    );
  }
  const [pairing, store, links] = await Promise.all([
    import(pathToFileURL(PAIRING_OFFER_EXPORT).href),
    import(pathToFileURL(DEVICE_STORE_EXPORT).href),
    import(pathToFileURL(PAIRING_LINK_STORE_EXPORT).href),
  ]);
  return {
    generateLocalPairingOffer: pairing.generateLocalPairingOffer,
    RelayDeviceCredentialStore: store.RelayDeviceCredentialStore,
    RelayPairingLinkStore: links.RelayPairingLinkStore,
    DSH_VENDOR_PACKAGES,
  };
}

/**
 * @param {Record<string, any>} config
 * @returns {boolean}
 */
function modeIsAway(config) {
  return config.remoteMode !== 'lan';
}

/**
 * @param {Record<string, any>} [config]
 * @returns {string}
 */
function mobileBindAddress(config = {}) {
  return typeof config.remoteBindAddress === 'string' && config.remoteBindAddress
    ? config.remoteBindAddress
    : '127.0.0.1';
}

/**
 * @param {Record<string, any>} config
 * @returns {string}
 */
function resolvedAppBaseUrl(config) {
  if (modeIsAway(config)) {
    const relayEndpoint = typeof config.remoteRelayEndpoint === 'string'
      ? config.remoteRelayEndpoint.trim()
      : DEFAULT_RELAY_ENDPOINT;
    const rawAppBaseUrl = typeof config.remoteAppBaseUrl === 'string' ? config.remoteAppBaseUrl : '';
    return normalizePublicAppBaseUrl(rawAppBaseUrl, {
      relayEndpoint,
    }) || DEFAULT_PUBLIC_APP_BASE_URL;
  }
  const bind = mobileBindAddress(config);
  const ip = bind === '0.0.0.0' ? (preferredLanIp() || '127.0.0.1') : bind;
  return publicUrl(ip, MOBILE_WEB_PORT).replace(/\/$/, '');
}

/** @type {Record<string, number>} */
const TRANSPORT_MODE_RANK = { lan: 3, p2p: 2, turn: 1, relay: 0 };

/**
 * Ranked `host:port` endpoints for zero-external-server LAN pairing offers.
 * @param {Record<string, any>} [config]
 * @returns {string[]}
 */
function lanPairingEndpoints(config = {}) {
  if (modeIsAway(config)) {
    return [];
  }
  const bind = mobileBindAddress(config);
  if (bind !== '0.0.0.0') {
    return [`${bind}:${MOBILE_WEB_PORT}`];
  }
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();
  /** @param {unknown} ip */
  const pushIp = (ip) => {
    const clean = typeof ip === 'string' ? ip.trim() : '';
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    ordered.push(`${clean}:${MOBILE_WEB_PORT}`);
  };
  pushIp(preferredLanIp());
  for (const addr of listLanAddresses()) {
    pushIp(addr);
  }
  if (ordered.length === 0) {
    ordered.push(`127.0.0.1:${MOBILE_WEB_PORT}`);
  }
  return ordered;
}

/**
 * @param {Record<string, any>} [config]
 */
function iceServersFromConfig(config = {}) {
  return normalizeRemoteIceServers(config.remoteIceServers, { strict: false });
}

/**
 * @param {Map<string, string>} modesMap
 * @returns {string}
 */
function bestActiveTransportMode(modesMap) {
  let best = '';
  let bestRank = -1;
  for (const mode of modesMap.values()) {
    const rank = Object.prototype.hasOwnProperty.call(TRANSPORT_MODE_RANK, mode)
      ? TRANSPORT_MODE_RANK[mode]
      : -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = mode;
    }
  }
  return best;
}

/**
 * The unauthenticated daemon stays loopback; the visible port control owns its port.
 * @param {Record<string, any>} [config]
 * @returns {string}
 */
function daemonListen(config = {}) {
  const port = Number(config.remotePort);
  return `127.0.0.1:${Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 6767}`;
}

/**
 * @param {Record<string, any>} config
 * @param {string} endpoint
 * @returns {boolean}
 */
function relayUseTls(config, endpoint) {
  if (typeof config.remoteRelayUseTls === 'boolean') {
    return config.remoteRelayUseTls;
  }
  if (endpoint === DEFAULT_RELAY_ENDPOINT) {
    return DEFAULT_RELAY_USE_TLS;
  }
  return /:443$/.test(endpoint);
}

/**
 * @param {{ listDevices?: () => Array<Record<string, unknown>> } | null | undefined} store
 */
function publicDevicesFromStore(store) {
  if (!store || typeof store.listDevices !== 'function') {
    return [];
  }
  return store.listDevices()
    .filter((device) => !device.revokedAt)
    .map((device) => ({
      id: device.deviceId,
      name: device.label || device.deviceId,
      createdAt: device.createdAt || '',
      boundAt: device.createdAt || '',
      lastSeenAt: device.lastUsedAt || device.createdAt || '',
      shortId: String(device.deviceId || '').slice(-4),
    }));
}

/**
 * Relay control state from one parsed daemon log record. Replaces the old
 * in-process logger-wrapping probe (`attachRelayStatusProbe`): the daemon now
 * runs in a child process whose pino JSON lines are the same stable upstream
 * identifiers, read at the process boundary instead of by monkey-patching the
 * logger.
 * @param {{ msg?: unknown, err?: { message?: unknown } | null, reason?: unknown }} record
 * @param {{ connected?: boolean, lastError?: string } | null} [previous]
 * @returns {{ connected: boolean, lastError: string } | null}
 */
function relayStatusFromLogRecord(record, previous) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const msg = typeof record.msg === 'string' ? record.msg : '';
  if (msg === 'relay_control_connected') {
    return { connected: true, lastError: '' };
  }
  if (msg === 'relay_error' || msg === 'relay_control_disconnected') {
    const err = record.err;
    const detail = (err && typeof err === 'object' && err.message) || record.reason || '';
    const lastError = String(detail || msg);
    const prior = previous && previous.lastError ? String(previous.lastError) : '';
    const keepPrior = lastError === 'relay_control_disconnected'
      && prior
      && prior !== 'relay_control_disconnected';
    return { connected: false, lastError: keepPrior ? prior : lastError };
  }
  return null;
}

/**
 * Line-buffered reader over a child stdio pipe.
 * @param {import('stream').Readable | null} stream
 * @param {(line: string) => void} onLine
 */
function wireLineReader(stream, onLine) {
  if (!stream) {
    return;
  }
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line) {
        onLine(line);
      }
      newline = buffer.indexOf('\n');
    }
  });
  stream.on('error', () => {});
}

/**
 * @param {import('child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true when the child exited within the window
 */
function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

/** @returns {Error & { code: string }} */
function daemonStartCancelled() {
  const error = /** @type {Error & { code: string }} */ (new Error('远程守护进程启动已取消'));
  error.code = 'DSHD_REMOTE_CANCELLED';
  return error;
}

/**
 * Desktop-facing home override (naming: `DSHD_*`, the desktop env family —
 * `CHISACODE_HOME` never appears in the shell's own environment). Mirrors the
 * dsh-home law: packaged builds ignore an inherited `DSHD_CHISACODE_HOME`
 * unless `DSHD_ALLOW_ENV_HOME=1` explicitly opts in.
 * @param {{ defaultDir: string, env?: NodeJS.ProcessEnv, isPackaged?: boolean }} options
 * @returns {string}
 */
function resolveDesktopChisaCodeHome({ defaultDir, env = process.env, isPackaged = false }) {
  const value = typeof env.DSHD_CHISACODE_HOME === 'string' ? env.DSHD_CHISACODE_HOME.trim() : '';
  if (!value) {
    return defaultDir;
  }
  if (isPackaged && env.DSHD_ALLOW_ENV_HOME !== '1') {
    return defaultDir;
  }
  return value;
}

/**
 * dsh provider plugin tree for the daemon child. Precedence: desktop-facing
 * `DSHD_DSH_VENDOR_DIR` > inherited upstream `CHISACODE_DSH_VENDOR_DIR`
 * (compat) > bundled harness when complete > null (the child falls back to
 * the stdio-hardened npm-global probe).
 * @param {{ DSH_VENDOR_PACKAGES?: readonly string[] } | null} api
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ root?: string }} [options]
 * @returns {string | null}
 */
function dshVendorDirForChild(api, env = process.env, options = {}) {
  const desktop = typeof env.DSHD_DSH_VENDOR_DIR === 'string' ? env.DSHD_DSH_VENDOR_DIR.trim() : '';
  if (desktop) {
    return desktop;
  }
  const upstream = typeof env.CHISACODE_DSH_VENDOR_DIR === 'string' ? env.CHISACODE_DSH_VENDOR_DIR.trim() : '';
  if (upstream) {
    return upstream;
  }
  return desktopDshVendorDir({ packages: api && api.DSH_VENDOR_PACKAGES, root: options.root });
}

/**
 * Materialize a `dsh-acp-demo` PATH shim so the daemon's dsh provider can
 * launch the bundled harness ACP server (there is no npm-global install on a
 * desktop machine). Upstream resolves the binary via PATH lookup and its
 * spawn util handles Windows `.cmd` shims, so no vendor changes are needed.
 * Returns null (and materializes nothing) when the bundled harness has no
 * built ACP entry — the provider then reports unavailable instead of lying.
 * @param {{ home: string, harnessRoot?: string, execPath?: string }} options
 * @returns {string | null} shim bin dir for PATH prepend
 */
function ensureDshAcpShim({ home, harnessRoot = defaultHarnessRoot(), execPath = process.execPath }) {
  const entry = path.join(harnessRoot, 'packages', 'examples', 'acp-demo', 'lib', 'bin.js');
  if (!fs.existsSync(entry)) {
    return null;
  }
  const binDir = path.join(home, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const sh = [
    '#!/bin/sh',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "${execPath}" "${entry}" "$@"`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(binDir, 'dsh-acp-demo'), sh, { encoding: 'utf8', mode: 0o755 });
  const cmd = [
    '@echo off',
    'set ELECTRON_RUN_AS_NODE=1',
    `"${execPath}" "${entry}" %*`,
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(binDir, 'dsh-acp-demo.cmd'), cmd, { encoding: 'utf8' });
  return binDir;
}

/**
 * Environment for the daemon child. This is the ONLY place `CHISACODE_*`
 * names exist on the desktop — a controlled bridge at the process boundary;
 * the shell's own env and every other child (PTY, `dsh web`) stay clean.
 * @param {object} options
 * @param {NodeJS.ProcessEnv} options.baseEnv
 * @param {string} options.home - resolved chisacode runtime home (userData)
 * @param {string | null} options.vendorDir - dsh plugin tree (see dshVendorDirForChild)
 * @param {string | null} options.shimDir - dsh-acp-demo bin dir for PATH prepend
 * @param {{ apiKey?: string, baseUrl?: string }} options.config - desktop shell config
 * @param {string} [options.harnessOrigin]
 * @param {string} [options.gitTunnelUrl]
 * @returns {NodeJS.ProcessEnv}
 */
function buildDaemonChildEnv({
  baseEnv, home, vendorDir, shimDir, config, harnessOrigin, gitTunnelUrl,
}) {
  const env = { ...baseEnv };
  env.ELECTRON_RUN_AS_NODE = '1';
  // Bridge: dsh provider managed homes land under userData, never ~/.chisacode.
  env.CHISACODE_HOME = home;
  if (vendorDir) {
    env.CHISACODE_DSH_VENDOR_DIR = vendorDir;
  }
  if (shimDir) {
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
    const current = env[pathKey] || '';
    env[pathKey] = current ? `${shimDir}${path.delimiter}${current}` : shimDir;
  }
  if (harnessOrigin) env.DSHD_HARNESS_ORIGIN = harnessOrigin;
  if (gitTunnelUrl) env.DSHD_GIT_TUNNEL_URL = gitTunnelUrl;
  // Same credential law as `dsh web` children: official https host only.
  applyOfficialDeepSeekSpawnEnv(env, { apiKey: config.apiKey, baseUrl: config.baseUrl });
  return env;
}

module.exports = {
  VENDOR_ROOT,
  SERVER_EXPORT,
  RUNNER_PATH,
  DAEMON_READY_TIMEOUT_MS,
  DAEMON_STOP_TIMEOUT_MS,
  DAEMON_STDERR_TAIL_LIMIT,
  desktopDshVendorDir,
  readDefaults,
  DSH_VENDOR_PACKAGES,
  loadServerApi,
  modeIsAway,
  resolvedAppBaseUrl,
  mobileBindAddress,
  TRANSPORT_MODE_RANK,
  lanPairingEndpoints,
  iceServersFromConfig,
  bestActiveTransportMode,
  daemonListen,
  relayUseTls,
  publicDevicesFromStore,
  relayStatusFromLogRecord,
  wireLineReader,
  waitForExit,
  daemonStartCancelled,
  resolveDesktopChisaCodeHome,
  dshVendorDirForChild,
  ensureDshAcpShim,
  buildDaemonChildEnv,
};
