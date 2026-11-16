/**
 * Loopback control route for task control. The shell calls these ops with a
 * per-boot Bearer token delivered through the Host child's environment; an
 * empty token keeps the route closed rather than open to the profile.
 */

import { acquireLock, lockStatus, releaseLock, renewLock } from './state.js';
import { collectInspection } from './inspection.js';
import { constantTimeEqual, readBodyLimited } from '../../dsh-shared/lib/secret.mjs';

export const CONTROL_PREFIX = '/dshd-task-control';
const MAX_BODY_BYTES = 64 * 1024;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function authorized(req, token) {
  if (!token) return false;
  const header = req.headers.authorization || '';
  return constantTimeEqual(header, `Bearer ${token}`);
}

async function readJson(req, res) {
  let raw;
  try {
    raw = await readBodyLimited(req, MAX_BODY_BYTES, { res });
  } catch (error) {
    if (error && error.code === 'BODY_TOO_LARGE') {
      throw new Error('body too large');
    }
    throw error;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON body');
  }
}

/**
 * webServer route handler for the CONTROL_PREFIX route. Unknown ops and
 * unauthorized requests never reach inspection or lock mutation.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {ReturnType<import('./state.js').createControlState>} state
 * @param {{ token: string }} options
 */
export function createControlHandler(ctx, state, options) {
  const token = String(options.token || '');
  const onUnlock = typeof options.onUnlock === 'function' ? options.onUnlock : () => {};
  return async function controlRoute(req, res) {
    if (!authorized(req, token)) {
      sendJson(res, 401, { ok: false, code: 'dshd/unauthorized' });
      return;
    }
    const op = new URL(req.url || '/', 'http://x').pathname.slice(CONTROL_PREFIX.length).replace(/^\/+|\/+$/g, '');
    let body = {};
    if (req.method === 'POST') {
      try {
        body = await readJson(req, res);
      } catch (error) {
        sendJson(res, 400, { ok: false, code: 'dshd/bad-request', detail: error.message });
        return;
      }
    }
    try {
      switch (op) {
        case 'status':
          sendJson(res, 200, { ok: true, ...lockStatus(state) });
          return;
        case 'inspect': {
          sendJson(res, 200, await collectInspection(ctx, state));
          return;
        }
        case 'acquire': {
          sendJson(res, 200, await acquireLock(state, body));
          return;
        }
        case 'renew':
          sendJson(res, 200, renewLock(state, body));
          return;
        case 'release': {
          const released = releaseLock(state, body);
          if (released.ok && released.released) onUnlock();
          sendJson(res, 200, released);
          return;
        }
        case 'cancel': {
          const released = releaseLock(state, body);
          if (released.ok) {
            // Best-effort cancellation signal; producers that accept
            // cancellation subscribe on the Host context.
            ctx.emit('dsh-task-control/cancel', {
              owner: String(body.owner || ''),
              reason: String(body.reason || ''),
            });
          }
          if (released.ok && released.released) onUnlock();
          sendJson(res, released.ok ? 200 : 409, released);
          return;
        }
        default:
          sendJson(res, 404, { ok: false, code: 'dshd/unknown-op' });
      }
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        code: 'dshd/internal',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
