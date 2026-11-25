/**
 * Auxiliary LLM call classification and conversation prompt projection helpers
 * shared by the host LLM adapter.
 */

const AUTHORED_USER_SOURCES = new Set(['user', 'agent-message', 'subagent-settled']);

function isAuthoredUserMessage(message) {
  if (!message || message.role !== 'user') return false;
  const sourceKind = message.source?.kind;
  return sourceKind === undefined || AUTHORED_USER_SOURCES.has(sourceKind);
}

function extractMessageBlocks(content) {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text });
    } else if ((block.type === 'file' || block.type === 'image') && block.attachment) {
      blocks.push(block);
    }
  }
  return blocks;
}

function formatTranscriptBlock(block) {
  if (block?.type === 'text') return block.text;
  if ((block?.type === 'file' || block?.type === 'image') && block.attachment) {
    return `[Attached ${block.type}: ${block.attachment.name || block.attachment.path || 'attachment'}]`;
  }
  return '';
}

function formatTranscriptMessage(message) {
  const text = typeof message.content === 'string'
    ? message.content
    : (message.content || []).map(formatTranscriptBlock).filter(Boolean).join('\n');
  return text ? `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${text}` : '';
}

function collectRelevantAttachments(relevant, prompt) {
  for (const message of relevant) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === 'image' && block.attachment && !block.offloaded) prompt.push(block);
      if (block.type === 'file' && block.attachment) prompt.push(block);
    }
  }
}

/**
 * Auxiliary LLM calls (session title, compaction, vision describe, and the
 * next-prompt predictor) must not become ACP conversation turns.
 */
export function isAuxiliaryCall(callOptions) {
  if (!callOptions || typeof callOptions !== 'object') return false;
  if (callOptions.purpose !== undefined) return true;
  const tools = callOptions.tools;
  if (!Array.isArray(tools) || tools.length !== 0) return false;
  const text = (callOptions.messages ?? [])
    .map((m) => {
      if (typeof m?.content === 'string') return m.content;
      if (Array.isArray(m?.content)) return m.content.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
      return '';
    })
    .join('\n');
  return text.includes('Conversation reference data')
    || text.includes("USER'S NEXT message")
    || text.includes('Predict one short message');
}

/** Extract the latest user turn's prompt blocks from `GenerateOptions.messages`. */
export function extractLatestUserPromptBlocks(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ type: 'text', text: '' }];
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (!isAuthoredUserMessage(messages[i])) continue;
    const blocks = extractMessageBlocks(messages[i].content);
    if (blocks.length > 0) return blocks;
  }
  return [{ type: 'text', text: 'Continue.' }];
}

/** Pure helper: compute prompt blocks & next cursor without mutating connection. */
export function prepareConversationPrompt(messages, connection = {}, options = {}) {
  const rows = Array.isArray(messages) ? messages : [];
  const latest = extractLatestUserPromptBlocks(rows);
  const nextCursor = rows.findLast(isAuthoredUserMessage)?.id;

  // Native slash commands (e.g. /compact, /clear) must pass through verbatim
  // on any turn without wrapping in "Conversation context".
  if (latest.length > 0 && latest[0]?.type === 'text' && String(latest[0].text || '').trimStart().startsWith('/')) {
    return { prompt: latest, nextCursor };
  }

  const previous = connection?.promptCursor;
  const index = previous ? rows.findIndex((message) => message.id === previous) : -1;
  const relevant = index >= 0
    ? rows.slice(index + 1)
    : connection?.restoredSession && !connection?.promptStarted
      ? []
      : rows;

  const ownAssistantId = options.lastAssistantId ?? connection?.lastAssistantMessageId;
  const ownProvider = options.providerId ?? connection?.agentConfig?.providerId;
  const authoredAndAssistant = relevant.filter(
    (message) => message.role === 'assistant' || isAuthoredUserMessage(message),
  );

  // On consecutive turns of the same stateful ACP agent, skip re-injecting the
  // agent's own immediately preceding assistant reply.
  if (index >= 0 && (ownAssistantId || ownProvider)) {
    const assistants = authoredAndAssistant.filter((message) => message.role === 'assistant');
    const users = authoredAndAssistant.filter(isAuthoredUserMessage);
    const allOwnAssistants = assistants.length > 0 && assistants.every(
      (message) => (ownAssistantId && message.id === ownAssistantId)
        || (ownProvider && message.provider === ownProvider),
    );
    if (allOwnAssistants && users.length <= 1) {
      return { prompt: latest, nextCursor };
    }
  }

  const transcript = authoredAndAssistant
    .map(formatTranscriptMessage)
    .filter(Boolean);
  const prompt = transcript.length > 1
    ? [{ type: 'text', text: 'Conversation context (earlier turns may have used another agent):\n\n' + transcript.join('\n\n') }]
    : latest;
  if (transcript.length > 1) collectRelevantAttachments(relevant, prompt);
  return { prompt, nextCursor };
}

/** Seed a newly selected agent with the visible conversation, then relay only missed turns. */
export function conversationPrompt(messages, connection, options) {
  const { prompt, nextCursor } = prepareConversationPrompt(messages, connection, options);
  if (connection && typeof connection === 'object') {
    connection.promptCursor = nextCursor;
    connection.promptStarted = true;
  }
  return prompt;
}
