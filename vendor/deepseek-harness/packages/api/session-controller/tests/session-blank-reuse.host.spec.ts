/** Read-only blank-session reuse eligibility for attached and persisted logs. */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import {
  ToolCallId,
  createAssistantMessage,
  createMessage,
  createSystemMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createSessionTestRemote, testSessionPersistence, type TestSessionRemote } from './test-remote.ts'

const sid = (id: string): SessionId => id as SessionId

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function header(id: string, extra: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: sid(id),
    createdAt: 1,
    cwd: '/workspace',
    isSeeded: false,
    ...extra,
  }
}

function blankReuse(
  remote: TestSessionRemote,
  sessionId: SessionId,
  signal?: AbortSignal,
): ReturnType<TestSessionRemote['blankReuse']> {
  return remote.blankReuse({ sessionId }, signal)
}

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, {
      defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
      cwd: '/workspace',
    }),
  }
}

async function durableFiles(root: string): Promise<readonly [string, string][]> {
  const names = (await readdir(root, { recursive: true })).filter(name => /\.jsonl(?:\.zstd)?$/u.test(name)).sort()
  return Promise.all(names.map(async name => [name, (await readFile(join(root, name))).toString('base64')] as [string, string]))
}

function providePersistence(ctx: Context, persistence: Record<string, unknown>): void {
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, persistence) as never)
}

function event(type: string, data: unknown, seq = 0, extra: Record<string, unknown> = {}): SessionEvent {
  return { type, data, seq: SessionSeq(seq), time: seq + 1, ...extra } as SessionEvent
}

describe('session.blankReuse', () => {
  it('rejects the exact bot presentation, title, and release sequence', async () => {
    const { ctx, remote } = await harness()
    const session = ctx.sessions.create(sid('bot-title-release'), { meta: header('bot-title-release') })
    session.append('session/presentation', { owner: 'bot', title: 'Bot name' })
    session.append('session/title', {
      title: 'Pinned user title',
      messageSeqs: [],
      source: { kind: 'user' },
    } as never)
    session.append('session/presentation', null)

    await expect(blankReuse(remote, session.id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it('keeps released plugin ownership sticky even when no title was written', async () => {
    const { ctx, remote } = await harness()
    const session = ctx.sessions.create(sid('released-untitled'), { meta: header('released-untitled') })
    session.append('session/presentation', { owner: 'bot', title: 'Untitled owner' })
    session.append('session/presentation', null)

    await expect(blankReuse(remote, session.id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it('allows an isolated null presentation without any previous identity', async () => {
    const { ctx, remote } = await harness()
    const session = ctx.sessions.create(sid('null-only'), { meta: header('null-only') })
    session.append('session/presentation', null)
    await expect(blankReuse(remote, session.id)).resolves.toEqual({ ok: true, value: { reusable: true } })
  })

  it.each(['next-turn', 'next-step'] as const)('rejects input staged in the %s inbox before a turn', async (target) => {
    const { ctx, remote } = await harness()
    const session = ctx.sessions.create(sid(`pending-${target}`), { meta: header(`pending-${target}`) })
    session.append('agent/inbox/spliced', {
      target, start: 0,
      inserted: [createUserMessage({ content: [{ type: 'text', text: 'Existing work' }], source: { kind: 'user' } })],
    })
    await expect(blankReuse(remote, session.id)).resolves.toEqual({ ok: true, value: { reusable: false } })
    expect(session.snapshotEvents().some(item => item.type === 'turn/start')).toBe(false)
  })

  it.each([
    ['goal/change', { kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'goal-1', revision: 1 }, clearedAt: 1 }],
    ['schedule/change', {
      version: 1, operation: 'create',
      schedule: { id: 'schedule-1', kind: 'after', prompt: 'Existing reminder', afterSeconds: 1, scheduledAt: '1970-01-01T00:00:01.001Z' },
    }],
  ] as const)('does not repurpose durable pre-turn %s work', async (type, data) => {
    const { ctx, remote } = await harness()
    const id = sid(type.replace('/', '-'))
    const meta = header(id)
    // Optional domain payloads remain opaque to the Session query reader. The
    // durable domain event itself certifies prior work, even after it is cleared.
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [event(type, data)] }),
    })
    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it('rejects cold inbox history even after its queued input was canceled', async () => {
    const { ctx, remote } = await harness()
    const id = sid('cold-inbox')
    const meta = header(id)
    const message = createUserMessage({ content: [{ type: 'text', text: 'Prior input' }], source: { kind: 'user' } })
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [
        event('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] }),
        event('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' }, 1),
      ] }),
    })
    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
    expect(ctx.sessions.get(id)).toBeUndefined()
  })

  it('accepts ordinary no-turn configuration without activating or writing', async () => {
    const { ctx, remote } = await harness()
    const id = sid('cold-config')
    const meta = header('cold-config')
    const events = [
      event('model/selection', { provider: 'fixture', model: 'fixture-model' }),
      event('permission/preset', { preset: 'danger-full-access' }, 1),
      event('plan/mode', { active: true }, 2),
    ]
    const inspect = vi.fn(async () => ({ meta, events }))
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect,
    })
    const resume = vi.spyOn(ctx.agents, 'resume')

    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: true } })
    expect(inspect).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.sessions.get(id)).toBeUndefined()
  })

  it.each([
    ['turn', [event('turn/start', { turn: 1 })]],
    ['user', [event('user/message', createUserMessage({ content: [{ type: 'text', text: 'old' }], source: { kind: 'user' } }), 0, { surfaceOp: 'append' })]],
    ['assistant', [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }, 1),
      event('assistant/message', {
        turn: 1, step: 1,
        message: createAssistantMessage({ content: [{ type: 'text', text: 'old' }], source: { provider: 'fixture', model: 'fixture-model' } }),
        stream: [],
      }, 2, { surfaceOp: 'append' }),
    ]],
    ['system', [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }, 1),
      event('system/message', { turn: 1, step: 1, message: createSystemMessage('old') }, 2, { surfaceOp: 'append' }),
    ]],
    ['tool', [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }, 1),
      event('assistant/message', {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'tool-call', id: ToolCallId('old-call'), name: 'fixture', arguments: '{}' }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture-model' },
        }),
        stream: [],
      }, 2, { surfaceOp: 'append' }),
      event('tool/call', { turn: 1, step: 1, callId: ToolCallId('old-call'), name: 'fixture', arguments: '{}' }, 3),
      event('tool/result', {
        turn: 1, step: 1,
        message: createToolResultMessage({ callId: ToolCallId('old-call'), content: [{ type: 'text', text: 'old' }], isError: false }),
      }, 4, { surfaceOp: 'append', sourceEventSeqs: [SessionSeq(3)] }),
    ]],
    ['title', [event('session/title', { title: 'old', messageSeqs: [], source: { kind: 'fallback' } })]],
    ['presentation', [event('session/presentation', { owner: 'bot', title: 'owned' })]],
  ])('rejects %s history', async (_name, events) => {
    const { ctx, remote } = await harness()
    const id = sid(`history-${_name}`)
    const meta = header(id)
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events }),
    })

    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it.each([
    ['parent', { parentSession: sid('parent') }],
    ['seeded', { isSeeded: true }],
    ['subagent', { origin: 'subagent' as const }],
  ])('rejects %s identities', async (_name, extra) => {
    const { ctx, remote } = await harness()
    const id = sid(`identity-${_name}`)
    const meta = header(id, extra)
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => Promise.resolve({ meta, events: [] }),
    })

    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it('rejects a valid inherited seed prefix', async () => {
    const { ctx, remote } = await harness()
    const id = sid('inherited')
    const seededMeta = header(id, { isSeeded: true })
    providePersistence(ctx, {
      list: () => Promise.resolve([seededMeta]),
      inspect: () => Promise.resolve({
        meta: seededMeta,
        inheritedEventCount: SessionLogOffset(1),
        events: [event('session/end-seed', {})],
      }),
    })

    await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
  })

  it('returns false for a missing session and preserves read failures', async () => {
    const { ctx, remote } = await harness()
    const failure = new Error('corrupt log')
    providePersistence(ctx, {
      list: () => Promise.resolve([header('broken')]),
      inspect: (id: SessionId) => id === sid('broken') ? Promise.reject(failure) : Promise.resolve(undefined),
    })
    await expect(blankReuse(remote, sid('missing'))).resolves.toEqual({ ok: true, value: { reusable: false } })

    const result = await blankReuse(remote, sid('broken'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatchObject({ code: 'gateway/internal' })
  })

  it('honors cancellation before and after an async read', async () => {
    const { ctx, remote } = await harness()
    const controller = new AbortController()
    controller.abort()
    await expect(blankReuse(remote, sid('cancelled'), controller.signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'gateway/cancelled' },
    })

    const gate = Promise.withResolvers<{ meta: SessionHeader; events: readonly SessionEvent[] }>()
    providePersistence(ctx, {
      list: () => Promise.resolve([header('cancelled-after')]),
      inspect: () => gate.promise,
    })
    const after = new AbortController()
    const pending = blankReuse(remote, sid('cancelled-after'), after.signal)
    after.abort()
    gate.resolve({ meta: header('cancelled-after'), events: [] })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'gateway/cancelled' } })
  })

  it('uses the fresh attached snapshot when activity wins an async cold read', async () => {
    const { ctx, remote } = await harness()
    const id = sid('attached-race')
    const meta = header(id)
    const gate = Promise.withResolvers<{ meta: SessionHeader; events: readonly SessionEvent[] }>()
    providePersistence(ctx, {
      list: () => Promise.resolve([meta]),
      inspect: () => gate.promise,
    })
    const pending = blankReuse(remote, id)
    const attached = ctx.sessions.create(id, { meta })
    attached.append('turn/start', { turn: 1 })
    gate.resolve({ meta, events: [] })

    await expect(pending).resolves.toEqual({ ok: true, value: { reusable: false } })
    expect(attached.snapshotEvents()).toHaveLength(1)
  })

  it.each(['none', 'zstd'] as const)('reads real %s JSONL history after remount without activation or writes', async (compression) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-blank-reuse-'))
    const id = sid('jsonl-bot-title-release')
    try {
      const writerCtx = new Context()
      await writerCtx.plugin(SessionStore)
      await writerCtx.plugin(JsonlSessionPersistence, { root, compression })
      const meta = header(String(id))
      const handle = await writerCtx.sessionPersistence.create(meta)
      await handle.append([
        event('session/presentation', { owner: 'bot', title: 'Bot title' }),
        event('session/title', { title: 'User title', messageSeqs: [], source: { kind: 'user' } }, 1),
        event('session/presentation', null, 2),
      ])
      await handle.flush()
      await handle.close()
      await writerCtx.fiber.dispose()

      const before = await durableFiles(root)
      expect(before.length).toBeGreaterThan(0)
      const readerCtx = new Context()
      await readerCtx.plugin(SessionStore)
      await readerCtx.plugin(AgentRegistry)
      await readerCtx.plugin(JsonlSessionPersistence, { root, compression })
      const resume = vi.spyOn(readerCtx.agents, 'resume')
      const remote = createSessionTestRemote(readerCtx, {
        defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
        cwd: '/workspace',
      })

      await expect(blankReuse(remote, id)).resolves.toEqual({ ok: true, value: { reusable: false } })
      expect(resume).not.toHaveBeenCalled()
      expect(readerCtx.sessions.get(id)).toBeUndefined()
      await expect(durableFiles(root)).resolves.toEqual(before)
      await readerCtx.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
