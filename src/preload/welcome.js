'use strict';

/**
 * Localized welcome copy and write-only credential actions (upstream preload-welcome).
 * Self-contained like the platform preload: the window-owned locale table
 * arrives over a sync bootstrap channel, so this file stays sandbox-safe —
 * no local requires.
 */

const { contextBridge, ipcRenderer } = require('electron');

const IPC = {
  locale: 'dsh-welcome:locale',
  saveApiKey: 'dsh-welcome:save-api-key',
  skip: 'dsh-welcome:skip',
  start: 'dsh-welcome:start',
  cancel: 'dsh-welcome:cancel',
  copyLink: 'dsh-welcome:copy-link',
  state: 'dsh-welcome:state',
  takeNotice: 'dsh-welcome:take-notice',
};

const locale = ipcRenderer.sendSync(IPC.locale);
if (locale === null || typeof locale !== 'object' || Array.isArray(locale)
  || typeof locale.id !== 'string'
  || locale.messages === null || typeof locale.messages !== 'object' || Array.isArray(locale.messages)) {
  throw new Error('dshd welcome: missing window locale');
}
const api = {
  ...locale,
  takeNotice: () => ipcRenderer.invoke(IPC.takeNotice),
  startSignIn: () => ipcRenderer.invoke(IPC.start),
  cancelSignIn: (id) => ipcRenderer.invoke(IPC.cancel, id),
  copySignInLink: (id) => ipcRenderer.invoke(IPC.copyLink, id),
  onAccountState: (listener) => {
    const receive = (_event, state) => { listener(state); };
    ipcRenderer.on(IPC.state, receive);
    return () => { ipcRenderer.removeListener(IPC.state, receive); };
  },
  saveApiKey: (value) => ipcRenderer.invoke(IPC.saveApiKey, value),
  skip: () => ipcRenderer.invoke(IPC.skip),
};
contextBridge.exposeInMainWorld('dshWelcome', api);
