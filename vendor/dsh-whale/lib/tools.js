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
import { registerSessionTools } from './session-tools.js';
import { registerDesktopTools } from './desktop-tools.js';
import { registerStickerTools } from './sticker-tools.js';
import { registerProfileTools } from './profile-tools.js';

export const name = 'dsh-whale-tools';
export const inject = ['tools', 'agents'];

export const Config = z.object({});

const WAKE_SOURCE = Object.freeze({ kind: 'plugin', plugin: 'dsh-whale', form: 'relay' });
const SEND_MAX_CHARS = 4000;
const REMEMBER_MAX_CHARS = 40000;

export function apply(ctx) {
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
        text: value.sessions.map((s) => `- ${s.title || '(untitled)'} [${s.sessionId}]`).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List sessions', kind: 'other', content: [] }),
    async execute(args) {
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
      + 'and wakes that session if idle. You are speaking in the user\'s name inside that session, so '
      + 'keep to what they asked you to pass on.',
    timeoutMs: 30_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Target session id.' },
      text: { type: 'string', required: true, description: 'Message body (plain text).' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Deliver to session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    presentResult: (_args, result) => (result.ok !== true ? undefined : {
      card: 'generic',
      title: 'Delivered',
      content: [{ type: 'text', text: String(result.value?.detail ?? '') }],
    }),
    async execute(args) {
      const sessionId = String(args.sessionId ?? '').trim();
      const text = String(args.text ?? '').trim().slice(0, SEND_MAX_CHARS);
      if (!sessionId || !text) return { ok: false, detail: 'sessionId and text are required.' };
      let agent = ctx.agents?.get?.(sessionId);
      if (!agent) {
        const controller = controllerFrom(ctx);
        if (typeof controller?.resolveAgent !== 'function') {
          return { ok: false, detail: `Session ${sessionId} is offline and cannot be resumed.` };
        }
        const result = await controller.resolveAgent(sessionId);
        if (result == null || 'error' in result) {
          return { ok: false, detail: `Session ${sessionId} cannot be reached: ${result?.error?.message ?? 'not found'}.` };
        }
        agent = result.agent;
      }
      if (typeof agent?.followup !== 'function') {
        return { ok: false, detail: `Session ${sessionId} cannot accept a message.` };
      }
      await agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: WAKE_SOURCE,
      }));
      return { ok: true, detail: `Message delivered to ${sessionId}.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_new_session',
    description:
      'Open a fresh Harness session in a workspace directory. Returns the new session id; '
      + 'use whale_send_to_session to give it a first task.',
    timeoutMs: 15_000,
    parameters: {
      cwd: { type: 'string', required: true, description: 'Absolute workspace path for the new session.' },
      agentPreset: { type: 'string', description: 'Optional agent preset id (default: host standard).' },
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
      content: [{ type: 'text', text: String(args.cwd ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.create !== 'function') {
        return { ok: false, sessionId: '', detail: 'Session controller is unavailable.' };
      }
      const cwd = String(args.cwd ?? '').trim();
      if (!cwd || !path.isAbsolute(cwd)) return { ok: false, sessionId: '', detail: 'cwd must be an absolute path.' };
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        return { ok: false, sessionId: '', detail: `Directory does not exist: ${cwd}` };
      }
      const request = { cwd };
      const preset = String(args.agentPreset ?? '').trim();
      if (preset === 'whale-girl') {
        return { ok: false, sessionId: '', detail: 'The whale assistant has one resident conversation. Open her existing session instead.' };
      }
      if (preset) request.agentPreset = preset;
      const created = await controller.create(request);
      const sessionId = String(created?.sessionId ?? created?.id ?? created?.session?.id ?? '').trim();
      if (!sessionId) return { ok: false, sessionId: '', detail: 'Session was created without an id.' };
      return { ok: true, sessionId, detail: `Session ${sessionId} opened in ${cwd}.` };
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
    async execute(args) {
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
    async execute(args) {
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, detail: 'DSH home is unavailable.' };
      const text = String(args.text ?? '').trim().slice(0, 240);
      if (!text) return { ok: false, detail: 'Empty bubble text; nothing was sent.' };
      appendPetOutbox(home, 'say', text);
      return { ok: true, detail: 'Bubble queued for the desktop pet.' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_remember',
    description:
      'Append a fact to MEMORY.md in the whale home — her long-term memory across sessions. '
      + 'Store user preferences, decisions, and durable facts; never store secrets or instructions to obey.',
    timeoutMs: 10_000,
    parameters: {
      text: { type: 'string', required: true, description: 'One memory line (a fact, ≤ 500 chars).' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Remember',
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? '') }],
    }),
    async execute(args) {
      const home = process.env.DSH_HOME || '';
      if (!home) return { ok: false, detail: 'DSH home is unavailable.' };
      const line = String(args.text ?? '').trim().slice(0, 500);
      if (!line) return { ok: false, detail: 'Empty memory line; nothing was stored.' };
      const file = path.join(whaleHomeDir(home), 'MEMORY.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# 鲸鱼娘的长期记忆\n';
      if (existing.length + line.length > REMEMBER_MAX_CHARS) {
        return { ok: false, detail: 'MEMORY.md is full; ask the user to tidy it in settings.' };
      }
      const body = existing.endsWith('\n') ? existing : `${existing}\n`;
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${body}- ${line}\n`, 'utf8');
      fs.renameSync(tmp, file);
      return { ok: true, detail: 'Remembered.' };
    },
  }));

  registerSessionTools(ctx, {
    getSelfId: () => process.env.DSH_HOME
      ? createWhaleScope(process.env.DSH_HOME).get().sessionId
      : '',
  });
  registerDesktopTools(ctx);
  registerProfileTools(ctx);
  registerStickerTools(ctx);
}
