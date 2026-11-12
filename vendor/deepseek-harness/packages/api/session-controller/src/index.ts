/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { hostname } from 'node:os'
import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { errorChain, ReasoningEffortId, type MessageSource } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-client-file-upload'
import { canOpenNativePath, nativeFileManager, nativeFileApplications, openNativeFileApplication, openNativeAssociatedPath, revealNativePath } from '@deepseek-ai/dsh-native-command'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteService, principalOf, type TypertResourceResolveInput } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalClientTimeZone } from '@deepseek-ai/dsh-util-time'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import {
  ApiSessionAgentController,
  ApiSessionNotFound,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { canReuseBlankInspection, inspectAttachedSession } from './blank-reuse.ts'
import { SessionCommandController, hasPromptContent } from './commands.ts'
import { SessionControlController } from './control.ts'
import { ArchivedSessionDelete } from './delete-archived.ts'
import { HistoryController } from './history/controller.ts'
import { IdleSessionRelease } from './idle-release.ts'
import { SessionLifecycle } from './lifecycle.ts'
import { StateController } from './state/controller.ts'
import { WebController } from './web/controller.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList } from './list.ts'
import { buildModelCatalog, hasProviderApiKey } from './catalog.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import { installMessageEdits } from './message-edit.ts'
import { SessionMediaReferences } from './media-references.ts'
import { ArchivedSessionGate } from './archived-session-gate.ts'
import type {
  ModelCatalog,
  SessionWorkspacePathApplication,
  SessionAddress,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionVisualReplyRequest,
  SessionVisualReplyValue,
  SessionBlankReuseRequest,
  SessionBlankReuseValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionPresentationRequest,
  SessionPresentationValue,
  SessionDeleteRequest,
  SessionDeleteValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionEventsPage, SessionPageRequest, SessionEventFrame, SessionObserveEventRequest,
  SessionProjectionFrame, SessionStateRequest, SessionState, SessionWaitRequest, SessionWaitValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Stop plugin-owned background work before cancelling its public Agent.
     * @param payload.agent - the live public Agent about to be cancelled.
     * @param payload.request - the Session cancel request that triggered the cancellation.
     * @mode serial
     */
    'session/before-cancel'(payload: { agent: Agent; request: SessionCancelRequest }): Promise<void> | void
  }
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/**
 * Extract the Session resource from an ID or a history address.
 *
 * Registers as the `session` kind default, so it applies to every Remote method of
 * every namespace: a top-level `sessionId` parameter, otherwise the first object
 * parameter carrying `sessionId` or an `address`. A new request type whose first
 * object parameter has an unrelated `address` field would be read as an address.
 * @param input - validated wire arguments and their ordered parameter descriptions.
 * @returns the named Session identity, otherwise the first object's Session identity or history address.
 * @throws Error when the request object supplies both sessionId and address.
 */
function resolveSessionResource({ args, parameters }: TypertResourceResolveInput): SessionId | undefined {
  const sessionParameter = parameters.find(parameter => parameter.name === 'sessionId' || parameter.wire === 'sessionId')
  if (sessionParameter !== undefined) return args[sessionParameter.wire] as SessionId | undefined
  for (const parameter of parameters) {
    const value = args[parameter.wire]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const request = value as { readonly sessionId?: SessionId; readonly address?: SessionAddress }
    const address = request.address
    if (request.sessionId !== undefined && address !== undefined) {
      throw new Error('Session resource request must not contain both sessionId and address')
    }
    return request.sessionId ?? (address === undefined ? undefined
      : address.kind === 'session' ? address.sessionId : address.childSessionId)
  }
  return undefined
}

/** Session Controller deployment policy. */
export interface Config {
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
  /** Positive integral milliseconds of list work before yielding between complete rows. */
  readonly listWorkSliceMs?: number
  /**
   * Milliseconds an opened Session may stay unwatched and idle before its resident Agent is
   * released; reopening reloads it from persistence. `0` keeps every opened Session resident.
   */
  readonly idleReleaseMs?: number
  /** Most recently active idle Sessions kept resident regardless of {@link idleReleaseMs}. */
  readonly idleReleaseKeep?: number
}

/** Deployment policy after schema defaults have been applied. */
type ResolvedConfig = Config & {
  readonly listWorkSliceMs: number
  readonly idleReleaseMs: number
  readonly idleReleaseKeep: number
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native file-association query. */
  readonly fileApplications?: typeof nativeFileApplications
  /** Explicit registered-application handoff. */
  readonly openFileApplication?: typeof openNativeFileApplication
  /** Native file-manager handoff. */
  readonly revealPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fileUploads',
    'fs',
    'llm',
    'remoteAccess',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'typertGateway',
    'workspaceRegistry',
  ]

  static Config: z<Config, ResolvedConfig> = z.object({
    nativeOpen: z.boolean(),
    listWorkSliceMs: z.natural().min(1).default(16),
    idleReleaseMs: z.natural().default(300_000),
    idleReleaseKeep: z.natural().default(3),
  })

  private historyController!: HistoryController
  private stateController!: StateController
  private webController!: WebController

  private agents!: ApiSessionAgentController
  private commands!: SessionCommandController
  private controlState!: SessionControlController
  private listState!: ApiSessionList
  private lifecycle!: SessionLifecycle
  private archivedDelete!: ArchivedSessionDelete
  private readonly idleReleaseMs: number
  private readonly idleReleaseKeep: number
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly fileApplications: typeof nativeFileApplications
  private readonly openFileApplication: typeof openNativeFileApplication
  private readonly revealPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly listWorkSliceMs: number
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - native-opener and list-scheduling deployment policy.
   * @param internals - host integrations replaceable by direct unit tests.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    const resolved = SessionController.Config(config)
    this.listWorkSliceMs = resolved.listWorkSliceMs
    this.idleReleaseMs = resolved.idleReleaseMs
    this.idleReleaseKeep = resolved.idleReleaseKeep
    this.fileApplications = internals.fileApplications ?? nativeFileApplications
    this.openFileApplication = internals.openFileApplication ?? openNativeFileApplication
    this.openPath = internals.openPath ?? openNativeAssociatedPath
    this.revealPath = internals.revealPath ?? revealNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
  }

  protected async [Service.init](): Promise<void> {
    const ctx = this.ctx
    ctx.typert.resources.register('session', { resolve: resolveSessionResource })
    installMessageEdits(ctx)
    this.lifecycle = new SessionLifecycle(ctx)
    const idleRelease = new IdleSessionRelease(ctx, this.lifecycle, {
      idleMs: this.idleReleaseMs,
      keep: this.idleReleaseKeep,
    })
    this.archivedDelete = new ArchivedSessionDelete(ctx, this.lifecycle)
    this.agents = new ApiSessionAgentController(ctx)
    this.agents.initialize()
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    ctx.effect(() => ctx.fileUploads.registerAgentResolver(async (sessionId) => {
      const result = await this.agents.resolveAgent(sessionId)
      if ('error' in result) throw result.error
      return result.agent
    }), 'session-controller: file-upload Agent resolver')
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    // Assistant-stream observation must be live before the list read yields: an Agent's
    // opening frame arriving during that await would otherwise have no listener.
    this.historyController = new HistoryController(ctx)
    this.stateController = new StateController(ctx, this.historyController)
    this.webController = new WebController(ctx, this.historyController,
      (observation) => { this.promote(observation) },
      sessionId => idleRelease.watch(sessionId),
    )
    this.listState = new ApiSessionList(ctx, this.listWorkSliceMs)
    await this.listState.initialize()
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionMediaReferences)
    ctx.plugin(SessionSkillCatalog)
    // An archived Session, or a subagent descendant of one, runs no model step
    // until it is restored; what it still runs is stopped by the owners that
    // answer the Workspace registry's archive-admission events.
    ctx.plugin(ArchivedSessionGate)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      if (this.lifecycle.deletingIds.has(session.id)) return
      // An idle release keeps the Session listed; only its resident Agent went away.
      if (this.lifecycle.releasingIds.has(session.id)) {
        ctx.emit('api-session/added', { ...this.listState.summaryFor(session), agentAvailable: false, running: false })
        return
      }
      ctx.emit('api-session/removed', session.id)
    })
    const publishAgentAvailability = ({ agent }: { agent: Agent }): undefined => {
      if (ctx.sessions.get(agent.id) === agent.session) {
        ctx.emit('api-session/added', this.listState.summaryFor(agent.session))
      }
    }
    ctx.on('agent/created', publishAgentAvailability)
    ctx.on('agent/disposed', publishAgentAvailability)
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  /**
   * Request background activation through the existing Session Agent controller.
   * @param observation - owned lease disposed by the background task; callers retain their own lease separately.
   */
  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Check one complete Session log for the narrow identity-reuse contract.
   * This is advisory and never reserves, activates, or mutates the Session.
   * @param request - durable Session identity to inspect.
   * @param signal - caller cancellation for the cold read.
   * @returns whether the identity remains an ordinary blank Session.
   * @throws {RemoteError} for cancellation and storage/inspection failures.
   */
  @Remote('blankReuse')
  async blankReuse(
    request: SessionBlankReuseRequest,
    signal: AbortSignal,
  ): Promise<SessionBlankReuseValue> {
    try {
      signal.throwIfAborted()
      let inspection = await this.inspect(request.sessionId, signal)
      signal.throwIfAborted()
      // A cold read can race a caller attaching the Session. Prefer the live
      // snapshot at the decision point so a stale persisted prefix cannot make
      // a newly attached, non-blank Session reusable.
      const attached = this.ctx.sessions.get(request.sessionId)
      if (attached !== undefined) inspection = inspectAttachedSession(attached)
      signal.throwIfAborted()
      return { reusable: canReuseBlankInspection(inspection) }
    } catch (error: unknown) {
      if (signal.aborted) {
        throw new RemoteError('gateway/cancelled', 'session blank reuse was aborted', {}, { cause: error })
      }
      if (error instanceof ApiSessionNotFound) return { reusable: false }
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        `session blank reuse inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        { cause: error },
      )
    }
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads and summary generation.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    const items = await this.listState.list(signal)
    return { items: items.filter(item => this.ctx.remoteAccess.allows({ kind: 'session', id: item.sessionId })) }
  }

  /**
   * Search visible Session content without resuming an Agent. A non-owner
   * receives only the hits whose Session `allows()` admits; `hasMore`
   * describes the bounded result before that filtering.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  async search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    const result = await this.listState.search(request.query, signal)
    return { ...result, items: result.items.filter(item => this.ctx.remoteAccess.allows({ kind: 'session', id: item.sessionId })) }
  }

  /**
   * Create one ordinary Session for a new conversation, reusing the named blank Session while it is reusable.
   * @param request - optional blank Session to reuse, location, and Agent preset.
   * @returns the created or reused Session identity and its preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Set or release plugin-owned navigation metadata on an existing Session.
   * @param request - Session identity and the presentation or null.
   * @returns accepted metadata and its durable event sequence.
   */
  @Remote('setPresentation')
  setPresentation(request: SessionPresentationRequest): Promise<SessionPresentationValue> {
    return this.commands.setPresentation(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session; save the default in the background.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session, without waiting for default persistence.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Select the first available account model after login when no provider API key is configured.
   * @returns after saving the first available model or retaining the existing default.
   */
  @Remote
  async initializeDefaultModel(): Promise<void> {
    const provider = 'deepseek-account'
    if (await hasProviderApiKey(this.ctx)) return
    const catalog = await buildModelCatalog(this.ctx)
    const model = catalog.groups.find(group => group.id === provider)?.models[0]
    if (model === undefined) throw new RemoteError('session/provider-models-unavailable',
      `provider "${provider}" has no available models`, { provider })
    const selection = { provider, model: model.id,
      ...model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoning.defaultEffort) },
    }
    await this.ctx.agentDefaultModel.saveSelection(selection)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Describe the serving desktop for authenticated file-action routes.
   * @returns Host name, configured availability, and platform-specific file-manager behavior.
   */
  workspaceDesktop(): { name: string; available: boolean; fileManager: 'finder' | 'explorer' | 'directory' | null } {
    const fileManager = nativeFileManager()
    return { name: hostname(), available: fileManager !== null && this.canOpenPath(), fileManager }
  }

  /**
   * Verify one path through the composed filesystem and open it on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, has no verified Host mapping, is cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      if (request.action === 'reveal') await this.revealPath(path, signal)
      else if (request.application !== undefined) await this.openFileApplication(path, request.application, signal)
      else await this.openPath(path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError(
        'gateway/internal',
        'path open failed',
        {},
        { cause: error },
      )
    }
  }

  /**
   * Query current file handlers on the serving desktop without activating an Agent.
   * @param request - file path in Host filesystem syntax.
   * @param signal - caller lifetime, propagated to filesystem and desktop queries.
   * @returns OS application names, icons, and default selection; empty when desktop opening is unavailable.
   * @throws RemoteError when the path is invalid, the query is cancelled, or native discovery fails.
   */
  @Remote('workspacePathApplications')
  async workspacePathApplications(
    request: { readonly path: string }, signal: AbortSignal,
  ): Promise<readonly SessionWorkspacePathApplication[]> {
    if (!this.canOpenPath()) return []
    try {
      const path = await this.verifyDesktopPath(request.path, signal)
      return await this.fileApplications(path, signal)
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'application query was aborted', {})
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'file application query failed', {}, { cause: error })
    }
  }

  private async verifyDesktopPath(path: string, signal: AbortSignal): Promise<string> {
    if (path.length === 0) throw new RemoteError('gateway/bad-request', 'A non-empty file path is required', {})
    signal.throwIfAborted()
    const hostPath = resolve(path)
    const { fs } = this.ctx
    const mapped = fs.processPathFromHostPath(hostPath)
    if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== hostPath) {
      throw new RemoteError('gateway/bad-request', 'Path has no verified Host path', {})
    }
    signal.throwIfAborted()
    return hostPath
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable exact event prefix into a new Session. An omitted
   * boundary selects the latest completed-turn prefix; an open cut receives
   * synthetic fork closers.
   * @param request - source Session, optional exact inclusive event boundary, and migration preflight choice.
   * @returns the new Session identity.
   */
  @Remote('fork')
  async fork(request: SessionForkRequest): Promise<SessionForkValue> {
    if (request.allowMigration === false && this.ctx.sessions.get(request.sessionId) === undefined) {
      const stored = await this.ctx.get('sessionPersistence')?.stat(request.sessionId)
      if (stored?.formatStatus === 'migration-required' && this.ctx.sessions.get(request.sessionId) === undefined) {
        throw new RemoteError('session/migration-required', 'Open the source Session to complete migration before forking', {
          sessionId: request.sessionId,
        })
      }
    }
    return this.commands.fork(request)
  }

  /**
   * Destroy one archived Session log and its `origin === 'subagent'` descendants.
   * @param request - archived root identity.
   * @returns deleted identities and the resulting archive set.
   */
  @Remote('delete')
  delete(request: SessionDeleteRequest): Promise<SessionDeleteValue> {
    return this.archivedDelete.delete(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  async prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    if (!hasPromptContent(request.content)) {
      throw new RemoteError('gateway/bad-request', 'prompt content must include non-whitespace text or an attachment', {})
    }
    const clientTimeZone = request.clientTimeZone === undefined
      ? undefined
      : canonicalClientTimeZone(request.clientTimeZone)
    if (request.clientTimeZone !== undefined && clientTimeZone === undefined) {
      throw new RemoteError(
        'session/invalid-time-zone',
        'clientTimeZone must be UTC or a valid IANA Area/Location name',
        { value: request.clientTimeZone },
      )
    }
    // The caller is recorded only when it is not the owner, so owner messages keep their exact source.
    const principal = principalOf(this.ctx.invocation)
    const source: MessageSource = {
      kind: 'user',
      rpcId: request.requestId,
      ...(clientTimeZone === undefined ? {} : { clientTimeZone }),
      ...(principal === undefined ? {} : { principal }),
    }
    return this.commands.prompt(request, source)
  }

  /**
   * Read one image from the attachment store after gateway authorization.
   * @param request - image reference and gateway permission scope; Session existence is not checked.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /** Read a durable Visual reply, including when new publications are disabled. */
  @Remote('readVisualReply')
  readVisualReply(request: SessionVisualReplyRequest, signal: AbortSignal): Promise<SessionVisualReplyValue> {
    signal.throwIfAborted()
    return this.commands.readVisualReply(request, signal)
  }

  /**
   * Mutate one still-pending queue occurrence, resuming a cold Agent first.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue> {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): Promise<SessionCancelValue> {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @deprecated Use `events`; this entry point remains for existing Web callers.
   * @param request - durable address, optional fixed cut, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page with its inclusive cursor; an omitted `throughSeq` selects the observed log end.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionEventsPage> {
    return this.historyController.events(request, signal)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, optional fixed cut, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page with its inclusive cursor.
   */
  @Remote
  events(request: SessionPageRequest, signal: AbortSignal): Promise<SessionEventsPage> {
    return this.historyController.events(request, signal)
  }

  /**
   * Subscribe to Session events without reading a snapshot.
   * @param request - Session address.
   * @param signal - subscription cancellation.
   * @returns readiness and subsequent events, without a snapshot.
   */
  @Remote({ mode: 'stream' })
  observeEvent(request: SessionObserveEventRequest, signal: AbortSignal): AsyncIterable<SessionEventFrame> {
    return this.historyController.observeEvent(request, signal)
  }

  /**
   * Subscribe to Session projection changes.
   * @param request - target Session.
   * @param signal - subscription cancellation.
   * @returns readiness followed by one projection change frame per committed event.
   */
  @Remote({ mode: 'stream' })
  observeProjections(request: SessionProjectionsRequest, signal: AbortSignal): AsyncIterable<SessionProjectionFrame> {
    return this.historyController.observeProjections(request, signal)
  }

  /**
   * Read passive Session state.
   * @param request - target Session.
   * @param signal - read cancellation.
   * @returns current passive state.
   */
  @Remote
  state(request: SessionStateRequest, signal: AbortSignal): Promise<SessionState> {
    return this.stateController.state(request, signal)
  }

  /**
   * Subscribe to complete Session state replacements.
   * @param request - target Session.
   * @param signal - subscription cancellation.
   * @returns complete passive state replacements.
   */
  @Remote({ mode: 'stream' })
  observeState(request: SessionStateRequest, signal: AbortSignal): AsyncIterable<SessionState> {
    return this.stateController.observeState(request, signal)
  }

  /**
   * Wait for Session quiescence or pending input with bounded assistant output.
   * @param request - Session, wait bounds and output window.
   * @param signal - caller cancellation.
   * @returns stopping state and bounded assistant output.
   */
  @Remote
  wait(request: SessionWaitRequest, signal: AbortSignal): Promise<SessionWaitValue> {
    return this.stateController.wait(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free durable event
   *   frames and optional cursorless assistant-stream frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.webController.follow(request, signal)
  }

  /**
   * Read exact projections, returning cached hints only when migration is required.
   * @param request - Session whose current values are required.
   * @param signal - cancellation for the Session read.
   * @returns a sequenced baseline, cached hints when migration is deferred, or null when absent.
   */
  @Remote('projections')
  projections(request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue> {
    return this.historyController.projections(request, signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    for await (const frame of this.controlState.control(signal)) {
      switch (frame.type) {
        case 'baseline': {
          const projections = Object.fromEntries(Object.entries(frame.value.projections)
            .filter(([sessionId]) => this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId as SessionId })))
          yield { type: 'baseline', value: { ...frame.value, projections } }
          break
        }
        case 'projection':
          if (this.ctx.remoteAccess.allows({ kind: 'session', id: frame.sessionId })) yield frame
          break
        /* v8 ignore next -- closed control-frame union. */
        default:
          assertNever(frame)
      }
    }
  }
}

export default SessionController
