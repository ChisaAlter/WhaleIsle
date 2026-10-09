'use strict';

// Unit coverage for the vendored dsh-task-control Host plugin. The plugin is
// ESM under vendor/, so the suite loads it through dynamic import and keeps
// every surface pure Node — no Electron, no cordis runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');

const PLUGIN = path.join(__dirname, '..', '..', 'vendor', 'dsh-task-control', 'lib');
const load = (file) => import(pathToFileURL(path.join(PLUGIN, file)).href);

test('an awaited drain timeout keeps a standalone process alive until its result', () => {
  const moduleUrl = pathToFileURL(path.join(PLUGIN, 'state.js')).href;
  const script = `import { createControlState, admit, acquireLock } from ${JSON.stringify(moduleUrl)};
    const state = createControlState(); admit(state);
    const result = await acquireLock(state, { owner: 'probe', drainTimeoutMs: 20 });
    process.stdout.write(result.code);`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '--eval', script],
    { encoding: 'utf8', timeout: 15000, windowsHide: true }), 'dshd/drain-timeout');
});

test('admit accepts while unlocked and rejects while locked', async () => {
  const { createControlState, admit, acquireLock } = await load('state.js');
  const state = createControlState();
  const first = admit(state, 'upgrade /api/remote.mux');
  assert.equal(first.accepted, true);
  const acquired = await acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 50 });
  assert.equal(acquired.ok, false);
  assert.equal(acquired.code, 'dshd/drain-timeout');
  // Timed-out drain reports what was still open — the label is how a stuck
  // transport is identified without Host-side logging.
  assert.equal(acquired.pendingCount, 1);
  assert.deepEqual(acquired.pendingLabels, ['upgrade /api/remote.mux']);
  // Timed-out drain released the lock — admission works again.
  const second = admit(state);
  assert.equal(second.accepted, true);
});

test('acquire drains admitted work, then admits block with the locked code', async () => {
  const { createControlState, admit, acquireLock } = await load('state.js');
  const state = createControlState();
  const pending = admit(state);
  let released = false;
  const acquiring = acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 2000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.lock !== null, true);
  const refused = admit(state);
  assert.equal(refused.accepted, false);
  assert.equal(refused.code, 'dshd/admission-locked');
  pending.done();
  released = true;
  const acquired = await acquiring;
  assert.equal(released, true);
  assert.equal(acquired.ok, true);
  assert.equal(acquired.drainedPending, 1);
});

test('release frees the lock; a superseded acquire is detected', async () => {
  const { createControlState, admit, acquireLock, releaseLock } = await load('state.js');
  const state = createControlState();
  // Hold a pending admission so owner-a's drain stays open while owner-b
  // cannot steal the lock — supersession comes from expiry, not takeover.
  const stuck = admit(state);
  const attempt = acquireLock(state, { owner: 'a', drainTimeoutMs: 1000, ttlMs: 30 });
  await new Promise((resolve) => setImmediate(resolve));
  const b = await acquireLock(state, { owner: 'b', drainTimeoutMs: 10 });
  assert.equal(b.ok, false);
  assert.equal(b.code, 'dshd/lock-held');
  // TTL expiry during the drain prunes the lock — a's acquire reports
  // superseded rather than committing against a stale generation.
  await new Promise((resolve) => setTimeout(resolve, 60));
  stuck.done();
  const result = await attempt;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'dshd/lock-superseded');
  const rel = releaseLock(state, { lockId: 'anything', owner: 'a' });
  assert.equal(rel.ok, true);
  assert.equal(rel.released, false);
});

test('release requires matching lockId and owner', async () => {
  const { createControlState, acquireLock, releaseLock } = await load('state.js');
  const state = createControlState();
  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);
  const wrong = releaseLock(state, { lockId: acquired.lockId, owner: 'other' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'dshd/lock-mismatch');
  const right = releaseLock(state, { lockId: acquired.lockId, owner: 'desktop-quit' });
  assert.equal(right.ok, true);
  assert.equal(right.released, true);
});

test('inspection aggregates agents, jobs, sockets, and pending requests', async () => {
  const { createControlState, admit } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const state = createControlState();
  process.env.DSHD_SCHEDULE_ENABLED = '1';
  const ctx = {
    get: (name) => ({
      agents: {
        list: () => [
          { id: 'a1', status: 'running', inbox: { nextTurn: [], nextStep: [] } },
          { id: 'a2', status: 'idle', inbox: { nextTurn: ['msg'], nextStep: [] } },
        ],
      },
      jobs: {
        list: (owner) => (owner === 'a1'
          ? [{ id: 'j1', status: 'running' }]
          : owner === undefined
            ? [{ id: 'j0', status: 'queued' }]
            : []),
      },
      webServer: { upgradedSockets: new Set([{}]) },
      schedule: { catalog: async () => [
        { id: 's1', sessionId: 'a1', kind: 'every', title: '站会提醒', status: 'active', scheduledAt: new Date(Date.now() + 3600e3).toISOString() },
        { id: 's2', sessionId: 'a2', kind: 'at', title: '过期', status: 'active', scheduledAt: new Date(Date.now() - 60e3).toISOString() },
        { id: 's3', sessionId: 'a2', kind: 'at', title: '已停', status: 'inactive', scheduledAt: new Date().toISOString() },
      ] },
    })[name],
    waterfall: async () => [],
  };
  const pending = admit(state);
  const inspection = await collectInspection(ctx, state);
  assert.equal(inspection.ok, true);
  const kinds = inspection.activeWork.map((w) => `${w.kind}:${w.id}`);
  assert.ok(kinds.includes('agent:a1'));
  assert.ok(kinds.includes('agent:a2'));
  assert.ok(kinds.includes('job:j1'));
  assert.ok(kinds.includes('socket:upgraded-sockets'));
  assert.ok(kinds.includes('request:pending-requests'));
  // Queued (non-running) jobs do not count — upstream predicate.
  assert.ok(!kinds.includes('job:j0'));
  const scheduled = inspection.scheduledWork.map((w) => w.id);
  assert.deepEqual(scheduled.sort(), ['s1', 's2']);
  assert.equal(inspection.scheduledWork.find((w) => w.id === 's2').due, true);
  assert.equal(inspection.scheduledWork.find((w) => w.id === 's1').recurring, true);
  pending.done();
  delete process.env.DSHD_SCHEDULE_ENABLED;
});

test('inspection excludes local idle transports but keeps external and unknown peers', async () => {
  const { createControlState } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const local = ['127.0.0.1', '127.2.3.4', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '::ffff:7f00:1'];
  const sockets = new Set(local.map(remoteAddress => ({ remoteAddress })));
  const ctx = { get: name => ({
    agents: { list: () => [] }, jobs: { list: () => [] }, webServer: { upgradedSockets: sockets },
  })[name] };
  const state = createControlState();
  const idle = await collectInspection(ctx, state);
  assert.deepEqual(idle.activeWork, []);
  for (const remoteAddress of ['192.168.1.25', '2001:db8::1', '::ffff:192.168.1.25', undefined]) {
    sockets.add({ remoteAddress });
  }
  sockets.add({ remoteAddress: '192.168.1.26', destroyed: true });
  const external = await collectInspection(ctx, state);
  assert.equal(external.activeWork.find(item => item.kind === 'socket').count, 4);
});

test('a real loopback socket is ignored without suppressing active agent work', async (t) => {
  const net = require('node:net');
  const { once } = require('node:events');
  const { createControlState } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const server = net.createServer();
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const accepted = once(server, 'connection');
  const client = net.connect(server.address().port, '127.0.0.1');
  t.after(() => client.destroy());
  const [socket] = await accepted;
  t.after(() => socket.destroy());
  const ctx = { get: name => ({
    agents: { list: () => [{ id: 'active', status: 'running' }] },
    jobs: { list: () => [] }, webServer: { upgradedSockets: new Set([socket]) },
  })[name] };
  const inspection = await collectInspection(ctx, createControlState());
  assert.deepEqual(inspection.activeWork, [{ kind: 'agent', id: 'active', detail: 'running' }]);
});

test('inspection reports missing producers as unavailable', async () => {
  const { createControlState } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const state = createControlState();
  const inspection = await collectInspection({ get: () => undefined }, state);
  assert.equal(inspection.coverage.agents, 'unavailable');
  assert.equal(inspection.coverage.jobs, 'unavailable');
  // Schedule coverage follows the declared flag: unset means the desktop
  // turned it off, so absence is `intentional-disabled`, not damage.
  assert.equal(inspection.coverage.schedule, 'intentional-disabled');
});

test('schedule coverage honors the declared enabled flag', async () => {
  const { createControlState } = await load('state.js');
  const { collectInspection } = await load('inspection.js');
  const state = createControlState();
  process.env.DSHD_SCHEDULE_ENABLED = '1';
  try {
    // Declared on but the service is missing: runtime damage, not opt-out.
    const missing = await collectInspection({ get: () => undefined }, state);
    assert.equal(missing.coverage.schedule, 'unavailable');
    // Declared on with a healthy catalog: full coverage.
    const ctx = {
      get: (name) => (name === 'schedule' ? { catalog: async () => [] } : undefined),
      waterfall: async () => [],
    };
    const healthy = await collectInspection(ctx, state);
    assert.equal(healthy.coverage.schedule, 'ok');
  } finally {
    delete process.env.DSHD_SCHEDULE_ENABLED;
  }
});

function fakeRes() {
  const res = {
    status: 0,
    body: '',
    headersSent: false,
    writeHead(code) { res.status = code; res.headersSent = true; },
    end(payload) { res.body = payload || ''; },
    once() {},
    listeners: {},
  };
  return res;
}

test('control route gates on the bearer token and serves ops', async () => {
  const { createControlState } = await load('state.js');
  const { createControlHandler, CONTROL_PREFIX } = await load('http.js');
  const state = createControlState();
  const ctx = { get: () => undefined, emit: () => {} };
  const route = createControlHandler(ctx, state, { token: 'secret' });
  const reqOf = (op, body) => ({
    url: `${CONTROL_PREFIX}/${op}`,
    method: 'POST',
    headers: { authorization: 'Bearer secret' },
    on(event, fn) { if (event === 'end') setImmediate(fn); if (event === 'data') return; },
    // emulate readable: emit 'end' after zero chunks
    [Symbol.asyncIterator]: undefined,
    destroy() {},
    resume() {},
  });
  const unauth = { url: `${CONTROL_PREFIX}/status`, method: 'POST', headers: {} };
  const res1 = fakeRes();
  await route(unauth, res1);
  assert.equal(res1.status, 401);
});

test('gated http handler returns 503 while locked and drains on finish', async () => {
  const { createControlState, admit, acquireLock, releaseLock } = await load('state.js');
  const { wrapWebServer, internals } = await load('wrap.js');
  const state = createControlState();
  const calls = [];
  const webServer = {
    prefixes: new Map(),
    exact: new Map(),
    upgrades: new Map(),
    register(route) {
      (route.kind === 'exact' ? this.exact : this.prefixes).set(route.path, route);
      return () => {};
    },
    registerUpgrade(route) { this.upgrades.set(route.path, route); return () => {}; },
    registerFallback(handler) { this.fallback = handler; return () => {}; },
  };
  assert.equal(wrapWebServer(state, webServer), true);
  // Second wrap is a no-op.
  assert.equal(wrapWebServer(state, webServer), false);
  webServer.register({ kind: 'exact', path: '/api/x', handler: async (_req, res) => res.end('ok') });
  webServer.registerUpgrade({ path: '/ws', handler: () => {} });
  webServer.registerFallback(async (_req, res) => res.end('spa'));

  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);

  const res = fakeRes();
  await webServer.exact.get('/api/x').handler({}, res);
  assert.equal(res.status, 503);
  assert.ok(res.body.includes('dshd/admission-locked'));

  const socket = { written: '', write(s) { socket.written += s; }, destroy() { socket.destroyed = true; }, once() {} };
  webServer.upgrades.get('/ws').handler({ url: '/ws' }, socket, Buffer.alloc(0));
  assert.ok(socket.written.includes('503'));
  assert.equal(socket.destroyed, true);

  // Read fallback stays open — a locked Host must not white-out the window.
  const getRes = fakeRes();
  await webServer.fallback({ method: 'GET' }, getRes);
  assert.equal(getRes.body, 'spa');
  const postRes = fakeRes();
  await webServer.fallback({ method: 'POST' }, postRes);
  assert.equal(postRes.status, 503);

  releaseLock(state, { lockId: acquired.lockId, owner: 'desktop-quit' });
  const ok = fakeRes();
  await webServer.exact.get('/api/x').handler({}, ok);
  assert.equal(ok.body, 'ok');
  assert.ok(calls.length === 0);
});

test('an open upgrade socket does not block drain; new upgrades 503 while locked', async () => {
  const { createControlState, acquireLock } = await load('state.js');
  const { wrapWebServer } = await load('wrap.js');
  const state = createControlState();
  const webServer = {
    upgrades: new Map(),
    register() { return () => {}; },
    registerUpgrade(route) { this.upgrades.set(route.path, route); return () => {}; },
    registerFallback() { return () => {}; },
  };
  wrapWebServer(state, webServer);
  webServer.registerUpgrade({ path: '/api/remote.mux', handler: () => {} });
  // Two long-lived transports stay open for the whole session — they must
  // never land in the drain set, or every protected operation times out.
  const openSocket = () => ({ written: '', write(s) { this.written += s; }, destroy() { this.destroyed = true; }, once() {} });
  webServer.upgrades.get('/api/remote.mux').handler({ url: '/api/remote.mux' }, openSocket(), Buffer.alloc(0));
  webServer.upgrades.get('/api/remote.mux').handler({ url: '/api/remote.mux' }, openSocket(), Buffer.alloc(0));
  assert.equal(state.pending.size, 0);
  const acquired = await acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 500 });
  assert.equal(acquired.ok, true);
  const refused = openSocket();
  webServer.upgrades.get('/api/remote.mux').handler({ url: '/api/remote.mux' }, refused, Buffer.alloc(0));
  assert.ok(refused.written.includes('503'));
  assert.equal(refused.destroyed, true);
});

test('resolveAgent and jobs.start refuse while locked', async () => {
  const { createControlState, acquireLock } = await load('state.js');
  const { wrapSessionController, wrapJobs, AdmissionLockedError } = await load('wrap.js');
  const state = createControlState();
  const controller = { resolveAgent: async (id) => ({ agent: id }) };
  const jobs = { start: () => 'pwsh-1' };
  assert.equal(wrapSessionController(state, controller), true);
  assert.equal(wrapJobs(state, jobs), true);
  const acquired = await acquireLock(state, { owner: 'desktop-quit' });
  assert.equal(acquired.ok, true);
  const resolved = await controller.resolveAgent('s1');
  assert.ok(resolved.error instanceof AdmissionLockedError);
  assert.equal(resolved.error.code, 'session/agent-busy');
  assert.throws(() => jobs.start({}), AdmissionLockedError);
});

test('jobs.start preserves the synchronous id consumed by foreground shell wait', async () => {
  const { createControlState } = await load('state.js');
  const { wrapJobs } = await load('wrap.js');
  const state = createControlState();
  const running = new Map();
  const jobs = {
    start(spec) {
      assert.equal(state.pending.size, 1);
      running.set('pwsh-1', spec);
      return 'pwsh-1';
    },
    wait(id) {
      if (!running.has(id)) throw new Error(`unknown job ${id}`);
      return { id, status: 'completed' };
    },
  };
  wrapJobs(state, jobs);
  const id = jobs.start({ command: 'Get-Location' });
  assert.deepEqual(jobs.wait(id), { id: 'pwsh-1', status: 'completed' });
  assert.equal(state.pending.size, 0);
});

test('jobs.start releases admission on a synchronous producer exception', async () => {
  const { createControlState, acquireLock } = await load('state.js');
  const { wrapJobs } = await load('wrap.js');
  const state = createControlState();
  const failure = new Error('job controller unavailable');
  const jobs = { start() { throw failure; } };
  wrapJobs(state, jobs);
  assert.throws(() => jobs.start({}), error => error === failure);
  assert.equal(state.pending.size, 0);
  assert.equal((await acquireLock(state, { owner: 'desktop-quit', drainTimeoutMs: 20 })).ok, true);
});

function lifecycleWebServer() {
  return {
    prefixes: new Map(), exact: new Map(), upgrades: new Map(), fallback: undefined,
    register(route) {
      const table = route.kind === 'exact' ? this.exact : this.prefixes;
      if (table.has(route.path)) throw new Error('duplicate route');
      table.set(route.path, route);
      return () => table.delete(route.path);
    },
    registerUpgrade(route) {
      if (this.upgrades.has(route.path)) throw new Error('duplicate upgrade');
      this.upgrades.set(route.path, route);
      return () => this.upgrades.delete(route.path);
    },
    registerFallback(handler) {
      if (this.fallback !== undefined) throw new Error('duplicate fallback');
      this.fallback = handler;
      return () => { this.fallback = undefined; };
    },
  };
}

function lifecycleContext(services) {
  const disposers = [];
  const listeners = new Map();
  return {
    get: name => services[name],
    effect(setup) { disposers.push(setup()); },
    on(name, handler) {
      const handlers = listeners.get(name) || new Set();
      listeners.set(name, handlers);
      handlers.add(handler);
      disposers.push(() => handlers.delete(handler));
    },
    emit(name, ...args) {
      for (const handler of listeners.get(name) || []) handler(...args);
    },
    replaceService(name, service) {
      services[name] = service;
      this.emit('internal/service', name);
    },
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}

async function controlReply(webServer, op, body = {}) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]);
  request.method = 'POST';
  request.url = `/dshd-task-control/${op}`;
  request.headers = { authorization: 'Bearer lifecycle-token' };
  const response = fakeRes();
  await webServer.prefixes.get('/dshd-task-control').handler(request, response);
  assert.equal(response.status, 200);
  return JSON.parse(response.body);
}

function withLifecycleToken(t) {
  const previous = process.env.DSHD_TASK_CONTROL_TOKEN;
  process.env.DSHD_TASK_CONTROL_TOKEN = 'lifecycle-token';
  t.after(() => {
    if (previous === undefined) delete process.env.DSHD_TASK_CONTROL_TOKEN;
    else process.env.DSHD_TASK_CONTROL_TOKEN = previous;
  });
}

function upgradeSocket() {
  return {
    written: '', destroyed: false,
    write(value) { this.written += value; },
    destroy() { this.destroyed = true; },
  };
}

test('service replacement registers a fresh control route while preserving the held lock', async (t) => {
  withLifecycleToken(t);
  const { apply } = await load('index.js');
  const first = lifecycleWebServer();
  const ctx = lifecycleContext({ webServer: first });
  t.after(() => ctx.dispose());
  apply(ctx);
  const before = await controlReply(first, 'status');
  const lock = await controlReply(first, 'acquire', { owner: 'replace-test' });
  assert.equal(lock.ok, true);

  const second = lifecycleWebServer();
  second.register({ kind: 'exact', path: '/existing', handler: (_req, res) => res.end('existing') });
  second.registerUpgrade({ path: '/existing-ws', handler: (_req, socket) => socket.write('upgrade-ok') });
  ctx.replaceService('webServer', second);
  // Other service notifications must neither duplicate the row nor reset the lock.
  ctx.replaceService('jobs', { start: () => 'job-1' });
  const after = await controlReply(second, 'status');
  assert.equal(after.hostGeneration, before.hostGeneration);
  assert.equal(after.lock.lockId, lock.lockId);
  const denied = fakeRes();
  await second.exact.get('/existing').handler({ method: 'POST', url: '/existing' }, denied);
  assert.equal(denied.status, 503);
  const refusedSocket = upgradeSocket();
  second.upgrades.get('/existing-ws').handler({ url: '/existing-ws' }, refusedSocket, Buffer.alloc(0));
  assert.ok(refusedSocket.written.includes('503'));
  assert.equal(refusedSocket.destroyed, true);

  assert.equal((await controlReply(second, 'release', { owner: 'replace-test', lockId: lock.lockId })).released, true);
  const allowed = fakeRes();
  await second.exact.get('/existing').handler({ method: 'POST', url: '/existing' }, allowed);
  assert.equal(allowed.body, 'existing');
  ctx.dispose();
  assert.equal(first.prefixes.has('/dshd-task-control'), false);
  assert.equal(second.prefixes.has('/dshd-task-control'), false);
});

test('plugin unload and reload retain later wrappers and gate every entry with fresh state', async (t) => {
  withLifecycleToken(t);
  const { apply } = await load('index.js');
  const { AdmissionLockedError } = await load('wrap.js');
  const server = lifecycleWebServer();
  const route = { kind: 'exact', path: '/ping', handler: (_req, res) => res.end('ping') };
  const upgrade = { path: '/ws', handler: (_req, socket) => socket.write('upgrade-ok') };
  server.register(route);
  server.registerUpgrade(upgrade);
  server.registerFallback((_req, res) => res.end('spa'));
  const controller = { resolveAgent: async id => ({ agent: id }) };
  const jobs = { start: () => 'job-1' };
  const services = { webServer: server, sessionController: controller, jobs };
  const first = lifecycleContext(services);
  const second = lifecycleContext(services);
  t.after(() => { first.dispose(); second.dispose(); });
  apply(first);
  const before = await controlReply(server, 'status');

  const calls = [];
  const retainWrapper = (target, key) => {
    const inner = target[key];
    const later = function (...args) {
      calls.push(key);
      return inner.apply(this, args);
    };
    target[key] = later;
    return later;
  };
  const laterRegister = retainWrapper(server, 'register');
  const laterUpgradeRegister = retainWrapper(server, 'registerUpgrade');
  const laterFallbackRegister = retainWrapper(server, 'registerFallback');
  const laterRoute = retainWrapper(route, 'handler');
  const laterUpgrade = retainWrapper(upgrade, 'handler');
  const laterFallback = retainWrapper(server, 'fallback');
  const laterResolve = retainWrapper(controller, 'resolveAgent');
  const laterStart = retainWrapper(jobs, 'start');
  server.register({ kind: 'exact', path: '/later', handler: (_req, res) => res.end('later') });
  first.dispose();

  assert.equal(server.prefixes.has('/dshd-task-control'), false);
  for (const [target, key, later] of [
    [server, 'register', laterRegister], [server, 'registerUpgrade', laterUpgradeRegister],
    [server, 'registerFallback', laterFallbackRegister], [route, 'handler', laterRoute],
    [upgrade, 'handler', laterUpgrade], [server, 'fallback', laterFallback],
    [controller, 'resolveAgent', laterResolve], [jobs, 'start', laterStart],
  ]) assert.equal(target[key], later);
  const ping = fakeRes();
  await route.handler({ method: 'POST', url: '/ping' }, ping);
  assert.equal(ping.body, 'ping');
  const spa = fakeRes();
  await server.fallback({ method: 'POST', url: '/unmatched' }, spa);
  assert.equal(spa.body, 'spa');
  const socket = upgradeSocket();
  upgrade.handler({ url: '/ws' }, socket, Buffer.alloc(0));
  assert.equal(socket.written, 'upgrade-ok');
  assert.equal(socket.destroyed, false);
  assert.equal(jobs.start({}), 'job-1');
  assert.deepEqual(await controller.resolveAgent('session-1'), { agent: 'session-1' });

  apply(second);
  const after = await controlReply(server, 'status');
  assert.notEqual(after.hostGeneration, before.hostGeneration);
  assert.equal(after.stopping, false);
  server.register({ kind: 'exact', path: '/after-reload', handler: (_req, res) => res.end('fresh') });
  const lock = await controlReply(server, 'acquire', { owner: 'reload-test' });
  assert.equal(lock.ok, true);
  for (const path of ['/ping', '/later', '/after-reload']) {
    const denied = fakeRes();
    await server.exact.get(path).handler({ method: 'POST', url: path }, denied);
    assert.equal(denied.status, 503);
    assert.equal(JSON.parse(denied.body).error.code, 'dshd/admission-locked');
  }
  const deniedFallback = fakeRes();
  await server.fallback({ method: 'POST', url: '/unmatched' }, deniedFallback);
  assert.equal(deniedFallback.status, 503);
  const allowedRead = fakeRes();
  await server.fallback({ method: 'GET', url: '/unmatched' }, allowedRead);
  assert.equal(allowedRead.body, 'spa');
  const refusedSocket = upgradeSocket();
  upgrade.handler({ url: '/ws' }, refusedSocket, Buffer.alloc(0));
  assert.ok(refusedSocket.written.includes('503'));
  assert.equal(refusedSocket.destroyed, true);
  assert.throws(() => jobs.start({}), AdmissionLockedError);
  assert.ok((await controller.resolveAgent('session-1')).error instanceof AdmissionLockedError);
  assert.equal((await controlReply(server, 'release', { owner: 'reload-test', lockId: lock.lockId })).released, true);
  const resumed = fakeRes();
  await route.handler({ method: 'POST', url: '/ping' }, resumed);
  assert.equal(resumed.body, 'ping');
  assert.equal(jobs.start({}), 'job-1');
  assert.deepEqual(await controller.resolveAgent('session-1'), { agent: 'session-1' });
  assert.ok(calls.includes('handler') && calls.includes('fallback') && calls.includes('start') && calls.includes('resolveAgent'));
});

test('unloading task control preserves a later registration at its previous control path', async (t) => {
  withLifecycleToken(t);
  const { apply } = await load('index.js');
  const server = lifecycleWebServer();
  const ctx = lifecycleContext({ webServer: server });
  t.after(() => ctx.dispose());
  apply(ctx);
  server.prefixes.delete('/dshd-task-control');
  const later = { kind: 'prefix', path: '/dshd-task-control', handler: (_req, res) => res.end('later-owner') };
  server.register(later);
  ctx.dispose();
  assert.equal(server.prefixes.get(later.path), later);
  const response = fakeRes();
  await later.handler({ method: 'POST', url: later.path }, response);
  assert.equal(response.body, 'later-owner');
});
