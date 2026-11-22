/**
 * Overnight & on-demand Memory Tidy-up service.
 * Executes a tool-free LLM pass producing `BEGIN MEMORY.md` /
 * `BEGIN memory/<topic>.md` / `BEGIN REPLACED` blocks and commits via
 * `memoryService.applyTidyUpResult` with strict concurrency & ratio guards.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  botTidyUp,
  patchTidyUp,
  tidyUpWindowStart,
} from '../../src/shared/index.js';
import { botMetaDir, botsRootDir, writeAtomicFile } from './fs-home.js';

const MAX_CONSECUTIVE_FAILURES = 3;
const TIDY_TIMEOUT_MS = 60_000;

/** @param {string} metaRoot */
function tidyStateFile(metaRoot) {
  return path.join(metaRoot, 'bot-tidy-up-state.json');
}

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

/** @param {any} bot @param {string} memoryText @param {string} topicsText */
function buildTidyPrompt(bot, memoryText, topicsText) {
  return [
    `You are tidying long-term memory for bot "${bot.name}".`,
    'Rules:',
    '- Keep MEMORY.md <= 200 lines.',
    '- Remove at most 20% of existing facts and archive at most 20 lines.',
    '- Never invent facts in topic files that are not already in MEMORY.md.',
    '- Wrap output strictly in blocks:',
    'BEGIN MEMORY.md',
    '...',
    'END MEMORY.md',
    'Optional topic blocks: BEGIN memory/<topic-slug>.md ... END memory/<topic-slug>.md',
    'Optional replaced block: BEGIN REPLACED ... END REPLACED',
    '',
    'Current MEMORY.md:',
    '<<<<<',
    memoryText,
    '>>>>>',
    ...(topicsText ? ['', 'Existing topic files:', '<<<<<', topicsText, '>>>>>'] : []),
  ].join('\n');
}

/** @param {any} ctx @param {string} prompt @param {any} route */
async function callModelForTidyUp(ctx, prompt, route) {
  const llm = ctx?.get?.('llm');
  if (typeof llm?.stream !== 'function' || !route?.provider || !route?.model) {
    return null;
  }
  const llmPkg = await import('@deepseek-ai/dsh-llm').catch(() => null);
  const userMsg = llmPkg?.createUserMessage
    ? llmPkg.createUserMessage({
      source: { kind: 'dsh-bots:tidy-up' },
      content: [{ type: 'text', text: prompt }],
    })
    : { role: 'user', content: [{ type: 'text', text: prompt }] };
  const assembler = llmPkg?.BlockAssembler ? new llmPkg.BlockAssembler() : null;
  const fallbackTexts = [];
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    messages: [userMsg],
    system: 'Output only the requested BEGIN/END blocks without commentary.',
    maxTokens: 4096,
    purpose: 'bot-tidy-up',
    signal: AbortSignal.timeout(TIDY_TIMEOUT_MS),
  })) {
    if (assembler) assembler.push(chunk);
    else if (typeof chunk?.delta === 'string') fallbackTexts.push(chunk.delta);
    else if (typeof chunk?.text === 'string') fallbackTexts.push(chunk.text);
  }
  if (!assembler) return fallbackTexts.join('').trim();
  return assembler.blocks()
    .filter((b) => b?.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
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
 *   runModel?: (bot: any, prompt: string) => Promise<string | null>,
 * }} deps
 */
export function createTidyUpService(deps) {
  const { ctx, dshHome, botsStore, memoryService, sessionRuntime, eventBus } = deps;
  const stateFile = tidyStateFile(botMetaDir(dshHome));

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

  function getStatus(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const cfg = botTidyUp(bot);
    const state = readState(bot.id);
    const stepMs = (cfg.every === 'week' ? 7 : 1) * 24 * 60 * 60 * 1000;
    const nextRunAt = bot.paused || !cfg.on ? null : tidyUpWindowStart(now) + stepMs;
    return {
      botId: bot.id,
      config: cfg,
      nextRunAt,
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
    const rawModel = String(bot?.launch?.model ?? '').trim();
    const optProvider = String(bot?.launch?.options?.provider ?? '').trim();
    if (optProvider && rawModel) {
      return { provider: optProvider, model: rawModel.includes('/') ? rawModel.split('/').slice(1).join('/') : rawModel };
    }
    if (rawModel.includes('/')) {
      const idx = rawModel.indexOf('/');
      return { provider: rawModel.slice(0, idx), model: rawModel.slice(idx + 1) };
    }
    const catalog = await sessionRuntime.listModels();
    return catalog?.default ?? null;
  }

  async function runNow(botId, now = Date.now()) {
    const bot = botsStore.getBot(botId);
    if (!bot) throw Object.assign(new Error(`Bot not found: ${botId}`), { code: 'bot_not_found' });
    const homeDir = path.join(botsRootDir(dshHome), bot.folder);
    const snap = memoryService.snapshotMemory(homeDir, now);
    const state = readState(bot.id);
    const prompt = buildTidyPrompt(bot, snap.text, readExistingTopicsSummary(homeDir));

    let rawOutput = null;
    try {
      if (typeof deps.runModel === 'function') {
        rawOutput = await deps.runModel(bot, prompt);
      } else {
        const route = await resolveRoute(bot);
        rawOutput = await callModelForTidyUp(ctx, prompt, route);
      }
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
      eventBus.emit({ botIds: [bot.id], kinds: ['bot'] });
      return { ok: true, ...applied, changesCount };
    } catch (error) {
      const msg = String(error?.message ?? error);
      recordFailure(bot, state, msg, now);
      return { ok: false, error: msg, code: error?.code ?? 'tidy_up_failed' };
    }
  }

  function undoLast(botId, changeId = null, now = Date.now()) {
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

  return {
    getStatus,
    runNow,
    undoLast,
  };
}
