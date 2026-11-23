/**
 * Per-Bot Peak/Off-Peak Budget & Usage Governance Service.
 *
 * Official billing windows (Beijing wall time, UTC+8, DST-free, aligned with
 * `vendor/dsh-usage-panel/src/shared/billing.ts`):
 * - Peak: Monday–Friday 09:00–12:00 and 14:00–18:00 UTC+8
 * - Off-peak: all other instants (weekends, 12:00–14:00 break, 18:00–09:00)
 *
 * Persists budgets in `bot_budgets` and aggregated usage in `bot_usage_daily`
 * via `workStore`. Supports circuit-breaking (`budget_exceeded` + optional
 * `needs_you` item) and background deferral (`off_peak_only`).
 */
import { DEFAULT_BOT_BUDGET } from '../../src/shared/index.js';

const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_MAX = 5; // getUTCDay(): 1..5 are Monday..Friday

/** Peak windows in minutes of day (Beijing wall time). */
const PEAK_WINDOWS = Object.freeze([
  Object.freeze({ open: 9 * 60, close: 12 * 60 }),
  Object.freeze({ open: 14 * 60, close: 18 * 60 }),
]);

/** @param {number} [epochMs] */
export function utcDayKey(epochMs = Date.now()) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Whether `epochMs` falls inside an official Beijing peak billing window.
 * @param {number} [epochMs]
 */
export function isPeakNow(epochMs = Date.now()) {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS);
  const day = wall.getUTCDay();
  if (day < 1 || day > WEEKDAY_MAX) return false;
  const minuteOfDay = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  return PEAK_WINDOWS.some((w) => minuteOfDay >= w.open && minuteOfDay < w.close);
}

/**
 * Whether `epochMs` falls inside an official Beijing off-peak window.
 * @param {number} [epochMs]
 */
export function isOffPeakNow(epochMs = Date.now()) {
  return !isPeakNow(epochMs);
}

/**
 * Epoch ms of the next peak/off-peak boundary strictly after `epochMs`.
 * @param {number} [epochMs]
 */
export function nextPeakSwitchMs(epochMs = Date.now()) {
  const wall = new Date(epochMs + BEIJING_UTC_OFFSET_MS);
  const dayStartUtc = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const weekday = (wall.getUTCDay() + dayOffset) % 7;
    if (weekday < 1 || weekday > WEEKDAY_MAX) continue;
    const candidateDay = dayStartUtc + dayOffset * DAY_MS;
    for (const win of PEAK_WINDOWS) {
      for (const minute of [win.open, win.close]) {
        const ts = candidateDay + minute * 60_000 - BEIJING_UTC_OFFSET_MS;
        if (ts > epochMs) return ts;
      }
    }
  }
  return epochMs + DAY_MS;
}

/** @param {number} [epochMs] */
export function getPeakValleyState(epochMs = Date.now()) {
  const peak = isPeakNow(epochMs);
  const nextSwitchMs = nextPeakSwitchMs(epochMs);
  return {
    phase: peak ? 'peak' : 'off-peak',
    isPeak: peak,
    isOffPeak: !peak,
    nextSwitchMs,
    msRemaining: Math.max(0, nextSwitchMs - epochMs),
  };
}

/** @param {string} botId @param {any} row */
function normalizeBudget(botId, row) {
  return {
    botId: String(botId),
    dailyLimitUsd: row?.dailyLimitUsd ?? DEFAULT_BOT_BUDGET.dailyLimitUsd,
    dailyLimitTokens: row?.dailyLimitTokens ?? DEFAULT_BOT_BUDGET.dailyLimitTokens,
    offPeakOnly: row ? Boolean(row.offPeakOnly) : DEFAULT_BOT_BUDGET.offPeakOnly,
    pauseOnExceed: row ? Boolean(row.pauseOnExceed) : DEFAULT_BOT_BUDGET.pauseOnExceed,
    alertThresholdPct: row?.alertThresholdPct ?? DEFAULT_BOT_BUDGET.alertThresholdPct,
    updatedAt: row?.updatedAt ?? null,
  };
}

/** @param {any} usage */
function computeCacheHitRate(usage) {
  const promptTokens = (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
  if (promptTokens <= 0) return 0;
  return Number(((usage.cacheReadTokens ?? 0) / promptTokens).toFixed(4));
}

/** @param {any} budget @param {any} usage */
function evaluateLimits(budget, usage) {
  const usdLimit = budget.dailyLimitUsd;
  const tokLimit = budget.dailyLimitTokens;
  const usdUsedPct = typeof usdLimit === 'number' && usdLimit > 0
    ? Number(((usage.costUsd / usdLimit) * 100).toFixed(2))
    : null;
  const tokensUsedPct = typeof tokLimit === 'number' && tokLimit > 0
    ? Number(((usage.totalTokens / tokLimit) * 100).toFixed(2))
    : null;
  const exceededUsd = typeof usdLimit === 'number' && usdLimit >= 0 && usage.costUsd >= usdLimit;
  const exceededTokens = typeof tokLimit === 'number' && tokLimit >= 0 && usage.totalTokens >= tokLimit;
  const exceeded = exceededUsd || exceededTokens;
  const threshold = budget.alertThresholdPct ?? 80;
  const nearLimit = !exceeded && (
    (usdUsedPct !== null && usdUsedPct >= threshold)
    || (tokensUsedPct !== null && tokensUsedPct >= threshold)
  );
  return { usdUsedPct, tokensUsedPct, exceededUsd, exceededTokens, exceeded, nearLimit };
}

/** @param {any} itemsStore @param {any} botsStore @param {string} botId @param {any} summary @param {number} at */
function createBudgetExceededItem(itemsStore, botsStore, botId, summary, at) {
  if (!itemsStore || typeof itemsStore.add !== 'function') return null;
  const day = summary.dayUtc;
  const dedupTitle = `日预算已达上限 (${day})`;
  const existing = itemsStore.needsYou?.({ ownerBotId: botId, now: at, includeSnoozed: true }) ?? [];
  const dup = existing.find((/** @type {any} */ item) => item.title === dedupTitle);
  if (dup) return dup;

  const bot = botsStore?.getBot?.(botId) ?? null;
  const chatId = bot?.chatSessionId || `bot-budget:${botId}`;
  const limitDesc = [
    summary.budget.dailyLimitUsd !== null ? `费用 $${summary.today.costUsd.toFixed(4)} / $${summary.budget.dailyLimitUsd}` : null,
    summary.budget.dailyLimitTokens !== null ? `Token ${summary.today.totalTokens} / ${summary.budget.dailyLimitTokens}` : null,
  ].filter(Boolean).join('；');

  const res = itemsStore.add({
    ownerBotId: botId,
    chatId,
    source: { kind: 'automation', title: 'budget-guard' },
    title: dedupTitle,
    description: `${bot?.name || botId} 今日用量已触发预算熔断（${limitDesc}）。`,
    status: 'needs_you',
    ask: {
      context: `该队友已触发日预算保护并暂停新回合（${limitDesc}）。`,
      questions: [{
        prompt: '请选择处理方式：',
        options: [
          { label: '提高今日预算上限并继续' },
          { label: '保持暂停直到明日重置' },
          { label: '仅在谷段继续运行后台任务' },
        ],
        recommended: 1,
        multi: false,
      }],
    },
  }, { kind: 'orca', why: 'budget_exceeded' }, at);
  return res?.item ?? null;
}

/**
 * Create the Bot Budget & Peak/Off-Peak Governance service.
 * @param {{
 *   workStore: any,
 *   botsStore?: any,
 *   itemsStore?: any,
 *   eventBus?: any,
 *   onBudgetExceeded?: (info: { botId: string, summary: any, at: number }) => any,
 *   now?: () => number,
 * }} deps
 */
export function createBudgetService(deps) {
  const { workStore, botsStore = null, itemsStore = null, eventBus = null, onBudgetExceeded = null } = deps;
  const nowFn = deps.now ?? (() => Date.now());
  if (!workStore) throw new Error('createBudgetService requires workStore');

  /** @param {string} botId */
  function getBudget(botId) {
    return normalizeBudget(botId, workStore.getBotBudget(String(botId)));
  }

  /** @param {string} botId @param {Record<string, any>} [patch] */
  function setBudget(botId, patch = {}, at = nowFn()) {
    const saved = workStore.setBotBudget(String(botId), patch, at);
    eventBus?.emit({ botIds: [String(botId)], kinds: ['bot', 'settings'] });
    return normalizeBudget(botId, saved);
  }

  /** @param {string} botId @param {{ at?: number, dayUtc?: string, days?: number }} [options] */
  function getBudgetSummary(botId, options = {}) {
    const id = String(botId);
    const at = options.at ?? nowFn();
    const dayUtc = options.dayUtc || utcDayKey(at);
    const days = Math.min(90, Math.max(1, Number(options.days) || 7));
    const fromDayUtc = utcDayKey(at - (days - 1) * DAY_MS);

    const budget = getBudget(id);
    const today = workStore.sumBotUsageForDay(id, dayUtc);
    const todayRows = workStore.listBotUsageDaily({ botId: id, dayUtc });
    const history = workStore.listBotUsageDaily({ botId: id, fromDayUtc, toDayUtc: dayUtc });
    const limits = evaluateLimits(budget, today);
    const peakValley = getPeakValleyState(at);

    return {
      botId: id,
      dayUtc,
      budget,
      today: {
        ...today,
        cacheHitRate: computeCacheHitRate(today),
      },
      bySource: todayRows,
      history,
      ...limits,
      peakValley,
    };
  }

  /** @param {any} input */
  function recordUsage(input, at = nowFn()) {
    const botId = String(input?.botId ?? '').trim();
    if (!botId) throw Object.assign(new Error('botId is required for recordUsage'), { code: 'invalid_argument' });
    const dayUtc = input.dayUtc || utcDayKey(at);
    const costUsd = Math.max(0, Number(input.costUsd) || 0);
    const peak = isPeakNow(at);
    const peakCostUsd = input.peakCostUsd !== undefined ? Math.max(0, Number(input.peakCostUsd) || 0) : (peak ? costUsd : 0);
    const offPeakCostUsd = input.offPeakCostUsd !== undefined
      ? Math.max(0, Number(input.offPeakCostUsd) || 0)
      : (peak ? 0 : costUsd);

    const row = workStore.upsertBotUsageDaily({
      dayUtc,
      botId,
      sourceKind: input.sourceKind || 'bot_chats',
      inputTokens: Math.max(0, Number(input.inputTokens) || 0),
      cacheReadTokens: Math.max(0, Number(input.cacheReadTokens) || 0),
      cacheWriteTokens: Math.max(0, Number(input.cacheWriteTokens) || 0),
      outputTokens: Math.max(0, Number(input.outputTokens) || 0),
      costUsd,
      peakCostUsd,
      offPeakCostUsd,
      mode: input.mode || 'add',
    }, at);

    const summary = getBudgetSummary(botId, { dayUtc, at });
    eventBus?.emit({ botIds: [botId], kinds: ['bot', 'status'] });
    return { usage: row, summary, isPeak: peak };
  }

  /** @param {string} botId @param {{ at?: number, isBackground?: boolean, createNeedsYouOnExceed?: boolean }} [options] */
  function checkExecutionAllowed(botId, options = {}) {
    const id = String(botId);
    const at = options.at ?? nowFn();
    const isBackground = options.isBackground === true;
    const createNeedsYou = options.createNeedsYouOnExceed !== false;
    const summary = getBudgetSummary(id, { at });

    if (summary.exceeded && summary.budget.pauseOnExceed) {
      let needsYouItem = null;
      if (typeof onBudgetExceeded === 'function') {
        needsYouItem = onBudgetExceeded({ botId: id, summary, at }) ?? null;
      } else if (createNeedsYou) {
        needsYouItem = createBudgetExceededItem(itemsStore, botsStore, id, summary, at);
      }
      if (needsYouItem) eventBus?.emit({ botIds: [id], kinds: ['items', 'status'] });
      return {
        allowed: false,
        reason: 'budget_exceeded',
        deferUntilMs: null,
        summary,
        needsYouItem,
      };
    }

    if (isBackground && summary.budget.offPeakOnly && !summary.peakValley.isOffPeak) {
      return {
        allowed: false,
        reason: 'off_peak_only',
        deferUntilMs: summary.peakValley.nextSwitchMs,
        summary,
        needsYouItem: null,
      };
    }

    return {
      allowed: true,
      reason: summary.nearLimit ? 'near_limit' : 'ok',
      deferUntilMs: null,
      summary,
      needsYouItem: null,
    };
  }

  function listUsage(filters = {}) {
    return workStore.listBotUsageDaily(filters);
  }

  return {
    getBudget,
    setBudget,
    recordUsage,
    getBudgetSummary,
    checkExecutionAllowed,
    listUsage,
    isPeakNow,
    isOffPeakNow,
    nextPeakSwitchMs,
    getPeakValleyState,
  };
}
