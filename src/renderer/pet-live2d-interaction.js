'use strict';

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
    lastPanelRect, chatRect, pickerInk, chatFeedbackRect].filter(Boolean).map((r) => {
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
  const rects = [body, ...[panel, chatRect, chatPickerRect, chatFeedbackRect,
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
    petLifetime.clearTimeout(exitInteractiveTimer);
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
    petLifetime.clearTimeout(exitInteractiveTimer);
    setInteractive(false);
  } else {
    // Near the edge: debounce so rapid boundary crossings don't toggle
    // setIgnoreMouseEvents back and forth (each toggle repaints the window).
    petLifetime.clearTimeout(exitInteractiveTimer);
    exitInteractiveTimer = petLifetime.timeout(() => {
      // Never drop interactivity mid-drag — that would eat pointerup and
      // strand the drag (she freezes and goes unresponsive).
      if (!dragging) {
        setInteractive(false);
      }
    }, 200);
  }
}
petLifetime.listen(window, 'mousemove', (event) => onCursorMove(event.clientX, event.clientY, event.buttons));

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
  petLifetime.clearInterval(relocatePoll);
  relocatePoll = petLifetime.interval(() => {
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
  petLifetime.clearTimeout(exitInteractiveTimer);
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
petLifetime.listen(window, 'pointerdown', onCanvasPointerDown);

petLifetime.listen(window, 'pointermove', (event) => {
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
  petLifetime.clearInterval(relocatePoll);
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

petLifetime.listen(window, 'pointerup', endDrag);
petLifetime.listen(window, 'pointercancel', endDrag);

petLifetime.listen(window, 'contextmenu', (event) => {
  event.preventDefault();
  if (event.target !== canvas) { return; }
  togglePanel();
});

// Drag-and-drop file eating (§B10): files dropped on her are "eaten" — a
// reaction line plus a care bump, counted in stats. Files are NEVER read
// or deleted; the click-through window must already be interactive (the
// hover pass that precedes a drop does that via petBounds).
petLifetime.listen(window, 'dragover', (event) => {
  if (event.dataTransfer && Array.from(event.dataTransfer.types || [])
      .includes('Files') && overBody(event.clientX, event.clientY)) {
    event.preventDefault(); // required, or the drop is rejected
    event.dataTransfer.dropEffect = 'copy';
  }
});
petLifetime.listen(window, 'drop', (event) => {
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

petLifetime.listen(window, 'resize', resizeCanvas);

// kind: 'rice' (白米饭 menu feed) | 'token' (growth feed — glowing crystal).
