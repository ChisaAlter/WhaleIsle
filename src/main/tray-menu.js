'use strict';

/** @type {Electron.MenuItemConstructorOptions} */
const SEPARATOR = { type: 'separator' };

/**
 * Tray context-menu rows. Labels are the product copy for TC-DESK-002.
 * @param {{
 *   onShow: () => void,
 *   onOpenLauncher: () => void,
 *   onSettings: () => void,
 *   onMarketplace: () => void,
 *   onRestart: () => void,
 *   onQuit: () => void,
 *   onPetToggle: (enabled: boolean) => void,
 *   petEnabled: () => boolean,
 *   updateLabel?: () => string,
 *   onUpdate?: () => void,
 * }} actions
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function trayMenuTemplate({
  onShow, onOpenLauncher, onSettings, onMarketplace, onRestart, onQuit, onPetToggle, petEnabled, updateLabel, onUpdate,
}) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const petItem = typeof onPetToggle === 'function' && typeof petEnabled === 'function'
    ? [{
        label: '桌面宠物',
        type: 'checkbox',
        checked: petEnabled(),
        click: (/** @type {Electron.MenuItem} */ item) => onPetToggle(typeof item?.checked === 'boolean' ? item.checked : !petEnabled()),
      }]
    : [];
  return [
    { label: '显示窗口', click: () => onShow() },
    { label: '打开启动器', click: () => onOpenLauncher() },
    { label: '设置…', click: () => onSettings() },
    { label: '插件市场', click: () => onMarketplace() },
    { label: '重启 Harness', click: () => onRestart() },
    ...petItem,
    ...(typeof updateLabel === 'function' && typeof onUpdate === 'function'
      ? [SEPARATOR, { label: updateLabel(), click: () => onUpdate() }]
      : []),
    SEPARATOR,
    { label: '退出', click: () => onQuit() },
  ];
}

module.exports = { trayMenuTemplate };
