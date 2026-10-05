'use strict';

/**
 * Harness `/api/events.mux` is SSE (`text/event-stream`), not WebSocket.
 * Daemon must parse `data:` frames the same way dsh web `readSse` does.
 */

function consumeSse(buffer) {
  let rest = typeof buffer === 'string' ? buffer : '';
  const envelopes = [];
  let boundary = rest.indexOf('\n\n');
  while (boundary !== -1) {
    const chunk = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const data = chunk
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('');
    if (data) {
      try {
        const full = JSON.parse(data);
        if (full && full.type === 'server-request' && typeof full.rpcId === 'string') {
          envelopes.push(full);
        }
      } catch {
        /* drop malformed frame; keep the stream */
      }
    }
    boundary = rest.indexOf('\n\n');
  }
  return { envelopes, rest };
}

/** Chunks already land in session.history; forwarding them over E2EE starves approval frames.
 *  `consumeSse` above is kept for the legacy SSE parser tests only. */
const MUX_DROP_EVENT_TYPES = new Set(['assistant/chunk']);

function shouldForwardMuxEnvelope(envelope) {
  const payload = envelope && typeof envelope === 'object' ? envelope.payload : null;
  if (!payload || typeof payload !== 'object') return true;
  if (payload.type !== 'session/event') return true;
  const eventType = payload.event && typeof payload.event === 'object' ? payload.event.type : '';
  return !MUX_DROP_EVENT_TYPES.has(eventType);
}

/**
 * Harness pin 0.1.2-alpha.2 has no SSE `/api/events.mux`; live state rides the
 * Gateway WebSocket `/api/remote.mux` as logical streams. The drawer needs
 * three of them (DEF-SYNC-REVERSE):
 *   `$events`          Cordis `api-session/*` emits → host/session-* frames
 *   `session/control`  every session's projection/queue/jobs → session/* frames
 *   `workspace/follow` workspace increments → host/workspace-* frames
 */
const MUX_STREAMS = Object.freeze(['$events', 'session/control', 'workspace/follow']);

const SESSION_EMIT_TYPES = Object.freeze({
  'api-session/added': 'host/session-added',
  'api-session/removed': 'host/session-removed',
  'api-session/status': 'host/session-status',
  'api-session/error': 'host/agent-error',
});

const WORKSPACE_INCREMENT_TYPES = Object.freeze({
  upsert: 'host/workspace-changed',
  remove: 'host/workspace-removed',
  order: 'host/workspace-order-changed',
  archived: 'host/archived-sessions-changed',
});

function summaryBlank(summary) {
  if (!summary || typeof summary !== 'object') return undefined;
  if (typeof summary.blank === 'boolean') return summary.blank;
  const meta = summary.projections && summary.projections.values
    ? summary.projections.values.sessionListMetadata
    : null;
  return meta && typeof meta.blank === 'boolean' ? meta.blank : undefined;
}

/**
 * Translate one logical-stream item into the mux payload the SPA consumes.
 * @returns {object|null} payload, or null for ready/baseline/unknown items.
 */
function mapRemoteStreamItem(endpoint, value) {
  if (!value || typeof value !== 'object') return null;
  if (endpoint === '$events') {
    if (value.type !== 'emit' || typeof value.event !== 'string') return null;
    const type = SESSION_EMIT_TYPES[value.event];
    if (!type) return null;
    const args = Array.isArray(value.args) ? value.args : [];
    if (value.event === 'api-session/added') {
      const summary = args[0] && typeof args[0] === 'object' ? args[0] : {};
      const blank = summaryBlank(summary);
      return { ...summary, type, sessionId: summary.sessionId, ...(blank === undefined ? {} : { blank }) };
    }
    if (value.event === 'api-session/status') {
      return { type, sessionId: args[0], running: args[1] === true };
    }
    if (value.event === 'api-session/error') {
      return { type, sessionId: args[0], message: typeof args[1] === 'string' ? args[1] : '' };
    }
    return { type, sessionId: args[0] };
  }
  if (endpoint === 'session/control') {
    if (value.type === 'projection') {
      return { type: 'session/projection', sessionId: value.sessionId, key: value.key, value: value.value, seq: value.seq };
    }
    if (value.type === 'queue') return { type: 'session/queue', sessionId: value.sessionId, items: value.items };
    if (value.type === 'jobs') return { type: 'session/jobs', sessionId: value.sessionId, jobs: value.jobs };
    return null;
  }
  if (endpoint === 'workspace/follow') {
    const type = WORKSPACE_INCREMENT_TYPES[value.type];
    if (!type) return null;
    const { type: _drop, ...rest } = value;
    return { type, ...rest };
  }
  return null;
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const timer = setTimeout(done, ms);
    // A pending reconnect must never pin a daemon/test process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    function done() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    }
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * Keep the catalog streams open until `signal` aborts; reconnect with backoff
 * when the socket closes. Resolves only on abort; rejects only on a bad origin.
 * Approval waterfalls retain the Gateway event generation for their unary reply.
 */
async function openMuxSse({ origin, cookie, onEnvelope, signal, WebSocketImpl, fetchImpl, reconnectDelayMs = 1_000 }) {
  const { assertLoopbackHarnessOrigin, sanitizeHarnessCookie, forwardRemoteEventResult } = require('./dshd-host-tunnel.js');
  const originUrl = new URL(assertLoopbackHarnessOrigin(origin));
  const target = new URL('/api/remote.mux', `${originUrl.origin}/`);
  target.protocol = 'ws:';
  const WS = WebSocketImpl || globalThis.WebSocket;
  if (typeof WS !== 'function') throw new Error('mux: WebSocket unavailable');
  const pair = sanitizeHarnessCookie(cookie);
  let seq = 0;
  let attempt = 0;

  while (!(signal && signal.aborted)) {
    const streamIds = new Map(MUX_STREAMS.map((endpoint) => [`mux-${endpoint}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, endpoint]));
    const options = { headers: {} };
    if (pair) options.headers.Cookie = pair;
    const socket = new WS(target.href, options);
    let eventClientId = '';
    const approvals = new Map();
    let sawItem = false;

    await new Promise((resolve) => {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      };
      function onAbort() {
        try {
          if (socket.readyState === 1) {
            for (const streamId of streamIds.keys()) socket.send(JSON.stringify({ type: 'cancel', streamId }));
          }
          socket.close();
        } catch { /* teardown */ }
        finish();
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('open', () => {
        try {
          for (const [streamId, endpoint] of streamIds) {
            socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: {} } }));
          }
        } catch { /* close event follows */ }
      });
      socket.addEventListener('message', (event) => {
        let frame;
        try {
          const data = event && event.data;
          frame = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'));
        } catch { return; }
        if (!frame || frame.type !== 'item') return;
        const endpoint = streamIds.get(frame.streamId);
        if (!endpoint) return;
        sawItem = true;
        const value = frame.value;
        if (endpoint === '$events' && value?.type === 'ready') { eventClientId = value.clientId; return; }
        if (endpoint === '$events' && value?.type === 'waterfall' && eventClientId) {
          if (value.event === 'approval/request') {
            const request = value.request || {};
            const payload = { type: 'approval/requested', sessionId: value.agentId,
              approvalId: request.requestId || value.eventId, toolName: request.toolName, reason: request.reason || '' };
            approvals.set(value.eventId, payload);
            onEnvelope({ type: 'server-request', rpcId: `remote-event:${JSON.stringify({ clientId: eventClientId, eventId: value.eventId })}`, payload });
          } else {
            // This client does not present other waterfalls; let another answerer handle them.
            void forwardRemoteEventResult({ origin, cookie, signal, fetchImpl, clientId: eventClientId,
              eventId: value.eventId, outcome: { kind: 'next' } }).catch(() => socket.close());
          }
          return;
        }
        if (endpoint === '$events' && value?.type === 'cancel') {
          const approval = approvals.get(value.eventId);
          if (approval) {
            approvals.delete(value.eventId);
            onEnvelope({ type: 'server-request', rpcId: `${endpoint}#${++seq}`,
              payload: { type: 'approval/resolved', sessionId: approval.sessionId, approvalId: approval.approvalId } });
          }
          return;
        }
        const payload = mapRemoteStreamItem(endpoint, frame.value);
        if (!payload) return;
        seq += 1;
        const envelope = { type: 'server-request', rpcId: `${endpoint}#${seq}`, payload };
        if (shouldForwardMuxEnvelope(envelope)) {
          try { onEnvelope(envelope); } catch { /* listener errors must not kill the loop */ }
        }
      });
      socket.addEventListener('error', () => { /* close follows */ });
      socket.addEventListener('close', finish);
    });

    if (signal && signal.aborted) break;
    attempt = sawItem ? 0 : attempt + 1;
    await sleep(Math.min(reconnectDelayMs * (2 ** Math.min(attempt, 4)), 15_000), signal);
  }
}

module.exports = { MUX_STREAMS, consumeSse, mapRemoteStreamItem, openMuxSse, shouldForwardMuxEnvelope };
