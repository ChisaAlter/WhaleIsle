import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { saveSessionStore } from './presets.js';
import { AcpTurnExecution } from './acp-session.js';
import { runtimeBundle } from './agent-runtime.js';
import { TEAM_GUIDANCE, teamEnabled } from './team.js';
import { stageLog } from './store-file.js';
import { acpErrorMessage } from './errors.js';
import { approvalPolicyOf, safeGetService } from './host-contract.js';
import { isAuxiliaryCall, prepareConversationPrompt } from './prompt-context.js';
import { encodeConnKey } from './catalog-models.js';

const execFileAsync = promisify(execFile);
const MAX_GIT_REPO_CACHE = 256;

function readSessionEvents(session) {
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents() || [];
  if (typeof session?.events === 'function') return session.events() || [];
  return Array.isArray(session?.events) ? session.events : [];
}

function listRegisteredAgents(agentsSvc) {
  if (typeof agentsSvc.list === 'function') return agentsSvc.list();
  if (typeof agentsSvc.values === 'function') return [...agentsSvc.values()];
  return [];
}

function resolveLastMessageId(options) {
  if (!Array.isArray(options?.messages)) return null;
  for (let i = options.messages.length - 1; i >= 0; i -= 1) {
    const msg = options.messages[i];
    if (msg && typeof msg.id === 'string') return msg.id;
  }
  return null;
}

export function resolveActiveDshAgent(ctx, options) {
  const agentsSvc = safeGetService(ctx, 'agents');
  if (!agentsSvc) return null;
  try {
    // The registry resolves agents directly by session id.
    const byId = options?.sessionId ? agentsSvc.get?.(String(options.sessionId)) : null;
    if (byId) return byId;
  } catch {
    // ignore
  }
  try {
    // AsyncLocalStorage boundary set by the driving loop.
    const initiator = agentsSvc.currentInitiator?.() ?? agentsSvc.initiator?.();
    if (initiator) return initiator;
  } catch {
    // ignore
  }
  try {
    const list = listRegisteredAgents(agentsSvc);
    if (list.length > 0) {
      const lastMsgId = resolveLastMessageId(options);
      if (!lastMsgId) return list[0];
      return list.find((agent) =>
        readSessionEvents(agent?.session).some(
          (ev) => ev?.data?.message?.id === lastMsgId || ev?.data?.id === lastMsgId,
        ),
      ) ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function createLlmAdapter({
  ctx,
  storeFile,
  autoDeliverWrites,
  sessionConnections,
  pendingToolExecutions,
  tasks,
  whaleisleMcp,
  getSessionStore,
  getAgentByProvider,
  getAllModelsForAgent,
  getEffectiveModels,
  createConnection,
  ownConnection,
  assertCredentialsStable,
  markAcpAuthed,
  purgePendingToolsForConn,
  releaseConnMcpToken,
  humanOwner,
  planActive,
  askOperation,
  runtimePolicyFor,
  appendAcpErrorLog,
}) {
  const gitRepoCache = new Map();

  async function insideGitRepo(cwd) {
    let inside = gitRepoCache.get(cwd);
    if (inside === undefined) {
      try {
        const res = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
          cwd, encoding: 'utf8', timeout: 8000, windowsHide: true,
        });
        inside = String(res.stdout || '').trim() === 'true';
      } catch {
        inside = false;
      }
      if (gitRepoCache.size >= MAX_GIT_REPO_CACHE) {
        gitRepoCache.delete(gitRepoCache.keys().next().value);
      }
      gitRepoCache.set(cwd, inside);
    }
    return inside;
  }

  async function autoDeliver(conn, dshSession) {
    try {
      const written = conn?.writtenPaths;
      if (!autoDeliverWrites || !written?.size) return;
      if (!dshSession || typeof dshSession.append !== 'function') return;
      if (await insideGitRepo(conn.cwd)) {
        written.clear();
        return;
      }
      const fsSvc = safeGetService(ctx, 'fs');
      const projections = safeGetService(ctx, 'sessionProjections');
      if (!fsSvc || !projections) return;
      const boundary = projections.stateOf(dshSession, 'turnBoundary');
      const turn = boundary?.lastTurn;
      if (turn == null) return;
      const alreadyPresented = whaleisleMcp.sessionFor(conn.mcpToken)?.presented;
      const files = [];
      for (const filePath of [...written]) {
        try {
          const target = await fsSvc.resolve(filePath, { cwd: conn.cwd });
          const info = await fsSvc.stat(target);
          if (info === undefined || info.type !== 'file') continue;
          const canonical = fsSvc.processPath(target);
          if (alreadyPresented?.has(canonical)) continue;
          files.push({ path: canonical });
        } catch {
          // A path that no longer resolves is simply not delivered.
        }
      }
      written.clear();
      if (files.length === 0) return;
      dshSession.append('deliverables/presented', {
        turn,
        callId: `whaleisle-auto-${crypto.randomBytes(6).toString('hex')}`,
        files,
      });
    } catch (err) {
      appendAcpErrorLog('autoDeliver', err, { cwd: conn?.cwd });
    }
  }

  async function attachmentPrompt(blocks, connection, signal) {
    const result = [];
    for (const block of blocks) {
      if (block.type === 'file') {
        const attachments = safeGetService(ctx, 'attachments');
        const filePath = attachments?.fileHostPath(block.attachment);
        if (!filePath) throw new Error(`Cannot resolve attached file "${block.attachment.name}" to a readable host path.`);
        result.push({ type: 'resource_link', uri: pathToFileURL(filePath).href, name: block.attachment.name, title: block.attachment.name });
        continue;
      }
      if (block.type !== 'image') { result.push(block); continue; }
      if (!connection.supportsImages) throw new Error(`ACP agent "${connection.agentConfig.name}" did not negotiate image prompt support.`);
      const attachments = safeGetService(ctx, 'attachments');
      if (!attachments) throw new Error('The host attachment service is unavailable.');
      const image = await attachments.readImage(block.attachment, signal);
      result.push({ type: 'image', data: Buffer.from(image.data).toString('base64'), mimeType: image.ref.mediaType });
    }
    return result;
  }

  async function requestAcpApproval({ entry, turn, connection }, perm) {
    const targetAgent = turn.hostAgent;
    turn.signal?.throwIfAborted();
    const owner = targetAgent ? humanOwner(targetAgent) : null;
    const ownerSession = owner?.session;
    const hostFullAccess = Boolean(
      ownerSession
      && safeGetService(ctx, 'sandboxPolicy')?.resolve?.({ session: ownerSession })?.mode === 'danger-full-access'
      && safeGetService(ctx, 'approval')
      && approvalPolicyOf(safeGetService(ctx, 'approval'), ownerSession) === 'never',
    );
    const runtimePolicy = runtimePolicyFor(connection);
    const disposition = runtimePolicy && runtimeBundle().providers.AcpClientPolicy.acpPermissionDisposition(runtimePolicy, { toolCall: { ...perm.toolCall, kind: entry.kind } });
    if (disposition === 'deny') return false;
    if (disposition === 'allow') return true;
    if (hostFullAccess && runtimePolicy?.sandboxPolicy.type !== 'readOnly' && runtimePolicy?.approvalPolicy === 'never') return true;
    if (!targetAgent?.session) return false;
    if (targetAgent.session.header?.parentSession) return askOperation(targetAgent, turn.signal,
      `${connection.agentConfig.name}: ${perm.toolCall?.title || entry.title || entry.name}\n${JSON.stringify(entry.args || {})}`);
    const approvalService = safeGetService(ctx, 'approval');
    if (!approvalService?.request) return false;
    const decision = await approvalService.request({
      agent: targetAgent, toolName: entry.name, callId: entry.toolCallId,
      reason: perm.toolCall?.title || entry.title || `Allow ${connection.agentConfig?.name || 'ACP Agent'} to run ${entry.name}?`,
      signal: turn.signal,
    });
    const approvalMap = { 'allowed-always': 'allowed-always', 'allowed-once': true, cancelled: 'cancelled' };
    return Object.hasOwn(approvalMap, decision) ? approvalMap[decision] : false;
  }

  function trackedExecution(exec) {
    const tracked = pendingToolExecutions.get(exec?.callId);
    if (!tracked || (tracked.dshAgent && tracked.dshAgent.id !== exec?.agent?.id)) return undefined;
    if (exec?.name && exec.name !== tracked.entry.name) return undefined;
    return tracked;
  }

  async function executeTrackedToolCall(exec) {
    const tracked = trackedExecution(exec);
    if (!tracked) return null;
    const { entry, turn } = tracked;

    try {
      while (true) {
        if (exec.signal?.aborted) {
          if (entry.pendingPermission) {
            entry.pendingPermission.resolve('cancelled');
            entry.pendingPermission = null;
          }
          break;
        }

        if (entry.status === 'completed' || entry.status === 'failed' || turn.promptDone) {
          break;
        }

        await new Promise((resolve) => {
          const done = () => {
            entry.onPermissionArrived = null;
            const index = entry.waiters.indexOf(done);
            if (index >= 0) entry.waiters.splice(index, 1);
            exec.signal?.removeEventListener('abort', done);
            resolve();
          };
          entry.onPermissionArrived = done;
          entry.waiters.push(done);
          exec.signal?.addEventListener('abort', done, { once: true });
        });
      }

      const isError = entry.status === 'failed' || exec.signal?.aborted === true;
      const outputText = entry.outputText || (exec.signal?.aborted ? 'Tool call cancelled' : isError ? 'Tool call failed' : 'Completed');
      const result = {
        content: [{ type: 'text', text: outputText }],
        value: { text: outputText },
        isError,
        ...(isError ? { error: { message: outputText } } : {}),
      };
      const toolsSvc = safeGetService(ctx, 'tools');
      if (typeof toolsSvc?.markCanonical === 'function' && exec?.token !== undefined) {
        toolsSvc.markCanonical(exec, result);
      } else if (toolsSvc?.canonicalResults instanceof WeakMap && exec?.token !== undefined) {
        toolsSvc.canonicalResults.set(result, exec.token);
      }
      return result;
    } finally {
      if (pendingToolExecutions.get(exec.callId) === tracked) pendingToolExecutions.delete(exec.callId);
    }
  }

  const adapter = {
    providerInfo(provider) {
      const agent = getAgentByProvider(provider);
      return {
        id: provider,
        name: agent ? agent.name : provider,
      };
    },
    providerRetryPolicy(_provider) {
      // ResolvedRetryPolicy shape required by llm-retry: an empty
      // retryableCodes set short-circuits before any retry attempt — an
      // external agent turn must never be replayed implicitly.
      return {
        mode: 'normal',
        maxRetries: 0,
        retryableCodes: [],
        initialDelayMs: 500,
        maxDelayMs: 2_000,
        jitterRatio: 0,
      };
    },
    imageRequestPricing(_provider, _model) {
      return undefined;
    },
    imageRequestTarget(_provider, _model, image) {
      return {
        width: image.width,
        height: image.height,
        maxBytes: image.bytes,
      };
    },
    async listModels(provider) {
      const agent = getAgentByProvider(provider);
      if (!agent || !agent.enabled) return [];
      return getEffectiveModels(agent).map((m) => ({
        provider,
        id: m.id,
        name: m.name || m.id,
        // The composer picker renders `m.favorite`; without it the star
        // state saved in favoriteModels never surfaces in the picker.
        favorite: m.favorite === true,
        ...(m.inputModalities ? { inputModalities: m.inputModalities } : {}),
        ...(m.efforts?.length ? { reasoning: { efforts: m.efforts } } : {}),
      }));
    },
    async resolveModel(provider, model, _signal) {
      const agent = getAgentByProvider(provider);
      const effective = agent ? getAllModelsForAgent(agent) : [];
      const matched = effective.find((m) => m.id === model);
      return {
        provider,
        id: model,
        name: matched?.name || model,
        // Stateful ACP sessions own their context. Host-side summarization
        // cannot replace the external agent's native conversation state.
        contextManagement: 'provider',
        ...(matched?.inputModalities ? { inputModalities: matched.inputModalities } : {}),
        ...(matched?.context ? { context: matched.context } : {}),
        ...(matched?.efforts?.length ? { reasoning: {
          efforts: matched.efforts,
        } } : {}),
      };
    },
    async prepareCall(provider, model, signal) {
      return {
        model: await this.resolveModel(provider, model, signal),
        stream: (callOptions) => this.stream(callOptions),
      };
    },
    async *stream(callOptions) {
      let nextIndex = 0;
      try {
        for await (const chunk of this._streamImpl(callOptions)) {
          if (typeof chunk.index === 'number') nextIndex = Math.max(nextIndex, chunk.index + 1);
          yield chunk;
        }
      } catch (err) {
        appendAcpErrorLog('adapter.stream', err, {
          provider: callOptions?.provider,
          model: callOptions?.model,
          sessionId: callOptions?.sessionId,
          data: err?.data,
        });
        if (callOptions.signal?.aborted || err.name === 'AbortError') throw err;
        // Like the native one-shot providers, retain a useful failure result
        // before settlement. Cold continuations use the host's result delivery.
        const failure = { message: acpErrorMessage(err), code: 'ACP_EXECUTION_FAILED' };
        yield { type: 'block-start', index: nextIndex, blockType: 'text' };
        yield { type: 'text-delta', index: nextIndex, text: failure.message };
        yield { type: 'block-end', index: nextIndex, block: { type: 'text', text: failure.message } };
        yield { type: 'finish', reason: { kind: 'error', failure } };
      }
    },
    async *_streamImpl(callOptions) {
      if (isAuxiliaryCall(callOptions)) {
        // Title generation, compaction, vision describe and the next-prompt
        // predictor are not conversational turns — never spawn the agent.
        yield { type: 'finish', reason: 'stop' };
        return;
      }
      const provider = callOptions.provider;
      const agentConfig = getAgentByProvider(provider);
      if (!agentConfig) {
        throw new Error(`External ACP agent for provider "${provider}" is not configured.`);
      }
      if (!agentConfig.enabled) throw new Error(`Agent "${agentConfig.name}" is disabled.`);

      const dshAgent = resolveActiveDshAgent(ctx, callOptions);
      const rawSessionId =
        callOptions.sessionId || dshAgent?.session?.id || dshAgent?.id || null;
      // Without a resolvable session id, a shared 'default-session' key would
      // silently merge every unidentifiable dsh session into one ACP session.
      // Each such call gets an isolated ephemeral connection instead — never
      // resumed from the store and disposed when the turn ends (AC-040).
      const sessionResolved = rawSessionId !== null && String(rawSessionId) !== '';
      const dshSessionId = sessionResolved
        ? String(rawSessionId)
        : `ephemeral-${crypto.randomUUID()}`;
      const cwd = dshAgent?.session?.header?.cwd || process.cwd();
      const connKey = encodeConnKey(dshSessionId, agentConfig.id);

      let conn = sessionConnections.get(connKey);
      if (conn && conn.closed) {
        sessionConnections.delete(connKey);
        // A conn that died without close() can still hold a live MCP token —
        // release it here instead of leaking the whaleisleMcp session
        // entry (AC-046).
        releaseConnMcpToken(conn);
        await conn.close();
        conn = null;
      }
      if (!conn) {
        conn = createConnection(agentConfig, cwd, dshSessionId, dshAgent);
        sessionConnections.set(connKey, conn);
      } else {
        conn.agentConfig = agentConfig;
      }

      try {
        conn.hostAgent = dshAgent;
        conn.preparingTask = undefined;
        await assertCredentialsStable(agentConfig);
        ownConnection(dshAgent);
        await conn.ensureReady(callOptions.signal);
        if (!conn.promptStarted && conn.restoredSession && conn.acpSessionId !== conn.resumeSessionId) {
          conn.restoredSession = false;
          conn.promptCursor = undefined;
        }
        if (conn.acpAuthenticated) markAcpAuthed(agentConfig.id);
        // Rebind the live dsh session for whaleisle_present; restored
        // connections may have issued the token before the agent resolved.
        if (conn.mcpToken && dshAgent?.session) {
          whaleisleMcp.bindSession(conn.mcpToken, dshAgent.session, callOptions.signal, provider);
        }
        const persistSessionId = (id) => {
          const sessionStore = getSessionStore();
          if (id && sessionResolved && sessionStore[connKey]?.sessionId !== id) {
            sessionStore[connKey] = { ...sessionStore[connKey], sessionId: id, cwd: conn.cwd, updatedAt: Date.now(), promptCursor: conn.promptCursor };
            saveSessionStore(sessionStore, storeFile);
          }
        };
        persistSessionId(conn.acpSessionId);
        await conn.syncModelAndEffort(callOptions.model, callOptions.reasoningEffort, callOptions.signal);
        const currentTask = [...tasks.tasks.values()].findLast((item) => item.childId === dshSessionId);
        for (const setting of currentTask?.options || getSessionStore()[connKey]?.modelOptions?.[callOptions.model] || []) await conn.syncOption(setting.id, setting.value);

        let turn = conn.pendingBackgroundTurns.shift() || conn.activeTurn;
        // A stopped host turn can leave queued ACP text/errors behind while
        // tools/execute is being cancelled. A later user turn must not drain
        // that old queue and fail with the previous turn's AbortError.
        if (turn?.signal?.aborted) turn = null;
        if (turn && !turn.promptDone) {
          if (turn.background) {
            turn.attached = true;
            conn.backgroundWakePending = false;
          }
          turn.attachSignal(callOptions.signal);
        }
        const resolveOwnAssistantId = () => {
          if (!conn.completedPromptCursor || conn.completedPromptCursor !== conn.promptCursor) return undefined;
          const rows = Array.isArray(callOptions.messages) ? callOptions.messages : [];
          const idx = rows.findIndex((m) => m?.id === conn.promptCursor);
          if (idx < 0) return undefined;
          const after = rows.slice(idx + 1);
          const assistants = after.filter((m) => m?.role === 'assistant');
          if (assistants.length !== 1) return undefined;
          const switchedAway = dshAgent?.session?.snapshotEvents?.().some((ev) => {
            if (ev?.type === 'user/message' && ev.data?.source?.kind === 'model-change') {
              const evProvider = ev.data?.source?.provider || ev.data?.provider;
              return Boolean(evProvider && evProvider !== agentConfig.providerId);
            }
            return false;
          });
          return switchedAway ? undefined : assistants[0]?.id;
        };
        const startForegroundTurn = async () => {
          const prepared = prepareConversationPrompt(callOptions.messages, conn, {
            lastAssistantId: resolveOwnAssistantId(),
            providerId: agentConfig.providerId,
          });
          let promptBlocks = await attachmentPrompt(prepared.prompt, conn, callOptions.signal);
          const task = [...tasks.tasks.values()].findLast((item) => item.childId === dshSessionId);
          const interactionMode = planActive(dshAgent) || planActive(humanOwner(dshAgent)) || task?.interactionMode === 'plan' ? 'plan' : 'default';
          await conn.syncRuntimeMode(interactionMode, callOptions.signal);
          const instructions = interactionMode === 'plan'
            ? 'Plan mode: investigate with read-only actions. Do not edit files, run modifying commands, or start implementation. Return a decision-complete plan.'
            : 'Default mode: carry out the authorized request. Ask the user only when a missing decision materially changes the result.';
          const team = teamEnabled(ctx, dshAgent) ? `\n${TEAM_GUIDANCE}` : '';
          if (!String(promptBlocks[0]?.text || '').trimStart().startsWith('/')) promptBlocks = [{ type: 'text', text: `${instructions}${team}\nConfigured-agent tools: use acp_agents once before selecting a configured agent. Use acp_delegate for cross-agent or background work; prefer native children for same-provider, same-settings work completed in this turn. Use a stable client_request_id for retries. Follow next and end your turn; do not poll. Final task results are delivered automatically; do not send_message a second final report. Send earlier messages only for actionable coordination. Use acp_cancel to cancel a task and interrupt_agent only to pause it. As a child, do not delegate again unless the task explicitly authorizes it.` }, ...promptBlocks];
          // Commit cursor only after attachment reads & runtime mode sync succeed.
          conn.promptCursor = prepared.nextCursor;
          conn.promptStarted = true;
          const sessionStore = getSessionStore();
          if (sessionResolved && sessionStore[connKey]?.promptCursor !== conn.promptCursor) {
            sessionStore[connKey] = { ...sessionStore[connKey], promptCursor: conn.promptCursor };
            saveSessionStore(sessionStore, storeFile);
          }
          const nextTurn = new AcpTurnExecution({
            connection: conn,
            promptBlocks,
            signal: callOptions.signal,
            hostAgent: dshAgent,
          });
          conn.activeTurn = nextTurn;
          nextTurn.attached = true;
          conn.workQuarantined = false;
          nextTurn.beginPrompt();
          return nextTurn;
        };
        if (!turn || (turn.promptDone && turn.queue.closed && turn.queue.items.length === 0)) {
          turn = await startForegroundTurn();
        }

        let openIndex = -1;
        let openType = null;
        let blockText = '';
        let nextIndex = 0;
        const closeBlock = function* () {
          if (openType === 'reasoning') {
            yield { type: 'block-end', index: openIndex, block: { type: 'reasoning', text: blockText } };
          } else if (openType === 'text') {
            yield { type: 'block-end', index: openIndex, block: { type: 'text', text: blockText } };
          }
          openType = null;
          openIndex = -1;
          blockText = '';
        };
        const finishChunk = function* (reason) {
          if (turn.usage) {
            yield { type: 'usage', usage: turn.usage };
          }
          stageLog('yield-finish ' + JSON.stringify(reason));
          yield { type: 'finish', reason };
        };

        while (true) {
          const { value: item, done } = await turn.queue.next(callOptions.signal);
          if (done || !item) {
            yield* closeBlock();
            await autoDeliver(conn, dshAgent?.session);
            conn.completedPromptCursor = conn.promptCursor;
            yield* finishChunk({ kind: 'stop' });
            return;
          }

          if (item.type === 'thought') {
            if (openType !== 'reasoning') {
              yield* closeBlock();
              openIndex = nextIndex++;
              openType = 'reasoning';
              yield { type: 'block-start', index: openIndex, blockType: 'reasoning' };
            }
            blockText += item.text;
            yield { type: 'reasoning-delta', index: openIndex, text: item.text };
            continue;
          }

          if (item.type === 'text') {
            if (openType !== 'text') {
              yield* closeBlock();
              openIndex = nextIndex++;
              openType = 'text';
              yield { type: 'block-start', index: openIndex, blockType: 'text' };
            }
            blockText += item.text;
            yield { type: 'text-delta', index: openIndex, text: item.text };
            continue;
          }

          if (item.type === 'tool-call') {
            const entry = item.entry;
            entry.projected = true;
            yield* closeBlock();
            const callIndex = nextIndex++;
            const argsJson = JSON.stringify({
              ...(entry.args && typeof entry.args === 'object' ? entry.args : {}),
              _title: entry.title || entry.name,
              _kind: entry.kind || 'other',
            });
            stageLog('yield-tool-call id=' + entry.toolCallId + ' name=' + entry.name);
            const hostCallId = entry.hostCallId ??= `acp-${turn.turnKey}-${crypto.randomUUID()}`;
            pendingToolExecutions.set(hostCallId, {
              entry,
              turn,
              dshAgent,
              conn,
            });
            yield { type: 'block-start', index: callIndex, blockType: 'tool-call' };
            yield {
              type: 'tool-call-delta',
              index: callIndex,
              id: hostCallId,
              name: entry.name,
              argumentsDelta: argsJson,
            };
            yield {
              type: 'block-end',
              index: callIndex,
              block: { type: 'tool-call', id: hostCallId, name: entry.name, arguments: argsJson },
            };
            yield* finishChunk({ kind: 'tool-calls' });
            return;
          }

          if (item.type === 'prompt-error') {
            yield* closeBlock();
            throw item.error || new Error(`ACP agent "${agentConfig.name}" turn failed`);
          }

          if (item.type === 'prompt-done') {
            if (conn.claudeResumeSessionId) {
              persistSessionId(conn.claudeResumeSessionId);
            }
            yield* closeBlock();
            if (turn.background) {
              const next = conn.pendingBackgroundTurns.shift() || (conn.activeTurn !== turn && conn.activeTurn?.background ? conn.activeTurn : null);
              if (next) { turn = next; turn.attached = true; turn.attachSignal(callOptions.signal); continue; }
            }
            const latestUser = (callOptions.messages || []).findLast((message) => message.role === 'user' && (message.source?.kind === undefined || ['user', 'agent-message', 'subagent-settled'].includes(message.source.kind)));
            if (turn.background && latestUser?.id && latestUser.id !== conn.promptCursor && item.stopReason !== 'cancelled') {
              turn = await startForegroundTurn();
              continue;
            }
            if (item.stopReason === 'cancelled') {
              const error = new Error('ACP provider cancelled the turn.'); error.name = 'AbortError'; throw error;
            }
            await autoDeliver(conn, dshAgent?.session);
            conn.completedPromptCursor = conn.promptCursor;
            yield* finishChunk(item.stopReason === 'max_tokens' ? { kind: 'max-tokens' } : { kind: 'stop' });
            return;
          }
        }
      } finally {
        // Ephemeral connections are scoped to this call: dispose on every
        // exit (finish, error, abort) so an unresolvable session can never
        // leak a live agent process or MCP token (AC-040/AC-046).
        if (!sessionResolved) {
          sessionConnections.delete(connKey);
          purgePendingToolsForConn(conn);
          releaseConnMcpToken(conn);
          void conn.close().catch(() => { /* The failed delegation reports its original error after releasing the unresolved session. */ });
        }
      }
    },
  };

  return {
    adapter,
    attachmentPrompt,
    autoDeliver,
    requestAcpApproval,
    executeTrackedToolCall,
    trackedExecution,
  };
}
