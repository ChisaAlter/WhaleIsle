'use strict';

/**
 * Main-process ownership and fixed isolation policy for Sidebar webview
 * guests. Ported from upstream apps/desktop/browser-guests.ts; the owner is
 * the harness BrowserView's webContents (the product document), and the
 * Host-exclusion targets our loopback origin.
 */

const { randomUUID } = require('node:crypto');
const { app, session } = require('electron');
const { createRegisterIpc } = require('./ipc-register');

const CHANNELS = {
  acquire: 'shell:browser-acquire',
  release: 'shell:browser-release',
  openRequested: 'shell:browser-open-requested',
};

class BrowserGuests {
  /**
   * @param {() => string | undefined} hostUrl - current harness Host origin;
   *   guests cannot request it.
   * @param {(partition: string) => object} [fromPartition] - Electron
   *   session.fromPartition (injected for tests).
   */
  constructor(hostUrl, fromPartition = (partition) => session.fromPartition(partition)) {
    this.hostUrl = hostUrl;
    this.fromPartition = fromPartition;
    this.partitions = new Map();
    this.leases = new Map();
  }

  /**
   * Reserve one guest in a workspace's process-lifetime partition.
   * @param {object} owner - authenticated product-document WebContents.
   * @param {unknown} workspace - workspace identity received over IPC.
   * @returns {{ lease: string, partition: string }}
   */
  acquire(owner, workspace) {
    if (typeof workspace !== 'string' || workspace.length === 0 || workspace.length > 4096) {
      throw new Error('dshd browser: a workspace storage identity is required');
    }
    let partition = this.partitions.get(workspace);
    if (partition === undefined) {
      partition = `dsh-sidebar-browser-${randomUUID()}`;
      this.configureSession(this.fromPartition(partition));
      this.partitions.set(workspace, partition);
    }
    const lease = randomUUID();
    this.leases.set(lease, { owner, partition, attached: false });
    return { lease, partition };
  }

  /** Release only a lease issued to this document; workspace storage survives. */
  async release(owner, id) {
    if (typeof id !== 'string') throw new Error('dshd browser: invalid guest lease');
    const lease = this.leases.get(id);
    if (lease === undefined) return;
    if (lease.owner !== owner) throw new Error('dshd browser: guest belongs to another document');
    lease.releaseInput?.();
    this.leases.delete(id);
    const guest = lease.guest;
    if (guest !== undefined && !guest.isDestroyed()) {
      const destroyed = new Promise((resolve) => { guest.once('destroyed', resolve); });
      guest.close({ waitForBeforeUnload: false });
      await destroyed;
    }
  }

  /**
   * Install attachment checks before the product document can create a webview.
   * @param {object} ownerContents - harness view webContents (webview host).
   * @param {object} window - owning product window (for shortcut focus checks).
   * @param {(guest: object, name: string) => () => void} attachInput
   */
  bind(ownerContents, window, attachInput) {
    const owner = ownerContents;
    owner.on('will-attach-webview', (event, preferences, params) => {
      const id = typeof params.src === 'string' && params.src.startsWith('about:blank#')
        ? params.src.slice('about:blank#'.length) : '';
      const lease = this.leases.get(id);
      if (lease === undefined || lease.owner !== owner || lease.attached || params.partition !== lease.partition) {
        event.preventDefault();
        return;
      }
      lease.attached = true;
      for (const key of Object.keys(preferences)) {
        if (key !== 'disablePopups') Reflect.deleteProperty(preferences, key);
      }
      Object.assign(preferences, {
        partition: lease.partition,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        webviewTag: false, plugins: false, navigateOnDragDrop: false, disableDialogs: true,
        devTools: !app.isPackaged,
      });
      params.httpreferrer = '';
    });
    owner.on('did-attach-webview', (_event, guest) => {
      let attachedLease;
      guest.once('dom-ready', () => {
        const url = guest.getURL();
        const id = url.startsWith('about:blank#') ? url.slice('about:blank#'.length) : '';
        const lease = this.leases.get(id);
        if (lease === undefined || lease.owner !== owner || lease.guest !== undefined) {
          guest.close({ waitForBeforeUnload: false });
          return;
        }
        lease.guest = guest;
        attachedLease = id;
        lease.releaseInput = attachInput(guest, id);
        guest.once('destroyed', () => { lease.releaseInput?.(); this.leases.delete(id); });
      });
      guest.setWindowOpenHandler(({ url, postBody }) => {
        const lease = attachedLease === undefined ? undefined : this.leases.get(attachedLease);
        if (attachedLease !== undefined && lease?.guest === guest && lease.owner === owner && !owner.isDestroyed()
          && postBody === undefined && this.allowedNavigation(url)) {
          owner.send(CHANNELS.openRequested, { lease: attachedLease, url: new URL(url).href });
        }
        return { action: 'deny' };
      });
      guest.on('will-frame-navigate', (event) => {
        if (event.isMainFrame && !this.allowedNavigation(event.url)) event.preventDefault();
      });
      guest.on('will-redirect', (event, url, _inPlace, mainFrame) => {
        if (mainFrame && !this.allowedNavigation(url)) event.preventDefault();
      });
      guest.on('will-attach-webview', (event) => { event.preventDefault(); });
      guest.on('login', (event, _details, _authInfo, callback) => { event.preventDefault(); callback(); });
    });
    const releaseAll = () => {
      for (const [id, lease] of this.leases) {
        if (lease.owner === owner) void this.release(owner, id).catch((error) => { console.error(error); });
      }
    };
    owner.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) releaseAll();
    });
    owner.on('render-process-gone', releaseAll);
    owner.once('destroyed', releaseAll);
  }

  configureSession(browserSession) {
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => { callback(false); });
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setDevicePermissionHandler(() => false);
    browserSession.setDisplayMediaRequestHandler((_request, callback) => { callback({}); });
    browserSession.on('will-download', (event) => { event.preventDefault(); });
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      // A parse throw inside onBeforeRequest crashes the network service, so
      // unparseable requests are denied instead of propagated.
      let url;
      try { url = new URL(details.url); } catch { callback({ cancel: true }); return; }
      const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
      callback({
        cancel: network
          ? url.username !== '' || url.password !== '' || this.isApplicationHost(url)
          : !['about:', 'data:', 'blob:'].includes(url.protocol),
      });
    });
  }

  allowedNavigation(value) {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.username === '' && url.password === ''
      && !this.isApplicationHost(url);
  }

  isApplicationHost(url) {
    const value = this.hostUrl();
    if (value === undefined) return false;
    try {
      const host = new URL(value);
      return url.port === host.port
        && (url.hostname === host.hostname || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    } catch {
      return false;
    }
  }
}

function matchesOrigin(/** @type {unknown} */ frameUrl, /** @type {unknown} */ expectedOrigin) {
  if (typeof expectedOrigin !== 'string' || expectedOrigin.trim() === '') return false;
  if (typeof frameUrl !== 'string' || frameUrl.trim() === '') return false;
  try {
    const actual = new URL(frameUrl).origin;
    const expected = new URL(expectedOrigin).origin;
    return actual !== 'null' && actual === expected;
  } catch {
    return false;
  }
}

/**
 * Lease-scoped IPC for the product document. acquire/release are invoke
 * handlers gated to the harness view's main frame.
 * @param {object} options.ipcMain
 * @param {() => object | undefined} options.getView - harness BrowserView.
 * @param {() => string} options.getOrigin - trusted harness origin.
 */
function installBrowserGuestIpc(guests, { ipcMain, getView, getOrigin }) {
  const assertSender = (event) => {
    const target = getView();
    if (!target || !target.webContents || target.webContents.isDestroyed?.()
      || event.sender !== target.webContents
      || event.senderFrame !== target.webContents.mainFrame
      || !matchesOrigin(event.senderFrame?.url, getOrigin())) {
      throw new Error('dshd browser: rejected sender');
    }
    return target;
  };
  // assertSender returns the owning view; it rides the normalized argument
  // list so each channel authorizes exactly once.
  const register = createRegisterIpc(ipcMain);
  register({
    channel: CHANNELS.acquire,
    authorize: assertSender,
    handler: (_event, target, workspace) => guests.acquire(target.webContents, workspace),
  });
  register({
    channel: CHANNELS.release,
    authorize: assertSender,
    handler: (_event, target, lease) => guests.release(target.webContents, lease),
  });
}

let browserGuests;

function installBrowserGuests(guests, ipcOptions) {
  browserGuests = guests;
  installBrowserGuestIpc(guests, ipcOptions);
  return guests;
}

function getBrowserGuests() {
  return browserGuests;
}

module.exports = { BrowserGuests, installBrowserGuests, getBrowserGuests, installBrowserGuestIpc, BROWSER_IPC: CHANNELS };
