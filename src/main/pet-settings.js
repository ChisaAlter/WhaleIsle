'use strict';

// Pet settings — pure logic layer: defaults, normalization, clamps.
// Persisted under config.live2dPet.settings; every field falls back to its
// default on garbage input so a corrupt config can never wedge the pet.
// No I/O here — the same shapes are mirrored renderer-side for instant UI.

const ACTIVITIES = ['quiet', 'balanced', 'active'];
const PERSONALITIES = ['natural', 'genki', 'tsundere', 'poison'];

const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;
const SCALE_STEP = 0.1;
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1.0;
const OPACITY_STEP = 0.05;

// One `activity` scalar drives both schedulers. Intervals are [min,max]
// seconds; the renderer picks uniform-random one-shot timers from the row.
const ACTIVITY_TABLE = {
  quiet: { talk: [360, 720], wander: [600, 1200] },
  balanced: { talk: [120, 240], wander: [300, 540] },
  active: { talk: [40, 80], wander: [120, 240] },
};

function defaultSettings() {
  return {
    scale: 1.0,
    opacity: 1.0,
    personality: 'natural',
    activity: 'balanced',
    selfTalk: true,
    wander: true,
    lockPosition: false,
    shiftToDrag: false,
    powerSave: false,
    clickSound: false,
    chatEnabled: true,
    approvalButtons: false,
    lookModel: '',
    lookProvider: '',
  };
}

// 「看看」vision route ids — free-form strings (provider/model ids like
// 'qwen-vl-max' or 'org/model'); trimmed and capped so a corrupt config can
// never smuggle an oversized payload. Empty model = feature off; empty
// provider means the wire call falls back to the desktop baseUrl.
const LOOK_MODEL_MAX = 128;
function lookModelOf(value, fallback) {
  return typeof value === 'string' ? value.trim().slice(0, LOOK_MODEL_MAX) : fallback;
}

function clampStep(value, lo, hi, step, fallback) {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    return fallback;
  }
  const snapped = Math.round(v / step) * step;
  // Float dust: 0.6+0.1*7 = 1.299999… — round to step precision.
  const fixed = Math.round(snapped * 100) / 100;
  return Math.min(hi, Math.max(lo, fixed));
}

function boolOf(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = defaultSettings();
  return {
    scale: clampStep(source.scale, SCALE_MIN, SCALE_MAX, SCALE_STEP, d.scale),
    opacity: clampStep(source.opacity, OPACITY_MIN, OPACITY_MAX, OPACITY_STEP, d.opacity),
    personality: PERSONALITIES.includes(source.personality) ? source.personality : d.personality,
    activity: ACTIVITIES.includes(source.activity) ? source.activity : d.activity,
    selfTalk: boolOf(source.selfTalk, d.selfTalk),
    wander: boolOf(source.wander, d.wander),
    lockPosition: boolOf(source.lockPosition, d.lockPosition),
    shiftToDrag: boolOf(source.shiftToDrag, d.shiftToDrag),
    powerSave: boolOf(source.powerSave, d.powerSave),
    clickSound: boolOf(source.clickSound, d.clickSound),
    chatEnabled: boolOf(source.chatEnabled, d.chatEnabled),
    approvalButtons: boolOf(source.approvalButtons, d.approvalButtons),
    lookModel: lookModelOf(source.lookModel, d.lookModel),
    lookProvider: lookModelOf(source.lookProvider, d.lookProvider),
  };
}

// Partial update against the CURRENT normalized state: only keys actually
// present in the patch are touched, and a garbage value falls back to the
// current value — a corrupt patch preserves, never resets.
function normalizePatch(current, patch) {
  const cur = normalizeSettings(current);
  const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const out = { ...cur };
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  if (has('scale')) { out.scale = clampStep(src.scale, SCALE_MIN, SCALE_MAX, SCALE_STEP, cur.scale); }
  if (has('opacity')) { out.opacity = clampStep(src.opacity, OPACITY_MIN, OPACITY_MAX, OPACITY_STEP, cur.opacity); }
  if (has('personality')) { out.personality = PERSONALITIES.includes(src.personality) ? src.personality : cur.personality; }
  if (has('activity')) { out.activity = ACTIVITIES.includes(src.activity) ? src.activity : cur.activity; }
  for (const k of ['selfTalk', 'wander', 'lockPosition', 'shiftToDrag',
    'powerSave', 'clickSound', 'chatEnabled', 'approvalButtons']) {
    if (has(k)) { out[k] = boolOf(src[k], cur[k]); }
  }
  if (has('lookModel')) { out.lookModel = lookModelOf(src.lookModel, cur.lookModel); }
  if (has('lookProvider')) { out.lookProvider = lookModelOf(src.lookProvider, cur.lookProvider); }
  return out;
}

// Activity table row for a (already-normalized) activity level; unknown
// values ride the balanced row so a stray string can never zero a timer.
function activityRow(activity) {
  return ACTIVITY_TABLE[activity] || ACTIVITY_TABLE.balanced;
}

// DSH-link watermarks — persisted under live2dPet.dsh so reminders and
// milestones never double-fire across restarts. `files`/`openTurns` are the
// watcher's tail cursors: byte offsets into append-only session logs and
// sessions whose latest turn has not closed yet.
function defaultDshState() {
  return {
    day: '',
    activeMsToday: 0,
    milestoneMarks: [],
    lastRestReminder: 0,
    lastGreetDay: '',
    files: {},
    openTurns: {},
    dayTokens: { day: '', used: 0 },
    activeSince: 0,
    lastActiveAt: 0,
    lastSeenAt: 0,
  };
}

function numMap(value, cap) {
  const out = {};
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof k !== 'string' || !k || !Number.isFinite(v) || v < 0) {
      continue;
    }
    out[k.slice(0, 400)] = Math.floor(v);
    if (Object.keys(out).length >= cap) {
      break;
    }
  }
  return out;
}

function normalizeDshState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const marks = Array.isArray(source.milestoneMarks)
    ? source.milestoneMarks.filter((n) => Number.isFinite(n) && n > 0).map(Math.floor)
    : [];
  const dayTokens = source.dayTokens && typeof source.dayTokens === 'object'
    ? source.dayTokens : {};
  const nonneg = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    day: typeof source.day === 'string' ? source.day : '',
    activeMsToday: nonneg(source.activeMsToday),
    milestoneMarks: [...new Set(marks)],
    lastRestReminder: nonneg(source.lastRestReminder),
    lastGreetDay: typeof source.lastGreetDay === 'string' ? source.lastGreetDay : '',
    // Tail cursors are capped so a long-lived sessions dir can't grow the
    // config file without bound; stale entries are pruned by the watcher.
    files: numMap(source.files, 400),
    openTurns: numMap(source.openTurns, 200),
    dayTokens: {
      day: typeof dayTokens.day === 'string' ? dayTokens.day : '',
      used: nonneg(dayTokens.used),
    },
    activeSince: nonneg(source.activeSince),
    lastActiveAt: nonneg(source.lastActiveAt),
    lastSeenAt: nonneg(source.lastSeenAt),
  };
}

// Files she has "eaten" — stats only, the files themselves are never
// touched. history is capped at 50 entries.
function normalizeFileEaten(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const history = (Array.isArray(source.history) ? source.history : [])
    .filter((e) => e && typeof e === 'object' && typeof e.name === 'string')
    .map((e) => ({
      name: e.name.slice(0, 200),
      at: Number.isFinite(e.at) && e.at >= 0 ? e.at : 0,
      day: typeof e.day === 'string' ? e.day : '',
    }))
    .slice(-50);
  return {
    total: Number.isFinite(source.total) && source.total >= 0 ? Math.floor(source.total) : history.length,
    history,
  };
}

module.exports = {
  ACTIVITIES,
  LOOK_MODEL_MAX,
  SCALE_MIN,
  SCALE_MAX,
  OPACITY_MIN,
  OPACITY_MAX,
  defaultSettings,
  normalizeSettings,
  normalizePatch,
  activityRow,
  defaultDshState,
  normalizeDshState,
  normalizeFileEaten,
};
