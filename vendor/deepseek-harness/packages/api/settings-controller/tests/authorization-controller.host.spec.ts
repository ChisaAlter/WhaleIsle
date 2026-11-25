import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationStreamEvent } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai')

async function collectUntil(
  iterator: AsyncIterator<AuthorizationStreamEvent>,
  predicate: (event: AuthorizationStreamEvent) => boolean,
): Promise<AuthorizationStreamEvent[]> {
  const seen: AuthorizationStreamEvent[] = []
  while (true) {
    const next = await iterator.next()
    if (next.done === true) return seen
    seen.push(next.value)
    if (predicate(next.value)) return seen
  }
}

async function bootWithAuth(): Promise<{ ctx: Context; controller: AuthorizationController }> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  return { ctx, controller: ctx.authorizationController }
}

describe('the authorization Remote namespace', () => {
  it('publishes the authorization namespace and all five Remote methods', async () => {
    const { controller } = await bootWithAuth()
    expect(controller.typertRemote.serviceKey).toBe('authorizationController')
    expect(controller.typertRemote.namespace).toBe('authorization')
    expect(remoteMethods(controller)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'describe', invocation: { kind: 'direct' } },
      { method: 'start', mode: 'stream', invocation: { kind: 'direct' } },
      { method: 'respondPrompt', invocation: { kind: 'direct' } },
      { method: 'cancel', invocation: { kind: 'direct' } },
    ])
  })

  it('returns empty list / null describe when ctx.authorization is absent, and rejects start when absent', async () => {
    const ctx = new Context()
    await ctx.plugin(AuthorizationController)
    expect(ctx.authorizationController.list()).toEqual([])
    expect(ctx.authorizationController.describe('llm-pi-ai/openai')).toBeNull()
    expect(() => { ctx.authorizationController.cancel('llm-pi-ai/openai') }).not.toThrow()

    const iterator = ctx.authorizationController.start('llm-pi-ai/openai', undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const failure = await iterator.next().catch((error: unknown) => error)
    expect(remoteErrorOf(failure)).toMatchObject({ code: 'gateway/internal' })
  })

  it('rejects invalid credential keys across describe, start, cancel, and unknown promptIds', async () => {
    const { controller } = await bootWithAuth()
    expect(() => { controller.describe('invalid') }).toThrow()
    expect(() => { controller.cancel('invalid') }).toThrow()
    expect(() => { controller.respondPrompt('missing-prompt', 'ans') }).toThrow()

    const badDescribe = (() => {
      try { controller.describe('invalid') } catch (error) { return error }
      return undefined
    })()
    expect(remoteErrorOf(badDescribe)).toMatchObject({ code: 'gateway/bad-request' })

    const badRespond = (() => {
      try { controller.respondPrompt('missing-prompt', 'ans') } catch (error) { return error }
      return undefined
    })()
    expect(remoteErrorOf(badRespond)).toMatchObject({ code: 'gateway/bad-request' })

    const badStart = await controller.start('invalid', undefined, new AbortController().signal)[Symbol.asyncIterator]().next().catch((error: unknown) => error)
    expect(remoteErrorOf(badStart)).toMatchObject({ code: 'gateway/bad-request' })
  })

  it('lists and describes registered flows with strict field projection', async () => {
    const { ctx, controller } = await bootWithAuth()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT', secretExtra: 'hidden' } as never],
      run: () => Promise.resolve(),
    })

    const listed = controller.list()
    expect(listed).toEqual([{
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
    }])
    expect(JSON.stringify(listed)).not.toContain('hidden')
    expect(controller.describe(KEY)).toEqual(listed[0])
    expect(controller.describe('llm-pi-ai/other')).toBeNull()
  })

  it('streams notices, prompts without signals, responds to prompts, and finishes as authorized', async () => {
    const { ctx, controller } = await bootWithAuth()
    const answers: string[] = []
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        session.notify({ message: 'Open browser', url: 'https://auth.openai.com/authorize' })
        const code = await session.prompt({
          kind: 'text',
          message: 'Paste code',
          placeholder: 'code',
          signal: new AbortController().signal,
        })
        answers.push(code)
        const choice = await session.prompt({
          kind: 'select',
          message: 'Select workspace',
          options: [{ id: 'ws-1', label: 'Personal', description: 'Default' }],
        })
        answers.push(choice)
        await session.commit({ kind: 'grant', payload: { token: 'ok' } })
      },
    })

    const iterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const firstBatch = await collectUntil(iterator, event => event.type === 'prompt')
    expect(firstBatch[0]).toEqual({
      type: 'notice',
      notice: { message: 'Open browser', url: 'https://auth.openai.com/authorize' },
    })
    const prompt1 = firstBatch[1]
    expect(prompt1?.type).toBe('prompt')
    if (prompt1?.type !== 'prompt') throw new Error('expected prompt')
    expect(prompt1.prompt).toEqual({ kind: 'text', message: 'Paste code', placeholder: 'code' })
    expect('signal' in prompt1.prompt).toBe(false)

    controller.respondPrompt(prompt1.promptId, 'code-123')

    const secondBatch = await collectUntil(iterator, event => event.type === 'prompt')
    const prompt2 = secondBatch[0]
    expect(prompt2?.type).toBe('prompt')
    if (prompt2?.type !== 'prompt') throw new Error('expected second prompt')
    expect(prompt2.prompt).toEqual({
      kind: 'select',
      message: 'Select workspace',
      options: [{ id: 'ws-1', label: 'Personal', description: 'Default' }],
    })

    controller.respondPrompt(prompt2.promptId, 'ws-1')

    const endBatch = await collectUntil(iterator, () => false)
    expect(endBatch).toEqual([{ type: 'done', status: 'authorized' }])
    expect(answers).toEqual(['code-123', 'ws-1'])
  })

  it('settles as cancelled when prompt is declined via respondPrompt(promptId, null)', async () => {
    const { ctx, controller } = await bootWithAuth()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        await session.prompt({ kind: 'secret', message: 'API key' })
      },
    })

    const iterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const events = await collectUntil(iterator, event => event.type === 'prompt')
    const prompt = events[0]
    if (prompt?.type !== 'prompt') throw new Error('expected prompt')

    controller.respondPrompt(prompt.promptId, null)

    const tail = await collectUntil(iterator, () => false)
    expect(tail).toEqual([{ type: 'done', status: 'cancelled' }])
  })

  it('emits prompt-withdrawn when prompt.signal aborts and cleans up pending prompt', async () => {
    const { ctx, controller } = await bootWithAuth()
    const promptAbort = new AbortController()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Manual code', signal: promptAbort.signal })
          .catch(() => 'browser-won')
        await session.commit({ kind: 'grant', payload: { token: 'browser' } })
      },
    })

    const iterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const first = await collectUntil(iterator, event => event.type === 'prompt')
    const prompt = first[0]
    if (prompt?.type !== 'prompt') throw new Error('expected prompt')

    promptAbort.abort()

    const rest = await collectUntil(iterator, () => false)
    expect(rest).toEqual([
      { type: 'prompt-withdrawn', promptId: prompt.promptId },
      { type: 'done', status: 'authorized' },
    ])
    expect(() => { controller.respondPrompt(prompt.promptId, 'too-late') }).toThrow()
  })

  it('cancels an active stream via cancel() and cleans up pending prompts on early close', async () => {
    const { ctx, controller } = await bootWithAuth()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Waiting' })
      },
    })

    const iterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const first = await collectUntil(iterator, event => event.type === 'prompt')
    const prompt = first[0]
    if (prompt?.type !== 'prompt') throw new Error('expected prompt')

    controller.cancel(KEY)
    const rest = await collectUntil(iterator, () => false)
    expect(rest).toEqual([{ type: 'done', status: 'cancelled' }])
    expect(() => { controller.respondPrompt(prompt.promptId, 'late') }).toThrow()

    // Also test early stream termination via return()
    const secondIterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const secondFirst = await collectUntil(secondIterator, event => event.type === 'prompt')
    const secondPrompt = secondFirst[0]
    if (secondPrompt?.type !== 'prompt') throw new Error('expected prompt')

    await secondIterator.return?.()
    expect(() => { controller.respondPrompt(secondPrompt.promptId, 'after-return') }).toThrow()
  })

  it('emits an error event when the authorization attempt fails', async () => {
    const { ctx, controller } = await bootWithAuth()
    const iterator = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const events = await collectUntil(iterator, () => false)
    expect(events).toEqual([{
      type: 'error',
      code: 'NO_FLOW',
      message: `no authorization flow is registered for "${KEY}"`,
    }])

    const failing = vi.fn().mockRejectedValue(new Error('oauth server 500'))
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'ChatGPT',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      run: failing,
    })
    const iterator2 = controller.start(KEY, undefined, new AbortController().signal)[Symbol.asyncIterator]()
    const events2 = await collectUntil(iterator2, () => false)
    expect(events2).toEqual([{
      type: 'error',
      code: 'INTERNAL',
      message: 'oauth server 500',
    }])
  })
})
