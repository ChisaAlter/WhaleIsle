/** Durable origin of a chat binding; legacy bindings remain distinguishable. */
export function normalizeBindings(value, sessions) {
  const result = {};
  for (const [key, row] of Object.entries(value ?? {})) {
    if (row?.sessionId === sessions[key]
      && ['manual', 'auto', 'whale-auto'].includes(row.kind)) {
      result[key] = { sessionId: row.sessionId, kind: row.kind, preset: row.preset ?? null };
    }
  }
  return result;
}

export function bindingValue(sessionId, options) {
  return { sessionId, kind: options?.kind ?? 'manual', preset: options?.preset ?? null };
}

/** Resolve one binding without deleting an unclassified legacy conversation. */
export async function selectConversationSession(harness, state, key, resolution) {
  const bound = state.sessionFor(key);
  const origin = state.bindingFor?.(key);
  const isWhale = Boolean(bound && bound === resolution.residentId);
  if (origin?.kind === 'manual') {
    if (!resolution.sessionId && (isWhale || (typeof harness.sessionPreset === 'function' && await harness.sessionPreset(bound) === 'whale-girl'))) {
      throw Object.assign(new Error('鲸鱼娘 IM 已关闭或预设已切换；请显式选择其他会话。'), { code: 'whale-im-disabled' });
    }
    return { sessionId: bound, shared: isWhale, origin };
  }
  if (resolution.sessionId) {
    return { sessionId: resolution.sessionId, shared: true,
      origin: { kind: 'whale-auto', preset: 'whale-girl' } };
  }
  if (origin?.kind === 'whale-auto'
    || (origin?.kind === 'auto' && origin.preset !== resolution.preset)) {
    await state.clearSession(key);
    return { sessionId: null, shared: false, origin: { kind: 'auto', preset: resolution.preset } };
  }
  if (!origin && bound && !isWhale && typeof harness.sessionPreset === 'function') {
    const preset = await harness.sessionPreset(bound);
    if (preset === 'whale-girl' && !resolution.sessionId) throw Object.assign(new Error('旧鲸鱼娘绑定来源不明，请用 /new 或 /session 明确选择；历史保留。'), { code: 'whale-binding-review' });
  }
  if (isWhale && !origin) {
    throw Object.assign(new Error('旧鲸鱼娘绑定的来源不明，已阻止继续执行。请用 /new 清除此聊天绑定，或 /session 明确选择会话；历史保留。'), { code: 'whale-binding-review' });
  }
  return { sessionId: bound, shared: false,
    origin: origin ?? (bound ? null : { kind: 'auto', preset: resolution.preset }) };
}
