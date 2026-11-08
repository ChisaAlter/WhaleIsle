/** Archived-root delete: pure deletable set plus SessionController.delete. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentHandle, type CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { Session, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { collectDeletable, persistDeleteOrder } from '../src/delete-archived.ts'
import {
  createSessionTestRemote, installSessionReadTestServices, testSessionPersistence,
} from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

/**
 * Brand a payload for a unary Session Remote call.
 * @param payload - request body.
 * @returns the same payload.
 */
function request<P>(payload: P): P {
  return payload
}

/**
 * Minimal header for collectDeletable / persistDeleteOrder fixtures.
 * @param id - session identity.
 * @param extra - parentSession and origin when the fixture is a child.
 * @returns a SessionHeader.
 */
function header(
  id: string,
  extra: Partial<Pick<SessionHeader, 'parentSession' | 'origin'>> = {},
): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: sid(id), createdAt: 1, isSeeded: false, ...extra }
}

/**
 * In-memory workspace registry with an archive set and detachable memberships.
 * @param workspaces - workspaces returned by list().
 * @returns a registry stub with archiveSession / unarchiveSession.
 */
function testWorkspaceRegistry(workspaces: readonly Workspace[] = []) {
  const archivedSessionIds: SessionId[] = []
  return {
    archivedSessionIds,
    list: () => workspaces,
    /**
     * Add one id to the archive set if it is not already present.
     * @param sessionId - session identity to archive.
     */
    archiveSession: async (sessionId: SessionId): Promise<void> => {
      if (!archivedSessionIds.includes(sessionId)) archivedSessionIds.push(sessionId)
    },
    /**
     * Remove one id from the archive set if present.
     * @param sessionId - session identity to restore.
     */
    unarchiveSession: async (sessionId: SessionId): Promise<void> => {
      const index = archivedSessionIds.indexOf(sessionId)
      if (index >= 0) archivedSessionIds.splice(index, 1)
    },
  }
}

/**
 * Session Controller unit context with a richer workspace-registry stub than
 * the fork suite's `{ list }` double.
 * @param workspaces - workspaces returned by registry.list().
 * @returns the context and the archive-capable registry stub.
 */
async function composed(workspaces: readonly Workspace[] = []): Promise<{
  ctx: Context
  registry: ReturnType<typeof testWorkspaceRegistry>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(AgentRegistry)
  installSessionReadTestServices(ctx)
  const registry = testWorkspaceRegistry(workspaces)
  ctx.provide('workspaceRegistry', registry as never)
  ctx.agents.setFactory({
    createAgent: async (ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, {
        ...options.seed === undefined ? {} : { seed: [...options.seed] },
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const agent = {} as Agent
      const agentCtx = ownerCtx.extend({ agent })
      Object.assign(agent, { id: session.id, session, status: 'idle', ctx: agentCtx })
      await options.setup?.(agentCtx, agent)
      await ctx.agents.register(agent)
      return { agent, dispose: () => Promise.resolve() }
    },
    resume: () => Promise.reject(new Error('delete test sources are live')),
  })
  return { ctx, registry }
}

const remote = (ctx: Context) => createSessionTestRemote(ctx, {
  defaultModelSelection: () => ({ provider: 'default-provider', model: 'default-model' }),
  cwd: '/tmp',
})

/**
 * Live idle Agent whose log is `turns` completed user turns.
 * @param ctx - Host context with a Session store and Agent registry.
 * @param id - session identity.
 * @param turns - completed turns to append.
 * @returns the live Session.
 */
async function liveAgent(ctx: Context, id: string, turns: number): Promise<Session> {
  const session = ctx.sessions.create(sid(id), { meta: { cwd: '/proj' } })
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `prompt ${String(turn)}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  return session
}

/**
 * Retain a handle so `session.delete` can dispose a `liveAgent` registration.
 * `liveAgent` uses `agents.register`, which Host treats as session-live-unowned.
 * @param ctx - Host context after createSessionTestRemote installed SessionLifecycle.
 * @param sessionId - live Agent identity to retain.
 */
function retainLiveHandle(ctx: Context, sessionId: SessionId): void {
  const lifecycle = ctx.get('sessionLifecycle')
  const agent = ctx.agents.get(sessionId)
  if (lifecycle === undefined || agent === undefined) {
    throw new Error('fixture must install SessionLifecycle and register the Agent')
  }
  lifecycle.retainHandle({ agent, dispose: () => Promise.resolve() })
}

describe('collectDeletable / persistDeleteOrder', () => {
  it('includes nested subagents, excludes forks, and orders children before parents', () => {
    const root = header('root')
    const child = header('child', { parentSession: root.id, origin: 'subagent' })
    const nested = header('nested', { parentSession: child.id, origin: 'subagent' })
    const fork = header('fork', { parentSession: root.id })
    const headers = [root, child, nested, fork]
    const deletable = collectDeletable(root.id, headers)
    expect(deletable).toEqual(new Set([root.id, child.id, nested.id]))
    expect(deletable.has(fork.id)).toBe(false)
    expect(persistDeleteOrder(deletable, new Map(headers.map(item => [item.id, item])))).toEqual([
      nested.id, child.id, root.id,
    ])
  })
})

describe('sessions.delete', () => {
  it('rejects a live session that is not archived', async () => {
    const { ctx } = await composed()
    const source = await liveAgent(ctx, 'session-live', 1)
    const response = await (await remote(ctx)).delete(request({ sessionId: source.id }))
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'session-not-archived', details: { sessionId: source.id } },
    })
    await ctx.fiber.dispose()
  })

  it('rejects an unknown id that is not in the archive set', async () => {
    const { ctx } = await composed()
    const sessionId = sid('missing')
    const response = await (await remote(ctx)).delete(request({ sessionId }))
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'session/not-found', details: { sessionId } },
    })
    await ctx.fiber.dispose()
  })

  it('rejects an archived live session without a retained handle', async () => {
    const { ctx, registry } = await composed()
    const source = await liveAgent(ctx, 'session-unowned', 1)
    await registry.archiveSession(source.id)
    const response = await (await remote(ctx)).delete(request({ sessionId: source.id }))
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'session-live-unowned', details: { sessionId: source.id } },
    })
    expect(registry.archivedSessionIds).toEqual([source.id])
    await ctx.fiber.dispose()
  })

  it('deletes an archived liveAgent session, unarchives it, and emits api-session/deleted', async () => {
    const detachSession = vi.fn<(sessionId: SessionId) => Promise<void>>()
      .mockResolvedValue(undefined)
    const workspace = { sessionIds: [] as SessionId[], detachSession } as unknown as Workspace
    const { ctx, registry } = await composed([workspace])
    const listed: SessionHeader[] = []
    const persistDelete = vi.fn<(id: SessionId) => Promise<void>>(async (id) => {
      const index = listed.findIndex(item => item.id === id)
      if (index >= 0) listed.splice(index, 1)
    })
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([...listed]),
      delete: persistDelete,
    }) as never)

    const proxy = await remote(ctx)
    const source = await liveAgent(ctx, 'session-archived', 1)
    listed.push(source.header)
    retainLiveHandle(ctx, source.id)
    await registry.archiveSession(source.id)
    expect(registry.archivedSessionIds).toEqual([source.id])

    const deleted: SessionId[] = []
    ctx.on('api-session/deleted', (sessionId) => { deleted.push(sessionId) })
    const unarchive = vi.spyOn(registry, 'unarchiveSession')

    const response = await proxy.delete(request({ sessionId: source.id }))
    expect(response).toEqual({
      ok: true,
      value: {
        deletedSessionIds: [source.id],
        archivedSessionIds: [],
      },
    })
    expect(persistDelete).toHaveBeenCalledWith(source.id)
    expect(unarchive).toHaveBeenCalledWith(source.id)
    expect(registry.archivedSessionIds).toEqual([])
    expect(deleted).toEqual([source.id])
    expect(detachSession).toHaveBeenCalledWith(source.id)
    await ctx.fiber.dispose()
  })
})
