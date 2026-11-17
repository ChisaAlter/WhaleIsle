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
const { h, mount: mountNodes } = window.whaleDom;
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

