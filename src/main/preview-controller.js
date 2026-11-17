'use strict';
const {
  previewGuestWebPreferences,
  previewPartitionForScope,
  previewSessionForPartition,
  listPreviewSessions,
  clearPreviewCookies,
  clearPreviewCache,
  PREVIEW_COOKIE_STORAGES,
} = require('./preview-session');
const path = require('node:path');
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
const {
  START_PICK_CHANNEL,
  CANCEL_PICK_CHANNEL,
  ELEMENT_PICKED_CHANNEL,
  ANNOTATION_CAPTURED_CHANNEL,
  ANNOTATION_THEME_CHANNEL,
} = require('./preview-guest-protocol');
const { randomUUID } = require('node:crypto');
const { DEFAULT_ZOOM_FACTOR, ZOOM_EPSILON, nextZoomLevel } = require('./preview-zoom');
const {
  DEFAULT_ANNOTATION_THEME,
  isPreviewAnnotationPayload,
  normalizeCaptureRect,
} = require('./preview-pick-helpers');
const fs = require('node:fs/promises');
const { unknownPreviewId, failClosed, toBuffer, ensureDebugger, pipPreloadPath, pipWindowTitle, defaultAttach, sessionState, isPreviewRefreshShortcut, resolvePreviewLoadUrl, rejectRemote, previewScope, guardView, applyZoom, readZoomFactor, artifactSiteSlug, MAX_RECORDING_BYTES, resolvePreviewArtifactPath } = require('./preview-common');

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

  function resolveUserDataPath() {
    if (injectedUserDataPath) return injectedUserDataPath;
    try {
      return require('electron').app.getPath('userData');
    } catch {
      return null;
    }
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
    if (prior) await prior.catch(() => { /* The previous frame consumer owns its failure; serialize the next capture after it settles. */ });
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
        if (bytes.length === 0) return { ok: false, message: 'screenshot capture returned an empty image' };
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

module.exports = { createPreviewController };
