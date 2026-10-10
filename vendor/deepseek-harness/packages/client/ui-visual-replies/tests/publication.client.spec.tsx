// @vitest-environment jsdom
/** Published pages remain reply content through replay, grouping, and plugin injection. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { Service, type Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ConversationNodeAssembler, UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode, ChatNodeInjected, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError, SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { useTurnDataValue } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/use-turn-data.ts'
import { bindDisclosure } from '@deepseek-ai/dsh-client-ui-chat/src/client/chat/use-disclosure.ts'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { processGroupDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/process-groups.ts'
import { toolDefinition } from '@deepseek-ai/dsh-client-ui-chat/src/client/conversation-nodes/tool.ts'
import { apply, inject } from '../src/client/index.ts'
import { en } from '../src/client/locale.ts'
import { visualReplyDefinition } from '../src/client/visual-reply-node.ts'
import { emulateMoveBeforeInJsdom } from './fixtures/move-before.ts'

emulateMoveBeforeInJsdom()
usePinnedBrowserLanguages('en')
const HTML = '<!doctype html><html><body><h1>Visible reply</h1></body></html>'
const FILE = { attachmentId: AttachmentId('sha256:published'), name: 'reply.html', bytes: HTML.length }
const SID = 'visual-session' as SessionId
const ROOT = ToolCallId('root')
const CHILD = ToolCallId('root:ptc:1')
const ARGS = { title: 'Recorded PTC title', height: 300, file_path: 'reply.html' }
const CONTENT = [{ type: 'text' as const, text: 'Published' }, { type: 'file' as const, attachment: FILE }]
const opening: SessionLiveEventEntry[] = [
  entry({ type: 'turn/start', seq: SessionSeq(1), time: 1, data: { turn: 1 } }),
  entry({ type: 'step/start', seq: SessionSeq(2), time: 2, data: { turn: 1, step: 1 } }),
]

function entry(event: SessionEvent): SessionLiveEventEntry { return { type: 'event', event } }

function publication(nested: boolean, error = false, recognized = true): SessionLiveEventEntry {
  if (nested) return entry({
    type: 'tool/ptc-dispatch', seq: SessionSeq(5), time: 5,
    data: {
      rootCallId: ROOT, parentCallId: ROOT, subCallId: CHILD,
      name: recognized ? 'html_render' : 'other_tool', arguments: ARGS,
      isError: error, content: CONTENT,
    },
  })
  return entry({
    type: 'tool/result', seq: SessionSeq(5), time: 5, surfaceOp: 'append',
    data: {
      turn: 1, step: 1, message: createToolResultMessage({ callId: ROOT, content: CONTENT, isError: error }),
      ...(recognized ? { meta: { visualReply: { version: 1, title: 'Published native title', height: 400 } } } : {}),
    },
  })
}

function history(nested: boolean, error = false, recognized = true): SessionLiveEventEntry[] {
  return [
    ...opening,
    entry({ type: 'tool/call', seq: SessionSeq(3), time: 3,
      data: { turn: 1, step: 1, callId: ROOT, name: nested ? 'run_code' : 'html_render', arguments: JSON.stringify(ARGS) } }),
    ...(nested ? [entry({ type: 'tool/ptc-dispatch-start', seq: SessionSeq(4), time: 4,
      data: { rootCallId: ROOT, parentCallId: ROOT, subCallId: CHILD, name: 'html_render', arguments: ARGS } })] : []),
    publication(nested, error, recognized),
    entry({ type: 'step/end', seq: SessionSeq(6), time: 6, data: { turn: 1, step: 1 } }),
    entry({ type: 'turn/end', seq: SessionSeq(7), time: 7, data: { turn: 1, reason: { kind: 'completed' } } }),
  ]
}

function assemble(entries: readonly SessionLiveEventEntry[]) {
  const assembler = new ConversationNodeAssembler(
    { entries: () => [toolDefinition, visualReplyDefinition], fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition] },
    { entries: () => [processGroupDefinition], forTarget: target => target === 'chat' ? processGroupDefinition : undefined },
  )
  assembler.replaceWindow(entries, false)
  assembler.activateTarget('chat')
  assembler.flush()
  return { assembler, snapshot: assembler.snapshot('chat') as ChatSnapshot }
}

const runtimes: SlotTestRuntime[] = []
const previousShell = Object.getOwnPropertyDescriptor(window, 'shell')
afterEach(async () => {
  cleanup()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  if (previousShell === undefined) Reflect.deleteProperty(window, 'shell')
  else Object.defineProperty(window, 'shell', previousShell)
})

describe('published visual replies', () => {
  it.each([false, true])('keeps a successful nested=%s page outside the completed tool activity', (nested) => {
    const { assembler, snapshot } = assemble(history(nested))
    const page = snapshot.nodes.values().find((node): node is ChatNode<'visual-reply'> => node.kind === 'visual-reply')!
    expect(page.data).toEqual({ file: FILE, title: nested ? ARGS.title : 'Published native title', height: nested ? 300 : 400 })
    const groups = assembler.grouped('chat')!
    expect(groups.entries).toContainEqual({ kind: 'node', key: page.key })
    const activity = groups.entries.find(item => item.kind === 'group')!
    if (activity.kind !== 'group') throw new Error('Tool activity should retain its process group')
    const group = groups.groupSource(activity.key).getSnapshot()!
    expect(group.data.closed).toBe(true)
    expect(group.members.some(member => member.key === page.key)).toBe(false)
    expect(group.members.some(member => snapshot.nodes.get(member.key)?.kind === 'tool-call')).toBe(true)
  })

  it.each([false, true])('preserves nested=%s publication when history starts at the result', (nested) => {
    const { assembler, snapshot } = assemble([publication(nested)])
    const page = snapshot.nodes.values().find(node => node.kind === 'visual-reply')!
    expect(page).toBeDefined()
    expect(assembler.grouped('chat')!.entries).toContainEqual({ kind: 'node', key: page.key })
  })

  it.each([false, true])('does not promote failed or unrecognized nested=%s records to reply pages', (nested) => {
    for (const [error, recognized] of [[true, true], [false, false]]) {
      const { snapshot } = assemble(history(nested, error, recognized))
      expect(snapshot.nodes.values().some(node => node.kind === 'visual-reply')).toBe(false)
      const tool = snapshot.nodes.values().find((node): node is ChatNode<'tool-call'> => node.kind === 'tool-call')!
      expect(tool).toBeDefined()
      const result = nested ? tool.data.root.subCalls[0]! : tool.data.root
      expect('kind' in result && result.content).toEqual(CONTENT)
    }
  })

  it.each(['ready', 'missing', 'temporary'] as const)('reads a published page through actual plugin injection (%s)', async (mode) => {
    Object.defineProperty(window, 'shell', { configurable: true, value: { visualReplyIsolation: true } })
    const runtime = await SlotTestRuntime.create()
    runtimes.push(runtime)
    const readVisualReply = vi.fn<typeof runtime.ctx.remote.session.readVisualReply>()
      .mockResolvedValue({ ok: true, value: { attachment: FILE, html: HTML } })
    if (mode === 'missing') readVisualReply.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/attachment-invalid', 'Stored attachment missing', { reason: 'ATTACHMENT_NOT_FOUND' }),
    })
    if (mode === 'temporary') readVisualReply.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('gateway/internal', 'Attachment read unavailable', {}),
    })
    // The shipped Gateway owns tracked Services in another plugin Fiber. A
    // root-owned plain TestRemote permits inherited reads and cannot prove
    // the consumer has declared both the parent and namespace injections.
    const remoteContext = runtime.ctx.isolate('remote').isolate('remote.session')
    class TrackedRemote extends Service {
      constructor(ctx: Context) { super(ctx, 'remote') }
    }
    class TrackedSessionRemote extends Service {
      readonly readVisualReply = readVisualReply
      constructor(ctx: Context) { super(ctx, 'remote.session') }
    }
    await remoteContext.plugin({ apply(ctx: Context) {
      new TrackedRemote(ctx)
      new TrackedSessionRemote(ctx)
    } }).await()
    const theme = { active: { colorScheme: 'light' } } as ThemeSnapshot
    runtime.ctx.provide('theme', { getTheme: () => theme } as never)
    runtime.ctx.provide('configForms', { get: () => stubConfigForm().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    const conversation = new UiConversation(runtime.ctx, runtime.sessions)
    conversation.events.register(toolDefinition)
    conversation.views.register(chatViewDefinition)
    conversation.groups.register(processGroupDefinition)
    await runtime.sessions.add({ id: SID, events: history(false) })
    const reference = runtime.sessions.retain(SID)
    await reference.ready
    await remoteContext.plugin({ inject: [...inject], apply }).await()
    const binding = conversation.binding(SID)
    binding.activate('chat')
    const snapshot = binding.target('chat').getSnapshot()!
    const node = snapshot.nodes.values().find((value): value is ChatNode<'visual-reply'> => value.kind === 'visual-reply')!
    const chatInject: ChatNodeInjected = {
      hooks: {
        turnData: (_standard, { turnData }) => function useTurnData(key) {
          return useTurnDataValue(turnData, key)
        },
        disclosure: (_standard, { disclosureReset }) => bindDisclosure(disclosureReset),
      },
    }
    const hookContext = {
      turnData: node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn.data : undefined,
      disclosureReset: createSnapshotStore(0),
    }
    await runtime.root.declare({
      'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: chatInject },
    }, ({ renderSlot, SessionProvider }: PropsRenderSlots<'conversation.chat.node'>) =>
      <SessionProvider session={reference}>
        {renderSlot('conversation.chat.node', {
          node, openFile: vi.fn(), openSkill: vi.fn(), inspectCall: undefined, forkAt: vi.fn(),
          loadImage: vi.fn(), renderMessageImages: () => null, fileMentions: () => undefined,
        }, { entryKey: 'visual-reply', hookContext })}
      </SessionProvider>)
    const view = runtime.renderRoot()
    if (mode === 'missing') {
      expect(await view.findByRole('alert')).toHaveProperty('textContent', en['card.loadMissing'])
      expect(view.queryByRole('button', { name: en['card.reload'] })).toBeNull()
      expect(document.querySelector('iframe')).toBeNull()
      expect(readVisualReply).toHaveBeenCalledWith({ sessionId: SID, attachmentId: FILE.attachmentId }, expect.any(AbortSignal))
      expect(readVisualReply).toHaveBeenCalledTimes(1)
      return
    }
    if (mode === 'temporary') {
      expect(await view.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining(en['card.loadFailed']))
      expect(readVisualReply).toHaveBeenCalledTimes(1)
      fireEvent.click(view.getByRole('button', { name: en['card.reload'] }))
    }
    const frame = await view.findByTitle('Visual reply: Published native title')
    expect(frame.getAttribute('srcdoc')).toBe(HTML)
    expect(readVisualReply).toHaveBeenCalledWith({ sessionId: SID, attachmentId: FILE.attachmentId }, expect.any(AbortSignal))
    expect(readVisualReply).toHaveBeenCalledTimes(mode === 'temporary' ? 2 : 1)
    fireEvent.click(view.getByRole('button', { name: en['card.expand'] }))
    const expanded = view.getByRole('dialog', { name: 'Published native title' })
    expect(within(expanded).getByTitle('Visual reply: Published native title')).toBe(frame)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
    fireEvent.click(within(expanded).getByRole('button', { name: en['card.source'] }))
    const source = view.getByRole('dialog', { name: en['card.sourceTitle'] })
    expect(within(source).getByText(HTML)).toBeTruthy()
    expect(within(source).getByTitle('Visual reply: Published native title')).toBe(frame)
    fireEvent.click(within(source).getByRole('button', { name: en['card.preview'] }))
    const preview = view.getByRole('dialog', { name: 'Published native title' })
    expect(within(preview).getByTitle('Visual reply: Published native title')).toBe(frame)
    fireEvent.click(within(preview).getByRole('button', { name: en['card.close'] }))
    expect(view.container.querySelector('iframe')).toBe(frame)
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })
})
