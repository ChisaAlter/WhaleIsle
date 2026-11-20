'use strict';

/** Isolated sandboxed bridge for the floating minimized approval popup window. */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  state: 'shell:approval-popup-state',
  decide: 'shell:approval-popup-decide',
  select: 'shell:approval-popup-select',
  openSession: 'shell:approval-popup-open-session',
  dismiss: 'shell:approval-popup-dismiss',
  changed: 'shell:approval-popup-changed',
};

const api = {
  getState: () => ipcRenderer.invoke(CHANNELS.state),
  decide: (/** @type {string} */ eventId, /** @type {string} */ action) => (
    ipcRenderer.invoke(CHANNELS.decide, { eventId, action })
  ),
  select: (/** @type {string} */ eventId) => {
    ipcRenderer.send(CHANNELS.select, { eventId });
  },
  openSession: (/** @type {string} */ sessionId) => (
    ipcRenderer.invoke(CHANNELS.openSession, { sessionId })
  ),
  dismiss: () => {
    ipcRenderer.send(CHANNELS.dismiss);
  },
  onState: (/** @type {(view: unknown) => void} */ listener) => {
    const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ view) => {
      listener(view);
    };
    ipcRenderer.on(CHANNELS.changed, receive);
    return () => {
      ipcRenderer.removeListener(CHANNELS.changed, receive);
    };
  },
  onTheme: (/** @type {(theme: unknown) => void} */ listener) => {
    const receive = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ theme) => {
      listener(theme);
    };
    ipcRenderer.on('shell:theme', receive);
    return () => {
      ipcRenderer.removeListener('shell:theme', receive);
    };
  },
};

if (/^file:.*approval-popup\.html(?:[?#].*)?$/u.test(location.href)) {
  contextBridge.exposeInMainWorld('dshApprovalPopup', api);
}
