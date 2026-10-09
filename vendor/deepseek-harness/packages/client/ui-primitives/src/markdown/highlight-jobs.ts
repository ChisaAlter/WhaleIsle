/**
 * Main-thread client of the review-diff highlight Worker (`./highlight.worker.ts`,
 * embedded by tsdown and run from a Blob URL). One Worker per page serves every
 * mounted diff — jobs carry a `run` id so replies route to their dispatch.
 * Each run sends one job at a time; disposal stops unsent jobs and ignores the
 * submitted job's reply. Worker startup is lazy and memoized: a page that
 * never renders a diff never fetches the worker chunk.
 *
 * Availability is deliberately tentative: `Worker` missing, a blocked Blob
 * URL, a chunk that fails to load, or a worker error all degrade to `undefined`
 * / the `failed` callback, and the caller falls back to inline sliced
 * highlighting with plain text readable throughout — highlighting is an
 * enhancement, never a render dependency.
 */

import { fetchGrammarModule, type HighlightSpan } from './highlight.ts'
import type { LangModule } from './highlight-engine.ts'

/** One hunk side to tokenize off-thread. */
export interface HighlightJobRequest {
  /** The joined source text of the side. */
  readonly code: string
  /** The language hint a file extension produced. */
  readonly lang?: string
}

/** Per-dispatch callbacks; every invocation is checked against `cancelled` first. */
export interface HighlightJobCallbacks {
  /** True once the owning effect disposed — results are dropped, not applied. */
  readonly cancelled: () => boolean
  /**
   * Apply one job's spans (or `undefined` for plain text) on the main thread.
   * `workMs` is the worker-side tokenize duration — evidence for the diff
   * performance gate, not a main-thread measurement.
   */
  readonly apply: (job: number, spans: HighlightSpan[][] | undefined, workMs: number) => void
  /** The Worker died or failed to start; the caller reruns its pending jobs inline. */
  readonly failed: () => void
}

/** What {@link dispatchHighlightJobs} returns while a run is cancellable. */
export interface HighlightJobRun {
  /** Stop unsent jobs and callbacks; the one submitted job cannot be interrupted. */
  cancel(): void
}

interface WorkerReply {
  readonly op: 'done' | 'missing'
  readonly run: number
  readonly job: number
  readonly spans?: HighlightSpan[][] | undefined
  readonly workMs?: number
  readonly resolved?: string
}

interface RunState {
  readonly jobs: readonly HighlightJobRequest[]
  readonly callbacks: HighlightJobCallbacks
  /** Job indexes not yet answered. */
  readonly pending: Set<number>
  /** The submitted job stays current while its lazy grammar loads. */
  active: { readonly job: number; readonly phase: 'worker' | 'grammar' } | undefined
}

const runs = new Map<number, RunState>()
let nextRun = 0
let worker: Worker | undefined
let workerPromise: Promise<Worker | undefined> | undefined
/** Terminal state: construction or a runtime error failed once — never retried this page. */
let workerFailed = false

/**
 * Ready-handshake budget: a worker that has not posted `ready` in time is
 * treated as unavailable so its dispatch falls back instead of hanging.
 */
const WORKER_READY_TIMEOUT_MS = 10_000

/** Submit at most one unanswered job per run, leaving other runs independent. */
function dispatchNext(run: number): void {
  const state = runs.get(run)
  if (state === undefined || state.callbacks.cancelled() || state.active !== undefined || worker === undefined) return
  const [index] = state.pending
  if (index === undefined) return
  const job = state.jobs[index]!
  state.active = { job: index, phase: 'worker' }
  worker.postMessage({ op: 'job', run, job: index, code: job.code, lang: job.lang })
}

/** Settle one side before advancing its run; applying a result may cancel it. */
function completeJob(run: number, job: number, spans: HighlightSpan[][] | undefined, workMs: number): void {
  const state = runs.get(run)
  if (state === undefined || state.callbacks.cancelled()) return
  state.pending.delete(job)
  state.active = undefined
  if (state.pending.size === 0) runs.delete(run)
  try {
    state.callbacks.apply(job, spans, workMs)
  } catch (error) {
    console.error('review highlight: apply callback failed', error)
  }
  dispatchNext(run)
}

/** Route every worker reply to its current job; cancelled runs ignore it. */
function onWorkerMessage(event: MessageEvent<WorkerReply>): void {
  const message = event.data
  const state = runs.get(message.run)
  if (state === undefined || state.callbacks.cancelled()) return
  const active = state.active
  if (active === undefined || active.job !== message.job || active.phase !== 'worker') return
  if (message.op === 'done') {
    completeJob(message.run, message.job, message.spans, message.workMs ?? 0)
    return
  }
  // 'missing': the worker realm lacks this grammar. Fetch the registration
  // data on the main thread (its lazy chunk already exists for the singleton
  // path), post it over, and repost the job. A failed fetch applies plain.
  const resolved = message.resolved
  if (resolved === undefined) return
  state.active = { job: message.job, phase: 'grammar' }
  void fetchGrammarModule(resolved).then((registrations) => {
    const live = runs.get(message.run)
    if (live === undefined || live.callbacks.cancelled() || worker === undefined) return
    const current = live.active
    if (current === undefined || current.job !== message.job || current.phase !== 'grammar') return
    if (registrations === undefined) {
      completeJob(message.run, message.job, undefined, 0)
      return
    }
    const job = live.jobs[message.job]!
    live.active = { job: message.job, phase: 'worker' }
    worker.postMessage({ op: 'langs', registrations: registrations satisfies LangModule['default'] })
    worker.postMessage({ op: 'job', run: message.run, job: message.job, code: job.code, lang: job.lang })
  })
}

/** Terminal worker failure: every pending dispatch reruns inline. */
function onWorkerError(): void {
  workerFailed = true
  worker?.terminate()
  worker = undefined
  workerPromise = undefined
  const affected = [...runs.values()]
  runs.clear()
  for (const state of affected) {
    if (!state.callbacks.cancelled()) state.callbacks.failed()
  }
}

/**
 * Lazily load the bundled Worker script and start it. Memoized: the chunk is
 * fetched once per page and the Worker kept alive so its registered grammars
 * stay warm across diffs.
 */
function acquireWorker(): Promise<Worker | undefined> {
  workerPromise ??= (async (): Promise<Worker | undefined> => {
    try {
      const { default: source } = await import('./highlight.worker.ts?raw')
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const started = await new Promise<Worker | undefined>((resolve) => {
        const instance = new Worker(url)
        const timeout = setTimeout(() => {
          instance.terminate()
          resolve(undefined)
        }, WORKER_READY_TIMEOUT_MS)
        instance.addEventListener('message', (event) => {
          if ((event.data as { op?: string }).op !== 'ready') return
          clearTimeout(timeout)
          resolve(instance)
        }, { once: true })
        instance.addEventListener('error', () => {
          clearTimeout(timeout)
          resolve(undefined)
        }, { once: true })
      })
      // Safe to revoke once construction returned: the script bytes are already
      // claimed by the worker's loader at that point.
      URL.revokeObjectURL(url)
      if (started === undefined) return undefined
      started.addEventListener('message', onWorkerMessage)
      started.addEventListener('error', onWorkerError)
      worker = started
      return started
    } catch {
      return undefined
    }
  })()
  void workerPromise.then((instance) => { if (instance === undefined) workerFailed = true })
  return workerPromise
}

/**
 * Dispatch one batch of sides to the shared highlight Worker.
 * @param jobs - side sources, indexed by the `job` argument `apply` receives.
 * @param callbacks - cancellation check, per-job apply, and failure fallback.
 * @returns a cancel handle, or `undefined` when no Worker path exists and the
 *   caller should run its inline sliced fallback instead.
 */
export function dispatchHighlightJobs(
  jobs: readonly HighlightJobRequest[],
  callbacks: HighlightJobCallbacks,
): HighlightJobRun | undefined {
  if (typeof Worker !== 'function' || typeof URL.createObjectURL !== 'function' || workerFailed) {
    return undefined
  }
  const run = ++nextRun
  const state: RunState = { jobs, callbacks, pending: new Set(jobs.keys()), active: undefined }
  runs.set(run, state)
  if (jobs.length === 0) {
    runs.delete(run)
    return { cancel() {} }
  }
  void acquireWorker().then((instance) => {
    const live = runs.get(run)
    if (live === undefined || live.callbacks.cancelled()) return
    if (instance === undefined) {
      runs.delete(run)
      live.callbacks.failed()
      return
    }
    dispatchNext(run)
  })
  return {
    cancel() {
      runs.delete(run)
    },
  }
}
