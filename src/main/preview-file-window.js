'use strict';

const path = require('node:path');
const { loadConfig } = require('./config');
const { currentTheme, officialShellBackground } = require('./chrome');
const { rendererFile } = require('./paths');
const { readFile } = require('./workspace-fs');
const { normalizePreviewFileTarget } = require('./preview-file-target');
const { createRegisterIpc, unauthorizedError } = require('./ipc-register');

const FILE_PREVIEW_STATE_CHANNEL = 'shell:file-preview-state';
const IMAGE_EXTENSIONS = new Set(['.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const VIDEO_EXTENSIONS = new Set(['.m4v', '.mov', '.mp4', '.ogv', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.oga', '.ogg', '.wav']);
const HTML_EXTENSIONS = new Set(['.htm', '.html', '.xhtml']);

function previewFileKind(relativePath) {
  const extension = path.extname(String(relativePath || '')).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (extension === '.pdf') return 'pdf';
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  return 'text';
}

function previewFileName(relativePath) {
  return path.basename(String(relativePath || '').replace(/\\/g, '/')) || 'File preview';
}

function defaultCreateWindow(options) {
  const { BrowserWindow } = require('electron');
  return new BrowserWindow(options);
}

function defaultPreloadPath() {
  return path.join(__dirname, '..', 'preload', 'file-preview.js');
}

function defaultLocale() {
  return loadConfig().locale === 'en' ? 'en' : 'zh';
}

/**
 * Single native, always-on-top viewer for workspace files. The renderer gets
 * only a state snapshot; all file authority remains in main.
 */
function createFilePreviewWindowController(options = {}) {
  const ipcMain = options.ipcMain;
  const workspacePreview = options.workspacePreview;
  const readWorkspaceFile = options.readFile ?? readFile;
  const authority = options.authority;
  const createWindow = options.createWindow ?? defaultCreateWindow;
  const getTheme = options.getTheme ?? currentTheme;
  const getLocale = options.getLocale ?? defaultLocale;
  const preloadPath = options.preloadPath ?? defaultPreloadPath();
  const htmlPath = options.htmlPath ?? rendererFile('file-preview.html');
  const platform = options.platform ?? process.platform;
  let previewWindow = null;
  let previewState = null;
  let requestSequence = 0;

  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new TypeError('file preview requires ipcMain');
  }
  if (!workspacePreview || typeof workspacePreview.fileUrl !== 'function') {
    throw new TypeError('file preview requires a workspace preview controller');
  }

  createRegisterIpc(ipcMain)({
    channel: FILE_PREVIEW_STATE_CHANNEL,
    authorize: (event) => {
      const sender = event?.sender;
      const frame = event?.senderFrame;
      if (
        !previewWindow
        || previewWindow.isDestroyed()
        || sender !== previewWindow.webContents
        || frame !== sender.mainFrame
        || (typeof sender.isDestroyed === 'function' && sender.isDestroyed())
      ) {
        throw unauthorizedError();
      }
    },
    handler: () => previewState,
  });

  function configureWindow(win) {
    if (typeof win.setMenuBarVisibility === 'function') win.setMenuBarVisibility(false);
    if (typeof win.setAlwaysOnTop === 'function') {
      win.setAlwaysOnTop(true, platform === 'darwin' ? 'floating' : 'normal');
    }
    if (platform === 'darwin' && typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    }
    const contents = win.webContents;
    if (contents && typeof contents.setWindowOpenHandler === 'function') {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    if (typeof win.once === 'function') {
      win.once('closed', () => {
        if (previewWindow === win) {
          previewWindow = null;
          previewState = null;
        }
      });
    }
  }

  function ensureWindow(theme) {
    if (previewWindow && !previewWindow.isDestroyed()) return previewWindow;
    previewWindow = createWindow({
      width: 720,
      height: 520,
      minWidth: 320,
      minHeight: 220,
      title: 'File preview',
      show: false,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      resizable: true,
      skipTaskbar: true,
      backgroundColor: officialShellBackground(theme),
      ...(platform === 'darwin' ? { type: 'panel' } : {}),
      webPreferences: {
        preload: preloadPath,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    configureWindow(previewWindow);
    return previewWindow;
  }

  async function open(input = {}) {
    const sequence = ++requestSequence;
    const en = getLocale() === 'en';
    const target = normalizePreviewFileTarget(input, authority);
    if (!target.ok) return target;
    const { cwd, relativePath } = target;
    const opened = await workspacePreview.fileUrl(target);
    if (sequence !== requestSequence) return { ok: false, message: en ? 'Preview request was replaced.' : '预览请求已被替换。' };
    if (!opened?.ok || typeof opened.url !== 'string') return opened;

    let kind = previewFileKind(relativePath);
    let text = null;
    let truncated = false;
    let message = null;
    if (kind === 'text') {
      const result = await readWorkspaceFile(cwd, relativePath);
      if (sequence !== requestSequence) return { ok: false, message: en ? 'Preview request was replaced.' : '预览请求已被替换。' };
      if (!result?.ok) {
        message = result?.message || (en ? 'Could not read the file.' : '无法读取该文件。');
      } else if (result.binary === true) {
        kind = 'unsupported';
        message = en ? 'This binary file cannot be previewed.' : '二进制文件无法预览。';
      } else {
        text = typeof result.text === 'string' ? result.text : '';
        truncated = result.truncated === true;
      }
    }

    const theme = getTheme();
    const name = previewFileName(relativePath);
    previewState = {
      kind,
      name,
      relativePath,
      url: opened.url,
      text,
      truncated,
      message,
      locale: getLocale(),
      scheme: theme?.scheme === 'dark' ? 'dark' : 'light',
    };
    const win = ensureWindow(theme);
    if (typeof win.setTitle === 'function') {
      win.setTitle(`${previewState.locale === 'en' ? 'Preview' : '预览'} · ${name}`);
    }
    if (typeof win.setBackgroundColor === 'function') {
      win.setBackgroundColor(officialShellBackground(theme));
    }
    await Promise.resolve(win.loadFile(htmlPath));
    if (sequence !== requestSequence || win.isDestroyed()) {
      return { ok: false, message: 'Preview request was replaced.' };
    }
    if (typeof win.showInactive === 'function') win.showInactive();
    else if (typeof win.show === 'function') win.show();
    return { ok: true };
  }

  async function close() {
    requestSequence += 1;
    const win = previewWindow;
    previewWindow = null;
    previewState = null;
    if (win && !win.isDestroyed() && typeof win.close === 'function') win.close();
  }

  return { open, close };
}

module.exports = {
  FILE_PREVIEW_STATE_CHANNEL,
  previewFileKind,
  createFilePreviewWindowController,
};
