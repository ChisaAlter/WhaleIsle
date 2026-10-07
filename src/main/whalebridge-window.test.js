'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function fixture() {
  const windows = [];
  const nativeTheme = new EventEmitter();
  nativeTheme.shouldUseDarkColors = false;
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.calls = [];
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.getURL = () => this.url || '';
      this.webContents.setWindowOpenHandler = () => {};
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() { this.calls.push('show'); }
    showInactive() { this.calls.push('showInactive'); }
    focus() { this.calls.push('focus'); }
    setBackgroundColor() {}
    setTitleBarOverlay() {}
    loadURL(url) { this.url = url; return Promise.resolve(); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'whalebridge-window.js'), 'utf8'), {
    module, URL, process: { platform: 'win32' },
    require(name) {
      if (name === 'electron') return { BrowserWindow, nativeTheme, shell: { openExternal() {} } };
      if (name === './paths') return { assetFile: name => path.join('assets', name) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { ...module.exports, windows };
}

test('normal WhaleBridge opens still show the window and focus same-origin reuse', () => {
  const { openWhaleBridgeWindow, windows } = fixture();
  const url = 'http://127.0.0.1:19198/';
  openWhaleBridgeWindow(url);
  const win = windows[0];
  assert.equal(win.options.show, false);
  assert.deepEqual(win.calls, []);
  win.emit('ready-to-show');
  assert.deepEqual(win.calls, ['show']);

  openWhaleBridgeWindow(`${url}accounts`);
  assert.equal(windows.length, 1);
  assert.deepEqual(win.calls, ['show', 'show', 'focus']);
});

test('inactive new, reused and replacement windows never call show or focus', () => {
  const { openWhaleBridgeWindow, windows } = fixture();
  const url = 'http://127.0.0.1:19198/';
  openWhaleBridgeWindow(url, { activate: false });
  const win = windows[0];
  assert.equal(win.options.show, false);
  assert.deepEqual(win.calls, []);
  win.emit('ready-to-show');
  assert.deepEqual(win.calls, ['showInactive']);

  openWhaleBridgeWindow(`${url}accounts`, { activate: false });
  assert.equal(windows.length, 1);
  assert.deepEqual(win.calls, ['showInactive', 'showInactive']);

  openWhaleBridgeWindow('http://127.0.0.1:19199/', { activate: false });
  assert.equal(win.destroyed, true);
  assert.equal(windows.length, 2);
  windows[1].emit('ready-to-show');
  assert.deepEqual(windows[1].calls, ['showInactive']);

  openWhaleBridgeWindow('http://127.0.0.1:19199/', { activate: true });
  assert.equal(windows.length, 2);
  assert.deepEqual(windows[1].calls, ['showInactive', 'show', 'focus']);
});

test('inactive opening retains the exact 127.0.0.1 host restriction', () => {
  const { openWhaleBridgeWindow, windows } = fixture();
  for (const url of [
    'http://localhost:19198/',
    'http://example.com/',
    'http://127.0.0.1.example.com/',
    'http://127.0.0.1@example.com/',
  ]) {
    assert.throws(() => openWhaleBridgeWindow(url, { activate: false }));
  }
  assert.equal(windows.length, 0);
});
