'use strict';

/**
 * Launcher-facing peer endpoint. The desktop publishes a per-boot credential
 * file under its userData dir so a slim launcher process can ask it to stop
 * (graceful, task-protected) or to prepare for an install (coordinate, then
 * quit the whole desktop process). Without this file the launcher falls back
 * to "ask the user to quit normally" — never a force kill.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');
const { atomicWriteFile } = require('../shared/fs-safe');
const { constantTimeEqual, readBodyLimited } = require('../shared/secret');

const PEER_FILENAME = 'task-control-peer.json';
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req, res) {
  let raw;
  try {
    raw = await readBodyLimited(req, MAX_BODY_BYTES, { res });
  } catch (error) {
    throw error && error.code === 'BODY_TOO_LARGE' ? new Error('body too large') : error;
  }
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

async function writePeerFile(stateDir, peer) {
  const file = path.join(stateDir, PEER_FILENAME);
  const contents = JSON.stringify({ ...peer, schemaVersion: 1 }, null, 2);
  await fs.promises.mkdir(stateDir, { recursive: true });
  await atomicWriteFile(file, contents, { encoding: 'utf8' });
  return file;
}

function removePeerFile(stateDir, generation) {
  const file = path.join(stateDir, PEER_FILENAME);
  try {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (current && current.generation === generation) {
      fs.unlinkSync(file);
    }
  } catch {
    // Missing or foreign peer file is left alone.
  }
}

/**
 * @param {{
 *   stateDir: () => string,
 *   onPeerStop: () => Promise<object>,
 *   onPeerInstall: () => Promise<object>,
 *   status?: () => object,
 *   log?: (message: string) => void,
 * }} options
 */
function createTaskControlPeer(options = {}) {
  const token = randomBytes(24).toString('hex');
  const generation = randomUUID();
  const startedAt = Date.now();
  let server = null;
  let url = '';
  /** @type {Promise<any> | null} */
  let pendingWrite = null;

  const handler = async (req, res) => {
    const auth = req.headers.authorization || '';
    if (!constantTimeEqual(auth, `Bearer ${token}`)) {
      sendJson(res, 401, { ok: false, code: 'unauthorized' });
      return;
    }
    const pathname = new URL(req.url || '/', 'http://x').pathname;
    if (pathname === '/peer/status' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        generation,
        startedAt,
        ...(typeof options.status === 'function' ? options.status() : {}),
      });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
      return;
    }
    try {
      const body = await readBody(req, res);
      if (pathname === '/peer/stop-desktop') {
        sendJson(res, 200, await options.onPeerStop(body));
        return;
      }
      if (pathname === '/peer/prepare-install') {
        sendJson(res, 200, await options.onPeerInstall(body));
        return;
      }
      sendJson(res, 404, { ok: false, code: 'unknown-op' });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        code: 'internal',
        detail: error && error.message ? error.message : String(error),
      });
    }
  };

  function start() {
    if (server !== null) return { ok: true, url };
    const stateDir = typeof options.stateDir === 'function' ? options.stateDir() : '';
    if (!stateDir) return { ok: false, error: 'no-state-dir' };
    server = http.createServer((req, res) => {
      void handler(req, res).catch((error) => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'internal' });
        else res.destroy();
        (options.log || (() => {}))(`peer handler failed: ${error && error.message ? error.message : error}`);
      });
    });
    const listeningServer = server;
    return new Promise((resolve) => {
      /** @param {any} error */
      const onError = (error) => {
        if (server === listeningServer) server = null;
        resolve({ ok: false, error: error.message });
      };
      listeningServer.once('error', onError);
      listeningServer.listen(0, '127.0.0.1', () => {
        listeningServer.off('error', onError);
        if (server !== listeningServer) {
          resolve({ ok: false, error: 'stopped' });
          return;
        }
        const address = listeningServer.address();
        url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        const write = writePeerFile(stateDir, {
          url, token, pid: process.pid, generation, startedAt,
        }).then(
          (file) => {
            if (server !== listeningServer) {
              removePeerFile(stateDir, generation);
              return { ok: false, error: 'stopped' };
            }
            return { ok: true, url, file };
          },
          (error) => ({ ok: false, error: `peer-file: ${error.message}` }),
        ).finally(() => {
          if (pendingWrite === write) pendingWrite = null;
        });
        pendingWrite = write;
        void write.then(resolve);
      });
    });
  }

  async function stop() {
    const stateDir = typeof options.stateDir === 'function' ? options.stateDir() : '';
    const closing = server;
    server = null;
    const inflightWrite = pendingWrite;
    if (closing !== null) {
      await new Promise((resolve) => {
        closing.close(() => resolve());
        closing.closeAllConnections?.();
      });
    }
    if (inflightWrite) {
      await inflightWrite.catch(() => { /* Pending write failure is reported by its own start() rejection. */ });
    }
    if (stateDir) removePeerFile(stateDir, generation);
  }

  return {
    start,
    stop,
    get url() { return url; },
    get token() { return token; },
    get generation() { return generation; },
    PEER_FILENAME,
  };
}

module.exports = { createTaskControlPeer, PEER_FILENAME };
