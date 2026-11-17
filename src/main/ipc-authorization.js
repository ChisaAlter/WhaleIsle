const {
  isLocalAppNavigationUrl,
  isLauncherNavigationUrl,
  isSameOriginLoopbackUrl,
} = require('./local-url');

const IPC_ROLES = Object.freeze({
  BOOT: 'boot',
  HARNESS: 'harness',
  LAUNCHER: 'launcher',
});

/**
 * ipcMain 事件的结构化最低形态：sender 为 WebContents，senderFrame 为顶层
 * Frame（带 url 属性）。Electron 事件对象满足该形状；测试注入的同形替身
 * 也满足。
 * @typedef {Object} IpcEventLike
 * @property {{ isDestroyed?(): boolean, mainFrame?: { url?: unknown } }} [sender]
 * @property {{ url?: unknown }} [senderFrame]
 */

/**
 * @typedef {Object} IpcSenderOptions
 * @property {{ boot?: unknown, harness?: unknown, harnessOrigin?: unknown, launcher?: unknown }} [surfaces]
 * @property {(url: unknown) => boolean} [isBootUrl]
 * @property {(url: unknown, expected: unknown) => boolean} [isHarnessUrl]
 * @property {(url: unknown) => boolean} [isLauncherUrl]
 */

function defaultSurfaces() {
  const {
    getMainWindow,
    getHarnessWebContents,
    getHarnessOrigin,
    getLauncherWindow,
  } = require('./window');
  const mainWindow = getMainWindow();
  const launcherWindow = getLauncherWindow();
  return {
    boot: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null,
    harness: getHarnessWebContents(mainWindow),
    harnessOrigin: getHarnessOrigin(),
    launcher: launcherWindow && !launcherWindow.isDestroyed() ? launcherWindow.webContents : null,
  };
}

/**
 * @param {IpcEventLike | null | undefined} event
 * @param {IpcSenderOptions} [options]
 * @returns {string | null}
 */
function ipcSenderRole(event, options = {}) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (
    !sender
    || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())
    || !frame
    || frame !== sender.mainFrame
    || typeof frame.url !== 'string'
  ) {
    return null;
  }

  const surfaces = options.surfaces || defaultSurfaces();
  const bootUrl = options.isBootUrl || isLocalAppNavigationUrl;
  const harnessUrl = options.isHarnessUrl || isSameOriginLoopbackUrl;
  const launcherUrl = options.isLauncherUrl || isLauncherNavigationUrl;

  if (sender === surfaces.boot && bootUrl(frame.url)) {
    return IPC_ROLES.BOOT;
  }
  if (sender === surfaces.harness && harnessUrl(frame.url, surfaces.harnessOrigin)) {
    return IPC_ROLES.HARNESS;
  }
  if (sender === surfaces.launcher && launcherUrl(frame.url)) {
    return IPC_ROLES.LAUNCHER;
  }
  return null;
}

/**
 * @param {IpcEventLike | null | undefined} event
 * @param {Iterable<string> | Set<string> | null | undefined} allowedRoles
 * @param {IpcSenderOptions} [options]
 * @returns {string}
 */
function assertIpcSender(event, allowedRoles, options) {
  const allowed = allowedRoles instanceof Set ? allowedRoles : new Set(allowedRoles || []);
  const role = ipcSenderRole(event, options);
  if (!role || !allowed.has(role)) {
    throw Object.assign(new Error('Unauthorized IPC sender'), { code: 'ERR_DSH_IPC_SENDER' });
  }
  return role;
}

module.exports = { IPC_ROLES, ipcSenderRole, assertIpcSender };
