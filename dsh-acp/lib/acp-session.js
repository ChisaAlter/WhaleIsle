import crypto from 'node:crypto';
import os from 'node:os';
import {
  initAgentRuntime,
  runtimeBundle,
  runtimeHomeDir,
  registrySettingsFor,
} from './agent-runtime.js';
import {
  buildAgentRuntimeEnv,
  buildTerminalEnv,
  resolveCommandBinary,
  sanitizeHostEnvForAgent,
} from './presets.js';
import { acpErrorMessage } from './errors.js';
import { stageLog } from './store-file.js';
import {
  abortSignalError,
  permissionDecisionOf,
  agentWiring,
  antigravityAuthConfigFor,
  clientCapabilitiesFor,
  createDeferred,
} from './acp-session-utils.js';
import { AcpTurnExecution } from './acp-turn.js';
import {
  isReasoningOption,
  optionChoiceId,
  modelsFromConfigOptions,
  modelOptionMetadata,
  syncConnectionModelAndEffort,
  syncConnectionRuntimeMode,
  syncConnectionOption,
} from './acp-config-options.js';
import {
  wireSessionHandlers,
  requestTerminalExecuteApproval,
  handleCreateTerminal,
  resolveSessionPermission,
  normalizeProviderToolCall,
  extractProviderSubagentUpdate,
  isProviderProvisionalSubagentTool,
  applyClaudeSubagentSessionEvent,
  finishSubagentNotice,
} from './acp-session-handlers.js';

export { agentWiring, antigravityAuthConfigFor };
export { AcpTurnExecution };
export { modelsFromConfigOptions, modelOptionMetadata };
export { probeAcpAgent } from './acp-probe.js';

const STARTUP_TIMEOUT_MS = 30_000;
// Antigravity's managed runtime unpacks ~1 GB on cold start (same bound the
// explicit live probe uses).
const STARTUP_TIMEOUT_AGY_MS = 180_000;

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
    const startupAbort = new AbortController();
    this._startupAbort = startupAbort;
    const started = this._startupPromise = this._start(startupAbort.signal);
    started.catch(() => { /* Observed by Promise.race or late cleanup checkpoints. */ });
    let timer = null;
    let onAbort = null;
    const watchdog = new Promise((_, reject) => {
      if (signal) {
        if (signal.aborted) {
          const err = abortSignalError();
          startupAbort.abort(err);
          reject(err);
          return;
        }
        onAbort = () => {
          const err = abortSignalError();
          startupAbort.abort(err);
          reject(err);
        };
        signal.addEventListener?.('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        const err = new Error(
          `ACP agent "${this.agentConfig?.name}" session did not start within ${Math.round(timeoutMs / 1000)}s.`,
        );
        startupAbort.abort(err);
        reject(err);
      }, timeoutMs);
      timer.unref?.();
    });
    const release = () => {
      if (timer) clearTimeout(timer);
      if (onAbort) signal.removeEventListener?.('abort', onAbort);
    };
    // `started` may still be settling after a watchdog loss; _start aborts at
    // checkpoints and reaps late resources without blocking _close().
    this.readyPromise = Promise.race([started, watchdog]).then(
      (value) => {
        release();
        return value;
      },
      async (err) => {
        release();
        this.readyPromise = null;
        await this.close().catch(() => { /* Preserve the original startup failure while releasing its session. */ });
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
    if (this.closed || signal?.aborted) {
      throw this.closed ? new Error('connection closed') : abortSignalError();
    }

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
    // runtime under a sealed environment (extendEnv:false, isolated
    // GEMINI_HOME profile) — never the registry build and never the host env.
    let spawn;
    let agyOptions = null;
    this._agyPlan = null;
    const sanitizedBaseEnv = sanitizeHostEnvForAgent(process.env);
    if (wiring.isAntigravity) {
      const { antigravitySessionPlan, antigravitySessionOptions } = runtimeBundle();
      const agyAuth = antigravityAuthConfigFor(agent, environment);
      this._agyPlan = await antigravitySessionPlan({
        instanceId: `dsh:${agent.id}`,
        profileDirectory: agent.profileDir || agent.env?.GEMINI_HOME,
        cwd: this.cwd,
        baseEnv: { ...sanitizedBaseEnv, ...environment },
        auth: agyAuth,
        stateDir: runtimeHomeDir(),
        userHome: os.homedir(),
        signal,
        ...(commandPath ? { executablePath: commandPath } : {}),
      });
      if (this.closed || signal?.aborted) {
        const plan = this._agyPlan;
        this._agyPlan = null;
        await plan?.cleanup?.().catch(() => { /* Startup already aborted/closed; ignore best-effort plan cleanup error. */ });
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
      // to hostEnvironment when null) — merge sanitized host env so npm/uvx/binary
      // lookup and the spawned agent both see PATH without leaking DSH secrets.
      const resolved = await catalog.resolve(
        settings,
        this.cwd,
        { ...sanitizedBaseEnv, ...environment },
        { signal },
      );
      if (this.closed || signal?.aborted) {
        throw this.closed ? new Error('connection closed') : abortSignalError();
      }
      spawn = { ...resolved.spawn };
      if (environment && Object.keys(environment).length > 0) {
        spawn.env = { ...(spawn.env || {}), ...environment };
      }
    }
    // Only inject MCP bridge env into the agent process when explicitly opted in;
    // normal sessions pass credentials exclusively to the dedicated MCP server entry.
    if (this.mcpInjection?.processEnvironment && process.env.DSH_ACP_ALLOW_TERMINAL_MCP_FALLBACK === '1') {
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
    let handle;
    try {
      handle = await createSession({
        signal,
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
    } catch (error) {
      if (this.closed && this._agyPlan) {
        const plan = this._agyPlan;
        this._agyPlan = null;
        await plan.cleanup().catch(() => { /* createSession already failed; ignore best-effort plan cleanup error. */ });
      }
      throw error;
    }
    stageLog('session-created');
    // Abort/timeout can fire while createSession is in flight: the runtime
    // spawned the agent already, so a stale handle must die here (AC-008).
    if (this.closed || signal?.aborted) {
      await disposeSession(handle).catch(() => { /* Cancellation below remains the outcome even if the stale session already closed. */ });
      if (this._agyPlan) {
        const plan = this._agyPlan;
        this._agyPlan = null;
        await plan.cleanup().catch(() => { /* createSession already failed; ignore best-effort plan cleanup error. */ });
      }
      throw this.closed ? new Error('connection closed') : abortSignalError();
    }
    this.handle = handle;
    this.api = sessionApi(handle.service);

    const checkAbortedAfterHandle = async () => {
      if (!this.closed && !signal?.aborted) return;
      if (this.handle === handle) {
        this.handle = null;
        await disposeSession(handle).catch(() => { /* Connection closed/aborted after handle set; ignore stale dispose error. */ });
      }
      if (this._agyPlan) {
        const plan = this._agyPlan;
        this._agyPlan = null;
        await plan.cleanup().catch(() => { /* createSession already failed; ignore best-effort plan cleanup error. */ });
      }
      throw this.closed ? new Error('connection closed') : abortSignalError();
    };

    // Client terminals (ACP runtime adapter.ts:5880-5891): Devin only, shell command
    // mode, guarded by the same execute disposition ACP runtime applies.
    if (!wiring.isAntigravity) {
      this.terminals = await effect.runCatch(
        providers.AcpClientTerminals.makeAcpClientTerminals({
          shellCommands: wiring.isDevin,
          defaultCwd: this.cwd,
          environment: buildTerminalEnv(environment, agent.env),
        }).pipe(effect.Effect.provideService(effect.Scope.Scope, handle.scope)),
      );
      await checkAbortedAfterHandle();
    }

    stageLog('wire-handlers-start');
    await this._wireHandlers();
    await checkAbortedAfterHandle();
    stageLog('wire-handlers-done');

    await this.api.initialize();
    await checkAbortedAfterHandle();
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
      await checkAbortedAfterHandle();
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
      await checkAbortedAfterHandle();
      stageLog('agy-mode-applied');
    }
  }

  _onAntigravityAuthorizationUrl(url) {
    const turn = this.activeTurn;
    if (!turn || typeof url !== 'string' || !url) return;
    turn.registerToolCall({
      toolCallId: `agy-auth-${crypto.randomUUID()}`,
      title: 'Antigravity sign-in required',
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
      effect.run(effect.Deferred.succeed(event.acknowledge, undefined)).catch(() => { /* The runtime may close its barrier during cancellation; no user operation remains. */ });
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
        const prior = this.activeTurn.promptResponse || {};
        this.activeTurn.complete({
          ...prior,
          ...work,
          stopReason: work?.stopReason || prior.stopReason || (this.activeTurn.background ? 'end_turn' : undefined),
          usage: work?.usage || prior.usage,
        });
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
    const turn = new AcpTurnExecution({ connection: this, promptBlocks: [], signal: undefined, hostAgent: this.hostAgent });
    turn.background = true;
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
    return applyClaudeSubagentSessionEvent(this, subEvent);
  }

  _normalizeToolCall(toolCall) {
    return normalizeProviderToolCall(this.wiring, toolCall);
  }

  _extractSubagentUpdate(toolCall) {
    return extractProviderSubagentUpdate(this.wiring, toolCall);
  }

  _isProvisionalSubagentTool(toolCall) {
    return isProviderProvisionalSubagentTool(this.wiring, toolCall);
  }

  _handleTermination(error) {
    this.closed = true;
    const failure =
      error instanceof Error
        ? error
        : new Error(`ACP agent "${this.agentConfig?.name}" connection terminated`);
    this.activeTurn?.fail(failure);
    // Avoid closing the event subscription from inside its own callback.
    queueMicrotask(() => { void this.close().catch(() => { /* The active turn already received the connection failure above. */ }); });
  }

  _wireHandlers() {
    return wireSessionHandlers(this);
  }

  _requestTerminalExecuteApproval(request, envKeys = []) {
    return requestTerminalExecuteApproval(this, request, envKeys);
  }

  _handleCreateTerminal(request, terminals, runtimePolicy, providers, toPromise) {
    return handleCreateTerminal(this, request, terminals, runtimePolicy, providers, toPromise);
  }

  _finishSubagent(notice) {
    return finishSubagentNotice(this, notice);
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
    turn.publishTool(entry);
    turn.reportActivity();
    return decision;
  }

  _resolvePermission(params, runtimePolicy, requestContext) {
    return resolveSessionPermission(this, params, runtimePolicy, requestContext);
  }

  _setConfigOptions(options) {
    this.configOptions = options;
    const model = options.find((option) => option.type === 'select' && (option.category === 'model' || option.id === 'model'));
    if (model?.currentValue !== undefined) this.currentModel = model.currentValue;
    const effort = options.find(isReasoningOption);
    if (effort?.currentValue !== undefined) this.currentEffort = optionChoiceId(effort.currentValue);
    else if (!effort) this.currentEffort = undefined;
  }

  syncModelAndEffort(modelId, reasoningEffort, signal, explicitEffort = false) {
    return syncConnectionModelAndEffort(this, modelId, reasoningEffort, signal, explicitEffort);
  }

  syncRuntimeMode(interactionMode, signal) {
    return syncConnectionRuntimeMode(this, interactionMode, signal);
  }

  syncOption(id, value) {
    return syncConnectionOption(this, id, value);
  }

  close() {
    return this._closePromise ??= this._close();
  }

  async _close() {
    this.closed = true;
    try {
      this._startupAbort?.abort(new Error('connection closed'));
    } catch {
      // ignore
    }
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
      if (handle || !this._startupPromise) {
        const agyPlan = this._agyPlan;
        this._agyPlan = null;
        if (agyPlan) await agyPlan.cleanup().catch(() => { /* Teardown already shutting down; ignore best-effort plan cleanup error. */ });
      } else {
        // Never block watchdog/abort teardown indefinitely on a hung startup;
        // _start's closed checkpoints reap late handles and _agyPlan cleanly.
        const settled = await Promise.race([
          this._startupPromise.then(() => true, () => true),
          new Promise((resolve) => {
            const t = setTimeout(() => resolve(false), 50);
            t.unref?.();
          }),
        ]);
        if (settled) {
          const agyPlan = this._agyPlan;
          this._agyPlan = null;
          if (agyPlan) await agyPlan.cleanup().catch(() => { /* Teardown already shutting down; ignore best-effort plan cleanup error. */ });
        }
      }
    }
  }
}
