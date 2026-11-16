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

test('handle channels authorize the sender once before the handler', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  const seen = [];
  register({
    channel: 'test:echo',
    authorize(event) {
      seen.push(event);
      return 'role-token';
    },
    validate: (args, auth) => [auth, ...args],
    handler: (event, auth, value) => ({ event, auth, value }),
  });
  const handler = ipc.handlers.get('test:echo');
  const event = { sender: {} };
  assert.deepEqual(await handler(event, 42), { event, auth: 'role-token', value: 42 });
  assert.equal(seen.length, 1);
});

test('handle channels reject unauthorized senders and invalid arguments', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  register({
    channel: 'test:guarded',
    authorize: () => { throw unauthorizedError(); },
    validate: noArgs,
    handler: () => assert.fail('unauthorized calls must not reach the handler'),
  });
  // The captured handle function throws synchronously in this seam (Electron
  // turns the same throw into an invoke rejection).
  assert.throws(() => ipc.handlers.get('test:guarded')({}), { code: 'ERR_DSH_IPC_SENDER' });

  register({
    channel: 'test:strict',
    authorize: () => {},
    validate(args) {
      const [value] = args;
      if (typeof value !== 'string') throw new Error('value must be a string');
      return [value.trim()];
    },
    handler: (_event, value) => value,
  });
  const strict = ipc.handlers.get('test:strict');
  assert.equal(await strict({}, '  ok  '), 'ok');
  assert.throws(() => strict({}, 7), /value must be a string/);
  assert.throws(() => strict({}), /value must be a string/);
});

test('roles + senderOptions reach assertIpcSender', async () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  const { policy, ...event } = harnessEvent();
  register({
    channel: 'test:roles',
    roles: [IPC_ROLES.HARNESS],
    senderOptions: policy,
    validate: (args, role) => [role],
    handler: (_event, role) => role,
  });
  assert.equal(await ipc.handlers.get('test:roles')(event), IPC_ROLES.HARNESS);

  register({
    channel: 'test:wrong-role',
    roles: [IPC_ROLES.LAUNCHER],
    senderOptions: policy,
    validate: noArgs,
    handler: () => true,
  });
  assert.throws(() => ipc.handlers.get('test:wrong-role')(event), { code: 'ERR_DSH_IPC_SENDER' });

  // The folded role matches what a direct assertIpcSender call computes.
  assert.equal(assertIpcSender(event, [IPC_ROLES.HARNESS], policy), IPC_ROLES.HARNESS);
});

test('on channels drop unauthorized or malformed messages with a warning', (t) => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  const warned = [];
  t.mock.method(console, 'warn', (...args) => warned.push(args));
  let ran = 0;
  register({
    kind: 'on',
    channel: 'test:event',
    authorize: () => { throw unauthorizedError(); },
    validate: noArgs,
    handler: () => { ran += 1; },
  });
  const listener = ipc.listeners.get('test:event');
  assert.equal(typeof listener, 'function');
  assert.doesNotThrow(() => listener({}));
  assert.equal(ran, 0);
  assert.equal(warned.length, 1);

  register({
    kind: 'on',
    channel: 'test:event2',
    authorize: () => {},
    validate(args) {
      if (args.length !== 0) throw new Error('unexpected arguments');
      return [];
    },
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
    kind: 'on',
    channel: 'test:event3',
    authorize: () => {},
    validate: noArgs,
    handler: () => { ran += 1; },
  });
  ipc.listeners.get('test:event3')({}, 'ignored');
  assert.equal(ran, 2);
  assert.equal(warned.length, 2);
});

test('on channels swallow async handler rejections as warnings', async (t) => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  const warned = [];
  t.mock.method(console, 'warn', (...args) => warned.push(args));
  register({
    kind: 'on',
    channel: 'test:async',
    authorize: () => {},
    validate: noArgs,
    handler: () => Promise.reject(new Error('late failure')),
  });
  ipc.listeners.get('test:async')({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warned.length, 1);
});

test('registration refuses channels without validate or handler', () => {
  const ipc = fakeIpc();
  const register = createRegisterIpc(ipc);
  assert.throws(() => register({ channel: 'x', authorize: () => {}, handler: () => {} }), /validate and handler/);
  assert.throws(() => register({ channel: 'x', authorize: () => {}, validate: noArgs }), /validate and handler/);
  assert.throws(() => register({ authorize: () => {}, validate: noArgs, handler: () => {} }), /channel name/);
});

test('noArgs normalizes every call to zero handler arguments', () => {
  assert.deepEqual(noArgs([]), []);
  assert.deepEqual(noArgs([1, 'x', {}]), []);
});
