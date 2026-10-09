'use strict';

/**
 * Main-owned confirmations rendered in a shell window; closing or replacing
 * a dialog never grants permission. Ported from upstream
 * apps/desktop/update-dialog.ts — the page is served from file:// (packaged
 * renderer assets) rather than the upstream dsh-app://shell route, and copy
 * is injected rather than locale-driven.
 */

const { ipcMain } = require('electron');
const { currentTheme } = require('./chrome');

const UPDATE_DIALOG_IPC = {
  status: 'dsh-update-dialog:status',
  changed: 'dsh-update-dialog:changed',
  respond: 'dsh-update-dialog:respond',
};

const DEFAULT_TEXT = {
  acknowledge: '知道了',
  title: '鲸屿',
  close: '关闭',
  technicalDetails: '技术细节',
};

/**
 * One fading backdrop with replaceable confirmation content; a response from
 * an older prompt is rejected via revision.
 */
class ShellConfirmDialog {
  /**
   * @param {string} preload - bundled isolated preload for the dialog document.
   * @param {string} page - file:// URL of the packaged update-dialog.html.
   * @param {{ create: Function }} overlays - application-owned overlay creation.
   * @param {object} [text] - shell copy.
   */
  constructor(preload, page, overlays, text = {}) {
    this.preload = preload;
    this.page = page;
    this.overlays = overlays;
    this.text = { ...DEFAULT_TEXT, ...text };
    this.disposed = false;
    this.revision = 0;
    this.window = undefined;
    this.parent = undefined;
    this.closing = undefined;
    this.active = undefined;
    ipcMain.handle(UPDATE_DIALOG_IPC.status, (event) => { this.owned(event); return this.active?.view ?? null; });
    ipcMain.handle(UPDATE_DIALOG_IPC.respond, (event, revision, index, downloadMode) => {
      this.owned(event);
      const active = this.active;
      if (active === undefined || revision !== active.view.revision) {
        throw new Error('dshd dialog: stale response');
      }
      if (typeof index !== 'number' || !Number.isInteger(index)
        || (index !== active.view.cancelId && (index < 0 || index >= active.view.buttons.length))) {
        throw new Error('dshd dialog: invalid response');
      }
      if (index === 0 && active.view.downloadMethods.length > 0
        && !active.view.downloadMethods.some((method) => method.id === downloadMode && !method.disabledReason)) {
        throw new Error('dshd dialog: unavailable download method');
      }
      active.finish(index, false, index === 0 ? downloadMode : undefined);
    });
  }

  focus() { this.active?.window.focus(); }
  get isOpen() { return this.active !== undefined; }

  /**
   * @param {any} parent - window blocked by this confirmation.
   * @param {object} options - main-owned localized content + response choices
   *   (+ optional `signal` AbortSignal, `technicalDetails` string).
   * @returns Promise<{response:number}> cancellation on replace/abort/close/load failure.
   */
  show(parent, options) {
    const buttons = options.buttons ?? [this.text.acknowledge];
    const cancelId = options.cancelId ?? buttons.length - 1;
    if (this.disposed || options.signal?.aborted === true || parent.isDestroyed()) {
      return Promise.resolve({ response: cancelId });
    }
    if (this.parent !== parent) { this.cancel(); this.close(); }
    this.active?.finish(this.active.view.cancelId, true);
    clearTimeout(this.closing);
    this.closing = undefined;
    const existing = this.window;
    const window = existing ?? this.overlays.create(parent, this.preload, options.title ?? this.text.title, false);
    this.window = window;
    this.parent = parent;
    const { isEffectivelyMaximized } = require('./chrome');
    const view = {
      revision: ++this.revision, locale: 'zh-CN', title: options.title ?? '',
      message: options.message ?? '', detail: options.detail ?? '',
      kind: options.kind === 'update' ? 'update' : 'confirmation',
      context: options.context ?? '',
      downloadMethods: Array.isArray(options.downloadMethods) ? options.downloadMethods : [],
      buttons, cancelId, closeLabel: this.text.close,
      technicalDetails: options.technicalDetails ?? '',
      technicalDetailsLabel: this.text.technicalDetails,
      maximized: isEffectivelyMaximized(parent),
      // Each prompt decides which (if any) buttons are destructive — the
      // renderer paints them with the danger outline so the risky verb reads
      // as such, not as the safe primary. `options.dangerIds` mirrors Electron
      // button indices; absent/empty → all neutral.
      dangerIds: Array.isArray(options.dangerIds)
        ? options.dangerIds.filter((i) => Number.isInteger(i) && i >= 0 && i < buttons.length)
        : [],
      // The renderer applies `data-ds-dark-theme` from this; the shared
      // `shell:theme` broadcast then keeps the card in step on later flips.
      scheme: currentTheme().scheme,
    };
    return new Promise((resolve) => {
      // The scrim corners track the parent silhouette; fake-maximized parents
      // flip on geometry, so keep pushing the effective state while open.
      const syncMaximized = () => {
        if (this.active?.view !== view || window.isDestroyed()) return;
        const maximized = isEffectivelyMaximized(parent);
        if (view.maximized === maximized) return;
        view.maximized = maximized;
        window.webContents.send(UPDATE_DIALOG_IPC.changed, view);
      };
      const abort = () => { finish(cancelId); };
      const finish = (response, retain = false, downloadMode) => {
        if (this.active?.view !== view) return;
        this.active = undefined;
        parent.off('resize', syncMaximized);
        parent.off('moved', syncMaximized);
        options.signal?.removeEventListener('abort', abort);
        if (!retain && !window.isDestroyed()) {
          window.webContents.send(UPDATE_DIALOG_IPC.changed, null);
          this.closing = setTimeout(() => { this.close(); }, 150);
        }
        resolve(downloadMode === undefined ? { response } : { response, downloadMode });
      };
      this.active = { window, view, finish };
      parent.on('resize', syncMaximized);
      parent.on('moved', syncMaximized);
      window.once('closed', () => { parent.off('resize', syncMaximized); parent.off('moved', syncMaximized); });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (existing !== undefined) {
        window.webContents.send(UPDATE_DIALOG_IPC.changed, view);
        return;
      }
      const failed = () => { if (this.window === window) { this.cancel(); this.close(); } };
      window.once('closed', failed);
      window.webContents.on('will-navigate', (event, url) => { if (url !== this.page) event.preventDefault(); });
      window.webContents.once('render-process-gone', failed);
      void window.loadURL(this.page).catch(failed);
    });
  }

  /** Cancel the displayed prompt without authorizing any operation. */
  cancel() { this.active?.finish(this.active.view.cancelId); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.close();
    ipcMain.removeHandler(UPDATE_DIALOG_IPC.status);
    ipcMain.removeHandler(UPDATE_DIALOG_IPC.respond);
  }

  close() {
    clearTimeout(this.closing);
    this.closing = undefined;
    const window = this.window;
    this.window = undefined;
    this.parent = undefined;
    if (window !== undefined && !window.isDestroyed()) window.destroy();
  }

  owned(event) {
    const window = this.window;
    if (window === undefined || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== this.page) {
      throw new Error('dshd dialog: rejected unowned renderer');
    }
  }
}

module.exports = { ShellConfirmDialog, UPDATE_DIALOG_IPC };
