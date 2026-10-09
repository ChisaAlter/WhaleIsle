import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import { describe, expect, it, vi } from 'vitest'
import { SessionFileReferences } from '../src/file-references.ts'

describe('SessionFileReferences', () => {
  it('delegates the resolved Agent, query, and cancellation signal unchanged', async () => {
    const ctx = new Context()
    const candidates: FileReferenceCandidate[] = [{ path: 'src', kind: 'directory' }]
    const list = vi.fn(() => Promise.resolve(candidates))
    ctx.provide('fileReferences', { list } as never)
    const adapter = new SessionFileReferences(ctx)
    const agent = { id: 'target', session: { snapshotEvents: () => [] } } as unknown as Agent
    const signal = new AbortController().signal

    await expect(adapter.list(agent, 'sr', signal)).resolves.toBe(candidates)
    expect(list).toHaveBeenCalledWith(agent, 'sr', signal)
  })

  it('uses only a registered user directory for presentation-bound discovery', async () => {
    const ctx = new Context()
    const list = vi.fn().mockResolvedValue([{ path: 'README.md', kind: 'file' }])
    ctx.provide('fileReferences', { list } as never)
    const adapter = new SessionFileReferences(ctx)
    const agent = { session: { snapshotEvents: () => [{ type: 'session/presentation', data: { owner: 'project', title: 'Project', workingDirectory: '/user/project' } }] } } as unknown as Agent
    const signal = new AbortController().signal
    await expect(adapter.list(agent, '', signal)).resolves.toEqual([])
    expect(list).not.toHaveBeenCalled()
    ctx.provide('workspaceRegistry', { list: () => [{ path: '/user/project' }] } as never)
    await expect(adapter.list(agent, '', signal)).resolves.toEqual([{ path: 'README.md', kind: 'file' }])
    expect(list).toHaveBeenCalledWith(agent, '', signal, '/user/project')
    await ctx.fiber.dispose()
  })
})
