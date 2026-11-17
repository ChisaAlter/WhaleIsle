'use strict';

const { app } = require('electron');
const { loadConfig } = require('./config');
const { getMainWindow, getLauncherWindow, getHarnessWebContents } = require('./window');
const { getLive2dPet } = require('./desktop-live2d');
const { devToolsShortcutAllowed, attachDevToolsShortcut } = require('./devtools-shortcut');

/**
 * App-level event handlers extracted from index.js (#439 P3-4), registered
 * only after the single-instance lock is held. Behavior and registration
 * order unchanged.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {() => void} deps.showForeground
 * @param {(message: string) => void} deps.log
 */
function registerAppEvents({ state, showForeground, log }) {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--background')) return;
    showForeground();
  });

  // The pet overlay is a fullscreen transparent always-on-top window; a GPU
  // process crash can leave its layered surface compositing opaque-black over
  // the whole display (whale sprite still draws). Rebuild it on GPU death.
  (/** @type {any} */ (app)).on('gpu-process-crashed', () => {
    try { getLive2dPet()?.recreateWindow(); } catch (error) { log(`恢复桌宠窗口失败；请在内置功能中关闭再启用桌宠：${error instanceof Error ? error.message : String(error)}`); }
  });
  app.on('child-process-gone', (_event, details) => {
    if (details?.type === 'GPU') {
      try { getLive2dPet()?.recreateWindow(); } catch (error) { log(`恢复桌宠窗口失败；请在内置功能中关闭再启用桌宠：${error instanceof Error ? error.message : String(error)}`); }
    }
  });

  // Window-scoped DevTools toggle (Ctrl+Shift+I / Cmd+Alt+I). Never an OS
  // global shortcut: that would hijack the chord in other applications and
  // opened DevTools unconditionally in packaged builds.
  app.on('web-contents-created', (_event, contents) => {
    attachDevToolsShortcut(contents, {
      allowed: () => devToolsShortcutAllowed({
        isPackaged: app.isPackaged,
        openDevTools: loadConfig().openDevTools === true,
      }),
      resolveTarget: () => {
        const win = getMainWindow() || getLauncherWindow();
        return getHarnessWebContents(win) || win?.webContents;
      },
    });
  });

  app.on('activate', () => {
    if (state.backgroundStartup) return;
    showForeground();
  });
}

module.exports = { registerAppEvents };
