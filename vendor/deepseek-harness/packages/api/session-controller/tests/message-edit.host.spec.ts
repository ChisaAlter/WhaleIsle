/** Same-session edits through the real controller, inbox, loop, and model surface. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { createSessionTestRemote } from './test-remote.ts'
import type { SessionRequestId } from '../src/types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'edit-test': { kind: 'edit-test' }
    'edit-instructions': { kind: 'edit-instructions'; form?: 'instructions' }
    'edit-state': { kind: 'edit-state'; form: 'snapshot'; sections: readonly [] }
    'edit-notice': { kind: 'edit-notice'; form: 'notice'; summary: string }
  }
}

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter(Array.from({ length: 8 }, (_, i) => textResponse(`reply-${i}`)))
  ctx.llm.registerAdapter(['mock'], adapter)
  ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] } as never)
  const remote = await createSessionTestRemote(ctx, {
    cwd: '/workspace', defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
  })
  const agent = await ctx.agentLoop.create(SessionId('edit-session'), { provider: 'mock', model: 'mock' })
  let request = 0
  const send = async (text: string, editMessageSeq?: number) => {
    const result = await remote.prompt({
      sessionId: agent.id, requestId: `edit-${request++}` as SessionRequestId,
      mode: 'queue', content: [{ type: 'text', text }],
      ...(editMessageSeq === undefined ? {} : { editMessageSeq }),
    })
    await agent.whenIdle()
    return result
  }
  const latest = () => agent.session.snapshotEvents().findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')!.seq
  const texts = (session = agent.session) => session.deriveMessages().flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
  return { ctx, agent, adapter, remote, send, latest, texts }
}

describe('same-session message editing', () => {
  it.each([1, 2])('edits the latest of %i turns without creating another session, including repeated edits and replay', async (count) => {
    const b = await bench()
    for (let i = 0; i < count; i++) expect((await b.send(`prompt-${i}`)).ok).toBe(true)
    const header = b.agent.session.header
    const prefix = b.agent.session.snapshotEvents()
    expect((await b.send('revised', b.latest())).ok).toBe(true)
    expect(b.ctx.agents.list()).toHaveLength(1)
    expect(b.agent.session.id).toBe(SessionId('edit-session'))
    expect(b.agent.session.header).toEqual(header)
    expect(b.agent.session.snapshotEvents().slice(0, prefix.length)).toEqual(prefix)
    expect(b.texts()).not.toContain(`prompt-${count - 1}`)
    expect(b.texts()).not.toContain(`reply-${count - 1}`)
    expect(b.texts()).toContain('revised')
    // rc.1 surfaces the harness identity as node 0; tolerate that one leading
    // system line and pin everything after it.
    if (count === 2) {
      expect(b.texts()).toHaveLength(5)
      expect(b.texts().slice(1)).toEqual(['prompt-0', 'reply-0', 'revised', 'reply-2'])
    }
    expect((await b.send('revised-again', b.latest())).ok).toBe(true)
    expect(b.texts()).not.toContain('revised')
    expect(b.texts()).toContain('revised-again')
    const replay = Session.create(header.id, b.agent.session.snapshotEvents(), header)
    expect(b.texts(replay)).toEqual(b.texts())
    const requestTexts = b.adapter.requests.at(-1)!.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
    expect(requestTexts).not.toContain(`prompt-${count - 1}`)
    expect(requestTexts).not.toContain('revised')
    expect(requestTexts).toContain('revised-again')
  })

  it('rejects historical, malformed, and pending edits before altering history', async () => {
    const b = await bench()
    await b.send('first')
    const first = b.latest()
    await b.send('second')
    const latest = b.latest()
    const prefix = b.agent.session.snapshotEvents()
    for (const target of [first, -1, 1.5, Number.NaN, 999999]) {
      expect((await b.send('invalid', target)).ok).toBe(false)
      expect(b.agent.session.snapshotEvents()).toEqual(prefix)
    }
    b.agent.inject(createUserMessage({ content: [{ type: 'text', text: 'pending context' }], source: { kind: 'edit-test' } }))
    expect((await b.send('pending edit', latest)).ok).toBe(false)
    expect(b.texts()).not.toContain('pending edit')
    expect(b.ctx.agents.list()).toHaveLength(1)
  })

  it('rejects an edit while another prompt is running, without queuing the revision', async () => {
    const b = await bench()
    await b.send('original')
    const target = b.latest()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    b.ctx.on('agent/pre-step', async (_payload, next) => {
      entered.resolve(undefined)
      await release.promise
      return next()
    })
    const ongoing = b.send('next turn')
    await entered.promise
    try {
      const result = await b.remote.prompt({
        sessionId: b.agent.id, requestId: 'busy-edit' as SessionRequestId,
        mode: 'queue', content: [{ type: 'text', text: 'must not queue' }], editMessageSeq: target,
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'session/agent-busy' } })
      expect([...b.agent.inbox.nextTurn, ...b.agent.inbox.nextStep]).toHaveLength(0)
    } finally {
      release.resolve(undefined)
      await ongoing
    }
    expect(b.texts()).not.toContain('must not queue')
  })

  it('keeps injected instructions and ignores same-turn steering when locating the editable message', async () => {
    const b = await bench()
    let inject = true
    b.ctx.on('agent/pre-step', async (_payload, next) => {
      const result = await next()
      if (!inject || result.kind !== 'enter') return result
      inject = false
      return { ...result, messages: [...result.messages,
        createUserMessage({ content: [{ type: 'text', text: 'retained instructions' }], source: { kind: 'edit-instructions' } }),
        createUserMessage({ content: [{ type: 'text', text: 'steering' }], source: { kind: 'user' } }),
      ] }
    })
    await b.send('original')
    const target = b.agent.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')!.seq
    expect((await b.send('edited', target)).ok).toBe(true)
    expect(b.texts()).toContain('retained instructions')
    expect(b.texts()).not.toContain('original')
    expect(b.texts()).not.toContain('steering')
  })

  it('retains earlier file instructions beside newly injected instructions but replaces snapshots and drops one-off notices', async () => {
    const b = await bench()
    let round = 0
    b.ctx.on('agent/pre-step', async (_payload, next) => {
      const result = await next()
      if (result.kind !== 'enter') return result
      round += 1
      const text = round === 1 ? 'base instructions' : 'new file instructions'
      const state = round === 1 ? 'old runtime state' : 'fresh runtime state'
      return { ...result, messages: [...result.messages,
        createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'edit-instructions', form: 'instructions' } }),
        createUserMessage({ content: [{ type: 'text', text: state }], source: { kind: 'edit-state', form: 'snapshot', sections: [] } }),
        ...(round === 1 ? [createUserMessage({ content: [{ type: 'text', text: 'old one-off notice' }], source: { kind: 'edit-notice', form: 'notice', summary: 'notice' } })] : []),
      ] }
    })
    await b.send('original')
    expect((await b.send('edited', b.latest())).ok).toBe(true)
    expect(b.texts()).toContain('base instructions')
    expect(b.texts()).toContain('new file instructions')
    expect(b.texts()).toContain('fresh runtime state')
    expect(b.texts()).not.toContain('old runtime state')
    expect(b.texts()).not.toContain('old one-off notice')
  })
})
