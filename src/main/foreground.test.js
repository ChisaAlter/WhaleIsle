'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createForegroundPolicy } = require('./foreground');

function fixture({ visible = [], focused = null } = {}) {
  const app = new EventEmitter();
  const state = { focused, visible };
  const BrowserWindow = {
    getAllWindows: () => state.visible.map(() => ({ isDestroyed: () => false, isVisible: () => true })),
    getFocusedWindow: () => state.focused,
  };
  const deferred = [];
  const policy = createForegroundPolicy({ app, BrowserWindow, defer: fn => deferred.push(fn) });
  const settle = () => { while (deferred.length) deferred.shift()(); };
  const win = () => {
    const calls = [];
    return { calls, show: () => calls.push('show'), showInactive: () => calls.push('showInactive'), flashFrame: on => calls.push(`flash:${on}`) };
  };
  return { app, state, policy, settle, win };
}

test('a window ready while the user is still with us is activated', () => {
  const f = fixture();
  const main = f.win();
  assert.equal(f.policy.present(main), 'activated');
  assert.deepEqual(main.calls, ['show']);
});

test('a window ready after the user switched apps appears inactive and flashes', () => {
  const f = fixture();
  f.app.emit('browser-window-focus');
  f.state.focused = null;
  f.app.emit('browser-window-blur');
  f.settle();
  const main = f.win();
  assert.equal(f.policy.present(main), 'inactive');
  assert.deepEqual(main.calls, ['showInactive', 'flash:true']);
  f.app.emit('browser-window-focus');
  assert.equal(f.policy.isAway(), false);
});

test('moving focus between our own windows is not leaving', () => {
  const f = fixture();
  f.state.focused = { id: 2 };
  f.app.emit('browser-window-blur');
  f.settle();
  assert.equal(f.policy.isAway(), false);
});

test('a policy created while our visible windows are unfocused starts away', () => {
  const f = fixture({ visible: ['launcher'], focused: null });
  assert.equal(f.policy.isAway(), true);
});

test('background presentation never activates or flashes', () => {
  const f = fixture();
  const main = f.win();
  assert.equal(f.policy.present(main, false), 'inactive');
  assert.deepEqual(main.calls, ['showInactive']);
});
