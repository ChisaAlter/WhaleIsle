// Session projection views shared with Android NativeSessionData.kt:
// queued user input (`inbox`) and the optional usage panel totals.

const QUEUE_TARGETS = ['next-turn', 'next-step'];

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** Only identified user input is offered for queue mutation; non-text blocks stay intact. */
function queuedMessages(values) {
  const inbox = objectValue(objectValue(values).inbox);
  const items = [];
  for (const target of QUEUE_TARGETS) {
    for (const message of Array.isArray(inbox[target]) ? inbox[target] : []) {
      if (!message || typeof message !== 'object') continue;
      const id = typeof message.id === 'string' ? message.id : '';
      if (!id || objectValue(message.source).kind !== 'user') continue;
      const content = Array.isArray(message.content) ? message.content : [];
      const hasAttachments = content.some((block) => objectValue(block).type !== 'text');
      items.push({
        id,
        target,
        text: content.filter((block) => objectValue(block).type === 'text').map((block) => String(block.text || '')).join('\n'),
        editable: content.length > 0 && !hasAttachments,
        hasAttachments,
      });
    }
  }
  return items;
}

/** An unpublished or incomplete usage projection stays absent; zeros are never invented. */
function sessionUsage(values) {
  const totals = objectValue(objectValue(objectValue(values).usagePanel).totals);
  const count = (name) => (Number.isFinite(totals[name]) && totals[name] >= 0 ? totals[name] : null);
  const usage = { input: count('input'), output: count('output'), cacheRead: count('cacheRead'), cacheWrite: count('cacheWrite') };
  return Object.values(usage).some((value) => value === null) ? null : usage;
}

/** The `session.updateQueue` request for one queued item, validated like Android. */
function queueUpdate(sessionId, item, kind, { text = '', running = false } = {}) {
  if (!item) throw new Error('这条消息已不在待发送队列，请等待同步');
  const action = { kind };
  if (kind === 'edit') {
    if (!item.editable || item.hasAttachments || !text.trim()) throw new Error('只能编辑非空的纯文本待发送消息');
    action.content = [{ type: 'text', text }];
  } else if (kind === 'steer') {
    if (item.target !== 'next-turn' || !running) throw new Error('当前回复已结束，无法转入这条消息');
  } else if (kind !== 'remove') {
    throw new Error('未知队列操作');
  }
  return { sessionId, itemId: item.id, action };
}

function formatTokens(count) {
  if (!Number.isFinite(count)) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}K`;
  return String(count);
}

export { formatTokens, queuedMessages, queueUpdate, sessionUsage };
