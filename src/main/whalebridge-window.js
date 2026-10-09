'use strict';

const fs = require('node:fs');
const path = require('node:path');

let window = null;
function openWhaleBridgeWindow(url, { activate = true } = {}) {
  const { BrowserWindow, shell } = require('electron');
  const parsed = new URL(url);
  const origin = parsed.origin;
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1') {
    throw new Error('鲸桥只能打开本机管理界面');
  }
  if (window && !window.isDestroyed()) {
    if (new URL(window.webContents.getURL() || url).origin === origin) {
      if (activate) { window.show(); window.focus(); } else window.showInactive();
      return;
    }
    window.destroy();
  }
  const { assetFile, rendererFile } = require('./paths');
  const nativeMotion = require('./native-window-motion');
  const controlsCss = fs.readFileSync(rendererFile('window-controls.css'), 'utf8')
    + fs.readFileSync(rendererFile('whalebridge-window.css'), 'utf8');
  const controlsScript = fs.readFileSync(rendererFile('window-controls.js'), 'utf8');
  const mountControls = `(() => {
    if (!document.getElementById('whalebridge-window-controls')) {
      const host = document.createElement('div');
      host.id = 'whalebridge-window-controls';
      host.className = 'window-controls';
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', '窗口控制');
      document.body.appendChild(host);
      ${controlsScript}
    }
  })();`;
  const win = new BrowserWindow({
    title: '鲸桥 · WhaleBridge', width: 1120, height: 780, minWidth: 380, minHeight: 520,
    icon: assetFile('icon.ico'), autoHideMenuBar: true, show: false,
    // Same silhouette as the launcher: whalebridge-window.css paints 20px
    // corners on a transparent window; the OS mask would cut them to ~8px.
    frame: false, transparent: true, thickFrame: true, roundedCorners: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'whalebridge.js'),
      additionalArguments: [`--whalebridge-origin=${origin}`],
      nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:whalebridge',
    },
  });
  window = win;
  nativeMotion.enableNativeWindowMotion(win);
  const contents = win.webContents;
  const isOwnedSender = event => !win.isDestroyed()
    && event.sender === contents && event.senderFrame === contents.mainFrame
    && URL.canParse(event.senderFrame.url)
    && new URL(event.senderFrame.url).origin === origin;
  const isMaximized = () => nativeMotion.isNativeWindowMaximized(win) ?? win.isMaximized();
  const windowState = () => ({ maximized: isMaximized(), minimizable: win.minimizable, maximizable: win.maximizable });
  contents.ipc.on('whalebridge:window', (event, action) => {
    if (!isOwnedSender(event)) return;
    if (action === 'close') { win.close(); return; }
    if (!['minimize', 'maximize'].includes(action)) return;
    // Native caption hit-testing must finish before changing the window state.
    setImmediate(() => {
      if (win.isDestroyed()) return;
      if (action === 'minimize' && win.minimizable) win.minimize();
      if (action === 'maximize' && win.maximizable && !nativeMotion.toggleNativeMaximize(win)) {
        if (win.isMaximized()) win.unmaximize(); else win.maximize();
      }
    });
  });
  contents.ipc.handle('whalebridge:window-state', event => {
    if (!isOwnedSender(event)) throw new Error('Unauthorized WhaleBridge window sender');
    return windowState();
  });
  const sendState = () => contents.send('whalebridge:window-state', windowState());
  let lastMaximized;
  const syncState = () => {
    if (win.isDestroyed() || isMaximized() === lastMaximized) return;
    lastMaximized = isMaximized();
    sendState();
  };
  win.on('maximize', syncState);
  win.on('unmaximize', syncState);
  win.on('resize', syncState);
  contents.on('dom-ready', () => {
    if (win.isDestroyed() || new URL(contents.getURL()).origin !== origin) return;
    void contents.insertCSS(controlsCss).then(() => {
      if (!win.isDestroyed() && new URL(contents.getURL()).origin === origin) {
        return contents.executeJavaScript(mountControls);
      }
    }).catch(error => console.error('[whalebridge] Failed to mount window controls:', error.message));
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  const guardNavigation = (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  };
  contents.on('will-navigate', guardNavigation);
  contents.on('will-redirect', guardNavigation);
  win.once('ready-to-show', () => activate ? win.show() : win.showInactive());
  win.once('closed', () => {
    if (window === win) window = null;
  });
  void win.loadURL(url);
}
function closeWhaleBridgeWindow() {
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
}
module.exports = { openWhaleBridgeWindow, closeWhaleBridgeWindow };
