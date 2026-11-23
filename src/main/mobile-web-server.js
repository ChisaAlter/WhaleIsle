'use strict';

const http = require('http');
const fs = require('fs');
const { WebSocket, WebSocketServer } = require('ws');
const { resolveMobileWebRoot, resolveSpaAsset } = require('./mobile-web');

const MOBILE_WEB_PORT = 3180;
const LAN_BRIDGE_WS_PATH = '/ws';
const MAX_PENDING_BRIDGE_MESSAGES = 64;
const MAX_BRIDGE_PAYLOAD_BYTES = 16 * 1024 * 1024;
const VALID_HOST_HEADER_RE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/;

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
 * Serve the mobile/web parity SPA for phone pairing (hash #offer= stays client-side),
 * and optionally bridge `/ws` WebSocket upgrades 1:1 to the daemon's loopback `/lan-ws`
 * E2EE endpoint for zero-external-server LAN transport.
 * @param {object} [options]
 * @param {string} [options.bindAddress]
 * @param {number} [options.port]
 * @param {string} [options.root]
 * @param {string | (() => string)} [options.lanWsTarget]
 * @returns {import('http').Server}
 */
function createMobileWebServer(options = {}) {
  const root = options.root || resolveMobileWebRoot();
  const resolveLanWsTarget = typeof options.lanWsTarget === 'function'
    ? options.lanWsTarget
    : () => (typeof options.lanWsTarget === 'string' ? options.lanWsTarget : '');

  const server = http.createServer((req, res) => {
    let asset;
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      asset = resolveSpaAsset(root, url.pathname);
    } catch {
      // HTTP parser acceptance does not imply a valid URL or percent encoding.
      // Keep malformed, unauthenticated LAN input out of the main-process guard.
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
      // Defense-in-depth for the LAN pairing landing page. NOTE: no CSP here —
      // the SPA opens a WebSocket to a *different* relay host (the ChisaCode
      // daemon relay), so a same-origin `connect-src` would break pairing on the
      // non-secure LAN context. Only universally-safe headers are set. Pairing
      // secret stays in the `#offer=` fragment and never reaches this server.
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
    let body;
    try {
      body = fs.readFileSync(asset.file);
    } catch {
      // A file can disappear after asset resolution during an update/rebuild.
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, headers);
    res.end(body);
  });

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_BRIDGE_PAYLOAD_BYTES,
  });
  /** @type {Set<WebSocket>} */
  const activeUpstreams = new Set();

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
      activeUpstreams.add(upstreamWs);

      /** @type {Array<{ data: import('ws').RawData, isBinary: boolean }>} */
      const pendingToUpstream = [];
      let closed = false;

      const teardown = (/** @type {unknown} */ code, /** @type {unknown} */ reason) => {
        if (closed) return;
        closed = true;
        activeUpstreams.delete(upstreamWs);
        pendingToUpstream.length = 0;
        const safeCode = normalizeForwardCloseCode(code);
        const safeReason = typeof reason === 'string' ? reason.slice(0, 120) : '';
        if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
          try {
            clientWs.close(safeCode, safeReason);
          } catch {
            try { clientWs.terminate(); } catch { /* ignore */ }
          }
        }
        if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
          try {
            upstreamWs.close(safeCode, safeReason);
          } catch {
            try { upstreamWs.terminate(); } catch { /* ignore */ }
          }
        }
      };

      upstreamWs.on('open', () => {
        if (closed) return;
        while (pendingToUpstream.length > 0 && upstreamWs.readyState === WebSocket.OPEN) {
          const item = pendingToUpstream.shift();
          if (!item) continue;
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
        if (upstreamWs.readyState === WebSocket.OPEN) {
          try {
            upstreamWs.send(data, { binary: isBinary });
          } catch {
            teardown(1011, 'Upstream send failed');
          }
          return;
        }
        if (upstreamWs.readyState === WebSocket.CONNECTING) {
          if (pendingToUpstream.length >= MAX_PENDING_BRIDGE_MESSAGES) {
            teardown(1008, 'Bridge queue overflow');
            return;
          }
          pendingToUpstream.push({ data, isBinary });
        }
      });

      upstreamWs.on('message', (data, isBinary) => {
        if (closed || clientWs.readyState !== WebSocket.OPEN) return;
        try {
          clientWs.send(data, { binary: isBinary });
        } catch {
          teardown(1011, 'Client send failed');
        }
      });

      clientWs.on('close', (code, reason) => {
        teardown(code, reason ? reason.toString('utf8') : '');
      });
      clientWs.on('error', () => {
        teardown(1011, 'Client socket error');
      });
      upstreamWs.on('close', (code, reason) => {
        teardown(code, reason ? reason.toString('utf8') : '');
      });
      upstreamWs.on('error', () => {
        teardown(1011, 'Upstream bridge error');
      });
    });
  });

  server.on('close', () => {
    for (const client of wss.clients) {
      try {
        client.close(1001, 'Server closing');
      } catch {
        // ignore
      }
    }
    for (const upstream of activeUpstreams) {
      try {
        upstream.close(1001, 'Server closing');
      } catch {
        // ignore
      }
    }
    activeUpstreams.clear();
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
  createMobileWebServer,
  listenMobileWebServer,
};
