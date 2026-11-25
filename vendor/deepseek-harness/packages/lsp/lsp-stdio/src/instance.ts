/**
 * One language-server instance: a connection plus the initialize handshake, the serialized abortable
 * query queue, an LRU-bounded persistent document cache (`didOpen`/`didChange`/`didClose`),
 * `textDocument/publishDiagnostics` caching/waiters, and bounded teardown. One instance owns one
 * `(provider id, canonical workspace)` process. Queries serialize through a single queue so a
 * cancellation that fails to stop the server can terminate it without killing unrelated work;
 * distinct instances run in parallel.
 * @module @deepseek-ai/dsh-lsp-stdio/instance
 */

import { createHash } from 'node:crypto'
import { LspError } from '@deepseek-ai/dsh-lsp'
import type {
  LspDiagnostic,
  LspOperation,
  LspProviderQuery,
  LspQueryResult,
} from '@deepseek-ai/dsh-lsp'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { abortable, abortError } from './abort.ts'
import { LspConnection } from './connection.ts'
import type { ConnectionSpawner, ConnectionSpec, ConnectionWriter } from './connection.ts'
import type { HostSource } from './host.ts'
import { CLIENT_CAPABILITIES } from './protocol.ts'
import type { WireServerCapabilities } from './protocol.ts'
import {
  initializeCapabilities,
  MAX_DIAGNOSTICS_PER_FILE,
  negotiatePositionEncoding,
  normalizeDocumentUri,
  normalizeHover,
  normalizeLocations,
  normalizePublishDiagnostics,
  requestMethod,
  supportsDocumentChange,
  supportsOperation,
  supportsTransientOpen,
} from './translate.ts'

/** Default maximum open documents held concurrently in the per-instance LRU cache. */
export const DEFAULT_MAX_OPEN_DOCUMENTS = 32

/** Default bounded wait (ms) for a fresh `publishDiagnostics` notification after sync. */
export const DEFAULT_DIAGNOSTICS_WAIT_MS = 1_500

/** Quiet settle window (ms) after an unversioned push so multi-phase servers (syntax -> semantic) finish emitting. */
const UNVERSIONED_DIAGNOSTICS_SETTLE_MS = 500

/** Maximum distinct URIs retained in the in-memory diagnostics cache per instance. */
const MAX_DIAGNOSTIC_FILES = 256

/** Everything an instance needs beyond the connection spec. */
export interface InstanceSpec extends ConnectionSpec {
  /** Canonical workspace file URI supplied by the filesystem provider. */
  readonly workspaceUri: string
  /** Static `initialize` options forwarded to the server. */
  readonly initializationOptions: unknown
  /** Graceful `shutdown`/`exit` budget before escalation (ms). */
  readonly shutdownTimeoutMs: number
  /** Keep synchronized documents open in an LRU cache across queries (default `true`). */
  readonly keepDocumentsOpen?: boolean
  /** Maximum open documents retained concurrently when `keepDocumentsOpen` is true (default `32`). */
  readonly maxOpenDocuments?: number
  /** Bounded wait (ms) for a fresh `publishDiagnostics` push after opening or changing a file (default `1500`). */
  readonly diagnosticsWaitMs?: number
}

interface OpenDocumentEntry {
  readonly uri: string
  readonly languageId: string
  version: number
  textHash: string
}

interface SyncState {
  expectedVersion: number
  syncSeq: number
}

interface CachedDiagnosticsEntry {
  readonly uri: string
  readonly diagnostics: readonly LspDiagnostic[]
  readonly version?: number
  readonly seq: number
  fresh: boolean
}

interface DiagnosticWaiter {
  readonly expectedVersion: number
  readonly minSeq: number
  readonly onPush: (version: number | undefined) => void
  readonly reject: (error: Error) => void
}

/**
 * A single initialized server process. Not exported as a provider — the provider single-flights and
 * pools these. `query()` serializes; `dispose()` closes cached documents, rejects queued work, and
 * tears the process down.
 */
export class LspInstance {
  private readonly connection: LspConnection
  private readonly keepDocumentsOpen: boolean
  private readonly maxOpenDocuments: number
  private readonly diagnosticsWaitMs: number
  /** The serialization tail: each query awaits the prior one, so lifecycles never interleave. */
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  /** The one teardown transaction shared by abort, failure, and explicit disposal. */
  private teardownPromise: Promise<void> | undefined
  /** Set once the process closes, so the pool can synchronously skip a dead instance. */
  private processClosed = false
  /** The server's negotiated capabilities once `initialize` succeeds; a failed handshake rejects every query. */
  private readonly ready: Promise<WireServerCapabilities>
  /** LRU cache of currently open documents (insertion order: oldest first, most-recent last). */
  private readonly openDocuments = new Map<string, OpenDocumentEntry>()
  /** Bounded cache of normalized `publishDiagnostics` notifications indexed by canonical URI. */
  private readonly diagnosticsByUri = new Map<string, CachedDiagnosticsEntry>()
  /** Most recent sync sequence/version per canonical URI to distinguish fresh vs stale pushes. */
  private readonly syncStateByUri = new Map<string, SyncState>()
  /** Active waiters awaiting a fresh `publishDiagnostics` notification per canonical URI. */
  private readonly diagnosticWaiters = new Map<string, Set<DiagnosticWaiter>>()
  private notificationSeq = 0

  /**
   * @param spec - the launch, initialize, and teardown parameters.
   * @param spawner - the subprocess seam's spawn function.
   * @param writer - optional connection writer used by transport conformance tests.
   */
  constructor(private readonly spec: InstanceSpec, spawner: ConnectionSpawner, writer?: ConnectionWriter) {
    this.keepDocumentsOpen = spec.keepDocumentsOpen ?? true
    this.maxOpenDocuments = spec.maxOpenDocuments ?? DEFAULT_MAX_OPEN_DOCUMENTS
    this.diagnosticsWaitMs = spec.diagnosticsWaitMs ?? DEFAULT_DIAGNOSTICS_WAIT_MS
    this.connection = new LspConnection(
      spec,
      spawner,
      (method, params) => this.answerServerRequest(method, params),
      writer,
      (method, params) => { this.handleNotification(method, params) },
    )
    this.ready = this.initialize()
    // A handshake rejection must not surface as an unhandled rejection before the first query awaits
    // it; queries attach the real handler.
    this.ready.catch(() => {})
    void this.connection.closed.then(() => {
      this.processClosed = true
      this.rejectAllDiagnosticWaiters(this.connection.failure ?? new LspError('language server exited', 'LSP_SERVER_EXITED'))
    })
  }

  /** Synchronous liveness check: true once the process has closed or the instance was disposed. */
  get dead(): boolean {
    return this.processClosed || this.disposed || this.connection.failed
  }

  /**
   * Test whether a caught query error came from this instance's transport.
   * @param error - error caught by the provider.
   * @returns `true` only for the connection's retained fatal transport cause.
   */
  isTransportFailure(error: unknown): boolean {
    return this.connection.failedWith(error)
  }

  /**
   * Run one query through the serialized queue.
   * @param request - the resolved provider query.
   * @param source - the pre-validated, already-read host source (the provider reads before spawning).
   * @param signal - optional cancellation for this query's full lifecycle.
   * @returns the normalized result.
   */
  query(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    // Serialize behind prior work, but observe abort DURING the queue wait too: if an earlier query
    // hangs (e.g. a signal-less service caller), a later tool's timeout must still be able to give up
    // rather than block on the shared tail forever.
    const run = abortable(this.queue, signal)
      .then(() => this.runQuery(request, source, signal))
      .catch(async (error: unknown) => {
        if (!this.isTransportFailure(error)) throw error
        await this.awaitTeardownAttempt()
        throw this.connection.settledFailure(error)
      })
    // Keep the tail alive regardless of this query's outcome so the next caller still serializes. The
    // tail follows the ACTUAL prior work (this.queue), not the abortable view, so a caller giving up
    // on the wait does not deserialize the queue.
    this.queue = this.queue.then(() => run).then(() => undefined, () => undefined)
    return run
  }

  private async initialize(): Promise<WireServerCapabilities> {
    const initializeResult = await this.connection.request('initialize', {
      // A subprocess provider may run in another PID namespace or machine;
      // the host PID would let the server monitor an unrelated process.
      processId: null,
      rootUri: this.spec.workspaceUri,
      workspaceFolders: [{ uri: this.spec.workspaceUri, name: 'workspace' }],
      capabilities: CLIENT_CAPABILITIES,
      initializationOptions: this.spec.initializationOptions,
    })
    const capabilities = initializeCapabilities(initializeResult)
    // An omitted encoding defaults to utf-16; any other value is a protocol error we reject here.
    negotiatePositionEncoding(capabilities.positionEncoding)
    await this.connection.notify('initialized', {})
    return capabilities
  }

  private async runQuery(request: LspProviderQuery, source: HostSource, signal?: AbortSignal): Promise<LspQueryResult> {
    if (this.disposed) throw new LspError('LSP instance was disposed', 'LSP_DISPOSED')
    /* v8 ignore next -- the abortable queue wait rejects a pre-aborted signal before runQuery; this is a belt-and-suspenders guard. */
    if (signal?.aborted) throw abortError(signal)
    // Observe abort during the handshake wait, and never pool a poisoned instance: if the wait ends
    // in failure — an abort on a still-pending handshake, OR `initialize` rejecting (utf-8
    // negotiation, malformed result) without the process exiting — tear the instance down so a
    // permanently-rejecting/pending `ready` can't make every later query for this workspace fail.
    let capabilities: WireServerCapabilities
    try {
      capabilities = await abortable(this.ready, signal)
    } catch (error) {
      if (!this.dead) {
        await this.awaitTeardownAttempt()
      }
      throw error
    }
    if (!supportsOperation(capabilities, request.operation)) {
      throw new LspError(`server does not support ${request.operation}`, 'LSP_UNSUPPORTED_OPERATION')
    }
    if (!supportsTransientOpen(capabilities.textDocumentSync)) {
      throw new LspError('server does not support the transient textDocument/didOpen this host requires', 'LSP_UNSUPPORTED_OPERATION')
    }

    const uri = source.fileUrl
    if (!this.keepDocumentsOpen) {
      return await this.runTransientQuery(request, source, uri, signal)
    }

    const key = normalizeDocumentUri(uri)
    const syncState = await this.ensureDocumentOpen(capabilities, key, uri, request.languageId, source.text, signal)
    if (request.operation === 'diagnostics') {
      await this.waitForDiagnostics(key, syncState.expectedVersion, syncState.syncSeq, signal)
      return {
        kind: 'diagnostics',
        uri,
        diagnostics: this.readCachedDiagnostics(key),
        resolvedWorkspaceUri: this.spec.workspaceUri,
      }
    }
    const payload = await this.sendRequest(request.operation, uri, request.position, signal)
    return this.normalize(request.operation, payload)
  }

  private async runTransientQuery(
    request: LspProviderQuery,
    source: HostSource,
    uri: string,
    signal?: AbortSignal,
  ): Promise<LspQueryResult> {
    const key = normalizeDocumentUri(uri)
    let opened = false
    try {
      /* v8 ignore next -- guards an abort landing between the ready wait and didOpen; not deterministically reproducible. */
      if (signal?.aborted) throw abortError(signal)
      const syncSeq = ++this.notificationSeq
      this.syncStateByUri.set(key, { expectedVersion: 1, syncSeq })
      this.markDiagnosticsStale(key)
      try {
        await abortable(this.connection.notify('textDocument/didOpen', {
          textDocument: { uri, languageId: request.languageId, version: 1, text: source.text },
        }), signal)
      } catch (error) {
        // A canceled backpressured write or failed stdin leaves the protocol stream unusable before
        // `opened` can arm the didClose cleanup. Teardown here makes the pool evict the instance.
        await this.awaitTeardownAttempt()
        throw error
      }
      opened = true
      if (request.operation === 'diagnostics') {
        await this.waitForDiagnostics(key, 1, syncSeq, signal)
        return {
          kind: 'diagnostics',
          uri,
          diagnostics: this.readCachedDiagnostics(key),
          resolvedWorkspaceUri: this.spec.workspaceUri,
        }
      }
      const payload = await this.sendRequest(request.operation, uri, request.position, signal)
      return this.normalize(request.operation, payload)
    } finally {
      // A disposed or closed instance (e.g. an aborted request whose server ignored
      // `$/cancelRequest`) is already tearing down; sending didClose would race that teardown and let
      // the next queued query's document lifecycle overlap the still-active request.
      if (opened && !this.dead) {
        try {
          await this.connection.notify('textDocument/didClose', { textDocument: { uri } })
        } catch (_closeFailure: unknown) {
          // A close-write failure does not replace the settled result/error, but the instance can no
          // longer be trusted. The provider re-awaits this teardown and owns failure reporting.
          await this.awaitTeardownAttempt()
        }
      }
    }
  }

  private async ensureDocumentOpen(
    capabilities: WireServerCapabilities,
    key: string,
    uri: string,
    languageId: string,
    text: string,
    signal?: AbortSignal,
  ): Promise<SyncState> {
    /* v8 ignore next -- guards an abort landing between ready and sync; not deterministically reproducible. */
    if (signal?.aborted) throw abortError(signal)
    const textHash = hashDocumentText(text)
    const existing = this.openDocuments.get(key)
    if (existing !== undefined) {
      // Refresh MRU position on every hit.
      this.openDocuments.delete(key)
      this.openDocuments.set(key, existing)

      const canDidChange = existing.languageId === languageId && supportsDocumentChange(capabilities.textDocumentSync)
      if (existing.textHash === textHash && existing.languageId === languageId) {
        return this.syncStateByUri.get(key) ?? { expectedVersion: existing.version, syncSeq: 0 }
      }
      if (canDidChange) {
        const nextVersion = existing.version + 1
        const syncSeq = ++this.notificationSeq
        const syncState: SyncState = { expectedVersion: nextVersion, syncSeq }
        this.syncStateByUri.set(key, syncState)
        this.markDiagnosticsStale(key)
        try {
          await abortable(this.connection.notify('textDocument/didChange', {
            textDocument: { uri: existing.uri, version: nextVersion },
            contentChanges: [{ text }],
          }), signal)
        } catch (error) {
          this.openDocuments.delete(key)
          await this.awaitTeardownAttempt()
          throw error
        }
        existing.version = nextVersion
        existing.textHash = textHash
        return syncState
      }

      // Server cannot didChange (or languageId changed): close first, then reopen at version 1.
      this.openDocuments.delete(key)
      this.markDiagnosticsStale(key)
      try {
        await abortable(this.connection.notify('textDocument/didClose', {
          textDocument: { uri: existing.uri },
        }), signal)
      } catch (error) {
        await this.awaitTeardownAttempt()
        throw error
      }
    }

    while (this.openDocuments.size >= this.maxOpenDocuments) {
      const oldest = this.openDocuments.entries().next().value
      /* v8 ignore next -- size >= maxOpenDocuments (>= 1) guarantees an entry exists. */
      if (oldest === undefined) break
      const [evictKey, evictEntry] = oldest
      this.openDocuments.delete(evictKey)
      this.markDiagnosticsStale(evictKey)
      try {
        await abortable(this.connection.notify('textDocument/didClose', {
          textDocument: { uri: evictEntry.uri },
        }), signal)
      } catch (error) {
        await this.awaitTeardownAttempt()
        throw error
      }
    }

    const syncSeq = ++this.notificationSeq
    const syncState: SyncState = { expectedVersion: 1, syncSeq }
    this.syncStateByUri.set(key, syncState)
    this.markDiagnosticsStale(key)
    try {
      await abortable(this.connection.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text },
      }), signal)
    } catch (error) {
      await this.awaitTeardownAttempt()
      throw error
    }
    this.openDocuments.set(key, { uri, languageId, version: 1, textHash })
    return syncState
  }

  private handleNotification(method: string, params: unknown): void {
    if (method !== 'textDocument/publishDiagnostics') return
    const parsed = normalizePublishDiagnostics(params, MAX_DIAGNOSTICS_PER_FILE)
    if (parsed === undefined) return
    const key = normalizeDocumentUri(parsed.uri)
    const seq = ++this.notificationSeq
    const syncState = this.syncStateByUri.get(key)
    if (parsed.version !== undefined && syncState !== undefined && parsed.version < syncState.expectedVersion) {
      // Ignore delayed diagnostics from a superseded document version.
      return
    }
    const isFresh = syncState === undefined
      ? true
      : parsed.version !== undefined
        ? parsed.version >= syncState.expectedVersion
        : seq > syncState.syncSeq

    this.storeDiagnostics(key, {
      uri: parsed.uri,
      diagnostics: parsed.diagnostics,
      ...parsed.version !== undefined ? { version: parsed.version } : {},
      seq,
      fresh: isFresh,
    })
    if (isFresh) {
      this.resolveDiagnosticWaiters(key, parsed.version, seq)
    }
  }

  private storeDiagnostics(key: string, entry: CachedDiagnosticsEntry): void {
    this.diagnosticsByUri.delete(key)
    this.diagnosticsByUri.set(key, entry)
    while (this.diagnosticsByUri.size > MAX_DIAGNOSTIC_FILES) {
      let evictedKey: string | undefined
      for (const candidateKey of this.diagnosticsByUri.keys()) {
        if (!this.openDocuments.has(candidateKey)) {
          evictedKey = candidateKey
          break
        }
      }
      /* v8 ignore next -- fallback only triggers when every tracked URI is simultaneously open. */
      evictedKey ??= this.diagnosticsByUri.keys().next().value
      /* v8 ignore next -- map size > MAX_DIAGNOSTIC_FILES ensures a key exists. */
      if (evictedKey === undefined) break
      this.diagnosticsByUri.delete(evictedKey)
    }
  }

  private markDiagnosticsStale(key: string): void {
    const existing = this.diagnosticsByUri.get(key)
    if (existing !== undefined) existing.fresh = false
  }

  private readCachedDiagnostics(key: string): readonly LspDiagnostic[] {
    return this.diagnosticsByUri.get(key)?.diagnostics ?? []
  }

  private async waitForDiagnostics(
    key: string,
    expectedVersion: number,
    minSeq: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const current = this.diagnosticsByUri.get(key)
    if (
      current !== undefined
      && current.fresh
      && (current.version !== undefined ? current.version >= expectedVersion : current.seq > minSeq)
    ) {
      return
    }
    if (this.diagnosticsWaitMs === 0) return
    if (this.disposed) throw new LspError('LSP instance was disposed', 'LSP_DISPOSED')
    if (this.connection.failure !== undefined) throw this.connection.failure
    if (signal?.aborted) throw abortError(signal)

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let settleTimer: ReturnType<typeof setTimeout> | undefined
      const diagnosticWaiters = this.diagnosticWaiters
      const waiters = diagnosticWaiters.get(key) ?? new Set<DiagnosticWaiter>()
      diagnosticWaiters.set(key, waiters)

      const onAbort = signal === undefined
        ? undefined
        : (): void => { finishReject(abortError(signal)) }

      const waiter: DiagnosticWaiter = {
        expectedVersion,
        minSeq,
        onPush: (version) => {
          if (version !== undefined) {
            finishResolve()
            return
          }
          // Unversioned servers often split syntax and semantic diagnostics into separate pushes;
          // wait briefly for follow-up notifications while staying bounded by diagnosticsWaitMs.
          if (settleTimer !== undefined) clearTimeout(settleTimer)
          settleTimer = setTimeout(finishResolve, UNVERSIONED_DIAGNOSTICS_SETTLE_MS)
          settleTimer.unref()
        },
        reject: finishReject,
      }
      waiters.add(waiter)

      const timer = setTimeout(finishResolve, this.diagnosticsWaitMs)
      timer.unref()
      if (signal !== undefined && onAbort !== undefined) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      function cleanup(): void {
        waiters.delete(waiter)
        if (waiters.size === 0) diagnosticWaiters.delete(key)
        clearTimeout(timer)
        if (settleTimer !== undefined) clearTimeout(settleTimer)
        if (signal !== undefined && onAbort !== undefined) {
          signal.removeEventListener('abort', onAbort)
        }
      }
      function finishResolve(): void {
        if (settled) return
        settled = true
        cleanup()
        resolve()
      }
      function finishReject(error: Error): void {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
    })
  }

  private resolveDiagnosticWaiters(key: string, version: number | undefined, seq: number): void {
    const waiters = this.diagnosticWaiters.get(key)
    if (waiters === undefined) return
    for (const waiter of [...waiters]) {
      const matches = version !== undefined ? version >= waiter.expectedVersion : seq > waiter.minSeq
      if (matches) waiter.onPush(version)
    }
  }

  private rejectAllDiagnosticWaiters(error: Error): void {
    const all = [...this.diagnosticWaiters.values()]
    this.diagnosticWaiters.clear()
    for (const group of all) {
      for (const waiter of [...group]) {
        waiter.reject(error)
      }
    }
  }

  private async sendRequest(
    operation: Exclude<LspOperation, 'diagnostics'>,
    uri: string,
    position: LspProviderQuery['position'],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const params = {
      textDocument: { uri },
      position: { line: position.line, character: position.character },
      // findReferences always includes declarations: the caller gets no flag and impact analysis
      // never omits the defining site.
      ...(operation === 'findReferences' ? { context: { includeDeclaration: true } } : {}),
    }
    const requestId = this.connection.peekNextId()
    const send = this.connection.request(requestMethod(operation), params)
    if (signal === undefined) return send
    return this.raceAbort(send, requestId, signal)
  }

  /**
   * Race a pending request against abort. On abort, send `$/cancelRequest` and give the server a
   * bounded grace to acknowledge; if it does not settle in time, invalidate and tear down the
   * instance so the still-active request cannot overlap the next queued query's document lifecycle.
   */
  private async raceAbort(send: Promise<unknown>, requestId: number, signal: AbortSignal): Promise<unknown> {
    try {
      return await abortable(send, signal)
    } catch (error) {
      if (!signal.aborted) throw error
      this.connection.cancel(requestId)
      // Wait, bounded, for the server to honor the cancellation. If it does not, the request is still
      // running: terminate the instance (disposal awaits process close) so nothing outlives the query.
      const grace = deadline(undefined, this.spec.killGraceMs, 'LSP_CANCEL_GRACE')
      try {
        // `settled` is true if the request finished (either outcome) before the grace elapsed.
        const settled = await Promise.race([
          send.then(markSettled, markSettled),
          new Promise<boolean>((resolve) => {
            /* v8 ignore next -- the cancel-grace deadline signal is freshly armed and not yet aborted here; defensive. */
            if (grace.signal.aborted) { resolve(false); return }
            grace.signal.addEventListener('abort', () => { resolve(false) }, { once: true })
          }),
        ])
        if (!settled) await this.awaitTeardownAttempt()
      } finally {
        grace[Symbol.dispose]()
      }
      throw error
    }
  }

  private normalize(operation: Exclude<LspOperation, 'diagnostics'>, payload: unknown): LspQueryResult {
    if (operation === 'hover') {
      return { kind: 'hover', hover: normalizeHover(payload) }
    }
    // The filesystem provider owns URI syntax for the execution platform, which may differ from the
    // harness host. Preserve that coordinate through rendering instead of reparsing `spec.cwd` there.
    return { kind: 'locations', locations: normalizeLocations(payload), resolvedWorkspaceUri: this.spec.workspaceUri }
  }

  private answerServerRequest(method: string, params: unknown): Promise<unknown> {
    if (method === 'workspace/configuration') {
      // Answer every requested item with the one static configuration value.
      const record = params as { items?: unknown[] } | null
      /* v8 ignore next -- a configuration request always carries an items array; the empty fallback is defensive. */
      const items = Array.isArray(record?.items) ? record.items : []
      return Promise.resolve(items.map(() => this.spec.configuration))
    }
    if (LIFECYCLE_NOOP_METHODS.has(method)) {
      // Accept lifecycle bookkeeping requests with an empty result; we register nothing dynamic.
      return Promise.resolve(null)
    }
    if (method === 'workspace/applyEdit') {
      // This host never applies edits or runs commands.
      return Promise.reject(new Error('workspace/applyEdit is not permitted by this host'))
    }
    return Promise.reject(new Error(`unsupported server request: ${method}`))
  }

  /**
   * Close cached documents, reject queued work, attempt graceful `shutdown`/`exit`, then escalate
   * SIGTERM→SIGKILL, awaiting process close so nothing outlives disposal.
   */
  async dispose(): Promise<void> {
    await this.startTeardown()
  }

  /** Publish disposal once and make every caller await the same quiescence boundary. */
  private startTeardown(): Promise<void> {
    this.disposed = true
    this.rejectAllDiagnosticWaiters(new LspError('LSP instance was disposed', 'LSP_DISPOSED'))
    this.teardownPromise ??= this.tearDown()
    return this.teardownPromise
  }

  /** Await teardown while leaving its memoized failure for provider-level finalization. */
  private async awaitTeardownAttempt(): Promise<void> {
    try {
      await this.startTeardown()
    } catch (_teardownFailure: unknown) {
      // LocalLspProvider re-awaits the same teardown and combines it with the query outcome.
    }
  }

  private async tearDown(): Promise<void> {
    const shutdownDeadline = deadline(undefined, this.spec.shutdownTimeoutMs, 'LSP_SHUTDOWN')
    try {
      await this.gracefulShutdown(shutdownDeadline.signal)
    } catch (_gracefulShutdownFailed) {
      // Graceful shutdown failed or timed out; managed-range cleanup below remains authoritative.
    } finally {
      shutdownDeadline[Symbol.dispose]()
    }
    await this.forceTerminate()
  }

  /** Best-effort close of cached open documents followed by LSP `shutdown`/`exit`, bounded by `signal`. */
  private async gracefulShutdown(signal: AbortSignal): Promise<void> {
    const open = [...this.openDocuments.values()]
    this.openDocuments.clear()
    if (!this.connection.failed) {
      for (const entry of open) {
        await abortable(this.connection.notify('textDocument/didClose', {
          textDocument: { uri: entry.uri },
        }), signal)
      }
    }
    await abortable(this.connection.request('shutdown', null), signal)
    await this.connection.notify('exit', null)
    await abortable(this.connection.closed, signal)
  }

  /**
   * Terminate the provider-managed range, then await the direct server result
   * and whole-range quiescence. The awaits are unbounded on purpose because
   * quiescence, not another timer, is the postcondition disposal owes callers.
   */
  private async forceTerminate(): Promise<void> {
    this.connection.terminate()
    await Promise.all([
      this.connection.closed,
      this.connection.waitForManagedRangeExit(),
    ])
  }
}

/** Compute SHA-256 content hash for document change detection. */
function hashDocumentText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Server→client request methods this host acknowledges with an empty result (no dynamic registration). */
const LIFECYCLE_NOOP_METHODS = new Set([
  'window/workDoneProgress/create',
  'client/registerCapability',
  'client/unregisterCapability',
])

/** Mark a settled request in the cancel-grace race (either outcome means the request finished). */
function markSettled(): boolean {
  return true
}
