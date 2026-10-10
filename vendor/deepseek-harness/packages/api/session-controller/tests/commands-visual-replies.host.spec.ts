import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices, testSessionPersistence } from './test-remote.ts'

const HTML = '<!doctype html><button onclick="this.textContent=\'clicked\'">Interactive history</button>'

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq: SessionSeq(seq), time: seq + 1, data,
    ...type === 'tool/result' || type === 'user/message' ? { surfaceOp: 'append' } : {},
  } as SessionEvent
}

function nativeResult(ref: FileAttachmentRef, name = 'html_render', failed = false, includeFile = true): SessionEvent[] {
  const callId = ToolCallId('native-publication')
  return [
    event('tool/call', 0, { turn: 1, step: 0, callId, name, arguments: JSON.stringify({ title: 'Page', height: 120 }) }),
    event('tool/result', 1, {
      turn: 1, step: 0,
      message: createToolResultMessage({ callId,
        content: includeFile ? [{ type: 'file', attachment: ref }] : [{ type: 'text', text: 'no page' }], isError: failed }),
      meta: { visualReply: { version: 1, title: 'Page', height: 120, attachmentId: ref.attachmentId } },
    }),
  ]
}

function nestedResult(ref: FileAttachmentRef, failed = false): SessionEvent[] {
  return [
    event('tool/call', 0, { turn: 1, step: 0, callId: ToolCallId('outer'), name: 'run_code', arguments: '{}' }),
    event('tool/ptc-dispatch-start', 1, { parentCallId: 'outer', subCallId: 'nested', name: 'html_render', arguments: { title: 'Nested', height: 160 } }),
    event('tool/ptc-dispatch', 2, { parentCallId: 'outer', subCallId: 'nested', name: 'html_render', arguments: { title: 'Nested', height: 160 },
      content: [{ type: 'file', attachment: ref }], isError: failed }),
  ]
}

async function setup(records: (ref: FileAttachmentRef) => Map<string, SessionEvent[]>) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-visual-reply-read-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await ctx.plugin(SessionStore)
  await ctx.plugin(LocalAttachmentStore, { dshHome: directory })
  const ref = await ctx.attachments.saveFile({ data: Buffer.from(HTML), name: 'visual-reply.html' })
  const recordsById = records(ref)
  const headers = new Map([...recordsById.keys()].map(id => [id, {
    id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, cwd: '/workspace', isSeeded: false,
  } satisfies SessionHeader]))
  ctx.provide('sessionPersistence', testSessionPersistence(ctx, {
    list: () => Promise.resolve([...headers.values()]),
    inspect: id => {
      const meta = headers.get(String(id))
      const events = recordsById.get(String(id))
      return Promise.resolve(meta === undefined || events === undefined ? undefined : { meta, events, inheritedEventCount: SessionLogOffset(0) })
    },
  }) as never)
  installSessionReadTestServices(ctx)
  const resolveAgent = vi.fn()
  const controller = new SessionCommandController(ctx, { resolveAgent } as unknown as ApiSessionAgentController, '/workspace')
  const read = vi.spyOn(ctx.attachments, 'readFileStream')
  return { ctx, controller, ref, resolveAgent, read }
}

describe('Session-authorized Visual reply history', () => {
  it.each(['native', 'nested'])('reads a successful cold %s page from its durable file reference without activating an Agent', async mode => {
    const fixture = await setup(ref => new Map([['history', mode === 'native' ? nativeResult(ref) : nestedResult(ref)]]))
    const result = await fixture.controller.readVisualReply({ sessionId: SessionId('history'), attachmentId: fixture.ref.attachmentId })
    expect(result).toEqual({ attachment: fixture.ref, html: HTML })
    expect(result.html).toContain('onclick=')
    expect(fixture.ctx.sessions.get(SessionId('history'))).toBeUndefined()
    expect(fixture.resolveAgent).not.toHaveBeenCalled()
    expect(fixture.read).toHaveBeenCalledOnce()
  })

  it('refuses a file owned only by a different session before reading stored bytes', async () => {
    const fixture = await setup(ref => new Map([['owner', nativeResult(ref)], ['other', []]]))
    await expect(fixture.controller.readVisualReply({ sessionId: SessionId('other'), attachmentId: fixture.ref.attachmentId }))
      .rejects.toMatchObject({ code: 'session/attachment-invalid', details: { reason: 'ATTACHMENT_NOT_REFERENCED' } })
    expect(fixture.read).not.toHaveBeenCalled()
  })

  it.each(['native', 'nested'])('does not authorize a failed %s result even if it carries a durable file block', async mode => {
    const fixture = await setup(ref => new Map([['failed', mode === 'native' ? nativeResult(ref, 'html_render', true) : nestedResult(ref, true)]]))
    await expect(fixture.controller.readVisualReply({ sessionId: SessionId('failed'), attachmentId: fixture.ref.attachmentId }))
      .rejects.toMatchObject({ code: 'session/attachment-invalid' })
    expect(fixture.read).not.toHaveBeenCalled()
  })

  it.each(['metadata', 'other-tool', 'upload'])('does not authorize %s as a published Visual reply', async source => {
    const fixture = await setup(ref => new Map([['unpublished', source === 'metadata'
      ? nativeResult(ref, 'html_render', false, false)
      : source === 'other-tool' ? nativeResult(ref, 'read')
        : [event('user/message', 0, createUserMessage({ content: [{ type: 'file', attachment: ref }], source: { kind: 'user' } }))],
    ]]))
    await expect(fixture.controller.readVisualReply({ sessionId: SessionId('unpublished'), attachmentId: fixture.ref.attachmentId }))
      .rejects.toMatchObject({ code: 'session/attachment-invalid' })
    expect(fixture.read).not.toHaveBeenCalled()
  })
})
