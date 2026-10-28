'use strict';

// A window that becomes ready long after the user started us (the first start
// extracts the runtime and can take minutes) must not take the foreground from
// an app they switched to meanwhile: it appears without activation and flashes
// in the taskbar instead. Explicit requests (tray, second launch, menus) still
// activate through their own show/focus calls.

function createForegroundPolicy({ app, BrowserWindow, defer = setImmediate }) {
  const focused = () => (typeof BrowserWindow?.getFocusedWindow === 'function' ? BrowserWindow.getFocusedWindow() : null);
  const windows = () => (typeof BrowserWindow?.getAllWindows === 'function' ? BrowserWindow.getAllWindows() : []);
  // Visible windows of ours but none focused: the user is already elsewhere.
  let away = windows().some((win) => !win.isDestroyed() && win.isVisible()) && !focused();
  app?.on?.('browser-window-focus', () => { away = false; });
  // Focus moving between our own windows blurs one before focusing the next.
  app?.on?.('browser-window-blur', () => defer(() => { away = !focused(); }));
  return {
    isAway: () => away,
    /** Show `win`, activating it only while the user is still with us. */
    present(win, activate = true) {
      if (activate && !away) {
        win.show();
        return 'activated';
      }
      win.showInactive();
      if (activate && typeof win.flashFrame === 'function') win.flashFrame(true);
      return 'inactive';
    },
  };
}

module.exports = { createForegroundPolicy };
