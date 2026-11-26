import { createModernHarnessTransport } from './harness-modern-transport.mjs';

const EMPTY_UPLINK = Object.freeze({
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.resolve({ value: undefined, done: true }),
  }),
});

function defaultStreamFailure(error) {
  return {
    code: typeof error?.code === 'string' && error.code ? error.code : 'gateway/internal',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details && typeof error.details === 'object' ? error.details : {},
  };
}

function combineSignals(left, right) {
  if (!left) return right;
  if (!right) return left;
  return AbortSignal.any([left, right]);
}

function resolveOwnerPeer(connection) {
  const peer = typeof connection?.createPeer === 'function'
    ? connection.createPeer({ principal: { kind: 'owner' } })
    : connection?.browserPeer;
  if (!peer || peer.principal?.kind !== 'owner' || peer.signal?.aborted) {
    return null;
  }
  return peer;
}

function createDirectMuxSocketFactory({ assertSameOrigin, muxPath, wireStream, peer }) {
  const failureMapper = typeof wireStream.failure === 'function'
    ? wireStream.failure
    : defaultStreamFailure;

  return function createDirectMuxSocket(target) {
    const url = assertSameOrigin(target);
    if (url.pathname !== muxPath) {
      throw new Error(`Unsupported Harness stream endpoint: ${url.pathname}`);
    }

    const socket = new EventTarget();
    const streams = new Map();
    let readyState = 0;

    const emitFrame = (frame) => {
      if (readyState >= 2) return;
      socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
    };

    const close = () => {
      if (readyState >= 2) return;
      readyState = 3;
      peer.signal?.removeEventListener('abort', close);
      for (const control of streams.values()) {
        control.abort(new Error('Harness stream socket closed'));
      }
      streams.clear();
      socket.dispatchEvent(new Event('close'));
    };

    Object.defineProperty(socket, 'readyState', {
      get: () => readyState,
    });
    socket.close = close;
    socket.send = (raw) => {
      if (readyState !== 1) return;
      const frame = JSON.parse(String(raw));
      if (frame?.type === 'cancel') {
        const control = streams.get(frame.streamId);
        if (control) {
          streams.delete(frame.streamId);
          control.abort(new Error('Harness stream cancelled'));
        }
        return;
      }
      if (frame?.type !== 'open' || typeof frame.streamId !== 'string') return;
      if (streams.has(frame.streamId)) {
        close();
        return;
      }
      const streamControl = new AbortController();
      streams.set(frame.streamId, streamControl);
      const signal = combineSignals(streamControl.signal, peer.signal);
      Promise.resolve()
        .then(async () => {
          const stream = await wireStream.open(
            frame.endpoint,
            frame.payload,
            EMPTY_UPLINK,
            peer,
            signal,
          );
          for await (const value of stream) {
            if (signal.aborted || readyState >= 2) break;
            emitFrame({ type: 'item', streamId: frame.streamId, value });
          }
          if (!signal.aborted && readyState < 2) {
            emitFrame({ type: 'end', streamId: frame.streamId });
          }
        })
        .catch((error) => {
          if (signal.aborted || readyState >= 2) return;
          emitFrame({
            type: 'error',
            streamId: frame.streamId,
            error: failureMapper(error),
          });
        })
        .finally(() => {
          streams.delete(frame.streamId);
        });
    };

    peer.signal?.addEventListener('abort', close, { once: true });
    queueMicrotask(() => {
      if (readyState !== 0) return;
      if (peer.signal?.aborted) {
        close();
        return;
      }
      readyState = 1;
      socket.dispatchEvent(new Event('open'));
    });
    return socket;
  };
}

/**
 * Bind `dsh-im` to the Host's in-process owner Peer, `/api` Fetch lane, and
 * Typert Gateway stream opener introduced in DeepSeek Harness `0.2.2-rc.2+`.
 * Fails closed (`{}`) when required Host services are absent or origins mismatch.
 */
export function createHarnessAuthTransport(ctx, baseUrl) {
  const port = ctx?.webServer?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return {};
  const origin = new URL(`http://127.0.0.1:${port}`).origin;
  let targetOrigin;
  try {
    targetOrigin = new URL(baseUrl).origin;
  } catch {
    return {};
  }
  if (targetOrigin !== origin) return {};

  const connection = ctx?.connection;
  const wireStream = ctx?.typertGateway?.wireStream;
  if (typeof connection?.createSharedFetchHandler !== 'function'
    || typeof wireStream?.open !== 'function') {
    return {};
  }

  const peer = resolveOwnerPeer(connection);
  if (!peer) return {};
  const sharedFetch = connection.createSharedFetchHandler('/api');
  if (typeof sharedFetch?.fetch !== 'function') return {};

  function assertSameOrigin(target) {
    const url = new URL(target);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    else if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.origin !== origin || url.username || url.password) {
      throw new Error('Refusing to send Harness credentials to another origin');
    }
    return url;
  }

  const fetchImpl = (target, options = {}) => {
    const url = assertSameOrigin(target);
    const signal = combineSignals(options.signal, peer.signal);
    const request = new Request(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(signal ? { signal } : {}),
    });
    return sharedFetch.fetch(request, peer);
  };

  const createWebSocket = createDirectMuxSocketFactory({
    assertSameOrigin,
    muxPath: '/api/remote.mux',
    wireStream,
    peer,
  });

  return createModernHarnessTransport({
    baseUrl,
    fetchImpl,
    createWebSocket,
  });
}
