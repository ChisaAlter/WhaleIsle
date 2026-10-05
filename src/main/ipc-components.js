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
}

function register({ handle, LAUNCHER_ONLY, send, onQuitCommit }) {
  const svc = ensureService();
  const bridge = serviceDeps ? serviceDeps.whaleBridge : require('../launcher/whalebridge').whaleBridgeService();
  const progress = (event, id) => (payload) => send(event, 'shell:components-progress', { id, ...payload });

  handle('shell:components-list', LAUNCHER_ONLY, async (_event, options) => {
    const list = svc.list();
    if (!bridge) return list;
    if (!bridgeListed || options?.refresh === true) { await bridge.refreshCatalog(); bridgeListed = true; }
    return { ...list, components: [bridge.row(), ...list.components] };
  });

  handle('shell:components-install', LAUNCHER_ONLY, (event, arg) => {
    const id = typeof arg === 'string' ? arg : arg?.id;
    return id === 'whalebridge' && bridge ? bridge.install(progress(event, id)) : svc.install(arg, progress(event, id));
  });

  handle('shell:components-start', LAUNCHER_ONLY, (event, id) => id === 'whalebridge' && bridge ? bridge.start(progress(event, id)) : svc.start(id, progress(event, id)));

  handle('shell:components-stop', LAUNCHER_ONLY, async (event, id) => {
    if (id !== 'whalebridge' || !bridge) return svc.stop(id, progress(event, id));
    const result = await bridge.stop(progress(event, id));
    if (result.ok) require('./whalebridge-window').closeWhaleBridgeWindow();
    return result;
  });

  handle('shell:components-update', LAUNCHER_ONLY, async (event, id) => {
    if (id !== 'whalebridge' || !bridge) return svc.update(id, progress(event, id));
    const result = await bridge.update(progress(event, id));
    if (result.ok) require('./whalebridge-window').closeWhaleBridgeWindow();
    return result;
  });

  handle('shell:components-rollback', LAUNCHER_ONLY, async (event, id) => {
    if (id !== 'whalebridge' || !bridge) return svc.rollback(id, progress(event, id));
    const result = await bridge.rollback(progress(event, id));
    if (result.ok) require('./whalebridge-window').closeWhaleBridgeWindow();
    return result;
  });

  handle('shell:components-uninstall', LAUNCHER_ONLY, async (event, arg) => {
    const id = typeof arg === 'string' ? arg : arg?.id;
    if (id !== 'whalebridge' || !bridge) return svc.uninstall(id, progress(event, id));
    const result = await bridge.uninstall(arg, progress(event, id));
    if (result.ok) require('./whalebridge-window').closeWhaleBridgeWindow();
    return result;
  });
  handle('shell:components-uninstall-info', LAUNCHER_ONLY, (_event, id) => id === 'whalebridge' && bridge ? bridge.uninstallInfo() : {});
  handle('shell:components-open', LAUNCHER_ONLY, async (event, id) => {
    if (id !== 'whalebridge' || !bridge) return { ok: false, error: 'unknown-component' };
    const result = await bridge.start(progress(event, id));
    if (!result.ok) return result;
    require('./whalebridge-window').openWhaleBridgeWindow(result.url);
    return { ok: true };
  });

  // Services supervised by this launcher die with it (feature card:
  // 退出 Launcher 时停止其监管的服务); closing the window alone keeps them.
  // The full package routes the cleanup through the task-protection commit
  // point — `before-quit` fires even when the protection prompt cancels the
  // quit, so a plain listener would shut services down on a cancelled quit.
  if (!quitHooked) {
    quitHooked = true;
    if (typeof onQuitCommit === 'function') {
      onQuitCommit(() => svc.shutdown());
    } else {
      try {
        const { app } = require('electron');
        app.on('before-quit', () => {
          svc.shutdown();
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
  return { components: service.snapshot() };
}

module.exports = { register, contributeStatus, _configureForTest };
