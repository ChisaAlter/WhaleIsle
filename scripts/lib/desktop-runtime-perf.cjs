'use strict';

// Explicit Electron benchmark entry. Normal application launches never load it.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const SMAPS_ROLLUP_KEYS = new Set([
  'Rss',
  'Pss',
  'Private_Clean',
  'Private_Dirty',
  'Shared_Clean',
  'Shared_Dirty',
]);

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function toMiBFromKiB(value) {
  return isFiniteNonNegative(value) ? value / 1024 : undefined;
}

/**
 * Parse Linux `/proc/<pid>/smaps_rollup` KiB counters into MiB metrics.
 * @param {string} text
 * @returns {{ privateMiB?: number, pssMiB?: number, sharedMiB?: number } | null}
 */
function parseSmapsRollup(text) {
  if (typeof text !== 'string' || !text) return null;
  /** @type {Record<string, number>} */
  const kib = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_]+):\s+(\d+)\s+kB\s*$/i.exec(line);
    if (!match || !SMAPS_ROLLUP_KEYS.has(match[1])) continue;
    const amount = Number(match[2]);
    if (isFiniteNonNegative(amount)) kib[match[1]] = amount;
  }
  /** @type {{ privateMiB?: number, pssMiB?: number, sharedMiB?: number }} */
  const parsed = {};
  if (kib.Private_Clean !== undefined || kib.Private_Dirty !== undefined) {
    parsed.privateMiB = ((kib.Private_Clean || 0) + (kib.Private_Dirty || 0)) / 1024;
  }
  if (kib.Pss !== undefined) parsed.pssMiB = kib.Pss / 1024;
  if (kib.Shared_Clean !== undefined || kib.Shared_Dirty !== undefined) {
    parsed.sharedMiB = ((kib.Shared_Clean || 0) + (kib.Shared_Dirty || 0)) / 1024;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

/**
 * Read `/proc/<pid>/smaps_rollup` on Linux when present and readable.
 * @param {number} pid
 * @param {{ platform?: string, readFileSync?: (filePath: string, encoding: 'utf8') => string }} [options]
 * @returns {{ privateMiB?: number, pssMiB?: number, sharedMiB?: number } | null}
 */
function readLinuxProcMemory(pid, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'linux' || !Number.isInteger(pid) || pid <= 0) return null;
  const read = options.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
  try {
    return parseSmapsRollup(read(`/proc/${pid}/smaps_rollup`, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Capture per-process memory breakdown from Electron metrics and Linux procfs when readable.
 * @param {{ pid: number, type: string, memory?: { workingSetSize: number, privateBytes?: number } }} item
 * @param {{ platform?: string, readFileSync?: (filePath: string, encoding: 'utf8') => string }} [options]
 * @returns {import('../measure-desktop-runtime.mjs').ProcessMemorySnapshot}
 */
function captureProcessSnapshotEntry(item, options = {}) {
  /** @type {import('../measure-desktop-runtime.mjs').ProcessMemorySnapshot} */
  const entry = {
    pid: item.pid,
    type: item.type,
    workingSetMiB: toMiBFromKiB(item.memory?.workingSetSize) ?? 0,
  };
  const procMemory = readLinuxProcMemory(item.pid, options);
  const privateMiB = procMemory?.privateMiB ?? toMiBFromKiB(item.memory?.privateBytes);
  if (privateMiB !== undefined) entry.privateMiB = privateMiB;
  if (procMemory?.pssMiB !== undefined) entry.pssMiB = procMemory.pssMiB;
  if (procMemory?.sharedMiB !== undefined) entry.sharedMiB = procMemory.sharedMiB;
  return entry;
}

/**
 * Aggregate working set and optional private/PSS/shared totals across a process snapshot.
 * @param {import('../measure-desktop-runtime.mjs').ProcessMemorySnapshot[]} processes
 * @returns {import('../measure-desktop-runtime.mjs').PeakProcessTotals}
 */
function summarizeProcessSnapshot(processes) {
  let workingSetMiB = 0;
  let privateMiB = 0;
  let privateProcessCount = 0;
  let pssMiB = 0;
  let pssProcessCount = 0;
  let sharedMiB = 0;
  let sharedProcessCount = 0;
  for (const item of processes) {
    workingSetMiB += isFiniteNonNegative(item.workingSetMiB) ? item.workingSetMiB : 0;
    if (isFiniteNonNegative(item.privateMiB)) {
      privateMiB += item.privateMiB;
      privateProcessCount += 1;
    }
    if (isFiniteNonNegative(item.pssMiB)) {
      pssMiB += item.pssMiB;
      pssProcessCount += 1;
    }
    if (isFiniteNonNegative(item.sharedMiB)) {
      sharedMiB += item.sharedMiB;
      sharedProcessCount += 1;
    }
  }
  /** @type {import('../measure-desktop-runtime.mjs').PeakProcessTotals} */
  const totals = { workingSetMiB, processCount: processes.length };
  if (privateProcessCount > 0) {
    totals.privateMiB = privateMiB;
    totals.privateProcessCount = privateProcessCount;
  }
  if (pssProcessCount > 0) {
    totals.pssMiB = pssMiB;
    totals.pssProcessCount = pssProcessCount;
  }
  if (sharedProcessCount > 0) {
    totals.sharedMiB = sharedMiB;
    totals.sharedProcessCount = sharedProcessCount;
  }
  return totals;
}

/**
 * Capture one simultaneous process snapshot and its aggregated totals.
 * @param {{ pid: number, type: string, memory?: { workingSetSize: number, privateBytes?: number } }[]} processes
 * @param {string} phase
 * @param {number} elapsedMs
 * @param {{ platform?: string, readFileSync?: (filePath: string, encoding: 'utf8') => string }} [options]
 * @returns {import('../measure-desktop-runtime.mjs').PeakProcessSnapshot}
 */
function capturePeakProcessSnapshot(processes, phase, elapsedMs, options = {}) {
  const captured = processes.map(item => captureProcessSnapshotEntry(item, options));
  return {
    phase,
    elapsedMs,
    processes: captured,
    totals: summarizeProcessSnapshot(captured),
  };
}

/** @param {number} ms */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {Electron.App} app
 * @param {string} root
 * @param {{ rejectWc?: Electron.WebContents | null }} [options]
 */
async function clientReady(app, root, options = {}) {
  const { getHarnessWebContents } = require(path.join(root, 'src/main/window.js'));
  const { readLastDesktopStart } = require(path.join(root, 'src/main/launcher-gate.js'));
  const rejectWc = options.rejectWc ?? null;
  const deadline = performance.now() + 180000;
  while (performance.now() < deadline) {
    const startup = readLastDesktopStart(app.getPath('userData'));
    if (startup.ok === false) throw new Error(`Desktop start failed: ${startup.error}`);
    const wc = getHarnessWebContents();
    if (wc && wc !== rejectWc && !wc.isDestroyed() && !wc.isLoading()) {
      // Require the assembled workbench, rather than an HTTP-ready host alone.
      const ready = await wc.executeJavaScript('Boolean(document.querySelector("[data-dshd-caption=band]"))');
      if (ready) return wc;
    }
    await pause(100);
  }
  throw new Error('Desktop workbench did not become ready within 180 seconds');
}

/**
 * Wait until startup's maintenance slot is released before issuing `shell:restart`.
 * @param {{ isMaintenanceHeld?: () => boolean }} importGuard
 * @param {{ timeoutMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number }} [options]
 */
async function waitForMaintenanceIdle(importGuard, options = {}) {
  if (typeof importGuard?.isMaintenanceHeld !== 'function') return;
  const timeoutMs = options.timeoutMs ?? 30000;
  const pollMs = options.pollMs ?? 50;
  const sleep = options.sleep ?? pause;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + timeoutMs;
  while (importGuard.isMaintenanceHeld()) {
    if (now() >= deadline) {
      throw new Error(`Startup maintenance remained held after ${timeoutMs} ms`);
    }
    await sleep(pollMs);
  }
}

/**
 * Observe `window.shell.restart()` settlement without blocking the unload poll loop.
 * @param {{ webContents: { executeJavaScript: (code: string) => Promise<any> } }} win
 */
function startRestartProbe(win) {
  const state = { settled: false, outcome: /** @type {any} */ (undefined), rejected: false, error: /** @type {unknown} */ (null) };
  Promise.resolve()
    .then(() => win.webContents.executeJavaScript('window.shell.restart()'))
    .then(
      (value) => { state.settled = true; state.outcome = value; },
      (error) => { state.settled = true; state.rejected = true; state.error = error; },
    );
  return state;
}

/**
 * Check whether the previous workbench WebContents has been destroyed or replaced.
 * @param {any} previousWc
 * @param {() => any} getHarnessWebContents
 */
function hasWorkbenchUnloaded(previousWc, getHarnessWebContents) {
  if (!previousWc) return true;
  if (typeof previousWc.isDestroyed === 'function' && previousWc.isDestroyed()) return true;
  return getHarnessWebContents() !== previousWc;
}

/**
 * Throw when `window.shell.restart()` rejected or returned a refusal payload.
 * @param {{ settled: boolean, outcome: any, rejected: boolean, error: unknown }} probe
 */
function assertRestartAccepted(probe) {
  if (probe.rejected) throw probe.error;
  if (!probe.settled) return;
  const { outcome } = probe;
  if (outcome && (outcome.ok === false || outcome.proceeded === false)) {
    throw new Error(`Restart refused: ${outcome.error || outcome.code || 'unknown'}`);
  }
}

/**
 * Trigger `window.shell.restart()`, reject `{ ok: false }` / `{ proceeded: false }`
 * refusals, observe the previous workbench view unloading/replacing, and measure
 * elapsed milliseconds until the newly mounted workbench becomes ready.
 * @param {{
 *   win: { webContents: { executeJavaScript: (code: string) => Promise<any> } },
 *   getHarnessWebContents: () => any,
 *   waitForClientReady: (options?: { rejectWc?: any }) => Promise<any>,
 *   sleep?: (ms: number) => Promise<void>,
 *   pollMs?: number,
 *   timeoutMs?: number,
 *   unloadGraceMs?: number,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<number>}
 */
async function performMeasuredRestart({
  win,
  getHarnessWebContents,
  waitForClientReady,
  sleep = pause,
  pollMs = 50,
  timeoutMs = 180000,
  unloadGraceMs = 5000,
  now = () => performance.now(),
}) {
  const previousWc = getHarnessWebContents();
  const started = now();
  const deadline = started + timeoutMs;
  const probe = startRestartProbe(win);

  let sawUnload = !previousWc;
  let settledAt = null;
  while (now() < deadline) {
    assertRestartAccepted(probe);
    if (!sawUnload && hasWorkbenchUnloaded(previousWc, getHarnessWebContents)) {
      sawUnload = true;
    }
    if (sawUnload && probe.settled) break;
    if (probe.settled && !sawUnload) {
      if (settledAt === null) settledAt = now();
      else if (now() - settledAt >= unloadGraceMs) {
        throw new Error('Previous workbench did not unload during restart');
      }
    }
    await sleep(pollMs);
  }
  if (!probe.settled) throw new Error(`Restart did not complete within ${timeoutMs} ms`);
  if (!sawUnload) throw new Error('Previous workbench did not unload during restart');
  await waitForClientReady({ rejectWc: previousWc });
  return now() - started;
}

function startRuntimeMeasurement() {
  const { app } = require('electron');
  const root = (process.argv.find(arg => arg.startsWith('--source-root=')) || '').slice('--source-root='.length);
  const output = (process.argv.find(arg => arg.startsWith('--perf-report=')) || '').slice('--perf-report='.length);
  if (!root || !output) throw new Error('Missing --source-root or --perf-report');
  /** @type {{phase: string, elapsedMs: number, lagMs: number, workingSetMiB: number, processCount: number}[]} */
  const samples = [];
  let expected = performance.now() + 25;
  let maxLagMs = 0;
  let peakWorkingSetMiB = 0;
  /** @type {import('../measure-desktop-runtime.mjs').PeakProcessSnapshot | undefined} */
  let peakProcessSnapshot;
  let phase = 'startup';
  /** @type {ReturnType<typeof setInterval>} */
  let timer;
  /** @type {string | undefined} */
  let samplingError;

  function sample() {
    const now = performance.now();
    const lagMs = Math.max(0, now - expected);
    maxLagMs = Math.max(maxLagMs, lagMs);
    expected = now + 25;
    if (!app.isReady()) return;
    try {
      // Electron reports workingSetSize (and privateBytes on Windows) in KiB.
      const processes = app.getAppMetrics();
      const workingSetMiB = processes.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024;
      if (workingSetMiB > peakWorkingSetMiB) {
        peakWorkingSetMiB = workingSetMiB;
        // Capture one simultaneous process set, not the sum of each process's
        // individual peak at different times. Store no argv or profile paths.
        peakProcessSnapshot = capturePeakProcessSnapshot(processes, phase, now);
      }
      samples.push({ phase, elapsedMs: now, lagMs, workingSetMiB, processCount: processes.length });
    } catch (error) {
      samplingError = error instanceof Error ? error.message : String(error);
    }
  }

  async function measure() {
    /** @type {import('../measure-desktop-runtime.mjs').RuntimeReport & {samples: typeof samples}} */
    const report = { schemaVersion: 1, ok: false, samples };
    try {
      await app.whenReady();
      await clientReady(app, root);
      report.startupMs = process.uptime() * 1000;
      await pause(1000);
      const importGuard = require(path.join(root, 'src/main/import-guard.js'));
      await waitForMaintenanceIdle(importGuard);
      phase = 'restart';
      const { getMainWindow, getHarnessWebContents } = require(path.join(root, 'src/main/window.js'));
      const win = getMainWindow();
      if (!win || win.isDestroyed()) throw new Error('Main window unavailable for restart');
      report.restartMs = await performMeasuredRestart({
        win,
        getHarnessWebContents,
        waitForClientReady: (options) => clientReady(app, root, options),
      });
      await pause(1000);
      if (samplingError) throw new Error(`Process sampling failed: ${samplingError}`);
      if (samples.length === 0) throw new Error('No Electron process samples collected');
      report.mainThreadLagMs = maxLagMs;
      report.peakWorkingSetMiB = peakWorkingSetMiB;
      report.peakProcessSnapshot = peakProcessSnapshot;
      report.ok = true;
    } catch (error) {
      report.error = error instanceof Error ? error.stack || error.message : String(error);
    } finally {
      clearInterval(timer);
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      // Normal quit owns the Harness/process teardown; the outer runner enforces
      // a deadline and waits for its child before reclaiming the synthetic profile.
      app.quit();
      if (!report.ok) process.exitCode = 1;
    }
  }

  // Electron exposes this main-process bootstrap method but omits it from App's
  // public declarations; it sets the source package for the external driver.
  /** @type {Electron.App & {setAppPath: (path: string) => void}} */ (app).setAppPath(root);
  timer = setInterval(sample, 25);
  require(path.join(root, 'src/main/index.js'));
  void measure();
}

const isDirectEntry = require.main === module
  || (Boolean(process.versions.electron)
    && !process.env.ELECTRON_RUN_AS_NODE
    && Boolean(process.argv[1])
    && path.resolve(process.argv[1]) === __filename);

if (isDirectEntry) {
  startRuntimeMeasurement();
}

module.exports = {
  parseSmapsRollup,
  readLinuxProcMemory,
  captureProcessSnapshotEntry,
  summarizeProcessSnapshot,
  capturePeakProcessSnapshot,
  waitForMaintenanceIdle,
  performMeasuredRestart,
};
