'use strict';

/**
 * Platform document preload (upstream preload-platform-account): the isolated
 * frame receives its credentials once via a sync bootstrap and exposes the
 * embedded `dsh` bridge; token getters never perform IPC. Self-contained so
 * it stays sandbox-safe — no local requires.
 */

const { contextBridge, ipcRenderer } = require('electron');

const IPC = {
  bootstrap: 'dsh-platform:bootstrap',
  localeChanged: 'dsh-platform:locale-changed',
};

const originArgument = '--dsh-platform-origin=';
const allowedOrigin = process.argv.find((argument) => argument.startsWith(originArgument))?.slice(originArgument.length);
if (process.isMainFrame && location.origin === allowedOrigin) {
  /** @type {string | undefined} */
  let token;
  /** @type {string | undefined} */
  let locale;
  /** @type {Set<(value: string) => void>} */
  const localeListeners = new Set();
  ipcRenderer.on(IPC.localeChanged, (_event, /** @type {unknown} */ value) => {
    if (value !== 'en_US' && value !== 'zh_CN') return;
    locale = value;
    for (const listener of localeListeners) {
      try { listener(value); } catch (error) { console.error('Platform locale listener failed', error); }
    }
  });
  try {
    const value = ipcRenderer.sendSync(IPC.bootstrap);
    if (typeof value === 'object' && value !== null && 'token' in value && 'origin' in value
      && typeof value.token === 'string' && value.token.length > 0 && value.origin === location.origin
      && 'locale' in value && (value.locale === 'en_US' || value.locale === 'zh_CN')) {
      token = value.token;
      locale = value.locale;
    }
  } catch {
    // Initialization failure retains embedded mode so Platform cannot use browser credentials.
  }
  contextBridge.exposeInMainWorld('dsh', {
    protocolVersion: 1,
    displayMode: 'embedded',
    getLocale: () => {
      if (locale === undefined) throw new Error('Platform locale initialization failed');
      return locale;
    },
    onLocaleChange: (/** @type {(value: string) => void} */ listener) => {
      localeListeners.add(listener);
      return () => { localeListeners.delete(listener); };
    },
    getAuthToken: () => {
      if (token === undefined) throw new Error('Platform initialization failed');
      return token;
    },
  });
}
