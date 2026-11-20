/**
 * Desktop management tools — the whale assistant's reach into the desktop
 * shell itself. They ride the same loopback control channel the in-chat
 * installer uses (DSH_DESKTOP_INSTALL_URL + Bearer token delivered to the
 * Harness process), so every action lands in the main process with its own
 * validation: plugin guards, renderer-config whitelist, catalog pinning.
 * When the URL env or the in-store token is absent (non-desktop host), each
 * tool reports 'desktop-unavailable' instead of pretending.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { internalSecret } from '../../dsh-shared/lib/internal-secret.mjs';
import { genericOutput, trimTo } from './shared.js';
import {
  ABORTED_TEXT,
  CONFIRM_TOOL_TIMEOUT_MS,
  NON_OWNER_IM_REFUSAL_TEXT,
  UNATTENDED_REFUSAL_TEXT,
  confirmModelAction,
  refusalTextFor,
} from './desktop-confirm.js';
import { isNonOwnerImTurn, isUnattendedPulseTurn } from './call-origin.js';

const CONTROL_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = CONFIRM_TOOL_TIMEOUT_MS;

// Renderer-writable keys that change credentials, external exposure, startup
// behavior or built-in capability — a patch touching any of them confirms on
// the desktop first. Ordinary appearance/policy keys stay local.
export const SENSITIVE_CONFIG_KEYS = new Set([
  'githubToken', 'remoteWorkspaceEnabled', 'dshImEnabled', 'openAtLogin', 'autoStartDesktop',
  'openDevTools', 'downloadRoute', 'projectEnabled', 'whaleAssistantEnabled',
]);

// Credential keys: a patch writing one replaces the stored secret, so it
// confirms as 'patch-credentials' (registry: destructive) — the dialog never
// offers a run-scoped "always" for credential writes, every write asks again.
const CREDENTIAL_CONFIG_KEYS = new Set(['githubToken']);

function controlConfig() {
  const url = String(process.env.DSH_DESKTOP_INSTALL_URL ?? '').trim();
  const token = internalSecret('DSH_DESKTOP_INSTALL_TOKEN').trim();
  return url && token ? { url, token } : null;
}

function unavailable() {
  return { ok: false, detail: 'desktop-unavailable — no control channel in this host.' };
}

/**
 * @param {number} timeoutMs
 * @param {AbortSignal | null | undefined} signal
 */
function combineSignal(timeoutMs, signal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([timeout, signal]) : signal;
}

/**
 * @param {{ url: string, token: string }} control
 * @param {string} pathname
 * @param {{ method?: string, body?: any, timeoutMs?: number, signal?: AbortSignal | null }} [opts]
 */
async function desktopCall(control, pathname, { method = 'GET', body, timeoutMs = CONTROL_TIMEOUT_MS, signal } = {}) {
  if (signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
  let response;
  try {
    response = await fetch(`${control.url}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${control.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combineSignal(timeoutMs, signal),
    });
  } catch (error) {
    if (signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
    return { ok: false, detail: `control channel unreachable: ${String(error?.message ?? error)}` };
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    return { ok: false, detail: String(json?.error ?? `HTTP ${response.status}`) };
  }
  return json ?? { ok: false, detail: 'control channel returned a non-JSON body' };
}

const pluginListOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      plugins: { type: 'array', required: true, items: { type: 'string' } },
      detail: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.plugins.join('\n') || value.detail,
  }],
};

/**
 * @param {string} action
 * @param {any} args
 */
function buildPluginBody(action, args) {
  /** @type {Record<string, any>} */
  const payload = { action };
  if (action === 'install') {
    const id = String(args.id ?? '').trim();
    const spec = String(args.spec ?? '').trim();
    if (!id && !spec) return { error: 'install needs a catalog id or a github:owner/repo spec.' };
    if (id) payload.id = id;
    if (spec) payload.spec = spec;
    if (Array.isArray(args.allowBuilds)) payload.allowBuilds = args.allowBuilds;
    return { payload };
  }
  const name = String(args.name ?? '').trim();
  if (!name) return { error: `${action} needs a package name.` };
  payload.name = name;
  return { payload };
}

/**
 * @param {string} action
 * @param {any} args
 * @param {any} result
 */
function formatPluginResult(action, args, result) {
  if (result.ok !== true) {
    if (result.declined === true) {
      return { ok: false, detail: '用户拒绝了这次插件变更，不要重试，除非用户再次明确要求。' };
    }
    if (result.needsAllowBuilds === true) {
      return {
        ok: false,
        detail: `该插件需要构建脚本许可。向用户确认后用 allowBuilds=[${(result.allowBuilds ?? []).join(', ')}] 重试。`,
      };
    }
    return { ok: false, detail: String(result.error ?? result.detail ?? `${action} failed`) };
  }
  const restarting = result.restarting === true || result.harnessRestarted === true;
  return {
    ok: true,
    detail: `${action} ${String(args.name ?? args.id ?? args.spec ?? '')} 完成${restarting ? '，Harness 正在重启' : ''}。`,
  };
}

export function registerDesktopTools(ctx) {
  ctx.tools.register(defineTool({
    name: 'whale_pet_settings',
    description:
      'Read or update the desktop whale appearance and behavior settings. With no patch, '
      + 'read current settings. A patch may contain scale, opacity, personality, activity, '
      + 'selfTalk, wander, lockPosition, shiftToDrag, powerSave, clickSound, chatEnabled, '
      + 'lookProvider or lookModel. The desktop applies the same normalization as its Settings UI.',
    timeoutMs: CONTROL_TIMEOUT_MS,
    parameters: {
      patch: { type: 'object', additionalProperties: true, description: 'Optional whale appearance/behavior settings patch.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic', title: 'Whale settings', kind: 'other',
      content: [{ type: 'text', text: JSON.stringify(args.patch ?? {}) }],
    }),
    async execute(args, exec) {
      const control = controlConfig();
      if (!control) return unavailable();
      const patch = args.patch;
      if (patch !== undefined && exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const result = patch === undefined
        ? await desktopCall(control, '/desktop/pet-settings', { signal: exec?.signal })
        : await desktopCall(control, '/desktop/pet-settings', { method: 'POST', body: { patch }, signal: exec?.signal });
      if (result.ok !== true) return { ok: false, detail: result.error ?? result.detail ?? 'whale settings failed' };
      return { ok: true, detail: JSON.stringify({ enabled: result.enabled, settings: result.settings }) };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_desktop_state',
    description:
      'Desktop overview: app version, Harness kernel state, installed plugins, disabled list, '
      + 'and the non-secret config. Read this before changing anything.',
    timeoutMs: CONTROL_TIMEOUT_MS,
    parameters: {},
    output: genericOutput,
    presentCall: () => ({ card: 'generic', title: 'Desktop state', kind: 'other', content: [] }),
    async execute() {
      const control = controlConfig();
      if (!control) return unavailable();
      const result = await desktopCall(control, '/desktop/state');
      if (result.ok !== true) return { ok: false, detail: result.detail ?? 'state read failed' };
      const plugins = Array.isArray(result.plugins) ? result.plugins : [];
      const config = result.config ?? {};
      const shown = Object.entries(config)
        .filter(([, v]) => ['boolean', 'string', 'number'].includes(typeof v) && String(v).length <= 80)
        .map(([k, v]) => `  ${k} = ${JSON.stringify(v)}`)
        .join('\n');
      return {
        ok: true,
        detail: [
          `版本 ${result.version ?? '?'}，Harness 状态 ${result.kernel || 'unknown'}`,
          `已装插件 ${plugins.length} 个${plugins.length ? `：${plugins.join(', ')}` : ''}`,
          `已禁用：${(result.disabledPlugins ?? []).join(', ') || '(无)'}`,
          shown ? `配置:\n${shown}` : '',
        ].filter(Boolean).join('\n'),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_marketplace',
    description:
      'Browse the curated plugin marketplace catalog (id, name, summary). Results feed '
      + 'whale_desktop_plugin install by id.',
    timeoutMs: 30_000,
    parameters: {
      query: { type: 'string', description: 'Optional search text.' },
      refresh: { type: 'boolean', description: 'Force a catalog refresh.' },
    },
    output: pluginListOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Marketplace',
      kind: 'other',
      content: [{ type: 'text', text: String(args.query ?? '') }],
    }),
    async execute(args) {
      const control = controlConfig();
      if (!control) return { ...unavailable(), plugins: [] };
      const q = trimTo(String(args.query ?? '').trim(), 200);
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (args.refresh === true) params.set('refresh', '1');
      const result = await desktopCall(control, `/desktop/marketplace${params.size ? `?${params}` : ''}`, {
        timeoutMs: 30_000,
      });
      if (result.ok !== true) return { ok: false, plugins: [], detail: result.detail ?? 'catalog read failed' };
      const entries = Array.isArray(result.plugins) ? result.plugins : Array.isArray(result.items) ? result.items : [];
      const plugins = entries.slice(0, 40).map((p) => {
        const id = String(p?.id ?? p?.name ?? '');
        const name = String(p?.name ?? '');
        const summary = trimTo(String(p?.summary ?? p?.description ?? ''), 80);
        return `${id}${name && name !== id ? ` — ${name}` : ''}${summary ? `：${summary}` : ''}`;
      });
      return { ok: true, plugins, detail: `${plugins.length} catalog entr${plugins.length === 1 ? 'y' : 'ies'}.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_desktop_config',
    description:
      'Patch renderer-writable desktop settings (same whitelist as the Settings UI: theme, '
      + 'locale, openAtLogin, closeToTray, projectEnabled, whaleAssistantEnabled, harness* '
      + 'policy keys, githubToken). Built-in plugin toggles and theme apply immediately; '
      + 'toggling a built-in plugin restarts Harness — your own session '
      + 'goes with it, so tell the user first.',
    timeoutMs: CONFIRM_TOOL_TIMEOUT_MS,
    parameters: {
      patch: {
        type: 'object',
        required: true,
        additionalProperties: true,
        description: 'Config patch, e.g. {theme:"dark"} or {projectEnabled:true}.',
      },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Desktop config',
      kind: 'other',
      content: [{ type: 'text', text: JSON.stringify(args.patch ?? {}) }],
    }),
    async execute(args, exec) {
      const control = controlConfig();
      if (!control) return unavailable();
      const patch = args.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, detail: 'patch must be an object of config keys.' };
      }
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const sensitive = Object.keys(patch).filter((key) => SENSITIVE_CONFIG_KEYS.has(key)).sort();
      if (sensitive.length) {
        const touchesCredential = sensitive.some((key) => CREDENTIAL_CONFIG_KEYS.has(key));
        const confirmation = await confirmModelAction({
          tool: 'whale_desktop_config',
          action: touchesCredential ? 'patch-credentials' : 'patch',
          effect: touchesCredential ? 'destructive' : 'external',
          // The endpoint keys a run-scoped "always" grant by this exact key
          // set: approving {projectEnabled} never covers {githubToken} or any
          // other combination.
          scope: sensitive.join(','),
          summary: `修改影响安全或对外暴露的桌面配置：${sensitive.join(', ')}`,
          details: JSON.stringify(patch, null, 2),
        }, exec?.signal, exec);
        if (confirmation.ok !== true || exec?.signal?.aborted) {
          return { ok: false, detail: refusalTextFor(confirmation, exec?.signal) };
        }
      }
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      const result = await desktopCall(control, '/desktop/config', { method: 'POST', body: { patch }, signal: exec?.signal });
      if (result.ok !== true) return { ok: false, detail: result.detail ?? String(result.error ?? 'config write failed') };
      return { ok: true, detail: `Config applied: ${Object.keys(patch).join(', ')}.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_desktop_plugin',
    description:
      'Manage desktop plugins. list = installed rows; install = curated catalog id OR a '
      + 'github:owner/repo[#ref] spec (allowBuilds passes pnpm build-script consent through); '
      + 'remove / disable / enable take a package name. Installs, removals and toggles '
      + 'restart Harness — your own session restarts with it. Every change pops a '
      + 'desktop confirmation dialog and runs only when the user approves.',
    timeoutMs: INSTALL_TIMEOUT_MS,
    parameters: {
      action: { type: 'string', required: true, description: 'list | install | remove | disable | enable' },
      name: { type: 'string', description: 'Package name (remove/disable/enable).' },
      id: { type: 'string', description: 'Marketplace catalog id (install).' },
      spec: { type: 'string', description: 'github:owner/repo[#ref] (install).' },
      allowBuilds: {
        type: 'array',
        items: { type: 'string' },
        description: 'pnpm allowBuilds keys after a needsAllowBuilds reply (install).',
      },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: `Plugin ${String(args.action ?? '')}`,
      kind: 'other',
      content: [{ type: 'text', text: String(args.name ?? args.id ?? args.spec ?? '') }],
    }),
    async execute(args, exec) {
      const control = controlConfig();
      if (!control) return unavailable();
      const action = String(args.action ?? '').trim();
      if (action === 'list') {
        const result = await desktopCall(control, '/desktop/state', { signal: exec?.signal });
        if (result.ok !== true) return { ok: false, detail: result.detail ?? 'state read failed' };
        const plugins = Array.isArray(result.plugins) ? result.plugins : [];
        const disabled = Array.isArray(result.disabledPlugins) ? result.disabledPlugins : [];
        return {
          ok: true,
          detail: plugins.length
            ? `${plugins.join(', ')}${disabled.length ? `\n已禁用：${disabled.join(', ')}` : ''}`
            : 'No plugins installed.',
        };
      }
      if (!['install', 'remove', 'disable', 'enable'].includes(action)) {
        return { ok: false, detail: 'action must be list | install | remove | disable | enable.' };
      }
      if (exec?.signal?.aborted) return { ok: false, detail: ABORTED_TEXT };
      if (isUnattendedPulseTurn(exec)) return { ok: false, detail: UNATTENDED_REFUSAL_TEXT };
      if (isNonOwnerImTurn(exec)) return { ok: false, detail: NON_OWNER_IM_REFUSAL_TEXT };
      const body = buildPluginBody(action, args);
      if (body.error) return { ok: false, detail: body.error };
      const result = await desktopCall(control, '/desktop/plugin', {
        method: 'POST',
        body: body.payload,
        // Every mutation waits on a desktop confirmation dialog.
        timeoutMs: INSTALL_TIMEOUT_MS,
        signal: exec?.signal,
      });
      return formatPluginResult(action, args, result);
    },
  }));
}
