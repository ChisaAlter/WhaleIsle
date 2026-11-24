/**
 * `dsh-whale/tools` — preset-scoped tool plugin mounted by the whale-girl
 * agent.cordis.yml row. Everything registers into this preset's tools
 * layer: only sessions on the whale-girl preset see whale_* tools, and no
 * global tool visibility changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { whaleHomeDir, appendPetOutbox } from './preset.js';
import { createWhaleScope } from './scope.js';
import { controllerFrom, genericOutput, rowSummary, sessionRowsFrom } from './shared.js';
import {
  ABORTED_TEXT,
  CONFIRM_TOOL_TIMEOUT_MS,
  confirmModelAction,
  refusalTextFor,
} from './desktop-confirm.js';
import { validateTaskCwd } from './task-paths.js';
import { TAINTED_SESSION_REFUSAL_TEXT, isSessionTainted } from './call-origin.js';
import { registerSessionTools } from './session-tools.js';
import { registerDesktopTools } from './desktop-tools.js';
import { registerStickerTools } from './sticker-tools.js';
import { registerProfileTools } from './profile-tools.js';
import { registerTaskTools } from './task-tools.js';
import { registerProjectBridgeTools } from './project-bridge-tools.js';
import { registerMemoryTools } from './memory-tools.js';
import { registerDiscoveryTools } from './discovery-tools.js';
import { registerBotTools } from './bots/bot-tools-registry.js';

export const name = 'dsh-whale-tools';
export const inject = ['tools', 'agents'];

export const Config = z.object({});

const WAKE_SOURCE = Object.freeze({ kind: 'dsh-whale:relay', form: 'relay' });
const SEND_MAX_CHARS = 4000;
const FORBIDDEN_PRESETS = new Set(['whale-girl', 'whale-task-reader', 'project-worker', 'project-coordinator']);

/** @param {string} value */
const pathKey = (value) => {
  try {
    const real = fs.realpathSync.native(path.resolve(value));
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
};

/**
 * @param {any} ctx
 * @param {string} presetId
 */
async function isHiddenPreset(ctx, presetId) {
  if (!presetId) return false;
  if (FORBIDDEN_PRESETS.has(presetId)) return true;
  const presets = ctx.get?.('agentPresets');
  if (!presets) return false;
  const direct = typeof presets.get === 'function' ? await presets.get(presetId) : undefined;
  if (direct?.hidden === true) return true;
  if (typeof presets.list === 'function') {
    const raw = await presets.list();
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.presets) ? raw.presets : []);
    const found = rows.find((/** @type {any} */ entry) => entry?.id === presetId);
    if (found?.hidden === true) return true;
  }
  return false;
}

const INTERNAL_OWNER_PREFIXES = ['dsh-whale:task', 'project:', 'dsh-project:'];
const INTERNAL_OWNERS = new Set(['dsh-whale:assistant', 'project']);

function isInternalPresentationOwner(owner) {
  return INTERNAL_OWNERS.has(owner) || INTERNAL_OWNER_PREFIXES.some((prefix) => owner.startsWith(prefix));
}

function presentationOwnerFromEvents(owner, events) {
  const direct = String(owner ?? '');
  if (direct || !Array.isArray(events) || !events.length) return direct;
  const pres = events.findLast((/** @type {any} */ ev) => ev?.type === 'session/presentation')?.data;
  return String(pres?.owner ?? '');
}

/**
 * Check internal-worker restrictions using read-only header + presentation
 * metadata so dormant ordinary sessions are NEVER hydrated before confirmation.
 * @param {any} ctx
 * @param {{ header?: any, owner?: string, events?: any[] }} meta
 */
async function internalWorkerReasonFromMeta(ctx, { header = {}, owner = '', events = [] }) {
  if (header?.origin === 'subagent') return 'Cannot relay messages directly to an internal subagent session.';
  const preset = String(header?.agentPreset ?? '');
  if (preset && await isHiddenPreset(ctx, preset)) {
    return `Cannot relay messages to internal worker preset "${preset}".`;
  }
  const resolvedOwner = presentationOwnerFromEvents(owner, events);
  if (isInternalPresentationOwner(resolvedOwner)) {
    return `Cannot relay messages to internal session owned by "${resolvedOwner}".`;
  }
  return '';
}

/**
 * @param {any} ctx
 * @param {any} agent
 */
async function internalWorkerReason(ctx, agent) {
  const header = agent?.session?.header ?? {};
  const events = typeof agent?.session?.snapshotEvents === 'function' ? agent.session.snapshotEvents() : [];
  return internalWorkerReasonFromMeta(ctx, { header, events });
}

/** @param {any} s */
function formatSessionRow(s) {
  const updated = s.updatedAt ? new Date(s.updatedAt).toISOString() : '-';
  const parts = [
    `${s.title || '(untitled)'} [${s.sessionId}]`,
    `status=${s.status || 'idle'}`,
    `owner=${s.owner || 'user'}`,
    `cwd=${s.cwd || '-'}`,
    `updated=${updated}`,
  ];
  return `- ${parts.join(' | ')}`;
}

/**
 * @param {any} registry
 * @param {string} workspaceId
 * @param {string} dshHome
 */
function resolveWorkspaceById(registry, workspaceId, dshHome) {
  const workspace = typeof registry?.get === 'function' ? registry.get(workspaceId) : undefined;
  if (registry && !workspace) return { error: `Workspace not found: ${workspaceId}` };
  const wsPath = workspace?.path;
  if (wsPath) {
    try { validateTaskCwd(wsPath, { dshHome, requireExisting: true }); }
    catch (/** @type {any} */ error) { return { error: String(error?.message ?? error) }; }
  }
  return { request: { workspaceId }, displayTarget: wsPath ? `${workspaceId} (${wsPath})` : workspaceId };
}

/**
 * @param {any} registry
 * @param {string} rawCwd
 * @param {string} dshHome
 */
function resolveWorkspaceByCwd(registry, rawCwd, dshHome) {
  let safeCwd;
  try { safeCwd = validateTaskCwd(rawCwd, { dshHome, requireExisting: true }); }
  catch (/** @type {any} */ error) { return { error: String(error?.message ?? error) }; }
  if (typeof registry?.list === 'function') {
    const key = pathKey(safeCwd);
    const matched = registry.list().find((/** @type {any} */ ws) => ws?.path && pathKey(ws.path) === key);
    if (matched?.id) return { request: { workspaceId: matched.id }, displayTarget: safeCwd };
  }
  return { request: { cwd: safeCwd }, displayTarget: safeCwd };
}

/**
 * @param {any} ctx
 * @param {any} args
 */
function resolveWorkspaceCreateRequest(ctx, args) {
  const rawCwd = String(args.cwd ?? '').trim();
  const workspaceId = String(args.workspaceId ?? '').trim();
  if (rawCwd && workspaceId) return { error: 'Provide either cwd or workspaceId, not both.' };
  if (!rawCwd && !workspaceId) return { error: 'Either cwd or workspaceId is required.' };
  const dshHome = process.env.DSH_HOME || '';
  const registry = ctx.get?.('workspaceRegistry');
  return workspaceId
    ? resolveWorkspaceById(registry, workspaceId, dshHome)
    : resolveWorkspaceByCwd(registry, rawCwd, dshHome);
}

function validateRelayArgs(args, exec, getSelfId) {
  if (isSessionTainted(exec?.agent)) return { error: TAINTED_SESSION_REFUSAL_TEXT };
  const sessionId = String(args.sessionId ?? '').trim();
  const text = String(args.text ?? '').trim().slice(0, SEND_MAX_CHARS);
  const mode = args.mode === undefined ? 'queue' : String(args.mode).trim();
  if (!sessionId || !text) return { error: 'sessionId and text are required.' };
  if (mode !== 'queue' && mode !== 'steer') return { error: 'mode must be queue or steer.' };
  if (sessionId === getSelfId() || sessionId === exec?.agent?.id) {
    return { error: 'Cannot send a relay message to her own resident conversation.' };
  }
  return { sessionId, text, mode };
}

async function precheckViaSessionQuery(ctx, querySvc, sessionId, signal) {
  let observation;
  try {
    observation = await querySvc.observeSession(sessionId, {
      ...(signal ? { signal } : {}),
      projectionMode: 'none',
    });
    if (!observation?.header) return `Session ${sessionId} cannot be reached: not found.`;
    return await internalWorkerReasonFromMeta(ctx, {
      header: observation.header,
      events: observation.events ?? [],
    });
  } catch (/** @type {any} */ error) {
    return `Session ${sessionId} cannot be reached: ${error?.message ?? 'not found'}.`;
  } finally {
    observation?.[Symbol.dispose]?.();
  }
}

async function precheckViaControllerInspect(ctx, controller, sessionId, signal) {
  try {
    const info = await controller.inspect(sessionId, signal);
    if (!info) return `Session ${sessionId} cannot be reached: not found.`;
    return await internalWorkerReasonFromMeta(ctx, {
      header: info.meta ?? info.header ?? {},
      owner: info.presentation?.owner ?? '',
      events: info.events ?? [],
    });
  } catch (/** @type {any} */ error) {
    return `Session ${sessionId} cannot be reached: ${error?.message ?? 'not found'}.`;
  }
}

async function precheckViaControllerList(ctx, controller, sessionId) {
  try {
    const rows = sessionRowsFrom(await controller.list({}));
    const found = rows.find((row) => String(row?.sessionId ?? row?.id ?? '') === sessionId);
    if (!found) return `Session ${sessionId} cannot be reached: not found.`;
    const pres = found?.projections?.values?.sessionListMetadata?.presentation ?? found?.presentation;
    return await internalWorkerReasonFromMeta(ctx, {
      header: {
        origin: found.origin,
        agentPreset: found.agentPreset ?? found?.projections?.values?.agentPreset?.preset,
      },
      owner: pres?.owner ?? found.owner ?? '',
    });
  } catch {
    return null;
  }
}

/**
 * Read-only precheck before popping a human confirmation dialog:
 * inspects persisted metadata via `sessionQuery.observeSession(..., { projectionMode: 'none' })`,
 * `controller.inspect`, or `controller.list` — NEVER calling `controller.resolveAgent`
 * when read-only APIs exist so declining confirmation never hydrates a dormant session.
 * @param {any} ctx
 * @param {string} sessionId
 * @param {AbortSignal | null | undefined} [signal]
 */
async function precheckRelayTarget(ctx, sessionId, signal) {
  const querySvc = ctx.get?.('sessionQuery');
  if (typeof querySvc?.observeSession === 'function') {
    return precheckViaSessionQuery(ctx, querySvc, sessionId, signal);
  }
  const controller = controllerFrom(ctx);
  if (typeof controller?.inspect === 'function') {
    return precheckViaControllerInspect(ctx, controller, sessionId, signal);
  }
  if (typeof controller?.list === 'function') {
    const listed = await precheckViaControllerList(ctx, controller, sessionId);
    if (listed !== null) return listed;
  }
  if (typeof controller?.resolveAgent !== 'function') return '';
  const precheck = await controller.resolveAgent(sessionId);
  if (precheck == null || 'error' in precheck || !precheck.agent) {
    return `Session ${sessionId} cannot be reached: ${precheck?.error?.message ?? 'not found'}.`;
  }
  return internalWorkerReason(ctx, precheck.agent);
}

/**
 * @param {any} ctx
 * @param {{ sessionId: string, text: string, mode: string, signal?: AbortSignal | null }} opts
 */
async function deliverToResolvedSession(ctx, { sessionId, text, mode, signal }) {
  const controller = controllerFrom(ctx);
  if (typeof controller?.resolveAgent !== 'function') {
    return { ok: false, messageId: '', detail: `Session ${sessionId} cannot be resolved (controller unavailable).` };
  }
  const result = await controller.resolveAgent(sessionId);
  if (result == null || 'error' in result || !result.agent) {
    return { ok: false, messageId: '', detail: `Session ${sessionId} cannot be reached: ${result?.error?.message ?? 'not found'}.` };
  }
  const agent = result.agent;
  const blocked = await internalWorkerReason(ctx, agent);
  if (blocked) return { ok: false, messageId: '', detail: blocked };
  const deliverFn = mode === 'steer' ? agent.steer : agent.followup;
  if (typeof deliverFn !== 'function') {
    return { ok: false, messageId: '', detail: `Session ${sessionId} does not support ${mode} delivery.` };
  }
  if (signal?.aborted) return { ok: false, messageId: '', detail: ABORTED_TEXT };
  const message = createUserMessage({ content: [{ type: 'text', text }], source: WAKE_SOURCE });
  await deliverFn.call(agent, message);
  const messageId = String(message.id ?? '');
  return { ok: true, messageId, detail: `Message ${messageId} delivered to ${sessionId} (${mode}).` };
}

/** @param {any} created */
function createdSessionId(created) {
  return String(created?.sessionId ?? created?.id ?? created?.session?.id ?? '').trim();
}

/**
 * @param {any} ctx
 * @param {string} preset
 */
async function validateNewPreset(ctx, preset) {
  if (preset === 'whale-girl') {
    return 'The whale assistant has one resident conversation. Open her existing session instead.';
  }
  if (preset && await isHiddenPreset(ctx, preset)) {
    return `Preset "${preset}" is internal/hidden and cannot be used to open a session.`;
  }
  return '';
}

export function apply(ctx) {
  const getSelfId = () => (process.env.DSH_HOME
    ? createWhaleScope(process.env.DSH_HOME).get().sessionId
    : '');

  ctx.tools.register(defineTool({
    name: 'whale_list_sessions',
    description:
      'List Harness sessions with metadata (id, title, owner, workspace, last-activity, '
      + 'running state). The entry point for finding a session id; whale_read_session and '
      + 'whale_search_sessions open the contents.',
    timeoutMs: 15_000,
    parameters: {
      limit: { type: 'number', description: 'Max sessions to return (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          sessions: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                title: { type: 'string', required: true },
                owner: { type: 'string', required: true },
                cwd: { type: 'string', required: true },
                status: { type: 'string', required: true },
                updatedAt: { type: 'number', required: true },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.sessions.map(formatSessionRow).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List sessions', kind: 'other', content: [] }),
    async execute(args, exec) {
      if (isSessionTainted(exec?.agent)) {
        return { ok: false, sessions: [], detail: TAINTED_SESSION_REFUSAL_TEXT };
      }
      const controller = controllerFrom(ctx);
      if (typeof controller?.list !== 'function') {
        return { ok: false, sessions: [], detail: 'Session controller is unavailable.' };
      }
      const rows = sessionRowsFrom(await controller.list({}));
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 20));
      const sessions = rows.slice(0, limit).map(rowSummary);
      return { ok: true, sessions, detail: `${sessions.length} session(s).` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_send_to_session',
    description:
      'Deliver a text message into another Harness session by sessionId — it arrives as a user message '
      + 'and wakes that session if idle (mode="queue") or steers an active turn (mode="steer"). '
      + 'Cannot target herself or internal read-only/project workers.',
    timeoutMs: CONFIRM_TOOL_TIMEOUT_MS,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Target session id.' },
      text: { type: 'string', required: true, description: 'Message body (plain text).' },
      mode: { type: 'string', description: 'Delivery mode: queue (default) | steer.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          messageId: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
      presentationMeta: (_args, value) => ({ ok: value.ok, detail: value.detail }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Deliver to session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    presentResult: (_args, result) => {
      if (!result || result.isError) return undefined;
      const meta = result.meta && typeof result.meta === 'object' && !Array.isArray(result.meta)
        ? /** @type {Record<string, any>} */ (result.meta)
        : null;
      if (meta && meta.ok !== true) return undefined;
      const fallbackText = Array.isArray(result.content)
        ? result.content.map((b) => (b && b.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n')
        : '';
      return {
        card: 'generic',
        title: 'Delivered',
        content: [{ type: 'text', text: String(meta?.detail ?? fallbackText) }],
      };
    },
    async execute(args, exec) {
      const parsed = validateRelayArgs(args, exec, getSelfId);
      if ('error' in parsed && parsed.error) return { ok: false, messageId: '', detail: parsed.error };
      const sessionId = parsed.sessionId ?? '';
      const text = parsed.text ?? '';
      const mode = parsed.mode ?? 'queue';
      const preBlocked = await precheckRelayTarget(ctx, sessionId, exec?.signal);
      if (preBlocked) return { ok: false, messageId: '', detail: preBlocked };
      const confirmation = await confirmModelAction({
        tool: 'whale_send_to_session',
        action: 'send',
        effect: 'external',
        summary: `以你的名义向会话 ${sessionId} 发送一条消息（${mode}）`,
        details: text,
      }, exec?.signal, exec);
      if (confirmation.ok !== true || exec?.signal?.aborted) {
        return { ok: false, messageId: '', detail: refusalTextFor(confirmation, exec?.signal) };
      }
      return deliverToResolvedSession(ctx, { sessionId, text, mode, signal: exec?.signal });
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_new_session',
    description:
      'Open a fresh Harness session in a workspace directory (cwd) or registered workspaceId '
      + '(mutually exclusive). Returns the new session id; use whale_send_to_session to give it a first task.',
    timeoutMs: CONFIRM_TOOL_TIMEOUT_MS,
    parameters: {
      cwd: { type: 'string', description: 'Absolute workspace path for the new session (mutually exclusive with workspaceId).' },
      workspaceId: { type: 'string', description: 'Registered workspace id (mutually exclusive with cwd).' },
      agentPreset: { type: 'string', description: 'Optional visible agent preset id (default: host standard).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          sessionId: { type: 'string', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'New session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.cwd ?? args.workspaceId ?? '') }],
    }),
    async execute(args, exec) {
      if (isSessionTainted(exec?.agent)) {
        return { ok: false, sessionId: '', detail: TAINTED_SESSION_REFUSAL_TEXT };
      }
      const controller = controllerFrom(ctx);
      if (typeof controller?.create !== 'function') {
        return { ok: false, sessionId: '', detail: 'Session controller is unavailable.' };
      }
      const preset = String(args.agentPreset ?? '').trim();
      const presetError = await validateNewPreset(ctx, preset);
      if (presetError) return { ok: false, sessionId: '', detail: presetError };
      const resolved = resolveWorkspaceCreateRequest(ctx, args);
      if (resolved.error) return { ok: false, sessionId: '', detail: resolved.error };
      const request = { ...resolved.request, ...(preset ? { agentPreset: preset } : {}) };
      const confirmation = await confirmModelAction({
        tool: 'whale_new_session',
        action: 'create',
        effect: 'code',
        summary: `在 ${resolved.displayTarget} 打开一个新的工作会话`,
        details: preset ? `目标：${resolved.displayTarget}\n预设：${preset}` : `目标：${resolved.displayTarget}`,
      }, exec?.signal, exec);
      if (confirmation.ok !== true || exec?.signal?.aborted) {
        return { ok: false, sessionId: '', detail: refusalTextFor(confirmation, exec?.signal) };
      }
      const created = await controller.create(request);
      const sessionId = createdSessionId(created);
      if (!sessionId) return { ok: false, sessionId: '', detail: 'Session was created without an id.' };
      return { ok: true, sessionId, detail: `Session ${sessionId} opened in ${resolved.displayTarget}.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_usage_today',
    description:
      'Report today\'s DeepSeek Harness token usage — the desktop pet watcher mirrors a daily '
      + 'snapshot into the whale home (usage-today.json). Read it instead of scanning session logs.',
    timeoutMs: 10_000,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          used: { type: 'number', required: true },
          activeMinutes: { type: 'number', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.detail }],
    },
    presentCall: () => ({ card: 'generic', title: 'Usage today', kind: 'other', content: [] }),
    async execute() {
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, used: 0, activeMinutes: 0, detail: 'DSH home is unavailable.' };
      const file = path.join(whaleHomeDir(home), 'usage-today.json');
      let snapshot = null;
      try {
        snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return { ok: false, used: 0, activeMinutes: 0, detail: 'No usage snapshot yet — the desktop pet has not observed activity.' };
      }
      const used = Number.isFinite(snapshot?.used) ? Math.floor(snapshot.used) : 0;
      const activeMinutes = Number.isFinite(snapshot?.activeMsToday)
        ? Math.round(snapshot.activeMsToday / 60000) : 0;
      const day = typeof snapshot?.day === 'string' ? snapshot.day : '';
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      if (day !== today) {
        return { ok: false, used: 0, activeMinutes: 0, detail: `Usage snapshot is out of date (${day || 'unknown day'}); today's usage is unavailable.` };
      }
      return {
        ok: true,
        used,
        activeMinutes,
        detail: `Today (${day || 'current UTC day'}): ${used} tokens, ~${activeMinutes} min active.`,
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_notify',
    description:
      'Push an important one-line notification onto the desktop pet bubble — for milestones, '
      + 'rest reminders, or things the user must not miss. The bubble stays pinned on screen '
      + 'with a close button until the user dismisses it, so use this for results and answers '
      + 'the user will want to read. Same channel as whale_pet_say; prefer pet_say for casual '
      + 'lines and reserve notify for items worth interrupting for.',
    timeoutMs: 10_000,
    parameters: {
      text: { type: 'string', required: true, description: 'One notification line, ≤ 240 chars.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Pet notification',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    async execute(args, exec) {
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, detail: 'DSH home is unavailable.' };
      const text = String(args.text ?? '').trim().slice(0, 240);
      if (!text) return { ok: false, detail: 'Empty notification text; nothing was sent.' };
      appendPetOutbox(home, 'notify', text);
      return { ok: true, detail: 'Notification queued for the desktop pet.' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_pet_say',
    description:
      'Make the desktop Live2D pet say something on screen — a short bubble line. '
      + 'Use it for milestones, greetings, reminders; one sentence, her voice, no markdown.',
    timeoutMs: 10_000,
    parameters: {
      text: { type: 'string', required: true, description: 'One bubble line, ≤ 240 chars.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Pet bubble',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    async execute(args, exec) {
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, detail: 'DSH home is unavailable.' };
      const text = String(args.text ?? '').trim().slice(0, 240);
      if (!text) return { ok: false, detail: 'Empty bubble text; nothing was sent.' };
      appendPetOutbox(home, 'say', text);
      return { ok: true, detail: 'Bubble queued for the desktop pet.' };
    },
  }));

  registerMemoryTools(ctx);
  registerSessionTools(ctx, { getSelfId });
  registerDiscoveryTools(ctx, { getSelfId });
  registerTaskTools(ctx);
  registerProjectBridgeTools(ctx, { getSelfId });
  registerDesktopTools(ctx);
  registerProfileTools(ctx);
  registerStickerTools(ctx);
  registerBotTools(ctx, { defineTool });
}
