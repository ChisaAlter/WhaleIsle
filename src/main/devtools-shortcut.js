'use strict';

/**
 * Window-scoped DevTools toggle.
 *
 * The desktop must not register an OS-global shortcut for DevTools: a global
 * `CommandOrControl+Shift+I` hijacks the same key in every other application
 * while the desktop runs, and it opened DevTools unconditionally in packaged
 * builds. Instead every webContents of this app gets a `before-input-event`
 * listener (fires only when that webContents has focus), gated so packaged
 * builds require the explicit `openDevTools` config switch.
 */

/**
 * Whether the DevTools toggle may act in this process.
 * Development (unpackaged) keeps the old always-on behavior; packaged builds
 * only honor the shortcut when the user turned on the openDevTools setting.
 */
function devToolsShortcutAllowed({ isPackaged = false, openDevTools = false } = {}) {
  return !isPackaged || openDevTools === true;
}

/**
 * Match the DevTools toggle chord on a `before-input-event` input record:
 * Ctrl+Shift+I (Windows/Linux) or Cmd+Alt+I (macOS), keyDown only.
 * @param {Electron.Input} input
 */
function isDevToolsToggleInput(input) {
  if (!input || input.type !== 'keyDown') {
    return false;
  }
  if (String(input.key || '').toLowerCase() !== 'i') {
    return false;
  }
  const ctrlShift = input.control === true && input.shift === true && !input.meta && !input.alt;
  const metaAlt = input.meta === true && input.alt === true && !input.control && !input.shift;
  return ctrlShift || metaAlt;
}

/**
 * Attach the window-scoped toggle to one webContents.
 * @param {Electron.WebContents} contents - receiver of the key input.
 * @param {{ allowed: () => boolean, resolveTarget: () => Electron.WebContents | null | undefined }} deps
 *   `allowed` re-reads the gate on every press (config can change at runtime);
 *   `resolveTarget` picks the webContents whose DevTools toggle (harness view
 *   over boot page, launcher as fallback — same target as the old shortcut).
 */
function attachDevToolsShortcut(contents, { allowed, resolveTarget }) {
  if (!contents || typeof contents.on !== 'function') {
    return;
  }
  contents.on('before-input-event', (event, input) => {
    if (!isDevToolsToggleInput(input) || !allowed()) {
      return;
    }
    event.preventDefault();
    const target = resolveTarget();
    if (target && typeof target.toggleDevTools === 'function') {
      target.toggleDevTools();
    }
  });
}

module.exports = {
  devToolsShortcutAllowed,
  isDevToolsToggleInput,
  attachDevToolsShortcut,
};
