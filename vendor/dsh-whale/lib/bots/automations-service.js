/**
 * Bot Automations & one-shot Waits runtime service.
 * Persists schedules and waits in `bot_automations` (via `workStore`) and
 * guarantees idempotent failure retries via `bot_run_resends`.
 *
 * Supports:
 * - RFC 5545 RRULE (`FREQ=MINUTELY|HOURLY|DAILY|WEEKLY|MONTHLY`, `INTERVAL`,
 *   `BYDAY`, `BYHOUR`, `BYMINUTE`, `BYMONTHDAY`, `WKST`) with strict validation
 * - Standard 5-field Cron expressions (used by built-in templates)
 * - IANA timezone & local wall-clock scheduling
 * - `NO_REPLY` quiet result suppression (`isQuietResult`)
 * - Result delivery back to Home Chat or configured Group room when `runsIn === 'new'`
 * - Missed-run grace window (default 15m) to skip stale triggers after sleep/wake
 * - Shared-turn merged answer settlement (`completed` instead of false failure)
 */
import crypto from 'node:crypto';
import { isQuietResult, stripQuietMarker } from '../../src/shared/index.js';
import { BOT_OWNER_AUTOMATION } from './session-runtime.js';
import {
  computeNextRunAt,
  computeSafeNextRunAt,
  invalidArg,
  isSharedTurnCompleted,
  isSharedTurnMerged,
  normalizeAutomationCreate,
  parseScheduleExpression,
  resolveGroupDestination,
  shouldAutoDeleteOnce,
  validateIntervalMinutes,
  validateTimezone,
} from './automations-schedule.js';

export { computeNextRunAt, parseScheduleExpression };

const SCHEDULER_TICK_MS = 60_000;
export const DEFAULT_MISSED_RUN_GRACE_MS = 15 * 60_000;
const MAX_SUMMARY_CHARS = 8_000;

/** @param {Record<string, any>} nextPatch */
function hasScheduleFieldChanges(nextPatch) {
  return (
    nextPatch.schedule !== undefined
    || nextPatch.rrule !== undefined
    || nextPatch.timezone !== undefined
    || nextPatch.intervalMinutes !== undefined
    || nextPatch.once !== undefined
  );
}

/** @param {any} merged @param {Record<string, any>} nextPatch @param {number} now */
function resolveUpdatedNextRunAt(merged, nextPatch, now) {
  if (merged.enabled === false) return null;
  if (nextPatch.nextRunAt !== undefined) return nextPatch.nextRunAt;
  if (hasScheduleFieldChanges(nextPatch) || (nextPatch.enabled === true && !merged.nextRunAt)) {
    return computeNextRunAt(merged, now);
  }
  return merged.nextRunAt;
}

/**
 * Create the Bot Automations & Waits service.
 * @param {{
 *   botsStore: any,
 *   workStore: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 *   groupsService?: any,
 *   getGroupsService?: () => any,
 *   missedRunGraceMs?: number,
 *   enableScheduler?: boolean,
 * }} deps
 */
export function createAutomationsService(deps) {
  const { botsStore, workStore, sessionRuntime, eventBus } = deps;
  const missedRunGraceMs = typeof deps.missedRunGraceMs === 'number'
    && Number.isFinite(deps.missedRunGraceMs)
    && deps.missedRunGraceMs >= 0
    ? deps.missedRunGraceMs
    : DEFAULT_MISSED_RUN_GRACE_MS;
  const groupsServiceOf = () => (
    typeof deps.getGroupsService === 'function' ? deps.getGroupsService() : (deps.groupsService ?? null)
  );
  /** @type {Set<string>} */
  const runningIds = new Set();

  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  function list({ botId = null, enabledOnly = false } = {}) {
    return workStore.listAutomations({ botId, enabledOnly });
  }

  /** @param {any} params @param {number} [now] */
  function create(params, now = Date.now()) {
    const bot = requireBot(params?.botId);
    const saved = workStore.upsertAutomation(normalizeAutomationCreate(params, bot.id, now), now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
    return saved;
  }

  /** @param {any} current @param {Record<string, any>} patch @param {number} now */
  function persistAutomationState(current, patch, now) {
    const merged = {
      ...current,
      ...patch,
      id: current.id,
      botId: current.botId,
      createdAt: current.createdAt,
    };
    const needsNullClear = (
      (Object.prototype.hasOwnProperty.call(patch, 'nextRunAt') && patch.nextRunAt === null && current.nextRunAt !== null)
      || (Object.prototype.hasOwnProperty.call(patch, 'lastError') && patch.lastError === null && current.lastError !== null)
    );
    if (needsNullClear && typeof workStore.deleteAutomation === 'function') {
      workStore.deleteAutomation(current.id);
      return workStore.upsertAutomation(merged, now);
    }
    return workStore.upsertAutomation(merged, now);
  }

  /** @param {string} id @param {Record<string, any>} [patch] @param {number} [now] */
  function update(id, patch = {}, now = Date.now()) {
    const current = workStore.getAutomation(id);
    if (!current) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    /** @type {Record<string, any>} */
    const nextPatch = { ...patch };
    if (nextPatch.rrule !== undefined && nextPatch.schedule === undefined) {
      nextPatch.schedule = nextPatch.rrule;
    }
    const merged = { ...current, ...nextPatch, id: current.id, botId: current.botId };
    if (merged.timezone !== undefined) merged.timezone = validateTimezone(merged.timezone);
    if (typeof merged.schedule === 'string' && merged.schedule.trim()) {
      parseScheduleExpression(merged.schedule);
    }
    validateIntervalMinutes(merged.intervalMinutes);
    merged.nextRunAt = resolveUpdatedNextRunAt(merged, nextPatch, now);
    const saved = persistAutomationState(current, merged, now);
    eventBus.emit({ botIds: [saved.botId], kinds: ['automations'] });
    return saved;
  }

  /** @param {string} id */
  function remove(id) {
    const current = workStore.getAutomation(id);
    if (!current) return { deleted: false };
    const deleted = workStore.deleteAutomation(id);
    if (deleted) eventBus.emit({ botIds: [current.botId], kinds: ['automations'] });
    return { deleted };
  }

  /** @param {{ auto: any, bot: any, sourceSessionId: string | null, cleanReply: string }} args */
  async function deliverResult({ auto, bot, sourceSessionId, cleanReply }) {
    if (!cleanReply) return null;
    const summary = cleanReply.length > MAX_SUMMARY_CHARS
      ? `${cleanReply.slice(0, MAX_SUMMARY_CHARS)}…`
      : cleanReply;
    const deliveryPrompt = `[WhaleIsle: Automation "${auto.name}" result]\n${summary}`;
    const groupDest = resolveGroupDestination(auto);

    if (groupDest) {
      const groupsSvc = groupsServiceOf();
      if (groupsSvc && typeof groupsSvc.postAutomationResult === 'function') {
        const res = await groupsSvc.postAutomationResult({
          groupId: groupDest.groupId,
          threadId: groupDest.threadId,
          botId: bot.id,
          automation: auto,
          text: summary,
        });
        return { kind: 'group', groupId: groupDest.groupId, threadId: groupDest.threadId, messageId: res?.message?.id ?? null };
      }
      if (groupsSvc && typeof groupsSvc.send === 'function') {
        const res = await groupsSvc.send({
          groupId: groupDest.groupId,
          threadId: groupDest.threadId,
          text: deliveryPrompt,
          authorName: bot.name,
        });
        return { kind: 'group', groupId: groupDest.groupId, threadId: groupDest.threadId, messageId: res?.message?.id ?? null };
      }
      return null;
    }

    if (auto.resultsTo === 'chat') {
      const home = await sessionRuntime.openHomeChat(bot.id);
      if (!home?.sessionId || home.sessionId === sourceSessionId) return null;
      if (typeof sessionRuntime.deliverAutomationResult === 'function') {
        await sessionRuntime.deliverAutomationResult(home.sessionId, deliveryPrompt, {
          botId: bot.id,
          automationId: auto.id,
          automationName: auto.name,
        });
      } else {
        await sessionRuntime.runSingleTurn(home.sessionId, deliveryPrompt, {
          timeoutMs: 60_000,
          origin: 'automation-result',
        });
      }
      return { kind: 'chat', sessionId: home.sessionId };
    }
    return null;
  }

  /** @param {any} auto @param {any} bot @param {{ groupId: string, threadId: string } | null} groupDest @param {string} prompt */
  async function executeAutomationTurn(auto, bot, groupDest, prompt) {
    const groupsSvc = groupsServiceOf();
    if (auto.runsIn === 'chat' && groupDest && typeof groupsSvc?.runAutomationInGroup === 'function') {
      const groupRun = await groupsSvc.runAutomationInGroup({
        groupId: groupDest.groupId,
        threadId: groupDest.threadId,
        botId: bot.id,
        automation: auto,
        prompt,
      });
      return { targetSessionId: groupRun?.sessionId ?? null, turn: groupRun };
    }
    const target = auto.runsIn === 'new'
      ? await sessionRuntime.startSideChat(bot.id, {
        title: auto.name || 'Automation',
        kind: 'automation',
        origin: 'automation',
        owner: BOT_OWNER_AUTOMATION,
      })
      : await sessionRuntime.openHomeChat(bot.id);
    const targetSessionId = target.sessionId;
    const turn = await sessionRuntime.runSingleTurn(targetSessionId, prompt, { timeoutMs: 120_000 });
    return { targetSessionId, turn };
  }

  /** @param {any} auto @param {boolean} ok @param {string | null} lastError @param {number} now */
  function settleAutomationAfterRun(auto, ok, lastError, now) {
    const isOnce = Boolean(auto.once);
    const nextEnabled = isOnce ? false : auto.enabled;
    const nextRunAt = nextEnabled ? computeNextRunAt({ ...auto, lastRunAt: now }, now) : null;
    const lastStatus = ok ? 'completed' : 'failed';

    if (ok && shouldAutoDeleteOnce(auto)) {
      const cleanedUp = workStore.deleteAutomation(auto.id);
      return { lastStatus, nextRunAt, cleanedUp };
    }
    const latestAuto = workStore.getAutomation(auto.id) ?? auto;
    persistAutomationState(latestAuto, {
      enabled: nextEnabled,
      lastRunAt: now,
      lastStatus,
      lastError,
      nextRunAt,
    }, now);
    return { lastStatus, nextRunAt, cleanedUp: false };
  }

  /** @param {any} auto @param {any} bot @param {string} runId @param {unknown} error @param {number} now */
  function handleAutomationRunFailure(auto, bot, runId, error, now) {
    const msg = error instanceof Error ? error.message : String(error);
    const isOnce = Boolean(auto.once);
    const nextEnabled = isOnce ? false : auto.enabled;
    const nextRunAt = nextEnabled ? computeSafeNextRunAt({ ...auto, lastRunAt: now }, now) : null;
    const latestAuto = workStore.getAutomation(auto.id) ?? auto;
    persistAutomationState(latestAuto, {
      enabled: nextEnabled,
      lastRunAt: now,
      lastStatus: 'failed',
      lastError: msg,
      nextRunAt,
    }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
    return { ok: false, runId, automationId: auto.id, status: 'failed', error: msg };
  }

  /** @param {string} id @param {{ now?: number }} [options] */
  async function runNow(id, { now = Date.now() } = {}) {
    const auto = workStore.getAutomation(id);
    if (!auto) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    const bot = requireBot(auto.botId);
    if (runningIds.has(auto.id)) {
      return { ok: true, alreadyRunning: true, automationId: auto.id };
    }
    runningIds.add(auto.id);
    const runId = `run-${crypto.randomUUID().slice(0, 12)}`;
    const groupDest = resolveGroupDestination(auto);
    const prompt = `[WhaleIsle: Automation "${auto.name}"]\n${auto.prompt}`;

    try {
      const { targetSessionId, turn } = await executeAutomationTurn(auto, bot, groupDest, prompt);
      const merged = isSharedTurnMerged(turn);
      const ok = isSharedTurnCompleted(turn);
      const rawReply = String(turn?.reply ?? '').trim();
      const quiet = ok && isQuietResult(rawReply);
      const cleanReply = quiet ? stripQuietMarker(rawReply).trim() : rawReply;
      const lastError = ok ? null : (turn?.error || 'turn-failed');

      const deliveredTo = (ok && !quiet && auto.runsIn === 'new' && cleanReply)
        ? await deliverResult({ auto, bot, sourceSessionId: targetSessionId, cleanReply }).catch(() => null)
        : null;
      const { lastStatus, nextRunAt, cleanedUp } = settleAutomationAfterRun(auto, ok, lastError, now);

      eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'chats'] });
      return {
        ok,
        runId,
        automationId: auto.id,
        sessionId: targetSessionId,
        reply: cleanReply,
        quiet,
        merged,
        status: lastStatus,
        delivered: Boolean(deliveredTo),
        deliveredTo,
        cleanedUp,
        nextRunAt,
        error: lastError,
      };
    } catch (error) {
      return handleAutomationRunFailure(auto, bot, runId, error, now);
    } finally {
      runningIds.delete(auto.id);
    }
  }

  /** @param {any} auto @param {number} lateMs @param {number} now */
  function skipMissedRun(auto, lateMs, now) {
    const isOnce = Boolean(auto.once);
    const nextRunAt = isOnce ? null : computeSafeNextRunAt(auto, now);
    if (shouldAutoDeleteOnce(auto)) {
      workStore.deleteAutomation(auto.id);
    } else {
      persistAutomationState(auto, {
        enabled: isOnce ? false : auto.enabled,
        lastStatus: 'missed',
        lastError: null,
        nextRunAt,
      }, now);
    }
    eventBus.emit({ botIds: [auto.botId], kinds: ['automations'] });
    return { automationId: auto.id, botId: auto.botId, lateMs, nextRunAt };
  }

  /**
   * Single scheduler sweep. Skips stale triggers beyond `missedRunGraceMs` without
   * firing an avalanche after sleep/wake, and advances recurring schedules forward.
   * @param {number} [now]
   */
  async function tick(now = Date.now()) {
    /** @type {string[]} */
    const triggered = [];
    /** @type {Array<{ automationId: string, botId: string, lateMs: number, nextRunAt: number | null }>} */
    const skippedMissed = [];
    const due = workStore.listAutomations({ enabledOnly: true });

    for (const auto of due) {
      if (!auto.nextRunAt || auto.nextRunAt > now || runningIds.has(auto.id)) continue;
      const bot = botsStore.getBot(auto.botId);
      if (!bot || bot.paused) continue;

      const lateMs = now - auto.nextRunAt;
      if (lateMs > missedRunGraceMs) {
        skippedMissed.push(skipMissedRun(auto, lateMs, now));
        continue;
      }

      triggered.push(auto.id);
      void runNow(auto.id, { now }).catch(() => null);
    }

    return { triggered, skippedMissed };
  }

  /** @param {string} botId @param {string} waitId @param {number} [now] */
  function cancelWait(botId, waitId, now = Date.now()) {
    const bot = requireBot(botId);
    const wait = workStore.getAutomation(waitId);
    if (!wait || wait.botId !== bot.id) {
      throw Object.assign(new Error(`Wait not found: ${waitId}`), { code: 'not_found' });
    }
    persistAutomationState(wait, { enabled: false, nextRunAt: null, lastStatus: 'canceled' }, now);
    const cancelledWaits = [...(bot.cancelledWaits ?? []).slice(-49), { id: wait.id, name: wait.name, at: now }];
    botsStore.updateBot(bot.id, { cancelledWaits }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'bot'] });
    return { ok: true, waitId: wait.id };
  }

  /** @param {{ runId: string, automationId: string }} args @param {number} [now] */
  async function sendRunAgain({ runId, automationId }, now = Date.now()) {
    if (!runId || !automationId) {
      throw invalidArg('runId and automationId are required');
    }
    const auto = workStore.getAutomation(automationId);
    if (!auto) throw Object.assign(new Error(`Automation not found: ${automationId}`), { code: 'not_found' });
    const bot = requireBot(auto.botId);
    const sessionId = bot.chatSessionId || `auto-${auto.id}`;
    const guard = workStore.recordRunResend(runId, sessionId, now);
    if (!guard.recorded) {
      return { ok: true, deduplicated: true, runId, sessionId: guard.sessionId };
    }
    const res = await runNow(auto.id, { now });
    return { ...res, deduplicated: false, originalRunId: runId };
  }

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  if (deps.enableScheduler !== false) {
    timer = setInterval(() => {
      void tick(Date.now()).catch(() => null);
    }, SCHEDULER_TICK_MS);
    timer.unref?.();
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    list,
    create,
    update,
    delete: remove,
    runNow,
    tick,
    cancelWait,
    sendRunAgain,
    close,
  };
}
