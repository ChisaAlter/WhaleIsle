'use strict';

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

