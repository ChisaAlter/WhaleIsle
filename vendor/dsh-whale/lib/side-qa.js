/**
 * `/side` side-question handler for Big Fish mode:
 * - Reads bounded recent context via read-only `sessionProjections` / snapshot
 *   (NEVER appends any event to the main Session log).
 * - Invokes `ctx.llm.stream` directly with ZERO tools so side questions stay
 *   fast, read-only, and completely non-polluting.
 * - Respects the irreversible guest/group taint boundary (never injects owner
 *   memory for tainted sessions).
 */
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildPersonaText } from './persona.js';
import { readPushIndex } from './memory-store.js';
import { isSessionTainted } from './call-origin.js';
import {
  SYSTEM_REMINDER_RE,
  controllerFrom,
  eventText,
  sessionSnapshot,
  trimTo,
} from './shared.js';

const SIDE_MAX_QUESTION_CHARS = 2000;
const SIDE_MAX_TOKENS = 1536;
const SIDE_TIMEOUT_MS = 45_000;
const SIDE_CONTEXT_TURNS = 12;
const SIDE_LINE_MAX = 400;

/**
 * Extract compact recent context lines without mutating the session.
 * @param {any[]} events
 */
function summarizeRecentContext(events) {
  const lines = [];
  for (const raw of events ?? []) {
    const ev = raw?.event ?? raw;
    if (!ev || (ev.type !== 'user/message' && ev.type !== 'assistant/message')) continue;
    const text = eventText(ev).replace(SYSTEM_REMINDER_RE, '').trim();
    if (!text) continue;
    const role = ev.type === 'user/message' ? '用户' : '助理';
    lines.push(`${role}: ${trimTo(text, SIDE_LINE_MAX)}`);
  }
  return lines.slice(-SIDE_CONTEXT_TURNS).join('\n');
}

/**
 * Resolve model route from live session projection, settings, or host catalog.
 * @param {any} ctx
 * @param {any} settings
 * @param {any} session
 * @param {any} snapshot
 */
function formatModelPick(pick) {
  if (!pick?.provider || !pick?.model) return null;
  return {
    provider: String(pick.provider),
    model: String(pick.model),
    ...(pick.reasoningEffort ? { reasoningEffort: String(pick.reasoningEffort) } : {}),
  };
}

function modelFromProjection(ctx, session) {
  const projections = ctx.get?.('sessionProjections');
  if (!session || typeof projections?.stateOf !== 'function') return null;
  try {
    const sel = projections.stateOf(session, 'modelSelection');
    return formatModelPick(sel?.next ?? sel?.lastUsed);
  } catch {
    return null;
  }
}

async function resolveSideModel(ctx, settings, session, snapshot) {
  const fromLive = modelFromProjection(ctx, session);
  if (fromLive) return fromLive;
  const snapSel = snapshot?.projections?.values?.modelSelection;
  const fromSnap = formatModelPick(snapSel?.next ?? snapSel?.lastUsed);
  if (fromSnap) return fromSnap;
  const fromSettings = formatModelPick({
    provider: settings?.modelProvider,
    model: settings?.modelModel,
    reasoningEffort: settings?.modelReasoningEffort,
  });
  if (fromSettings) return fromSettings;
  const catalog = await controllerFrom(ctx)?.modelCatalog?.().catch(() => null);
  return formatModelPick(catalog?.default);
}

async function readSideContext(ctx, targetSessionId) {
  const liveAgent = targetSessionId
    ? (ctx.get?.('agents')?.get?.(targetSessionId) ?? ctx.agents?.get?.(targetSessionId) ?? null)
    : null;
  if (liveAgent?.session && typeof liveAgent.session.snapshotEvents === 'function') {
    return { liveAgent, events: liveAgent.session.snapshotEvents(), snapshot: null };
  }
  if (!targetSessionId) return { liveAgent, events: [], snapshot: null };
  const controller = controllerFrom(ctx);
  if (typeof controller?.follow !== 'function') return { liveAgent, events: [], snapshot: null };
  const snapshot = await sessionSnapshot(controller, targetSessionId, 24).catch(() => null);
  return { liveAgent, events: snapshot?.records ?? [], snapshot };
}

function buildSideRequest({ route, settings, events, tainted, home, question, signal }) {
  const recentContext = summarizeRecentContext(events);
  const memoryIndex = !tainted && home ? readPushIndex(home) : '';
  const systemParts = [
    buildPersonaText(settings),
    '这是大肥鱼模式的 `/side` 旁路快问：你处于只读无工具模式，不会修改文件、不会调用任何工具，也不会把本条问答写入主会话日志。请直接、简洁、准确地回答用户问题。',
    ...(memoryIndex.trim() ? [`长期记忆索引：\n${memoryIndex}`] : []),
  ];
  const userBody = recentContext
    ? `【主会话近期只读上下文】\n${recentContext}\n\n【旁路提问】\n${question}`
    : question;
  const signals = [AbortSignal.timeout(SIDE_TIMEOUT_MS)];
  if (signal) signals.push(signal);
  return {
    provider: route.provider,
    model: route.model,
    ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}),
    messages: [createUserMessage({
      source: { kind: 'dsh-whale:side-qa' },
      content: [{ type: 'text', text: userBody }],
    })],
    system: systemParts.join('\n\n'),
    tools: [],
    maxTokens: SIDE_MAX_TOKENS,
    purpose: 'whale-side-qa',
    signal: typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0],
  };
}

function finalizeSideStream(assembler, route, targetSessionId) {
  if (assembler.finish && !['stop', 'max-tokens'].includes(assembler.finish.kind)) {
    const failure = assembler.finish.failure ?? {};
    return {
      ok: false,
      error: 'model-error',
      detail: trimTo(String(failure.message || failure.code || assembler.finish.kind), 240),
    };
  }
  const answer = assembler.blocks()
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!answer) return { ok: false, error: 'empty-reply', detail: '模型返回了空内容。' };
  return {
    ok: true,
    answer: trimTo(answer, 6000),
    model: `${route.provider}/${route.model}`,
    sessionId: targetSessionId,
    nonPolluting: true,
  };
}

function validateSideQuestion(input, ctx) {
  const question = String(input?.question ?? '').trim();
  if (!question) return { error: { ok: false, error: 'empty-question', detail: '请输入要旁路提问的问题。' } };
  if (question.length > SIDE_MAX_QUESTION_CHARS) {
    return { error: { ok: false, error: 'question-too-long', detail: `旁路提问最多 ${SIDE_MAX_QUESTION_CHARS} 字。` } };
  }
  const llm = ctx.get?.('llm') ?? ctx.llm;
  if (typeof llm?.stream !== 'function') {
    return { error: { ok: false, error: 'llm-unavailable', detail: '模型流服务不可用。' } };
  }
  return { question, llm };
}

/**
 * Execute a read-only, tool-free `/side` question against recent session context.
 * Guaranteed NEVER to append to or mutate the target Session log.
 *
 * @param {any} ctx
 * @param {any} scope
 * @param {{ question: string, sessionId?: string, home?: string, signal?: AbortSignal }} input
 */
export async function askSideQuestion(ctx, scope, input) {
  const checked = validateSideQuestion(input, ctx);
  if (checked.error) return checked.error;
  const settings = scope?.get?.() ?? {};
  const targetSessionId = String(input?.sessionId || settings.sessionId || '').trim();
  const { liveAgent, events, snapshot } = await readSideContext(ctx, targetSessionId);
  const liveSession = liveAgent ? liveAgent.session : null;
  const route = await resolveSideModel(ctx, settings, liveSession, snapshot);
  if (!route) return { ok: false, error: 'no-model', detail: '没有可用模型，请先选择默认模型。' };

  const tainted = isSessionTainted(liveSession ?? events.map((r) => (r && r.event) || r));
  const req = buildSideRequest({
    route,
    settings,
    events,
    tainted,
    home: input?.home ?? process.env.DSH_HOME ?? '',
    question: checked.question,
    signal: input?.signal,
  });
  const assembler = new BlockAssembler();
  try {
    for await (const chunk of checked.llm.stream(req)) assembler.push(chunk);
  } catch (/** @type {any} */ error) {
    return { ok: false, error: 'model-error', detail: trimTo(String(error instanceof Error ? error.message : error), 240) };
  }
  return finalizeSideStream(assembler, route, targetSessionId);
}
