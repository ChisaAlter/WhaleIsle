'use strict';

/**
 * Raw Windows Electron notifications register a Start Menu Electron.lnk using
 * the binary's PE name and our installed AppID. Even isSupported initializes
 * that presenter, so the development boundary precedes all Electron calls.
 * Packaged applications and other platforms retain their notification policy.
 * @param {{ platform?: string, defaultApp?: boolean }} [environment]
 */
function systemNotificationsAllowed({ platform = process.platform, defaultApp = process.defaultApp } = {}) {
  return platform !== 'win32' || defaultApp !== true;
}

/**
 * Check support only when it cannot register the raw Electron shortcut.
 * @param {{ isSupported: () => boolean }} Notification
 * @param {{ platform?: string, defaultApp?: boolean }} [environment]
 */
function systemNotificationsSupported(Notification, environment) {
  return systemNotificationsAllowed(environment) && Notification.isSupported();
}

module.exports = { systemNotificationsAllowed, systemNotificationsSupported };
