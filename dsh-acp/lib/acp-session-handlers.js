import crypto from 'node:crypto';
import path from 'node:path';
import { runtimeBundle } from './agent-runtime.js';
import { acpErrorMessage } from './errors.js';
import { stageLog } from './store-file.js';
import { assertWorkspaceContainment } from './delegate-cwd.js';
import {
  providerRequestKind,
  permissionDecisionOf,
  permissionOutcome,
  autoAllowedOutcome,
} from './acp-session-utils.js';

const MAX_WRITTEN_PATHS = 4096;
const DANGEROUS_TERMINAL_ENV_RE = /^(?:LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|NODE_OPTIONS|PYTHONSTARTUP|BASH_ENV|ENV|IFS|PATH)$/i;

export function sanitizeTerminalRequestEnv(rawEnv) {
  if (Array.isArray(rawEnv)) {
    const sanitizedEnv = [];
    const envKeys = [];
    for (const entry of rawEnv) {
      const name = String(entry?.name || '').trim();
      if (!name || DANGEROUS_TERMINAL_ENV_RE.test(name)) continue;
      sanitizedEnv.push({ name, value: String(entry?.value ?? '') });
      envKeys.push(name);
    }
    return { sanitizedEnv, envKeys };
  }
  if (rawEnv && typeof rawEnv === 'object') {
    const sanitizedEnv = {};
    const envKeys = [];
    for (const [key, value] of Object.entries(rawEnv)) {
      const name = String(key || '').trim();
      if (!name || value === undefined || value === null || DANGEROUS_TERMINAL_ENV_RE.test(name)) continue;
      sanitizedEnv[name] = String(value);
      envKeys.push(name);
    }
    return { sanitizedEnv, envKeys };
  }
  return { sanitizedEnv: undefined, envKeys: [] };
}

export async function wireSessionHandlers(conn) {
  const { effect, providers, clientFileSystem } = runtimeBundle();
  const wiring = conn.wiring || {};
  // ACP runtime policy table: approval-required pairs with a workspace-write sandbox
  // (mutations ask), full-access pairs with dangerFullAccess (allow). A
  // workspaceWrite sandbox under auto-allow would DENY execute calls.
  const autoAllow = conn.agentConfig.permissionPolicy === 'auto-allow';
  const initialPolicy = {
    runtimeMode: autoAllow ? 'full-access' : 'approval-required',
    cwd: conn.cwd,
    approvalPolicy: autoAllow ? 'never' : 'on-request',
    sandboxPolicy: autoAllow ? { type: 'dangerFullAccess' } : { type: 'workspaceWrite' },
  };
  // Callbacks resolve the current turn's host policy, not the policy that
  // happened to be active when this long-lived connection was initialized.
  const runtimePolicy = new Proxy(initialPolicy, {
    get: (target, key) => (conn.getRuntimePolicy?.(conn) || target)[key],
  });

  // ACP runtime makeAcpClientPolicyGrants: interactive "command" approvals feed the
  // terminal/create execute grant for their turn/session scope.
  conn._policyGrants = providers.AcpClientPolicy.makeAcpClientPolicyGrants();

  // ACP runtime AntigravityClientFiles: symlink-aware containment inside the session
  // workspace, 8 MiB read cap, 1-indexed line/limit slicing.
  const clientFs = await clientFileSystem([conn.cwd]);
  const fullFs = await clientFileSystem([path.parse(path.resolve(conn.cwd)).root]);
  const fileBridge = () => runtimePolicy.sandboxPolicy?.type === 'dangerFullAccess' ? fullFs : clientFs;
  stageLog('clientfs-ready');

  const handlers = {
    handleRequestPermission: async (params, requestContext) =>
      conn._resolvePermission(params, runtimePolicy, requestContext),
    handleReadTextFile: async (request) => {
      stageLog('fs-read ' + JSON.stringify(request).slice(0, 300));
      const out = await fileBridge().readTextFile(request);
      stageLog('fs-read-done');
      return out;
    },
    handleWriteTextFile: async (request) => {
      if (runtimePolicy.sandboxPolicy?.type === 'readOnly') throw new Error('The active runtime policy is read-only.');
      if (runtimePolicy.approvalPolicy !== 'never') {
        const decision = await conn._requestApproval({ title: `Write file: ${request.path}`, kind: 'edit', params: {}, toolCall: { kind: 'edit', rawInput: { path: request.path } } });
        if (!['accept', 'acceptForSession'].includes(decision)) throw new Error('File write was not approved.');
      }
      stageLog('fs-write ' + JSON.stringify({
        path: request?.path,
        bytes: typeof request?.content === 'string' ? Buffer.byteLength(request.content, 'utf8') : 0,
      }));
      const out = await fileBridge().writeTextFile(request);
      stageLog('fs-write-done');
      if (conn.writtenPaths.size >= MAX_WRITTEN_PATHS) {
        conn.writtenPaths.delete(conn.writtenPaths.values().next().value);
      }
      conn.writtenPaths.add(path.resolve(conn.cwd, String(request?.path ?? '')));
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
        const decision = await conn._requestApproval({
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
        const decision = await conn._requestApproval({
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
      if (params?.mode === 'form' && conn.requestUserInput && conn.activeTurn) {
        const form = runtimeBundle().parseElicitationForm(params.requestedSchema, params.message || 'Agent input');
        if (!form) throw new Error('This ACP form uses fields the host cannot present.');
        const answers = {};
        for (const question of form.questions) {
          const response = await conn.requestUserInput({ turn: conn.activeTurn, connection: conn }, question);
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
    conn.mcpInjection?.acpServers?.length
    && conn.mcpInjection.endpoint
    && conn.mcpInjection.authorization
  ) {
    const bridge = await effect.runCatch(
      providers.AcpMcpOverAcpBridge.makeAcpMcpOverAcpBridge({
        endpoint: conn.mcpInjection.endpoint,
        authorization: conn.mcpInjection.authorization,
        allocateConnectionId: effect.Effect.sync(() => crypto.randomUUID()),
      }),
    );
    if (conn.closed) {
      await effect.runCatch(bridge.dispose).catch(() => {});
      return;
    }
    conn._mcpBridge = bridge;
    if (conn.handle?.scope && effect.Scope?.addFinalizer) {
      await effect.runCatch(effect.Scope.addFinalizer(conn.handle.scope, bridge.dispose)).catch(() => {});
    }
    handlers.handleMcpConnect = (request) =>
      effect.runCatch(bridge.connect(request));
    handlers.handleMcpMessage = (request) =>
      effect.runCatch(bridge.message(request));
    handlers.handleMcpNotification = (request) =>
      effect.runCatch(bridge.notification(request));
    handlers.handleMcpDisconnect = (request) =>
      effect.runCatch(bridge.disconnect(request));
  }

  if (conn.terminals) {
    // Teardown clears conn.terminals before awaiting disposal. Requests
    // already dispatched by the native process still own this service.
    const terminals = conn.terminals;
    const toPromise = (eff) => effect.runCatch(eff);
    // ACP runtime guardClientTerminalCreate (adapter.ts:5867-5877): client terminals
    // run with host privileges, so creation passes the execute disposition —
    // allow, a recorded approval grant, or a fresh interactive approval.
    handlers.handleCreateTerminal = (request) =>
      conn._handleCreateTerminal(request, terminals, runtimePolicy, providers, toPromise);
    handlers.handleTerminalOutput = (request) =>
      toPromise(terminals.output(request));
    handlers.handleTerminalWaitForExit = (request) =>
      toPromise(terminals.waitForExit(request));
    handlers.handleTerminalKill = (request) =>
      toPromise(terminals.kill(request));
    handlers.handleTerminalRelease = (request) =>
      toPromise(terminals.release(request));
  }

  stageLog('assign-handlers-start ' + Object.keys(handlers).join(','));
  await conn.api.assignHandlers(handlers);
  stageLog('assign-handlers-done');

  // ACP runtime registry adapter.ts:242-248 — Copilot extension notifications feed
  // its subagent routing on the raw runtime service.
  if (wiring.isCopilot && conn._copilotRouting && conn.handle?.service) {
    await effect
      .runCatch(
        conn._copilotRouting.registerExtensions({
          runtime: conn.handle.service,
          finishSubagent: (notice) =>
            effect.Effect.sync(() => conn._finishSubagent(notice)),
        }),
      )
      .catch(() => { /* Copilot routing is an optional notification; it must not change the completed session event. */ });
  }
}

export async function requestTerminalExecuteApproval(conn, request, envKeys = []) {
  const turn = conn.activeTurn;
  const decision = await conn._requestApproval({
    title: request?.command ? `Run terminal command: ${request.command}` : 'Run terminal command',
    kind: 'execute',
    params: {},
    toolCall: {
      title: request?.command || 'terminal/create',
      kind: 'execute',
      rawInput: {
        command: request?.command,
        args: request?.args,
        cwd: request?.cwd,
        ...(envKeys.length > 0 ? { envKeys } : {}),
      },
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
  if (decision === 'acceptForSession') {
    conn._policyGrants?.recordApproval({
      kind: 'command',
      scope: 'session',
      turnKey: turn?.turnKey ?? null,
    });
  }
}

export async function handleCreateTerminal(conn, request, terminals, runtimePolicy, providers, toPromise) {
  if (conn.closed) throw new Error('ACP connection closed before terminal creation.');
  const disposition = providers.AcpClientPolicy.acpClientExecuteDisposition(runtimePolicy);
  if (disposition === 'deny') {
    throw new Error('The active runtime policy does not allow terminal/create.');
  }
  if (request?.cwd && runtimePolicy.sandboxPolicy?.type !== 'dangerFullAccess') {
    assertWorkspaceContainment(conn.cwd, String(request.cwd), { label: String(request.cwd) });
  }
  const { sanitizedEnv, envKeys } = sanitizeTerminalRequestEnv(request?.env);
  const safeRequest = request && typeof request === 'object'
    ? { ...request, ...(sanitizedEnv !== undefined ? { env: sanitizedEnv } : {}) }
    : request;
  const turn = conn.activeTurn;
  const grants = conn._policyGrants;
  const granted = Boolean(
    turn && grants && (typeof grants.consumeExecute === 'function'
      ? grants.consumeExecute(turn.turnKey)
      : grants.allowsExecute(turn.turnKey)),
  );
  if (disposition !== 'allow' && !granted) {
    await conn._requestTerminalExecuteApproval(safeRequest, envKeys);
  }
  if (conn.closed) throw new Error('ACP connection closed before terminal creation.');
  return toPromise(terminals.create(safeRequest));
}

export async function resolveSessionPermission(conn, params, runtimePolicy) {
  const { providers } = runtimeBundle();
  const wiring = conn.wiring || {};
  stageLog('permission-req ' + JSON.stringify(params).slice(0, 500));

  // ACP runtime AntigravityProtocol: `interaction_*` tool calls are the agent's own
  // user-input questions, not binary approvals. Route the original choices
  // through the host question service and return the selected protocol id.
  if (
    wiring.isAntigravity
    && providers.AntigravityProtocol.isAntigravityUserInputRequest(params)
  ) {
    const question = providers.AntigravityProtocol.extractAntigravityUserInputQuestion(params);
    const turn = conn.activeTurn;
    const toolCallId = String(
      params?.toolCall?.toolCallId || `question-${crypto.randomUUID()}`,
    );
    const settleQuestion = (status, outputText) => {
      const entry = turn?.toolCalls.get(toolCallId);
      if (!entry) return;
      entry.status = status;
      entry.outputText = outputText;
      for (const waiter of entry.waiters.splice(0)) waiter();
      turn.publishTool(entry);
      turn.reportActivity();
    };
    if (turn && !turn.toolCalls.has(toolCallId)) {
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
    if (!question || !turn || !conn.requestUserInput) {
      settleQuestion('failed', 'Question cancelled');
      return { outcome: { outcome: 'cancelled' } };
    }
    try {
      const answer = await conn.requestUserInput({ turn, connection: conn }, question);
      const selected = answer.answers?.find((item) => item.id === question.id)?.selected?.[0];
      const option = question.options.find((item) => item.label === selected);
      settleQuestion(option ? 'completed' : 'failed', selected || 'Question cancelled');
      return option ? { outcome: { outcome: 'selected', optionId: option.value } } : { outcome: { outcome: 'cancelled' } };
    } catch (error) {
      settleQuestion('failed', turn.signal?.aborted ? 'Question cancelled' : acpErrorMessage(error));
      if (turn.signal?.aborted) return { outcome: { outcome: 'cancelled' } };
      throw error;
    }
  }

  const disposition = providers.AcpClientPolicy.acpPermissionDisposition(runtimePolicy, params);
  if (disposition === 'allow') return autoAllowedOutcome(params);
  if (disposition === 'deny') return permissionOutcome(params, 'decline');

  const turn = conn.activeTurn;
  if (turn && !turn.promptDone && !turn.queue.closed) {
    const toolCall = params?.toolCall || {};
    const toolCallId = String(toolCall.toolCallId || `perm-${crypto.randomUUID()}`);
    let entry = turn.toolCalls.get(toolCallId);
    if (!entry) {
      entry = turn.registerToolCall({
        toolCallId,
        title: toolCall.title || 'Permission Request',
        kind: toolCall.kind || 'other',
        args: toolCall.rawInput || {},
        locations: toolCall.locations,
        status: 'pending',
      });
    }
    stageLog('permission-pending toolCall=' + toolCallId);
    const decision = permissionDecisionOf(await conn._awaitPermission(entry, {
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
      conn._policyGrants?.recordApproval({
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

export function normalizeProviderToolCall(wiring, toolCall) {
  if (!toolCall) return toolCall;
  const w = wiring || {};
  try {
    const { providers } = runtimeBundle();
    if (w.isAntigravity) return providers.AntigravityProtocol.normalizeAntigravityToolCall(toolCall);
    if (w.isDevin) return providers.DevinAcp.normalizeDevinToolCall(toolCall);
  } catch {
    // Normalization is display-only; never let it drop the event.
  }
  return toolCall;
}

export function extractProviderSubagentUpdate(wiring, toolCall) {
  if (!toolCall) return undefined;
  const w = wiring || {};
  try {
    const { providers } = runtimeBundle();
    if (w.isAntigravity) {
      if (providers.AntigravityProtocol.classifyAntigravitySubagentToolCall(toolCall) !== 'subagent') {
        return undefined;
      }
      const status = toolCall.status === 'failed' ? 'failed' : toolCall.status === 'pending' ? 'pending' : 'running';
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
    if (w.isDevin) return providers.DevinAcp.extractDevinSubagentUpdate(toolCall);
    if (w.isClaude) return providers.ClaudeAcp.extractClaudeSubagentUpdate(toolCall);
    if (w.isCopilot) return providers.CopilotAcp.extractCopilotSubagentUpdate(toolCall);
  } catch {
    // Extraction is best-effort.
  }
  return undefined;
}

export function isProviderProvisionalSubagentTool(wiring, toolCall) {
  if (!wiring?.isClaude) return false;
  try {
    return runtimeBundle().providers.ClaudeAcp.isClaudeProvisionalSubagentTool(toolCall) === true;
  } catch {
    return false;
  }
}

export function applyClaudeSubagentSessionEvent(conn, subEvent) {
  if (subEvent.type === 'delegation') {
    if (subEvent.childSessionId && subEvent.delegationId) {
      conn._subagentToolByChildSession.set(subEvent.childSessionId, subEvent.delegationId);
    }
    return;
  }
  const toolCallId = conn._subagentToolByChildSession.get(subEvent.childSessionId);
  const turn = conn.activeTurn;
  if (!toolCallId || !turn) return;
  const entry = turn.toolCalls.get(toolCallId);
  if (!entry) return;
  entry.subagentStatus = subEvent.status;
  if (subEvent.status === 'completed' || subEvent.status === 'failed' || subEvent.status === 'cancelled') {
    entry.status = subEvent.status === 'cancelled' ? 'failed' : subEvent.status;
    if (subEvent.result) entry.outputText = String(subEvent.result);
    for (const waiter of entry.waiters.splice(0)) waiter();
    turn.publishTool(entry);
    turn.reportActivity();
    conn._subagentToolByChildSession.delete(subEvent.childSessionId);
  }
}

export function finishSubagentNotice(conn, notice) {
  // notice.childSessionId for copilot is `copilot-task:${toolCallId}`.
  const toolCallId = conn._subagentToolByChildSession.get(notice.childSessionId)
    || (typeof notice.childSessionId === 'string' && notice.childSessionId.startsWith('copilot-task:')
      ? notice.childSessionId.slice('copilot-task:'.length)
      : null);
  const turn = conn.activeTurn;
  if (!toolCallId || !turn) return;
  const entry = turn.toolCalls.get(toolCallId);
  if (!entry) return;
  entry.status = notice.status === 'cancelled' ? 'failed' : notice.status;
  if (notice.result) entry.outputText = String(notice.result);
  for (const waiter of entry.waiters.splice(0)) waiter();
  turn.publishTool(entry);
  turn.reportActivity();
  if (entry.status === 'completed' || entry.status === 'failed') {
    conn._subagentToolByChildSession.delete(notice.childSessionId);
  }
}
