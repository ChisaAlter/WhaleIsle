'use strict';

// One state channel and one command channel for every surface that shows
// updates: the update center overlay, the launcher and the Harness page
// (dshDesktop.updates). The overlay is opened over whichever window asked.

const UPDATE_CENTER_IPC = Object.freeze({
  state: 'shell:update-center-state',
  command: 'shell:update-center-command',
  open: 'shell:update-center-open',
  close: 'shell:update-center-close',
  changed: 'shell:update-center',
});

const COMMANDS = new Set(['check', 'download', 'downloadFull', 'pause', 'resume', 'cancel', 'install',
  'installVersion', 'setRoute', 'setAutoDownload']);

/** Center snapshot → upstream DesktopUpdatePresentation for the Web status chip. */
function presentation(view) {
  const version = view.target?.version;
  const progress = view.progress;
  const percent = progress?.total > 0 ? Math.min(99, Math.floor((progress.received / progress.total) * 100)) : undefined;
  switch (view.phase) {
    case 'checking': return { phase: 'checking' };
    case 'available': return { phase: 'available', version };
    case 'downloading':
    case 'paused': return { phase: 'downloading', version, ...(percent === undefined ? {} : { percent }) };
    case 'verifying': return { phase: 'verifying', version };
    case 'ready': return { phase: 'ready', version };
    case 'installing': return { phase: 'installing', version };
    case 'error': return {
      phase: 'error',
      failure: `${view.error?.operation || 'install'}${view.error?.network ? '-network' : ''}`,
    };
    default: return { phase: 'idle' };
  }
}

/** Add renderer-ready release notes tabs to a snapshot. */
function decorate(view, releaseNotes) {
  if (!view.target) return view;
  const tabs = releaseNotes.releaseNotesTabs(view.target.notes);
  return {
    ...view,
    target: {
      ...view.target,
      notesTabs: tabs.length > 0 ? tabs : [{ id: 'notes', label: '', text: releaseNotes.plainReleaseNotes(view.target.notes) }],
    },
  };
}

class UpdateCenterWindow {
  /**
   * @param {{ overlays: { create: Function }, preload: string, page: string, theme: () => { scheme: string },
   *   isMaximized: (win: any) => boolean }} options
   */
  constructor(options) {
    this.options = options;
    this.window = null;
    this.parent = null;
  }

  get webContents() {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null;
  }

  owns(sender) {
    return Boolean(sender && this.webContents === sender);
  }

  open(parent) {
    if (!parent || parent.isDestroyed()) return null;
    if (this.window && !this.window.isDestroyed()) {
      if (this.parent === parent) {
        this.window.focus();
        return this.window;
      }
      this.window.destroy();
    }
    const { overlays, preload, page, theme, isMaximized } = this.options;
    const window = overlays.create(parent, preload, '更新', false);
    this.window = window;
    this.parent = parent;
    window.once('closed', () => {
      if (this.window === window) {
        this.window = null;
        this.parent = null;
      }
    });
    const url = new URL(page);
    url.searchParams.set('scheme', theme().scheme === 'dark' ? 'dark' : 'light');
    if (isMaximized(parent)) url.searchParams.set('maximized', '1');
    void window.loadURL(url.href).catch(() => {});
    return window;
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
  }
}

/**
 * @param {{ ipcMain: any, center: any, centerWindow: UpdateCenterWindow, releaseNotes: any,
 *   authorize: (event: any) => string|null, parentFor: (role: string) => any,
 *   surfaces: () => any[], onPresentation?: (presentation: object) => void }} deps
 */
function registerUpdateCenterIpc(deps) {
  const { ipcMain, center, centerWindow, releaseNotes, authorize, parentFor, surfaces, onPresentation } = deps;
  const role = (event) => {
    if (centerWindow.owns(event.sender)) return 'update-center';
    const found = authorize(event);
    if (!found) {
      const error = new Error('Unauthorized IPC sender');
      error.code = 'ERR_DSH_IPC_SENDER';
      throw error;
    }
    return found;
  };
  const view = () => decorate(center.snapshot(), releaseNotes);

  ipcMain.handle(UPDATE_CENTER_IPC.state, (event) => { role(event); return view(); });
  ipcMain.handle(UPDATE_CENTER_IPC.command, async (event, action, arg) => {
    role(event);
    if (!COMMANDS.has(action)) throw new Error(`unknown update command ${action}`);
    await center.command(action, arg);
    return view();
  });
  ipcMain.handle(UPDATE_CENTER_IPC.open, (event) => {
    const sender = role(event);
    const parent = parentFor(sender === 'update-center' ? null : sender);
    centerWindow.open(parent);
    return view();
  });
  ipcMain.handle(UPDATE_CENTER_IPC.close, (event) => {
    if (!centerWindow.owns(event.sender)) role(event);
    centerWindow.close();
  });

  const broadcast = (snapshot) => {
    const payload = decorate(snapshot, releaseNotes);
    const targets = new Set([centerWindow.webContents, ...surfaces()]);
    for (const wc of targets) {
      try { if (wc && !wc.isDestroyed()) wc.send(UPDATE_CENTER_IPC.changed, payload); } catch { /* closing */ }
    }
    onPresentation?.(presentation(snapshot));
  };
  const unsubscribe = center.subscribe(broadcast);
  return { broadcast: () => broadcast(center.snapshot()), dispose: unsubscribe };
}

module.exports = { UPDATE_CENTER_IPC, UpdateCenterWindow, registerUpdateCenterIpc, presentation, decorate };
