'use strict';

const path = require('path');

const DESKTOP_DSH_HOME_DIRNAME = 'dsh-home';
const UNSET_ERROR = 'desktop DSH home is not configured';

let configuredHome = '';

/**
 * @param {unknown} userData
 * @returns {string}
 */
function desktopDshHomeFromUserData(userData) {
  if (typeof userData !== 'string' || !userData.trim()) {
    throw new Error(UNSET_ERROR);
  }
  return path.join(path.resolve(userData.trim()), DESKTOP_DSH_HOME_DIRNAME);
}

/**
 * @param {unknown} dir
 * @returns {string}
 */
function setDesktopDshHome(dir) {
  if (typeof dir !== 'string' || !dir.trim()) {
    throw new Error(UNSET_ERROR);
  }
  configuredHome = path.resolve(dir.trim());
  return configuredHome;
}

function clearDesktopDshHome() {
  configuredHome = '';
}

function getDesktopDshHome() {
  const fromEnv = process.env.DSHD_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) {
    return path.resolve(fromEnv.trim());
  }
  if (configuredHome) {
    return configuredHome;
  }
  throw new Error(UNSET_ERROR);
}

function tryGetDesktopDshHome() {
  try {
    return getDesktopDshHome();
  } catch {
    return '';
  }
}

/**
 * In packaged builds an inherited `DSHD_HOME` must not silently redirect the
 * desktop home away from `userData/dsh-home`; it is honored only with the
 * explicit `DSHD_ALLOW_ENV_HOME=1` switch. Dev / debug (non-packaged) runs
 * keep the override as-is. Call once at main-process startup, before the
 * home is first resolved.
 * @param {{ isPackaged?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ dropped: boolean, value: string }}
 */
function sanitizePackagedDshHomeEnv({ isPackaged = false, env = process.env } = {}) {
  const value = typeof env.DSHD_HOME === 'string' ? env.DSHD_HOME : '';
  if (!isPackaged || !value.trim() || env.DSHD_ALLOW_ENV_HOME === '1') {
    return { dropped: false, value };
  }
  delete env.DSHD_HOME;
  return { dropped: true, value };
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {NodeJS.ProcessEnv}
 */
function applyDesktopDshHome(env = {}) {
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.toUpperCase() === 'DSH_HOME') delete next[key];
  }
  next.DSH_HOME = getDesktopDshHome();
  return next;
}

module.exports = {
  DESKTOP_DSH_HOME_DIRNAME,
  desktopDshHomeFromUserData,
  setDesktopDshHome,
  clearDesktopDshHome,
  getDesktopDshHome,
  tryGetDesktopDshHome,
  applyDesktopDshHome,
  sanitizePackagedDshHomeEnv,
};
