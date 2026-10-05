/**
 * Session orchestration tools — the read/control half of the whale
 * assistant's widened authority. Everything here is a thin, schema-checked
 * wrapper over the host sessionController API; these stay preset-scoped so
 * only whale-girl sessions see them.
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  controllerFrom,
  controlBaseline,
  eventText,
  genericOutput,
  sessionSnapshot,
  trimTo,
} from './shared.js';
import {
  addSchedule,
  addWatch,
  listSchedules,
  listWatches,
  recentEvents,
  removeSchedule,
  removeWatch,
} from './observe.js';

const READ_LINE_MAX = 400;
const READ_TOTAL_MAX = 8000;
const READ_DEFAULT_MESSAGES = 30;

function unavailable() {
  return { ok: false, detail: 'Session controller is unavailable.' };
}

function failed(error) {
  return { ok: false, detail: String(error?.message ?? error ?? 'unknown error') };
}

function messageSourceLabel(source) {
  const kind = source?.kind;
  if (!kind || kind === 'user') return '用户';
  if (kind === 'plugin') return `${source.plugin || 'plugin'} 代投`;
  return String(kind);
}

/**
 * Render one history page into `[#seq] actor: text` lines. Events the
 * model cannot act on (context folds, request internals) are dropped;
 * everything the session surface shows stays visible.
 */
function formatRecords(records) {
  const lines = [];
  for (const rec of records ?? []) {
    const ev = rec?.event ?? rec;
    const seq = Number(ev?.seq) || 0;
    const tag = `[#${seq}]`;
    switch (ev?.type) {
      case 'user/message': {
        const text = trimTo(eventText(ev).trim(), READ_LINE_MAX);
        lines.push(`${tag} ${messageSourceLabel(ev?.data?.source)}: ${text || '(非文本消息)'}`);
        break;
      }
      case 'assistant/message': {
        const text = trimTo(eventText(ev).trim(), READ_LINE_MAX);
        if (text) lines.push(`${tag} 助手: ${text}`);
        break;
      }
      case 'tool/call':
        lines.push(`${tag} 工具调用 ${String(ev?.data?.name ?? '?')}`);
        break;
      case 'tool/result': {
        const msg = ev?.data?.message ?? {};
        const status = msg.isError === true ? 'error' : 'ok';
        lines.push(`${tag} 工具结果 ${String(msg.callId ?? '')}（${status}）`);
        break;
      }
      case 'turn/start':
        lines.push(`${tag} ── 回合 #${ev?.data?.turn ?? '?'} 开始`);
        break;
      case 'turn/end': {
        const kind = String(ev?.data?.reason?.kind ?? 'unknown');
        lines.push(`${tag} ── 回合 #${ev?.data?.turn ?? '?'} 结束（${kind}）`);
        break;
      }
      case 'session/presentation': {
        const title = String(ev?.data?.presentation?.title ?? '');
        if (title) lines.push(`${tag} 标题: ${trimTo(title, 120)}`);
        break;
      }
      default:
        break;
    }
  }
  return lines;
}

export function registerSessionTools(ctx, { getSelfId = () => '' } = {}) {
  ctx.tools.register(defineTool({
    name: 'whale_search_sessions',
    description:
      'Full-text search across every session\'s message contents. Returns session ids with '
      + 'matching snippets — the way to find which conversation talked about something.',
    timeoutMs: 20_000,
    parameters: {
      query: { type: 'string', required: true, description: 'Literal search text.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                snippet: { type: 'string', required: true },
              },
            },
          },
          hasMore: { type: 'boolean', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.items.map((i) => `- [${i.sessionId}] ${i.snippet}`).join('\n') || value.detail,
      }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Search sessions',
      kind: 'other',
      content: [{ type: 'text', text: String(args.query ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.search !== 'function') return { ...unavailable(), items: [], hasMore: false };
      const query = String(args.query ?? '').trim();
      if (!query) return { ok: false, items: [], hasMore: false, detail: 'query is required.' };
      try {
        const result = await controller.search({ query }, AbortSignal.timeout(15_000));
        const items = (result?.items ?? []).map((item) => ({
          sessionId: String(item.sessionId ?? ''),
          snippet: trimTo(item.snippet ?? '', 240),
        }));
        return {
          ok: true,
          items,
          hasMore: result?.hasMore === true,
          detail: `${items.length} hit(s)${result?.hasMore ? ' (truncated)' : ''}.`,
        };
      } catch (error) {
        return { ok: false, items: [], hasMore: false, detail: String(error?.message ?? error) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_read_session',
    description:
      'Read one session\'s message history as [#seq] actor: text lines (newest page by '
      + 'default, beforeSeq to page further back). This is the cross-session read the user '
      + 'granted — use it to check progress, outcomes, and what was asked.',
    timeoutMs: 20_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Target session id.' },
      beforeSeq: { type: 'number', description: 'Page further back: only events before this seq.' },
      maxMessages: { type: 'number', description: 'Page budget (default 30).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          sessionId: { type: 'string', required: true },
          lines: { type: 'array', required: true, items: { type: 'string' } },
          hasMore: { type: 'boolean', required: true },
          oldestSeq: { type: 'number', required: true },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.lines.join('\n').slice(0, READ_TOTAL_MAX)
          + (value.hasMore ? `\n…更早历史：whale_read_session(sessionId, beforeSeq=${value.oldestSeq})` : ''),
      }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Read session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.follow !== 'function' || typeof controller?.page !== 'function') {
        return { ...unavailable(), sessionId: '', lines: [], hasMore: false, oldestSeq: 0 };
      }
      const sessionId = String(args.sessionId ?? '').trim();
      if (!sessionId) return { ok: false, sessionId: '', lines: [], hasMore: false, oldestSeq: 0, detail: 'sessionId is required.' };
      const maxMessages = Math.max(5, Math.min(100, Number(args.maxMessages) || READ_DEFAULT_MESSAGES));
      try {
        const snapshot = await sessionSnapshot(controller, sessionId, maxMessages);
        if (!snapshot) {
          return { ok: false, sessionId, lines: [], hasMore: false, oldestSeq: 0, detail: `Session ${sessionId} is not readable (missing or not yet visible).` };
        }
        let records = snapshot.records;
        let hasMore = snapshot.hasMore === true;
        const beforeSeq = Number(args.beforeSeq);
        if (Number.isFinite(beforeSeq) && beforeSeq > 0) {
          const page = await controller.page({
            address: { kind: 'session', sessionId },
            throughSeq: snapshot.cursor,
            beforeSeq,
            maxMessages,
          }, AbortSignal.timeout(15_000));
          records = page?.records ?? [];
          hasMore = page?.hasMore === true;
        }
        const lines = formatRecords(records);
        const oldestSeq = Number(records?.[0]?.event?.seq ?? 0);
        return {
          ok: true,
          sessionId,
          lines,
          hasMore,
          oldestSeq,
          detail: `${lines.length} line(s)${hasMore ? ', earlier history available' : ''}.`,
        };
      } catch (error) {
        return { ok: false, sessionId, lines: [], hasMore: false, oldestSeq: 0, detail: String(error?.message ?? error) };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_session_queue',
    description:
      'Live queue + background-job overview from the host control stream. With sessionId, '
      + 'shows that session\'s pending messages and jobs; without, every session that has any. '
      + 'Queue item ids from here feed whale_update_queue.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', description: 'Optional: only this session\'s queue.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          queues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sessionId: { type: 'string', required: true },
                items: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string', required: true },
                      placement: { type: 'string', required: true },
                      text: { type: 'string', required: true },
                    },
                  },
                },
                jobs: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.queues.map((q) => [
          `${q.sessionId}:`,
          ...q.items.map((i) => `  [${i.placement}] ${i.id}: ${i.text}`),
          ...q.jobs.map((j) => `  job ${j}`),
        ].join('\n')).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'Session queues', kind: 'other', content: [] }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.control !== 'function') return { ...unavailable(), queues: [] };
      const wanted = String(args.sessionId ?? '').trim();
      const baseline = await controlBaseline(controller);
      if (!baseline) return { ok: false, queues: [], detail: 'Control stream is unavailable.' };
      const queues = [];
      const sessionIds = wanted ? [wanted] : Object.keys(baseline.queues ?? {});
      for (const sessionId of sessionIds) {
        const items = (baseline.queues?.[sessionId] ?? []).map((item) => ({
          id: String(item.id ?? ''),
          placement: String(item.placement ?? 'queued'),
          text: trimTo(
            (item.message?.content ?? [])
              .map((b) => (b?.type === 'text' ? String(b.text ?? '') : ''))
              .join(' ')
              .trim(),
            160,
          ),
        }));
        const jobs = (baseline.jobs?.[sessionId] ?? []).map((job) =>
          `${job.kind ?? job.label ?? 'job'} ${job.status ?? ''}`.trim());
        if (wanted || items.length || jobs.length) queues.push({ sessionId, items, jobs });
      }
      return { ok: true, queues, detail: `${queues.length} session(s) with pending work.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_recent_events',
    description:
      'Newest-first ring buffer of notable events across all sessions (messages, tool calls, '
      + 'turn boundaries). The pulse watcher fills this live; use it to see what just happened '
      + 'without reading whole logs.',
    timeoutMs: 10_000,
    parameters: {
      sessionId: { type: 'string', description: 'Optional: only this session\'s events.' },
      limit: { type: 'number', description: 'Max rows (default 30).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          events: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                at: { type: 'number', required: true },
                sessionId: { type: 'string', required: true },
                type: { type: 'string', required: true },
                detail: { type: 'string', required: true },
              },
            },
          },
          detail: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.events.map((e) => `- [${e.sessionId}] ${e.detail}`).join('\n') || value.detail,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'Recent events', kind: 'other', content: [] }),
    async execute(args) {
      const events = recentEvents({
        sessionId: String(args.sessionId ?? ''),
        limit: Number(args.limit) || 30,
      });
      return { ok: true, events, detail: `${events.length} event(s) in the buffer.` };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_watch',
    description:
      'Watch a session: when its turn ends, a wake-up message lands in YOUR session so you '
      + 'react with your tools. add with once=true (default) for a single notification, '
      + 'once=false to be told after every turn; list / remove by sessionId.',
    timeoutMs: 10_000,
    parameters: {
      action: { type: 'string', required: true, description: 'add | remove | list' },
      sessionId: { type: 'string', description: 'Session to watch (add/remove).' },
      note: { type: 'string', description: 'What to check when it fires (add).' },
      once: { type: 'boolean', description: 'Fire once then remove (default true).' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: `Watch ${String(args.action ?? '')}`,
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args) {
      const action = String(args.action ?? '').trim();
      if (action === 'list') {
        const watches = listWatches();
        return {
          ok: true,
          detail: watches.length
            ? watches.map((w) => `- ${w.sessionId}${w.once ? ' (once)' : ''}${w.pending?.length ? ' (pending delivery)' : ''}${w.lastError ? ` [delivery failed: ${w.lastError}]` : ''}${w.note ? ` — ${w.note}` : ''}`).join('\n')
            : 'No active watches.',
        };
      }
      if (action === 'add') {
        const result = addWatch({
          sessionId: String(args.sessionId ?? ''),
          note: String(args.note ?? ''),
          once: args.once !== false,
        });
        if (!result.ok) return { ok: false, detail: `Watch failed: ${result.error}` };
        return { ok: true, detail: `Watching ${result.watch.sessionId}${result.watch.once ? ' (once)' : ''}.` };
      }
      if (action === 'remove') {
        const result = removeWatch(String(args.sessionId ?? ''));
        return result.ok
          ? { ok: true, detail: 'Watch removed.' }
          : { ok: false, detail: `No watch on ${String(args.sessionId ?? '')}.` };
      }
      return { ok: false, detail: 'action must be add | remove | list.' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_schedule',
    description:
      'Schedule a wake-up for yourself: inMinutes (one-shot), everyMinutes (repeating), or '
      + 'daily "HH:MM". When it fires, the text lands in your session as a prompt — write it '
      + 'as an instruction to your future self. list / remove by id. Persists across restarts.',
    timeoutMs: 10_000,
    parameters: {
      action: { type: 'string', required: true, description: 'add | remove | list' },
      id: { type: 'string', description: 'Schedule id (remove).' },
      text: { type: 'string', description: 'Wake-up instruction (add, required).' },
      inMinutes: { type: 'number', description: 'One-shot delay in minutes.' },
      everyMinutes: { type: 'number', description: 'Repeating interval in minutes (>=1).' },
      daily: { type: 'string', description: 'Daily local time "HH:MM".' },
      maxRuns: { type: 'number', description: 'Stop after N fires (repeating kinds).' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: `Schedule ${String(args.action ?? '')}`,
      kind: 'other',
      content: [{ type: 'text', text: String(args.text ?? args.id ?? '') }],
    }),
    async execute(args) {
      const action = String(args.action ?? '').trim();
      if (action === 'list') {
        const schedules = listSchedules();
        const at = (ms) => new Date(ms).toLocaleString();
        return {
          ok: true,
          detail: schedules.length
            ? schedules.map((s) =>
              `- ${s.id} [${s.kind}${s.everyMinutes ? ` ${s.everyMinutes}m` : ''}${s.daily ? ` ${s.daily}` : ''}]`
              + ` next ${at(s.nextRunAt)}${s.enabled === false ? ' (done)' : ''}${s.lastError ? ` [delivery failed: ${s.lastError}]` : ''}: ${s.text}`).join('\n')
            : 'No schedules.',
        };
      }
      if (action === 'add') {
        const result = addSchedule(args);
        if (!result.ok) return { ok: false, detail: `Schedule failed: ${result.error}` };
        const s = result.schedule;
        return { ok: true, detail: `Scheduled ${s.id} (${s.kind}), next run ${new Date(s.nextRunAt).toLocaleString()}.` };
      }
      if (action === 'remove') {
        const result = removeSchedule(String(args.id ?? ''));
        return result.ok
          ? { ok: true, detail: 'Schedule removed.' }
          : { ok: false, detail: `No schedule ${String(args.id ?? '')}.` };
      }
      return { ok: false, detail: 'action must be add | remove | list.' };
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_cancel_session',
    description:
      'Cancel the running turn in a session (its queued messages stay). Returns whether the '
      + 'cancel was admitted; a session with no live turn reports a failure instead.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Session to cancel.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Cancel session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.cancel !== 'function') return unavailable();
      const sessionId = String(args.sessionId ?? '').trim();
      if (!sessionId) return { ok: false, detail: 'sessionId is required.' };
      try {
        await controller.cancel({ sessionId });
        return { ok: true, detail: `Cancel admitted for ${sessionId}.` };
      } catch (error) {
        return failed(error);
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_rename_session',
    description: 'Rename a session\'s title.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', required: true },
      title: { type: 'string', required: true, description: 'New title.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Rename session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.title ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.rename !== 'function') return unavailable();
      const sessionId = String(args.sessionId ?? '').trim();
      const title = String(args.title ?? '').trim();
      if (!sessionId || !title) return { ok: false, detail: 'sessionId and title are required.' };
      try {
        const result = await controller.rename({ sessionId, title });
        return { ok: true, detail: `Renamed to "${result?.title ?? title}".` };
      } catch (error) {
        return failed(error);
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_fork_session',
    description:
      'Fork a session into a new one — optionally anchored at an event seq (atSeq inclusive, '
      + 'or beforeSeq exclusive) so the copy holds only that prefix.',
    timeoutMs: 20_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Source session id.' },
      atSeq: { type: 'number', description: 'Fork including this event seq.' },
      beforeSeq: { type: 'number', description: 'Fork the prefix before this event seq.' },
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
      title: 'Fork session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.fork !== 'function') return { ...unavailable(), sessionId: '' };
      const sessionId = String(args.sessionId ?? '').trim();
      if (!sessionId) return { ok: false, sessionId: '', detail: 'sessionId is required.' };
      if (sessionId === getSelfId()) {
        return { ok: false, sessionId: '', detail: 'The whale assistant has one resident conversation and cannot fork herself.' };
      }
      const request = { sessionId };
      const atSeq = Number(args.atSeq);
      const beforeSeq = Number(args.beforeSeq);
      if (Number.isFinite(atSeq) && atSeq > 0) request.atSeq = Math.floor(atSeq);
      else if (Number.isFinite(beforeSeq) && beforeSeq > 0) request.beforeSeq = Math.floor(beforeSeq);
      try {
        const result = await controller.fork(request);
        const forkId = String(result?.sessionId ?? '');
        return { ok: true, sessionId: forkId, detail: `Forked ${sessionId} -> ${forkId}.` };
      } catch (error) {
        return { ...failed(error), sessionId: '' };
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_delete_session',
    description:
      'Permanently delete an ARCHIVED session and its subagent children. Only archived '
      + 'sessions can be deleted — this is irreversible, so say what you are deleting first.',
    timeoutMs: 20_000,
    parameters: {
      sessionId: { type: 'string', required: true, description: 'Archived session id to delete.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Delete session',
      kind: 'other',
      content: [{ type: 'text', text: String(args.sessionId ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.delete !== 'function') return unavailable();
      const sessionId = String(args.sessionId ?? '').trim();
      if (!sessionId) return { ok: false, detail: 'sessionId is required.' };
      try {
        const result = await controller.delete({ sessionId });
        const count = result?.deletedSessionIds?.length ?? 0;
        return { ok: true, detail: `Deleted ${count} session(s) rooted at ${sessionId}.` };
      } catch (error) {
        return failed(error);
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_select_model',
    description:
      'Change one session\'s model selection (session-local only, never the app default). '
      + 'provider + model ids come from the desktop model catalog.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', required: true },
      provider: { type: 'string', required: true, description: 'Provider id (e.g. deepseek).' },
      model: { type: 'string', required: true, description: 'Model id.' },
      reasoningEffort: { type: 'string', description: 'Optional reasoning effort id.' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: 'Select model',
      kind: 'other',
      content: [{ type: 'text', text: `${String(args.provider ?? '')}/${String(args.model ?? '')}` }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.selectModel !== 'function') return unavailable();
      const sessionId = String(args.sessionId ?? '').trim();
      const provider = String(args.provider ?? '').trim();
      const model = String(args.model ?? '').trim();
      const reasoningEffort = String(args.reasoningEffort ?? '').trim();
      if (!sessionId || !provider || !model) {
        return { ok: false, detail: 'sessionId, provider and model are required.' };
      }
      try {
        const result = await controller.selectModel({
          sessionId,
          provider,
          model,
          ...(reasoningEffort ? { reasoningEffort } : {}),
          saveAsDefault: false,
        });
        const sel = result?.selected ?? { provider, model, reasoningEffort };
        return { ok: true, detail: `Session ${sessionId} now on ${sel.provider}/${sel.model}.` };
      } catch (error) {
        return failed(error);
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'whale_update_queue',
    description:
      'Mutate one still-pending queued message: remove it, steer it into the running turn, '
      + 'or edit its text. Item ids come from whale_session_queue.',
    timeoutMs: 15_000,
    parameters: {
      sessionId: { type: 'string', required: true },
      itemId: { type: 'string', required: true, description: 'Queue item id.' },
      action: { type: 'string', required: true, description: 'edit | remove | steer' },
      text: { type: 'string', description: 'Replacement text (edit only).' },
    },
    output: genericOutput,
    presentCall: (args) => ({
      card: 'generic',
      title: `Queue ${String(args.action ?? '')}`,
      kind: 'other',
      content: [{ type: 'text', text: String(args.itemId ?? '') }],
    }),
    async execute(args) {
      const controller = controllerFrom(ctx);
      if (typeof controller?.updateQueue !== 'function') return unavailable();
      const sessionId = String(args.sessionId ?? '').trim();
      const itemId = String(args.itemId ?? '').trim();
      const action = String(args.action ?? '').trim();
      if (!sessionId || !itemId || !action) {
        return { ok: false, detail: 'sessionId, itemId and action are required.' };
      }
      let queueAction;
      if (action === 'remove') queueAction = { kind: 'remove' };
      else if (action === 'steer') queueAction = { kind: 'steer' };
      else if (action === 'edit') {
        const text = String(args.text ?? '').trim();
        if (!text) return { ok: false, detail: 'edit needs a non-empty text.' };
        queueAction = { kind: 'edit', content: [{ type: 'text', text }] };
      } else {
        return { ok: false, detail: 'action must be edit | remove | steer.' };
      }
      try {
        await controller.updateQueue({ sessionId, itemId, action: queueAction });
        return { ok: true, detail: `Queue item ${itemId} ${action} applied.` };
      } catch (error) {
        return failed(error);
      }
    },
  }));
}
