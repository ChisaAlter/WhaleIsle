'use strict';

// Explicit Electron benchmark entry. Normal application launches never load it.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = (process.argv.find(arg => arg.startsWith('--source-root=')) || '').slice('--source-root='.length);
const output = (process.argv.find(arg => arg.startsWith('--perf-report=')) || '').slice('--perf-report='.length);
if (!root || !output) throw new Error('Missing --source-root or --perf-report');
/** @type {{phase: string, elapsedMs: number, lagMs: number, workingSetMiB: number, processCount: number}[]} */
const samples = [];
let expected = performance.now() + 25;
let maxLagMs = 0;
let peakWorkingSetMiB = 0;
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
    // Electron reports workingSetSize in KiB, for this app's entire process set.
    const processes = app.getAppMetrics();
    const workingSetMiB = processes.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024;
    peakWorkingSetMiB = Math.max(peakWorkingSetMiB, workingSetMiB);
    samples.push({ phase, elapsedMs: now, lagMs, workingSetMiB, processCount: processes.length });
  } catch (error) {
    samplingError = error instanceof Error ? error.message : String(error);
  }
}

/** @param {number} ms */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function clientReady() {
  const { getHarnessWebContents } = require(path.join(root, 'src/main/window.js'));
  const { readLastDesktopStart } = require(path.join(root, 'src/main/launcher-gate.js'));
  const deadline = performance.now() + 180000;
  while (performance.now() < deadline) {
    const startup = readLastDesktopStart(app.getPath('userData'));
    if (startup.ok === false) throw new Error(`Desktop start failed: ${startup.error}`);
    const wc = getHarnessWebContents();
    if (wc && !wc.isDestroyed() && !wc.isLoading()) {
      // Require the assembled workbench, rather than an HTTP-ready host alone.
      const ready = await wc.executeJavaScript('Boolean(document.querySelector("[data-dshd-caption=band]"))');
      if (ready) return wc;
    }
    await pause(100);
  }
  throw new Error('Desktop workbench did not become ready within 180 seconds');
}

async function measure() {
  /** @type {import('../measure-desktop-runtime.mjs').RuntimeReport & {samples: typeof samples}} */
  const report = { schemaVersion: 1, ok: false, samples };
  try {
    await app.whenReady();
    await clientReady();
    report.startupMs = process.uptime() * 1000;
    await pause(1000);
    phase = 'restart';
    const { getMainWindow } = require(path.join(root, 'src/main/window.js'));
    const win = getMainWindow();
    if (!win || win.isDestroyed()) throw new Error('Main window unavailable for restart');
    const started = performance.now();
    // Exercise the same privileged renderer entry as the user, including cleanup.
    const outcome = await win.webContents.executeJavaScript('window.shell.restart()');
    if (outcome?.proceeded === false) throw new Error(`Restart refused: ${outcome.code}`);
    await clientReady();
    report.restartMs = performance.now() - started;
    await pause(1000);
    if (samplingError) throw new Error(`Process sampling failed: ${samplingError}`);
    if (samples.length === 0) throw new Error('No Electron process samples collected');
    report.mainThreadLagMs = maxLagMs;
    report.peakWorkingSetMiB = peakWorkingSetMiB;
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
