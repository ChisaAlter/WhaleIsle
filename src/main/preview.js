const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { rewriteLoopbackLoadUrl } = require('./local-url');
const { isHttpOrHttpsUrl } = require('./preview-url');
const { loadWorkspaceAuthority } = require('./workspace-authority');
const { createWorkspaceFileReader } = require('./workspace-fs');
const { createWorkspacePreviewController } = require('./preview-workspace');
const { createFilePreviewWindowController } = require('./preview-file-window');
const {
  previewGuestWebPreferences,
  previewPartitionForScope,
  previewSessionForPartition,
  listPreviewSessions,
  clearPreviewCookies,
  clearPreviewCache,
  PREVIEW_COOKIE_STORAGES,
} = require('./preview-session');
const { DEFAULT_ZOOM_FACTOR, ZOOM_EPSILON, nextZoomLevel } = require('./preview-zoom');
const {
  START_PICK_CHANNEL,
  CANCEL_PICK_CHANNEL,
  ELEMENT_PICKED_CHANNEL,
  ANNOTATION_CAPTURED_CHANNEL,
  ANNOTATION_THEME_CHANNEL,
} = require('./preview-guest-protocol');
const {
  DEFAULT_ANNOTATION_THEME,
  isPreviewAnnotationPayload,
  normalizeCaptureRect,
} = require('./preview-pick-helpers');
const {
  PREVIEW_PIP_FRAME_CHANNEL,
  PICTURE_IN_PICTURE_INITIAL_WIDTH,
  PICTURE_IN_PICTURE_INITIAL_HEIGHT,
  PICTURE_IN_PICTURE_MIN_WIDTH,
  PICTURE_IN_PICTURE_MIN_HEIGHT,
  PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON,
  PREVIEW_PIP_FRAME_INTERVAL_MS,
  PREVIEW_PIP_JPEG_QUALITY,
  buildPreviewPictureInPictureDataUrl,
  fitPictureInPictureContentSize,
} = require('./preview-pip-protocol');

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

/**
 * Guest document URLs: any http(s) host. `file:`, `javascript:`, and `ftp:`
 * are rejected. Subresource loads (fonts, CDN scripts) are filtered
 * separately by {@link previewRequestFilter}. Loopback-dev discovery still
 * uses `isPreviewableUrl` in preview-url.js.
 * @param {unknown} raw
 * @returns {boolean}
 */
function isAllowedPreviewUrl(raw) {
  return isHttpOrHttpsUrl(raw);
}

/**
 * Map `0.0.0.0` to `127.0.0.1` when loopback; otherwise `URL.href` for http(s).
 * @param {unknown} raw
 * @returns {string | null}
 */
function resolvePreviewLoadUrl(raw) {
  const rewritten = rewriteLoopbackLoadUrl(raw);
  if (rewritten) return rewritten;
  if (!isAllowedPreviewUrl(raw)) return null;
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
  if (bounds) view.setBounds(bounds);
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
      view.setBounds(next);
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
 * Cancel non-http(s) document navigations (mainFrame / subFrame). Allow
 * other resource types so Vite/Next apps can load CDN fonts and scripts
 * while top-level navigation stays http(s) via will-navigate / will-redirect.
 * @param {{ url?: string, resourceType?: string }} details
 * @returns {{ cancel: boolean }}
 */
function previewRequestFilter(details) {
  const type = details && details.resourceType;
  if (typeof type === 'string' && !FRAME_RESOURCE_TYPES.has(type)) {
    return { cancel: false };
  }
  return { cancel: !isAllowedPreviewUrl(details && details.url) };
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

function guardView(view) {
  const deny = (event, next) => {
    if (!isAllowedPreviewUrl(next)) event.preventDefault();
  };
  view.webContents.on('will-navigate', deny);
  view.webContents.on('will-redirect', deny);
  const webRequest = view.webRequest;
  if (webRequest && typeof webRequest.onBeforeRequest === 'function') {
    webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      callback(previewRequestFilter(details));
    });
  }
}

/**
 * In-process preview table. Tests inject `attach`; production uses BrowserView
 * on an isolated partition so the user API key never rides the guest session.
 * @param {{ attach?: Function, onState?: (state: object) => void, onRecordingFrame?: (frame: object) => void, sessionCache?: { listSessions?: Function, clearCookies?: Function, clearCache?: Function }, createPipWindow?: Function, userDataPath?: string, showItemInFolder?: Function, clipboard?: { writeImage?: Function }, nativeImage?: { createFromPath?: Function } }} [options]
 */
function createPreviewController(options = {}) {
  const attach = options.attach ?? defaultAttach;
  const onState = typeof options.onState === 'function' ? options.onState : null;
  const onRecordingFrame = typeof options.onRecordingFrame === 'function' ? options.onRecordingFrame : null;
  const createPipWindow = typeof options.createPipWindow === 'function'
    ? options.createPipWindow
    : (windowOptions) => new (require('electron').BrowserWindow)(windowOptions);
  const sessionCache = options.sessionCache ?? {
    listSessions: listPreviewSessions,
    clearCookies: clearPreviewCookies,
    clearCache: clearPreviewCache,
  };
  const injectedUserDataPath = typeof options.userDataPath === 'string' ? options.userDataPath : null;
  const showItemInFolder = typeof options.showItemInFolder === 'function' ? options.showItemInFolder : null;
  const clipboard = options.clipboard ?? null;
  const nativeImage = options.nativeImage ?? null;
  const sessions = new Map();
  const pickSessions = new Map();
  /** @type {null | { window: object, previewId: string, lastAspectRatio: number | undefined }} */
  let pipSession = null;
  /** @type {Map<string, { timer: ReturnType<typeof setInterval> | null, consumers: Set<string> }>} */
  const frameCaptureSessions = new Map();
  const frameCapturesInFlight = new Map();

  function unknownPreviewId() {
    return { ok: false, message: 'unknown preview id' };
  }

  function failClosed(error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  function resolveUserDataPath() {
    if (injectedUserDataPath) return injectedUserDataPath;
    try {
      return require('electron').app.getPath('userData');
    } catch {
      return null;
    }
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

  function liveState(session) {
    return {
      ...sessionState(session),
      pictureInPicture: pipSession !== null && pipSession.previewId === session.id,
    };
  }

  function publishState(session) {
    if (!onState) return;
    onState(liveState(session));
  }

  function releasePictureInPicture(closeWindow) {
    const current = pipSession;
    if (!current) return;
    pipSession = null;
    stopFrameCapture(current.previewId, 'picture-in-picture');
    if (closeWindow && current.window && typeof current.window.isDestroyed === 'function' && !current.window.isDestroyed()) {
      current.window.close();
    }
    const session = sessions.get(current.previewId);
    if (session) publishState(session);
  }

  function stopFrameCapture(previewId, consumer) {
    const current = frameCaptureSessions.get(previewId);
    if (!current || !current.consumers.has(consumer)) return;
    current.consumers.delete(consumer);
    if (current.consumers.size > 0) return;
    if (current.timer) {
      clearInterval(current.timer);
      current.timer = null;
    }
    frameCaptureSessions.delete(previewId);
  }

  function stopAllFrameCapture(previewId) {
    const current = frameCaptureSessions.get(previewId);
    if (!current) return;
    if (current.timer) clearInterval(current.timer);
    frameCaptureSessions.delete(previewId);
  }

  async function startFrameCapture(previewId, consumer) {
    let current = frameCaptureSessions.get(previewId);
    if (current) {
      current.consumers.add(consumer);
      return;
    }
    current = { timer: null, consumers: new Set([consumer]) };
    frameCaptureSessions.set(previewId, current);
    const prior = frameCapturesInFlight.get(previewId);
    if (prior) await prior.catch(() => {});
    if (frameCaptureSessions.get(previewId) !== current) return;
    await capturePreviewFrame(previewId);
    if (frameCaptureSessions.get(previewId) !== current) return;
    const timer = setInterval(() => {
      void capturePreviewFrame(previewId);
    }, PREVIEW_PIP_FRAME_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    current.timer = timer;
  }

  async function capturePreviewFrame(previewId) {
    const capture = frameCaptureSessions.get(previewId);
    if (!capture || capture.consumers.size === 0 || frameCapturesInFlight.has(previewId)) return;
    const pending = publishCapturedPreviewFrame(previewId, capture);
    frameCapturesInFlight.set(previewId, pending);
    try {
      await pending;
    } finally {
      if (frameCapturesInFlight.get(previewId) === pending) frameCapturesInFlight.delete(previewId);
    }
  }

  async function publishCapturedPreviewFrame(previewId, capture) {
    const session = sessions.get(previewId);
    if (!session) return;
    const wc = session.view.webContents;
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return;
    if (typeof wc.capturePage !== 'function') return;
    let image;
    try {
      image = await Promise.resolve(wc.capturePage());
    } catch {
      // Chromium can throw while a hidden guest warms its first frame.
      return;
    }
    if (frameCaptureSessions.get(previewId) !== capture) return;
    const size = typeof image.getSize === 'function' ? image.getSize() : { width: 0, height: 0 };
    if (
      !Number.isFinite(size.width)
      || !Number.isFinite(size.height)
      || size.width <= 0
      || size.height <= 0
    ) {
      return;
    }
    if (typeof image.toJPEG !== 'function') return;
    const jpeg = image.toJPEG(PREVIEW_PIP_JPEG_QUALITY);
    const data = Buffer.isBuffer(jpeg) ? jpeg.toString('base64') : Buffer.from(jpeg).toString('base64');
    const frame = {
      id: previewId,
      data,
      width: size.width,
      height: size.height,
    };
    if (capture.consumers.has('picture-in-picture')) {
      const current = pipSession;
      if (current && current.previewId === previewId && current.window
        && (typeof current.window.isDestroyed !== 'function' || !current.window.isDestroyed())) {
        const aspectRatio = size.width / size.height;
        try {
          if (
            current.lastAspectRatio === undefined
            || Math.abs(current.lastAspectRatio - aspectRatio) > PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON
          ) {
            const contentSize = typeof current.window.getContentSize === 'function'
              ? current.window.getContentSize()
              : [PICTURE_IN_PICTURE_INITIAL_WIDTH, PICTURE_IN_PICTURE_INITIAL_HEIGHT];
            const fitted = fitPictureInPictureContentSize(contentSize, aspectRatio);
            current.window.setAspectRatio(0);
            current.window.setContentSize(fitted[0], fitted[1], false);
            current.window.setAspectRatio(aspectRatio);
            current.lastAspectRatio = aspectRatio;
          }
          current.window.webContents.send(PREVIEW_PIP_FRAME_CHANNEL, frame);
        } catch {
          // Frame delivery failed; the interval retries.
        }
      }
    }
    if (capture.consumers.has('recording') && onRecordingFrame) {
      try {
        onRecordingFrame(frame);
      } catch {
        // Harness listener failed; the interval retries.
      }
    }
  }

  async function captureAnnotationScreenshot(wc, cropRect) {
    if (typeof wc.capturePage !== 'function') return null;
    const image = await Promise.resolve(
      wc.capturePage(cropRect ? {
        x: cropRect.x,
        y: cropRect.y,
        width: cropRect.width,
        height: cropRect.height,
      } : undefined),
    );
    if (!image) return null;
    let dataUrl = null;
    if (typeof image.toDataURL === 'function') {
      dataUrl = image.toDataURL();
    } else if (typeof image.toPNG === 'function') {
      const png = image.toPNG();
      if (!png) return null;
      dataUrl = `data:image/png;base64,${Buffer.isBuffer(png) ? png.toString('base64') : Buffer.from(png).toString('base64')}`;
    }
    if (!dataUrl) return null;
    const size = typeof image.getSize === 'function'
      ? image.getSize()
      : { width: cropRect ? cropRect.width : 0, height: cropRect ? cropRect.height : 0 };
    return {
      dataUrl,
      width: size.width,
      height: size.height,
      cropRect: cropRect ?? { x: 0, y: 0, width: size.width, height: size.height },
    };
  }

  function sendCaptured(wc) {
    try {
      if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return;
      if (typeof wc.send === 'function') wc.send(ANNOTATION_CAPTURED_CHANNEL);
    } catch {
      // Guest already gone after capture.
    }
  }

  function requireSession(id) {
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`unknown preview id: ${id}`);
    }
    return session;
  }

  function bindGuest(session) {
    const contents = session.view.webContents;
    const emit = () => {
      const state = liveState(session);
      session.url = state.url;
      if (onState) onState(state);
    };
    contents.on('did-navigate', emit);
    contents.on('did-navigate-in-page', emit);
    contents.on('did-start-loading', () => {
      session.loading = true;
      session.unreachable = false;
      emit();
    });
    contents.on('did-stop-loading', () => {
      session.loading = false;
      emit();
    });
    contents.on('did-fail-load', (_event, code, _description, _failedUrl, isMainFrame) => {
      if (code === -3 || isMainFrame === false) return;
      session.unreachable = true;
      emit();
    });
    contents.on('page-title-updated', (_event, title) => {
      session.title = typeof title === 'string' ? title : '';
      emit();
    });
    contents.on('before-input-event', (event, input) => {
      if (!isPreviewRefreshShortcut(input)) return;
      event.preventDefault();
      if (typeof contents.reload === 'function') contents.reload();
    });
  }

  return {
    async open(input = {}) {
      const loadUrl = resolvePreviewLoadUrl(input.url);
      if (!loadUrl) return rejectRemote();
      const id = randomUUID();
      const view = attach({
        id,
        url: loadUrl,
        bounds: input.bounds,
        partition: previewPartitionForScope(previewScope(input.scope)),
        extraHeaders: null,
      });
      guardView(view);
      const session = {
        id,
        url: loadUrl,
        view,
        loading: false,
        title: '',
        unreachable: false,
        zoomFactor: DEFAULT_ZOOM_FACTOR,
        annotationTheme: { ...DEFAULT_ANNOTATION_THEME },
      };
      sessions.set(id, session);
      bindGuest(session);
      view.webContents.loadURL(loadUrl);
      return { ok: true, id, url: loadUrl };
    },

    async navigate(id, url) {
      const loadUrl = resolvePreviewLoadUrl(url);
      if (!loadUrl) return rejectRemote();
      const session = requireSession(id);
      session.view.webContents.loadURL(loadUrl);
      session.url = loadUrl;
      return { ok: true, id, url: loadUrl };
    },

    async resize(id, bounds) {
      const session = sessions.get(id);
      if (!session || !bounds) return;
      session.view.setBounds(bounds);
    },

    async hide(id) {
      const session = sessions.get(id);
      if (!session) return;
      session.view.setVisible(false);
    },

    async show(id, bounds) {
      const session = requireSession(id);
      session.view.setVisible(true);
      if (bounds) session.view.setBounds(bounds);
    },

    async back(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.canGoBack === 'function' && contents.canGoBack() && typeof contents.goBack === 'function') {
        contents.goBack();
      }
      return sessionState(session);
    },

    async forward(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.canGoForward === 'function' && contents.canGoForward() && typeof contents.goForward === 'function') {
        contents.goForward();
      }
      return sessionState(session);
    },

    async reload(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.reload === 'function') contents.reload();
      return sessionState(session);
    },

    async hardReload(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.reloadIgnoringCache === 'function') contents.reloadIgnoringCache();
      return sessionState(session);
    },

    async stop(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.stop === 'function') contents.stop();
      return sessionState(session);
    },

    async zoomIn(id) {
      const session = requireSession(id);
      return applyZoom(session, nextZoomLevel(readZoomFactor(session), 'in'));
    },

    async zoomOut(id) {
      const session = requireSession(id);
      return applyZoom(session, nextZoomLevel(readZoomFactor(session), 'out'));
    },

    async resetZoom(id) {
      const session = requireSession(id);
      return applyZoom(session, DEFAULT_ZOOM_FACTOR);
    },

    async setColorScheme(id, scheme) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      const dbg = ensureDebugger(contents);
      if (dbg && typeof dbg.sendCommand === 'function') {
        await dbg.sendCommand('Emulation.setEmulatedMedia', {
          features: [{
            name: 'prefers-color-scheme',
            value: scheme === 'system' ? '' : scheme,
          }],
        });
      }
      return sessionState(session);
    },

    async clearCookies() {
      if (typeof sessionCache.clearCookies === 'function') {
        await sessionCache.clearCookies();
      } else {
        const list = typeof sessionCache.listSessions === 'function' ? sessionCache.listSessions() : [];
        await Promise.all(list.map((ses) => (
          typeof ses.clearStorageData === 'function'
            ? ses.clearStorageData({ storages: [...PREVIEW_COOKIE_STORAGES] })
            : undefined
        )));
      }
      return { ok: true };
    },

    async clearCache() {
      if (typeof sessionCache.clearCache === 'function') {
        await sessionCache.clearCache();
      } else {
        const list = typeof sessionCache.listSessions === 'function' ? sessionCache.listSessions() : [];
        await Promise.all(list.map((ses) => (
          typeof ses.clearCache === 'function' ? ses.clearCache() : undefined
        )));
      }
      return { ok: true };
    },

    async captureScreenshot(id) {
      const session = sessions.get(id);
      if (!session) return unknownPreviewId();
      const contents = session.view.webContents;
      try {
        if (typeof contents.capturePage !== 'function') {
          return { ok: false, message: 'capturePage is unavailable' };
        }
        const image = await Promise.resolve(contents.capturePage());
        const png = image && typeof image.toPNG === 'function' ? image.toPNG() : null;
        if (!png) return { ok: false, message: 'screenshot capture failed' };
        const bytes = toBuffer(png);
        const userData = resolveUserDataPath();
        if (!userData) return { ok: false, message: 'userData path is unavailable' };
        const rawUrl = typeof contents.getURL === 'function' ? contents.getURL() : session.url;
        const slug = artifactSiteSlug(typeof rawUrl === 'string' ? rawUrl : '');
        const fileId = `browser-screenshot-${slug}-${Date.now().toString(36)}`;
        const directory = path.join(userData, 'preview-recordings');
        const artifactPath = path.join(directory, `${fileId}.png`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(artifactPath, bytes);
        return {
          ok: true,
          path: artifactPath,
          mimeType: 'image/png',
          sizeBytes: bytes.length,
          pngBase64: bytes.toString('base64'),
        };
      } catch (error) {
        return failClosed(error);
      }
    },

    async setAnnotationTheme(id, theme) {
      const session = sessions.get(id);
      if (!session) return unknownPreviewId();
      session.annotationTheme = { ...DEFAULT_ANNOTATION_THEME, ...theme };
      const wc = session.view.webContents;
      if (wc && typeof wc.send === 'function' && (typeof wc.isDestroyed !== 'function' || !wc.isDestroyed())) {
        wc.send(ANNOTATION_THEME_CHANNEL, theme);
      }
      return { ok: true };
    },

    async cancelPickElement(id) {
      const pending = pickSessions.get(id);
      if (pending) pending.cancel();
      const session = sessions.get(id);
      if (session) {
        const wc = session.view.webContents;
        if (wc && typeof wc.send === 'function' && (typeof wc.isDestroyed !== 'function' || !wc.isDestroyed())) {
          wc.send(CANCEL_PICK_CHANNEL);
        }
      }
      return { ok: true };
    },

    async pickElement(id) {
      const session = sessions.get(id);
      if (!session) return unknownPreviewId();
      const previous = pickSessions.get(id);
      if (previous) previous.cancel();
      const wc = session.view.webContents;
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          pickSessions.delete(id);
          cleanup();
          resolve(result);
        };
        const onMessage = (_event, payload, crop) => {
          if (!isPreviewAnnotationPayload(payload)) {
            finish({ ok: false, message: 'cancelled' });
            return;
          }
          const cropRect = normalizeCaptureRect(crop);
          Promise.resolve(captureAnnotationScreenshot(wc, cropRect)).then((screenshot) => {
            sendCaptured(wc);
            const annotation = screenshot ? { ...payload, screenshot } : payload;
            finish({
              ok: true,
              annotation,
              screenshot: screenshot || undefined,
            });
          }, () => {
            sendCaptured(wc);
            finish({ ok: true, annotation: payload });
          });
        };
        const onDestroyed = () => finish({ ok: false, message: 'cancelled' });
        const onNavigated = (_event, _url, _isInPlace, isMainFrame) => {
          if (isMainFrame) finish({ ok: false, message: 'cancelled' });
        };
        const cleanup = () => {
          if (wc.ipc && typeof wc.ipc.removeListener === 'function') {
            wc.ipc.removeListener(ELEMENT_PICKED_CHANNEL, onMessage);
          }
          if (typeof wc.off === 'function') {
            wc.off('destroyed', onDestroyed);
            wc.off('did-start-navigation', onNavigated);
          }
        };
        pickSessions.set(id, {
          cancel() {
            finish({ ok: false, message: 'cancelled' });
          },
        });
        if (wc.ipc && typeof wc.ipc.on === 'function') wc.ipc.on(ELEMENT_PICKED_CHANNEL, onMessage);
        if (typeof wc.once === 'function') {
          wc.once('destroyed', onDestroyed);
          wc.once('did-start-navigation', onNavigated);
        }
        if (typeof wc.isFocused === 'function' && !wc.isFocused() && typeof wc.focus === 'function') {
          wc.focus();
        }
        if (typeof wc.send === 'function') {
          wc.send(START_PICK_CHANNEL, session.annotationTheme ?? { ...DEFAULT_ANNOTATION_THEME });
        }
      });
    },

    async state(id) {
      return sessionState(requireSession(id));
    },

    async openDevTools(id) {
      const session = requireSession(id);
      const contents = session.view.webContents;
      if (typeof contents.openDevTools === 'function') contents.openDevTools({ mode: 'detach' });
      return { ok: true, id };
    },

    async close(id) {
      const session = sessions.get(id);
      if (!session) return;
      if (pipSession && pipSession.previewId === id) {
        releasePictureInPicture(true);
      }
      stopAllFrameCapture(id);
      const pending = pickSessions.get(id);
      if (pending) pending.cancel();
      session.view.destroy();
      sessions.delete(id);
    },

    /** Destroy every live view (app quit, harness restart, renderer teardown). */
    async closeAll() {
      releasePictureInPicture(true);
      for (const previewId of [...frameCaptureSessions.keys()]) {
        stopAllFrameCapture(previewId);
      }
      for (const session of sessions.values()) {
        try {
          session.view.destroy();
        } catch {
          // A view that already closed must not block the sweep.
        }
      }
      sessions.clear();
    },

    async openPictureInPicture(id) {
      const session = sessions.get(id);
      if (!session) return unknownPreviewId();
      if (pipSession && typeof pipSession.window.isDestroyed === 'function' && !pipSession.window.isDestroyed()) {
        pipSession.window.showInactive();
        return { ok: true };
      }
      if (pipSession) {
        releasePictureInPicture(false);
      }
      session.view.setVisible(false);
      const pictureInPictureWindow = createPipWindow({
        width: PICTURE_IN_PICTURE_INITIAL_WIDTH,
        height: PICTURE_IN_PICTURE_INITIAL_HEIGHT,
        minWidth: PICTURE_IN_PICTURE_MIN_WIDTH,
        minHeight: PICTURE_IN_PICTURE_MIN_HEIGHT,
        title: pipWindowTitle(session),
        show: false,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        fullscreenable: false,
        maximizable: false,
        minimizable: false,
        resizable: true,
        skipTaskbar: true,
        backgroundColor: '#111111',
        ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
        webPreferences: {
          preload: pipPreloadPath(),
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const onClosed = () => {
        if (pipSession && pipSession.window === pictureInPictureWindow) {
          releasePictureInPicture(false);
        }
      };
      if (typeof pictureInPictureWindow.once === 'function') {
        pictureInPictureWindow.once('closed', onClosed);
      }
      if (typeof pictureInPictureWindow.setAlwaysOnTop === 'function') {
        pictureInPictureWindow.setAlwaysOnTop(
          true,
          process.platform === 'darwin' ? 'floating' : 'normal',
        );
      }
      if (process.platform === 'darwin' && typeof pictureInPictureWindow.setVisibleOnAllWorkspaces === 'function') {
        pictureInPictureWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      }
      pipSession = {
        window: pictureInPictureWindow,
        previewId: id,
        lastAspectRatio: undefined,
      };
      await Promise.resolve(pictureInPictureWindow.loadURL(buildPreviewPictureInPictureDataUrl()));
      if (pipSession && pipSession.window === pictureInPictureWindow) {
        await startFrameCapture(id, 'picture-in-picture');
      }
      if (pipSession && pipSession.window === pictureInPictureWindow) {
        pictureInPictureWindow.showInactive();
        publishState(session);
      }
      return { ok: true };
    },

    async closePictureInPicture() {
      releasePictureInPicture(true);
      return { ok: true };
    },

    async startRecording(id) {
      const session = sessions.get(id);
      if (!session) return unknownPreviewId();
      await startFrameCapture(id, 'recording');
      return { ok: true };
    },

    async stopRecording(id) {
      if (typeof id === 'string' && id.length > 0) {
        stopFrameCapture(id, 'recording');
        return { ok: true };
      }
      for (const previewId of [...frameCaptureSessions.keys()]) {
        stopFrameCapture(previewId, 'recording');
      }
      return { ok: true };
    },

    async saveRecording(id, payload = {}) {
      const userData = resolveUserDataPath();
      if (!userData) return { ok: false, message: 'userData path is unavailable' };
      const mimeType = typeof payload.mimeType === 'string' && payload.mimeType.length > 0
        ? payload.mimeType
        : 'video/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
      const recordingId = `browser-recording-${Date.now().toString(36)}`;
      const directory = path.join(userData, 'preview-recordings');
      const artifactPath = path.join(directory, `${recordingId}.${extension}`);
      try {
        const bytes = toBuffer(payload.data);
        if (bytes.length > MAX_RECORDING_BYTES) {
          return { ok: false, message: 'recording exceeds the 512 MiB limit' };
        }
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(artifactPath, bytes);
        return {
          ok: true,
          id: recordingId,
          previewId: id,
          path: artifactPath,
          mimeType,
          sizeBytes: bytes.length,
        };
      } catch (error) {
        return failClosed(error);
      }
    },

    async revealArtifact(artifactPath) {
      const resolved = resolvePreviewArtifactPath(resolveUserDataPath(), artifactPath);
      if (!resolved) {
        return { ok: false, message: 'artifact path is not a preview recording' };
      }
      try {
        const reveal = showItemInFolder ?? ((next) => require('electron').shell.showItemInFolder(next));
        reveal(resolved);
        return { ok: true };
      } catch (error) {
        return failClosed(error);
      }
    },

    async copyArtifactToClipboard(artifactPath) {
      const resolved = resolvePreviewArtifactPath(resolveUserDataPath(), artifactPath);
      if (!resolved) {
        return { ok: false, message: 'artifact path is not a preview recording' };
      }
      try {
        const imageApi = nativeImage ?? require('electron').nativeImage;
        const clip = clipboard ?? require('electron').clipboard;
        const image = imageApi.createFromPath(resolved);
        if (!image || (typeof image.isEmpty === 'function' && image.isEmpty())) {
          return { ok: false, message: 'empty image' };
        }
        clip.writeImage(image);
        return { ok: true };
      } catch (error) {
        return failClosed(error);
      }
    },
  };
}

/**
 * Register desktop preview IPC on ipcMain.
 * @param {import('electron').IpcMain} ipcMain
 * @param {ReturnType<typeof createPreviewController>} [controller]
 */
function registerPreviewIpc(ipcMain, controller, options = {}) {
  const authorize = typeof options.authorize === 'function' ? options.authorize : () => {};
  const workspaceAuthority = options.workspaceAuthority
    ?? loadWorkspaceAuthority({ allowScratchCwd: true });
  const workspacePreview = options.workspacePreview
    ?? createWorkspacePreviewController({ authority: workspaceAuthority });
  const previewFileReader = options.readFile
    ? null
    : createWorkspaceFileReader(workspaceAuthority).readFile;
  const filePreviewWindow = options.filePreviewWindow ?? createFilePreviewWindowController({
    ipcMain,
    workspacePreview,
    createWindow: options.createFilePreviewWindow,
    readFile: previewFileReader ?? options.readFile,
    authority: workspaceAuthority,
    getTheme: options.getTheme,
    getLocale: options.getLocale,
    preloadPath: options.filePreviewPreloadPath,
    htmlPath: options.filePreviewHtmlPath,
    platform: options.platform,
  });
  let host = null;
  let hostGeneration = 0;
  let boundHost = null;
  const boundHostListeners = new Map();
  /**
   * Resources created by the host generation that currently owns the window.
   *
   * Cleanup for a replaced host must never sweep resources created by its
   * successor. `reapHost()` runs before the replacement's first
   * `shell:preview-open` resolves, so a deferred global `closeAll()` would
   * destroy the newly opened preview while its handler still reported success.
   * Each generation therefore tears down only the ids and singletons it
   * actually created.
   */
  let ownedPreviewIds = new Set();
  let ownedSingletons = new Set();
  /**
   * Which generation currently owns each shared singleton. A successor host
   * that reuses the workspace preview server or the file preview window takes
   * ownership, so the replaced host's teardown must leave it alone.
   */
  const singletonOwner = new Map();
  let teardownOwnedResources = async () => {};

  function ownPreview(result) {
    if (result && typeof result.id === 'string') ownedPreviewIds.add(result.id);
    return result;
  }

  function ownSingleton(name, generation) {
    ownedSingletons.add(name);
    singletonOwner.set(name, generation);
  }

  function canTrackHost(sender) {
    return Boolean(sender && typeof sender.on === 'function' && typeof sender.once === 'function');
  }

  function releaseHost() {
    const previous = boundHost;
    if (!previous) return;
    for (const [eventName, listener] of boundHostListeners) {
      if (typeof previous.off === 'function') {
        previous.off(eventName, listener);
      } else if (typeof previous.removeListener === 'function') {
        previous.removeListener(eventName, listener);
      }
    }
    boundHostListeners.clear();
    boundHost = null;
  }

  function reapHost() {
    if (!host) return;
    const reapedGeneration = hostGeneration;
    const reapedPreviewIds = ownedPreviewIds;
    const reapedSingletons = ownedSingletons;
    ownedPreviewIds = new Set();
    ownedSingletons = new Set();
    hostGeneration += 1;
    host = null;
    releaseHost();
    if (reapedPreviewIds.size === 0 && reapedSingletons.size === 0) return;
    void Promise.resolve()
      .then(() => teardownOwnedResources(reapedPreviewIds, reapedSingletons, reapedGeneration))
      .catch(() => {});
  }

  function bindHost(sender) {
    if (boundHost === sender) return;
    releaseHost();
    boundHost = sender;
    const onNavigate = () => reapHost();
    const onGone = () => reapHost();
    const onDestroyed = () => reapHost();
    boundHostListeners.set('did-navigate', onNavigate);
    boundHostListeners.set('render-process-gone', onGone);
    boundHostListeners.set('destroyed', onDestroyed);
    if (typeof sender.on === 'function') {
      sender.on('did-navigate', onNavigate);
      sender.on('render-process-gone', onGone);
      sender.once('destroyed', onDestroyed);
    }
  }

  const remember = (event) => {
    authorize(event);
    const sender = event && event.sender ? event.sender : null;
    if (!sender || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())) {
      const error = new Error('Unauthorized IPC sender');
      error.code = 'ERR_DSH_IPC_SENDER';
      throw error;
    }
    if (host !== sender) {
      if (canTrackHost(host) || canTrackHost(sender)) reapHost();
      host = sender;
      hostGeneration += 1;
    }
    if (canTrackHost(sender)) bindHost(sender);
    return hostGeneration;
  };
  const sendToHost = (channel, payload) => {
    if (host && typeof host.isDestroyed === 'function' && host.isDestroyed()) return;
    if (host && typeof host.send === 'function') host.send(channel, payload);
  };
  const asResult = (work) => Promise.resolve()
    .then(work)
    .catch((error) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
  /**
   * Single reporting path for cleanup failures. Every teardown attempt routes
   * through here so a failed close stays observable instead of being counted
   * as a successful cleanup.
   */
  const reportTeardownFailure = typeof options.onTeardownError === 'function'
    ? options.onTeardownError
    : (error) => {
      console.warn(`[preview] host teardown failed: ${error instanceof Error ? error.message : String(error)}`);
    };
  const live = controller ?? createPreviewController({
    attach: options.attach,
    createPipWindow: options.createPipWindow,
    userDataPath: options.userDataPath,
    showItemInFolder: options.showItemInFolder,
    clipboard: options.clipboard,
    nativeImage: options.nativeImage,
    onState(state) {
      sendToHost('shell:preview-state-change', state);
    },
    onRecordingFrame(frame) {
      sendToHost('shell:preview-recording-frame', frame);
    },
  });
  ipcMain.handle('shell:preview-open', async (event, input) => {
    const generation = remember(event);
    const result = await live.open(input);
    if (generation !== hostGeneration || !host) {
      if (result && typeof result.id === 'string') {
        await Promise.resolve()
          .then(() => live.close(result.id))
          .catch((error) => reportTeardownFailure(error));
      }
      const error = new Error('Unauthorized IPC sender');
      error.code = 'ERR_DSH_IPC_SENDER';
      throw error;
    }
    return ownPreview(result);
  });
  ipcMain.handle('shell:preview-navigate', (event, id, url) => {
    remember(event);
    return live.navigate(id, url);
  });
  ipcMain.handle('shell:preview-back', (event, id) => {
    remember(event);
    return live.back(id);
  });
  ipcMain.handle('shell:preview-forward', (event, id) => {
    remember(event);
    return live.forward(id);
  });
  ipcMain.handle('shell:preview-reload', (event, id) => {
    remember(event);
    return live.reload(id);
  });
  ipcMain.handle('shell:preview-hard-reload', (event, id) => {
    remember(event);
    return live.hardReload(id);
  });
  ipcMain.handle('shell:preview-stop', (event, id) => {
    remember(event);
    return live.stop(id);
  });
  ipcMain.handle('shell:preview-zoom-in', (event, id) => {
    remember(event);
    return live.zoomIn(id);
  });
  ipcMain.handle('shell:preview-zoom-out', (event, id) => {
    remember(event);
    return live.zoomOut(id);
  });
  ipcMain.handle('shell:preview-zoom-reset', (event, id) => {
    remember(event);
    return live.resetZoom(id);
  });
  ipcMain.handle('shell:preview-color-scheme', (event, id, scheme) => {
    remember(event);
    return live.setColorScheme(id, scheme);
  });
  ipcMain.handle('shell:preview-clear-cookies', (event) => {
    remember(event);
    return live.clearCookies();
  });
  ipcMain.handle('shell:preview-clear-cache', (event) => {
    remember(event);
    return live.clearCache();
  });
  ipcMain.handle('shell:preview-capture-screenshot', (event, id) => {
    remember(event);
    return asResult(() => live.captureScreenshot(id));
  });
  ipcMain.handle('shell:preview-pick-element', (event, id) => {
    remember(event);
    return live.pickElement(id);
  });
  ipcMain.handle('shell:preview-cancel-pick', (event, id) => {
    remember(event);
    return live.cancelPickElement(id);
  });
  ipcMain.handle('shell:preview-annotation-theme', (event, id, theme) => {
    remember(event);
    return live.setAnnotationTheme(id, theme);
  });
  ipcMain.handle('shell:preview-open-pip', (event, id) => {
    // Claim ownership synchronously. `remember()` may have queued a teardown
    // for the previous generation; that microtask runs as soon as this handler
    // awaits, so a claim registered afterwards would arrive too late and the
    // stale teardown would close the resource this host just created.
    ownSingleton('picture-in-picture', remember(event));
    return live.openPictureInPicture(id);
  });
  ipcMain.handle('shell:preview-close-pip', (event) => {
    remember(event);
    return live.closePictureInPicture();
  });
  ipcMain.handle('shell:preview-start-recording', (event, id) => {
    remember(event);
    return asResult(() => live.startRecording(id));
  });
  ipcMain.handle('shell:preview-stop-recording', (event, id) => {
    remember(event);
    return asResult(() => live.stopRecording(id));
  });
  ipcMain.handle('shell:preview-save-recording', (event, id, payload) => {
    remember(event);
    return asResult(() => live.saveRecording(id, payload));
  });
  ipcMain.handle('shell:preview-reveal-artifact', (event, artifactPath) => {
    remember(event);
    return asResult(() => live.revealArtifact(artifactPath));
  });
  ipcMain.handle('shell:preview-copy-artifact', (event, artifactPath) => {
    remember(event);
    return asResult(() => live.copyArtifactToClipboard(artifactPath));
  });
  ipcMain.handle('shell:preview-state', (event, id) => {
    remember(event);
    return live.state(id);
  });
  ipcMain.handle('shell:preview-devtools', (event, id) => {
    remember(event);
    return live.openDevTools(id);
  });
  ipcMain.handle('shell:preview-discover', (event) => {
    remember(event);
    return discoverLocalServers();
  });
  ipcMain.handle('shell:preview-resize', (event, id, bounds) => {
    remember(event);
    return live.resize(id, bounds);
  });
  ipcMain.handle('shell:preview-hide', (event, id) => {
    remember(event);
    return live.hide(id);
  });
  ipcMain.handle('shell:preview-show', (event, id, bounds) => {
    remember(event);
    return live.show(id, bounds);
  });
  ipcMain.handle('shell:preview-close', (event, id) => {
    remember(event);
    ownedPreviewIds.delete(id);
    return live.close(id);
  });
  ipcMain.handle('shell:preview-workspace-file', (event, input) => {
    // Synchronous claim, as above: the successor must own the shared server
    // before its first await lets the replaced host's teardown run.
    ownSingleton('workspace-preview', remember(event));
    return workspacePreview.fileUrl(input);
  });
  ipcMain.handle('shell:preview-open-file-window', async (event, input) => {
    const generation = remember(event);
    ownSingleton('file-preview-window', generation);
    // `open()` resolves its URL through the shared workspace-preview server, so
    // the window depends on that server. A floating-window entry point can be a
    // host's only contact with the server, so claim it here too; otherwise the
    // server stays ownerless and the replaced host's teardown closes it out
    // from under the successor's window.
    ownSingleton('workspace-preview', generation);
    const result = await asResult(() => filePreviewWindow.open(input));
    // `open()` awaits the workspace preview server and a window load, so the
    // host can be reaped mid-flight. A window installed after the reap would
    // belong to no generation and never be torn down.
    if (generation !== hostGeneration || !host) {
      // Close only a window this call actually created. A failed open installed
      // nothing, and a successor may already own the single shared window — in
      // both cases closing here would destroy a window this host never owned.
      const ownedBySuccessor = singletonOwner.has('file-preview-window')
        && singletonOwner.get('file-preview-window') !== generation;
      if (result?.ok === true && !ownedBySuccessor) {
        // Route this through the same reporting path as host teardown: a failed
        // close here is a real leak, not a silent success.
        await Promise.resolve()
          .then(() => filePreviewWindow.close())
          .catch((error) => reportTeardownFailure(error));
      }
      return { ok: false, message: 'Unauthorized IPC sender' };
    }
    return result;
  });
  const closeAll = typeof live.closeAll === 'function' ? live.closeAll.bind(live) : async () => {};
  live.closeAll = async () => {
    const attempts = [
      () => closeAll(),
      () => filePreviewWindow.close(),
      () => workspacePreview.close(),
    ].map((close) => {
      try {
        return Promise.resolve(close());
      } catch (error) {
        return Promise.reject(error);
      }
    });
    // `allSettled` keeps one failure from blocking the others, but the results
    // must still be inspected: an explicit closeAll() that swallowed a failed
    // close would report cleanup that did not happen.
    const results = await Promise.allSettled(attempts);
    for (const result of results) {
      if (result.status === 'rejected') reportTeardownFailure(result.reason);
    }
  };
  /**
   * Tear down exactly the resources the reaped generation created. Preview ids
   * are closed individually so a preview opened by the replacement host is
   * never swept; shared singletons are closed only when the reaped generation
   * still owns them (a successor that reuses one takes ownership).
   * @param {Set<string>} previewIds
   * @param {Set<string>} singletons
   * @param {number} generation
   */
  teardownOwnedResources = async (previewIds, singletons, generation) => {
    /** @type {Promise<unknown>[]} */
    const attempts = [];
    const attempt = (work) => {
      attempts.push(Promise.resolve().then(work).catch((error) => {
        reportTeardownFailure(error);
      }));
    };
    for (const id of previewIds) {
      if (typeof live.close !== 'function') break;
      attempt(() => live.close(id));
    }
    for (const name of singletons) {
      /**
       * Ownership is re-validated *inside* the close work, synchronously
       * immediately before the close call. Checking (and releasing the claim)
       * before queuing left a window in which a successor could take ownership
       * and still be closed by the reaped generation.
       */
      const closeIfStillOwned = (close) => () => {
        if (singletonOwner.get(name) !== generation) return undefined;
        singletonOwner.delete(name);
        return close();
      };
      if (name === 'picture-in-picture') {
        attempt(closeIfStillOwned(() => (typeof live.closePictureInPicture === 'function'
          ? live.closePictureInPicture()
          : undefined)));
      } else if (name === 'workspace-preview') {
        attempt(closeIfStillOwned(() => workspacePreview.close()));
      } else if (name === 'file-preview-window') {
        attempt(closeIfStillOwned(() => filePreviewWindow.close()));
      }
    }
    await Promise.all(attempts);
  };
  return live;
}

module.exports = {
  DISCOVER_PORTS,
  isAllowedPreviewUrl,
  previewRequestFilter,
  discoverLocalServers,
  createPreviewController,
  registerPreviewIpc,
  resolvePreviewLoadUrl,
};
