'use strict';

/** Isolated response-only bridge for shell-owned update dialogs. */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  status: 'dsh-update-dialog:status',
  changed: 'dsh-update-dialog:changed',
  respond: 'dsh-update-dialog:respond',
};

const api = {
  status: () => ipcRenderer.invoke(CHANNELS.status),
  respond: (/** @type {unknown} */ revision, /** @type {unknown} */ index, /** @type {unknown} */ downloadMode) => ipcRenderer.invoke(CHANNELS.respond, revision, index, downloadMode),
  subscribe: (/** @type {(view: unknown) => void} */ listener) => {
    const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ view) => { listener(view); };
    ipcRenderer.on(CHANNELS.changed, receive);
    return () => { ipcRenderer.removeListener(CHANNELS.changed, receive); };
  },
  // `applyAppTheme` fans `shell:theme` out to every non-harness BrowserWindow
  // (this dialog is one of them); forwarding keeps the scrim/card palette in
  // step with the host theme instead of pinning a hard-coded dark look.
  onTheme: (/** @type {(theme: unknown) => void} */ listener) => {
    const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ theme) => { listener(theme); };
    ipcRenderer.on('shell:theme', receive);
    return () => { ipcRenderer.removeListener('shell:theme', receive); };
  },
};

// Only the packaged dialog document gets the bridge; it is served from
// file:// rather than the upstream dsh-app://shell route.
if (process.isMainFrame && /^file:.*update-dialog\.html(?:[?#].*)?$/u.test(location.href)) {
  contextBridge.exposeInMainWorld('dshUpdateDialog', api);
}
