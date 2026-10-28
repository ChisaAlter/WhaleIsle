const { Tray, Menu, nativeImage } = require('electron');
const { showMain, iconImage, openHarnessSettings, openMarketplace } = require('./window');
const { assetFile } = require('./paths');
const { trayMenuTemplate } = require('./tray-menu');

let tray = null;
let trayActions = null;
let trayMenuParams = null;

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

  trayActions = {
    show: onShow || (() => showMain()),
    openLauncher: onOpenLauncher || (() => {}),
    settings: () => { openHarnessSettings(); },
    marketplace: () => { openMarketplace(); },
    restart: onRestart,
    quit: onQuit,
    petToggle: onPetToggle || (() => {}),
  };
  tray = new Tray(image && !image.isEmpty() ? image : nativeImage.createEmpty());
  tray.setToolTip('Whale Isle');
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
  return tray;
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

module.exports = {
  createTray,
  refreshTrayMenu,
  showMain,
  trayMenuTemplate,
  invokeTrayAction,
};
