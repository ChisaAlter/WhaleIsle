/**
 * Desktop management tools — the whale assistant's reach into the desktop
 * shell itself. They ride the same loopback control channel the in-chat
 * installer uses (DSH_DESKTOP_INSTALL_URL + Bearer token injected into the
 * Harness process), so every action lands in the main process with its own
 * validation: plugin guards, renderer-config whitelist, catalog pinning.
 * When the env pair is absent (non-desktop host), each tool reports
 * 'desktop-unavailable' instead of pretending.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { genericOutput, trimTo } from './shared.js';

const CONTROL_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 240_000;

function controlConfig() {
  const url = String(process.env.DSH_DESKTOP_INSTALL_URL ?? '').trim();
  const token = String(process.env.DSH_DESKTOP_INSTALL_TOKEN ?? '').trim();
  return url && token ? { url, token } : null;
}

function unavailable() {
  return { ok: false, detail: 'desktop-unavailable — no control channel env in this host.' };
}

async function desktopCall(control, pathname, { method = 'GET', body, timeoutMs = CONTROL_TIMEOUT_MS } = {}) {
  let response;
  try {
    response = await fetch(`${control.url}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${control.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
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
    async execute(args) {
      const control = controlConfig();
      if (!control) return unavailable();
      const patch = args.patch;
      const result = patch === undefined
        ? await desktopCall(control, '/desktop/pet-settings')
        : await desktopCall(control, '/desktop/pet-settings', { method: 'POST', body: { patch } });
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
    timeoutMs: CONTROL_TIMEOUT_MS,
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
    async execute(args) {
      const control = controlConfig();
      if (!control) return unavailable();
      const patch = args.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return { ok: false, detail: 'patch must be an object of config keys.' };
      }
      const result = await desktopCall(control, '/desktop/config', { method: 'POST', body: { patch } });
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
      + 'restart Harness — your own session restarts with it; tell the user before acting.',
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
    async execute(args) {
      const control = controlConfig();
      if (!control) return unavailable();
      const action = String(args.action ?? '').trim();
      if (action === 'list') {
        const result = await desktopCall(control, '/desktop/state');
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
      const body = { action };
      if (action === 'install') {
        const id = String(args.id ?? '').trim();
        const spec = String(args.spec ?? '').trim();
        if (!id && !spec) return { ok: false, detail: 'install needs a catalog id or a github:owner/repo spec.' };
        if (id) body.id = id;
        if (spec) body.spec = spec;
        if (Array.isArray(args.allowBuilds)) body.allowBuilds = args.allowBuilds;
      } else {
        const name = String(args.name ?? '').trim();
        if (!name) return { ok: false, detail: `${action} needs a package name.` };
        body.name = name;
      }
      const result = await desktopCall(control, '/desktop/plugin', {
        method: 'POST',
        body,
        timeoutMs: action === 'install' ? INSTALL_TIMEOUT_MS : CONTROL_TIMEOUT_MS,
      });
      if (result.ok !== true) {
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
    },
  }));
}
