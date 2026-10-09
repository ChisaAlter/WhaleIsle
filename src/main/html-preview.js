'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_PREPARED_HTML_BYTES = 25 * 1024 * 1024;
const CAPTURE_TIMEOUT_MS = 20_000;
const MAX_CAPTURE_HEIGHT = 4000;
const MAX_CONSOLE_MESSAGES = 20;

/**
 * Render only the supplied page in a fresh in-memory Chromium partition.
 * This window is never shown and carries neither preload nor user cookies.
 */
async function captureHtmlPreview(input, signal) {
  if (!input || typeof input.html !== 'string' || !input.html.trim()
    || Buffer.byteLength(input.html, 'utf8') > MAX_PREPARED_HTML_BYTES) {
    throw new Error('Prepared HTML must contain 1 to 25 MiB of UTF-8 content.');
  }
  const width = input.width;
  const appearance = input.appearance;
  if (!Number.isInteger(width) || width < 240 || width > 1600) {
    throw new Error('Preview width must be an integer from 240 to 1600.');
  }
  if (appearance !== 'light' && appearance !== 'dark') {
    throw new Error('Preview appearance must be light or dark.');
  }
  signal?.throwIfAborted();
  const { BrowserWindow, session } = require('electron');
  const partition = session.fromPartition(`dshd-html-preview-${crypto.randomUUID()}`);
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  partition.setPermissionCheckHandler(() => false);
  // The document and embedded images use data:. Nothing may fetch a file,
  // desktop endpoint, LAN service, CDN, or other external resource.
  partition.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' });
  });
  partition.on('will-download', event => event.preventDefault());
  const window = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width,
    height: 800,
    useContentSize: true,
    webPreferences: {
      session: partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
      disableDialogs: true,
    },
  });
  const contents = window.webContents;
  const consoleMessages = [];
  let omittedMessages = 0;
  const recordMessage = (level, message) => {
    if (consoleMessages.length >= MAX_CONSOLE_MESSAGES) { omittedMessages++; return; }
    const text = message.length > 500 ? message.slice(0, 480) + '… [truncated]' : message;
    consoleMessages.push({ level, text });
  };
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('console-message', event => {
    const level = event.level === 'error' ? 'error'
      : event.level === 'warning' ? 'warning'
        : event.level === 'info' ? 'info' : 'log';
    const location = event.lineNumber > 0 ? `Console line ${event.lineNumber}: ` : '';
    recordMessage(level, location + event.message);
  });

  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    if (!window.isDestroyed()) window.destroy();
    rejectAbort(signal?.reason instanceof Error ? signal.reason : new Error('HTML preview cancelled.'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    if (!window.isDestroyed()) window.destroy();
    rejectAbort(new Error('HTML preview timed out after 20 seconds.'));
  }, CAPTURE_TIMEOUT_MS);
  const work = (async () => {
    signal?.throwIfAborted();
    // Chromium limits navigation URL length; embedded images can exceed it.
    // Parse the supplied document in the fresh blank renderer instead.
    await contents.loadURL('about:blank');
    await contents.executeJavaScript(`document.open();document.write(${JSON.stringify(input.html)});document.close();`);
    // Use the shipped shell mirror of ui-theme, including its light/dark rules.
    await contents.insertCSS(fs.readFileSync(path.join(__dirname, '..', 'shared', 'dsh-webui-tokens.css'), 'utf8'));
    const unknownSvgTags = await contents.executeJavaScript(`(async()=>{
      document.documentElement.style.colorScheme=${JSON.stringify(appearance)};
      document.documentElement.toggleAttribute('data-ds-dark-theme',${JSON.stringify(appearance === 'dark')});
      const computed=getComputedStyle(document.documentElement);
      const tokens={'--bg':'--dsw-alias-bg-base','--background':'--dsw-alias-bg-base','--surface':'--dsw-alias-bg-layer-1','--text':'--dsw-alias-label-primary','--text-secondary':'--dsw-alias-label-secondary','--border':'--dsw-alias-border-l2','--accent':'--dsw-alias-brand-primary'};
      for(const [key,token] of Object.entries(tokens))document.documentElement.style.setProperty(key,computed.getPropertyValue(token).trim());
      await document.fonts.ready;
      await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      // Unknown SVG tags keep the base interface and can swallow nested shapes.
      return [...new Set([...document.querySelectorAll('svg *')]
        .filter(element=>element.constructor===SVGElement).map(element=>element.localName))];
    })()`);
    for (const tag of unknownSvgTags) {
      recordMessage('warning', `HTML preview: Chromium does not recognize SVG tag <${tag}>. Check spelling or browser support; its child content may not render.`);
    }
    const measured = await contents.executeJavaScript('window.__whaleVisualReplyHeight ? window.__whaleVisualReplyHeight() : Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)');
    if (!Number.isFinite(measured) || measured < 1) throw new Error('Page returned an invalid content height.');
    const contentHeight = Math.ceil(measured);
    const capturedHeight = Math.min(contentHeight, MAX_CAPTURE_HEIGHT);
    window.setContentSize(width, capturedHeight);
    await contents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    signal?.throwIfAborted();
    const screenshot = await contents.capturePage();
    const png = screenshot.resize({ width, height: capturedHeight, quality: 'best' }).toPNG();
    if (omittedMessages > 0) consoleMessages.push({ level: 'warning', text: `${omittedMessages} additional console messages omitted.` });
    return { png: png.toString('base64'), width, contentHeight, capturedHeight, consoleMessages };
  })();
  try {
    return await Promise.race([work, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (!window.isDestroyed()) window.destroy();
    // A cancelled capture owns no live renderer when the tool settles.
    await work.catch(() => {});
    partition.webRequest.onBeforeRequest(null);
  }
}

module.exports = { captureHtmlPreview };
