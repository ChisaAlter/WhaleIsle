'use strict';

/** Isolated bridge for the shell-owned update center overlay. */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  state: 'shell:update-center-state',
  command: 'shell:update-center-command',
  close: 'shell:update-center-close',
  changed: 'shell:update-center',
};

const api = {
  state: () => ipcRenderer.invoke(CHANNELS.state),
  command: (action, arg) => ipcRenderer.invoke(CHANNELS.command, action, arg),
  close: () => ipcRenderer.invoke(CHANNELS.close),
  subscribe: (listener) => {
    const receive = (_event, view) => { listener(view); };
    ipcRenderer.on(CHANNELS.changed, receive);
    return () => { ipcRenderer.removeListener(CHANNELS.changed, receive); };
  },
  onTheme: (listener) => {
    const receive = (_event, theme) => { listener(theme); };
    ipcRenderer.on('shell:theme', receive);
    return () => { ipcRenderer.removeListener('shell:theme', receive); };
  },
  onWindowState: (listener) => {
    const receive = (_event, state) => { listener(state); };
    ipcRenderer.on('shell:window-state', receive);
    return () => { ipcRenderer.removeListener('shell:window-state', receive); };
  },
};

// Only the packaged update center document gets the bridge.
if (/^file:.*update-center\.html(?:[?#].*)?$/u.test(location.href)) {
  contextBridge.exposeInMainWorld('whaleUpdateCenter', api);
}
