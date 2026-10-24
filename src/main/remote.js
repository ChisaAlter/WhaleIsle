const http = require('http');
const https = require('https');
const net = require('net');
const zlib = require('zlib');
const fs = require('fs');
const { EventEmitter } = require('events');
const { resolveMobileWebRoot, shouldProxyToHost, resolveSpaAsset } = require('./mobile-web');
const { isRemoteShellName, shellNameFromUrl } = require('./remote-shell');
const {
  generateToken,
  isAuthorized,
  cookieHeader,
  clearCookieHeader,
  tokenFromHeaders,
  tokensEqual,
  matchingToken,
} = require('../shared/remote-auth');
const { listLanAddresses, pairingUrl, publicUrl, reachableAddresses, DEFAULT_RELAY_ORIGIN } = require('../shared/lan');
const { createDevice, normalizeDevices, publicDevices } = require('../shared/remote-devices');
const { generateTlsMaterial } = require('./remote-tls');
const { RelayClient } = require('./relay-client');

const DEFAULT_PORT = 3180;
const DEFAULT_BIND_ADDRESS = '0.0.0.0';

/** Bind addresses the gateway accepts; anything else falls back to default. */
function normalizeBindAddress(value) {
  const raw = String(value || '').trim();
  if (raw === DEFAULT_BIND_ADDRESS) {
    return raw;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) {
    return DEFAULT_BIND_ADDRESS;
  }
  return raw.split('.').every((part) => Number(part) <= 255) ? raw : DEFAULT_BIND_ADDRESS;
}

/**
 * Address the desktop itself (relay client) uses to reach the local gateway:
 * a wildcard or loopback bind is reachable via loopback; a specific NIC bind
 * is only reachable at that NIC address.
 */
function localConnectHost(bindAddress) {
  const bind = normalizeBindAddress(bindAddress);
  return bind === DEFAULT_BIND_ADDRESS || bind === '127.0.0.1' ? '127.0.0.1' : bind;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function loopbackOrigin(port) {
  return `http://127.0.0.1:${Number(port)}`;
}

function rewriteProxyHeaders(headers, target, options = {}) {
  const keepUpgrade = Boolean(options.upgrade);
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const name = String(key).toLowerCase();
    if (name.startsWith('sec-fetch-')) {
      continue;
    }
    if (name === 'cookie' || name === 'authorization') {
      continue;
    }
    if (!keepUpgrade && HOP_BY_HOP.has(name)) {
      continue;
    }
    out[name] = value;
  }
  const origin = loopbackOrigin(target.port);
  out.host = `127.0.0.1:${target.port}`;
  if (out.origin) {
    out.origin = origin;
  }
  if (out.referer) {
    try {
      const current = new URL(out.referer);
      out.referer = `${origin}${current.pathname}${current.search}`;
    } catch {
      out.referer = `${origin}/`;
    }
  }
  return out;
}

function acceptsGzip(headers) {
  return /(?:^|,|\s)gzip(?:$|,|;|\s)/i.test(String((headers && headers['accept-encoding']) || ''));
}

function shouldGzipProxy(headers, contentType) {
  if (!acceptsGzip(headers)) {
    return false;
  }
  if (headers && headers['content-encoding']) {
    return false;
  }
  // Script and document responses decompress in the browser HTTP stack.
  // application/json is fetch() body on the phone; some WebViews leave gzip
  // bytes in place and session.list then fails closed as an empty sidebar.
  return /javascript|text\/html|text\/css|image\/svg/i.test(String(contentType || ''));
}

/**
 * Never-listening remote face. Production always constructs `RemoteGateway`
 * (`remote.test.js` asserts index.js does not use this); the export stays as
 * a test stub for the fail-closed IPC paths in `ipc.test.js` / `remote.test.js`.
 */
function createDisabledRemote() {
  const snapshot = () => ({
    available: false,
    enabled: false,
    listening: false,
  });
  return {
    sync() {
      return snapshot();
    },
    stop() {},
    snapshot,
  };
}

function headerLines(headers) {
  return Object.entries(headers)
    .map(([key, value]) => {
      const values = Array.isArray(value) ? value : [value];
      return values.map((item) => `${key}: ${item}`).join('\r\n');
    })
    .join('\r\n');
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="rgb(21, 21, 23)" />
  <title>Whale Isle · 远程</title>
  <style>
    :root {
      color-scheme: dark;
      --dsw-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
      --dsw-alias-bg-base: rgb(21, 21, 23);
      --dsw-alias-label-primary: rgb(249, 250, 251);
      --dsw-alias-label-tertiary: rgb(173, 178, 184);
      --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
      --dsw-alias-bg-layer-1: rgb(35, 35, 36);
      --dsw-alias-button-primary-fill: rgb(249, 250, 251);
      --dsw-alias-label-primary-foreground: rgb(15, 17, 21);
      --dsw-alias-button-primary-hover: rgb(235, 238, 242);
      --dsw-alias-state-error-primary: rgb(242, 90, 90);
    }
    html, body { margin: 0; min-height: 100%; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: 16px/24px var(--dsw-font-family); }
    main { max-width: 380px; margin: 0 auto; padding: 48px 24px; }
    h1 { font-size: 16px; line-height: 24px; font-weight: 500; margin: 0 0 8px; }
    p { color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; margin: 0 0 20px; }
    p.error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; margin: 0 0 12px; }
    p.error[hidden] { display: none; }
    input, button { width: 100%; box-sizing: border-box; font: inherit; }
    input { height: 36px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: inherit; margin-bottom: 12px; }
    button { height: 36px; border: 0; border-radius: 18px; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-size: 14px; line-height: 22px; font-weight: 500; }
  </style>
</head>
<body>
  <main>
    <h1>连接本机 Harness</h1>
    <p>用桌面端侧栏手机按钮弹出的二维码打开本页。密钥在地址的 #offer= 里，不会发到服务器查询串。</p>
    <p class="error" id="login-error" hidden></p>
    <form method="post" action="/__remote__/login">
      <input name="token" type="password" autocomplete="current-password" placeholder="访问令牌" required />
      <button type="submit">进入</button>
    </form>
  </main>
  <script>
    (function () {
      // #offer= 自动登录失败绝不能静默：解不开、密钥被拒、网络断都要落文案，
      // 手动令牌表单始终保留为兜底。
      var errorLine = document.getElementById('login-error');
      function showError(message) {
        errorLine.textContent = message;
        errorLine.hidden = false;
      }
      var hash = location.hash || '';
      var match = hash.match(/(?:^|#|&)offer=([^&]+)/);
      if (!match) return;
      var token = '';
      try {
        var padded = match[1].replace(/-/g, '+').replace(/_/g, '/');
        while (padded.length % 4) padded += '=';
        var json = JSON.parse(decodeURIComponent(escape(atob(padded))));
        token = json && json.token ? String(json.token) : '';
      } catch (e) {
        token = '';
      }
      if (!token) {
        showError('配对链接无效：#offer= 无法解析。请重扫桌面二维码，或手动输入访问令牌。');
        return;
      }
      var body = new URLSearchParams();
      body.set('token', token);
      fetch('/__remote__/login', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body,
        credentials: 'same-origin',
        redirect: 'follow'
      }).then(function (res) {
        if (res.ok || res.redirected) {
          location.replace('/');
          return;
        }
        showError(res.status === 401 || res.status === 403
          ? '配对密钥无效：二维码可能已过期（令牌被轮换）。请在桌面端重新打开远程弹窗再扫一次。'
          : '自动登录失败（HTTP ' + res.status + '）。可以手动输入访问令牌重试。');
      }).catch(function () {
        showError('无法连接桌面端：网络请求失败。请确认手机和电脑在同一网络后刷新本页。');
      });
    })();
  </script>
</body>
</html>`;
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseFormToken(body) {
  try {
    return new URLSearchParams(body).get('token') || '';
  } catch {
    return '';
  }
}

function wantsJson(req) {
  const accept = String((req && req.headers && req.headers.accept) || '');
  const type = String((req && req.headers && req.headers['content-type']) || '');
  return /application\/json/i.test(accept) || /application\/json/i.test(type);
}

function parseJsonToken(body) {
  try {
    const value = JSON.parse(body);
    return value && typeof value.token === 'string' ? value.token : '';
  } catch {
    return '';
  }
}

function parseLoginToken(req, body) {
  const type = String((req && req.headers && req.headers['content-type']) || '');
  if (/application\/json/i.test(type)) {
    return parseJsonToken(body);
  }
  return parseFormToken(body);
}

class RemoteGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.getTarget = options.getTarget || (() => null);
    this.getConfig = options.getConfig || (() => ({}));
    this.saveConfig = options.saveConfig || (() => ({}));
    this.server = null;
    this.error = '';
    this.port = 0;
    this.token = '';
    this.target = null;
    this.bindAddress = DEFAULT_BIND_ADDRESS;
    this.tlsActive = false;
    this.tlsFingerprint = '';
    this.sockets = new Map();
    this.relayOp = 0;
    this.mobileWebRoot = options.mobileWebRoot || resolveMobileWebRoot();
    this.invokeShell = typeof options.invokeShell === 'function' ? options.invokeShell : null;
    // Persistent material comes from index.js (userData/remote-tls). Without
    // a provider (tests, bare gateway) an ephemeral in-memory certificate
    // still encrypts the LAN hop; only fingerprint stability is lost.
    this.getTlsMaterial = typeof options.getTlsMaterial === 'function'
      ? options.getTlsMaterial
      : () => {
        if (!this._ephemeralTls) {
          this._ephemeralTls = generateTlsMaterial({ addresses: listLanAddresses() });
        }
        return this._ephemeralTls;
      };
    this._ephemeralTls = null;
    this.relay = options.relay || new RelayClient({
      ...options.relayOptions,
      getLocal: () => (this.port
        ? { port: this.port, host: localConnectHost(this.bindAddress) }
        : null),
      getHostToken: () => (this.getConfig() || {}).remoteRelayToken || '',
    });
    this.relay.on('connected', () => {
      this.error = '';
      this.emit('listening', this.snapshot());
    });
  }

  snapshot() {
    const config = this.getConfig() || {};
    const token = config.remoteToken || this.token || '';
    const port = this.port || Number(config.remotePort) || DEFAULT_PORT;
    const mode = config.remoteMode === 'relay' ? 'relay' : 'lan';
    const relayUrl = config.remoteRelayUrl || '';
    const bindAddress = normalizeBindAddress(config.remoteBindAddress);
    const lanTls = mode === 'lan' && config.remoteLanTls === true;
    let fingerprint = '';
    if (lanTls) {
      try {
        fingerprint = (this.getTlsMaterial() || {}).fingerprint256 || '';
      } catch {
        fingerprint = '';
      }
    }
    const addresses = listLanAddresses();
    const relay = this.relay ? this.relay.snapshot() : { connected: false, url: '', error: '' };
    const relayDown = mode === 'relay' && Boolean(config.remoteEnabled) && !relay.connected;
    return {
      available: true,
      enabled: Boolean(config.remoteEnabled),
      listening: Boolean(this.server && this.port),
      port,
      token,
      mode,
      bindAddress,
      lanTls,
      tlsFingerprint: fingerprint,
      addresses,
      relayUrl,
      defaultRelayUrl: DEFAULT_RELAY_ORIGIN,
      relayTokenSet: Boolean(config.remoteRelayToken),
      relayConfigured: Boolean(relayUrl && config.remoteRelayToken),
      relayConnected: Boolean(relay.connected),
      relayError: mode === 'relay' ? (relay.error || '') : '',
      error: relay.connected
        ? ''
        : mode === 'relay'
          ? (this.error || relay.error || (relayDown ? '桌面还没连上中继' : ''))
          : (this.error || ''),
      target: this.target,
      devices: publicDevices(this.storedDevices(), this.onlineDeviceIds()),
      urls: reachableAddresses(bindAddress, addresses).map((address) => ({
        address,
        url: publicUrl(address, port, { tls: lanTls }),
        pairingUrl: pairingUrl(address, port, token, {
          mode,
          relay: relayUrl,
          tls: lanTls,
          fp: fingerprint,
        }),
      })),
    };
  }

  ensureToken() {
    const config = this.getConfig() || {};
    if (config.remoteToken) {
      this.token = config.remoteToken;
      return config.remoteToken;
    }
    const token = generateToken();
    this.token = token;
    this.saveConfig({ remoteToken: token });
    return token;
  }

  rotateToken() {
    const token = generateToken();
    this.token = token;
    this.saveConfig({ remoteToken: token });
    return token;
  }

  storedDevices() {
    return normalizeDevices((this.getConfig() || {}).remoteDevices);
  }

  onlineDeviceIds() {
    const ids = [];
    for (const [id, sockets] of this.sockets) {
      if (sockets && sockets.size) {
        ids.push(id);
      }
    }
    return ids;
  }

  authTokens() {
    return [this.token, ...this.storedDevices().map((device) => device.token)].filter(Boolean);
  }

  deviceForToken(presented) {
    if (!presented) {
      return null;
    }
    for (const device of this.storedDevices()) {
      if (tokensEqual(presented, device.token)) {
        return device;
      }
    }
    return null;
  }

  persistDevices(devices) {
    this.saveConfig({ remoteDevices: normalizeDevices(devices) });
  }

  touchDevice(id, options = {}) {
    const now = Date.now();
    const devices = this.storedDevices();
    const current = devices.find((device) => device.id === id);
    if (!current) {
      return;
    }
    const last = Date.parse(current.lastSeenAt) || 0;
    if (!options.force && now - last < 60_000) {
      return;
    }
    const stamp = new Date(now).toISOString();
    this.persistDevices(devices.map((device) => (
      device.id === id ? { ...device, lastSeenAt: stamp } : device
    )));
  }

  pairDevice(req) {
    const presented = tokenFromHeaders(req.headers || {}, req.url || '/');
    const existing = this.deviceForToken(presented);
    if (existing) {
      this.touchDevice(existing.id, { force: true });
      return this.storedDevices().find((device) => device.id === existing.id) || existing;
    }
    const device = createDevice(req.headers && req.headers['user-agent'], generateToken());
    this.persistDevices([...this.storedDevices(), device]);
    return device;
  }

  unbindDevice(id) {
    const devices = this.storedDevices();
    const next = devices.filter((device) => device.id !== id);
    if (next.length === devices.length) {
      return this.snapshot();
    }
    this.dropSockets(id);
    this.persistDevices(next);
    return this.snapshot();
  }

  trackSocket(deviceId, socket) {
    if (!deviceId || !socket) {
      return;
    }
    let sockets = this.sockets.get(deviceId);
    if (!sockets) {
      sockets = new Set();
      this.sockets.set(deviceId, sockets);
    }
    sockets.add(socket);
    const drop = () => {
      sockets.delete(socket);
      if (!sockets.size) {
        this.sockets.delete(deviceId);
      }
    };
    socket.once('close', drop);
    socket.once('error', drop);
  }

  dropSockets(deviceId) {
    const sockets = this.sockets.get(deviceId);
    if (!sockets) {
      return;
    }
    this.sockets.delete(deviceId);
    for (const socket of sockets) {
      try {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      } catch {
        // The socket may already be half-closed; destroy still drops the bind.
      }
      socket.destroy();
    }
  }

  async sync() {
    const config = { ...(this.getConfig() || {}) };
    const target = this.getTarget();
    if (!config.remoteEnabled) {
      await this.stop();
      return this.snapshot();
    }
    if (!target || !target.port) {
      this.error = 'Harness 还没就绪';
      await this.stop();
      return this.snapshot();
    }
    const token = this.ensureToken();
    const port = Number(config.remotePort) || DEFAULT_PORT;
    const bindAddress = normalizeBindAddress(config.remoteBindAddress);
    // TLS covers only the LAN-facing listener. Relay mode keeps a plain local
    // server: the phone-to-relay hop is already HTTPS end-to-end and the
    // relay client reconnects to the local port without certificate trust.
    const tls = config.remoteLanTls === true && config.remoteMode !== 'relay';
    const same = this.server
      && this.port === port
      && this.token === token
      && this.bindAddress === bindAddress
      && this.tlsActive === tls
      && this.target
      && this.target.port === target.port;
    if (same) {
      this.error = '';
      this.target = target;
      await this.syncRelay(config);
      return this.snapshot();
    }
    await this.stop();
    await this.start({ port, token, target, bindAddress, tls });
    await this.syncRelay(config);
    return this.snapshot();
  }

  async syncRelay(config) {
    if (!this.relay) {
      return;
    }
    const op = ++this.relayOp;
    if (config.remoteEnabled && config.remoteMode === 'relay' && this.server) {
      if (!config.remoteRelayUrl || !config.remoteRelayToken) {
        await this.relay.disconnect();
        this.error = !config.remoteRelayUrl ? '中继地址未配置' : '中继宿主令牌未配置';
        return;
      }
      try {
        await this.relay.sync(config.remoteRelayUrl, config.remoteRelayToken);
      } catch {
        // Relay errors stay on the client and are surfaced by snapshot().
      }
      return;
    }
    await this.relay.disconnect();
    if (op !== this.relayOp) {
      return;
    }
    if (config.remoteMode !== 'relay' || /^(?:relay |中继)/i.test(this.error)) {
      this.error = '';
    }
  }

  async start({ port, token, target, bindAddress, tls } = {}) {
    if (!token) {
      throw new Error('没有访问令牌时不能开放局域网');
    }
    if (!target || !target.port) {
      throw new Error('Harness 还没就绪');
    }
    this.token = token;
    this.target = { host: '127.0.0.1', port: Number(target.port) };
    this.bindAddress = normalizeBindAddress(bindAddress);
    this.tlsActive = tls === true;
    this.tlsFingerprint = '';
    this.error = '';
    let tlsMaterial = null;
    if (this.tlsActive) {
      tlsMaterial = this.getTlsMaterial();
      if (!tlsMaterial || !tlsMaterial.key || !tlsMaterial.cert) {
        throw new Error('自签 TLS 证书不可用');
      }
      this.tlsFingerprint = tlsMaterial.fingerprint256 || '';
    }
    await new Promise((resolve, reject) => {
      // A request the gateway cannot handle ends with a response, never as an
      // uncaught error in the main process.
      const handler = (req, res) => {
        this.handleHttp(req, res).catch((error) => {
          this.emit('request-error', error);
          if (!res.headersSent) this.send(res, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'bad request');
          else res.destroy();
        });
      };
      const server = this.tlsActive
        ? https.createServer({ key: tlsMaterial.key, cert: tlsMaterial.cert }, handler)
        : http.createServer(handler);
      server.on('upgrade', (req, socket, head) => {
        try {
          this.handleUpgrade(req, socket, head);
        } catch (error) {
          this.emit('request-error', error);
          socket.destroy();
        }
      });
      server.on('error', (error) => {
        this.error = error.message;
        this.emit('error', error);
        if (!this.server) {
          reject(error);
        }
      });
      server.listen(port, this.bindAddress, () => {
        this.server = server;
        this.port = server.address().port;
        this.emit('listening', this.snapshot());
        resolve();
      });
    });
  }

  async stop() {
    if (this.relay) {
      await this.relay.disconnect();
    }
    for (const id of [...this.sockets.keys()]) {
      this.dropSockets(id);
    }
    const server = this.server;
    this.server = null;
    this.port = 0;
    this.target = null;
    this.tlsActive = false;
    this.tlsFingerprint = '';
    if (!server) {
      return;
    }
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 400);
    });
  }

  wantsHtml(req) {
    return /text\/html|\*\/\*/i.test(String(req.headers.accept || ''))
      && req.method === 'GET';
  }

  prefersHtml(req) {
    return /text\/html/i.test(String(req.headers.accept || ''))
      && req.method === 'GET';
  }

  send(res, status, headers, body) {
    res.writeHead(status, headers);
    res.end(body);
  }

  async handleHttp(req, res) {
    const url = req.url || '/';
    const target = this.target;
    if (!target) {
      this.send(res, 503, { 'content-type': 'text/plain; charset=utf-8' }, 'Harness 还没就绪');
      return;
    }

    if (req.method === 'POST' && url.startsWith('/__remote__/login')) {
      let body = '';
      try {
        body = await readBody(req);
      } catch {
        this.send(res, 413, { 'content-type': 'text/plain; charset=utf-8' }, '请求过大');
        return;
      }
      const json = wantsJson(req);
      const token = parseLoginToken(req, body);
      if (!tokensEqual(token, this.token)) {
        if (json) {
          this.send(
            res,
            401,
            { 'content-type': 'application/json; charset=utf-8' },
            JSON.stringify({ ok: false, error: '配对密钥无效' }),
          );
          return;
        }
        this.send(res, 401, { 'content-type': 'text/html; charset=utf-8' }, loginPage());
        return;
      }
      const device = this.pairDevice(req);
      if (json) {
        this.send(res, 200, {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': cookieHeader(device.token),
        }, JSON.stringify({ ok: true, deviceToken: device.token }));
        return;
      }
      this.send(res, 302, { location: '/', 'set-cookie': cookieHeader(device.token) }, '');
      return;
    }

    if (url.startsWith('/__remote__/logout')) {
      this.send(res, 302, { location: '/', 'set-cookie': clearCookieHeader() }, '');
      return;
    }

    const presented = matchingToken(req.headers, url, this.authTokens());
    if (presented && !this.deviceForToken(presented) && tokensEqual(presented, this.token) && this.prefersHtml(req)) {
      const device = this.pairDevice({ headers: { ...req.headers, cookie: '' }, url: '/' });
      this.send(res, 302, { location: url, 'set-cookie': cookieHeader(device.token) }, '');
      return;
    }
    if (!presented) {
      if (this.wantsHtml(req)) {
        this.send(res, 401, { 'content-type': 'text/html; charset=utf-8' }, loginPage());
        return;
      }
      this.send(res, 401, { 'content-type': 'text/plain; charset=utf-8' }, 'unauthorized');
      return;
    }
    const device = this.deviceForToken(presented);
    if (device) {
      this.touchDevice(device.id);
    }

    if (req.method === 'POST') {
      const shellName = shellNameFromUrl(url);
      if (shellName) {
        await this.handleShell(req, res, shellName);
        return;
      }
    }

    if (!shouldProxyToHost(url)) {
      if ((req.method === 'GET' || req.method === 'HEAD') && this.serveMobileWeb(req, res, url)) {
        return;
      }
      this.send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
      return;
    }

    const headers = rewriteProxyHeaders(req.headers, target);
    const proxy = http.request({
      hostname: '127.0.0.1',
      port: target.port,
      path: url,
      method: req.method,
      headers,
    }, (upstream) => {
      const outHeaders = { ...upstream.headers };
      delete outHeaders['content-length'];
      if (/text\/html/i.test(String(outHeaders['content-type'] || ''))) {
        outHeaders['cache-control'] = 'no-store';
      }
      const gzip = shouldGzipProxy(req.headers, outHeaders['content-type'])
        && !outHeaders['content-encoding'];
      if (gzip) {
        outHeaders['content-encoding'] = 'gzip';
        delete outHeaders['content-length'];
      }
      res.writeHead(upstream.statusCode || 502, outHeaders);
      if (gzip) {
        upstream.pipe(zlib.createGzip()).pipe(res);
        return;
      }
      upstream.pipe(res);
    });
    proxy.on('error', () => {
      if (!res.headersSent) {
        this.send(res, 502, { 'content-type': 'text/plain; charset=utf-8' }, 'Harness 不可达');
      } else {
        res.destroy();
      }
    });
    req.pipe(proxy);
  }

  async handleShell(req, res, name) {
    const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
    if (!isRemoteShellName(name)) {
      this.send(res, 404, jsonHeaders, JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    if (typeof this.invokeShell !== 'function') {
      this.send(res, 501, jsonHeaders, JSON.stringify({ ok: false, error: 'shell unavailable' }));
      return;
    }
    let raw = '';
    try {
      raw = await readBody(req, 262144);
    } catch {
      this.send(res, 413, jsonHeaders, JSON.stringify({ ok: false, error: '请求过大' }));
      return;
    }
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        this.send(res, 400, jsonHeaders, JSON.stringify({ ok: false, error: 'invalid json' }));
        return;
      }
    }
    let outcome;
    try {
      outcome = await this.invokeShell(name, payload);
    } catch (error) {
      this.send(res, 500, jsonHeaders, JSON.stringify({
        ok: false,
        error: error && error.message ? error.message : 'shell failed',
      }));
      return;
    }
    if (!outcome || outcome.ok !== true) {
      const status = Number(outcome && outcome.status) || 400;
      this.send(res, status, jsonHeaders, JSON.stringify({
        ok: false,
        error: (outcome && outcome.error) || '请求失败',
      }));
      return;
    }
    this.send(res, 200, jsonHeaders, JSON.stringify({ ok: true, result: outcome.result }));
  }

  serveMobileWeb(req, res, url) {
    const asset = resolveSpaAsset(this.mobileWebRoot, url);
    if (!asset) {
      return false;
    }
    const headers = {
      'content-type': asset.type,
      'cache-control': /html/.test(asset.type) ? 'no-store' : 'no-cache',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return true;
    }
    this.send(res, 200, headers, fs.readFileSync(asset.file));
    return true;
  }

  handleUpgrade(req, socket, head) {
    const target = this.target;
    if (!target || !isAuthorized(req.headers, req.url || '/', this.authTokens())) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const presented = matchingToken(req.headers, req.url || '/', this.authTokens());
    const device = this.deviceForToken(presented);
    if (device) {
      this.touchDevice(device.id, { force: true });
      this.trackSocket(device.id, socket);
    }
    const headers = rewriteProxyHeaders(req.headers, target, { upgrade: true });
    const request = [
      `${req.method} ${req.url} HTTP/1.1`,
      headerLines(headers),
      '',
      '',
    ].join('\r\n');
    const upstream = net.connect(target.port, '127.0.0.1', () => {
      upstream.write(request);
      if (head && head.length) {
        upstream.write(head);
      }
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const fail = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', fail);
    socket.on('error', fail);
  }
}

module.exports = {
  RemoteGateway,
  createDisabledRemote,
  rewriteProxyHeaders,
  shouldGzipProxy,
  normalizeBindAddress,
  localConnectHost,
  DEFAULT_PORT,
  DEFAULT_BIND_ADDRESS,
};
