import crypto from 'node:crypto';
import { acpErrorMessage } from './errors.js';
import {
  abortSignalError,
  hostToolName,
  TurnQueue,
} from './acp-session-utils.js';

export function extractToolCallOutputText(toolCall) {
  const data = toolCall?.data;
  if (!data || typeof data !== 'object') return '';
  const raw = data.rawOutput ?? data.output;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw.text === 'string') return raw.text;
  const content = data.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.type === 'content' && part.content?.type === 'text'
        ? part.content.text : typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export class AcpTurnExecution {
  constructor({ connection, promptBlocks, signal, hostAgent }) {
    this.connection = connection;
    this.promptBlocks = promptBlocks;
    this.signal = signal;
    this.hostAgent = hostAgent;
    this.turnKey = crypto.randomUUID();
    this.queue = new TurnQueue();
    this.toolCalls = new Map();
    this.usage = null;
    this.contextUsage = null;
    this.stopReason = null;
    this.promptDone = false;
    this.promptPromise = null;
    this._onAbort = null;
  }

  registerToolCall(fields) {
    const existing = this.toolCalls.get(fields.toolCallId);
    if (existing) {
      Object.assign(existing, fields);
      return existing;
    }
    const entry = {
      waiters: [],
      onPermissionArrived: null,
      pendingPermission: null,
      outputText: '',
      status: 'pending',
      ...fields,
    };
    entry.name = hostToolName(entry.kind);
    this.toolCalls.set(entry.toolCallId, entry);
    // Native tools execute independently of the Host mirror. Only a settled
    // receipt enters the synchronous Host executor; pending/background work
    // must not block consumption of later native text and tool updates.
    this.publishTool(entry);
    return entry;
  }

  publishTool(entry) {
    if (!entry.projected && !entry.projectionQueued && ['completed', 'failed'].includes(entry.status)) {
      entry.projectionQueued = true;
      this.queue.push({ type: 'tool-call', entry });
    }
  }

  reportActivity() {
    this.connection.onActivity?.({
      lastActivityAt: Date.now(), usagePending: !this.promptDone,
      activeTools: [...this.toolCalls.values()]
        .filter(entry => !['completed', 'failed'].includes(entry.status))
        .map(entry => ({ id: entry.toolCallId, title: entry.title || entry.name, status: entry.status })),
    });
  }

  _normalizeToolStatus(status) {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'inProgress') return 'in_progress';
    return 'pending';
  }

  _applySubagentToolUpdate(conn, tc, fields) {
    const subagent = conn?._extractSubagentUpdate(tc);
    if (subagent) {
      fields.subagent = subagent;
      fields.title = subagent.title || fields.title;
      if (subagent.status === 'completed' || subagent.status === 'failed') fields.status = subagent.status;
      if (subagent.result) fields.outputText = subagent.result;
      if (subagent.childSessionId && conn) {
        conn._subagentToolByChildSession.set(subagent.childSessionId, tc.toolCallId);
      }
    }
    // ACP runtime isProvisionalSubagentTool: claude emits a placeholder Task tool
    // before its input arrives — keep it pending and unnamed until then.
    if (conn?._isProvisionalSubagentTool?.(tc)) {
      fields.status = 'pending';
      fields.provisional = true;
    }
  }

  _handleToolCallUpdated(event) {
    const conn = this.connection;
    const tc = conn?._normalizeToolCall(event.toolCall) ?? event.toolCall;
    if (!tc?.toolCallId) return;
    const entry = this.toolCalls.get(tc.toolCallId);
    const fields = {
      toolCallId: tc.toolCallId,
      name: hostToolName(tc.kind),
      kind: tc.kind,
      title: tc.title || tc.command || '',
      args: tc.data?.rawInput ?? tc.data ?? {},
      locations: tc.data?.locations,
      status: this._normalizeToolStatus(tc.status),
    };
    this._applySubagentToolUpdate(conn, tc, fields);
    if (entry) {
      Object.assign(entry, fields);
      const outputText = extractToolCallOutputText(tc);
      if (outputText) entry.outputText = outputText;
      for (const waiter of entry.waiters.splice(0)) waiter();
    } else {
      const created = this.registerToolCall(fields);
      const outputText = extractToolCallOutputText(tc);
      if (outputText) created.outputText = outputText;
    }
    this.publishTool(this.toolCalls.get(tc.toolCallId));
    this.reportActivity();
  }

  handleEvent(event) {
    switch (event?._tag) {
      case 'ContentDelta':
        if (event.text) this.queue.push({ type: 'text', text: event.text });
        if (event.text) this.reportActivity();
        return;
      case 'ThoughtDelta':
        if (event.text) this.queue.push({ type: 'thought', text: event.text });
        if (event.text) this.reportActivity();
        return;
      case 'ToolCallUpdated':
        this._handleToolCallUpdated(event);
        return;
      case 'UsageUpdated': {
        // ACP runtime normalizes all ACP usage into context-window occupancy
        // ({usedTokens, maxTokens?, cost?}), not per-turn input/output. Keep it
        // as a side channel; real turn usage comes from the PromptResponse.
        const usage = event.usage || {};
        this.contextUsage = {
          usedTokens: Number(usage.usedTokens) || 0,
          ...(usage.maxTokens ? { maxTokens: Number(usage.maxTokens) } : {}),
          ...(usage.cost ? { cost: usage.cost } : {}),
        };
        return;
      }
      default:
        return;
    }
  }

  _handleAbort() {
    // session/cancel must reach the agent before local teardown — otherwise
    // the agent keeps running a turn nobody is consuming (AC-002).
    try {
      this.connection.api?.cancel?.().catch(() => { /* Local abort still fails the active turn if the remote cancel channel is closed. */ });
    } catch { /* Local abort below still fails the turn when the remote cancel channel is closed. */ }
    this.fail(abortSignalError());
    this.connection.workQuarantined = true;
  }

  _clearAbortListener() {
    if (this._onAbort && this.signal) {
      this.signal.removeEventListener('abort', this._onAbort);
    }
    this._onAbort = null;
  }

  attachSignal(signal) {
    this._clearAbortListener();
    this.signal = signal;
    if (!signal || this.promptDone) return;
    this._onAbort = () => this._handleAbort();
    if (signal.aborted) this._handleAbort();
    else signal.addEventListener('abort', this._onAbort, { once: true });
  }

  beginPrompt() {
    const api = this.connection.api;
    this.attachSignal(this.signal);
    this.promptPromise = api
      .makeDeferred()
      .then((dispatched) =>
        // Cancel already fired: dispatching now would start a fresh turn the
        // agent no longer knows to stop.
        this.signal?.aborted
          ? { stopReason: 'cancelled' }
          : api.prompt({ prompt: this.promptBlocks }, { dispatched }),
      )
      .then((result) => {
        if (this.promptDone) return;
        this.promptResponse = result;
        if (this.connection.protocolVersion === 2 && this.connection.agentWork && this.connection.agentWork.state !== 'idle' && result?.stopReason !== 'error') return;
        this.complete(result);
      })
      .catch((error) => this.fail(error));
    this.promptPromise.catch(() => { /* The original prompt promise is returned and reports failure to its caller. */ });
    return this.promptPromise;
  }

  complete(result) {
    if (this.promptDone) return;
    if (result?.stopReason === 'error') {
      const error = new Error(result.error?.message || 'ACP provider turn failed.');
      error.code = result.error?.code;
      error.data = result.error?.data;
      this.stopReason = 'error';
      this.fail(error);
      return;
    }
    this._clearAbortListener();
    this.promptDone = true;
    // PromptResponse carries the real per-turn ACP Usage and stopReason.
    this.stopReason = result?.stopReason || null;
    const usage = result?.usage;
    if (usage) {
      this.usage = {
        inputTokens: Number(usage.inputTokens) || 0,
        outputTokens: Number(usage.outputTokens) || 0,
        totalTokens: Number(usage.totalTokens) || 0,
        ...(usage.thoughtTokens ? { reasoningTokens: Number(usage.thoughtTokens) } : {}),
        ...(usage.cachedReadTokens ? { cacheReadTokens: Number(usage.cachedReadTokens) } : {}),
        ...(usage.cachedWriteTokens ? { cacheWriteTokens: Number(usage.cachedWriteTokens) } : {}),
      };
    }
    // Some ACP agents finish the prompt without sending a final tool
    // update. The host is waiting in tools/execute, not reading our queue.
    this._settleTools(this.stopReason === 'end_turn' ? null : new Error(`Agent stopped: ${this.stopReason || 'unknown'}`));
    this.queue.push({ type: 'prompt-done', stopReason: this.stopReason });
    this.queue.close();
  }

  _settleTools(error) {
    for (const [, entry] of this.toolCalls) {
      if (entry.pendingPermission) {
        entry.pendingPermission.resolve('cancelled');
        entry.pendingPermission = null;
      }
      if (entry.status !== 'completed' && entry.status !== 'failed') {
        entry.status = error ? 'failed' : 'completed';
        entry.outputText ||= error ? acpErrorMessage(error) : 'Agent turn completed without a separate tool result.';
      }
      for (const waiter of entry.waiters.splice(0)) waiter();
      this.publishTool(entry);
    }
    this.reportActivity();
  }

  fail(error) {
    if (this.promptDone) return;
    this._clearAbortListener();
    this.promptDone = true;
    this._settleTools(error);
    this.connection?.onTurnFailed?.(this, error);
    this.queue.push({ type: 'prompt-error', error });
    this.queue.close();
  }
}
