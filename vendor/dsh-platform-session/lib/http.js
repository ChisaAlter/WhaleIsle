/**
 * Loopback session route for embedded Platform documents. The Electron shell
 * fetches the current PlatformSession with the per-boot Bearer token the
 * desktop delivers over the host's stdin secret channel (#427) as
 * DSHD_PLATFORM_TOKEN in the in-process store; an empty token keeps the
 * route closed.
 */

import { constantTimeEqual } from '../../dsh-shared/lib/secret.mjs';

export const PLATFORM_PREFIX = '/dshd-platform';

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {string} token
 */
function authorized(req, token) {
  if (!token) return false;
  return constantTimeEqual(req.headers.authorization || '', `Bearer ${token}`);
}

/**
 * @param {object} options
 * @param {string} options.token - per-boot credential; empty keeps closed.
 * @param {() => Promise<object|null>} options.read - PlatformSession reader.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} route handler for webServer.register.
 */
export function createPlatformHandler({ token, read }) {
  return async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== `${PLATFORM_PREFIX}/session`) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    if (!authorized(req, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }
    try {
      const session = await read();
      sendJson(res, 200, { session });
    } catch (error) {
      sendJson(res, 500, { error: 'platform-session-failed' });
    }
  };
}
