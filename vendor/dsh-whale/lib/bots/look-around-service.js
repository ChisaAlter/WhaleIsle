/**
 * Look Around & Up Next service.
 * Persists per-bot sweep history, open/started/dismissed suggestions, and seen
 * markers in `_meta/bot-look-around.json`, reusing all deduplication & schedule
 * math from `src/shared/bot-look-around.js`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUGGESTION_LIMITS,
  botLookAround,
  checkSuggestionDedupe,
  nextLookAroundAt,
  normalizeSuggestion,
  patchLookAround,
  pruneLookAroundState,
} from '../../src/shared/index.js';
import { botMetaDir, writeAtomicFile } from './fs-home.js';

const TICK_MS = 60_000;

/** @param {string} metaRoot */
function stateFilePath(metaRoot) {
  return path.join(metaRoot, 'bot-look-around.json');
}

/** @param {string} file */
function loadStore(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Create Look Around & Up Next service.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 *   runSweep?: (bot: any, prompt: string) => Promise<{ ok: boolean, summary?: string }>,
 *   enableScheduler?: boolean,
 * }} deps
 */
export function createLookAroundService(deps) {
  const { dshHome, botsStore, sessionRuntime, eventBus } = deps;
  const metaRoot = botMetaDir(dshHome);
  const file = stateFilePath(metaRoot);
  /** @type {Set<string>} */
  const runningBots = new Set();

  function readBotState(botId, now = Date.now()) {
    const all = loadStore(file);
    const raw = all[botId] ?? { runs: [], suggestions: [], dismissals: [], seenAt: 0 };
    return pruneLookAroundState(raw, now);
  }

  function writeBotState(botId, state, now = Date.now()) {
    const all = loadStore(file);
    const pruned = pruneLookAroundState(state, now);
    pruned.runs = (pruned.runs ?? []).slice(-SUGGESTION_LIMITS.maxStoredRuns);
    all[botId] = pruned;
    writeAtomicFile(file, `${JSON.stringify(all, null, 2)}\n`);
    return pruned;
  }

  function getState(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    const cfg = botLookAround(bot);
    const state = readBotState(botId, now);
    const open = state.suggestions.filter((s) => s.status === 'open');
    return {
      botId,
      config: cfg,
      nextRunAt: bot?.paused ? null : nextLookAroundAt(cfg, now),
      running: runningBots.has(botId),
      runs: state.runs ?? [],
      suggestions: state.suggestions,
      openSuggestions: open,
      unseenCount: open.filter((s) => s.createdAt > (state.seenAt ?? 0)).length,
      seenAt: state.seenAt ?? 0,
    };
  }

  function listUpNext(botId, now = Date.now()) {
    return getState(botId, now).openSuggestions;
  }

  function countOpenUpNext(botId, now = Date.now()) {
    return listUpNext(botId, now).length;
  }

  function setConfig(botId, patch, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const nextCfg = patchLookAround(botLookAround(bot), patch, now);
    botsStore.updateBot(bot.id, { lookAround: nextCfg }, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround', 'bot'] });
    return { botId: bot.id, config: nextCfg, nextRunAt: bot.paused ? null : nextLookAroundAt(nextCfg, now) };
  }

  function addSuggestion(botId, candidate, { runSessionId = null, now = Date.now() } = {}) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const norm = normalizeSuggestion(candidate);
    if (!norm.ok) {
      throw Object.assign(new Error(norm.reason), { code: norm.code });
    }
    const state = readBotState(botId, now);
    const dedupe = checkSuggestionDedupe(state, norm.suggestion, now, runSessionId);
    if (dedupe.duplicate) {
      return { ok: false, duplicate: true, reason: dedupe.reason };
    }
    const item = {
      id: crypto.randomUUID(),
      ...norm.suggestion,
      key: dedupe.key,
      status: 'open',
      runSessionId,
      createdAt: now,
    };
    state.suggestions.push(item);
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, duplicate: false, suggestion: item };
  }

  async function lookNow(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    if (runningBots.has(bot.id)) {
      return { ok: true, alreadyRunning: true, botId: bot.id };
    }
    runningBots.add(bot.id);
    const runId = `look-${crypto.randomUUID().slice(0, 8)}`;
    const cfg = botLookAround(bot);
    const focusLine = cfg.focus ? `Focus area: ${cfg.focus}` : 'Focus on open items, pending work, and actionable updates.';
    const prompt = [
      '[WhaleIsle: Look Around read-only sweep]',
      focusLine,
      'Review recent context and call `bot_suggest` for up to 5 concrete suggestions worth bringing to your owner. End with `NO_REPLY`.',
    ].join('\n');

    let outcome = { ok: true, summary: 'completed' };
    try {
      if (typeof deps.runSweep === 'function') {
        outcome = await deps.runSweep(bot, prompt);
      } else {
        const started = await sessionRuntime.startSideChat(bot.id, {
          title: 'Look Around',
          kind: 'look-around',
          origin: 'automation',
        });
        const res = await sessionRuntime.runSingleTurn(started.sessionId, prompt, { timeoutMs: 90_000 });
        outcome = { ok: Boolean(res.ok), summary: res.error || 'completed' };
        botsStore.closeChat(started.sessionId, Date.now());
      }
    } catch (error) {
      outcome = { ok: false, summary: String(error?.message ?? error) };
    } finally {
      runningBots.delete(bot.id);
    }

    const state = readBotState(bot.id, now);
    state.runs = [...(state.runs ?? []), { id: runId, at: now, ok: outcome.ok, summary: outcome.summary }];
    writeBotState(bot.id, state, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround'] });
    return { ok: outcome.ok, runId, botId: bot.id, summary: outcome.summary };
  }

  async function startSuggestion(botId, suggestionId, { chat = 'home', now = Date.now() } = {}) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const state = readBotState(bot.id, now);
    const entry = state.suggestions.find((s) => s.id === suggestionId);
    if (!entry) throw Object.assign(new Error(`Suggestion not found: ${suggestionId}`), { code: 'not_found' });

    entry.status = 'started';
    entry.resolvedAt = now;
    writeBotState(bot.id, state, now);

    const target = chat === 'new'
      ? await sessionRuntime.startSideChat(bot.id, { title: entry.title })
      : await sessionRuntime.openHomeChat(bot.id);
    const prompt = entry.link ? `${entry.ask}\n\nLink: ${entry.link}` : entry.ask;
    await sessionRuntime.runSingleTurn(target.sessionId, prompt, { timeoutMs: 30_000 }).catch(() => null);
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround', 'chats'] });
    return { ok: true, suggestion: entry, sessionId: target.sessionId };
  }

  function dismissSuggestion(botId, suggestionId, now = Date.now()) {
    const state = readBotState(botId, now);
    const entry = state.suggestions.find((s) => s.id === suggestionId);
    if (!entry) throw Object.assign(new Error(`Suggestion not found: ${suggestionId}`), { code: 'not_found' });
    entry.status = 'dismissed';
    entry.resolvedAt = now;
    state.dismissals.push({ key: entry.key, title: entry.title, at: now });
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, suggestion: entry };
  }

  function markSeen(botId, now = Date.now()) {
    const state = readBotState(botId, now);
    state.seenAt = now;
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, botId, seenAt: now };
  }

  function markUnseen(botId, now = Date.now()) {
    const state = readBotState(botId, now);
    state.seenAt = 0;
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, botId, seenAt: 0 };
  }

  let timer = null;
  if (deps.enableScheduler !== false) {
    timer = setInterval(() => {
      const now = Date.now();
      for (const bot of botsStore.listBots()) {
        if (bot.paused || runningBots.has(bot.id)) continue;
        const cfg = botLookAround(bot);
        if (!cfg.on) continue;
        const state = readBotState(bot.id, now);
        const lastAt = state.runs?.at(-1)?.at ?? cfg.since ?? bot.createdAt ?? 0;
        const dueAt = nextLookAroundAt(cfg, lastAt);
        if (dueAt !== null && dueAt <= now) {
          void lookNow(bot.id, now).catch(() => null);
        }
      }
    }, TICK_MS);
    timer.unref?.();
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    getState,
    listUpNext,
    countOpenUpNext,
    setConfig,
    addSuggestion,
    lookNow,
    startSuggestion,
    dismissSuggestion,
    markSeen,
    markUnseen,
    close,
  };
}
