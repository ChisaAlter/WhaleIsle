'use strict';

const { systemNotificationsAllowed } = require('./system-notifications');

/**
 * defaultSession permission whitelist. The session hosts the harness
 * WebContentsView as well as the boot/launcher/welcome windows and the
 * generated Whale UI documents, all of which render model output and remote
 * data, so every permission not listed here is denied in both handlers.
 *
 * Granted permissions, and who may receive them:
 *   media                       primary harness main frame, loopback origin,
 *                               audio only (upstream microphone-permissions
 *                               policy adapted to our origin);
 *   clipboard-read              primary harness main frame, loopback origin
 *                               (terminal paste, settings import);
 *   clipboard-sanitized-write   same binding (copy actions, ClipboardItem);
 *   notifications               same binding, plus denied when raw system
 *                               notifications are unavailable;
 *   fullscreen                  any frame of the primary harness view —
 *                               embedded frames opt in through their own
 *                               allow/allowFullScreen attributes (the Whale
 *                               UI viewer and its YouTube embeds).
 */

/**
 * Non-media permissions granted to the primary harness view's main frame at
 * the loopback origin.
 */
const HARNESS_MAIN_FRAME_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
]);

function isHarnessOrigin(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Install the whitelist on the session hosting the harness view
 * (defaultSession). Requests from any other webContents, non-main frames, or
 * non-loopback origins are denied; local file:// pages on this session need
 * no web permissions.
 * @param {any} ses - the session hosting the harness view (defaultSession).
 * @param {() => any} primary - current primary harness webContents, or undefined.
 * @param {any} [systemPreferences]
 */
function installMediaPermissions(ses, primary, systemPreferences) {
  const darwinAccess = () => process.platform !== 'darwin'
    || (systemPreferences && systemPreferences.getMediaAccessStatus('microphone') === 'granted');
  const isPrimaryMainFrame = (contents, origin, details) => contents != null
    && contents === primary() && details?.isMainFrame === true && isHarnessOrigin(origin);
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (permission === 'media') {
      return contents != null && contents === primary() && details.isMainFrame
        && isHarnessOrigin(origin) && details.mediaType === 'audio'
        && darwinAccess();
    }
    if (HARNESS_MAIN_FRAME_PERMISSIONS.has(permission)) {
      return isPrimaryMainFrame(contents, origin, details)
        && (permission !== 'notifications' || systemNotificationsAllowed());
    }
    if (permission === 'fullscreen') {
      return contents != null && contents === primary();
    }
    return false;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'media') {
      const allowed = contents === primary() && details.isMainFrame
        && isHarnessOrigin(details.requestingUrl)
        && 'mediaTypes' in details && details.mediaTypes.length === 1
        && details.mediaTypes[0] === 'audio';
      if (!allowed) {
        callback(false);
        return;
      }
      if (process.platform !== 'darwin' || !systemPreferences) {
        callback(true);
        return;
      }
      void systemPreferences.askForMediaAccess('microphone').then(callback, () => callback(false));
      return;
    }
    if (HARNESS_MAIN_FRAME_PERMISSIONS.has(permission)) {
      callback(isPrimaryMainFrame(contents, details?.requestingUrl, details)
        && (permission !== 'notifications' || systemNotificationsAllowed()));
      return;
    }
    if (permission === 'fullscreen') {
      callback(contents === primary());
      return;
    }
    callback(false);
  });
}

module.exports = { installMediaPermissions, isHarnessOrigin };
