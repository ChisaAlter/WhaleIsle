'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('applyDaemonStdinLine stores a sanitized harness-cookie for host RPC', async () => {
  const { applyDaemonStdinLine, installDesktopRpcHooks } = await import('./dshd-daemon-hooks.mjs');
  assert.equal(applyDaemonStdinLine('harness-cookie dsh-browser-session=tok\r\nX: 1'), 'cookie');
  installDesktopRpcHooks();
  let seen = null;
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: init.headers };
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: JSON.parse(init.body).rpcId,
      result: { ok: true, value: { items: [] } },
    }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    applyDaemonStdinLine('harness-origin http://127.0.0.1:3080');
    const result = await globalThis.__dshdDesktopRpc.hostRpc({ method: 'session.list', payload: {} });
    assert.equal(result.ok, true);
    assert.equal(seen.headers.Cookie, 'dsh-browser-session=tok');
  } finally {
    applyDaemonStdinLine('harness-origin ');
    globalThis.fetch = prev;
  }
});

test('shared mux replays only current pending approvals to a later subscriber', async () => {
  const { applyDaemonStdinLine, installDesktopRpcHooks } = await import('./dshd-daemon-hooks.mjs');
  const previousSocket = globalThis.WebSocket;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true } }));
  };
  const sockets = [];
  class Socket {
    constructor() { this.listeners = new Map(); this.sent = []; this.readyState = 0; sockets.push(this); }
    addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) || []), listener]); }
    emit(name, event) { for (const listener of this.listeners.get(name) || []) listener(event); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.emit('close', {}); }
    open() { this.readyState = 1; this.emit('open', {}); }
    item(value) {
      const streamId = this.sent.find(frame => frame.endpoint === '$events').streamId;
      this.emit('message', { data: JSON.stringify({ type: 'item', streamId, value }) });
    }
  }
  globalThis.WebSocket = Socket;
  const subscriptions = [];
  const subscribe = () => {
    const frames = [];
    subscriptions.push(globalThis.__dshdDesktopRpc.subscribeMux(frame => frames.push(frame)));
    return frames;
  };
  try {
    applyDaemonStdinLine('harness-origin ');
    installDesktopRpcHooks();
    const initial = subscribe();
    applyDaemonStdinLine('harness-origin http://127.0.0.1:3080');
    const socket = sockets[0];
    socket.open();
    socket.item({ type: 'ready', clientId: 'gateway-owner' });
    socket.item({ type: 'waterfall', event: 'approval/request', eventId: 'event-a', agentId: 'session-a', request: { requestId: 'approval-a', toolName: 'write' } });
    const later = subscribe();
    assert.equal(sockets.length, 1, 'later devices must share the existing stream');
    assert.deepEqual(later, initial, 'later device needs the pending approval and its Gateway reply identity');
    assert.deepEqual(JSON.parse(later[0].rpcId.slice('remote-event:'.length)), { clientId: 'gateway-owner', eventId: 'event-a' });
    socket.item({ type: 'cancel', eventId: 'event-a' });
    assert.equal(later.at(-1).envelope.payload.type, 'approval/resolved');
    assert.deepEqual(subscribe(), [], 'resolved approvals must not reappear');
    socket.item({ type: 'waterfall', event: 'approval/request', eventId: 'event-decided', agentId: 'session-a', request: { requestId: 'approval-decided' } });
    const decisionRpc = later.at(-1).rpcId;
    await globalThis.__dshdDesktopRpc.respond({ rpcId: decisionRpc, value: { outcome: 'allowed-once' } });
    assert.equal(later.at(-1).envelope.payload.type, 'approval/resolved', 'winning Gateway stream receives no cancel, so dispatch its completed decision locally');
    assert.deepEqual(subscribe(), [], 'a decision through the shared stream must remove the replay cache');
    socket.item({ type: 'waterfall', event: 'approval/request', eventId: 'event-b', agentId: 'session-a', request: { requestId: 'approval-b' } });
    socket.close();
    assert.deepEqual(subscribe(), [], 'closed Gateway owner identities must not be replayed');
    applyDaemonStdinLine('harness-cookie next-session=value');
    const replacement = sockets.at(-1);
    replacement.open();
    replacement.item({ type: 'ready', clientId: 'next-owner' });
    replacement.item({ type: 'waterfall', event: 'approval/request', eventId: 'event-c', agentId: 'session-a', request: { requestId: 'approval-c' } });
    assert.equal(subscribe()[0].envelope.payload.approvalId, 'approval-c');
    applyDaemonStdinLine('harness-origin http://127.0.0.1:3081');
    socket.item({ type: 'waterfall', event: 'approval/request', eventId: 'stale-event', agentId: 'session-old', request: { requestId: 'stale-approval' } });
    assert.deepEqual(subscribe(), [], 'new origins must not inherit approvals or late frames from the old stream');
  } finally {
    for (const unsubscribe of subscriptions) unsubscribe();
    applyDaemonStdinLine('harness-origin ');
    globalThis.WebSocket = previousSocket;
    globalThis.fetch = previousFetch;
  }
});
