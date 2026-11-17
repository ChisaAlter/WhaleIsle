'use strict';

const { tryGetDesktopDshHome } = require('../shared/dsh-home');

/**
 * @param {string} target
 * @returns {Promise<string>}
 */
function defaultOpenPath(target) {
  return require('electron').shell.openPath(target);
}

/**
 * Open the bound desktop Harness home in the OS file manager.
 * Callers must not pass a filesystem path; only the bound home is opened.
 * @param {{ getHome?: () => string, openPath?: (target: string) => Promise<string> }} [deps]
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
async function openDesktopDshHome(deps = {}) {
  const getHome = typeof deps.getHome === 'function' ? deps.getHome : tryGetDesktopDshHome;
  const openPath = typeof deps.openPath === 'function' ? deps.openPath : defaultOpenPath;
  const home = getHome();
  if (!home) {
    return { ok: false, error: 'desktop DSH home is not configured' };
  }
  try {
    const error = await openPath(home);
    if (error) return { ok: false, error: String(error) };
    return { ok: true, path: home };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

module.exports = {
  openDesktopDshHome,
};
