'use strict';

// Care stats for the live2d pet — 饱食度 / 心情值 / 亲密度, the QQ-pet
// lineage adapted to the whale girl. Pure logic, no I/O: state lives in
// config.live2dPet.stats and every read folds elapsed time in lazily, so
// nothing ticks while the app is closed but she still gets hungry
// overnight (decay is a pure function of `now`).
//
// Effects (wired in the renderer/main, not here):
//   satiety < 20   → idle chatter draws from the `hungry` pool
//   mood   < 25    → tease backfires (angry still + `grumpy` pool)
//   affection Lv≥3 → idle chatter draws from the `clingy` pool
// and the status panel renders all three as bars.

const STAT_MAX = 100;
const MOOD_BASELINE = 62; // mean-reversion target — she is lazy, not hype

// Per-hour drift. Satiety only falls; mood relaxes toward the baseline in
// whichever direction. Affection never decays.
const SATIETY_PER_HOUR = -3;    // full → empty in ~33h: feed her daily
const MOOD_SETTLE_PER_HOUR = 8;
const MAX_OFFLINE_HOURS = 72;   // cap so a week away isn't instant-empty×20

// One affection point per N minutes of the same care kind — spam-patting
// gives a quarter-rate trickle instead of farming the bond.
const AFFECTION_COOLDOWN_MS = 10 * 60 * 1000;
const AFFECTION_COOLDOWN_RATE = 0.25;

const AFFECTION_LEVELS = [
  { at: 0, name: '陌生' },
  { at: 40, name: '相识' },
  { at: 120, name: '亲近' },
  { at: 260, name: '信赖' },
  { at: 520, name: '形影不离' },
];

// kind → {satiety, mood, affection} deltas. `tease` flips sign when she is
// already grumpy (mood < 25): teasing an upset whale just upsets her more.
const CARE = {
  feedToken: { satiety: 45, mood: 12, affection: 5 },
  play: { satiety: -8, mood: 14, affection: 3 }, // play burns calories
  pat: { mood: 10, affection: 4 },
  tease: { mood: 6, affection: 2 },
  come: { mood: 4, affection: 3 },
  throw: { mood: -9, affection: 1 }, // roughhousing: dizzy but attended to
  poke: { mood: 2, affection: 1 },
  wake: { mood: -7 }, // poked awake mid-nap
  fileEat: { satiety: 2, mood: 1 }, // files dropped on her — she "eats" them
};

function clampStat(v) {
  return Math.max(0, Math.min(STAT_MAX, v));
}

function normalizeStats(value, now = Date.now()) {
  const source = value && typeof value === 'object' ? value : {};
  const stat = (v, dflt) => (Number.isFinite(v) ? clampStat(Math.round(v)) : dflt);
  const care = {};
  if (source.care && typeof source.care === 'object') {
    for (const [k, ts] of Object.entries(source.care)) {
      if (CARE[k] && Number.isFinite(ts) && ts >= 0) {
        care[k] = ts;
      }
    }
  }
  return {
    satiety: stat(source.satiety, 70),
    mood: stat(source.mood, 70),
    affection: Number.isFinite(source.affection) && source.affection >= 0
      ? Math.floor(source.affection) : 0,
    lastTick: Number.isFinite(source.lastTick) && source.lastTick > 0
      ? source.lastTick : now,
    care,
  };
}

// Fold elapsed hours into satiety/mood. lastTick always advances so each
// read is O(1) regardless of how long she sat alone.
function decayStats(state, now = Date.now()) {
  const s = normalizeStats(state, now);
  const hours = Math.min(MAX_OFFLINE_HOURS, Math.max(0, (now - s.lastTick) / 3600000));
  if (hours <= 0) {
    return s;
  }
  const mood = s.mood + Math.sign(MOOD_BASELINE - s.mood)
    * Math.min(Math.abs(MOOD_BASELINE - s.mood), MOOD_SETTLE_PER_HOUR * hours);
  return {
    ...s,
    satiety: clampStat(s.satiety + SATIETY_PER_HOUR * hours),
    mood: clampStat(mood),
    lastTick: now,
  };
}

function affectionLevel(points) {
  let idx = 0;
  for (let i = 0; i < AFFECTION_LEVELS.length; i += 1) {
    if (points >= AFFECTION_LEVELS[i].at) {
      idx = i;
    }
  }
  return idx;
}

// Apply one care action. Returns {state, affectionScaled} — the caller can
// ignore the flag; tests use it to pin the anti-farm cooldown.
function applyCare(state, kind, now = Date.now()) {
  const delta = CARE[kind];
  const s = decayStats(state, now);
  if (!delta) {
    return { state: s, affectionScaled: false };
  }
  let mood = delta.mood || 0;
  let affection = delta.affection || 0;
  if (kind === 'tease' && s.mood < 25) {
    mood = -4;
    affection = 0;
  }
  const lastSame = s.care[kind];
  const affectionScaled = affection > 0
    && Number.isFinite(lastSame) && now - lastSame < AFFECTION_COOLDOWN_MS;
  if (affectionScaled) {
    affection = Math.floor(affection * AFFECTION_COOLDOWN_RATE);
  }
  const next = {
    ...s,
    satiety: clampStat(s.satiety + (delta.satiety || 0)),
    mood: clampStat(s.mood + mood),
    affection: s.affection + Math.max(0, affection),
    care: { ...s.care, [kind]: now },
  };
  return { state: next, affectionScaled };
}

function satietyLabel(v) {
  if (v >= 75) { return '肚肚圆滚滚'; }
  if (v >= 45) { return '不饿'; }
  if (v >= 20) { return '有点饿'; }
  return '饿扁了';
}

function moodLabel(v) {
  if (v >= 80) { return '超开心'; }
  if (v >= 55) { return '心情不错'; }
  if (v >= 30) { return '蔫蔫的'; }
  return '闹别扭中';
}

// Display-ready snapshot. `hearts` is filled count out of 5.
function statsSnapshot(state, now = Date.now()) {
  const s = decayStats(state, now);
  const lv = affectionLevel(s.affection);
  const next = lv + 1 < AFFECTION_LEVELS.length ? AFFECTION_LEVELS[lv + 1].at : null;
  return {
    satiety: s.satiety,
    mood: s.mood,
    affection: s.affection,
    affectionLevel: lv + 1,
    affectionName: AFFECTION_LEVELS[lv].name,
    affectionBase: AFFECTION_LEVELS[lv].at,
    affectionNext: next,
    hearts: lv + 1,
    satietyLabel: satietyLabel(s.satiety),
    moodLabel: moodLabel(s.mood),
  };
}

module.exports = {
  normalizeStats,
  AFFECTION_LEVELS,
  CARE,
  decayStats,
  applyCare,
  affectionLevel,
  satietyLabel,
  moodLabel,
  statsSnapshot,
};
