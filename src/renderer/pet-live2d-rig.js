'use strict';

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
    }).catch((error) => { console.warn('[src/renderer/pet-live2d.js] background operation failed', error); });
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

