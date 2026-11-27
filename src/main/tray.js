const { Tray, Menu, nativeImage } = require('electron');
const { showMain, iconImage, openHarnessSettings, openMarketplace } = require('./window');
const { assetFile } = require('./paths');
const { trayMenuTemplate } = require('./tray-menu');

/** @type {Electron.Tray | null} */
let tray = null;
let trayActions = null;
let trayMenuParams = null;
/** @type {Electron.NativeImage | null} */
let baseTrayImage = null;
/** @type {{ width: number, height: number, bgra: Buffer } | null} */
let baseTrayBitmap = null;
/** @type {{ image?: Electron.NativeImage, tooltip?: string } | null | undefined} */
let pendingTrayBadge;

/** @param {{ image?: Electron.NativeImage, tooltip?: string } | null} indicator */
function applyTrayBadge(indicator) {
  if (!tray) return;
  if (!indicator) {
    if (baseTrayImage && !baseTrayImage.isEmpty()) {
      tray.setImage(baseTrayImage);
    }
    tray.setToolTip('WhaleIsle');
    return;
  }
  if (indicator.image && !indicator.image.isEmpty()) {
    tray.setImage(indicator.image);
  } else if (baseTrayImage && !baseTrayImage.isEmpty()) {
    tray.setImage(baseTrayImage);
  }
  tray.setToolTip(typeof indicator.tooltip === 'string' && indicator.tooltip ? indicator.tooltip : 'WhaleIsle');
}

function createTray({ onShow, onOpenLauncher, onRestart, onQuit, onPetToggle, petEnabled, updateLabel, onUpdate }) {
  if (tray) {
    return tray;
  }

  let image = iconImage();
  if (!image || image.isEmpty()) {
    image = nativeImage.createFromPath(assetFile('icon.svg'));
  }
  if (process.platform === 'win32' && image && !image.isEmpty()) {
    image = image.resize({ width: 24, height: 24 });
  }
  baseTrayImage = image && !image.isEmpty() ? image : null;
  if (baseTrayImage && typeof baseTrayImage.getSize === 'function' && typeof baseTrayImage.toBitmap === 'function') {
    const size = baseTrayImage.getSize();
    const bgra = baseTrayImage.toBitmap();
    if (size.width > 0 && size.height > 0 && bgra.length === size.width * size.height * 4) {
      baseTrayBitmap = { width: size.width, height: size.height, bgra };
    }
  }

  trayActions = {
    show: onShow || (() => showMain()),
    openLauncher: onOpenLauncher || (() => {}),
    settings: () => { openHarnessSettings(); },
    marketplace: () => { openMarketplace(); },
    restart: onRestart,
    quit: onQuit,
    petToggle: onPetToggle || (() => {}),
  };
  tray = new Tray(baseTrayImage || nativeImage.createEmpty());
  tray.setToolTip('WhaleIsle');
  trayMenuParams = {
    onShow: trayActions.show,
    onOpenLauncher: trayActions.openLauncher,
    onSettings: trayActions.settings,
    onMarketplace: trayActions.marketplace,
    onRestart,
    onQuit,
    onPetToggle: trayActions.petToggle,
    petEnabled,
    updateLabel,
    onUpdate,
  };
  refreshTrayMenu();
  tray.on('click', () => trayActions.show());
  if (pendingTrayBadge !== undefined) {
    applyTrayBadge(pendingTrayBadge);
    pendingTrayBadge = undefined;
  }
  return tray;
}

function getBaseTrayIcon() {
  return baseTrayBitmap;
}

/** @param {{ image?: Electron.NativeImage, tooltip?: string } | null} indicator */
function setTrayBadge(indicator) {
  if (!tray) {
    pendingTrayBadge = indicator ?? null;
    return;
  }
  applyTrayBadge(indicator ?? null);
}

// The template's `checked: petEnabled()` is a build-time snapshot — toggles
// that bypass this menu (the pet's own 隐藏 row, the settings page) leave a
// stale check behind, so the pet manager pings us to rebuild on every flip.
function refreshTrayMenu() {
  if (!tray || !trayMenuParams) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(trayMenuParams)));
}

function invokeTrayAction(name) {
  const action = trayActions && trayActions[name];
  if (typeof action !== 'function') {
    throw new Error(`Tray action is not registered: ${name}`);
  }
  return action();
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch {
    // Tray already destroyed during app shutdown.
  }
  tray = null;
  trayActions = null;
  trayMenuParams = null;
  pendingTrayBadge = undefined;
}

module.exports = {
  createTray,
  destroyTray,
  getBaseTrayIcon,
  setTrayBadge,
  refreshTrayMenu,
  invokeTrayAction,
};
