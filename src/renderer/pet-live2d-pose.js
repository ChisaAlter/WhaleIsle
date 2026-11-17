'use strict';

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

