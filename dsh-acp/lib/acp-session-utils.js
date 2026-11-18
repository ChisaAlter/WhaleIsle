import path from 'node:path';

export function abortSignalError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

// ACP runtime adapter.ts providerRequestKind — approved "command" requests feed the
// terminal/create execute grant.
export function providerRequestKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'read' || k === 'search' || k === 'fetch') return 'file-read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'file-change';
  return 'command';
}

// Host decisions arrive as booleans/'cancelled' today; a richer host may pass
// the runtime's decision vocabulary through. Unknown values decline (fail-closed).
export function permissionDecisionOf(approved) {
  if (approved === 'cancelled' || approved === 'cancel') return 'cancel';
  if (approved === true || approved === 'accept' || approved === 'allowed-once') return 'accept';
  if (
    approved === 'acceptForSession'
    || approved === 'allow_always'
    || approved === 'allow-always'
    || approved === 'allowed-always'
  ) {
    return 'acceptForSession';
  }
  return 'decline';
}

const ACP_TOOL_KINDS = new Set([
  'read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode',
]);

// Host tool-call contract: the yielded block.name must satisfy
// [A-Za-z0-9_-]{1,64} and resolve to a registered tool.
export function hostToolName(kind) {
  const k = String(kind || '').toLowerCase();
  return ACP_TOOL_KINDS.has(k) ? `acp_${k}` : 'acp_tool';
}

function selectPermissionOptionId(request, decision) {
  const kind =
    decision === 'acceptForSession'
      ? 'allow_always'
      : decision === 'accept'
        ? 'allow_once'
        : 'reject_once';
  const list = Array.isArray(request?.options) ? request.options : [];
  const found = list.find((option) => option?.kind === kind);
  const optionId = String(found?.optionId || '').trim();
  return optionId || undefined;
}

function selectAutoApprovedPermissionOption(request) {
  return (
    selectPermissionOptionId(request, 'accept')
    ?? selectPermissionOptionId(request, 'acceptForSession')
  );
}

export function permissionOutcome(request, decision) {
  if (decision === 'cancel') {
    return { outcome: { outcome: 'cancelled' } };
  }
  const optionId = selectPermissionOptionId(request, decision);
  return optionId === undefined
    ? { outcome: { outcome: 'cancelled' } }
    : { outcome: { outcome: 'selected', optionId } };
}

export function autoAllowedOutcome(request) {
  const optionId = selectAutoApprovedPermissionOption(request);
  return optionId === undefined
    ? { outcome: { outcome: 'cancelled' } }
    : { outcome: { outcome: 'selected', optionId } };
}

export function agentWiring(agent, commandPath) {
  const registryAgentId = String(agent?.registryAgentId || '');
  const base = path.basename(String(commandPath || '')).toLowerCase();
  const isDevin =
    registryAgentId === 'devin' || /^devin(?:\.(exe|cmd))?$/i.test(base);
  const isClaude =
    registryAgentId === 'claude-acp' || /^claude-agent-acp(?:\.(exe|cmd))?$/i.test(base);
  const isCopilot =
    registryAgentId === 'github-copilot-cli' || /^copilot(?:\.(exe|cmd))?$/i.test(base);
  const isAntigravity =
    registryAgentId === 'antigravity-acp' || /^agy_acp_server(?:\.exe)?$/i.test(base);
  return { registryAgentId, isDevin, isClaude, isCopilot, isAntigravity };
}

const AGY_AUTH_METHODS = new Set([
  'oauth-personal',
  'oauth-business',
  'gemini-api-key',
  'agent-platform',
]);

/** AntigravitySettings equivalent from our agent record + env. */
export function antigravityAuthConfigFor(agent, environment = {}) {
  const raw = String(agent?.acpAuthMethodId || agent?.authMethod || '');
  return {
    authMethod: AGY_AUTH_METHODS.has(raw) ? raw : 'oauth-personal',
    apiKey: environment.GEMINI_API_KEY || environment.GOOGLE_API_KEY || '',
    gcpProject: environment.AGY_ACP_GCP_PROJECT || environment.GOOGLE_CLOUD_PROJECT || '',
    gcpLocation: environment.AGY_ACP_GCP_LOCATION || environment.GOOGLE_CLOUD_LOCATION || '',
  };
}

export function clientCapabilitiesFor(wiring, clientMeta) {
  const meta = {
    ...(wiring.isDevin
      ? {
          'cognition.ai/subagentSupport': true,
          'cognition.ai/messageGrouping': true,
        }
      : {}),
    ...(clientMeta || {}),
  };
  return {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
    elicitation: { form: {}, url: {} },
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

export class TurnQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(item) {
    if (this.closed) return;
    this.items.push(item);
    this._flush();
  }

  close() {
    this.closed = true;
    this._flush();
  }

  _flush() {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (this.items.length > 0) {
        waiter.cleanup?.();
        waiter.resolve({ value: this.items.shift(), done: false });
      } else if (this.closed) {
        waiter.cleanup?.();
        waiter.resolve({ value: undefined, done: true });
      } else {
        this.waiters.unshift(waiter);
        break;
      }
    }
  }

  next(signal) {
    if (signal?.aborted) {
      return Promise.reject(abortSignalError());
    }
    if (this.items.length > 0) {
      return Promise.resolve({ value: this.items.shift(), done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve };
      const onAbort = () => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(abortSignalError());
      };
      waiter.signal = signal;
      waiter.cleanup = () => signal?.removeEventListener('abort', onAbort);
      signal?.addEventListener?.('abort', onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
