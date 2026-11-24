'use strict';
const { URL } = require('node:url');
const { isHttpOrHttpsUrl } = require('./preview-url');
const { rewriteLoopbackLoadUrl } = require('./local-url');
const path = require('node:path');
const fsSync = require('node:fs');
const {
  previewGuestWebPreferences,
  previewPartitionForScope,
  previewSessionForPartition,
  listPreviewSessions,
  clearPreviewCookies,
  clearPreviewCache,
  PREVIEW_COOKIE_STORAGES,
} = require('./preview-session');
const net = require('node:net');
const { DEFAULT_ZOOM_FACTOR, ZOOM_EPSILON, nextZoomLevel } = require('./preview-zoom');

const DISCOVER_PORTS = Object.freeze([
  3000, 3001, 3333, 4173, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081, 8888, 9000,
]);
const DISCOVER_TIMEOUT_MS = 200;
/** Document navigations that must stay http(s). */
const FRAME_RESOURCE_TYPES = new Set(['mainFrame', 'subFrame']);
/** Max hostname characters in a screenshot filename slug. */
const MAX_ARTIFACT_SITE_SLUG_LENGTH = 80;
/** Byte cap for one saved MediaRecorder artifact. */
const MAX_RECORDING_BYTES = 512 * 1024 * 1024;

const LOOPBACK_MATCH_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

function defaultControlOrigins() {
  const urls = [];
  try {
    const { getHarnessOrigin } = require('./window');
    const origin = typeof getHarnessOrigin === 'function' ? getHarnessOrigin() : '';
    if (origin) urls.push(origin);
  } catch {
    // Window module unavailable in isolated tests.
  }
  try {
    const { desktopInstallEnv } = require('./desktop-install-control');
    const controlUrl = typeof desktopInstallEnv === 'function'
      ? desktopInstallEnv()?.DSH_DESKTOP_INSTALL_URL
      : '';
    if (controlUrl) urls.push(controlUrl);
  } catch {
    // Install control module unavailable in isolated tests.
  }
  return urls;
}

function matchesControlOrigin(/** @type {URL} */ url, /** @type {unknown} */ candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return false;
  try {
    const host = new URL(candidate);
    if (url.port !== host.port) return false;
    return url.hostname === host.hostname
      || (LOOPBACK_MATCH_HOSTS.has(url.hostname) && LOOPBACK_MATCH_HOSTS.has(host.hostname));
  } catch {
    return false;
  }
}

function isBlockedControlUrl(/** @type {URL} */ url, /** @type {{ blockedOrigins?: string[], getHarnessOrigin?: () => string } | undefined} */ options) {
  const origins = [
    ...defaultControlOrigins(),
    ...(Array.isArray(options?.blockedOrigins) ? options.blockedOrigins : []),
  ];
  if (typeof options?.getHarnessOrigin === 'function') {
    const origin = options.getHarnessOrigin();
    if (origin) origins.push(origin);
  }
  return origins.some((candidate) => matchesControlOrigin(url, candidate));
}

/**
 * Guest document URLs: any http(s) host without URL credentials or application
 * loopback control origins. `file:`, `javascript:`, and `ftp:` are rejected.
 * @param {unknown} raw
 * @param {{ blockedOrigins?: string[], getHarnessOrigin?: () => string }} [options]
 * @returns {boolean}
 */
function isAllowedPreviewUrl(raw, options) {
  if (!isHttpOrHttpsUrl(raw)) return false;
  try {
    const parsed = new URL(String(raw));
    if (parsed.username !== '' || parsed.password !== '') return false;
    return !isBlockedControlUrl(parsed, options);
  } catch {
    return false;
  }
}

/**
 * Map `0.0.0.0` to `127.0.0.1` when loopback; otherwise `URL.href` for http(s).
 * @param {unknown} raw
 * @param {{ blockedOrigins?: string[], getHarnessOrigin?: () => string }} [options]
 * @returns {string | null}
 */
function resolvePreviewLoadUrl(raw, options) {
  const rewritten = rewriteLoopbackLoadUrl(raw);
  if (rewritten) return isAllowedPreviewUrl(rewritten, options) ? rewritten : null;
  if (!isAllowedPreviewUrl(raw, options)) return null;
  try {
    return new URL(String(raw)).href;
  } catch {
    return null;
  }
}

/**
 * Preview persist scope from the client. Missing or empty cwd → `'shared'`.
 * @param {unknown} raw
 * @returns {string}
 */
function previewScope(raw) {
  if (typeof raw !== 'string') return 'shared';
  const trimmed = raw.trim();
  return trimmed === '' ? 'shared' : trimmed;
}

function rejectRemote() {
  return { ok: false, message: 'Preview only opens http(s) URLs.' };
}

/**
 * Reveal/copy may only touch files the preview controller wrote under
 * `userData/preview-recordings`. Symlink escapes fail closed.
 * @param {unknown} userData
 * @param {unknown} artifactPath
 * @returns {string | null}
 */
function resolvePreviewArtifactPath(userData, artifactPath) {
  if (typeof userData !== 'string' || userData.trim() === '') return null;
  if (typeof artifactPath !== 'string' || artifactPath.trim() === '') return null;
  const root = path.resolve(userData, 'preview-recordings');
  let realRoot;
  let realTarget;
  try {
    realRoot = fsSync.realpathSync(root);
    realTarget = fsSync.realpathSync(artifactPath);
  } catch {
    return null;
  }
  const relative = path.relative(realRoot, realTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return realTarget;
}

/**
 * Filesystem-safe hostname slug for screenshot filenames.
 * Empty or unparseable URLs become `site`.
 * @param {unknown} rawUrl
 * @returns {string}
 */
function artifactSiteSlug(rawUrl) {
  try {
    const url = new URL(String(rawUrl));
    const slug = url.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_ARTIFACT_SITE_SLUG_LENGTH)
      .replace(/-+$/g, '');
    return slug || 'site';
  } catch {
    return 'site';
  }
}

// A floating host rounds its guest to match its own frame; docked bounds carry
// no radius and stay square.
function placeView(view, bounds) {
  view.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  const radius = Number(bounds.radius);
  view.setBorderRadius(Number.isFinite(radius) && radius > 0 ? Math.round(radius) : 0);
}

function defaultAttach({ bounds, partition }) {
  const { WebContentsView } = require('electron');
  const { getMainWindow } = require('./window');
  const win = getMainWindow();
  if (!win) {
    throw new Error('preview requires the desktop window');
  }
  const ses = previewSessionForPartition(partition);
  const view = new WebContentsView({
    webPreferences: previewGuestWebPreferences({ session: ses }),
  });
  win.contentView.addChildView(view);
  if (bounds) placeView(view, bounds);
  view.webContents.setWindowOpenHandler(({ url }) => {
    const next = resolvePreviewLoadUrl(url);
    if (next) view.webContents.loadURL(next);
    return { action: 'deny' };
  });
  let visible = true;
  return {
    partition,
    extraHeaders: null,
    webContents: view.webContents,
    webRequest: ses.webRequest,
    setBounds(next) {
      placeView(view, next);
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      // Menus and PiP hide the native overlay, but capturePage still needs
      // its attached display surface. Detaching leaves captures pending.
      if (next) win.contentView.addChildView(view);
      view.setVisible(next);
    },
    destroy() {
      win.contentView.removeChildView(view);
      view.webContents.close();
    },
  };
}

/**
 * Cancel non-http(s) document navigations (mainFrame / subFrame) and block
 * credentialed or application-control requests across all protocols.
 * @param {{ url?: string, resourceType?: string }} details
 * @param {{ blockedOrigins?: string[], getHarnessOrigin?: () => string }} [options]
 * @returns {{ cancel: boolean }}
 */
function previewRequestFilter(details, options) {
  let url;
  try {
    url = new URL(String(details?.url ?? ''));
  } catch {
    return { cancel: true };
  }
  const type = details && details.resourceType;
  if (typeof type !== 'string' || FRAME_RESOURCE_TYPES.has(type)) {
    return { cancel: !isAllowedPreviewUrl(url.href, options) };
  }
  const isNetwork = url.protocol === 'http:' || url.protocol === 'https:'
    || url.protocol === 'ws:' || url.protocol === 'wss:';
  if (isNetwork) {
    return {
      cancel: url.username !== '' || url.password !== '' || isBlockedControlUrl(url, options),
    };
  }
  return { cancel: url.protocol !== 'data:' && url.protocol !== 'blob:' && url.protocol !== 'about:' };
}

/**
 * Probe one loopback TCP port. Resolves true only when the handshake connects.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function probeLocalPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (ok) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => { finish(false); }, DISCOVER_TIMEOUT_MS);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/**
 * List common local-dev URLs that currently accept a TCP connection.
 * @param {(port: number) => Promise<boolean>} [probe]
 * @returns {Promise<{ url: string, port: number }[]>}
 */
async function discoverLocalServers(probe = probeLocalPort) {
  const found = [];
  await Promise.all(DISCOVER_PORTS.map(async (port) => {
    if (await probe(port)) found.push({ url: `http://127.0.0.1:${port}`, port });
  }));
  found.sort((left, right) => left.port - right.port);
  return found;
}

function readZoomFactor(session) {
  const contents = session.view.webContents;
  if (contents && typeof contents.getZoomFactor === 'function') {
    return contents.getZoomFactor();
  }
  return session.zoomFactor ?? DEFAULT_ZOOM_FACTOR;
}

function sessionState(session) {
  const contents = session.view.webContents;
  const url = typeof contents.getURL === 'function' && contents.getURL()
    ? contents.getURL()
    : session.url;
  return {
    ok: true,
    id: session.id,
    url,
    canGoBack: typeof contents.canGoBack === 'function' ? contents.canGoBack() : false,
    canGoForward: typeof contents.canGoForward === 'function' ? contents.canGoForward() : false,
    loading: session.loading === true,
    title: session.title,
    unreachable: session.unreachable === true,
    zoomFactor: readZoomFactor(session),
  };
}

function applyZoom(session, next) {
  const current = readZoomFactor(session);
  if (Math.abs(next - current) < ZOOM_EPSILON) return sessionState(session);
  session.zoomFactor = next;
  const contents = session.view.webContents;
  if (typeof contents.setZoomFactor === 'function') contents.setZoomFactor(next);
  return sessionState(session);
}

function isPreviewRefreshShortcut(input) {
  if (!input) return false;
  if (input.type && input.type !== 'keyDown') return false;
  const key = String(input.key ?? '').toLowerCase();
  return (input.control || input.meta) && key === 'r' && !input.shift && !input.alt;
}

function guardView(/** @type {any} */ view, /** @type {{ blockedOrigins?: string[], getHarnessOrigin?: () => string } | undefined} */ options) {
  const deny = (/** @type {any} */ event, /** @type {unknown} */ next) => {
    const targetUrl = typeof next === 'string' ? next : event?.url;
    if (!isAllowedPreviewUrl(targetUrl, options)) event.preventDefault();
  };
  view.webContents.on('will-navigate', deny);
  view.webContents.on('will-frame-navigate', deny);
  view.webContents.on('will-redirect', deny);
  const webRequest = view.webRequest;
  if (webRequest && typeof webRequest.onBeforeRequest === 'function') {
    webRequest.onBeforeRequest((/** @type {any} */ details, /** @type {(res: { cancel: boolean }) => void} */ callback) => {
      callback(previewRequestFilter(details, options));
    });
  }
}


  function unknownPreviewId() {
    return { ok: false, message: 'unknown preview id' };
  }

  function failClosed(error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  function toBuffer(data) {
    if (data == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
    return Buffer.from(data);
  }

  function ensureDebugger(contents) {
    const dbg = contents && contents.debugger;
    if (!dbg) return null;
    try {
      if (typeof dbg.isAttached === 'function' && !dbg.isAttached() && typeof dbg.attach === 'function') {
        dbg.attach('1.3');
      }
    } catch {
      // Already attached on this guest.
    }
    return dbg;
  }

  function pipPreloadPath() {
    return path.join(__dirname, 'preview-pip-preload.js');
  }

  function pipWindowTitle(session) {
    const wc = session.view.webContents;
    const raw = typeof wc.getTitle === 'function' ? wc.getTitle() : session.title;
    const title = typeof raw === 'string' ? raw.trim() : '';
    return title.length > 0 ? `预览 · ${title}` : 'Browser preview';
  }

module.exports = { unknownPreviewId, failClosed, toBuffer, ensureDebugger, pipPreloadPath, pipWindowTitle, DISCOVER_PORTS, isAllowedPreviewUrl, resolvePreviewLoadUrl, previewScope, rejectRemote, resolvePreviewArtifactPath, artifactSiteSlug, defaultAttach, previewRequestFilter, discoverLocalServers, readZoomFactor, sessionState, applyZoom, isPreviewRefreshShortcut, guardView, MAX_RECORDING_BYTES };
