'use strict';

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
  petLifetime.keep(petShell.onLayout?.((layout) => {
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
  }));
  // While click-through, no DOM mouse events reach this page — the main
  // process polls the real cursor and pushes window-local positions through
  // here. `inside:false` means the pointer left the overlay entirely: run
  // the exit path with a far-away point so a resting hover can't wedge the
  // fullscreen window interactive.
  petLifetime.keep(petShell.onCursor?.((cur) => {
    if (!cur) {
      return;
    }
    if (cur.inside === false) {
      onCursorMove(-1e9, -1e9, null);
    } else if (Number.isFinite(cur.x) && Number.isFinite(cur.y)) {
      onCursorMove(cur.x, cur.y, null);
    }
  }));
  petLifetime.keep(petShell.onMove?.((pos) => {
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) {
      return;
    }
    drawPos = { x: pos.x - overlayOrigin.x, y: pos.y - overlayOrigin.y };
    clampDrawPos();
    requestFrame();
  }));
  petLifetime.keep(petShell.onGrowth?.(onGrowthPush));
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
  petLifetime.keep(petShell.onSettings?.((s) => {
    if (s && typeof s === 'object') { applySettings(s); }
  }));
  // DSH link channels (R2 — handlers land with that work; subscriptions
  // are safe no-ops until main starts pushing).
  petLifetime.keep(petShell.onDsh?.((ev) => onDshEvent(ev)));
  petLifetime.keep(petShell.onAlert?.((al) => onDshAlert(al)));
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
  petLifetime.timeout(() => say('greet'), 1200);
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
    petLifetime.frame(loop);
  };
  renderLoopActive = true;
  petLifetime.frame(loop);
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
