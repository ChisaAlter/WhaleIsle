/**
 * Shared helpers for the dsh-whale surface: controller resolution, session
 * row shaping, follow-snapshot reads, and the small generic output schema
 * most whale_* tools reuse. Kept import-free of cordis so every lib file
 * (tools.js, session-tools.js, desktop-tools.js, observe.js) can share it
 * without cycles.
 */

export function trimTo(value, max) {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max) : text;
}

export function controllerFrom(ctx) {
  try {
    return ctx.get?.('sessionController') ?? ctx.sessionController;
  } catch {
    try {
      return ctx.sessionController;
    } catch {
      return undefined;
    }
  }
}

export function sessionRowsFrom(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.sessions)) return value.sessions;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

export function sessionIdFromRow(row) {
  return String(row?.sessionId ?? row?.id ?? '').trim();
}

/**
 * @param {any} row
 * @param {any} presentation
 */
function titleFromRow(row, presentation) {
  const projected = row?.projections?.values?.title;
  if (presentation.title) return String(presentation.title);
  if (typeof projected === 'string' && projected) return projected;
  return String(row?.title ?? row?.name ?? '');
}

export function rowSummary(row) {
  const presentation = row?.projections?.values?.sessionListMetadata?.presentation ?? {};
  return {
    sessionId: sessionIdFromRow(row),
    title: titleFromRow(row, presentation),
    owner: String(presentation.owner ?? ''),
    cwd: String(row?.cwd ?? ''),
    updatedAt: row?.updatedAt ?? row?.lastActiveAt ?? 0,
    status: row?.running === true ? 'running' : String(row?.status ?? row?.state ?? ''),
  };
}

export const genericOutput = {
  schema: /** @type {const} */ ({
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      detail: { type: 'string', required: true },
    },
  }),
  render: (/** @type {any} */ _args, /** @type {{ ok: boolean, detail: string }} */ value) => [
    { type: /** @type {const} */ ('text'), text: value.detail },
  ],
};

/** Text of one durable message event (content blocks or a bare string). */
export function eventText(ev) {
  const content = ev?.data?.message?.content ?? ev?.data?.content;
  if (typeof content === 'string') return content;
  const parts = [];
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

export const SYSTEM_REMINDER_RE = /^<system-reminder>[\s\S]*?<\/system-reminder>/;

/**
 * One follow-snapshot read: the opening frame carries the recent records
 * window plus the projection baseline, then we abort — cold-safe and cheap.
 * Returns { header, cursor, records, hasMore, projections } or null.
 */
export async function sessionSnapshot(controller, sessionId, maxMessages) {
  const ac = new AbortController();
  try {
    const it = controller.follow(
      { address: { kind: 'session', sessionId }, maxMessages },
      ac.signal,
    );
    const first = await it[Symbol.asyncIterator]().next();
    return first?.value?.type === 'snapshot' ? first.value : null;
  } catch {
    return null;
  } finally {
    ac.abort();
  }
}

/**
 * One control-stream baseline read: queues, jobs, and projections for every
 * session, then abort. Used by the queue-overview tool.
 */
export async function controlBaseline(controller) {
  const ac = new AbortController();
  try {
    const it = controller.control(ac.signal);
    const first = await it[Symbol.asyncIterator]().next();
    return first?.value?.type === 'baseline' ? first.value.value : null;
  } catch {
    return null;
  } finally {
    ac.abort();
  }
}
