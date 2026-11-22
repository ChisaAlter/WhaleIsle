/**
 * Bot Automations & one-shot Waits runtime service.
 * Persists schedules and waits in `bot_automations` (via `workStore`) and
 * guarantees idempotent failure retries via `bot_run_resends`.
 */
import crypto from 'node:crypto';
import { BOT_OWNER_AUTOMATION } from './session-runtime.js';

const SCHEDULER_TICK_MS = 60_000;

/**
 * Compute next run timestamp from a simple interval or explicit `once.by` / `nextRunAt`.
 * @param {any} input
 * @param {number} now
 */
function computeNextRunAt(input, now) {
  if (Number.isFinite(input?.nextRunAt)) return input.nextRunAt;
  if (Number.isFinite(input?.once?.by)) return input.once.by;
  if (Number.isFinite(input?.intervalMinutes) && input.intervalMinutes > 0) {
    return now + Math.round(input.intervalMinutes) * 60_000;
  }
  return null;
}

/** @param {any} params @param {string} botId @param {number} now */
function normalizeAutomationCreate(params, botId, now) {
  const p = params ?? {};
  const prompt = String(p.prompt ?? '').trim();
  if (!prompt) {
    throw Object.assign(new Error('Automation prompt is required'), { code: 'invalid_argument' });
  }
  const enabled = p.enabled !== false;
  return {
    id: p.id || crypto.randomUUID(),
    botId,
    name: String(p.name ?? '').trim() || (p.once ? 'One-shot wait' : 'Scheduled task'),
    prompt,
    schedule: p.schedule ?? p.rrule ?? null,
    intervalMinutes: p.intervalMinutes ?? null,
    timezone: p.timezone ?? null,
    triggers: Array.isArray(p.triggers) ? p.triggers : [],
    once: p.once ?? null,
    runsIn: p.runsIn === 'new' ? 'new' : 'chat',
    resultsTo: p.resultsTo ?? 'chat',
    enabled,
    nextRunAt: enabled ? computeNextRunAt(p, now) : null,
  };
}

/**
 * Create the Bot Automations & Waits service.
 * @param {{
 *   botsStore: any,
 *   workStore: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 *   enableScheduler?: boolean,
 * }} deps
 */
export function createAutomationsService(deps) {
  const { botsStore, workStore, sessionRuntime, eventBus } = deps;
  /** @type {Set<string>} */
  const runningIds = new Set();

  function requireBot(botId) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    return bot;
  }

  function list({ botId = null, enabledOnly = false } = {}) {
    return workStore.listAutomations({ botId, enabledOnly });
  }

  function create(params, now = Date.now()) {
    const bot = requireBot(params?.botId);
    const saved = workStore.upsertAutomation(normalizeAutomationCreate(params, bot.id, now), now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
    return saved;
  }

  function update(id, patch = {}, now = Date.now()) {
    const current = workStore.getAutomation(id);
    if (!current) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    const merged = { ...current, ...patch, id: current.id, botId: current.botId };
    if (patch.enabled === true && !merged.nextRunAt) {
      merged.nextRunAt = computeNextRunAt(merged, now);
    }
    const saved = workStore.upsertAutomation(merged, now);
    eventBus.emit({ botIds: [saved.botId], kinds: ['automations'] });
    return saved;
  }

  function remove(id) {
    const current = workStore.getAutomation(id);
    if (!current) return { deleted: false };
    const deleted = workStore.deleteAutomation(id);
    if (deleted) eventBus.emit({ botIds: [current.botId], kinds: ['automations'] });
    return { deleted };
  }

  async function runNow(id, { now = Date.now() } = {}) {
    const auto = workStore.getAutomation(id);
    if (!auto) throw Object.assign(new Error(`Automation not found: ${id}`), { code: 'not_found' });
    const bot = requireBot(auto.botId);
    if (runningIds.has(auto.id)) {
      return { ok: true, alreadyRunning: true, automationId: auto.id };
    }
    runningIds.add(auto.id);
    const runId = `run-${crypto.randomUUID().slice(0, 12)}`;
    try {
      const target = auto.runsIn === 'new'
        ? await sessionRuntime.startSideChat(bot.id, {
          title: auto.name || 'Automation',
          kind: 'automation',
          origin: 'automation',
          owner: BOT_OWNER_AUTOMATION,
        })
        : await sessionRuntime.openHomeChat(bot.id);

      const prompt = `[WhaleIsle: Automation "${auto.name}"]\n${auto.prompt}`;
      const turn = await sessionRuntime.runSingleTurn(target.sessionId, prompt, { timeoutMs: 120_000 });
      const nextEnabled = auto.once ? false : auto.enabled;
      const nextRunAt = nextEnabled && Number.isFinite(auto.intervalMinutes)
        ? now + auto.intervalMinutes * 60_000
        : null;

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
        automationId: auto.id,
        sessionId: target.sessionId,
        reply: turn.reply ?? '',
        error: turn.ok ? null : (turn.error || 'turn-failed'),
      };
    } catch (error) {
      const msg = String(error?.message ?? error);
      workStore.updateAutomationRunState(auto.id, {
        lastRunAt: now,
        lastStatus: 'failed',
        lastError: msg,
      }, now);
      eventBus.emit({ botIds: [bot.id], kinds: ['automations'] });
      return { ok: false, runId, automationId: auto.id, error: msg };
    } finally {
      runningIds.delete(auto.id);
    }
  }

  function cancelWait(botId, waitId, now = Date.now()) {
    const bot = requireBot(botId);
    const wait = workStore.getAutomation(waitId);
    if (!wait || wait.botId !== bot.id) {
      throw Object.assign(new Error(`Wait not found: ${waitId}`), { code: 'not_found' });
    }
    workStore.updateAutomationRunState(wait.id, { enabled: false, lastStatus: 'canceled' }, now);
    const cancelledWaits = [...(bot.cancelledWaits ?? []).slice(-49), { id: wait.id, name: wait.name, at: now }];
    botsStore.updateBot(bot.id, { cancelledWaits }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['automations', 'bot'] });
    return { ok: true, waitId: wait.id };
  }

  async function sendRunAgain({ runId, automationId }, now = Date.now()) {
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
    const res = await runNow(auto.id, { now });
    return { ...res, deduplicated: false, originalRunId: runId };
  }

  let timer = null;
  if (deps.enableScheduler !== false) {
    timer = setInterval(() => {
      const now = Date.now();
      for (const auto of workStore.listAutomations({ enabledOnly: true })) {
        if (!auto.nextRunAt || auto.nextRunAt > now || runningIds.has(auto.id)) continue;
        const bot = botsStore.getBot(auto.botId);
        if (!bot || bot.paused) continue;
        void runNow(auto.id, { now }).catch(() => null);
      }
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
    cancelWait,
    sendRunAgain,
    close,
  };
}
