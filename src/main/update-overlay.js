'use strict';

/**
 * Shell-owned modal windows cover the parent's content without replacing its
 * native window controls. Ported from upstream apps/desktop/update-overlay.ts.
 */

const { BrowserWindow } = require('electron');

const UNBLOCKED_INPUT = Object.freeze({ revision: 0, blocked: false });

class UpdateOverlays {
  constructor() {
    this.inputStates = new WeakMap();
  }

  /** Current blocking state; revision changes whenever an overlay opens or closes. */
  input(parent) {
    return this.inputStates.get(parent) ?? UNBLOCKED_INPUT;
  }

  /**
   * A transparent child that follows its parent's bounds and visibility after
   * loading and releases its listeners on close.
   * @param {any} parent - product window whose content is blocked while open.
   * @param {string} preload - isolated shell-only preload.
   * @param {string} title - window title.
   * @param {boolean} [nativeModal]
   */
  create(parent, preload, title, nativeModal = true) {
    const window = new BrowserWindow({
      parent, modal: nativeModal || process.platform !== 'darwin', show: false, frame: false, transparent: true,
      // The scrim paints the parent's silhouette radius itself; the OS corner
      // mask would alias-clip it.
      roundedCorners: false,
      ...parent.getContentBounds(), resizable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, hasShadow: false, title,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
    });
    const inputState = this.inputStates.get(parent) ?? { revision: 0, active: 0, get blocked() { return this.active > 0; } };
    this.inputStates.set(parent, inputState);
    inputState.active += 1;
    inputState.revision += 1;
    window.once('closed', () => { inputState.active -= 1; inputState.revision += 1; });
    const focus = () => { if (!window.isDestroyed()) window.focus(); };
    const blockInput = (event) => { event.preventDefault(); focus(); };
    if (!nativeModal && process.platform === 'darwin') {
      parent.on('focus', focus);
      // Shell dialogs block input before product shortcut listeners dispatch it.
      parent.webContents.prependListener('before-input-event', blockInput);
      window.once('closed', () => {
        parent.off('focus', focus);
        if (!parent.isDestroyed()) parent.webContents.off('before-input-event', blockInput);
      });
    }
    const follow = () => { if (!window.isDestroyed()) window.setBounds(parent.getContentBounds()); };
    parent.on('move', follow);
    parent.on('resize', follow);
    window.once('closed', () => { parent.off('move', follow); parent.off('resize', follow); });
    let ready = false;
    const show = () => {
      if (ready && !window.isDestroyed() && !parent.isDestroyed() && parent.isVisible()) window.show();
    };
    parent.on('show', show);
    window.once('closed', () => { parent.off('show', show); });
    window.once('ready-to-show', () => { ready = true; show(); });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return window;
  }
}

module.exports = { UpdateOverlays };
