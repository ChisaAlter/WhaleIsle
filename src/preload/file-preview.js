'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('filePreview', {
  getState: () => ipcRenderer.invoke('shell:file-preview-state'),
  /** @param {(theme: unknown) => void} handler */
  onTheme(handler) {
    const listener = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ theme) => handler(theme);
    ipcRenderer.on('shell:theme', listener);
    return () => ipcRenderer.removeListener('shell:theme', listener);
  },
});
