// dsh-usage-panel · host-side structural types for services the plugin uses
// at runtime but whose host-side type packages are not public: the Cordis
// `connection` service (RPC), the `llm` service (provider directory), and the
// user-settings service (`settings`). The runtime shapes below are exactly
// what the plugin exercises.

// `ctx.interval` comes from @deepseek-ai/cordis-plugin-timer at runtime.
// The augmentation is declared locally so the built bundle has NO runtime
// import of that devDependency (consumers never install devDeps).
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

declare module '@deepseek-ai/cordis' {
  interface Context {
    interval(callback: () => void, delay: number): () => void
  }
}

export interface HostRpcResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string; details: Record<string, unknown> }
}

export interface HostRpcHandle {
  handle(
    path: string,
    handler: (endpoint: string, payload: unknown) => Promise<HostRpcResult<unknown>>,
    options: { authority: 'loopback' },
  ): () => void
}

export interface HostConnection {
  rpc: HostRpcHandle
}

export interface LlmProviderInfoLike {
  id: string
  name: string
}

export interface LlmModelInfoLike {
  id: string
}

export interface HostLlm {
  listProviders(): Promise<LlmProviderInfoLike[]> | LlmProviderInfoLike[]
  /** Adapter-known models for one provider (may be unavailable on some adapters). */
  listModels?(provider: string): Promise<LlmModelInfoLike[]>
}

// --- User-settings face (harness `ctx.settings`) ---
//
// The plugin does not depend on `@deepseek-ai/dsh-settings`: the desktop
// runtime provides the service, the npm type packages do not. The faces below
// are structural, same precedent as the connection/llm faces above.

/** One registered namespace as reported by `ctx.settings.describe()`. */
export interface HostSettingsDescriptor {
  /** Profile entry id the namespace is registered under. */
  ns: string
  /** Resolved value (composition base → user layer → schema defaults). */
  value: unknown
}

/** `ctx.settings` — the namespace listing plus the revision-checked write path. */
export interface HostSettings {
  /**
   * Every registered namespace. A missing id means unregistered — the
   * vendored service has no per-namespace `get`.
   */
  describe(): HostSettingsDescriptor[]
  /**
   * Merge a patch into one namespace's user section. REJECTS (it does not
   * no-op) while the namespace is unregistered — callers must treat
   * "registered" as a precondition, never as a guarantee.
   */
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}

/**
 * `ctx.on('settings/document-updated', …)` — the settings service's commit
 * event. The payload is `(ns, revision)` only — the committed value is
 * re-read through `describe()`. The listener signature is declared locally
 * because merging this event into the global cordis `Events` map would
 * collide with the harness's own declaration of the same event inside one
 * program; the call site casts the context once instead.
 */
export interface HostSettingsEventSource {
  on(
    event: 'settings/document-updated',
    listener: (ns: unknown, revision: unknown) => void,
  ): () => void
}

// Vendored Host read APIs. The npm rc.6 development types predate the
// disposable Session observation and its exact projection cut.

/** Session identity and workspace attribution used by the statistics consumer. */
export interface HostSessionHeader {
  id: string
  createdAt: number
  cwd?: string | null
  isSeeded?: boolean
}

/** `sessionQuery.readSession` — complete replay-validated raw log (vendored shape). */
export interface HostSessionLogSnapshot {
  session: HostSessionHeader
  /** Exact fork-inherited prefix length paired with {@link session}. */
  inheritedEventCount: number
  events: SessionEvent[]
}

/** Projection cut: whole values as of `asOfSeq` (-1 for an empty log). */
export interface HostProjectionSnapshot {
  asOfSeq: number
  values: Record<string, unknown>
}

/** Caller-owned immutable observation; projection reads do not materialize its log. */
export interface HostSessionObservation extends Disposable {
  readonly header: HostSessionHeader
  readonly projections?: HostProjectionSnapshot
}

/** `ctx.sessionQuery` — the read face the panel exercises. */
export interface HostSessionQuery {
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  observeSession(sessionId: string): Promise<HostSessionObservation>
  readSession(sessionId: string): Promise<HostSessionLogSnapshot>
  /** Vendored `SessionTitleSnapshot` cut down to the field the panel reads (`title` is non-empty). */
  readTitle(sessionId: string, signal?: AbortSignal): Promise<{ title: string } | undefined>
}
