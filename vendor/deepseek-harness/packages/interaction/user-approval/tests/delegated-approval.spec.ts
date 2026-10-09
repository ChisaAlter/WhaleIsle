import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import ApprovalService from '../src/index.ts'
import type { ApprovalOutcome, ApprovalRequestEvent } from '../src/types.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(ApprovalService)
  const ownerId = SessionId('lead'), childId = SessionId('member')
  const owner = { id: ownerId, session: Session.create(ownerId), inject: vi.fn() } as unknown as Agent
  const session = Session.create(childId, undefined, {
    version: SESSION_FORMAT_VERSION, id: childId, createdAt: 0, isSeeded: false,
    origin: 'subagent', parentSession: ownerId, cwd: 'C:\\project',
  })
  const child = { id: childId, session, inject: vi.fn() } as unknown as Agent
  session.append('approval/policy', { policy: 'never', source: 'delegation' })
  session.append('sandbox/mode', { mode: 'workspace-write', source: 'delegation' })
  session.append('turn/start', { turn: 1 })
  const callId = ToolCallId('actual-command')
  session.append('tool/call', { turn: 1, step: 1, callId, name: 'pwsh', arguments: '{"command":"node --test","workdir":"src"}' })
  const request = { agent: child, callId, toolName: 'pwsh' }
  return { ctx, owner, child, session, request }
}

describe('managed delegated approval', () => {
  it('preserves default never, then routes an explicitly enabled request to the parent while auditing only the child', async () => {
    const { ctx, owner, child, session, request } = await setup()
    const heard: ApprovalRequestEvent[] = []
    ctx.on('approval/request', async req => { heard.push(req); return 'allowed-once' })
    expect(await ctx.approval.request({ ...request, callId: ToolCallId('ordinary') })).toBe('rejected')
    expect(heard).toEqual([])
    expect(ctx.approval.enableDelegatedRequests(child, owner)).toBe(true)
    const release = ctx.approval.bindDelegatedRequester(child, { owner, label: 'Build proof', validate: () => true })
    expect(await ctx.approval.request(request)).toBe('allowed-once')
    expect(heard[0]).toMatchObject({ agent: owner, requester: {
      sessionId: child.id, label: 'Build proof', cwd: 'C:\\project',
      call: { callId: request.callId, name: 'pwsh', arguments: '{"command":"node --test","workdir":"src"}' },
    } })
    expect(owner.session.snapshotEvents()).toEqual([])
    expect(session.snapshotEvents().filter(event => event.type === 'approval/decided').map(event => event.data.outcome)).toEqual(['rejected', 'allowed-once'])
    expect(session.snapshotEvents().filter(event => event.type === 'sandbox/mode')).toHaveLength(1)
    release()
    await ctx.fiber.dispose()
  })

  it('does not overwrite explicit never even when it matches the previous delegated value', async () => {
    const { ctx, owner, child, request } = await setup()
    ctx.approval.setPolicy(child, 'never')
    expect(ctx.approval.enableDelegatedRequests(child, owner)).toBe(false)
    ctx.approval.bindDelegatedRequester(child, { owner, label: 'Task', validate: () => true })
    const listener = vi.fn(async (): Promise<ApprovalOutcome> => 'allowed-once')
    ctx.on('approval/request', listener)
    expect(await ctx.approval.request(request)).toBe('rejected')
    expect(listener).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('requires a current route after restoring an enabled child', async () => {
    const { ctx, owner, child, request } = await setup()
    ctx.approval.enableDelegatedRequests(child, owner)
    expect(await ctx.approval.request(request)).toBe('unavailable')
    expect(() => ctx.approval.captureExecution(child, new AbortController().signal)).toThrow('route is unavailable')
    await ctx.fiber.dispose()
  })

  it.each(['release', 'parent-never', 'assignment'] as const)('withdraws or rejects a late grant after %s', async change => {
    const { ctx, owner, child, session, request } = await setup()
    ctx.approval.enableDelegatedRequests(child, owner)
    let current = true
    const release = ctx.approval.bindDelegatedRequester(child, { owner, label: 'Task', validate: () => current })
    const scope = ctx.approval.captureExecution(child, new AbortController().signal)!
    const seen = Promise.withResolvers<ApprovalRequestEvent>(), answer = Promise.withResolvers<ApprovalOutcome>()
    ctx.on('approval/request', req => { seen.resolve(req); return answer.promise })
    const result = ctx.approval.request(request)
    const presented = await seen.promise
    if (change === 'release') release()
    else if (change === 'parent-never') ctx.approval.setPolicy(owner, 'never')
    else current = false
    answer.resolve('allowed-once')
    expect(await result).toBe('cancelled')
    expect(() => scope.assertCurrent()).toThrow()
    if (change !== 'assignment') expect(presented.signal?.aborted).toBe(true)
    expect(session.snapshotEvents().at(-1)).toMatchObject({ type: 'approval/decided', data: { outcome: 'cancelled' } })
    await ctx.fiber.dispose()
  })
})
