/**
 * Native Bot Tools registry for Harness sessions (`dsh-bot` & `dsh-bot-worker` presets).
 *
 * Enforces:
 * - `permissionMode === 'read-only'` hard block on all write/dispatch/outbound tools
 * - Fail-closed desktop confirmation (`confirmModelAction`) for cross-boundary tools
 *   (`bot_tools_manage` mutations, `bot_reply`)
 * - Non-owner IM refusal boundary (`isNonOwnerImTurn`) for Harness-governed tools
 * - Tool WAL (`tool-wal.js`) for high-side-effect `bot_reply` delivery
 * - Isolated Git worktree & empirical verification (`worktree-runner.js`) for `bot_work_start`
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isNonOwnerImTurn } from '../call-origin.js';
import {
  CONFIRM_TOOL_TIMEOUT_MS,
  NON_OWNER_IM_REFUSAL_TEXT,
  confirmModelAction,
  refusalTextFor,
} from '../desktop-confirm.js';
import { BOT_WORKER_PRESET_ID } from '../preset.js';
import { genericOutput } from '../shared.js';
import { buildBotItemTools } from './bot-tools-items.js';
import { appendDecisionTsv, botMetaDir, botsRootDir } from './fs-home.js';
import { resolveBotForSession } from './prompt-engine.js';
import { BOT_OWNER_WORK } from './session-runtime.js';
import { createToolWalManager } from './tool-wal.js';
import { createWorktreeRunner, executeDispatchedWorker } from './worktree-runner.js';

/** @type {any} */
let activeBotsRuntimeSource = null;

/** @type {WeakMap<object, ReturnType<typeof createWorktreeRunner>>} */
const defaultWorktreeRunners = new WeakMap();
/** @type {WeakMap<object, ReturnType<typeof createToolWalManager>>} */
const defaultWalManagers = new WeakMap();

export const READ_ONLY_ALLOWED_TOOLS = Object.freeze([
  'bot_list',
  'bot_chats',
  'bot_work_list',
  'bot_item_list',
  'bot_item_show',
  'bot_memory_search',
]);

export const WORKER_ALLOWED_TOOLS = Object.freeze([
  'bot_item_comment',
  'bot_item_link',
  'bot_decision_append',
  'bot_memory_search',
]);

const WORKER_ALLOWED_SET = new Set(WORKER_ALLOWED_TOOLS);

const READ_ONLY_TOOL_SET = new Set(READ_ONLY_ALLOWED_TOOLS);
const READ_ONLY_REFUSAL_TEXT = '当前 Bot 处于 read-only 权限模式，禁止执行写入、派发或外发操作。';

/** @param {any} runtimeOrGetter */
export function setActiveBotsRuntime(runtimeOrGetter) {
  activeBotsRuntimeSource = runtimeOrGetter;
}

export function getActiveBotsRuntime() {
  return typeof activeBotsRuntimeSource === 'function'
    ? activeBotsRuntimeSource()
    : activeBotsRuntimeSource;
}

/** @param {string} detail */
const okOut = (detail) => ({ ok: true, detail });
/** @param {string} detail */
const errOut = (detail) => ({ ok: false, detail });

/** @param {any} runtime @param {any} exec */
function resolveCallerBot(runtime, exec) {
  if (!runtime) return null;
  const resolved = resolveBotForSession(runtime, exec);
  if (resolved?.bot) {
    return { bot: resolved.bot, sessionId: resolved.sessionId || resolved.bot.chatSessionId || 'unknown' };
  }
  const fallback = runtime.legacyCompat?.resolvePetBot?.() ?? runtime.botsStore?.listBots?.()?.[0] ?? null;
  return fallback ? { bot: fallback, sessionId: fallback.chatSessionId || 'unknown' } : null;
}

/** @param {any} runtime @param {any} bot */
const botHomeDir = (runtime, bot) => path.join(botsRootDir(runtime.dshHome), bot.folder);

/** @param {any} itemsStore @param {string | number} ref */
function resolveItemUid(itemsStore, ref) {
  const raw = String(ref ?? '').trim();
  const numMatch = /^#?(\d+)$/u.exec(raw);
  if (numMatch && itemsStore?.byNumber) {
    const found = itemsStore.byNumber(Number(numMatch[1]));
    if (found) return found.uid;
  }
  return raw;
}

/** @param {string} toolName @param {any} args */
function isReadOnlyAllowedCall(toolName, args) {
  if (READ_ONLY_TOOL_SET.has(toolName)) return true;
  if (toolName === 'bot_tools_manage' && String(args?.action ?? '').trim() === 'list') return true;
  if (toolName === 'bot_crew_adopt' && String(args?.action ?? '').trim() === 'list') return true;
  return false;
}

/** @param {any} runtime @param {string} toolName @param {unknown} error @param {Record<string, any>} [meta] */
function reportToolAsyncError(runtime, toolName, error, meta = {}) {
  const errMsg = error instanceof Error ? error.message : String(error ?? 'unknown_error');
  if (typeof runtime?.onToolError === 'function') {
    runtime.onToolError({ toolName, error: errMsg, ...meta });
    return;
  }
  console.error(`[dsh-bots:${toolName}]`, errMsg, meta);
}

/** @param {any} runtime @param {any} options */
function resolveWorktreeRunner(runtime, options) {
  if (options?.worktreeRunner) return options.worktreeRunner;
  if (runtime?.worktreeRunner) return runtime.worktreeRunner;
  let runner = defaultWorktreeRunners.get(runtime);
  if (!runner) {
    runner = createWorktreeRunner({
      metaRoot: botMetaDir(runtime.dshHome),
      workStore: runtime.workStore,
      execGit: options?.execGit,
      execCommand: options?.execCommand,
    });
    defaultWorktreeRunners.set(runtime, runner);
  }
  return runner;
}

/** @param {any} runtime @param {any} options */
function resolveToolWal(runtime, options) {
  if (options?.toolWal) return options.toolWal;
  if (runtime?.toolWal) return runtime.toolWal;
  if (!runtime?.workStore?.appendToolWalIntent) return null;
  let wal = defaultWalManagers.get(runtime);
  if (!wal) {
    wal = createToolWalManager({ workStore: runtime.workStore });
    defaultWalManagers.set(runtime, wal);
  }
  return wal;
}

/** @param {any} runtime @param {any} options */
const resolveImOutboundBridge = (runtime, options) => (
  options?.imOutboundBridge ?? runtime?.imOutboundBridge ?? runtime?.ctx?.get?.('dshImOutboundBridge') ?? null
);

/** @param {string} name @param {string} description @param {Record<string, any>} parameters @param {(args: any, exec: any) => Promise<any>} execute @param {number} [timeoutMs] */
function makeTool(name, description, parameters, execute, timeoutMs = 20_000) {
  return {
    name,
    description,
    timeoutMs,
    parameters,
    output: genericOutput,
    presentCall: () => ({ card: 'generic', title: name, kind: 'other', content: [] }),
    execute,
  };
}

/** @param {string} homeDir @param {string} query @param {number} limit */
function fallbackScanBotMemory(homeDir, query, limit) {
  const tokens = String(query ?? '').toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return [];
  const files = [];
  const memFile = path.join(homeDir, 'MEMORY.md');
  if (fs.existsSync(memFile)) files.push({ rel: 'MEMORY.md', full: memFile });
  const memDir = path.join(homeDir, 'memory');
  if (fs.existsSync(memDir)) {
    for (const entry of fs.readdirSync(memDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({ rel: `memory/${entry.name}`, full: path.join(memDir, entry.name) });
      }
    }
  }
  const hits = [];
  for (const file of files) {
    for (const raw of fs.readFileSync(file.full, 'utf8').split(/\r?\n/u)) {
      const text = raw.trim();
      if (!text) continue;
      const lower = text.toLowerCase();
      const matched = tokens.filter((t) => lower.includes(t)).length;
      if (matched > 0) hits.push({ scope: 'bot', sourceFile: file.rel, body: text, score: matched / tokens.length });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** @param {any} runtime @param {any} caller @param {any} args */
function executeMemorySearch(runtime, caller, args) {
  const query = String(args.query ?? '').trim();
  if (!query) return errOut('query is required.');
  const scopeRaw = String(args.scope ?? 'all').trim().toLowerCase();
  const scopeFilter = scopeRaw === 'all' || !scopeRaw ? null : scopeRaw;
  const scopeId = args.scopeId ? String(args.scopeId).trim() : null;
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 10));
  const homeDir = botHomeDir(runtime, caller.bot);

  if (typeof runtime.memoryService?.searchMemory === 'function') {
    const results = runtime.memoryService.searchMemory({
      botId: caller.bot.id,
      query,
      scope: scopeFilter,
      groupId: scopeFilter === 'team' ? scopeId : null,
      projectId: scopeFilter === 'project' ? scopeId : null,
      limit,
    });
    if (Array.isArray(results) && results.length > 0) {
      return okOut(JSON.stringify({ query, scope: scopeRaw, results }));
    }
  }
  if (!scopeFilter || scopeFilter === 'bot') {
    return okOut(JSON.stringify({ query, scope: scopeRaw, results: fallbackScanBotMemory(homeDir, query, limit) }));
  }
  return okOut(JSON.stringify({ query, scope: scopeRaw, results: [] }));
}

/** @param {any} entry */
function formatDeduplicatedReply(entry) {
  if (entry.status === 'committed') {
    return okOut(JSON.stringify({
      ok: true, deduplicated: true, delivered: true, walId: entry.walId, resultSummary: entry.resultSummary,
    }));
  }
  const status = entry.status === 'failed' ? 'FAILED' : 'UNKNOWN';
  return errOut(JSON.stringify({
    ok: false, deduplicated: true, delivered: false, status, walId: entry.walId,
    reason: status === 'UNKNOWN' ? 'previous_execution_unknown_no_replay' : 'previous_execution_failed',
  }));
}

/** @param {any} sendFn @param {any} ctx */
async function deliverReplyViaBridge(sendFn, { caller, args, text, channel, wal, walId }) {
  const delivery = await sendFn({
    botId: caller.bot.id, sessionId: caller.sessionId, channel,
    accountId: args.accountId ?? null, chatId: args.chatId ?? null,
    replyToMessageId: args.replyToMessageId ?? null, text,
  });
  const delivered = Boolean(delivery?.ok || delivery?.delivered);
  if (delivered) {
    wal?.commit(walId, { transport: 'im', channel: delivery.channel ?? channel, messageId: delivery.messageId ?? null });
    return okOut(JSON.stringify({
      ok: true, delivered: true, transport: 'im', channel: delivery.channel ?? channel ?? 'im',
      messageId: delivery.messageId ?? null, chars: text.length, walId,
    }));
  }
  const reason = String(delivery?.error ?? delivery?.reason ?? 'im_delivery_failed');
  wal?.fail(walId, reason);
  return okOut(JSON.stringify({ ok: true, delivered: false, transport: 'im', channel: channel ?? 'external', reason, chars: text.length, walId }));
}

/** @param {any} runtime @param {any} caller @param {any} text @param {string | null} channel @param {any} wal @param {string | null} walId */
function handleMissingImBridge(runtime, caller, text, channel, wal, walId) {
  const petFallback = caller.bot.replyFallback === 'pet';
  if (petFallback) runtime.legacyCompat?.notifyPet?.('say', text.slice(0, 240));
  wal?.fail(walId, 'im_bridge_unavailable');
  return okOut(JSON.stringify({
    ok: true, delivered: false, reason: 'im_bridge_unavailable',
    petNotified: petFallback, channel: channel ?? 'external', chars: text.length, walId,
  }));
}

/** @param {any} runtime @param {any} caller @param {any} args @param {any} options */
async function executeBotReply(runtime, caller, args, options) {
  const text = String(args.text ?? '').trim();
  const channel = args.channel ? String(args.channel).trim() : null;
  const wal = resolveToolWal(runtime, options);
  let walId = null;
  if (wal) {
    const intent = wal.beginIntent({
      botId: caller.bot.id, sessionId: caller.sessionId, toolName: 'bot_reply', action: 'reply', effect: 'external',
      idempotencyKey: args.idempotencyKey ? String(args.idempotencyKey).trim() : null,
      args: { text, channel, accountId: args.accountId ?? null, chatId: args.chatId ?? null },
    });
    if (intent.deduplicated) return formatDeduplicatedReply(intent.entry);
    walId = intent.entry.walId;
  }

  try {
    if (channel === 'pet') {
      runtime.legacyCompat?.notifyPet?.('say', text.slice(0, 240));
      wal?.commit(walId, { transport: 'pet', chars: text.length });
      return okOut(JSON.stringify({ ok: true, delivered: true, transport: 'pet', channel: 'pet', chars: text.length, walId }));
    }
    const bridge = resolveImOutboundBridge(runtime, options);
    const sendFn = bridge?.sendText ?? bridge?.deliver;
    if (typeof sendFn === 'function') {
      return await deliverReplyViaBridge(sendFn, { caller, args, text, channel, wal, walId });
    }
    return handleMissingImBridge(runtime, caller, text, channel, wal, walId);
  } catch (error) {
    const msg = String(/** @type {any} */ (error)?.message ?? error);
    wal?.fail(walId, msg);
    return errOut(`bot_reply delivery error: ${msg}`);
  }
}

/** @param {any} runtime @param {any} caller @param {any} args @param {any} options */
async function executeWorkStart(runtime, caller, args, options) {
  const cwd = String(args.cwd ?? '').trim();
  const prompt = String(args.prompt ?? '').trim();
  if (!cwd || !prompt) return errOut('cwd and prompt are required.');

  const dispatchId = `disp-${crypto.randomUUID().slice(0, 12)}`;
  const taskId = `task-${crypto.randomUUID().slice(0, 12)}`;
  const worktreeRunner = resolveWorktreeRunner(runtime, options);
  let prepared;
  try {
    prepared = await worktreeRunner.prepareWorkerCwd({
      botId: caller.bot.id, cwd, dispatchId, useWorktree: args.useWorktree !== false,
    });
  } catch (error) {
    return errOut(String(/** @type {any} */ (error)?.message ?? error));
  }

  let started;
  try {
    started = await runtime.sessionRuntime.startSideChat(caller.bot.id, {
      title: args.title || `Worker · ${path.basename(cwd)}`,
      kind: 'worker', origin: 'work', owner: BOT_OWNER_WORK,
      preset: BOT_WORKER_PRESET_ID, cwd: prepared.cwd,
    });
  } catch (error) {
    if (prepared.isolatedWorktree) {
      await worktreeRunner.cleanupWorktree(dispatchId).then(undefined, (/** @type {unknown} */ e) => {
        reportToolAsyncError(runtime, 'bot_work_start:rollback', e, { dispatchId });
      });
    }
    return errOut(`Failed to start worker session: ${String(/** @type {any} */ (error)?.message ?? error)}`);
  }

  const work = runtime.workStore.startWork({
    botId: caller.bot.id, source: 'app', externalId: caller.sessionId, taskId, dispatchId,
  });
  const itemUid = args.itemUid ? resolveItemUid(runtime.itemsStore, args.itemUid) : null;
  if (itemUid) runtime.itemsStore.linkStartedWorker(itemUid, dispatchId, caller.sessionId);
  runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers', 'items', 'chats'] });

  const lifecycle = executeDispatchedWorker({
    runtime, caller, homeDir: botHomeDir(runtime, caller.bot), worktreeRunner, dispatchId,
    sessionId: started.sessionId, effectiveCwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
    itemUid, args, onError: (tag, err, meta) => reportToolAsyncError(runtime, tag, err, meta),
  });

  if (args.awaitCompletion === true) {
    const outcome = await lifecycle;
    return okOut(JSON.stringify({
      work, sessionId: started.sessionId, dispatchId, preset: BOT_WORKER_PRESET_ID,
      cwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
      completed: true, passed: outcome.ok, exitCode: outcome.exitCode,
      verify: outcome.verify ?? null, decisionEntry: outcome.decisionEntry ?? null,
    }));
  }
  lifecycle.then(undefined, (err) => reportToolAsyncError(runtime, 'bot_work_start:lifecycle', err, { dispatchId }));
  return okOut(JSON.stringify({
    work, sessionId: started.sessionId, dispatchId, preset: BOT_WORKER_PRESET_ID,
    cwd: prepared.cwd, isolatedWorktree: prepared.isolatedWorktree,
  }));
}

/** @param {() => any} getRuntime */
function buildBasicBotTools(getRuntime) {
  return [
    makeTool('bot_list', 'List all bots on this machine with SOUL descriptions, status, and Home Chat IDs.', {}, async () => {
      const runtime = getRuntime();
      if (!runtime) return errOut('Bots runtime unavailable.');
      return okOut(JSON.stringify(runtime.botsService.roster()));
    }),

    makeTool('bot_chats', 'List chats for the current bot or a specified botId.', {
      botId: { type: 'string', description: 'Optional bot id (defaults to caller bot).' },
      includeClosed: { type: 'boolean', description: 'Include closed chats (default false).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const targetId = args.botId ? String(args.botId).trim() : caller.bot.id;
      return okOut(JSON.stringify(runtime.sessionRuntime.listChats(targetId, { includeClosed: args.includeClosed === true })));
    }),

    makeTool('bot_memory_search', 'Search bot, team, or project memory indexes (read-only).', {
      query: { type: 'string', description: 'Search query text.', required: true },
      scope: { type: 'string', description: 'bot | team | project | all (default all).' },
      scopeId: { type: 'string', description: 'Optional groupId or projectId filter.' },
      limit: { type: 'number', description: 'Max hits (1..50, default 10).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      return executeMemorySearch(runtime, caller, args);
    }),

    makeTool('bot_memory_forget', 'Remove a fact from MEMORY.md so turn-end guard does not restore it.', {
      fact: { type: 'string', description: 'Exact or normalized fact text to forget.', required: true },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const res = runtime.botsService.memoryForget(caller.bot.id, { fact: args.fact, actor: 'bot' });
      if (res.forgottenKeys.length > 0) runtime.recordForgottenMemoryKeys?.(caller.sessionId, res.forgottenKeys);
      return okOut(JSON.stringify(res));
    }),

    makeTool('bot_decision_append', 'Append an auditable decision row to `<botHome>/decisions/<itemUid>.tsv`.', {
      itemUid: { type: 'string', description: 'Work Item uid or #number.', required: true },
      phase: { type: 'string', description: 'Workflow phase (plan|implement|verify|review|block).', required: true },
      decision: { type: 'string', description: 'Decision outcome (approved|verified|failed|deferred|escalated).', required: true },
      evidence: { type: 'string', description: 'Empirical evidence (command, exit code, PR/file ref).' },
      notes: { type: 'string', description: 'Optional notes.' },
      actor: { type: 'string', description: 'Optional actor identifier.' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const uid = resolveItemUid(runtime.itemsStore, args.itemUid);
      const phase = String(args.phase ?? '').trim();
      const decision = String(args.decision ?? '').trim();
      if (!uid || !phase || !decision) return errOut('itemUid, phase, and decision are required.');
      const res = appendDecisionTsv(botHomeDir(runtime, caller.bot), uid, {
        actor: args.actor ? String(args.actor).trim() : `bot:${caller.bot.id}`,
        phase, decision, evidence: args.evidence ?? '', notes: args.notes ?? '',
      }, { botId: caller.bot.id });
      runtime.eventBus?.emit({ botIds: [caller.bot.id], kinds: ['items'] });
      return okOut(JSON.stringify({ ok: true, itemUid: uid, path: res.path, entry: res.entry }));
    }),

    makeTool('bot_work_list', 'List dispatched coding workers and their current status for this bot.', {
      openOnly: { type: 'boolean', description: 'Only return active workers (default false).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      return okOut(JSON.stringify(runtime.workStore.listWork({ botId: caller.bot.id, openOnly: args.openOnly === true })));
    }),

    makeTool('bot_work_forget', 'Clear the sticky worker binding for the current chat.', {
      source: { type: 'string', description: 'Conversation source (default app).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const res = runtime.workStore.forgetWork(caller.bot.id, args.source || 'app', caller.sessionId);
      runtime.eventBus.emit({ botIds: [caller.bot.id], kinds: ['workers'] });
      return okOut(JSON.stringify(res));
    }),

    makeTool('bot_suggest', 'Submit an Up Next suggestion during Look Around.', {
      title: { type: 'string', description: 'Short suggestion title (<=80 chars).', required: true },
      why: { type: 'string', description: 'Why this matters (<=400 chars).', required: true },
      ask: { type: 'string', description: 'Actionable prompt if owner starts it (<=2000 chars).', required: true },
      link: { type: 'string', description: 'Optional canonical URL.' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      return okOut(JSON.stringify(runtime.lookAroundService.addSuggestion(caller.bot.id, args, { runSessionId: caller.sessionId })));
    }),

    makeTool('bot_look_around_set', 'Update Look Around schedule or focus when explicitly requested by the owner.', {
      on: { type: 'boolean', description: 'Enable or disable Look Around.' },
      every: { type: 'string', description: 'every-4h | every-2h | twice-daily | mornings.' },
      weekdaysOnly: { type: 'boolean', description: 'Run Monday..Friday only.' },
      focus: { type: 'string', description: 'Focus guidance (<=500 chars).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      return okOut(JSON.stringify(runtime.lookAroundService.setConfig(caller.bot.id, args)));
    }),

    makeTool('bot_create_offer', 'Propose creating a new specialist bot as an owner-approved card.', {
      name: { type: 'string', description: 'Suggested bot name.', required: true },
      purpose: { type: 'string', description: 'One-line purpose.', required: true },
      watches: { type: 'string', description: 'What the bot monitors.' },
      does: { type: 'string', description: 'What the bot does.' },
      reports: { type: 'string', description: 'How/where the bot reports.' },
      templateId: { type: 'string', description: 'Optional template id.' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const offer = {
        offerId: crypto.randomUUID(), proposerBotId: caller.bot.id,
        name: String(args.name ?? '').trim(), purpose: String(args.purpose ?? '').trim(),
        watches: args.watches ?? null, does: args.does ?? null,
        reports: args.reports ?? null, templateId: args.templateId ?? null, createdAt: Date.now(),
      };
      return okOut(JSON.stringify({ kind: 'bot-create-offer', offer }));
    }),
  ];
}

/** @param {() => any} getRuntime @param {any} options */
function buildGuardedBotTools(getRuntime, options) {
  const confirmAction = options.confirmAction ?? confirmModelAction;
  /** @param {any} req @param {any} exec */
  const requireConfirm = async (req, exec) => {
    const decision = await confirmAction(req, exec?.signal, exec);
    return decision?.ok === true ? null : errOut(refusalTextFor(decision, exec?.signal));
  };
  /** @param {any} exec */
  const refuseNonOwnerIm = (exec) => (isNonOwnerImTurn(exec) ? errOut(NON_OWNER_IM_REFUSAL_TEXT) : null);

  return [
    makeTool('bot_work_start', 'Dispatch a coding worker (`dsh-bot-worker`) with optional Git worktree isolation and empirical verification.', {
      cwd: { type: 'string', description: 'Absolute path to target project repository.', required: true },
      prompt: { type: 'string', description: 'Task instructions for the coding worker.', required: true },
      itemUid: { type: 'string', description: 'Optional Work Item uid or #number to link and verify.' },
      title: { type: 'string', description: 'Optional worker title.' },
      doneMeans: { type: 'string', description: 'Acceptance criteria for the coding worker.' },
      verifyCmd: { type: 'string', description: 'Optional shell command to empirically verify worker output.' },
      useWorktree: { type: 'boolean', description: 'Isolate inside a detached Git worktree when cwd is a Git repo (default true).' },
      keepWorktree: { type: 'boolean', description: 'Keep the isolated worktree after completion (default false).' },
      awaitCompletion: { type: 'boolean', description: 'Wait for worker turn and verification before returning (default false).' },
    }, async (args, exec) => {
      const blocked = refuseNonOwnerIm(exec);
      if (blocked) return blocked;
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      return caller ? executeWorkStart(runtime, caller, args, options) : errOut('Caller bot context unavailable.');
    }),

    makeTool('bot_send', 'Send a handoff, question, or status message to another local bot.', {
      toBotId: { type: 'string', description: 'Target bot id or name.', required: true },
      purpose: { type: 'string', description: 'status | handoff | question.', required: true },
      text: { type: 'string', description: 'Message content.', required: true },
      rootKey: { type: 'string', description: 'Optional chain root key for cycle detection.' },
      depth: { type: 'number', description: 'Current nesting depth (default 1).' },
      sendKey: { type: 'string', description: 'Optional idempotency key.' },
      awaitReply: { type: 'boolean', description: 'Wait for the target bot turn outcome (default false).' },
    }, async (args, exec) => {
      const blocked = refuseNonOwnerIm(exec);
      if (blocked) return blocked;
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const target = runtime.botsStore.getBot(args.toBotId) ?? runtime.botsStore.getBotByName(args.toBotId);
      if (!target) return errOut(`Target bot not found: ${args.toBotId}`);
      const text = String(args.text ?? '').trim();
      if (!text) return errOut('text is required.');

      const reqRes = runtime.workStore.createRequest({
        rootKey: args.rootKey || `root-${caller.sessionId}`, fromBotId: caller.bot.id, toBotId: target.id,
        purpose: args.purpose, depth: Number.isInteger(args.depth) ? args.depth : 1,
        sendKey: args.sendKey ?? null, record: { text, fromName: caller.bot.name },
      });
      if (!reqRes.deduplicated) {
        const home = await runtime.sessionRuntime.openHomeChat(target.id);
        const msgText = `[From bot ${caller.bot.name} (${args.purpose})]\n${text}`;
        runtime.workStore.setRequestOutcome(reqRes.request.messageId, 'posted');
        const deliver = Promise.resolve()
          .then(() => runtime.sessionRuntime.runSingleTurn(home.sessionId, msgText))
          .then((turn) => {
            const ok = turn?.ok !== false;
            runtime.workStore.setRequestOutcome(reqRes.request.messageId, ok ? 'delivered' : 'failed');
            if (!ok) reportToolAsyncError(runtime, 'bot_send', turn?.error || 'turn-failed', { messageId: reqRes.request.messageId, toBotId: target.id });
            return { ok, reply: turn?.reply ?? '', error: ok ? null : (turn?.error || 'turn-failed') };
          }, (err) => {
            runtime.workStore.setRequestOutcome(reqRes.request.messageId, 'failed');
            reportToolAsyncError(runtime, 'bot_send', err, { messageId: reqRes.request.messageId, toBotId: target.id });
            return { ok: false, reply: '', error: String(err?.message ?? err) };
          });
        if (args.awaitReply === true) return okOut(JSON.stringify({ ...reqRes, delivery: await deliver }));
      }
      return okOut(JSON.stringify(reqRes));
    }),

    makeTool('bot_tools_manage', 'List, add, update, or remove per-bot MCP tool servers (mutations require desktop confirmation).', {
      action: { type: 'string', description: 'list | add | update | remove.', required: true },
      name: { type: 'string', description: 'Server name (for update/remove).' },
      server: {
        type: 'object', description: 'Server spec (for add/update).', additionalProperties: true,
        properties: { name: { type: 'string' }, transport: { type: 'string' }, url: { type: 'string' }, command: { type: 'string' } },
      },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const action = String(args.action ?? '').trim();
      if (action === 'list') return okOut(JSON.stringify(runtime.botsService.toolsList(caller.bot.id)));
      if (!['add', 'update', 'remove'].includes(action)) return errOut(`Unknown bot_tools_manage action: ${action}`);
      const refused = await requireConfirm({
        tool: 'bot_tools_manage', action, effect: action === 'remove' ? 'destructive' : 'code',
        summary: `${caller.bot.name} 请求执行 MCP 工具操作：${action} ${args.name ?? args.server?.name ?? ''}`,
        details: JSON.stringify(args.server ?? { name: args.name }).slice(0, 400),
      }, exec);
      if (refused) return refused;
      if (action === 'add') return okOut(JSON.stringify(runtime.botsService.toolsAdd(caller.bot.id, args.server)));
      if (action === 'update') return okOut(JSON.stringify(runtime.botsService.toolsUpdate(caller.bot.id, args.name, args.server)));
      return okOut(JSON.stringify(runtime.botsService.toolsRemove(caller.bot.id, args.name)));
    }, CONFIRM_TOOL_TIMEOUT_MS),

    makeTool('bot_automation_create', 'Create, update, or delete local scheduled automations or one-shot waits.', {
      action: { type: 'string', description: 'create | update | delete (default create).' },
      id: { type: 'string', description: 'Automation id (for update/delete).' },
      name: { type: 'string', description: 'Automation title.' },
      prompt: { type: 'string', description: 'Prompt executed when triggered.' },
      schedule: { type: 'string', description: 'Cron/RRule string.' },
      timezone: { type: 'string', description: 'IANA timezone (e.g. Asia/Shanghai).' },
      intervalMinutes: { type: 'number', description: 'Simple interval in minutes.' },
      once: { type: 'object', description: 'One-shot wait spec { by?: epochMs }.', additionalProperties: true, properties: { by: { type: 'number' } } },
      runsIn: { type: 'string', description: 'chat | new.' },
    }, async (args, exec) => {
      const blocked = refuseNonOwnerIm(exec);
      if (blocked) return blocked;
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const action = String(args.action || 'create').trim();
      if (action === 'delete') return okOut(JSON.stringify(runtime.automationsService.delete(args.id)));
      if (action === 'update') return okOut(JSON.stringify(runtime.automationsService.update(args.id, args)));
      if (action === 'create') return okOut(JSON.stringify(runtime.automationsService.create({ ...args, botId: caller.bot.id })));
      return errOut(`Invalid automation action: ${action}`);
    }),

    makeTool('bot_reply', 'Send a reply to the external connector or IM thread that woke this turn (requires desktop confirmation & WAL).', {
      text: { type: 'string', description: 'Reply text.', required: true },
      channel: { type: 'string', description: 'Optional external channel/thread identifier (or "pet").' },
      accountId: { type: 'string', description: 'Optional IM account identifier.' },
      chatId: { type: 'string', description: 'Optional IM chat/thread identifier.' },
      replyToMessageId: { type: 'string', description: 'Optional message id to reply to.' },
      idempotencyKey: { type: 'string', description: 'Optional WAL idempotency key.' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const text = String(args.text ?? '').trim();
      if (!text) return errOut('Reply text is required.');
      const refused = await requireConfirm({
        tool: 'bot_reply', action: 'reply', effect: 'external',
        summary: `${caller.bot.name} 请求向外部渠道发送回复`,
        details: text.slice(0, 400),
      }, exec);
      return refused ?? executeBotReply(runtime, caller, args, options);
    }, CONFIRM_TOOL_TIMEOUT_MS),

    makeTool('bot_new_chat', 'Start a new independent side chat session for this bot.', {
      title: { type: 'string', description: 'Title for the new side chat.' },
      prompt: { type: 'string', description: 'Optional initial prompt.' },
      awaitReply: { type: 'boolean', description: 'Wait for the initial prompt turn to settle (default false).' },
    }, async (args, exec) => {
      const blocked = refuseNonOwnerIm(exec);
      if (blocked) return blocked;
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const started = await runtime.sessionRuntime.startSideChat(caller.bot.id, { title: args.title });
      if (args.prompt) {
        const turnPromise = Promise.resolve()
          .then(() => runtime.sessionRuntime.runSingleTurn(started.sessionId, String(args.prompt)))
          .then((turn) => {
            if (turn?.ok === false) reportToolAsyncError(runtime, 'bot_new_chat', turn.error || 'turn-failed', { sessionId: started.sessionId });
            return turn;
          }, (err) => {
            reportToolAsyncError(runtime, 'bot_new_chat', err, { sessionId: started.sessionId });
            return { ok: false, error: String(err?.message ?? err), reply: '' };
          });
        if (args.awaitReply === true) return okOut(JSON.stringify({ sessionId: started.sessionId, chat: started.chat, turn: await turnPromise }));
      }
      return okOut(JSON.stringify({ sessionId: started.sessionId, chat: started.chat }));
    }),

    makeTool('bot_crew_adopt', 'Adopt, release, or list existing local sessions mapped as crew members for this bot.', {
      action: { type: 'string', description: 'adopt | release | list (default adopt).' },
      sessionId: { type: 'string', description: 'Target session id (required for adopt/release).' },
      workspaceId: { type: 'string', description: 'Optional workspace id.' },
      cwd: { type: 'string', description: 'Optional working directory.' },
      title: { type: 'string', description: 'Optional session title.' },
      role: { type: 'string', description: 'Optional crew role (default crew).' },
    }, async (args, exec) => {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (!caller) return errOut('Caller bot context unavailable.');
      const action = String(args.action || 'adopt').trim().toLowerCase();
      if (action === 'list') {
        return okOut(JSON.stringify({ action: 'list', adoptions: runtime.workStore.listCrewAdoptions({ botId: caller.bot.id, status: 'active' }) }));
      }
      const blocked = refuseNonOwnerIm(exec);
      if (blocked) return blocked;
      const sid = String(args.sessionId ?? '').trim();
      if (!sid) return errOut('sessionId is required for adopt/release.');
      if (action === 'adopt') {
        const adoption = runtime.workStore.adoptCrewSession({
          sessionId: sid, botId: caller.bot.id, workspaceId: args.workspaceId ?? null,
          cwd: args.cwd ?? null, title: args.title ?? null, role: args.role || 'crew',
        });
        runtime.eventBus?.emit({ botIds: [caller.bot.id], kinds: ['chats', 'workers'] });
        return okOut(JSON.stringify({ ok: true, action: 'adopt', adoption }));
      }
      if (action === 'release') {
        const existing = runtime.workStore.getCrewAdoption(sid);
        if (!existing) return errOut(`Crew adoption not found: ${sid}`);
        if (existing.botId !== caller.bot.id) return errOut('Cannot release a crew session owned by another bot.');
        const released = runtime.workStore.releaseCrewSession(sid);
        runtime.eventBus?.emit({ botIds: [caller.bot.id], kinds: ['chats', 'workers'] });
        return okOut(JSON.stringify({ ok: true, action: 'release', adoption: released }));
      }
      return errOut(`Invalid bot_crew_adopt action: ${action}`);
    }),
  ];
}

/**
 * Build all 25 native bot tool definitions with `read-only` permission enforcement.
 * @param {() => any} getRuntime
 * @param {{
 *   confirmAction?: typeof confirmModelAction,
 *   imOutboundBridge?: any,
 *   worktreeRunner?: any,
 *   toolWal?: any,
 *   execGit?: any,
 *   execCommand?: any,
 * }} [options]
 */
export function buildBotToolDefinitions(getRuntime = getActiveBotsRuntime, options = {}) {
  const allDefs = [
    ...buildBasicBotTools(getRuntime),
    ...buildBotItemTools(getRuntime, resolveCallerBot),
    ...buildGuardedBotTools(getRuntime, options),
  ];
  return allDefs.map((def) => ({
    ...def,
    /** @param {any} args @param {any} exec */
    async execute(args, exec) {
      const runtime = getRuntime();
      const caller = resolveCallerBot(runtime, exec);
      if (caller?.bot?.permissionMode === 'read-only' && !isReadOnlyAllowedCall(def.name, args)) {
        return errOut(READ_ONLY_REFUSAL_TEXT);
      }
      return def.execute(args, exec);
    },
  }));
}

/**
 * Register all 25 native `bot_*` tools on a Harness `ctx.tools` registry.
 * @param {any} ctx
 * @param {Record<string, any>} [options]
 */
export function registerBotTools(ctx, options = {}) {
  const wrap = typeof options.defineTool === 'function' ? options.defineTool : (/** @type {any} */ spec) => spec;
  const defs = buildBotToolDefinitions(options.getRuntime ?? getActiveBotsRuntime, options);
  /** @type {Array<() => void>} */
  const disposers = [];
  for (const def of defs) {
    const off = ctx?.tools?.register?.(wrap(def));
    if (typeof off === 'function') disposers.push(off);
  }
  return () => {
    for (const off of disposers) {
      try { off(); } catch { /* Best-effort tool unregister. */ }
    }
  };
}

/**
 * Register ONLY the worker-safe subset (`WORKER_ALLOWED_TOOLS`) on `ctx.tools`,
 * stripping orchestration, external reply, automation, and MCP-management tools.
 * @param {any} ctx
 * @param {Record<string, any>} [options]
 */
export function registerWorkerTools(ctx, options = {}) {
  const wrap = typeof options.defineTool === 'function' ? options.defineTool : (/** @type {any} */ spec) => spec;
  const defs = buildBotToolDefinitions(options.getRuntime ?? getActiveBotsRuntime, options)
    .filter((def) => WORKER_ALLOWED_SET.has(def.name));
  /** @type {Array<() => void>} */
  const disposers = [];
  for (const def of defs) {
    const off = ctx?.tools?.register?.(wrap(def));
    if (typeof off === 'function') disposers.push(off);
  }
  return () => {
    for (const off of disposers) {
      try { off(); } catch { /* Best-effort tool unregister. */ }
    }
  };
}
