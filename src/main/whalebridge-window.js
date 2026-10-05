'use strict';

let window = null;
function openWhaleBridgeWindow(url) {
  const { BrowserWindow, shell } = require('electron');
  const origin = new URL(url).origin;
  if (new URL(origin).hostname !== '127.0.0.1') throw new Error('鲸桥只能打开本机管理界面');
  if (window && !window.isDestroyed()) {
    if (new URL(window.webContents.getURL() || url).origin === origin) { window.show(); window.focus(); return; }
    window.destroy();
  }
  const { assetFile } = require('./paths');
  const win = new BrowserWindow({
    title: '鲸桥 · WhaleBridge', width: 1120, height: 780, minWidth: 380, minHeight: 520,
    icon: assetFile('icon.ico'), autoHideMenuBar: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:whalebridge' },
  });
  window = win;
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    }
  });
  win.once('ready-to-show', () => win.show());
  win.once('closed', () => { if (window === win) window = null; });
  void win.loadURL(url);
}
function closeWhaleBridgeWindow() {
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
}
module.exports = { openWhaleBridgeWindow, closeWhaleBridgeWindow };
