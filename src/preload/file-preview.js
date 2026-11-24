'use strict';

const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame === true
  && typeof location === 'object'
  && location !== null
  && /^file:.*\/file-preview\.html(?:[?#].*)?$/iu.test(location.href)) {
  contextBridge.exposeInMainWorld('filePreview', {
    getState: () => ipcRenderer.invoke('shell:file-preview-state'),
    /** @param {(theme: unknown) => void} handler */
    onTheme(handler) {
      const listener = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ theme) => handler(theme);
      ipcRenderer.on('shell:theme', listener);
      return () => ipcRenderer.removeListener('shell:theme', listener);
    },
  });
}
