import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionPresentation, SessionListMetadata } from '../src/types.ts'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

const defaults = {
  defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
  cwd: '/tmp',
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  ctx.agents.setFactory({
    createAgent: (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = { id: session.id, session, status: 'idle', ctx: ownerCtx } as Agent
      ctx.agents.register(agent)
      return Promise.resolve({ agent, dispose: () => Promise.resolve() })
    },
    resume: () => Promise.reject(new Error('resume must not run in this fixture')),
  })
  return { ctx, remote: createSessionTestRemote(ctx, defaults) }
}

function sessionOf(ctx: Context, id: SessionId): Session {
  const session = ctx.sessions.get(id)
  if (session === undefined) throw new Error(`missing session ${id}`)
  return session
}

function metadataOf(ctx: Context, session: Session): SessionListMetadata {
  const metadata = ctx.sessionProjections.snapshot(session).values.sessionListMetadata
  if (metadata === undefined) throw new Error(`missing list metadata for ${session.id}`)
  return metadata
}

async function listedItem(remote: TestSessionRemote, id: SessionId) {
  const response = await remote.list({})
  if (!response.ok) throw response.error
  const item = response.value.items.find(candidate => candidate.sessionId === id)
  if (item === undefined) throw new Error(`missing listed session ${id}`)
  return item
}

describe('session presentation host commands', () => {
  it('creates presentation as a log-only event without starting a conversation', async () => {
    const { ctx, remote } = await harness()
    const id = sid('presentation-create')
    const presentation: SessionPresentation = { owner: 'project', title: 'Project conversation', workingDirectory: '/user/project' }

    await expect(remote.create({ sessionId: id, cwd: '/tmp', presentation })).resolves.toEqual({
      ok: true,
      value: { sessionId: id },
    })

    const session = sessionOf(ctx, id)
    expect(session.header.cwd).toBe('/tmp')
    expect(session.snapshotEvents().map(event => event.type)).toEqual(['session/presentation'])
    expect(session.snapshotEvents()[0]).toMatchObject({ seq: 0, data: presentation })
    expect(metadataOf(ctx, session)).toEqual({ blank: true, lastPromptAt: null, presentation })
    expect(ctx.sessionProjections.checkpoint(session).sessionListMetadata).toMatchObject({ ver: 3 })

    await expect(listedItem(remote, id)).resolves.toMatchObject({
      blank: true,
      projections: { values: { sessionListMetadata: { blank: true, lastPromptAt: null, presentation } } },
    })
  })

  it('sets, updates, deduplicates, and clears presentation metadata', async () => {
    const { ctx, remote } = await harness()
    const id = sid('presentation-mutations')
    const first: SessionPresentation = { owner: 'plugin', title: 'First title', composer: 'managed' }
    const second: SessionPresentation = { owner: 'plugin', title: 'First title' }
    await expect(remote.create({ sessionId: id, cwd: '/tmp' })).resolves.toMatchObject({ ok: true })

    await expect(remote.setPresentation({ sessionId: id, presentation: first })).resolves.toEqual({
      ok: true,
      value: { presentation: first, seq: 0 },
    })
    const session = sessionOf(ctx, id)
    expect(session.snapshotEvents()).toHaveLength(1)

    await expect(remote.setPresentation({ sessionId: id, presentation: first })).resolves.toEqual({
      ok: true,
      value: { presentation: first, seq: 0 },
    })
    expect(session.snapshotEvents()).toHaveLength(1)

    await expect(remote.setPresentation({ sessionId: id, presentation: second })).resolves.toEqual({
      ok: true,
      value: { presentation: second, seq: 1 },
    })
    expect(session.snapshotEvents()).toHaveLength(2)
    expect(metadataOf(ctx, session).presentation).toEqual(second)
    await expect(listedItem(remote, id)).resolves.toMatchObject({
      projections: { values: { sessionListMetadata: { presentation: second } } },
    })

    const directoryChange = { ...second, workingDirectory: '/user/project' }
    await expect(remote.setPresentation({ sessionId: id, presentation: directoryChange })).resolves.toMatchObject({
      ok: true, value: { seq: 2, presentation: directoryChange },
    })
    expect(metadataOf(ctx, session).presentation).toEqual(directoryChange)
    expect(session.header.cwd).toBe('/tmp')

    await expect(remote.setPresentation({ sessionId: id, presentation: null })).resolves.toEqual({
      ok: true,
      value: { presentation: null, seq: 3 },
    })
    expect(session.snapshotEvents().map(event => event.type)).toEqual([
      'session/presentation', 'session/presentation', 'session/presentation', 'session/presentation',
    ])
    expect(session.snapshotEvents().at(-1)?.data).toBeNull()
    expect(metadataOf(ctx, session)).toEqual({ blank: true, lastPromptAt: null })
  })

  it('keeps presentation through turn and prompt projection updates', async () => {
    const { ctx, remote } = await harness()
    const id = sid('presentation-projection')
    const presentation: SessionPresentation = { owner: 'plugin', title: 'Persistent title', composer: 'managed' }
    await expect(remote.create({ sessionId: id, cwd: '/tmp', presentation })).resolves.toMatchObject({ ok: true })
    const session = sessionOf(ctx, id)

    expect(metadataOf(ctx, session)).toEqual({ blank: true, lastPromptAt: null, presentation })
    session.append('turn/start', { turn: 1 })
    expect(metadataOf(ctx, session)).toEqual({ blank: false, lastPromptAt: null, presentation })

    const prompt = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(metadataOf(ctx, session)).toEqual({
      blank: false,
      lastPromptAt: prompt.time,
      presentation,
    })
  })

  it.each([
    { name: 'empty owner', presentation: { owner: '', title: 'Valid title' } },
    { name: 'empty title', presentation: { owner: 'plugin', title: '   ' } },
    { name: 'oversized owner', presentation: { owner: 'x'.repeat(241), title: 'Valid title' } },
    { name: 'oversized title', presentation: { owner: 'plugin', title: 'x'.repeat(241) } },
  ])('rejects $name before creating a Session', async ({ presentation }) => {
    const { ctx, remote } = await harness()
    const id = sid(`invalid-${presentation.owner.length}-${presentation.title.length}`)

    const response = await remote.create({ sessionId: id, cwd: '/tmp', presentation })

    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error.code).toBe('gateway/bad-request')
    expect(ctx.sessions.get(id)).toBeUndefined()
    expect(ctx.agents.get(id)).toBeUndefined()
  })

  it('rejects an unsupported composer discriminator before creating a Session', async () => {
    const { ctx, remote } = await harness()
    const id = sid('invalid-composer')

    const response = await remote.create({
      sessionId: id,
      cwd: '/tmp',
      presentation: { owner: 'plugin', title: 'Invalid', composer: 'custom' as never },
    })

    expect(response).toMatchObject({ ok: false, error: { code: 'gateway/bad-request' } })
    expect(ctx.sessions.get(id)).toBeUndefined()
  })

  it('leaves ordinary create without presentation events', async () => {
    const { ctx, remote } = await harness()
    const id = sid('ordinary-create')

    await expect(remote.create({ sessionId: id, cwd: '/tmp' })).resolves.toEqual({
      ok: true,
      value: { sessionId: id },
    })

    const session = sessionOf(ctx, id)
    expect(session.snapshotEvents()).toEqual([])
    expect(metadataOf(ctx, session)).toEqual({ blank: true, lastPromptAt: null })
  })
})
