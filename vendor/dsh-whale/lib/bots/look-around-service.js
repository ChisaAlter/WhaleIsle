/**
 * Look Around & Up Next service.
 * Persists per-bot sweep history, open/started/dismissed suggestions, armedAt
 * gate, circuit-breaker counters, and seen markers in `_meta/bot-look-around.json`,
 * reusing deduplication & schedule math from `src/shared/bot-look-around.js`.
 *
 * Enhancements:
 * - Code-level read-only tool policy (`isLookAroundToolAllowed` / `evaluateLookAroundToolPolicy`)
 * - Sweep prompt injection of `history.open`, `history.started`, `history.dismissed`
 * - `armedAt` gate (`markFirstOwnerChat`) so fresh bots do not sweep before first owner chat
 * - Consecutive-failure circuit breaker (auto-disables after 3 consecutive failures)
 * - Automatic replacement of previous round's `open` suggestions on successful sweep
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  SUGGESTION_LIMITS,
  botLookAround,
  checkSuggestionDedupe,
  fenceQuotedText,
  nextLookAroundAt,
  normalizeSuggestion,
  patchLookAround,
  pruneLookAroundState,
} from '../../src/shared/index.js';
import { botMetaDir, writeAtomicFile } from './fs-home.js';

const TICK_MS = 60_000;
export const LOOK_AROUND_MAX_CONSECUTIVE_FAILURES = 3;

/** Explicit read-only + suggestion tool allowlist during Look Around sweeps. */
export const LOOK_AROUND_ALLOWED_TOOLS = Object.freeze(new Set([
  // Native bot read-only & suggest tools
  'bot_suggest',
  'bot_list',
  'bot_chats',
  'bot_work_list',
  'bot_item_list',
  'bot_item_show',
  // Standard read-only filesystem / code inspection tools
  'read_file',
  'view_file',
  'view_file_outline',
  'view_code_item',
  'read',
  'list_dir',
  'list_directory',
  'ls',
  'glob',
  'find_files',
  'find_by_name',
  'grep',
  'grep_search',
  'ripgrep',
  'search_files',
  'file_search',
  'stat_file',
  // Read-only git inspection tools
  'git_status',
  'git_log',
  'git_diff',
  'git_show',
]));

/** Explicit write / side-effect / shell / external tools always blocked. */
export const LOOK_AROUND_DISALLOWED_TOOLS = Object.freeze(new Set([
  'bot_work_start',
  'bot_work_forget',
  'bot_tools_manage',
  'bot_reply',
  'bot_send',
  'bot_create_offer',
  'bot_automation_create',
  'bot_new_chat',
  'bot_memory_forget',
  'bot_look_around_set',
  'bot_item_add',
  'bot_item_set',
  'bot_item_comment',
  'bot_item_done',
  'bot_item_cancel',
  'bot_item_link',
  'write_file',
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
  'apply_patch',
  'patch_file',
  'delete_file',
  'remove_file',
  'rename_file',
  'move_file',
  'mkdir',
  'write',
  'edit',
  'notebook_edit',
  'notebookedit',
  'bash',
  'sh',
  'shell',
  'exec',
  'run_command',
  'execute_command',
  'terminal',
  'powershell',
  'cmd',
  'spawn',
  'web_fetch',
  'fetch_url',
  'http_request',
  'subagent',
  'invoke_subagent',
  'task',
  'agent',
]));

const DANGEROUS_FLAG_RE = /(?:^|\s)(?:--join|--download|--offer|--output|--upload-file|--in-place|--write|--delete|--force|--exec|--apply|-X|-T|-o|-c)(?:\s|=|$)/u;
const DANGEROUS_SHELL_RE = /\$\(|`[^`]+`|\|\s*(?:sh|bash|zsh|pwsh|powershell|cmd)\b|(?:^|\s)>>?\s*\S/iu;
const DANGEROUS_ARG_KEYS = new Set(['write', 'delete', 'remove', 'force', 'inPlace', 'in_place', 'execute', 'exec']);

/** @param {string} str @param {string} key */
function checkDangerousString(str, key) {
  if (DANGEROUS_FLAG_RE.test(str)) {
    return `Disallowed flag in argument "${key || 'arg'}" during Look Around`;
  }
  if (DANGEROUS_SHELL_RE.test(str)) {
    return `Shell redirection/execution pattern in "${key || 'arg'}" is not allowed during Look Around`;
  }
  return null;
}

/** @param {unknown} value @param {string} [key] @param {number} [depth] @returns {string | null} */
function findDangerousArgument(value, key = '', depth = 0) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (DANGEROUS_ARG_KEYS.has(key) && value === true) {
    return `Dangerous boolean flag "${key}=true" is not allowed during Look Around`;
  }
  if (key === 'mode' && typeof value === 'string' && /[wa+]/i.test(value)) {
    return `Write mode "${value}" is not allowed during Look Around`;
  }
  if (typeof value === 'string') return checkDangerousString(value, key);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findDangerousArgument(value[i], `${key}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const hit = findDangerousArgument(v, k, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Evaluate code-level read-only tool guard policy for Look Around sessions.
 * Designed for Wave 2 integration in `bot-tools-registry.js` and Harness tool guards.
 * @param {string} toolName
 * @param {any} [args]
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function evaluateLookAroundToolPolicy(toolName, args = undefined) {
  const normalized = String(toolName ?? '').trim().toLowerCase();
  if (!normalized) {
    return { allowed: false, reason: 'Tool name is required' };
  }
  if (LOOK_AROUND_DISALLOWED_TOOLS.has(normalized)) {
    return { allowed: false, reason: `Tool "${toolName}" is disallowed during read-only Look Around sweeps` };
  }
  if (!LOOK_AROUND_ALLOWED_TOOLS.has(normalized)) {
    return { allowed: false, reason: `Tool "${toolName}" is not in the Look Around read-only allowlist` };
  }
  // `bot_suggest` accepts natural-language suggestion prose; only validate non-prose fields.
  if (normalized === 'bot_suggest') {
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return { allowed: false, reason: 'bot_suggest requires an object argument' };
    }
    return { allowed: true };
  }
  const danger = findDangerousArgument(args);
  if (danger) {
    return { allowed: false, reason: danger };
  }
  return { allowed: true };
}

/**
 * Boolean convenience wrapper for code-level read-only Look Around tool policy.
 * @param {string} toolName
 * @param {any} [args]
 */
export function isLookAroundToolAllowed(toolName, args = undefined) {
  return evaluateLookAroundToolPolicy(toolName, args).allowed;
}

/** @param {any[]} entries @param {number} max */
function formatHistoryLines(entries, max = 20) {
  return entries.slice(-max).map((entry) => {
    const linkPart = entry.link ? ` (${entry.link})` : '';
    return `- ${entry.title}${linkPart}`;
  }).join('\n');
}

/**
 * Build the Look Around read-only sweep prompt with deduplication history context:
 * - `history.open`: currently listed Up Next items (do not re-suggest)
 * - `history.started`: recently accepted suggestions (owner preference signal, do not repeat)
 * - `history.dismissed`: dismissed suggestions (never suggest again)
 * @param {any} bot
 * @param {any} cfg
 * @param {any} state
 */
export function buildLookAroundPrompt(bot, cfg, state) {
  const focusLine = cfg?.focus
    ? `Focus area: ${cfg.focus}`
    : 'Focus on open items, pending work, unreviewed workspaces, and actionable updates.';

  const suggestions = Array.isArray(state?.suggestions) ? state.suggestions : [];
  const openItems = suggestions.filter((s) => s.status === 'open');
  const startedItems = suggestions.filter((s) => s.status === 'started');
  const dismissedItems = [
    ...suggestions.filter((/** @type {any} */ s) => s.status === 'dismissed').map((/** @type {any} */ s) => ({ title: s.title, link: s.link })),
    ...(Array.isArray(state?.dismissals) ? state.dismissals : []).map((/** @type {any} */ d) => ({ title: d.title, link: d.link })),
  ];
  // Deduplicate dismissed by title/link
  const seenDismissed = new Set();
  const uniqueDismissed = [];
  for (const d of dismissedItems) {
    if (!d?.title) continue;
    const k = `${String(d.title).toLowerCase()}|${d.link ?? ''}`;
    if (seenDismissed.has(k)) continue;
    seenDismissed.add(k);
    uniqueDismissed.push(d);
  }

  const lines = [
    `[WhaleIsle: Look Around read-only sweep for ${bot?.name ?? 'Bot'}]`,
    focusLine,
    'Strict read-only rule: Only inspect existing context and call `bot_suggest` for up to 5 concrete, high-signal suggestions worth bringing to your owner. Do NOT modify files, run shell commands, dispatch workers, send messages, or create offers. End with `NO_REPLY`.',
  ];

  if (openItems.length > 0) {
    lines.push(
      '',
      '[history.open — already listed in Up Next; do NOT duplicate these]:',
      fenceQuotedText(formatHistoryLines(openItems, 15)),
    );
  }
  if (startedItems.length > 0) {
    lines.push(
      '',
      '[history.started — recently accepted by owner; reflects preferences, do NOT repeat]:',
      fenceQuotedText(formatHistoryLines(startedItems, 15)),
    );
  }
  if (uniqueDismissed.length > 0) {
    lines.push(
      '',
      '[history.dismissed — explicitly dismissed by owner; NEVER suggest these again]:',
      fenceQuotedText(formatHistoryLines(uniqueDismissed, 25)),
    );
  }

  return lines.join('\n');
}

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

/** @param {any} state @param {any} suggestion */
function decorateSuggestionSeen(state, suggestion) {
  const seenAt = Number(state?.seenAt ?? 0);
  const seenIds = new Set(Array.isArray(state?.seenIds) ? state.seenIds : []);
  const unseenIds = new Set(Array.isArray(state?.unseenIds) ? state.unseenIds : []);
  const unread = unseenIds.has(suggestion.id)
    ? true
    : (seenIds.has(suggestion.id) ? false : Number(suggestion.createdAt ?? 0) > seenAt);
  return { ...suggestion, seen: !unread, unread };
}

/** @param {any} optionsOrNow */
function parseSeenMutationArgs(optionsOrNow) {
  if (typeof optionsOrNow === 'number') {
    return { now: optionsOrNow, targetIds: [] };
  }
  const opts = optionsOrNow && typeof optionsOrNow === 'object' ? optionsOrNow : {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  /** @type {string[]} */
  const ids = [];
  if (Array.isArray(opts.ids)) {
    for (const raw of opts.ids) {
      const s = String(raw ?? '').trim();
      if (s) ids.push(s);
    }
  }
  for (const single of [opts.suggestionId, opts.id]) {
    const s = String(single ?? '').trim();
    if (s) ids.push(s);
  }
  return { now, targetIds: [...new Set(ids)] };
}

/** @param {any} state @param {Set<string>} priorOpenIds @param {number} now */
function replacePriorOpenSuggestions(state, priorOpenIds, now) {
  let replacedCount = 0;
  if (priorOpenIds.size === 0) return replacedCount;
  state.suggestions = state.suggestions.map((/** @type {any} */ s) => {
    if (s.status === 'open' && priorOpenIds.has(s.id)) {
      replacedCount += 1;
      return { ...s, status: 'replaced', resolvedAt: now };
    }
    return s;
  });
  return replacedCount;
}

/** @param {any} state @param {any} bot @param {any} botsStore @param {number} maxFailures @param {number} now */
function recordSweepFailure(state, bot, botsStore, maxFailures, now) {
  state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
  if (state.consecutiveFailures < maxFailures) return false;
  state.trippedAt = now;
  state.trippedReason = 'consecutive_failures';
  const latestBot = botsStore.getBot(bot.id);
  if (latestBot) {
    const disabledCfg = patchLookAround(botLookAround(latestBot), { on: false }, now);
    botsStore.updateBot(bot.id, { lookAround: disabledCfg }, now);
  }
  return true;
}

/**
 * Create Look Around & Up Next service.
 * @param {{
 *   dshHome: string,
 *   botsStore: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 *   budgetService?: any,
 *   onError?: (error: unknown, context?: Record<string, any>) => void,
 *   runSweep?: (bot: any, prompt: string) => Promise<{ ok: boolean, summary?: string }>,
 *   maxConsecutiveFailures?: number,
 *   enableScheduler?: boolean,
 * }} deps
 */
export function createLookAroundService(deps) {
  const { dshHome, botsStore, sessionRuntime, eventBus, budgetService = null } = deps;
  const maxConsecutiveFailures = Number.isInteger(deps.maxConsecutiveFailures) && Number(deps.maxConsecutiveFailures) > 0
    ? Number(deps.maxConsecutiveFailures)
    : LOOK_AROUND_MAX_CONSECUTIVE_FAILURES;
  const metaRoot = botMetaDir(dshHome);
  const file = stateFilePath(metaRoot);
  /** @type {Set<string>} */
  const runningBots = new Set();
  /** @type {Map<string, number>} */
  const deferredUntil = new Map();

  /** @param {unknown} error @param {Record<string, any>} [context] */
  function reportError(error, context = {}) {
    const message = error instanceof Error ? error.message : String(error ?? 'unknown_error');
    if (typeof deps.onError === 'function') {
      deps.onError(error, { ...context, message });
      return;
    }
    console.error('[dsh-bots:look-around]', message, context);
  }

  /** @param {string} botId @param {number} [now] */
  function readBotState(botId, now = Date.now()) {
    const all = loadStore(file);
    const raw = all[botId] ?? {
      runs: [],
      suggestions: [],
      dismissals: [],
      seenAt: 0,
      seenIds: [],
      unseenIds: [],
      armedAt: null,
      consecutiveFailures: 0,
      trippedAt: null,
      trippedReason: null,
    };
    const pruned = /** @type {any} */ (pruneLookAroundState(raw, now));
    return {
      ...pruned,
      seenIds: Array.isArray(pruned.seenIds) ? pruned.seenIds : [],
      unseenIds: Array.isArray(pruned.unseenIds) ? pruned.unseenIds : [],
      armedAt: Number.isFinite(pruned.armedAt) ? pruned.armedAt : null,
      consecutiveFailures: Number.isInteger(pruned.consecutiveFailures) ? pruned.consecutiveFailures : 0,
      trippedAt: Number.isFinite(pruned.trippedAt) ? pruned.trippedAt : null,
      trippedReason: typeof pruned.trippedReason === 'string' ? pruned.trippedReason : null,
    };
  }

  /** @param {string} botId @param {any} state @param {number} [now] */
  function writeBotState(botId, state, now = Date.now()) {
    const all = loadStore(file);
    const pruned = /** @type {any} */ (pruneLookAroundState(state, now));
    pruned.runs = (pruned.runs ?? []).slice(-SUGGESTION_LIMITS.maxStoredRuns);
    const validIds = new Set((pruned.suggestions ?? []).map((/** @type {any} */ s) => s.id));
    pruned.seenIds = (Array.isArray(state.seenIds) ? state.seenIds : []).filter((/** @type {string} */ id) => validIds.has(id));
    pruned.unseenIds = (Array.isArray(state.unseenIds) ? state.unseenIds : []).filter((/** @type {string} */ id) => validIds.has(id));
    all[botId] = pruned;
    writeAtomicFile(file, `${JSON.stringify(all, null, 2)}\n`);
    return pruned;
  }

  /**
   * Arm periodic Look Around for a bot after it completes its first genuine owner chat.
   * Safe to call repeatedly (idempotent; preserves the initial `armedAt` timestamp).
   * @param {string} botId
   * @param {number} [now]
   */
  function markFirstOwnerChat(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const state = readBotState(bot.id, now);
    if (state.armedAt !== null) {
      return { ok: true, botId: bot.id, armedAt: state.armedAt, newlyArmed: false };
    }
    state.armedAt = now;
    writeBotState(bot.id, state, now);
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround'] });
    return { ok: true, botId: bot.id, armedAt: now, newlyArmed: true };
  }

  /** @param {string} botId @param {number} [now] */
  function getState(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    const cfg = botLookAround(bot);
    const state = readBotState(botId, now);
    const decorated = state.suggestions.map((/** @type {any} */ s) => decorateSuggestionSeen(state, s));
    const open = decorated.filter((/** @type {any} */ s) => s.status === 'open');
    const armed = state.armedAt !== null;
    return {
      botId,
      config: cfg,
      armed,
      armedAt: state.armedAt,
      consecutiveFailures: state.consecutiveFailures,
      trippedAt: state.trippedAt,
      trippedReason: state.trippedReason,
      nextRunAt: (!bot || bot.paused || !armed) ? null : nextLookAroundAt(cfg, now),
      running: runningBots.has(botId),
      runs: state.runs ?? [],
      suggestions: decorated,
      openSuggestions: open,
      unseenCount: open.filter((/** @type {any} */ s) => s.unread).length,
      seenAt: state.seenAt ?? 0,
    };
  }

  /** @param {string} botId @param {number} [now] */
  function listUpNext(botId, now = Date.now()) {
    return getState(botId, now).openSuggestions;
  }

  /** @param {string} botId @param {number} [now] */
  function countOpenUpNext(botId, now = Date.now()) {
    return listUpNext(botId, now).length;
  }

  /** @param {string} botId @param {any} patch @param {number} [now] */
  function setConfig(botId, patch, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const nextCfg = patchLookAround(botLookAround(bot), patch, now);
    botsStore.updateBot(bot.id, { lookAround: nextCfg }, now);
    const state = readBotState(bot.id, now);
    if (patch?.on === true && (state.consecutiveFailures > 0 || state.trippedAt !== null)) {
      state.consecutiveFailures = 0;
      state.trippedAt = null;
      state.trippedReason = null;
      writeBotState(bot.id, state, now);
    }
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround', 'bot'] });
    return {
      botId: bot.id,
      config: nextCfg,
      armed: state.armedAt !== null,
      nextRunAt: (bot.paused || state.armedAt === null) ? null : nextLookAroundAt(nextCfg, now),
    };
  }

  /** @param {string} botId @param {any} candidate @param {{ runSessionId?: string | null, now?: number }} [opts] */
  function addSuggestion(botId, candidate, { runSessionId = null, now = Date.now() } = {}) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const norm = /** @type {any} */ (normalizeSuggestion(candidate));
    if (!norm.ok) {
      throw Object.assign(new Error(norm.reason), { code: norm.code });
    }
    const state = readBotState(botId, now);
    const dedupe = (/** @type {any} */ (checkSuggestionDedupe))(state, norm.suggestion, now, runSessionId);
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
    return { ok: true, duplicate: false, suggestion: decorateSuggestionSeen(state, item) };
  }

  /** @param {any} bot @param {string} prompt */
  async function executeSweepTurn(bot, prompt) {
    if (typeof deps.runSweep === 'function') {
      return deps.runSweep(bot, prompt);
    }
    const started = await sessionRuntime.startSideChat(bot.id, {
      title: 'Look Around',
      kind: 'look-around',
      origin: 'automation',
    });
    const res = await sessionRuntime.runSingleTurn(started.sessionId, prompt, { timeoutMs: 90_000 });
    botsStore.closeChat(started.sessionId, Date.now());
    return { ok: Boolean(res.ok), summary: res.error || 'completed' };
  }

  /** @param {string} botId @param {number} now @param {{ isBackground?: boolean }} options */
  function checkBudgetGate(botId, now, options) {
    if (!budgetService || typeof budgetService.checkExecutionAllowed !== 'function') return null;
    const gate = budgetService.checkExecutionAllowed(botId, { isBackground: options.isBackground === true, at: now });
    return gate.allowed
      ? null
      : { ok: false, skipped: true, reason: gate.reason || 'budget_exceeded', deferUntilMs: gate.deferUntilMs ?? null, botId };
  }

  /** @param {any} bot @param {string} runId @param {{ ok?: boolean, summary?: string } | null} outcome @param {Set<string>} priorOpenIds @param {number} now */
  function settleLookNowOutcome(bot, runId, outcome, priorOpenIds, now) {
    const state = readBotState(bot.id, now);
    let replacedCount = 0;
    let circuitTripped = false;
    if (outcome?.ok) {
      state.consecutiveFailures = 0;
      state.trippedAt = null;
      state.trippedReason = null;
      replacedCount = replacePriorOpenSuggestions(state, priorOpenIds, now);
    } else {
      circuitTripped = recordSweepFailure(state, bot, botsStore, maxConsecutiveFailures, now);
    }
    state.runs = [...(state.runs ?? []), { id: runId, at: now, ok: Boolean(outcome?.ok), summary: outcome?.summary ?? '' }];
    writeBotState(bot.id, state, now);
    eventBus.emit({ botIds: [bot.id], kinds: circuitTripped ? ['lookAround', 'bot'] : ['lookAround'] });
    return {
      ok: Boolean(outcome?.ok),
      runId,
      botId: bot.id,
      summary: outcome?.summary ?? '',
      replacedCount,
      consecutiveFailures: state.consecutiveFailures,
      circuitTripped,
    };
  }

  /** @param {string} botId @param {number} [now] @param {{ isBackground?: boolean }} [options] */
  async function lookNow(botId, now = Date.now(), options = {}) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    if (runningBots.has(bot.id)) return { ok: true, alreadyRunning: true, botId: bot.id };
    const blocked = checkBudgetGate(bot.id, now, options);
    if (blocked) return blocked;

    runningBots.add(bot.id);
    const runId = `look-${crypto.randomUUID().slice(0, 8)}`;
    const beforeState = readBotState(bot.id, now);
    const priorOpenIds = new Set(
      beforeState.suggestions.filter((/** @type {any} */ s) => s.status === 'open').map((/** @type {any} */ s) => s.id),
    );
    const prompt = buildLookAroundPrompt(bot, botLookAround(bot), beforeState);

    /** @type {{ ok: boolean, summary?: string }} */
    let outcome = { ok: true, summary: 'completed' };
    try {
      outcome = await executeSweepTurn(bot, prompt);
    } catch (error) {
      reportError(error, { phase: 'lookNow', botId: bot.id, runId });
      outcome = { ok: false, summary: String(/** @type {any} */ (error)?.message ?? error) };
    } finally {
      runningBots.delete(bot.id);
    }
    return settleLookNowOutcome(bot, runId, outcome, priorOpenIds, now);
  }

  /** @param {string} botId @param {string} suggestionId @param {{ chat?: string, now?: number }} [opts] */
  async function startSuggestion(botId, suggestionId, { chat = 'home', now = Date.now() } = {}) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const state = readBotState(bot.id, now);
    const entry = state.suggestions.find((/** @type {any} */ s) => s.id === suggestionId);
    if (!entry) throw Object.assign(new Error(`Suggestion not found: ${suggestionId}`), { code: 'not_found' });

    entry.status = 'started';
    entry.resolvedAt = now;
    writeBotState(bot.id, state, now);

    const target = chat === 'new'
      ? await sessionRuntime.startSideChat(bot.id, { title: entry.title })
      : await sessionRuntime.openHomeChat(bot.id);
    const prompt = entry.link ? `${entry.ask}\n\nLink: ${entry.link}` : entry.ask;
    let turnError = null;
    try {
      const turnRes = await sessionRuntime.runSingleTurn(target.sessionId, prompt, { timeoutMs: 30_000 });
      if (turnRes && turnRes.ok === false) {
        turnError = String(turnRes.error ?? 'turn_failed');
        reportError(new Error(turnError), {
          phase: 'startSuggestion',
          botId: bot.id,
          suggestionId,
          sessionId: target.sessionId,
        });
      }
    } catch (error) {
      turnError = error instanceof Error ? error.message : String(error ?? 'turn_failed');
      reportError(error, {
        phase: 'startSuggestion',
        botId: bot.id,
        suggestionId,
        sessionId: target.sessionId,
      });
    }
    eventBus.emit({ botIds: [bot.id], kinds: ['lookAround', 'chats'] });
    return {
      ok: true,
      suggestion: entry,
      sessionId: target.sessionId,
      ...(turnError ? { turnError } : {}),
    };
  }

  /** @param {string} botId @param {string} suggestionId @param {number} [now] */
  function dismissSuggestion(botId, suggestionId, now = Date.now()) {
    const state = readBotState(botId, now);
    const entry = state.suggestions.find((/** @type {any} */ s) => s.id === suggestionId);
    if (!entry) throw Object.assign(new Error(`Suggestion not found: ${suggestionId}`), { code: 'not_found' });
    entry.status = 'dismissed';
    entry.resolvedAt = now;
    state.dismissals.push({ key: entry.key, title: entry.title, link: entry.link, at: now });
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, suggestion: entry };
  }

  /** @param {string} botId @param {number | { id?: string, suggestionId?: string, ids?: string[], now?: number }} [optionsOrNow] */
  function markSeen(botId, optionsOrNow = Date.now()) {
    const { now, targetIds } = parseSeenMutationArgs(optionsOrNow);
    const state = readBotState(botId, now);
    if (targetIds.length > 0) {
      const seenSet = new Set(state.seenIds);
      const unseenSet = new Set(state.unseenIds);
      for (const id of targetIds) {
        seenSet.add(id);
        unseenSet.delete(id);
      }
      state.seenIds = [...seenSet];
      state.unseenIds = [...unseenSet];
    } else {
      state.seenAt = now;
      state.unseenIds = [];
    }
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, botId, seenAt: state.seenAt, ...(targetIds.length > 0 ? { ids: targetIds } : {}) };
  }

  /** @param {string} botId @param {number | { id?: string, suggestionId?: string, ids?: string[], now?: number }} [optionsOrNow] */
  function markUnseen(botId, optionsOrNow = Date.now()) {
    const { now, targetIds } = parseSeenMutationArgs(optionsOrNow);
    const state = readBotState(botId, now);
    if (targetIds.length > 0) {
      const seenSet = new Set(state.seenIds);
      const unseenSet = new Set(state.unseenIds);
      for (const id of targetIds) {
        unseenSet.add(id);
        seenSet.delete(id);
      }
      state.seenIds = [...seenSet];
      state.unseenIds = [...unseenSet];
    } else {
      state.seenAt = 0;
      state.seenIds = [];
    }
    writeBotState(botId, state, now);
    eventBus.emit({ botIds: [botId], kinds: ['lookAround'] });
    return { ok: true, botId, seenAt: state.seenAt, ...(targetIds.length > 0 ? { ids: targetIds } : {}) };
  }

  /**
   * Single scheduler sweep over all bots. Respects the `armedAt` gate so
   * newly created bots never run periodic sweeps before their first owner chat.
   * @param {number} [now]
   * @param {{ isBackground?: boolean }} [options]
   */
  async function tick(now = Date.now(), options = {}) {
    const triggered = [];
    const skippedUnarmed = [];
    const isBackground = options.isBackground === true;
    for (const bot of botsStore.listBots()) {
      if (bot.paused || runningBots.has(bot.id)) continue;
      if (isBackground && (deferredUntil.get(bot.id) ?? 0) > now) continue;
      const cfg = botLookAround(bot);
      if (!cfg.on) continue;
      const state = readBotState(bot.id, now);
      if (state.armedAt === null) {
        skippedUnarmed.push(bot.id);
        continue;
      }
      const lastAt = state.runs?.at(-1)?.at ?? Math.max(cfg.since ?? 0, state.armedAt);
      const dueAt = nextLookAroundAt(cfg, lastAt);
      if (dueAt !== null && dueAt <= now) {
        triggered.push(bot.id);
        void lookNow(bot.id, now, isBackground ? { isBackground: true } : {}).then((res) => {
          const r = /** @type {any} */ (res);
          if (r?.skipped) {
            deferredUntil.set(bot.id, r.deferUntilMs ?? (now + TICK_MS));
          }
        }).catch((error) => {
          reportError(error, { phase: 'scheduler', botId: bot.id });
        });
      }
    }
    return { triggered, skippedUnarmed };
  }

  let timer = null;
  if (deps.enableScheduler !== false) {
    timer = setInterval(() => {
      void tick(Date.now(), { isBackground: true }).catch((error) => {
        reportError(error, { phase: 'scheduler' });
      });
    }, TICK_MS);
    timer.unref?.();
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = null;
    deferredUntil.clear();
  }

  return {
    getState,
    listUpNext,
    countOpenUpNext,
    setConfig,
    markFirstOwnerChat,
    addSuggestion,
    lookNow,
    tick,
    startSuggestion,
    dismissSuggestion,
    markSeen,
    markUnseen,
    close,
  };
}
