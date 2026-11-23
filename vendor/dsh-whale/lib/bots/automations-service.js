/**
 * Bot Automations & one-shot Waits runtime service.
 *
 * Features:
 * - Standard 5-field Cron, RRule, timezone, interval, and one-shot `once.by` scheduling
 * - Claim-before-dispatch ledger via `workStore.claimAutomationSlot`
 * - Startup interrupted-claim reconciliation via `markInterruptedAutomationClaims`
 * - Sleep/wake missed-slot coalescing (`coalescedCount`)
 * - Local folder change watcher (`folder` trigger) and inbound `webhook` trigger dispatch
 * - Optional `budgetGuard` enforcement (daily budget / `off_peak_only` deferral -> `skipped_budget`)
 * - Honest `resultsTo` routing (`chat`, `home`, `item`, `pet`, `im`)
 */
import crypto from 'node:crypto';
import { isQuietResult, stripQuietMarker } from '../../src/shared/index.js';
import { collectDueScheduleSlots, computeNextScheduleAt, parseScheduleExpression } from './cron-rrule.js';
import { createFolderWatcher } from './folder-watcher.js';
import { BOT_OWNER_AUTOMATION } from './session-runtime.js';

const SCHEDULER_TICK_MS = 60_000;

/** @param {any} input */
function extractScheduleExpr(input) {
  if (typeof input?.schedule === 'string' && input.schedule.trim()) return input.schedule.trim();
  if (typeof input?.rrule === 'string' && input.rrule.trim()) return input.rrule.trim();
  return '';
}

/**
 * Compute next run timestamp from explicit `nextRunAt`, `once.by`, Cron/RRule `schedule`,
 * or `intervalMinutes`. Pass `{ recalculate: true }` to ignore any existing `input.nextRunAt`.
 * @param {any} input
 * @param {number} [now]
 * @param {{ recalculate?: boolean }} [options]
 * @returns {number | null}
 */
export function computeNextRunAt(input, now = Date.now(), options = {}) {
  if (!options.recalculate && Number.isFinite(input?.nextRunAt)) return Math.trunc(input.nextRunAt);
  if (Number.isFinite(input?.once?.by)) return Math.trunc(input.once.by);
  const scheduleExpr = extractScheduleExpr(input);
  if (scheduleExpr) {
    return computeNextScheduleAt(scheduleExpr, {
      afterMs: now,
      timezone: input?.timezone ?? null,
      anchorMs: Number.isFinite(input?.createdAt) ? input.createdAt : now,
    });
  }
  if (Number.isFinite(input?.intervalMinutes) && input.intervalMinutes > 0) {
    return Math.trunc(now + Math.round(input.intervalMinutes) * 60_000);
  }
  return null;
}

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

/** @param {string | null} schedule */
function assertValidScheduleIfPresent(schedule) {
  if (!schedule) return;
  try {
    parseScheduleExpression(schedule);
  } catch (error) {
    throw Object.assign(new Error(`Invalid automation schedule: ${/** @type {any} */ (error)?.message ?? error}`), {
      code: 'invalid_argument',
    });
  }
}

/** @param {any} params @param {string} botId @param {number} now */
function normalizeAutomationCreate(params, botId, now) {
  const p = params ?? {};
  const prompt = String(p.prompt ?? '').trim();
  if (!prompt) {
    throw Object.assign(new Error('Automation prompt is required'), { code: 'invalid_argument' });
  }
  const scheduleRaw = p.schedule ?? p.rrule ?? null;
  const schedule = typeof scheduleRaw === 'string' && scheduleRaw.trim() ? scheduleRaw.trim() : null;
  assertValidScheduleIfPresent(schedule);
  const enabled = p.enabled !== false;
  const normalized = {
    id: p.id || crypto.randomUUID(),
    botId,
    name: String(p.name ?? '').trim() || (p.once ? 'One-shot wait' : 'Scheduled task'),
    prompt,
    schedule,
    intervalMinutes: Number.isFinite(p.intervalMinutes) && p.intervalMinutes > 0 ? p.intervalMinutes : null,
    timezone: typeof p.timezone === 'string' && p.timezone.trim() ? p.timezone.trim() : null,
    triggers: normalizeTriggers(p.triggers),
    once: p.once ?? null,
    runsIn: p.runsIn === 'new' ? 'new' : 'chat',
    resultsTo: p.resultsTo ?? 'chat',
    enabled,
  };
  return {
    ...normalized,
    nextRunAt: enabled ? computeNextRunAt({ ...normalized, nextRunAt: p.nextRunAt }, now) : null,
  };
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
  const lines = [`[WhaleIsle: Automation "${auto.name}" (${meta.triggerKind})]`];
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

/** @param {any} deps @param {any} bot @param {any} auto @param {string} sessionId @param {string} reply */
async function routeAutomationResult(deps, bot, auto, sessionId, reply) {
  const clean = stripQuietMarker(reply).trim();
  if (!clean || isQuietResult(reply)) return { routed: false, kind: 'quiet' };
  const target = parseResultsTo(auto.resultsTo);
  if (target.kind === 'pet') return routeResultToPet(deps, clean);
  if (target.kind === 'item' && deps.itemsStore) return routeResultToItem(deps, bot, auto, target, sessionId, clean);
  if (target.kind === 'im') return routeResultToIm(deps, bot, target, sessionId, clean);
  return { routed: true, kind: target.kind };
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
    const saved = workStore.upsertAutomation(normalizeAutomationCreate(params, bot.id, now), now);
    syncFolderWatches();
    eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
    return saved;
  }

  /** @param {string} id @param {Record<string, any>} [patch] @param {number} [now] */
  function update(id, patch = {}, now = nowFn()) {
    const current = workStore.getAutomation(id);
    if (!current) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    const nextSchedule = patch.schedule !== undefined
      ? (typeof patch.schedule === 'string' && patch.schedule.trim() ? patch.schedule.trim() : null)
      : (patch.rrule !== undefined ? (typeof patch.rrule === 'string' && patch.rrule.trim() ? patch.rrule.trim() : null) : current.schedule);
    assertValidScheduleIfPresent(nextSchedule);
    const merged = {
      ...current,
      ...patch,
      schedule: nextSchedule,
      triggers: patch.triggers !== undefined ? normalizeTriggers(patch.triggers) : (current.triggers ?? []),
      id: current.id,
      botId: current.botId,
    };
    const scheduleChanged = patch.schedule !== undefined || patch.rrule !== undefined
      || patch.intervalMinutes !== undefined || patch.timezone !== undefined || patch.once !== undefined;
    if (merged.enabled && (scheduleChanged || (patch.enabled === true && !merged.nextRunAt))) {
      merged.nextRunAt = computeNextRunAt(merged, now, { recalculate: scheduleChanged });
    }
    const saved = workStore.upsertAutomation(merged, now);
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

  /** @param {any} auto @param {any} bot @param {any} claim @param {any} opts */
  async function executeClaimedAutomation(auto, bot, claim, opts) {
    const { now, runId, triggerKind, coalescedCount, nextRunAtOverride, triggerContext } = opts;
    workStore.updateAutomationClaim?.(claim.claimId, { status: 'running', runId }, now);
    const target = auto.runsIn === 'new'
      ? await sessionRuntime.startSideChat(bot.id, {
        title: auto.name || 'Automation',
        kind: 'automation',
        origin: 'automation',
        owner: BOT_OWNER_AUTOMATION,
      })
      : await sessionRuntime.openHomeChat(bot.id);

    workStore.updateAutomationClaim?.(claim.claimId, { status: 'running', sessionId: target.sessionId }, now);
    const prompt = buildAutomationPrompt(auto, { triggerKind, coalescedCount, triggerContext });
    const turn = await sessionRuntime.runSingleTurn(target.sessionId, prompt, { timeoutMs: 120_000 });
    const nextEnabled = auto.once ? false : auto.enabled;
    const nextRunAt = nextEnabled
      ? (nextRunAtOverride !== undefined ? nextRunAtOverride : computeNextRunAt(auto, now, { recalculate: true }))
      : null;

    const routed = turn.ok
      ? await routeAutomationResult(deps, bot, auto, target.sessionId, turn.reply ?? '')
      : { routed: false, kind: 'failed' };

    workStore.updateAutomationClaim?.(claim.claimId, {
      status: turn.ok ? 'completed' : 'failed',
      sessionId: target.sessionId,
      error: turn.ok ? null : (turn.error || 'turn-failed'),
    }, now);

    workStore.updateAutomationRunState(auto.id, {
      enabled: nextEnabled,
      lastRunAt: now,
      lastStatus: turn.ok ? 'ok' : 'failed',
      lastError: turn.ok ? null : (turn.error || 'turn-failed'),
      nextRunAt,
    }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'chats'] });
    return {
      ok: Boolean(turn.ok),
      runId,
      claimId: claim.claimId,
      coalescedCount,
      triggerKind,
      automationId: auto.id,
      sessionId: target.sessionId,
      reply: turn.reply ?? '',
      routed,
      error: turn.ok ? null : (turn.error || 'turn-failed'),
    };
  }

  /** @param {any} auto @param {any} bot @param {any} claim @param {any} budgetCheck @param {any} options @param {number} now */
  function recordBudgetSkip(auto, bot, claim, budgetCheck, options, now) {
    const fallbackNext = options.nextRunAtOverride !== undefined
      ? options.nextRunAtOverride
      : computeNextRunAt(auto, now, { recalculate: true });
    const deferredNext = budgetCheck.deferUntilMs && budgetCheck.deferUntilMs > now
      ? budgetCheck.deferUntilMs
      : fallbackNext;
    workStore.updateAutomationClaim?.(claim.claimId, { status: 'skipped_budget', error: budgetCheck.reason }, now);
    workStore.updateAutomationRunState(auto.id, {
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
      const msg = String(/** @type {any} */ (error)?.message ?? error);
      workStore.updateAutomationClaim?.(claimRes.claim.claimId, { status: 'failed', error: msg }, now);
      workStore.updateAutomationRunState(auto.id, {
        lastRunAt: now,
        lastStatus: 'failed',
        lastError: msg,
      }, now);
      eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
      return { ok: false, runId, claimId: claimRes.claim.claimId, automationId: auto.id, error: msg };
    } finally {
      runningIds.delete(auto.id);
    }
  }

  async function tick(now = nowFn()) {
    const results = [];
    for (const auto of workStore.listAutomations({ enabledOnly: true })) {
      if (!auto.nextRunAt || auto.nextRunAt > now || runningIds.has(auto.id)) continue;
      const bot = botsStore.getBot(auto.botId);
      if (!bot || bot.paused) continue;
      const plan = collectDueScheduleSlots({
        schedule: auto.schedule,
        intervalMinutes: auto.intervalMinutes,
        timezone: auto.timezone,
        dueAt: auto.nextRunAt,
        nowMs: now,
        anchorMs: auto.createdAt ?? auto.nextRunAt,
        once: auto.once,
      });
      if (plan.slotAt === null) continue;
      const res = await runNow(auto.id, {
        now,
        triggerKind: 'schedule',
        slotAt: plan.slotAt,
        coalescedCount: plan.coalescedCount,
        nextRunAtOverride: plan.nextRunAt,
      });
      results.push(res);
    }
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
    workStore.updateAutomationRunState(wait.id, { enabled: false, lastStatus: 'canceled' }, now);
    const cancelledWaits = [...(bot.cancelledWaits ?? []).slice(-49), { id: wait.id, name: wait.name, at: now }];
    botsStore.updateBot(bot.id, { cancelledWaits }, now);
    syncFolderWatches();
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'bot'] });
    return { ok: true, waitId: wait.id };
  }

  /** @param {{ runId: string, automationId: string }} params @param {number} [now] */
  async function sendRunAgain({ runId, automationId }, now = nowFn()) {
    if (!runId || !automationId) {
      throw Object.assign(new Error('runId and automationId are required'), { code: 'invalid_argument' });
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
