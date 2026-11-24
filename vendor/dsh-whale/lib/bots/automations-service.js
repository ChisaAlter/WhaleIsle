/**
 * Bot Automations & one-shot Waits runtime service.
 * Persists schedules and waits in `bot_automations` (via `workStore`) and
 * guarantees idempotent failure retries via `bot_run_resends` and
 * `automation_claims`.
 *
 * Combines:
 * - RFC 5545 RRULE & 5-field Cron + IANA timezone scheduling (`automations-schedule.js`)
 * - Claim-before-dispatch ledger, startup interrupted-claim reconciliation,
 *   sleep/wake missed-slot coalescing (`coalescedCount`), optional `missedRunGraceMs`
 * - Local folder change watcher (`folder-watcher.js`) & inbound `webhook` triggers
 * - Optional `budgetGuard` enforcement (`skipped_budget`)
 * - `NO_REPLY` suppression, Home/Group/`item`/`pet`/`im` result routing, and
 *   shared-turn merged answer settlement
 */
import crypto from 'node:crypto';
import { isQuietResult, stripQuietMarker } from '../../src/shared/index.js';
import { collectDueScheduleSlots } from './cron-rrule.js';
import { createFolderWatcher } from './folder-watcher.js';
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

/** @param {any} triggers */
function normalizeTriggers(triggers) {
  if (!Array.isArray(triggers)) return [];
  const out = [];
  for (const item of triggers) {
    if (!item || typeof item !== 'object') continue;
    const kind = String(item.kind ?? '').trim().toLowerCase();
    if (!kind) continue;
    out.push({ ...item, kind });
  }
  return out;
}

/** @param {any} budgetGuard @param {{ botId: string, automation: any, triggerKind: string, now: number }} ctx */
async function evaluateBudgetGuard(budgetGuard, ctx) {
  if (!budgetGuard) return { allowed: true };
  let res;
  if (typeof budgetGuard === 'function') {
    res = await budgetGuard(ctx);
  } else if (typeof budgetGuard.checkAutomationBudget === 'function') {
    res = await budgetGuard.checkAutomationBudget(ctx);
  } else if (typeof budgetGuard.evaluateDispatch === 'function') {
    res = await budgetGuard.evaluateDispatch({
      botId: ctx.botId,
      sourceKind: 'automation',
      automationId: ctx.automation.id,
      triggerKind: ctx.triggerKind,
      now: ctx.now,
    });
  } else {
    return { allowed: true };
  }
  if (!res || res.allowed !== false) return { allowed: true };
  return {
    allowed: false,
    reason: String(res.reason ?? (res.offPeakDeferred ? 'off_peak_only' : 'budget_exceeded')),
    deferUntilMs: Number.isFinite(res.deferUntilMs) ? Math.trunc(res.deferUntilMs) : null,
    offPeakDeferred: Boolean(res.offPeakDeferred),
  };
}

/** @param {any} auto @param {{ triggerKind: string, coalescedCount: number, triggerContext?: any }} meta */
function buildAutomationPrompt(auto, meta) {
  const header = meta.triggerKind === 'manual' && !meta.triggerContext && meta.coalescedCount <= 1
    ? `[WhaleIsle: Automation "${auto.name}"]`
    : `[WhaleIsle: Automation "${auto.name}" (${meta.triggerKind})]`;
  const lines = [header];
  if (meta.coalescedCount > 1) {
    lines.push(`[Coalesced ${meta.coalescedCount} missed scheduled slots into this single run.]`);
  }
  if (meta.triggerKind === 'folder' && meta.triggerContext) {
    const paths = Array.isArray(meta.triggerContext.changedPaths)
      ? meta.triggerContext.changedPaths.slice(0, 20).join(', ')
      : '';
    lines.push(`<folder_trigger untrusted="true" path="${String(meta.triggerContext.watchPath ?? '')}">${paths}</folder_trigger>`);
  } else if (meta.triggerKind === 'webhook' && meta.triggerContext) {
    const preview = typeof meta.triggerContext.payload === 'string'
      ? meta.triggerContext.payload.slice(0, 2000)
      : JSON.stringify(meta.triggerContext.payload ?? {}).slice(0, 2000);
    lines.push(`<webhook_trigger untrusted="true" webhookId="${String(meta.triggerContext.webhookId ?? '')}" eventId="${String(meta.triggerContext.eventId ?? '')}">${preview}</webhook_trigger>`);
  }
  lines.push(auto.prompt);
  return lines.join('\n');
}

/** @param {any} resultsTo */
function parseResultsTo(resultsTo) {
  if (!resultsTo || resultsTo === 'chat' || resultsTo === 'home') {
    return { kind: resultsTo === 'home' ? 'home' : 'chat' };
  }
  if (typeof resultsTo === 'string') {
    if (resultsTo === 'item' || resultsTo === 'pet') return { kind: resultsTo };
    if (resultsTo.startsWith('im:')) return { kind: 'im', channel: resultsTo.slice(3).trim() };
    return { kind: 'chat' };
  }
  if (typeof resultsTo === 'object') {
    return { kind: String(resultsTo.kind ?? 'chat').toLowerCase(), ...resultsTo };
  }
  return { kind: 'chat' };
}

/** @param {any} deps @param {string} clean */
function routeResultToPet(deps, clean) {
  const notify = deps.notifyPet ?? deps.legacyCompat?.notifyPet;
  if (typeof notify === 'function') {
    notify('say', clean.slice(0, 240));
    return { routed: true, kind: 'pet' };
  }
  return { routed: false, kind: 'pet', reason: 'pet_notifier_unavailable' };
}

/** @param {any} deps @param {any} bot @param {any} auto @param {any} target @param {string} sessionId @param {string} clean */
function routeResultToItem(deps, bot, auto, target, sessionId, clean) {
  const created = deps.itemsStore.add({
    ownerBotId: bot.id,
    chatId: sessionId,
    source: { kind: 'automation', title: auto.name },
    title: String(target.title ?? auto.name ?? 'Automation result').slice(0, 200),
    description: clean.slice(0, 4000),
    status: target.status || 'needs_you',
  }, { kind: 'bot', botId: bot.id, chatId: sessionId });
  deps.eventBus.emit({ botIds: [bot.id], kinds: ['items'] });
  return { routed: true, kind: 'item', itemUid: created.item.uid };
}

/** @param {any} deps @param {any} bot @param {any} target @param {string} sessionId @param {string} clean */
async function routeResultToIm(deps, bot, target, sessionId, clean) {
  const sendFn = deps.imOutboundBridge?.sendText ?? deps.imOutboundBridge?.deliver;
  if (typeof sendFn !== 'function') {
    return { routed: false, kind: 'im', delivered: false, reason: 'im_bridge_unavailable' };
  }
  const delivery = await sendFn({
    botId: bot.id,
    sessionId,
    channel: target.channel ?? null,
    accountId: target.accountId ?? null,
    chatId: target.chatId ?? null,
    text: clean,
  });
  const ok = Boolean(delivery?.ok || delivery?.delivered);
  return { routed: ok, kind: 'im', delivered: ok, reason: delivery?.error ?? delivery?.reason ?? null };
}

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
 *   itemsStore?: any,
 *   imOutboundBridge?: any,
 *   notifyPet?: (kind: string, text: string) => void,
 *   legacyCompat?: any,
 *   budgetGuard?: any,
 *   groupsService?: any,
 *   getGroupsService?: () => any,
 *   missedRunGraceMs?: number,
 *   enableScheduler?: boolean,
 *   enableFolderWatcher?: boolean,
 *   folderDebounceMs?: number,
 *   watchFactory?: any,
 *   onError?: (error: unknown, context?: Record<string, any>) => void,
 *   now?: () => number,
 * }} deps
 */
export function createAutomationsService(deps) {
  const { botsStore, workStore, sessionRuntime, eventBus } = deps;
  const nowFn = typeof deps.now === 'function' ? deps.now : () => Date.now();
  /** @type {(err: unknown, ctx?: Record<string, any>) => void} */
  const reportError = typeof deps.onError === 'function'
    ? deps.onError
    : (err, ctx) => { console.error('[dsh-bots:automations]', ctx?.phase ?? '', err); };
  const missedRunGraceMs = typeof deps.missedRunGraceMs === 'number'
    && Number.isFinite(deps.missedRunGraceMs)
    && deps.missedRunGraceMs >= 0
    ? deps.missedRunGraceMs
    : null;
  const groupsServiceOf = () => (
    typeof deps.getGroupsService === 'function' ? deps.getGroupsService() : (deps.groupsService ?? null)
  );
  /** @type {Set<string>} */
  const runningIds = new Set();
  let lastManualSlot = 0;

  // Startup recovery: mark any crash-interrupted claimed/running slots as `interrupted`.
  const startupRecovery = typeof workStore.markInterruptedAutomationClaims === 'function'
    ? workStore.markInterruptedAutomationClaims(nowFn())
    : { count: 0, claimIds: [] };
  if (startupRecovery.count > 0) {
    eventBus.emit({ botIds: [], kinds: ['automations'] });
  }
  /** @param {string} botId */
  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  /** @param {number} now */
  function nextUniqueSlotAt(now) {
    const base = Math.trunc(now);
    lastManualSlot = base > lastManualSlot ? base : lastManualSlot + 1;
    return lastManualSlot;
  }

  const watcherEnabled = deps.enableFolderWatcher !== undefined
    ? Boolean(deps.enableFolderWatcher)
    : (deps.enableScheduler !== false || typeof deps.watchFactory === 'function');

  const folderWatcher = watcherEnabled
    ? createFolderWatcher({
      debounceMs: deps.folderDebounceMs,
      watchFactory: deps.watchFactory,
      onError: (err, ctx) => reportError(err, { phase: 'folder_watcher', ...ctx }),
      onChange: (event) => handleFolderEvent(event),
    })
    : null;

  function syncFolderWatches() {
    if (!folderWatcher) return [];
    return folderWatcher.syncWatches(workStore.listAutomations({ enabledOnly: true }));
  }

  function list({ botId = null, enabledOnly = false } = {}) {
    return workStore.listAutomations({ botId, enabledOnly });
  }

  /** @param {any} params @param {number} [now] */
  function create(params, now = nowFn()) {
    const bot = requireBot(params?.botId);
    const normalized = normalizeAutomationCreate(params, bot.id, now);
    if (params?.triggers !== undefined) {
      normalized.triggers = normalizeTriggers(params.triggers);
    }
    const saved = workStore.upsertAutomation(normalized, now);
    syncFolderWatches();
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
    if (needsNullClear && typeof workStore.withTransaction === 'function') {
      return workStore.withTransaction(() => workStore.upsertAutomation(merged, now));
    }
    return workStore.upsertAutomation(merged, now);
  }

  /** @param {string} id @param {Record<string, any>} [patch] @param {number} [now] */
  function update(id, patch = {}, now = nowFn()) {
    const current = workStore.getAutomation(id);
    if (!current) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    /** @type {Record<string, any>} */
    const nextPatch = { ...patch };
    if (nextPatch.rrule !== undefined && nextPatch.schedule === undefined) {
      nextPatch.schedule = nextPatch.rrule;
    }
    if (nextPatch.triggers !== undefined) {
      nextPatch.triggers = normalizeTriggers(nextPatch.triggers);
    }
    const merged = { ...current, ...nextPatch, id: current.id, botId: current.botId };
    if (merged.timezone !== undefined) merged.timezone = validateTimezone(merged.timezone);
    if (typeof merged.schedule === 'string' && merged.schedule.trim()) {
      parseScheduleExpression(merged.schedule);
    }
    validateIntervalMinutes(merged.intervalMinutes);
    merged.nextRunAt = resolveUpdatedNextRunAt(merged, nextPatch, now);
    const saved = persistAutomationState(current, merged, now);
    syncFolderWatches();
    eventBus.emit({ botIds: [saved.botId], kinds: ['automations'] });
    return saved;
  }

  /** @param {string} id */
  function remove(id) {
    const current = workStore.getAutomation(id);
    if (!current) return { deleted: false };
    const deleted = workStore.deleteAutomation(id);
    if (deleted) {
      syncFolderWatches();
      eventBus.emit({ botIds: [current.botId], kinds: ['automations'] });
    }
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
          timeoutMs: 60_000, botId: bot.id, isBackground: true, origin: 'automation-result',
          sourceKind: 'dsh-bots:automation', source: { kind: 'dsh-bots:automation', automationId: auto.id, phase: 'deliver-result' },
        });
      }
      return { kind: 'chat', sessionId: home.sessionId };
    }
    return null;
  }

  /** @param {string} triggerKind */
  function resolveAutomationSourceKind(triggerKind) {
    if (triggerKind === 'webhook') return 'dsh-bots:webhook';
    if (triggerKind === 'folder') return 'dsh-bots:folder';
    return 'dsh-bots:automation';
  }

  /** @param {any} auto @param {any} bot @param {{ groupId: string, threadId: string } | null} groupDest @param {string} prompt @param {string | null} [claimId] @param {string} [triggerKind] */
  async function executeAutomationTurn(auto, bot, groupDest, prompt, claimId = null, triggerKind = 'schedule') {
    const sourceKind = resolveAutomationSourceKind(triggerKind);
    const groupsSvc = groupsServiceOf();
    if (auto.runsIn === 'chat' && groupDest && typeof groupsSvc?.runAutomationInGroup === 'function') {
      const groupRun = await groupsSvc.runAutomationInGroup({
        groupId: groupDest.groupId,
        threadId: groupDest.threadId,
        botId: bot.id,
        automation: auto,
        prompt,
        triggerKind,
        sourceKind,
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
    if (claimId) {
      workStore.updateAutomationClaim?.(claimId, { status: 'running', sessionId: targetSessionId }, nowFn());
    }
    const turn = await sessionRuntime.runSingleTurn(targetSessionId, prompt, {
      timeoutMs: 120_000, botId: bot.id, isBackground: true, sourceKind, source: { kind: sourceKind, automationId: auto.id, triggerKind },
    });
    return { targetSessionId, turn };
  }

  /** @param {any} auto @param {boolean} ok @param {string | null} lastError @param {number} now @param {number | null | undefined} [nextRunAtOverride] */
  function settleAutomationAfterRun(auto, ok, lastError, now, nextRunAtOverride = undefined) {
    const isOnce = Boolean(auto.once);
    const nextEnabled = isOnce ? false : auto.enabled;
    const nextRunAt = nextEnabled
      ? (nextRunAtOverride !== undefined ? nextRunAtOverride : computeNextRunAt({ ...auto, lastRunAt: now }, now))
      : null;
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

  /** @param {any} auto @param {any} bot @param {string} runId @param {any} claim @param {unknown} error @param {number} now */
  function handleAutomationRunFailure(auto, bot, runId, claim, error, now) {
    const msg = error instanceof Error ? error.message : String(error);
    workStore.updateAutomationClaim?.(claim.claimId, { status: 'failed', error: msg }, now);
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
    return { ok: false, runId, claimId: claim.claimId, automationId: auto.id, status: 'failed', error: msg };
  }

  /** @param {any} input */
  async function routeClaimedOutcome({ auto, bot, targetSessionId, groupDest, ok, quiet, cleanReply }) {
    if (!ok) return { routed: { routed: false, kind: 'failed' }, deliveredTo: null };
    if (quiet || !cleanReply) return { routed: { routed: false, kind: quiet ? 'quiet' : 'chat' }, deliveredTo: null };
    const target = parseResultsTo(auto.resultsTo);
    if (groupDest || auto.runsIn === 'new') {
      const deliveredTo = await deliverResult({ auto, bot, sourceSessionId: targetSessionId, cleanReply }).catch(() => null);
      return {
        deliveredTo,
        routed: { routed: Boolean(deliveredTo), kind: groupDest ? 'group' : target.kind },
      };
    }
    if (target.kind === 'pet') return { deliveredTo: null, routed: routeResultToPet(deps, cleanReply) };
    if (target.kind === 'item' && deps.itemsStore) return { deliveredTo: null, routed: routeResultToItem(deps, bot, auto, target, targetSessionId, cleanReply) };
    if (target.kind === 'im') return { deliveredTo: null, routed: await routeResultToIm(deps, bot, target, targetSessionId, cleanReply) };
    return { deliveredTo: null, routed: { routed: true, kind: target.kind } };
  }

  /** @param {any} auto @param {any} bot @param {any} claim @param {any} opts */
  async function executeClaimedAutomation(auto, bot, claim, opts) {
    const { now, runId, triggerKind, coalescedCount, nextRunAtOverride, triggerContext } = opts;
    workStore.updateAutomationClaim?.(claim.claimId, { status: 'running', runId }, now);

    const groupDest = resolveGroupDestination(auto);
    const prompt = buildAutomationPrompt(auto, { triggerKind, coalescedCount, triggerContext });
    const { targetSessionId, turn } = await executeAutomationTurn(auto, bot, groupDest, prompt, claim.claimId, triggerKind);
    const merged = isSharedTurnMerged(turn);
    const ok = isSharedTurnCompleted(turn);
    const rawReply = String(turn?.reply ?? '').trim();
    const quiet = ok && isQuietResult(rawReply);
    const cleanReply = quiet ? stripQuietMarker(rawReply).trim() : rawReply;
    const lastError = ok ? null : (turn?.error || 'turn-failed');

    const { routed, deliveredTo } = await routeClaimedOutcome({ auto, bot, targetSessionId, groupDest, ok, quiet, cleanReply });

    workStore.updateAutomationClaim?.(claim.claimId, {
      status: ok ? 'completed' : 'failed',
      sessionId: targetSessionId,
      error: lastError,
    }, now);

    const { lastStatus, nextRunAt, cleanedUp } = settleAutomationAfterRun(auto, ok, lastError, now, nextRunAtOverride);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'chats'] });
    return {
      ok, runId, claimId: claim.claimId, coalescedCount, triggerKind, automationId: auto.id,
      sessionId: targetSessionId, reply: cleanReply, quiet, merged, status: lastStatus,
      routed, delivered: Boolean(deliveredTo), deliveredTo, cleanedUp, nextRunAt, error: lastError,
    };
  }

  /** @param {any} auto @param {any} bot @param {any} claim @param {any} budgetCheck @param {any} options @param {number} now */
  function recordBudgetSkip(auto, bot, claim, budgetCheck, options, now) {
    const fallbackNext = options.nextRunAtOverride !== undefined
      ? options.nextRunAtOverride
      : computeNextRunAt({ ...auto, lastRunAt: now }, now);
    const deferredNext = budgetCheck.deferUntilMs && budgetCheck.deferUntilMs > now
      ? budgetCheck.deferUntilMs
      : fallbackNext;
    workStore.updateAutomationClaim?.(claim.claimId, { status: 'skipped_budget', error: budgetCheck.reason }, now);
    persistAutomationState(auto, {
      lastStatus: 'skipped_budget',
      lastError: budgetCheck.reason,
      nextRunAt: auto.enabled ? deferredNext : auto.nextRunAt,
    }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
    return {
      ok: false,
      skipped: true,
      reason: 'skipped_budget',
      budgetReason: budgetCheck.reason,
      deferUntilMs: budgetCheck.deferUntilMs ?? null,
      claimId: claim.claimId,
      automationId: auto.id,
    };
  }

  /** @param {string} id @param {Record<string, any>} [options] */
  async function runNow(id, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : nowFn();
    const triggerKind = options.triggerKind || 'manual';
    const coalescedCount = Math.max(1, Math.trunc(options.coalescedCount ?? 1));
    const auto = workStore.getAutomation(id);
    if (!auto) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    const bot = requireBot(auto.botId);
    if (runningIds.has(auto.id)) {
      return { ok: true, alreadyRunning: true, automationId: auto.id };
    }

    const runId = `run-${crypto.randomUUID().slice(0, 12)}`;
    const slotAt = Number.isFinite(options.slotAt) ? Math.trunc(options.slotAt) : nextUniqueSlotAt(now);
    const claimRes = typeof workStore.claimAutomationSlot === 'function'
      ? workStore.claimAutomationSlot({ automationId: auto.id, botId: bot.id, slotAt, triggerKind, coalescedCount, runId }, now)
      : { claimed: true, claim: { claimId: `ephemeral-${runId}`, status: 'claimed' } };

    if (!claimRes.claimed) {
      return {
        ok: true,
        deduplicated: true,
        alreadyClaimed: true,
        claimId: claimRes.claim.claimId,
        claim: claimRes.claim,
        automationId: auto.id,
      };
    }

    const budgetCheck = await evaluateBudgetGuard(deps.budgetGuard, { botId: bot.id, automation: auto, triggerKind, now });
    if (!budgetCheck.allowed) {
      return recordBudgetSkip(auto, bot, claimRes.claim, budgetCheck, options, now);
    }

    runningIds.add(auto.id);
    try {
      return await executeClaimedAutomation(auto, bot, claimRes.claim, {
        now,
        runId,
        triggerKind,
        coalescedCount,
        nextRunAtOverride: options.nextRunAtOverride,
        triggerContext: options.triggerContext,
      });
    } catch (error) {
      return handleAutomationRunFailure(auto, bot, runId, claimRes.claim, error, now);
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

  /** @param {any} auto @param {number} now */
  function resolveDuePlan(auto, now) {
    try {
      return collectDueScheduleSlots({
        schedule: auto.schedule,
        intervalMinutes: auto.intervalMinutes,
        timezone: auto.timezone,
        dueAt: auto.nextRunAt,
        nowMs: now,
        anchorMs: auto.createdAt ?? auto.nextRunAt,
        once: auto.once,
      });
    } catch {
      return {
        slotAt: Math.trunc(auto.nextRunAt),
        coalescedCount: 1,
        nextRunAt: auto.once ? null : computeSafeNextRunAt({ ...auto, lastRunAt: now }, now),
      };
    }
  }

  /** @param {number} [now] */
  async function tick(now = nowFn()) {
    /** @type {any[] & { triggered?: string[], skippedMissed?: any[] }} */
    const results = [];
    /** @type {string[]} */
    const triggered = [];
    /** @type {Array<{ automationId: string, botId: string, lateMs: number, nextRunAt: number | null }>} */
    const skippedMissed = [];

    for (const auto of workStore.listAutomations({ enabledOnly: true })) {
      if (!auto.nextRunAt || auto.nextRunAt > now || runningIds.has(auto.id)) continue;
      const bot = botsStore.getBot(auto.botId);
      if (!bot || bot.paused) continue;

      const lateMs = now - auto.nextRunAt;
      if (missedRunGraceMs !== null && lateMs > missedRunGraceMs) {
        skippedMissed.push(skipMissedRun(auto, lateMs, now));
        continue;
      }

      const plan = resolveDuePlan(auto, now);
      if (plan.slotAt === null) continue;
      const res = await runNow(auto.id, {
        now,
        triggerKind: 'schedule',
        slotAt: plan.slotAt,
        coalescedCount: plan.coalescedCount,
        nextRunAtOverride: plan.nextRunAt,
      });
      triggered.push(auto.id);
      results.push(res);
    }
    results.triggered = triggered;
    results.skippedMissed = skippedMissed;
    return results;
  }

  /** @param {any} event */
  async function handleFolderEvent(event) {
    const auto = workStore.getAutomation(event.automationId);
    if (!auto || !auto.enabled) return { ok: false, skipped: true, reason: 'automation_inactive' };
    const bot = botsStore.getBot(auto.botId);
    if (!bot || bot.paused) return { ok: false, skipped: true, reason: 'bot_paused' };
    return runNow(auto.id, {
      now: event.detectedAt ?? nowFn(),
      triggerKind: 'folder',
      triggerContext: event,
    });
  }

  /** @param {{ automationId?: string | null, botId?: string | null, webhookId?: string | null, eventId?: string | null, payload?: any, slotAt?: number, now?: number }} params */
  async function triggerWebhook({ automationId = null, botId = null, webhookId = null, eventId = null, payload = null, slotAt, now = nowFn() }) {
    const targets = automationId
      ? [workStore.getAutomation(automationId)].filter((a) => a && a.enabled)
      : workStore.listAutomations({ botId, enabledOnly: true }).filter((/** @type {any} */ auto) => (
        Array.isArray(auto.triggers) && auto.triggers.some((/** @type {any} */ t) => (
          t.kind === 'webhook' && (!t.webhookId || !webhookId || t.webhookId === webhookId)
        ))
      ));
    const dispatches = [];
    for (const auto of targets) {
      const bot = botsStore.getBot(auto.botId);
      if (!bot || bot.paused) continue;
      dispatches.push(await runNow(auto.id, {
        now,
        triggerKind: 'webhook',
        slotAt,
        triggerContext: { webhookId, eventId, payload },
      }));
    }
    return { matched: targets.length, dispatches };
  }

  /** @param {string} botId @param {string} waitId @param {number} [now] */
  function cancelWait(botId, waitId, now = nowFn()) {
    const bot = requireBot(botId);
    const wait = workStore.getAutomation(waitId);
    if (!wait || wait.botId !== bot.id) {
      throw Object.assign(new Error(`Wait not found: ${waitId}`), { code: 'not_found' });
    }
    persistAutomationState(wait, { enabled: false, nextRunAt: null, lastStatus: 'canceled' }, now);
    const cancelledWaits = [...(bot.cancelledWaits ?? []).slice(-49), { id: wait.id, name: wait.name, at: now }];
    botsStore.updateBot(bot.id, { cancelledWaits }, now);
    syncFolderWatches();
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'bot'] });
    return { ok: true, waitId: wait.id };
  }

  /** @param {{ runId: string, automationId: string }} params @param {number} [now] */
  async function sendRunAgain({ runId, automationId }, now = nowFn()) {
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
    const res = await runNow(auto.id, { now, triggerKind: 'manual' });
    return { ...res, deduplicated: false, originalRunId: runId };
  }

  function listClaims(filters = {}) {
    return typeof workStore.listAutomationClaims === 'function'
      ? workStore.listAutomationClaims(filters)
      : [];
  }

  function reconcileInterrupted(now = nowFn()) {
    return typeof workStore.markInterruptedAutomationClaims === 'function'
      ? workStore.markInterruptedAutomationClaims(now)
      : { count: 0, claimIds: [] };
  }

  syncFolderWatches();

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  if (deps.enableScheduler !== false) {
    timer = setInterval(() => {
      tick(nowFn()).then(undefined, (err) => {
        reportError(err, { phase: 'scheduler_tick' });
      });
    }, SCHEDULER_TICK_MS);
    timer.unref?.();
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    folderWatcher?.close();
  }

  return {
    list,
    create,
    update,
    delete: remove,
    runNow,
    tick,
    handleFolderEvent,
    triggerWebhook,
    cancelWait,
    sendRunAgain,
    listClaims,
    reconcileInterrupted,
    getStartupRecovery: () => ({ ...startupRecovery }),
    syncFolderWatches,
    close,
  };
}
