'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const prefix = '--whalebridge-origin=';
const origin = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);

if (process.isMainFrame && origin && location.origin === origin) {
  contextBridge.exposeInMainWorld('shell', {
    windowAction: (/** @type {unknown} */ action) => ipcRenderer.send('whalebridge:window', action),
    getWindowState: () => ipcRenderer.invoke('whalebridge:window-state'),
    onWindowState: (/** @type {(state: unknown) => void} */ listener) => {
      const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ state) => listener(state);
      ipcRenderer.on('whalebridge:window-state', receive);
      return () => ipcRenderer.removeListener('whalebridge:window-state', receive);
    },
  });
}
