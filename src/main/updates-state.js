'use strict';

/**
 * Main-owned update status bus feeding `dshDesktop.updates`. Mirrors the
 * upstream DesktopUpdatePresentation contract (idle/checking/available/
 * downloading/verifying/installing/ready/error); open() joins the
 * shell-owned update flow, never selects artifacts or skips confirmation.
 */

const { ipcMain } = require('electron');
const { presentUpdate } = require('./update-presentation');

const IPC = {
  status: 'shell:updates-status',
  open: 'shell:updates-open',
  changed: 'shell:updates-changed',
};

function createUpdatesState({ onOpen }) {
  let presentation = { phase: 'idle' };
  const listeners = new Set();

  const notify = () => {
    for (const listener of listeners) {
      try { listener(presentation); } catch (error) { console.warn('dshd updates: listener failed', error); }
    }
  };
  const publish = (state) => {
    presentation = presentUpdate(state);
    notify();
  };

  ipcMain.handle(IPC.status, () => presentation);
  ipcMain.handle(IPC.open, async () => { await onOpen(); });
  ipcMain.on(IPC.changed, () => { /* renderer-pull only; subscription rides preload subscribe */ });

  return {
    presentation: () => presentation,
    publish,
    /** Adopt an already semantic presentation (update center). */
    present(next) {
      presentation = next;
      notify();
    },
    /** Push the same state to every harness renderer subscriber. */
    broadcast(webContentsList) {
      for (const wc of webContentsList) {
        try { if (!wc.isDestroyed()) wc.send(IPC.changed, presentation); } catch { /* destroyed */ }
      }
    },
    changedChannel: IPC.changed,
  };
}

module.exports = { createUpdatesState, UPDATE_IPC: IPC };
