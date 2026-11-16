'use strict';

/**
 * Native account commands and Gateway state stream; no renderer receives
 * credentials. Ported from upstream apps/desktop/account-backend.ts; the
 * mux stream is parsed by a local minimal validator instead of the vendored
 * stream-protocol module.
 */

const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

const REMOTE_STREAM_MUX_PATH = '/api/remote.mux';

/** Decode the UI-safe account projection. */
function accountView(value) {
  if (typeof value !== 'object' || value === null || !('status' in value)
    || !['signed-out', 'credential-stored'].includes(String(value.status)) || !('attempt' in value)) {
    throw new Error('desktop account: invalid state');
  }
  if (!('links' in value) || typeof value.links !== 'object' || value.links === null
    || !('usageUrl' in value.links) || typeof value.links.usageUrl !== 'string'
    || !('topUpUrl' in value.links) || typeof value.links.topUpUrl !== 'string') {
    throw new Error('desktop account: invalid platform links');
  }
  validateBrowserDestination(value.links.usageUrl);
  validateBrowserDestination(value.links.topUpUrl);
  const attempt = value.attempt;
  if (attempt !== null && (typeof attempt !== 'object' || !('id' in attempt) || typeof attempt.id !== 'string'
    || !('phase' in attempt) || !['initializing', 'waiting-browser', 'exchanging', 'committing', 'succeeded', 'cancelled', 'expired', 'failed'].includes(String(attempt.phase))
    || ('authorizeUrl' in attempt && typeof attempt.authorizeUrl !== 'string')
    || ('expiresAt' in attempt && (typeof attempt.expiresAt !== 'number' || !Number.isFinite(attempt.expiresAt)))
    || ('errorCode' in attempt && !['network', 'protocol', 'expired', 'storage'].includes(String(attempt.errorCode))))) {
    throw new Error('desktop account: invalid attempt');
  }
  if (attempt !== null && 'authorizeUrl' in attempt) {
    validateBrowserDestination(String(attempt.authorizeUrl));
  }
  return {
    status: value.status,
    links: { usageUrl: value.links.usageUrl, topUpUrl: value.links.topUpUrl },
    attempt: attempt === null ? null : {
      id: attempt.id, phase: attempt.phase,
      ...(attempt.authorizeUrl === undefined ? {} : { authorizeUrl: attempt.authorizeUrl }),
      ...(attempt.expiresAt === undefined ? {} : { expiresAt: attempt.expiresAt }),
      ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
    },
  };
}

/** Only HTTP loopback or HTTPS destinations can leave the native app. */
function validateBrowserDestination(value) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || !(url.protocol === 'https:' || (loopback && url.protocol === 'http:'))) {
    throw new Error('desktop account: invalid browser destination');
  }
}

/** Minimal mux frame validation matching the vendored stream protocol. */
function parseStreamMessage(raw) {
  const frame = JSON.parse(raw);
  if (typeof frame !== 'object' || frame === null || typeof frame.streamId !== 'string'
    || !['open', 'item', 'close', 'error'].includes(String(frame.type))) {
    throw new Error('desktop account: invalid stream frame');
  }
  return frame;
}

/**
 * Connect native account operations to the standard authenticated Web backend.
 * @param {string} origin - Host Web origin.
 * @param {(request: {namespace:string, method:string, args:object}) => Promise<unknown>} invoke
 * @param {() => Promise<string>} cookies - session cookie reader for the mux stream.
 */
function desktopAccountBackend(origin, invoke, cookies) {
  const call = async (method, args = {}) =>
    accountView(await invoke({ namespace: 'account', method, args }));
  return {
    state: () => call('getState'),
    start: (client) => call('startSignIn', { client, callbackOrigin: new URL(origin).origin, loginSource: 'desktop' }),
    cancel: (attemptId) => call('cancelSignIn', { attemptId }),
    signOut: (client) => call('signOut', { client }),
    watch(listener, failed, expired) {
      let closed = false;
      let socket;
      let retry;
      const connect = () => {
        const streamId = randomUUID();
        const expiryStreamId = randomUUID();
        void cookies().then((cookie) => {
          if (closed) return;
          const url = new URL(REMOTE_STREAM_MUX_PATH, origin);
          url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
          socket = new WebSocket(url.href, { headers: { cookie, origin }, maxPayload: 65536 });
          socket.on('open', () => {
            socket.send(JSON.stringify({ type: 'open', streamId: expiryStreamId, endpoint: 'account/watchExpiry', payload: { args: {} } }));
            socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'account/watch', payload: { args: {} } }));
          });
          socket.on('message', (data) => {
            try {
              const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
              const frame = parseStreamMessage(bytes.toString('utf8'));
              if (frame.streamId === expiryStreamId && frame.type === 'item' && frame.value === 'session-expired') {
                expired();
                return;
              }
              if (frame.streamId !== streamId) throw new Error('desktop account: unexpected stream');
              if (frame.type === 'item') listener(accountView(frame.value));
              else socket.close();
            } catch {
              socket.close();
            }
          });
          socket.on('error', () => { socket.close(); });
          socket.on('close', () => { if (!closed) { failed(); retry = setTimeout(connect, 1000); } });
        }).catch(() => { if (!closed) { failed(); retry = setTimeout(connect, 1000); } });
      };
      connect();
      return () => { closed = true; clearTimeout(retry); socket?.close(); };
    },
  };
}

module.exports = { accountView, desktopAccountBackend, validateBrowserDestination };
