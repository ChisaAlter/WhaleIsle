import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HarnessClient } from './src/channels/weixin/harness-client.mjs';
import { createHarnessAuthTransport } from './plugin-src/host/harness-auth-transport.mjs';
import { createHarnessSessionExecutors } from './plugin-src/host/harness-session-coordinator.mjs';

const harnessRoot = fileURLToPath(new URL('../deepseek-harness', import.meta.url));
const cliRequire = createRequire(join(harnessRoot, 'apps/cli/package.json'));
const connectionPkgRequire = createRequire(
  join(harnessRoot, 'packages/client/connection/package.json'),
);
const { Context } = await import(pathToFileURL(cliRequire.resolve('@deepseek-ai/cordis')).href);
const ConnectionPlugin = await import(
  pathToFileURL(join(harnessRoot, 'packages/client/connection/lib/index.js')).href
);

async function createRealConnectionContext(t, { port = 3080, onIntercept, wireStream } = {}) {
  const rootCtx = new Context();
  await rootCtx.plugin(ConnectionPlugin);
  const ctx = rootCtx.extend({
    webServer: { port },
    typertGateway: { wireStream },
  });
  t.after(async () => {
    await rootCtx.fiber.dispose();
  });
  if (onIntercept) {
    ctx.connection.rpc.intercept('/api', () => true, onIntercept);
  }
  return { rootCtx, ctx };
}

test('createHarnessAuthTransport binds real 0.2.3-alpha.2 HostConnectionService and TypertGateway wireStream', async (t) => {
  const records = [];
  const rpcCalls = [];
  const eventQueues = new Set();
  const followQueues = new Set();
  let clientSeq = 0;

  function pushSessionEvent(type, data) {
    const entry = { type: 'event', event: { seq: records.length, time: Date.now(), type, data } };
    records.push(entry);
    for (const queue of followQueues) queue.push(entry);
  }

  function makeQueue() {
    const buffer = [];
    let waiting = null;
    let closed = false;
    return {
      push(item) {
        if (closed) return;
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve({ value: item, done: false });
        } else {
          buffer.push(item);
        }
      },
      end() {
        closed = true;
        if (waiting) {
          const resolve = waiting;
          waiting = null;
          resolve({ value: undefined, done: true });
        }
      },
      [Symbol.asyncIterator]() {
        return {
          next: () => {
            if (buffer.length > 0) return Promise.resolve({ value: buffer.shift(), done: false });
            if (closed) return Promise.resolve({ value: undefined, done: true });
            return new Promise((resolve) => { waiting = resolve; });
          },
          return: () => {
            this.end();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  const wireStream = {
    async open(endpoint, payload, _uplink, peer, signal) {
      assert.equal(peer.principal.kind, 'owner');
      assert.equal(signal.aborted, false);
      const queue = makeQueue();
      signal.addEventListener('abort', () => queue.end(), { once: true });

      if (endpoint === '$events') {
        eventQueues.add(queue);
        signal.addEventListener('abort', () => eventQueues.delete(queue), { once: true });
        queue.push({ type: 'ready', clientId: `client-${++clientSeq}`, host: { home: '/test' } });
        return queue;
      }
      if (endpoint === 'session/follow') {
        followQueues.add(queue);
        signal.addEventListener('abort', () => followQueues.delete(queue), { once: true });
        queue.push({
          type: 'snapshot',
          records: [...records],
          cursor: records.length - 1,
          hasMore: false,
          projections: { values: { modelSelection: { next: { provider: 'mock', model: 'mock' } } } },
        });
        return queue;
      }
      if (endpoint === 'workspace/follow') {
        queue.push({ type: 'baseline', value: { items: [], archivedSessionIds: [] } });
        queue.end();
        return queue;
      }
      throw Object.assign(new Error(`Unknown stream ${endpoint}`), { code: 'gateway/lookup-not-found' });
    },
    failure(error) {
      return { code: error?.code ?? 'gateway/internal', message: error.message, details: {} };
    },
  };

  const { ctx } = await createRealConnectionContext(t, {
    wireStream,
    async onIntercept(endpoint, payload, _signal, peer) {
      assert.equal(peer.principal.kind, 'owner');
      rpcCalls.push({ endpoint, payload });
      if (endpoint === 'session/prompt') {
        const requestId = payload.args.request.requestId;
        pushSessionEvent('turn/start', { turn: 1 });
        pushSessionEvent('user/message', { turn: 1, source: { kind: 'user', rpcId: requestId } });
        for (const q of eventQueues) {
          q.push({
            type: 'waterfall',
            eventId: 'decision-1',
            agentId: 'session-1',
            event: 'approval/request',
            request: { toolName: 'test-tool', callId: 'call-1' },
          });
        }
        return { ok: true, value: { accepted: true } };
      }
      if (endpoint === '$events/result') {
        pushSessionEvent('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'owner peer ok' }] } });
        pushSessionEvent('turn/end', { turn: 1, reason: 'completed' });
        return { ok: true, value: { ok: true } };
      }
      return { ok: true, value: {} };
    },
  });

  const baseUrl = 'http://127.0.0.1:3080';
  const transport = createHarnessAuthTransport(ctx, baseUrl);
  assert.equal(typeof transport.fetchImpl, 'function');
  assert.equal(typeof transport.createWebSocket, 'function');

  const harness = new HarnessClient({ baseUrl, ...transport });
  assert.equal(await harness.health(), true);

  let approvalCount = 0;
  const answer = await harness.ask('session-1', 'hello', {
    signal: AbortSignal.timeout(5_000),
    onInteraction: async (interaction) => {
      approvalCount += 1;
      await interaction.respond({
        ok: true,
        value: { sessionId: 'session-1', approvalId: 'decision-1', outcome: 'allowed-once' },
      });
    },
  });
  assert.equal(answer, 'owner peer ok');
  assert.equal(approvalCount, 1);
  assert.ok(rpcCalls.some((c) => c.endpoint === '$events/result'));

  // Origin boundary enforcement
  await assert.rejects(transport.fetchImpl('https://example.com/api/host.describe'), /Unexpected Harness origin/);
  assert.throws(() => transport.createWebSocket('ws://example.com/api/events.mux'), /Unexpected Harness origin/);
  assert.deepEqual(createHarnessAuthTransport(ctx, 'https://example.com'), {});
});

test('createHarnessAuthTransport fails closed when required 0.2.3-alpha.2 Host services are missing or disposed', async () => {
  const baseUrl = 'http://127.0.0.1:3080';
  assert.deepEqual(createHarnessAuthTransport({ webServer: { port: 3080 }, connection: {} }, baseUrl), {});
  assert.deepEqual(
    createHarnessAuthTransport({
      webServer: { port: 3080 },
      connection: { createSharedFetchHandler: () => ({ fetch: async () => new Response() }) },
      typertGateway: { wireStream: { open: async () => [] } },
    }, baseUrl),
    {},
  );
  assert.deepEqual(
    createHarnessAuthTransport({
      webServer: { port: 3080 },
      connection: {
        createPeer: () => ({ principal: { kind: 'guest' }, signal: new AbortController().signal }),
        createSharedFetchHandler: () => ({ fetch: async () => new Response() }),
      },
      typertGateway: { wireStream: { open: async () => [] } },
    }, baseUrl),
    {},
  );

  // Disposing the Peer aborts active in-process streams cleanly.
  const ac = new AbortController();
  const peer = { id: 'p1', principal: { kind: 'owner' }, signal: ac.signal };
  let streamAborted = false;
  const transport = createHarnessAuthTransport({
    webServer: { port: 3080 },
    connection: {
      createPeer: () => peer,
      createSharedFetchHandler: () => ({ fetch: async () => Response.json({ ok: true }) }),
    },
    typertGateway: {
      wireStream: {
        open(_endpoint, _payload, _uplink, _peer, signal) {
          signal.addEventListener('abort', () => { streamAborted = true; }, { once: true });
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'ready', clientId: 'c1', host: { home: '/test' } };
              await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
            },
          };
        },
        failure: (err) => ({ code: 'gateway/internal', message: err.message, details: {} }),
      },
    },
  }, baseUrl);

  const socket = transport.createWebSocket('ws://127.0.0.1:3080/api/events.mux');
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  ac.abort(new Error('Peer disposed'));
  await new Promise((resolve) => {
    if (socket.readyState === 3) resolve();
    else socket.addEventListener('close', resolve, { once: true });
  });
  assert.equal(streamAborted, true);
});

test('createHarnessSessionExecutors controlExecutor reads Session.snapshotEvents() (no .events property)', () => {
  let cancelled = false;
  let injected = null;
  const events = [
    { type: 'turn/start', data: { turn: 3 } },
    { type: 'user/message', data: { source: { rpcId: 'rpc-42' } } },
  ];
  const fakeAgent = {
    status: 'running',
    session: {
      snapshotEvents: () => Object.freeze([...events]),
    },
    cancel() { cancelled = true; },
    inject(msg) { injected = msg; },
  };
  const { controlExecutor } = createHarnessSessionExecutors({
    get: (key) => (key === 'agents' ? new Map([['sess-1', fakeAgent]]) : undefined),
  });
  assert.equal(
    controlExecutor({ sessionId: 'sess-1', expectedTurn: 3, promptRpcId: 'rpc-42', action: 'steer', text: 'focus' }),
    true,
  );
  assert.equal(injected.content[0].text, 'focus');
  assert.equal(
    controlExecutor({ sessionId: 'sess-1', expectedTurn: 3, promptRpcId: 'rpc-42', action: 'stop' }),
    true,
  );
  assert.equal(cancelled, true);
});
