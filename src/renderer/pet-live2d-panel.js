'use strict';

// ── status panel (replaces the native context menu) ──
// Right-click opens a pet-game status card: avatar + level pill +
// affection hearts, a real growth bar, three care-stat bars (饱食/心情/
// 亲密 — QQ-pet lineage), and a 2×3 action grid — all drawn and hit-tested
// on this canvas. While open the panel's rect joins petBounds(), so
// hovering the card still counts as "on the pet" and the overlay stays
// interactive — that is what lets the chips take clicks.
const PANEL_W = 214;
const PANEL_PAD = 12;
const PANEL_HEAD_H = 40;   // avatar + name + relation line
const PANEL_GROWTH_H = 96; // label + bar + next-level + today + fed + feed button
const PANEL_FEED_TOP = 70; // stats center 52 + half-line 6 + 12px gap
const PANEL_FEED_H = 20;
const PANEL_STAT_H = 20;   // per care-stat row
const PANEL_CHIP_H = 28;
const PANEL_CHIP_GAP = 6;
const PANEL_CHIP_W = (PANEL_W - PANEL_PAD * 2 - PANEL_CHIP_GAP) / 2;
// Grid top tracks the drawPanel layout: header(div1) + growth + stats(div3) + 6px.
const PANEL_GRID_TOP = PANEL_PAD + PANEL_HEAD_H + 2 + 6 + PANEL_GROWTH_H + 4
  + 6 + PANEL_STAT_H * 3 + 4 + 6;
// Panel actions — the functional set only. The one-shot flavor verbs
// (玩耍/摸头/逗她) were cut: 摸头 still fires on a direct head click, and
// the care stats move through feeding/chat/sleep anyway. 喂食 lives in the
// growth block next to the token stats (it IS the token-feed action).
const PANEL_ACTIONS = [
  { id: 'chat', icon: '💬', label: '聊聊' },
  { id: 'look', icon: '👀', label: '看看' },
  { id: 'pat', icon: '🫳', label: '摸摸头' },
  { id: 'nap', icon: '💤', label: '睡觉' },
  { id: 'settings', icon: '⚙', label: '设置' },
  { id: 'hide', icon: '🌙', label: '隐藏' },
];
// Grid rows follow the action list — 6 cells = 3 rows.
const PANEL_ROWS = Math.ceil(PANEL_ACTIONS.length / 2);
const PANEL_H = PANEL_GRID_TOP + PANEL_CHIP_H * PANEL_ROWS
  + PANEL_CHIP_GAP * (PANEL_ROWS - 1) + PANEL_PAD;
const PANEL_STATS = [
  { id: 'satiety', icon: '🍚', label: '饱食' },
  { id: 'mood', icon: '😊', label: '心情' },
  { id: 'affection', icon: '💙', label: '亲密' },
];
let panel = null; // { x, y, w, h, cells, hover }

// Bounded close-reason trace. The unexplained 15s card closure was the last
// acceptance blocker, and it was unprovable without knowing WHICH path closed
// it: explicit dismissal, window recreation, a delayed callback, or the
// measurement script's own cleanup. Every open/close names its reason here.
const panelTrace = { entries: [], generation: 0 };
function tracePanel(event, detail) {
  panelTrace.generation += 1;
  panelTrace.entries.push({
    at: Math.round(performance.now()),
    event,
    generation: panelTrace.generation,
    detail: detail || null,
  });
  // Bounded: a long soak must not grow this without limit.
  if (panelTrace.entries.length > 120) { panelTrace.entries.shift(); }
  if (petPerf.enabled) { petPerf.bump(`panel:${event}`); }
  console.log(`pet: panel ${event}`, detail || '');
}

// The status card is the most expensive thing on this surface (text metrics,
// gradient fills, ten rungs, six chips) yet it only changes on real edges.
// Paint it once into an offscreen raster and blit that every frame instead of
// re-running the painter: the card stays on top of a walking character with
// no holes punched by her clear rect, while the per-frame cost collapses to
// one clearRect + one drawImage.
const PANEL_PAD_MARGIN = 20; // raster + clear margin around the card box
// The ✕ lives INSIDE the header row, on the title line's right edge, and only
// appears while the pointer is over the card. It is a quiet affordance, not a
// floating badge hanging off the corner: nothing pokes out of the silhouette,
// so the card reads as one card instead of a card with an extra button glued
// to it. The header reserves its width even when hidden, so nothing reflows.
const PANEL_CLOSE_SIZE = 22;  // square hit/draw box, header-aligned
const PANEL_CLOSE_X = PANEL_W - PANEL_PAD - PANEL_CLOSE_SIZE;
const PANEL_CLOSE_Y = PANEL_PAD;
const panelCache = { canvas: null, ctx: null, key: '', x: 0, y: 0, w: 0, h: 0 };

// The ✕ close affordance: an explicit dismissal that does not depend on the
// pointer leaving (the old behaviour destroyed the card the moment the cursor
// strayed past the body/panel gap, which made its buttons unclickable).
function panelCloseRect() {
  if (!panel) { return null; }
  return {
    x: panel.x + PANEL_CLOSE_X,
    y: panel.y + PANEL_CLOSE_Y,
    w: PANEL_CLOSE_SIZE,
    h: PANEL_CLOSE_SIZE,
  };
}
function panelCloseHit(x, y) {
  const r = panelCloseRect();
  return Boolean(r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// Reveal state for the header ✕. Kept beside the card so the raster key picks
// it up. The glyph is quiet while the pointer is anywhere on the card, then
// stresses when the pointer enters the hit box — a card with no visible close
// control is just as broken as one with a glued-on badge.
let closeHover = false;
let closeVisible = false;

// 大数简写：≥1亿 → x.x亿（去尾零），≥1万 → x.x万，以下原样本地化。
function fmtTokens(n) {
  const v = Number(n || 0);
  const short = (x, unit) => `${(x).toFixed(1).replace(/\.0$/, '')}${unit}`;
  if (v >= 1e8) { return short(v / 1e8, '亿'); }
  if (v >= 1e4) { return short(v / 1e4, '万'); }
  return v.toLocaleString('en-US');
}

// Rebuild the chips from the latest growth snapshot (feedable count).
// Rebuild the chips from the latest nap state. 喂食 lives in the growth
// block, not the grid. 「看看」needs a configured vision model — without one
// the main side refuses before capturing, so the cell stays hidden rather
// than showing a button that always plays the fallback line.
function panelCells() {
  return PANEL_ACTIONS
    .filter((a) => a.id !== 'look' || settings.lookAvailable === true)
    .map((a) => ({
      ...a,
      label: a.id === 'nap' && sleeping ? '叫醒' : a.label,
      enabled: true,
    }));
}

function openPanel() {
  const b = petBounds();
  const host = homeRect || { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
  const hostY = host.y ?? 0;
  const h = PANEL_H;
  // Anchor beside her bounds, flipping left at the screen edge.
  let x = b.right + 8;
  if (x + PANEL_W > host.x + host.width - 4) {
    x = b.x - PANEL_W - 8;
  }
  x = Math.min(Math.max(x, host.x + 4), host.x + host.width - PANEL_W - 4);
  // The ✕ is inside the card now, so the card needs no headroom above it.
  const y = Math.min(Math.max(b.y, hostY + 4),
    hostY + host.height - h - 4);
  panel = { x, y, w: PANEL_W, h, cells: panelCells(), hover: -1, feedHover: false };
  closeHover = false;
  closeVisible = false;
  tracePanel('open', { x: Math.round(x), y: Math.round(y) });
  console.log(`pet: panel open x=${x} y=${y} w=${PANEL_W} h=${h} bounds=${JSON.stringify(b)}`);
  // Fresh snapshot so the feedable count and stats are real, not stale.
  void Promise.resolve(petShell.getGrowth?.()).then((snap) => {
    if (snap && panel) {
      growth = snap;
      if (snap.stats) { stats = snap.stats; }
      panel.cells = panelCells();
      requestFrame();
    }
  }).catch((error) => { console.warn('[src/renderer/pet-live2d.js] background operation failed', error); });
  requestFrame();
}

function closePanel(reason = 'unspecified') {
  if (!panel) {
    return;
  }
  tracePanel('close', reason);
  panel = null;
  requestFrame();
}

// Right-click is the deliberate toggle (see the contextmenu listener): the
// card is opened by an explicit right-click and closed by the next one.
function togglePanel() {
  if (panel) { closePanel('right-click-toggle'); } else { openPanel(); }
}

// Everything the raster depends on. Cheap to compute (a handful of token
// reads) and it makes the cache self-invalidating: no producer has to remember
// to poke it when growth, stats, hover, theme, DPR or the avatar change.
function panelCacheKey() {
  const css = (name) => bubbleStyle.getPropertyValue(name);
  return [
    panel.x, panel.y, panel.w, panel.h, panel.hover, panel.feedHover ? 1 : 0,
    closeHover ? 1 : 0, closeVisible ? 1 : 0,
    sleeping ? 1 : 0, dshState,
    settings.lookAvailable === true ? 1 : 0,
    window.devicePixelRatio || 1, stillEpoch,
    css('--dsw-font-family'), css('--dsw-alias-bg-layer-1'),
    css('--dsw-alias-border-l2'), css('--dsw-alias-label-primary'),
    css('--dsw-alias-state-business-primary'),
    css('--dsw-alias-state-error-primary'),
    css('--dsw-alias-state-success-primary'),
    growth ? [growth.points, growth.level, growth.levelName, growth.nextAt,
      growth.nextName, growth.nextFeed, growth.tokensFed, growth.todayUsed,
      growth.levelColor].join(',') : '',
    stats ? [stats.satiety, stats.mood, stats.affection, stats.hearts,
      stats.affectionName, stats.affectionLevel, stats.affectionBase,
      stats.affectionNext].join(',') : '',
    panel.cells.map((c) => `${c.id}:${c.icon}:${c.label}:${c.enabled}`).join('|'),
  ].join('~');
}

// Blit the cached card. Rebuilds the raster only when the key changes; returns
// the ink rect so `paint()` can register the clear region.
function blitPanel() {
  if (!panel) { return null; }
  const pad = PANEL_PAD_MARGIN;
  const w = Math.ceil(panel.w + pad * 2);
  const h = Math.ceil(panel.h + pad * 2);
  const x = panel.x - pad;
  const y = panel.y - pad;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  const key = panelCacheKey();
  if (panelCache.key !== key || !panelCache.canvas
      || panelCache.canvas.width !== bw || panelCache.canvas.height !== bh) {
    if (!panelCache.canvas) {
      panelCache.canvas = document.createElement('canvas');
      panelCache.ctx = panelCache.canvas.getContext('2d');
    }
    const c = panelCache.ctx;
    panelCache.canvas.width = bw;
    panelCache.canvas.height = bh;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.save();
    c.translate(-x, -y);
    // Reuse the one painter by swapping the shared 2D context for the length
    // of this synchronous build; restored in `finally`.
    const prevCtx = ctx2d;
    ctx2d = c;
    try {
      drawPanel();
    } finally {
      ctx2d = prevCtx;
      c.restore();
    }
    panelCache.key = key;
  }
  panelCache.x = x;
  panelCache.y = y;
  panelCache.w = w;
  panelCache.h = h;
  ctx2d.drawImage(panelCache.canvas, x, y, w, h);
  return { x, y, w, h };
}

function statFill(v, warnAt, goodAt, css) {
  if (v < warnAt) { return css('--dsw-alias-state-error-primary'); }
  if (v >= goodAt) { return css('--dsw-alias-state-success-primary'); }
  return css('--dsw-alias-state-business-primary');
}

function drawPanel() {
  if (!panel) {
    return null;
  }
  const p = panel;
  const g = growth;
  const st = stats;
  const css = (name) => bubbleStyle.getPropertyValue(name);
  const label = css('--dsw-alias-label-primary');
  // Runs center on their real ink box: 'middle' baseline trusts the
  // primary font's metrics, which lands emoji ~2px high and CJK a hair
  // off — measure each run and drop its ink center on the target midline.
  const mid = (text, x, y, align = 'left') => {
    ctx2d.textAlign = align;
    ctx2d.textBaseline = 'alphabetic';
    const m = ctx2d.measureText(String(text));
    const measured = Number.isFinite(m.actualBoundingBoxAscent) && Number.isFinite(m.actualBoundingBoxDescent);
    ctx2d.textBaseline = measured ? 'alphabetic' : 'middle';
    const rise = measured ? (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 : 0;
    const shift = align === 'center' && Number.isFinite(m.actualBoundingBoxLeft) && Number.isFinite(m.actualBoundingBoxRight)
      ? (m.actualBoundingBoxLeft - m.actualBoundingBoxRight) / 2 : 0;
    ctx2d.fillText(text, x + shift, y + rise);
  };
  const dim = (text, x, y, alpha = 0.55) => {
    ctx2d.globalAlpha = alpha;
    ctx2d.fillStyle = label;
    mid(text, x, y);
    ctx2d.globalAlpha = 1;
  };
  ctx2d.save();
  ctx2d.textAlign = 'left';
  ctx2d.textBaseline = 'alphabetic';
  const font = css('--dsw-font-family');
  const padL = p.x + PANEL_PAD;
  const right = p.x + p.w - PANEL_PAD;
  // Card body: flat fill + hairline — no drop shadow. On a transparent
  // layered window a shadow is a dark halo around the card, and whatever
  // bleeds past the returned clear rect repaints every frame, compounding
  // into a near-solid black frame that stays on screen after close.
  ctx2d.beginPath();
  ctx2d.roundRect(p.x, p.y, p.w, p.h, 12);
  ctx2d.fillStyle = css('--dsw-alias-bg-layer-1');
  ctx2d.fill();
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.lineWidth = 1;
  ctx2d.stroke();

  // Level theme color — the growth ladder's visual identity. Used on the
  // level badge, growth bar fill, tier dots, and feed button so the whole
  // card shifts hue as she matures.
  const lvlColor = (g && g.levelColor) || css('--dsw-alias-state-business-primary');

  // ── header: avatar / name / level badge / hearts ──
  const avC = { x: padL + 18, y: p.y + PANEL_PAD + 18, r: 18 };
  ctx2d.beginPath();
  ctx2d.arc(avC.x, avC.y, avC.r, 0, Math.PI * 2);
  ctx2d.fillStyle = lvlColor;
  ctx2d.globalAlpha = 0.14;
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  const greet = stills.get('greet');
  if (greet && greet.box) {
    const hb = greet.box;
    const sw = hb.right - hb.x;
    const sh = hb.bottom - hb.y;
    const sx = hb.x + sw * 0.18;
    const sy = hb.y;
    const sd = Math.min(sw * 0.64, sh * 0.5);
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(avC.x, avC.y, avC.r - 1, 0, Math.PI * 2);
    ctx2d.clip();
    ctx2d.drawImage(greet.img, sx, sy, sd, sd,
      avC.x - avC.r + 1, avC.y - avC.r + 1, (avC.r - 1) * 2, (avC.r - 1) * 2);
    ctx2d.restore();
  } else {
    ctx2d.font = `20px ${font}`;
    mid('🐋', avC.x, avC.y, 'center');
  }
  const nameX = padL + 44;
  ctx2d.font = `600 13px ${font}`;
  ctx2d.fillStyle = label;
  mid('鲸鱼娘', nameX, p.y + PANEL_PAD + 9);
  // DSH link state dot: while the watcher sees an open turn or fresh log
  // traffic, a soft teal 「陪伴中」rides next to her name.
  const nameW = ctx2d.measureText('鲸鱼娘').width;
  const dotX = nameX + nameW + 8;
  const dotOn = dshState === 'working';
  ctx2d.beginPath();
  ctx2d.arc(dotX, p.y + PANEL_PAD + 9, 3, 0, Math.PI * 2);
  ctx2d.fillStyle = dotOn
    ? css('--dsw-alias-state-business-primary')
    : css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = dotOn ? 1 : 0.5;
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  if (dotOn) {
    ctx2d.font = `9px ${font}`;
    dim('工作中', dotX + 6, p.y + PANEL_PAD + 9);
    ctx2d.font = `600 13px ${font}`;
  }
  // Level badge — filled pill in the tier color, not a flat outline.
  if (g) {
    ctx2d.font = `600 10px ${font}`;
    const pill = `Lv.${g.level} ${g.levelName}`;
    const pw = ctx2d.measureText(pill).width + 14;
    // The header's right edge belongs to the ✕, so the badge ends before it
    // instead of underneath. The ✕ is hidden until hover, but the badge must
    // not shift when it appears.
    const badgeRight = p.x + PANEL_CLOSE_X - 6;
    ctx2d.beginPath();
    ctx2d.roundRect(badgeRight - pw, p.y + PANEL_PAD + 1, pw, 16, 8);
    ctx2d.fillStyle = lvlColor;
    ctx2d.globalAlpha = 0.18;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = lvlColor;
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.roundRect(badgeRight - pw, p.y + PANEL_PAD + 1, pw, 16, 8);
    ctx2d.stroke();
    ctx2d.fillStyle = lvlColor;
    mid(pill, badgeRight - pw + 7, p.y + PANEL_PAD + 9);
  }
  // Relation line: filled/open hearts + stage name.
  ctx2d.font = `10px ${font}`;
  const hearts = st ? '♥'.repeat(st.hearts) + '♡'.repeat(5 - st.hearts) : '♡♡♡♡♡';
  ctx2d.fillStyle = css('--dsw-alias-state-error-primary');
  mid(hearts, nameX, p.y + PANEL_PAD + 27);
  dim(` ${st ? st.affectionName : ''}`,
    nameX + ctx2d.measureText(hearts).width + 4, p.y + PANEL_PAD + 27);

  // ── divider: header → growth ──
  const div1Y = p.y + PANEL_PAD + PANEL_HEAD_H + 2;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div1Y);
  ctx2d.lineTo(right, div1Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── growth block: label / bar with tier dots / next-level / token stats / feed CTA ──
  const gy = div1Y + 6;
  ctx2d.font = `10px ${font}`;
  dim('成长值', padL, gy + 6);
  const gNum = g ? `${fmtTokens(g.points)}${g.nextAt ? ` / ${fmtTokens(g.nextAt)}` : ''}` : '';
  ctx2d.globalAlpha = 0.55;
  ctx2d.fillStyle = label;
  mid(gNum, right - ctx2d.measureText(gNum).width, gy + 6);
  ctx2d.globalAlpha = 1;
  // Growth bar: deep slot + tier-colored fill + tier dots marking the 6
  // ladder rungs so the player sees the whole path, not just this level.
  const barY = gy + 14;
  const barW = p.w - PANEL_PAD * 2;
  ctx2d.fillStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.4;
  ctx2d.beginPath();
  ctx2d.roundRect(padL, barY, barW, 9, 4.5);
  ctx2d.fill();
  ctx2d.globalAlpha = 1;
  // Fill = progress inside the CURRENT level (level-local), so the bar is
  // honest at every rung of the 10-level ladder instead of asymptoting
  // toward a distant final threshold.
  const curAt = g && g.levels && g.levels[g.level - 1] ? g.levels[g.level - 1].at : 0;
  const frac = g && g.nextAt
    ? Math.min(1, Math.max(0, (g.points - curAt) / (g.nextAt - curAt))) : 1;
  ctx2d.fillStyle = lvlColor;
  ctx2d.beginPath();
  ctx2d.roundRect(padL, barY, Math.max(4, barW * frac), 9, 4.5);
  ctx2d.fill();
  // Tier dots: rungs at EQUAL spacing across the bar — with 10 levels the
  // thresholds span 0→200亿 and a true scale would crush the early rungs
  // into the left edge. Reached rungs are solid tier color, future rungs
  // are dim. The current rung gets a ring.
  if (g && g.levels) {
    const slots = Math.max(1, g.levels.length - 1);
    for (let i = 0; i < g.levels.length; i += 1) {
      const dotX = padL + (i / slots) * barW;
      const reached = g.points >= g.levels[i].at;
      const current = i === g.level - 1;
      ctx2d.beginPath();
      ctx2d.arc(dotX, barY + 4.5, current ? 3 : 2, 0, Math.PI * 2);
      if (current) {
        ctx2d.fillStyle = css('--dsw-alias-bg-layer-1');
        ctx2d.fill();
        ctx2d.strokeStyle = lvlColor;
        ctx2d.lineWidth = 1.5;
        ctx2d.beginPath();
        ctx2d.arc(dotX, barY + 4.5, 3, 0, Math.PI * 2);
        ctx2d.stroke();
      } else {
        ctx2d.fillStyle = reached ? lvlColor : css('--dsw-alias-border-l2');
        ctx2d.globalAlpha = reached ? 1 : 0.5;
        ctx2d.fill();
        ctx2d.globalAlpha = 1;
      }
    }
  }
  dim(g
    ? (g.nextAt
      ? `→ 再长 ${fmtTokens(g.nextAt - g.points)} 点升「${g.nextName}」`
      : `${g.levelName} · 已加满`)
    : '成长值读取中…', padL, gy + 34);
  // Token accounting: today's burn + cumulative fed, side by side.
  const todayUsed = g && Number.isFinite(g.todayUsed) ? fmtTokens(g.todayUsed) : '0';
  const fed = g ? fmtTokens(g.tokensFed) : '0';
  ctx2d.font = `10px ${font}`;
  const halfW = (p.w - PANEL_PAD * 2) / 2;
  ctx2d.fillStyle = css('--dsw-alias-state-business-primary');
  mid('⚡', padL, gy + 52);
  dim(`今日 ${todayUsed}`, padL + 13, gy + 52);
  ctx2d.fillStyle = lvlColor;
  mid('🍚', padL + halfW, gy + 52);
  dim(`已投喂 ${fed}`, padL + halfW + 13, gy + 52);
  // Feed CTA — game-style button: tier-colored gradient fill + border +
  // hover brighten. Disabled state greys out.
  const feedable = Boolean(g && g.nextFeed > 0);
  const feedLabel = feedable ? `投喂 +${fmtTokens(g.nextFeed)}` : '无算力可喂';
  const btnY = gy + PANEL_FEED_TOP;
  const btnH = PANEL_FEED_H;
  const btnX = padL;
  const btnW = p.w - PANEL_PAD * 2;
  const btnHover = p.feedHover && feedable;
  ctx2d.save();
  if (feedable) {
    ctx2d.globalAlpha = btnHover ? 0.28 : 0.18;
    ctx2d.fillStyle = lvlColor;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.fill();
    ctx2d.globalAlpha = btnHover ? 0.9 : 0.6;
    ctx2d.strokeStyle = lvlColor;
    ctx2d.lineWidth = 1.5;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
    ctx2d.fillStyle = lvlColor;
  } else {
    ctx2d.globalAlpha = 0.08;
    ctx2d.fillStyle = css('--dsw-alias-border-l2');
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.fill();
    ctx2d.globalAlpha = 0.4;
    ctx2d.strokeStyle = css('--dsw-alias-border-l2');
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.roundRect(btnX, btnY, btnW, btnH, 10);
    ctx2d.stroke();
    ctx2d.globalAlpha = 0.5;
    ctx2d.fillStyle = label;
  }
  ctx2d.font = `600 11px ${font}`;
  mid(feedLabel, btnX + btnW / 2, btnY + btnH / 2, 'center');
  ctx2d.restore();

  // ── divider: growth → care stats ──
  const div2Y = gy + PANEL_GROWTH_H + 4;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div2Y);
  ctx2d.lineTo(right, div2Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── care stats: fixed columns — icon | label | bar | state text ──
  // Bar is a deep slot + colored fill (game HUD style), not a flat block.
  const sy = div2Y + 6;
  const STAT_LABEL_X = padL + 18;
  const STAT_BAR_X = padL + 50;
  const STAT_BAR_W = 70;
  const STAT_TEXT_X = STAT_BAR_X + STAT_BAR_W + 6;
  PANEL_STATS.forEach((row, i) => {
    const ry = sy + i * PANEL_STAT_H + PANEL_STAT_H / 2;
    ctx2d.font = `11px ${font}`;
    mid(row.icon, padL, ry);
    ctx2d.fillStyle = label;
    mid(row.label, STAT_LABEL_X, ry);
    // Deep slot
    ctx2d.fillStyle = css('--dsw-alias-border-l2');
    ctx2d.globalAlpha = 0.4;
    ctx2d.beginPath();
    ctx2d.roundRect(STAT_BAR_X, ry - 3, STAT_BAR_W, 6, 3);
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    let frac2 = 0;
    let txt = '—';
    let fill = css('--dsw-alias-state-business-primary');
    if (row.id === 'satiety' && st) {
      frac2 = st.satiety / 100; txt = st.satietyLabel;
      fill = statFill(st.satiety, 20, 75, css);
    } else if (row.id === 'mood' && st) {
      frac2 = st.mood / 100; txt = st.moodLabel;
      fill = statFill(st.mood, 30, 80, css);
    } else if (row.id === 'affection' && st) {
      frac2 = st.affectionNext
        ? (st.affection - st.affectionBase) / (st.affectionNext - st.affectionBase) : 1;
      txt = `Lv${st.affectionLevel}`;
    }
    // Colored fill
    ctx2d.fillStyle = fill;
    ctx2d.beginPath();
    ctx2d.roundRect(STAT_BAR_X, ry - 3,
      Math.max(3, STAT_BAR_W * Math.max(0, Math.min(1, frac2))), 6, 3);
    ctx2d.fill();
    ctx2d.textAlign = 'left';
    dim(txt, STAT_TEXT_X, ry);
  });

  // ── divider: care stats → action grid ──
  const div3Y = sy + PANEL_STAT_H * 3 + 4;
  ctx2d.strokeStyle = css('--dsw-alias-border-l2');
  ctx2d.globalAlpha = 0.5;
  ctx2d.lineWidth = 1;
  ctx2d.beginPath();
  ctx2d.moveTo(padL, div3Y);
  ctx2d.lineTo(right, div3Y);
  ctx2d.stroke();
  ctx2d.globalAlpha = 1;

  // ── action chips: 2 × 3 grid — outlined cards with hover fill ──
  ctx2d.font = `11px ${font}`;
  p.cells.forEach((cell, i) => {
    const cx = padL + (i % 2) * (PANEL_CHIP_W + PANEL_CHIP_GAP);
    const cy = div3Y + 6 + Math.floor(i / 2) * (PANEL_CHIP_H + PANEL_CHIP_GAP);
    if (i === p.hover && cell.enabled !== false) {
      ctx2d.fillStyle = lvlColor;
      ctx2d.globalAlpha = 0.12;
      ctx2d.beginPath();
      ctx2d.roundRect(cx, cy, PANEL_CHIP_W, PANEL_CHIP_H, 7);
      ctx2d.fill();
      ctx2d.globalAlpha = 1;
    }
    ctx2d.globalAlpha = cell.enabled === false ? 0.38 : 1;
    ctx2d.strokeStyle = i === p.hover && cell.enabled !== false
      ? lvlColor : css('--dsw-alias-border-l2');
    ctx2d.lineWidth = i === p.hover && cell.enabled !== false ? 1.5 : 1;
    ctx2d.beginPath();
    ctx2d.roundRect(cx, cy, PANEL_CHIP_W, PANEL_CHIP_H, 7);
    ctx2d.stroke();
    ctx2d.fillStyle = label;
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'alphabetic';
    const inkW = (mm) => (Number.isFinite(mm.actualBoundingBoxLeft) && Number.isFinite(mm.actualBoundingBoxRight)
      ? mm.actualBoundingBoxLeft + mm.actualBoundingBoxRight : mm.width);
    const iw = inkW(ctx2d.measureText(cell.icon));
    const lw = inkW(ctx2d.measureText(cell.label));
    const left = cx + (PANEL_CHIP_W - iw - 4 - lw) / 2;
    mid(cell.icon, left + iw / 2, cy + PANEL_CHIP_H / 2, 'center');
    mid(cell.label, left + iw + 4 + lw / 2, cy + PANEL_CHIP_H / 2, 'center');
    ctx2d.globalAlpha = 1;
  });
  // ── explicit dismissal: a ✕ inside the header, revealed on hover ──
  // The card no longer dies when the pointer strays; this is the affordance
  // that closes it (alongside the right-click toggle and every action chip).
  // It sits in the header's own row, so it is part of the card rather than a
  // badge glued outside it, and it stays hidden until the pointer is over the
  // card so an idle card is not wearing a permanent button. Quiet while the
  // pointer is on the card; emphasized only when the hit box itself is hot.
  if (closeVisible || closeHover) {
    const cr = panelCloseRect();
    const cx = cr.x + cr.w / 2;
    const cy = cr.y + cr.h / 2;
    // Quiet state must stay readable on the white card. Theme layer-2 is the
    // same white as the card body, so a filled quiet chip vanishes; draw only
    // a light hairline + secondary glyph until the hit box itself is hot.
    ctx2d.beginPath();
    ctx2d.roundRect(cr.x, cr.y, cr.w, cr.h, 6);
    if (closeHover) {
      ctx2d.globalAlpha = 0.95;
      ctx2d.fillStyle = css('--dsw-alias-state-error-primary');
      ctx2d.fill();
      ctx2d.strokeStyle = css('--dsw-alias-state-error-primary');
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.strokeStyle = css('--dsw-alias-bg-layer-1');
    } else {
      ctx2d.globalAlpha = 1;
      ctx2d.strokeStyle = css('--dsw-alias-border-l2');
      ctx2d.lineWidth = 1;
      ctx2d.stroke();
      ctx2d.strokeStyle = css('--dsw-alias-label-secondary');
      ctx2d.globalAlpha = 0.85;
    }
    ctx2d.lineWidth = 1.5;
    ctx2d.lineCap = 'round';
    const arm = PANEL_CLOSE_SIZE * 0.19;
    ctx2d.beginPath();
    ctx2d.moveTo(cx - arm, cy - arm);
    ctx2d.lineTo(cx + arm, cy + arm);
    ctx2d.moveTo(cx + arm, cy - arm);
    ctx2d.lineTo(cx - arm, cy + arm);
    ctx2d.stroke();
    ctx2d.lineCap = 'butt';
    ctx2d.globalAlpha = 1;
  }
  ctx2d.restore();
  // Clear margin must cover every painted pixel: 1px hairline stroke +
  // antialiased corners + emoji ink that can exceed its advance box, plus the
  // in-header ✕ (kept inside the card box, so the existing pad is enough).
  return { x: p.x - PANEL_PAD_MARGIN, y: p.y - PANEL_PAD_MARGIN,
    w: p.w + PANEL_PAD_MARGIN * 2, h: p.h + PANEL_PAD_MARGIN * 2 };
}

