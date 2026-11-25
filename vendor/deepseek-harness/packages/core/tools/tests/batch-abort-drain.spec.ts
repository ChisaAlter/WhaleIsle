/** Deterministic tests for bounded tool abort drain when tools ignore AbortSignal. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { DEFAULT_ABORT_DRAIN_TIMEOUT_MS, executeToolBatch } from '../src/batch.ts'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '../src/contracts.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  return ctx
}

afterEach(() => {
  vi.useRealTimers()
})

describe('executeToolBatch bounded abort drain', () => {
  it('exposes DEFAULT_ABORT_DRAIN_TIMEOUT_MS = 5_000 and rejects invalid bounds', async () => {
    expect(DEFAULT_ABORT_DRAIN_TIMEOUT_MS).toBe(5_000)
    const ctx = await setup()
    try {
      const pipeline = new ToolExecutionPipeline(ctx)
      const controller = new AbortController()
      await expect(executeToolBatch(
        { calls: [], signal: controller.signal },
        pipeline,
        () => 4,
        { abortDrainTimeoutMs: -1 },
      )).rejects.toThrow(RangeError)
      await expect(executeToolBatch(
        { calls: [], signal: controller.signal },
        pipeline,
        () => 4,
        { abortDrainTimeoutMs: Number.NaN },
      )).rejects.toThrow(RangeError)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('detaches uncooperative hanging tools after abortDrainTimeoutMs, records TOOL_ABORTED, and prevents unhandled rejections', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctx = await setup()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    let rejectHung1!: (error: Error) => void
    let rejectHung2!: (error: Error) => void
    let hungStarted = 0

    try {
      ctx.tools.register(defineContentToolFixture({
        name: 'hung',
        description: 'ignores signal and hangs',
        parameters: { slot: { type: 'number', required: true } },
        isConcurrencySafe: () => true,
        execute(args: { slot: number }) {
          hungStarted++
          return new Promise<never>((_resolve, reject) => {
            if (args.slot === 1) rejectHung1 = reject
            else rejectHung2 = reject
          })
        },
      }))
      ctx.tools.register(defineContentToolFixture({
        name: 'fast',
        description: 'completes promptly',
        parameters: {},
        isConcurrencySafe: () => true,
        async execute() {
          return [{ type: 'text', text: 'fast-ok' }]
        },
      }))

      const controller = new AbortController()
      const pipeline = new ToolExecutionPipeline(ctx)
      const batchPromise = executeToolBatch(
        {
          signal: controller.signal,
          calls: [
            { type: 'tool-call', id: ToolCallId('c0'), name: 'fast', arguments: '{}' },
            { type: 'tool-call', id: ToolCallId('c1'), name: 'hung', arguments: '{"slot":1}' },
            { type: 'tool-call', id: ToolCallId('c2'), name: 'hung', arguments: '{"slot":2}' },
            { type: 'tool-call', id: ToolCallId('c3'), name: 'fast', arguments: '{}' },
          ],
        },
        pipeline,
        () => 2,
        { abortDrainTimeoutMs: 250 },
      )

      // Allow c0 to complete & commit, leaving c1 and c2 inFlight at maxParallel=2 while c3 stays unstarted.
      await vi.advanceTimersByTimeAsync(0)
      expect(hungStarted).toBe(2)

      // Cancel while c1 and c2 ignore signal and stay hung.
      controller.abort()
      await vi.advanceTimersByTimeAsync(249)

      let settledEarly = false
      void batchPromise.then(() => { settledEarly = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(settledEarly).toBe(false)

      // Crossing the 250ms drain timeout unblocks the batch immediately.
      await vi.advanceTimersByTimeAsync(1)
      const batch = await batchPromise

      expect(batch.results.map(entry => ({
        callId: entry.callId,
        isError: entry.result.isError,
        code: entry.result.isError ? entry.result.error.info?.code : undefined,
      }))).toEqual([
        { callId: ToolCallId('c0'), isError: false, code: undefined },
        { callId: ToolCallId('c1'), isError: true, code: TOOL_ABORTED },
        { callId: ToolCallId('c2'), isError: true, code: TOOL_ABORTED },
        { callId: ToolCallId('c3'), isError: true, code: TOOL_ABORTED_BEFORE_DISPATCH },
      ])

      // Rejecting detached promises later must not emit unhandledRejection.
      rejectHung1(new Error('late rejection from c1'))
      rejectHung2(new Error('late rejection from c2'))
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      await ctx.fiber.dispose()
    }
  })

  it('bounds scheduler-failure drain wait when signal aborts with an uncooperative tool in flight', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const ctx = await setup()
    try {
      ctx.tools.register(defineContentToolFixture({
        name: 'hung',
        description: 'ignores signal and hangs',
        parameters: {},
        isConcurrencySafe: () => true,
        execute() {
          return new Promise<never>(() => {
            // Intentionally never settles.
          })
        },
      }))
      ctx.tools.register(defineContentToolFixture({
        name: 'failing_post',
        description: 'completes fast',
        parameters: {},
        isConcurrencySafe: () => true,
        async execute() {
          return [{ type: 'text', text: 'ok' }]
        },
      }))

      const controller = new AbortController()
      const pipeline = new ToolExecutionPipeline(ctx)
      const baseComplete = pipeline.complete.bind(pipeline)
      vi.spyOn(pipeline, 'complete').mockImplementation(async (exec, settled) => {
        if (exec.callId === ToolCallId('c1')) throw new Error('post-execute failure')
        return baseComplete(exec, settled)
      })
      // Make c1 throw during complete() while c0 hangs after abort.
      const batchPromise = executeToolBatch(
        {
          signal: controller.signal,
          calls: [
            { type: 'tool-call', id: ToolCallId('c1'), name: 'failing_post', arguments: '{}' },
            { type: 'tool-call', id: ToolCallId('c0'), name: 'hung', arguments: '{}' },
          ],
        },
        pipeline,
        () => 2,
        { abortDrainTimeoutMs: 100 },
      )

      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      const expected = expect(batchPromise).rejects.toMatchObject({ cause: new Error('post-execute failure') })
      await vi.advanceTimersByTimeAsync(100)
      await expected
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
