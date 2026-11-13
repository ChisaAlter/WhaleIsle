import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initAgentRuntime,
  runtimeBundle,
  runtimeHomeDir,
  registrySettingsFor,
} from './agent-runtime.js';
import { buildAgentRuntimeEnv, resolveCommandBinary } from './presets.js';
import { acpErrorMessage } from './errors.js';

const STARTUP_TIMEOUT_MS = 30_000;
// Antigravity's managed runtime unpacks ~1 GB on cold start (same bound the
// explicit live probe uses).
const STARTUP_TIMEOUT_AGY_MS = 180_000;
const MAX_WRITTEN_PATHS = 4096;

function abortSignalError() {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

// ACP runtime adapter.ts providerRequestKind — approved "command" requests feed the
// terminal/create execute grant.
function providerRequestKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'read' || k === 'search' || k === 'fetch') return 'file-read';
  if (k === 'edit' || k === 'delete' || k === 'move') return 'file-change';
  return 'command';
}

// Host decisions arrive as booleans/'cancelled' today; a richer host may pass
// the runtime's decision vocabulary through. Unknown values decline (fail-closed).
function permissionDecisionOf(approved) {
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

// Host tool-call contract: the yielded block.name must satisfy
// [A-Za-z0-9_-]{1,64} and resolve to a registered tool. ACP tool calls carry
// free-text titles (e.g. the shell command itself), so map the ACP `kind` to a
// stable host-registered name; the human title stays in `title`/`args._title`.
const ACP_TOOL_KINDS = new Set([
  'read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode',
]);
function hostToolName(kind) {
  const k = String(kind || '').toLowerCase();
  return ACP_TOOL_KINDS.has(k) ? `acp_${k}` : 'acp_tool';
}

// Temporary stage tracing for diagnosing startup hangs. Enabled by
// DSH_ACP_STAGE_LOG=<file path>.
const stageLog = (msg) => {
  const file = process.env.DSH_ACP_STAGE_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${msg}\n`);
  } catch {}
};

// ---------------------------------------------------------------------------
// Permission option selection — verbatim port of ACP runtime adapter.ts:969-990.
// allow → allow_once (fallback allow_always); deny → reject_once.
// ---------------------------------------------------------------------------

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

function permissionOutcome(request, decision) {
  if (decision === 'cancel') {
    return { outcome: { outcome: 'cancelled' } };
  }
  const optionId = selectPermissionOptionId(request, decision);
  return optionId === undefined
    ? { outcome: { outcome: 'cancelled' } }
    : { outcome: { outcome: 'selected', optionId } };
}

function autoAllowedOutcome(request) {
  const optionId = selectAutoApprovedPermissionOption(request);
  return optionId === undefined
    ? { outcome: { outcome: 'cancelled' } }
    : { outcome: { outcome: 'selected', optionId } };
}

// ---------------------------------------------------------------------------
// Per-agent wiring — mirrors ACP runtime provider-acp-registry adapter.ts:185-296.
// Registry ids apply to `source: 'registry'`; local installs are detected by
// command basename exactly like the runtime's copilot/claude local detection.
// ---------------------------------------------------------------------------

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

function clientCapabilitiesFor(wiring, clientMeta) {
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
    // fs handlers are registered for every session; advertising false left
    // them unreachable and broke the writtenPaths delivery record (AC-017).
    fs: { readTextFile: true, writeTextFile: true },
    // Devin runs commands through client terminals and has no ask mode over
    // ACP to fall back on (ACP runtime adapter.ts:286).
    terminal: true,
    elicitation: { form: {}, url: {} },
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

// ---------------------------------------------------------------------------
// Turn machinery — DSH stream-item queue fed by AcpSessionRuntime events.
// Item vocabulary is unchanged for index.js's projection loop.
// ---------------------------------------------------------------------------

class TurnQueue {
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    this.usage = { inputTokens: 0, outputTokens: 0 };
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
    this.queue.push({ type: 'tool-call', entry });
    return entry;
  }

  handleEvent(event) {
    switch (event?._tag) {
      case 'ContentDelta':
        if (event.text) this.queue.push({ type: 'text', text: event.text });
        return;
      case 'ThoughtDelta':
        if (event.text) this.queue.push({ type: 'thought', text: event.text });
        return;
      case 'ToolCallUpdated': {
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
          status:
            tc.status === 'completed'
              ? 'completed'
              : tc.status === 'failed'
                ? 'failed'
                : tc.status === 'inProgress'
                  ? 'in_progress'
                  : 'pending',
        };
        // ACP runtime extractSubagentUpdate: subagent traffic is projected onto the
        // tool call it rode in on (the host surface has no subagent lanes).
        const subagent = conn?._extractSubagentUpdate(tc);
        if (subagent) {
          fields.subagent = subagent;
          fields.title = subagent.title || fields.title;
          if (subagent.status === 'completed') fields.status = 'completed';
          if (subagent.status === 'failed') fields.status = 'failed';
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
        return;
      }
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
      this.connection.api?.cancel?.().catch(() => {});
    } catch {}
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
    this.promptPromise.catch(() => {});
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
    }
  }

  fail(error) {
    if (this.promptDone) return;
    this._clearAbortListener();
    this.promptDone = true;
    this._settleTools(error);
    this.queue.push({ type: 'prompt-error', error });
    this.queue.close();
  }

  finishQueue() {
    this.queue.close();
  }
}

function extractToolCallOutputText(toolCall) {
  const data = toolCall?.data;
  if (!data || typeof data !== 'object') return '';
  const raw = data.rawOutput ?? data.output;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw.text === 'string') return raw.text;
  const content = data.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

// ---------------------------------------------------------------------------
// Connection — one vendored AcpSessionRuntime per (sessionId, agentId).
// ---------------------------------------------------------------------------

export class AcpSessionConnection {
  constructor({ ctx, agentConfig, cwd, onModelsDiscovered, mcpInjection, resumeSessionId, requestApproval, requestUserInput, getRuntimePolicy }) {
    this.ctx = ctx;
    this.agentConfig = agentConfig;
    this.cwd = cwd;
    this.onModelsDiscovered = onModelsDiscovered;
    this.mcpInjection = mcpInjection;
    this.resumeSessionId = resumeSessionId || null;
    this.requestApproval = requestApproval;
    this.requestUserInput = requestUserInput;
    this.getRuntimePolicy = getRuntimePolicy;
    this.supportsImages = false;

    this.closed = false;
    this.readyPromise = null;
    this.handle = null;
    this.api = null;
    this.terminals = null;
    this.activeTurn = null;
    this.writtenPaths = new Set();
    this._policyGrants = null;
    this._customModels = [];
    this._refreshSeq = 0;

    this.acpSessionId = null;
    this.acpAuthenticated = false;
    this.currentModel = null;
    this.currentModeId = null;
    this.currentEffort = null;
    this.availableModes = [];
    this.availableCommands = [];
    this.configOptions = [];
    this.driverKind = 'acp';
    this.claudeResumeSessionId = null;
    this.mcpToken = mcpInjection?.token || null;

    // Provider-flavor state (ACP runtime AcpAdapterV2Flavor equivalents).
    this.wiring = null;
    this._agyOptions = null;
    this._copilotRouting = null;
    this._mcpBridge = null;
    // childSessionId → toolCallId, populated by subagent session events so
    // completion notices can settle the tool call they launched.
    this._subagentToolByChildSession = new Map();
    this.backgroundWakePending = false;
    this.pendingBackgroundTurns = [];
  }

  _startupTimeoutMs() {
    const agent = this.agentConfig || {};
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    return agentWiring(agent, commandPath).isAntigravity
      ? STARTUP_TIMEOUT_AGY_MS
      : STARTUP_TIMEOUT_MS;
  }

  async ensureReady(signal) {
    if (this.readyPromise) return this.readyPromise;
    const timeoutMs = this._startupTimeoutMs();
    const started = this._startupPromise = this._start(signal);
    let timer = null;
    let onAbort = null;
    const watchdog = new Promise((_, reject) => {
      if (signal) {
        if (signal.aborted) {
          reject(abortSignalError());
          return;
        }
        onAbort = () => reject(abortSignalError());
        signal.addEventListener?.('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        reject(new Error(
          `ACP agent "${this.agentConfig?.name}" session did not start within ${Math.round(timeoutMs / 1000)}s.`,
        ));
      }, timeoutMs);
      timer.unref?.();
    });
    const release = () => {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener?.('abort', onAbort);
    };
    // `started` keeps running after a watchdog loss; _start aborts itself at
    // the next closed/signal checkpoint and close() reaps whatever exists.
    this.readyPromise = Promise.race([started, watchdog]).then(
      (value) => {
        release();
        return value;
      },
      async (err) => {
        release();
        this.readyPromise = null;
        await this.close().catch(() => {});
        throw err;
      },
    );
    return this.readyPromise;
  }

  async _start(signal) {
    if (this.closed) throw new Error('connection closed');
    if (signal?.aborted) throw abortSignalError();
    const {
      catalog, createSession, disposeSession, sessionApi, sessionUpdateNormalizerFor, providers, effect,
    } = runtimeBundle();
    await initAgentRuntime();

    const agent = this.agentConfig;
    const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
    if (agent.registrySource !== 'registry' && !commandPath) {
      throw new Error(`ACP agent "${agent.name}" command "${agent.command}" was not found on PATH.`);
    }
    const wiring = agentWiring(agent, commandPath);
    this.wiring = wiring;
    const environment = buildAgentRuntimeEnv(agent, commandPath);
    if (wiring.isClaude) {
      // ACP runtime adapter.ts:200-208 — Claude Code needs the ACP v2 surface enabled.
      environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ??= '1';
    }
    // ACP runtime registry adapter.ts:210 — Copilot session events drive its subagent
    // routing; the normalizer must exist before the session is created.
    if (wiring.isCopilot) {
      this._copilotRouting = providers.CopilotAcp.makeCopilotSubagentRouting();
    }
    const settings = registrySettingsFor(
      { ...agent, args: agent.args },
      commandPath,
    );
    this._customModels = Array.isArray(settings.customModels) ? settings.customModels : [];

    // ACP runtime AntigravityDriver.makeRuntime: antigravity runs the managed
    // managed runtime under a sealed environment (extendEnv:false, isolated
    // GEMINI_HOME profile) — never the registry build and never the host env.
    let spawn;
    let agyOptions = null;
    this._agyPlan = null;
    if (wiring.isAntigravity) {
      const { antigravitySessionPlan, antigravitySessionOptions } = runtimeBundle();
      const agyAuth = antigravityAuthConfigFor(agent, environment);
      this._agyPlan = await antigravitySessionPlan({
        instanceId: `dsh:${agent.id}`,
        profileDirectory: agent.profileDir || agent.env?.GEMINI_HOME,
        cwd: this.cwd,
        baseEnv: { ...process.env, ...environment },
        auth: agyAuth,
        stateDir: runtimeHomeDir(),
        userHome: os.homedir(),
        ...(commandPath ? { executablePath: commandPath } : {}),
      });
      if (this.closed || signal?.aborted) {
        await this._agyPlan.cleanup(); this._agyPlan = null;
        throw signal?.aborted ? abortSignalError() : new Error('connection closed');
      }
      spawn = this._agyPlan.spawn;
      agyOptions = antigravitySessionOptions({
        authMethod: agyAuth.authMethod,
        // Mid-session OAuth requests surface through stdout/stderr transforms;
        // show the URL in the transcript instead of dropping it.
        onAuthorizationUrl: (url) =>
          effect.Effect.sync(() => this._onAntigravityAuthorizationUrl(url)),
      });
    } else {
      // ACP runtime treats `environment` as the complete process env (only falls back
      // to hostEnvironment when null) — merge host env so npm/uvx/binary
      // lookup and the spawned agent both see PATH.
      const resolved = await catalog.resolve(settings, this.cwd, {
        ...process.env,
        ...environment,
      });
      spawn = { ...resolved.spawn };
      if (environment && Object.keys(environment).length > 0) {
        spawn.env = { ...(spawn.env || {}), ...environment };
      }
    }
    // ACP runtime adapter acpMcpContext: processEnvironment rides the spawn env so
    // processes the agent launches itself can reach the MCP bridge too.
    if (this.mcpInjection?.processEnvironment) {
      spawn.env = { ...(spawn.env || {}), ...this.mcpInjection.processEnvironment };
    }
    this._agyOptions = agyOptions;

    const stderrTail = [];
    const agyStderr = agyOptions?.onStderr;
    const onStderr = (text) => {
      stderrTail.push(String(text));
      if (stderrTail.length > 40) stderrTail.shift();
      stageLog('stderr: ' + String(text).slice(0, 400));
      return agyStderr ? agyStderr(String(text)) : effect.Effect.void;
    };

    stageLog('spawn-built ' + JSON.stringify({ cmd: spawn.command, args: spawn.args }));
    const handle = await createSession({
      options: {
        spawn,
        cwd: this.cwd,
        clientInfo: { name: 'whaleisle', version: '0.0.0' },
        clientCapabilities: agyOptions
          ? agyOptions.clientCapabilities
          : clientCapabilitiesFor(
              wiring,
              wiring.isCopilot ? providers.CopilotAcp.copilotClientCapabilitiesMeta : undefined,
            ),
        // authMethodId stays unset unless a verified ACP id exists; the
        // runtime resolves the agent's first method when auth is required.
        ...(agyOptions
          ? {
              authMethodId: agyOptions.authMethodId,
              authenticateEagerly: agyOptions.authenticateEagerly,
              resumeMethod: agyOptions.resumeMethod,
              cancelBehavior: agyOptions.cancelBehavior,
              transformStdout: agyOptions.transformStdout,
            }
          : agent.acpAuthMethodId
            ? { authMethodId: String(agent.acpAuthMethodId) }
            : {}),
        ...(this.resumeSessionId ? { resumeSessionId: this.resumeSessionId } : {}),
        ...(this.mcpInjection?.servers?.length
          ? { mcpServers: this.mcpInjection.servers }
          : {}),
        ...(this.mcpInjection?.acpServers?.length
          ? { acpMcpServers: this.mcpInjection.acpServers }
          : {}),
        // Configured-but-unadvertised model ids validate ACP-side instead of
        // failing setConfigOption's allowed-values check (AC-007).
        ...(this._customModels.length ? { customModels: this._customModels } : {}),
        onStderr,
        onTermination: () => effect.asEffect(() => this._handleTermination()),
        ...(agyOptions
          ? { transformSessionUpdate: agyOptions.transformSessionUpdate }
          : this._copilotRouting
            ? {
                // Copilot routes subagent traffic by rewriting sessionId on the
                // wire notification (adapter.ts:246).
                transformSessionUpdate: (notification) =>
                  this._copilotRouting.normalizeSessionUpdate(notification),
              }
            : sessionUpdateNormalizerFor(wiring.registryAgentId)
                ? {
                    transformSessionUpdate: (notification) =>
                      sessionUpdateNormalizerFor(wiring.registryAgentId)(notification),
                  }
                : {}),
      },
      onEvent: (event) => this._onRuntimeEvent(event),
    });
    stageLog('session-created');
    // Abort/timeout can fire while createSession is in flight: the runtime
    // spawned the agent already, so a stale handle must die here (AC-008).
    if (this.closed || signal?.aborted) {
      await disposeSession(handle).catch(() => {});
      if (this._agyPlan) { await this._agyPlan.cleanup(); this._agyPlan = null; }
      throw this.closed ? new Error('connection closed') : abortSignalError();
    }
    this.handle = handle;
    this.api = sessionApi(handle.service);

    // Client terminals (ACP runtime adapter.ts:5880-5891): Devin only, shell command
    // mode, guarded by the same execute disposition ACP runtime applies.
    if (!wiring.isAntigravity) {
      this.terminals = await effect.runCatch(
        providers.AcpClientTerminals.makeAcpClientTerminals({
          shellCommands: wiring.isDevin,
          defaultCwd: this.cwd,
          environment,
        }).pipe(effect.Effect.provideService(effect.Scope.Scope, handle.scope)),
      );
    }

    stageLog('wire-handlers-start');
    await this._wireHandlers();
    stageLog('wire-handlers-done');

    await this.api.initialize();
    stageLog('initialized');
    if (!this.acpSessionId) {
      // start owns initial activation, including restore and its advertised fallback.
      // Explicit load/resume here would first start, then activate the same ID again.
      const result = await this.api.start().catch((err) => {
        if (this.resumeSessionId) throw new Error(`Could not restore ACP session "${this.resumeSessionId}": ${acpErrorMessage(err)}. The saved session has been retained.`, { cause: err });
        if (
          wiring.isAntigravity &&
          providers.AntigravityAuthSupport.isAntigravitySignInRequiredError(err)
        ) {
          throw new Error(
            'Antigravity sign-in required. Use the provider login before starting a session.',
          );
        }
        throw err;
      });
      this._captureStartResult(result);
      stageLog('started sessionId=' + this.acpSessionId);
    }
    // A usable session proves the credential state is good (explicit
    // authenticate ran when the agent required it).
    this.acpAuthenticated = true;

    // ACP runtime AntigravityAdapterV2 sessionModeForPolicy: the host permission mode
    // maps onto Antigravity's own session modes (default/auto_edit/yolo).
    if (wiring.isAntigravity) {
      await this._applyAntigravitySessionMode();
      stageLog('agy-mode-applied');
    }
  }

  _onAntigravityAuthorizationUrl(url) {
    const turn = this.activeTurn;
    if (!turn || typeof url !== 'string' || !url) return;
    turn.registerToolCall({
      toolCallId: `agy-auth-${crypto.randomUUID()}`,
      title: 'Antigravity sign-in required',
      name: 'authorization',
      kind: 'other',
      args: { url },
      status: 'failed',
    });
  }

  async _applyAntigravitySessionMode() {
    const runtimeMode =
      this.getRuntimePolicy?.(this)?.runtimeMode || (this.agentConfig.permissionPolicy === 'auto-allow'
        ? 'full-access'
        : 'approval-required');
    const modeId = runtimeBundle().providers.AntigravityAcpSupport.antigravityPermissionMode(runtimeMode);
    if (!modeId || modeId === this.currentModeId) return;
    if (
      this.availableModes.length > 0
      && !this.availableModes.some((mode) => mode.id === modeId)
    ) {
      return;
    }
    try {
      await this.api.setMode(modeId);
      this.currentModeId = modeId;
      this._refreshSeq += 1;
    } catch {
      // Mode application is best-effort; the session may not expose modes.
    }
  }

  _captureStartResult(result) {
    this.protocolVersion = result?.initializeResult?.protocolVersion;
    this.supportsImages = result?.initializeResult?.agentCapabilities?.promptCapabilities?.image === true;
    this.capabilitiesKnown = true;
    this.acpSessionId = result?.sessionId || this.acpSessionId;
    const setup = result?.sessionSetupResult || {};
    this.modelState = setup.models;
    this.currentModel = setup.models?.currentModelId || setup.configOptions?.find((option) => option.category === 'model' || option.id === 'model')?.currentValue || this.currentModel;
    if (Array.isArray(setup.configOptions)) {
      this._setConfigOptions(setup.configOptions);
    }
    this._publishDiscoveredModels();
    if (setup.modes) {
      this.availableModes = Array.isArray(setup.modes.availableModes)
        ? setup.modes.availableModes.map((m) => ({
            id: String(m?.id || ''),
            name: String(m?.name || m?.id || ''),
            description: String(m?.description || ''),
          }))
        : [];
      this.currentModeId = setup.modes.currentModeId || this.currentModeId;
    }
    this._refreshSeq += 1;
    void this._refreshModeAndConfig(this._refreshSeq);
  }

  // Refresh results must not overwrite state mutated after the refresh
  // started (AC-041): local mode/model writes bump _refreshSeq.
  async _refreshModeAndConfig(seq) {
    try {
      const modeState = await this.api.getModeState();
      if (seq !== undefined && seq !== this._refreshSeq) return;
      if (modeState?.currentModeId) this.currentModeId = modeState.currentModeId;
      if (Array.isArray(modeState?.availableModes)) {
        this.availableModes = modeState.availableModes.map((m) => ({
          id: String(m?.id || ''),
          name: String(m?.name || m?.id || ''),
          description: String(m?.description || ''),
        }));
      }
      const configOptions = await this.api.getConfigOptions();
      if (seq !== undefined && seq !== this._refreshSeq) return;
      if (Array.isArray(configOptions) && configOptions.length > 0) {
        this._setConfigOptions(configOptions);
        this._publishDiscoveredModels();
      }
    } catch {
      // State refresh failures must not fail session startup.
    }
  }

  _publishDiscoveredModels() {
    if (typeof this.onModelsDiscovered !== 'function') return;
    const found = modelsFromConfigOptions(this.configOptions, this.modelState).map((model) => ({ ...model, inputModalities: this.supportsImages ? ['text', 'image'] : ['text'] }));
    if (found.length > 0 || this.configOptions.some(option => option.type === 'select' && (option.id === 'model' || option.category === 'model'))) {
      this.onModelsDiscovered(this.agentConfig.id, found);
    }
  }

  _onRuntimeEvent(event) {
    const { effect } = runtimeBundle();
    if (event?._tag === 'EventStreamBarrier') {
      // The runtime gates resume/load history on barrier acknowledgements.
      effect.run(effect.Deferred.succeed(event.acknowledge, undefined)).catch(() => {});
      return;
    }
    if (event?._tag === 'ConnectionTerminated') {
      this._handleTermination(event.error);
      return;
    }
    const nativeSessionId = event?.rawPayload?.sessionId;
    if (nativeSessionId && this.acpSessionId && nativeSessionId !== this.acpSessionId) {
      // Child-session notifications have their own IDs and must not finish or
      // write into the root conversation. Provider subagent extraction below
      // remains responsible for their lifecycle.
      if (event._tag === 'UnknownUpdate' && this.wiring?.isClaude) {
        const child = this._claudeSubagentSessionEvent(event.rawPayload);
        if (child) this._applyClaudeSubagentSessionEvent(child);
      }
      return;
    }
    if (event?._tag === 'UnknownUpdate' && event.updateType === 'state_update') {
      const work = event.rawPayload?.update;
      this.agentWork = work;
      if (this.workQuarantined) return;
      if (work?.state === 'running' || work?.state === 'requires_action') this._ensureBackgroundTurn();
      if (work?.state === 'idle' && this.activeTurn && !this.activeTurn.promptDone && (this.activeTurn.background || this.activeTurn.promptResponse)) {
        this.activeTurn.complete(work);
      }
      return;
    }
    if (this.workQuarantined && ['ContentDelta', 'ThoughtDelta', 'ToolCallUpdated'].includes(event?._tag)) return;
    if (['ContentDelta', 'ThoughtDelta', 'ToolCallUpdated'].includes(event?._tag)) this._ensureBackgroundTurn();
    switch (event?._tag) {
      case 'AvailableCommandsUpdated':
        this.availableCommands = (event.availableCommands || [])
          .map((c) => ({
            name: String(c?.name || '').trim(),
            description: String(c?.description || ''),
            inputHint: typeof c?.input?.hint === 'string' ? c.input.hint : null,
          }))
          .filter((c) => c.name);
        return;
      case 'ModeChanged':
        if (event.modeId) this.currentModeId = event.modeId;
        return;
      case 'ConfigOptionsUpdated':
        if (Array.isArray(event.configOptions)) {
          this.currentModel = undefined;
          this.currentEffort = undefined;
          this._setConfigOptions(event.configOptions);
          this._refreshSeq += 1;
          this._publishDiscoveredModels();
        }
        return;
      case 'SessionInfoUpdated': {
        const sid = event.metadata?.nativeSessionId || event.metadata?.sessionId;
        if (typeof sid === 'string' && sid) this.acpSessionId = sid;
        return;
      }
      case 'UnknownUpdate': {
        // Claude subagent lifecycle travels in `_t3_unknown` session updates
        // (subagent_update / session_message); the normalized notification is
        // the event's rawPayload.
        if (this.wiring?.isClaude) {
          const subEvent = this._claudeSubagentSessionEvent(event.rawPayload);
          if (subEvent) this._applyClaudeSubagentSessionEvent(subEvent);
        }
        return;
      }
      default:
        break;
    }
    this.activeTurn?.handleEvent(event);
  }

  _ensureBackgroundTurn() {
    if (this.closed || this.protocolVersion !== 2 || (this.activeTurn && !this.activeTurn.promptDone)) return;
    if (this.activeTurn?.background && !this.activeTurn.attached && this.activeTurn.queue.items.length > 0) this.pendingBackgroundTurns.push(this.activeTurn);
    const controller = new AbortController();
    const turn = new AcpTurnExecution({ connection: this, promptBlocks: [], signal: controller.signal, hostAgent: this.hostAgent });
    turn.background = true;
    turn._onAbort = () => turn._handleAbort();
    turn.signal.addEventListener('abort', turn._onAbort, { once: true });
    this.activeTurn = turn;
    this.onBackgroundWork?.(this);
  }

  _claudeSubagentSessionEvent(notification) {
    try {
      return runtimeBundle().providers.ClaudeAcp.extractClaudeSubagentSessionEvent(notification);
    } catch {
      return undefined;
    }
  }

  _applyClaudeSubagentSessionEvent(subEvent) {
    if (subEvent.type === 'delegation') {
      if (subEvent.childSessionId && subEvent.delegationId) {
        this._subagentToolByChildSession.set(subEvent.childSessionId, subEvent.delegationId);
      }
      return;
    }
    const toolCallId = this._subagentToolByChildSession.get(subEvent.childSessionId);
    const turn = this.activeTurn;
    if (!toolCallId || !turn) return;
    const entry = turn.toolCalls.get(toolCallId);
    if (!entry) return;
    entry.subagentStatus = subEvent.status;
    if (subEvent.status === 'completed' || subEvent.status === 'failed' || subEvent.status === 'cancelled') {
      entry.status = subEvent.status === 'cancelled' ? 'failed' : subEvent.status;
      if (subEvent.result) entry.outputText = String(subEvent.result);
      for (const waiter of entry.waiters.splice(0)) waiter();
      this._subagentToolByChildSession.delete(subEvent.childSessionId);
    }
  }

  // ACP runtime flavor.normalizeToolCall — per-provider display normalization of
  // AcpToolCallState (command/cwd/output extraction, name from _meta).
  _normalizeToolCall(toolCall) {
    if (!toolCall) return toolCall;
    const wiring = this.wiring || {};
    try {
      const { providers } = runtimeBundle();
      if (wiring.isAntigravity) {
        return providers.AntigravityProtocol.normalizeAntigravityToolCall(toolCall);
      }
      if (wiring.isDevin) return providers.DevinAcp.normalizeDevinToolCall(toolCall);
    } catch {
      // Normalization is display-only; never let it drop the event.
    }
    return toolCall;
  }

  // ACP runtime flavor.extractSubagentUpdate — provider-specific subagent detection.
  _extractSubagentUpdate(toolCall) {
    if (!toolCall) return undefined;
    const wiring = this.wiring || {};
    try {
      const { providers } = runtimeBundle();
      if (wiring.isAntigravity) {
        // AntigravityAdapterV2.ts:86-107 — ACP 1.1.1 subagent calls have no
        // child ids; classify by title/kind and pull output for the prompt.
        if (
          providers.AntigravityProtocol.classifyAntigravitySubagentToolCall(toolCall) !== 'subagent'
        ) {
          return undefined;
        }
        const status =
          toolCall.status === 'failed'
            ? 'failed'
            : toolCall.status === 'pending'
              ? 'pending'
              : 'running';
        const output = providers.AntigravityProtocol.antigravitySubagentOutput(toolCall);
        return {
          nativeTaskId: toolCall.toolCallId,
          prompt: output ?? toolCall.detail ?? toolCall.title ?? 'Antigravity subagent batch',
          title: 'Antigravity subagent batch',
          model: null,
          status,
          childSessionId: null,
          result: status === 'failed' ? (output ?? null) : null,
        };
      }
      if (wiring.isDevin) return providers.DevinAcp.extractDevinSubagentUpdate(toolCall);
      if (wiring.isClaude) return providers.ClaudeAcp.extractClaudeSubagentUpdate(toolCall);
      if (wiring.isCopilot) return providers.CopilotAcp.extractCopilotSubagentUpdate(toolCall);
    } catch {
      // Extraction is best-effort.
    }
    return undefined;
  }

  // ACP runtime isProvisionalSubagentTool — claude's placeholder Task tool.
  _isProvisionalSubagentTool(toolCall) {
    if (!this.wiring?.isClaude) return false;
    try {
      return runtimeBundle().providers.ClaudeAcp.isClaudeProvisionalSubagentTool(toolCall) === true;
    } catch {
      return false;
    }
  }

  _handleTermination(error) {
    this.closed = true;
    const failure =
      error instanceof Error
        ? error
        : new Error(`ACP agent "${this.agentConfig?.name}" connection terminated`);
    this.activeTurn?.fail(failure);
    // Avoid closing the event subscription from inside its own callback.
    queueMicrotask(() => { void this.close().catch(() => {}); });
  }

  async _wireHandlers() {
    const { effect, providers, clientFileSystem } = runtimeBundle();
    const wiring = this.wiring || {};
    // ACP runtime policy table: approval-required pairs with a workspace-write sandbox
    // (mutations ask), full-access pairs with dangerFullAccess (allow). A
    // workspaceWrite sandbox under auto-allow would DENY execute calls.
    const autoAllow = this.agentConfig.permissionPolicy === 'auto-allow';
    const initialPolicy = {
      runtimeMode: autoAllow ? 'full-access' : 'approval-required',
      cwd: this.cwd,
      approvalPolicy: autoAllow ? 'never' : 'on-request',
      sandboxPolicy: autoAllow ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite' },
    };
    // Callbacks resolve the current turn's host policy, not the policy that
    // happened to be active when this long-lived connection was initialized.
    const runtimePolicy = new Proxy(initialPolicy, {
      get: (target, key) => (this.getRuntimePolicy?.(this) || target)[key],
    });

    // ACP runtime makeAcpClientPolicyGrants: interactive "command" approvals feed the
    // terminal/create execute grant for their turn/session scope.
    this._policyGrants = providers.AcpClientPolicy.makeAcpClientPolicyGrants();

    // ACP runtime AntigravityClientFiles: symlink-aware containment inside the session
    // workspace, 8 MiB read cap, 1-indexed line/limit slicing.
    const clientFs = await clientFileSystem([this.cwd]);
    const fullFs = await clientFileSystem([path.parse(path.resolve(this.cwd)).root]);
    const fileBridge = () => runtimePolicy.sandboxPolicy?.type === 'dangerFullAccess' ? fullFs : clientFs;
    stageLog('clientfs-ready');

    const handlers = {
      handleRequestPermission: async (params, requestContext) =>
        this._resolvePermission(params, runtimePolicy, requestContext),
      handleReadTextFile: async (request) => {
        stageLog('fs-read ' + JSON.stringify(request).slice(0, 300));
        const out = await fileBridge().readTextFile(request);
        stageLog('fs-read-done');
        return out;
      },
      handleWriteTextFile: async (request) => {
        const policy = this.getRuntimePolicy?.(this);
        if (policy?.sandboxPolicy?.type === 'readOnly') throw new Error('The active runtime policy is read-only.');
        if (policy && policy.approvalPolicy !== 'never') {
          const decision = await this._requestApproval({ title: `Write file: ${request.path}`, kind: 'edit', params: {}, toolCall: { kind: 'edit', rawInput: { path: request.path } } });
          if (!['accept', 'acceptForSession'].includes(decision)) throw new Error('File write was not approved.');
        }
        stageLog('fs-write ' + JSON.stringify(request).slice(0, 300));
        const out = await fileBridge().writeTextFile(request);
        stageLog('fs-write-done');
        if (this.writtenPaths.size >= MAX_WRITTEN_PATHS) {
          this.writtenPaths.delete(this.writtenPaths.values().next().value);
        }
        this.writtenPaths.add(path.resolve(this.cwd, String(request?.path ?? '')));
        return out;
      },
      // ACP runtime adapter.ts:6121-6195 — codex MCP approvals go through policy (the
      // transport request id is the second codex marker); url-mode requests
      // get interactive consent; other forms decline (we have no form UI).
      handleElicitation: async (params, requestContext) => {
        stageLog('elicitation ' + JSON.stringify(params).slice(0, 300));
        const meta = params?._meta && typeof params._meta === 'object' ? params._meta : {};
        const transportRequestId = String(requestContext?.requestId || '');
        if (
          params?.mode === 'form'
          && (meta.codex_approval_kind === 'mcp_tool_call'
            || transportRequestId.startsWith('mcp_tool_call_approval_'))
        ) {
          const disposition = providers.AcpClientPolicy.acpMcpToolApprovalElicitationDisposition(
            runtimePolicy,
            params,
            transportRequestId,
          );
          if (disposition === 'allow') return { action: 'accept', content: {} };
          if (disposition === 'deny') return { action: 'decline' };
          const decision = await this._requestApproval({
            title: params?.message || 'Allow MCP tool call?',
            kind: 'execute',
            params,
          });
          if (decision === 'accept' || decision === 'acceptForSession') {
            return { action: 'accept', content: {} };
          }
          return { action: decision === 'cancel' ? 'cancel' : 'decline' };
        }
        if (
          params?.mode === 'url'
          && typeof params.url === 'string'
          && typeof params.elicitationId === 'string'
        ) {
          const url = providers.AcpRegistryProbe.normalizeAcpRegistryWebUrl(params.url);
          if (url === undefined) return { action: 'decline' };
          const decision = await this._requestApproval({
            title: String(params?.message || `Open ${url}?`),
            kind: 'other',
            params,
            toolCall: { rawInput: { url } },
          });
          if (decision === 'accept' || decision === 'acceptForSession') {
            return { action: 'accept' };
          }
          return { action: decision === 'cancel' ? 'cancel' : 'decline' };
        }
        if (params?.mode === 'form' && this.requestUserInput && this.activeTurn) {
          const form = runtimeBundle().parseElicitationForm(params.requestedSchema, params.message || 'Agent input');
          if (!form) throw new Error('This ACP form uses fields the host cannot present.');
          const answers = {};
          for (const question of form.questions) {
            const response = await this.requestUserInput({ turn: this.activeTurn, connection: this }, question);
            const answer = response?.answers?.find((entry) => entry.id === question.id);
            if (!answer) return { action: 'cancel' };
            const selected = (answer.selected || []).map((label) => question.options.find((option) => option.label === label)?.value ?? label);
            const custom = answer.custom;
            Object.defineProperty(answers, question.id, { value: custom || (question.multiSelect ? selected : selected[0]), enumerable: true });
          }
          const content = form.content(answers);
          if (content === undefined) throw new Error('The ACP form answer is missing a required value or has an invalid type.');
          return { action: 'accept', content };
        }
        return { action: 'decline' };
      },
      // Client-side elicitation completions arrive as notifications; ours
      // resolve synchronously, so there is nothing to settle — consume and
      // flush the runtime's pending buffer.
      handleElicitationComplete: async () => {
        stageLog('elicitation-complete');
      },
    };

    // ACP runtime AcpMcpOverAcpBridge: when the session advertises acpMcpServers the
    // agent calls back over mcp_connect/message/notification/disconnect. The
    // runtime only sends acpServers after the agent negotiates mcp-acp
    // support, so registering the handlers unconditionally is safe.
    if (
      this.mcpInjection?.acpServers?.length
      && this.mcpInjection.endpoint
      && this.mcpInjection.authorization
    ) {
      this._mcpBridge = await effect.runCatch(
        providers.AcpMcpOverAcpBridge.makeAcpMcpOverAcpBridge({
          endpoint: this.mcpInjection.endpoint,
          authorization: this.mcpInjection.authorization,
          allocateConnectionId: effect.Effect.sync(() => crypto.randomUUID()),
        }),
      );
      handlers.handleMcpConnect = (request) =>
        effect.runCatch(this._mcpBridge.connect(request));
      handlers.handleMcpMessage = (request) =>
        effect.runCatch(this._mcpBridge.message(request));
      handlers.handleMcpNotification = (request) =>
        effect.runCatch(this._mcpBridge.notification(request));
      handlers.handleMcpDisconnect = (request) =>
        effect.runCatch(this._mcpBridge.disconnect(request));
    }

    if (this.terminals) {
      const toPromise = (eff) => effect.runCatch(eff);
      // ACP runtime guardClientTerminalCreate (adapter.ts:5867-5877): client terminals
      // run with host privileges, so creation passes the execute disposition —
      // allow, a recorded approval grant, or a fresh interactive approval.
      handlers.handleCreateTerminal = async (request) => {
        const disposition = providers.AcpClientPolicy.acpClientExecuteDisposition(runtimePolicy);
        if (disposition === 'deny') {
          throw new Error('The active runtime policy does not allow terminal/create.');
        }
        const turn = this.activeTurn;
        if (
          disposition !== 'allow'
          && !(turn && this._policyGrants?.allowsExecute(turn.turnKey))
        ) {
          const decision = await this._requestApproval({
            title: request?.command
              ? `Run terminal command: ${request.command}`
              : 'Run terminal command',
            kind: 'execute',
            params: {},
            toolCall: {
              title: request?.command || 'terminal/create',
              kind: 'execute',
              rawInput: { command: request?.command, args: request?.args, cwd: request?.cwd },
            },
            options: [
              { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'allow-always', name: 'Allow for this session', kind: 'allow_always' },
              { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
            ],
          });
          if (decision !== 'accept' && decision !== 'acceptForSession') {
            throw new Error(
              'The active runtime policy requires approval for terminal/create. '
              + 'Request permission with session/request_permission before retrying.',
            );
          }
          this._policyGrants?.recordApproval({
            kind: 'command',
            scope: decision === 'acceptForSession' ? 'session' : 'turn',
            turnKey: turn?.turnKey ?? null,
          });
        }
        return toPromise(this.terminals.create(request));
      };
      handlers.handleTerminalOutput = (request) =>
        toPromise(this.terminals.output(request));
      handlers.handleTerminalWaitForExit = (request) =>
        toPromise(this.terminals.waitForExit(request));
      handlers.handleTerminalKill = (request) =>
        toPromise(this.terminals.kill(request));
      handlers.handleTerminalRelease = (request) =>
        toPromise(this.terminals.release(request));
    }

    stageLog('assign-handlers-start ' + Object.keys(handlers).join(','));
    await this.api.assignHandlers(handlers);
    stageLog('assign-handlers-done');

    // ACP runtime registry adapter.ts:242-248 — Copilot extension notifications feed
    // its subagent routing on the raw runtime service.
    if (wiring.isCopilot && this._copilotRouting && this.handle?.service) {
      await effect
        .runCatch(
          this._copilotRouting.registerExtensions({
            runtime: this.handle.service,
            finishSubagent: (notice) =>
              effect.Effect.sync(() => this._finishSubagent(notice)),
          }),
        )
        .catch(() => {});
    }
  }

  _finishSubagent(notice) {
    // notice.childSessionId for copilot is `copilot-task:${toolCallId}`.
    const toolCallId = this._subagentToolByChildSession.get(notice.childSessionId)
      || (typeof notice.childSessionId === 'string' && notice.childSessionId.startsWith('copilot-task:')
        ? notice.childSessionId.slice('copilot-task:'.length)
        : null);
    const turn = this.activeTurn;
    if (!toolCallId || !turn) return;
    const entry = turn.toolCalls.get(toolCallId);
    if (!entry) return;
    entry.status = notice.status === 'cancelled' ? 'failed' : notice.status;
    if (notice.result) entry.outputText = String(notice.result);
    for (const waiter of entry.waiters.splice(0)) waiter();
    if (entry.status === 'completed' || entry.status === 'failed') {
      this._subagentToolByChildSession.delete(notice.childSessionId);
    }
  }

  /** ACP callbacks must not wait behind the host's mirrored tool execution. */
  async _awaitPermission(entry, permission) {
    const turn = this.activeTurn;
    if (this.requestApproval) {
      return this.requestApproval({ entry, turn, connection: this }, permission);
    }
    // Standalone ACP consumers without a host approval service own this channel.
    const decision = createDeferred();
    entry.pendingPermission = { ...permission, resolve: decision.resolve };
    entry.onPermissionArrived?.();
    return decision.promise;
  }

  /** Synthetic terminal/elicitation approvals have no later ACP tool status. */
  async _requestApproval({ title, kind, params, toolCall, options }) {
    const turn = this.activeTurn;
    if (!turn || turn.promptDone || turn.queue.closed) return 'decline';
    const toolCallId = String(toolCall?.toolCallId || `appr-${crypto.randomUUID()}`);
    let entry = turn.toolCalls.get(toolCallId);
    if (!entry) {
      entry = turn.registerToolCall({
        toolCallId,
        title: title || toolCall?.title || 'Approval request',
        kind: kind || toolCall?.kind || 'other',
        args: toolCall?.rawInput || {},
        locations: toolCall?.locations,
        status: 'pending',
      });
    }
    const decision = permissionDecisionOf(await this._awaitPermission(entry, {
      params: params ?? {},
      options: options || [],
      toolCall: toolCall || {},
    }));
    entry.status = decision === 'accept' || decision === 'acceptForSession' ? 'completed' : 'failed';
    for (const waiter of entry.waiters.splice(0)) waiter();
    return decision;
  }

  async _resolvePermission(params, runtimePolicy, requestContext) {
    const { providers } = runtimeBundle();
    const wiring = this.wiring || {};
    stageLog('permission-req ' + JSON.stringify(params).slice(0, 500));

    // ACP runtime AntigravityProtocol: `interaction_*` tool calls are the agent's own
    // user-input questions, not binary approvals. Route the original choices
    // through the host question service and return the selected protocol id.
    if (
      wiring.isAntigravity
      && providers.AntigravityProtocol.isAntigravityUserInputRequest(params)
    ) {
      const question = providers.AntigravityProtocol.extractAntigravityUserInputQuestion(params);
      const turn = this.activeTurn;
      if (turn) {
        const toolCallId = String(
          params?.toolCall?.toolCallId || `question-${crypto.randomUUID()}`,
        );
        if (!turn.toolCalls.has(toolCallId)) {
          turn.registerToolCall({
            toolCallId,
            title: question?.question || params?.toolCall?.title || 'Antigravity question',
            kind: 'other',
            args: {
              ...(params?.toolCall?.rawInput || {}),
              options: (question?.options || []).map((o) => o.label),
            },
            locations: params?.toolCall?.locations,
            status: 'pending',
          });
        }
      }
      if (!question || !turn || !this.requestUserInput) return { outcome: { outcome: 'cancelled' } };
      try {
        const answer = await this.requestUserInput({ turn, connection: this }, question);
        const selected = answer.answers?.find((item) => item.id === question.id)?.selected?.[0];
        const option = question.options.find((item) => item.label === selected);
        const entry = turn.toolCalls.get(String(params.toolCall.toolCallId));
        if (entry) { entry.status = option ? 'completed' : 'failed'; entry.outputText = selected || 'Question cancelled'; for (const waiter of entry.waiters.splice(0)) waiter(); }
        return option ? { outcome: { outcome: 'selected', optionId: option.value } } : { outcome: { outcome: 'cancelled' } };
      } catch (error) {
        if (turn.signal?.aborted) return { outcome: { outcome: 'cancelled' } };
        throw error;
      }
    }

    const disposition = providers.AcpClientPolicy.acpPermissionDisposition(runtimePolicy, params);
    if (disposition === 'allow') return autoAllowedOutcome(params);
    if (disposition === 'deny') return permissionOutcome(params, 'decline');

    const turn = this.activeTurn;
    if (turn && !turn.promptDone && !turn.queue.closed) {
      const toolCall = params?.toolCall || {};
      const toolCallId = String(toolCall.toolCallId || `perm-${crypto.randomUUID()}`);
      let entry = turn.toolCalls.get(toolCallId);
      if (!entry) {
        entry = turn.registerToolCall({
          toolCallId,
          title: toolCall.title || 'Permission Request',
          name: toolCall.title || toolCall.command || 'permission',
          kind: toolCall.kind || 'other',
          args: toolCall.rawInput || {},
          locations: toolCall.locations,
          status: 'pending',
        });
      }
      stageLog('permission-pending toolCall=' + toolCallId);
      const decision = permissionDecisionOf(await this._awaitPermission(entry, {
        params,
        options: wiring.isAntigravity
          ? providers.AntigravityProtocol.antigravityApprovalOptions(params)
          : params?.options || [],
        toolCall,
      }));
      stageLog('permission-decision ' + JSON.stringify(decision));
      if (decision === 'cancel') {
        return { outcome: { outcome: 'cancelled' } };
      }
      // ACP runtime adapter.ts:6084-6093 — approved "command" requests grant matching
      // terminal/create calls for the turn (accept) or session (acceptForSession).
      if (
        (decision === 'accept' || decision === 'acceptForSession')
        && providerRequestKind(toolCall.kind) === 'command'
      ) {
        this._policyGrants?.recordApproval({
          kind: 'command',
          scope: decision === 'acceptForSession' ? 'session' : 'turn',
          turnKey: turn.turnKey,
        });
      }
      if (wiring.isAntigravity) {
        const optionId = providers.AntigravityProtocol.selectAntigravityPermissionOptionId(
          params,
          decision,
        );
        return optionId === undefined
          ? { outcome: { outcome: 'cancelled' } }
          : { outcome: { outcome: 'selected', optionId } };
      }
      return permissionOutcome(params, decision);
    }
    // No live turn can carry the interactive request — deny, never grant
    // (the previous autoAllowedOutcome was the fail-open, AC-044).
    return permissionOutcome(params, 'decline');
  }

  _setConfigOptions(options) {
    this.configOptions = options;
    const model = options.find((option) => option.type === 'select' && (option.category === 'model' || option.id === 'model'));
    if (model?.currentValue !== undefined) this.currentModel = model.currentValue;
    const effort = options.find(isReasoningOption);
    if (effort?.currentValue !== undefined) this.currentEffort = optionChoiceId(effort.currentValue);
    else if (!effort) this.currentEffort = undefined;
  }

  async syncModelAndEffort(modelId, reasoningEffort, signal, explicitEffort = false) {
    await this.ensureReady(signal);
    // The connected account's current settings, not a saved/configured union,
    // determine whether a requested model can be selected.
    const currentOptions = await this.api.getConfigOptions();
    if (Array.isArray(currentOptions)) {
      this._setConfigOptions(currentOptions);
      this._publishDiscoveredModels();
    }
    let options = Array.isArray(this.configOptions) ? this.configOptions : [];
    // 'default' is the synthetic composer entry for "agent's own default" —
    // it is never a valid ACP-side id, so it must not reach session/set_model.
    if (modelId && modelId !== 'default' && modelId !== this.currentModel) {
      if (this.wiring?.isAntigravity && this.handle?.service) {
        // ACP runtime AntigravityAdapterV2.applyModelSelection: never replaces a saved
        // selection with the default returned by a cold resume; rejects
        // models the account does not offer. Failures propagate (AC-007).
        const { providers, effect } = runtimeBundle();
        const applied = await effect.runCatch(
          providers.AntigravityAcpSupport.applyAntigravityAcpModelSelection({
            runtime: this.handle.service,
            model: modelId === 'antigravity-default' ? undefined : modelId,
            defaultModel: undefined,
            mapError: (cause) => cause,
          }),
        );
        this.currentModel = applied || modelId;
        this._refreshSeq += 1;
      } else {
        const modelOpt = options.find(
          (opt) => opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model'),
        );
        if (modelOpt?.id) {
          // Reject ids the agent never advertised (the runtime's own
          // allowed-values check would too, but only when customModels was
          // passed — validate here so the error names the model).
          const known = new Set(modelsFromConfigOptions(options).map((m) => m.id));
          for (const id of this._customModels || []) known.add(id);
          if (known.size > 0 && !known.has(modelId)) {
            throw new Error(`ACP agent "${this.agentConfig?.name}" has no model "${modelId}".`);
          }
          await this.api.setConfigOption(modelOpt.id, modelId);
        } else {
          await this.api.setSessionModel(modelId).catch((error) => {
            if (error.code !== -32601) throw error;
            return this.api.setModel(modelId);
          });
        }
        this.currentModel = modelId;
        this._refreshSeq += 1;
      }
      // Model changes can replace the effort/option catalog. Validate the
      // selected model's settings, not the previous model's advertised values.
      this.currentEffort = undefined;
      const selectedOptions = await this.api.getConfigOptions();
      if (Array.isArray(selectedOptions)) {
        this._setConfigOptions(selectedOptions);
        options = selectedOptions;
        this._publishDiscoveredModels();
      }
    }

    if (reasoningEffort && reasoningEffort !== this.currentEffort) {
      const effortOpt = configOptionDescriptors(options).find(isReasoningOption);
      if (effortOpt?.id) {
        const values = effortOpt.options.map((item) => item.id);
        if (!values.includes(reasoningEffort)) throw new Error(`Unsupported reasoning effort "${reasoningEffort}". Available: ${values.join(', ')}.`);
        await this.syncOption(effortOpt.id, reasoningEffort);
      } else if (reasoningEffort !== 'medium' || explicitEffort) {
        // Medium was the legacy composer's implicit default. Preserve that
        // caller contract; new explicit settings are checked before spawning.
        throw new Error(`ACP agent "${this.agentConfig.name}" does not advertise reasoning effort settings.`);
      }
    }
  }

  async syncRuntimeMode(interactionMode, signal) {
    signal?.throwIfAborted();
    const policy = this.getRuntimePolicy?.(this);
    let mode;
    if (interactionMode === 'plan') mode = this.availableModes.find((entry) => /^(plan|read[-_ ]?only)$/i.test(entry.id))?.id;
    else if (this.wiring?.isAntigravity && policy) mode = runtimeBundle().providers.AntigravityAcpSupport.antigravityPermissionMode(policy.runtimeMode);
    else mode = this.availableModes.find((entry) => /^(default|code)$/i.test(entry.id))?.id;
    if (mode && mode !== this.currentModeId) { await this.api.setMode(mode); this.currentModeId = mode; this._refreshSeq += 1; }
  }

  async syncOption(id, value) {
    const currentOptions = await this.api.getConfigOptions();
    if (Array.isArray(currentOptions)) this._setConfigOptions(currentOptions);
    const option = this.configOptions.find((entry) => entry.id === id);
    if (id === 'model' || option?.category === 'model') throw new Error('Select models with model, not options.');
    if (/mode|permission|approval|sandbox/i.test(`${id} ${option?.category || ''}`)) throw new Error('Permission and interaction settings must use runtime_mode and interaction_mode; model options cannot raise permissions.');
    const wireValue = value === runtimeBundle().providers.AcpSessionConfig.ACP_EMPTY_OPTION_VALUE ? '' : value;
    const choices = (option?.options || []).flatMap((entry) => entry.options || [entry]);
    const valid = option?.type === 'boolean' ? typeof wireValue === 'boolean' : option?.type === 'select' && choices.some((entry) => entry.value === wireValue);
    if (!valid) throw new Error(`ACP option ${id}=${value} is not available in this session.`);
    await this.api.setConfigOption(id, wireValue); this._refreshSeq += 1;
    const updated = await this.api.getConfigOptions();
    if (Array.isArray(updated)) { this._setConfigOptions(updated); this._publishDiscoveredModels(); }
  }

  close() {
    return this._closePromise ??= this._close();
  }

  async _close() {
    this.closed = true;
    try {
      this.mcpInjection?.release?.();
    } catch {
      // ignore
    }
    try {
      this.activeTurn?.fail(new Error('connection closed'));
    } catch {
      // ignore
    }
    this.writtenPaths.clear();
    this._subagentToolByChildSession.clear();
    for (const turn of this.pendingBackgroundTurns.splice(0)) turn.fail(new Error('connection closed'));
    if (this.terminals) {
      const { effect } = runtimeBundle();
      const terminals = this.terminals;
      this.terminals = null;
      try {
        await effect.runCatch(terminals.disposeAll);
      } catch {
        // ignore
      }
    }
    if (this._mcpBridge) {
      const { effect } = runtimeBundle();
      const bridge = this._mcpBridge;
      this._mcpBridge = null;
      try {
        await effect.runCatch(bridge.dispose);
      } catch {
        // ignore
      }
    }
    const handle = this.handle;
    this.handle = null;
    try {
      if (handle) await runtimeBundle().disposeSession(handle);
    } finally {
      const agyPlan = this._agyPlan;
      this._agyPlan = null;
      try { if (agyPlan) await agyPlan.cleanup(); }
      finally { await this._startupPromise?.catch(() => {}); }
    }
  }
}

// ---------------------------------------------------------------------------
// Connection probe — replaces testAcpAgentConfig. Uses the runtime's registry probe
// (catalog.resolve + initialize + session/new for config/auth discovery).
// ---------------------------------------------------------------------------

/**
 * Raw session configOptions → normalized [{id, name}] model list. The model
 * select is identified by `category: 'model'` or `id: 'model'`; options may be
 * flat {value,name} entries or grouped {options:[…]} categories.
 */
function isReasoningOption(option) {
  return option?.type === 'select' && (option.role === 'reasoning'
    || ['thought_level', 'reasoning_effort'].includes(option.category)
    || /effort|thought|thinking/i.test(option.id));
}

function optionChoiceId(value) {
  return value === '' ? runtimeBundle().providers.AcpSessionConfig.ACP_EMPTY_OPTION_VALUE : value;
}

function configOptionDescriptors(configOptions) {
  const rawOptions = (configOptions || []).filter((option) => option.id !== 'model' && option.category !== 'model')
    .map((option) => option.type === 'select' && option.currentValue === undefined ? { ...option, currentValue: '' } : option);
  return runtimeBundle().modelOptionDescriptors({ configOptions: rawOptions, modeState: undefined })
    .map((option) => {
      const raw = rawOptions.find((entry) => entry.id === option.id);
      return { ...option, name: option.label, category: raw?.category,
        ...(isReasoningOption({ ...option, category: raw?.category }) ? { role: 'reasoning' } : {}),
        ...(option.type === 'select' ? { options: option.options.map((choice) => ({ ...choice, name: choice.label })) } : {}) };
    });
}

export function modelsFromConfigOptions(configOptions, modelState) {
  const found = [];
  const descriptors = configOptionDescriptors(configOptions);
  for (const opt of configOptions || []) {
    if (opt?.type === 'select' && (opt.category === 'model' || opt.id === 'model')) {
      for (const item of opt.options || []) {
        if (Array.isArray(item?.options)) {
          for (const sub of item.options) {
            if (sub?.value) found.push({ id: String(sub.value), name: String(sub.name || sub.value) });
          }
        } else if (item?.value) {
          found.push({ id: String(item.value), name: String(item.name || item.value) });
        }
      }
    }
  }
  if (found.length === 0 && modelState?.availableModels) {
    for (const model of modelState.availableModels) found.push({ id: model.modelId, name: model.name || model.modelId });
  }
  return found.map((model) => ({ ...model, ...modelOptionMetadata(descriptors) }));
}

export function modelOptionMetadata(descriptors = []) {
  const options = descriptors.map((option) => ({ ...option, name: option.name || option.label || option.id,
    ...(option.type === 'select' ? { options: (option.options || []).map((choice) => ({ ...choice, name: choice.name || choice.label || choice.id })) } : {}) }));
  const effort = options.find(isReasoningOption);
  return { options, efforts: effort?.options || [], ...(effort?.currentValue !== undefined ? { defaultEffort: effort.currentValue } : {}) };
}

const LIVE_PROBE_TIMEOUT_MS = 180_000;

/**
 * Explicit "sync models" probe for Antigravity. The model list only exists on
 * a live session's configOptions, so an explicit click boots the managed
 * runtime once (initialize + session/new with silent auth), harvests the
 * options, then disposes. Never invoked by background probes — the ~1 GB
 * PyInstaller unpack is far too heavy for those.
 */
async function probeAntigravityLiveSession(ctx, agent, cwd, { binaryPath, version }) {
  const conn = new AcpSessionConnection({
    ctx,
    agentConfig: agent,
    cwd: cwd || process.cwd(),
    resumeSessionId: null,
  });
  let timer = null;
  try {
    await Promise.race([
      conn.ensureReady(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Antigravity session did not start within ${LIVE_PROBE_TIMEOUT_MS / 1000}s.`)),
          LIVE_PROBE_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    // sessionSetupResult.configOptions arrives synchronously in start(); one
    // explicit refresh also catches agents that publish them only later.
    await conn._refreshModeAndConfig();
    return {
      ok: true,
      binaryPath,
      version,
      authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      configOptions: conn.configOptions || [],
      models: modelsFromConfigOptions(conn.configOptions),
      currentModelId: conn.currentModel || null,
      slashCommands: conn.availableCommands || [],
      acpAuthenticated: conn.acpAuthenticated === true,
      probe: { agentInfo: { name: 'antigravity-acp', title: 'Google Antigravity' } },
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), binaryPath };
  } finally {
    if (timer) clearTimeout(timer);
    await conn.close().catch(() => {});
  }
}

export async function probeAcpAgent(ctx, agent, cwd, options = {}) {
  const { catalog, providers, effect } = runtimeBundle();
  await initAgentRuntime();
  const commandPath = agent.command ? resolveCommandBinary(agent.command, agent.env) : '';
  if (agent.registrySource !== 'registry' && !commandPath) {
    return { ok: false, error: `Command "${agent.command}" not found on PATH.` };
  }
  const environment = buildAgentRuntimeEnv(agent, commandPath);
  const wiring = agentWiring(agent, commandPath);
  if (wiring.isClaude) {
    environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ??= '1';
  }
  // ACP runtime AntigravityDriver probe — static; the binary must never spawn for
  // capability discovery (PyInstaller bundle, ~1 GB unpack per launch).
  if (wiring.isAntigravity) {
    const { antigravityManagedExecutable } = runtimeBundle();
    const executable = await antigravityManagedExecutable({
      baseDir: runtimeHomeDir(),
      installIfMissing: false,
    }).catch(() => null);
    const binaryPath = executable?.executablePath || commandPath;
    // The static stub stays for implicit probes (agent toggle, catalog
    // refresh). An explicit "sync from CLI" click is the one place where the
    // user is asking for a real session — without it the sync is a no-op that
    // reports success anyway.
    if (options.liveSession) {
      return probeAntigravityLiveSession(ctx, agent, cwd, {
        binaryPath,
        version: executable?.version || null,
      });
    }
    return {
      ok: true,
      binaryPath,
      version: executable?.version || null,
      authMethods: [{ id: 'oauth-personal', name: 'Log in with Google' }],
      configOptions: [],
      models: [],
      currentModelId: null,
      slashCommands: [],
      probe: { agentInfo: { name: 'antigravity-acp', title: 'Google Antigravity' } },
    };
  }
  const settings = registrySettingsFor(agent, commandPath);
  try {
    const result = await effect.runCatch(
      providers.AcpRegistryProbe.probeAcpRegistryConfiguration({
        // Public probe results validate ProviderInstanceId as a slug. The
        // colon-prefixed legacy identity is reserved for existing auth/profile
        // storage; it is not a valid ID for the registry result contract.
        instanceId: `dsh-${agent.id}`,
        settings,
        cwd: cwd || process.cwd(),
        // Full process env required: the probe internally runs
        // catalog.resolve, which uses this as the complete environment.
        environment: { ...process.env, ...environment },
      }),
    );
    const probe = result?.probe || {};
    return {
      ok: true,
      binaryPath: commandPath,
      version: probe.version || null,
      authMethods: probe.authMethods || [],
      configOptions: probe.configOptions || [],
      configOptionsFormat: 'descriptors',
      models: probe.models || [],
      currentModelId: probe.currentModelId || null,
      slashCommands: result?.slashCommands || [],
      probe,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err), binaryPath: commandPath };
  }
}
