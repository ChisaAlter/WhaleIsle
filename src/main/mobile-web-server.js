'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const { WebSocket, WebSocketServer } = require('ws');
const { resolveMobileWebRoot, resolveSpaAsset } = require('./mobile-web');

const MOBILE_WEB_PORT = 3180;
const LAN_BRIDGE_WS_PATH = '/ws';
const MAX_PENDING_BRIDGE_MESSAGES = 64;
const MAX_PENDING_BRIDGE_BYTES = 16 * 1024 * 1024;
const MAX_BRIDGE_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_BRIDGE_CONNECTIONS = 16;
const MAX_BRIDGES_PER_REMOTE_ADDRESS = 4;
const BRIDGE_FIRST_FRAME_TIMEOUT_MS = 10_000;
const BRIDGE_IDLE_TIMEOUT_MS = 120_000;
const BRIDGE_HIGH_WATERMARK_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BRIDGE_BUFFERED_BYTES = 64 * 1024 * 1024;
const VALID_HOST_HEADER_RE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

/** @param {import('ws').RawData} data */
function rawDataByteLength(data) {
  if (typeof data === 'string') return Buffer.byteLength(data);
  if (Array.isArray(data)) return data.reduce((sum, buf) => sum + buf.byteLength, 0);
  return data.byteLength;
}

/** @param {unknown} raw */
function normalizeAddressToken(raw) {
  if (typeof raw !== 'string') return '';
  let addr = raw.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) {
    addr = addr.slice(1, -1);
  }
  const zoneIdx = addr.indexOf('%');
  if (zoneIdx >= 0) addr = addr.slice(0, zoneIdx);
  if (addr.startsWith('::ffff:')) addr = addr.slice(7);
  return addr;
}

/** @returns {string[]} */
function defaultListLocalAddresses() {
  const addresses = new Set(['127.0.0.1', '::1', 'localhost']);
  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const normalized = normalizeAddressToken(entry?.address);
      if (normalized) addresses.add(normalized);
    }
  }
  return [...addresses];
}

/** @param {string} rawHost */
function extractHostPort(rawHost) {
  if (!rawHost) return '';
  if (rawHost.startsWith('[')) {
    const close = rawHost.indexOf(']');
    if (close >= 0 && rawHost[close + 1] === ':') return rawHost.slice(close + 2);
    return '';
  }
  const colon = rawHost.lastIndexOf(':');
  return colon >= 0 ? rawHost.slice(colon + 1) : '';
}

/**
 * Validate WebSocket upgrade Origin against same-host OR same-port local interface addresses.
 * @param {string | undefined} rawOrigin
 * @param {string} rawHost
 * @param {{ port?: number, localAddresses?: Iterable<string> }} [context]
 * @returns {boolean}
 */
function isAllowedUpgradeOrigin(rawOrigin, rawHost, context = {}) {
  if (!rawOrigin) return true;
  let parsed;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.host.toLowerCase() === rawHost.toLowerCase()) return true;

  const expectedPort = String(context.port || extractHostPort(rawHost) || '');
  if (!expectedPort) return false;
  const originPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (originPort !== expectedPort) return false;

  const originHost = normalizeAddressToken(parsed.hostname);
  if (!originHost) return false;
  const localSet = new Set();
  for (const addr of context.localAddresses || []) {
    const normalized = normalizeAddressToken(addr);
    if (normalized) localSet.add(normalized);
  }
  return localSet.has(originHost);
}

/**
 * Normalize a WebSocket close code so reserved/non-wire codes (e.g. 1005/1006)
 * never throw when forwarding close across a 1:1 bridge.
 * @param {unknown} code
 * @returns {number}
 */
function normalizeForwardCloseCode(code) {
  if (typeof code !== 'number' || !Number.isInteger(code)) {
    return 1000;
  }
  if (code === 1000 || (code >= 3000 && code <= 4999)) {
    return code;
  }
  if (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) {
    return code;
  }
  return 1000;
}

/**
 * Validate that the configured loopback target is strictly a loopback `/lan-ws`
 * E2EE endpoint and never an arbitrary host or unauthenticated Express route.
 * @param {string} rawTarget
 * @returns {URL | null}
 */
function parseLoopbackLanTarget(rawTarget) {
  if (typeof rawTarget !== 'string' || !rawTarget.trim()) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(rawTarget.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' && host !== '[::1]') {
    return null;
  }
  if (parsed.pathname !== '/lan-ws') {
    return null;
  }
  return parsed;
}

/**
 * Write a minimal HTTP error response on a raw upgrade socket and destroy it.
 * @param {import('stream').Duplex} socket
 * @param {number} statusCode
 * @param {string} reason
 */
function rejectUpgrade(socket, statusCode, reason) {
  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(reason)}\r\n\r\n${reason}`,
    );
  } catch {
    // Socket may already be closed.
  }
  try {
    socket.destroy();
  } catch {
    // Ignore teardown errors.
  }
}

/**
 * @param {WebSocket} ws
 * @param {number} safeCode
 * @param {string} safeReason
 */
function closeSocketSafely(ws, safeCode, safeReason) {
  if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) return;
  try {
    ws.close(safeCode, safeReason);
    const killTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.CLOSED) {
        try { ws.terminate(); } catch { /* ignore */ }
      }
    }, 500);
    killTimer.unref?.();
  } catch {
    try { ws.terminate(); } catch { /* ignore */ }
  }
}

/**
 * @typedef {{
 *   queuedBytes: () => number,
 *   teardown: (code: unknown, reason: unknown) => void,
 * }} BridgeEntry
 * @typedef {{
 *   bridges: Set<BridgeEntry>,
 *   activeUpstreams: Set<WebSocket>,
 *   bridgesPerRemote: Map<string, number>,
 *   firstFrameTimeoutMs: number,
 *   idleTimeoutMs: number,
 *   bridgeHighWatermarkBytes: number,
 *   maxTotalBridgeBufferedBytes: number,
 * }} BridgePool
 */

/**
 * Enforce global WS bridge buffered-byte ceiling by closing the single heaviest bridge.
 * @param {BridgePool} pool
 * @param {number} nextBytes
 * @param {BridgeEntry} [activeEntry]
 * @returns {boolean}
 */
function enforceGlobalBufferBudget(pool, nextBytes, activeEntry) {
  let total = nextBytes;
  /** @type {BridgeEntry | null} */
  let heaviest = null;
  let heaviestBytes = -1;
  for (const entry of pool.bridges) {
    const base = entry.queuedBytes();
    const score = base + (entry === activeEntry ? nextBytes : 0);
    total += base;
    if (score > heaviestBytes) {
      heaviestBytes = score;
      heaviest = entry;
    }
  }
  if (total <= pool.maxTotalBridgeBufferedBytes || !heaviest) return false;
  heaviest.teardown(1008, 'Bridge memory budget exceeded');
  return true;
}

/**
 * Wire bidirectional forwarding, idle/first-frame timers, and backpressure limits on one 1:1 bridge.
 * @param {BridgePool} pool
 * @param {WebSocket} clientWs
 * @param {WebSocket} upstreamWs
 * @param {string} remoteKey
 */
function attachBridgeSession(pool, clientWs, upstreamWs, remoteKey) {
  /** @type {Array<{ data: import('ws').RawData, isBinary: boolean }>} */
  const pendingToUpstream = [];
  let pendingBytes = 0;
  let closed = false;
  let sawFirstClientFrame = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let firstFrameTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idleTimer = null;

  /** @param {unknown} code @param {unknown} reason */
  const teardown = (code, reason) => {
    if (closed) return;
    closed = true;
    if (firstFrameTimer) { clearTimeout(firstFrameTimer); firstFrameTimer = null; }
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    pool.bridges.delete(entry);
    pool.activeUpstreams.delete(upstreamWs);
    const prevCount = pool.bridgesPerRemote.get(remoteKey) || 0;
    if (prevCount <= 1) pool.bridgesPerRemote.delete(remoteKey);
    else pool.bridgesPerRemote.set(remoteKey, prevCount - 1);
    pendingToUpstream.length = 0;
    pendingBytes = 0;
    const safeCode = normalizeForwardCloseCode(code);
    const safeReason = typeof reason === 'string' ? reason.slice(0, 120) : '';
    closeSocketSafely(clientWs, safeCode, safeReason);
    closeSocketSafely(upstreamWs, safeCode, safeReason);
  };

  /** @type {BridgeEntry} */
  const entry = {
    queuedBytes: () => pendingBytes + clientWs.bufferedAmount + upstreamWs.bufferedAmount,
    teardown,
  };
  pool.bridges.add(entry);
  pool.activeUpstreams.add(upstreamWs);
  pool.bridgesPerRemote.set(remoteKey, (pool.bridgesPerRemote.get(remoteKey) || 0) + 1);

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (pool.idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => teardown(1008, 'Bridge idle'), pool.idleTimeoutMs);
      idleTimer.unref?.();
    }
  };

  if (pool.firstFrameTimeoutMs > 0) {
    firstFrameTimer = setTimeout(() => {
      if (!sawFirstClientFrame) teardown(1008, 'Bridge idle');
    }, pool.firstFrameTimeoutMs);
    firstFrameTimer.unref?.();
  }

  upstreamWs.on('open', () => {
    if (closed) return;
    while (pendingToUpstream.length > 0 && upstreamWs.readyState === WebSocket.OPEN) {
      const item = pendingToUpstream.shift();
      if (!item) continue;
      pendingBytes = Math.max(0, pendingBytes - rawDataByteLength(item.data));
      try {
        upstreamWs.send(item.data, { binary: item.isBinary });
      } catch {
        teardown(1011, 'Upstream send failed');
        return;
      }
    }
  });

  clientWs.on('message', (data, isBinary) => {
    if (closed) return;
    if (!sawFirstClientFrame) {
      sawFirstClientFrame = true;
      if (firstFrameTimer) { clearTimeout(firstFrameTimer); firstFrameTimer = null; }
    }
    resetIdleTimer();
    const bytes = rawDataByteLength(data);
    enforceGlobalBufferBudget(pool, bytes, entry);
    if (closed) return;

    if (upstreamWs.readyState === WebSocket.OPEN) {
      if (upstreamWs.bufferedAmount > pool.bridgeHighWatermarkBytes) {
        teardown(1008, 'Upstream backpressure overflow');
        return;
      }
      try { upstreamWs.send(data, { binary: isBinary }); } catch { teardown(1011, 'Upstream send failed'); }
      return;
    }
    if (upstreamWs.readyState === WebSocket.CONNECTING) {
      if (pendingToUpstream.length >= MAX_PENDING_BRIDGE_MESSAGES || pendingBytes + bytes > MAX_PENDING_BRIDGE_BYTES) {
        teardown(1008, 'Bridge queue overflow');
        return;
      }
      pendingBytes += bytes;
      pendingToUpstream.push({ data, isBinary });
    }
  });

  upstreamWs.on('message', (data, isBinary) => {
    if (closed || clientWs.readyState !== WebSocket.OPEN) return;
    if (sawFirstClientFrame) resetIdleTimer();
    enforceGlobalBufferBudget(pool, rawDataByteLength(data), entry);
    if (closed) return;
    if (clientWs.bufferedAmount > pool.bridgeHighWatermarkBytes) {
      teardown(1008, 'Client backpressure overflow');
      return;
    }
    try { clientWs.send(data, { binary: isBinary }); } catch { teardown(1011, 'Client send failed'); }
  });

  clientWs.on('close', (code, reason) => teardown(code, reason ? reason.toString('utf8') : ''));
  clientWs.on('error', () => teardown(1011, 'Client socket error'));
  upstreamWs.on('close', (code, reason) => teardown(code, reason ? reason.toString('utf8') : ''));
  upstreamWs.on('error', () => teardown(1011, 'Upstream bridge error'));
}

/**
 * Serve the mobile/web parity SPA for phone pairing (hash #offer= stays client-side),
 * and optionally bridge `/ws` WebSocket upgrades 1:1 to the daemon's loopback `/lan-ws`
 * E2EE endpoint for zero-external-server LAN transport.
 * @param {object} [options]
 * @param {string} [options.bindAddress]
 * @param {number} [options.port]
 * @param {string} [options.root]
 * @param {string | (() => string)} [options.lanWsTarget]
 * @param {() => Iterable<string>} [options.listLocalAddresses]
 * @param {(req: import('http').IncomingMessage) => string} [options.resolveRemoteAddress]
 * @param {number} [options.firstFrameTimeoutMs]
 * @param {number} [options.idleTimeoutMs]
 * @param {number} [options.maxBridgesPerRemoteAddress]
 * @param {number} [options.bridgeHighWatermarkBytes]
 * @param {number} [options.maxTotalBridgeBufferedBytes]
 * @returns {import('http').Server}
 */
function createMobileWebServer(options = {}) {
  const root = options.root || resolveMobileWebRoot();
  const resolveLanWsTarget = typeof options.lanWsTarget === 'function'
    ? options.lanWsTarget
    : () => (typeof options.lanWsTarget === 'string' ? options.lanWsTarget : '');
  const listLocalAddresses = typeof options.listLocalAddresses === 'function'
    ? options.listLocalAddresses
    : defaultListLocalAddresses;
  const resolveRemoteAddress = typeof options.resolveRemoteAddress === 'function'
    ? options.resolveRemoteAddress
    : (/** @type {import('http').IncomingMessage} */ req) => normalizeAddressToken(req.socket?.remoteAddress) || 'unknown';
  const maxBridgesPerRemote = options.maxBridgesPerRemoteAddress ?? MAX_BRIDGES_PER_REMOTE_ADDRESS;

  const server = http.createServer((req, res) => {
    let asset;
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      asset = resolveSpaAsset(root, url.pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Bad request');
      return;
    }
    if (!asset) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const headers = {
      'content-type': asset.type,
      'cache-control': /html/.test(asset.type) ? 'no-store' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405, headers);
      res.end('Method not allowed');
      return;
    }
    fs.promises.readFile(asset.file).then((body) => {
      if (res.writableEnded || req.destroyed) return;
      res.writeHead(200, headers);
      res.end(body);
    }, () => {
      if (res.writableEnded || req.destroyed) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_BRIDGE_PAYLOAD_BYTES,
  });
  /** @type {BridgePool} */
  const pool = {
    bridges: new Set(),
    activeUpstreams: new Set(),
    bridgesPerRemote: new Map(),
    firstFrameTimeoutMs: options.firstFrameTimeoutMs ?? BRIDGE_FIRST_FRAME_TIMEOUT_MS,
    idleTimeoutMs: options.idleTimeoutMs ?? BRIDGE_IDLE_TIMEOUT_MS,
    bridgeHighWatermarkBytes: options.bridgeHighWatermarkBytes ?? BRIDGE_HIGH_WATERMARK_BYTES,
    maxTotalBridgeBufferedBytes: options.maxTotalBridgeBufferedBytes ?? MAX_TOTAL_BRIDGE_BUFFERED_BYTES,
  };

  server.on('upgrade', (req, socket, head) => {
    const rawHost = typeof req.headers.host === 'string' ? req.headers.host.trim() : '';
    if (!rawHost || !VALID_HOST_HEADER_RE.test(rawHost)) {
      rejectUpgrade(socket, 400, 'Invalid Host header');
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(req.url || '/', `http://${rawHost}`);
    } catch {
      rejectUpgrade(socket, 400, 'Bad request');
      return;
    }
    if (requestUrl.pathname !== LAN_BRIDGE_WS_PATH) {
      rejectUpgrade(socket, 404, 'Not found');
      return;
    }
    const addr = server.address();
    const listenPort = addr && typeof addr === 'object' ? addr.port : options.port;
    const rawOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (!isAllowedUpgradeOrigin(rawOrigin, rawHost, { port: listenPort, localAddresses: listLocalAddresses() })) {
      rejectUpgrade(socket, 403, 'Origin not allowed');
      return;
    }
    const remoteKey = normalizeAddressToken(resolveRemoteAddress(req)) || 'unknown';
    if (pool.bridges.size >= MAX_BRIDGE_CONNECTIONS || (pool.bridgesPerRemote.get(remoteKey) || 0) >= maxBridgesPerRemote) {
      rejectUpgrade(socket, 503, 'Too many bridge connections');
      return;
    }
    const targetBase = parseLoopbackLanTarget(resolveLanWsTarget());
    if (!targetBase) {
      rejectUpgrade(socket, 503, 'LAN E2EE bridge unavailable');
      return;
    }
    const upstreamUrl = new URL(targetBase.toString());
    for (const [key, value] of requestUrl.searchParams.entries()) {
      if (key === 'serverId' || key === 'role' || key === 'v') {
        upstreamUrl.searchParams.set(key, value);
      }
    }
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      const upstreamWs = new WebSocket(upstreamUrl.toString(), {
        perMessageDeflate: false,
        handshakeTimeout: 5_000,
        maxPayload: MAX_BRIDGE_PAYLOAD_BYTES,
      });
      attachBridgeSession(pool, clientWs, upstreamWs, remoteKey);
    });
  });

  server.on('close', () => {
    for (const entry of [...pool.bridges]) {
      entry.teardown(1001, 'Server closing');
    }
    pool.bridges.clear();
    pool.activeUpstreams.clear();
    pool.bridgesPerRemote.clear();
    wss.close();
  });

  return server;
}

/**
 * Bind the mobile/web SPA server, surfacing listen errors to the caller.
 * @param {import('http').Server} server
 * @param {string} bindAddress
 * @param {number} port
 * @returns {Promise<void>}
 */
function listenMobileWebServer(server, bindAddress, port) {
  return new Promise((resolve, reject) => {
    const onError = (/** @type {Error} */ err) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      server.removeListener('error', onError);
      server.removeListener('listening', onListening);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    if (server.listening) {
      cleanup();
      resolve();
      return;
    }
    server.listen(port, bindAddress);
  });
}

module.exports = {
  MOBILE_WEB_PORT,
  isAllowedUpgradeOrigin,
  createMobileWebServer,
  listenMobileWebServer,
};
