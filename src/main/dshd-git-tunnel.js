'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { dispatchGitTunnel } = require('./dshd-git-dispatch');
const { constantTimeEqual, readBodyLimited } = require('../shared/secret');

const MAX_BODY_BYTES = 1024 * 1024;

async function readJson(req, res) {
  let raw;
  try {
    raw = await readBodyLimited(req, MAX_BODY_BYTES, { res });
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      const tooLarge = new Error('payload too large');
      tooLarge.statusCode = 413;
      throw tooLarge;
    }
    throw error;
  }
  return JSON.parse(raw || '{}');
}

function mintGitTunnelToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Loopback-only git facade for the daemon child. Same allowlist as
 * `dispatchGitTunnel`; stage/unstage/discard stay off this wire.
 * @param {{ git: object, token?: string }} options
 */
function startGitTunnelServer(options) {
  const git = options.git;
  const token = options.token || mintGitTunnelToken();
  const server = http.createServer(async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }));
    };
    if (req.socket.remoteAddress && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
      fail(403, 'loopback only');
      return;
    }
    if (!constantTimeEqual(req.headers['x-dshd-git-token'], token)) {
      fail(403, 'unauthorized');
      return;
    }
    if (req.method !== 'POST' || (req.url !== '/git' && req.url !== '/git/')) {
      fail(404, 'not found');
      return;
    }
    try {
      const body = await readJson(req, res);
      const value = await dispatchGitTunnel({
        action: body.action,
        cwd: body.cwd,
        payload: body.payload,
        git,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, value }));
    } catch (error) {
      if (error && error.statusCode === 413) {
        fail(413, 'payload too large');
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = {
  MAX_BODY_BYTES,
  mintGitTunnelToken,
  startGitTunnelServer,
};
