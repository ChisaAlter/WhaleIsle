'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { discoverCodexPets } = require('./desktop-pets');
const { createRegisterIpc } = require('./ipc-register');

const PET_SIZE = 88;
const EDGE_GAP = 16;
const DEFAULT_POSITION = Object.freeze({ enabled: true, xRatio: 0.82, yRatio: 0.72 });

// Feature switch: false hides the desktop pet entirely (no BrowserView mount,
// no tray item) while keeping the code path for a later re-enable.
const DESKTOP_PET_FEATURE = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizePetState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: source.enabled !== false,
    xRatio: clamp(finite(source.xRatio, DEFAULT_POSITION.xRatio), 0, 1),
    yRatio: clamp(finite(source.yRatio, DEFAULT_POSITION.yRatio), 0, 1),
    petId: typeof source.petId === 'string' ? source.petId : '',
  };
}

function contentBoundsFor(win) {
  const bounds = typeof win?.getContentBounds === 'function' ? win.getContentBounds() : {};
  return {
    width: Math.max(1, Math.round(finite(bounds.width, 1))),
    height: Math.max(1, Math.round(finite(bounds.height, 1))),
  };
}

function boundsForPosition(windowBounds, state) {
  const width = Math.min(PET_SIZE, windowBounds.width);
  const height = Math.min(PET_SIZE, windowBounds.height);
  const minX = Math.min(EDGE_GAP, Math.max(0, windowBounds.width - width));
  const minY = Math.min(EDGE_GAP, Math.max(0, windowBounds.height - height));
  const maxX = Math.max(minX, windowBounds.width - width - EDGE_GAP);
  const maxY = Math.max(minY, windowBounds.height - height - EDGE_GAP);
  return {
    x: Math.round(minX + state.xRatio * (maxX - minX)),
    y: Math.round(minY + state.yRatio * (maxY - minY)),
    width,
    height,
  };
}

function positionFromBounds(windowBounds, x, y) {
  const width = Math.min(PET_SIZE, windowBounds.width);
  const height = Math.min(PET_SIZE, windowBounds.height);
  const minX = Math.min(EDGE_GAP, Math.max(0, windowBounds.width - width));
  const minY = Math.min(EDGE_GAP, Math.max(0, windowBounds.height - height));
  const maxX = Math.max(minX, windowBounds.width - width - EDGE_GAP);
  const maxY = Math.max(minY, windowBounds.height - height - EDGE_GAP);
  return {
    xRatio: maxX === minX ? 0 : clamp((clamp(x, minX, maxX) - minX) / (maxX - minX), 0, 1),
    yRatio: maxY === minY ? 0 : clamp((clamp(y, minY, maxY) - minY) / (maxY - minY), 0, 1),
  };
}

function isPetFrameUrl(url, petUrl) {
  try {
    const actual = new URL(url);
    const expected = new URL(petUrl);
    return actual.protocol === expected.protocol
      && path.normalize(decodeURIComponent(actual.pathname)) === path.normalize(decodeURIComponent(expected.pathname));
  } catch {
    return false;
  }
}

function createDesktopPetManager(options = {}) {
  const electron = options.electron || require('electron');
  const BrowserView = options.BrowserView || electron.BrowserView;
  const Menu = options.Menu || electron.Menu;
  const ipcMain = options.ipcMain || electron.ipcMain;
  const rendererFile = options.rendererFile || require('./paths').rendererFile;
  const preloadFile = options.preloadFile || require('./paths').preloadFile;
  const loadConfig = options.loadConfig || require('./config').loadConfig;
  const saveConfig = options.saveConfig || require('./config').saveConfig;
  const currentTheme = options.currentTheme || (() => ({}));
  const discoverPets = options.discoverPets || (() => discoverCodexPets());
  const petUrl = pathToFileURL(rendererFile('pet.html')).href;

  let state = normalizePetState(loadConfig()?.pet);
  let view = null;
  let hostWindow = null;
  let lastBounds = null;
  let handlersRegistered = false;

  function persist() {
    state = normalizePetState(state);
    saveConfig({ pet: state });
  }

  function isAuthorized(event) {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    return Boolean(view && sender === view.webContents && frame === sender.mainFrame && isPetFrameUrl(frame.url, petUrl));
  }

  function assertAuthorized(event) {
    if (!isAuthorized(event)) {
      const error = new Error('Unauthorized pet IPC sender');
      error.code = 'ERR_DSH_PET_IPC_SENDER';
      throw error;
    }
  }

  function currentWindowBounds() {
    return contentBoundsFor(hostWindow);
  }

  function layout(targetWindow = hostWindow) {
    if (!view || !targetWindow || targetWindow.isDestroyed?.()) {
      return null;
    }
    const next = boundsForPosition(contentBoundsFor(targetWindow), state);
    lastBounds = next;
    view.setBounds(next);
    view.setAutoResize?.({ width: false, height: false });
    return next;
  }

  function bringToFront(targetWindow = hostWindow) {
    if (!view || !targetWindow || targetWindow.isDestroyed?.()) {
      return;
    }
    if (typeof targetWindow.getBrowserViews === 'function' && !targetWindow.getBrowserViews().includes(view)) {
      targetWindow.addBrowserView(view);
    }
    targetWindow.setTopBrowserView?.(view);
  }

  function removeView(targetWindow = hostWindow) {
    if (!view) {
      hostWindow = null;
      lastBounds = null;
      return;
    }
    try {
      targetWindow?.removeBrowserView?.(view);
    } catch {
      // The window may already be closing.
    }
    if (!view.webContents.isDestroyed?.()) {
      view.webContents.close?.();
    }
    view = null;
    hostWindow = null;
    lastBounds = null;
  }

  function createView(targetWindow) {
    view = new BrowserView({
      backgroundColor: '#00000000',
      webPreferences: {
        preload: preloadFile(),
        additionalArguments: ['--dshd-shell-role=pet'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    hostWindow = targetWindow;
    targetWindow.addBrowserView(view);
    view.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    view.webContents.on?.('will-navigate', (event, url) => {
      if (!isPetFrameUrl(url, petUrl)) {
        event.preventDefault();
      }
    });
    layout(targetWindow);
    void view.webContents.loadFile(rendererFile('pet.html'));
    return view;
  }

  function show(targetWindow) {
    if (!state.enabled || !targetWindow || targetWindow.isDestroyed?.()) {
      return null;
    }
    if (!view) {
      createView(targetWindow);
    } else {
      hostWindow = targetWindow;
      bringToFront(targetWindow);
      layout(targetWindow);
    }
    view.webContents.send?.('shell:theme', currentTheme());
    return view;
  }

  function hide(targetWindow = hostWindow) {
    removeView(targetWindow);
  }

  function setEnabled(enabled, targetWindow = hostWindow) {
    state = { ...state, enabled: enabled === true };
    persist();
    if (state.enabled) {
      show(targetWindow);
    } else {
      hide(targetWindow);
    }
    return { ...state };
  }

  function commitDrag(payload = {}) {
    if (!view || !lastBounds || !hostWindow) {
      return { ...state };
    }
    const next = positionFromBounds(
      currentWindowBounds(),
      lastBounds.x + finite(payload.deltaX),
      lastBounds.y + finite(payload.deltaY),
    );
    state = { ...state, ...next };
    persist();
    layout(hostWindow);
    return { ...state };
  }

  function setTheme(theme) {
    view?.webContents.send?.('shell:theme', theme);
  }

  function resolvePet(pets = discoverPets()) {
    const selected = pets.find((pet) => pet.id === state.petId);
    return selected || pets[0] || null;
  }

  function petPayload(pets = discoverPets()) {
    const pet = resolvePet(pets);
    return {
      ...state,
      pet: pet ? {
        id: pet.id,
        displayName: pet.displayName,
        version: pet.version,
        cols: pet.cols,
        rows: pet.rows,
        cellWidth: pet.cellWidth,
        cellHeight: pet.cellHeight,
        sheetUrl: pathToFileURL(pet.sheetPath).href,
      } : null,
      pets: pets.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        version: entry.version,
      })),
      theme: currentTheme(),
    };
  }

  function pushState() {
    view?.webContents.send?.('shell:pet-state', petPayload());
  }

  function setPet(petId) {
    state = { ...state, petId: typeof petId === 'string' ? petId : '' };
    persist();
    pushState();
    return { ...state };
  }

  function openMenu() {
    if (!view || !hostWindow || hostWindow.isDestroyed?.()) {
      return;
    }
    const pets = discoverPets();
    const active = resolvePet(pets);
    const template = pets.map((pet) => ({
      label: pet.displayName,
      type: 'radio',
      checked: active?.id === pet.id,
      click: () => setPet(pet.id),
    }));
    if (template.length) {
      template.push({ type: 'separator' });
    }
    template.push({ label: '隐藏桌面宠物', click: () => setEnabled(false) });
    const menu = Menu.buildFromTemplate(template);
    const anchor = lastBounds || { x: 0, y: 0, width: 0, height: 0 };
    menu.popup({
      window: hostWindow,
      x: Math.round(anchor.x + anchor.width / 2),
      y: Math.round(anchor.y + anchor.height),
    });
  }

  function registerHandlers() {
    if (handlersRegistered || !ipcMain?.handle) {
      return;
    }
    const register = createRegisterIpc(ipcMain);
    register({ channel: 'shell:pet-state', authorize: assertAuthorized, handler: () => petPayload() });
    register({
      channel: 'shell:pet-drag-commit',
      authorize: assertAuthorized,
      handler: (_event, payload) => commitDrag(payload),
    });
    register({ channel: 'shell:pet-menu', authorize: assertAuthorized, handler: () => { openMenu(); return null; } });
    handlersRegistered = true;
  }

  function dispose() {
    hide();
    if (handlersRegistered) {
      ipcMain.removeHandler?.('shell:pet-state');
      ipcMain.removeHandler?.('shell:pet-drag-commit');
      ipcMain.removeHandler?.('shell:pet-menu');
      handlersRegistered = false;
    }
  }

  registerHandlers();
  return {
    show,
    hide,
    layout,
    bringToFront,
    setEnabled,
    setPet,
    setTheme,
    commitDrag,
    openMenu,
    petPayload,
    discoverPets,
    dispose,
    getState: () => ({ ...state }),
    isEnabled: () => state.enabled,
    getView: () => view,
    getBounds: () => (lastBounds ? { ...lastBounds } : null),
  };
}

let activeManager = null;

function configureDesktopPet(options) {
  if (!DESKTOP_PET_FEATURE) {
    return null;
  }
  activeManager?.dispose();
  activeManager = createDesktopPetManager(options);
  return activeManager;
}

function getDesktopPet() {
  return DESKTOP_PET_FEATURE ? activeManager : null;
}

module.exports = {
  DESKTOP_PET_FEATURE,
  PET_SIZE,
  EDGE_GAP,
  DEFAULT_POSITION,
  clamp,
  normalizePetState,
  boundsForPosition,
  positionFromBounds,
  isPetFrameUrl,
  createDesktopPetManager,
  configureDesktopPet,
  getDesktopPet,
};
