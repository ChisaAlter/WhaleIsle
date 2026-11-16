'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { IPC_ROLES, assertIpcSender } = require('./ipc-authorization');
const { createRegisterIpc, noArgs, unauthorizedError } = require('./ipc-register');

function fakeIpc() {
  const handlers = new Map();
  const listeners = new Map();
  return {
    handlers,
    listeners,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { listeners.set(channel, fn); },
  };
}

// Contract rows in the shape of src/shared/ipc-contract.js, injected so the
// wrapper tests stay independent of the real registry (#436).
function contract(rows) {
  return rows.map((row) => ({ ...row }));
}

function surfaces() {
  const contents = (url) => ({ mainFrame: { url }, isDestroyed: () => false });
  return {
    surfaces: {
      boot: contents('file:///boot.html'),
      harness: contents('http://127.0.0.1:3080/chat'),
      harnessOrigin: 'http://127.0.0.1:3080',
      launcher: contents('file:///launcher.html'),
    },
    isBootUrl: (url) => url === 'file:///boot.html',
    isHarnessUrl: (url, origin) => new URL(url).origin === origin,
    isLauncherUrl: (url) => url === 'file:///launcher.html',
  };
}

function harnessEvent() {
  const policy = surfaces();
  return {
    sender: policy.surfaces.harness,
    senderFrame: policy.surfaces.harness.mainFrame,
    policy,
  };
}

test('invoke channels authorize the sender once before the handler', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:echo', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: (args, auth) => [auth, ...args] },
  ]));
  const seen = [];
  register({
    channel: 'test:echo',
    authorize(event) {
      seen.push(event);
      return 'role-token';
    },
    handler: (event, auth, value) => ({ event, auth, value }),
  });
  const handler = ipc.handlers.get('test:echo');
  const event = { sender: {} };
  assert.deepEqual(await handler(event, 42), { event, auth: 'role-token', value: 42 });
  assert.equal(seen.length, 1);
});

test('invoke channels reject unauthorized senders and invalid arguments', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:guarded', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: noArgs },
    { channel: 'test:strict', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned',
      validate(args) {
        const [value] = args;
        if (typeof value !== 'string') throw new Error('value must be a string');
        return [value.trim()];
      } },
  ]));
  register({
    channel: 'test:guarded',
    authorize: () => { throw unauthorizedError(); },
    handler: () => assert.fail('unauthorized calls must not reach the handler'),
  });
  // The captured handle function throws synchronously in this seam (Electron
  // turns the same throw into an invoke rejection).
  assert.throws(() => ipc.handlers.get('test:guarded')({}), { code: 'ERR_DSH_IPC_SENDER' });

  register({
    channel: 'test:strict',
    authorize: () => {},
    handler: (_event, value) => value,
  });
  const strict = ipc.handlers.get('test:strict');
  assert.equal(await strict({}, '  ok  '), 'ok');
  assert.throws(() => strict({}, 7), /value must be a string/);
  assert.throws(() => strict({}), /value must be a string/);
});

test('contract roles + senderOptions reach assertIpcSender', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:roles', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      validate: (args, role) => [role] },
    { channel: 'test:wrong-role', kind: 'invoke', roles: [IPC_ROLES.LAUNCHER], validate: noArgs },
  ]));
  const { policy, ...event } = harnessEvent();
  register({
    channel: 'test:roles',
    senderOptions: policy,
    handler: (_event, role) => role,
  });
  assert.equal(await ipc.handlers.get('test:roles')(event), IPC_ROLES.HARNESS);

  register({
    channel: 'test:wrong-role',
    senderOptions: policy,
    handler: () => true,
  });
  assert.throws(() => ipc.handlers.get('test:wrong-role')(event), { code: 'ERR_DSH_IPC_SENDER' });

  // The folded role matches what a direct assertIpcSender call computes.
  assert.equal(assertIpcSender(event, [IPC_ROLES.HARNESS], policy), IPC_ROLES.HARNESS);
});

test('send channels mount ipcMain.on and drop unauthorized messages', (t) => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:event', kind: 'send', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: noArgs },
    { channel: 'test:event2', kind: 'send', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned',
      validate(args) {
        if (args.length !== 0) throw new Error('unexpected arguments');
        return [];
      } },
    { channel: 'test:event3', kind: 'send', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: noArgs },
  ]));
  const warned = [];
  t.mock.method(console, 'warn', (...args) => warned.push(args));
  let ran = 0;
  register({
    channel: 'test:event',
    authorize: () => { throw unauthorizedError(); },
    handler: () => { ran += 1; },
  });
  const listener = ipc.listeners.get('test:event');
  assert.equal(typeof listener, 'function');
  assert.doesNotThrow(() => listener({}));
  assert.equal(ran, 0);
  assert.equal(warned.length, 1);

  register({
    channel: 'test:event2',
    authorize: () => {},
    handler: () => { ran += 1; },
  });
  const ok = ipc.listeners.get('test:event2');
  ok({});
  assert.equal(ran, 1);
  // A malformed message is dropped and logged, never reaches the handler.
  assert.doesNotThrow(() => ok({}, 'extra'));
  assert.equal(ran, 1);
  assert.equal(warned.length, 2);
  // noArgs still normalizes stray payloads away instead of rejecting.
  register({
    channel: 'test:event3',
    authorize: () => {},
    handler: () => { ran += 1; },
  });
  ipc.listeners.get('test:event3')({}, 'ignored');
  assert.equal(ran, 2);
  assert.equal(warned.length, 2);
});

test('send channels swallow async handler rejections as warnings', async (t) => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:async', kind: 'send', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: noArgs },
  ]));
  const warned = [];
  t.mock.method(console, 'warn', (...args) => warned.push(args));
  register({
    channel: 'test:async',
    authorize: () => {},
    handler: () => Promise.reject(new Error('late failure')),
  });
  ipc.listeners.get('test:async')({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warned.length, 1);
});

test('registration rejects inline kind/roles/validate and unknown channels', () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:known', kind: 'invoke', roles: [IPC_ROLES.HARNESS], validate: noArgs },
    { channel: 'test:event-only', kind: 'event', roles: [IPC_ROLES.HARNESS] },
    { channel: 'test:pending', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      validate: noArgs, pending: true },
  ]));
  assert.throws(
    () => register({ channel: 'test:known', kind: 'handle', handler: () => {} }),
    /declared in src\/shared\/ipc-contract/,
  );
  assert.throws(
    () => register({ channel: 'test:known', roles: [IPC_ROLES.HARNESS], handler: () => {} }),
    /declared in src\/shared\/ipc-contract/,
  );
  assert.throws(
    () => register({ channel: 'test:known', validate: noArgs, handler: () => {} }),
    /declared in src\/shared\/ipc-contract/,
  );
  // Event rows and pending rows are not mountable incoming channels.
  assert.throws(
    () => register({ channel: 'test:event-only', handler: () => {} }),
    /not declared in src\/shared\/ipc-contract/,
  );
  assert.throws(
    () => register({ channel: 'test:pending', handler: () => {} }),
    /not declared in src\/shared\/ipc-contract/,
  );
  assert.throws(
    () => register({ channel: 'test:missing', handler: () => {} }),
    /not declared in src\/shared\/ipc-contract/,
  );
});

test('channel-owned authorize is required exactly when the contract asks', () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'test:owned', kind: 'invoke', roles: [IPC_ROLES.HARNESS],
      authorize: 'channel-owned', validate: noArgs },
    { channel: 'test:role-auth', kind: 'invoke', roles: [IPC_ROLES.HARNESS], validate: noArgs },
  ]));
  assert.throws(
    () => register({ channel: 'test:owned', handler: () => {} }),
    /requires the module-owned authorize/,
  );
  assert.throws(
    () => register({ channel: 'test:role-auth', authorize: () => {}, handler: () => {} }),
    /call-site authorize is not allowed/,
  );
});

test('registration refuses channels without validate or handler', () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc, contract([
    { channel: 'x', kind: 'invoke', roles: [IPC_ROLES.HARNESS] },
    { channel: 'y', kind: 'invoke', roles: [IPC_ROLES.HARNESS], validate: noArgs },
  ]));
  assert.throws(() => register({ channel: 'x', handler: () => {} }), /validate and handler/);
  assert.throws(() => register({ channel: 'y' }), /handler function/);
  assert.throws(() => register({ handler: () => {} }), /channel name/);
});

test('noArgs normalizes every call to zero handler arguments', () => {
  assert.deepEqual(noArgs([]), []);
  assert.deepEqual(noArgs([1, 'x', {}]), []);
});
