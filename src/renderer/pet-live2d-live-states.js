'use strict';

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

