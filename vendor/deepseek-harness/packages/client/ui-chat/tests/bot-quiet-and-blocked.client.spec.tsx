// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, bindSnapshotSelector, contextMenuHook, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { AssistantNodeView } from '../src/client/chat/AssistantNodeView.tsx'
import { stripBotQuietBlocks } from '../src/client/chat/bot-quiet.ts'
import { TurnProcessNodeView } from '../src/client/chat/TurnProcessNodeView.tsx'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import type { ChatNodeViewProps, TurnProcessOwnerProps } from '../src/client/contract/slots.ts'
import { derivePresentationPolicy } from '../src/client/presentation-policy.ts'
import { en, zh } from '../src/client/locale.ts'

afterEach(cleanup)

const SID = 'bot-session-1' as SessionId

function sessionsHook(owner: string | undefined) {
  const store = createSnapshotStore<SessionListState>({
    ids: [SID],
    phase: 'ready',
    projectionsBySession: {},
    byId: {
      [SID]: {
        id: SID,
        displayTitle: 'Session',
        running: false,
        retainedBy: {},
        blank: false,
        updatedAt: 0,
        ...(owner === undefined ? {} : { presentation: { owner, title: 'Session' } }),
      },
    },
  })
  return bindSnapshotSelector(store)
}

function assistantNode(text: string, status: 'running' | 'settled' = 'settled'): ChatNode<'assistant-step'> {
  return {
    key: 'assistant:1',
    kind: 'assistant-step',
    id: 'assistant-1',
    target: 'chat',
    anchorSeq: 2,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      status,
      turn: 1,
      step: 1,
      blocks: [{ kind: 'text', text }],
      time: 1_000,
    },
  }
}

function makeChatNodeProps(
  owner: string | undefined,
  locale: typeof zh = zh,
  turnProcess?: TurnProcessOwnerProps,
): Omit<ChatNodeViewProps<'turn-process'>, 'node'> {
  return {
    sessionId: SID,
    useSessions: sessionsHook(owner),
    useDisclosure: () => ({ expanded: false, setExpanded: () => {}, toggle: () => {} }),
    useGroupAction: () => ({ current: null }),
    useTurnData: () => undefined,
    turnProcess,
    openFile: () => {},
    loadImage: Object.assign(async () => '', { peek: () => undefined }),
    renderFactorySlot: () => null,
    t: makeTranslate(locale),
    useContextMenu: contextMenuHook(),
    useSession: (() => undefined) as never,
    useChat: (() => undefined) as never,
    useConversation: (() => undefined) as never,
    useTrajectory: (() => undefined) as never,
    useSessionRetainInfo: () => undefined,
    useSessionStatus: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    usePanelInfo: () => null as never,
    useResource: () => ({ status: 'none', value: undefined, failure: undefined }),
    useProjection: () => undefined,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    forkAt: () => {},
    inspectCall: () => {},
    ...allowAllAccess,
  }
}

function renderAssistant(text: string, owner: string | undefined, status: 'running' | 'settled' = 'settled') {
  const node = assistantNode(text, status)
  const presentation = derivePresentationPolicy(
    createSnapshotStore('standard'),
    createSnapshotStore('completion'),
    createSnapshotStore('all'),
  )
  return render(
    <AssistantNodeView
      {...makeChatNodeProps(owner)}
      node={node}
      fileMentions={() => undefined}
      usePresentation={bindSnapshotSelector(presentation)}
      renderSlot={() => null}
      SessionProvider={({ children }) => <>{children}</>}
      resolveFilePath={p => p}
      useOpenUiTheme={selector => selector('light' as never)}
      useOpenUiLocale={selector => selector('zh')}
      sendOpenUiAction={async () => ({ ok: true })}
      readOpenUiState={() => ({})}
      saveOpenUiState={() => {}}
      useStore={selector => selector({
        snapshot: null, base: null, barrier: null, operations: [], lastSeenSeq: -1, collapsed: false, restoreError: null,
      })}
      actions={{ publish: () => {}, collapse: () => {}, clear: () => {} }}
    />,
  )
}

describe('Bot quiet NO_REPLY stripping', () => {
  it('strips standalone trailing NO_REPLY and holds back streaming prefixes only in Bot sessions', () => {
    const settledBot = renderAssistant('已同步进展。\n\nNO_REPLY', 'dsh-bots:home', 'settled')
    expect(settledBot.container.textContent).toContain('已同步进展。')
    expect(settledBot.container.textContent).not.toContain('NO_REPLY')
    cleanup()

    const legacyWhale = renderAssistant('收到，已关掉。\n\nNO_REPLY', 'dsh-whale:assistant', 'settled')
    expect(legacyWhale.container.textContent).toContain('收到，已关掉。')
    expect(legacyWhale.container.textContent).not.toContain('NO_REPLY')
    cleanup()

    const quietOnlyBot = renderAssistant('NO_REPLY', 'dsh-bots:group-member', 'settled')
    expect(quietOnlyBot.container.textContent).toBe('')
    cleanup()

    const streamingBot = renderAssistant('收到，先看日志。\nNO_REP', 'dsh-bots:chat', 'running')
    expect(streamingBot.container.textContent).toContain('收到，先看日志。')
    expect(streamingBot.container.textContent).not.toContain('NO_REP')
    cleanup()

    const normalSession = renderAssistant('Normal code note.\n\nNO_REPLY', 'project', 'settled')
    expect(normalSession.container.textContent).toContain('NO_REPLY')
  })

  it('preserves inline code mentions and fenced code blocks containing NO_REPLY inside Bot sessions', () => {
    const inline = renderAssistant('约定：无需汇报时在末尾输出 `NO_REPLY`。', 'dsh-bots:home', 'settled')
    expect(inline.container.textContent).toContain('NO_REPLY')
    cleanup()

    expect(stripBotQuietBlocks([{ kind: 'text', text: '```text\nhello\nNO_REPLY\n```' }], false))
      .toEqual([{ kind: 'text', text: '```text\nhello\nNO_REPLY\n```' }])
    expect(stripBotQuietBlocks([{ kind: 'text', text: '```text\nNO_RE' }], true))
      .toEqual([{ kind: 'text', text: '```text\nNO_RE' }])
  })
})

describe('TurnProcessNodeView blocked reason', () => {
  it.each([
    [zh, '已拦截', '已完成'],
    [en, 'Blocked', 'Completed'],
  ])('renders blocked turns accurately instead of completed (%s)', (locale, expected, forbidden) => {
    const turnProcess: TurnProcessOwnerProps = {
      hasContent: false,
      foldable: false,
      open: false,
      setOpen: vi.fn(),
      spec: {
        turn: 1,
        controlAnchorSeq: 1,
        processStartSeq: 1,
        answerAnchorSeq: null,
        answerStep: 1,
        inlineReasoning: false,
        messageCount: 0,
        toolCallCount: 0,
        subagentCount: 0,
      },
    }
    const node: ChatNode<'turn-process'> = {
      key: 'turn-process:1',
      kind: 'turn-process',
      id: 'tp-1',
      target: 'chat',
      anchorSeq: 2,
      visibility: 'visible',
      location: {
        kind: 'turn',
        turn: {
          turn: 1,
          status: 'closed',
          start: { type: 'turn/start', seq: 1 as never, time: 1_000, data: { turn: 1 } },
          end: { type: 'turn/end', seq: 2 as never, time: 113_000, data: { turn: 1, reason: { kind: 'blocked' } } },
          steps: [],
        } as never,
      },
      data: {
        turn: 1,
        controlAnchorSeq: 1,
        processStartSeq: 1,
        answerAnchorSeq: null,
        answerStep: 1,
        inlineReasoning: false,
        messageCount: 0,
        toolCallCount: 0,
        subagentCount: 0,
      },
    }
    const view = render(
      <TurnProcessNodeView
        {...makeChatNodeProps('dsh-bots:home', locale, turnProcess)}
        node={node}
      />,
    )
    expect(view.getByRole('button').textContent).toBe(expected)
    expect(view.getByRole('status').textContent).toBe(expected)
    expect(view.container.textContent).not.toContain(forbidden)
  })
})
