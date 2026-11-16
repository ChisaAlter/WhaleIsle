'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const { createLauncherConfirm, CONFIRM_EVENT, RESPONSE_CHANNEL } = require('./launcher-confirm');
const { IPC_ROLES } = require('../main/ipc-authorization');
const { IPC_CONTRACT } = require('../shared/ipc-contract');

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeWindow() {
  const contents = new EventEmitter();
  contents.sent = [];
  contents.send = (channel, payload) => {
    contents.sent.push({ channel, payload });
  };
  contents.isDestroyed = () => false;
  return { isDestroyed: () => false, webContents: contents };
}

test('ask sends the confirm payload to the launcher window and resolves the answer', async () => {
  const win = fakeWindow();
  const bridge = createLauncherConfirm({ getWindow: () => win });
  const waiting = bridge.ask({ title: '发现新版本', body: '是否更新到 1.2.3？', confirmText: '更新' });
  await tick();
  assert.equal(win.webContents.sent.length, 1);
  const sent = win.webContents.sent[0];
  assert.equal(sent.channel, CONFIRM_EVENT);
  assert.equal(sent.payload.title, '发现新版本');
  assert.equal(sent.payload.confirmText, '更新');
  assert.equal(sent.payload.danger, false);
  assert.equal(bridge.respond({ id: sent.payload.id, ok: true }), true);
  assert.equal(await waiting, true);
});

test('ask resolves null when no launcher window exists so callers can fall back', async () => {
  const bridge = createLauncherConfirm({ getWindow: () => null });
  assert.equal(await bridge.ask({ title: 't' }), null);
});

test('ask resolves null when the webContents is destroyed before send', async () => {
  const win = fakeWindow();
  win.webContents.isDestroyed = () => true;
  const bridge = createLauncherConfirm({ getWindow: () => win });
  assert.equal(await bridge.ask({ title: 't' }), null);
  assert.equal(win.webContents.sent.length, 0);
});

test('a destroyed webContents mid-ask resolves null instead of hanging', async () => {
  const win = fakeWindow();
  const bridge = createLauncherConfirm({ getWindow: () => win });
  const waiting = bridge.ask({ title: 't' });
  await tick();
  win.webContents.emit('destroyed');
  assert.equal(await waiting, null);
});

test('respond ignores unknown and malformed ids', async () => {
  const bridge = createLauncherConfirm({ getWindow: () => null });
  assert.equal(bridge.respond(null), false);
  assert.equal(bridge.respond({}), false);
  assert.equal(bridge.respond({ id: 'lc999', ok: true }), false);
});

test('asks serialize so the shared modal never races two confirms', async () => {
  const win = fakeWindow();
  const bridge = createLauncherConfirm({ getWindow: () => win });
  const first = bridge.ask({ title: 'first' });
  await tick();
  const second = bridge.ask({ title: 'second' });
  await tick();
  assert.equal(win.webContents.sent.length, 1, 'second ask must wait for the first to settle');
  const firstId = win.webContents.sent[0].payload.id;
  bridge.respond({ id: firstId, ok: false });
  assert.equal(await first, false);
  await tick();
  assert.equal(win.webContents.sent.length, 2);
  const secondId = win.webContents.sent[1].payload.id;
  assert.notEqual(secondId, firstId);
  bridge.respond({ id: secondId, ok: true });
  assert.equal(await second, true);
});

test('register mounts the response channel through the lane ctx handle', () => {
  const bridge = createLauncherConfirm({ getWindow: () => null });
  const mounted = [];
  bridge.register({
    handle: (channel, listener) => mounted.push({ channel, listener }),
    LAUNCHER_ONLY: ['launcher'],
  });
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].channel, RESPONSE_CHANNEL);
  // Roles and argument validation are contract-owned (#436): the lane only
  // mounts channel + listener, so assert both against the contract row.
  const entry = IPC_CONTRACT.find((row) => row.channel === RESPONSE_CHANNEL && row.kind === 'invoke');
  assert.deepEqual(entry.roles, [IPC_ROLES.LAUNCHER]);
  const args = entry.validate([{ id: 'lc1', ok: true }]);
  assert.equal(mounted[0].listener(null, ...args), false, 'unmatched response must not throw');
});
