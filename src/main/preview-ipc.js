'use strict';
const { createCachedWorkspaceAuthority } = require('./workspace-authority');
const { createWorkspacePreviewController } = require('./preview-workspace');
const { createWorkspaceFileReader } = require('./workspace-fs');
const { createFilePreviewWindowController } = require('./preview-file-window');
const { createRegisterIpc } = require('./ipc-register');
const { discoverLocalServers } = require('./preview-common');
const { createPreviewController } = require('./preview-controller');

function createDynamicWorkspaceAuthority() {
  const cached = createCachedWorkspaceAuthority({ allowScratchCwd: true });
  return {
    authorizedRoot: () => cached.get().authorizedRoot(),
    authorizedRoots: () => cached.get().authorizedRoots(),
    resolveAuthorizedCwd: (/** @type {unknown} */ cwd) => cached.get().resolveAuthorizedCwd(cwd),
    resolveInside: (/** @type {unknown} */ cwd, /** @type {unknown} */ relativePath) => cached.get().resolveInside(cwd, relativePath),
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
    ?? createDynamicWorkspaceAuthority();
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
      .catch((error) => { console.warn('[src/main/preview.js] background operation failed', error); });
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
  // Every preview channel mounts through the shared wrapper: `remember` is the
  // custom authorize (runs exactly once per request, returns the host
  // generation), and validators thread that generation ahead of the renderer
  // arguments for the channels that claim singleton resources synchronously.
  const register = createRegisterIpc(ipcMain);
  register({
    channel: 'shell:preview-open',
    authorize: remember,
    handler: async (_event, generation, input) => {
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
    },
  });
  register({
    channel: 'shell:preview-navigate',
    authorize: remember,
    handler: (_event, id, url) => live.navigate(id, url),
  });
  register({ channel: 'shell:preview-back', authorize: remember, handler: (_event, id) => live.back(id) });
  register({ channel: 'shell:preview-forward', authorize: remember, handler: (_event, id) => live.forward(id) });
  register({ channel: 'shell:preview-reload', authorize: remember, handler: (_event, id) => live.reload(id) });
  register({ channel: 'shell:preview-hard-reload', authorize: remember, handler: (_event, id) => live.hardReload(id) });
  register({ channel: 'shell:preview-stop', authorize: remember, handler: (_event, id) => live.stop(id) });
  register({ channel: 'shell:preview-zoom-in', authorize: remember, handler: (_event, id) => live.zoomIn(id) });
  register({ channel: 'shell:preview-zoom-out', authorize: remember, handler: (_event, id) => live.zoomOut(id) });
  register({ channel: 'shell:preview-zoom-reset', authorize: remember, handler: (_event, id) => live.resetZoom(id) });
  register({
    channel: 'shell:preview-color-scheme',
    authorize: remember,
    handler: (_event, id, scheme) => live.setColorScheme(id, scheme),
  });
  register({ channel: 'shell:preview-clear-cookies', authorize: remember, handler: () => live.clearCookies() });
  register({ channel: 'shell:preview-clear-cache', authorize: remember, handler: () => live.clearCache() });
  register({
    channel: 'shell:preview-capture-screenshot',
    authorize: remember,
    handler: (_event, id) => asResult(() => live.captureScreenshot(id)),
  });
  register({ channel: 'shell:preview-pick-element', authorize: remember, handler: (_event, id) => live.pickElement(id) });
  register({ channel: 'shell:preview-cancel-pick', authorize: remember, handler: (_event, id) => live.cancelPickElement(id) });
  register({
    channel: 'shell:preview-annotation-theme',
    authorize: remember,
    handler: (_event, id, theme) => live.setAnnotationTheme(id, theme),
  });
  register({
    channel: 'shell:preview-open-pip',
    authorize: remember,
    handler: (_event, generation, id) => {
      // Claim ownership synchronously. `remember()` may have queued a teardown
      // for the previous generation; that microtask runs as soon as this
      // handler awaits, so a claim registered afterwards would arrive too
      // late and the stale teardown would close the resource this host just
      // created.
      ownSingleton('picture-in-picture', generation);
      return live.openPictureInPicture(id);
    },
  });
  register({ channel: 'shell:preview-close-pip', authorize: remember, handler: () => live.closePictureInPicture() });
  register({
    channel: 'shell:preview-start-recording',
    authorize: remember,
    handler: (_event, id) => asResult(() => live.startRecording(id)),
  });
  register({
    channel: 'shell:preview-stop-recording',
    authorize: remember,
    handler: (_event, id) => asResult(() => live.stopRecording(id)),
  });
  register({
    channel: 'shell:preview-save-recording',
    authorize: remember,
    handler: (_event, id, payload) => asResult(() => live.saveRecording(id, payload)),
  });
  register({
    channel: 'shell:preview-reveal-artifact',
    authorize: remember,
    handler: (_event, artifactPath) => asResult(() => live.revealArtifact(artifactPath)),
  });
  register({
    channel: 'shell:preview-copy-artifact',
    authorize: remember,
    handler: (_event, artifactPath) => asResult(() => live.copyArtifactToClipboard(artifactPath)),
  });
  register({ channel: 'shell:preview-state', authorize: remember, handler: (_event, id) => live.state(id) });
  register({ channel: 'shell:preview-devtools', authorize: remember, handler: (_event, id) => live.openDevTools(id) });
  register({ channel: 'shell:preview-discover', authorize: remember, handler: () => discoverLocalServers() });
  register({
    channel: 'shell:preview-resize',
    authorize: remember,
    handler: (_event, id, bounds) => live.resize(id, bounds),
  });
  register({ channel: 'shell:preview-hide', authorize: remember, handler: (_event, id) => live.hide(id) });
  register({
    channel: 'shell:preview-show',
    authorize: remember,
    handler: (_event, id, bounds) => live.show(id, bounds),
  });
  register({
    channel: 'shell:preview-close',
    authorize: remember,
    handler: (_event, id) => {
      ownedPreviewIds.delete(id);
      return live.close(id);
    },
  });
  register({
    channel: 'shell:preview-workspace-file',
    authorize: remember,
    handler: (_event, generation, input) => {
      // Synchronous claim, as above: the successor must own the shared server
      // before its first await lets the replaced host's teardown run.
      ownSingleton('workspace-preview', generation);
      return workspacePreview.fileUrl(input);
    },
  });
  register({
    channel: 'shell:preview-open-file-window',
    authorize: remember,
    handler: async (_event, generation, input) => {
      ownSingleton('file-preview-window', generation);
      // `open()` resolves its URL through the shared workspace-preview server,
      // so the window depends on that server. A floating-window entry point
      // can be a host's only contact with the server, so claim it here too;
      // otherwise the server stays ownerless and the replaced host's teardown
      // closes it out from under the successor's window.
      ownSingleton('workspace-preview', generation);
      const result = await asResult(() => filePreviewWindow.open(input));
      // `open()` awaits the workspace preview server and a window load, so the
      // host can be reaped mid-flight. A window installed after the reap would
      // belong to no generation and never be torn down.
      if (generation !== hostGeneration || !host) {
        // Close only a window this call actually created. A failed open
        // installed nothing, and a successor may already own the single shared
        // window — in both cases closing here would destroy a window this
        // host never owned.
        const ownedBySuccessor = singletonOwner.has('file-preview-window')
          && singletonOwner.get('file-preview-window') !== generation;
        if (result?.ok === true && !ownedBySuccessor) {
          // Route this through the same reporting path as host teardown: a
          // failed close here is a real leak, not a silent success.
          await Promise.resolve()
            .then(() => filePreviewWindow.close())
            .catch((error) => reportTeardownFailure(error));
        }
        return { ok: false, message: 'Unauthorized IPC sender' };
      }
      return result;
    },
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

module.exports = { registerPreviewIpc };
