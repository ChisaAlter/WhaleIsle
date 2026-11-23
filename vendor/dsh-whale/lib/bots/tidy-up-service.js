/**
 * Overnight & on-demand Memory Tidy-up service with off-peak scheduler and
 * reflection proposal generation (`BEGIN PROPOSAL ... END PROPOSAL`).
 *
 * Uses `resolveBotLaunchRoute` for unified model selection, executes a tool-free
 * LLM pass, commits via `memoryService.applyTidyUpResult`, and creates
 * `status='needs_you'` reflection proposal items when repeated corrections (>=2)
 * are detected — NEVER silently mutating `SOUL.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  botTidyUp,
  patchTidyUp,
  tidyUpWindowStart,
} from '../../src/shared/index.js';
import { isOffPeakNow } from './budget-service.js';
import { botMetaDir, botsRootDir, writeAtomicFile } from './fs-home.js';
import { resolveBotLaunchRoute } from './launch-route.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const TIDY_TIMEOUT_MS = 60_000;
const DEFAULT_SCHEDULER_INTERVAL_MS = 15 * 60_000;
const MIN_PROPOSAL_OCCURRENCES = 2;

/** @param {string} metaRoot */
const tidyStateFile = (metaRoot) => path.join(metaRoot, 'bot-tidy-up-state.json');

/** @param {string} file */
function loadTidyMap(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** @param {string} homeDir */
function readExistingTopicsSummary(homeDir) {
  const memDir = path.join(homeDir, 'memory');
  if (!fs.existsSync(memDir)) return '';
  const chunks = [];
  for (const name of fs.readdirSync(memDir).sort()) {
    if (!name.endsWith('.md') || name === 'archive.md') continue;
    const text = fs.readFileSync(path.join(memDir, name), 'utf8').slice(0, 4000);
    chunks.push(`### memory/${name}\n${text}`);
  }
  return chunks.join('\n\n');
}

/**
 * Parse raw `BEGIN PROPOSAL ... END PROPOSAL` blocks into structured reflection proposals.
 * @param {string[]} rawBlocks
 */
export function parseReflectionProposals(rawBlocks = []) {
  const results = [];
  for (const raw of Array.isArray(rawBlocks) ? rawBlocks : []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const lines = text.split(/\r?\n/u);
    let title = '';
    let occurrences = 0;
    let suggestedRule = '';
    const evidence = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const titleMatch = /^(?:title|标题)\s*[:：]\s*(.+)$/iu.exec(trimmed);
      if (titleMatch) { title = titleMatch[1].trim(); continue; }
      const occMatch = /^(?:occurrences|count|重复次数|次数)\s*[:：]\s*(\d+)/iu.exec(trimmed);
      if (occMatch) { occurrences = Number(occMatch[1]); continue; }
      const ruleMatch = /^(?:rule|suggested[_ ]?rule|proposal|建议规则|建议)\s*[:：]\s*(.+)$/iu.exec(trimmed);
      if (ruleMatch) { suggestedRule = ruleMatch[1].trim(); continue; }
      const evMatch = /^(?:evidence|证据|[-*])\s*[:：]?\s*(.+)$/iu.exec(trimmed);
      if (evMatch && evMatch[1].trim()) evidence.push(evMatch[1].trim());
    }

    if (occurrences === 0 && evidence.length >= MIN_PROPOSAL_OCCURRENCES) {
      occurrences = evidence.length;
    }
    if (!title) {
      title = (lines.find((l) => l.trim().length > 0) || 'SOUL.md 规则优化提案').replace(/^[-*#\s]+/u, '').slice(0, 120);
    }
    results.push({
      title,
      occurrences,
      suggestedRule: suggestedRule || text,
      evidence,
      raw: text,
    });
  }
  return results;
}

/**
 * Build the tidy-up prompt, including optional `BEGIN PROPOSAL ... END PROPOSAL`
 * instructions for repeated owner corrections (>= 2).
 * @param {any} bot
 * @param {string} memoryText
 * @param {string} topicsText
 */
export function buildTidyPrompt(bot, memoryText, topicsText = '') {
  return [
    `You are tidying long-term memory for bot "${bot.name}".`,
    'Rules:',
    '- Keep MEMORY.md <= 200 lines.',
    '- Remove at most 20% of existing facts and archive at most 20 lines.',
    '- Never invent facts in topic files that are not already in MEMORY.md.',
    '- NEVER rewrite SOUL.md directly. If you spot a repeated owner correction occurring >= 2 times, emit an optional reflection proposal block for owner approval.',
    '- Wrap output strictly in blocks:',
    'BEGIN MEMORY.md',
    '...',
    'END MEMORY.md',
    'Optional topic blocks: BEGIN memory/<topic-slug>.md ... END memory/<topic-slug>.md',
    'Optional replaced block: BEGIN REPLACED ... END REPLACED',
    'Optional reflection proposal (ONLY when repeated corrections >= 2):',
    'BEGIN PROPOSAL',
    'Title: <short proposal title>',
    'Occurrences: <integer >= 2>',
    'Suggested Rule: <proposed SOUL.md rule change>',
    '- <evidence 1>',
    '- <evidence 2>',
    'END PROPOSAL',
    '',
    'Current MEMORY.md:',
    '<<<<<',
    memoryText,
    '>>>>>',
    ...(topicsText ? ['', 'Existing topic files:', '<<<<<', topicsText, '>>>>>'] : []),
  ].join('\n');
}

/** @param {any} chunk */
function extractStreamChunkText(chunk) {
  if (typeof chunk?.delta === 'string') return chunk.delta;
  if (typeof chunk?.text === 'string') return chunk.text;
  return '';
}

/** @param {any} ctx @param {string} prompt @param {any} route */
async function callModelForTidyUp(ctx, prompt, route) {
  const llm = ctx?.get?.('llm');
  if (typeof llm?.stream !== 'function' || !route?.provider || !route?.model) return null;
  let llmPkg = null;
  try {
    llmPkg = await import('@deepseek-ai/dsh-llm');
  } catch {
    llmPkg = null;
  }
  const userMsg = llmPkg?.createUserMessage
    ? llmPkg.createUserMessage({ source: { kind: 'dsh-bots:tidy-up' }, content: [{ type: 'text', text: prompt }] })
    : { role: 'user', content: [{ type: 'text', text: prompt }] };
  const assembler = llmPkg?.BlockAssembler ? new llmPkg.BlockAssembler() : null;
  const fallbackTexts = [];
  /** @type {Record<string, any>} */
  const req = {
    provider: route.provider,
    model: route.model,
    messages: [userMsg],
    system: 'Output only the requested BEGIN/END blocks without commentary.',
    maxTokens: 4096,
    purpose: 'bot-tidy-up',
    signal: AbortSignal.timeout(TIDY_TIMEOUT_MS),
  };
  if (route.reasoningEffort) req.reasoningEffort = route.reasoningEffort;

  for await (const chunk of llm.stream(req)) {
    if (assembler) assembler.push(chunk);
    else {
      const piece = extractStreamChunkText(chunk);
      if (piece) fallbackTexts.push(piece);
    }
  }
  if (!assembler) return fallbackTexts.join('').trim();
  return assembler.blocks().filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

/** @param {any} itemsStore @param {any} bot @param {any[]} proposals @param {number} now */
function createProposalItems(itemsStore, bot, proposals, now) {
  if (!itemsStore || typeof itemsStore.add !== 'function') return [];
  const qualifying = proposals.filter((p) => p.occurrences >= MIN_PROPOSAL_OCCURRENCES);
  if (qualifying.length === 0) return [];
  const openNeeds = itemsStore.needsYou?.({ ownerBotId: bot.id, now, includeSnoozed: true }) ?? [];
  const created = [];
  for (const prop of qualifying) {
    const title = `反思提案：${prop.title}`.slice(0, 140);
    if (openNeeds.some((/** @type {any} */ item) => item.title === title)) continue;
    const evidenceText = prop.evidence.length > 0
      ? `\n\n重复纠错证据（${prop.occurrences} 次）：\n${prop.evidence.map((/** @type {any} */ e) => `- ${e}`).join('\n')}`
      : '';
    const res = itemsStore.add({
      ownerBotId: bot.id,
      chatId: bot.chatSessionId || `bot-tidy:${bot.id}`,
      source: { kind: 'automation', title: 'memory-tidy-up' },
      title,
      description: `建议写入 SOUL.md 的规则（绝不自动改写，需你拍板）：\n${prop.suggestedRule}${evidenceText}`,
      status: 'needs_you',
      ask: {
        context: `记忆整理检测到 ${prop.occurrences} 次重复纠错，建议将其沉淀为 SOUL.md 长期规则。`,
        questions: [{
          prompt: `是否采纳提案「${prop.title}」并更新 SOUL.md？`,
          options: [
            { label: '采纳并更新 SOUL.md' },
            { label: '暂不修改 SOUL.md' },
            { label: '忽略此类建议' },
          ],
          recommended: 0,
          multi: false,
        }],
      },
    }, { kind: 'orca', why: 'tidy_up_reflection' }, now);
    if (res?.item) created.push(res.item);
  }
  return created;
}

/**
 * Create the Memory Tidy-up service.
 * @param {{
 *   ctx: any,
 *   dshHome: string,
 *   botsStore: any,
 *   memoryService: any,
 *   sessionRuntime: any,
 *   eventBus: any,
 *   itemsStore?: any,
 *   budgetService?: any,
 *   enableScheduler?: boolean,
 *   schedulerIntervalMs?: number,
 *   now?: () => number,
 *   runModel?: (bot: any, prompt: string, route?: any) => Promise<string | null>,
 * }} deps
 */
export function createTidyUpService(deps) {
  const { ctx, dshHome, botsStore, memoryService, sessionRuntime, eventBus, itemsStore = null, budgetService = null } = deps;
  const nowFn = deps.now ?? (() => Date.now());
  const stateFile = tidyStateFile(botMetaDir(dshHome));
  /** @type {ReturnType<typeof setInterval> | null} */
  let schedulerTimer = null;
  let ticking = false;

  function readState(botId) {
    return loadTidyMap(stateFile)[botId] ?? {
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      lastChangeId: null,
      lastChangesCount: 0,
      consecutiveFailures: 0,
      turnedOff: false,
    };
  }

  function writeState(botId, next) {
    const all = loadTidyMap(stateFile);
    all[botId] = next;
    writeAtomicFile(stateFile, `${JSON.stringify(all, null, 2)}\n`);
    return next;
  }

  function getStatus(botId, now = nowFn()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const cfg = botTidyUp(bot);
    const state = readState(bot.id);
    const stepMs = (cfg.every === 'week' ? 7 : 1) * 24 * 60 * 60 * 1000;
    const baseWindow = state.lastRunAt ? state.lastRunAt : tidyUpWindowStart(now);
    const nextRunAt = bot.paused || !cfg.on ? null : baseWindow + stepMs;
    return {
      botId: bot.id,
      config: cfg,
      nextRunAt,
      schedulerRunning: Boolean(schedulerTimer),
      ...state,
    };
  }

  function recordFailure(bot, state, errorMessage, now) {
    const consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
    const turnedOff = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    if (turnedOff) {
      const nextCfg = patchTidyUp(botTidyUp(bot), { on: false }, now);
      botsStore.updateBot(bot.id, { tidyUp: nextCfg }, now);
    }
    writeState(bot.id, {
      ...state,
      lastRunAt: now,
      lastStatus: 'failed',
      lastError: errorMessage,
      consecutiveFailures,
      turnedOff,
    });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
  }

  async function resolveRoute(bot) {
    const direct = resolveBotLaunchRoute(bot?.launch, null);
    if (direct) return direct;
    const catalog = await sessionRuntime.listModels();
    return resolveBotLaunchRoute(bot?.launch, catalog?.default ?? null);
  }

  async function runNow(botId, now = nowFn()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    const snap = memoryService.snapshotMemory(homeDir, now);
    const state = readState(bot.id);
    const prompt = buildTidyPrompt(bot, snap.text, readExistingTopicsSummary(homeDir));

    try {
      const route = await resolveRoute(bot);
      const rawOutput = typeof deps.runModel === 'function'
        ? await deps.runModel(bot, prompt, route)
        : await callModelForTidyUp(ctx, prompt, route);
      if (!rawOutput) {
        const msg = 'Model unavailable or returned empty tidy-up draft';
        recordFailure(bot, state, msg, now);
        return { ok: false, error: msg, turnedOff: state.consecutiveFailures + 1 >= MAX_CONSECUTIVE_FAILURES };
      }
      const applied = memoryService.applyTidyUpResult({
        botId: bot.id,
        homeDir,
        beforeSnapshot: snap,
        rawOutput,
        at: now,
      });
      const proposals = parseReflectionProposals(applied.proposals ?? []);
      const proposalItems = createProposalItems(itemsStore, bot, proposals, now);
      const changesCount = applied.added.length + applied.removed.length + applied.topicsWritten.length;
      writeState(bot.id, {
        lastRunAt: now,
        lastStatus: 'ok',
        lastError: null,
        lastChangeId: applied.changeId,
        lastChangesCount: changesCount,
        consecutiveFailures: 0,
        turnedOff: false,
      });
      eventBus.emit({ botIds: [bot.id], kinds: proposalItems.length > 0 ? ['bot', 'items'] : ['bot'] });
      return { ok: true, ...applied, changesCount, route, proposals, proposalItems };
    } catch (error) {
      const msg = String(error?.message ?? error);
      recordFailure(bot, state, msg, now);
      return { ok: false, error: msg, code: error?.code ?? 'tidy_up_failed' };
    }
  }

  async function tickScheduler(now = nowFn()) {
    if (ticking) return { skipped: true, reason: 'already_ticking', ran: [] };
    const offPeak = typeof budgetService?.isOffPeakNow === 'function'
      ? budgetService.isOffPeakNow(now)
      : isOffPeakNow(now);
    if (!offPeak) {
      return { skipped: true, reason: 'peak_window', ran: [] };
    }
    ticking = true;
    const ran = [];
    const deferred = [];
    try {
      for (const bot of botsStore.listBots()) {
        const cfg = botTidyUp(bot);
        if (bot.paused || !cfg.on) continue;
        const state = readState(bot.id);
        const stepMs = (cfg.every === 'week' ? 7 : 1) * 24 * 60 * 60 * 1000;
        const dueAt = state.lastRunAt ? state.lastRunAt + stepMs : tidyUpWindowStart(now);
        if (now < dueAt) continue;
        if (typeof budgetService?.checkExecutionAllowed === 'function') {
          const guard = budgetService.checkExecutionAllowed(bot.id, { isBackground: true, at: now });
          if (!guard.allowed) {
            deferred.push({ botId: bot.id, reason: guard.reason, deferUntilMs: guard.deferUntilMs });
            continue;
          }
        }
        const res = await runNow(bot.id, now);
        ran.push({ botId: bot.id, ok: res.ok });
      }
      return { skipped: false, ran, deferred };
    } finally {
      ticking = false;
    }
  }

  function startScheduler(intervalMs = deps.schedulerIntervalMs ?? DEFAULT_SCHEDULER_INTERVAL_MS) {
    if (schedulerTimer) return { running: true };
    const safeMs = Math.max(1000, Number(intervalMs) || DEFAULT_SCHEDULER_INTERVAL_MS);
    schedulerTimer = setInterval(() => {
      void tickScheduler().catch((err) => {
        console.warn('[dsh-bots] tidy-up scheduler tick failed:', err?.message ?? err);
      });
    }, safeMs);
    schedulerTimer.unref?.();
    return { running: true, intervalMs: safeMs };
  }

  function stopScheduler() {
    if (schedulerTimer) {
      clearInterval(schedulerTimer);
      schedulerTimer = null;
    }
    return { running: false };
  }

  function undoLast(botId, changeId = null, now = nowFn()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const state = readState(bot.id);
    const targetId = changeId || state.lastChangeId;
    if (!targetId) {
      throw Object.assign(new Error('No tidy-up change available to undo'), { code: 'not_found' });
    }
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    const result = memoryService.undoChange({ botId: bot.id, homeDir, changeId: targetId, at: now });
    eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
    return result;
  }

  if (deps.enableScheduler === true) {
    startScheduler();
  }

  return {
    getStatus,
    runNow,
    undoLast,
    resolveRoute,
    startScheduler,
    stopScheduler,
    tickScheduler,
    close: stopScheduler,
  };
}
