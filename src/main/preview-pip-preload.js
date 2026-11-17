'use strict';

const { contextBridge, ipcRenderer } = require('electron');
// Sandboxed preloads cannot require local modules; keep this channel in sync
// with preview-pip-protocol.js.
const PREVIEW_PIP_FRAME_CHANNEL = 'dshd-preview-pip-frame';

contextBridge.exposeInMainWorld('previewPictureInPicture', {
  /**
   * @param {(frame: unknown) => void} listener
   * @returns {() => void}
   */
  onFrame(listener) {
    const wrappedListener = (/** @type {Electron.IpcRendererEvent} */ _event, /** @type {unknown} */ frame) => {
      if (typeof frame !== 'object' || frame === null) return;
      listener(frame);
    };
    ipcRenderer.on(PREVIEW_PIP_FRAME_CHANNEL, wrappedListener);
    return () => ipcRenderer.removeListener(PREVIEW_PIP_FRAME_CHANNEL, wrappedListener);
  },
});
