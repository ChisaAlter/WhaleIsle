'use strict';

// THA4 neural-avatar desktop pet renderer. The main process gives us a
// transparent always-on-top window covering the WHOLE virtual screen; the
// window itself never moves — the character is painted at `drawPos` inside
// the canvas, so a drag is just a repaint at new coordinates (moving the
// layered window via setPosition blanks its surface on Windows).
//
// Click-through is the default (main side `setIgnoreMouseEvents(true,
// {forward:true})`), so mousemove keeps arriving everywhere. While the
// pointer is inside the pet bounds we ask the main process to make the
// window interactive, which enables tap reactions and dragging.
const canvas = document.getElementById('pet');
// `let` (not const) so the status-card raster cache can point the shared
// painter at an offscreen context for the duration of one synchronous build.
let ctx2d = canvas.getContext('2d');
const bubbleStyle = getComputedStyle(document.documentElement);

// Opt-in, in-memory measurements for the pet DevTools console. No sampling
// or logging runs in normal use: __dshdPetPerf.start(), then .stop().
const petPerf = (() => {
  let enabled = false;
  let started = 0;
  let samples = {};
  let timingCounts = {};
  // Pure counts (no timing sample storage): these must keep counting even
  // after the per-bucket sample cap is hit, otherwise a long soak reports
  // "0 events" for the thing it is actually measuring.
  const counts = Object.create(null);
  const bump = (name) => { if (enabled) { counts[name] = (counts[name] || 0) + 1; } };
  const percentile = (values, fraction) => {
    if (!values.length) { return 0; }
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil((sorted.length - 1) * fraction)];
  };
  const snapshot = () => {
    const seconds = Math.max(0.001, (performance.now() - started) / 1000);
    return {
      ...Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, {
        count: timingCounts[name],
        perSecond: +(timingCounts[name] / seconds).toFixed(2),
        p50Ms: +percentile(values, 0.5).toFixed(2),
        p95Ms: +percentile(values, 0.95).toFixed(2),
      }])),
      counts: { ...counts },
    };
  };
  return {
    get enabled() { return enabled; },
    start() { samples = {}; timingCounts = {}; for (const k of Object.keys(counts)) { delete counts[k]; } started = performance.now(); enabled = true; },
    stop() { enabled = false; return snapshot(); },
    snapshot,
    bump,
    record(name, ms) {
      if (!enabled) { return; }
      timingCounts[name] = (timingCounts[name] || 0) + 1;
      const bucket = samples[name] || (samples[name] = []);
      if (bucket.length < 60000) { bucket.push(ms); }
    },
  };
})();
window.__dshdPetPerf = petPerf;

const MODEL_URL = 'pet://pet/pet-live2d/avatar/model.onnx';
const CHARACTER_URL = 'pet://pet/pet-live2d/avatar/character.png';
// The 1024² export is currently disabled: its WebGPU output is all-white.
// Keep the active 512² model as the only packaged runtime candidate.
let FRAME = 512;
// Region of the FRAME² output that contains the character, drawn into the
// canvas at PET_W x PET_H. Scales with FRAME.
let CROP = { x: 60, y: 20, w: 390, h: 492 };
const PET_W = 240;
const PET_H = 260;
// Persisted pet settings (live2dPet.settings) — defaults mirror
// pet-settings.js; the real normalized object arrives via IPC at mount and
// on every change push.
let settings = {
  scale: 1, opacity: 1, personality: 'natural', activity: 'balanced',
  selfTalk: true, wander: true, lockPosition: false, shiftToDrag: false,
  powerSave: false, clickSound: false, chatEnabled: true, approvalButtons: false,
  lookModel: '', lookAvailable: false,
};
// Effective draw size — every layout/hit/anchor use goes through petW/petH
// so the scale slider resizes drawing, bounds, roam reports at once.
const petW = () => PET_W * (settings.scale || 1);
const petH = () => PET_H * (settings.scale || 1);
const HOVER_PADDING = 8;
const EXIT_HYSTERESIS = 8;
const DRAG_THRESHOLD = 4;
const TAP_REACTION_MS = 1400;
// Activity tiers (§B3): self-talk / wander interval ranges in ms. Missed
// slots are rescheduled forward, never back-paid.
const ACTIVITY_MS = {
  quiet: { talk: [360000, 720000], wander: [600000, 1200000] },
  balanced: { talk: [120000, 240000], wander: [300000, 540000] },
  active: { talk: [40000, 80000], wander: [120000, 240000] },
};
function activityPair(key) {
  return (ACTIVITY_MS[settings.activity] || ACTIVITY_MS.balanced)[key];
}
// Idle-chatter category bias per persona — nudges pool selection only.
const PERSONA_BIAS = {
  genki: { clingy: 0.15 },
  tsundere: { clingy: -0.15 },
  poison: { clingy: -0.05 },
};

let session = null;
let sessionOnGpu = false;
let imageTensor = null;
let poseGpuBuffer = null;
let poseTensor = null;
let inferBusy = false;

let interactive = false;
let dragging = false;
let dragMoved = false;
let grabOffset = null;
let downClient = null;
// Character top-left in window (canvas) coordinates. Screen coordinates
// only ever appear in IPC payloads; `overlayOrigin` (the overlay's screen
// position, sent by main) converts between the two spaces — event.screenX
// and window.screenX are NOT used because they mix physical px and DIP on
// multi-DPI setups, which flung the character off-canvas mid-drag.
let overlayOrigin = { x: 0, y: 0 };
let displayRects = []; // display bounds in window coords
let homeRect = null; // the display the overlay currently covers
let drawPos = {
  x: Math.max(0, window.innerWidth - petW() - 24),
  y: Math.max(0, window.innerHeight - petH() - 24),
};
let painted = false;
let charRect = null; // pet-local rect of the character's non-transparent pixels
let charRectFrames = 0; // rendered frames since last silhouette re-measure
let exitInteractiveTimer = 0;

const petShell = window.shell || {};

// ── pose controller (ported from THA4 web_demo IdlePoseGenerator) ──
// 45-dim layout: 0-11 eyebrows, 12-23 eye shapes, 24-25 iris_small,
// 26-36 mouth shapes, 37-38 iris pitch/yaw, 39-40 head pitch/yaw,
// 41 neck tilt, 42-43 body sway, 44 breathing.
const pose = new Float32Array(45);
const rng = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);
// in-out envelope for an action: 0→1→0 across its duration
const actEnv = (phase) => Math.sin(Math.PI * clamp01(phase));

// Idle micro-actions — picked at random every few seconds. Each applies an
// envelope value k∈[0,1] plus the phase for looping shapes.
const ACTS = [
  { dur: 1.7, apply: (k, p) => { p[41] += 0.55 * k; p[39] += 0.18 * k; } },                    // head tilt
  { dur: 2.0, apply: (k, p) => { p[40] += 0.7 * k; p[38] += 0.55 * k; } },                    // look left
  { dur: 2.0, apply: (k, p) => { p[40] -= 0.7 * k; p[38] -= 0.55 * k; } },                    // look right
  { dur: 1.9, apply: (k, p) => { p[14] = p[15] = Math.max(p[14], 0.8 * k); p[8] = p[9] = 0.6 * k; p[34] = p[35] = 0.35 * k; } }, // happy-eye smile
  { dur: 1.1, apply: (k, p, t) => { p[42] += 0.4 * Math.sin(t * 14) * k; p[44] += 0.35 * k; } }, // happy bounce
  { dur: 0.9, apply: (k, p) => { p[12] = Math.max(p[12], k); } },                             // wink (left)
  { dur: 0.9, apply: (k, p) => { p[13] = Math.max(p[13], k); } },                             // wink (right)
];
const YAWN = { dur: 2.6, apply: (k, p) => { p[12] = p[13] = Math.max(p[12], 0.7 * k); p[18] = p[19] = Math.max(p[18], 0.5 * k); p[6] = p[7] = 0.4 * k; p[39] += 0.2 * k; p[26] = Math.max(p[26], 0.4 * k); } };

// Tap reactions rotate through four expressions.
// Tap reactions rotate through four expressions. Mouth channels are kept
// small: the source art's mouth is a 2px line so the model barely morphs
// it — eyes/brows/head carry the expression instead.
const TAP_KINDS = [
  (k, p) => { p[14] = p[15] = Math.max(p[14], 0.9 * k); p[8] = p[9] = 0.7 * k; p[34] = p[35] = 0.4 * k; p[42] += 0.3 * k; }, // happy ^^ + bounce
  (k, p) => { p[16] = p[17] = 0.9 * k; p[6] = p[7] = 0.8 * k; p[39] -= 0.2 * k; p[42] += 0.35 * k; },                       // surprised + hop
  (k, p) => { p[20] = 0.8 * k; p[21] = 0.4 * k; p[10] = p[11] = 0.6 * k; p[36] = 0.3 * k; p[41] += 0.35 * k; },             // smug + tilt
  (k, p) => { p[0] = p[1] = 0.7 * k; p[2] = p[3] = 0.4 * k; p[22] = p[23] = 0.5 * k; p[40] += 0.3 * Math.sin(k * 6); },     // grumpy shake
];

const idle = {
  t: 0,
  last: performance.now(),
  pby: rng(0, Math.PI * 2), pbz: rng(0, Math.PI * 2), pbr: rng(0, Math.PI * 2),
  phx: rng(0, Math.PI * 2), phy: rng(0, Math.PI * 2),
  bsy: rng(0.6, 1.0), bsz: rng(0.4, 0.7), bsb: rng(1.6, 2.0),
  nextBlink: rng(0.6, 1.6),
  blinkState: 0, blinkTimer: 0,
  blinkDur: 0.06, blinkHold: 0.08,
  // Two-tier gaze: iris snaps fast, head drifts slowly and only partially.
  ix: 0, iy: 0, mx: 0, my: 0,
  targetMx: 0, targetMy: 0,
  tapUntil: 0, tapKind: 0,
  act: null, actStart: 0, nextAct: rng(5, 10),
  lastInteract: performance.now(), sleepy: 0,
  dragVX: 0, lastDrawX: 0,
};

function stepPose() {
  const now = performance.now();
  const dt = Math.min((now - idle.last) / 1000, 0.1);
  idle.last = now;
  idle.t += dt;
  pose.fill(0);

  const breath = 0.40 * Math.sin(idle.t * idle.bsb + idle.pbr);
  const bodyY = 0.35 * Math.sin(idle.t * idle.bsy + idle.pby);
  const bodyZ = 0.30 * Math.sin(idle.t * idle.bsz + idle.pbz);
  const headX = 0.18 * Math.sin(idle.t * 1.1 + idle.phx);
  const headY = 0.14 * Math.sin(idle.t * 1.3 + idle.phy);
  const neck = 0.08 * Math.sin(idle.t * 0.55);
  const irisX = 0.10 * Math.sin(idle.t * 0.45 + idle.phy);
  const irisY = 0.07 * Math.sin(idle.t * 0.55 + idle.phx);

  // Iris leads (fast lerp, full range); head follows slowly and partially —
  // reads as her eyes finding the cursor first, then her head catching up.
  idle.ix += (idle.targetMx - idle.ix) * Math.min(dt * 16, 1);
  idle.iy += (idle.targetMy - idle.iy) * Math.min(dt * 16, 1);
  idle.mx += (idle.targetMx - idle.mx) * Math.min(dt * 5, 1);
  idle.my += (idle.targetMy - idle.my) * Math.min(dt * 5, 1);

  pose[44] = breath;
  pose[42] = bodyY + idle.mx * 0.20;
  pose[43] = bodyZ + idle.my * 0.15;
  pose[39] = headX - idle.my * 0.55;
  pose[40] = headY - idle.mx * 0.60;
  pose[41] = neck;
  pose[37] = irisX - idle.iy * 1.0;
  pose[38] = irisY - idle.ix * 1.0;

  idle.blinkTimer += dt;
  if (idle.blinkState === 0) {
    if (idle.blinkTimer >= idle.nextBlink) {
      idle.blinkState = 1;
      idle.blinkTimer = 0;
      idle.nextBlink = rng(2, 6);
      if (Math.random() < 0.15) { idle.nextBlink = 0.35; } // occasional double-blink
    }
  } else if (idle.blinkState === 1) {
    const v = Math.min(idle.blinkTimer / idle.blinkDur, 1);
    pose[12] = pose[13] = v;
    if (v >= 1) { idle.blinkState = 2; idle.blinkTimer = 0; }
  } else if (idle.blinkState === 2) {
    pose[12] = pose[13] = 1;
    if (idle.blinkTimer >= idle.blinkHold) { idle.blinkState = 3; idle.blinkTimer = 0; }
  } else {
    const v = Math.max(1 - idle.blinkTimer / idle.blinkDur, 0);
    pose[12] = pose[13] = v;
    if (v <= 0) { idle.blinkState = 0; idle.blinkTimer = 0; }
  }

  // Sleepiness: after ~90s without interaction her lids droop, head sags,
  // and she occasionally yawns. Any nearby cursor movement wakes her.
  const idleFor = now - idle.lastInteract;
  idle.sleepy += ((idleFor > 90000 ? 1 : 0) - idle.sleepy) * Math.min(dt * 0.6, 1);
  if (idle.sleepy > 0.01) {
    const s = smooth(idle.sleepy);
    pose[18] = Math.max(pose[18], 0.6 * s);
    pose[19] = Math.max(pose[19], 0.6 * s);
    pose[39] += 0.16 * s;
    pose[44] *= 1 - 0.5 * s;
  }

  // Scheduled micro-action (yawn is much more likely once sleepy).
  if (idle.act) {
    const phase = (now - idle.actStart) / (idle.act.dur * 1000);
    if (phase >= 1) {
      idle.act = null;
    } else {
      idle.act.apply(actEnv(phase), pose, phase * idle.act.dur);
    }
  } else {
    idle.nextAct -= dt;
    if (idle.nextAct <= 0) {
      idle.nextAct = rng(6, 14);
      idle.act = (idle.sleepy > 0.5 && Math.random() < 0.5)
        ? YAWN
        : ACTS[Math.floor(Math.random() * ACTS.length)];
      idle.actStart = now;
    }
  }

  // Tap reaction: rotate through the expression set.
  if (now < idle.tapUntil) {
    const k = actEnv((TAP_REACTION_MS - (idle.tapUntil - now)) / TAP_REACTION_MS);
    TAP_KINDS[idle.tapKind % TAP_KINDS.length](k, pose);
  }

  // Being carried: >< squeezed-shut eyes, brows up, head wobbling, body
  // tilting with the drag — reads as being lifted even though the model's
  // mouth morph is too weak for an open-mouth yell.
  if (dragging && dragMoved) {
    pose[12] = pose[13] = 1.0;
    pose[6] = pose[7] = 0.7;
    pose[26] = 0.35;
    const vx = physVel.x / 20; // px/s → per-frame units the pose expects
    idle.dragVX += (vx - idle.dragVX) * 0.4;
    pose[43] += Math.max(-0.8, Math.min(0.8, idle.dragVX * 0.05));
    pose[40] += 0.18 * Math.sin(idle.t * 9);
    pose[42] -= 0.12;
  }
  applyLiveState();
  isolateClosedEyes();
  idle.lastDrawX = drawPos.x;
}

// Blink/wink must win after idle, tap and live-state eye shapes have composed.
// THA4 distorts eyelids when full natural closure overlaps happy/relaxed eyes.
// Fade only the closing eye's competing shapes; keep the other eye and mouth.
function isolateClosedEyes() {
  const leftClosed = clamp01(pose[12]);
  const rightClosed = clamp01(pose[13]);
  for (let side = 0; side < 2; side += 1) {
    const open = 1 - (side === 0 ? leftClosed : rightClosed);
    for (let ch = 14 + side; ch < 26; ch += 2) { pose[ch] *= open; }
  }
  // Iris rotation is shared by both eyes: retain it for a one-eyed wink.
  const gaze = 1 - Math.min(leftClosed, rightClosed);
  pose[37] *= gaze;
  pose[38] *= gaze;
}

// ── ONNX runtime ──
async function createSession() {
  ort.env.wasm.wasmPaths = 'pet://pet/pet-live2d/ort/';
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'warning';
  for (const ep of ['webnn', 'webgpu']) {
    // The 1024² HD export renders all-white under the WebGPU EP — stick to the
    // proven 512² model until that graph is fixed.
    for (const [url, frame] of [[MODEL_URL, 512]]) {
      // The HD graph has ops that don't partition to JSEP under capture —
      // retry it without capture (slightly slower launches, still WebGPU).
      for (const capture of ep === 'webgpu' ? [true, false] : [false]) {
        try {
          const s = await ort.InferenceSession.create(url, {
            executionProviders: [ep],
            enableGraphCapture: capture,
            preferredOutputLocation: ep === 'webgpu' ? 'gpu-buffer' : undefined,
          });
          const k = frame / 512;
          FRAME = frame;
          CROP = { x: 60 * k, y: 20 * k, w: 390 * k, h: 492 * k };
          sessionOnGpu = ep === 'webgpu' && !!ort.env.webgpu?.device;
          console.log(`pet: session on ${ep} @${frame}² capture=${capture}`);
          return s;
        } catch (error) {
          console.warn(`pet: ${ep} session failed @${frame} capture=${capture}`, error);
        }
      }
    }
  }
  // WASM: SD only — a 1024² SIREN frame is ~2s on CPU, not a usable fallback.
  const s = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] });
  console.log('pet: session on wasm @512²');
  return s;
}

async function loadImageTensor() {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = CHARACTER_URL;
  });
  const off = document.createElement('canvas');
  off.width = off.height = FRAME;
  const offCtx = off.getContext('2d', { willReadFrequently: true });
  offCtx.drawImage(img, 0, 0);
  const { data } = offCtx.getImageData(0, 0, FRAME, FRAME);
  const tensor = new Float32Array(4 * FRAME * FRAME);
  for (let i = 0; i < FRAME * FRAME; i += 1) {
    const a = data[i * 4 + 3] / 255;
    tensor[i] = (data[i * 4] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME + i] = (data[i * 4 + 1] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME * 2 + i] = (data[i * 4 + 2] / 255) * a * 2 - 1;
    tensor[FRAME * FRAME * 3 + i] = a * 2 - 1;
  }
  if (sessionOnGpu) {
    // Graph capture replays the recorded command list, so every input must be
    // an external GPU buffer. The image is constant; only `pose` is rewritten
    // per frame via `queue.writeBuffer`.
    const device = ort.env.webgpu.device;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const imageBuffer = device.createBuffer({ size: tensor.byteLength, usage });
    device.queue.writeBuffer(imageBuffer, 0, tensor);
    poseGpuBuffer = device.createBuffer({ size: 45 * 4, usage });
    poseTensor = ort.Tensor.fromGpuBuffer(poseGpuBuffer, { dataType: 'float32', dims: [1, 45] });
    return ort.Tensor.fromGpuBuffer(imageBuffer, { dataType: 'float32', dims: [1, 4, FRAME, FRAME] });
  }
  return new ort.Tensor('float32', tensor, [1, 4, FRAME, FRAME]);
}

// Output buffers are sized by FRAME, which is only known once the session
// picks HD (1024²) or SD (512²) — allocate lazily after createSession().
let outCanvas = null;
let outCtx = null;
let outImage = null;
let gpuPixels = null;
function allocOutput() {
  outCanvas = document.createElement('canvas');
  outCanvas.width = outCanvas.height = FRAME;
  outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
  outImage = outCtx.createImageData(FRAME, FRAME);
}

// Keep the existing Uint8ClampedArray conversion (including ties-to-even)
// while downloading one packed RGBA byte per channel instead of four floats.
// Inference and Anime4K still use the same model and display pipeline.
async function initGpuPixels() {
  if (!sessionOnGpu) { return; }
  const device = ort.env.webgpu.device;
  const n = FRAME * FRAME;
  const shader = device.createShaderModule({ code: `
    @group(0) @binding(0) var<storage, read> rgba: array<f32>;
    @group(0) @binding(1) var<storage, read_write> pixels: array<u32>;
    fn clampedByte(v: f32) -> u32 {
      if (!(v > 0.0)) { return 0u; }
      if (v >= 255.0) { return 255u; }
      let lower = floor(v);
      let value = u32(lower);
      let fraction = v - lower;
      return value + select(0u, 1u,
        fraction > 0.5 || (fraction == 0.5 && (value & 1u) == 1u));
    }
    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let i = id.x;
      if (i >= ${n}u) { return; }
      pixels[i] = clampedByte(rgba[i])
        | (clampedByte(rgba[${n}u + i]) << 8u)
        | (clampedByte(rgba[${n * 2}u + i]) << 16u)
        | (clampedByte(rgba[${n * 3}u + i]) << 24u);
    }` });
  const pipeline = await device.createComputePipelineAsync({ layout: 'auto',
    compute: { module: shader, entryPoint: 'main' } });
  const packed = device.createBuffer({ size: n * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const staging = device.createBuffer({ size: n * 4,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  gpuPixels = { device, pipeline, packed, staging, size: n * 4, n };
}

async function copyOutputPixels(out) {
  if (gpuPixels) {
    const { device, pipeline, packed, staging, size, n } = gpuPixels;
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: out.gpuBuffer } },
      { binding: 1, resource: { buffer: packed } },
    ] });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 256));
    pass.end();
    encoder.copyBufferToBuffer(packed, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    try {
      outImage.data.set(new Uint8Array(staging.getMappedRange()));
    } finally {
      staging.unmap();
    }
    return;
  }
  const raw = sessionOnGpu ? await out.getData() : out.data;
  const px = outImage.data;
  const n = FRAME * FRAME;
  for (let i = 0; i < n; i += 1) {
    px[i * 4] = raw[i];
    px[i * 4 + 1] = raw[n + i];
    px[i * 4 + 2] = raw[n * 2 + i];
    px[i * 4 + 3] = raw[n * 3 + i];
  }
}

// ── live SR stage (Anime4K CNN, WebGL) ──
// THA4 renders painterly-soft at 512²; Anime4K restores the line art at 2×
// per frame — real-time GLSL, no per-frame readback. The net only sees RGB:
// transparent-black surroundings would smear a dark halo inward, so the
// crop's RGB is bleed-filled (destination-over with a blurred copy) before
// upscale, and alpha comes from a plain bilinear upscale composited
// destination-in afterwards — edges stay soft because alpha is smooth.
let srUp = null;        // Anime4KJS.ImageUpscaler
let srCrop = null;      // 2d canvas CROP.w × CROP.h — RGB-bleeded net input
let srBlur = null;      // scratch for the bleed pass
let srGL = null;        // WebGL canvas the upscaler renders into
let srOut = null;       // 2d canvas: SR rgb + alpha composited → drawn frame
let srReady = false;
// Whether the CURRENT `outCanvas` contents reached the display through SR.
// Cleared whenever a raw inference frame is produced, set by `srFrame()`.
let frameIsSr = false;

function initSr() {
  if (typeof Anime4KJS === 'undefined' || !Anime4KJS.ImageUpscaler?.isSupported()) {
    return;
  }
  try {
    srCrop = document.createElement('canvas');
    srCrop.width = CROP.w; srCrop.height = CROP.h;
    srBlur = document.createElement('canvas');
    srBlur.width = CROP.w; srBlur.height = CROP.h;
    srGL = document.createElement('canvas');
    srUp = new Anime4KJS.ImageUpscaler(Anime4KJS.ANIME4KJS_SIMPLE_M_2X);
    srUp.attachSource(srCrop, srGL);
    srOut = document.createElement('canvas');
    srOut.width = srGL.width; srOut.height = srGL.height;
    srReady = true;
    console.log('pet: anime4k SR ready', srGL.width, 'x', srGL.height);
  } catch (e) {
    console.warn('pet: anime4k init failed', e);
    srUp = null;
    srReady = false;
  }
}

// One inference frame → SR'd display frame. Runs inside renderFrame after
// putImageData; all steps are GPU-side draws (no readback).
function srFrame() {
  // A diagnostic override may suspend SR for one measurement window. It must
  // fall back to the raw frame rather than leaving the last enhanced image on
  // screen, so the comparison measures the same content at two qualities.
  if (!srReady || srEnabledOverride === false) {
    frameIsSr = false;
    return;
  }
  const perfStart = petPerf.enabled ? performance.now() : 0;
  const c = srCrop.getContext('2d');
  c.clearRect(0, 0, CROP.w, CROP.h);
  c.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);
  // Two blur-bleed passes flood RGB ~20px past the silhouette.
  const b = srBlur.getContext('2d');
  for (let i = 0; i < 2; i += 1) {
    b.clearRect(0, 0, CROP.w, CROP.h);
    b.filter = 'blur(10px)';
    b.drawImage(srCrop, 0, 0);
    b.filter = 'none';
    c.globalCompositeOperation = 'destination-over';
    c.drawImage(srBlur, 0, 0);
    c.globalCompositeOperation = 'source-over';
  }
  srUp.upscale(); // re-uploads srCrop, runs the CNN chain into srGL
  const o = srOut.getContext('2d');
  o.clearRect(0, 0, srOut.width, srOut.height);
  o.drawImage(srGL, 0, 0);
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, srOut.width, srOut.height);
  o.globalCompositeOperation = 'source-over';
  frameIsSr = true;
  if (petPerf.enabled) { petPerf.record('superResolution', performance.now() - perfStart); }
}

// Bounding box of the character in PET-LOCAL coordinates (0..PET_W/PET_H),
// measured from the alpha channel of the rendered frame once — petBounds()
// adds drawPos to get the window-space hit area, so clicks pass through
// everywhere except on the character itself.
function measureCharRect() {
  const data = outImage.data;
  const n = FRAME * FRAME;
  let minX = FRAME; let minY = FRAME; let maxX = -1; let maxY = -1;
  for (let y = 0; y < FRAME; y += 2) {
    for (let x = 0; x < FRAME; x += 2) {
      if (data[(y * FRAME + x) * 4 + 3] > 16) {
        if (x < minX) { minX = x; }
        if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; }
        if (y > maxY) { maxY = y; }
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  const sx = petW() / CROP.w;
  const sy = petH() / CROP.h;
  return {
    x: (minX - CROP.x) * sx,
    y: (minY - CROP.y) * sy,
    right: (maxX - CROP.x) * sx,
    bottom: (maxY - CROP.y) * sy,
  };
}

// ── still-pose layer (hybrid renderer) ──
// Whole-body actions the 45-dim pose space can't express — carried, running,
// eating — are played as still art (dsh-whale-musume asset set, MIT) under
// the same canvas, with sprite physics + procedural sway so they don't read
// as pasted stickers. The live model cross-fades out and back in.
const STILL_URL = (name) => `pet://pet/pet-live2d/states/${name}.webp`;
const STILL_FADE = 7; // cross-fade rate, alpha/sec
// Anchor mode per pose: 'feet' keeps her planted on the live model's foot
// line; 'hang' pins the art's top-center to the cursor so a carried pose
// reads as held by the scruff at the grab point.
const STILL_ANCHOR = { 'pick-up': 'hang' };
const stills = new Map(); // name -> { img, box } — box = alpha bbox in image px
// Bumped whenever a still finishes decoding — the status card's raster shows
// the `greet` avatar, so a late image must invalidate it.
let stillEpoch = 0;
const stillCtl = { name: null, entry: null, target: 0, alpha: 0, sway: 0.6 };
const pointer = { x: 0, y: 0 }; // last cursor position, canvas coords
const fx = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
let landT = -1e9; // landing squash envelope start (performance.now)
let feed = null; // { phase, t0, bowlX, bowlY, groundY, kind: 'rice'|'token' }
let come = null; // { targetX } — run-to-cursor action
let action = null; // { until } — timed still playback (pat/celebrate/angry)
let sleeping = false;
let facing = 1; // wander flips this; drawPos-side mirror in paint()
let wander = { glide: null, t0: 0, nextAt: 0, roamAt: 0 }; // autonomous roam leg
let growth = null; // last pushed snapshot {level, points, toNext, available, fed, leveledUp}
let stats = null; // care snapshot riding the same push {satiety, mood, affection, ...}
let pendingLevelUp = false; // celebrate once the running action/feed wraps up
const particles = []; // { type, x, y, vx, vy, born, life, seed }
let tapTimes = [];
const patTrack = { lastX: 0, dir: 0, flips: 0, since: 0 };
let throwT = -1e9; // tumble/dizzy envelope during and after a throw
// Physics body point: the hanging still's top-center. Overdamped-springs
// after the cursor while carried; ballistic with edge bounces once thrown.
let physPoint = null;
let physVel = { x: 0, y: 0 };
let thrown = false;
let dragTrail = []; // [tSec, x, y] pointer samples for release estimation
let physLastT = 0;

async function loadStill(name) {
  if (stills.has(name)) {
    return stills.get(name);
  }
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = STILL_URL(name);
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const { data } = cx.getImageData(0, 0, w, h);
  let minX = w; let minY = h; let maxX = -1; let maxY = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        if (x < minX) { minX = x; }
        if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; }
        if (y > maxY) { maxY = y; }
      }
    }
  }
  const entry = { img, box: { x: minX, y: minY, right: maxX + 2, bottom: maxY + 2 } };
  stills.set(name, entry);
  stillEpoch += 1;
  return entry;
}

const LIVE_ENTRY = { live: true }; // marker — live mode renders states itself

function setStill(name) {
  stillCtl.name = name;
  stillCtl.target = 1;
  rigStateT0 = rigT;
  if (session || rig.ready) {
    // Live and rig engines both render states procedurally — the marker
    // entry keeps the alpha envelope and entry-gated code paths (bounds,
    // drag physics) working unchanged.
    stillCtl.entry = session ? LIVE_ENTRY : RIG_ENTRY;
    return;
  }
  stillCtl.entry = stills.get(name) || null;
  if (name && !stillCtl.entry) {
    void loadStill(name).then((entry) => {
      if (stillCtl.name === name) {
        stillCtl.entry = entry;
      }
    }).catch(() => {});
  }
}

function clearStill() {
  stillCtl.target = 0;
}

// Timed still playback — fades in, holds `durMs`, fades back to live.
function playStill(name, durMs) {
  setStill(name);
  action = { until: performance.now() + durMs };
}

// ── HD part rig ──
// The character is assembled from parts split off one 2048² master —
// body, tail, and per-expression heads — so idle and every action share
// the same pixels and the art style can never drift between states.
// stillCtl.name stays the state holder (same FSM, same callers); the
// 45-dim pose channels feed rig params, so blink / gaze / micro-acts /
// yawn / sleepiness all carry over untouched. The ONNX live render only
// runs as the fallback when the rig assets fail to load.
const RIG_URL = (f) => `pet://pet/pet-live2d/rig/${f}`;
const rig = { ready: false, mf: null, imgs: {} };
// Anchor points in master-image px (2048² canvas coordinates).
const RIG_NECK = [1018, 621];
const RIG_TAIL_ROOT = [1152, 741];
const RIG_FEET = [1018, 955];
const RIG_GRAB = [1018, 330];
const RIG_NUM_KEYS = ['bodyRot', 'bodySx', 'bodySy', 'headRot', 'headDx', 'headDy',
  'tailRot', 'allRot', 'allDx', 'allDy'];
let rigT = 0;
let rigStateT0 = 0; // rigT when the current rig state was entered
// Head-expression crossfade: expression-category swaps blend the outgoing
// head out over ~140ms instead of hard-cutting (the stillCtl alpha envelope
// only lerps numeric pose params, so the face would pop at the discrete
// flip). Blink-band steps (open/half/closed) are excluded — the three bands
// already are the in-between frames, and a 140ms dissolve over the ~20ms
// ramp steps just smears her eyes instead of snapping the lid.
const BLINK_BANDS = new Set(['neutral', 'half-closed', 'eyes-closed']);
let rigShell = { cur: null, prev: null, swapT: 0 };
let rigSwing = 0.3;
let rigSwingV = 0;
const RIG_ENTRY = { rig: true }; // non-null stillCtl.entry marker

async function loadRig() {
  const mf = await (await fetch(RIG_URL('manifest.json'))).json();
  const imgs = {};
  const jobs = [];
  const byFile = new Map();
  const load = (key, file) => {
    if (!byFile.has(file)) {
      byFile.set(file, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = RIG_URL(file);
      }));
    }
    jobs.push(byFile.get(file).then((img) => { if (img) { imgs[key] = img; } }));
  };
  load('body', mf.body.file);
  load('tail', mf.tail.file);
  // shells = whole-character expression variants (head+body fused as one
  // opaque piece — there is no neck seam to hide). shell.png is also
  // mf.body.file (the neutral shell); variants only differ inside the
  // baked face rect, so swaps/crossfades can never seam at the outline.
  for (const v of Object.keys(mf.shells || {})) {
    load(`shell:${v}`, mf.shells[v].file);
  }
  await Promise.all(jobs);
  rig.mf = mf;
  rig.imgs = imgs;
  rig.ready = !!(imgs.body && imgs.tail && imgs['shell:neutral']);
}

function rigScale() {
  const b = rig.mf.char_bbox;
  return (petH() * 0.96) / Math.max(1, b[3] - b[1]);
}

// Idle program: pose channels + cursor gaze + breathing → part params.
// State programs override selected fields; stillCtl.alpha blends them in.
function rigBase() {
  const t = rigT;
  const breathe = Math.sin((t * 2 * Math.PI) / 3.6);
  const P = {
    expr: 'neutral', pivot: null, body: null,
    bodyRot: 0.008 * Math.sin(t * 1.1),
    bodySx: 1 - 0.010 * breathe, bodySy: 1 + 0.016 * breathe,
    headRot: 0.02 * Math.sin(t * 1.7),
    headDx: 0, headDy: 1.8 * breathe,
    tailRot: 0.14 * Math.sin(t * 2.4) + 0.05 * Math.sin(t * 5.1),
    allRot: 0, allDx: 0, allDy: 0,
  };
  if (pointer.x || pointer.y) {
    const gx = Math.max(-1, Math.min(1,
      (pointer.x - (drawPos.x + petW() / 2)) / (petW() * 0.9)));
    const gy = Math.max(-1, Math.min(1,
      (pointer.y - (drawPos.y + petH() * 0.25)) / (petH() * 0.9)));
    P.headRot += 0.06 * gx;
    P.headDx += 5 * gx;
    P.headDy += 2.5 * gy;
  }
  // Micro-acts / taps / yawn ride the pose channels — mapped to the
  // nearest head variant + head offsets.
  P.headRot += pose[41] * 0.035 + pose[39] * 0.02;
  P.headDx += pose[40] * 4;
  P.headDy += pose[38] * 2.5 - pose[42] * 6;
  P.allDy -= pose[42] * 5;
  // Blink channel is analog (60ms ramp each way): three bands give the
  // blink a real closing phase instead of a one-frame snap.
  const eyeV = Math.max(pose[12], pose[13]);
  if (eyeV > 0.78) { P.expr = 'eyes-closed'; } else if (eyeV > 0.35) { P.expr = 'half-closed'; } else if (pose[14] > 0.55 || pose[15] > 0.55 || pose[20] > 0.5) { P.expr = 'happy'; } else if (pose[26] > 0.35 || pose[18] > 0.5 || pose[19] > 0.5 || pose[16] > 0.6 || pose[17] > 0.6) { P.expr = 'mouth-open'; } else if (pose[0] > 0.5 && pose[1] > 0.5) { P.expr = 'angry'; }
  const s = smooth(idle.sleepy || 0);
  if (s > 0) {
    P.headRot += 0.14 * s;
    P.headDy += 9 * s;
    if (s > 0.55) { P.expr = 'eyes-closed'; } else if (s > 0.3) { P.expr = 'half-closed'; }
  }
  return P;
}

// Per-state motion programs. Each mutates a params object: expression
// head, part transforms, and the global pivot ('feet' rotates the whole
// rig about the foot line; 'grab' hangs her from RIG_GRAB at physPoint).
const RIG_STATES = {
  'sleep': (P, t) => {
    P.expr = 'eyes-closed';
    P.pivot = 'feet';
    P.allRot = -1.0;
    P.allDy = 12;
    P.headRot += 0.05 + 0.03 * Math.sin(t * 1.2);
    P.bodySy = 1 + 0.030 * Math.sin((t * 2 * Math.PI) / 4.4);
    // Tail curls forward across her front — sells "curled up asleep"
    // without needing a dedicated torso asset.
    P.tailRot = 0.55 + 0.04 * Math.sin(t * 1.1);
  },
  'pick-up': (P, t, dt) => {
    P.pivot = 'grab';
    // Raised-arms torso drops in as manifest `bodies.pickup` — a no-op
    // (default body) until the asset lands.
    P.body = 'pickup';
    // Grab arc: a surprised gasp in the first ~0.7s, then worried with
    // periodic wails (squeezed eyes + open mouth).
    const heldFor = t - rigStateT0;
    P.expr = heldFor < 0.7 ? 'surprised'
      : (Math.sin(t * 1.3) > 0.93 ? 'wail' : 'worried');
    rigSwingV += (-16 * rigSwing) * dt - rigSwingV * 1.7 * dt;
    rigSwing += rigSwingV * dt;
    if (!dragging && Math.abs(rigSwing) < 0.02 && Math.abs(rigSwingV) < 0.02) {
      rigSwingV = 2.4;
    }
    P.allRot = rigSwing * 0.45;
    // Held by the scruff: body hangs slightly stretched, chin drops,
    // head does a small scared wobble, tail trails limply.
    P.headRot += 0.12 + 0.06 * Math.sin(t * 9);
    P.headDy += 5 + 2 * Math.sin(t * 8);
    P.bodySy = 1.07 + 0.012 * Math.sin(t * 3.1);
    P.tailRot = 0.15 * Math.sin(t * 2.5) - 0.08;
  },
  'eat': (P, t) => {
    // Food arriving gets a brief delighted gasp before she starts chewing.
    P.expr = (t - rigStateT0) < 0.8 ? 'surprised'
      : (Math.sin(t * 7) > 0 ? 'mouth-open' : 'neutral');
    P.headRot += 0.05 * Math.sin(t * 2.2) + 0.03;
    P.headDy += 3 * Math.abs(Math.sin(t * 7));
    P.tailRot = 0.10 * Math.sin(t * 3);
    // Lean her head toward the bowl while it's on screen.
    if (feed) {
      const dir = Math.sign(feed.bowlX - (drawPos.x + petW() / 2)) || 1;
      P.headRot += dir * 0.07;
      P.headDx += dir * 4;
    }
  },
  'running': (P, t) => {
    P.expr = 'happy';
    P.pivot = 'feet';
    P.allRot = 0.07;
    P.allDy = -6 * Math.abs(Math.sin(t * 9));
    P.bodySy = 1 + 0.03 * Math.sin(t * 18);
    P.headRot += 0.04 * Math.sin(t * 9);
    P.headDy += 2.5 * Math.sin(t * 18);
    P.tailRot = 0.35 * Math.sin(t * 9);
  },
  'react-head': (P, t) => {
    // A pat lands as a tiny "oh!" before melting into the happy wobble.
    P.expr = (t - rigStateT0) < 0.45 ? 'surprised'
      : (Math.sin(t * 5) > 0.7 ? 'mouth-open' : 'happy');
    P.headRot += 0.10 * Math.sin(t * 5);
    P.headDx += (patTrack.dir || 0) * 7;
    P.bodySy = 1 + 0.02 * Math.sin(t * 5);
    P.tailRot = 0.3 * Math.sin(t * 5.5);
  },
  'angry': (P, t) => {
    // Mostly furious, with brief squeezed-eye frustration beats.
    P.expr = Math.sin(t * 0.9) > 0.94 ? 'eyes-closed' : 'angry';
    P.allDx = 2.5 * Math.sin(t * 22);
    P.headRot += 0.06 * Math.sin(t * 14);
    P.tailRot = 0.1 * Math.sin(t * 11);
  },
  'celebrate': (P, t) => {
    // Mouth opens at the top of each bounce — cheering, not a frozen grin.
    P.expr = Math.abs(Math.sin(t * 5.2)) > 0.6 ? 'mouth-open' : 'happy';
    P.allDy = -14 * Math.abs(Math.sin(t * 5.2));
    P.bodySy = 1 + 0.03 * Math.sin(t * 10.4);
    P.headRot += 0.05 * Math.sin(t * 5.2);
    P.tailRot = 0.25 * Math.sin(t * 6.5);
  },
  'star': (P, t) => {
    P.expr = 'mouth-open'; // open eyes + mouth, star pupils drawn on top
    P.allDy = -8 * Math.abs(Math.sin(t * 4.4));
    P.headRot += 0.09 * Math.sin(t * 3.1);
    P.tailRot = 0.4 * Math.sin(t * 5.5);
  },
  'greet': (P, t) => {
    // Alternating open mouth — waving hello reads as actually saying it —
    // plus a playful wink once per wave cycle.
    const winkPh = t % 5;
    P.expr = (winkPh > 1 && winkPh < 1.5) ? 'wink'
      : (Math.sin(t * 2.4) > 0.3 ? 'mouth-open' : 'happy');
    P.pivot = 'feet';
    P.allRot = 0.06 * Math.sin(t * 2.4);
    P.headRot += 0.10 * Math.sin(t * 2.4);
    P.allDy = -5 * Math.abs(Math.sin(t * 2.4));
    P.tailRot = 0.2 * Math.sin(t * 4);
  },
  'startle': (P, t) => {
    // Jolt awake: surprised face, rapid little hops, tail flicks up.
    P.expr = 'surprised';
    P.pivot = 'feet';
    P.allDy = -9 * Math.abs(Math.sin(t * 8));
    P.headRot += 0.05 * Math.sin(t * 16);
    P.tailRot = 0.45;
  },
  'tail-swing': (P, t) => {
    P.expr = 'happy';
    P.tailRot = 0.45 * Math.sin(t * 7);
    P.headRot += 0.03 * Math.sin(t * 2.4);
    P.bodyRot += 0.02 * Math.sin(t * 3.5);
  },
};

// ── live-mode state programs ──
// The THA4 render path animates every pixel continuously, so states need no
// sprite swap: a program writes pose channels (face/expression) and whole-
// frame fx (rotation, offset, squash). `a` = stillCtl.alpha smoothed — state
// overrides lerp in over ~140ms, and because pose space is continuous the
// face morphs between expressions instead of crossfading textures.
// S.set(ch, v): pose[ch] blends toward v by a. S.fx fields are absolute
// targets, scaled by `a` when composed in drawLive.
const liveFx = { rot: 0, dx: 0, dy: 0, sx: 1, sy: 1, pivot: null, stars: false };
const LIVE_STATES = {
  // These programs keep the original avatar as the only rendered character.
  // Generated key poses are reviewed separately; none is loaded by live mode.
  'idle-float'(S, t) {
    S.fx.dy = -2.5 * Math.sin(t * 1.8);
    S.fx.rot = 0.012 * Math.sin(t * 1.2);
  },
  swim(S, t) {
    S.set(42, 0.3 * Math.sin(t * 5));
    S.set(43, 0.35 * Math.sin(t * 5 + 0.7));
    S.fx.dx = 4 * Math.sin(t * 2.5);
    S.fx.rot = 0.04 * Math.sin(t * 5);
  },
  twirl(S, t) {
    const p = clamp01((t - rigStateT0) / 1.3);
    // The live frame pivots at her feet. A whole-frame 360° roll clips her
    // below a bottom-edge desktop position, so turn head/body within the
    // model and use only a small planted sway.
    S.set(40, 0.6 * Math.sin(2 * Math.PI * p));
    S.set(42, 0.5 * Math.sin(2 * Math.PI * p));
    S.fx.rot = 0.14 * Math.sin(2 * Math.PI * p);
    S.fx.sx = 1 - 0.06 * Math.sin(Math.PI * p) ** 2;
    S.fx.dy = -5 * Math.sin(Math.PI * p);
  },
  look(S, t) {
    S.set(37, 0.5 * Math.sin(t * 2));
    S.set(38, 0.6 * Math.sin(t * 2));
    S.set(40, 0.35 * Math.sin(t * 2));
    S.fx.rot = 0.025 * Math.sin(t * 2);
  },
  doze(S, t) {
    S.set(18, 0.7); S.set(19, 0.7);
    S.set(39, 0.22 + 0.04 * Math.sin(t * 1.4));
    S.mul(44, 0.55);
    S.fx.dy = 2 * Math.sin(t * 1.4);
  },
  'sleep-enter'(S, t) {
    const p = smooth(clamp01((t - rigStateT0) / 1.2));
    S.set(39, 0.2 * p);
    S.fx.rot = -1.0 * p;
    S.fx.dy = 14 * p;
  },
  sleep(S, t) {
    S.set(39, 0.16);                     // head sags
    S.mul(44, 1.5);                      // slower, deeper breath
    S.fx.rot = -1.0;                     // lies on her side
    S.fx.dy = 14;
  },
  wake(S, t) {
    const p = clamp01((t - rigStateT0) / 1.1);
    S.set(16, 0.8 * (1 - p)); S.set(17, 0.8 * (1 - p));
    S.fx.dy = -9 * Math.sin(Math.PI * p);
    S.fx.sy = 1 + 0.04 * Math.sin(Math.PI * p);
  },
  'pick-up'(S, t, dt) {
    // Pendulum swing about the grab point, same spring as the rig path.
    rigSwingV += (-16 * rigSwing) * dt - rigSwingV * 1.7 * dt;
    rigSwing += rigSwingV * dt;
    if (!dragging && Math.abs(rigSwing) < 0.02 && Math.abs(rigSwingV) < 0.02) {
      rigSwingV = 2.4;
    }
    S.fx.pivot = 'grab';
    S.fx.rot = rigSwing * 0.45;
    S.fx.sy = 1.06;                      // hanging stretch
    const held = t - rigStateT0;
    if (held < 0.7) {
      S.set(16, 1); S.set(17, 1);        // wide eyes — the grab surprise
      S.set(22, 0.5);
    } else {
      S.set(2, 1); S.set(3, 1);          // troubled brows
      S.set(12, 0.85); S.set(13, 0.85);  // squeezed
      S.set(26, Math.sin(t * 1.3) > 0.93 ? 0.9 : 0.1); // wail beats
    }
    S.set(40, 0.12 + 0.06 * Math.sin(t * 9));
  },
  pickup(S, t, dt) { LIVE_STATES['pick-up'](S, t, dt); },
  'drag-sway'(S, t, dt) { LIVE_STATES['pick-up'](S, t, dt); },
  fling(S, t, dt) { LIVE_STATES['pick-up'](S, t, dt); },
  recover(S, t) {
    const p = clamp01((t - rigStateT0) / 1.5);
    S.set(18, 0.35 * (1 - p)); S.set(19, 0.35 * (1 - p));
    S.fx.rot = 0.2 * (1 - p) * Math.sin(p * 15);
    S.fx.dy = 3 * (1 - p);
  },
  'food-notice'(S, t) {
    S.set(16, 0.7); S.set(17, 0.7);
    S.set(22, 0.35);
    S.fx.dy = -3 * Math.sin(Math.PI * clamp01((t - rigStateT0) / 1.1));
  },
  eat(S, t) {
    if (t - rigStateT0 < 0.8) {
      S.set(16, 1); S.set(17, 1);        // food arrives — delight gasp
      S.set(22, 0.5);
    } else {
      S.set(26, 0.05 + 0.75 * (0.5 + 0.5 * Math.sin(t * 7))); // continuous chew
    }
    S.set(39, 0.04 + 0.03 * Math.sin(t * 2.2));
    if (feed) {
      const dir = Math.sign(feed.bowlX - (drawPos.x + petW() / 2)) || 1;
      S.set(40, dir * 0.3);              // face the bowl
      S.set(37, dir * 0.4);
      S.fx.rot = dir * 0.04;
    }
  },
  chew(S, t) {
    S.set(26, 0.08 + 0.62 * (0.5 + 0.5 * Math.sin(t * 8)));
    S.set(39, 0.035 * Math.sin(t * 8));
    S.fx.dy = 1.2 * Math.sin(t * 8);
  },
  full(S, t) {
    S.set(14, 0.9); S.set(15, 0.9);
    S.set(30, 0.5); S.set(31, 0.5);
    S.fx.sy = 1 + 0.02 * Math.sin(t * 2);
  },
  running(S, t) {
    S.set(14, 1); S.set(15, 1);          // happy eyes
    S.set(30, 0.7); S.set(31, 0.7);
    S.set(39, 0.05);
    S.fx.rot = 0.07;
  },
  'react-head'(S, t) {
    if (t - rigStateT0 < 0.45) {
      S.set(16, 1); S.set(17, 1);        // "oh!"
      S.set(22, 0.4);
    } else {
      S.set(14, 1); S.set(15, 1);        // melt into happy
      S.set(30, 0.8); S.set(31, 0.8);
    }
    S.fx.rot = 0.08 * Math.sin(t * 5);
  },
  pat(S, t) { LIVE_STATES['react-head'](S, t); },
  poke(S, t) {
    const p = clamp01((t - rigStateT0) / 0.8);
    S.set(16, 0.8 * (1 - p)); S.set(17, 0.8 * (1 - p));
    S.fx.sx = 1 - 0.07 * Math.sin(Math.PI * p);
    S.fx.sy = 1 + 0.05 * Math.sin(Math.PI * p);
  },
  wave(S, t) { LIVE_STATES.greet(S, t); },
  shy(S, t) {
    S.set(12, 0.45); S.set(13, 0.45);
    S.set(40, 0.25);
    S.fx.rot = 0.045 * Math.sin(t * 2);
    S.fx.dy = 2 * Math.sin(t * 2);
  },
  'happy-tail'(S, t) { LIVE_STATES['tail-swing'](S, t); },
  sad(S, t) {
    S.set(2, 0.7); S.set(3, 0.7);
    S.set(18, 0.35); S.set(19, 0.35);
    S.set(39, 0.2);
    S.fx.dy = 3;
    S.fx.sy = 0.97;
  },
  angry(S, t) {
    S.set(0, 1); S.set(1, 1);            // angry brows
    S.set(24, 0.5);                      // puffed mouth
    if (Math.sin(t * 0.9) > 0.94) { S.set(12, 1); S.set(13, 1); }
    S.fx.dx = 2.5 * Math.sin(t * 22);    // fuming shake
  },
  celebrate(S, t) {
    S.set(14, 1); S.set(15, 1);
    S.set(26, Math.abs(Math.sin(t * 5.2)) > 0.6 ? 0.8 : 0.15);
    S.set(30, 0.7); S.set(31, 0.7);
    S.fx.dy = -14 * Math.abs(Math.sin(t * 5.2));
    S.fx.sy = 1 + 0.03 * Math.sin(t * 10.4);
  },
  star(S, t) {
    S.set(16, 1); S.set(17, 1);          // wide eyes
    S.set(26, 0.8);
    S.fx.dy = -8 * Math.abs(Math.sin(t * 4.4));
    S.fx.stars = true;                   // sparkle pupils drawn in drawLive
  },
  greet(S, t) {
    const winkPh = t % 5;
    if (winkPh > 1 && winkPh < 1.5) { S.set(12, 1); } // wink beat
    S.set(14, 0.9); S.set(15, 0.9);
    S.set(30, 0.8); S.set(31, 0.8);
    S.set(26, Math.sin(t * 2.4) > 0.3 ? 0.7 : 0.1);
    S.fx.rot = 0.06 * Math.sin(t * 2.4); // wave lean
    S.fx.dy = -5 * Math.abs(Math.sin(t * 2.4));
  },
  startle(S, t) {
    S.set(16, 1); S.set(17, 1);
    S.set(22, 0.6);
    S.fx.dy = -9 * Math.abs(Math.sin(t * 8));
  },
  'tail-swing'(S, t) {
    S.set(14, 1); S.set(15, 1);
    S.set(30, 0.7); S.set(31, 0.7);
    S.set(43, 0.25 * Math.sin(t * 7));   // body channel sways the tail region
    S.fx.rot = 0.04 * Math.sin(t * 3.5);
  },
};

// Facial programs stay in the original avatar's THA4 pose space.
const LIVE_EXPRESSIONS = {
  neutral() {},
  happy(S) { S.set(14, 0.8); S.set(15, 0.8); S.set(30, 0.5); S.set(31, 0.5); },
  laugh(S) { S.set(14, 1); S.set(15, 1); S.set(26, 0.7); },
  curious(S) { S.set(16, 0.35); S.set(17, 0.35); S.set(41, 0.35); },
  sleepy(S) { S.set(18, 0.65); S.set(19, 0.65); },
  asleep(S) {
    const closed = stillCtl.name === 'sleep-enter'
      ? smooth(clamp01((rigT - rigStateT0) / 1.2)) : 1;
    // The distilled face does not compose wink + relaxed/happy eyes safely:
    // leftover idle shapes and gaze enlarge/displace the sleeping eyelids.
    // Fade the whole facial pose to neutral, then use only natural closure.
    // Head/body motion and breathing remain live; wake releases this owner.
    for (let ch = 0; ch < 39; ch += 1) {
      if (ch !== 12 && ch !== 13) { S.mul(ch, 1 - closed); }
    }
    S.set(12, closed); S.set(13, closed);
  },
  surprised(S) { S.set(16, 0.9); S.set(17, 0.9); S.set(22, 0.5); },
  panicked(S) { S.set(2, 0.75); S.set(3, 0.75); S.set(26, 0.4); },
  dizzy(S) { S.set(18, 0.35); S.set(19, 0.35); S.set(41, 0.4); },
  blush(S) { S.set(12, 0.4); S.set(13, 0.4); S.set(40, 0.25); },
  annoyed(S) { S.set(0, 0.85); S.set(1, 0.85); S.set(24, 0.4); },
  'sad-face'(S) { S.set(2, 0.8); S.set(3, 0.8); S.set(18, 0.35); S.set(19, 0.35); },
};
const LIVE_ACTION_EXPRESSION = {
  'idle-float': 'neutral', swim: 'happy', twirl: 'laugh', look: 'curious',
  doze: 'sleepy', 'sleep-enter': 'asleep', sleep: 'asleep', wake: 'surprised',
  pickup: 'panicked', 'drag-sway': 'panicked', fling: 'panicked',
  recover: 'dizzy', 'food-notice': 'surprised', eat: 'happy', chew: 'happy',
  full: 'happy', pat: 'happy', poke: 'surprised', wave: 'happy', shy: 'blush',
  'happy-tail': 'happy', sad: 'sad-face', angry: 'annoyed', startle: 'surprised',
};

// Apply the live-state program for stillCtl.name after the base pose math —
// overrides are weighted by the state alpha envelope.
function applyLiveState() {
  liveFx.rot = 0; liveFx.dx = 0; liveFx.dy = 0;
  liveFx.sx = 1; liveFx.sy = 1; liveFx.pivot = null; liveFx.stars = false;
  const prog = stillCtl.name && LIVE_STATES[stillCtl.name];
  if (!prog) {
    return;
  }
  const a = smooth(clamp01(stillCtl.alpha));
  const S = {
    fx: liveFx,
    a,
    set(ch, v) { pose[ch] += (v - pose[ch]) * a; },
    mul(ch, v) { pose[ch] *= 1 + (v - 1) * a; },
  };
  prog(S, rigT, 1 / 60);
  const expression = LIVE_EXPRESSIONS[LIVE_ACTION_EXPRESSION[stillCtl.name]];
  if (expression) { expression(S); }
}

// ── live-mode draw ──
// The SR'd THA4 frame is one seamless image — poses come from rotating /
// offsetting / squashing that single frame while the model keeps every
// pixel alive inside it. Anchor modes: feet pivot on the ground line, or
// the grab point pinned to the cursor while carried.
const GRAB_FRAC = 0.085; // grab point (top of head) as a fraction of frame h
function drawLive() {
  const t = rigT;
  const opacity = Math.max(0.3, Math.min(1, settings.opacity || 1));
  // SR 2× when the pipeline is up AND this frame actually went through it.
  // Selecting purely on `srReady` displays the last enhanced image forever
  // once SR is skipped, which reads as a saving that is not real.
  const src = srReady && frameIsSr ? srOut : outCanvas;
  const a = smooth(clamp01(stillCtl.alpha));
  const rot = fx.rot + liveFx.rot * a;
  const dx = fx.dx + liveFx.dx * a;
  const dy = fx.dy + liveFx.dy * a;
  const sx = fx.sx * (1 + (liveFx.sx - 1) * a);
  const sy = fx.sy * (1 + (liveFx.sy - 1) * a);
  const hanging = liveFx.pivot === 'grab' && a > 0.4 && (dragging || thrown) && physPoint;
  const w = petW(); const h = petH();
  ctx2d.save();
  ctx2d.globalAlpha = opacity;
  if (hanging) {
    ctx2d.translate(physPoint.x + dx, physPoint.y + dy);
    ctx2d.rotate(rot);
    ctx2d.scale(sx, sy);
    ctx2d.drawImage(src, -w / 2, -h * GRAB_FRAC, w, h);
  } else {
    ctx2d.translate(drawPos.x + w / 2 + dx, drawPos.y + h - 2 + dy);
    ctx2d.rotate(rot);
    ctx2d.scale(sx * (facing < 0 ? -1 : 1), sy);
    ctx2d.drawImage(src, -w / 2, -h, w, h);
  }
  // Star-pupil sparkles ride the live face (only state the model can't say).
  if (liveFx.stars && a > 0.4) {
    const tw = 0.8 + 0.2 * Math.sin(t * 14);
    drawSparkle(-24, -h + 116, 7 * tw);
    drawSparkle(24, -h + 116, 7 * tw);
  }
  ctx2d.restore();
}

function drawRigPart(img, bb, pivot, o) {
  if (!img || !img.naturalWidth) {
    return;
  }
  ctx2d.save();
  ctx2d.translate(pivot[0] + (o.dx || 0), pivot[1] + (o.dy || 0));
  ctx2d.rotate(o.rot || 0);
  ctx2d.scale(o.sx || 1, o.sy || 1);
  ctx2d.drawImage(img, bb[0] - pivot[0], bb[1] - pivot[1]);
  ctx2d.restore();
}

// Four-pointed sparkle (star-pupil overlay), in current transform space.
function drawSparkle(x, y, r) {
  ctx2d.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 === 0 ? r : r * 0.32;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) { ctx2d.moveTo(px, py); } else { ctx2d.lineTo(px, py); }
  }
  ctx2d.closePath();
  ctx2d.fillStyle = '#ffdf6b';
  ctx2d.fill();
  ctx2d.beginPath();
  ctx2d.arc(x, y, r * 0.22, 0, Math.PI * 2);
  ctx2d.fillStyle = '#fff';
  ctx2d.fill();
}

function drawRig() {
  const mf = rig.mf;
  const box = mf.char_bbox;
  const cw = box[2] - box[0];
  const S = rigScale();
  const base = rigBase();
  const P = { ...base };
  const prog = stillCtl.name && RIG_STATES[stillCtl.name];
  if (prog && stillCtl.alpha > 0.01) {
    const over = { ...base };
    prog(over, rigT, 1 / 60);
    const a = smooth(clamp01(stillCtl.alpha));
    for (const k of RIG_NUM_KEYS) {
      P[k] = base[k] + (over[k] - base[k]) * a;
    }
    if (a > 0.4) {
      P.expr = over.expr;
      P.pivot = over.pivot;
      P.body = over.body;
    }
  }
  P.allRot += fx.rot;
  P.allDy += fx.dy / S;
  const opacity = Math.max(0.3, Math.min(1, settings.opacity || 1));
  ctx2d.globalAlpha = opacity;
  const hanging = P.pivot === 'grab' && (dragging || thrown) && physPoint;
  ctx2d.save();
  if (hanging) {
    // GRAB sits at the physics point; the rig swings about it.
    ctx2d.translate(physPoint.x, physPoint.y);
    ctx2d.scale(S, S);
    ctx2d.rotate(P.allRot);
    ctx2d.translate(P.allDx - RIG_GRAB[0], P.allDy - RIG_GRAB[1]);
  } else {
    // Feet anchored to the pet's bottom line, centered in the draw box.
    ctx2d.translate(drawPos.x + petW() / 2, drawPos.y + petH() - 2);
    ctx2d.scale(S * (facing < 0 ? -1 : 1), S);
    const pv = RIG_FEET;
    // Parts draw at absolute master coords — pre-subtract pv so the feet
    // pivot (not the master 0,0) lands on the anchor.
    ctx2d.translate(P.allDx - pv[0], P.allDy - pv[1]);
    ctx2d.translate(pv[0], pv[1]);
    ctx2d.rotate(P.allRot);
    ctx2d.scale(fx.sx, fx.sy);
    ctx2d.translate(-pv[0], -pv[1]);
  }
  drawRigPart(rig.imgs.tail, mf.tail.bbox_in_master, RIG_TAIL_ROOT, { rot: P.tailRot });
  // Expression = whole-shell variant swap (head+body are fused — there is
  // no neck seam). Head tilt/bob channels fold into the shell transform;
  // blink-band swaps stay instant because blink shells are pixel-identical
  // outside the baked face rect.
  // P.body (state programs) may name a manifest `shells` variant that
  // replaces the expression shell wholesale (e.g. a raised-arms pickup
  // pose) — the extension hook for future pose assets.
  const shellKey = (P.body && mf.shells && mf.shells[P.body]) ? P.body
    : (mf.shells && mf.shells[P.expr] ? P.expr : 'neutral');
  if (shellKey !== rigShell.cur) {
    const bandStep = BLINK_BANDS.has(shellKey) && BLINK_BANDS.has(rigShell.cur);
    rigShell.prev = bandStep ? null : rigShell.cur;
    rigShell.cur = shellKey;
    rigShell.swapT = rigT;
  }
  const shellBlend = rigShell.prev ? Math.min(1, (rigT - rigShell.swapT) / 0.14) : 1;
  const prevImg = rigShell.prev ? rig.imgs[`shell:${rigShell.prev}`] : null;
  const shellCand = rig.imgs[`shell:${shellKey}`];
  const shellDflt = rig.imgs['shell:neutral'];
  const shellImg = (shellCand && shellCand.naturalWidth) ? shellCand
    : (shellDflt && shellDflt.naturalWidth ? shellDflt : rig.imgs.body);
  const shellBb = ((mf.shells && mf.shells[shellKey]) || mf.body).bbox_in_master;
  const pvX = RIG_NECK[0], pvY = RIG_NECK[1] + 280;
  ctx2d.save();
  ctx2d.translate(pvX + P.headDx, pvY + P.headDy);
  ctx2d.rotate(P.bodyRot + P.headRot * 0.7);
  ctx2d.scale(P.bodySx, P.bodySy);
  if (prevImg && prevImg.naturalWidth && shellBlend < 1) {
    const pb = ((mf.shells && mf.shells[rigShell.prev]) || mf.body).bbox_in_master;
    ctx2d.globalAlpha = opacity * (1 - shellBlend);
    ctx2d.drawImage(prevImg, pb[0] - pvX, pb[1] - pvY);
  }
  ctx2d.globalAlpha = opacity * shellBlend;
  ctx2d.drawImage(shellImg, shellBb[0] - pvX, shellBb[1] - pvY);
  ctx2d.globalAlpha = opacity;
  // 'star' draws literal star pupils over the happy face — the only
  // expression whose marker can't come from the model's own vocabulary.
  if (stillCtl.name === 'star' && stillCtl.alpha > 0.4) {
    const tw = 0.8 + 0.2 * Math.sin(rigT * 14);
    for (const ex of [912, 1012]) {
      drawSparkle(ex - pvX, 550 - pvY, 20 * tw);
    }
  }
  ctx2d.restore();
  ctx2d.restore();
  ctx2d.globalAlpha = 1;
  // Hit-test box in drawPos-local coords (idle pose; states widen it via
  // stillDrawRect).
  charRect = {
    x: petW() / 2 + (box[0] - RIG_FEET[0]) * S,
    right: petW() / 2 + (box[2] - RIG_FEET[0]) * S,
    y: petH() - 2 + (box[1] - RIG_FEET[1]) * S,
    bottom: petH() - 2 + (box[3] - RIG_FEET[1]) * S,
  };
}

// ── speech bubble + dialogue library ──
// Dialogue content is data, not code: lines live in
// dialogue/whale.json ({global, agents, idleTopics, timeOfDay}) and are
// fetched over pet:// at mount. LINES mirrors store.global for call sites
// and tests; say() picks via PetDialogue's sayer — shuffle-bag cycles with
// no instant repeats, plus {field} template slots for Harness events.
let LINES = {};
// Bubble arbitration (ported from the reference speech_bubble, trimmed):
//   priority 0 self-talk < 1 event reaction < 2 DSH alert/approval.
//   Higher priority preempts and DROPS the visible lower one; equal
//   priority replaces in place for plain bubbles but queues for alertId
//   bubbles (each pending approval must be seen); lower priority queues
//   (cap 3, oldest dropped on overflow); an alertId match updates in place
//   wherever it sits; holdBubbles() blocks only priority-0 chatter.
let bubble = null; // { text, until, priority, alertId?, buttons?, pinned? }
let bubbleQueue = []; // {seq} keeps FIFO inside a priority
let bubbleQueueSeq = 0;
let bubbleHoldUntil = 0;
// Hit rect of the ✕ drawn on a pinned bubble — populated by drawBubble,
// consumed by the pointerdown handler. Null whenever no pinned bubble is up.
let bubbleCloseRect = null;
const BUBBLE_QUEUE_MAX = 3;
const BUBBLE_ALERT_MIN_MS = 4000;
let dialogueStore = PetDialogue.emptyStore();
let IDLE_TOPICS = ['idle', 'idleRice', 'idleStandby', 'idleTail', 'idleCoding', 'idleCare'];
let say = () => {};
let sayAlert = () => {};
// Memoized bubble wrap — drawBubble refills this only when the text,
// font, or width budget actually changes (see drawBubble).
function holdBubbles(seconds) {
  bubbleHoldUntil = performance.now() + seconds * 1000;
}
function enqueueBubble(entry) {
  if (bubbleQueue.length >= BUBBLE_QUEUE_MAX) {
    const ordinary = bubbleQueue.findIndex((queued) => !queued.pinned && (queued.priority || 0) < 2);
    if (ordinary < 0) {
      if (!entry.pinned && (entry.priority || 0) < 2) return;
    } else {
      bubbleQueue.splice(ordinary, 1);
    }
  }
  entry.seq = bubbleQueueSeq += 1;
  bubbleQueue.push(entry);
}
function dequeueBubble(now) {
  if (!bubbleQueue.length) {
    return null;
  }
  let best = 0;
  for (let i = 1; i < bubbleQueue.length; i += 1) {
    const c = bubbleQueue[i];
    const b = bubbleQueue[best];
    if (c.priority > b.priority || (c.priority === b.priority && c.seq < b.seq)) {
      best = i;
    }
  }
  const next = bubbleQueue.splice(best, 1)[0];
  next.until = Math.max(next.until, now + (next.priority >= 2 ? BUBBLE_ALERT_MIN_MS : 0));
  delete next.seq;
  return next;
}
// Her voice moves into the open card — a visible ambient bubble or queued
// chatter popping over the dialog reads as noise. Alerts stay reachable.
function dropAmbientBubbles() {
  if (bubble && !bubble.lookPin && (bubble.priority || 0) < 2) {
    bubble = null;
  }
  bubbleQueue = bubbleQueue.filter((e) => (e.priority || 0) >= 2);
}
function resolveAlert(alertId) {
  if (!alertId) { return; }
  bubbleQueue = bubbleQueue.filter((b) => b.alertId !== alertId);
  if (bubble && bubble.alertId === alertId) {
    bubble = dequeueBubble(performance.now());
    requestFrame();
  }
}
function pushBubble(entry) {
  const now = performance.now();
  if (entry.lookPin) {
    if (bubble?.lookPin) { return; }
    bubbleQueue = bubbleQueue.filter((e) => (e.priority || 0) >= 2);
    if (bubble && (bubble.priority || 0) >= 2) { enqueueBubble(bubble); }
    bubble = entry;
    requestFrame();
    return;
  }
  if (bubble?.lookPin) {
    if (now < lookBusyUntil) {
      if ((entry.priority || 0) >= 2) {
        const qi = entry.alertId ? bubbleQueue.findIndex((e) => e.alertId === entry.alertId) : -1;
        if (qi >= 0) {
          bubbleQueue[qi] = { ...bubbleQueue[qi], ...entry, seq: bubbleQueue[qi].seq };
        } else { enqueueBubble(entry); }
      }
      return;
    }
    bubble = entry;
    requestFrame();
    return;
  }
  // While the chat card is up she talks there — ambient chatter (priority
  // <2) is dropped outright, never queued. Alert bubbles (approvals,
  // notices) stay reachable since they can carry buttons.
  if (chatOpen && (entry.priority || 0) < 2) {
    return;
  }
  if (entry.alertId) {
    if (bubble && bubble.alertId === entry.alertId) {
      bubble = { ...bubble, ...entry };
      requestFrame();
      return;
    }
    const qi = bubbleQueue.findIndex((b) => b.alertId === entry.alertId);
    if (qi >= 0) {
      bubbleQueue[qi] = { ...bubbleQueue[qi], ...entry, seq: bubbleQueue[qi].seq };
      return;
    }
  }
  // A pinned notification (whale_notify) owns the stage until the user
  // clicks its ✕ — nothing preempts it in place or knocks it off early;
  // every newcomer queues and surfaces on dismissal. Look pins are handled
  // above: they still take over and re-queue the pinned copy.
  if (bubble?.pinned) {
    enqueueBubble(entry);
    return;
  }
  const curPri = bubble ? (bubble.priority || 0) : -1;
  if (!bubble) {
    if ((entry.priority || 0) === 0 && now < bubbleHoldUntil) {
      enqueueBubble(entry);
    } else {
      bubble = entry;
      requestFrame();
    }
    return;
  }
  if (entry.priority > curPri) {
    bubble = entry; // preempt: the lower-priority incumbent is dropped
    requestFrame();
    return;
  }
  if (entry.priority === curPri && !bubble.alertId && !entry.alertId
      && !(entry.priority === 0 && now < bubbleHoldUntil)) {
    bubble = entry; // fresher reaction replaces the visible one in place
    requestFrame();
    return;
  }
  enqueueBubble(entry);
}
function wireDialogue() {
  // Personality layer: whale.json `agents` pools resolve ahead of `global`;
  // 'natural' 软萌 IS the global pool so it passes ''.
  const pick = PetDialogue.createSayer(() => dialogueStore, undefined,
    () => (settings.personality === 'natural' ? '' : settings.personality));
  say = (category, values, autohide, priority, opts) => {
    const text = pick(category, values, autohide);
    if (typeof text !== 'string' || !text) { return; }
    pushBubble({
      text,
      until: performance.now() + Math.min(2200 + Array.from(text).length * 90, 5600),
      priority: Number.isFinite(priority) ? priority : 1,
      ...(opts || {}),
    });
  };
  // DSH alerts carry an alertId so `resolved` events retract them cleanly.
  sayAlert = (category, alertId, values, opts = {}) => {
    const text = pick(category, values, opts.autohide);
    if (typeof text !== 'string' || !text) { return; }
    pushBubble({
      text,
      until: performance.now() + (opts.holdMs || 120000),
      priority: 2,
      alertId,
      buttons: opts.buttons,
    });
  };
  if (dialogueStore.idleTopics && dialogueStore.idleTopics.length) {
    IDLE_TOPICS = dialogueStore.idleTopics;
  }
}
wireDialogue();

function drawBubble(now) {
  if (!bubble) {
    bubbleCloseRect = null;
    return;
  }
  const remain = bubble.until - now;
  if (remain <= 0) {
    bubbleCloseRect = null;
    return;
  }
  const alpha = Math.min(1, remain / 300);
  // Anchor above the head of whatever is currently drawn (still or live).
  const bounds = petBodyBounds();
  const headX = (bounds.x + bounds.right) / 2;
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  ctx2d.font = `12px ${bubbleStyle.getPropertyValue('--dsw-font-family')}`;
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const hostY = host.y ?? 0;
  const hostBottom = hostY + host.height;
  const maxW = Math.min(150, host.width - 32);
  const lines = [];
  let line = '';
  const units = [];
  for (const ch of Array.from(bubble.text)) {
    if (units.length && /[，。！？、；：…）》」』】”’]/u.test(ch)) {
      units[units.length - 1] += ch;
    } else {
      units.push(ch);
    }
  }
  for (const ch of units) {
    if (ctx2d.measureText(line + ch).width > maxW && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) { lines.push(line); }
  // Sticker bubbles paint the image above the name caption. Until the Image
  // finishes decoding the bubble falls back to the caption alone.
  const sticker = bubble.image && bubble.image.complete && bubble.image.naturalWidth
    ? bubble.image : null;
  let iw = 0;
  let ih = 0;
  if (sticker) {
    const cap = Math.min(112, host.width - 32, host.height - 48);
    const k = Math.min(1, cap / Math.max(sticker.naturalWidth, sticker.naturalHeight));
    iw = Math.max(1, Math.round(sticker.naturalWidth * k));
    ih = Math.max(1, Math.round(sticker.naturalHeight * k));
  }
  const bw = Math.ceil(Math.max(iw, ...lines.map((l) => ctx2d.measureText(l).width))) + 18;
  const bh = lines.length * 16 + 12 + (ih ? ih + 4 : 0);
  const bx = Math.min(Math.max(headX - bw / 2, host.x + 4), host.x + host.width - bw - 4);
  let by = bounds.y - 12 - bh - 8;
  let below = false;
  if (by < hostY + 4) {
    below = true;
    by = Math.min(Math.max(bounds.bottom + 12 + 8, hostY + 12), hostBottom - bh - 4);
  } else {
    by = Math.min(by, hostBottom - bh - 12);
  }
  // The status card is drawn above bubbles. Keep the text and tail outside
  // its rectangle when the head anchor would place them behind the card.
  if (panel && bx < panel.x + panel.w + 4 && bx + bw > panel.x - 4
      && by + bh + (below ? 0 : 8) > panel.y - 4
      && by - (below ? 8 : 0) < panel.y + panel.h + 4) {
    const above = panel.y - bh - 16;
    if (above >= hostY + 4) {
      by = above;
      below = false;
    } else {
      by = panel.y + panel.h + 16;
      below = true;
    }
  }
  const tx = Math.min(Math.max(headX, bx + 16), bx + bw - 16);
  ctx2d.fillStyle = bubbleStyle.getPropertyValue('--dsw-alias-bg-layer-1');
  ctx2d.strokeStyle = bubbleStyle.getPropertyValue('--dsw-alias-border-l2');
  const r = 9;
  ctx2d.lineWidth = 1;
  ctx2d.lineJoin = 'round';
  ctx2d.beginPath();
  ctx2d.moveTo(bx + r, by);
  if (below) {
    ctx2d.lineTo(tx - 6, by);
    ctx2d.lineTo(tx, by - 8);
    ctx2d.lineTo(tx + 6, by);
  }
  ctx2d.lineTo(bx + bw - r, by);
  ctx2d.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx2d.lineTo(bx + bw, by + bh - r);
  ctx2d.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  // Tail pointing down at her head.
  if (!below) {
    ctx2d.lineTo(tx + 6, by + bh);
    ctx2d.lineTo(tx, by + bh + 8);
    ctx2d.lineTo(tx - 6, by + bh);
  }
  ctx2d.lineTo(bx + r, by + bh);
  ctx2d.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx2d.lineTo(bx, by + r);
  ctx2d.quadraticCurveTo(bx, by, bx + r, by);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.stroke();
  if (sticker) {
    ctx2d.drawImage(sticker, bx + (bw - iw) / 2, by + 6, iw, ih);
  }
  ctx2d.fillStyle = bubbleStyle.getPropertyValue('--dsw-alias-label-primary');
  ctx2d.textBaseline = 'middle';
  const textMidY = by + bh / 2 - ((lines.length - 1) * 16) / 2 + ih / 2;
  lines.forEach((l, i) => ctx2d.fillText(l, bx + 9, textMidY + i * 16));
  // Pinned bubbles (whale_notify) never time out — the ✕ in the top-right
  // corner is the only way off the stage. It lives inside the bubble's own
  // ink rect so the dirty-rect sweep clears it with the body.
  if (bubble.pinned) {
    const cx = bx + bw - 10;
    const cy = by + 10;
    ctx2d.strokeStyle = bubbleStyle.getPropertyValue('--dsw-alias-label-tertiary');
    ctx2d.lineWidth = 1.2;
    ctx2d.beginPath();
    ctx2d.moveTo(cx - 3, cy - 3);
    ctx2d.lineTo(cx + 3, cy + 3);
    ctx2d.moveTo(cx + 3, cy - 3);
    ctx2d.lineTo(cx - 3, cy + 3);
    ctx2d.stroke();
    // Fat-fingered hit box around the glyph; the visible ✕ is 6×6.
    bubbleCloseRect = { x: cx - 8, y: cy - 8, w: 16, h: 16 };
  } else {
    bubbleCloseRect = null;
  }
  ctx2d.restore();
  const topEdge = below ? by - 8 : by;
  const bottomEdge = below ? by + bh : by + bh + 8;
  return {
    x: Math.floor(bx) - 4,
    y: Math.floor(topEdge) - 4,
    w: Math.ceil(bx + bw) - Math.floor(bx) + 8,
    h: Math.ceil(bottomEdge) - Math.floor(topEdge) + 8,
  };
}

// ── status panel (replaces the native context menu) ──
// Right-click opens a pet-game status card: avatar + level pill +
// affection hearts, a real growth bar, three care-stat bars (饱食/心情/
// 亲密 — QQ-pet lineage), and a 2×3 action grid — all drawn and hit-tested
// on this canvas. While open the panel's rect joins petBounds(), so
// hovering the card still counts as "on the pet" and the overlay stays
// interactive — that is what lets the chips take clicks.
const PANEL_W = 214;
const PANEL_PAD = 12;
const PANEL_HEAD_H = 40;   // avatar + name + relation line
const PANEL_GROWTH_H = 96; // label + bar + next-level + today + fed + feed button
const PANEL_FEED_TOP = 70; // stats center 52 + half-line 6 + 12px gap
const PANEL_FEED_H = 20;
const PANEL_STAT_H = 20;   // per care-stat row
const PANEL_CHIP_H = 28;
const PANEL_CHIP_GAP = 6;
const PANEL_CHIP_W = (PANEL_W - PANEL_PAD * 2 - PANEL_CHIP_GAP) / 2;
// Grid top tracks the drawPanel layout: header(div1) + growth + stats(div3) + 6px.
const PANEL_GRID_TOP = PANEL_PAD + PANEL_HEAD_H + 2 + 6 + PANEL_GROWTH_H + 4
  + 6 + PANEL_STAT_H * 3 + 4 + 6;
// Panel actions — the functional set only. The one-shot flavor verbs
// (玩耍/摸头/逗她) were cut: 摸头 still fires on a direct head click, and
// the care stats move through feeding/chat/sleep anyway. 喂食 lives in the
// growth block next to the token stats (it IS the token-feed action).
const PANEL_ACTIONS = [
  { id: 'chat', icon: '💬', label: '聊聊' },
  { id: 'look', icon: '👀', label: '看看' },
  { id: 'pat', icon: '🫳', label: '摸摸头' },
  { id: 'nap', icon: '💤', label: '睡觉' },
  { id: 'settings', icon: '⚙', label: '设置' },
  { id: 'hide', icon: '🌙', label: '隐藏' },
];
// Grid rows follow the action list — 6 cells = 3 rows.
const PANEL_ROWS = Math.ceil(PANEL_ACTIONS.length / 2);
const PANEL_H = PANEL_GRID_TOP + PANEL_CHIP_H * PANEL_ROWS
  + PANEL_CHIP_GAP * (PANEL_ROWS - 1) + PANEL_PAD;
const PANEL_STATS = [
  { id: 'satiety', icon: '🍚', label: '饱食' },
  { id: 'mood', icon: '😊', label: '心情' },
  { id: 'affection', icon: '💙', label: '亲密' },
];
let panel = null; // { x, y, w, h, cells, hover }

// Bounded close-reason trace. The unexplained 15s card closure was the last
// acceptance blocker, and it was unprovable without knowing WHICH path closed
// it: explicit dismissal, window recreation, a delayed callback, or the
// measurement script's own cleanup. Every open/close names its reason here.
const panelTrace = { entries: [], generation: 0 };
function tracePanel(event, detail) {
  panelTrace.generation += 1;
  panelTrace.entries.push({
    at: Math.round(performance.now()),
    event,
    generation: panelTrace.generation,
    detail: detail || null,
  });
  // Bounded: a long soak must not grow this without limit.
  if (panelTrace.entries.length > 120) { panelTrace.entries.shift(); }
  if (petPerf.enabled) { petPerf.bump(`panel:${event}`); }
  console.log(`pet: panel ${event}`, detail || '');
}

// The status card is the most expensive thing on this surface (text metrics,
// gradient fills, ten rungs, six chips) yet it only changes on real edges.
// Paint it once into an offscreen raster and blit that every frame instead of
// re-running the painter: the card stays on top of a walking character with
// no holes punched by her clear rect, while the per-frame cost collapses to
// one clearRect + one drawImage.
const PANEL_PAD_MARGIN = 20; // raster + clear margin around the card box
// The ✕ lives INSIDE the header row, on the title line's right edge, and only
// appears while the pointer is over the card. It is a quiet affordance, not a
// floating badge hanging off the corner: nothing pokes out of the silhouette,
// so the card reads as one card instead of a card with an extra button glued
// to it. The header reserves its width even when hidden, so nothing reflows.
const PANEL_CLOSE_SIZE = 22;  // square hit/draw box, header-aligned
const PANEL_CLOSE_X = PANEL_W - PANEL_PAD - PANEL_CLOSE_SIZE;
const PANEL_CLOSE_Y = PANEL_PAD;
const panelCache = { canvas: null, ctx: null, key: '', x: 0, y: 0, w: 0, h: 0 };

// The ✕ close affordance: an explicit dismissal that does not depend on the
// pointer leaving (the old behaviour destroyed the card the moment the cursor
// strayed past the body/panel gap, which made its buttons unclickable).
function panelCloseRect() {
  if (!panel) { return null; }
  return {
    x: panel.x + PANEL_CLOSE_X,
    y: panel.y + PANEL_CLOSE_Y,
    w: PANEL_CLOSE_SIZE,
    h: PANEL_CLOSE_SIZE,
  };
}
function panelCloseHit(x, y) {
  const r = panelCloseRect();
  return Boolean(r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// Reveal state for the header ✕. Kept beside the card so the raster key picks
// it up. The glyph is quiet while the pointer is anywhere on the card, then
// stresses when the pointer enters the hit box — a card with no visible close
// control is just as broken as one with a glued-on badge.
let closeHover = false;
let closeVisible = false;

// 大数简写：≥1亿 → x.x亿（去尾零），≥1万 → x.x万，以下原样本地化。
function fmtTokens(n) {
  const v = Number(n || 0);
  const short = (x, unit) => `${(x).toFixed(1).replace(/\.0$/, '')}${unit}`;
  if (v >= 1e8) { return short(v / 1e8, '亿'); }
  if (v >= 1e4) { return short(v / 1e4, '万'); }
  return v.toLocaleString('en-US');
}

// Rebuild the chips from the latest growth snapshot (feedable count).
// Rebuild the chips from the latest nap state. 喂食 lives in the growth
// block, not the grid. 「看看」needs a configured vision model — without one
// the main side refuses before capturing, so the cell stays hidden rather
// than showing a button that always plays the fallback line.
function panelCells() {
  return PANEL_ACTIONS
    .filter((a) => a.id !== 'look' || settings.lookAvailable === true)
    .map((a) => ({
      ...a,
      label: a.id === 'nap' && sleeping ? '叫醒' : a.label,
      enabled: true,
    }));
}

function openPanel() {
  const b = petBounds();
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const hostY = host.y ?? 0;
  const h = PANEL_H;
  // Anchor beside her bounds, flipping left at the screen edge.
  let x = b.right + 8;
  if (x + PANEL_W > host.x + host.width - 4) {
    x = b.x - PANEL_W - 8;
  }
  x = Math.min(Math.max(x, host.x + 4), host.x + host.width - PANEL_W - 4);
  // The ✕ is inside the card now, so the card needs no headroom above it.
  const y = Math.min(Math.max(b.y, hostY + 4),
    hostY + host.height - h - 4);
  panel = { x, y, w: PANEL_W, h, cells: panelCells(), hover: -1, feedHover: false };
  closeHover = false;
  closeVisible = false;
  tracePanel('open', { x: Math.round(x), y: Math.round(y) });
  console.log(`pet: panel open x=${x} y=${y} w=${PANEL_W} h=${h} bounds=${JSON.stringify(b)}`);
  // Fresh snapshot so the feedable count and stats are real, not stale.
  void Promise.resolve(petShell.getGrowth?.()).then((snap) => {
    if (snap && panel) {
      growth = snap;
      if (snap.stats) { stats = snap.stats; }
      panel.cells = panelCells();
      requestFrame();
    }
  }).catch(() => {});
  requestFrame();
}

function closePanel(reason = 'unspecified') {
  if (!panel) {
    return;
  }
  tracePanel('close', reason);
  panel = null;
  requestFrame();
}

// Right-click is the deliberate toggle (see the contextmenu listener): the
// card is opened by an explicit right-click and closed by the next one.
function togglePanel() {
  if (panel) { closePanel('right-click-toggle'); } else { openPanel(); }
}

// Everything the raster depends on. Cheap to compute (a handful of token
// reads) and it makes the cache self-invalidating: no producer has to remember
// to poke it when growth, stats, hover, theme, DPR or the avatar change.
function panelCacheKey() {
  const css = (name) => bubbleStyle.getPropertyValue(name);
  return [
    panel.x, panel.y, panel.w, panel.h, panel.hover, panel.feedHover ? 1 : 0,
    closeHover ? 1 : 0, closeVisible ? 1 : 0,
    sleeping ? 1 : 0, dshState,
    settings.lookAvailable === true ? 1 : 0,
    window.devicePixelRatio || 1, stillEpoch,
    css('--dsw-font-family'), css('--dsw-alias-bg-layer-1'),
    css('--dsw-alias-border-l2'), css('--dsw-alias-label-primary'),
    css('--dsw-alias-state-business-primary'),
    css('--dsw-alias-state-error-primary'),
    css('--dsw-alias-state-success-primary'),
    growth ? [growth.points, growth.level, growth.levelName, growth.nextAt,
      growth.nextName, growth.nextFeed, growth.tokensFed, growth.todayUsed,
      growth.levelColor].join(',') : '',
    stats ? [stats.satiety, stats.mood, stats.affection, stats.hearts,
      stats.affectionName, stats.affectionLevel, stats.affectionBase,
      stats.affectionNext].join(',') : '',
    panel.cells.map((c) => `${c.id}:${c.icon}:${c.label}:${c.enabled}`).join('|'),
  ].join('~');
}

// Blit the cached card. Rebuilds the raster only when the key changes; returns
// the ink rect so `paint()` can register the clear region.
function blitPanel() {
  if (!panel) { return null; }
  const pad = PANEL_PAD_MARGIN;
  const w = Math.ceil(panel.w + pad * 2);
  const h = Math.ceil(panel.h + pad * 2);
  const x = panel.x - pad;
  const y = panel.y - pad;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  const key = panelCacheKey();
  if (panelCache.key !== key || !panelCache.canvas
      || panelCache.canvas.width !== bw || panelCache.canvas.height !== bh) {
    if (!panelCache.canvas) {
      panelCache.canvas = document.createElement('canvas');
      panelCache.ctx = panelCache.canvas.getContext('2d');
    }
    const c = panelCache.ctx;
    panelCache.canvas.width = bw;
    panelCache.canvas.height = bh;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.save();
    c.translate(-x, -y);
    // Reuse the one painter by swapping the shared 2D context for the length
    // of this synchronous build; restored in `finally`.
    const prevCtx = ctx2d;
    ctx2d = c;
    try {
      drawPanel();
    } finally {
      ctx2d = prevCtx;
      c.restore();
    }
    panelCache.key = key;
  }
  panelCache.x = x;
  panelCache.y = y;
  panelCache.w = w;
  panelCache.h = h;
  ctx2d.drawImage(panelCache.canvas, x, y, w, h);
  return { x, y, w, h };
}

// ── settings page lives in the main window ──
// The ⚙ cell jumps to the desktop Settings `pet` section via
// `shell:live2d-open-settings`; this surface only reads settings (initial
// get + change push) — writes are owned by the main window.
// Quick-chat input (§B9): the box stays hidden until the R3 chat surface;
// the wiring is real now so the fallback line has a live call site.
const chatEl = typeof document !== 'undefined' && document.getElementById
  ? document.getElementById('pet-chat') : null;
const chatDom = chatEl && typeof chatEl.querySelector === 'function' ? chatEl : null;
const chatPickerEl = typeof document !== 'undefined' && document.getElementById
  ? document.getElementById('pc-picker') : null;

function applySettings(next) {
  const prev = settings;
  settings = { ...settings, ...next };
  if (settings.scale !== prev.scale && charRect) {
    const k = settings.scale / (prev.scale || 1);
    charRect = {
      x: charRect.x * k, y: charRect.y * k,
      right: charRect.right * k, bottom: charRect.bottom * k,
    };
  }
  if (settings.activity !== prev.activity) {
    tickStill._nextChat = 0;
    wander.nextAt = 0;
  }
  if (settings.personality !== prev.personality && prev.personality !== undefined) {
    say('personalitySet', undefined, undefined, 0); // pool may be empty pre-B11: no-op
  }
  clampDrawPos();
  reportRoam();
  requestFrame();
}

// ── wander / power-save helpers (§B4, §B10) ──
function scheduleWander() {
  const t = activityPair('wander');
  wander.nextAt = performance.now() + rng(t[0], t[1]);
}
function wanderSuppressed() {
  return !settings.wander || sleeping || dragging || thrown || feed || come
    || panel || chatOpen;
}
function powerSaving(now) {
  return settings.powerSave && !interactive && now - idle.lastInteract > 300000;
}
function clickBlip() {
  if (!settings.clickSound) { return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    clickBlip._ctx = clickBlip._ctx || new AC();
    const actx = clickBlip._ctx;
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, actx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, actx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.08, actx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.09);
    osc.connect(gain).connect(actx.destination);
    osc.start();
    osc.stop(actx.currentTime + 0.1);
  } catch (_) { /* audio is best-effort */ }
}
let lastRoamAt = 0;
function reportRoam() {
  if (!overlayOrigin || typeof petShell.reportRoam !== 'function') { return; }
  const now = performance.now();
  if (now - lastRoamAt < 100) { return; }
  lastRoamAt = now;
  // Report the tight BODY bounds (alpha silhouette + hover pad, still-aware),
  // not the whole pet frame: the main side inflates this rect into the hold
  // zone, so every px of slack here becomes dead click-through area.
  const b = petBodyBounds();
  void Promise.resolve(petShell.reportRoam({
    x: Math.round(b.x + overlayOrigin.x),
    y: Math.round(b.y + overlayOrigin.y),
    w: Math.round(b.right - b.x),
    h: Math.round(b.bottom - b.y),
  })).catch(() => {});
}

// Chip index under a point, or -1 (outside card / header / stats / gaps).
// Hit-test the feed button in the growth block. Returns true if the point
// lands on the button rect (independent of the chip grid below).
function feedButtonHit(x, y) {
  if (!panel) { return false; }
  const div1Y = panel.y + PANEL_PAD + PANEL_HEAD_H + 2;
  const gy = div1Y + 6;
  const btnY = gy + PANEL_FEED_TOP;
  const btnH = PANEL_FEED_H;
  const btnX = panel.x + PANEL_PAD;
  const btnW = panel.w - PANEL_PAD * 2;
  return x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH;
}

function panelCellAt(x, y) {
  if (!panel || x < panel.x || x > panel.x + panel.w
      || y < panel.y || y > panel.y + panel.h) {
    return -1;
  }
  const gx = panel.x + PANEL_PAD;
  const gy = panel.y + PANEL_GRID_TOP;
  const col = Math.floor((x - gx) / (PANEL_CHIP_W + PANEL_CHIP_GAP));
  const row = Math.floor((y - gy) / (PANEL_CHIP_H + PANEL_CHIP_GAP));
  if (col < 0 || col > 1 || row < 0 || row >= PANEL_ROWS) {
    return -1;
  }
  // Clicking inside the 6px gutter between chips hits nothing.
  const inX = (x - gx) - col * (PANEL_CHIP_W + PANEL_CHIP_GAP);
  const inY = (y - gy) - row * (PANEL_CHIP_H + PANEL_CHIP_GAP);
  return inX <= PANEL_CHIP_W && inY <= PANEL_CHIP_H ? row * 2 + col : -1;
}

function dispatchPanelCell(cell) {
  console.log('pet: panel cell', cell.id);
  closePanel(`action:${cell.id}`);
  if (cell.id === 'nap') {
    if (sleeping) { wake(); care('wake'); } else { sleepEnter(); say('sleep'); }
  } else if (cell.id === 'settings') {
    // Her settings live in the main window's Settings shell (section
    // `pet`) — navigate there, confirm with a line, no local overlay.
    void Promise.resolve(petShell.openSettings?.()).then((res) => {
      say(res && res.ok === true ? 'settingsChanged' : 'dshError', undefined, undefined, 0);
    }).catch(() => say('dshError', undefined, undefined, 0));
  } else if (cell.id === 'chat') {
    toggleChat(true);
  } else if (cell.id === 'look') {
    void submitLook();
  } else if (cell.id === 'hide') {
    void Promise.resolve(petShell.hidePet?.()).catch(() => {});
  } else {
    runAction(cell.id);
  }
}

// Quick-chat dialog: a DOM card anchored to her head, re-anchored every
// frame while open so it follows her anywhere (drag, wander, come). DOM is
// required for real IME input — and the overlay window is focusable:false,
// so opening asks main to flip setFocusable+focus, closing restores it.
let chatOpen = false;
let chatBusy = false;
let chatRect = null; // { x, y, w, h } — joins petBounds so the card takes clicks
let chatPickerRect = null; // floating menu joins the interactive area only while open
const chatLog = []; // { role: 'user'|'her'|'err', text }
let chatTypingEl = null;
const CHAT_LOG_MAX = 30;
// Shared-session mode: when the whale assistant is enabled the card talks
// to her persistent session, so its model picker IS the session selection
// and the thread backfills from the real conversation log.
let chatShared = false;
let chatGroups = [];    // [{id,name,models:[{id,name,efforts,defaultEffort}]}]
let chatFlatModels = [];// [{provider,model,efforts,defaultEffort}]
let chatServerSeq = 0;  // max event seq last synced from the shared log
let chatSelKey = '';    // serialized [groups, selected] — rebuild selects only on change
let chatPollTimer = 0;
let chatPickerOpen = ''; // 'root' | 'model' | 'effort' — portaled menu pane
let chatPickPending = false;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function chatPart(sel) {
  return chatDom ? chatDom.querySelector(sel) : null;
}

// Anchor above her head like the bubble; flip below when there is no room
// up top. The card must never sit ON her: when the host is too short to
// clear her either way, pick the side that leaves more of her uncovered.
// Pure math (testable); the DOM read/write lives in syncChatPos.
function chatAnchor(b, host, w, h) {
  const hostY = host.y ?? 0;
  const hostB = hostY + host.height;
  const cx = (b.x + b.right) / 2;
  const x = Math.min(Math.max(cx - w / 2, host.x + 4), host.x + host.width - w - 4);
  let y = b.y - h - 8;
  if (y < hostY + 4) {
    y = Math.min(b.bottom + 8, hostB - h - 4);
    if (y < b.bottom && hostB - b.bottom < b.y - hostY) {
      y = hostY + 4;
    }
  }
  y = Math.min(Math.max(y, hostY + 4), Math.max(hostY + 4, hostB - h - 4));
  return { x: Math.round(x), y: Math.round(y), w, h };
}

// Card size comes from layout each call — the thread grows as they talk.
function syncChatPos() {
  if (!chatOpen || !chatEl || typeof chatEl.offsetWidth !== 'number') {
    return;
  }
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const w = chatEl.offsetWidth || 248;
  const h = chatEl.offsetHeight || 120;
  const next = chatAnchor(petBodyBounds(), host, w, h);
  const nx = next.x;
  const ny = next.y;
  if (!chatRect || chatRect.x !== nx || chatRect.y !== ny || chatRect.h !== h) {
    chatRect = { x: nx, y: ny, w, h };
    chatEl.style.left = `${nx}px`;
    chatEl.style.top = `${ny}px`;
  }
  syncChatPickerPos();
}

function chatScrollDown() {
  const thread = chatPart('#pc-thread');
  if (thread) { thread.scrollTop = thread.scrollHeight; }
}

function chatRenderEmpty() {
  const thread = chatPart('#pc-thread');
  if (!thread) { return; }
  const empty = chatPart('#pc-empty');
  if (empty) { empty.hidden = chatLog.length > 0; }
}

// She texts like a person — one reply can arrive as several short
// messages, split on blank lines. The log entry stays whole; only the
// rendering splits.
function chatSegments(role, text) {
  if (role !== 'her') { return [String(text)]; }
  const parts = String(text).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [String(text)];
}
function chatAppend(role, text) {
  chatLog.push({ role, text });
  if (chatLog.length > CHAT_LOG_MAX) { chatLog.shift(); }
  const thread = chatPart('#pc-thread');
  if (!thread) { return; }
  for (const part of chatSegments(role, text)) {
    const node = document.createElement('div');
    node.className = `pc-msg pc-${role}`;
    node.textContent = part;
    thread.appendChild(node);
  }
  chatRenderEmpty();
  chatScrollDown();
}

// A sticker while the card is open lands inside the thread like any of her
// replies — the ambient bubble stays the closed-card surface.
function chatAppendImage(src, alt) {
  chatLog.push({ role: 'her', text: alt || '[表情包]' });
  if (chatLog.length > CHAT_LOG_MAX) { chatLog.shift(); }
  const thread = chatPart('#pc-thread');
  if (thread) {
    const node = document.createElement('div');
    node.className = 'pc-msg pc-her';
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt || '表情包';
    img.className = 'pc-sticker';
    node.appendChild(img);
    thread.appendChild(node);
  }
  chatRenderEmpty();
  chatScrollDown();
}

function chatSetBusy(next) {
  chatBusy = next;
  const send = chatPart('#pc-send');
  if (send) { send.disabled = next || !(chatPart('#pc-input')?.value || '').trim(); }
  if (next) {
    const thread = chatPart('#pc-thread');
    if (thread) {
      chatTypingEl = document.createElement('div');
      chatTypingEl.className = 'pc-msg pc-typing';
      chatTypingEl.textContent = '…';
      thread.appendChild(chatTypingEl);
      chatRenderEmpty();
      chatScrollDown();
    }
  } else if (chatTypingEl) {
    chatTypingEl.remove?.();
    chatTypingEl = null;
  }
}

function chatFocusWindow(on) {
  void Promise.resolve(petShell.chatFocus?.({ focus: on })).catch(() => {});
}

// Rebuild the thread from the shared session tail (poll/backfill path).
// chatServerCount only moves forward — a shorter list (fresh session,
// transient error rows) never wipes what the user just typed.
function chatRenderHistory(list) {
  chatLog.length = 0;
  for (const m of list) {
    chatLog.push({ role: m.role === 'her' || m.role === 'err' ? m.role : 'user', text: String(m.text || '') });
  }
  const thread = chatPart('#pc-thread');
  if (!thread || typeof thread.querySelectorAll !== 'function') { return; }
  chatTypingEl?.remove?.();
  chatTypingEl = null;
  for (const node of thread.querySelectorAll('.pc-msg')) { node.remove?.(); }
  for (const m of chatLog) {
    for (const part of chatSegments(m.role, m.text)) {
      const node = document.createElement('div');
      node.className = `pc-msg pc-${m.role}`;
      node.textContent = part;
      thread.appendChild(node);
    }
  }
  if (chatBusy) {
    chatTypingEl = document.createElement('div');
    chatTypingEl.className = 'pc-msg pc-typing';
    chatTypingEl.textContent = '…';
    thread.appendChild(chatTypingEl);
  }
  const empty = chatPart('#pc-empty');
  if (empty) { empty.hidden = chatLog.length > 0; }
  chatScrollDown();
}

const CHAT_EFFORT_NAMES = {
  off: '关闭', minimal: '最低', low: '低', medium: '中',
  high: '高', xhigh: '极高', max: '最大',
};
function chatEffortName(entry) {
  return CHAT_EFFORT_NAMES[entry?.id] || entry?.name || entry?.id || '';
}

// Hidden selects retain the catalog's exact ids. The visible triggers show
// a readable value and expose the full choice to hover and assistive tech.
function chatSyncPickTitle(sel) {
  if (!sel) { return; }
  const option = sel.selectedOptions?.[0];
  if (sel.id === 'pc-model') {
    const trigger = chatPart('#pc-model-trigger');
    if (!trigger) { return; }
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel.value);
    const group = chatGroups.find((g) => g.id === m?.provider);
    const label = option?.textContent || m?.model || '选择模型';
    trigger.querySelector('.pc-choice-value').textContent = label;
    trigger.title = group ? `${group.name || group.id} · ${label}` : label;
    trigger.setAttribute('aria-label', `选择模型，当前${trigger.title}`);
  } else if (sel.id === 'pc-effort') {
    const trigger = chatPart('#pc-model-trigger');
    if (!trigger) { return; }
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === chatPart('#pc-model')?.value);
    const effort = m?.efforts?.find((e) => e.id === sel.value);
    const label = chatEffortName(effort) || '选择档位';
    const caption = trigger.querySelector('.pc-choice-effort');
    caption.textContent = label;
    caption.hidden = false;
    trigger.title = `${chatPart('#pc-model')?.selectedOptions?.[0]?.textContent || '模型'} · ${label}`;
    trigger.setAttribute('aria-label', `选择模型与思考，当前${trigger.title}`);
  }
}

function syncChatPickerPos() {
  if (!chatPickerOpen || !chatPickerEl || chatPickerEl.hidden) { chatPickerRect = null; return; }
  const trigger = chatPart('#pc-model-trigger');
  if (!trigger) { return; }
  const anchor = trigger.getBoundingClientRect();
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const width = chatPickerEl.offsetWidth;
  const height = chatPickerEl.offsetHeight;
  const left = Math.round(Math.min(Math.max(anchor.right - width, host.x + 4), host.x + host.width - width - 4));
  const above = anchor.top - height - 8;
  const top = Math.round(Math.min(Math.max(above, host.y + 4), host.y + host.height - height - 4));
  chatPickerEl.style.left = `${left}px`;
  chatPickerEl.style.top = `${top}px`;
  chatPickerRect = { x: left, y: top, w: width, h: height };
}

// Effort options follow the picked model; the whole side cell hides when
// the model has none so the name keeps the full bar.
function chatRenderEfforts(prefer) {
  const sel = chatPart('#pc-model');
  const effSel = chatPart('#pc-effort');
  const effBox = chatPart('#pc-effort-box');
  if (!sel || !effSel) { return; }
  const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel.value);
  const efforts = m?.efforts || [];
  if (!efforts.length) {
    if (effBox) { effBox.hidden = true; }
    const caption = chatPart('#pc-model-trigger .pc-choice-effort');
    if (caption) { caption.hidden = true; caption.textContent = ''; }
    if (chatPickerOpen === 'effort') { chatClosePicker(); }
    effSel.innerHTML = '';
    chatSyncPickTitle(sel);
    return;
  }
  effSel.innerHTML = efforts
    .map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
  if (effBox) { effBox.hidden = false; }
  if (prefer && efforts.some((e) => e.id === prefer)) {
    effSel.value = prefer;
  } else if (m.defaultEffort) {
    effSel.value = m.defaultEffort;
  }
  chatSyncPickTitle(effSel);
}

function chatRenderModels(selected) {
  const sel = chatPart('#pc-model');
  if (!sel) { return; }
  chatFlatModels = [];
  sel.innerHTML = chatGroups.map((g) => (
    `<optgroup label="${esc(g.name || g.id)}">${
      (g.models || []).map((m) => {
        chatFlatModels.push({
          provider: g.id, model: m.id,
          efforts: m.efforts || [], defaultEffort: m.defaultEffort || '',
        });
        return `<option value="${esc(g.id)}::${esc(m.id)}">${esc(m.name || m.id)}</option>`;
      }).join('')
    }</optgroup>`
  )).join('');
  if (selected?.provider && selected?.model) {
    sel.value = `${selected.provider}::${selected.model}`;
  }
  chatSyncPickTitle(sel);
  chatRenderEfforts(selected?.reasoningEffort || '');
}

function chatClosePicker(restoreFocus = false) {
  chatPickerOpen = '';
  const picker = chatPickerEl;
  if (picker) { picker.hidden = true; picker.innerHTML = ''; }
  chatPickerRect = null;
  chatPart('#pc-model-trigger')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) { chatPart('#pc-model-trigger')?.focus?.(); }
}

function chatShowPicker(kind) {
  const picker = chatPickerEl;
  if (!picker) { return; }
  const selected = chatPart(kind === 'model' ? '#pc-model' : '#pc-effort')?.value;
  if (kind === 'root') {
    const model = chatPart('#pc-model')?.selectedOptions?.[0]?.textContent || '选择模型';
    const effort = chatPart('#pc-model-trigger .pc-choice-effort')?.textContent || '';
    picker.innerHTML = `<button class="pc-option" type="button" data-pane="model" role="menuitem"><span class="pc-option-name">模型</span><span class="pc-option-detail">${esc(model)}</span><span aria-hidden="true">›</span></button>${chatPart('#pc-effort-box')?.hidden ? '' : `<button class="pc-option" type="button" data-pane="effort" role="menuitem"><span class="pc-option-name">思考</span><span class="pc-option-detail">${esc(effort)}</span><span aria-hidden="true">›</span></button>`}`;
  } else if (kind === 'model') {
    picker.innerHTML = '<button class="pc-option" type="button" data-pane="root" role="menuitem"><span aria-hidden="true">‹</span><span class="pc-option-name">模型</span></button>' + chatGroups.map((group) => `<div class="pc-picker-group">${esc(group.name || group.id)}</div>${
      (group.models || []).map((m) => {
        const value = `${group.id}::${m.id}`;
        const picked = value === selected;
        return `<button class="pc-option" type="button" role="menuitemradio" data-value="${esc(value)}" aria-checked="${picked}"><span class="pc-option-name">${esc(m.name || m.id)}</span>${picked ? '<span class="pc-option-check" aria-hidden="true">✓</span>' : ''}</button>`;
      }).join('')
    }`).join('');
  } else {
    const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === chatPart('#pc-model')?.value);
    picker.innerHTML = `<button class="pc-option" type="button" data-pane="root" role="menuitem"><span aria-hidden="true">‹</span><span class="pc-option-name">思考</span></button>${
      (m?.efforts || []).map((e) => {
        const picked = e.id === selected;
        return `<button class="pc-option" type="button" role="menuitemradio" data-value="${esc(e.id)}" aria-checked="${picked}"><span class="pc-option-name">${esc(chatEffortName(e))}</span>${picked ? '<span class="pc-option-check" aria-hidden="true">✓</span>' : ''}</button>`;
      }).join('')
    }`;
  }
  chatPickerOpen = kind;
  picker.hidden = false;
  chatPart('#pc-model-trigger')?.setAttribute('aria-expanded', 'true');
  syncChatPickerPos();
  const focusRow = picker.querySelector('[aria-checked="true"]') || picker.querySelector('.pc-option');
  focusRow?.scrollIntoView?.({ block: 'nearest' });
  focusRow?.focus?.();
}

function chatTogglePicker() {
  if (chatPickerOpen) { chatClosePicker(true); }
  else { chatShowPicker('root'); }
}

// Card chrome + shared-log sync: model selects, jump button, her display
// name, and the merged thread. Polled while the card is open so messages
// sent from the DSHD side show up here too (互通).
let chatServerSession = '';
let chatCatalogAt = 0;
let chatCatalogLoaded = false;
let chatHistoryPending = null;
let chatCatalogPending = null;
let chatCatalogForceQueued = false;
let chatSelected = null;

function chatRefreshState(forceCatalog = false) {
  const history = chatRefreshHistory();
  if (!forceCatalog && chatCatalogLoaded && Date.now() - chatCatalogAt < 60000) {
    return history;
  }
  // Resolve the session identity first, then fetch its catalog. A slow
  // catalog must not hold the next three-second history refresh hostage.
  return history.then(() => chatRefreshCatalog(forceCatalog));
}

function chatRefreshHistory() {
  if (chatHistoryPending) { return chatHistoryPending; }
  chatHistoryPending = chatRefreshStateOnce().finally(() => { chatHistoryPending = null; });
  return chatHistoryPending;
}

function chatRefreshCatalog(force) {
  if (chatCatalogPending) {
    if (!force) { return chatCatalogPending; }
    chatCatalogForceQueued = true;
    return chatCatalogPending.then(() => chatCatalogPending);
  }
  const request = Promise.resolve().then(() => petShell.chatState?.({ includeCatalog: true }))
    .catch(() => null).then((st) => {
      if (!st || st.ok !== true || !Array.isArray(st.groups)) { return; }
      if (st.sessionId && chatServerSession && String(st.sessionId) !== chatServerSession) { return; }
      chatGroups = st.groups;
      chatCatalogAt = Date.now();
      chatCatalogLoaded = true;
      const selKey = JSON.stringify([chatGroups, chatSelected]);
      if (selKey !== chatSelKey && !chatPickerOpen && !chatPickPending) {
        chatSelKey = selKey;
        chatRenderModels(chatSelected);
      }
    });
  chatCatalogPending = request.finally(() => {
    chatCatalogPending = null;
    if (chatCatalogForceQueued) {
      chatCatalogForceQueued = false;
      void chatRefreshCatalog(true);
    }
  });
  return chatCatalogPending;
}

async function chatRefreshStateOnce() {
  const st = await Promise.resolve().then(() => petShell.chatState?.({ includeCatalog: false })).catch(() => null);
  if (!st || st.ok !== true) { return; }
  // A recreated assistant session starts a new log — drop the stale sync
  // watermark so the short fresh tail still repaints.
  const sid = String(st.sessionId || '');
  if (sid && sid !== chatServerSession) {
    chatServerSession = sid;
    chatServerSeq = 0;
    chatSelKey = '';
    chatCatalogLoaded = false;
    chatCatalogAt = 0;
  }
  chatShared = st.enabled === true;
  const modelsEl = chatPart('#pc-models');
  const openBtn = chatPart('#pc-open');
  if (modelsEl) { modelsEl.hidden = !chatShared; }
  if (openBtn) { openBtn.hidden = !chatShared; }
  const nameEl = chatPart('.pc-name');
  if (nameEl && st.name) { nameEl.textContent = st.name; }
  if (!chatShared) { chatClosePicker(); return; }
  chatSelected = st.selected ?? null;
  // Rebuild the selects only when the catalog/selection actually changed —
  // a poll must never clobber an open dropdown or an in-flight pick.
  const selKey = JSON.stringify([chatGroups, chatSelected]);
  if (selKey !== chatSelKey && !chatPickerOpen && !chatPickPending) {
    chatSelKey = selKey;
    chatRenderModels(chatSelected);
  }
  // Watermark on max event seq, not row count — the server tail is capped,
  // so a full tail keeps the same length while new rows rotate through.
  if (Array.isArray(st.history) && st.history.length) {
    const maxSeq = st.history.reduce((m, r) => Math.max(m, Number(r?.seq) || 0), 0);
    if (maxSeq > chatServerSeq) {
      chatServerSeq = maxSeq;
      chatRenderHistory(st.history);
    }
  }
}

function chatStartPoll() {
  chatStopPoll();
  chatPollTimer = setInterval(() => {
    if (chatOpen && chatShared) { void chatRefreshState(); }
  }, 3000);
}

function chatStopPoll() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = 0; }
}

function chatSubmitModelChoice() {
  const sel = chatPart('#pc-model');
  const effSel = chatPart('#pc-effort');
  const effBox = chatPart('#pc-effort-box');
  const m = chatFlatModels.find((x) => `${x.provider}::${x.model}` === sel?.value);
  if (!m) { return; }
  const effort = effSel && effBox && !effBox.hidden ? String(effSel.value || '') : '';
  chatPickPending = true;
  void Promise.resolve(petShell.chatSelectModel?.({
    provider: m.provider, model: m.model, reasoningEffort: effort,
  })).then((result) => {
    if (result?.ok === false) { chatAppend('err', '模型切换没有成功'); }
  }).catch(() => {
    chatAppend('err', '模型切换没有成功');
  }).finally(() => {
    chatPickPending = false;
    if (chatOpen) { void chatRefreshState(); }
  });
}

function toggleChat(force) {
  const next = force !== undefined ? Boolean(force) : !chatOpen;
  if (next === chatOpen) { return; }
  if (next && (!chatEl || !chatDom || !settings.chatEnabled)) {
    say('chatFallback');
    return;
  }
  chatOpen = next;
  if (chatOpen) {
    chatEl.hidden = false;
    dropAmbientBubbles();
    chatRenderEmpty();
    syncChatPos();
    setInteractive(true); // the card joins petBounds, but pin it explicitly
    chatFocusWindow(chatOpen);
    // Focus lands once the window actually takes OS focus.
    setTimeout(() => chatPart('#pc-input')?.focus?.(), 60);
    void chatRefreshState(true);
    chatStartPoll();
  } else {
    chatClosePicker();
    chatEl.hidden = true;
    chatRect = null;
    chatFocusWindow(chatOpen);
    chatStopPoll();
  }
  requestFrame();
}

// Renderer-side submit: thread echo + her reply inline, bubble stays the
// ambient copy so a closed card still shows the answer.
async function submitChat(text) {
  const t = String(text || '').trim();
  if (!t || chatBusy) { return; }
  if (t.length > 2000) {
    chatAppend('err', '最多发送 2000 字，请缩短后再发送');
    return;
  }
  const input = chatPart('#pc-input');
  if (!settings.chatEnabled) {
    say('chatFallback');
    return;
  }
  chatAppend('user', t);
  if (input) { input.value = ''; chatAutosize(); }
  chatSetBusy(true);
  try {
    const res = await Promise.resolve(petShell.chat?.({ text: t }));
    chatSetBusy(false);
    if (res && res.ok && typeof res.reply === 'string' && res.reply) {
      // Shared mode: the reply already lives in the session log — pull it
      // via state so the card can't double-render it when the 3s poll
      // catches up. Only append when the tail hasn't published it yet.
      let shown = false;
      if (chatShared) {
        await Promise.resolve(chatRefreshState()).catch(() => {});
        const last = chatLog[chatLog.length - 1];
        shown = last?.role === 'her' && last.text.slice(0, 60) === res.reply.slice(0, 60);
      }
      if (!shown) { chatAppend('her', res.reply); }
      pushBubble({ text: res.reply.slice(0, 120), until: performance.now() + 6000, priority: 1 });
      return;
    }
    if (res?.ok === true && res.via === 'whale') {
      // A completed tool-only turn can legitimately have no closing prose.
      if (chatShared) await Promise.resolve(chatRefreshState()).catch(() => {});
      return;
    }
    // Whale-path failures already get a precise error row — a random quip
    // on top would only muddy it.
    if (res?.via === 'whale') {
      if (chatShared) await Promise.resolve(chatRefreshState()).catch(() => {});
      const replyShown = res.reply && chatLog.slice(-2).some((row) => row.role === 'her'
        && row.text.slice(0, 60) === res.reply.slice(0, 60));
      if (res.reply && !replyShown) chatAppend('her', res.reply);
      if (chatLog[chatLog.length - 1]?.role !== 'err') {
        const status = res.reason === 'turn-aborted' ? '这轮已中止'
          : res.reason === 'timeout' ? '等待回复超时' : '这轮没有完成';
        chatAppend('err', `${status}——点 ↗ 去会话里看详情`);
      }
      return;
    }
    chatAppend('err', '没连上——稍后再试试');
  } catch (_) {
    chatSetBusy(false);
    chatAppend('err', '没连上——稍后再试试');
  }
  say('chatFallback');
}

// Textarea grows to three lines then scrolls; send key is plain Enter.
function chatAutosize() {
  const input = chatPart('#pc-input');
  if (!input) { return; }
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 66)}px`;
  syncChatPos();
}

function bindChatDom() {
  if (!chatDom) { return; }
  const input = chatPart('#pc-input');
  chatPart('#pc-close')?.addEventListener('click', () => toggleChat(false));
  chatPart('#pc-send')?.addEventListener('click', () => {
    void submitChat(input?.value);
  });
  input?.addEventListener('input', () => {
    chatAutosize();
    const send = chatPart('#pc-send');
    if (send && !chatBusy) { send.disabled = !input.value.trim(); }
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submitChat(input.value);
    }
  });
  chatPart('#pc-model-trigger')?.addEventListener('click', () => chatTogglePicker());
  chatPickerEl?.addEventListener('click', (event) => {
    const pane = event.target.closest?.('[data-pane]');
    if (pane) { chatShowPicker(pane.dataset.pane); return; }
    const choice = event.target.closest?.('.pc-option');
    if (!choice) { return; }
    if (chatPickerOpen === 'model') {
      const sel = chatPart('#pc-model');
      if (sel?.value === choice.dataset.value) { chatClosePicker(true); return; }
      if (sel) { sel.value = choice.dataset.value; chatSyncPickTitle(sel); }
      chatRenderEfforts('');
    } else if (chatPickerOpen === 'effort') {
      const sel = chatPart('#pc-effort');
      if (sel?.value === choice.dataset.value) { chatClosePicker(true); return; }
      if (sel) { sel.value = choice.dataset.value; chatSyncPickTitle(sel); }
    }
    chatClosePicker(true);
    chatSubmitModelChoice();
  });
  const onChatKeydown = (event) => {
    if (chatPickerOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const rows = [...chatPickerEl.querySelectorAll('.pc-option')];
      const index = rows.indexOf(document.activeElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[(index + step + rows.length) % rows.length]?.focus?.();
      return;
    }
    if (event.key !== 'Escape') { return; }
    event.preventDefault();
    event.stopPropagation();
    if (chatPickerOpen === 'model' || chatPickerOpen === 'effort') { chatShowPicker('root'); }
    else if (chatPickerOpen) { chatClosePicker(true); }
    else { toggleChat(false); }
  };
  chatDom.addEventListener('keydown', onChatKeydown);
  chatPickerEl?.addEventListener('keydown', onChatKeydown);
  document.addEventListener('pointerdown', (event) => {
    if (chatPickerOpen && !chatDom.contains(event.target) && !chatPickerEl?.contains(event.target)) { chatClosePicker(); }
  });
  chatPart('#pc-open')?.addEventListener('click', () => {
    void Promise.resolve(petShell.openWhale?.()).catch(() => {});
  });
  // The card never folds itself: only ✕ / Esc / the 聊聊 chip close it.
  // Clicking another window just blurs this one — the card stays put, and
  // regaining focus drops the caret back into the input so typing
  // continues where it left off.
  window.addEventListener('focus', () => { if (chatOpen) { chatPart('#pc-input')?.focus?.(); } });
}

// 「看看」往返要几秒——点下立刻给「正在看」加载气泡，结果/错误到了原位顶掉。
// lookBusyUntil 兼作防重入：在途期间为 Infinity，重复点击只保住现有气泡，
// 不发第二次请求（主进程另有 4s 冷却兜底）。
const LOOK_FEEDBACK_MS = 46000; // covers the plugin-side 45s deadline
let lookBusyUntil = 0;
let lookAnimTimer = 0;
function stopLookAnim() {
  if (lookAnimTimer) { clearInterval(lookAnimTimer); lookAnimTimer = 0; }
}
function startLookAnim() {
  if (lookAnimTimer) { return; }
  lookAnimTimer = setInterval(() => {
    // The pin is gone (settled, preempted by an alert, or dropped with the
    // ambient layer) — stop touching whatever bubble took the stage.
    if (!bubble || !bubble.lookPin || performance.now() >= lookBusyUntil) {
      stopLookAnim();
      return;
    }
    bubble.text = bubble.text.replace(/…+$/u, '')
      + '…'.repeat((Math.floor(performance.now() / 350) % 3) + 1);
    requestFrame();
  }, 350);
}
function sayLooking() {
  // A re-click while the pin is up keeps the existing bubble untouched —
  // a second「正在看」line would only leave a stale copy behind.
  if (bubble && bubble.lookPin && performance.now() < lookBusyUntil) {
    startLookAnim();
    return;
  }
  say('looking', undefined, undefined, 1, { lookPin: true, until: Infinity });
  // The dialogue store can still be empty at startup — pin SOME loading
  // bubble even without a pool line.
  if (!bubble || !bubble.lookPin) {
    pushBubble({ text: '正在看屏幕', priority: 1, until: Infinity, lookPin: true });
  }
  startLookAnim();
}
async function submitLook() {
  // The in-flight pin decides first — a re-click never reissues, whatever
  // changed in settings since the call started.
  if (performance.now() < lookBusyUntil) {
    sayLooking();
    return;
  }
  if (!settings.chatEnabled) {
    say('lookAssistantOff');
    return;
  }
  lookBusyUntil = Infinity;
  sayLooking();
  let res = null;
  try {
    res = await Promise.resolve(petShell.lookScreen?.());
  } catch (_) {
    // transport/IPC collapse → res stays null → generic fallback below
  } finally {
    // The call settled — release the re-click guard and drop the pin so the
    // outcome voice lands in place over「正在看」. Queued lookPin copies
    // are stale now — purge. If the outcome produces no line, give the
    // visible pin a normal lifetime instead of an infinite stale bubble.
    lookBusyUntil = 0;
    stopLookAnim();
    bubbleQueue = bubbleQueue.filter((e) => !e.lookPin && !e.lookResult);
    if (bubble && bubble.lookPin) {
      bubble.until = performance.now() + 6000;
    }
  }
  if (res && res.ok && typeof res.reply === 'string' && res.reply) {
    pushBubble({ text: res.reply.slice(0, 120), until: Infinity, priority: 2, pinned: true, lookResult: true });
    return;
  }
  // Distinct failures get distinct voices — only a real capture/noise
  // miss deserves the generic「看不清」pool.
  const reason = res && typeof res.reason === 'string' ? res.reason : '';
  if (reason === 'no-vision-model') { say('lookNoModel'); return; }
  if (reason === 'assistant-off') { say('lookAssistantOff'); return; }
  // Capture-side misses never reached a model — the generic pool is the
  // honest voice for those, not「模型把我拒之门外」.
  if (reason === 'capture-failed' || reason === 'no-frame' || reason === 'no-capturer') {
    say('lookFallback');
    return;
  }
  if (reason && reason !== 'cooldown') {
    // Plugin failures carry a prose detail; legacy/transport reasons are
    // themselves the actionable token (http-500, timeout, …).
    const detail = typeof res.detail === 'string' && res.detail
      ? res.detail.slice(0, 80) : reason;
    // autohide drops the （detail） shell entirely when no detail came back.
    say('lookError', { detail }, ['detail']);
    return;
  }
  say('lookFallback');
}

// Bar fill for a 0-100 care stat: red under the warn line, green when
// topped off, business blue otherwise — the QQ-pet convention.
function statFill(v, warnAt, goodAt, css) {
  if (v < warnAt) { return css('--dsw-alias-state-error-primary'); }
  if (v >= goodAt) { return css('--dsw-alias-state-success-primary'); }
  return css('--dsw-alias-state-business-primary');
}

function drawPanel() {
  if (!panel) {
    return null;
  }
  const p = panel;
  const g = growth;
  const st = stats;
  const css = (name) => bubbleStyle.getPropertyValue(name);
  const label = css('--dsw-alias-label-primary');
  // Runs center on their real ink box: 'middle' baseline trusts the
  // primary font's metrics, which lands emoji ~2px high and CJK a hair
  // off — measure each run and drop its ink center on the target midline.
  const mid = (text, x, y, align = 'left') => {
    ctx2d.textAlign = align;
    ctx2d.textBaseline = 'alphabetic';
    const m = ctx2d.measureText(String(text));
    const measured = Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent);
    ctx2d.textBaseline = measured ? 'alphabetic' : 'middle';
    const rise = measured ? (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : 0;
    const shift = align === 'center' && Number.isFinite(m.actualBoundingBoxLeft) && Number.isFinite(m.actualBoundingBoxRight)
      ? (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 : 0;
    ctx2d.fillText(text, x + shift, y + rise);
  };
  const dim = (text, x, y, alpha = 0.55) => {
    ctx2d.globalAlpha = alpha;
    ctx2d.fillStyle = label;
    mid(text, x, y);
    ctx2d.globalAlpha = 1;
  };
  ctx2d.save();
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'alphabetic';
  const font = css('--dsw-font-family');
  const padL = p.x + PANEL_PAD;
  const right = p.x + p.w - PANEL_PAD;
  // Card body: flat fill + hairline — no drop shadow. On a transparent
  // layered window a shadow is a dark halo around the card, and whatever
  // bleeds past the returned clear rect repaints every frame, compounding
  // into a near-solid black frame that stays on screen after close.
  ctx2d.beginPath();
  ctx2d.roundRect(p.x, p.y, p.w, p.h, 12);
  ctx2d.fillStyle = css('--dsw-alias-bg-layer-1');
  ctx2d.fill();
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.lineWidth = 1;
  ctx2d.stroke();

  // Level theme color — the growth ladder's visual identity. Used on the
  // level badge, growth bar fill, tier dots, and feed button so the whole
  // card shifts hue as she matures.
  const lvlColor = (g && g.levelColor) || css('--dsw-alias-state-business-primary');

  // ── header: avatar / name / level badge / hearts ──
  const avC = { x: padL + 18, y: p.y + PANEL_PAD + 18, r: 18 };
  ctx2d.beginPath();
  ctx2d.arc(avC.x, avC.y, avC.r, 0, Math.PI * 2);
  ctx2d.fillStyle = lvlColor;
  ctx2d.globalAlpha = 0.14;
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  const greet = stills.get('greet');
  if (greet && greet.box) {
    const hb = greet.box;
    const sw = hb.right - hb.x;
    const sh = hb.bottom - hb.y;
    const sx = hb.x + sw * 0.18;
    const sy = hb.y;
    const sd = Math.min(sw * 0.64, sh * 0.5);
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(avC.x, avC.y, avC.r - 1, 0, Math.PI * 2);
    ctx2d.clip();
    ctx2d.drawImage(greet.img, sx, sy, sd, sd,
      avC.x - avC.r + 1, avC.y - avC.r + 1, (avC.r - 1) * 2, (avC.r - 1) * 2);
    ctx2d.restore();
  } else {
    ctx2d.font = `20px ${font}`;
    mid('🐋', avC.x, avC.y, 'center');
  }
  const nameX = padL + 44;
  ctx2d.font = `600 13px ${font}`;
  ctx2d.fillStyle = label;
  mid('鲸鱼娘', nameX, p.y + PANEL_PAD + 9);
  // DSH link state dot: while the watcher sees an open turn or fresh log
  // traffic, a soft teal 「陪伴中」rides next to her name.
  const nameW = ctx2d.measureText('鲸鱼娘').width;
  const dotX = nameX + nameW + 8;
  const dotOn = dshState === 'working';
  ctx2d.beginPath();
  ctx2d.arc(dotX, p.y + PANEL_PAD + 9, 3, 0, Math.PI * 2);
  ctx2d.fillStyle = dotOn
    ? css('--dsw-alias-state-business-primary')
    : css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = dotOn ? 1 : 0.5;
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  if (dotOn) {
    ctx2d.font = `9px ${font}`;
    dim('工作中', dotX + 6, p.y + PANEL_PAD + 9);
    ctx2d.font = `600 13px ${font}`;
  }
  // Level badge — filled pill in the tier color, not a flat outline.
  if (g) {
    ctx2d.font = `600 10px ${font}`;
    const pill = `Lv.${g.level} ${g.levelName}`;
    const pw = ctx2d.measureText(pill).width + 14;
    // The header's right edge belongs to the ✕, so the badge ends before it
    // instead of underneath. The ✕ is hidden until hover, but the badge must
    // not shift when it appears.
    const badgeRight = p.x + PANEL_CLOSE_X - 6;
    ctx2d.beginPath();
    ctx2d.roundRect(badgeRight - pw, p.y + PANEL_PAD + 1, pw, 16, 8);
    ctx2d.fillStyle = lvlColor;
    ctx2d.globalAlpha = 0.18;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = lvlColor;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.roundRect(badgeRight - pw, p.y + PANEL_PAD + 1, pw, 16, 8);
    ctx2d.stroke();
    ctx2d.fillStyle = lvlColor;
    mid(pill, badgeRight - pw + 7, p.y + PANEL_PAD + 9);
  }
  // Relation line: filled/open hearts + stage name.
  ctx2d.font = `10px ${font}`;
  const hearts = st ? '♥'.repeat(st.hearts) + '♡'.repeat(5 - st.hearts) : '♡♡♡♡♡';
  ctx2d.fillStyle = css('--dsw-alias-state-error-primary');
  mid(hearts, nameX, p.y + PANEL_PAD + 27);
  dim(` ${st ? st.affectionName : ''}`,
    nameX + ctx2d.measureText(hearts).width + 4, p.y + PANEL_PAD + 27);

  // ── divider: header → growth ──
  const div1Y = p.y + PANEL_PAD + PANEL_HEAD_H + 2;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div1Y);
  ctx2d.lineTo(right, div1Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── growth block: label / bar with tier dots / next-level / token stats / feed CTA ──
  const gy = div1Y + 6;
  ctx2d.font = `10px ${font}`;
  dim('成长值', padL, gy + 6);
  const gNum = g ? `${fmtTokens(g.points)}${g.nextAt ? ` / ${fmtTokens(g.nextAt)}` : ''}` : '';
  ctx2d.globalAlpha = 0.55;
  ctx2d.fillStyle = label;
  mid(gNum, right - ctx2d.measureText(gNum).width, gy + 6);
  ctx2d.globalAlpha = 1;
  // Growth bar: deep slot + tier-colored fill + tier dots marking the 6
  // ladder rungs so the player sees the whole path, not just this level.
  const barY = gy + 14;
  const barW = p.w - PANEL_PAD * 2;
  ctx2d.fillStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.4;
  ctx2d.beginPath();
  ctx2d.roundRect(padL, barY, barW, 9, 4.5);
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  // Fill = progress inside the CURRENT level (level-local), so the bar is
  // honest at every rung of the 10-level ladder instead of asymptoting
  // toward a distant final threshold.
  const curAt = g && g.levels && g.levels[g.level - 1] ? g.levels[g.level - 1].at : 0;
  const frac = g && g.nextAt
    ? Math.min(1, Math.max(0, (g.points - curAt) / (g.nextAt - curAt))) : 1;
  ctx2d.fillStyle = lvlColor;
  ctx2d.beginPath();
  ctx2d.roundRect(padL, barY, Math.max(4, barW * frac), 9, 4.5);
  ctx2d.fill();
  // Tier dots: rungs at EQUAL spacing across the bar — with 10 levels the
  // thresholds span 0→200亿 and a true scale would crush the early rungs
  // into the left edge. Reached rungs are solid tier color, future rungs
  // are dim. The current rung gets a ring.
  if (g && g.levels) {
    const slots = Math.max(1, g.levels.length - 1);
    for (let i = 0; i < g.levels.length; i += 1) {
      const dotX = padL + (i / slots) * barW;
      const reached = g.points >= g.levels[i].at;
      const current = i === g.level - 1;
      ctx2d.beginPath();
      ctx2d.arc(dotX, barY + 4.5, current ? 3 : 2, 0, Math.PI * 2);
      if (current) {
        ctx2d.fillStyle = css('--dsw-alias-bg-layer-1');
        ctx2d.fill();
        ctx2d.strokeStyle = lvlColor;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.arc(dotX, barY + 4.5, 3, 0, Math.PI * 2);
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = reached ? lvlColor : css('--dsw-alias-border-l2');
        ctx2d.globalAlpha = reached ? 1 : 0.5;
        ctx2d.fill();
        ctx2d.globalAlpha = 1;
      }
    }
  }
  dim(g
    ? (g.nextAt
      ? `→ 再长 ${fmtTokens(g.nextAt - g.points)} 点升「${g.nextName}」`
      : `${g.levelName} · 已加满`)
    : '成长值读取中…', padL, gy + 34);
  // Token accounting: today's burn + cumulative fed, side by side.
  const todayUsed = g && Number.isFinite(g.todayUsed) ? fmtTokens(g.todayUsed) : '0';
  const fed = g ? fmtTokens(g.tokensFed) : '0';
  ctx2d.font = `10px ${font}`;
  const halfW = (p.w - PANEL_PAD * 2) / 2;
  ctx2d.fillStyle = css('--dsw-alias-state-business-primary');
  mid('⚡', padL, gy + 52);
  dim(`今日 ${todayUsed}`, padL + 13, gy + 52);
  ctx2d.fillStyle = lvlColor;
  mid('🍚', padL + halfW, gy + 52);
  dim(`已投喂 ${fed}`, padL + halfW + 13, gy + 52);
  // Feed CTA — game-style button: tier-colored gradient fill + border +
  // hover brighten. Disabled state greys out.
  const feedable = Boolean(g && g.nextFeed > 0);
  const feedLabel = feedable ? `投喂 +${fmtTokens(g.nextFeed)}` : '无算力可喂';
  const btnY = gy + PANEL_FEED_TOP;
  const btnH = PANEL_FEED_H;
  const btnX = padL;
  const btnW = p.w - PANEL_PAD * 2;
  const btnHover = p.feedHover && feedable;
  ctx2d.save();
  if (feedable) {
    ctx2d.globalAlpha = btnHover ? 0.28 : 0.18;
    ctx2d.fillStyle = lvlColor;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.fill();
    ctx2d.globalAlpha = btnHover ? 0.9 : 0.6;
    ctx2d.strokeStyle = lvlColor;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
    ctx2d.fillStyle = lvlColor;
  } else {
    ctx2d.globalAlpha = 0.08;
    ctx2d.fillStyle = css('--dsw-alias-border-l2');
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.fill();
    ctx2d.globalAlpha = 0.4;
    ctx2d.strokeStyle = css('--dsw-alias-border-l2');
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.stroke();
    ctx2d.globalAlpha = 0.5;
    ctx2d.fillStyle = label;
  }
  ctx2d.font = `600 11px ${font}`;
  mid(feedLabel, btnX + btnW / 2, btnY + btnH / 2, 'center');
  ctx2d.restore();

  // ── divider: growth → care stats ──
  const div2Y = gy + PANEL_GROWTH_H + 4;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div2Y);
  ctx2d.lineTo(right, div2Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── care stats: fixed columns — icon | label | bar | state text ──
  // Bar is a deep slot + colored fill (game HUD style), not a flat block.
  const sy = div2Y + 6;
  const STAT_LABEL_X = padL + 18;
  const STAT_BAR_X = padL + 50;
  const STAT_BAR_W = 70;
  const STAT_TEXT_X = STAT_BAR_X + STAT_BAR_W + 6;
  PANEL_STATS.forEach((row, i) => {
    const ry = sy + i * PANEL_STAT_H + PANEL_STAT_H / 2;
    ctx2d.font = `11px ${font}`;
    mid(row.icon, padL, ry);
    ctx2d.fillStyle = label;
    mid(row.label, STAT_LABEL_X, ry);
    // Deep slot
    ctx2d.fillStyle = css('--dsw-alias-border-l2');
    ctx2d.globalAlpha = 0.4;
    ctx2d.beginPath();
    ctx2d.roundRect(STAT_BAR_X, ry - 3, STAT_BAR_W, 6, 3);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    let frac2 = 0;
    let txt = '—';
    let fill = css('--dsw-alias-state-business-primary');
    if (row.id === 'satiety' && st) {
      frac2 = st.satiety / 100; txt = st.satietyLabel;
      fill = statFill(st.satiety, 20, 75, css);
    } else if (row.id === 'mood' && st) {
      frac2 = st.mood / 100; txt = st.moodLabel;
      fill = statFill(st.mood, 30, 80, css);
    } else if (row.id === 'affection' && st) {
      frac2 = st.affectionNext
        ? (st.affection - st.affectionBase) / (st.affectionNext - st.affectionBase) : 1;
      txt = `Lv${st.affectionLevel}`;
    }
    // Colored fill
    ctx2d.fillStyle = fill;
    ctx2d.beginPath();
    ctx2d.roundRect(STAT_BAR_X, ry - 3,
      Math.max(3, STAT_BAR_W * Math.max(0, Math.min(1, frac2))), 6, 3);
    ctx2d.fill();
    ctx2d.textAlign = 'left';
    dim(txt, STAT_TEXT_X, ry);
  });

  // ── divider: care stats → action grid ──
  const div3Y = sy + PANEL_STAT_H * 3 + 4;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div3Y);
  ctx2d.lineTo(right, div3Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── action chips: 2 × 3 grid — outlined cards with hover fill ──
  ctx2d.font = `11px ${font}`;
  p.cells.forEach((cell, i) => {
    const cx = padL + (i % 2) * (PANEL_CHIP_W + PANEL_CHIP_GAP);
    const cy = div3Y + 6 + Math.floor(i / 2) * (PANEL_CHIP_H + PANEL_CHIP_GAP);
    if (i === p.hover && cell.enabled !== false) {
      ctx2d.fillStyle = lvlColor;
      ctx2d.globalAlpha = 0.12;
      ctx2d.beginPath();
      ctx2d.roundRect(cx, cy, PANEL_CHIP_W, PANEL_CHIP_H, 7);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
    }
    ctx2d.globalAlpha = cell.enabled === false ? 0.38 : 1;
    ctx2d.strokeStyle = i === p.hover && cell.enabled !== false
      ? lvlColor : css('--dsw-alias-border-l2');
    ctx2d.lineWidth = i === p.hover && cell.enabled !== false ? 1.5 : 1;
    ctx2d.beginPath();
    ctx2d.roundRect(cx, cy, PANEL_CHIP_W, PANEL_CHIP_H, 7);
    ctx2d.stroke();
    ctx2d.fillStyle = label;
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'alphabetic';
    const inkW = (mm) => (Number.isFinite(mm.actualBoundingBoxLeft) && Number.isFinite(mm.actualBoundingBoxRight)
      ? mm.actualBoundingBoxLeft + mm.actualBoundingBoxRight : mm.width);
    const iw = inkW(ctx2d.measureText(cell.icon));
    const lw = inkW(ctx2d.measureText(cell.label));
    const left = cx + (PANEL_CHIP_W - iw - 4 - lw) / 2;
    mid(cell.icon, left + iw / 2, cy + PANEL_CHIP_H / 2, 'center');
    mid(cell.label, left + iw + 4 + lw / 2, cy + PANEL_CHIP_H / 2, 'center');
    ctx2d.globalAlpha = 1;
  });
  // ── explicit dismissal: a ✕ inside the header, revealed on hover ──
  // The card no longer dies when the pointer strays; this is the affordance
  // that closes it (alongside the right-click toggle and every action chip).
  // It sits in the header's own row, so it is part of the card rather than a
  // badge glued outside it, and it stays hidden until the pointer is over the
  // card so an idle card is not wearing a permanent button. Quiet while the
  // pointer is on the card; emphasized only when the hit box itself is hot.
  if (closeVisible || closeHover) {
    const cr = panelCloseRect();
    const cx = cr.x + cr.w / 2;
    const cy = cr.y + cr.h / 2;
    // Quiet state must stay readable on the white card. Theme layer-2 is the
    // same white as the card body, so a filled quiet chip vanishes; draw only
    // a light hairline + secondary glyph until the hit box itself is hot.
    ctx2d.beginPath();
    ctx2d.roundRect(cr.x, cr.y, cr.w, cr.h, 6);
    if (closeHover) {
      ctx2d.globalAlpha = 0.95;
      ctx2d.fillStyle = css('--dsw-alias-state-error-primary');
      ctx2d.fill();
      ctx2d.strokeStyle = css('--dsw-alias-state-error-primary');
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.strokeStyle = css('--dsw-alias-bg-layer-1');
    } else {
      ctx2d.globalAlpha = 1;
      ctx2d.strokeStyle = css('--dsw-alias-border-l2');
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.strokeStyle = css('--dsw-alias-label-secondary');
      ctx2d.globalAlpha = 0.85;
    }
    ctx2d.lineWidth = 1.5;
    ctx2d.lineCap = 'round';
    const arm = PANEL_CLOSE_SIZE * 0.19;
    ctx2d.beginPath();
    ctx2d.moveTo(cx - arm, cy - arm);
    ctx2d.lineTo(cx + arm, cy + arm);
    ctx2d.moveTo(cx + arm, cy - arm);
    ctx2d.lineTo(cx - arm, cy + arm);
    ctx2d.stroke();
    ctx2d.lineCap = 'butt';
    ctx2d.globalAlpha = 1;
  }
  ctx2d.restore();
  // Clear margin must cover every painted pixel: 1px hairline stroke +
  // antialiased corners + emoji ink that can exceed its advance box, plus the
  // in-header ✕ (kept inside the card box, so the existing pad is enough).
  return { x: p.x - PANEL_PAD_MARGIN, y: p.y - PANEL_PAD_MARGIN,
    w: p.w + PANEL_PAD_MARGIN * 2, h: p.h + PANEL_PAD_MARGIN * 2 };
}

// ── particles (Zzz / hearts / water spray / dizzy stars) ──
function spawn(type, x, y, vx, vy) {
  particles.push({
    type, x, y,
    vx: vx ?? rng(-0.15, 0.15),
    vy: vy ?? rng(-0.6, -0.3),
    born: performance.now(),
    life: type === 'zzz' ? 2400 : type === 'drop' ? 900 : 1400,
    seed: rng(0, Math.PI * 2),
  });
}

function drawParticles(now) {
  for (const p of particles) {
    const age = now - p.born;
    const k = age / p.life;
    if (k >= 1) { continue; }
    const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
    ctx2d.globalAlpha = Math.max(0, a);
    if (p.type === 'zzz') {
      ctx2d.fillStyle = '#8fb8e8';
      ctx2d.font = `bold ${Math.round(14 + k * 10)}px sans-serif`;
      ctx2d.fillText('Z', p.x + Math.sin(age / 300 + p.seed) * 6, p.y);
    } else if (p.type === 'heart') {
      ctx2d.font = `${Math.round(13 + k * 4)}px sans-serif`;
      ctx2d.fillText('💗', p.x, p.y);
    } else if (p.type === 'drop') {
      ctx2d.fillStyle = '#6db3f2';
      ctx2d.beginPath();
      ctx2d.ellipse(p.x, p.y, 3, 5, 0, 0, Math.PI * 2);
      ctx2d.fill();
    } else if (p.type === 'star') {
      ctx2d.fillStyle = '#ffd94d';
      ctx2d.font = '14px sans-serif';
      ctx2d.fillText('★', p.x + Math.sin(age / 120 + p.seed) * 18, p.y + Math.cos(age / 120 + p.seed) * 5);
    }
  }
  ctx2d.globalAlpha = 1;
}

function sleepEnter() {
  sleeping = true;
  idle.sleepy = 0;
  sleepEnter.until = performance.now() + 1200;
  setStill('sleep-enter');
}

function wake() {
  if (!sleeping) { return; }
  sleeping = false;
  playStill('wake', 1100);
  const now = performance.now();
  idle.lastInteract = now;
  idle.sleepy = 0;
  // startled awake, then mildly grumpy — she was napping
  idle.tapKind = 1;
  idle.tapUntil = now + TAP_REACTION_MS;
  say('wake');
}

// Anchor: still's alpha-bbox bottom-center sits on the live character's
// feet, scaled to her height — poses swap without the character jumping.
function drawStill(entry, alpha, t) {
  const b = entry.box;
  const ch = charRect ? (charRect.bottom - charRect.y) : petH();
  const s = ch / Math.max(1, b.bottom - b.y);
  const cx = drawPos.x + (charRect ? (charRect.x + charRect.right) / 2 : petW() / 2);
  const feetY = drawPos.y + (charRect ? charRect.bottom : petH());
  const dw = (b.right - b.x) * s;
  const dh = (b.bottom - b.y) * s;
  const breathe = 1 + Math.sin(t * 1.8) * 0.008 * stillCtl.sway;
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  const hanging = STILL_ANCHOR[stillCtl.name] === 'hang' && (dragging || thrown);
  if (hanging) {
    // Hold point: grips the top of the art; swings pivot there. The point
    // trails the cursor through the spring while carried, and flies
    // ballistically once thrown.
    const a = physPoint || { x: pointer.x, y: pointer.y + 12 };
    ctx2d.translate(a.x + fx.dx, a.y + fx.dy);
  } else {
    ctx2d.translate(cx + fx.dx, feetY + fx.dy);
  }
  ctx2d.rotate(fx.rot);
  ctx2d.scale(fx.sx, fx.sy * breathe);
  // Horizontal strips get a tiny sine offset — planted poses sway at the
  // top with feet pinned; hanging poses pin the grab and swing the feet.
  const strips = 12;
  const sh = (b.bottom - b.y) / strips;
  const yBase = hanging ? 0 : -dh;
  for (let i = 0; i < strips; i += 1) {
    const amp = hanging ? (i / strips) : (1 - i / strips);
    const sway = Math.sin(t * 2.4 + i * 0.7) * 1.5 * amp * stillCtl.sway;
    ctx2d.drawImage(entry.img, b.x, b.y + i * sh, b.right - b.x, sh,
      -dw / 2 + sway, yBase + i * sh * s, dw, sh * s);
  }
  ctx2d.restore();
}

// Canvas-drawn token crystal — a glowing compute-credit treat she eats
// when the user feeds her real token usage.
function drawToken(x, y, alpha) {
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  ctx2d.translate(x, y);
  ctx2d.shadowColor = 'rgba(94, 210, 255, 0.9)';
  ctx2d.shadowBlur = 14;
  ctx2d.fillStyle = '#8fdcff';
  ctx2d.beginPath();
  ctx2d.moveTo(0, -18);
  ctx2d.lineTo(12, -4);
  ctx2d.lineTo(0, 17);
  ctx2d.lineTo(-12, -4);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.shadowBlur = 0;
  ctx2d.fillStyle = '#eaf8ff';
  ctx2d.beginPath();
  ctx2d.moveTo(0, -18);
  ctx2d.lineTo(5, -4);
  ctx2d.lineTo(0, 17);
  ctx2d.lineTo(-5, -4);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.restore();
}

// Canvas-drawn rice bowl — she's a 大胃王 whose canon food is 白米饭.
function drawBowl(x, y, alpha) {
  ctx2d.save();
  ctx2d.globalAlpha = alpha;
  ctx2d.translate(x, y);
  ctx2d.fillStyle = '#f2f6fb';
  ctx2d.beginPath();
  ctx2d.ellipse(0, -14, 16, 9, 0, 0, Math.PI * 2); // rice mound
  ctx2d.fill();
  ctx2d.fillStyle = '#dfe8f2';
  ctx2d.beginPath();
  ctx2d.moveTo(-18, -8);
  ctx2d.quadraticCurveTo(0, 16, 18, -8);
  ctx2d.closePath();
  ctx2d.fill();
  ctx2d.strokeStyle = '#7d94b3';
  ctx2d.lineWidth = 1.5;
  ctx2d.stroke();
  ctx2d.restore();
}

// Physics tick: while carried, her hang point springs after the cursor
// (overdamped ζ≈1.06 — trails fast drags without overshoot); once thrown she
// flies ballistically, bounces off the screen edges, and friction settles
// her on the floor where the live model lands.
// Rig entries have no still ink box — synthesize one from the manifest's
// char bbox for the code paths that scale e.box to display size.
function rigCharBox() {
  if (!rig.ready || !rig.mf || !rig.mf.char_bbox) {
    return null;
  }
  const cb = rig.mf.char_bbox;
  return { x: cb[0], y: cb[1], right: cb[2], bottom: cb[3] };
}

// Live-mode entries draw the whole crop — its box is just the crop rect.
function liveCharBox() {
  return session ? { x: 0, y: 0, right: CROP.w, bottom: CROP.h } : null;
}

function tickPhysics(now) {
  const dt = physLastT ? Math.min((now - physLastT) / 1000, 0.05) : 0;
  physLastT = now;
  if (!dt || !physPoint) {
    return;
  }
  if (dragging && dragMoved) {
    // Pinned to the cursor — the spring-follow read as laggy. physVel still
    // reports real velocity so the dangle tilt and release-throw work.
    physVel.x = (pointer.x - physPoint.x) / dt;
    physVel.y = (pointer.y + 12 - physPoint.y) / dt;
    physPoint.x = pointer.x;
    physPoint.y = pointer.y + 12;
    requestFrame();
  } else if (thrown) {
    const e = stillCtl.entry;
    if (!e) {
      landFromPhys(now, true);
      return;
    }
    // Rig entries carry no still ink box — the assembled character's
    // master-space bbox plays the same role (s scales it to display).
    const b = e.box || rigCharBox() || liveCharBox();
    if (!b) {
      landFromPhys(now, true);
      return;
    }
    const ch = charRect ? charRect.bottom - charRect.y : petH();
    const s = ch / Math.max(1, b.bottom - b.y);
    const w = (b.right - b.x) * s;
    const h = (b.bottom - b.y) * s;
    const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const floor = host.y + host.height - h;
    const r = PetPhysics.throwStep(physPoint.x, physPoint.y, physVel.x, physVel.y, dt,
      host.x + w / 2, host.y, host.x + host.width - w / 2, floor);
    physPoint = { x: r.px, y: r.py };
    physVel = { x: r.vx, y: r.vy };
    if (PetPhysics.isAtRest(r.py, r.vx, r.vy, floor, r.bounced, Math.hypot(r.vx, r.vy))) {
      landFromPhys(now, true);
    }
    requestFrame();
  }
}

// Per-frame driver: cross-fade, sprite physics (dangle/squash/hops/tumble),
// particles, and the action FSM — feed, come-here, timed stills, sleep.
function tickStill(now) {
  const dt = 0.05;
  // Rig states redraw the character in different shapes at the same anchor
  // (sleep rotates her horizontal, pick-up jumps to the cursor). A state
  // change leaves the old pose's ink outside the new draw box — force the
  // next paint's full-canvas sweep so it can't linger.
  if (stillCtl.name !== tickStill._rigName) {
    tickStill._rigName = stillCtl.name;
    lastFullClear = 0;
  }
  stillCtl.alpha += (stillCtl.target - stillCtl.alpha) * Math.min(dt * STILL_FADE, 1);
  if (stillCtl.target === 0 && stillCtl.alpha < 0.005) {
    stillCtl.alpha = 0;
    stillCtl.name = null;
    stillCtl.entry = null;
  }
  fx.dx = 0;
  fx.dy = 0;
  fx.rot = 0;
  fx.sx = 1;
  fx.sy = 1;
  if ((dragging && dragMoved || thrown) && stillCtl.alpha > 0.5) {
    // Carried or airborne: she dangles — tilt with real velocity, bigger sway.
    stillCtl.sway = thrown ? 0.6 : 1.6;
    fx.rot = Math.max(-0.2, Math.min(0.2, physVel.x * 0.0004));
    fx.dy = -6; // lifted slightly off her feet line
  } else {
    stillCtl.sway += (0.6 - stillCtl.sway) * Math.min(dt * 3, 1);
  }
  // Landing squash: brief flatten → overshoot → settle after a drop.
  const landP = (now - landT) / 500;
  if (landP >= 0 && landP < 1) {
    const q = Math.sin(landP * Math.PI);
    fx.sy *= 1 - 0.18 * q;
    fx.sx *= 1 + 0.14 * q;
  }
  // Throw tumble: spins briefly after a fast release; dizzy stars fire when
  // she actually lands (landFromPhys), not mid-flight.
  const throwP = (now - throwT) / 900;
  if (throwP >= 0 && throwP < 1) {
    fx.rot += Math.sin(throwP * Math.PI * 2) * 0.3 * (1 - throwP);
  }
  // Timed still playback end → fade back to live.
  if (action && now > action.until) {
    action = null;
    if (!feed && !come && !sleeping) {
      clearStill();
    }
    if (pendingLevelUp && !feed && !come && !sleeping) {
      pendingLevelUp = false;
      celebrateLevelUp();
    }
  }
  // Let drowsiness show before the four-minute nap. A renewed interaction
  // cancels this transition; it never competes with a timed reaction.
  const idleFor = now - idle.lastInteract;
  if (stillCtl.name === 'doze' && (idleFor < 225000 || dragging || feed || come || panel)) {
    clearStill();
  }
  if (!sleeping && !dragging && !feed && !come && !action && !panel
      && stillCtl.target === 0 && idleFor > 225000 && idleFor <= 240000) {
    setStill('doze');
  }
  // Sleep: 4 min idle → she naps (sleep still + Zzz). Any cursor contact
  // or poke wakes her — startled, then grumpy (傲娇: naps are sacred).
  if (!sleeping && !dragging && !feed && !come && !action
      && (stillCtl.target === 0 || stillCtl.name === 'doze')
      && !panel && idleFor > 240000) {
    sleepEnter();
    say('sleep');
  }
  if (sleeping) {
    if (stillCtl.name === 'sleep-enter' && now >= sleepEnter.until) {
      setStill('sleep');
    }
    if (!tickStill._nextZzz || now > tickStill._nextZzz) {
      tickStill._nextZzz = now + rng(1400, 2200);
      // Sleep lies her down with the head left of the feet anchor —
      // the Zzz must rise from where her head actually is.
      const zzx = (session || rig.ready) && stillCtl.name === 'sleep'
        ? drawPos.x + petW() * 0.08
        : drawPos.x + petW() * 0.62;
      const zzy = (session || rig.ready) && stillCtl.name === 'sleep'
        ? drawPos.y + petH() * 0.42
        : drawPos.y + petH() * 0.18;
      spawn('zzz', zzx, zzy);
    }
    if (overPet(pointer.x, pointer.y)) {
      wake();
    }
  }
  // Come-here: run still + hops toward the pointer's x.
  if (come) {
    const dist = come.targetX - drawPos.x;
    if (Math.abs(dist) > 8) {
      drawPos.x += dist * Math.min(dt * 5, 1);
      fx.dy = -Math.abs(Math.sin(now / 90)) * 10;
      clampDrawPos();
    } else {
      come = null;
      clearStill();
      idle.tapUntil = now + TAP_REACTION_MS;
      idle.tapKind = 0;
      idle.lastInteract = now;
      say('arrive');
    }
  }
  // Feed sequence: bowl drops → she runs over (running still + hops) →
  // eats (eat still) → fades back to live with a happy reaction.
  if (feed) {
    const t = (now - feed.t0) / 1000;
    if (feed.phase === 'drop') {
      const p = Math.min(t / 0.4, 1);
      feed.bowlY = feed.groundY - (1 - p * p) * 260;
      if (p >= 1) {
        feed.phase = 'run';
        feed.t0 = now;
        feed.startX = drawPos.x;
        setStill('running');
        say(feed.kind === 'token' ? 'feedToken' : 'feed');
      }
    } else if (feed.phase === 'run') {
      const target = feed.bowlX - petW() / 2;
      const dist = target - drawPos.x;
      if (Math.abs(dist) > 8) {
        drawPos.x += dist * Math.min(dt * 5, 1);
        fx.dy = -Math.abs(Math.sin(now / 90)) * 10; // run hops
        clampDrawPos();
      } else {
        feed.phase = 'notice';
        feed.t0 = now;
        setStill('food-notice');
        say(feed.kind === 'token' ? 'feedTokenEat' : 'feedEat');
      }
    } else if (feed.phase === 'notice') {
      if (t > 0.5) {
        feed.phase = 'eat';
        feed.t0 = now;
        setStill('eat');
      }
    } else if (feed.phase === 'eat') {
      if (t > 1.5) {
        feed.phase = 'chew';
        feed.t0 = now;
        setStill('chew');
      }
    } else if (feed.phase === 'chew') {
      if (t > 0.8) {
        feed.phase = 'full';
        feed.t0 = now;
        setStill('full');
      }
    } else if (feed.phase === 'full') {
      if (t > 0.6) {
        const kind = feed.kind;
        feed = null;
        clearStill();
        idle.tapUntil = now + TAP_REACTION_MS;
        idle.tapKind = 0; // happy ^^
        idle.lastInteract = now;
        if (pendingLevelUp) {
          pendingLevelUp = false;
          celebrateLevelUp();
        } else {
          say(kind === 'token' ? 'feedTokenDone' : 'feedDone');
        }
      }
    }
  }
  // Autonomous wandering (§B4): bounded target legs with eased glides. The
  // character repaints at the new drawPos — the OS window never moves, and
  // the roam rect rides to the main process so hover/click-through hit
  // testing follows her (transient, never persisted). Any busy state
  // cancels the current leg.
  if (wander.glide) {
    if (wanderSuppressed()) {
      wander.glide = null;
      if (stillCtl.name === 'swim') { clearStill(); }
      scheduleWander();
      say('wanderStop', undefined, undefined, 0);
    } else {
      const g = PetWander.glidePos(wander.glide, (now - wander.t0) / 1000);
      drawPos.x = g.x;
      drawPos.y = g.y;
      if (g.dir) { facing = g.dir; }
      if (g.done) {
        wander.glide = null;
        if (stillCtl.name === 'swim') { clearStill(); }
        scheduleWander();
        if (Math.random() < 0.35) { say('wanderEnd', undefined, undefined, 0); }
      }
    }
  }
  // Idle flourish: every ~30-60s she does a little something on her own —
  // starry eyes, a celebrate hop, or a moody tail flick. Power-save mode
  // suspends both flourish and wander while she's idle (§B10).
  const idleEnough = stillCtl.target === 0 && !action && !feed && !come && !sleeping && !dragging;
  if (idleEnough && !powerSaving(now)) {
    if (!tickStill._nextFlourish) {
      tickStill._nextFlourish = now + rng(25000, 45000);
    }
    if (now > tickStill._nextFlourish) {
      tickStill._nextFlourish = now + rng(25000, 45000);
      const pool = ['star', 'twirl', 'look', 'wave', 'happy-tail'];
      if (stats && stats.affectionLevel >= 3) { pool.push('shy'); }
      if (stats && stats.mood < 35) { pool.push('sad'); }
      playStill(pool[Math.floor(Math.random() * pool.length)], 1600);
    }
    // Wander pick: next leg fires on the activity-tier schedule.
    if (!wander.nextAt) { scheduleWander(); }
    if (!wander.glide && now > wander.nextAt && settings.wander
        && !panel) {
      const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
      const target = PetWander.pickTarget({
        x: drawPos.x, y: drawPos.y, w: petW(), h: petH(),
        bounds: host, facing, scale: settings.scale,
      });
      if (Math.abs(target.x - drawPos.x) > 2 || Math.abs(target.y - drawPos.y) > 2) {
        wander.glide = PetWander.makeGlide(
          drawPos, target, PetWander.speedFor(settings.activity, settings.scale));
        wander.t0 = now;
        setStill('swim');
        if (Math.random() < 0.4) { say('wanderStart', undefined, undefined, 0); }
      } else {
        scheduleWander();
      }
    }
    // Idle chatter on the activity tier's randomized interval (§B3).
    // Priority 0: any visible/held bubble or an open overlay makes her
    // wait for the next slot — chatter never crowds a reaction or an
    // alert, and she never talks in her sleep.
    if (!tickStill._nextChat) {
      const t = activityPair('talk');
      tickStill._nextChat = now + Math.min(rng(t[0], t[1]), 90000);
    }
    if (now > tickStill._nextChat) {
      const t = activityPair('talk');
      tickStill._nextChat = now + rng(t[0], t[1]);
      if (settings.selfTalk && !bubble && now >= bubbleHoldUntil
          && !wander.glide && !panel
          && !action && stillCtl.target === 0) {
        const bias = PERSONA_BIAS[settings.personality] || {};
        if (idle.sleepy > 0.5 && Math.random() < 0.4) {
          // drowsy mumble instead
          say('sleepy', undefined, undefined, 0);
        } else if (stats && stats.satiety < 20 && Math.random() < 0.55) {
          // An empty stomach overrides small talk.
          say('hungry', undefined, undefined, 0);
        } else if (stats && stats.affectionLevel >= 4
            && Math.random() < 0.25 + (bias.clingy || 0)) {
          // 信赖+ — she gets openly attached.
          say('clingy', undefined, undefined, 0);
        } else {
          const cat = PetDialogue.categoryForHour(new Date().getHours(), dialogueStore.timeOfDay) || 'idle';
          say(Math.random() < 0.45 ? cat
            : IDLE_TOPICS[Math.floor(Math.random() * IDLE_TOPICS.length)],
          undefined, undefined, 0);
        }
      }
    }
  }
  if (bubble && now > bubble.until) {
    bubble = dequeueBubble(now);
  }
  // Particle lifecycle.
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    if (now - p.born > p.life) {
      particles.splice(i, 1);
      continue;
    }
    p.x += p.vx;
    p.y += p.vy;
    if (p.type === 'drop') { p.vy += 0.08; }
    if (p.type === 'zzz') { p.vx += 0.004; }
  }
  if (stillCtl.alpha > 0.01 || feed || lastFeedRect || come || sleeping
      || particles.length || lastParticleRect
      || bubble || lastBubbleRect || panel || lastPanelRect
      || landP < 1 || throwP < 1 || wander.glide) {
    requestFrame();
  }
}

// Dirty-rect paint: clearing the whole canvas every frame forces the
// compositor to re-upload the entire layered surface — that full-surface
// churn IS the visible flicker. Only the character's alpha box ever
// changes, so repaint just that.
let lastPaintRect = null;
let lastFeedRect = null;
let lastParticleRect = null;
let lastBubbleRect = null;
let lastPanelRect = null;
let lastRigRect = null;
let lastFullClear = 0;
let renderLoopActive = false;
let paintRequested = false;

// ── presentation scheduler ──
// Producers (inference completion, event handlers, settings pushes) mark the
// scene dirty instead of compositing it themselves. ONE owner decides when a
// presentation actually happens, so a presentation ceiling cannot be
// bypassed by a producer calling the painter directly — the exact defect
// that let the pet composite 87 times a second under a 15 ms budget.
function invalidate() {
  paintRequested = true;
  petPerf.bump('invalidate');
}

// Presentation budgets are diagnostics first: `null` means "use the shipped
// default". They are never persisted — a restart always returns to product
// behavior. The measurement script overrides them for one window and the
// script's `finally` restores them.
let presentCeilingOverride = null;   // presentations/second
let inferCeilingOverride = null;     // inference STARTS/second
let srEnabledOverride = null;        // boolean
function presentCeilingMs(now) {
  if (presentCeilingOverride !== null && presentCeilingOverride > 0) {
    return 1000 / presentCeilingOverride;
  }
  // Animation follows every display refresh. Only a deliberately applied
  // diagnostic override adds a presentation ceiling; power saving paces
  // inference without lowering animation quality.
  return 0;
}

// Inference START budget. At most one run is ever in flight; a skipped slot
// is dropped rather than queued, so a slow backend stays responsive instead
// of accumulating a backlog of catch-up frames.
function inferenceGapMs(now) {
  if (powerSaving(now)) { return 110; }
  if (inferCeilingOverride !== null && inferCeilingOverride > 0) {
    return 1000 / inferCeilingOverride;
  }
  return 50;
}

// Diagnostic overrides for one measurement window. Never persisted; the
// caller restores them in a `finally`. Returns the applied values so the
// caller can prove restoration happened.
function __setPerfOverrides({ presentPerSecond, inferPerSecond, superResolution } = {}) {
  presentCeilingOverride = Number.isFinite(presentPerSecond) && presentPerSecond > 0
    ? presentPerSecond : null;
  inferCeilingOverride = Number.isFinite(inferPerSecond) && inferPerSecond > 0
    ? inferPerSecond : null;
  srEnabledOverride = typeof superResolution === 'boolean' ? superResolution : null;
  return {
    presentPerSecond: presentCeilingOverride,
    inferPerSecond: inferCeilingOverride,
    superResolution: srEnabledOverride,
    srReady,
  };
}

// ONE pending presentation, at most. `requestFrame()` is the only public way
// to ask for a paint; it never composites inline, so a burst of producers
// collapses into a single presentation on the next opportunity.
let presentScheduled = false;
function requestFrame() {
  invalidate();
  if (renderLoopActive || presentScheduled) { return; }
  presentScheduled = true;
  const run = (now) => {
    presentScheduled = false;
    // Once mounted, the display loop owns the commit after state ticking.
    if (renderLoopActive) { return; }
    maybePresent(Number.isFinite(now) ? now : performance.now());
    if (paintRequested) { requestFrame(); }
  };
  if (typeof requestAnimationFrame === 'function') { requestAnimationFrame(run); }
  else { setTimeout(run, 16); }
}

// The single presentation gate. `now` is the rAF timestamp when available.
let lastPresentAt = -Infinity;
let presentSuppressed = 0;
function maybePresent(now) {
  if (!paintRequested) { return; }
  const gap = presentCeilingMs(now);
  if (now - lastPresentAt < gap) {
    // Too soon: remember that it is due so the rAF loop presents it as soon
    // as the budget allows, instead of dropping the request.
    presentSuppressed += 1;
    petPerf.bump('presentSuppressed');
    return;
  }
  lastPresentAt = now;
  paintRequested = false;
  paintFrame();
}

function paintFrame() {
  const perfStart = petPerf.enabled ? performance.now() : 0;
  const liveAlpha = (session || rig.ready) ? 1 : 1 - stillCtl.alpha;
  if (!painted && liveAlpha <= 0.01) {
    return;
  }
  // Self-healing sweep: every ~1.5s clear the WHOLE surface once. Dirty
  // rects track each painter's ink, but any pixel that slips outside its
  // tracked rect (shadow bleed, emoji overshoot, transform slips) would
  // otherwise stay on this layered window forever — the sweep bounds every
  // leak's lifetime to ~1.5s regardless of which painter missed.
  const nowMs = performance.now();
  // Rig path: always full-clear. Dirty rects leaked ghosts whenever ink
  // escaped a tracked rect (fast throws, pose swaps, half-faded tails) —
  // on a transparent layered window each miss persisted as a splice mark.
  // One clearRect is ~free at this canvas size and makes ghosts impossible.
  if (rig.ready || nowMs - lastFullClear > 1500) {
    lastFullClear = nowMs;
    const clearStart = petPerf.enabled ? performance.now() : 0;
    ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
    petPerf.bump('fullSurfaceClear');
    if (petPerf.enabled) { petPerf.record('fullClear', performance.now() - clearStart); }
  }
  // Clear the full draw region, not the measured alpha box: body morphing
  // can push pixels (tail, hair) past the box measured on an early frame,
  // and anything painted outside the cleared rect smears across the screen.
  const rect = {
    x: Math.floor(drawPos.x) - 24,
    y: Math.floor(drawPos.y) - 24,
    w: petW() + 48,
    h: petH() + 48,
  };
  // A hanging still is drawn at the cursor, which can sit far from drawPos
  // — union its real rect into the clear region or it smears.
  if (stillCtl.entry && stillCtl.alpha > 0.01) {
    const sb = stillDrawRect();
    const ux = Math.min(rect.x, Math.floor(sb.x) - 4);
    const uy = Math.min(rect.y, Math.floor(sb.y) - 4);
    rect.w = Math.max(rect.x + rect.w, Math.ceil(sb.right) + 4) - ux;
    rect.h = Math.max(rect.y + rect.h, Math.ceil(sb.bottom) + 4) - uy;
    rect.x = ux;
    rect.y = uy;
  }
  // Rig states can reshape the drawn box between frames (sleep swaps the
  // upright box for a horizontal one, pick-up jumps to the cursor) — the
  // PREVIOUS state's ink sits outside the new rect, so union the last
  // state box into the clear region or the old pose smears.
  if (rig.ready && lastRigRect) {
    const ux = Math.min(rect.x, lastRigRect.x);
    const uy = Math.min(rect.y, lastRigRect.y);
    rect.w = Math.max(rect.x + rect.w, lastRigRect.right) - ux;
    rect.h = Math.max(rect.y + rect.h, lastRigRect.bottom) - uy;
    rect.x = ux;
    rect.y = uy;
  }
  // ALL clears first, then all draws — a clear after a draw erases part of
  // the character (the spray band once cut her in half).
  if (lastPaintRect) {
    ctx2d.clearRect(lastPaintRect.x, lastPaintRect.y, lastPaintRect.w, lastPaintRect.h);
  }
  if (lastFeedRect) {
    ctx2d.clearRect(lastFeedRect.x, lastFeedRect.y, lastFeedRect.w, lastFeedRect.h);
    lastFeedRect = null;
  }
  if (lastParticleRect) {
    ctx2d.clearRect(lastParticleRect.x, lastParticleRect.y, lastParticleRect.w, lastParticleRect.h);
    lastParticleRect = null;
  }
  if (lastBubbleRect) {
    ctx2d.clearRect(lastBubbleRect.x, lastBubbleRect.y, lastBubbleRect.w, lastBubbleRect.h);
    lastBubbleRect = null;
  }
  if (lastPanelRect) {
    ctx2d.clearRect(lastPanelRect.x, lastPanelRect.y, lastPanelRect.w, lastPanelRect.h);
    lastPanelRect = null;
  }
  ctx2d.clearRect(rect.x, rect.y, rect.w, rect.h);
  // The falling bowl lives outside the pet rect — it needs its own cleared
  // column spanning the whole drop path, or each frame's bowl smears down
  // the screen into a capsule-shaped streak.
  if (feed) {
    const fr = {
      x: Math.floor(feed.bowlX) - 32,
      y: Math.floor(feed.groundY) - 300,
      w: 64,
      h: 340,
    };
    ctx2d.clearRect(fr.x, fr.y, fr.w, fr.h);
    lastFeedRect = fr;
  }
  // Particles roam beyond the pet rect — same rule: their union rect must
  // be cleared up front or they streak.
  if (particles.length) {
    let px0 = 1e9; let py0 = 1e9; let px1 = -1e9; let py1 = -1e9;
    for (const p of particles) {
      if (p.x < px0) { px0 = p.x; }
      if (p.x > px1) { px1 = p.x; }
      if (p.y < py0) { py0 = p.y; }
      if (p.y > py1) { py1 = p.y; }
    }
    // Stars sway 18px then draw a 14px glyph to its right; include that
    // entire ink and antialiasing, not just the particle's nominal center.
    lastParticleRect = {
      x: Math.floor(px0) - 36, y: Math.floor(py0) - 36,
      w: Math.ceil(px1 - px0) + 72, h: Math.ceil(py1 - py0) + 72,
    };
    ctx2d.clearRect(lastParticleRect.x, lastParticleRect.y, lastParticleRect.w, lastParticleRect.h);
  }
  if (feed) {
    (feed.kind === 'token' ? drawToken : drawBowl)(feed.bowlX, feed.bowlY, 1);
  }
  if (session) {
    // Live path: every state rides the THA4 frame — face deforms for real,
    // poses are whole-frame transforms, and there is no seam to show.
    if (painted) {
      drawLive();
    }
  } else if (rig.ready) {
    drawRig();
  } else {
    if (painted && liveAlpha > 0.01) {
      const opacity = Math.max(0.3, Math.min(1, settings.opacity || 1));
      ctx2d.globalAlpha = liveAlpha * opacity;
      if (facing < 0) {
        // Wander facing: mirror her about the draw rect's own center.
        ctx2d.save();
        ctx2d.translate(drawPos.x + petW(), drawPos.y);
        ctx2d.scale(-1, 1);
        ctx2d.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, petW(), petH());
        ctx2d.restore();
      } else {
        ctx2d.drawImage(outCanvas, CROP.x, CROP.y, CROP.w, CROP.h, drawPos.x, drawPos.y, petW(), petH());
      }
      ctx2d.globalAlpha = 1;
    }
    if (stillCtl.entry && stillCtl.entry.img && stillCtl.alpha > 0.01) {
      drawStill(stillCtl.entry, stillCtl.alpha * Math.max(0.3, Math.min(1, settings.opacity || 1)),
        performance.now() / 1000);
    }
  }
  if (particles.length) {
    drawParticles(performance.now());
  }
  lastBubbleRect = drawBubble(performance.now()) || null;
  // The card rides a cached raster — one clearRect + one drawImage per frame
  // instead of ~270 lines of text metrics and gradient fills.
  lastPanelRect = blitPanel() || null;
  lastPaintRect = rect;
  lastRigRect = rig.ready && stillCtl.entry && stillCtl.alpha > 0.01
    ? stillDrawRect()
    : null;
  reportSurfaceRegions();
  if (petPerf.enabled) { petPerf.record('paint', performance.now() - perfStart); }
}

let poseCpuTensor = null; // reused pose input on the non-graph-capture path —
                          // a fresh ort.Tensor per frame leaked WASM memory.

async function renderFrame() {
  if (inferBusy || !session) {
    if (inferBusy) { petPerf.record('inferenceBusy', 0); }
    return;
  }
  inferBusy = true;
  petPerf.bump('inferenceStart');
  const perfStart = petPerf.enabled ? performance.now() : 0;
  // Hoisted so `finally` can release the output tensors on EVERY exit path —
  // including a rejected run() or a readback that throws. Disposing only after
  // a successful readback leaked a full frame of wasm/webgpu memory each time
  // the backend hiccuped.
  let results = null;
  try {
    if (sessionOnGpu) {
      ort.env.webgpu.device.queue.writeBuffer(poseGpuBuffer, 0, pose);
      results = await session.run({ image: imageTensor, pose: poseTensor });
    } else {
      if (!poseCpuTensor) {
        poseCpuTensor = new ort.Tensor('float32', new Float32Array(45), [1, 45]);
      }
      poseCpuTensor.data.set(pose);
      results = await session.run({ image: imageTensor, pose: poseCpuTensor });
    }
    const runMs = performance.now() - perfStart;
    petPerf.bump('frameProduced');
    if (petPerf.enabled) { petPerf.record('sessionRun', runMs); }
    const out = results.rgba_f || results.rgba;
    const readStart = petPerf.enabled ? performance.now() : 0;
    await copyOutputPixels(out);
    if (petPerf.enabled) { petPerf.record('readbackConvert', performance.now() - readStart); }
    const px = outImage.data;
    let alphaMax = 0;
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] > alphaMax) alphaMax = px[i];
    }
    // Skip a fully-transparent frame (a bad readback would blank her out for
    // a frame, which reads as flicker); keep the previous frame instead.
    if (alphaMax < 4) {
      petPerf.bump('frameRejected');
      return;
    }
    // Re-measure the silhouette box every ~4s of rendered frames: the
    // hit area must track where she actually IS, not where the warmup
    // frame put her — a stale box leaves dead spots on her body.
    charRectFrames = (charRectFrames || 0) + 1;
    if (!charRect || charRectFrames % 240 === 0) {
      charRect = measureCharRect() || charRect;
    }
    outCtx.putImageData(outImage, 0, 0);
    srFrame();
    painted = true;
    // The rAF loop composites; a second paint here would double the frame.
    requestFrame();
  } catch (error) {
    console.warn('pet: inference failed', error);
    // Opt-in only: lets the CDP measurement tell a working live pet from one
    // that is merely ticking without producing frames.
    petPerf.bump('inferenceError');
  } finally {
    if (results) {
      // An output can be referenced under multiple names. Release each
      // tensor exactly once, including failures before conversion completes.
      for (const output of new Set(Object.values(results))) {
        try { output?.dispose?.(); }
        catch (error) { console.warn('pet: output release failed', error); }
      }
    }
    inferBusy = false;
    // End-to-end frame production: run + readback + conversion + SR. Renamed
    // from the misleading `inference`, which also wrapped a presentation.
    if (petPerf.enabled) { petPerf.record('frameProduction', performance.now() - perfStart); }
  }
}

let canvasDensityQuery = null;
function resizeCanvas() {
  // Backing pixels follow display density; all geometry stays in CSS pixels.
  // Re-arm the query because a DPI-only display move need not resize the page.
  const density = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * density);
  canvas.height = Math.round(window.innerHeight * density);
  ctx2d.setTransform(density, 0, 0, density, 0, 0);
  canvasDensityQuery?.removeEventListener('change', resizeCanvas);
  canvasDensityQuery = window.matchMedia(`(resolution: ${density}dppx)`);
  canvasDensityQuery.addEventListener('change', resizeCanvas);
  lastPaintRect = null;
  lastFeedRect = null;
  lastParticleRect = null;
  lastBubbleRect = null;
  lastPanelRect = null;
  ctx2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
  requestFrame();
}

// ── click-through + drag ──
let surfaceRegionKey = '';

// Logical interactive islands in SCREEN coordinates: her body plus every card
// surface (status card, chat card, model picker, pinned bubble). The main
// process merges these into its own cursor hold, so stepping off her body onto
// the card — or back — never depends on a renderer round trip. That round trip
// is exactly what used to drop interactivity while the renderer was busy.
function interactiveHitRects() {
  const rects = [petBodyBounds()];
  for (const r of [panel, chatRect, chatPickerRect,
    bubble && bubble.pinned ? lastBubbleRect : null]) {
    if (r) { rects.push({ x: r.x, y: r.y, right: r.x + r.w, bottom: r.y + r.h }); }
  }
  const ox = overlayOrigin ? overlayOrigin.x : 0;
  const oy = overlayOrigin ? overlayOrigin.y : 0;
  return rects.map((r) => ({
    x: Math.floor(r.x + ox),
    y: Math.floor(r.y + oy),
    width: Math.ceil(r.right + ox) - Math.floor(r.x + ox),
    height: Math.ceil(r.bottom + oy) - Math.floor(r.y + oy),
  }));
}

function reportSurfaceRegions() {
  // Preserve the existing menu elevation outside its border box as well.
  const pickerInk = chatPickerRect && { x: chatPickerRect.x - 24, y: chatPickerRect.y - 24,
    w: chatPickerRect.w + 48, h: chatPickerRect.h + 56 };
  const regions = [lastPaintRect, lastFeedRect, lastParticleRect, lastBubbleRect,
    lastPanelRect, chatRect, pickerInk].filter(Boolean).map((r) => {
    const x = Math.floor(r.x);
    const y = Math.floor(r.y);
    return { x, y, width: Math.ceil(r.x + r.w) - x, height: Math.ceil(r.y + r.h) - y };
  });
  const hitRegions = interactiveHitRects();
  const key = JSON.stringify([regions, hitRegions]);
  if (key === surfaceRegionKey) { return; }
  surfaceRegionKey = key;
  void Promise.resolve(petShell.setInteractive?.({ regions, hitRegions })).catch(() => {
    if (surfaceRegionKey === key) { surfaceRegionKey = ''; }
  });
}

function setInteractive(next) {
  if (next === interactive) {
    return;
  }
  interactive = next;
  console.log('pet: interactive →', next);
  void Promise.resolve(petShell.setInteractive?.({ interactive: next }))
    .catch((e) => console.warn('pet: setInteractive rejected', e && e.message));
}

// Where the active still is drawn, in window coords. The rect must cover
// the POST-transform pixels: drawStill rotates by fx.rot about the pivot
// and offsets each strip by sway, so the clear region is the rotated
// bounding box — not the upright alpha box, or tips smear while dragged.
function stillDrawRect() {
  const e = stillCtl.entry;
  if (!e) {
    return null;
  }
  if (session || rig.ready) {
    // Live/rig geometry: every state pivots the frame about an anchor —
    // feet on the ground line, or GRAB at the physics point while carried.
    // The ink always lands inside the disc of radius ~char-height around
    // the anchor, so the clear box is that disc's bounding square (a bit
    // over-large is free — it only clears transparent canvas).
    const h = session ? petH() : (rig.mf.char_bbox[3] - rig.mf.char_bbox[1]) * rigScale();
    const hanging = stillCtl.name === 'pick-up' && (dragging || thrown);
    const a = hanging
      ? (physPoint || { x: pointer.x, y: pointer.y + 12 })
      : { x: drawPos.x + petW() / 2, y: drawPos.y + petH() - 2 };
    const r = h * 1.05 + 12;
    return {
      x: a.x - r,
      y: a.y - r,
      right: a.x + r,
      bottom: a.y + r,
    };
  }
  const b = e.box;
  const ch = charRect ? charRect.bottom - charRect.y : petH();
  const s = ch / Math.max(1, b.bottom - b.y);
  const w = (b.right - b.x) * s;
  const h = (b.bottom - b.y) * s;
  const th = Math.abs(fx.rot || 0);
  const sc = Math.cos(th);
  const ss = Math.sin(th);
  const halfX = (w / 2) * sc + h * ss; // rotated corners + strip sway
  if (STILL_ANCHOR[stillCtl.name] === 'hang' && (dragging || thrown)) {
    const a = physPoint || { x: pointer.x, y: pointer.y + 12 };
    return {
      x: a.x - halfX - 6,
      y: a.y - (w / 2) * ss + fx.dy - 6,
      right: a.x + halfX + 6,
      bottom: a.y + (w / 2) * ss + h * sc + fx.dy + 6,
    };
  }
  const cx = drawPos.x + (charRect ? (charRect.x + charRect.right) / 2 : petW() / 2);
  const feetY = drawPos.y + (charRect ? charRect.bottom : petH());
  return {
    x: cx - halfX - 6,
    y: feetY + fx.dy - h * sc - (w / 2) * ss - 6,
    right: cx + halfX + 6,
    bottom: feetY + fx.dy + (w / 2) * ss + 6,
  };
}

// Window-space rect the pointer must be inside to interact. While a still
// dominates, the hit area follows the still's real alpha box (and the grab
// point while hanging), not the live model's frame.
// Just her body — no cards. Chat anchoring must use THIS: the chat rect
// joins petBounds below, and anchoring to the union would self-feed (the
// card's own rect would drag the card's anchor).
// Tight body rect under the rig — the clear box (stillDrawRect) is a
// generously oversized disc, far too big for a hover hit area.
function rigBodyRect() {
  const S = rigScale();
  const b = rig.mf.char_bbox;
  const w = (b[2] - b[0]) * S;
  const h = (b[3] - b[1]) * S;
  if (stillCtl.name === 'pick-up' && (dragging || thrown)) {
    const a = physPoint || { x: pointer.x, y: pointer.y + 12 };
    return {
      x: a.x - w / 2 - 40,
      y: a.y - 10,
      right: a.x + w / 2 + 40,
      bottom: a.y + h + 10,
    };
  }
  const cx = drawPos.x + petW() / 2;
  const fy = drawPos.y + petH() - 2;
  if (stillCtl.name === 'sleep') {
    // Lying: head points left of the feet anchor.
    return {
      x: cx - h - 10,
      y: fy - w - 20,
      right: cx + 50,
      bottom: fy + w * 0.5 + 12,
    };
  }
  return {
    x: cx - w / 2 - 8,
    y: fy - h - 8,
    right: cx + w / 2 + 8,
    bottom: fy + 8,
  };
}

function petBodyBounds() {
  // Live states transform the model about either its feet or the grab point.
  // The clear rect is an oversized disc; use the transformed alpha box for
  // hover and bubble anchoring instead.
  if (session) {
    const r = charRect || { x: 0, y: 0, right: petW(), bottom: petH() };
    const a = smooth(clamp01(stillCtl.alpha));
    const rot = fx.rot + liveFx.rot * a;
    const sx = fx.sx * (1 + (liveFx.sx - 1) * a);
    const sy = fx.sy * (1 + (liveFx.sy - 1) * a);
    const dx = fx.dx + liveFx.dx * a;
    const dy = fx.dy + liveFx.dy * a;
    const hanging = liveFx.pivot === 'grab' && a > 0.4
      && (dragging || thrown) && physPoint;
    const origin = hanging
      ? { x: physPoint.x + dx, y: physPoint.y + dy }
      : { x: drawPos.x + petW() / 2 + dx,
        y: drawPos.y + petH() - 2 + dy };
    const mirror = !hanging && facing < 0 ? -1 : 1;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const corners = [
      [r.x, r.y], [r.right, r.y], [r.x, r.bottom], [r.right, r.bottom],
    ].map(([x, y]) => {
      const px = (x - petW() / 2) * sx * mirror;
      const py = (y - (hanging ? petH() * GRAB_FRAC : petH())) * sy;
      return { x: origin.x + px * cos - py * sin,
        y: origin.y + px * sin + py * cos };
    });
    return {
      x: Math.min(...corners.map((p) => p.x)) - HOVER_PADDING,
      y: Math.min(...corners.map((p) => p.y)) - HOVER_PADDING,
      right: Math.max(...corners.map((p) => p.x)) + HOVER_PADDING,
      bottom: Math.max(...corners.map((p) => p.y)) + HOVER_PADDING,
    };
  }
  if (stillCtl.alpha > 0.5) {
    const sb = rig.ready ? rigBodyRect() : stillDrawRect();
    if (sb) {
      return {
        x: sb.x - HOVER_PADDING,
        y: sb.y - HOVER_PADDING,
        right: sb.right + HOVER_PADDING,
        bottom: sb.bottom + HOVER_PADDING,
      };
    }
  }
  const r = charRect || { x: 0, y: 0, right: petW(), bottom: petH() };
  return {
    x: drawPos.x + r.x - HOVER_PADDING,
    y: drawPos.y + r.y - HOVER_PADDING,
    right: drawPos.x + r.right + HOVER_PADDING,
    bottom: drawPos.y + r.bottom + HOVER_PADDING,
  };
}

function petBounds() {
  let b = petBodyBounds();
  // The status panel is part of "her" while open — hovering the card must
  // keep the overlay interactive or its rows could never take a click.
  if (panel) {
    b = {
      x: Math.min(b.x, panel.x),
      y: Math.min(b.y, panel.y),
      right: Math.max(b.right, panel.x + panel.w),
      bottom: Math.max(b.bottom, panel.y + panel.h),
    };
  }
  // The chat card too — its rect rides the hover union so text input and
  // the send button take clicks without the window going click-through.
  if (chatRect) {
    b = {
      x: Math.min(b.x, chatRect.x),
      y: Math.min(b.y, chatRect.y),
      right: Math.max(b.right, chatRect.x + chatRect.w),
      bottom: Math.max(b.bottom, chatRect.y + chatRect.h),
    };
  }
  return b;
}

function overPet(clientX, clientY) {
  return distanceToInteractiveSurface(clientX, clientY) === 0;
}

function distanceToInteractiveSurface(x, y) {
  // Cards and pinned bubbles are separate islands; their empty gaps belong
  // to the desktop. Geometry used to anchor bubbles is independent of this.
  const body = petBodyBounds();
  const rects = [body, ...[panel, chatRect, chatPickerRect,
    bubble?.pinned ? lastBubbleRect : null].filter(Boolean).map(r => ({
    x: r.x, y: r.y, right: r.x + r.w, bottom: r.y + r.h,
  }))];
  return Math.min(...rects.map(r => Math.hypot(
    Math.max(r.x - x, x - r.right, 0), Math.max(r.y - y, y - r.bottom, 0))));
}

// Body-only hit test: the panel/chat rects are interaction surfaces, not
// her body — a press or file drop in the hold ring around her must not
// read as a grab, a poke, or a feeding.
function overBody(clientX, clientY) {
  const b = petBodyBounds();
  return clientX >= b.x && clientX <= b.right
    && clientY >= b.y && clientY <= b.bottom;
}

// Cursor input arrives from two sources: native mousemove while the window
// is interactive, and the main process's `shell:live2d-cursor` pump while it
// is click-through (forwarded moves never reach this page). Both feed the
// same hover/gaze logic; pushed positions carry buttons=null, so only real
// events run the orphan-drag watchdog.
function onCursorMove(clientX, clientY, buttons) {
  // Watchdog: real mousemoves keep arriving while interactive, so a drag
  // whose pointerup was eaten (e.g. the exit timer fired mid-drag and the
  // window went click-through) gets closed instead of sticking forever.
  if (dragging && buttons !== null && (buttons & 1) === 0) {
    console.log('pet: orphan drag ended via mousemove');
    endDrag({ clientX, clientY });
  }
  // Gaze follows the cursor's direction from her face — the anchor is the
  // THA4 head-center spec point (256,128 in the 512 frame) mapped through
  // the crop, not a guess. Deflection saturates at ~1.4 body-widths away.
  pointer.x = clientX;
  pointer.y = clientY;
  const faceX = drawPos.x + petW() * 0.5;
  const faceY = drawPos.y + petH() * 0.22;
  idle.targetMx = Math.max(-1, Math.min(1, (clientX - faceX) / (petW() * 1.4)));
  idle.targetMy = Math.max(-1, Math.min(1, (clientY - faceY) / (petH() * 1.3)));
  if (dragging) {
    return;
  }
  // Panel hover tracking rides the same cursor stream — repaint on change.
  if (panel) {
    const h = panelCellAt(clientX, clientY);
    const fb = feedButtonHit(clientX, clientY);
    // The header ✕ only exists while the pointer is over the card, so its
    // reveal state is part of the same hover edge as the chips.
    const onCard = clientX >= panel.x && clientX <= panel.x + panel.w
      && clientY >= panel.y && clientY <= panel.y + panel.h;
    const nearClose = onCard && panelCloseHit(clientX, clientY);
    if (h !== panel.hover || fb !== panel.feedHover
        || nearClose !== closeHover || onCard !== closeVisible) {
      panel.hover = h;
      panel.feedHover = fb;
      closeHover = nearClose;
      closeVisible = onCard;
      // Hover edges must schedule a presentation: marking dirty alone leaves
      // the cached raster on screen until an unrelated paint happens.
      requestFrame();
    }
  }
  const bounds = petBodyBounds();
  const outside = distanceToInteractiveSurface(clientX, clientY);
  if (outside <= 0) {
    idle.lastInteract = performance.now();
    // Wake and head-pat are BODY gestures: the status card, chat card and
    // pinned bubbles are also interactive surfaces, and sweeping the pointer
    // across the card must not wake her or read as a pat.
    const onBody = overBody(clientX, clientY);
    if (onBody && sleeping) { wake(); }
    // Head-pat: strokes across the top 45% of her bounds — 3 direction
    // flips inside 1.6s trigger the react-head still + hearts.
    const headY = bounds.y + (bounds.bottom - bounds.y) * 0.45;
    if (onBody && clientY < headY && !action && !feed && !come && stillCtl.target === 0) {
      const now = performance.now();
      if (now - patTrack.since > 1600) { patTrack.flips = 0; patTrack.since = now; }
      const dx = clientX - patTrack.lastX;
      patTrack.lastX = clientX;
      if (Math.abs(dx) > 4) {
        const d = Math.sign(dx);
        if (d !== patTrack.dir) {
          patTrack.dir = d;
          patTrack.flips += 1;
          if (patTrack.flips >= 3) {
            patTrack.flips = 0;
            care('pat');
            playStill('pat', 2600);
            say('pat');
            for (let i = 0; i < 3; i += 1) {
              spawn('heart', drawPos.x + petW() * rng(0.3, 0.7), drawPos.y + petH() * 0.15);
            }
          }
        }
      }
    }
    clearTimeout(exitInteractiveTimer);
    // Enter immediately: any delay here is a dead zone where right-clicks
    // and grabs fall through to the desktop. Toggling hit-testing costs no
    // repaint, so lingering is not required.
    setInteractive(true);
  } else if (outside > EXIT_HYSTERESIS) {
    // Clearly gone: drop interactivity at once — a lingering interactive
    // fullscreen window would eat clicks meant for the desktop below. The
    // card is NOT closed here: it used to be, which is exactly why it
    // vanished the moment the pointer crossed the body/card gap and made its
    // buttons unclickable. Leaving only releases click-through; the card is
    // dismissed explicitly (✕ badge, right-click toggle, or an action).
    clearTimeout(exitInteractiveTimer);
    setInteractive(false);
  } else {
    // Near the edge: debounce so rapid boundary crossings don't toggle
    // setIgnoreMouseEvents back and forth (each toggle repaints the window).
    clearTimeout(exitInteractiveTimer);
    exitInteractiveTimer = setTimeout(() => {
      // Never drop interactivity mid-drag — that would eat pointerup and
      // strand the drag (she freezes and goes unresponsive).
      if (!dragging) {
        setInteractive(false);
      }
    }, 200);
  }
}
window.addEventListener('mousemove', (event) => onCursorMove(event.clientX, event.clientY, event.buttons));

// Keep the character's visible box inside the overlay's home display — the
// overlay covers exactly one display at a time (a union-spanning window
// gets silently relocated by the OS on mixed-DPI setups, breaking both
// coordinates and coverage). Crossing to another display is handled by the
// pointerleave -> relocate hop below.
function clampDrawPos() {
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const box = charRect || { x: 0, y: 0, right: petW(), bottom: petH() };
  drawPos.x = Math.min(Math.max(drawPos.x, host.x - box.x), host.x + host.width - box.right);
  drawPos.y = Math.min(Math.max(drawPos.y, host.y - box.y), host.y + host.height - box.bottom);
}

// The overlay covers one display, so pointer events die at its edge. While
// dragging, poll main for the real cursor display — when the cursor lands
// on another monitor the overlay hops there and the drag continues.
let relocatePoll = 0;
function startRelocatePoll() {
  clearInterval(relocatePoll);
  relocatePoll = setInterval(() => {
    if (dragging) {
      void Promise.resolve(petShell.relocate?.({})).catch(() => {});
    }
  }, 150);
}

// The ✕ on a pinned notification is the ONLY way it leaves the stage —
// closing dequeues the next bubble exactly like an expiry would.
function bubbleCloseHit(x, y) {
  const r = bubbleCloseRect;
  return Boolean(bubble?.pinned && r)
    && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
function dismissPinnedBubble() {
  bubble = dequeueBubble(performance.now());
  bubbleCloseRect = null;
  requestFrame();
}

function onCanvasPointerDown(event) {
  // DOM overlays (chat box) own their events — a click on a DOM node is
  // never a drag start or a panel cell.
  if (event.target !== canvas) {
    return;
  }
  // Right-button presses leave the card alone: `contextmenu` owns the toggle,
  // and closing on pointerdown would make the toggle reopen it instead.
  if (event.button === 2) {
    return;
  }
  // The pinned bubble's ✕ wins over everything — it must take the click
  // even when the status panel happens to be open beneath it.
  if (event.button === 0 && bubbleCloseHit(event.clientX, event.clientY)) {
    console.log('pet: pinned bubble dismissed via ✕');
    dismissPinnedBubble();
    return;
  }
  // Panel clicks win over the drag gesture: a row dispatch closes the card,
  // and the ✕ badge dismisses it. Neutral clicks — the header, the dividers,
  // the 6px gutters, or her own body underneath — leave it open, because
  // dismissal is explicit only (the old "any other click closes it" rule is
  // what made the card feel like it vanished on its own).
  if (panel) {
    if (event.button === 0 && panelCloseHit(event.clientX, event.clientY)) {
      console.log('pet: panel dismissed via ✕');
      closePanel('badge-dismiss');
      return;
    }
    // Feed button in the growth block takes priority over the chip grid.
    if (feedButtonHit(event.clientX, event.clientY) && event.button === 0) {
      console.log('pet: feed button hit');
      if (growth && growth.nextFeed > 0) {
        closePanel('feed-action');
        void Promise.resolve(petShell.feedTokens?.({})).catch(() => {});
      }
      return;
    }
    const idx = panelCellAt(event.clientX, event.clientY);
    console.log(`pet: panel click x=${Math.round(event.clientX)} y=${Math.round(event.clientY)} idx=${idx}`);
    const cell = idx >= 0 ? panel.cells[idx] : null;
    if (cell && cell.enabled !== false && event.button === 0) {
      dispatchPanelCell(cell);
    }
    return;
  }
  // Only her body starts a drag: the hold zone keeps the window interactive
  // in a ring around her, and a press there must not pick her up or count
  // as a poke.
  if (!interactive || event.button !== 0 || !overBody(event.clientX, event.clientY)) {
    return;
  }
  clearTimeout(exitInteractiveTimer);
  // Catching her mid-flight cancels the throw — she goes back to being held.
  thrown = false;
  // Drag is fully renderer-local: the window never moves, only drawPos does.
  grabOffset = { x: event.clientX - drawPos.x, y: event.clientY - drawPos.y };
  downClient = { x: event.clientX, y: event.clientY };
  dragging = true;
  dragMoved = false;
  startRelocatePoll();
  console.log('pet: drag down');
}
window.addEventListener('pointerdown', onCanvasPointerDown);

window.addEventListener('pointermove', (event) => {
  if (!dragging || !grabOffset || !downClient) {
    return;
  }
  // lockPosition disables dragging outright (release reads as a tap);
  // shiftToDrag requires SHIFT held while moving (§B10).
  const dragAllowed = !settings.lockPosition
    && (!settings.shiftToDrag || event.shiftKey);
  if (!dragMoved && dragAllowed
      && Math.hypot(event.clientX - downClient.x, event.clientY - downClient.y) > DRAG_THRESHOLD) {
    dragMoved = true;
    setStill('pick-up');
    say('pickup');
    // The spring starts where she was grabbed — no snap on pickup.
    physPoint = { x: event.clientX, y: event.clientY + 12 };
    physVel = { x: 0, y: 0 };
  }
  if (dragMoved) {
    // Feed the release-velocity estimator; the spring itself runs in
    // tickPhysics every frame so she trails the cursor smoothly.
    const t = performance.now() / 1000;
    dragTrail.push([t, event.clientX, event.clientY]);
    while (dragTrail.length && dragTrail[0][0] < t - 0.4) {
      dragTrail.shift();
    }
  }
});

// Fold the physics point back into drawPos: the live model lands exactly
// where the hanging still settled, feet on the same bottom line — no snap.
function landFromPhys(now, fromThrow = false) {
  const e = stillCtl.entry;
  if (session && stillCtl.name === 'pick-up' && physPoint) {
    // Live hang: the grab point sat at physPoint; feet land GRAB_FRAC·h
    // below it — same geometry the draw uses, so she doesn't snap.
    drawPos.x = physPoint.x - petW() / 2;
    drawPos.y = physPoint.y - GRAB_FRAC * petH() + 2;
    clampDrawPos();
  } else if (rig.ready && stillCtl.name === 'pick-up' && physPoint) {
    // Rig hang: GRAB at physPoint, feet at GRAB + (FEET-GRAB)·S below it.
    const S = rigScale();
    drawPos.x = physPoint.x - petW() / 2;
    drawPos.y = physPoint.y + (RIG_FEET[1] - RIG_GRAB[1]) * S - petH() + 2;
    clampDrawPos();
  } else if (e && e.img && STILL_ANCHOR[stillCtl.name] === 'hang' && physPoint) {
    const b = e.box;
    const ch = charRect ? charRect.bottom - charRect.y : petH();
    const s = ch / Math.max(1, b.bottom - b.y);
    const cxr = charRect ? (charRect.x + charRect.right) / 2 : petW() / 2;
    const fyr = charRect ? charRect.bottom : petH();
    drawPos.x = physPoint.x - cxr;
    drawPos.y = physPoint.y + (b.bottom - b.y) * s - fyr;
    clampDrawPos();
  }
  thrown = false;
  physPoint = null;
  physVel = { x: 0, y: 0 };
  clearStill();
  if (fromThrow) { playStill('recover', 1100); }
  landT = now;
  say('land');
  if (fromThrow) {
    for (let i = 0; i < 3; i += 1) {
      spawn('star', drawPos.x + petW() * 0.5, drawPos.y + 30);
    }
  }
  const petScreen = {
    x: Math.round(drawPos.x + overlayOrigin.x),
    y: Math.round(drawPos.y + overlayOrigin.y),
  };
  void Promise.resolve(petShell.dragCommit?.(petScreen)).catch(() => {});
}

function endDrag(event) {
  if (!dragging) {
    return;
  }
  dragging = false;
  clearInterval(relocatePoll);
  relocatePoll = 0;
  console.log(`pet: drag end moved=${dragMoved}`);
  grabOffset = null;
  downClient = null;
  if (dragMoved) {
    dragMoved = false;
    const now = performance.now();
    // Trail-window estimate: endpoint direction + peak-blended magnitude +
    // accel gain, soft-knee capped — a real throw, not a single-sample guess.
    const est = PetPhysics.estimateReleaseVelocity(
      dragTrail, now / 1000, PetPhysics.throwSpeedCap('standard'));
    dragTrail = [];
    if (Math.hypot(est.vx, est.vy) >= PetPhysics.DEAD_ZONE_SPEED && physPoint) {
      // She's airborne: keep the carried pose, tumble, and let tickPhysics
      // fly her ballistically until she settles on the floor.
      thrown = true;
      physVel = { x: est.vx, y: est.vy }; // estimator returns {vx,vy}
      throwT = now;
      care('throw');
      say('throw');
    } else {
      landFromPhys(now);
    }
  } else {
    const now = performance.now();
    tapTimes.push(now);
    tapTimes = tapTimes.filter((t) => now - t < 3000);
    idle.lastInteract = now;
    clickBlip();
    if (sleeping) { wake(); care('wake'); }
    else { care('poke'); }
    if (tapTimes.length >= 4) {
      tapTimes = [];
      playStill('angry', 1800);
      say('angry');
      // Water spray: droplets arc outward from her mouth, not a column.
      for (let i = 0; i < 8; i += 1) {
        const dir = i % 2 === 0 ? -1 : 1;
        spawn('drop',
          drawPos.x + petW() * 0.5 + dir * rng(4, 12),
          drawPos.y + petH() * 0.35,
          dir * rng(0.6, 1.8), rng(-0.9, -0.2));
      }
    } else if (!action && !feed && !come) {
      idle.tapUntil = now + TAP_REACTION_MS;
      idle.tapKind += 1;
      playStill('poke', 800);
      say(`tap${idle.tapKind % TAP_KINDS.length}`);
    }
  }
  setInteractive(overPet(event.clientX, event.clientY));
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (event.target !== canvas) { return; }
  togglePanel();
});

// Drag-and-drop file eating (§B10): files dropped on her are "eaten" — a
// reaction line plus a care bump, counted in stats. Files are NEVER read
// or deleted; the click-through window must already be interactive (the
// hover pass that precedes a drop does that via petBounds).
window.addEventListener('dragover', (event) => {
  if (event.dataTransfer && Array.from(event.dataTransfer.types || [])
      .includes('Files') && overBody(event.clientX, event.clientY)) {
    event.preventDefault(); // required, or the drop is rejected
    event.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('drop', (event) => {
  if (!(event.dataTransfer && event.dataTransfer.files
      && event.dataTransfer.files.length)
      || !overBody(event.clientX, event.clientY)) {
    return;
  }
  event.preventDefault();
  const names = Array.from(event.dataTransfer.files).map((f) => f.name || '文件');
  console.log(`pet: ate ${names.length} file(s): ${names.slice(0, 3).join(', ')}`);
  idle.lastInteract = performance.now();
  if (sleeping) { wake(); }
  care('fileEat');
  playStill('celebrate', 1400);
  say('fileEat', { file: names[0] });
  spawn('star', drawPos.x + petW() * 0.5, drawPos.y + 30);
});

window.addEventListener('resize', resizeCanvas);

// kind: 'rice' (白米饭 menu feed) | 'token' (growth feed — glowing crystal).
function startFeed(kind) {
  const now = performance.now();
  idle.lastInteract = now;
  const host = homeRect || { x: 0, width: window.innerWidth };
  const bowlX = Math.min(host.x + host.width - 60,
    Math.max(host.x + 60, drawPos.x + petW() / 2 + rng(-220, 220)));
  const groundY = drawPos.y + (charRect ? charRect.bottom : petH()) - 10;
  feed = {
    phase: 'drop',
    t0: now,
    bowlX,
    bowlY: groundY - 260,
    groundY,
    kind: kind === 'token' ? 'token' : 'rice',
  };
  holdBubbles(4); // the eat routine owns the stage — chatter waits it out
}

function celebrateLevelUp() {
  playStill('celebrate', 2600);
  holdBubbles(4);
  say('levelUp');
  for (let i = 0; i < 5; i += 1) {
    spawn('star', drawPos.x + petW() * rng(0.15, 0.85), drawPos.y + petH() * rng(0.05, 0.4));
  }
}

// Main-process push: {available, fed, leveledUp, level, ...}. A feed grant
// plays the crystal-eat routine; a level-up queues behind it so the two
// performances don't fight over the still layer.
// Care events ride to main where they persist; the pushed snapshot comes
// back with fresh stats. feedToken is applied main-side inside feedTokens.
function care(kind) {
  void Promise.resolve(petShell.care?.({ kind })).catch(() => {});
}

function onGrowthPush(snap) {
  if (!snap || typeof snap !== 'object') { return; }
  growth = snap;
  if (snap.stats) { stats = snap.stats; }
  const fed = Number(snap.fed) > 0;
  const leveled = snap.leveledUp === true;
  // The minute usage rescan sends an ordinary snapshot too. Only a real
  // feeding or level-up is an interaction that should wake a sleeping pet.
  if (fed || leveled) {
    idle.lastInteract = performance.now();
    if (sleeping) { wake(); }
  }
  if (dragging) { return; }
  const stageFree = !feed && !come && !action;
  if (fed && !feed && !come) {
    startFeed('token');
    if (leveled) { pendingLevelUp = true; }
  } else if (leveled) {
    if (stageFree) { celebrateLevelUp(); } else { pendingLevelUp = true; }
  }
}

// Action verbs shared by the status panel's rows.
function runAction(act) {
  const now = performance.now();
  idle.lastInteract = now;
  if (sleeping) { wake(); }
  if (dragging) { return; }
  if (act === 'play' && !feed && !come && !action) {
    // 玩耍: she hops around chasing a yarn-ball — costs satiety, lifts mood.
    care('play');
    playStill(Math.random() < 0.5 ? 'twirl' : 'celebrate', 2400);
    say('tease');
    for (let i = 0; i < 5; i += 1) {
      spawn('star', drawPos.x + petW() * rng(0.15, 0.85), drawPos.y + petH() * rng(0.05, 0.4));
    }
  } else if (act === 'come' && !feed) {
    care('come');
    const host = homeRect || { x: 0, width: window.innerWidth };
    come = {
      targetX: Math.min(host.x + host.width - petW(),
        Math.max(host.x, pointer.x - petW() / 2)),
    };
    setStill('running');
    say('come');
  } else if (act === 'pat' && !feed && !come && !action) {
    care('pat');
    playStill('pat', 2600);
    say('pat');
    for (let i = 0; i < 3; i += 1) {
      spawn('heart', drawPos.x + petW() * rng(0.3, 0.7), drawPos.y + petH() * 0.15);
    }
  } else if (act === 'tease' && !feed && !come && !action) {
    care('tease');
    // Teasing an already-grumpy whale backfires — she sprays and sulks.
    if (stats && stats.mood < 25) {
      playStill('angry', 2200);
      say('grumpy');
    } else {
      playStill(Math.random() < 0.5 ? 'shy' : 'star', 2200);
      say('tease');
      for (let i = 0; i < 3; i += 1) {
        spawn('star', drawPos.x + petW() * rng(0.2, 0.8), drawPos.y + petH() * rng(0.05, 0.3));
      }
    }
  }
}

async function mount() {
  // From this point on, producers wait for the mounted display owner.
  renderLoopActive = true;
  resizeCanvas();
  // Dialogue store: fetched over pet:// (same origin as the stills/model).
  // Until it lands, say() is a safe no-op over the empty store.
  void PetDialogue.load('pet://pet/').then((store) => {
    dialogueStore = store;
    LINES = store.global || {};
    wireDialogue();
  }).catch(() => {});
  // The panel avatar needs greet; fallback poses load on demand in setStill.
  void loadStill('greet').catch(() => {});
  // Main process relays the persisted screen position; convert it to
  // canvas coordinates by subtracting the overlay's own origin.
  petShell.onLayout?.((layout) => {
    if (!layout) {
      return;
    }
    // A layout swap mid-drag means the overlay hopped displays — keep her at
    // the same screen position under the new origin.
    const petScreen = dragging
      ? { x: drawPos.x + overlayOrigin.x, y: drawPos.y + overlayOrigin.y }
      : null;
    if (layout.origin && Number.isFinite(layout.origin.x) && Number.isFinite(layout.origin.y)) {
      overlayOrigin = { x: layout.origin.x, y: layout.origin.y };
    }
    if (Array.isArray(layout.displays)) {
      displayRects = layout.displays.filter((d) => d && Number.isFinite(d.width));
      homeRect = displayRects[layout.home] || displayRects[0] || null;
    }
    if (petScreen) {
      drawPos = { x: petScreen.x - overlayOrigin.x, y: petScreen.y - overlayOrigin.y };
      clampDrawPos();
      // Re-anchor the spring at the cursor's new window coords — otherwise
      // she'd swing across the fresh display chasing a stale point.
      if (physPoint) {
        physPoint = { x: pointer.x, y: pointer.y + 12 };
        physVel = { x: 0, y: 0 };
      }
      requestFrame();
    }
  });
  // While click-through, no DOM mouse events reach this page — the main
  // process polls the real cursor and pushes window-local positions through
  // here. `inside:false` means the pointer left the overlay entirely: run
  // the exit path with a far-away point so a resting hover can't wedge the
  // fullscreen window interactive.
  petShell.onCursor?.((cur) => {
    if (!cur) {
      return;
    }
    if (cur.inside === false) {
      onCursorMove(-1e9, -1e9, null);
    } else if (Number.isFinite(cur.x) && Number.isFinite(cur.y)) {
      onCursorMove(cur.x, cur.y, null);
    }
  });
  petShell.onMove?.((pos) => {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      return;
    }
    drawPos = { x: pos.x - overlayOrigin.x, y: pos.y - overlayOrigin.y };
    clampDrawPos();
    requestFrame();
  });
  petShell.onGrowth?.(onGrowthPush);
  void Promise.resolve(petShell.getGrowth?.()).then((snap) => {
    if (snap && !growth) { growth = snap; }
    if (snap && snap.stats) { stats = snap.stats; }
  }).catch(() => {});
  // Pet settings: pull once, then ride the change push. applySettings is
  // the single fan-out point for side effects (scale rect, timers, roam
  // rect) — writes are owned by the main window's settings page.
  void Promise.resolve(petShell.getSettings?.()).then((s) => {
    if (s && typeof s === 'object') { applySettings(s); }
  }).catch(() => {});
  petShell.onSettings?.((s) => {
    if (s && typeof s === 'object') { applySettings(s); }
  });
  // DSH link channels (R2 — handlers land with that work; subscriptions
  // are safe no-ops until main starts pushing).
  petShell.onDsh?.((ev) => onDshEvent(ev));
  petShell.onAlert?.((al) => onDshAlert(al));
  bindChatDom();
  // Live engine first: THA4 renders every pixel continuously (the liveliness
  // the part rig could only fake), and Anime4K restores the line art so it
  // is not blurry. The part rig stays as the fallback when the ONNX model
  // or WebGPU is missing.
  try {
    session = await createSession();
    allocOutput();
    imageTensor = await loadImageTensor();
    try {
      await initGpuPixels();
    } catch (error) {
      console.warn('pet: packed GPU output unavailable; using float output', error);
    }
    if (FRAME === 512) {
      // HD frames already supersample the 240px display 4x — SR only pays
      // on the 512² pipeline.
      initSr();
    }
    console.log('pet: avatar model ready (live engine)');
  } catch (error) {
    session = null;
    console.warn('pet: live engine unavailable, falling back to rig', error);
  }
  if (!session) {
    try {
      await loadRig();
    } catch (error) {
      console.warn('pet: rig load failed', error);
    }
    if (rig.ready) {
      painted = true;
      console.log('pet: HD part rig ready');
      // The rig is the visible renderer now — pull the state stills it draws.
      for (const name of ['pick-up', 'running', 'eat', 'sleep', 'react-head',
        'angry', 'celebrate', 'star', 'tail-swing']) {
        void loadStill(name).catch(() => {});
      }
    }
  }
  setTimeout(() => say('greet'), 1200);
  reportRoam(); // seed the main-side hover rect with the real size/origin
  // Pace inference on a steady cadence: an irregular rate (chasing max
  // speed) reads as flicker.
  let lastFrameAt = 0;
  const loop = (now) => {
    try {
      if (petPerf.enabled) { petPerf.record('displayRefresh', 0); }
      tickPhysics(now);
      tickStill(now);
      // Roam rect rides along whenever her BODY bounds move (wander legs,
      // come, feed run — and stills, which swing her visible box around a
      // fixed drawPos) — the main process needs the CURRENT screen rect for
      // hover hit-testing, throttled to ~10Hz.
      const bb = petBodyBounds();
      const bk = `${bb.x | 0},${bb.y | 0},${bb.right | 0},${bb.bottom | 0}`;
      if (bk !== loop._bk) {
        loop._bk = bk;
        reportRoam();
      }
      if (chatOpen) { syncChatPos(); }
      rigT = now / 1000;
      stepPose();
      if (session || !rig.ready) {
        // Live path: pose math every rAF (transforms tween at display rate);
        // inference itself is paced — the SR'd frame refreshes ~20fps.
        const gap = inferenceGapMs(now);
        if (now - lastFrameAt >= gap) {
          lastFrameAt = now;
          void renderFrame();
        }
      }
      // Commit changed live frames/state together at display refresh. The
      // rig animates in canvas, so it still needs every refresh. An unchanged
      // live idle image can stay on the surface until the next inference.
      if (!session) { paintRequested = true; }
      maybePresent(now);
    } catch (err) {
      // A bad frame must never kill the rAF chain — one throw used to
      // freeze the whole pet until reload.
      console.error('pet: frame error', err);
    }
    requestAnimationFrame(loop);
  };
  renderLoopActive = true;
  requestAnimationFrame(loop);
}

// Diagnostics surface for scripts/measure-whale-cdp.mjs. Everything here is
// opt-in and non-persisted: overrides are restored by the caller's `finally`,
// and a restart always returns to shipped product behavior.
window.__dshdPetDiag = {
  setOverrides: __setPerfOverrides,
  effective: () => ({
    presentGapMs: presentCeilingMs(performance.now()),
    inferGapMs: inferenceGapMs(performance.now()),
    srEnabled: srEnabledOverride,
    srReady,
    frameIsSr,
  }),
  panelTrace: () => ({ generation: panelTrace.generation, entries: [...panelTrace.entries] }),
  counts: () => ({ ...petPerf.snapshot().counts }),
};

// DSH link surface (§B6): state events ride shell:live2d-dsh, alerts ride
// shell:live2d-alert. The main-side tailer lands in R2; both handlers are
// already real so pushes light up the moment they exist.
const ALERT_CATEGORIES = new Set(['dshWorking', 'dshDone', 'dshError', 'dshRest',
  'dshMilestone', 'dshMiss', 'dshApproval', 'dshQuestion', 'approvalAllow',
  'approvalReject', 'greet', 'dshWhale']);
// Last pushed harness activity state — the status card shows a small
// 「陪伴中/工作中」dot next to her name so the link is visible, not just
// audible.
let dshState = 'idle';
function onDshEvent(ev) {
  if (ev && typeof ev.state === 'string') {
    dshState = ev.state === 'working' ? 'working' : 'idle';
    return;
  }
  if (!ev || typeof ev.category !== 'string' || !ALERT_CATEGORIES.has(ev.category)) {
    return;
  }
  // The dsh-whale assistant speaks directly: its outbox line IS the bubble
  // text (priority 2 alert), not a dialogue-pool lookup.
  if (ev.category === 'dshWhale') {
    const text = String(ev.summary || '').trim();
    // sticker lines carry a data-URL image — the pet page cannot reach disk
    // paths itself, so the watcher ships the bytes. With the card open the
    // picture joins the thread; otherwise it takes the ambient bubble.
    const image = typeof ev.image === 'string' && ev.image.startsWith('data:image/')
      ? ev.image : '';
    if (image && chatOpen) {
      chatAppendImage(image, text);
      return;
    }
    if (text || image) {
      // whale_notify pins: the message holds the stage with a ✕ until the
      // user dismisses it — a done line can no longer knock a result off.
      const pinned = ev.kind === 'notify';
      const entry = {
        text,
        until: pinned ? Infinity
          : performance.now() + Math.min(2200 + Array.from(text).length * 90, 8000),
        priority: 2,
        pinned,
      };
      if (image) {
        const img = new Image();
        img.onload = () => requestFrame();
        img.src = image;
        entry.image = img;
        entry.until = performance.now() + 8000; // a picture reads slower than a line
      }
      pushBubble(entry);
    }
    return;
  }
  say(ev.category, { tokens: ev.tokens, min: ev.min, days: ev.days, summary: ev.summary },
    undefined, 1);
}
function onDshAlert(al) {
  if (!al || typeof al.category !== 'string' || !ALERT_CATEGORIES.has(al.category)) {
    return;
  }
  if (al.resolved) {
    resolveAlert(al.alertId);
    return;
  }
  sayAlert(al.category, al.alertId,
    { summary: al.summary, tokens: al.tokens },
    { buttons: al.buttons, holdMs: al.holdMs });
}
mount().catch((error) => console.warn('pet: mount failed', error));
