/** Navigation is projected from owned UI state, never from host payloads. */
export function backTarget(state) {
  if (state.lightbox) return 'lightbox';
  for (const key of ['sessionConfirm', 'confirmAction', 'workspaceRename', 'folderCreate', 'sessionRename', 'queueEdit']) {
    if (state[key]) return key;
  }
  if (state.gitDialog) return 'git';
  if (state.newSession) return state.newSession.step === 'browse' ? 'directory' : 'newSession';
  if (state.history) return 'history';
  if (state.sessionMenu) return 'sessionMenu';
  if (state.workspaceMenu) return 'workspaceMenu';
  if (state.pickerSheet) return 'picker';
  if (state.attachOpen) return 'attachment';
  if (state.sessionsOpen) return 'sessions';
  if (state.settingsOpen) return state.settingsPane ? 'settingsPane' : 'settings';
  if (state.drawerOpen) return 'drawer';
  if (state.route === 'scan' || state.route === 'permission') return 'scan';
  return 'root';
}

/** A single disposable history barrier avoids serializing tasks or replaying writes. */
export function createNavigation({ history, listen, hasSurface, onBack, isBlocked = () => false, canTrack = () => true, getSurfaceKey = hasSurface }) {
  const token = `surface-${Date.now()}-${Math.random()}`;
  let armed = false;
  let pending = false;
  let pruning = false;
  let requestedKey;
  let superseded = false;

  function sync() {
    if (pending) {
      if (getSurfaceKey() !== requestedKey) superseded = true;
      return;
    }
    if (!canTrack()) return;
    if (hasSurface() && !armed) {
      history.pushState({ dshdSurface: token }, '');
      armed = true;
    } else if (!hasSurface() && armed) {
      pending = true;
      pruning = true;
      requestedKey = getSurfaceKey();
      history.back();
    }
  }

  listen((event) => {
    const wasArmed = armed;
    armed = false;
    pending = false;
    if (event.state?.dshdSurface) {
      // Skip a stale forward/reload barrier instead of creating a second root.
      pending = true;
      pruning = true;
      requestedKey = getSurfaceKey();
      history.back();
      return;
    } else if (wasArmed && !pruning && !superseded && (requestedKey === undefined || requestedKey === getSurfaceKey()) && hasSurface() && !isBlocked()) {
      onBack();
    }
    pruning = false;
    superseded = false;
    requestedKey = undefined;
    sync();
  });

  if (history.state?.dshdSurface) {
    pending = true;
    pruning = true;
    requestedKey = getSurfaceKey();
    history.back();
  }

  return {
    sync,
    back() {
      if (pending || isBlocked()) return 'busy';
      if (!hasSurface()) return 'root';
      if (armed) {
        pending = true;
        requestedKey = getSurfaceKey();
        history.back();
      } else {
        onBack();
        sync();
      }
      return 'handled';
    },
  };
}
