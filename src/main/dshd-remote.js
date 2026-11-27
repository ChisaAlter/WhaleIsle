'use strict';

/**
 * DSHD remote face — full createChisaCodeDaemon + offer v2 pairing.
 * Replaces HTTP RemoteGateway as the product pairing path (Touching: remote-settings).
 */

const { EventEmitter } = require('events');
const { spawn, execFile } = require('child_process');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { listLanAddresses, preferredLanIp } = require('../shared/lan');
const { createMobileWebServer, listenMobileWebServer, MOBILE_WEB_PORT } = require('./mobile-web-server');
const { startGitTunnelServer } = require('./dshd-git-tunnel');
const { spawnTreeOptions, killProcessTree } = require('../shared/process-tree');
const { passSecretToChild } = require('../shared/secret');
const {
  VENDOR_ROOT, SERVER_EXPORT, RUNNER_PATH, DAEMON_READY_TIMEOUT_MS, DAEMON_STOP_TIMEOUT_MS,
  DAEMON_STDERR_TAIL_LIMIT, desktopDshVendorDir, readDefaults, DSH_VENDOR_PACKAGES, loadServerApi,
  modeIsAway, resolvedAppBaseUrl, mobileBindAddress, TRANSPORT_MODE_RANK, lanPairingEndpoints,
  iceServersFromConfig, bestActiveTransportMode, daemonListen, relayUseTls, publicDevicesFromStore,
  relayStatusFromLogRecord, wireLineReader, waitForExit, daemonStartCancelled,
  resolveDesktopChisaCodeHome, dshVendorDirForChild, ensureDshAcpShim, buildDaemonChildEnv,
} = require('./dshd-remote-helpers');

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
   * @param {number} [options.revokeAckTimeoutMs]
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
    this.revokeAckTimeoutMs = typeof options.revokeAckTimeoutMs === 'number' ? options.revokeAckTimeoutMs : 5_000;
    this.execFile = options.execFile || execFile;
    this.daemon = null;
    this.pendingDaemon = null;
    this.pendingRevokeAcks = new Map();
    this.mobileWebServer = null;
    this.mobileWebStarting = null;
    this.serverApi = null;
    this.pairing = { relayEnabled: false, url: null, qr: null };
    this.pairingOperation = null;
    this.relayState = { connected: false, lastError: '' };
    this.clientTransportModes = new Map();
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
    const server = createMobileWebServer({
      bindAddress: bind,
      port: MOBILE_WEB_PORT,
      lanWsTarget: () => (this.daemon ? `ws://${daemonListen(this.getConfig() || {})}/lan-ws` : ''),
    });
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
    await this.mobileWebStarting?.catch(() => { /* Wait for any failed startup before releasing the acquired HTTP server. */ });
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

    const lanReady = !away && listening && Boolean(this.mobileWebServer);
    const iceServers = iceServersFromConfig(config);
    const activeTransportModes = Array.from(this.clientTransportModes.values());
    const activeTransportMode = bestActiveTransportMode(this.clientTransportModes);

    return {
      available: true, protocol: 'chisacode-v2', enabled, listening, starting: Boolean(this.starting),
      port: Number(daemonListen(config).split(':').pop()), token: '', mode: away ? 'relay' : 'lan',
      lanReady, bindAddress: this.mobileWebServer?.address()?.address || mobileBindAddress(config),
      lanTls: false, tlsFingerprint: '', addresses, iceServers, activeTransportMode, activeTransportModes,
      relayUrl: relayEndpoint, defaultRelayUrl: defaults.relayEndpoint, relayTokenSet: true,
      legacyRelayTokenSet: Boolean(config.remoteRelayToken), relayConfigured: relayReady,
      relayConnected: Boolean(this.relayState.connected), relayError: this.relayState.lastError || '',
      error: this.error || '', target: null, devices, pairingQr: '',
      pairingExpiresAtMs: this.pairing.expiresAtMs || null, pairingLinkUrl: this.pairing.linkUrl || '',
      urls: pairingUrl ? [{ address: snapshotAddress, url: pairingUrl, pairingUrl }] : [],
    };
  }

  async refreshPairing({ revokeLink = false } = {}) {
    const generation = this.startGeneration;
    // Startup, status polls, manual refresh and link revocation share one writer.
    // A revoke waits for the current mint, then commits its own new link.
    const running = this.pairingOperation;
    if (running) {
      if (!revokeLink && running.generation === generation) return running.promise;
      try {
        await running.promise;
      } catch (error) {
        if (running.generation === generation || error?.code !== 'DSHD_REMOTE_CANCELLED') throw error;
      }
      if (generation !== this.startGeneration) throw daemonStartCancelled();
      return this.refreshPairing({ revokeLink });
    }
    const operation = { generation, promise: this.generatePairing({ revokeLink }) };
    this.pairingOperation = operation;
    try {
      return await operation.promise;
    } finally {
      if (this.pairingOperation === operation) this.pairingOperation = null;
    }
  }

  async generatePairing({ revokeLink }) {
    const generation = this.startGeneration;
    const assertCurrent = () => {
      if (generation !== this.startGeneration) throw daemonStartCancelled();
    };
    const api = await this.ensureApi();
    assertCurrent();
    const config = this.getConfig() || {};
    const defaults = readDefaults();
    const away = modeIsAway(config);
    const relayEndpoint = (config.remoteRelayEndpoint || config.remoteRelayUrl || defaults.relayEndpoint || '').trim();
    const useTls = relayUseTls(config, relayEndpoint);
    const appBaseUrl = this.pairingAppBaseUrl();
    const lanEndpoints = away ? [] : lanPairingEndpoints(config);
    const iceServers = iceServersFromConfig(config);
    if (revokeLink) {
      new api.RelayPairingLinkStore(this.homeDir()).revoke();
      // Never publish a revoked link if creating its replacement fails.
      this.pairing = { ...this.pairing, linkUrl: '' };
    }

    const pairing = await api.generateLocalPairingOffer({
      chisacodeHome: this.homeDir(),
      relayEnabled: away,
      ...(away ? {
        relayEndpoint,
        relayPublicEndpoint: relayEndpoint,
        relayUseTls: useTls,
        relayPublicUseTls: useTls,
      } : {}),
      ...(lanEndpoints.length > 0 ? { lanEndpoints, lanUseTls: false } : {}),
      ...(iceServers.length > 0 ? { iceServers } : {}),
      appBaseUrl,
      includeQr: false,
      includePersistentLink: true,
      assertCurrent,
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
    if (!this.daemon || this.starting || this.pairingEnsureBlocked) return this.snapshot();
    if (this.pairing.url) {
      const expired = this.pairing.expiresAtMs && this.pairing.expiresAtMs <= Date.now();
      const token = this.pairingToken();
      const store = this.deviceStore();
      const consumed = token && typeof store?.isPairingTokenActive === 'function'
        && !store.isPairingTokenActive(token);
      if (!expired && !consumed) return this.snapshot();
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

  pairingToken() {
    const url = this.pairing.url;
    if (!url) return '';
    try {
      const fragment = new URL(url).hash.slice('#offer='.length);
      const offer = JSON.parse(Buffer.from(fragment, 'base64url').toString('utf8'));
      return offer.authBootstrap?.pairingToken || '';
    } catch {
      // Only legacy test/host offers may lack the v2 bootstrap payload.
      return '';
    }
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
    this.error = '';
    this.relayState = { connected: false, lastError: '' };
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
      const staticDir = path.join(home, 'empty-public');
      const agentStoragePath = path.join(home, 'agents');
      fs.mkdirSync(staticDir, { recursive: true });
      fs.mkdirSync(agentStoragePath, { recursive: true });

      const away = modeIsAway(config);
      const iceServers = iceServersFromConfig(config);
      if (away) {
        await this.stopMobileWebServer();
      } else {
        await this.ensureMobileWebServer(config);
      }
      assertCurrent();
      this.relayState = { connected: false, lastError: '' };
      this.clientTransportModes.clear();

      const daemonConfig = {
        listen,
        chisacodeHome: home,
        // The daemon has no password on loopback, so a browser page from any
        // other site must not reach it. Phones and the pairing page use the
        // encrypted relay (or loopback /lan-ws E2EE bridge in pure LAN mode);
        // the daemon itself still admits its own loopback origins and Origin-less local clients.
        corsAllowedOrigins: [],
        staticDir,
        mcpDebug: false,
        agentClients: {},
        agentStoragePath,
        relayEnabled: away,
        lanE2eeEnabled: true,
        ...(away ? {
          relayEndpoint,
          relayPublicEndpoint: relayEndpoint,
          relayUseTls: useTls,
          relayPublicUseTls: useTls,
        } : {}),
        ...(iceServers.length > 0 ? { iceServers } : {}),
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
        await Promise.allSettled([this.closeGitTunnel(), this.stopMobileWebServer()]);
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
    const git = typeof this.git === 'function' ? this.git() : this.git;
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
    });

    const child = spawn(this.execPath, [this.runnerPath, launchFile], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      windowsHide: true,
      // POSIX group leader so the forced stop can reach daemon descendants.
      ...spawnTreeOptions(),
    });
    // The tunnel token is a credential: it rides the stdin control channel
    // (same law as `harness-cookie`), never the child env or launch file.
    if (this.gitTunnel?.token) {
      try {
        passSecretToChild(child, 'git-tunnel-token', this.gitTunnel.token);
      } catch {
        // Child already gone; the ready wait reports the real failure.
      }
    }
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
   * @param {string} msg
   * @param {{ level?: unknown }} record
   * @returns {boolean}
   */
  isOperatorDaemonLog(msg, record) {
    return msg.startsWith('dshd_daemon_')
      || msg === 'remote_client_transport_mode'
      || msg === 'webrtc_upgrade_activated'
      || msg === 'lan_e2ee_transport_ready'
      || (typeof record.level === 'number' && record.level >= 40);
  }

  /**
   * @param {string} msg
   * @param {Record<string, any>} record
   */
  applyClientTransportRecord(msg, record) {
    const connectionId = typeof record.connectionId === 'string' ? record.connectionId : '';
    if (!connectionId) return;
    if (msg === 'remote_client_transport_mode') {
      const mode = typeof record.mode === 'string' ? record.mode : '';
      if (Object.prototype.hasOwnProperty.call(TRANSPORT_MODE_RANK, mode)
        && this.clientTransportModes.get(connectionId) !== mode) {
        this.clientTransportModes.set(connectionId, mode);
        this.emit('listening', this.snapshot());
      }
    } else if (msg === 'remote_client_disconnected' && this.clientTransportModes.delete(connectionId)) {
      this.emit('listening', this.snapshot());
    }
  }

  /**
   * One parsed stdout line from the daemon child: lifecycle control lines,
   * relay status transitions, and warn+ log forwarding into the dsh log.
   * @param {any} handle
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
    const isCurrentChild = !handle.stopping && (this.daemon === handle || this.pendingDaemon === handle);
    const status = relayStatusFromLogRecord(record, this.relayState);
    // exit can precede stdio drain. An old child's final log must not hide a
    // replacement daemon's QR after its one connected notification has arrived.
    if (status && isCurrentChild) {
      this.setRelayState(status);
    }
    const msg = typeof record.msg === 'string' ? record.msg : '';
    if (isCurrentChild) {
      this.applyClientTransportRecord(msg, record);
    }
    if (msg === 'dshd_daemon_device_revoked' || msg === 'dshd_daemon_revoke_error'
      || msg === 'dshd_daemon_ready' || msg === 'dshd_daemon_start_failed') {
      this.applyDaemonControlRecord(handle, msg, record);
    }
    // Info-level daemon chatter stays out of the dsh log; lifecycle lines,
    // transport upgrades, and warn+ records are the operator-relevant slice.
    if (this.isOperatorDaemonLog(msg, record)) {
      this.log?.(`[dshd-daemon] ${line}`);
    }
  }

  /** @param {any} handle @param {string} msg @param {Record<string, any>} record */
  applyDaemonControlRecord(handle, msg, record) {
    if (msg === 'dshd_daemon_ready') { handle.readyResolve(); return; }
    if (msg === 'dshd_daemon_start_failed') {
      handle.readyReject(new Error(`远程守护进程启动失败：${record.error || 'unknown'}`));
      return;
    }
    if (typeof record.requestId !== 'string') return;
    if (msg === 'dshd_daemon_device_revoked') {
      this.settleRevokeAck(record.requestId, { ok: true, state: 'confirmed', disconnected: Number(record.disconnected) || 0 });
    } else {
      this.settleRevokeAck(record.requestId, { ok: false, state: 'daemon-error', error: String(record.error || 'unknown') });
    }
  }

  /** @param {string} requestId @param {Record<string, any>} revokeResult */
  settleRevokeAck(requestId, revokeResult) {
    const entry = this.pendingRevokeAcks.get(requestId);
    if (!entry) return;
    this.pendingRevokeAcks.delete(requestId);
    clearTimeout(entry.timer);
    entry.resolve({ ...this.snapshot(), revokeResult });
  }

  /**
   * Child exit: expected during stopDaemon; anything else is a crash that must
   * stay visible (snapshot.error + popup retry) without touching the GUI.
   * @param {{ child: import('child_process').ChildProcess, stopping: boolean, readyReject: (err: Error) => void }} handle
   * @param {number | null} code
   * @param {string | null} signal
   */
  handleDaemonExit(handle, code, signal) {
    for (const [requestId, entry] of [...this.pendingRevokeAcks.entries()]) {
      if (entry.handle === handle) this.settleRevokeAck(requestId, { ok: false, state: 'daemon-exited' });
    }
    handle.readyReject(new Error(`远程守护进程提前退出（${signal || `code ${code}`}）`));
    if (this.pendingDaemon === handle) this.pendingDaemon = null;
    if (this.daemon !== handle) {
      return;
    }
    this.daemon = null;
    this.runtimeKey = '';
    this.clientTransportModes.clear();
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
        // This exact handle came from our spawn and remains owned. Its
        // executable can be Electron running as Node; never broaden the
        // image-name guard used for PID files in DshManager.
        if ((this.daemon !== handle && this.pendingDaemon !== handle)
            || child.pid === process.pid || child.pid === process.ppid) {
          throw new Error('远程守护进程不属于当前桌面，拒绝终止');
        }
        await killProcessTree(child.pid, { signal: 'SIGKILL', run: this.execFile });
      } catch (error) {
        killError = error;
      }
      // The child can exit gracefully while the tree kill is starting. A
      // failed kill is not a live process; reconcile the owned child's exit.
      if (!await waitForExit(child, 2_000)) {
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

  async closeGitTunnel() {
    // The cancelled startup no longer publishes ready, but can still be
    // finishing a concrete server listen. Wait for those resource acquisitions.
    await this.gitTunnelStarting?.catch(() => { /* Wait for cancelled tunnel acquisition before releasing its resources. */ });
    const tunnel = this.gitTunnel;
    if (!tunnel) return;
    try { await tunnel.close(); } finally { if (this.gitTunnel === tunnel) this.gitTunnel = null; }
  }

  async stopDaemonResources() {
    const handles = [...new Set([this.daemon, this.pendingDaemon].filter(Boolean))];
    const stopped = await Promise.allSettled(handles.map((handle) => this.terminateDaemonProcess(handle)));
    const cleanup = [this.closeGitTunnel(), this.stopMobileWebServer()];
    const results = stopped.concat(await Promise.allSettled(cleanup));
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, failures.map((error) => error?.message || String(error)).join('\n'));
    for (const handle of handles) {
      if (this.daemon === handle) this.daemon = null;
      if (this.pendingDaemon === handle) this.pendingDaemon = null;
    }
    this.relayState = { connected: false, lastError: '' };
    this.clientTransportModes.clear();
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
      // Same line-write validation as the secret channel: a newline inside
      // the origin would mint another control line, so the write is refused.
      passSecretToChild(child, 'harness-origin', String(next || '').trim());
      const cookie = String(this.getSessionCookie() || '').split(/\r|\n/)[0].trim();
      passSecretToChild(child, 'harness-cookie', cookie);
    } catch (error) {
      this.log?.(`[dshd-remote] daemon 控制行写入被拒绝：${error instanceof Error ? error.message : error}`);
    }
  }

  async revokePairingLink() { await this.refreshPairing({ revokeLink: true }); return this.snapshot(); }
  rotateToken() { return this.refreshPairing().then(() => { this.pairingEnsureBlocked = false; return this.snapshot(); }); }
  /** @param {string} deviceId */
  revokeDeviceInStore(deviceId) {
    const store = this.deviceStore();
    if (!store || typeof store.revokeDevice !== 'function') return 'no-store';
    try {
      store.revokeDevice(deviceId);
      return 'ok';
    } catch (err) {
      this.log?.(`[dshd-remote] 吊销设备落盘失败：${err instanceof Error ? err.message : err}`);
      return 'failed';
    }
  }
  unbindDevice(id) {
    const deviceId = id ? String(id).trim() : '';
    if (!deviceId || this.revokeDeviceInStore(deviceId) !== 'ok') return this.snapshot();
    const child = this.daemon?.child ?? this.pendingDaemon?.child;
    if (child?.stdin && !child.killed) {
      try { passSecretToChild(child, 'revoke-device', deviceId); } catch { /* child already gone */ }
    }
    return this.snapshot();
  }
  /** @param {string} id */
  async unbindDeviceWithAck(id) {
    const deviceId = id ? String(id).trim() : '';
    if (!deviceId) return { ...this.snapshot(), revokeResult: { ok: false, state: 'invalid-device-id' } };
    if (!this.serverApi) {
      try { await this.ensureApi(); } catch { /* handled by revokeDeviceInStore no-store status */ }
    }
    if (this.revokeDeviceInStore(deviceId) !== 'ok') {
      return { ...this.snapshot(), revokeResult: { ok: false, state: 'store-failed' } };
    }
    const handle = this.daemon || this.pendingDaemon;
    const child = handle?.child;
    if (!child?.stdin || child.killed) return { ...this.snapshot(), revokeResult: { ok: true, state: 'daemon-offline' } };
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.settleRevokeAck(requestId, { ok: false, state: 'timeout' }); }, this.revokeAckTimeoutMs);
      timer.unref?.();
      this.pendingRevokeAcks.set(requestId, { resolve, timer, handle });
      try {
        passSecretToChild(child, 'revoke-device', `${deviceId} ${requestId}`);
      } catch {
        this.settleRevokeAck(requestId, { ok: false, state: 'daemon-exited' });
      }
    });
  }
  renameDevice(id, name) {
    const store = this.deviceStore();
    if (store && typeof store.renameDevice === 'function' && id) store.renameDevice(String(id), String(name ?? ''));
    return this.snapshot();
  }
  ensureToken() { return ''; }

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
      iceServers: iceServersFromConfig(config),
    });
  }
}

module.exports = {
  DshdRemote, loadServerApi, DSH_VENDOR_PACKAGES, VENDOR_ROOT, RUNNER_PATH,
  desktopDshVendorDir, dshVendorDirForChild, readDefaults, relayStatusFromLogRecord,
  resolveDesktopChisaCodeHome, ensureDshAcpShim, buildDaemonChildEnv, publicDevicesFromStore,
  relayUseTls,
};
