/**
 * The frame-wide quota notice host: a live Chat failure publishes one notice
 * that outlives the Chat panel, and history scrollback never does.
 */
// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { afterEach, describe, expect, it } from 'vitest'
import { act, screen } from '@testing-library/react'
import { SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionLiveEventEntry, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import {
  apply as applyConversation, inject as injectConversation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyChat, inject as injectChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { QuotaNoticeInjected } from '@deepseek-ai/dsh-client-ui-chat/client'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { CHAT_SETTINGS_NAMESPACE, type ChatSettings } from '../src/chat-settings.ts'

usePinnedBrowserLanguages('en')

const SID = 'session-1' as SessionId
const disposers: Array<() => Promise<void>> = []
const references: SessionReference[] = []

afterEach(async () => {
  // Held references keep their binding — and so its Chat source subscription —
  // alive for the whole case. Release is idempotent, so a case may release too.
  for (const reference of references.splice(0)) reference.release()
  for (const dispose of disposers.splice(0).reverse()) await dispose()
})

/** One live `turn/end` failure entry for a session event window. */
const quotaEntry = (seq: number, code: string, turn = 0): SessionLiveEventEntry => ({
  type: 'event', event: {
    type: 'turn/end', seq: seq as SessionSeq, time: seq,
    data: { turn, reason: { kind: 'error', error: { code, message: 'balance' } } },
  },
})

/** The durable replacement emitted after Host edit admission, not an ordinary append. */
const editEntry = (seq: number, turn: number): SessionLiveEventEntry => ({
  type: 'event', event: {
    type: 'user/message', seq: seq as SessionSeq, time: seq,
    data: createUserMessage({ content: [{ type: 'text', text: 'edited prompt' }], source: {
      kind: 'user', edit: { messageSeq: 0, turn },
    } }),
    surfaceOp: { op: 'replace', startSeq: 0 as SessionSeq, endSeq: 0 as SessionSeq },
    sourceEventSeqs: [0 as SessionSeq],
  },
})

/** One ordinary surface message, including the prompt targeted by an edit. */
const promptEntry = (seq: number): SessionLiveEventEntry => ({
  type: 'event', event: {
    type: 'user/message', seq: seq as SessionSeq, time: seq,
    data: createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }),
    surfaceOp: 'append',
  },
})

/**
 * Mount the real Conversation and Chat plugins over a runtime whose root frame
 * renders the frame-wide `shell.overlay` seat.
 * @returns the runtime, plugin handles, and the Chat standard-source descriptor.
 */
async function bench() {
  const runtime = await SlotTestRuntime.create()
  disposers.push(() => runtime.dispose())
  await runtime.mount({ apply: installConnection })
  const chatSettings = stubConfigForm<ChatSettings>()
  runtime.ctx.provide('configForms', {
    developerTools: { enabled: createSnapshotStore(true) },
    get: (namespace: string) => namespace === CHAT_SETTINGS_NAMESPACE ? chatSettings.scope : stubConfigForm().scope,
  } as never)
  runtime.ctx.provide('layout', { openRightbar: () => {}, closeRightbar: () => {} } as never)
  runtime.ctx.provide('sidebarRight', { openResource: () => {}, openTab: () => {} } as never)
  runtime.ctx.provide('sidebarRightTabs', {
    register: () => () => {}, get: () => ({}), subscribe: () => () => {},
  } as never)
  runtime.ctx.provide('resources', { register: () => () => {} } as never)
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: async (_workspaceId: WorkspaceId, beforeOpen: (id: SessionId) => void) => { beforeOpen(SID) },
    openSession: () => {},
  } as never)
  runtime.remote.provideNamespaces({ session: { openWorkspacePath: async () => ({ ok: true, value: { opened: true } }) } })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  await runtime.declare({
    'shell.overlay': { kind: 'list', scope: 'root' },
    'conversation.approval.detail': { kind: 'single', scope: 'session' },
  })
  const conversation = await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  let descriptor: Parameters<typeof runtime.ctx.uiSession.provide>[0] | undefined
  const provide = runtime.ctx.uiSession.provide.bind(runtime.ctx.uiSession)
  runtime.ctx.uiSession.provide = (next) => { descriptor ??= next; return provide(next) }
  const chat = await runtime.mount({ inject: [...injectChat], apply: applyChat })
  if (descriptor === undefined) throw new Error('ui-chat did not provide its standard source')
  return { runtime, conversation, chat, sourceDescriptor: descriptor }
}

/** The registered quota host's inject face, checked at the type-erased boundary. */
function noticeFace(runtime: SlotTestRuntime): QuotaNoticeInjected {
  const row = runtime.slots.entries('shell.overlay').find(entry => entry.options.id === 'chat.quota-notice')
  const inject: ((...args: never[]) => Record<string, unknown>) | undefined = row?.inject
  if (inject === undefined) throw new Error('ui-chat did not register the quota notice host')
  const face = inject()
  if (face.hooks === undefined || typeof face.dismissNotice !== 'function'
    || typeof face.keepNoticeOpen !== 'function') {
    throw new Error('quota notice host inject face is incomplete')
  }
  return {
    hooks: face.hooks as QuotaNoticeInjected['hooks'],
    dismissNotice: face.dismissNotice as QuotaNoticeInjected['dismissNotice'],
    keepNoticeOpen: face.keepNoticeOpen as QuotaNoticeInjected['keepNoticeOpen'],
  }
}

/** Retain one Session and subscribe the Chat source to its events. */
async function attach(runtime: SlotTestRuntime, descriptor: Awaited<ReturnType<typeof bench>>['sourceDescriptor'], sessionId = SID) {
  await runtime.sessions.add({ id: sessionId })
  const reference = runtime.sessions.retain(sessionId)
  references.push(reference)
  descriptor.resolve(reference.binding)
  return reference
}

describe('frame-wide quota notices', () => {
  it('publishes one notice per live append and republishes the latest', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const notice = noticeFace(b.runtime).hooks.notice
    expect(notice.getSnapshot()).toBeNull()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'ACCOUNT_QUOTA'))
    expect(notice.getSnapshot()).toMatchObject({ code: 'ACCOUNT_QUOTA' })
    const first = notice.getSnapshot()?.seq
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'QUOTA'))
    expect(notice.getSnapshot()).toMatchObject({ code: 'QUOTA' })
    // An unretained later notice rekeys the surface so its display restarts.
    expect(notice.getSnapshot()?.seq).not.toBe(first)
  })

  it('never publishes for history replacement or paging, or for other failures', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const notice = noticeFace(b.runtime).hooks.notice
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'QUOTA'))
    const published = notice.getSnapshot()
    expect(published).toMatchObject({ code: 'QUOTA' })
    await b.runtime.sessions.replaceEvents(SID, [quotaEntry(1, 'QUOTA')])
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.prependEvents(SID, [quotaEntry(2, 'ACCOUNT_QUOTA')])
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.appendEvent(SID, quotaEntry(3, 'AUTH'))
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.appendEvent(SID, { type: 'event', event: {
      type: 'turn/end', seq: 4 as SessionSeq, time: 4, data: { turn: 0, reason: { kind: 'completed' } },
    } })
    expect(notice.getSnapshot()).toBe(published)
  })

  it('dismisses a replaced turn notice and retires only its old holds', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const face = noticeFace(b.runtime)
    await b.runtime.sessions.appendEvent(SID, promptEntry(0))
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'ACCOUNT_QUOTA'))
    const oldRelease = face.keepNoticeOpen()
    await b.runtime.sessions.appendEvent(SID, editEntry(2, 0))
    expect(face.hooks.notice.getSnapshot()).toBeNull()

    await b.runtime.sessions.appendEvent(SID, quotaEntry(3, 'QUOTA', 1))
    const current = face.hooks.notice.getSnapshot()
    expect(current).toMatchObject({ code: 'QUOTA' })
    const activeRelease = face.keepNoticeOpen()
    oldRelease()
    expect(face.hooks.notice.getSnapshot()).toBe(current)
    await b.runtime.sessions.appendEvent(SID, quotaEntry(4, 'ACCOUNT_QUOTA', 1))
    expect(face.hooks.notice.getSnapshot()).toBe(current)
    activeRelease()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(5, 'ACCOUNT_QUOTA', 1))
    expect(face.hooks.notice.getSnapshot()).toMatchObject({ code: 'ACCOUNT_QUOTA' })
    expect(face.hooks.notice.getSnapshot()?.seq).toBeGreaterThan(current!.seq)
  })

  it('keeps a live notice during edit cancellation, ordinary sends, unrelated edits, and history loading', async () => {
    const b = await bench()
    const reference = await attach(b.runtime, b.sourceDescriptor)
    const otherId = 'session-2' as SessionId
    await attach(b.runtime, b.sourceDescriptor, otherId)
    const notice = noticeFace(b.runtime).hooks.notice
    await b.runtime.sessions.appendEvent(SID, promptEntry(0))
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'QUOTA'))
    const published = notice.getSnapshot()
    expect(published).toMatchObject({ code: 'QUOTA' })

    const conversation = reference.binding.ctx.get('conversation')
    if (conversation === undefined) throw new Error('retained Session has no Conversation service')
    const input = conversation.input.for(reference.binding.ctx)
    expect(input.beginEdit({
      key: 'message-edit:0', label: 'Edit message', seed: 'original prompt',
      submit: async () => ({ kind: 'success' }),
    })).toBe(true)
    expect(notice.getSnapshot()).toBe(published)
    input.cancelEdit()
    expect(input.state.getSnapshot().edit).toBeUndefined()
    expect(notice.getSnapshot()).toBe(published)

    await b.runtime.sessions.appendEvent(SID, promptEntry(2))
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.appendEvent(SID, editEntry(3, 9))
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.appendEvent(otherId, promptEntry(0))
    await b.runtime.sessions.appendEvent(otherId, editEntry(1, 0))
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.replaceEvents(SID, [editEntry(4, 0)])
    expect(notice.getSnapshot()).toBe(published)
    await b.runtime.sessions.prependEvents(SID, [editEntry(3, 0)])
    expect(notice.getSnapshot()).toBe(published)
  })

  it('keeps the notice on screen after the viewed Session goes away', async () => {
    const b = await bench()
    const reference = await attach(b.runtime, b.sourceDescriptor)
    // Mounting the host is what subscribes its store. The Toast it raises then
    // portals to the body, so the query is document-wide.
    b.runtime.renderSlot('shell.overlay', {})
    expect(screen.queryByRole('alert')).toBeNull()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'ACCOUNT_QUOTA'))
    // Wait for the committed notice rather than assuming the store write has
    // already reached React.
    expect((await screen.findByRole('alert')).textContent).toBe('Request quota exhausted.')
    // Switching away releases the binding and stops new notices, but the live
    // notice is host state, so it stays on screen.
    reference.release()
    expect(screen.getByRole('alert').textContent).toBe('Request quota exhausted.')
    act(() => { noticeFace(b.runtime).dismissNotice() })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retains the live notice until the takeover releases its hold', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const face = noticeFace(b.runtime)
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'ACCOUNT_QUOTA'))
    const held = face.hooks.notice.getSnapshot()
    expect(held).toMatchObject({ code: 'ACCOUNT_QUOTA' })
    const release = face.keepNoticeOpen()
    // Holding means a takeover owns the surface: neither a later account
    // failure nor a generic one may republish and remount it.
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'ACCOUNT_QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toBe(held)
    await b.runtime.sessions.appendEvent(SID, quotaEntry(2, 'QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toBe(held)
    // Releasing resumes future failures without replaying the ones skipped.
    release()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(3, 'QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toMatchObject({ code: 'QUOTA' })
    expect(face.hooks.notice.getSnapshot()?.seq).toBeGreaterThan(held!.seq)
  })

  it('suppresses nothing when a hold is acquired with no live notice', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const face = noticeFace(b.runtime)
    expect(face.hooks.notice.getSnapshot()).toBeNull()
    const release = face.keepNoticeOpen()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toMatchObject({ code: 'QUOTA' })
    // Its release clears nothing either.
    release()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'ACCOUNT_QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toMatchObject({ code: 'ACCOUNT_QUOTA' })
  })

  it('ignores a stale release that arrives after a dismissal or a newer hold', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const face = noticeFace(b.runtime)
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'ACCOUNT_QUOTA'))
    const stale = face.keepNoticeOpen()
    // Dismissal clears every hold, then the next failure publishes anew.
    face.dismissNotice()
    expect(face.hooks.notice.getSnapshot()).toBeNull()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'QUOTA'))
    const current = face.hooks.notice.getSnapshot()
    expect(current).toMatchObject({ code: 'QUOTA' })
    // The old release must not clear the notice a dismissal already cleared.
    stale()
    expect(face.hooks.notice.getSnapshot()).toBe(current)
    // Nor may it clear a hold taken on the newer notice.
    const active = face.keepNoticeOpen()
    stale()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(2, 'ACCOUNT_QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toBe(current)
    // Only its own release ends that newer hold.
    active()
    await b.runtime.sessions.appendEvent(SID, quotaEntry(3, 'QUOTA'))
    expect(face.hooks.notice.getSnapshot()).toMatchObject({ code: 'QUOTA' })
    expect(face.hooks.notice.getSnapshot()?.seq).toBeGreaterThan(current!.seq)
  })

  it('detaches its subscription when the plugin unloads with a retained binding', async () => {
    const b = await bench()
    await attach(b.runtime, b.sourceDescriptor)
    const notice = noticeFace(b.runtime).hooks.notice
    await b.runtime.sessions.appendEvent(SID, quotaEntry(0, 'QUOTA'))
    const published = notice.getSnapshot()
    expect(published).toMatchObject({ code: 'QUOTA' })
    await b.chat.dispose()
    expect(b.runtime.slots.entries('shell.overlay').some(entry => entry.options.id === 'chat.quota-notice')).toBe(false)
    // A leaked callback would still write through the detached store.
    await b.runtime.sessions.appendEvent(SID, quotaEntry(1, 'ACCOUNT_QUOTA'))
    expect(notice.getSnapshot()).toBe(published)
  })
})
