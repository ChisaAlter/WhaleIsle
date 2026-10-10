// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HighlightJobRun } from '../src/markdown/highlight-jobs.ts'
import type { LangModule } from '../src/markdown/highlight-engine.ts'

const { fetchGrammarModule } = vi.hoisted(() => ({
  fetchGrammarModule: vi.fn<(resolved: string) => Promise<LangModule['default'] | undefined>>(),
}))

vi.mock('../src/markdown/highlight.ts', () => ({ fetchGrammarModule }))
vi.mock('../src/markdown/highlight.worker.ts?raw', () => ({ default: 'highlight worker stub' }))

type JobMessage = { op: 'job'; run: number; job: number; code: string; lang?: string }
type PostedMessage = JobMessage | { op: 'langs'; registrations: LangModule['default'] }

class WorkerStub extends EventTarget {
  static latest: WorkerStub | undefined
  readonly postMessage = vi.fn<(message: PostedMessage) => void>()
  readonly terminate = vi.fn()

  constructor() {
    super()
    WorkerStub.latest = this
  }

  reply(data: object): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  done(message: JobMessage): void {
    this.reply({ op: 'done', run: message.run, job: message.job, spans: [[]], workMs: 2 })
  }

  fail(): void {
    this.dispatchEvent(new Event('error'))
  }
}

const GRAMMAR: LangModule['default'] = [{ name: 'python', scopeName: 'source.python', patterns: [], repository: {} }]
const BATCH = [{ code: 'first', lang: 'ts' }, { code: 'second', lang: 'ts' }, { code: 'third', lang: 'ts' }]
const callbacks = () => ({ cancelled: () => false, apply: vi.fn(), failed: vi.fn() })
const jobs = (worker: WorkerStub): JobMessage[] => worker.postMessage.mock.calls
  .map(([message]) => message).filter((message): message is JobMessage => message.op === 'job')

async function readyWorker(): Promise<WorkerStub> {
  await vi.waitFor(() => { expect(WorkerStub.latest).toBeDefined() })
  const worker = WorkerStub.latest!
  worker.reply({ op: 'ready' })
  await vi.waitFor(() => { expect(jobs(worker).length).toBeGreaterThan(0) })
  return worker
}

beforeEach(() => {
  vi.resetModules()
  fetchGrammarModule.mockReset().mockResolvedValue(undefined)
  WorkerStub.latest = undefined
  vi.stubGlobal('Worker', WorkerStub)
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = vi.fn(() => 'blob:highlight-test')
    static override revokeObjectURL = vi.fn<(url: string) => void>()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('review highlight job dispatch', () => {
  it('submits one side initially and advances only after its reply', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const output = callbacks()
    dispatchHighlightJobs(BATCH, output)
    const worker = await readyWorker()
    expect(jobs(worker).map(job => job.code)).toEqual(['first'])

    worker.done(jobs(worker)[0]!)
    expect(jobs(worker).map(job => job.code)).toEqual(['first', 'second'])
    worker.done(jobs(worker)[1]!)
    expect(jobs(worker).map(job => job.code)).toEqual(['first', 'second', 'third'])
    worker.done(jobs(worker)[2]!)
    expect(output.apply.mock.calls).toEqual([[0, [[]], 2], [1, [[]], 2], [2, [[]], 2]])
    expect(output.failed).not.toHaveBeenCalled()
  })

  it('does not submit remaining sides or apply late replies after cancellation', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const output = callbacks()
    const run = dispatchHighlightJobs(BATCH, output)!
    const worker = await readyWorker()
    run.cancel()
    worker.done(jobs(worker)[0]!)
    worker.fail()

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(output.apply).not.toHaveBeenCalled()
    expect(output.failed).not.toHaveBeenCalled()
  })

  it('continues after an apply callback throws and still ignores cancelled results', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const error = new Error('consumer could not apply the first side')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const output = callbacks()
      output.apply.mockImplementationOnce(() => { throw error })
      dispatchHighlightJobs(BATCH, output)
      const worker = await readyWorker()
      worker.done(jobs(worker)[0]!)
      expect(jobs(worker).map(job => job.code)).toEqual(['first', 'second'])
      worker.done(jobs(worker)[1]!)
      expect(jobs(worker).map(job => job.code)).toEqual(['first', 'second', 'third'])
      worker.done(jobs(worker)[2]!)
      expect(output.apply.mock.calls).toEqual([[0, [[]], 2], [1, [[]], 2], [2, [[]], 2]])
      expect(output.failed).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledExactlyOnceWith('review highlight: apply callback failed', error)

      const cancelled = dispatchHighlightJobs(BATCH, output)!
      await vi.waitFor(() => { expect(jobs(worker)).toHaveLength(4) })
      cancelled.cancel()
      worker.done(jobs(worker)[3]!)
      expect(worker.postMessage).toHaveBeenCalledTimes(4)
      expect(output.apply).toHaveBeenCalledTimes(3)
      expect(output.failed).not.toHaveBeenCalled()
      expect(log).toHaveBeenCalledOnce()
    } finally {
      log.mockRestore()
    }
  })

  it('allows the apply callback to cancel before the next side is submitted', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    let run: HighlightJobRun
    const output = callbacks()
    output.apply.mockImplementation(() => { run.cancel() })
    run = dispatchHighlightJobs(BATCH, output)!
    const worker = await readyWorker()
    const first = jobs(worker)[0]!
    worker.done(first)
    worker.done(first)

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(output.apply).toHaveBeenCalledExactlyOnceWith(0, [[]], 2)
    expect(output.failed).not.toHaveBeenCalled()
  })

  it('waits for a lazy grammar and completes the same side before advancing', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    let resolveGrammar!: (registrations: LangModule['default']) => void
    fetchGrammarModule.mockReturnValue(new Promise(resolve => { resolveGrammar = resolve }))
    const output = callbacks()
    dispatchHighlightJobs([{ code: 'first', lang: 'py' }, BATCH[1]!], output)
    const worker = await readyWorker()
    const first = jobs(worker)[0]!
    worker.reply({ op: 'missing', run: first.run, job: first.job, resolved: 'python' })
    expect(fetchGrammarModule).toHaveBeenCalledExactlyOnceWith('python')
    expect(worker.postMessage).toHaveBeenCalledTimes(1)

    resolveGrammar(GRAMMAR)
    await vi.waitFor(() => { expect(worker.postMessage).toHaveBeenCalledTimes(3) })
    expect(worker.postMessage.mock.calls[1]?.[0]).toEqual({ op: 'langs', registrations: GRAMMAR })
    expect(jobs(worker)).toEqual([first, first])
    expect(output.apply).not.toHaveBeenCalled()
    worker.done(first)
    expect(jobs(worker).map(job => job.code)).toEqual(['first', 'first', 'second'])
    worker.done(jobs(worker)[2]!)
    expect(output.apply.mock.calls).toEqual([[0, [[]], 2], [1, [[]], 2]])
  })

  it('does not register or repost a side cancelled while its grammar loads', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    let resolveGrammar!: (registrations: LangModule['default']) => void
    const loading = new Promise<LangModule['default']>(resolve => { resolveGrammar = resolve })
    fetchGrammarModule.mockReturnValue(loading)
    const output = callbacks()
    const run = dispatchHighlightJobs([{ code: 'first', lang: 'py' }, BATCH[1]!], output)!
    const worker = await readyWorker()
    const first = jobs(worker)[0]!
    worker.reply({ op: 'missing', run: first.run, job: first.job, resolved: 'python' })
    run.cancel()
    resolveGrammar(GRAMMAR)
    await loading

    expect(worker.postMessage).toHaveBeenCalledTimes(1)
    expect(output.apply).not.toHaveBeenCalled()
    expect(output.failed).not.toHaveBeenCalled()
  })

  it('applies plain text for a failed grammar load and continues the batch', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const output = callbacks()
    dispatchHighlightJobs([{ code: 'first', lang: 'py' }, BATCH[1]!], output)
    const worker = await readyWorker()
    const first = jobs(worker)[0]!
    worker.reply({ op: 'missing', run: first.run, job: first.job, resolved: 'python' })
    await vi.waitFor(() => { expect(output.apply).toHaveBeenCalledExactlyOnceWith(0, undefined, 0) })
    expect(jobs(worker).map(job => job.code)).toEqual(['first', 'second'])
    worker.done(jobs(worker)[1]!)
    expect(output.apply.mock.calls).toEqual([[0, undefined, 0], [1, [[]], 2]])
    expect(output.failed).not.toHaveBeenCalled()
  })

  it('lets another run advance while the first loads a grammar and is cancelled', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    let resolveGrammar!: (registrations: LangModule['default']) => void
    const loading = new Promise<LangModule['default']>(resolve => { resolveGrammar = resolve })
    fetchGrammarModule.mockReturnValue(loading)
    const firstOutput = callbacks()
    const secondOutput = callbacks()
    const firstRun = dispatchHighlightJobs([{ code: 'python', lang: 'py' }, BATCH[1]!], firstOutput)!
    dispatchHighlightJobs([{ code: 'typescript', lang: 'ts' }, BATCH[2]!], secondOutput)
    const worker = await readyWorker()
    await vi.waitFor(() => { expect(jobs(worker)).toHaveLength(2) })
    const [first, second] = jobs(worker)
    worker.reply({ op: 'missing', run: first!.run, job: first!.job, resolved: 'python' })
    worker.done(second!)
    expect(jobs(worker).map(job => job.code)).toEqual(['python', 'typescript', 'third'])
    firstRun.cancel()
    resolveGrammar(GRAMMAR)
    await loading
    worker.done(jobs(worker)[2]!)

    expect(worker.postMessage).toHaveBeenCalledTimes(3)
    expect(firstOutput.apply).not.toHaveBeenCalled()
    expect(firstOutput.failed).not.toHaveBeenCalled()
    expect(secondOutput.apply.mock.calls).toEqual([[0, [[]], 2], [1, [[]], 2]])
    expect(secondOutput.failed).not.toHaveBeenCalled()
  })

  it('falls back once on a worker error and never applies its remaining replies', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const output = callbacks()
    dispatchHighlightJobs(BATCH, output)
    const worker = await readyWorker()
    worker.done(jobs(worker)[0]!)
    const pending = jobs(worker)[1]!
    worker.fail()
    worker.done(pending)

    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    expect(output.apply).toHaveBeenCalledExactlyOnceWith(0, [[]], 2)
    expect(output.failed).toHaveBeenCalledOnce()
    expect(dispatchHighlightJobs(BATCH, callbacks())).toBeUndefined()
  })

  it('does not submit a run cancelled before the shared worker is ready', async () => {
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const cancelledOutput = callbacks()
    dispatchHighlightJobs(BATCH, cancelledOutput)!.cancel()
    const liveOutput = callbacks()
    dispatchHighlightJobs([{ code: 'live', lang: 'ts' }], liveOutput)
    const worker = await readyWorker()

    expect(jobs(worker).map(job => job.code)).toEqual(['live'])
    expect(cancelledOutput.apply).not.toHaveBeenCalled()
    expect(cancelledOutput.failed).not.toHaveBeenCalled()
    worker.done(jobs(worker)[0]!)
    expect(liveOutput.apply).toHaveBeenCalledExactlyOnceWith(0, [[]], 2)
  })

  it('reports a startup failure only to live runs and keeps the failure terminal', async () => {
    vi.stubGlobal('Worker', class {
      constructor() { throw new Error('worker construction blocked') }
    })
    const { dispatchHighlightJobs } = await import('../src/markdown/highlight-jobs.ts')
    const cancelledOutput = callbacks()
    dispatchHighlightJobs(BATCH, cancelledOutput)!.cancel()
    const liveOutput = callbacks()
    dispatchHighlightJobs(BATCH, liveOutput)
    await vi.waitFor(() => { expect(liveOutput.failed).toHaveBeenCalledOnce() })

    expect(cancelledOutput.failed).not.toHaveBeenCalled()
    expect(cancelledOutput.apply).not.toHaveBeenCalled()
    expect(liveOutput.apply).not.toHaveBeenCalled()
    expect(dispatchHighlightJobs(BATCH, callbacks())).toBeUndefined()
  })
})
