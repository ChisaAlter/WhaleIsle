// src/shared/contract.ts
var RPC_CHANNEL = "/usage-stats";
var RPC_OVERVIEW = "overview";
var RPC_SESSION_COST = "session.cost";
var RPC_BILLING_GET = "billing.get";
var RPC_BILLING_SET = "billing.set";
var RPC_BILLING_MODELS = "billing.models";
var RPC_SESSIONS_MORE = "sessions.more";
var RPC_PROJECTS_MORE = "projects.more";
var RPC_REPAIR_SESSION = "repair.session";
var DEFAULT_BILLING_SETTINGS = {
  prices: {},
  peakValleyEnabled: true
};
var OVERVIEW_VERSION = 5;

// src/shared/pricing.ts
var DEEPSEEK_OFFICIAL_PRICES = [
  {
    model: "deepseek-v4-flash",
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3 },
      output: { idle: 4.5, peak: 9 }
    }
  },
  {
    model: "deepseek-v4-pro",
    price: {
      inputCacheHit: { idle: 0.15, peak: 0.3 },
      inputCacheMiss: { idle: 4.5, peak: 9 },
      output: { idle: 13.5, peak: 27 }
    }
  },
  {
    model: "deepseek-v4-flash-vision-exp",
    price: {
      inputCacheHit: { idle: 0.05, peak: 0.1 },
      inputCacheMiss: { idle: 1.5, peak: 3 },
      output: { idle: 4.5, peak: 9 }
    }
  }
];
function isDeepSeekProvider(provider) {
  return provider !== null && provider !== void 0 && provider !== "" && provider.toLowerCase().includes("deepseek");
}
function officialPriceFor(model) {
  const needle = model.toLowerCase();
  return DEEPSEEK_OFFICIAL_PRICES.find((entry) => entry.model.toLowerCase() === needle)?.price;
}
function compositePriceKey(provider, model) {
  return provider + "/" + model;
}
function resolveModelPrice(provider, model, customPrices) {
  if (model === null || model === void 0 || model === "") return null;
  const custom = lookupCustomPrice(provider, model, customPrices);
  if (custom !== void 0) {
    const peak = { inputCacheHit: custom.inputCacheHit, inputCacheMiss: custom.inputCacheMiss, output: custom.output };
    if (custom.flat === true) {
      return { peak, idle: peak, idleExplicit: true, flat: true, source: "custom" };
    }
    if (custom.idle !== void 0) {
      return { peak, idle: custom.idle, idleExplicit: true, flat: false, source: "custom" };
    }
    const half = (n) => n / 2;
    return {
      peak,
      idle: {
        inputCacheHit: half(peak.inputCacheHit),
        inputCacheMiss: half(peak.inputCacheMiss),
        output: half(peak.output)
      },
      idleExplicit: false,
      flat: false,
      source: "custom"
    };
  }
  const official = officialPriceFor(model);
  if (official === void 0) return null;
  return {
    peak: { inputCacheHit: official.inputCacheHit.peak, inputCacheMiss: official.inputCacheMiss.peak, output: official.output.peak },
    idle: { inputCacheHit: official.inputCacheHit.idle, inputCacheMiss: official.inputCacheMiss.idle, output: official.output.idle },
    idleExplicit: true,
    flat: false,
    source: "official"
  };
}
function lookupCustomPrice(provider, model, customPrices) {
  if (provider !== null && provider !== void 0) {
    const byProvider = customPrices[compositePriceKey(provider, model)];
    if (byProvider !== void 0) return byProvider;
  }
  return customPrices[model];
}
var MAX_PRICE = 1e6;
var MAX_KEY_LENGTH = 256;
function parseSessionCostPrices(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: ["prices must be an object"] };
  }
  const prices = {};
  const issues = [];
  for (const [key, raw] of Object.entries(input)) {
    if (key.length === 0) {
      issues.push("empty price key");
      continue;
    }
    if (key.length > MAX_KEY_LENGTH) {
      issues.push("price key too long: " + key.slice(0, 24) + "\u2026");
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      issues.push('price for "' + key + '" must be an object');
      continue;
    }
    const value = raw;
    const inputCacheHit = readPrice(value.inputCacheHit);
    const inputCacheMiss = readPrice(value.inputCacheMiss);
    const output = readPrice(value.output);
    if (inputCacheHit === null || inputCacheMiss === null || output === null) {
      issues.push('price for "' + key + '" needs finite numbers: inputCacheHit/inputCacheMiss/output');
      continue;
    }
    const entry = { inputCacheHit, inputCacheMiss, output };
    if (value.flat !== void 0 && value.flat !== true) {
      issues.push('price for "' + key + '" has a non-boolean flat');
      continue;
    }
    if (value.flat === true) entry.flat = true;
    if (value.idle !== void 0) {
      const idle = value.idle;
      const idleHit = readPrice(idle.inputCacheHit);
      const idleMiss = readPrice(idle.inputCacheMiss);
      const idleOut = readPrice(idle.output);
      if (idleHit === null || idleMiss === null || idleOut === null) {
        issues.push('price for "' + key + '" has an invalid idle column');
        continue;
      }
      entry.idle = { inputCacheHit: idleHit, inputCacheMiss: idleMiss, output: idleOut };
    }
    prices[key] = entry;
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, prices };
}
function readPrice(value) {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > MAX_PRICE) return null;
  return value;
}
function repairFlatEntries(prices) {
  let changed = false;
  const next = {};
  for (const [key, entry] of Object.entries(prices)) {
    if (entry.flat === true && entry.idle === void 0) {
      changed = true;
      next[key] = {
        ...entry,
        idle: {
          inputCacheHit: entry.inputCacheHit,
          inputCacheMiss: entry.inputCacheMiss,
          output: entry.output
        }
      };
      continue;
    }
    next[key] = entry;
  }
  return { prices: next, changed };
}

// src/shared/cost.ts
var MICRO_SCALE = 1e6;
var CENTS_DIVISOR = 1e10;
function microRate(yuanPerMillion) {
  return Math.round(yuanPerMillion * MICRO_SCALE);
}
function bucketMicro(b, hit, miss, out) {
  return b.missInputTokens * miss + b.cacheReadTokens * hit + b.outputTokens * out;
}
function periodCostCents(b, rate) {
  const micro = bucketMicro(b, microRate(rate.inputCacheHit), microRate(rate.inputCacheMiss), microRate(rate.output));
  return Math.round(micro / CENTS_DIVISOR);
}
function computeBilledCost(usage, price) {
  return periodCostCents(usage.peak, price.peak) + periodCostCents(usage.offPeak, price.idle);
}
function billedBucketsOf(b) {
  return {
    missInputTokens: b.input + b.cacheWrite,
    cacheReadTokens: b.cacheRead,
    outputTokens: b.output
  };
}
function costCentsFor(buckets, provider, model, customPrices, peakValley = true) {
  const price = resolveModelPrice(provider, model, customPrices);
  if (price === null) return null;
  const effective = peakValley ? price : { ...price, idle: price.peak };
  return computeBilledCost(
    { peak: billedBucketsOf(buckets.peak), offPeak: billedBucketsOf(buckets.offPeak) },
    effective
  );
}
function sumCostCents(rows) {
  let any = false;
  let sum = 0;
  for (const cents of rows) {
    if (cents === null) continue;
    any = true;
    sum += cents;
  }
  return any ? sum : null;
}
function totalCostCents(rows, prices, peakValley) {
  return sumCostCents(rows.map((row) => costCentsFor(row.cost, row.provider, row.model, prices, peakValley)));
}

// src/shared/usage.ts
var HEAT_DAYS = 182;
var RECENT_DAYS = 30;
function emptyBuckets() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
function emptyTotals() {
  return { ...emptyBuckets(), total: 0 };
}
function totalsFrom(b) {
  return { ...b, total: b.input + b.output };
}
function hasUsage(b) {
  return b.input + b.output + b.cacheRead + b.cacheWrite > 0;
}
function sortedModels(map, costs, providers) {
  return Object.keys(map).map((model) => {
    const b = map[model];
    return {
      model,
      ...b,
      total: b.input + b.output,
      provider: providers && providers[model] ? providers[model] : "unknown",
      cost: costs && costs[model] ? { peak: { ...costs[model].peak }, offPeak: { ...costs[model].offPeak } } : { peak: { ...emptyBuckets() }, offPeak: { ...emptyBuckets() } }
    };
  }).sort((a, b) => b.total - a.total);
}
function totalsFromModels(models) {
  const totals = emptyTotals();
  for (const item of models) {
    totals.input += item.input;
    totals.output += item.output;
    totals.cacheRead += item.cacheRead;
    totals.cacheWrite += item.cacheWrite;
  }
  totals.total = totals.input + totals.output;
  return totals;
}
function dayKeyUTC(ts) {
  const d = new Date(ts);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function parseDayKeyUTC(key) {
  const p = key.split("-");
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
function keyOfDateUTC(d) {
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
}
function todayKeyUTC(now) {
  return dayKeyUTC(now);
}
function buildDayWindow(byDay, now, costByDay) {
  const days = [];
  const today = todayKeyUTC(now);
  const todayDate = parseDayKeyUTC(today);
  for (let i = HEAT_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), todayDate.getUTCDate() - i));
    const key = keyOfDateUTC(d);
    const record = byDay[key];
    const models = {};
    const cost = emptyPhase();
    let total = 0;
    if (record) {
      for (const model of Object.keys(record)) {
        const b = record[model];
        models[model] = totalsFrom(b);
        total += models[model].total;
      }
    }
    const dayCost = costByDay?.[key];
    if (dayCost) {
      for (const model of Object.keys(dayCost)) {
        const phase = dayCost[model];
        cost.peak.input += phase.peak.input;
        cost.peak.output += phase.peak.output;
        cost.peak.cacheRead += phase.peak.cacheRead;
        cost.peak.cacheWrite += phase.peak.cacheWrite;
        cost.offPeak.input += phase.offPeak.input;
        cost.offPeak.output += phase.offPeak.output;
        cost.offPeak.cacheRead += phase.offPeak.cacheRead;
        cost.offPeak.cacheWrite += phase.offPeak.cacheWrite;
      }
    }
    days.push({ date: key, total, models, cost, modelCosts: dayCost ?? {} });
  }
  return days;
}
function emptyPhase() {
  return { peak: emptyBuckets(), offPeak: emptyBuckets() };
}
function sumDayBuckets(byDay, cutoffKey) {
  const totals = emptyBuckets();
  const byModel = {};
  for (const day of Object.keys(byDay)) {
    if (day < cutoffKey) continue;
    const dayMap = byDay[day];
    for (const model of Object.keys(dayMap)) {
      const b = dayMap[model];
      totals.input += b.input;
      totals.output += b.output;
      totals.cacheRead += b.cacheRead;
      totals.cacheWrite += b.cacheWrite;
      const cur = byModel[model];
      byModel[model] = cur ? {
        input: cur.input + b.input,
        output: cur.output + b.output,
        cacheRead: cur.cacheRead + b.cacheRead,
        cacheWrite: cur.cacheWrite + b.cacheWrite
      } : { ...b };
    }
  }
  return { totals, byModel };
}

// src/host/projection.ts
import { z } from "zod";

// src/shared/billing.ts
var BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
var PEAK_WINDOWS = [
  { open: 9 * 60, close: 12 * 60 },
  { open: 14 * 60, close: 18 * 60 }
];
var WEEKDAY_MAX = 5;
function isPeakBillingTime(epochMs) {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS);
  const day = wall.getUTCDay();
  if (day < 1 || day > WEEKDAY_MAX) return false;
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  return PEAK_WINDOWS.some((w) => minuteOfDay >= w.open && minuteOfDay < w.close);
}

// src/host/projection.ts
var bucketSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number()
});
var phaseBucketsSchema = z.object({
  peak: bucketSchema,
  offPeak: bucketSchema
});
var stepSchema = z.object({
  buckets: bucketSchema,
  /** Billing phase of the step's start instant (classification snapshot). */
  peak: z.boolean(),
  lastTime: z.number(),
  model: z.string(),
  provider: z.string(),
  mode: z.enum(["provisional", "authoritative"])
});
var stepStartSchema = z.object({
  turn: z.number().int().nonnegative(),
  step: z.number().int().nonnegative(),
  ms: z.number().int().nonnegative()
});
var usagePanelSchema = z.object({
  totals: bucketSchema,
  byModel: z.record(z.string(), bucketSchema),
  byDay: z.record(z.string(), z.record(z.string(), bucketSchema)),
  byProvider: z.record(z.string(), bucketSchema),
  costTotals: phaseBucketsSchema,
  costByModel: z.record(z.string(), phaseBucketsSchema),
  costByDay: z.record(z.string(), z.record(z.string(), phaseBucketsSchema)),
  costByProvider: z.record(z.string(), phaseBucketsSchema),
  modelProviders: z.record(z.string(), z.string()),
  retries: z.number(),
  compactionTokens: z.number(),
  firstTime: z.number().nullable(),
  lastTime: z.number().nullable(),
  seedEnd: z.number().nullable(),
  explicitSeedBoundary: z.boolean(),
  currentModel: z.string(),
  currentProvider: z.string(),
  stepStart: stepStartSchema.nullable(),
  openStep: z.string().nullable(),
  steps: z.record(z.string(), stepSchema)
});
var USAGE_PANEL_KEY = "usagePanel";
var EMPTY = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
function initState(_header, inheritedEventCount) {
  return {
    totals: { ...EMPTY },
    byModel: {},
    byDay: {},
    byProvider: {},
    costTotals: { peak: { ...EMPTY }, offPeak: { ...EMPTY } },
    costByModel: {},
    costByDay: {},
    costByProvider: {},
    modelProviders: {},
    retries: 0,
    compactionTokens: 0,
    firstTime: null,
    lastTime: null,
    seedEnd: inheritedEventCount ?? null,
    explicitSeedBoundary: inheritedEventCount !== void 0,
    currentModel: "unknown",
    currentProvider: "unknown",
    stepStart: null,
    openStep: null,
    steps: {}
  };
}
function stepKey(turn, step) {
  return turn + ":" + step;
}
function add(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  };
}
function addInto(map, key, b) {
  const cur = map[key];
  return { ...map, [key]: cur ? add(cur, b) : { ...b } };
}
function addIntoDay(byDay, day, model, b) {
  const dayMap = byDay[day];
  return { ...byDay, [day]: dayMap ? addInto(dayMap, model, b) : { [model]: { ...b } } };
}
function addPhase(a, b, peak) {
  return { ...a, [peak ? "peak" : "offPeak"]: add(a[peak ? "peak" : "offPeak"], b) };
}
function addIntoPhase(map, key, b, peak) {
  const cur = map[key];
  return {
    ...map,
    [key]: cur ? addPhase(cur, b, peak) : addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak)
  };
}
function addIntoDayPhase(byDay, day, model, b, peak) {
  const dayMap = byDay[day];
  return {
    ...byDay,
    [day]: dayMap ? addIntoPhase(dayMap, model, b, peak) : { [model]: addPhase({ peak: { ...EMPTY }, offPeak: { ...EMPTY } }, b, peak) }
  };
}
function isCounted(state, event) {
  return state.seedEnd !== null && event.seq >= state.seedEnd;
}
function touchTime(state, time) {
  if (state.firstTime === null || time < state.firstTime || time > (state.lastTime ?? 0)) {
    return {
      ...state,
      firstTime: state.firstTime === null ? time : Math.min(state.firstTime, time),
      lastTime: state.lastTime === null ? time : Math.max(state.lastTime, time)
    };
  }
  return state;
}
function commitStep(state, key) {
  const step = state.steps[key];
  if (!step) return state;
  const b = step.buckets;
  if (b.input === 0 && b.output === 0 && b.cacheRead === 0 && b.cacheWrite === 0) {
    const steps = { ...state.steps };
    delete steps[key];
    return { ...state, steps, openStep: state.openStep === key ? null : state.openStep };
  }
  const day = dayKeyUTC(step.lastTime);
  const next = {
    ...state,
    totals: add(state.totals, b),
    byModel: addInto(state.byModel, step.model, b),
    byDay: addIntoDay(state.byDay, day, step.model, b),
    byProvider: addInto(state.byProvider, step.provider, b),
    costTotals: addPhase(state.costTotals, b, step.peak),
    costByModel: addIntoPhase(state.costByModel, step.model, b, step.peak),
    costByDay: addIntoDayPhase(state.costByDay, day, step.model, b, step.peak),
    costByProvider: addIntoPhase(state.costByProvider, step.provider, b, step.peak),
    modelProviders: { ...state.modelProviders, [step.model]: step.provider },
    firstTime: state.firstTime === null ? step.lastTime : Math.min(state.firstTime, step.lastTime),
    lastTime: state.lastTime === null ? step.lastTime : Math.max(state.lastTime, step.lastTime),
    steps: { ...state.steps },
    openStep: state.openStep === key ? null : state.openStep
  };
  delete next.steps[key];
  return next;
}
function commitOpenStep(state, incomingKey) {
  if (state.openStep !== null && state.openStep !== incomingKey) {
    return commitStep(state, state.openStep);
  }
  return state;
}
function samplePeak(state, turn, step, eventTime) {
  const start = state.stepStart;
  if (start !== null && start.turn === turn && start.step === step) return isPeakBillingTime(start.ms);
  return isPeakBillingTime(eventTime);
}
function applyEvent(state, event) {
  switch (event.type) {
    case "session/end-seed": {
      if (state.explicitSeedBoundary) return state;
      if (state.seedEnd !== null && event.seq <= state.seedEnd) return state;
      return { ...state, seedEnd: event.seq };
    }
    case "step/start": {
      if (!isCounted(state, event)) return state;
      const stepStart = { turn: event.data.turn, step: event.data.step, ms: event.time };
      const current = state.stepStart;
      if (current !== null && current.turn === stepStart.turn && current.step === stepStart.step && current.ms === stepStart.ms) {
        return state;
      }
      return { ...state, stepStart };
    }
    case "request/context": {
      const { model, provider } = event.data;
      if (!model && !provider) return state;
      return {
        ...state,
        currentModel: model || state.currentModel,
        currentProvider: provider || state.currentProvider
      };
    }
    case "request/header": {
      const cfg = event.data.header && event.data.header.config;
      if (!cfg || !cfg.model && !cfg.provider) return state;
      return {
        ...state,
        currentModel: cfg.model || state.currentModel,
        currentProvider: cfg.provider || state.currentProvider
      };
    }
    case "assistant/chunk": {
      if (!isCounted(state, event)) return state;
      const chunk = event.data.chunk;
      if (!chunk || chunk.type !== "usage" || !chunk.usage) return state;
      const key = stepKey(event.data.turn, event.data.step);
      const usage = chunk.usage;
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      let next = commitOpenStep(state, key);
      const existing = next.steps[key];
      const step = existing ? { ...existing, buckets: add(existing.buckets, b), lastTime: event.time } : {
        buckets: b,
        peak: samplePeak(next, event.data.turn, event.data.step, event.time),
        lastTime: event.time,
        model: next.currentModel,
        provider: next.currentProvider,
        mode: "provisional"
      };
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key
      };
    }
    case "assistant/message": {
      if (!isCounted(state, event)) return state;
      const usage = event.data.usage;
      if (!usage) return state;
      const key = stepKey(event.data.turn, event.data.step);
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      let next = commitOpenStep(state, key);
      const existing = next.steps[key];
      const step = {
        buckets: b,
        // The step's phase is a snapshot: a provisional accumulation already
        // classified it, and a late message (after the next step's start) must
        // not reclassify it by its own (possibly post-boundary) arrival time.
        peak: existing ? existing.peak : samplePeak(next, event.data.turn, event.data.step, event.time),
        lastTime: event.time,
        model: next.currentModel,
        provider: next.currentProvider,
        mode: "authoritative"
      };
      return {
        ...next,
        steps: { ...next.steps, [key]: step },
        openStep: key
      };
    }
    case "step/end": {
      const key = stepKey(event.data.turn, event.data.step);
      return commitStep(state, key);
    }
    case "turn/end": {
      return state.openStep !== null ? commitStep(state, state.openStep) : state;
    }
    case "llm/retry": {
      if (!isCounted(state, event)) return state;
      return touchTime({ ...state, retries: state.retries + 1 }, event.time);
    }
    case "compaction/summary": {
      if (!isCounted(state, event)) return state;
      const usage = event.data.usage;
      if (!usage) return state;
      const b = {
        input: Number(usage.inputTokens) || 0,
        output: Number(usage.outputTokens) || 0,
        cacheRead: Number(usage.cacheReadTokens) || 0,
        cacheWrite: Number(usage.cacheWriteTokens) || 0
      };
      const model = event.data.model || state.currentModel;
      const provider = event.data.provider || state.currentProvider;
      const day = dayKeyUTC(event.time);
      return {
        ...state,
        totals: add(state.totals, b),
        byModel: addInto(state.byModel, model, b),
        byDay: addIntoDay(state.byDay, day, model, b),
        byProvider: addInto(state.byProvider, provider, b),
        modelProviders: { ...state.modelProviders, [model]: provider },
        compactionTokens: state.compactionTokens + b.input + b.output + b.cacheRead + b.cacheWrite,
        firstTime: state.firstTime === null ? event.time : Math.min(state.firstTime, event.time),
        lastTime: state.lastTime === null ? event.time : Math.max(state.lastTime, event.time)
      };
    }
    default:
      return state;
  }
}
function recentOf(value, cutoffKey) {
  const totals = { ...EMPTY };
  const byModel = {};
  const costByModel = {};
  for (const day of Object.keys(value.byDay)) {
    if (day < cutoffKey) continue;
    for (const model of Object.keys(value.byDay[day])) {
      const b = value.byDay[day][model];
      totals.input += b.input;
      totals.output += b.output;
      totals.cacheRead += b.cacheRead;
      totals.cacheWrite += b.cacheWrite;
      const cur = byModel[model];
      byModel[model] = cur ? {
        input: cur.input + b.input,
        output: cur.output + b.output,
        cacheRead: cur.cacheRead + b.cacheRead,
        cacheWrite: cur.cacheWrite + b.cacheWrite
      } : { ...b };
    }
  }
  const dayCost = value.costByDay;
  for (const day of Object.keys(dayCost)) {
    if (day < cutoffKey) continue;
    for (const model of Object.keys(dayCost[day])) {
      const phase = dayCost[day][model];
      const cur = costByModel[model];
      costByModel[model] = cur ? {
        peak: add(cur.peak, phase.peak),
        offPeak: add(cur.offPeak, phase.offPeak)
      } : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
    }
  }
  return { totals, byModel, costByModel };
}

// src/host/aggregate.ts
var EMPTY_COST = Object.freeze({ peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
function emptyCost() {
  return { peak: { ...EMPTY_COST.peak }, offPeak: { ...EMPTY_COST.offPeak } };
}
function emptyAggregate() {
  return {
    allTimeTotals: emptyTotals(),
    allTimeByModel: {},
    allTimeByProvider: {},
    allTimeCost: emptyCost(),
    allTimeCostByModel: {},
    allTimeModelProviders: {},
    byDay: {},
    byDayCost: {},
    recentTotals: emptyTotals(),
    recentByModel: {},
    recentCostByModel: {},
    recentSessionCount: 0,
    allTimeSessionCount: 0,
    retries: 0,
    compactionTokens: 0,
    from: null,
    to: null,
    usageSessionsMain: 0,
    usageSessionsSubagent: 0,
    sessions: []
  };
}
function mergeSessionValue(a, value, sessionId, now, depth = 0, cwd = null) {
  const cutoffKey = dayKeyUTC(now - RECENT_DAYS * 24 * 3600 * 1e3);
  const recent = recentOf(value, cutoffKey);
  const totals = totalsFrom(value.totals);
  const next = {
    ...a,
    allTimeTotals: {
      input: a.allTimeTotals.input + totals.input,
      output: a.allTimeTotals.output + totals.output,
      cacheRead: a.allTimeTotals.cacheRead + totals.cacheRead,
      cacheWrite: a.allTimeTotals.cacheWrite + totals.cacheWrite,
      total: a.allTimeTotals.total + totals.total
    },
    recentTotals: {
      input: a.recentTotals.input + recent.totals.input,
      output: a.recentTotals.output + recent.totals.output,
      cacheRead: a.recentTotals.cacheRead + recent.totals.cacheRead,
      cacheWrite: a.recentTotals.cacheWrite + recent.totals.cacheWrite,
      // Same rule as totalsFrom: uncached input + output, cache excluded.
      total: a.recentTotals.total + recent.totals.input + recent.totals.output
    },
    retries: a.retries + value.retries,
    compactionTokens: a.compactionTokens + value.compactionTokens,
    from: a.from === null ? value.firstTime : value.firstTime === null ? a.from : Math.min(a.from, value.firstTime),
    to: a.to === null ? value.lastTime : value.lastTime === null ? a.to : Math.max(a.to, value.lastTime)
  };
  for (const model of Object.keys(value.byModel)) {
    const b = value.byModel[model];
    const cur = next.allTimeByModel[model];
    next.allTimeByModel[model] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const model of Object.keys(value.costByModel)) {
    const phase = value.costByModel[model];
    const cur = next.allTimeCostByModel[model];
    next.allTimeCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
  }
  for (const model of Object.keys(value.modelProviders)) {
    if (next.allTimeModelProviders[model] === void 0) next.allTimeModelProviders[model] = value.modelProviders[model];
  }
  for (const provider of Object.keys(value.byProvider)) {
    const b = value.byProvider[provider];
    const cur = next.allTimeByProvider[provider];
    next.allTimeByProvider[provider] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const day of Object.keys(value.byDay)) {
    const dayMap = value.byDay[day];
    const target = next.byDay[day] || (next.byDay[day] = {});
    for (const model of Object.keys(dayMap)) {
      const b = dayMap[model];
      const cur = target[model];
      target[model] = cur ? mergeB(cur, b) : { ...b };
    }
  }
  for (const day of Object.keys(value.costByDay)) {
    const dayMap = value.costByDay[day];
    const target = next.byDayCost[day] || (next.byDayCost[day] = {});
    for (const model of Object.keys(dayMap)) {
      const phase = dayMap[model];
      const cur = target[model];
      target[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
    }
  }
  for (const model of Object.keys(recent.byModel)) {
    const b = recent.byModel[model];
    const cur = next.recentByModel[model];
    next.recentByModel[model] = cur ? mergeB(cur, b) : { ...b };
  }
  for (const model of Object.keys(recent.costByModel)) {
    const phase = recent.costByModel[model];
    const cur = next.recentCostByModel[model];
    next.recentCostByModel[model] = cur ? mergePhase(cur, phase) : { peak: { ...phase.peak }, offPeak: { ...phase.offPeak } };
  }
  if (recent.totals.input + recent.totals.output + recent.totals.cacheRead + recent.totals.cacheWrite > 0) {
    next.recentSessionCount += 1;
  }
  if (hasUsage(totals)) {
    next.allTimeSessionCount += 1;
    if (depth > 0) next.usageSessionsSubagent += 1;
    else next.usageSessionsMain += 1;
    next.sessions.push({
      id: sessionId,
      cwd,
      totals,
      lastActive: value.lastTime ?? 0,
      depth,
      models: sessionModels(value)
    });
  }
  next.allTimeCost = mergePhase(next.allTimeCost, value.costTotals);
  return next;
}
function sessionModels(value) {
  return Object.keys(value.costByModel).map((model) => ({
    model,
    provider: value.modelProviders[model] ?? "unknown",
    cost: value.costByModel[model]
  }));
}
function mergePhase(a, b) {
  return {
    peak: mergeB(a.peak, b.peak),
    offPeak: mergeB(a.offPeak, b.offPeak)
  };
}
function mergeB(a, b) {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite
  };
}
function rankSessions(sessions, limit) {
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total).slice(0, limit);
}
function rankSessionsBy(sessions, sort, prices, peakValley) {
  if (sort === "cost") {
    return [...sessions].sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley);
      const bc = totalCostCents(b.models, prices, peakValley);
      if (ac === null && bc === null) return b.totals.total - a.totals.total;
      if (ac === null) return 1;
      if (bc === null) return -1;
      return bc - ac;
    });
  }
  return [...sessions].sort((a, b) => b.totals.total - a.totals.total);
}
function pathBasename(dir) {
  if (dir === null || dir === "") return "";
  const sep = dir.includes("\\") ? "\\" : "/";
  const parts = dir.split(sep).filter((p) => p !== "");
  return parts[parts.length - 1] ?? dir;
}
function projectRowsOf(sessions, sort = "tokens", prices = {}, peakValley = true) {
  const byProject = /* @__PURE__ */ new Map();
  for (const session of sessions) {
    const key = session.cwd ?? "(unknown)";
    let row = byProject.get(key);
    if (row === void 0) {
      row = { project: session.cwd, name: pathBasename(session.cwd) || "(unknown)", totals: emptyTotals(), models: [] };
      byProject.set(key, row);
    }
    const totals = row.totals;
    totals.input += session.totals.input;
    totals.output += session.totals.output;
    totals.cacheRead += session.totals.cacheRead;
    totals.cacheWrite += session.totals.cacheWrite;
    totals.total += session.totals.total;
    const index = /* @__PURE__ */ new Map();
    row.models.forEach((m, i) => index.set(m.model + "\0" + m.provider, i));
    for (const m of session.models) {
      const idx = index.get(m.model + "\0" + m.provider);
      if (idx !== void 0) {
        const cur = row.models[idx];
        cur.cost = { peak: mergeB(cur.cost.peak, m.cost.peak), offPeak: mergeB(cur.cost.offPeak, m.cost.offPeak) };
      } else {
        index.set(m.model + "\0" + m.provider, row.models.length);
        row.models.push({ model: m.model, provider: m.provider, cost: { peak: { ...m.cost.peak }, offPeak: { ...m.cost.offPeak } } });
      }
    }
  }
  const rows = [...byProject.values()];
  if (sort === "cost") {
    rows.sort((a, b) => {
      const ac = totalCostCents(a.models, prices, peakValley);
      const bc = totalCostCents(b.models, prices, peakValley);
      if (ac === null && bc === null) return b.totals.total - a.totals.total;
      if (ac === null) return 1;
      if (bc === null) return -1;
      return bc - ac;
    });
  } else {
    rows.sort((a, b) => b.totals.total - a.totals.total);
  }
  return rows;
}
function pageOf(rows, offset, limit) {
  const start = Math.max(0, offset);
  return {
    rows: rows.slice(start, start + limit),
    hasMore: start + limit < rows.length
  };
}
function finalizeOverview(input) {
  const { aggregate: a, now, mode, sessionsTotal, sessionsOk, sessionsFailed, sessionsPending, eventsCounted, titles, providerNames, magpie } = input;
  const gateway = magpie ?? null;
  const modelProviders = gateway === null ? a.allTimeModelProviders : { ...gateway.upstreamProviders, ...a.allTimeModelProviders };
  const recent = gateway === null ? null : sumDayBuckets(gateway.byDay, recentCutoffKey(now));
  const recentByModel = sortedModels(
    recent === null ? a.recentByModel : recent.byModel,
    a.recentCostByModel,
    modelProviders
  );
  const allTimeByModel = sortedModels(
    gateway === null ? a.allTimeByModel : gateway.byModel,
    a.allTimeCostByModel,
    modelProviders
  );
  const allTimeByProvider = gateway === null ? a.allTimeByProvider : providerGroups(gateway.byModel, modelProviders);
  const recentTotals = recent === null ? totalsFromModels(recentByModel) : totalsFrom(recent.totals);
  const allTimeTotals = gateway === null ? totalsFromModels(allTimeByModel) : totalsFrom(gateway.totals);
  const providerRows = Object.keys(allTimeByProvider).map((id) => {
    const b = allTimeByProvider[id];
    return { id, name: providerNames[id] || id, totals: totalsFrom(b) };
  }).sort((x, y) => y.totals.total - x.totals.total);
  const top = rankSessions(a.sessions, 10);
  const topSessions = top.map((s) => ({
    id: s.id,
    title: titles.has(s.id) ? titles.get(s.id) : null,
    totals: s.totals,
    lastActive: s.lastActive,
    depth: s.depth,
    models: s.models
  }));
  const coverage = {
    mode,
    timezone: "UTC",
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    retries: a.retries,
    compactionTokens: a.compactionTokens,
    from: a.from,
    to: a.to,
    usageSessionsMain: a.usageSessionsMain,
    usageSessionsSubagent: a.usageSessionsSubagent,
    failedSessionIds: input.failedSessionIds ?? [],
    source: gateway === null ? "logs" : "magpie",
    ...gateway === null ? {} : { magpie: { file: gateway.file, calls: gateway.calls, from: gateway.from, to: gateway.to } }
  };
  return {
    // Day cells stay UTC (declared contract) and keep the log-derived cost
    // buckets: a gateway row has no billing phase.
    days: buildDayWindow(gateway === null ? a.byDay : gateway.byDay, now, a.byDayCost),
    totals: recentTotals,
    sessionCount: a.recentSessionCount,
    byModel: recentByModel,
    allTime: {
      totals: allTimeTotals,
      sessionCount: a.allTimeSessionCount,
      byModel: allTimeByModel,
      costTotals: a.allTimeCost
    },
    coverage,
    topSessions,
    providers: providerRows,
    updatedAt: now
  };
}
function recentCutoffKey(now) {
  return dayKeyUTC(now - RECENT_DAYS * 24 * 3600 * 1e3);
}
function providerGroups(byModel, providers) {
  const out = {};
  for (const model of Object.keys(byModel)) {
    const provider = providers[model] ?? "unknown";
    const cur = out[provider];
    out[provider] = cur ? mergeB(cur, byModel[model]) : { ...byModel[model] };
  }
  return out;
}
function emptyOverview(now) {
  return finalizeOverview({
    aggregate: emptyAggregate(),
    now,
    mode: "none",
    sessionsTotal: 0,
    sessionsOk: 0,
    sessionsFailed: 0,
    sessionsPending: 0,
    eventsCounted: 0,
    titles: /* @__PURE__ */ new Map(),
    providerNames: {}
  });
}

// src/host/projection-unit.ts
var PROJECTION_STATE_VERSION = 3;
var usagePanelProjectionDefinition = {
  key: USAGE_PANEL_KEY,
  stateVersion: PROJECTION_STATE_VERSION,
  stateSchema: usagePanelSchema,
  init: initState,
  apply: applyEvent,
  wire: {
    viewSchema: usagePanelSchema,
    view: (state) => state
  }
};

// src/host/pacing.ts
var BATCH_SIZE = 5;
var PROGRESS_EVERY = 200;
function yieldLoop() {
  return new Promise((resolve2) => {
    setImmediate(resolve2);
  });
}
function scanPacer(log) {
  return {
    async beat(index, total) {
      if (index % BATCH_SIZE === 0) await yieldLoop();
      if (index % PROGRESS_EVERY === 0 || index === total) {
        log(`scan progress: ${index}/${total} sessions processed`);
      }
    }
  };
}
function withTimeout(source, ms, label) {
  return new Promise((resolve2, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(label + " timed out"));
    }, ms);
    source.then(
      (value) => {
        clearTimeout(timer);
        resolve2(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// src/host/scan.ts
function isCountedEvent(state, event) {
  if (state.seedEnd === null || event.seq < state.seedEnd) return false;
  switch (event.type) {
    case "assistant/message":
      return !!event.data.usage;
    case "assistant/chunk":
      return !!event.data.chunk && event.data.chunk.type === "usage" && !!event.data.chunk.usage;
    case "compaction/summary":
      return !!event.data.usage;
    case "llm/retry":
      return true;
    default:
      return false;
  }
}
async function scanFallback(deps, now) {
  const { sq, providerNames, logFailure } = deps;
  let a = emptyAggregate();
  const titles = /* @__PURE__ */ new Map();
  const failed = [];
  let sessionsTotal = 0;
  let sessionsOk = 0;
  let sessionsFailed = 0;
  let sessionsPending = 0;
  let eventsCounted = 0;
  let sessions = [];
  try {
    sessions = await sq.listSessions();
  } catch (err) {
    logFailure("listSessions failed: " + String(err?.message ?? err));
    return finalizeOverview({
      aggregate: a,
      now,
      mode: "scan",
      sessionsTotal: 0,
      sessionsOk: 0,
      sessionsFailed: 0,
      sessionsPending: 0,
      eventsCounted: 0,
      titles,
      providerNames,
      magpie: deps.magpie
    });
  }
  const pacer = scanPacer((message) => console.log("[dsh-usage-panel]", message));
  let index = 0;
  for (const rec of sessions) {
    index += 1;
    const header = rec && rec.header;
    if (!header) {
      sessionsTotal += 1;
      sessionsFailed += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    const sessionId = header.id;
    sessionsTotal += 1;
    if (!rec.persisted) {
      sessionsPending += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    let snapshot = null;
    try {
      snapshot = await sq.readSession(header.id);
    } catch (err) {
      sessionsFailed += 1;
      if (failed.length < 50) failed.push(sessionId);
      logFailure("readSession " + sessionId + " failed: " + String(err?.message ?? err));
      await pacer.beat(index, sessions.length);
      continue;
    }
    const events = snapshot && snapshot.events;
    if (!events || !events.length) {
      sessionsOk += 1;
      await pacer.beat(index, sessions.length);
      continue;
    }
    const seedLength = Number(header.seedLength) || 0;
    let seedEnd = 0;
    for (const event of events) {
      if (event.type === "session/end-seed") seedEnd = event.seq;
    }
    if (seedEnd === 0 && seedLength > 0) seedEnd = seedLength + 1;
    let state = snapshot?.inheritedEventCount !== void 0 ? initState(header, snapshot.inheritedEventCount) : { ...initState(), seedEnd };
    let title = null;
    for (const event of events) {
      if (event.type === "session/title") {
        title = event.data.title;
      }
      if (isCountedEvent(state, event)) eventsCounted += 1;
      state = applyEvent(state, event);
    }
    titles.set(sessionId, title);
    const depth = Number(header.delegationDepth) || 0;
    const cwd = header.cwd || null;
    a = mergeSessionValue(a, state, sessionId, now, depth, typeof cwd === "string" ? cwd : null);
    sessionsOk += 1;
    await pacer.beat(index, sessions.length);
  }
  deps.storeIndex(rankSessions(a.sessions, Number.MAX_SAFE_INTEGER));
  deps.storeFailed(failed);
  return finalizeOverview({
    aggregate: a,
    now,
    mode: "scan",
    sessionsTotal,
    sessionsOk,
    sessionsFailed,
    sessionsPending,
    eventsCounted,
    titles,
    providerNames,
    failedSessionIds: failed,
    magpie: deps.magpie
  });
}

// src/host/magpie-usage.ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
var MAGPIE_AGENT = "dsh";
var MAGPIE_USAGE_FILE_ENV = "MAGPIE_USAGE_FILE";
function resolveMagpieUsageFile(env = process.env, home = homedir()) {
  const explicit = env[MAGPIE_USAGE_FILE_ENV];
  if (typeof explicit === "string" && explicit.trim() !== "") return explicit.trim();
  return join(home, ".config", "magpie", "usage.jsonl");
}
function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function text(value, fallback) {
  return typeof value === "string" && value !== "" ? value : fallback;
}
function parseMagpieRow(line) {
  if (line.trim() === "") return null;
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const row = raw;
  if (row.agent !== MAGPIE_AGENT) return null;
  const at = typeof row.t === "string" ? Date.parse(row.t) : Number.NaN;
  return {
    at: Number.isFinite(at) ? at : null,
    // `req` is the composite route the harness also logs as its model id
    // (`codex/gpt-6.1-sol`, `clinepass/cline-pass/deepseek-v4.1-flash-1017`).
    // `model` (the served id) is a different vocabulary and must not become a
    // panel key; it is only the fallback for rows without `req`.
    model: text(row.req, text(row.model, "unknown")),
    provider: text(row.provider, "unknown"),
    buckets: {
      input: count(row.in),
      output: count(row.out),
      cacheRead: count(row.cache_read),
      cacheWrite: count(row.cache_write)
    }
  };
}
function addInto2(target, key, b) {
  const cur = target[key];
  if (cur === void 0) {
    target[key] = { ...b };
    return;
  }
  cur.input += b.input;
  cur.output += b.output;
  cur.cacheRead += b.cacheRead;
  cur.cacheWrite += b.cacheWrite;
}
function createMagpieFolder(file = "") {
  const source = {
    file,
    calls: 0,
    totals: emptyBuckets(),
    byModel: {},
    upstreamProviders: {},
    byDay: {},
    from: null,
    to: null
  };
  return {
    push(line) {
      const row = parseMagpieRow(line);
      if (row === null) return;
      source.calls += 1;
      const b = row.buckets;
      source.totals.input += b.input;
      source.totals.output += b.output;
      source.totals.cacheRead += b.cacheRead;
      source.totals.cacheWrite += b.cacheWrite;
      addInto2(source.byModel, row.model, b);
      source.upstreamProviders[row.model] = row.provider;
      if (row.at === null) return;
      if (source.from === null || row.at < source.from) source.from = row.at;
      if (source.to === null || row.at > source.to) source.to = row.at;
      const day = dayKeyUTC(row.at);
      const dayMap = source.byDay[day] ?? (source.byDay[day] = {});
      addInto2(dayMap, row.model, b);
    },
    result() {
      return source;
    }
  };
}
var cachedFold = null;
async function loadMagpieSource(file = resolveMagpieUsageFile(), warn) {
  let mtimeMs = 0;
  let size = 0;
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    mtimeMs = info.mtimeMs;
    size = info.size;
  } catch {
    return null;
  }
  if (cachedFold !== null && cachedFold.mtimeMs === mtimeMs && cachedFold.size === size) {
    return cachedFold.value;
  }
  try {
    const folder = createMagpieFolder(file);
    const reader = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of reader) folder.push(line);
    const source = folder.result();
    if (source.calls === 0) {
      warn?.("magpie usage file has no agent=dsh rows; using session logs: " + file);
      return null;
    }
    cachedFold = { mtimeMs, size, value: source };
    return source;
  } catch (err) {
    warn?.("magpie usage file unreadable; using session logs: " + String(err?.message ?? err));
    return null;
  }
}

// src/host/billing-store.ts
import { z as z2 } from "zod";
var BILLING_DOMAIN_NAME = "dsh_usage_panel_billing";
var BILLING_DOMAIN_VERSION = 1;
var priceValueSchema = z2.object({
  inputCacheHit: z2.number(),
  inputCacheMiss: z2.number(),
  output: z2.number(),
  idle: z2.object({
    inputCacheHit: z2.number(),
    inputCacheMiss: z2.number(),
    output: z2.number()
  }).optional(),
  flat: z2.boolean().optional()
});
var billingGlobalSchema = z2.object({
  prices: z2.record(z2.string(), priceValueSchema),
  // Legacy v0.3 fields of the retired composer cost strip: a record written
  // by that version still carries them; they parse and are ignored.
  stripVisible: z2.boolean().optional(),
  peakHintVisible: z2.boolean().optional(),
  peakValleyEnabled: z2.boolean()
});
function initialRecord() {
  return {
    prices: {},
    peakValleyEnabled: DEFAULT_BILLING_SETTINGS.peakValleyEnabled
  };
}
var BillingStore = class {
  constructor(medium, warn) {
    this.warn = warn;
    this.medium = medium;
    this.mode = medium === void 0 ? "memory" : "durable";
  }
  warn;
  cache = null;
  medium;
  mode;
  /** Attach the durable medium after the async domain open (upgrades the mode). */
  attachMedium(medium) {
    this.medium = medium;
    this.mode = "durable";
  }
  /** Read the current record (cached per process; first read materializes). */
  async load() {
    if (this.cache !== null) return this.cache;
    this.cache = this.fromRaw(this.medium?.get());
    return this.cache;
  }
  /**
   * Drop this domain's prices after they have been merged into the surviving
   * record. The record itself stays schema-valid (`prices: {}`); the legacy
   * fields of the retired composer strip are gone with it.
   */
  async clearPrices() {
    const cleared = { prices: {}, peakValleyEnabled: DEFAULT_BILLING_SETTINGS.peakValleyEnabled };
    if (this.medium !== void 0) await this.medium.set(cleared);
    this.cache = cleared;
  }
  fromRaw(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return initialRecord();
    const record = raw;
    const parsed = parseSessionCostPrices(record.prices);
    if (!parsed.ok) {
      this.warn("stored legacy prices failed validation, using defaults: " + parsed.issues.join(" | "));
      return {
        prices: {},
        peakValleyEnabled: record.peakValleyEnabled === false ? false : true
      };
    }
    return {
      prices: parsed.prices,
      peakValleyEnabled: record.peakValleyEnabled === false ? false : true
    };
  }
};
async function openBillingMedium(storageDomain, warn) {
  if (storageDomain === void 0) return void 0;
  try {
    const domain = await storageDomain.open({
      name: BILLING_DOMAIN_NAME,
      version: BILLING_DOMAIN_VERSION,
      global: {
        schema: billingGlobalSchema,
        initial: { ...initialRecord(), prices: {} }
      },
      tables: {}
    });
    return domain.global;
  } catch (error) {
    warn("legacy billing domain open failed; the one-time price import is deferred: " + String(error?.message ?? error));
    return void 0;
  }
}

// src/host/legacy-billing-import.ts
function mergeLegacyPrices(legacy, section) {
  const prices = { ...section };
  const imported = [];
  for (const [key, value] of Object.entries(legacy)) {
    if (Object.hasOwn(section, key)) continue;
    prices[key] = value;
    imported.push(key);
  }
  return { prices, imported };
}
function createLegacyBillingImport(deps) {
  const { store, prices, warn, log } = deps;
  let done = false;
  let inflight = null;
  let lastReason = null;
  function warnOnce(reason) {
    if (lastReason === reason) return;
    lastReason = reason;
    warn(reason);
  }
  async function run() {
    try {
      if (store.mode !== "durable") {
        warnOnce("legacy price import deferred: the plugin billing domain has not attached yet");
        return;
      }
      if (!prices.isSectionRegistered()) {
        warnOnce("legacy price import deferred: the ui-conversation settings section is not registered yet");
        return;
      }
      lastReason = null;
      const legacy = await store.load();
      if (Object.keys(legacy.prices).length === 0) {
        done = true;
        return;
      }
      const { prices: merged, imported } = mergeLegacyPrices(legacy.prices, prices.snapshot());
      if (imported.length > 0) await prices.save(merged);
      await store.clearPrices();
      done = true;
      log(
        "imported " + imported.length + " legacy price(s) from " + BILLING_DOMAIN_NAME + " into the conversation settings section; that domain is import-only from now on"
      );
    } catch (err) {
      warnOnce("legacy price import failed (retried on the next billing.get): " + String(err?.message ?? err));
    }
  }
  return {
    isDone: () => done,
    attempt() {
      if (done) return Promise.resolve();
      if (inflight !== null) return inflight;
      const running = run().finally(() => {
        inflight = null;
      });
      inflight = running;
      return running;
    }
  };
}

// src/host/prices-source.ts
var CONVERSATION_SETTINGS_NS = "ui-conversation";
var SESSION_COST_PRICES_FIELD = "sessionCostPrices";
function createPricesSource(settings, warn) {
  let cached = {};
  let observed = false;
  let lastWarning = null;
  function warnOnce(message) {
    if (lastWarning === message) return;
    lastWarning = message;
    warn(message);
  }
  function pricesOf(section) {
    if (typeof section !== "object" || section === null || Array.isArray(section)) return null;
    const raw = section[SESSION_COST_PRICES_FIELD];
    if (raw === void 0 || raw === null) return {};
    const parsed = parseSessionCostPrices(raw);
    if (!parsed.ok) {
      warnOnce(
        "stored " + CONVERSATION_SETTINGS_NS + "." + SESSION_COST_PRICES_FIELD + " failed validation, ignoring it: " + parsed.issues.join(" | ")
      );
      return {};
    }
    return parsed.prices;
  }
  function readSection() {
    let section;
    try {
      section = settings.describe().find((entry) => entry.ns === CONVERSATION_SETTINGS_NS)?.value;
    } catch (err) {
      warnOnce("settings read failed: " + String(err?.message ?? err));
      return false;
    }
    const prices = section === void 0 ? null : pricesOf(section);
    if (prices === null) return false;
    cached = prices;
    observed = true;
    return true;
  }
  return {
    isSectionRegistered() {
      return readSection();
    },
    snapshot() {
      if (!observed) readSection();
      return cached;
    },
    refresh() {
      readSection();
    },
    async save(prices) {
      const { prices: repaired } = repairFlatEntries(prices);
      const parsed = parseSessionCostPrices(repaired);
      if (!parsed.ok) throw new Error("invalid prices: " + parsed.issues.join(" | "));
      await settings.update(CONVERSATION_SETTINGS_NS, { [SESSION_COST_PRICES_FIELD]: parsed.prices });
      if (!readSection()) {
        cached = parsed.prices;
        observed = true;
      }
    }
  };
}

// src/host/prices-repair.ts
function createPricesRepair(deps) {
  const { prices, warn, log } = deps;
  let done = false;
  let inflight = null;
  let lastReason = null;
  function warnOnce(reason) {
    if (lastReason === reason) return;
    lastReason = reason;
    warn(reason);
  }
  async function run() {
    try {
      if (!prices.isSectionRegistered()) {
        warnOnce("flat price repair deferred: the ui-conversation settings section is not registered yet");
        return;
      }
      lastReason = null;
      const repaired = repairFlatEntries(prices.snapshot());
      if (!repaired.changed) {
        done = true;
        return;
      }
      await prices.save(repaired.prices);
      done = true;
      log(
        "repaired the stored conversation prices: every \u5CF0\u8C37\u8BA1\u4EF7-OFF record gained the idle column, so both periods bill the entered price"
      );
    } catch (err) {
      warnOnce("flat price repair failed (retried on the next billing.get): " + String(err?.message ?? err));
    }
  }
  return {
    isDone: () => done,
    attempt() {
      if (done) return Promise.resolve();
      if (inflight !== null) return inflight;
      const running = run().finally(() => {
        inflight = null;
      });
      inflight = running;
      return running;
    }
  };
}

// src/host/session-repair.ts
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve } from "node:path";

// src/host/zstd-frames.ts
import { constants, zstdCompress as nodeZstdCompress, zstdDecompress as nodeZstdDecompress } from "node:zlib";
import { promisify } from "node:util";
var zstdCompressAsync = promisify(nodeZstdCompress);
var zstdDecompressAsync = promisify(nodeZstdDecompress);
var ZSTD_MAGIC = 4247762216;
var CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };
function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  let tornStart;
  outer: while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      tornStart = start;
      break;
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error("corrupt Zstandard session log: invalid frame magic at byte " + offset);
    }
    offset += 4;
    if (offset === buffer.length) {
      tornStart = start;
      break;
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error("corrupt Zstandard session log: reserved frame-header bit at byte " + (offset - 1));
    }
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const contentSizeFlag = descriptor >>> 6;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? singleSegment ? 1 : 0 : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      tornStart = start;
      break;
    }
    offset += remainingHeaderBytes;
    for (; ; ) {
      if (buffer.length - offset < 3) {
        tornStart = start;
        break outer;
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = blockHeader >>> 1 & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error("corrupt Zstandard session log: reserved block type at byte " + (offset - 3));
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        tornStart = start;
        break outer;
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        tornStart = start;
        break;
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames, tornStart };
}
async function decompressZstdFrame(input) {
  return zstdDecompressAsync(input);
}
async function compressZstdFrame(input) {
  return zstdCompressAsync(input, CHECKSUM_OPTIONS);
}

// src/host/storage-rows.ts
var CHUNK_TAGS = /* @__PURE__ */ new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
function malformed(tag, why) {
  throw new Error(`malformed ${tag} storage row: ${why}`);
}
function validateRunData(tag, data, payloadKey) {
  if (typeof data.turn !== "number" || typeof data.step !== "number" || typeof data.index !== "number") {
    malformed(tag, "turn/step/index must be numbers");
  }
  const payload = data[payloadKey];
  if (!Array.isArray(payload) || payload.length === 0 || payload.some((entry) => typeof entry !== "string")) {
    malformed(tag, `${payloadKey} must be a non-empty string array`);
  }
  const dt = data.dt;
  if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) {
    malformed(tag, "dt must be an array of safe integers");
  }
  if (dt.length !== payload.length - 1) {
    malformed(tag, `dt length ${dt.length} does not match ${payload.length} members`);
  }
  return payload;
}
function validateRow(value, tag) {
  if (!hasExactKeys(value, ["type", "seq0", "time0", "data"])) {
    malformed(tag, "envelope must be exactly {type, seq0, time0, data}");
  }
  if (!Number.isSafeInteger(value.seq0) || value.seq0 < 0) malformed(tag, "seq0 must be a non-negative safe integer");
  if (!Number.isSafeInteger(value.time0)) malformed(tag, "time0 must be a safe integer");
  const data = value.data;
  if (!isRecord(data)) malformed(tag, "data must be an object");
  let payload;
  if (tag === "tool-call-chunks") {
    const withName = hasExactKeys(data, ["turn", "step", "index", "id", "name", "dt", "args"]);
    if (!withName && !hasExactKeys(data, ["turn", "step", "index", "id", "dt", "args"])) {
      malformed(tag, "data must be exactly {turn, step, index, id, name?, dt, args}");
    }
    if (typeof data.id !== "string" || withName && typeof data.name !== "string") {
      malformed(tag, "id (and name when present) must be strings");
    }
    payload = validateRunData(tag, data, "args");
  } else {
    if (!hasExactKeys(data, ["turn", "step", "index", "dt", "texts"])) {
      malformed(tag, "data must be exactly {turn, step, index, dt, texts}");
    }
    payload = validateRunData(tag, data, "texts");
  }
  if (!Number.isSafeInteger(value.seq0 + payload.length - 1)) malformed(tag, "member seqs must stay safe integers");
  let time = value.time0;
  for (const gap of data.dt) {
    time += gap;
    if (!Number.isSafeInteger(time)) malformed(tag, "member times must stay safe integers");
  }
  return value;
}
function expandRow(row) {
  const members = row.type === "tool-call-chunks" ? row.data.args : row.data.texts;
  const events = [];
  let time = row.time0;
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += row.data.dt[k - 1];
    let chunk;
    switch (row.type) {
      case "text-chunks":
        chunk = { type: "text-delta", index: row.data.index, text: members[k] };
        break;
      case "reasoning-chunks":
        chunk = { type: "reasoning-delta", index: row.data.index, text: members[k] };
        break;
      case "tool-call-chunks":
        chunk = {
          type: "tool-call-delta",
          index: row.data.index,
          id: row.data.id,
          ...Object.hasOwn(row.data, "name") ? { name: row.data.name } : {},
          argumentsDelta: members[k]
        };
        break;
      default:
        throw new Error(`unreachable chunk row tag: ${row.type}`);
    }
    events.push({
      type: "assistant/chunk",
      seq: row.seq0 + k,
      time,
      data: { turn: row.data.turn, step: row.data.step, chunk }
    });
  }
  return events;
}
function decodeStorageRecord(value) {
  if (!isRecord(value)) return [value];
  const tag = value.type;
  if (tag !== "text-chunks" && tag !== "reasoning-chunks" && tag !== "tool-call-chunks") {
    if (typeof tag === "string" && CHUNK_TAGS.has(tag) === false && tag.endsWith("-chunks")) {
      throw new Error(`unrecognised packed storage row tag: ${tag}`);
    }
    return [value];
  }
  return expandRow(validateRow(value, tag));
}

// src/host/session-repair.ts
function resolveDshHome() {
  const env = process.env.DSH_HOME;
  if (env !== void 0 && env.trim() !== "") return resolve(env.trim());
  return join2(homedir2(), ".dsh");
}
function isRepairableSessionId(sessionId, failedSessionIds) {
  return typeof sessionId === "string" && sessionId !== "" && sessionId !== "." && sessionId !== ".." && !/[\x00/\\]/u.test(sessionId) && failedSessionIds.includes(sessionId);
}
var CANONICAL_ZSTD_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl\.zstd$/u;
var CANONICAL_PLAIN_NAME = /^session(?:\.v([1-9][0-9]*))?\.jsonl$/u;
function generationVersion(name2, pattern) {
  const match = pattern.exec(name2);
  if (match === null) return void 0;
  return match[1] === void 0 ? 0 : Number(match[1]);
}
async function locateSessionArtifact(home, sessionId) {
  const sessionsRoot = join2(home, "sessions");
  let projects = [];
  try {
    projects = await readdir(sessionsRoot);
  } catch {
    return null;
  }
  const needles = sessionId.startsWith("session-") ? [sessionId] : [sessionId, "session-" + sessionId];
  for (const needle of needles) for (const project of projects) {
    const projectDir = join2(sessionsRoot, project);
    let entries = [];
    try {
      entries = await readdir(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name !== needle) continue;
      const sessionDir = join2(projectDir, entry.name);
      let files = [];
      try {
        files = await readdir(sessionDir, { withFileTypes: true });
      } catch {
        return null;
      }
      let best;
      for (const file of files) {
        if (!file.isFile()) continue;
        const compressedVersion = generationVersion(file.name, CANONICAL_ZSTD_NAME);
        const version = compressedVersion ?? generationVersion(file.name, CANONICAL_PLAIN_NAME);
        if (version === void 0) continue;
        const compressed = compressedVersion !== void 0;
        if (best === void 0 || compressed && !best.compressed || compressed === best.compressed && version > best.version) {
          best = { path: join2(sessionDir, file.name), version, compressed };
        }
      }
      return best?.path ?? null;
    }
  }
  return null;
}
var SESSION_FORMAT_VERSION = 4;
var RELEASED_V3_EVENT_TYPES = /* @__PURE__ */ new Set([
  "agent-preset/selected",
  "agent/inbox/spliced",
  "approval/asked",
  "approval/decided",
  "approval/policy",
  "assistant/attempt",
  "assistant/message",
  "command/done",
  "command/run",
  "compaction/end",
  "compaction/prune",
  "compaction/start",
  "compaction/summary",
  "deliverables/presented",
  "feedback/message-delete",
  "feedback/message-put",
  "feedback/record",
  "goal/change",
  "hook/invoked",
  "hook/result",
  "image/offload",
  "llm/retry",
  "llm/retry-started",
  "model/selection",
  "permission/preset",
  "plan/mode",
  "request/context",
  "request/header",
  "sandbox/mode",
  "schedule/change",
  "session-log-deepseek/delivery-accepted",
  "session/end-seed",
  "session/title",
  "session/title-llm-request",
  "step/end",
  "step/start",
  "subagent/catalog",
  "subagent/descriptor",
  "subagent/model-selection-policy",
  "system/message",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "todo/write",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "tool/call",
  "tool/ptc-dispatch",
  "tool/ptc-dispatch-start",
  "tool/result",
  "turn/end",
  "turn/start",
  "user/message",
  "web/deepseek-search-llm-request",
  "workspace/changes"
]);
function headerVersion(header) {
  let parsed;
  try {
    parsed = JSON.parse(header);
  } catch {
    throw new Error("corrupt session log: header line is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("corrupt session log: first line is not a session header");
  }
  const version = parsed.version;
  return typeof version === "number" ? version : void 0;
}
function admitV3Lines(bodyLines) {
  const out = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line.trim() === "") continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      throw new Error("unparsable committed event at line " + (i + 2));
    }
    const record = row;
    if (typeof record === "object" && record !== null && !Array.isArray(record) && typeof record.type === "string" && typeof record.seq === "number" && !RELEASED_V3_EVENT_TYPES.has(record.type) && record["ignorable"] !== true) {
      record.ignorable = true;
      out.push(JSON.stringify(record));
    } else {
      out.push(line);
    }
  }
  return out;
}
async function rebuildSessionLog(bytes, decode) {
  const { frames, tornStart } = scanZstdFrames(bytes);
  if (frames.length === 0) {
    throw new Error("no complete zstd frames" + (tornStart !== void 0 ? " (torn tail " + tornStart + ")" : ""));
  }
  const parts = [];
  for (const frame of frames) parts.push(await decompressZstdFrame(bytes.subarray(frame.start, frame.end)));
  const plain = Buffer.concat(parts).toString("utf8");
  const lines = plain.split("\n");
  const header = lines[0] ?? "";
  if (header.trim() === "") throw new Error("empty or header-less session log");
  const version = headerVersion(header);
  if (version !== void 0 && version > SESSION_FORMAT_VERSION) {
    throw new Error(`session log format v${version} is newer than the supported v${SESSION_FORMAT_VERSION}`);
  }
  let bodyLines = lines.slice(1);
  if (!plain.endsWith("\n") && bodyLines.length > 0) {
    bodyLines = bodyLines.slice(0, -1);
  }
  if (version === 3) {
    const admitted = admitV3Lines(bodyLines);
    if (admitted.length === 0) throw new Error("no events found in session log");
    const rebuilt2 = Buffer.concat([
      await compressZstdFrame(header + "\n"),
      await compressZstdFrame(admitted.join("\n") + "\n")
    ]);
    return { events: admitted.length, rebuilt: rebuilt2, header };
  }
  const events = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (line.trim() === "") continue;
    let decoded;
    try {
      decoded = decode(JSON.parse(line));
    } catch {
      throw new Error("unparsable committed event at line " + (i + 2));
    }
    if (!Array.isArray(decoded)) throw new Error("malformed storage row at line " + (i + 2));
    for (const event of decoded) {
      const shaped = event;
      shaped.seq = events.length;
      events.push(shaped);
    }
  }
  if (events.length === 0) throw new Error("no events found in session log");
  const headerText = header + "\n";
  const bodyText = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const rebuilt = Buffer.concat([await compressZstdFrame(headerText), await compressZstdFrame(bodyText)]);
  return { events: events.length, rebuilt, header };
}
async function repairSessionLog(home, sessionId, decode) {
  const artifact = await locateSessionArtifact(home, sessionId);
  if (artifact === null) {
    throw new Error("session artifact not found under " + join2(home, "sessions"));
  }
  const bytes = await readFile(artifact);
  const rebuilt = await rebuildSessionLog(bytes, decode);
  if (rebuilt.events === 0) throw new Error("nothing to repair");
  const backup = artifact + ".bak-" + Date.now();
  await writeFile(backup, bytes);
  const tmp = artifact + ".tmp";
  await writeFile(tmp, rebuilt.rebuilt);
  await rename(tmp, artifact);
  return {
    repaired: rebuilt.events,
    backup,
    bytesBefore: bytes.length,
    bytesAfter: rebuilt.rebuilt.length
  };
}

// src/host/stats-cache.ts
import { join as join3 } from "node:path";
function statsCacheKey(watermark) {
  return "v" + OVERVIEW_VERSION + ":s" + PROJECTION_STATE_VERSION + ":n" + watermark.sessionsTotal + ":t" + (watermark.to ?? 0);
}
async function openStatsCache(home, warn) {
  let sqlite = null;
  try {
    sqlite = await import("node:sqlite");
  } catch (err) {
    warn("node:sqlite unavailable \u2014 stats cache is memory-only: " + String(err?.message ?? err));
    return null;
  }
  try {
    const db = new sqlite.DatabaseSync(join3(home, "dsh-usage-panel.sqlite"));
    db.exec(
      "PRAGMA journal_mode = WAL"
      // concurrent reads with the write path + crash recovery
    );
    db.exec(
      "PRAGMA synchronous = NORMAL"
      // WAL's standard durability/perf pairing
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, payload TEXT NOT NULL, savedAt INTEGER NOT NULL)"
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS ledger (sessionId TEXT PRIMARY KEY, asOfSeq INTEGER NOT NULL, savedAt INTEGER NOT NULL)"
    );
    const getStmt = db.prepare("SELECT payload FROM stats WHERE key = ?");
    const putStmt = db.prepare("INSERT OR REPLACE INTO stats (key, payload, savedAt) VALUES (?, ?, ?)");
    const ledgerGetStmt = db.prepare("SELECT asOfSeq FROM ledger WHERE sessionId = ?");
    const ledgerPutStmt = db.prepare("INSERT OR REPLACE INTO ledger (sessionId, asOfSeq, savedAt) VALUES (?, ?, ?)");
    const ledgerDeleteStmt = db.prepare("DELETE FROM ledger WHERE sessionId = ?");
    const ledgerClearStmt = db.prepare("DELETE FROM ledger");
    const ledgerCountStmt = db.prepare("SELECT COUNT(*) AS n FROM ledger");
    return {
      async get(key) {
        try {
          const row = getStmt.get(key);
          if (row === void 0 || row.payload === void 0) return null;
          const parsed = JSON.parse(row.payload);
          if (typeof parsed !== "object" || parsed === null) return null;
          return parsed;
        } catch {
          return null;
        }
      },
      async put(key, payload) {
        try {
          putStmt.run(key, JSON.stringify(payload), Date.now());
        } catch {
        }
      },
      async ledgerGet(sessionId) {
        try {
          const row = ledgerGetStmt.get(sessionId);
          return typeof row?.asOfSeq === "number" ? row.asOfSeq : null;
        } catch {
          return null;
        }
      },
      async ledgerPut(sessionId, asOfSeq) {
        try {
          ledgerPutStmt.run(sessionId, asOfSeq, Date.now());
        } catch {
        }
      },
      async ledgerDelete(sessionId) {
        try {
          ledgerDeleteStmt.run(sessionId);
        } catch {
        }
      },
      async ledgerClear() {
        try {
          ledgerClearStmt.run();
        } catch {
        }
      },
      async ledgerCount() {
        try {
          const row = ledgerCountStmt.get();
          return typeof row?.n === "number" ? row.n : 0;
        } catch {
          return 0;
        }
      },
      close() {
        try {
          db.exec("PRAGMA optimize");
        } catch {
        }
      }
    };
  } catch (err) {
    warn("stats cache open failed \u2014 memory-only: " + String(err?.message ?? err));
    return null;
  }
}

// src/host/index.ts
var name = "dsh-usage-panel";
var inject = [
  "timer",
  "connection",
  "sessionProjections",
  "sessionQuery",
  "sessionProjectionCache",
  "settings"
];
function channelContext(ctx) {
  const webServer = typeof ctx?.get === "function" ? ctx.get("webServer") : void 0;
  if (webServer === void 0 || typeof ctx?.extend !== "function") return ctx;
  return ctx.extend({ webServer });
}
function isSessionGone(err) {
  return err?.code === "SESSION_QUERY_SESSION_NOT_FOUND";
}
var STALE_MS = 10 * 60 * 1e3;
var RESCAN_MS = 10 * 60 * 1e3;
function apply(ctx) {
  const tag = "[dsh-usage-panel]";
  const scopedCtx = channelContext(ctx);
  const sq = ctx.get("sessionQuery");
  const registry = ctx.get("sessionProjections");
  const projCache = ctx.get("sessionProjectionCache");
  const connection = scopedCtx.get("connection");
  const llm = ctx.get("llm");
  let mode = "projection";
  console.log(
    tag,
    "boot: mode=" + mode,
    "services: sessionQuery=" + Boolean(sq) + " sessionProjections=" + Boolean(registry) + " sessionProjectionCache=" + Boolean(projCache)
  );
  let disposeUnit = null;
  try {
    disposeUnit = ctx.sessionProjections.register(
      // Desktop harness register() reads stateSchema + wire; npm rc.6 d.ts still wants schema + view.
      usagePanelProjectionDefinition
    );
  } catch (err) {
    console.warn(tag, "projection registration failed; falling back to full scan:", String(err?.message ?? err));
    disposeUnit = null;
    mode = "scan";
  }
  let providerNames = {};
  if (llm && typeof llm.listProviders === "function") {
    Promise.resolve(llm.listProviders()).then((infos) => {
      providerNames = Object.fromEntries((infos || []).map((p) => [p.id, p.name]));
    }).catch((err) => console.warn(tag, "listProviders failed:", String(err?.message ?? err)));
  }
  let cache = null;
  let inflight = null;
  let disposed = false;
  let sessionIndex = [];
  let failedSessionIds = [];
  let reportedSource = "";
  const reportedCostFailures = /* @__PURE__ */ new Set();
  let statsCache = null;
  openStatsCache(resolveDshHome(), (message) => console.warn(tag, message)).then((cache2) => {
    statsCache = cache2;
  });
  const settings = ctx.get("settings");
  const pricesSource = createPricesSource(settings, (message) => console.warn(tag, message));
  ctx.on("settings/document-updated", (ns) => {
    if (String(ns) === CONVERSATION_SETTINGS_NS) pricesSource.refresh();
  });
  const pricesRepair = createPricesRepair({
    prices: pricesSource,
    warn: (message) => console.warn(tag, message),
    log: (message) => console.log(tag, message)
  });
  void pricesRepair.attempt();
  const legacyStore = new BillingStore(void 0, (message) => console.warn(tag, message));
  const legacyImport = createLegacyBillingImport({
    store: legacyStore,
    prices: pricesSource,
    warn: (message) => console.warn(tag, message),
    log: (message) => console.log(tag, message)
  });
  openBillingMedium(ctx.get("storageDomain"), (message) => console.warn(tag, message)).then((medium) => {
    if (medium) legacyStore.attachMedium(medium);
    return legacyImport.attempt();
  });
  function logFailure(message) {
    console.warn(tag, message);
  }
  async function scanProjection(now, magpie) {
    let a = emptyAggregate();
    let sessionsTotal = 0;
    let sessionsOk = 0;
    let sessionsFailed = 0;
    let sessionsPending = 0;
    const failures = [];
    let sessions = [];
    try {
      sessions = await sq.listSessions();
    } catch (err) {
      logFailure("listSessions failed: " + String(err?.message ?? err));
      return emptyOverview(now);
    }
    const pacer = scanPacer((message) => console.log(tag, message));
    const failed = [];
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i];
      const header = rec && rec.header;
      if (!header) {
        sessionsTotal += 1;
        sessionsFailed += 1;
        await pacer.beat(i + 1, sessions.length);
        continue;
      }
      const id = header.id;
      sessionsTotal += 1;
      if (!rec.persisted) {
        sessionsPending += 1;
        await pacer.beat(i + 1, sessions.length);
        continue;
      }
      try {
        const log = await sq.readSession(id);
        const snap = projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events);
        const value = snap.values.usagePanel;
        if (!value) {
          sessionsPending += 1;
          await pacer.beat(i + 1, sessions.length);
          continue;
        }
        a = mergeSessionValue(a, value, id, now, 0, log.session.cwd ?? null);
        sessionsOk += 1;
      } catch (err) {
        sessionsFailed += 1;
        if (!isSessionGone(err) && failed.length < 50) failed.push(id);
        if (failures.length < 3) failures.push(String(err?.message ?? err));
      }
      await pacer.beat(i + 1, sessions.length);
    }
    failedSessionIds = failed;
    if (failures.length > 0) {
      logFailure(sessionsFailed + " session(s) failed to read (first " + failures.length + "): " + failures.join(" | "));
    }
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER);
    const titles = /* @__PURE__ */ new Map();
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        try {
          const t = await sq.readTitle(s.id);
          titles.set(s.id, t ? t.title : null);
        } catch {
          titles.set(s.id, null);
        }
      })
    );
    return finalizeOverview({
      aggregate: a,
      now,
      mode: "projection",
      sessionsTotal,
      sessionsOk,
      sessionsFailed,
      sessionsPending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds: failed,
      magpie
    });
  }
  async function gatewaySource() {
    return loadMagpieSource(void 0, (message) => console.warn(tag, message));
  }
  async function scan(now, magpie) {
    if (disposed) return cache ? cache.payload : emptyOverview(now);
    if (mode === "projection") return scanProjection(now, magpie);
    return scanFallback({ sq, providerNames, logFailure, storeIndex: (rows) => {
      sessionIndex = rows;
    }, storeFailed: (ids) => {
      failedSessionIds = ids;
    }, magpie }, now);
  }
  async function watermarkKey() {
    const sessions = await sq.listSessions();
    let to = null;
    for (const rec of sessions) {
      const created = rec?.header?.createdAt;
      if (typeof created === "number" && (to === null || created > to)) to = created;
    }
    return statsCacheKey({ sessionsTotal: sessions.length, to });
  }
  async function hydrateFromCache() {
    if (cache !== null || statsCache === null) return;
    let payload = null;
    try {
      payload = await statsCache.get(await watermarkKey());
    } catch {
      payload = null;
    }
    if (payload !== null && !disposed) {
      cache = { at: payload.updatedAt, payload };
      console.log(tag, "stats cache hit \u2014 serving snapshot, refreshing in background");
    }
  }
  function startScan() {
    if (disposed) return Promise.resolve(cache ? cache.payload : emptyOverview(Date.now()));
    if (inflight) return inflight;
    const run = (async () => {
      await hydrateFromCache();
      const magpie = await gatewaySource();
      const magpieKey = magpie === null ? "logs" : magpie.file;
      if (magpieKey !== reportedSource) {
        reportedSource = magpieKey;
        if (magpie === null) {
          console.log(tag, "totals source: session logs (no Magpie usage file at " + resolveMagpieUsageFile() + ")");
        } else {
          console.log(
            tag,
            "totals source: Magpie gateway ledger (agent=dsh)",
            "calls=" + magpie.calls,
            "range=" + (magpie.from === null ? "-" : new Date(magpie.from).toISOString()) + ".." + (magpie.to === null ? "-" : new Date(magpie.to).toISOString()),
            "file=" + magpie.file
          );
        }
      }
      const payload = await scan(Date.now(), magpie);
      if (payload !== null && !disposed) {
        cache = { at: Date.now(), payload };
        if (statsCache !== null) {
          setImmediate(() => {
            if (disposed) return;
            void (async () => {
              try {
                const key = await watermarkKey();
                await statsCache.put(key, payload);
              } catch {
              }
            })();
          });
        }
      }
      return payload;
    })();
    inflight = run;
    run.catch(() => {
    }).then(() => {
      if (inflight === run) inflight = null;
    });
    return run;
  }
  function overview(args) {
    const force = !!(args && args.force);
    if (!force && cache) {
      if (Date.now() - cache.at < STALE_MS) return Promise.resolve(cache.payload);
      startScan();
      return Promise.resolve(Object.assign({}, cache.payload, { stale: true }));
    }
    return startScan();
  }
  const ZERO_TOTALS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  const ZERO_PHASE = {
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  };
  async function sessionCost(payload) {
    const sessionId = payload.sessionId;
    if (!sessionId) throw new Error("missing sessionId");
    const sessions = ctx.get("sessions");
    let value;
    try {
      const live = sessions && sessions.get(sessionId);
      if (live) {
        const liveRegistry = registry;
        value = liveRegistry.stateOf(live, USAGE_PANEL_KEY);
      } else {
        const log = await sq.readSession(sessionId);
        value = projCache.coldSnapshot(log.session, log.inheritedEventCount, log.events).values.usagePanel;
      }
    } catch (err) {
      if (isSessionGone(err)) {
        return { found: false, currentModel: "unknown", currentProvider: "unknown", cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } };
      }
      if (!reportedCostFailures.has(sessionId)) {
        reportedCostFailures.add(sessionId);
        logFailure("session.cost read failed for " + sessionId + ": " + String(err?.message ?? err));
        logFailure("session.cost will not retry reporting this session until the plugin reloads; open \u8BBE\u7F6E \u2192 \u7528\u91CF\u7EDF\u8BA1 and click the \u300C\u4FEE\u590D\u300D button in the page header (backed up to .bak-<ts> before rewriting)");
      }
      if (!failedSessionIds.includes(sessionId)) {
        failedSessionIds = [...failedSessionIds, sessionId];
        cache = null;
      }
    }
    if (!value) {
      return { found: false, currentModel: "unknown", currentProvider: "unknown", cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } };
    }
    return {
      found: true,
      currentModel: value.currentModel,
      currentProvider: value.currentProvider,
      cost: value.costTotals,
      models: sessionModels(value),
      totals: {
        ...value.totals,
        // Same total rule as every other payload: uncached input + output.
        total: value.totals.input + value.totals.output
      }
    };
  }
  const PAGE_SIZE = 10;
  function billingSettings() {
    return { prices: pricesSource.snapshot(), peakValleyEnabled: true };
  }
  const sortOf = (payload) => payload?.sort ?? "tokens";
  async function sessionsMore(payload) {
    const offset = Math.max(0, payload?.offset ?? 0);
    const sort = sortOf(payload);
    const ranked = rankSessionsBy(sessionIndex, sort, pricesSource.snapshot(), true);
    const { rows, hasMore } = pageOf(ranked, offset, PAGE_SIZE);
    const titles = /* @__PURE__ */ new Map();
    await Promise.all(
      rows.map(async (s) => {
        try {
          const t = await sq.readTitle(s.id);
          titles.set(s.id, t ? t.title : null);
        } catch {
          titles.set(s.id, null);
        }
      })
    );
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        title: titles.get(s.id) ?? null,
        totals: s.totals,
        lastActive: s.lastActive,
        depth: s.depth,
        models: s.models
      })),
      hasMore
    };
  }
  async function projectsMore(payload) {
    const offset = Math.max(0, payload?.offset ?? 0);
    const all = projectRowsOf(sessionIndex, sortOf(payload), pricesSource.snapshot(), true);
    const { rows, hasMore } = pageOf(all, offset, PAGE_SIZE);
    return { rows, hasMore };
  }
  async function repairSession(payload) {
    const sessionId = payload.sessionId;
    if (!isRepairableSessionId(sessionId, failedSessionIds)) {
      throw new Error("invalid session id");
    }
    const outcome = await repairSessionLog(resolveDshHome(), sessionId, decodeStorageRecord);
    failedSessionIds = failedSessionIds.filter((id) => id !== sessionId);
    cache = null;
    return outcome;
  }
  async function billingModels() {
    const options = /* @__PURE__ */ new Map();
    const ensure = (provider, providerName) => {
      let option = options.get(provider);
      if (option === void 0) {
        option = { provider, providerName, models: [] };
        options.set(provider, option);
      }
      return option;
    };
    let providers = [];
    if (llm) {
      try {
        providers = await withTimeout(Promise.resolve(llm.listProviders()), 2e3, "provider directory");
      } catch (err) {
        logFailure("billing.models listProviders failed/slow: " + String(err?.message ?? err));
      }
    }
    for (const p of providers) {
      const option = ensure(p.id, p.name || p.id);
      if (isDeepSeekProvider(p.id)) {
        for (const entry of DEEPSEEK_OFFICIAL_PRICES) {
          if (!option.models.includes(entry.model)) option.models.push(entry.model);
        }
      }
    }
    if (llm && typeof llm.listModels === "function") {
      await Promise.all(
        providers.map(async (p) => {
          try {
            const infos = await withTimeout(Promise.resolve(llm.listModels(p.id)), 2e3, "adapter models for " + p.id);
            const option = ensure(p.id, p.name || p.id);
            for (const info of infos) {
              if (info && info.id && !option.models.includes(info.id)) option.models.push(info.id);
            }
          } catch {
          }
        })
      );
    }
    if (cache) {
      for (const session of cache.payload.topSessions) {
        for (const row of session.models) {
          const provider = row.provider === "unknown" ? "(unknown)" : row.provider;
          const option = ensure(provider, provider);
          if (!option.models.includes(row.model)) option.models.push(row.model);
        }
      }
    }
    return { options: [...options.values()] };
  }
  const disposeRpc = connection && connection.rpc.handle(
    RPC_CHANNEL,
    (endpoint, payload) => {
      if (endpoint === RPC_OVERVIEW) {
        return overview(payload).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_GET) {
        return legacyImport.attempt().then(() => pricesRepair.attempt()).then(
          () => ({ ok: true, value: billingSettings() }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_SET) {
        const next = { ...DEFAULT_BILLING_SETTINGS, ...payload ?? {} };
        return pricesSource.save(next.prices).then(
          () => ({ ok: true, value: billingSettings() }),
          (err) => ({
            ok: false,
            error: {
              code: "bad-request",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_BILLING_MODELS) {
        return billingModels().then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_SESSION_COST) {
        return sessionCost(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_SESSIONS_MORE) {
        return sessionsMore(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_PROJECTS_MORE) {
        return projectsMore(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      if (endpoint === RPC_REPAIR_SESSION) {
        return repairSession(payload ?? {}).then(
          (value) => ({ ok: true, value }),
          (err) => ({
            ok: false,
            error: {
              code: "internal",
              message: String(err?.message ?? err),
              details: {}
            }
          })
        );
      }
      return Promise.resolve({
        ok: false,
        error: { code: "bad-request", message: "unknown endpoint: " + String(endpoint), details: { issues: [] } }
      });
    },
    { authority: "loopback" }
  );
  startScan().then((o) => {
    console.log(
      tag,
      "first scan done:",
      "mode=" + o.coverage.mode,
      "sessions=" + o.coverage.sessionsTotal + "/" + o.coverage.sessionsOk + " (failed " + o.coverage.sessionsFailed + ", pending " + o.coverage.sessionsPending + ")",
      "withUsage=" + o.allTime.sessionCount,
      "dataRange=" + (o.coverage.from === null ? "-" : new Date(o.coverage.from).toISOString()) + ".." + (o.coverage.to === null ? "-" : new Date(o.coverage.to).toISOString())
    );
  });
  const stopTimer = ctx.interval(() => {
    if (!inflight) startScan();
  }, RESCAN_MS);
  ctx.effect(() => () => {
    disposed = true;
    if (disposeUnit) disposeUnit();
    if (stopTimer) stopTimer();
    if (disposeRpc) disposeRpc();
  });
}
export {
  apply,
  inject,
  name
};
