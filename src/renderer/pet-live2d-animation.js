'use strict';

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
