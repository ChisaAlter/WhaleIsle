'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');

test('openWelcomeWindow destroys any prior active welcome window and removes its handlers', async (t) => {
  const electronPath = require.resolve('electron');
  const prevElectron = require.cache[electronPath];
  const welcomePath = require.resolve('./welcome-window');
  const prevWelcome = require.cache[welcomePath];

  const created = [];
  const handlers = new Map();
  const removedHandlers = [];
  const removedListeners = [];

  class FakeWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.destroyed = false;
      this.destroyCalls = 0;
      this.webContents = { mainFrame: { id: created.length + 1 }, setWindowOpenHandler() {}, on() {} };
      created.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyCalls++; this.destroyed = true; this.emit('closed'); }
    loadFile() { return Promise.resolve(); }
    show() {}
    focus() {}
  }

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserWindow: FakeWindow,
      ipcMain: {
        handle(ch, fn) { handlers.set(ch, fn); },
        removeHandler(ch) { removedHandlers.push(ch); handlers.delete(ch); },
        on() {},
        removeAllListeners(ch) { removedListeners.push(ch); },
      },
    },
  };
  delete require.cache[welcomePath];
  t.after(() => {
    if (prevElectron) require.cache[electronPath] = prevElectron;
    else delete require.cache[electronPath];
    if (prevWelcome) require.cache[welcomePath] = prevWelcome;
    else delete require.cache[welcomePath];
  });

  const { openWelcomeWindow } = require(path.join(__dirname, 'welcome-window.js'));
  const locale = { id: 'zh-CN', messages: {} };
  const ops = {
    takeNotice: async () => null,
    startSignIn: async () => ({}),
    cancelSignIn: async () => {},
    copySignInLink: async () => {},
    saveApiKey: async () => ({ ok: true }),
    skip: async () => {},
  };

  await openWelcomeWindow(locale, ops);
  assert.equal(created.length, 1);
  assert.equal(created[0].destroyed, false);

  await openWelcomeWindow(locale, ops);
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyCalls, 1, 'prior welcome window must be destroyed on reopen');
  assert.equal(created[0].destroyed, true);
  assert.equal(created[1].destroyed, false);
  assert.ok(removedHandlers.length > 0);
  assert.ok(removedListeners.length > 0);
});
