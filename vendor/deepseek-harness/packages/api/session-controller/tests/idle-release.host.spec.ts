import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { IdleSessionRelease } from '../src/idle-release.ts'
import { SessionLifecycle } from '../src/lifecycle.ts'
import { createSessionTestController, testSessionPersistence } from './test-remote.ts'

type Listener = (...args: unknown[]) => void

/** A fake Host context exposing only what the release policy reads. */
function releaseHarness(policy: { idleMs?: number; keep?: number } = {}) {
  let clock = 0
  const agents = new Map<SessionId, Agent>()
  const owners = new Map<SessionId, Agent>()
  const services: Record<string, unknown> = {}
  const presentations = new Map<SessionId, unknown>()
  const listeners = new Map<string, Listener[]>()
  const logger = { info: vi.fn(), warn: vi.fn() }
  const ctx = {
    on: (name: string, listener: Listener) => {
      listeners.set(name, [...listeners.get(name) ?? [], listener])
      return () => {}
    },
    effect: () => {},
    provide: () => {},
    get: (name: string) => services[name],
    logger,
    agents: {
      get: (id: SessionId) => agents.get(id),
      list: () => [...agents.values()],
      isOwnedBy: (id: SessionId, owner: Agent) => owners.get(id) === owner,
    },
    sessionProjections: {
      stateOf: (session: { id: SessionId }) => ({
        blank: false,
        lastPromptAt: null,
        ...presentations.has(session.id) ? { presentation: presentations.get(session.id) } : {},
      }),
    },
  }
  const emit = (name: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(name) ?? []) listener(...args)
  }
  const lifecycle = new SessionLifecycle(ctx as never)
  const release = new IdleSessionRelease(ctx as never, lifecycle, {
    idleMs: policy.idleMs ?? 1_000,
    keep: policy.keep ?? 0,
    now: () => clock,
  })
  const disposed: SessionId[] = []
  const open = (name: string, header: Record<string, unknown> = {}): Agent => {
    const id = SessionId(name)
    const agent = {
      id,
      status: 'idle',
      inbox: { nextTurn: [], nextStep: [] },
      session: { id, header: { id, ...header } },
    } as unknown as Agent
    agents.set(id, agent)
    lifecycle.retainHandle({
      agent,
      dispose: () => {
        agents.delete(id)
        disposed.push(id)
        return Promise.resolve()
      },
    })
    emit('agent/created', { agent })
    return agent
  }
  return {
    lifecycle, release, open, disposed, services, presentations, owners, agents, logger, emit,
    advance: (ms: number) => { clock += ms },
  }
}

describe('IdleSessionRelease', () => {
  it('releases idle unwatched Sessions past the threshold beyond the most recent ones', async () => {
    const test = releaseHarness({ keep: 1 })
    const older = test.open('older')
    test.advance(10)
    const recent = test.open('recent')
    test.advance(989)
    await test.release.sweep()
    expect(test.disposed).toEqual([])

    test.advance(1)
    await test.release.sweep()
    expect(test.disposed).toEqual([older.id])
    expect(test.lifecycle.handleOf(older.id)).toBeUndefined()
    expect(test.lifecycle.handleOf(recent.id)).toBeDefined()
    expect(test.lifecycle.releasingIds.size).toBe(0)
  })

  it('keeps watched Sessions and restarts their idle clock when the last watcher leaves', async () => {
    const test = releaseHarness()
    const agent = test.open('watched')
    const first = test.release.watch(agent.id)
    const second = test.release.watch(agent.id)
    test.advance(5_000)
    await test.release.sweep()
    first()
    first()
    await test.release.sweep()
    expect(test.disposed).toEqual([])

    second()
    test.advance(999)
    await test.release.sweep()
    expect(test.disposed).toEqual([])
    test.advance(1)
    await test.release.sweep()
    expect(test.disposed).toEqual([agent.id])
  })

  it('counts Session activity as use', async () => {
    const test = releaseHarness()
    const agent = test.open('active')
    test.advance(900)
    test.emit('session/event', agent.session)
    test.advance(900)
    await test.release.sweep()
    expect(test.disposed).toEqual([])
  })

  it.each([
    ['running', (_test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      (agent as { status: string }).status = 'running'
    }],
    ['queued input', (_test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      (agent.inbox.nextTurn as unknown[]).push({})
    }],
    ['a running background job', (test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      test.services.jobs = { list: () => [{ owner: agent.id, status: 'running' }] }
    }],
    ['a stopping background job', (test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      test.services.jobs = { list: () => [{ owner: agent.id, status: 'stopping' }] }
    }],
    ['an armed goal', (test: ReturnType<typeof releaseHarness>) => {
      test.services.goals = { get: () => ({ phase: 'active', activation: 'armed' }) }
    }],
    ['a live child Agent', (test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      const child = { id: SessionId('child'), status: 'idle', session: { header: {} } } as unknown as Agent
      test.agents.set(child.id, child)
      test.owners.set(child.id, agent)
    }],
    ['plugin-owned presentation', (test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      test.presentations.set(agent.id, { owner: 'project', title: 'Project' })
    }],
    ['an in-flight delete', (test: ReturnType<typeof releaseHarness>, agent: Agent) => {
      test.lifecycle.deletingIds.add(agent.id)
    }],
    ['an unreadable job registry', (test: ReturnType<typeof releaseHarness>) => {
      test.services.jobs = { list: () => { throw new Error('registry unavailable') } }
    }],
  ])('keeps a Session with %s resident', async (_label, arrange) => {
    const test = releaseHarness()
    const agent = test.open('busy')
    arrange(test, agent)
    test.advance(10_000)
    await test.release.sweep()
    expect(test.disposed).toEqual([])
  })

  it('leaves subagent Sessions to their parent', async () => {
    const test = releaseHarness()
    test.open('subagent', { origin: 'subagent' })
    test.advance(10_000)
    await test.release.sweep()
    expect(test.disposed).toEqual([])
  })

  it.each([
    ['paused', { phase: 'paused', activation: 'disarmed' }],
    ['disarmed active', { phase: 'active', activation: 'disarmed' }],
  ])('releases finished background-job owners with a %s goal', async (_label, goal) => {
    const test = releaseHarness()
    const agent = test.open('settled')
    test.services.jobs = { list: () => [{ owner: agent.id, status: 'completed' }, { status: 'running' }] }
    test.services.goals = { get: () => goal }
    test.advance(1_000)
    await test.release.sweep()
    expect(test.disposed).toEqual([agent.id])
  })

  it('never releases when idleMs is 0', async () => {
    const test = releaseHarness({ idleMs: 0 })
    test.open('kept')
    test.advance(Number.MAX_SAFE_INTEGER)
    await test.release.sweep()
    expect(test.disposed).toEqual([])
  })

  it('logs a failed release and clears its marker', async () => {
    const test = releaseHarness()
    const id = SessionId('failing')
    const agent = { id, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, session: { id, header: {} } } as unknown as Agent
    test.agents.set(id, agent)
    test.lifecycle.retainHandle({ agent, dispose: () => Promise.reject(new Error('teardown failed')) })
    test.emit('agent/created', { agent })
    test.advance(1_000)
    await test.release.sweep()
    expect(test.logger.warn).toHaveBeenCalledWith(expect.stringContaining('teardown failed'))
    expect(test.lifecycle.releasingIds.has(id)).toBe(false)
  })
})

describe('SessionController idle release wiring', () => {
  const defaults = {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    cwd: '/tmp',
  }

  it('keeps a released Session listed instead of removing it', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([]),
    }) as never)
    createSessionTestController(ctx, defaults)
    const added = vi.fn()
    const removed = vi.fn()
    ctx.on('api-session/added', added)
    ctx.on('api-session/removed', removed)

    const released = ctx.sessions.prepare(SessionId('released'), { meta: { cwd: '/workspace' } })
    const detachReleased = ctx.sessions.enter(released)
    ctx.sessions.announce(released)
    added.mockClear()
    ctx.sessionLifecycle?.releasingIds.add(released.id)
    detachReleased()
    ctx.sessionLifecycle?.releasingIds.delete(released.id)
    expect(removed).not.toHaveBeenCalled()
    expect(added).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: released.id, agentAvailable: false, running: false,
    }))

    const removedSession = ctx.sessions.prepare(SessionId('removed'), { meta: { cwd: '/workspace' } })
    const detachRemoved = ctx.sessions.enter(removedSession)
    ctx.sessions.announce(removedSession)
    detachRemoved()
    expect(removed).toHaveBeenCalledWith(removedSession.id)
    await ctx.fiber.dispose()
  })

  it('marks a followed Session as watched until its stream closes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const sessionId = SessionId('followed')
    const header: SessionHeader = {
      version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd: '/workspace', isSeeded: false,
    }
    ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
      list: () => Promise.resolve([header]),
      inspect: () => Promise.resolve({ meta: header, inheritedEventCount: SessionLogOffset(0), events: [] }),
    }) as never)
    const unwatch = vi.fn()
    const watch = vi.spyOn(IdleSessionRelease.prototype, 'watch').mockReturnValue(unwatch)
    const controller = createSessionTestController(ctx, defaults)
    const agents = (controller as unknown as { agents: ApiSessionAgentController }).agents
    vi.spyOn(agents, 'resolveObservedAgent').mockResolvedValue({
      agent: { id: sessionId, session: { id: sessionId }, ctx, status: 'idle' } as unknown as Agent,
    })
    const abort = new AbortController()
    const iterator = controller.follow({ address: { kind: 'session', sessionId } }, abort.signal)[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: 'snapshot' } })
    expect(watch).toHaveBeenCalledWith(sessionId)
    expect(unwatch).not.toHaveBeenCalled()
    const waiting = iterator.next()
    abort.abort()
    await expect(waiting).resolves.toMatchObject({ done: true })
    expect(unwatch).toHaveBeenCalledOnce()
    watch.mockRestore()
    await ctx.fiber.dispose()
  })
})
