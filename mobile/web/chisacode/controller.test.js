import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkForegroundConnection,
  connectionPhase,
  createDraftStore,
  resyncAfterReconnect,
  transportModeLabel,
  watchConnection,
  watchTransportMode,
} from './controller.js';

test('foreground recovery probes stale sockets twice so the client reconnects', async () => {
  let probes = 0;
  await assert.rejects(checkForegroundConnection({
    getConnectionState: () => ({ status: 'connected' }),
    async checkLiveness({ timeoutMs }) {
      assert.equal(timeoutMs, 3000);
      probes += 1;
      throw new Error('stale socket');
    },
  }), /stale socket/);
  assert.equal(probes, 2);
});

test('foreground recovery preserves a live socket and resumes a disconnected client', async () => {
  assert.equal(await checkForegroundConnection({
    getConnectionState: () => ({ status: 'connected' }),
    async checkLiveness() {},
  }), true);
  let resumed = 0;
  assert.equal(await checkForegroundConnection({
    getConnectionState: () => ({ status: 'disconnected' }),
    ensureConnected() { resumed += 1; },
  }), false);
  assert.equal(resumed, 1);
});

function fakeConnectionClient(initialState) {
  const listeners = new Set();
  let current = initialState;
  return {
    subscribeConnectionStatus(listener) {
      listeners.add(listener);
      listener(current);
      return () => listeners.delete(listener);
    },
    emit(state) {
      current = state;
      for (const listener of listeners) listener(state);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('connectionPhase maps DaemonClient states to the three UI phases', () => {
  assert.deepEqual(connectionPhase({ status: 'connected' }), { phase: 'online', label: '' });
  assert.equal(connectionPhase({ status: 'connecting', attempt: 2 }).phase, 'connecting');
  assert.equal(connectionPhase({ status: 'disconnected' }).phase, 'offline');
  assert.match(connectionPhase({ status: 'disconnected', reason: 'relay down' }).label, /relay down/);
  assert.equal(connectionPhase({ status: 'disposed' }).phase, 'offline');
  assert.equal(connectionPhase(undefined).phase, 'offline');
});

test('watchConnection reports status and only fires onReconnected after a real drop', () => {
  const client = fakeConnectionClient({ status: 'connected' });
  const phases = [];
  let reconnects = 0;
  const stop = watchConnection(client, {
    onStatus: (phase) => phases.push(phase.phase),
    onReconnected: () => { reconnects += 1; },
  });

  // Initial connected emission must not count as a reconnect.
  assert.deepEqual(phases, ['online']);
  assert.equal(reconnects, 0);

  client.emit({ status: 'disconnected', reason: 'socket closed' });
  client.emit({ status: 'connecting', attempt: 1 });
  assert.equal(reconnects, 0);

  client.emit({ status: 'connected' });
  assert.equal(reconnects, 1);

  // A second connected without a new drop must not re-fire.
  client.emit({ status: 'connected' });
  assert.equal(reconnects, 1);

  client.emit({ status: 'connecting', attempt: 1 });
  client.emit({ status: 'connected' });
  assert.equal(reconnects, 2);
  assert.deepEqual(phases, [
    'online', 'offline', 'connecting', 'online', 'online', 'connecting', 'online',
  ]);

  stop();
  assert.equal(client.listenerCount, 0);
});

test('watchConnection rejects clients without a status subscription', () => {
  assert.throws(() => watchConnection({}, {}), /不支持连接状态订阅/);
});

test('resyncAfterReconnect refetches host session.list and current history', async () => {
  const calls = [];
  const client = {
    async hostRpc(method, payload) {
      calls.push([method, payload]);
      if (method === 'session.list') return { ok: true, value: { items: [{ sessionId: 's1' }] } };
      if (method === 'workspace.list') return { ok: true, value: { items: [] } };
      if (method === 'session.history') return { ok: true, value: { events: [], hasMore: false } };
      return { ok: false, error: method };
    },
  };

  const result = await resyncAfterReconnect(client, { sessionId: 's1' });
  assert.equal(result.sessions.items[0].sessionId, 's1');
  assert.equal(result.history.hasMore, false);
  assert.deepEqual(calls, [
    ['session.list', {}],
    ['workspace.list', {}],
    ['session.history', { sessionId: 's1', maxMessages: 50 }],
  ]);
});

test('resyncAfterReconnect forwards the subagent history address', async () => {
  const calls = [];
  const client = {
    async hostRpc(method, payload) {
      calls.push([method, payload]);
      if (method === 'session.history') return { ok: true, value: { events: [], hasMore: false } };
      return { ok: true, value: { items: [] } };
    },
  };
  const address = { kind: 'subagent', parentSessionId: 's-1', childSessionId: 's-sub', mode: 'continuable' };
  await resyncAfterReconnect(client, { sessionId: 's-sub', address });
  assert.deepEqual(calls.find(([method]) => method === 'session.history')[1], {
    sessionId: 's-sub',
    maxMessages: 50,
    address,
  });
});

test('resyncAfterReconnect skips history without an open session and propagates errors', async () => {
  const result = await resyncAfterReconnect({
    async hostRpc(method) {
      if (method === 'session.history') throw new Error('must not fetch history');
      return { ok: true, value: { items: [] } };
    },
  });
  assert.equal(result.history, null);

  await assert.rejects(
    () => resyncAfterReconnect({
      async hostRpc() {
        throw new Error('daemon offline');
      },
    }, { sessionId: 's1' }),
    /daemon offline/,
  );
});

test('draft store keeps unsent text per session and per server', () => {
  const storage = memoryStorage();
  const storeA = createDraftStore(storage, 'srv-a');
  const storeB = createDraftStore(storage, 'srv-b');

  storeA.save('agent-1', '还没发出去的话');
  storeA.save('agent-2', 'draft two');
  storeB.save('agent-1', 'other server');

  assert.equal(storeA.load('agent-1'), '还没发出去的话');
  assert.equal(storeA.load('agent-2'), 'draft two');
  assert.equal(storeB.load('agent-1'), 'other server');

  // Simulate a reload: a fresh store over the same storage sees the draft.
  assert.equal(createDraftStore(storage, 'srv-a').load('agent-1'), '还没发出去的话');

  storeA.clear('agent-1');
  assert.equal(storeA.load('agent-1'), '');
  storeA.save('agent-2', '');
  assert.equal(storeA.load('agent-2'), '');

  storeB.clearAll();
  assert.equal(createDraftStore(storage, 'srv-b').load('agent-1'), '');
});

test('draft store keeps attachments in memory across session switches only', () => {
  const storage = memoryStorage();
  const store = createDraftStore(storage, 'srv-a');
  const images = [{ mediaType: 'image/png', data: 'aGk=' }];

  store.saveAttachments('agent-1', images);
  assert.deepEqual(store.loadAttachments('agent-1'), images);
  // Returned array is a copy — mutating it must not corrupt the stash.
  store.loadAttachments('agent-1').pop();
  assert.equal(store.loadAttachments('agent-1').length, 1);

  // In-memory by design: a "reload" (fresh store) does not see attachments.
  assert.deepEqual(createDraftStore(storage, 'srv-a').loadAttachments('agent-1'), []);

  store.saveAttachments('agent-1', []);
  assert.deepEqual(store.loadAttachments('agent-1'), []);

  store.saveAttachments('agent-2', images);
  store.clear('agent-2');
  assert.deepEqual(store.loadAttachments('agent-2'), []);

  store.saveAttachments('agent-3', images);
  store.clearAll();
  assert.deepEqual(store.loadAttachments('agent-3'), []);
});

test('draft store degrades to memory when storage is unavailable', () => {
  const broken = {
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
    removeItem() { throw new Error('storage denied'); },
  };
  const store = createDraftStore(broken, 'srv-a');
  store.save('agent-1', 'memory draft');
  assert.equal(store.load('agent-1'), 'memory draft');
  store.clearAll();
  assert.equal(store.load('agent-1'), '');
});

test('transportModeLabel formats real transport modes accurately', () => {
  assert.equal(transportModeLabel('lan'), '局域网直连 · 端到端加密');
  assert.equal(transportModeLabel('p2p'), 'P2P 直连 · 端到端加密');
  assert.equal(transportModeLabel('turn'), 'TURN 中继 · 端到端加密');
  assert.equal(transportModeLabel('relay'), '服务器中继 · 端到端加密');
  assert.equal(transportModeLabel(''), 'dshd · 端到端加密');
  assert.equal(transportModeLabel(null), 'dshd · 端到端加密');
});

test('watchTransportMode subscribes to transport mode updates and cleans up on dispose', () => {
  const listeners = new Set();
  const client = {
    subscribeTransportMode(fn) {
      listeners.add(fn);
      fn('relay');
      return () => listeners.delete(fn);
    },
  };
  const seen = [];
  const dispose = watchTransportMode(client, (mode) => seen.push(mode));
  assert.deepEqual(seen, ['relay']);
  for (const fn of listeners) fn('p2p');
  assert.deepEqual(seen, ['relay', 'p2p']);
  dispose();
  assert.equal(listeners.size, 0);
});
