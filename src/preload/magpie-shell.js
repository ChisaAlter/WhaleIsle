'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('shell', {
    platform: process.platform,
    windowAction: (/** @type {unknown} */ action) => ipcRenderer.send('magpie:window', action),
    getWindowState: () => ipcRenderer.invoke('magpie:window-state'),
    onWindowState: (/** @type {(state: unknown) => void} */ listener) => {
      const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ state) => listener(state);
      ipcRenderer.on('magpie:window-state', receive);
      return () => ipcRenderer.removeListener('magpie:window-state', receive);
    },
    getMeta: () => ipcRenderer.invoke('magpie:shell-meta'),
    onMeta: (/** @type {(meta: unknown) => void} */ listener) => {
      const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ meta) => listener(meta);
      ipcRenderer.on('magpie:shell-meta', receive);
      return () => ipcRenderer.removeListener('magpie:shell-meta', receive);
    },
    reloadPage: () => ipcRenderer.send('magpie:reload'),
    openExternalUpdate: () => ipcRenderer.invoke('magpie:open-external-update'),
  });
}
