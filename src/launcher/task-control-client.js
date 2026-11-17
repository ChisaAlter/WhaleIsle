'use strict';

/**
 * Launcher-side client for the desktop's task-control peer endpoint. The peer
 * file lives under the desktop's userData dir (desktopStateDir); a missing or
 * stale file means the target desktop predates the handshake and must be
 * asked to quit normally — never force-killed.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PEER_FILENAME } = require('../main/task-control-peer');

/** @param {string} stateDir */
function readPeerFile(stateDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(stateDir, PEER_FILENAME), 'utf8'));
    if (parsed && typeof parsed.url === 'string' && typeof parsed.token === 'string'
      && Number.isInteger(parsed.pid)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {number} pid
 * @param {{ execFileSync?: typeof execFileSync }} [deps]
 */
function pidAlive(pid, deps = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const exec = deps.execFileSync || execFileSync;
  try {
    const out = exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return typeof out === 'string' && out.includes(`"${pid}"`);
  } catch {
    return false;
  }
}

/**
 * @param {string} stateDir
 * @param {{ execFileSync?: typeof execFileSync }} [deps]
 * @returns {{ peer: object|null, code: 'ok'|'no-peer'|'stale-peer' }}
 */
function resolvePeer(stateDir, deps = {}) {
  const peer = readPeerFile(stateDir);
  if (peer === null) return { peer: null, code: 'no-peer' };
  if (!pidAlive(peer.pid, deps)) return { peer: null, code: 'stale-peer' };
  return { peer, code: 'ok' };
}

/**
 * @param {any} peer
 * @param {string} op
 * @param {object} [body]
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [deps]
 */
async function callPeer(peer, op, body = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  // The desktop may hold the response open while its own confirmation dialog
  // waits for the user — keep the budget generous.
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15 * 60 * 1000);
  try {
    const response = await fetchImpl(`${peer.url}/peer/${op}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${peer.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => null);
    if (!response.ok || parsed === null || typeof parsed !== 'object') {
      return { ok: false, code: `http-${response.status}` };
    }
    return parsed;
  } catch (error) {
    return {
      ok: false,
      code: 'peer-unreachable',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolvePeer, callPeer };
