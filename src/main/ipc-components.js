'use strict';

// Launcher components lane (refactor plan §5.0/§5.1). Mounts the
// shell:components-* channels through the shared authorized handle and
// contributes the `components` status key; all orchestration lives in
// src/launcher/components/.
const { createComponentsService } = require('../launcher/components');

let service = null;
let serviceDeps = null;
let quitHooked = false;
let bridgeListed = false;
let bridgeService = null;

function ensureService() {
  if (!service) {
    service = createComponentsService(serviceDeps || {});
  }
  return service;
}

// Test seam — swap the deps the singleton service is built with.
function _configureForTest(deps) {
  serviceDeps = deps || {};
  service = null;
  quitHooked = false;
  bridgeListed = false;
  bridgeService = null;
}

function register({ handle, send, onQuitCommit }) {
  const svc = ensureService();
  const bridge = serviceDeps ? serviceDeps.magpie : require('../launcher/magpie').magpieService();
  const bridgeId = bridge?.id || 'magpie';
  bridgeService = bridge || null;
  const progress = (/** @type {any} */ event, /** @type {any} */ id) => (/** @type {any} */ payload) => send(event, 'shell:components-progress', { id, ...payload });
  const isBridge = (/** @type {any} */ id) => Boolean(bridge && id === bridgeId);

  handle('shell:components-list', async (_event, options) => {
    const list = svc.list();
    if (!bridge) return list;
    if (!bridgeListed || options?.refresh === true) {
      await bridge.refreshCatalog();
      bridgeListed = true;
    } else {
      await bridge.reconcile?.();
    }
    return { ...list, components: [bridge.row(), ...list.components] };
  });

  handle('shell:components-install', (event, arg) => {
    const id = typeof arg === 'string' ? arg : arg?.id;
    return isBridge(id) ? bridge.install(progress(event, id)) : svc.install(arg, progress(event, id));
  });

  handle('shell:components-start', (event, id) => (isBridge(id) ? bridge.start(progress(event, id)) : svc.start(id, progress(event, id))));

  handle('shell:components-stop', async (event, id) => {
    if (!isBridge(id)) return svc.stop(id, progress(event, id));
    const result = await bridge.stop(progress(event, id));
    if (result.ok) require('./magpie-window').closeMagpieWindow();
    return result;
  });

  handle('shell:components-update', async (event, id) => {
    if (!isBridge(id)) return svc.update(id, progress(event, id));
    const previousUrl = bridge.state()?.url;
    const result = await bridge.update(progress(event, id));
    if (result?.externalUrl) {
      await require('./open-external').openExternalHttp(result.externalUrl);
      return result;
    }
    // A failed switch can restore the old version on a new management URL.
    if (result.ok || bridge.state()?.url !== previousUrl) require('./magpie-window').closeMagpieWindow();
    return result;
  });

  handle('shell:components-rollback', async (event, id) => {
    if (!isBridge(id)) return svc.rollback(id, progress(event, id));
    const previousUrl = bridge.state()?.url;
    const result = await bridge.rollback(progress(event, id));
    if (result.ok || bridge.state()?.url !== previousUrl) require('./magpie-window').closeMagpieWindow();
    return result;
  });

  handle('shell:components-uninstall', async (event, arg) => {
    const id = typeof arg === 'string' ? arg : arg?.id;
    if (!isBridge(id)) return svc.uninstall(id, progress(event, id));
    const previousUrl = bridge.state()?.url;
    const result = await bridge.uninstall(arg, progress(event, id));
    if (result.ok || bridge.state()?.url !== previousUrl) require('./magpie-window').closeMagpieWindow();
    return result;
  });
  handle('shell:components-uninstall-info', (_event, id) => (isBridge(id) ? bridge.uninstallInfo() : {}));
  handle('shell:components-open', async (event, id) => {
    if (!isBridge(id)) return { ok: false, error: 'unknown-component' };
    const result = await bridge.start(progress(event, id));
    if (!result.ok) return result;
    const row = typeof bridge.row === 'function' ? bridge.row() : null;
    require('./magpie-window').openMagpieWindow({
      url: result.url,
      ownership: result.ownership || row?.ownership,
      version: result.version || row?.installedVersion,
      latestVersion: row?.latest || '',
      externalUpdateUrl: row?.capabilities?.externalUpdateUrl || '',
      onClose: typeof bridge.stopCompanion === 'function' ? () => { void bridge.stopCompanion(); } : null,
    });
    return { ok: true };
  });

  // Services supervised by this launcher die with it (feature card:
  // 退出 Launcher 时停止其监管的服务); closing the window alone keeps them.
  // The full package routes the cleanup through the task-protection commit
  // point — `before-quit` fires even when the protection prompt cancels the
  // quit, so a plain listener would shut services down on a cancelled quit.
  if (!quitHooked) {
    quitHooked = true;
    const shutdownAll = () => {
      svc.shutdown();
      return bridge?.stopCompanion?.();
    };
    if (typeof onQuitCommit === 'function') {
      onQuitCommit(shutdownAll);
    } else {
      try {
        const { app } = require('electron');
        let companionStopped = false;
        app.on('before-quit', (/** @type {Electron.Event} */ event) => {
          svc.shutdown();
          if (companionStopped || typeof bridge?.stopCompanion !== 'function') return;
          companionStopped = true;
          event.preventDefault();
          Promise.resolve(bridge.stopCompanion())
            .catch((error) => {
              console.warn('[src/main/ipc-components.js] stopCompanion failed during before-quit', error);
            })
            .finally(() => { app.quit(); });
        });
      } catch {
        // outside Electron (unit tests) — shutdown stays reachable directly
      }
    }
  }
}

function contributeStatus() {
  if (!service) {
    return null;
  }
  return { components: [...(bridgeService ? [bridgeService.row()] : []), ...service.snapshot()] };
}

module.exports = { register, contributeStatus, _configureForTest };
