'use strict';

const { app, nativeTheme } = require('electron');
const { currentVersion } = require('./update');

/**
 * Desktop account integration extracted from index.js (#439 P3-4). Optional
 * and never owns workspace entry: the welcome backend connects lazily on the
 * first Harness target, the account watch only refreshes embedded Platform
 * identity, and pending initializations deduplicate. `platformView` /
 * `platformSessionRefresh` stay on the shared shell state because the
 * whenReady phase constructs them. Behavior unchanged.
 *
 * @param {object} deps
 * @param {import('./app-shell-state').ShellState} deps.state
 * @param {{ sessionCookie: string }} deps.dsh
 */
function createDesktopAccount({ state, dsh }) {
  // Desktop account integration is optional and never owns workspace entry.
  /** @type {any} */
  let welcomeBackend;
  /** @type {any} */
  let welcomeLocale;
  /** @type {any} */
  let openedAttempt;
  /** @type {any} */
  let previousAccountStatus;
  /** @type {(() => void)|undefined} */
  let stopAccount;
  /** @type {Promise<void>|undefined} */
  let initializingDesktopAccount;

  /**
   * @param {string} authorizeUrl
   */
  function platformLoginUrl(authorizeUrl) {
    const url = new URL(authorizeUrl);
    url.searchParams.set('theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    return url.href;
  }

  function welcomeClientMetadata() {
    return {
      version: currentVersion(),
      locale: welcomeLocale?.id ?? 'zh-CN',
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    };
  }

  function startAccountWatch() {
    stopAccount?.();
    if (welcomeBackend === undefined) return;
    stopAccount = welcomeBackend.account.watch((/** @type {any} */ accountState) => {
      if (state.quitting) return;
      // Keep embedded Platform identity current without hiding the workspace.
      if (accountState.status !== previousAccountStatus) void state.platformSessionRefresh?.();
      const attempt = accountState.attempt;
      if (attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && openedAttempt !== attempt.id) {
        openedAttempt = attempt.id;
        void require('./open-external').openExternalHttp(platformLoginUrl(attempt.authorizeUrl)).catch(() => undefined);
      }
      previousAccountStatus = accountState.status;
    }, () => {
      // The stream reconnects; transport failures never redirect the workspace.
    }, () => {
      if (!state.quitting) void state.platformSessionRefresh?.();
    });
  }

  /**
   * @param {string} targetUrl
   */
  async function initializeDesktopAccount(targetUrl) {
    if (state.quitting || welcomeBackend !== undefined) return;
    if (initializingDesktopAccount) return initializingDesktopAccount;
    initializingDesktopAccount = (async () => {
      try {
        const { connectWelcome } = require('./welcome-backend');
        const { resolveDesktopStartupLocale } = require('./desktop-locale');
        welcomeBackend = await connectWelcome(new URL(targetUrl).origin, () => dsh.sessionCookie);
        if (state.quitting) return;
        startAccountWatch();
        const preference = await welcomeBackend.readLocalePreference();
        const languages = [];
        try { languages.push(app.getLocale()); } catch { /* pre-ready */ }
        welcomeLocale = resolveDesktopStartupLocale(preference, languages.length === 0 ? ['zh-CN'] : languages);
      } catch (error) {
        console.warn('dshd account: initialization failed', error);
      }
    })().finally(() => { initializingDesktopAccount = undefined; });
    return initializingDesktopAccount;
  }

  /**
   * The whenReady phase reads the negotiated locale for the PlatformView
   * session parameter.
   * @returns {string|undefined}
   */
  function getWelcomeLocaleId() {
    return welcomeLocale?.id;
  }

  return {
    welcomeClientMetadata,
    initializeDesktopAccount,
    getWelcomeLocaleId,
  };
}

module.exports = { createDesktopAccount };
