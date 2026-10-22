/** Workspace archive and directory UI capability. */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ClientRemote, DirectoryListing, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ISessions,
  SessionCreateError,
  SessionBinding,
  SessionReference,
  SessionTarget,
  SessionListState,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the `agentPreset` Session projection value into this program.
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type {
  IWorkspaces, WorkspaceId, WorkspaceSnapshot, WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DraftInitializationOptions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RowToast } from './contract/slots.ts'
import { pinOrderAccounts, pinOrderSource } from './pin-order.ts'
import type { WorkspaceViewStoreActions } from './stores.ts'

interface MainSelection {
  readonly sessionId?: SessionId
  readonly subagentAddress?: SubagentAddress
}

interface OwnedSessionActions {
  readonly rename: (sessionId: SessionId) => void | Promise<void>
  readonly archive: (sessionId: SessionId) => void | Promise<void>
  readonly restore?: (sessionId: SessionId) => void | Promise<void>
}

/** Display membership supplied by a Session's presentation owner, never a Workspace account. */
export interface OwnedSessionNavigationEntry {
  readonly sessionId: SessionId
  readonly workingDirectory: string
  readonly archived: boolean
}

export interface OwnedSessionNavigation extends OwnedSessionNavigationEntry {
  readonly owner: string
}

/** A composed feature that adopts a directory from the New Session picker. */
export interface WorkspaceDirectoryAction {
  /** Stable feature identity, distinct from Workspace identities. */
  readonly id: string
  /** Localized menu label supplied by the feature. */
  readonly label: string
  readonly order?: number
  /** Accept the selected path without creating an ordinary Session. */
  readonly adopt: (path: string) => Promise<void>
  /**
   * Menu label offered on a listed directory's row for that directory, which
   * `adopt` then receives; omitted or undefined keeps the action off the row.
   */
  readonly rowLabel?: (path: string) => string | undefined
}

/** Optional content preparation for the resolved target Session. */
export interface StartSessionOptions extends DraftInitializationOptions {
  /** Prepare the resolved Session after retention and before navigation, unless superseded. */
  beforeOpen?: (sessionId: SessionId) => void
  /** Agent preset the Session runs; the Host default when omitted. */
  readonly agentPreset?: string
}

/** Workspace archive and directory operations consumed by Client UI domains. */
export interface UiWorkspace {
  /**
   * Register the presentation owner's rename, archive, and optional restore flows.
   * @param owner - unique Session presentation-owner identity.
   * @param actions - owner operations receiving the target Session identity.
   * @returns disposer that removes this owner's operations.
   */
  registerSessionActions(owner: string, actions: OwnedSessionActions): () => void
  /**
   * Resolve an action against the Session's current presentation owner, with its identity bound.
   * @param sessionId - Session whose current presentation owner supplies the action.
   * @param action - owner operation to resolve.
   * @returns the bound operation, or undefined when its owner or operation is not registered.
   */
  resolveSessionAction(sessionId: SessionId, action: keyof OwnedSessionActions): (() => void | Promise<void>) | undefined
  readonly sessionNavigation: HostObservable<readonly OwnedSessionNavigation[]>
  /**
   * Publish a presentation owner's observable Session navigation entries.
   * @param owner - unique presentation-owner identity added to each entry.
   * @param entries - current entries and updates supplied by that owner.
   * @returns disposer that unsubscribes and removes this owner's entries.
   */
  registerSessionNavigation(owner: string, entries: HostObservable<readonly OwnedSessionNavigationEntry[]>): () => void
  /** Additional directory actions in the New Session picker. */
  readonly directoryActions: HostObservable<readonly WorkspaceDirectoryAction[]>
  /**
   * Register one feature action; removal also updates the picker projection.
   * @param action - directory action with a unique feature id and adoption callback.
   * @returns disposer that removes the action from the picker.
   */
  registerDirectoryAction(action: WorkspaceDirectoryAction): () => void
  /**
   * Bind the resident browser to the composed native or in-app directory flow.
   * @param picker - directory selection flow, returning null on cancellation.
   * @returns disposer that clears this picker if it has not been replaced.
   */
  registerDirectoryPicker(picker: () => Promise<string | null>): () => void
  /**
   * Select a Session and show its Conversation as one UI navigation action.
   * @param target - known Session identity or durable direct-parent subagent address to display.
   * @param beforeOpen - optional synchronous preparation for the retained Session
   * before it is shown; a throw aborts the open and releases the reference.
   */
  openSession(target: SessionTarget, beforeOpen?: (sessionId: SessionId) => void): void
  /**
   * Connect a Workspace and open its Session unless a later navigation supersedes it.
   * @param workspaceId - target Workspace.
   * @param beforeOpen - optional synchronous preparation for the selected Session,
   * skipped after supersession; a throw aborts the open and releases the retained reference.
   * @param options - choices for the Session the connection creates or reuses.
   * @returns completion; a superseded request may create a Session but does not open it.
   * @throws on failure; a refused creation is also shown through the Workspace
   * notice unless a later navigation or disposal superseded the request.
   */
  openWorkspace(
    workspaceId: WorkspaceId,
    beforeOpen?: (sessionId: SessionId) => void,
    options?: Pick<StartSessionOptions, 'agentPreset'>,
  ): Promise<void>
  /**
   * Fork a Session without changing the current selection.
   * @param sessionId - source Session.
   * @param onCreated - observer before the optional child-title update.
   * @param options - optional permission to start source migration; omission preserves the Host default.
   * @returns the child SessionId after creation and inherited-title increment.
   */
  forkSession(
    sessionId: SessionId,
    onCreated?: (childId: SessionId) => void,
    options?: Pick<Parameters<ISessions['fork']>[0], 'allowMigration'>,
  ): Promise<SessionId>
  /**
   * Resolve the Session for a new conversation in a Workspace: the Host reuses
   * the first listed blank member while it is reusable and otherwise creates one,
   * under the requested preset or the Host default.
   * @param workspaceId - target Workspace.
   * @param options - choices for the created or reused Session.
   * @returns a Session already addressable through the Session Controller.
   */
  connectWorkspace(workspaceId: WorkspaceId, options?: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId>
  /**
   * Reuse or create a Session in the Host-owned no-directory location without navigating.
   * @param options - preset for the created or reused Session; omission uses the Host default.
   * @returns a Session already addressable through the Session Controller.
   */
  connectNoDirectory(options?: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId>
  /**
   * Open a Session without a Workspace directory unless a later navigation supersedes it.
   * @param beforeOpen - optional synchronous preparation after retention and before navigation;
   * skipped after supersession, and a throw aborts the open and releases the retained reference.
   * @param options - preset for the created or reused Session; omission uses the Host default.
   */
  openNoDirectory(beforeOpen?: (sessionId: SessionId) => void, options?: Pick<StartSessionOptions, 'agentPreset'>): Promise<void>
  /**
   * Remove a Workspace registration and clear its selected Session without deleting Sessions or files.
   * @param workspaceId - Workspace registration to remove.
   */
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>
  /**
   * Delete a Session and apply the Host archive-set echo.
   * @param sessionId - archived root Session to delete.
   */
  deleteSession(sessionId: SessionId): Promise<void>
  /**
   * Create a fresh Session, or reuse a blank when preparing an explicit draft. A creation the Host
   * refuses is shown through the Workspace notice and leaves the selection as it was.
   * @param workspaceId - explicit target; absent inherits the current or most recent Workspace.
   * @param options - initial content and the reused blank's preset; existing text or attachments
   * are preserved unless clearPreviousDraft is true.
   */
  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void
  /**
   * Archive a Session and clear it when it is the current selection.
   * @param sessionId - Session to archive.
   * @param options - `stopActivity` asks the Host to stop the Session's running work instead of refusing.
   */
  archiveSession(sessionId: SessionId, options?: { readonly stopActivity?: boolean }): Promise<void>
  /**
   * Unarchive a Session, restoring it to its recorded Workspace position.
   * @param sessionId - Session to unarchive.
   */
  unarchiveSession(sessionId: SessionId): Promise<void>
  /**
   * Pin a Session on the Host, then lead it in its accounts' saved orders
   * (its Workspace group or Ungrouped, and the flat list). The order write
   * reads the memberships current at completion, so reorders that landed
   * while the Host call was pending keep their positions.
   * @param sessionId - Session to pin.
   */
  pinSession(sessionId: SessionId): Promise<void>
  /**
   * Unpin a Session on the Host; saved positions stay as they are.
   * @param sessionId - Session to unpin.
   */
  unpinSession(sessionId: SessionId): Promise<void>
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
  /**
   * Ask the resident workspace directory flow without registering a workspace.
   * @returns the selected directory, or null when cancelled.
   */
  selectDirectory(): Promise<string | null>
  /**
   * List one Host directory level.
   * @param path - directory path; absent selects the Host home.
   * @param signal - cancellation for a superseded scan.
   * @returns directory entries and breadcrumb ancestry.
   */
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create a child directory.
   * @param path - existing parent directory.
   * @param name - child directory name.
   * @returns created absolute path.
   */
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-Controller Workspace navigation and directory UI capability. */
    uiWorkspace: UiWorkspace
  }
}

/** Structured directory failure exposed to directory UI consumers. */
export class DirectoryBrowseError extends Error {
  override readonly name = 'DirectoryBrowseError'

  /** @param rpcError - Host directory business failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`directory browse failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Implements Workspace archive and directory UI operations. */
class UiWorkspaceService extends Service implements UiWorkspace {
  private readonly sessionActions = new Map<string, OwnedSessionActions>()
  private readonly navigationSources = new Map<string, HostObservable<readonly OwnedSessionNavigationEntry[]>>()
  private readonly navigationStore = createSnapshotStore<readonly OwnedSessionNavigation[]>([])
  readonly sessionNavigation: HostObservable<readonly OwnedSessionNavigation[]> = this.navigationStore
  private readonly directoryActionStore = createSnapshotStore<readonly WorkspaceDirectoryAction[]>([])
  readonly directoryActions: HostObservable<readonly WorkspaceDirectoryAction[]> = this.directoryActionStore
  private composedPicker: (() => Promise<string | null>) | undefined
  /** In-flight no-directory inspection and create; callers share one Session. */
  private connectingNoDirectory: { agentPreset: string | undefined; attempt: Promise<SessionId> } | undefined
  /** The latest in-flight connection per Workspace; a request joins it only when both name the same preset. */
  private readonly connecting = new Map<WorkspaceId, {
    readonly agentPreset: string | undefined
    readonly attempt: Promise<SessionId>
  }>()
  private readonly lifetime = new AbortController()
  private readonly selection = createSnapshotStore<MainSelection>(
    {}, { persist: { name: 'dsh.sessions.current' } },
  )
  private mainReference: SessionReference | undefined

  /**
   * @param ctx - Client root Context.
   * @param directoryPicker - the directory-picking Remote namespace.
   * @param workspaces - pure Workspace Controller.
   * @param sessions - pure Session Controller.
   * @param view - the browser's viewing-store write set (one instance shared with its registration).
   * @param notify - show one notice through the Workspace notice channel.
   */
  constructor(
    ctx: Context,
    private readonly directoryPicker: ClientRemote['directoryPicker'],
    private readonly workspaces: IWorkspaces,
    private readonly sessions: ISessions,
    private readonly view: Pick<WorkspaceViewStoreActions, 'pinSessionOrder'>,
    private readonly notify: (toast: RowToast) => void,
  ) {
    super(ctx, 'uiWorkspace')
    ctx.effect(() => {
      const stop = this.watchNavigation()
      return () => {
        stop()
        this.lifetime.abort()
        const reference = this.mainReference
        this.mainReference = undefined
        reference?.release()
      }
    }, 'ui-workspace: Workspace navigation policy')
  }

  registerDirectoryAction(action: WorkspaceDirectoryAction): () => void {
    if (!action.id || action.id.startsWith('::') || this.directoryActions.getSnapshot().some(row => row.id === action.id)) {
      throw new Error(`uiWorkspace.registerDirectoryAction: duplicate or invalid action ${action.id}`)
    }
    this.directoryActionStore.set([...this.directoryActions.getSnapshot(), action].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
    let removed = false
    return () => {
      if (removed) return
      removed = true
      this.directoryActionStore.set(this.directoryActions.getSnapshot().filter(row => row !== action))
    }
  }

  registerSessionActions(owner: string, actions: OwnedSessionActions): () => void {
    if (this.sessionActions.has(owner)) throw new Error(`uiWorkspace.registerSessionActions: duplicate owner ${owner}`)
    this.sessionActions.set(owner, actions)
    let removed = false
    return () => {
      if (removed) return
      removed = true
      this.sessionActions.delete(owner)
    }
  }

  resolveSessionAction(sessionId: SessionId, action: keyof OwnedSessionActions): (() => void | Promise<void>) | undefined {
    const owner = this.sessions.list.getSnapshot().byId[sessionId]?.presentation?.owner
    const actions = owner === undefined ? undefined : this.sessionActions.get(owner)
    const execute = actions?.[action]
    return execute === undefined ? undefined : () => execute(sessionId)
  }

  registerSessionNavigation(owner: string, entries: HostObservable<readonly OwnedSessionNavigationEntry[]>): () => void {
    if (this.navigationSources.has(owner)) throw new Error(`uiWorkspace.registerSessionNavigation: duplicate owner ${owner}`)
    const publish = (): void => {
      this.navigationStore.set([...this.navigationSources].flatMap(([entryOwner, source]) =>
        source.getSnapshot().map(entry => ({ ...entry, owner: entryOwner }))))
    }
    this.navigationSources.set(owner, entries)
    const unsubscribe = entries.subscribe(publish)
    publish()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      unsubscribe()
      this.navigationSources.delete(owner)
      publish()
    }
  }

  connectWorkspace(workspaceId: WorkspaceId, options: Pick<StartSessionOptions, 'agentPreset'> = {}): Promise<SessionId> {
    return this.connectBlank(workspaceId, options)
  }

  /**
   * @param reuse - preset for the reused or created blank; absent creates a fresh Session.
   */
  private async connectBlank(
    workspaceId: WorkspaceId,
    reuse: Pick<StartSessionOptions, 'agentPreset'> | undefined,
  ): Promise<SessionId> {
    this.lifetime.signal.throwIfAborted()
    const workspace = this.workspaces.list.getSnapshot().items
      .find(item => item.workspaceId === workspaceId)
    if (workspace === undefined) {
      throw new Error(`uiWorkspace.connectWorkspace: unknown workspace ${workspaceId}`)
    }
    if (reuse === undefined) return this.sessions.create({ workspaceId })
    const inflight = this.connecting.get(workspaceId)
    if (inflight !== undefined && inflight.agentPreset === reuse.agentPreset) return inflight.attempt

    const attempt = this.createInWorkspace(workspace, reuse).finally(() => {
      if (this.connecting.get(workspaceId)?.attempt === attempt) this.connecting.delete(workspaceId)
    })
    this.connecting.set(workspaceId, { agentPreset: reuse.agentPreset, attempt })
    return attempt
  }

  private createInWorkspace(workspace: WorkspaceView, options: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId> {
    const archived = this.workspaces.list.getSnapshot().archivedSessionIds
    const sessions = this.sessions.list.getSnapshot()
    const blank = sessions.ids.find((id) => {
      const summary = sessions.byId[id]
      return isOrdinaryBlank(summary) && summary.cwd === workspace.path
        && workspace.sessionIds.includes(id) && !archived.includes(id)
    })
    return this.createNamed({
      workspaceId: workspace.workspaceId,
      ...(blank === undefined ? {} : { sessionId: blank }),
      ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }),
    })
  }

  /**
   * Create through the Host. A named blank the Host declined may still read as
   * blank from stale cached list metadata, which hides it from the Session tree;
   * its projections are reloaded so the row reflects its log.
   */
  private async createNamed(request: {
    readonly workspaceId?: WorkspaceId
    readonly cwd?: string
    readonly sessionId?: SessionId
    readonly agentPreset?: string
  }): Promise<SessionId> {
    const sessionId = await this.sessions.create(request)
    const named = request.sessionId
    if (named !== undefined && named !== sessionId) {
      void this.sessions.refreshProjections(named).catch((reason: unknown) => {
        console.warn('declined blank Session projection reload failed:', reason)
      })
    }
    return sessionId
  }

  /**
   * Reopen a saved blank Session under the preset its log recorded, or under
   * the Host default once that preset no longer activates. Listed values are
   * cached hints that can lag the log after an unclean Host exit, so the
   * Session's projections are reloaded before the preset is read; a Session
   * that still awaits a format migration reloads only those cached hints.
   */
  private async restoreBlank(workspaceId: WorkspaceId, sessionId: SessionId): Promise<SessionId> {
    await this.sessions.refreshProjections(sessionId)
    const recorded = this.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
    const request = { workspaceId, sessionId }
    if (typeof recorded !== 'string') return this.createNamed(request)
    try {
      return await this.createNamed({ ...request, agentPreset: recorded })
    } catch (error: unknown) {
      const code = sessionCreateErrorOf(error)?.rpcError.code
      if (code !== 'agent-preset/not-found' && code !== 'agent-preset/invalid') throw error
      return this.createNamed(request)
    }
  }

  openSession(target: SessionTarget, beforeOpen?: (sessionId: SessionId) => void): void {
    this.replaceMain(target, this.lifetime.signal, 'reveal', beforeOpen)
  }

  openWorkspace(
    workspaceId: WorkspaceId,
    beforeOpen?: (sessionId: SessionId) => void,
    options: Pick<StartSessionOptions, 'agentPreset'> = {},
  ): Promise<void> {
    return this.openWorkspaceSession(workspaceId, beforeOpen, options)
  }

  private async openWorkspaceSession(
    workspaceId: WorkspaceId,
    beforeOpen: ((sessionId: SessionId) => void) | undefined,
    reuse: Pick<StartSessionOptions, 'agentPreset'> | undefined,
  ): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId
    try {
      sessionId = await this.connectBlank(workspaceId, reuse)
    } catch (error: unknown) {
      // Reported here, not in connectWorkspace: startup restoration calls that
      // directly and stays console-only.
      if (!navigation.aborted) this.notify({ kind: 'createFailed', message: creationFailureMessage(error) })
      throw error
    }
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, 'reveal', beforeOpen)
  }

  async openNoDirectory(beforeOpen?: (sessionId: SessionId) => void, options: Pick<StartSessionOptions, 'agentPreset'> = {}): Promise<void> {
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId
    try {
      sessionId = await this.connectNoDirectory(options)
    } catch (error: unknown) {
      // Symmetric with openWorkspace: a refused no-directory Session is shown,
      // not silently dropped while the hero chip falls back to its placeholder.
      if (!navigation.aborted) this.notify({ kind: 'createFailed', message: creationFailureMessage(error) })
      throw error
    }
    if (navigation.aborted) return
    this.replaceMain(sessionId, navigation, 'reveal', beforeOpen)
  }

  async forkSession(
    sessionId: SessionId,
    onCreated?: (childId: SessionId) => void,
    options?: Pick<Parameters<ISessions['fork']>[0], 'allowMigration'>,
  ): Promise<SessionId> {
    return this.sessions.fork({
      sessionId,
      increaseTitle: true,
      ...onCreated === undefined ? {} : { onCreated },
      ...options?.allowMigration === undefined ? {} : { allowMigration: options.allowMigration },
    })
  }

  startSession(workspaceId?: WorkspaceId, options?: StartSessionOptions): void {
    const { agentPreset, ...draft } = options ?? {}
    const draftOptions = options === undefined ? undefined : draft
    const initializeDraft = draftOptions !== undefined
      && (draftOptions.prompt !== undefined || draftOptions.clearPreviousDraft === true)
    const workspace = this.workspaces.list.getSnapshot()
    const sessions = this.sessions.list.getSnapshot()
    const current = this.mainReference?.sessionId
    const currentWorkspaceId = current === undefined
      ? undefined
      : workspace.items.find(item => item.sessionIds.includes(current))?.workspaceId
    const recent = workspace.phase === 'ready' && sessions.phase === 'ready'
      ? recentWorkspace(workspace.items, sessions.byId)
      : undefined
    const target = workspaceId ?? currentWorkspaceId ?? recent
    const prepare = initializeDraft || draftOptions?.beforeOpen !== undefined ? (id: SessionId) => {
      if (initializeDraft) {
        const binding = this.sessions.binding(id)
        if (binding === undefined) this.draftPreparationFailed()
        this.prepareDraft(binding, draftOptions)
      }
      draftOptions?.beforeOpen?.(id)
    } : undefined
    if (target === undefined) {
      if (prepare === undefined && agentPreset === undefined) this.clearMain()
      else void this.openNoDirectory(prepare, agentPreset === undefined ? {} : { agentPreset }).catch(
        (reason: unknown) => { console.warn('new no-directory session failed:', reason) },
      )
      return
    }
    void this.openWorkspace(target, prepare, agentPreset === undefined ? {} : { agentPreset }).catch(
      (reason: unknown) => { console.warn('new session failed:', reason) },
    )
  }

  private prepareDraft(binding: SessionBinding, options: DraftInitializationOptions): void {
    const conversation = this.ctx.get('conversation')
    if (conversation === undefined) this.draftPreparationFailed()
    if (conversation.input.requestDraftInitialization(binding, options) === 'blocked') this.draftPreparationFailed()
  }

  private draftPreparationFailed(): never {
    const message = this.ctx.locale.bind('workspace')('draft.initializationFailed')
    this.notify({ kind: 'createFailed', message })
    throw new Error(message)
  }

  async archiveSession(sessionId: SessionId, options: { readonly stopActivity?: boolean } = {}): Promise<void> {
    await this.workspaces.archiveSession(sessionId, options)
    if (this.mainReference?.sessionId === sessionId) this.clearMain()
  }

  async unarchiveSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unarchiveSession(sessionId)
  }

  async deleteSession(sessionId: SessionId): Promise<void> {
    const value = await this.sessions.delete(sessionId)
    this.workspaces.applyArchivedEcho(value.archivedSessionIds)
  }

  async connectNoDirectory(options: Pick<StartSessionOptions, 'agentPreset'> = {}): Promise<SessionId> {
    this.lifetime.signal.throwIfAborted()
    const inflight = this.connectingNoDirectory
    if (inflight !== undefined && inflight.agentPreset === options.agentPreset) return inflight.attempt
    const pending = Promise.withResolvers<SessionId>()
    const attempt = pending.promise.finally(() => {
      if (this.connectingNoDirectory?.attempt === attempt) this.connectingNoDirectory = undefined
    })
    this.connectingNoDirectory = { agentPreset: options.agentPreset, attempt }
    void this.resolveNoDirectory(options).then(pending.resolve, pending.reject)
    return attempt
  }

  private async resolveNoDirectory(options: Pick<StartSessionOptions, 'agentPreset'>): Promise<SessionId> {
    const cwd = await this.connectScratchCwd()
    const eligible = (id: SessionId): boolean => {
      const workspace = this.workspaces.list.getSnapshot()
      const summary = this.sessions.list.getSnapshot().byId[id]
      return isOrdinaryBlank(summary) && summary.cwd === cwd
        && !workspace.items.some(item => item.sessionIds.includes(id))
        && !workspace.archivedSessionIds.includes(id)
    }
    for (const id of this.sessions.list.getSnapshot().ids) {
      if (!eligible(id)) continue
      const reusable = await this.sessions.canReuseBlank(id, this.lifetime.signal)
      this.lifetime.signal.throwIfAborted()
      if (eligible(id) && reusable) return this.createNamed({
        cwd, sessionId: id, ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset },
      })
    }
    this.lifetime.signal.throwIfAborted()
    return this.sessions.create({ cwd, ...options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset } })
  }

  /**
   * Resolve the Host scratch cwd, waiting for the first Workspace baseline.
   * The hero menu is usable while the list is still loading, so a pick made in
   * that window must queue behind the baseline instead of rejecting and
   * reverting the chip with no visible result.
   * @returns the Host-owned no-directory cwd.
   */
  private connectScratchCwd(): Promise<string> {
    const pending = Promise.withResolvers<string>()
    const signal = this.lifetime.signal
    let settled = false
    let stop = (): void => {}
    const finish = (): boolean => {
      if (settled) return false
      settled = true
      stop()
      signal.removeEventListener('abort', onAbort)
      return true
    }
    const onAbort = (): void => {
      if (finish()) pending.reject(signal.reason)
    }
    const check = (): void => {
      if (settled) return
      const current = this.workspaces.list.getSnapshot()
      if (current.scratchCwd !== undefined) {
        if (finish()) pending.resolve(current.scratchCwd)
      } else if (current.phase === 'ready' || current.state === 'error') {
        if (finish()) {
          pending.reject(new Error('uiWorkspace.connectNoDirectory: the Workspace service did not report a scratch cwd'))
        }
      }
    }
    stop = this.workspaces.list.subscribe(check)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    // A baseline that landed between the snapshot read and the subscription
    // would otherwise leave this promise pending forever.
    check()
    return pending.promise
  }

  async deleteWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const workspace = this.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
    const current = this.mainReference?.sessionId
    await this.workspaces.delete(workspaceId)
    if (current !== undefined && workspace?.sessionIds.includes(current) === true
      && this.mainReference?.sessionId === current) this.clearMain()
  }

  async pinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.pinSession(sessionId)
    const { items, pinnedSessionIds, archivedSessionIds, scratchCwd } = this.workspaces.list.getSnapshot()
    const source = pinOrderSource(
      items, this.sessions.list.getSnapshot(), { pinnedSessionIds, archivedSessionIds }, scratchCwd,
    )
    this.view.pinSessionOrder(
      sessionId,
      pinOrderAccounts(items, sessionId).filter(key => source.members[key]?.includes(sessionId)),
      source,
    )
  }

  async unpinSession(sessionId: SessionId): Promise<void> {
    await this.workspaces.unpinSession(sessionId)
  }

  registerDirectoryPicker(picker: () => Promise<string | null>): () => void {
    this.composedPicker = picker
    return () => { if (this.composedPicker === picker) this.composedPicker = undefined }
  }

  async selectDirectory(): Promise<string | null> {
    if (this.composedPicker !== undefined) return this.composedPicker()
    return this.pickDirectory()
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.directoryPicker.pick()
    if (!result.ok) throw new Error(`directory picker failed: ${result.error.message}`)
    return result.value
  }

  async listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing> {
    const result = await this.directoryPicker.list(path, signal)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  async createDirectory(path: string, name: string): Promise<string> {
    const result = await this.directoryPicker.createDirectory(path, name)
    if (!result.ok) throw new DirectoryBrowseError(result.error)
    return result.value
  }

  private watchNavigation(): () => void {
    let initial: 'waiting' | 'connecting' | 'done' = 'waiting'
    const reconcile = (): void => {
      if (this.lifetime.signal.aborted) return
      if (this.clearArchivedCurrent()) return
      if (initial !== 'waiting') return
      const workspace = this.workspaces.list.getSnapshot()
      const sessions = this.sessions.list.getSnapshot()
      if (workspace.phase !== 'ready' || sessions.phase !== 'ready') return
      if (this.mainReference !== undefined) {
        initial = 'done'
        return
      }
      initial = 'connecting'
      void this.restoreSelection(workspace, sessions).then(
        () => { initial = 'done' },
        (reason: unknown) => {
          if (this.lifetime.signal.aborted) return
          initial = 'waiting'
          console.warn('initial Session restoration failed:', reason)
        },
      )
    }

    const disposeWorkspaces = this.workspaces.list.subscribe(reconcile)
    const disposeSessions = this.sessions.list.subscribe(reconcile)
    reconcile()
    return () => {
      this.lifetime.abort()
      disposeSessions()
      disposeWorkspaces()
    }
  }

  private async restoreSelection(workspaces: WorkspaceSnapshot, sessions: SessionListState): Promise<void> {
    const saved = this.selection.getSnapshot()
    if (saved.subagentAddress !== undefined) {
      this.replaceMain(saved.subagentAddress, this.lifetime.signal, 'preserve')
      return
    }
    const summary = saved.sessionId === undefined ? undefined : sessions.byId[saved.sessionId]
    const workspace = summary === undefined ? undefined
      : workspaces.items.find(item => item.sessionIds.includes(summary.id))
    if (summary !== undefined && (!isOrdinaryBlank(summary) || workspace === undefined)) {
      this.replaceMain(summary.id, this.lifetime.signal, 'preserve')
      return
    }
    const navigation = AbortSignal.any([this.ctx.layout.beginNavigation(), this.lifetime.signal])
    let sessionId: SessionId | undefined
    if (summary !== undefined && workspace !== undefined && summary.cwd === workspace.path
      && !workspaces.archivedSessionIds.includes(summary.id)) {
      sessionId = await this.restoreBlank(workspace.workspaceId, summary.id)
    }
    let target = workspace?.workspaceId ?? recentWorkspace(workspaces.items, sessions.byId)
    if (target === undefined && workspaces.items.length === 0 && sessions.ids.length === 0) {
      const prepared = await this.initializeDefaultWorkspace(navigation)
      if (navigation.aborted) return
      target = prepared?.workspaceId
    }
    if (sessionId === undefined && target !== undefined) sessionId = await this.connectWorkspace(target)
    if (sessionId !== undefined && !navigation.aborted) {
      this.replaceMain(sessionId, navigation, 'preserve')
    }
  }

  private async initializeDefaultWorkspace(signal: AbortSignal): Promise<WorkspaceView | undefined> {
    try {
      return await this.workspaces.initializeDefault(signal)
    } catch (_error: unknown) {
      if (!signal.aborted) this.notify({ kind: 'defaultWorkspaceFailed' })
      return undefined
    }
  }

  /** @returns true when an archived current selection was cleared. */
  private clearArchivedCurrent(): boolean {
    const current = this.mainReference?.sessionId
    if (current === undefined
      || !this.workspaces.list.getSnapshot().archivedSessionIds.includes(current)) return false
    this.clearMain()
    return true
  }

  private clearMain(): void {
    const previous = this.mainReference
    this.mainReference = undefined
    this.selection.set({})
    previous?.release()
    this.ctx.layout.selectPanel(null)
  }

  private replaceMain(
    target: SessionTarget,
    signal: AbortSignal,
    panel: 'reveal' | 'preserve',
    beforeOpen?: (sessionId: SessionId) => void,
  ): void {
    signal.throwIfAborted()
    const reference = this.sessions.retain(target, { source: 'mainView' })
    try {
      signal.throwIfAborted()
      beforeOpen?.(reference.sessionId)
      if (signal.aborted) {
        reference.release()
        return
      }
      const subagentAddress = typeof target === 'string'
        ? this.sessions.subagentAddress(reference.sessionId)
        : target
      this.selection.set({
        sessionId: reference.sessionId,
        ...(subagentAddress === undefined ? {} : { subagentAddress }),
      })
    } catch (error: unknown) {
      reference.release()
      throw error
    }
    const previous = this.mainReference
    this.mainReference = reference
    previous?.release()
    if (panel === 'reveal') this.ctx.layout.selectPanel(null)
  }

}

/**
 * `error` as the Session Controller's creation failure, or undefined when it
 * is not one. Client plugin bundles do not share error-class identity, so the
 * name decides.
 */
function sessionCreateErrorOf(error: unknown): SessionCreateError | undefined {
  return error instanceof Error && error.name === 'SessionCreateError' ? error as SessionCreateError : undefined
}

/**
 * The words a failed Session creation is reported in: a Host refusal keeps its
 * stable code and message; any other failure keeps its own message.
 */
function creationFailureMessage(error: unknown): string {
  const refused = sessionCreateErrorOf(error)
  if (refused !== undefined) return `${refused.rpcError.code}: ${refused.rpcError.message}`
  return error instanceof Error ? error.message : String(error)
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined && session.presentation === undefined) {
        latest = Math.max(latest, session.updatedAt)
      }
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

export { UiWorkspaceService }

/** List metadata can reject a candidate, but Host history confirms reuse. */
function isOrdinaryBlank(summary: SessionSummary | undefined): summary is SessionSummary {
  return summary !== undefined && summary.blank && !summary.running
    && summary.title === undefined && summary.parentId === undefined
    && summary.origin === undefined && summary.presentation === undefined
}
