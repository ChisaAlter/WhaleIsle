'use strict';

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
  if (typeof requestAnimationFrame === 'function') { petLifetime.frame(run); }
  else { petLifetime.timeout(run, 16); }
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
  // A mount/resize invalidation can arrive before the first model image.
  // Commit only visible ink or cleanup; an empty live scene has nothing to
  // upload while that first inference is still in flight.
  const activeStill = stillCtl.entry && stillCtl.alpha > 0.01;
  if (!painted && !activeStill && !feed && !particles.length && !bubble && !panel
      && !lastPaintRect && !lastFeedRect && !lastParticleRect && !lastBubbleRect && !lastPanelRect) {
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

