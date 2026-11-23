const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureWorkspace, rpc, rpcMethodPath } = require('./workspace-rpc');

test('rpcMethodPath maps namespace/verb without encoding the slash', () => {
  assert.equal(rpcMethodPath('workspace/create'), '/api/workspace/create');
  assert.throws(() => rpcMethodPath('workspace.create'), /namespace\/verb/);
  assert.throws(() => rpcMethodPath('workspace%2Fcreate'), /namespace\/verb/);
});

test('ensureWorkspace uses the Harness unary route and full RPC envelope', async () => {
  let request;
  const value = await ensureWorkspace('http://127.0.0.1:3080/', 'C:\\work', async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return Response.json({
      type: 'server-response',
      rpcId: request.body.rpcId,
      result: {
        ok: true,
        value: { workspace: { path: 'C:\\work' }, created: true },
      },
    });
  });

  assert.equal(request.url, 'http://127.0.0.1:3080/api/workspace/create');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['content-type'], 'application/json');
  assert.deepEqual(request.body, {
    type: 'client-request',
    rpcId: request.body.rpcId,
    method: 'workspace/create',
    payload: { args: { request: { path: 'C:\\work' } } },
  });
  assert.deepEqual(value, { workspace: { path: 'C:\\work' }, created: true });
});

test('rpc attaches a redeemed session Cookie and still strips the token query', async () => {
  let request;
  await rpc('http://127.0.0.1:3080/?token=spent', 'workspace/create', { request: { path: 'C:\\work' } }, async (url, init) => {
    request = { url, cookie: init.headers.Cookie };
    const body = JSON.parse(init.body);
    return Response.json({
      type: 'server-response',
      rpcId: body.rpcId,
      result: { ok: true, value: {} },
    });
  }, { cookie: 'dsh-auth-x=tok' });
  assert.equal(request.url, 'http://127.0.0.1:3080/api/workspace/create');
  assert.equal(request.cookie, 'dsh-auth-x=tok');
});

test('rpc surfaces Harness business errors from a successful HTTP exchange', async () => {
  await assert.rejects(
    () => rpc('http://127.0.0.1:3080', 'workspace/create', { request: { path: 'missing' } }, async (_url, init) => {
      const request = JSON.parse(init.body);
      return Response.json({
        type: 'server-response',
        rpcId: request.rpcId,
        result: {
          ok: false,
          error: {
            code: 'workspace-invalid-path',
            message: 'workspace path is not an existing directory',
            details: { path: 'missing' },
          },
        },
      });
    }),
    /workspace path is not an existing directory/,
  );
});

test('rpc rejects a response that does not echo its request id', async () => {
  await assert.rejects(
    () => rpc('http://127.0.0.1:3080', 'workspace/create', { request: { path: 'C:\\work' } }, async () => Response.json({
      type: 'server-response',
      rpcId: 'different-request',
      result: { ok: true, value: {} },
    })),
    /返回无效响应/,
  );
});

test('rpc reports a non-JSON carrier failure with its HTTP status', async () => {
  await assert.rejects(
    () => rpc('http://127.0.0.1:3080', 'workspace/create', {}, async () => new Response('not found', { status: 404 })),
    /返回非 JSON（HTTP 404）/,
  );
});

test('rpc aborts and rejects with ETIMEDOUT when fetch hangs past timeoutMs', async () => {
  let seenSignal;
  await assert.rejects(
    () => rpc(
      'http://127.0.0.1:3080',
      'workspace/create',
      {},
      async (_url, init) => {
        seenSignal = init.signal;
        return new Promise(() => {});
      },
      { timeoutMs: 25 },
    ),
    (err) => err?.code === 'ETIMEDOUT' && /超时（25ms）/.test(err.message),
  );
  assert.equal(seenSignal?.aborted, true);
});
