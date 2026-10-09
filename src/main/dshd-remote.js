'use strict';

/**
 * DSHD remote face — full createChisaCodeDaemon + offer v2 pairing.
 * Replaces HTTP RemoteGateway as the product pairing path (Touching: remote-settings).
 */

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
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
const { createMobileWebServer, listenMobileWebServer, MOBILE_WEB_PORT } = require('./mobile-web-server');
const { startGitTunnelServer } = require('./dshd-git-tunnel');

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
 * @param {{ root?: string, packages?: readonly string[] }} [options]
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
 * @returns {Promise<{ generateLocalPairingOffer: Function, RelayDeviceCredentialStore: Function, DSH_VENDOR_PACKAGES: readonly string[] }>}
 */
async function loadServerApi() {
  if (!fs.existsSync(SERVER_EXPORT)) {
    throw new Error(
      `dshd remote runtime missing at ${SERVER_EXPORT}. Run vendor sync / build packages/server.`,
    );
  }
  const [pairing, store] = await Promise.all([
    import(pathToFileURL(PAIRING_OFFER_EXPORT).href),
    import(pathToFileURL(DEVICE_STORE_EXPORT).href),
  ]);
  return {
    generateLocalPairingOffer: pairing.generateLocalPairingOffer,
    RelayDeviceCredentialStore: store.RelayDeviceCredentialStore,
    DSH_VENDOR_PACKAGES,
  };
}

function modeIsAway(config) {
  return config.remoteMode !== 'lan';
}

function resolvedAppBaseUrl(config) {
  if (modeIsAway(config)) {
    return normalizePublicAppBaseUrl(config.remoteAppBaseUrl, {
      relayEndpoint: (config.remoteRelayEndpoint || DEFAULT_RELAY_ENDPOINT).trim(),
    }) || DEFAULT_PUBLIC_APP_BASE_URL;
  }
  const bind = mobileBindAddress(config);
  const ip = bind === '0.0.0.0' ? (preferredLanIp() || '127.0.0.1') : bind;
  return publicUrl(ip, MOBILE_WEB_PORT).replace(/\/$/, '');
}

function mobileBindAddress(config = {}) {
  return config.remoteBindAddress || '127.0.0.1';
}

/** The unauthenticated daemon stays loopback; the visible port control owns its port. */
function daemonListen(config = {}) {
  const port = Number(config.remotePort);
  return `127.0.0.1:${Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 6767}`;
}

function relayUseTls(config, endpoint) {
  if (typeof config.remoteRelayUseTls === 'boolean') {
    return config.remoteRelayUseTls;
  }
  if (endpoint === DEFAULT_RELAY_ENDPOINT) {
    return DEFAULT_RELAY_USE_TLS;
  }
  return /:443$/.test(endpoint);
}

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

function daemonStartCancelled() {
  const error = new Error('远程守护进程启动已取消');
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
 * @returns {NodeJS.ProcessEnv}
 */
function buildDaemonChildEnv({
  baseEnv, home, vendorDir, shimDir, config, harnessOrigin, gitTunnelUrl, gitTunnelToken,
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
  if (gitTunnelToken) env.DSHD_GIT_TUNNEL_TOKEN = gitTunnelToken;
  // Same credential law as `dsh web` children: official https host only.
  applyOfficialDeepSeekSpawnEnv(env, { apiKey: config.apiKey, baseUrl: config.baseUrl });
  return env;
}

/**
 * Product remote controller — process manager for the vendored daemon child
 * (createChisaCodeDaemon runs in `dshd-daemon-runner.mjs`, never in the
 * Electron main process). Pairing offers and device snapshots stay in-process:
 * they are file-backed against the same chisacode home, exactly like the
 * upstream CLI `daemon pair` running beside the daemon.
 */
class DshdRemote extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => object} options.getConfig
   * @param {(patch: object) => object} options.saveConfig
   * @param {() => string} options.getHomeDir - chisacode home under userData
   * @param {import('electron').SafeStorage | null} [options.safeStorage]
   * @param {(line: string) => void} [options.log] - dsh log sink for daemon child output
   * @param {string} [options.runnerPath] - daemon runner override (tests)
   * @param {string} [options.execPath] - node/electron executable override (tests)
   * @param {number} [options.readyTimeoutMs]
   * @param {number} [options.stopTimeoutMs]
   * @param {typeof execFile} [options.execFile] - owned Windows taskkill command
   */
  constructor(options = {}) {
    super();
    this.getConfig = options.getConfig || (() => ({}));
    this.saveConfig = options.saveConfig || (() => ({}));
    this.getHomeDir = options.getHomeDir || (() => path.join(process.cwd(), '.chisacode-home'));
    this.safeStorage = options.safeStorage || null;
    this.log = typeof options.log === 'function' ? options.log : null;
    this.runnerPath = options.runnerPath || RUNNER_PATH;
    this.execPath = options.execPath || process.execPath;
    this.getHarnessOrigin = typeof options.getHarnessOrigin === 'function'
      ? options.getHarnessOrigin
      : () => '';
    this.getSessionCookie = typeof options.getSessionCookie === 'function'
      ? options.getSessionCookie
      : () => '';
    this.git = options.git || null;
    this.gitTunnel = null;
    this.gitTunnelStarting = null;
    this.readyTimeoutMs = options.readyTimeoutMs || DAEMON_READY_TIMEOUT_MS;
    this.stopTimeoutMs = options.stopTimeoutMs || DAEMON_STOP_TIMEOUT_MS;
    this.execFile = options.execFile || execFile;
    this.daemon = null;
    this.pendingDaemon = null;
    this.mobileWebServer = null;
    this.mobileWebStarting = null;
    this.serverApi = null;
    this.pairing = { relayEnabled: false, url: null, qr: null };
    this.relayState = { connected: false, lastError: '' };
    this.error = '';
    this.starting = null;
    this.startGeneration = 0;
    this.stopping = null;
    this.runtimeKey = '';
    // After ensurePairing fails, get-remote polling must not hammer refreshPairing.
    this.pairingEnsureBlocked = false;
  }

  async ensureApi() {
    if (!this.serverApi) {
      this.serverApi = await loadServerApi();
    }
    return this.serverApi;
  }

  homeDir() {
    const home = this.getHomeDir();
    fs.mkdirSync(home, { recursive: true });
    return home;
  }

  deviceStore() {
    const Store = this.serverApi && this.serverApi.RelayDeviceCredentialStore;
    if (typeof Store !== 'function') {
      return null;
    }
    try {
      // The daemon writes through its own store instance. Re-open the file so
      // snapshots immediately see pair, reconnect, and revoke updates.
      return new Store(this.homeDir());
    } catch {
      // The upstream store owns corrupt-file recovery.
      return null;
    }
  }

  /**
   * Encrypt a device secret for optional desktop-side cache (sticky client material).
   * @param {string} deviceSecret
   * @returns {string | null} base64 ciphertext
   */
  encryptDeviceSecret(deviceSecret) {
    if (!this.safeStorage || typeof this.safeStorage.isEncryptionAvailable !== 'function') {
      return null;
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      return null;
    }
    if (typeof deviceSecret !== 'string' || deviceSecret.length < 32) {
      throw new Error('Invalid device secret');
    }
    return this.safeStorage.encryptString(deviceSecret).toString('base64');
  }

  setRelayState(next) {
    const connected = Boolean(next && next.connected);
    const lastError = next && next.lastError ? String(next.lastError) : '';
    if (this.relayState.connected === connected && this.relayState.lastError === lastError) {
      return;
    }
    this.relayState = { connected, lastError };
    this.emit('listening', this.snapshot());
  }

  /**
   * QR / SPA landing: LAN mobile/web :3180 in LAN mode; public nginx SPA in Away mode.
   * @returns {string}
   */
  pairingAppBaseUrl() {
    const config = this.getConfig() || {};
    return resolvedAppBaseUrl(config);
  }

  async ensureMobileWebServer(config = this.getConfig() || {}) {
    if (this.mobileWebStarting) {
      await this.mobileWebStarting;
      return;
    }
    if (this.mobileWebServer) {
      return;
    }
    const bind = mobileBindAddress(config);
    const server = createMobileWebServer({ bindAddress: bind, port: MOBILE_WEB_PORT });
    const listening = listenMobileWebServer(server, bind, MOBILE_WEB_PORT);
    this.mobileWebStarting = listening;
    try {
      await listening;
      this.mobileWebServer = server;
    } catch (err) {
      await new Promise((resolve) => {
        server.close(() => { resolve(); });
      });
      const code = err && err.code ? String(err.code) : '';
      if (code === 'EADDRINUSE') {
        throw new Error(`手机配对页端口 ${MOBILE_WEB_PORT} 已被占用，请关闭占用进程或修改 remote 配置后重试`);
      }
      // 持久化的单网卡地址会随网卡失效过期（WSL/vEthernet 子网重建、DHCP 换租），
      // 不能静默退回 0.0.0.0 扩大监听面；指回「监听范围」让用户重选。
      if (code === 'EADDRNOTAVAIL') {
        throw new Error(`监听地址 ${bind} 已失效：网卡断开或地址已变更（EADDRNOTAVAIL），请在「监听范围」改选其他地址`);
      }
      if (code === 'EACCES') {
        throw new Error(`系统拒绝在 ${bind}:${MOBILE_WEB_PORT} 监听（EACCES）：端口可能被 Windows 保留，请重启后重试`);
      }
      throw err;
    } finally {
      if (this.mobileWebStarting === listening) this.mobileWebStarting = null;
    }
  }

  async stopMobileWebServer() {
    await this.mobileWebStarting?.catch(() => {});
    const server = this.mobileWebServer;
    if (!server) {
      return;
    }
    await new Promise((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve(); });
    });
    if (this.mobileWebServer === server) this.mobileWebServer = null;
  }

  snapshot() {
    const config = this.getConfig() || {};
    const defaults = readDefaults();
    const away = modeIsAway(config);
    const enabled = Boolean(config.remoteEnabled);
    const listening = Boolean(this.daemon);
    const store = this.deviceStore();
    const devices = publicDevicesFromStore(store);
    const pairingUrl = this.pairing.url || '';
    const relayEndpoint = (config.remoteRelayEndpoint || config.remoteRelayUrl || defaults.relayEndpoint || '').trim();
    const relayReady = Boolean(relayEndpoint);
    const addresses = listLanAddresses();
    // Ranked by adapter as well as address: a plain address list cannot tell
    // the Wi-Fi NIC from a WSL / TUN adapter in the same private range.
    let snapshotAddress = preferredLanIp() || 'pair';
    if (pairingUrl) {
      try {
        snapshotAddress = new URL(pairingUrl).hostname;
      } catch {
        snapshotAddress = 'pair';
      }
    }

    return {
      available: true,
      protocol: 'chisacode-v2',
      enabled,
      listening,
      port: Number(daemonListen(config).split(':').pop()),
      token: '',
      mode: away ? 'relay' : 'lan',
      bindAddress: this.mobileWebServer?.address()?.address || mobileBindAddress(config),
      lanTls: false,
      tlsFingerprint: '',
      addresses,
      relayUrl: relayEndpoint,
      defaultRelayUrl: defaults.relayEndpoint,
      relayTokenSet: true,
      relayConfigured: relayReady,
      relayConnected: Boolean(this.relayState.connected),
      relayError: this.relayState.lastError || '',
      error: this.error || '',
      target: null,
      devices,
      pairingQr: '',
      urls: pairingUrl
        ? [{ address: snapshotAddress, url: pairingUrl, pairingUrl }]
        : [],
    };
  }

  async refreshPairing() {
    const generation = this.startGeneration;
    const assertCurrent = () => {
      if (generation !== this.startGeneration) throw daemonStartCancelled();
    };
    const api = await this.ensureApi();
    assertCurrent();
    const config = this.getConfig() || {};
    const defaults = readDefaults();
    const relayEndpoint = (config.remoteRelayEndpoint || config.remoteRelayUrl || defaults.relayEndpoint || '').trim();
    const useTls = relayUseTls(config, relayEndpoint);
    const appBaseUrl = this.pairingAppBaseUrl();

    const pairing = await api.generateLocalPairingOffer({
      chisacodeHome: this.homeDir(),
      relayEnabled: true,
      relayEndpoint,
      relayPublicEndpoint: relayEndpoint,
      relayUseTls: useTls,
      relayPublicUseTls: useTls,
      appBaseUrl,
      includeQr: false,
    });
    assertCurrent();
    this.pairing = pairing;
    this.pairingEnsureBlocked = false;
    return this.pairing;
  }

  /**
   * Lazily mint a pairing URL when the daemon is up but snapshot urls are empty.
   * Does not start/stop the daemon — that stays on sync().
   * @returns {object} current snapshot
   */
  async ensurePairing() {
    if (!this.daemon || (this.pairing && this.pairing.url) || this.pairingEnsureBlocked) {
      return this.snapshot();
    }
    try {
      await this.refreshPairing();
    } catch (err) {
      if (err?.code === 'DSHD_REMOTE_CANCELLED') return this.snapshot();
      this.pairingEnsureBlocked = true;
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.error) this.error = msg;
    }
    return this.snapshot();
  }

  async startDaemon() {
    if (this.stopping) throw daemonStartCancelled();
    if (this.starting) {
      await this.starting;
      return;
    }
    if (this.pendingDaemon || this.daemon?.stopping) {
      const beforeStop = this.startGeneration;
      await this.stopDaemon();
      if (this.startGeneration !== beforeStop + 1) throw daemonStartCancelled();
    }
    if (this.daemon) {
      const nextRuntimeKey = this.runtimeConfigKey(this.getConfig() || {});
      if (nextRuntimeKey !== this.runtimeKey) {
        const beforeStop = this.startGeneration;
        await this.stopDaemon();
        if (this.startGeneration !== beforeStop + 1) throw daemonStartCancelled();
        return this.startDaemon();
      }
      await this.refreshPairing();
      this.pairingEnsureBlocked = false;
      return;
    }
    const generation = ++this.startGeneration;
    const assertCurrent = () => {
      if (generation !== this.startGeneration) throw daemonStartCancelled();
    };
    let startedHandle = null;
    const starting = (async () => {
      const api = await this.ensureApi();
      assertCurrent();
      const config = this.getConfig() || {};
      const defaults = readDefaults();
      const home = this.homeDir();
      const relayEndpoint = (config.remoteRelayEndpoint || config.remoteRelayUrl || defaults.relayEndpoint || '').trim();
      const useTls = relayUseTls(config, relayEndpoint);
      const listen = daemonListen(config);
      const staticDir = path.join(VENDOR_ROOT, 'node_modules', '@chisacode', 'server', 'dist', 'server');
      const agentStoragePath = path.join(home, 'agents');
      fs.mkdirSync(agentStoragePath, { recursive: true });

      if (modeIsAway(config)) {
        await this.stopMobileWebServer();
      } else {
        await this.ensureMobileWebServer(config);
      }
      assertCurrent();
      this.relayState = { connected: false, lastError: '' };

      const daemonConfig = {
        listen,
        chisacodeHome: home,
        corsAllowedOrigins: ['*'],
        staticDir: fs.existsSync(staticDir) ? staticDir : home,
        mcpDebug: false,
        agentClients: {},
        agentStoragePath,
        relayEnabled: true,
        relayEndpoint,
        relayPublicEndpoint: relayEndpoint,
        relayUseTls: useTls,
        relayPublicUseTls: useTls,
        appBaseUrl: this.pairingAppBaseUrl(),
        // Loopback listen: empty auth is allowed. Non-loopback requires a password
        // or CHISACODE_ALLOW_WILDCARD_NO_AUTH=1 (see ChisaCode assertWildcardAuth).
        auth: {},
      };

      // Full daemon in an isolated child — a daemon-side crash cannot take
      // down the Electron main process.
      startedHandle = await this.spawnDaemonProcess({ api, home, config, daemonConfig, assertCurrent });
      assertCurrent();
      this.daemon = startedHandle;
      if (this.pendingDaemon === startedHandle) this.pendingDaemon = null;
      this.runtimeKey = this.runtimeConfigKey(config);
      this.error = '';
      this.pushHarnessOrigin();
      await this.refreshPairing();
      assertCurrent();
      this.pairingEnsureBlocked = false;
      this.emit('listening', this.snapshot());
    })();
    this.starting = starting;

    try {
      await starting;
    } catch (err) {
      const current = generation === this.startGeneration;
      if (current) this.error = err instanceof Error ? err.message : String(err);
      // A late failure (e.g. refreshPairing) can land after the child was
      // assigned; it must not leak past this cleanup.
      if (startedHandle) {
        await this.terminateDaemonProcess(startedHandle);
        if (this.daemon === startedHandle) this.daemon = null;
        if (this.pendingDaemon === startedHandle) this.pendingDaemon = null;
      }
      if (current) {
        this.runtimeKey = '';
        this.relayState = { connected: false, lastError: this.error };
        await this.stopMobileWebServer();
      }
      throw err;
    } finally {
      if (this.starting === starting) this.starting = null;
    }
  }

  /**
   * Spawn the daemon runner child and wait for its ready line.
   * @param {object} options
   * @param {{ DSH_VENDOR_PACKAGES?: readonly string[] }} options.api
   * @param {string} options.home
   * @param {object} options.config - desktop shell config
   * @param {object} options.daemonConfig
   * @returns {Promise<{ child: import('child_process').ChildProcess, stopping: boolean }>}
   */
  async spawnDaemonProcess({ api, home, config, daemonConfig, assertCurrent = () => {} }) {
    const launchFile = path.join(home, 'daemon-launch.json');
    // No credentials in the launch file — DEEPSEEK_* rides the child env only.
    fs.writeFileSync(
      launchFile,
      JSON.stringify({ serverExport: SERVER_EXPORT, daemonConfig }),
      { encoding: 'utf8', mode: 0o600 },
    );
    const git = this.git;
    if (git && !this.gitTunnel) {
      const startingTunnel = this.gitTunnelStarting || startGitTunnelServer({ git });
      this.gitTunnelStarting = startingTunnel;
      try {
        this.gitTunnel = await startingTunnel;
      } finally {
        if (this.gitTunnelStarting === startingTunnel) this.gitTunnelStarting = null;
      }
    }
    assertCurrent();
    const env = buildDaemonChildEnv({
      baseEnv: process.env,
      home,
      vendorDir: dshVendorDirForChild(api),
      shimDir: ensureDshAcpShim({ home, execPath: this.execPath }),
      config,
      harnessOrigin: this.getHarnessOrigin() || '',
      gitTunnelUrl: this.gitTunnel?.url || '',
      gitTunnelToken: this.gitTunnel?.token || '',
    });

    const child = spawn(this.execPath, [this.runnerPath, launchFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
    });
    const handle = { child, stopping: false, stderrTail: '' };
    this.pendingDaemon = handle;

    let readyResolve = null;
    let readyReject = null;
    const ready = new Promise((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    handle.readyResolve = () => { if (readyResolve) { readyResolve(); readyResolve = null; readyReject = null; } };
    handle.readyReject = (err) => { if (readyReject) { readyReject(err); readyResolve = null; readyReject = null; } };

    wireLineReader(child.stdout, (line) => { this.handleDaemonLogLine(handle, line); });
    wireLineReader(child.stderr, (line) => {
      handle.stderrTail = `${handle.stderrTail}${line}\n`.slice(-DAEMON_STDERR_TAIL_LIMIT);
      this.log?.(`[dshd-daemon] ${line}`);
    });
    child.stdin?.on?.('error', () => {});
    child.on('error', (err) => {
      handle.readyReject(new Error(`远程守护进程无法启动：${err && err.message ? err.message : err}`));
    });
    child.on('exit', (code, signal) => {
      this.handleDaemonExit(handle, code, signal);
    });

    const timer = setTimeout(() => {
      handle.readyReject(new Error(`远程守护进程 ${this.readyTimeoutMs / 1000}s 内未就绪`));
    }, this.readyTimeoutMs);
    try {
      await ready;
    } catch (err) {
      await this.terminateDaemonProcess(handle);
      if (this.pendingDaemon === handle) this.pendingDaemon = null;
      const tail = handle.stderrTail.trim();
      throw tail ? new Error(`${err.message}\nstderr:\n${tail}`) : err;
    } finally {
      clearTimeout(timer);
    }
    return handle;
  }

  /**
   * One parsed stdout line from the daemon child: lifecycle control lines,
   * relay status transitions, and warn+ log forwarding into the dsh log.
   * @param {{ readyResolve: () => void, readyReject: (err: Error) => void }} handle
   * @param {string} line
   */
  handleDaemonLogLine(handle, line) {
    let record = null;
    try {
      record = JSON.parse(line);
    } catch {
      // Non-JSON output (native module noise); keep it visible.
      this.log?.(`[dshd-daemon] ${line}`);
      return;
    }
    if (!record || typeof record !== 'object') {
      return;
    }
    const status = relayStatusFromLogRecord(record, this.relayState);
    if (status && !handle.stopping) {
      this.setRelayState(status);
    }
    const msg = typeof record.msg === 'string' ? record.msg : '';
    if (msg === 'dshd_daemon_ready') {
      handle.readyResolve();
    } else if (msg === 'dshd_daemon_start_failed') {
      handle.readyReject(new Error(`远程守护进程启动失败：${record.error || 'unknown'}`));
    }
    // Info-level daemon chatter stays out of the dsh log; lifecycle lines and
    // warn+ records are the operator-relevant slice.
    if (msg.startsWith('dshd_daemon_') || (typeof record.level === 'number' && record.level >= 40)) {
      this.log?.(`[dshd-daemon] ${line}`);
    }
  }

  /**
   * Child exit: expected during stopDaemon; anything else is a crash that must
   * stay visible (snapshot.error + popup retry) without touching the GUI.
   * @param {{ child: import('child_process').ChildProcess, stopping: boolean, readyReject: (err: Error) => void }} handle
   * @param {number | null} code
   * @param {string | null} signal
   */
  handleDaemonExit(handle, code, signal) {
    handle.readyReject(new Error(`远程守护进程提前退出（${signal || `code ${code}`}）`));
    if (this.pendingDaemon === handle) this.pendingDaemon = null;
    if (this.daemon !== handle) {
      return;
    }
    this.daemon = null;
    this.runtimeKey = '';
    if (!handle.stopping) {
      this.error = `远程守护进程异常退出（${signal || `code ${code}`}），点「开启」重试`;
      this.relayState = { connected: false, lastError: this.error };
      this.pairing = { relayEnabled: false, url: null, qr: null };
      this.log?.(`[dshd-daemon] ${this.error}`);
      this.emit('listening', this.snapshot());
    }
  }

  /**
   * Graceful stop: `stop` over stdin (cross-platform; Windows has no
   * trappable SIGTERM), hard kill after the timeout.
   * @param {{ child: import('child_process').ChildProcess, stopping: boolean }} handle
   */
  async terminateDaemonProcess(handle) {
    if (handle.stopPromise) return handle.stopPromise;
    handle.stopping = true;
    handle.readyReject?.(daemonStartCancelled());
    const stopping = this.stopDaemonProcess(handle);
    handle.stopPromise = stopping;
    try {
      await stopping;
    } catch (error) {
      if (handle.stopPromise === stopping) handle.stopPromise = null;
      throw error;
    }
  }

  async stopDaemonProcess(handle) {
    const child = handle.child;
    // pid undefined = the spawn itself failed ('error' fires, 'exit' never
    // does) — there is no process to wait on.
    if (!child.pid || child.exitCode !== null || child.signalCode) {
      return;
    }
    try {
      child.stdin.write('stop\n');
    } catch {
      // stdin already gone; fall through to the kill timeout.
    }
    const exited = await waitForExit(child, this.stopTimeoutMs);
    if (!exited) {
      let killError;
      try {
        if (process.platform === 'win32') {
          // This exact handle came from our spawn and remains owned. Its
          // executable can be Electron running as Node; never broaden the
          // image-name guard used for PID files in DshManager.
          if ((this.daemon !== handle && this.pendingDaemon !== handle)
              || child.pid === process.pid || child.pid === process.ppid) {
            throw new Error('远程守护进程不属于当前桌面，拒绝终止');
          }
          await new Promise((resolve, reject) => {
            this.execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              timeout: 2_500, windowsHide: true,
            }, (error) => { if (error) reject(error); else resolve(); });
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch (error) {
        killError = error;
      }
      if ((process.platform === 'win32' && killError) || !await waitForExit(child, 2_000)) {
        const error = new Error(`远程守护进程未停止（pid ${child.pid}）${killError ? `：${killError.message}` : ''}`);
        error.code = 'DSHD_REMOTE_STOP_FAILED';
        if (killError) error.cause = killError;
        throw error;
      }
    }
  }

  async stopDaemon() {
    this.startGeneration += 1;
    this.starting = null;
    if (this.stopping) return this.stopping;
    const stopping = this.stopDaemonResources();
    this.stopping = stopping;
    try {
      await stopping;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.relayState = { connected: false, lastError: this.error };
      throw error;
    } finally {
      if (this.stopping === stopping) this.stopping = null;
    }
  }

  async stopDaemonResources() {
    const handles = [...new Set([this.daemon, this.pendingDaemon].filter(Boolean))];
    const stopped = await Promise.allSettled(handles.map((handle) => this.terminateDaemonProcess(handle)));
    // The cancelled startup no longer publishes ready, but can still be
    // finishing a concrete server listen. Wait for those resource acquisitions.
    await this.gitTunnelStarting?.catch(() => {});
    const cleanup = [];
    if (this.gitTunnel) {
      const tunnel = this.gitTunnel;
      cleanup.push(Promise.resolve().then(() => tunnel.close()).then(() => {
        if (this.gitTunnel === tunnel) this.gitTunnel = null;
      }));
    }
    cleanup.push(this.stopMobileWebServer());
    const results = stopped.concat(await Promise.allSettled(cleanup));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, failures.map((error) => error?.message || String(error)).join('\n'));
    for (const handle of handles) {
      if (this.daemon === handle) this.daemon = null;
      if (this.pendingDaemon === handle) this.pendingDaemon = null;
    }
    this.relayState = { connected: false, lastError: '' };
    this.error = '';
    this.runtimeKey = '';
    this.pairing = { relayEnabled: false, url: null, qr: null };
    this.emit('listening', this.snapshot());
  }

  async sync() {
    const config = this.getConfig() || {};
    if (config.remoteEnabled) {
      await this.startDaemon();
      this.pushHarnessOrigin();
    } else {
      await this.stopDaemon();
    }
    return this.snapshot();
  }

  pushHarnessOrigin(origin) {
    const next = origin == null ? this.getHarnessOrigin() : origin;
    const child = this.daemon?.child;
    if (!child?.stdin || child.killed) return;
    try {
      child.stdin.write(`harness-origin ${String(next || '').trim()}\n`);
      const cookie = String(this.getSessionCookie() || '').split(/\r|\n/)[0].trim();
      child.stdin.write(`harness-cookie ${cookie}\n`);
    } catch {
      // Child already draining.
    }
  }

  rotateToken() {
    // Offer TTL is re-issued; sticky device secrets stay until unbind.
    return this.refreshPairing().then((pairing) => {
      this.pairingEnsureBlocked = false;
      return this.snapshot();
    });
  }

  unbindDevice(id) {
    const store = this.deviceStore();
    if (store && typeof store.revokeDevice === 'function' && id) {
      store.revokeDevice(String(id));
    }
    return this.snapshot();
  }

  renameDevice(id, name) {
    const store = this.deviceStore();
    if (store && typeof store.renameDevice === 'function' && id) {
      store.renameDevice(String(id), String(name ?? ''));
    }
    return this.snapshot();
  }

  ensureToken() {
    return '';
  }

  runtimeConfigKey(config = this.getConfig() || {}) {
    const defaults = readDefaults();
    const endpoint = (config.remoteRelayEndpoint || config.remoteRelayUrl || defaults.relayEndpoint || '').trim();
    return JSON.stringify({
      endpoint,
      useTls: relayUseTls(config, endpoint),
      listen: daemonListen(config),
      mobileBind: mobileBindAddress(config),
      mode: modeIsAway(config) ? 'relay' : 'lan',
      appBaseUrl: resolvedAppBaseUrl(config),
    });
  }
}

module.exports = {
  DshdRemote,
  loadServerApi,
  DSH_VENDOR_PACKAGES,
  VENDOR_ROOT,
  RUNNER_PATH,
  desktopDshVendorDir,
  dshVendorDirForChild,
  readDefaults,
  relayStatusFromLogRecord,
  resolveDesktopChisaCodeHome,
  ensureDshAcpShim,
  buildDaemonChildEnv,
  publicDevicesFromStore,
  relayUseTls,
  preferredLanIp,
};
