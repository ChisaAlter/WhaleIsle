'use strict';

/**
 * Isolated Platform documents owned by the desktop account lifetime. Ported
 * from upstream apps/desktop/platform-view.ts; the owner window is our main
 * BrowserWindow (WebContentsView children of its contentView), and the
 * PlatformSession arrives via the loopback publisher instead of the
 * desktop-host process channel.
 */

const { createHash, randomUUID } = require('node:crypto');
const { WebContentsView, session, shell } = require('electron');
const { constantTimeEqual } = require('../shared/secret');

const PLATFORM_IPC = {
  bootstrap: 'dsh-platform:bootstrap',
  localeChanged: 'dsh-platform:locale-changed',
  open: 'dsh-platform:open',
  bounds: 'dsh-platform:bounds',
  close: 'dsh-platform:close',
};

/** Merge Cookie header pairs by case-sensitive name (upstream port). */
function mergePlatformCookies(base, override) {
  const cookies = new Map();
  for (const header of [base, override]) {
    for (const pair of String(header || '').split(';')) {
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

function desktopClientHeaders(platform) {
  if (platform === null) return {};
  return { 'x-client-platform': platform === 'win32' ? 'desktop-win' : 'desktop-mac' };
}

function platformClientHeaders(platform, client) {
  return {
    'x-client-bundle-id': '',
    'x-client-platform': 'web',
    ...desktopClientHeaders(platform),
    'x-client-version': String(client.version),
    'x-client-locale': String(client.locale).toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh_CN' : 'en_US',
    'x-client-timezone-offset': String(client.timezoneOffsetSeconds),
  };
}

/** Decode the renderer rectangle before allocating a native view. */
function platformBounds(value) {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid Platform bounds');
  const result = { x: 0, y: 0, width: 0, height: 0 };
  for (const key of ['x', 'y', 'width', 'height']) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000) throw new Error('Invalid Platform bounds');
    result[key] = Math.round(n);
  }
  return result;
}

class DesktopPlatformView {
  /**
   * @param {string} preload - platform preload path.
   * @param {() => 'en_US'|'zh_CN'} getLocale - current language.
   * @param {'darwin'|'win32'} platform - OS reported to Platform.
   * @param {() => object} clientMetadata - {version, locale, timezoneOffsetSeconds}.
   */
  constructor(preload, getLocale, platform, clientMetadata) {
    this.preload = preload;
    this.getLocale = getLocale;
    this.platform = platform;
    this.clientMetadata = clientMetadata;
    this.account = null;
    this.view = undefined;
    this.owner = undefined;
    this.releaseOwner = undefined;
    this.generation = 0;
    this.storageCleanup = new Map();
    this.disposed = false;
  }

  /** Private Host credentials; identity enrichment preserves an open temporary document. */
  setSession(next) {
    if (constantTimeEqual(next?.token ?? '', this.account?.token ?? '') && next?.origin === this.account?.origin
      && next?.embeddedPageDist === this.account?.embeddedPageDist
      && JSON.stringify(next?.requestHeaders) === JSON.stringify(this.account?.requestHeaders)) {
      if (next?.userId === this.account?.userId || this.account?.userId === null) {
        this.account = next;
        return;
      }
    }
    this.close();
    this.account = next;
  }

  async open(owner, page, bounds) {
    if (this.disposed) throw new Error('Platform view disposed');
    this.close();
    const account = this.account;
    if (account === null) throw new Error('Platform account unavailable');
    if (owner.isDestroyed()) return;
    const generation = this.generation;
    this.owner = owner;
    const closeOwnedView = () => { if (generation === this.generation) this.close(); };
    const navigateOwner = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) closeOwnedView();
    };
    owner.webContents.on('did-start-navigation', navigateOwner);
    owner.webContents.on('render-process-gone', closeOwnedView);
    owner.webContents.on('destroyed', closeOwnedView);
    owner.on('closed', closeOwnedView);
    this.releaseOwner = () => {
      owner.webContents.removeListener('did-start-navigation', navigateOwner);
      owner.webContents.removeListener('render-process-gone', closeOwnedView);
      owner.webContents.removeListener('destroyed', closeOwnedView);
      owner.removeListener('closed', closeOwnedView);
    };
    const partition = account.userId === null ? `dsh-platform-${randomUUID()}`
      : `persist:dsh-platform-${createHash('sha256').update(JSON.stringify([account.origin, account.userId])).digest('hex')}`;
    const browserSession = session.fromPartition(partition);
    const failure = await this.cleanStorage(browserSession);
    if (generation !== this.generation) return;
    if (failure !== null) {
      this.close();
      throw failure.error;
    }
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
    browserSession.setPermissionCheckHandler(() => false);
    const deploymentHeaders = account.requestHeaders ?? {};
    const injectedNames = new Set([...Object.keys(deploymentHeaders),
      ...Object.keys(platformClientHeaders(this.platform, this.clientMetadata()))]
      .map((name) => name.toLowerCase()));
    const injectedRequests = new Set();
    browserSession.webRequest.onCompleted((details) => { injectedRequests.delete(details.id); });
    browserSession.webRequest.onErrorOccurred((details) => { injectedRequests.delete(details.id); });
    browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      let headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]));
      if (new URL(details.url).origin === account.origin) {
        injectedRequests.add(details.id);
        const injected = {
          ...deploymentHeaders,
          ...platformClientHeaders(this.platform, this.clientMetadata()),
        };
        const cookie = headers.cookie ?? '';
        Object.assign(headers, injected);
        if (injected.cookie !== undefined) headers.cookie = mergePlatformCookies(cookie, injected.cookie);
      } else if (injectedRequests.has(details.id)) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => !injectedNames.has(name.toLowerCase())));
      }
      callback({ requestHeaders: headers });
    });
    const view = new WebContentsView({ webPreferences: {
      session: browserSession, preload: this.preload, sandbox: true, contextIsolation: true,
      additionalArguments: [`--dsh-platform-origin=${account.origin}`],
      nodeIntegration: false, webSecurity: true,
    } });
    this.view = view;
    view.webContents.setWindowOpenHandler(({ url }) => {
      const destination = new URL(url);
      if (destination.protocol === 'https:' && !destination.username && !destination.password) {
        void shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });
    const allowNavigation = (url) => {
      try {
        const parsed = new URL(url);
        return parsed.origin === account.origin && !parsed.username && !parsed.password;
      } catch { return false; }
    };
    view.webContents.on('will-navigate', (event, url) => { if (!allowNavigation(url)) event.preventDefault(); });
    view.webContents.on('will-redirect', (event, url) => { if (!allowNavigation(url)) event.preventDefault(); });
    view.webContents.on('will-attach-webview', (event) => { event.preventDefault(); });
    view.webContents.on('preload-error', () => { if (this.view === view) this.close(); });
    view.webContents.on('render-process-gone', () => { if (this.view === view) this.close(); });
    view.setVisible(false);
    owner.contentView.addChildView(view);
    view.setBounds(bounds);
    try {
      const url = new URL(page === 'usage' ? '/usage' : '/top_up', account.origin);
      if (account.embeddedPageDist) url.searchParams.set('dist', account.embeddedPageDist);
      await view.webContents.loadURL(url.href);
    } catch (error) {
      const aborted = error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED';
      if (!aborted) {
        if (generation === this.generation) this.close();
        throw error;
      }
    }
    if (generation === this.generation && this.view === view) view.setVisible(true);
  }

  setBounds(bounds) { this.view?.setBounds(bounds); }

  /** Return prepared credentials + locale only to the current Platform main frame. */
  bootstrap(event) {
    const view = this.view;
    const account = this.account;
    if (view === undefined || account === null || event.sender !== view.webContents
      || event.senderFrame !== view.webContents.mainFrame || new URL(event.senderFrame.url).origin !== account.origin) {
      throw new Error('Rejected Platform bootstrap');
    }
    return { origin: account.origin, token: account.token, locale: this.getLocale() };
  }

  notifyLocaleChanged() {
    const view = this.view;
    if (view !== undefined && !view.webContents.isDestroyed()) {
      view.webContents.send(PLATFORM_IPC.localeChanged, this.getLocale());
    }
  }

  /** Destroy the document and clear authentication; page preferences survive reopening. */
  close() {
    this.generation += 1;
    const view = this.view;
    this.view = undefined;
    this.releaseOwner?.();
    this.releaseOwner = undefined;
    const owner = this.owner;
    this.owner = undefined;
    if (view === undefined) return;
    if (owner !== undefined && !owner.isDestroyed()) owner.contentView.removeChildView(view);
    const browserSession = view.webContents.session;
    const destroyed = new Promise((resolve) => {
      if (view.webContents.isDestroyed()) resolve();
      else {
        view.webContents.once('destroyed', resolve);
        view.webContents.close({ waitForBeforeUnload: false });
      }
    });
    browserSession.webRequest.onBeforeSendHeaders(null);
    browserSession.webRequest.onCompleted(null);
    browserSession.webRequest.onErrorOccurred(null);
    browserSession.flushStorageData();
    void this.cleanStorage(browserSession, destroyed);
  }

  async dispose() {
    this.disposed = true;
    this.account = null;
    await this.closeAndWait();
  }

  async closeAndWait() {
    this.close();
    const results = await Promise.all(this.storageCleanup.values());
    const failures = results.filter((result) => result !== null);
    if (failures.length > 0) throw new AggregateError(failures.map((result) => result.error), 'Platform storage cleanup failed');
  }

  cleanStorage(browserSession, destroyed = Promise.resolve()) {
    const previous = this.storageCleanup.get(browserSession);
    const cleanup = Promise.all([previous, destroyed]).then(async () => {
      await browserSession.closeAllConnections();
      const results = await Promise.allSettled([
        browserSession.clearStorageData(browserSession.isPersistent()
          ? { storages: ['cookies', 'filesystem', 'indexdb', 'shadercache', 'serviceworkers', 'cachestorage'] } : undefined),
        browserSession.clearCache(),
        browserSession.clearAuthCache(),
      ]);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), 'Platform storage cleanup failed');
    }).then(() => null, (error) => ({ error }));
    this.storageCleanup.set(browserSession, cleanup);
    return cleanup;
  }
}

module.exports = { DesktopPlatformView, PLATFORM_IPC, platformBounds, mergePlatformCookies, platformClientHeaders };
