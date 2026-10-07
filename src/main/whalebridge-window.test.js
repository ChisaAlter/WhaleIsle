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
      this.minimizable = true;
      this.maximizable = true;
      this.maximized = false;
      this.webContents = new EventEmitter();
      this.webContents.getURL = () => this.url || '';
      this.webContents.mainFrame = { url: '' };
      this.webContents.ipc = new EventEmitter();
      this.webContents.ipc.handlers = new Map();
      this.webContents.ipc.handle = (channel, callback) => this.webContents.ipc.handlers.set(channel, callback);
      this.webContents.setWindowOpenHandler = callback => { this.webContents.windowOpenHandler = callback; };
      this.webContents.send = (channel, state) => this.calls.push({ channel, state });
      this.webContents.insertCSS = css => { this.css = css; return Promise.resolve(); };
      this.webContents.executeJavaScript = script => { this.script = script; return Promise.resolve(); };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { this.calls.push('close'); this.destroyed = true; this.emit('closed'); }
    minimize() { this.calls.push('minimize'); }
    maximize() { this.calls.push('maximize'); this.maximized = true; this.emit('maximize'); }
    unmaximize() { this.calls.push('unmaximize'); this.maximized = false; this.emit('unmaximize'); }
    isMaximized() { return this.maximized; }
    show() { this.calls.push('show'); }
    showInactive() { this.calls.push('showInactive'); }
    focus() { this.calls.push('focus'); }
    setBackgroundColor() {}
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
  }
  const openedExternal = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'whalebridge-window.js'), 'utf8'), {
    module, URL, __dirname, console, setImmediate,
    require(name) {
      if (name === 'electron') return { BrowserWindow, nativeTheme, shell: { openExternal: url => openedExternal.push(url) } };
      if (name === './paths') return {
        assetFile: name => path.join('assets', name),
        rendererFile: name => path.join(__dirname, '..', 'renderer', name),
      };
      if (name === './native-window-motion') return {
        enableNativeWindowMotion: win => { win.nativeMotion = true; return true; },
        isNativeWindowMaximized: () => undefined,
        toggleNativeMaximize: () => false,
      };
      if (name === 'node:fs' || name === 'node:path') return require(name);
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { ...module.exports, windows, nativeTheme, openedExternal };
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
    'file://127.0.0.1/settings',
  ]) {
    assert.throws(() => openWhaleBridgeWindow(url, { activate: false }));
  }
  assert.equal(windows.length, 0);
});

test('WhaleBridge mounts the same controls stylesheet and script as the desktop shells', async () => {
  const { openWhaleBridgeWindow, windows } = fixture();
  openWhaleBridgeWindow('http://127.0.0.1:19198/?k=fixture', { activate: false });
  const win = windows[0];
  assert.equal(win.options.frame, false);
  assert.equal(win.options.titleBarOverlay, undefined);
  // Launcher silhouette: transparent page-drawn corners plus native window motion.
  assert.equal(win.options.transparent, true);
  assert.equal(win.options.roundedCorners, false);
  assert.equal(win.options.backgroundColor, '#00000000');
  assert.equal(win.nativeMotion, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.contextIsolation, true);
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.preload, path.join(__dirname, '..', 'preload', 'whalebridge.js'));
  assert.deepEqual(Array.from(win.options.webPreferences.additionalArguments), ['--whalebridge-origin=http://127.0.0.1:19198']);
  win.webContents.emit('dom-ready');
  await new Promise(resolve => setImmediate(resolve));
  const renderer = name => fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
  assert.equal(win.css, renderer('window-controls.css') + renderer('whalebridge-window.css'));
  assert.ok(win.script.includes(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'window-controls.js'), 'utf8')));
  assert.match(win.script, /host.className = 'window-controls'/);
  assert.deepEqual(win.calls, [], 'mounting controls never shows or focuses a window');
});

test('window actions remain scoped to the owned main frame and synchronize maximize/restore', async () => {
  const { openWhaleBridgeWindow, windows, nativeTheme } = fixture();
  openWhaleBridgeWindow('http://127.0.0.1:19198/', { activate: false });
  const win = windows[0];
  const ipc = win.webContents.ipc;
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  const readState = ipc.handlers.get('whalebridge:window-state');
  assert.equal(readState(event).maximized, false);
  ipc.emit('whalebridge:window', event, 'maximize');
  assert.deepEqual(win.calls, [], 'state changes wait until native caption hit-testing completes');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readState(event).maximized, true);
  assert.equal(win.calls[0], 'maximize');
  assert.equal(win.calls[1].channel, 'whalebridge:window-state');
  assert.equal(win.calls[1].state.maximized, true);
  ipc.emit('whalebridge:window', event, 'maximize');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readState(event).maximized, false);
  assert.equal(win.calls[2], 'unmaximize');
  assert.equal(win.calls[3].state.maximized, false);
  ipc.emit('whalebridge:window', event, 'minimize');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(win.calls.at(-1), 'minimize');
  assert.equal(win.calls.includes('show'), false);
  assert.equal(win.calls.includes('focus'), false);

  win.minimizable = false;
  win.maximizable = false;
  const calls = win.calls.length;
  for (const action of ['minimize', 'maximize', 'open-launcher', 'restart']) ipc.emit('whalebridge:window', event, action);
  for (const wrongEvent of [
    { sender: new EventEmitter(), senderFrame: win.webContents.mainFrame },
    { sender: win.webContents, senderFrame: { url: 'http://127.0.0.1:19198/' } },
    { sender: win.webContents, senderFrame: null },
  ]) {
    ipc.emit('whalebridge:window', wrongEvent, 'close');
    assert.throws(() => readState(wrongEvent), /Unauthorized/);
  }
  win.webContents.mainFrame.url = 'http://127.0.0.1:19199/';
  ipc.emit('whalebridge:window', event, 'close');
  assert.throws(() => readState(event), /Unauthorized/);
  win.webContents.mainFrame.url = 'not a URL';
  ipc.emit('whalebridge:window', event, 'close');
  assert.throws(() => readState(event), /Unauthorized/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(win.calls.length, calls);

  win.webContents.mainFrame.url = 'http://127.0.0.1:19198/';
  ipc.emit('whalebridge:window', event, 'close');
  assert.equal(win.calls.at(-1), 'close', 'the close control uses the normal native close lifecycle');
  assert.equal(nativeTheme.listenerCount('updated'), 0);
  openWhaleBridgeWindow('http://127.0.0.1:19198/', { activate: false });
  assert.equal(windows.length, 2, 'closing releases the managed singleton');
  ipc.emit('whalebridge:window', event, 'close');
  assert.equal(windows[1].destroyed, false, 'a closed window cannot control its replacement');
});

test('same-origin management navigation works while external navigation and redirects stay outside the shell', () => {
  const { openWhaleBridgeWindow, windows, openedExternal } = fixture();
  openWhaleBridgeWindow('http://127.0.0.1:19198/');
  const contents = windows[0].webContents;
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  contents.emit('will-navigate', event, 'http://127.0.0.1:19198/accounts');
  contents.emit('will-redirect', event, 'http://127.0.0.1:19198/?k=fixture');
  assert.equal(prevented, 0);
  contents.emit('will-navigate', event, 'https://login.example/');
  contents.emit('will-redirect', event, 'https://redirect.example/');
  contents.emit('will-redirect', event, 'file:///secret');
  assert.equal(prevented, 3);
  assert.deepEqual(openedExternal, ['https://login.example/', 'https://redirect.example/']);
});

test('the isolated preload exposes only three window methods to the exact management origin and main frame', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload', 'whalebridge.js'), 'utf8');
  const run = ({ origin = 'http://127.0.0.1:19198', main = true, argument = '--whalebridge-origin=http://127.0.0.1:19198' } = {}) => {
    const ipcRenderer = new EventEmitter();
    const calls = [];
    ipcRenderer.send = (...args) => calls.push(args);
    ipcRenderer.invoke = (...args) => { calls.push(args); return Promise.resolve({ maximized: false }); };
    let exposed;
    vm.runInNewContext(source, {
      process: { argv: [argument], isMainFrame: main },
      location: { origin },
      require: name => {
        assert.equal(name, 'electron');
        return { ipcRenderer, contextBridge: { exposeInMainWorld: (name, api) => { exposed = { name, api }; } } };
      },
    });
    return { exposed, calls, ipcRenderer };
  };
  for (const options of [{ origin: 'http://127.0.0.1:19199' }, { main: false }, { argument: '' }]) {
    assert.equal(run(options).exposed, undefined);
  }
  const { exposed, calls, ipcRenderer } = run();
  assert.equal(exposed.name, 'shell');
  assert.deepEqual(Object.keys(exposed.api), ['windowAction', 'getWindowState', 'onWindowState']);
  exposed.api.windowAction('minimize');
  exposed.api.getWindowState();
  assert.deepEqual(calls, [['whalebridge:window', 'minimize'], ['whalebridge:window-state']]);
  let state;
  const unsubscribe = exposed.api.onWindowState(next => { state = next; });
  ipcRenderer.emit('whalebridge:window-state', {}, { maximized: true });
  assert.deepEqual(state, { maximized: true });
  unsubscribe();
  assert.equal(ipcRenderer.listenerCount('whalebridge:window-state'), 0);
});
