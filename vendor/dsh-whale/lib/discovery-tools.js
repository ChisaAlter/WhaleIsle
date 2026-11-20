/**
 * Discovery and session-governance tools for the resident whale assistant:
 * `whale_list_workspaces`, `whale_list_models`, `whale_list_presets`,
 * and `whale_archive_session`.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  ABORTED_TEXT,
  NON_OWNER_IM_REFUSAL_TEXT,
  TAINTED_SESSION_REFUSAL_TEXT,
  UNATTENDED_REFUSAL_TEXT,
  isNonOwnerImTurn,
  isSessionTainted,
  isUnattendedPulseTurn,
} from './call-origin.js';
import { controllerFrom, genericOutput, rowSummary, sessionRowsFrom, trimTo } from './shared.js';

const BUSY_TODO_STATES = new Set(['starting', 'running', 'stopping', 'waiting_approval', 'waiting_input']);

function formatCatalogModel(provider, entry) {
  const rawEfforts = entry && entry.reasoning && Array.isArray(entry.reasoning.efforts)
    ? entry.reasoning.efforts
    : [];
  return {
    provider,
    id: String(entry?.id ?? ''),
    name: String(entry?.name ?? entry?.id ?? ''),
    efforts: rawEfforts.map((e) => String(e?.id ?? e ?? '')).filter(Boolean),
  };
}

function extractCatalogModels(catalog) {
  const def = catalog && catalog.default && catalog.default.provider && catalog.default.model
    ? `${catalog.default.provider}/${catalog.default.model}`
    : '';
  const groups = catalog && Array.isArray(catalog.groups) ? catalog.groups : [];
  const models = [];
  for (const group of groups) {
    const provider = String(group?.id ?? '');
    for (const entry of group?.models ?? []) {
      models.push(formatCatalogModel(provider, entry));
    }
  }
  return { defaultModel: def, models };
}

function isActiveManagedTaskSession(ctx, sessionId) {
  const todos = ctx.get?.('whaleTodos');
  if (todos?.activeBySession?.has?.(sessionId)) return true;
  if (typeof todos?.inspect === 'function' && todos.inspect().some((item) => item?.sessionId === sessionId)) return true;
  return typeof todos?.list === 'function'
    && todos.list().some((card) => card?.sessionId === sessionId && BUSY_TODO_STATES.has(card?.state));
}

function archiveRefusalReason(ctx, args, exec, getSelfId) {
  if (exec?.signal?.aborted) return ABORTED_TEXT;
  if (isSessionTainted(exec?.agent)) return TAINTED_SESSION_REFUSAL_TEXT;
  if (isNonOwnerImTurn(exec)) return NON_OWNER_IM_REFUSAL_TEXT;
  if (isUnattendedPulseTurn(exec)) return UNATTENDED_REFUSAL_TEXT;
  const sessionId = String(args.sessionId ?? '').trim();
  if (!sessionId) return 'sessionId is required.';
  if (sessionId === getSelfId() || sessionId === exec?.agent?.id) return '不能归档鲸鱼娘常驻会话。';
  if (isActiveManagedTaskSession(ctx, sessionId)) return '该会话属于正在执行的受管任务卡，请先停止任务后再归档。';
  return '';
}

async function archiveViaHostServices(ctx, sessionId) {
  const wsController = ctx.get?.('workspaceController');
  if (typeof wsController?.archiveSession === 'function') {
    await wsController.archiveSession({ sessionId });
    return { ok: true, detail: `Archived session ${sessionId}.` };
  }
  const wsRegistry = ctx.get?.('workspaceRegistry');
  if (typeof wsRegistry?.archiveSession === 'function') {
    await wsRegistry.archiveSession(sessionId);
    return { ok: true, detail: `Archived session ${sessionId}.` };
  }
  const controller = controllerFrom(ctx);
  if (typeof controller?.archive === 'function') {
    await controller.archive({ sessionId });
    return { ok: true, detail: `Archived session ${sessionId}.` };
  }
  return { ok: false, detail: 'Workspace archive service is unavailable.' };
}

export function registerDiscoveryTools(ctx, { getSelfId = () => '' } = {}) {
  ctx.tools.register(defineTool({
    name: 'whale_list_workspaces',
    description:
      'List registered workspaces (id, path, name) available on this desktop Host. '
      + 'Use workspaceId or path when creating sessions or task cards.',
    timeoutMs: 10_000,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          workspaces: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                path: { type: 'string', required: true },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.workspaces.map((w) => `- ${w.name || w.path} [${w.id}] (${w.path})`).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List workspaces', kind: 'other', content: [] }),
    async execute(_args, exec) {
      if (isSessionTainted(exec?.agent)) {
        return { ok: false, workspaces: [], detail: TAINTED_SESSION_REFUSAL_TEXT };
      }
      const registry = ctx.get?.('workspaceRegistry');
      if (registry && typeof registry.list === 'function') {
        const rows = await registry.list();
        const workspaces = (Array.isArray(rows) ? rows : []).map((ws) => ({
          id: String(ws?.id ?? ''),
          name: String(ws?.name ?? ws?.label ?? ''),
          path: String(ws?.path ?? ws?.cwd ?? ''),
        })).filter((ws) => ws.path || ws.id);
        return { ok: true, workspaces, detail: `${workspaces.length} workspace(s).` };
      }
      const controller = controllerFrom(ctx);
      if (typeof controller?.list === 'function') {
        const rows = sessionRowsFrom(await controller.list({})).map(rowSummary);
        const byPath = new Map();
        for (const row of rows) {
          if (row.cwd && !byPath.has(row.cwd)) {
            byPath.set(row.cwd, { id: '', name: row.cwd.split(/[\\/]/u).pop() || row.cwd, path: row.cwd });
          }
        }
        const workspaces = [...byPath.values()];
        return { ok: true, workspaces, detail: `${workspaces.length} workspace(s) inferred from sessions.` };
      }
      return { ok: false, workspaces: [], detail: 'Workspace registry is unavailable.' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_list_models',
    description:
      'List available LLM providers, models, and reasoning effort levels from the Host model catalog.',
    timeoutMs: 10_000,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          defaultModel: { type: 'string', required: true },
          models: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                provider: { type: 'string', required: true },
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                efforts: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          ...(value.defaultModel ? [`默认模型：${value.defaultModel}`] : []),
          ...value.models.map((m) => `- ${m.provider}/${m.id}${m.name && m.name !== m.id ? ` (${m.name})` : ''}${m.efforts.length ? ` [efforts: ${m.efforts.join(',')}]` : ''}`),
        ].join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List models', kind: 'other', content: [] }),
    async execute() {
      const controller = controllerFrom(ctx);
      if (typeof controller?.modelCatalog !== 'function') {
        return { ok: false, defaultModel: '', models: [], detail: 'Model catalog is unavailable.' };
      }
      try {
        const { defaultModel, models } = extractCatalogModels(await controller.modelCatalog());
        return { ok: true, defaultModel, models, detail: `${models.length} model(s).` };
      } catch (/** @type {any} */ error) {
        return { ok: false, defaultModel: '', models: [], detail: String(error?.message ?? error) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_list_presets',
    description:
      'List user-visible agent presets available for opening new sessions (internal/hidden presets are excluded).',
    timeoutMs: 10_000,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          presets: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.presets.map((p) => `- ${p.id} (${p.name})${p.description ? `：${p.description}` : ''}`).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List presets', kind: 'other', content: [] }),
    async execute() {
      const presetsSvc = ctx.get?.('agentPresets');
      if (!presetsSvc || typeof presetsSvc.list !== 'function') {
        return { ok: false, presets: [], detail: 'Agent preset registry is unavailable.' };
      }
      try {
        const raw = await presetsSvc.list();
        const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.presets) ? raw.presets : []);
        const presets = rows
          .filter((entry) => entry && entry.hidden !== true && entry.id !== 'whale-girl' && entry.id !== 'whale-task-reader')
          .map((entry) => ({
            id: String(entry.id ?? ''),
            name: String(entry.name ?? entry.id ?? ''),
            description: trimTo(String(entry.description ?? ''), 200),
          }))
          .filter((entry) => entry.id);
        return { ok: true, presets, detail: `${presets.length} preset(s).` };
      } catch (/** @type {any} */ error) {
        return { ok: false, presets: [], detail: String(error?.message ?? error) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_archive_session',
    description:
      'Archive a finished, idle ordinary session so the sidebar stays tidy (reversible; does not delete data). '
      + 'Refuses archiving the resident whale conversation or active task sessions.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Session id to archive.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Archive session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args, exec) {
      const refusal = archiveRefusalReason(ctx, args, exec, getSelfId);
      if (refusal) return { ok: false, detail: refusal };
      try {
        return await archiveViaHostServices(ctx, String(args.sessionId ?? '').trim());
      } catch (/** @type {any} */ error) {
        return { ok: false, detail: String(error?.message ?? error) };
      }
    },
  }));
}
