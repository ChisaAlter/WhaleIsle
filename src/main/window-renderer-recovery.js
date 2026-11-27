'use strict';

const {
  attachRendererConsoleTail,
  RendererConsoleTail,
  RendererMemorySamples,
  collectHangStack,
  rendererMemorySample,
  writeCrashReport,
  desktopErrorState,
} = require('./crash-report');
const { attachRecovery, UNRESPONSIVE } = require('./renderer-recovery');

// One hour of five-minute readings shows whether memory climbed before an OOM.
const RENDERER_MEMORY_INTERVAL_MS = 5 * 60 * 1000;
const hangStackSessions = new WeakSet();
// Renderer error-level console lines retained across windows for crash files.
const rendererConsoleTail = new RendererConsoleTail();

/** app.getPath('logs') resolves only after ready; reports defer without it. */
function crashLogDir() {
  try {
    const { app } = require('electron');
    return require('node:path').join(app.getPath('logs'), 'crash');
  } catch {
    return null;
  }
}

/**
 * Persist the diagnostic, then keep only its last lines in the dialog.
 * @param {string} why
 * @param {Electron.WebContents} contents
 * @param {{ stack?: unknown, memory?: unknown }} [diagnostics]
 */
async function writeRendererReport(why, contents, diagnostics = {}) {
  const dir = crashLogDir();
  if (!dir) return undefined;
  const { app } = require('electron');
  return writeCrashReport(dir, {
    source: 'renderer',
    phase: 'running',
    error: desktopErrorState(new Error(why)),
    rendererConsole: rendererConsoleTail.snapshot(),
    rendererStack: diagnostics.stack,
    rendererMemory: diagnostics.memory,
    app: {
      name: 'WhaleIsle',
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron || '',
      node: process.versions.node || '',
      locale: app.getLocale(),
    },
    time: new Date(),
  });
}

/**
 * Let unresponsive Harness pages report their running JavaScript: Chromium
 * collects the stack only for documents that opt in through Document-Policy,
 * and index.js enables the feature. Only main-frame responses pass through.
 * @param {Electron.Session | null | undefined} session
 */
function allowHangCallStacks(session) {
  if (!session || hangStackSessions.has(session)) return;
  hangStackSessions.add(session);
  session.webRequest.onHeadersReceived(
    { urls: ['http://127.0.0.1/*', 'http://localhost/*'], types: ['mainFrame'] },
    (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Document-Policy': ['include-js-call-stacks-in-crash-reports'] } });
    },
  );
}

/**
 * Attach crash/hang/load-failure recovery and periodic memory sampling to a WebContents.
 * @param {(Electron.WebContents & { __dshdRecoveryAttached?: boolean }) | null | undefined} contents
 * @param {string} label
 */
function attachRendererRecovery(contents, label) {
  if (!contents || contents.__dshdRecoveryAttached) {
    return;
  }
  contents.__dshdRecoveryAttached = true;
  attachRendererConsoleTail(contents, rendererConsoleTail);
  const memory = new RendererMemorySamples();
  const sampleMemory = () => {
    if (contents.isDestroyed()) return;
    const { app } = require('electron');
    memory.record(rendererMemorySample(contents.getOSProcessId(), app.getAppMetrics()));
  };
  const memoryTimer = setInterval(sampleMemory, RENDERER_MEMORY_INTERVAL_MS);
  memoryTimer.unref?.();
  contents.once('destroyed', () => { clearInterval(memoryTimer); });
  // Crash, hang and load failure recover without a dialog: reload, then a
  // failure page inside the surface (renderer-recovery.js).
  attachRecovery(contents, {
    label,
    report: async (why) => {
      sampleMemory();
      const stack = why === UNRESPONSIVE ? await collectHangStack(contents.mainFrame) : undefined;
      return writeRendererReport(why, contents, { stack, memory: memory.snapshot() });
    },
  });
}

module.exports = { allowHangCallStacks, attachRendererRecovery };
