// Renderer timing capture through an explicitly enabled local Electron
// DevTools port. Each scenario verifies Work-Done Oracles against the live
// `window.__dshdPetDiag` source of truth and restores any overrides/state
// in a `finally` block. Launch with `--remote-debugging-port=9223` (and
// `--inspect=127.0.0.1:9229` for `power-paused`).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCENARIOS = /** @type {const} */ (['normal', 'sleep', 'card', 'power-save', 'power-paused']);

/** @type {Readonly<Record<string, number | null>>} */
export const EXPECTED_INFER_GAP_MS = Object.freeze({
  normal: 50,
  sleep: 250,
  'power-save': 110,
  card: null,
  'power-paused': null,
});

/**
 * Parse CLI arguments supporting positional options and `--main-inspect <port>`.
 * @param {string[]} argv
 */
export function parseCliArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  let mainInspectPort = /** @type {number | null} */ (null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--main-inspect') {
      mainInspectPort = Number(argv[++i]);
      if (!Number.isInteger(mainInspectPort) || mainInspectPort < 1 || mainInspectPort > 65535) {
        throw new Error('invalid --main-inspect port');
      }
      continue;
    }
    positional.push(token);
  }
  const port = Number(positional[0] || 9223);
  const seconds = Number(positional[1] || 120);
  const screenshot = positional[2] || '';
  const scenario = positional[3] || 'normal';
  const presentPerSecond = Number(positional[4]);
  const inferPerSecond = Number(positional[5]);
  const noSr = positional[6] === 'no-sr';
  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535;
  const validSecs = Number.isFinite(seconds) && seconds >= 1 && seconds <= 3600;
  if (!validPort || !validSecs || !SCENARIOS.includes(/** @type {typeof SCENARIOS[number]} */ (scenario))) {
    throw new Error('usage: node scripts/measure-whale-cdp.mjs [port] [seconds] [screenshot.png] [normal|sleep|card|power-save|power-paused] [--main-inspect <port>]');
  }
  return { port, seconds, screenshot, scenario, presentPerSecond, inferPerSecond, noSr, mainInspectPort };
}

/**
 * @typedef {{ elapsedMs?: number, sleeping: boolean, inferGapMs: number, panelOpen?: boolean, painted?: boolean, bodyVisible?: boolean, inferenceCount?: number }} SampleState
 * @typedef {{ frameProduction?: { count?: number }, inferenceBusy?: { count?: number }, displayRefresh?: { count?: number } }} PetTimings
 */

/**
 * @param {SampleState[]} states
 * @param {{ attempts: number, seconds: number, liveEngine: boolean, perSecond: number, noErrors: boolean, sleepAttemptLimit: number, idleCursorSends: number | null }} stats
 */
function checkSleepOracle(states, stats) {
  const gapOk = states.every((s) => s.sleeping && s.inferGapMs === 250);
  const rateOk = !stats.liveEngine || (stats.perSecond >= 2.5 && stats.perSecond <= 4.5 && stats.noErrors);
  const cursorOk = stats.idleCursorSends === null || stats.seconds <= 0 || (stats.idleCursorSends / stats.seconds) <= 2.5;
  return { ok: gapOk && stats.attempts <= stats.sleepAttemptLimit && rateOk && cursorOk, invalidReason: '' };
}

/**
 * @param {SampleState[]} states
 * @param {{ attempts: number, seconds: number, inferenceProgress: number, noErrors: boolean }} stats
 */
function checkPowerSaveOracle(states, stats) {
  const gapOk = states.every((s) => !s.sleeping && s.inferGapMs === 110);
  const limit = Math.ceil((stats.seconds * 1000) / 110) + 5;
  return { ok: gapOk && stats.attempts <= limit && stats.inferenceProgress > 0 && stats.noErrors, invalidReason: '' };
}

/**
 * @param {number} frameCount
 * @param {number} displayCount
 * @param {number | null} cursorSends
 * @param {number | null} resumeMs
 */
function checkPowerPausedOracle(frameCount, displayCount, cursorSends, resumeMs) {
  const pausedOk = frameCount === 0 && displayCount === 0 && (cursorSends ?? 0) === 0;
  const resumeOk = typeof resumeMs === 'number' && resumeMs >= 0 && resumeMs <= 3000;
  return { ok: pausedOk && resumeOk, invalidReason: '' };
}

/**
 * @param {string} scenario
 * @param {SampleState[]} states
 * @param {{ liveEngine: boolean, perSecond: number, inferenceProgress: number, inferencePerSample: number, noErrors: boolean }} stats
 */
function checkDefaultOrCardOracle(scenario, states, stats) {
  if (scenario === 'card') {
    const panelOk = states.every((s) => !s.sleeping && s.panelOpen);
    const inferOk = !stats.liveEngine || (stats.inferenceProgress > 0 && stats.inferencePerSample >= 2 && stats.noErrors);
    return { ok: panelOk && inferOk, invalidReason: '' };
  }
  const gapOk = states.every((s) => !s.sleeping && s.inferGapMs === 50);
  const rateOk = !stats.liveEngine || (stats.perSecond >= 12 && stats.inferenceProgress > 0 && stats.noErrors);
  const invalidReason = stats.liveEngine && stats.perSecond < 12 ? 'INVALID: machine-too-slow' : '';
  return { ok: gapOk && rateOk, invalidReason };
}

/**
 * @param {string} scenario
 * @param {SampleState[]} states
 * @param {{ frameCount: number, displayCount: number, attempts: number, seconds: number, liveEngine: boolean, perSecond: number, inferenceProgress: number, inferencePerSample: number, noErrors: boolean, sleepAttemptLimit: number, cursorSends: number | null, resumeMs: number | null, idleCursorSends: number | null }} stats
 */
function dispatchOracleCheck(scenario, states, stats) {
  if (scenario === 'sleep') {
    return checkSleepOracle(states, stats);
  }
  if (scenario === 'power-save') {
    return checkPowerSaveOracle(states, stats);
  }
  if (scenario === 'power-paused') {
    return checkPowerPausedOracle(stats.frameCount, stats.displayCount, stats.cursorSends, stats.resumeMs);
  }
  return checkDefaultOrCardOracle(scenario, states, stats);
}

/**
 * @param {SampleState[]} states
 * @param {PetTimings | null | undefined} timings
 * @param {{ inferenceError?: number } | null | undefined} counts
 * @param {number} seconds
 */
function buildSampleMetrics(states, timings, counts, seconds) {
  const frameCount = timings?.frameProduction?.count ?? 0;
  const busyCount = timings?.inferenceBusy?.count ?? 0;
  const displayCount = timings?.displayRefresh?.count ?? 0;
  const firstCount = states[0]?.inferenceCount ?? 0;
  const lastCount = states.at(-1)?.inferenceCount ?? 0;
  const inferenceProgress = states.length > 1 ? (lastCount - firstCount) : frameCount;
  return {
    frameCount,
    displayCount,
    attempts: frameCount + busyCount,
    sleepAttemptLimit: Math.ceil((seconds * 1000) / 250) + 5,
    perSecond: seconds > 0 ? frameCount / seconds : 0,
    inferenceProgress,
    inferencePerSample: states.length > 1 ? inferenceProgress / (states.length - 1) : frameCount,
    petVisible: states.length > 0 && states.every((s) => Boolean(s.painted) && Boolean(s.bodyVisible)),
    noErrors: (counts?.inferenceError ?? 0) === 0,
  };
}

/**
 * @param {string} scenario
 * @param {boolean} liveEngine
 * @param {number} frameCount
 * @param {number} inferenceProgress
 * @param {boolean} noErrors
 * @returns {boolean | null}
 */
function computeLiveInference(scenario, liveEngine, frameCount, inferenceProgress, noErrors) {
  if (scenario === 'power-paused') return frameCount === 0 && noErrors;
  if (liveEngine) return inferenceProgress > 0 && noErrors;
  return null;
}

/**
 * Evaluate scenario oracle using `effective.inferGapMs` from the renderer rather than hardcoded 110/50.
 * @param {{
 *   scenario: string,
 *   states: SampleState[],
 *   effective?: { inferGapMs?: number } | null,
 *   timings?: PetTimings | null,
 *   counts?: { inferenceError?: number } | null,
 *   seconds: number,
 *   liveEngine?: boolean,
 *   cursorSends?: number | null,
 *   resumeMs?: number | null,
 *   idleCursorSends?: number | null,
 * }} input
 */
export function assessScenario(input) {
  const { scenario, states, effective = null, timings = null, counts = null, seconds, liveEngine = false } = input;
  const expectedInferGapMs = EXPECTED_INFER_GAP_MS[scenario] ?? null;
  const m = buildSampleMetrics(states, timings, counts, seconds);
  const outcome = dispatchOracleCheck(scenario, states, {
    ...m,
    seconds,
    liveEngine,
    cursorSends: input.cursorSends ?? null,
    resumeMs: input.resumeMs ?? null,
    idleCursorSends: input.idleCursorSends ?? null,
  });
  const effectiveOk = expectedInferGapMs === null
    || effective === null
    || effective.inferGapMs === undefined
    || effective.inferGapMs === expectedInferGapMs;
  const scenarioStable = outcome.ok && effectiveOk;
  const liveInference = computeLiveInference(scenario, liveEngine, m.frameCount, m.inferenceProgress, m.noErrors);
  const validScenario = scenarioStable && (scenario === 'power-paused' || (m.petVisible && liveInference !== false));

  return {
    expectedInferGapMs,
    scenarioStable,
    petVisible: m.petVisible,
    inferenceProgress: m.inferenceProgress,
    liveInference,
    validScenario,
    attempts: m.attempts,
    sleepAttemptLimit: m.sleepAttemptLimit,
    oracle: {
      name: scenario,
      status: validScenario ? 'pass' : 'fail',
      ...(outcome.invalidReason ? { invalidReason: outcome.invalidReason } : {}),
    },
  };
}

/** @param {string} wsUrl */
async function openWsCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  /** @type {Map<number, { resolve: (val: unknown) => void, reject: (err: Error) => void }>} */
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    const settle = pending.get(message.id);
    if (!settle) { return; }
    pending.delete(message.id);
    if (message.error) { settle.reject(new Error(message.error.message)); }
    else { settle.resolve(message.result); }
  });
  function command(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    /** @type {{ exceptionDetails?: { text?: string }, result?: { value?: unknown } }} */
    const result = /** @type {{ exceptionDetails?: { text?: string }, result?: { value?: unknown } }} */ (
      await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    );
    if (result.exceptionDetails) { throw new Error(result.exceptionDetails.text || 'CDP evaluate error'); }
    return result.result?.value;
  }
  return { socket, command, evaluate };
}

/** @param {number} port */
async function connectPetTarget(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const pet = pages.find((page) => page.url === 'pet://pet/pet-live2d.html');
  if (!pet?.webSocketDebuggerUrl) { throw new Error('pet renderer not found on DevTools port'); }
  return openWsCdp(pet.webSocketDebuggerUrl);
}

/** @param {number} inspectPort */
async function connectMainInspector(inspectPort) {
  const list = await (await fetch(`http://127.0.0.1:${inspectPort}/json`)).json();
  const target = Array.isArray(list) ? list[0] : null;
  if (!target?.webSocketDebuggerUrl) { throw new Error('main process Node inspector not found'); }
  const client = await openWsCdp(target.webSocketDebuggerUrl);
  await client.evaluate(`(() => {
    if (globalThis.__whaleCdpCursorWrap) return true;
    const { BrowserWindow } = process.mainModule.require('electron');
    const wrapped = [];
    for (const win of BrowserWindow.getAllWindows()) {
      const url = win.webContents?.getURL?.() || '';
      if (!url.startsWith('pet://')) continue;
      const wc = win.webContents;
      const origSend = wc.send.bind(wc);
      const counts = { cursor: 0 };
      wc.send = (channel, ...args) => {
        if (channel === 'shell:live2d-cursor') counts.cursor += 1;
        return origSend(channel, ...args);
      };
      wrapped.push({ wc, origSend, counts });
    }
    globalThis.__whaleCdpCursorWrap = {
      wrapped,
      readCursor: () => wrapped.reduce((s, e) => s + e.counts.cursor, 0),
      resetCursor: () => { for (const e of wrapped) e.counts.cursor = 0; },
      restore: () => {
        for (const e of wrapped) { try { e.wc.send = e.origSend; } catch {} }
        delete globalThis.__whaleCdpCursorWrap;
      },
    };
    return true;
  })()`);
  return client;
}

/** @typedef {Awaited<ReturnType<typeof openWsCdp>>} CdpClient */

/**
 * @param {CdpClient} pet
 * @param {ReturnType<typeof parseCliArgs>} opts
 */
async function applyInitialState(pet, opts) {
  const wasSleeping = Boolean(await pet.evaluate('sleeping'));
  const wasPanelOpen = Boolean(await pet.evaluate('Boolean(panel)'));
  if (opts.scenario === 'sleep' && !wasSleeping) { await pet.evaluate('sleepEnter()'); }
  if (opts.scenario !== 'sleep' && wasSleeping) { await pet.evaluate('wake()'); }
  if (opts.scenario === 'card' && !wasPanelOpen) { await pet.evaluate('openPanel()'); }
  if (opts.scenario === 'power-save') {
    await pet.evaluate('idle.lastInteract = performance.now() - 70000; settings.powerSave = true;');
  }
  let overridesApplied = false;
  if (Number.isFinite(opts.presentPerSecond) || Number.isFinite(opts.inferPerSecond) || opts.noSr) {
    const applied = await pet.evaluate(`window.__dshdPetDiag.setOverrides({
      presentPerSecond: ${Number.isFinite(opts.presentPerSecond) ? opts.presentPerSecond : 'undefined'},
      inferPerSecond: ${Number.isFinite(opts.inferPerSecond) ? opts.inferPerSecond : 'undefined'},
      superResolution: ${opts.noSr ? 'false' : 'undefined'},
    })`);
    overridesApplied = true;
    process.stderr.write(`pet-measure: overrides ${JSON.stringify(applied)}\n`);
  }
  return { wasSleeping, wasPanelOpen, overridesApplied };
}

/**
 * @param {CdpClient} pet
 * @param {number} seconds
 * @returns {Promise<SampleState[]>}
 */
async function collectSamples(pet, seconds) {
  /** @type {SampleState[]} */
  const states = [];
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    const waitMs = Math.min(1000, Math.max(1, seconds * 1000 - (Date.now() - started)));
    await new Promise((r) => setTimeout(r, waitMs));
    const sample = /** @type {Record<string, unknown>} */ (await pet.evaluate(`({sleeping, inferGapMs: window.__dshdPetDiag.effective().inferGapMs,
      visibility: document.visibilityState, focused: document.hasFocus(),
      pointerOverPet: overPet(pointer.x, pointer.y),
      panelOpen: Boolean(panel), painted,
      bodyVisible: Boolean(session || rig.ready) || stillCtl.alpha > 0.01,
      inferenceCount: window.__dshdPetPerf.snapshot().frameProduction?.count || 0})`));
    states.push({ elapsedMs: Date.now() - started, .../** @type {SampleState} */ (sample) });
  }
  return states;
}

/**
 * @param {CdpClient} pet
 * @param {CdpClient} mainInsp
 * @returns {Promise<number | null>}
 */
async function measureUnlockResume(pet, mainInsp) {
  await pet.evaluate('window.__dshdPetPerf.start()');
  const t0 = Date.now();
  await mainInsp.evaluate("process.mainModule.require('electron').powerMonitor.emit('unlock-screen')");
  let resumeMs = /** @type {number | null} */ (null);
  while (Date.now() - t0 < 4000) {
    const progressed = await pet.evaluate('(window.__dshdPetPerf.snapshot().frameProduction?.count || 0) > 0');
    if (progressed) {
      resumeMs = Date.now() - t0;
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  await pet.evaluate('window.__dshdPetPerf.stop()');
  return resumeMs;
}

/**
 * @param {CdpClient} pet
 * @param {CdpClient | null} mainInsp
 * @param {{ scenario: string, wasSleeping: boolean, wasPanelOpen: boolean, overridesApplied: boolean, perfStarted: boolean, powerPausedActive: boolean }} state
 */
async function cleanupState(pet, mainInsp, state) {
  try {
    if (state.powerPausedActive && mainInsp) {
      await mainInsp.evaluate("process.mainModule.require('electron').powerMonitor.emit('unlock-screen')");
    }
    if (mainInsp) {
      await mainInsp.evaluate('globalThis.__whaleCdpCursorWrap?.restore()');
    }
    if (state.perfStarted) { await pet.evaluate('window.__dshdPetPerf.stop()'); }
    if (state.overridesApplied) { await pet.evaluate('window.__dshdPetDiag.setOverrides({})'); }
    if (state.scenario === 'card' && !state.wasPanelOpen) { await pet.evaluate('closePanel()'); }
    if (state.scenario === 'sleep' && !state.wasSleeping) { await pet.evaluate('wake()'); }
    if (state.scenario !== 'sleep' && state.wasSleeping) { await pet.evaluate('sleepEnter()'); }
  } finally {
    pet.socket.close();
    mainInsp?.socket.close();
  }
}

/** @param {ReturnType<typeof parseCliArgs>} opts */
async function main(opts) {
  const pet = await connectPetTarget(opts.port);
  const mainInsp = opts.mainInspectPort ? await connectMainInspector(opts.mainInspectPort) : null;
  const state = {
    scenario: opts.scenario,
    wasSleeping: false,
    wasPanelOpen: false,
    overridesApplied: false,
    perfStarted: false,
    powerPausedActive: false,
  };

  try {
    Object.assign(state, await applyInitialState(pet, opts));
    const engine = /** @type {{ backend: string, inferenceGapMs: number }} */ (await pet.evaluate(`({backend: sessionOnGpu ? 'webgpu' : session ? 'wasm-or-webnn' : rig.ready ? 'rig' : 'states',
      superResolution: srReady, width: canvas.width, height: canvas.height, frame: FRAME, scenario: '${opts.scenario}',
      sleeping, inferenceGapMs: window.__dshdPetDiag.effective().inferGapMs})`));
    const liveEngine = engine.backend === 'webgpu' || engine.backend === 'wasm-or-webnn';

    if (opts.scenario === 'power-paused') {
      if (!mainInsp) throw new Error('power-paused scenario requires --main-inspect <port>');
      await mainInsp.evaluate("process.mainModule.require('electron').powerMonitor.emit('lock-screen')");
      state.powerPausedActive = true;
      await new Promise((r) => setTimeout(r, 250));
      await mainInsp.evaluate('globalThis.__whaleCdpCursorWrap?.resetCursor()');
    }

    await pet.evaluate('window.__dshdPetPerf.start()');
    state.perfStarted = true;
    const states = await collectSamples(pet, opts.seconds);
    const timings = /** @type {PetTimings & { counts?: { inferenceError?: number } }} */ (await pet.evaluate('window.__dshdPetPerf.stop()'));
    state.perfStarted = false;
    const cursorSends = mainInsp ? /** @type {number | null} */ (await mainInsp.evaluate('globalThis.__whaleCdpCursorWrap?.readCursor() ?? null')) : null;
    let resumeMs = /** @type {number | null} */ (null);
    if (opts.scenario === 'power-paused' && mainInsp) {
      state.powerPausedActive = false;
      resumeMs = await measureUnlockResume(pet, mainInsp);
    }

    const counts = timings.counts || /** @type {{ inferenceError?: number }} */ (await pet.evaluate('window.__dshdPetPerf.snapshot().counts'));
    const effective = /** @type {{ inferGapMs?: number }} */ (await pet.evaluate('window.__dshdPetDiag.effective()'));
    const panelTrace = opts.scenario === 'card' ? await pet.evaluate('window.__dshdPetDiag.panelTrace()') : null;
    if (opts.screenshot) {
      const shot = /** @type {{ data: string }} */ (await pet.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }));
      fs.writeFileSync(opts.screenshot, Buffer.from(shot.data, 'base64'));
    }

    const assessed = assessScenario({
      scenario: opts.scenario,
      states,
      effective,
      timings,
      counts,
      seconds: opts.seconds,
      liveEngine,
      cursorSends: opts.scenario === 'power-paused' ? cursorSends : null,
      resumeMs,
      idleCursorSends: opts.scenario === 'sleep' ? cursorSends : null,
    });
    process.stdout.write(`${JSON.stringify({
      at: new Date().toISOString(),
      seconds: opts.seconds,
      engine,
      effective,
      counts,
      cursorSends,
      resumeMs,
      ...assessed,
      observed: {
        samples: states.length,
        sleeping: [...new Set(states.map((s) => s.sleeping))],
        inferGapMs: [...new Set(states.map((s) => s.inferGapMs))],
        timeline: states,
      },
      panelTrace,
      timings,
    }, null, 2)}\n`);
    if (!assessed.validScenario) { process.exitCode = 2; }
  } finally {
    await cleanupState(pet, mainInsp, state);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(parseCliArgs(process.argv.slice(2)));
}
