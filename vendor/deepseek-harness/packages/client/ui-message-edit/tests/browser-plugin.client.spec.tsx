// @vitest-environment jsdom
/**
 * ui-message-edit browser half on a real cordis Context with fake slots/
 * sessions/conversation faces: the plugin registers the pencil at
 * conversation.chat.user-actions and the editor at conversation.chat.user-editor;
 * the inject beginEdit verb starts a composer edit session on the source
 * Session's input facade whose redirected sink re-checks latest-and-idle,
 * sends text plus images through the same scoped conversation service;
 * a beginEdit refusal notifies on the source composer; endEdit
 * cancels only its own live session; registration rides the plugin fiber
 * (HMR safety). The node half is exercised over the same Context.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { InputEditSpec } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageEditInjected } from '../src/client/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = (k: string): SessionId => k as SessionId

interface SnapshotLike {
  readonly nodes: readonly { kind: string; seq: number }[]
  readonly running: boolean
}

/** Boot the plugin over fake faces; sessions/conversation record every call. */
async function bench(options: {
  /** The source session's transcript state at confirm time. */
  snapshot?: SnapshotLike
  /** Force the source composer to refuse beginEdit. */
  refuse?: boolean
} = {}) {
  const ctx = new Context()
  const calls: { method: string; args: unknown[] }[] = []
  const drafts: Array<{ sessionId: string; text: string }> = []
  const images: Array<{ sessionId: string; ids: readonly string[] }> = []
  const submits: string[] = []
  const notices: Array<{ sessionId: string; message: string }> = []
  const cancels: string[] = []
  const focused: string[] = []
  /** The live edit spec per session, as the fake composer machine holds it. */
  const edits = new Map<string, InputEditSpec>()

  const snapshot = options.snapshot ?? { nodes: [{ kind: 'user', seq: 7 }], running: false }

  const sessions = {
    fork: vi.fn(async (opts: { sessionId: SessionId; beforeSeq?: number }) => {
      calls.push({ method: 'fork', args: [opts] })
      return 'child-1'
    }),
    open: vi.fn((id: SessionId) => { calls.push({ method: 'open', args: [id] }) }),
    scope: vi.fn((id: SessionId) => ({ sessionId: id })),
    binding: vi.fn((_id: SessionId) => ({
      session: { getSnapshot: () => snapshot },
      eventSource: {
        getSnapshot: () => ({
          entries: snapshot.nodes
            .filter((node) => node.kind === 'user')
            .flatMap((node) => [
              { type: 'event' as const, event: { type: 'turn/start', seq: node.seq - 1 } },
              { type: 'event' as const, event: { type: 'user/message', seq: node.seq, data: { source: { kind: 'user' } } } },
            ]),
        }),
      },
    })),
  }
  ctx.provide('sessions', sessions)

  const conversation = {
    edit: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'edit', args })
      return { kind: 'success' as const }
    }),
    input: {
      for: vi.fn((scope: { sessionId: SessionId }) => ({
        focus: () => { focused.push(scope.sessionId) },
        beginEdit: (spec: InputEditSpec) => {
          if (options.refuse === true) return false
          edits.set(scope.sessionId, spec)
          return true
        },
        cancelEdit: () => {
          cancels.push(scope.sessionId)
          edits.delete(scope.sessionId)
        },
        state: {
          getSnapshot: () => {
            const spec = edits.get(scope.sessionId)
            return { edit: spec === undefined ? undefined : { key: spec.key, label: spec.label } }
          },
        },
        addAttachments: (ids: readonly string[]) => { images.push({ sessionId: scope.sessionId, ids }) },
        setDraft: (text: string) => { drafts.push({ sessionId: scope.sessionId, text }) },
        submit: () => { submits.push(scope.sessionId) },
        notify: (level: 'info' | 'error', message: string) => {
          notices.push({ sessionId: scope.sessionId, message: `${level}:${message}` })
        },
      })),
    },
  }
  ctx.provide('conversation', conversation)
  sessions.scope.mockImplementation((id: SessionId) => ({
    sessionId: id,
    get: (name: string) => name === 'conversation' ? conversation : undefined,
    get conversation(): never { throw new Error('cannot get property "conversation" without inject') },
  }))

  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'conversation.chat.user-actions': { kind: 'list', scope: 'session' },
      'conversation.chat.user-editor': { kind: 'single', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  return {
    ctx,
    fiber,
    calls,
    drafts,
    images,
    submits,
    notices,
    cancels,
    focused,
    edits,
    sessions,
    conversation,
    action: () => {
      const entry = ctx.slots.entries('conversation.chat.user-actions')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        store: entry.store,
      }
    },
    editor: () => {
      const entry = ctx.slots.entries('conversation.chat.user-editor')[0]
      if (entry === undefined) return undefined
      return {
        ...entry.options,
        locale: entry.locale,
        store: entry.store,
        inject: entry.inject as unknown as ((sessionId: SessionId) => MessageEditInjected) | undefined,
      }
    },
  }
}

const SIGNAL = new AbortController().signal

describe('ui-message-edit browser plugin', () => {
  it('registers the pencil and the editor with the documented ids and locale', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.action()).toMatchObject({ id: 'edit', order: 10, locale: 'messageEdit' })
    expect(b.editor()).toMatchObject({ locale: 'messageEdit' })
    expect(b.editor()?.inject).toBeTypeOf('function')
  })

  it('shares one interaction store handle between the pencil and the editor', async () => {
    const b = await bench()
    await b.fiber.await()

    expect(b.action()?.store).toBeDefined()
    expect(b.action()?.store).toBe(b.editor()?.store)
  })

  it('beginEdit starts a composer edit session with this message key, banner label, and text seed', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    expect(face.beginEdit(7, 'original prompt')).toBe(true)

    const spec = b.edits.get('s1')!
    expect(spec).toMatchObject({ key: 'message-edit:7', label: en['editor.banner'], seed: 'original prompt' })
    expect(b.notices).toHaveLength(0)
    expect(b.focused).toEqual(['s1'])
    // The pencil never forks: only the composer's confirm does.
    expect(b.sessions.fork).not.toHaveBeenCalled()
  })

  it('the redirected sink edits in the current session without forking or switching', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    const outcome = await b.edits.get('s1')!.submit('revised prompt', ['img-1'] as never, SIGNAL)

    expect(outcome).toEqual({ kind: 'success' })
    expect(b.calls).toEqual([
      { method: 'edit', args: [7, 'revised prompt', ['img-1'], SIGNAL] },
    ])
    expect(b.sessions.fork).not.toHaveBeenCalled()
    expect(b.sessions.open).not.toHaveBeenCalled()
  })

  it('also keeps the session when editing its first message', async () => {
    const b = await bench({ snapshot: { nodes: [{ kind: 'user', seq: 1 }], running: false } })
    await b.fiber.await()
    b.editor()!.inject!(sid('s1')).beginEdit(1, 'first prompt')
    expect(await b.edits.get('s1')!.submit('revised first', [], SIGNAL)).toEqual({ kind: 'success' })
    expect(b.conversation.edit).toHaveBeenCalledWith(1, 'revised first', [], SIGNAL)
    expect(b.sessions.fork).not.toHaveBeenCalled()
    expect(b.sessions.open).not.toHaveBeenCalled()
  })

  it('skips the image handoff when the revision carries none', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    await b.edits.get('s1')!.submit('revised prompt', [], SIGNAL)

    expect(b.images).toHaveLength(0)
    expect(b.conversation.edit).toHaveBeenCalledWith(7, 'revised prompt', [], SIGNAL)
  })

  it('refuses the confirm when a newer user message arrived, without forking', async () => {
    const b = await bench({ snapshot: { nodes: [{ kind: 'user', seq: 7 }, { kind: 'user', seq: 9 }], running: false } })
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    const outcome = await b.edits.get('s1')!.submit('revised', [], SIGNAL)

    expect(outcome).toEqual({ kind: 'error', text: en['editor.hint.stale'] })
    expect(b.sessions.fork).not.toHaveBeenCalled()
  })

  it('refuses the confirm while the source session is running, without forking', async () => {
    const b = await bench({ snapshot: { nodes: [{ kind: 'user', seq: 7 }], running: true } })
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    const outcome = await b.edits.get('s1')!.submit('revised', [], SIGNAL)

    expect(outcome).toEqual({ kind: 'error', text: en['editor.hint.running'] })
    expect(b.sessions.fork).not.toHaveBeenCalled()
  })

  it('returns the generic error when edit rejects, keeping the edit armed', async () => {
    const b = await bench()
    await b.fiber.await()
    b.conversation.edit.mockRejectedValue(new Error('edit-unavailable'))

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    const outcome = await b.edits.get('s1')!.submit('revised', [], SIGNAL)

    expect(outcome).toEqual({ kind: 'error', text: en['error.generic'] })
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.drafts).toHaveLength(0)
    expect(b.submits).toHaveLength(0)
    // The composer machine still holds the session — the operator retries or cancels.
    expect(b.edits.has('s1')).toBe(true)
  })

  it('returns the generic error when the current scope cannot be resolved', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    b.sessions.scope.mockReturnValue(undefined as never)
    const outcome = await b.edits.get('s1')!.submit('revised', [], SIGNAL)

    expect(outcome).toEqual({ kind: 'error', text: en['error.generic'] })
    expect(b.sessions.open).not.toHaveBeenCalled()
    expect(b.submits).toHaveLength(0)
  })

  it('refuses to send when the current binding is gone', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    // A dropped binding must not redirect the revision into another session.
    b.sessions.binding.mockReturnValue(undefined as never)
    const outcome = await b.edits.get('s1')!.submit('revised', [], SIGNAL)

    expect(outcome).toEqual({ kind: 'error', text: en['error.generic'] })
    expect(b.conversation.edit).not.toHaveBeenCalled()
  })

  it('beginEdit fails loud when the source session scope cannot be resolved', async () => {
    const b = await bench()
    await b.fiber.await()
    b.sessions.scope.mockReturnValue(undefined as never)

    const face = b.editor()!.inject!(sid('s1'))
    expect(() => face.beginEdit(7, 'original prompt')).toThrow(/scope unavailable/)
    expect(b.sessions.fork).not.toHaveBeenCalled()
  })

  it('a beginEdit refusal notifies on the source composer and returns false', async () => {
    const b = await bench({ refuse: true })
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    expect(face.beginEdit(7, 'original prompt')).toBe(false)

    expect(b.notices).toEqual([{ sessionId: 's1', message: `error:${en['error.busy']}` }])
    expect(b.focused).toEqual([])
  })

  it('endEdit cancels its own live session and leaves a foreign one alone', async () => {
    const b = await bench()
    await b.fiber.await()

    const face = b.editor()!.inject!(sid('s1'))
    face.beginEdit(7, 'original prompt')
    // A different message's endEdit is a no-op on this live session.
    face.endEdit(9)
    expect(b.cancels).toHaveLength(0)
    face.endEdit(7)
    expect(b.cancels).toEqual(['s1'])
    // Nothing live any more: a repeat endEdit stays a no-op.
    face.endEdit(7)
    expect(b.cancels).toEqual(['s1'])
  })

  it('withdraws both registrations with the plugin fiber', async () => {
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    expect(b.ctx.slots.entries('conversation.chat.user-actions')).toHaveLength(0)
    expect(b.ctx.slots.entries('conversation.chat.user-editor')).toHaveLength(0)
  })

  it('re-registers cleanly when the plugin is reloaded', async () => {
    const b = await bench()
    await b.fiber.await()
    await b.fiber.dispose()

    const reloaded = b.ctx.plugin({ inject: [...inject], apply })
    await reloaded.await()

    expect(b.ctx.slots.entries('conversation.chat.user-actions')).toHaveLength(1)
    expect(b.ctx.slots.entries('conversation.chat.user-editor')).toHaveLength(1)
    expect(b.action()).toMatchObject({ id: 'edit' })
  })

  it('the node half applies without host-side behavior', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
