/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
}

/** The catalog entries one directory snapshot advertises: every group model,
 * plus the current selection's model when its (provider, id) is absent (a
 * custom or relay provider whose catalog lookup failed still serves the model
 * the user picked, and it must remain listable and priceable even when another
 * provider advertises the same model id). */
function catalogOf(
  snapshot: { groups: readonly { id: string; models: readonly { id: string }[] }[]; current: { provider: string; model: string } | null },
): readonly { provider: string; id: string }[] {
  const entries = snapshot.groups.flatMap(group => group.models.map(entry => ({ provider: group.id, id: entry.id })))
  const current = snapshot.current
  if (current !== null && !entries.some(entry => entry.provider === current.provider && entry.id === current.model)) {
    entries.push({ provider: current.provider, id: current.model })
  }
  return entries
}

/** One catalog-union key: a model is remembered per (provider, id), so a
 * custom provider serving the same id as the official route stays priceable
 * instead of being collapsed into whichever provider advertised it first. */
function catalogKey(provider: string, id: string): string {
  return `${provider}\u0000${id}`
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session']

  private readonly live: LiveState = { directories: new WeakMapWithValues() }
  private readonly catalog: ModelCatalogDirectory

  /**
   * Fiber-level union of every advertised (provider, model id) pair the
   * resolver has seen — seeded from the host-scoped `llm.models` catalog on
   * boot and on every topology/settings invalidation, and grown by the
   * session-directory publishes; never shrinks, so the root-scope price
   * settings row can list a provider the user just added even before any
   * session directory publishes it. The union is what makes custom/proxy
   * provider models reliably available to the global panel. Keyed per
   * (provider, id) so a custom provider serving the same model id as the
   * official route is not collapsed into whichever provider advertised it
   * first.
   */
  private readonly catalogUnion = new Map<string, { provider: string; id: string }>()

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context) {
    super(ctx, 'modelDirectories')
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    const refresh = (): void => {
      this.catalog.refresh()
      for (const directory of this.live.directories.values) {
        directory.load().catch(() => undefined)
      }
      void this.rememberHostCatalog()
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
    ctx.remote.$on('credentials/record-updated', refresh)
    ctx.remote.$on('credentials/reference-updated', refresh)
    void this.rememberHostCatalog()
  }

  /**
   * Seed the fiber-level union from the host-scoped catalog (the same groups
   * `session.models` returns, without a per-session selection), so the
   * settings-row price panel lists a newly added provider even when no session
   * directory has loaded it yet. Best-effort: a not-yet-connected remote or a
   * provider that finished registering after this read leaves
   * session-directory publishes as the fallback, and the next invalidation
   * retries.
   */
  private async rememberHostCatalog(): Promise<void> {
    try {
      const catalog = await this.catalog.load()
      for (const group of catalog.groups) {
        for (const model of group.models) {
          const key = catalogKey(group.id, model.id)
          if (!this.catalogUnion.has(key)) {
            this.catalogUnion.set(key, { provider: group.id, id: model.id })
          }
        }
      }
    } catch {
      // The remote is not connected yet or the host refused; session-directory
      // publishes remain the fallback source and the next invalidation retries.
    }
  }

  /**
   * Models every advertised (provider, id) pair the resolver has seen (fiber
   * union in first-seen order), then the resident session directories' current
   * groups. The root-scope price settings row aggregates over the union because
   * it has no session scope of its own, keeping a custom provider's same-id
   * model alongside the official route.
   * @returns the union of advertised models; empty when nothing has loaded yet.
   */
  catalogModelIds(): readonly { provider: string; id: string }[] {
    const models: { provider: string; id: string }[] = [...this.catalogUnion.values()]
    for (const directory of this.live.directories.values) {
      for (const group of directory.store.getSnapshot().groups) {
        for (const entry of group.models) {
          const duplicate = models.some(model => model.provider === group.id && model.id === entry.id)
          if (!duplicate) {
            models.push({ provider: group.id, id: entry.id })
          }
        }
      }
    }
    return models
  }

  /** Fold one directory's groups plus its current selection into the fiber-level union. */
  private rememberCatalog(
    groups: readonly {
      id: string
      models: readonly { id: string }[]
    }[],
    current: { provider: string; model: string } | null,
  ): void {
    for (const group of groups) {
      for (const entry of group.models) {
        const key = catalogKey(group.id, entry.id)
        if (!this.catalogUnion.has(key)) {
          this.catalogUnion.set(key, { provider: group.id, id: entry.id })
        }
      }
    }
    if (current !== null && !this.catalogUnion.has(catalogKey(current.provider, current.model))) {
      this.catalogUnion.set(catalogKey(current.provider, current.model), { provider: current.provider, id: current.model })
    }
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalog,
      binding.session.projections.faceOf('modelSelection'),
      () => binding.session.getSnapshot().blank,
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
    )
    live.directories.set(binding, directory)
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      // One subscription publishes two faces: the model fact (the current
      // provider route for the composer-dock status row) and the model
      // catalog (the advertised ids for the price panel's dropdown). Every
      // directory change — load, select, adapters-updated, settings refresh,
      // connection reset — republishes, so consumers never hold a stale route
      // or a stale model list: additions and removals in the directory flow
      // through.
      const publish = (): void => {
        if (sessions.binding(sessionId) !== binding) return
        const snapshot = directory.store.getSnapshot()
        conversation.modelFacts.set(sessionId, { provider: snapshot.current?.provider ?? null })
        conversation.modelCatalog?.set(sessionId, catalogOf(snapshot))
        this.rememberCatalog(snapshot.groups, snapshot.current)
      }
      publish()
      actx.effect(() => {
        const stop = directory.store.subscribe(publish)
        return () => {
          stop()
          const current = sessions.binding(sessionId)
          if (current !== undefined && current !== binding && live.directories.get(current) !== undefined) return
          conversation.modelFacts.set(sessionId, { provider: null })
          conversation.modelCatalog?.set(sessionId, [])
        }
      }, 'ui-model-selection: model facts')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(binding)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
