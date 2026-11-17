'use strict';

const http = require('http');
const fs = require('fs');
const { resolveMobileWebRoot, resolveSpaAsset } = require('./mobile-web');

const MOBILE_WEB_PORT = 3180;

/**
 * Serve the mobile/web parity SPA for phone pairing (hash #offer= stays client-side).
 * @param {object} [options]
 * @param {string} [options.bindAddress]
 * @param {number} [options.port]
 * @param {string} [options.root]
 * @returns {import('http').Server}
 */
function createMobileWebServer(options = {}) {
  const root = options.root || resolveMobileWebRoot();

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
