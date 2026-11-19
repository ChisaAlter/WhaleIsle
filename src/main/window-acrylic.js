'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isNativeWindowMaximized } = require('./native-window-motion');

// Match the page silhouette in harness-chrome-inject.js and boot.css.
const FRAME_RADIUS_DIP = 20;
const GEOMETRY_EVENTS = ['resize', 'moved', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen'];

/** @typedef {{ setVisible: (visible: boolean) => void }} AcrylicBackdrop */
/** @type {WeakMap<Electron.BrowserWindow, AcrylicBackdrop>} */
const backdrops = new WeakMap();

function loadBackdropLibrary() {
  const { app } = require('electron');
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'build');
  const file = path.join(root, 'whale-window-acrylic.dll');
  if (!fs.existsSync(file)) return null;
  const lib = require('koffi').load(file);
  return {
    create: lib.func('long CreateWindowAcrylic(uintptr_t hwnd, _Out_ void **result)'),
    update: lib.func('long UpdateWindowAcrylic(void *backdrop, int visible, uint radiusDip)'),
    destroy: lib.func('void DestroyWindowAcrylic(void *backdrop)'),
  };
}

/** @type {ReturnType<typeof loadBackdropLibrary> | undefined} */
let library;

/** @param {number} hr @param {string} operation */
function checkResult(hr, operation) {
  if (hr < 0) throw new Error(`Window acrylic ${operation} failed (0x${(hr >>> 0).toString(16)})`);
}

/**
 * Advertise the feature only after attaching a hidden composition target to
 * this window. On unsupported graphics stacks the page keeps drawing its
 * regular backdrop instead of stopping its wallpaper for a missing material.
 * @param {Electron.BrowserWindow} win
 */
function prepareWindowAcrylic(win) {
  if (backdrops.has(win)) return true;
  try {
    if (library === undefined) library = loadBackdropLibrary();
    if (!library) return false;
    const api = library;
    const handle = win.getNativeWindowHandle();
    const hwnd = handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE());
    const result = [null];
    checkResult(api.create(hwnd, result), 'initialization');
    const backdrop = result[0];
    const events = /** @type {NodeJS.EventEmitter} */ (win);
    let visible = false;
    const refresh = () => {
      const square = win.isFullScreen() || (isNativeWindowMaximized(win) ?? win.isMaximized());
      checkResult(api.update(backdrop, 1, square ? 0 : FRAME_RADIUS_DIP), 'update');
    };
    const state = {
      setVisible(/** @type {boolean} */ next) {
        if (visible === next) return;
        if (next) {
          refresh();
          for (const event of GEOMETRY_EVENTS) events.on(event, refresh);
        } else {
          for (const event of GEOMETRY_EVENTS) events.removeListener(event, refresh);
          checkResult(api.update(backdrop, 0, 0), 'hide');
        }
        visible = next;
      },
    };
    win.once('closed', () => {
      for (const event of GEOMETRY_EVENTS) events.removeListener(event, refresh);
      backdrops.delete(win);
      api.destroy(backdrop);
    });
    backdrops.set(win, state);
    return true;
  } catch (error) {
    console.warn('[window-acrylic] Cannot prepare window material:', error);
    return false;
  }
}

/** @param {Electron.BrowserWindow} win @param {boolean} visible */
function setWindowAcrylic(win, visible) {
  const backdrop = backdrops.get(win);
  if (!backdrop) return false;
  backdrop.setVisible(visible);
  return true;
}

module.exports = { prepareWindowAcrylic, setWindowAcrylic };
