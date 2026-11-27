// Helpers for idempotent Bot Work Item quick-ask / stepper submissions.

export interface QuickAskItemLike {
  uid: string;
  questionEventId?: number | string | null;
  question?: {
    id?: number | string;
    eventId?: number | string;
  } | null;
}

export interface QuickAskEventLike {
  id?: number | string;
  eventId?: number | string;
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function resolveItemQuestionEventId(
  item: QuickAskItemLike | null | undefined,
  fallbackEvent?: QuickAskEventLike | null,
): number | string | undefined {
  const candidate = item?.question?.eventId
    ?? item?.questionEventId
    ?? item?.question?.id
    ?? fallbackEvent?.eventId
    ?? fallbackEvent?.id;
  return candidate === null || candidate === undefined ? undefined : candidate;
}

export function askLockKey(uid: string, questionEventId: number | string | undefined | null): string {
  return `${uid}:${questionEventId ?? 'none'}`;
}

export function buildQuickAskChoiceKey(
  decisions: ReadonlyArray<{ picks: readonly number[] }> | undefined,
  text: string,
): string {
  if (Array.isArray(decisions) && decisions.length > 0) {
    const encoded = decisions
      .map((dec, idx) => `${idx}:${[...dec.picks].sort((a, b) => a - b).join(',')}`)
      .join('|');
    if (encoded) {
      return encoded;
    }
  }
  return `t:${fnv1aHex(text.trim())}`;
}

/** Deterministic idempotent requestId (<= 128 chars) keyed by (uid, questionEventId, choiceKey). */
export function buildQuickAskRequestId(
  uid: string,
  questionEventId: number | string | undefined | null,
  decisions: ReadonlyArray<{ picks: readonly number[] }> | undefined,
  text: string,
): string {
  const qPart = questionEventId !== undefined && questionEventId !== null ? String(questionEventId) : 'none';
  const choiceKey = buildQuickAskChoiceKey(decisions, text);
  const full = `ask:${uid}:${qPart}:${choiceKey}`;
  if (full.length <= 128) {
    return full;
  }
  return `ask:${uid}:${qPart}:${fnv1aHex(choiceKey)}`.slice(0, 128);
}

export function buildOwnerAnswerPayload(
  questionEventId: number | string | undefined | null,
  decisions: ReadonlyArray<{ picks: readonly number[] }> | undefined,
): {
  decisions?: Array<{ picks: number[] }>;
  questionEventId?: number | string;
  answers?: number | string;
} {
  return {
    ...(decisions ? { decisions: decisions.map((d) => ({ picks: [...d.picks] })) } : {}),
    ...(questionEventId !== undefined && questionEventId !== null
      ? { questionEventId, answers: questionEventId }
      : {}),
  };
}
