'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MUX_STREAMS,
  consumeSse,
  mapRemoteStreamItem,
  openMuxSse,
  shouldForwardMuxEnvelope,
} = require('./dshd-mux-sse');

/** Minimal WebSocket double: records opens, lets tests push server frames. */
class FakeSocket {
  constructor(href, options) {
    FakeSocket.instances.push(this);
    this.href = href;
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
  }

  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }

  emit(name, event) {
    for (const fn of this.listeners.get(name) || []) fn(event);
  }

  send(text) { this.sent.push(JSON.parse(text)); }

  close() {
    this.readyState = 3;
    this.emit('close', { code: 1000, reason: 'test' });
  }

  open() {
    this.readyState = 1;
    this.emit('open', {});
  }

  item(streamId, value) { this.emit('message', { data: JSON.stringify({ type: 'item', streamId, value }) }); }
}
FakeSocket.instances = [];

function tick(ms = 5) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

test('consumeSse reads data: JSON and keeps a partial tail (legacy helper)', () => {
  const first = consumeSse([
    'data: {"type":"server-request","rpcId":"r1","payload":{"type":"host/session-status","sessionId":"s1","running":true}}',
    '',
    'data: {"type":"server-request","rpcId":"partial"',
  ].join('\n'));
  assert.equal(first.envelopes.length, 1);
  assert.match(first.rest, /partial/);
});

test('openMuxSse opens the three catalog streams on /api/remote.mux with the harness Cookie', async () => {
  FakeSocket.instances = [];
  const ac = new AbortController();
  const run = openMuxSse({
    origin: 'http://127.0.0.1:3080',
    cookie: 'dsh-auth-x=mux-1',
    onEnvelope: () => {},
    WebSocketImpl: FakeSocket,
    signal: ac.signal,
  });
  await tick();
  const socket = FakeSocket.instances[0];
  assert.equal(new URL(socket.href).pathname, '/api/remote.mux');
  assert.equal(new URL(socket.href).protocol, 'ws:');
  assert.equal(socket.options.headers.Cookie, 'dsh-auth-x=mux-1');
  socket.open();
  await tick();
  const opened = socket.sent.filter((f) => f.type === 'open').map((f) => f.endpoint).sort();
  assert.deepEqual(opened, [...MUX_STREAMS].sort());
  ac.abort();
  await run;
});

test('openMuxSse maps stream items into host/* and session/* envelopes', async () => {
  FakeSocket.instances = [];
  const ac = new AbortController();
  const seen = [];
  const run = openMuxSse({
    origin: 'http://127.0.0.1:3080',
    onEnvelope: (envelope) => seen.push(envelope),
    WebSocketImpl: FakeSocket,
    signal: ac.signal,
  });
  await tick();
  const socket = FakeSocket.instances[0];
  socket.open();
  await tick();
  const idOf = (endpoint) => socket.sent.find((f) => f.type === 'open' && f.endpoint === endpoint).streamId;
  socket.item(idOf('$events'), { type: 'ready', clientId: 'c1', host: { home: 'C:\\Users\\x' } });
  socket.item(idOf('$events'), { type: 'emit', event: 'api-session/added', args: [{ sessionId: 's9', cwd: 'C:\\Ai\\x', origin: 'user', projections: { values: { sessionListMetadata: { blank: true } } } }] });
  socket.item(idOf('$events'), { type: 'emit', event: 'api-session/status', args: ['s9', true] });
  socket.item(idOf('$events'), { type: 'emit', event: 'api-session/removed', args: ['s9'] });
  socket.item(idOf('session/control'), { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } });
  socket.item(idOf('session/control'), { type: 'projection', sessionId: 's9', key: 'title', value: { title: 'Hello' }, seq: 3 });
  socket.item(idOf('workspace/follow'), { type: 'baseline', value: { items: [], archivedSessionIds: [] } });
  socket.item(idOf('workspace/follow'), { type: 'upsert', workspace: { workspaceId: 'w1', title: 'T', sessionIds: [] } });
  socket.item(idOf('workspace/follow'), { type: 'order', workspaceIds: ['w1'] });
  socket.item(idOf('workspace/follow'), { type: 'archived', archivedSessionIds: ['s2'] });
  socket.item(idOf('workspace/follow'), { type: 'remove', workspaceId: 'w1' });
  await tick();
  const types = seen.map((e) => e.payload.type);
  assert.deepEqual(types, [
    'host/session-added',
    'host/session-status',
    'host/session-removed',
    'session/projection',
    'host/workspace-changed',
    'host/workspace-order-changed',
    'host/archived-sessions-changed',
    'host/workspace-removed',
  ]);
  const added = seen[0].payload;
  assert.equal(added.sessionId, 's9');
  assert.equal(added.blank, true);
  assert.equal(added.cwd, 'C:\\Ai\\x');
  assert.equal(seen[1].payload.running, true);
  assert.equal(seen[3].payload.key, 'title');
  assert.deepEqual(seen[3].payload.value, { title: 'Hello' });
  assert.ok(seen.every((e) => typeof e.rpcId === 'string' && e.rpcId));
  ac.abort();
  await run;
});

test('openMuxSse reconnects after the socket closes until aborted', async () => {
  FakeSocket.instances = [];
  const ac = new AbortController();
  const run = openMuxSse({
    origin: 'http://127.0.0.1:3080',
    onEnvelope: () => {},
    WebSocketImpl: FakeSocket,
    signal: ac.signal,
    reconnectDelayMs: 5,
  });
  await tick();
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].close();
  await tick(30);
  assert.ok(FakeSocket.instances.length >= 2, 'expected a reconnect socket');
  ac.abort();
  await run;
});

test('Gateway approval waterfall preserves reply identity and cancellation clears the same approval', async () => {
  FakeSocket.instances = [];
  const ac = new AbortController();
  const seen = [];
  const delegated = [];
  const run = openMuxSse({ origin: 'http://127.0.0.1:3080', signal: ac.signal, WebSocketImpl: FakeSocket,
    onEnvelope: frame => seen.push(frame), fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body); delegated.push(body.payload.args);
      return new Response(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: { ok: true } }));
    } });
  await tick(); const socket = FakeSocket.instances[0]; socket.open();
  const streamId = socket.sent.find(frame => frame.endpoint === '$events').streamId;
  socket.item(streamId, { type: 'ready', clientId: 'c1' });
  socket.item(streamId, { type: 'waterfall', event: 'approval/request', eventId: 'e1', agentId: 's1', request: { requestId: 'a1', toolName: 'Write', reason: 'write a file' } });
  assert.deepEqual(JSON.parse(seen[0].rpcId.slice('remote-event:'.length)), { clientId: 'c1', eventId: 'e1' });
  assert.deepEqual(seen[0].payload, { type: 'approval/requested', sessionId: 's1', approvalId: 'a1', toolName: 'Write', reason: 'write a file' });
  socket.item(streamId, { type: 'cancel', eventId: 'e1' });
  assert.deepEqual(seen[1].payload, { type: 'approval/resolved', sessionId: 's1', approvalId: 'a1' });
  socket.item(streamId, { type: 'waterfall', event: 'other/question', eventId: 'e2', agentId: 's1', request: {} });
  await tick();
  assert.deepEqual(delegated, [{ clientId: 'c1', eventId: 'e2', outcome: { kind: 'next' } }]);
  assert.equal(seen.length, 2);
  ac.abort(); await run;
});

test('openMuxSse refuses a non-loopback origin without opening a socket', async () => {
  FakeSocket.instances = [];
  await assert.rejects(
    () => openMuxSse({ origin: 'http://example.com:3080', onEnvelope: () => {}, WebSocketImpl: FakeSocket }),
    /loopback/,
  );
  assert.equal(FakeSocket.instances.length, 0);
});

test('mapRemoteStreamItem ignores ready/baseline/unknown frames', () => {
  assert.equal(mapRemoteStreamItem('$events', { type: 'ready', clientId: 'c' }), null);
  assert.equal(mapRemoteStreamItem('session/control', { type: 'baseline', value: {} }), null);
  assert.equal(mapRemoteStreamItem('workspace/follow', { type: 'baseline', value: {} }), null);
  assert.equal(mapRemoteStreamItem('$events', { type: 'emit', event: 'something/else', args: [] }), null);
  assert.equal(mapRemoteStreamItem('nope', { type: 'item' }), null);
});

test('shouldForwardMuxEnvelope forwards desktop catalog frames the drawer relies on', () => {
  // DEF-SYNC-REVERSE regression guard: phone catalog sync depends on these.
  for (const type of [
    'host/session-added',
    'host/session-removed',
    'host/workspace-changed',
    'host/workspace-order-changed',
    'host/workspace-removed',
    'host/archived-sessions-changed',
    'session/projection',
  ]) {
    assert.equal(shouldForwardMuxEnvelope({ type: 'server-request', rpcId: `r-${type}`, payload: { type, sessionId: 's1' } }), true, type);
  }
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-turn',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'turn/start' } },
  }), true);
});

test('shouldForwardMuxEnvelope drops assistant/chunk session events and keeps approvals', () => {
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-chunk',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'assistant/chunk' } },
  }), false);
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-ask',
    payload: {
      type: 'approval/requested',
      sessionId: 's1',
      approvalId: 'a1',
      toolName: 'pwsh',
    },
  }), true);
  assert.equal(shouldForwardMuxEnvelope({
    type: 'server-request',
    rpcId: 'r-tool',
    payload: { type: 'session/event', sessionId: 's1', event: { type: 'tool/call' } },
  }), true);
});
