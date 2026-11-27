'use strict';

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
  return settings.powerSave && !interactive && now - idle.lastInteract > 60000;
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
  })).catch((error) => { console.warn('[src/renderer/pet-live2d.js] background operation failed', error); });
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
      say(res && res.ok === true ? 'settingsOpened' : 'dshError', undefined, undefined, 0);
    }).catch(() => say('dshError', undefined, undefined, 0));
  } else if (cell.id === 'chat') {
    toggleChat(true);
  } else if (cell.id === 'look') {
    void submitLook();
  } else if (cell.id === 'hide') {
    void Promise.resolve(petShell.hidePet?.()).catch((error) => { console.warn('[src/renderer/pet-live2d.js] background operation failed', error); });
  } else {
    runAction(cell.id);
  }
}

// Quick-chat dialog: a DOM card anchored to her head, re-anchored every
// frame while open so it follows her anywhere (drag, wander, come). DOM is
// required for real IME input — and the overlay window is focusable:false,
// so opening asks main to flip setFocusable+focus, closing restores it.
// 「看看」往返要几秒——点下立刻给「正在看」加载气泡，结果/错误到了原位顶掉。
// lookBusyUntil 兼作防重入：在途期间为 Infinity，重复点击只保住现有气泡，
// 不发第二次请求（主进程另有 4s 冷却兜底）。
const LOOK_FEEDBACK_MS = 46000; // covers the plugin-side 45s deadline
let lookBusyUntil = 0;
let lookAnimTimer = 0;
function stopLookAnim() {
  if (lookAnimTimer) { petLifetime.clearInterval(lookAnimTimer); lookAnimTimer = 0; }
}
function startLookAnim() {
  if (lookAnimTimer) { return; }
  lookAnimTimer = petLifetime.interval(() => {
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
