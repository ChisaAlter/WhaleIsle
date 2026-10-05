'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HOST_RPC_METHODS,
  isAllowedHostMethod,
  assertLoopbackHarnessOrigin,
  hostRpcTarget,
  hostRpcPayload,
  forwardHostRpc,
  forwardHostRespond,
  HARNESS_DOWN_MESSAGE,
  slimHostRpcValue,
} = require('./dshd-host-tunnel');

test('allowlist includes session/workspace/host browse and excludes privileged methods', () => {
  assert.equal(isAllowedHostMethod('session.list'), true);
  assert.equal(isAllowedHostMethod('session.selectModel'), true);
  assert.equal(isAllowedHostMethod('workspace.archiveSession'), true);
  assert.equal(isAllowedHostMethod('host.listDirectory'), true);
  assert.equal(isAllowedHostMethod('host.createDirectory'), true);
  assert.equal(isAllowedHostMethod('host.pickDirectory'), false);
  assert.equal(isAllowedHostMethod('host.openPath'), false);
  assert.equal(isAllowedHostMethod('settings.describe'), false);
  assert.equal(isAllowedHostMethod('credentials.set'), false);
  assert.equal(isAllowedHostMethod('llm.discoverModels'), false);
  assert.equal(isAllowedHostMethod('mcpServers/list'), false);
  assert.equal(isAllowedHostMethod('commands/list'), true);
  assert.equal(isAllowedHostMethod('commands/execute'), true);
  assert.equal(HOST_RPC_METHODS.has('session.prompt'), true);
});

test('session list forwards every row but excludes unused heavyweight projections', async () => {
  const values = {
    title: 'A session', modelSelection: { provider: 'p', model: 'm' },
    permissions: { currentValue: 'workspace-write' }, plan: { active: true },
    sessionListMetadata: { title: 'A session' },
    usagePanel: { details: 'x'.repeat(150_000) },
    contextBreakdown: { text: 'y'.repeat(50_000) },
  };
  const items = Array.from({ length: 3 }, (_, index) => ({
    sessionId: `s-${index}`, cwd: '/repo', running: index === 0,
    blank: index === 1, parentSessionId: index === 2 ? 's-0' : '',
    projections: { version: 1, values },
  }));
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080', method: 'session.list', payload: {},
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId,
        result: { ok: true, value: { items, cursor: 'unchanged' } },
      }));
    },
  });
  assert.equal(result.value.items.length, items.length);
  assert.equal(result.value.cursor, 'unchanged');
  for (const [index, item] of result.value.items.entries()) {
    assert.deepEqual({ ...item, projections: undefined }, { ...items[index], projections: undefined });
    assert.deepEqual(Object.keys(item.projections.values).sort(), ['sessionListMetadata', 'title']);
    assert.equal(item.projections.version, 1);
    assert.equal(item.projections.values.title, values.title);
  }
  assert.ok(JSON.stringify(result.value).length < 3000, 'catalog bandwidth budget exceeded');
  assert.ok(values.usagePanel.details.length > 0, 'must not mutate the host projections');
});

test('catalog slimming never strips the open session model, permission or plan details', () => {
  const projections = { values: {
    title: 'Session', modelSelection: { next: { provider: 'p', model: 'm' } },
    permissions: { currentValue: 'workspace-write' }, plan: { active: true },
  } };
  const detail = { events: [], projections };
  assert.equal(slimHostRpcValue('session.history', detail).projections, projections);
  for (const method of ['session.create', 'session.search', 'session.models']) {
    assert.equal(slimHostRpcValue(method, detail), detail);
  }
});

test('assertLoopbackHarnessOrigin rejects empty, non-http, and non-loopback origins', () => {
  assert.throws(() => assertLoopbackHarnessOrigin(''), /桌面端未启动/);
  assert.throws(() => assertLoopbackHarnessOrigin('https://127.0.0.1:3080'), /loopback/);
  assert.throws(() => assertLoopbackHarnessOrigin('http://example.com:3080'), /loopback/);
  assert.throws(() => assertLoopbackHarnessOrigin('http://192.168.1.2:3080'), /loopback/);
  assert.equal(assertLoopbackHarnessOrigin('http://127.0.0.1:3080'), 'http://127.0.0.1:3080');
  assert.equal(assertLoopbackHarnessOrigin('http://localhost:3080/'), 'http://localhost:3080');
});

test('forwardHostRpc rejects methods outside the allowlist without calling fetch', async () => {
  let called = 0;
  await assert.rejects(
    () => forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'settings.describe',
      payload: {},
      fetchImpl: async () => {
        called += 1;
        return new Response('{}');
      },
    }),
    /不允许/,
  );
  assert.equal(called, 0);
});

test('forwardHostRpc pins Host, strips Origin/Referer/Cookie/sec-fetch, and refuses gzip', async () => {
  /** @type {Request | null} */
  let seen = null;
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.list',
    payload: { cursor: 'x' },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { items: [] } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/session/list');
  assert.equal(seen.headers.get('host'), '127.0.0.1:3080');
  assert.equal(seen.headers.get('origin'), null);
  assert.equal(seen.headers.get('referer'), null);
  assert.equal(seen.headers.get('cookie'), null);
  assert.equal(seen.headers.get('sec-fetch-site'), null);
  assert.equal(seen.headers.get('accept-encoding'), 'identity');
  const body = JSON.parse(await seen.clone().text());
  assert.equal(body.type, 'client-request');
  assert.equal(body.method, 'session/list');
  assert.deepEqual(body.payload.args, { _request: { cursor: 'x' } });
});

test('hostRpcTarget maps dotted SPA names onto 0.1.2 slash endpoints', () => {
  assert.deepEqual(hostRpcTarget('session.list'), { path: '/api/session/list', wireMethod: 'session/list' });
  assert.deepEqual(hostRpcTarget('session.history'), { path: '/api/session/page', wireMethod: 'session/page' });
  assert.equal(isAllowedHostMethod('session.projections'), true);
  assert.deepEqual(hostRpcTarget('session.projections'), { path: '/api/session/projections', wireMethod: 'session/projections' });
  assert.deepEqual(hostRpcTarget('session.models'), { path: '/api/session/modelCatalog', wireMethod: 'session/modelCatalog' });
  assert.deepEqual(hostRpcTarget('host.describe'), { path: '/api/host/describe', wireMethod: 'host/describe' });
  assert.deepEqual(hostRpcTarget('host.listDirectory'), { path: '/api/directoryPicker/list', wireMethod: 'directoryPicker/list' });
  assert.deepEqual(hostRpcTarget('host.createDirectory'), { path: '/api/directoryPicker/createDirectory', wireMethod: 'directoryPicker/createDirectory' });
  assert.deepEqual(hostRpcTarget('agentPreset.list'), { path: '/api/agentPresets/list', wireMethod: 'agentPresets/list' });
  assert.deepEqual(hostRpcTarget('commands/list'), { path: '/api/commands/list', wireMethod: 'commands/list' });
});

test('hostRpcPayload wraps a bare object as Typert args', () => {
  assert.deepEqual(hostRpcPayload('session.list', {}), { args: { _request: {} } });
  assert.deepEqual(hostRpcPayload('session.search', { query: 'x' }), { args: { request: { query: 'x' } } });
  assert.deepEqual(hostRpcPayload('session.models', { sessionId: 's1' }), { args: {} });
  assert.deepEqual(hostRpcPayload('session.projections', { sessionId: 's1' }), { args: { request: { sessionId: 's1' } } });
  const prompt = hostRpcPayload('session.prompt', { sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] });
  assert.equal(prompt.args.request.sessionId, 's1');
  assert.equal(prompt.args.request.mode, 'queue');
  assert.match(prompt.args.request.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(hostRpcPayload('commands/execute', { args: { line: '/plan off' } }), { args: { line: '/plan off' } });
  assert.deepEqual(hostRpcPayload('host.listDirectory', {}), { args: {} });
  assert.deepEqual(hostRpcPayload('host.listDirectory', { path: 'C:/Ai' }), { args: { path: 'C:/Ai' } });
  assert.deepEqual(hostRpcPayload('host.createDirectory', { path: 'C:/Ai', name: 'tmp' }), { args: { path: 'C:/Ai', name: 'tmp' } });
});

test('forwardHostRpc attaches the desktop-redeemed harness Cookie and still strips phone cookies', async () => {
  /** @type {Request | null} */
  let seen = null;
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.list',
    payload: {},
    cookie: 'dsh-browser-session=abc123\r\nX-Injected: 1',
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { items: [] } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.ok(seen);
  assert.equal(seen.headers.get('cookie'), 'dsh-browser-session=abc123');
  assert.equal(seen.headers.get('x-injected'), null);
  assert.equal(seen.headers.get('origin'), null);
});

function fakeRemoteMuxWebSocket(onOpenSend) {
  return class FakeRemoteMuxWebSocket {
    constructor(url, protocols, options) {
      this.url = url;
      this.ctorArgs = [url, protocols, options];
      this.protocols = protocols;
      this.options = options && typeof options === 'object' ? options : (protocols && !Array.isArray(protocols) ? protocols : {});
      this.readyState = 0;
      this.sent = [];
      this.listeners = { open: [], message: [], error: [], close: [] };
      queueMicrotask(() => {
        this.readyState = 1;
        for (const fn of this.listeners.open) fn();
      });
    }

    addEventListener(type, fn) {
      (this.listeners[type] || (this.listeners[type] = [])).push(fn);
    }

    removeEventListener(type, fn) {
      this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== fn);
    }

    send(text) {
      const frame = JSON.parse(text);
      this.sent.push(frame);
      if (frame.type === 'open' && typeof onOpenSend === 'function') {
        queueMicrotask(() => onOpenSend(this, frame));
      }
    }

    emit(type, event) {
      for (const fn of this.listeners[type] || []) fn(event);
    }

    close() {
      this.readyState = 3;
    }
  };
}

test('forwardHostRpc fills workspace.list from workspace/follow baseline when unary 404s', async () => {
  let muxSocket = null;
  const FakeWs = fakeRemoteMuxWebSocket((socket, open) => {
    muxSocket = socket;
    assert.equal(open.endpoint, 'workspace/follow');
    assert.deepEqual(open.payload, { args: {} });
    socket.emit('message', {
      data: JSON.stringify({
        type: 'item',
        streamId: open.streamId,
        value: {
          type: 'baseline',
          value: {
            items: [{
              workspaceId: 'ws-1',
              title: 'Deepseek-Harness-Desktop',
              path: 'C:/Ai/Deepseek-Harness-Desktop',
              sessionIds: ['s-pong'],
            }],
            archivedSessionIds: ['s-old'],
            scratchCwd: 'C:/Users/t/.dsh/no-workspace',
          },
        },
      }),
    });
  });
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'workspace.list',
    payload: {},
    cookie: 'dsh-browser-session=follow-cookie',
    fetchImpl: async () => new Response('not found', { status: 404 }),
    WebSocketImpl: FakeWs,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.items[0].title, 'Deepseek-Harness-Desktop');
  assert.deepEqual(result.value.items[0].sessionIds, ['s-pong']);
  assert.deepEqual(result.value.archivedSessionIds, ['s-old']);
  // The phone lists against the same scratch cwd the desktop sidebar uses.
  assert.equal(result.value.scratchCwd, 'C:/Users/t/.dsh/no-workspace');
  assert.ok(muxSocket);
  assert.equal(new URL(muxSocket.url).pathname, '/api/remote.mux');
  assert.deepEqual(muxSocket.ctorArgs[1], { headers: { Cookie: 'dsh-browser-session=follow-cookie' } });
  assert.equal(muxSocket.ctorArgs[2], undefined);
  assert.equal(muxSocket.options.headers.Cookie, 'dsh-browser-session=follow-cookie');
  assert.equal(muxSocket.sent.some((frame) => frame.type === 'cancel'), true);
});

test('forwardHostRpc does not invent an empty workspace.list when follow baseline omits items', async () => {
  await assert.rejects(
    () => forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'workspace.list',
      payload: {},
      fetchImpl: async () => new Response('not found', { status: 404 }),
      WebSocketImpl: fakeRemoteMuxWebSocket((socket, open) => {
        socket.emit('message', {
          data: JSON.stringify({
            type: 'item',
            streamId: open.streamId,
            value: {
              type: 'baseline',
              value: { archivedSessionIds: [] },
            },
          }),
        });
      }),
    }),
    /workspace follow missing baseline/,
  );
});

test('forwardHostRpc does not invent an empty workspace.list when follow is missing', async () => {
  await assert.rejects(
    () => forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'workspace.list',
      payload: {},
      fetchImpl: async () => new Response('not found', { status: 404 }),
      WebSocketImpl: fakeRemoteMuxWebSocket((socket, open) => {
        socket.emit('message', {
          data: JSON.stringify({
            type: 'error',
            streamId: open.streamId,
            error: { code: 'gateway/not-found', message: 'no follow', details: {} },
          }),
        });
      }),
    }),
    /no follow|workspace follow/,
  );
});

test('forwardHostRpc posts directoryPicker/list with a bare path and adapts createDirectory string', async () => {
  /** @type {Request | null} */
  let listed = null;
  const listResult = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'host.listDirectory',
    payload: { path: 'C:/Ai' },
    fetchImpl: async (url, init) => {
      listed = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { path: 'C:/Ai', crumbs: [], entries: [] } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(listResult.ok, true);
  assert.equal(new URL(listed.url).pathname, '/api/directoryPicker/list');
  assert.deepEqual(JSON.parse(await listed.clone().text()).payload.args, { path: 'C:/Ai' });

  const created = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'host.createDirectory',
    payload: { path: 'C:/Ai', name: 'tmp' },
    fetchImpl: async (_url, init) => new Response(JSON.stringify({
      type: 'server-response',
      rpcId: JSON.parse(init.body).rpcId,
      result: { ok: true, value: 'C:/Ai/tmp' },
    }), { headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(created.ok, true);
  assert.deepEqual(created.value, { path: 'C:/Ai/tmp' });
});

test('forwardHostRpc does not invent an empty directory listing when picker 404s', async () => {
  await assert.rejects(
    () => forwardHostRpc({
      origin: 'http://127.0.0.1:3080',
      method: 'host.listDirectory',
      payload: { path: 'C:/Ai' },
      fetchImpl: async () => new Response('not found', { status: 404 }),
    }),
    /host HTTP 404/,
  );
});

test('forwardHostRpc posts Typert commands/execute under /api/commands/execute', async () => {
  /** @type {Request | null} */
  let seen = null;
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'commands/execute',
    payload: { args: { agentId: 's1', line: '/permission read-only', images: [] } },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: JSON.parse(init.body).rpcId,
        result: { ok: true, value: { commandId: 'cmd-1', result: { kind: 'success' } } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.commandId, 'cmd-1');
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/commands/execute');
  const commandBody = JSON.parse(await seen.clone().text());
  assert.equal(commandBody.method, 'commands/execute');
  assert.equal(commandBody.payload.args.line, '/permission read-only');
  assert.deepEqual(commandBody.payload.args.images, []);
});

test('forwardHostRpc fails visibly when harness origin is empty', async () => {
  await assert.rejects(
    () => forwardHostRpc({ origin: '', method: 'session.list', payload: {} }),
    new RegExp(HARNESS_DOWN_MESSAGE),
  );
});

test('forwardHostRespond posts /api/respond without browser Origin', async () => {
  /** @type {Request | null} */
  let seen = null;
  await forwardHostRespond({
    origin: 'http://127.0.0.1:3099',
    rpcId: 'rpc-1',
    value: { sessionId: 's', approvalId: 'a', outcome: 'allowed-once' },
    fetchImpl: async (url, init) => {
      seen = new Request(url, init);
      return new Response(JSON.stringify({ type: 'rpc-receipt', rpcId: 'rpc-1' }), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.ok(seen);
  assert.equal(new URL(seen.url).pathname, '/api/respond');
  assert.equal(seen.headers.get('origin'), null);
  assert.equal(seen.headers.get('host'), '127.0.0.1:3099');
  const body = JSON.parse(await seen.clone().text());
  assert.equal(body.type, 'client-response');
  assert.equal(body.rpcId, 'rpc-1');
});

test('Gateway approval reply carries the active event generation and only its decision', async () => {
  let request;
  const rpcId = 'remote-event:' + JSON.stringify({ clientId: 'client-1', eventId: 'event-1', origin: 'http://example.com' });
  await forwardHostRespond({ origin: 'http://127.0.0.1:3099', cookie: 'dsh-auth-x=test', rpcId,
    value: { sessionId: 's', approvalId: 'a', outcome: 'allowed-once' },
    fetchImpl: async (url, init) => {
      request = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.body.rpcId, result: { ok: true } }));
    } });
  assert.equal(request.url, 'http://127.0.0.1:3099/api/$events/result');
  assert.equal(request.body.method, '$events/result');
  assert.deepEqual(request.body.payload, { args: { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', value: 'allowed-once' } } });
  await assert.rejects(() => forwardHostRespond({ origin: 'http://127.0.0.1:3099', rpcId, value: { outcome: 'anything' } }), /outcome/);
});

test('slimHostRpcValue drops assistant/chunk from session.history', () => {
  const value = {
    hasMore: true,
    events: [
      { event: { type: 'user/message', seq: 1 } },
      { event: { type: 'assistant/chunk', seq: 2 } },
      { event: { type: 'assistant/chunk', seq: 3 } },
      { event: { type: 'assistant/message', seq: 4 } },
    ],
  };
  const slim = slimHostRpcValue('session.history', value);
  assert.deepEqual(slim.events.map((entry) => entry.event.type), ['user/message', 'assistant/message']);
  assert.equal(slim.hasMore, true);
  assert.equal(slimHostRpcValue('session.list', value), value);
});

test('forwardHostRpc maps session.history onto session/page and retries throughSeq', async () => {
  const seen = [];
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.history',
    payload: { sessionId: 's1', maxMessages: 50 },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ path: new URL(url).pathname, throughSeq: body.payload.args.request.throughSeq });
      if (body.payload.args.request.throughSeq === 1_000_000_000) {
        return new Response(JSON.stringify({
          type: 'server-response',
          rpcId: body.rpcId,
          result: { ok: false, error: { code: 'gateway/bad-request', message: 'session page through seq 1000000000 is past cursor 7' } },
        }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId: body.rpcId,
        result: { ok: true, value: { records: [{ type: 'event', event: { type: 'user/message', seq: 1 } }], hasMore: false } },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(seen.map((item) => item.path), ['/api/session/page', '/api/session/page']);
  assert.deepEqual(seen.map((item) => item.throughSeq), [1_000_000_000, 7]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.events.map((entry) => entry.event.type), ['user/message']);
});

test('forwardHostRpc slims session.history before returning to the phone', async () => {
  const result = await forwardHostRpc({
    origin: 'http://127.0.0.1:3080',
    method: 'session.history',
    payload: { sessionId: 's1', maxMessages: 50 },
    fetchImpl: async (_url, init) => {
      const rpcId = JSON.parse(init.body).rpcId;
      return new Response(JSON.stringify({
        type: 'server-response',
        rpcId,
        result: {
          ok: true,
          value: {
            hasMore: false,
            events: [
              { event: { type: 'assistant/chunk', seq: 1 } },
              { event: { type: 'assistant/message', seq: 2 } },
            ],
          },
        },
      }), { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.events.map((entry) => entry.event.type), ['assistant/message']);
});
