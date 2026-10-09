// Renderer timing capture through an explicitly enabled local Electron
// DevTools port. The sleep scenario temporarily enters sleep and the card
// scenario temporarily opens the status card; both restore the original state
// afterwards. Launch with --remote-debugging-port=9223 first.
//
// A run only counts as valid when the pet is actually visible AND a live
// engine keeps producing successful inference frames: a stalled or failing
// renderer reports fast timings for nothing, which would otherwise read as a
// performance win.
import fs from 'node:fs';

const port = Number(process.argv[2] || 9223);
const seconds = Number(process.argv[3] || 120);
const screenshot = process.argv[4] || '';
const scenario = process.argv[5] || 'normal';
if (!Number.isInteger(port) || port < 1 || port > 65535
    || !Number.isFinite(seconds) || seconds < 1 || seconds > 3600
    || !['normal', 'sleep', 'card'].includes(scenario)) {
  throw new Error('usage: node scripts/measure-whale-cdp.mjs [port] [seconds] [screenshot.png] [normal|sleep|card]');
}

const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pet = pages.find((page) => page.url === 'pet://pet/pet-live2d.html');
if (!pet?.webSocketDebuggerUrl) { throw new Error('pet renderer not found on DevTools port'); }
const socket = new WebSocket(pet.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
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
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) { throw new Error(result.exceptionDetails.text); }
  return result.result?.value;
}

let wasSleeping;
let wasPanelOpen;
let perfStarted = false;
try {
  wasSleeping = await evaluate('sleeping');
  wasPanelOpen = await evaluate('Boolean(panel)');
  if (scenario === 'sleep' && !wasSleeping) { await evaluate('sleepEnter()'); }
  if (scenario !== 'sleep' && wasSleeping) { await evaluate('wake()'); }
  if (scenario === 'card' && !wasPanelOpen) { await evaluate('openPanel()'); }
  const engine = await evaluate(`({backend: sessionOnGpu ? 'webgpu' : session ? 'wasm-or-webnn' : rig.ready ? 'rig' : 'states',
    superResolution: srReady, width: canvas.width, height: canvas.height, frame: FRAME, scenario: '${scenario}',
    sleeping, inferenceGapMs: powerSaving(performance.now()) ? 110 : 50})`);
  const liveEngine = engine.backend === 'webgpu' || engine.backend === 'wasm-or-webnn';
  await evaluate('window.__dshdPetPerf.start()');
  perfStarted = true;
  const states = [];
  const started = Date.now();
  while (Date.now() - started < seconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(1, seconds * 1000 - (Date.now() - started)))));
    states.push({ elapsedMs: Date.now() - started, ...(await evaluate(`({sleeping, inferenceGapMs: powerSaving(performance.now()) ? 110 : 50,
      visibility: document.visibilityState, focused: document.hasFocus(),
      pointerOverPet: overPet(pointer.x, pointer.y),
      panelOpen: Boolean(panel), painted,
      bodyVisible: Boolean(session || rig.ready) || stillCtl.alpha > 0.01,
      inferenceCount: window.__dshdPetPerf.snapshot().inference?.count || 0})`)) });
  }
  const timings = await evaluate('window.__dshdPetPerf.stop()');
  perfStarted = false;
  if (screenshot) {
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(screenshot, Buffer.from(shot.data, 'base64'));
  }
  const attempts = (timings.inference?.count || 0) + (timings.inferenceBusy?.count || 0);
  const sleepAttemptLimit = Math.ceil(seconds * 1000 / engine.inferenceGapMs) + 5;
  // A visible pet is a painted one whose body is actually being drawn; the
  // live engines additionally have to keep landing frames without errors.
  const petVisible = states.every((state) => state.painted && state.bodyVisible);
  // "Ongoing" is proven by the live frame counter actually advancing between
  // samples — a hardcoded rate would misjudge a machine whose inference simply
  // takes longer than the pacing gap.
  const inferenceProgress = states.at(-1).inferenceCount - states[0].inferenceCount;
  const inferencePerSample = states.length > 1 ? inferenceProgress / (states.length - 1) : 0;
  const liveInference = liveEngine
    ? inferenceProgress > 0 && inferencePerSample >= 2
      && (timings.inferenceError?.count || 0) === 0
    : null;
  const inferenceOk = liveInference === null || liveInference;
  const stableSleep = scenario === 'sleep' ? (attempts <= sleepAttemptLimit
    && states.every((state) => state.sleeping && state.inferenceGapMs === engine.inferenceGapMs)) : null;
  const stableNormal = scenario === 'normal'
    ? states.every((state) => !state.sleeping && state.inferenceGapMs === engine.inferenceGapMs) : null;
  const stableCard = scenario === 'card'
    ? states.every((state) => !state.sleeping && state.panelOpen) : null;
  const scenarioStable = scenario === 'sleep' ? stableSleep
    : scenario === 'card' ? stableCard : stableNormal;
  const validScenario = Boolean(scenarioStable) && petVisible && inferenceOk;
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), seconds, engine,
    stableSleep, stableNormal, stableCard, petVisible, inferenceProgress, liveInference,
    validScenario,
    observed: { samples: states.length, sleeping: [...new Set(states.map((s) => s.sleeping))],
      inferenceGapMs: [...new Set(states.map((s) => s.inferenceGapMs))],
      visibility: [...new Set(states.map((s) => s.visibility))],
      focused: [...new Set(states.map((s) => s.focused))],
      pointerOverPet: [...new Set(states.map((s) => s.pointerOverPet))],
      panelOpen: [...new Set(states.map((s) => s.panelOpen))],
      painted: [...new Set(states.map((s) => s.painted))],
      attempts, sleepAttemptLimit, timeline: states }, timings }, null, 2)}\n`);
  if (!validScenario) { process.exitCode = 2; }
} finally {
  try {
    if (perfStarted) { await evaluate('window.__dshdPetPerf.stop()'); }
    if (scenario === 'card' && wasPanelOpen === false) { await evaluate('closePanel()'); }
    if (scenario === 'sleep' && wasSleeping === false) { await evaluate('wake()'); }
    if (scenario !== 'sleep' && wasSleeping === true) { await evaluate('sleepEnter()'); }
  } finally {
    socket.close();
  }
}
