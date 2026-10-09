// @vitest-environment jsdom
import type { GlobalStandardProps, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState, SessionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  bindSnapshotSelector, makeTranslate, RemoteError, sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { EMPTY_CONVERSATION_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import type { ConversationSnapshot } from '../src/client/contract/snapshot.ts'
import { createConversationStore } from '../src/client/stores.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { en, zh } from '../src/client/locales.ts'
import { ConversationContent } from '../src/client/skeleton/ConversationContent.tsx'
import { ConversationHeader } from '../src/client/skeleton/ConversationHeader.tsx'
import { ConversationMainPanel } from '../src/client/skeleton/ConversationMainPanel.tsx'
import { ConversationSession, ConversationSessionHeader } from '../src/client/skeleton/ConversationSession.tsx'
import { conversationPhase } from '../src/client/contract/snapshot.ts'
import { HeroShell } from '../src/client/skeleton/EmptyHero.tsx'
import type { HeroShellProps } from '../src/client/skeleton/EmptyHero.tsx'
import './control-row-dom.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import type {
  ComposerBarOwnerProps, ConversationContentInputProps, ConversationContentProps,
  ConversationHeaderLineageOwnerProps, ConversationSessionHeaderSlotProps, ConversationSessionSlotProps, ConversationSlotProps,
  ConversationViewsProps,
} from '../src/client/contract/slots.ts'
import type { ViewTab } from '../src/client/contract/views.ts'
import { DEFAULT_COMPOSER_BEAM_STYLE, DEFAULT_TYPING_FX_STYLE } from '../src/submission-settings.ts'

const rootCss = readFileSync(resolve(process.cwd(), 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css'), 'utf8')

// Every session-scope fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

const unusedView = (): never => { throw new Error('view hook is not consumed by this skeleton fixture') }

const FactoryViewsTestContext = createContext<ConversationViewsProps | undefined>(undefined)

function StableConversationViews() {
  const props = useContext(FactoryViewsTestContext)
  if (props === undefined) throw new Error('Factory views test context is missing')
  return <>{props.renderSlot('conversation.session', {})}</>
}

// jsdom implements no Range geometry (Lexical's scroll-into-view measures the
// caret with one once the surface is genuinely contenteditable).
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})


function fakeWiring() {
  const sink = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
  const shell = new SessionInputShell({ actx: {} as Context, defaultSink: sink, commandAttachments: { serialize: () => Promise.resolve([]), release: () => {}, unsupportedNotice: (token: string) => `${token.trim()} attachments-unsupported` } })
  return { wiring: shell, sink, shell }
}

/** jsdom has no ResizeObserver; the root publishes its width and the composer
 * seat its height through one. Observed targets are recorded so a case can
 * fire the callback against a chosen element. */
const resizeObservers: { callback: ResizeObserverCallback; targets: Element[] }[] = []
class ResizeObserverStub {
  targets: Element[] = []
  constructor(callback: ResizeObserverCallback) {
    resizeObservers.push({ callback, targets: this.targets })
  }

  observe(target: Element): void { this.targets.push(target) }
  unobserve(): void {}
  disconnect(): void { this.targets.length = 0 }
}

/** Fires every recorded observer whose target list includes the element. */
function fireResize(el: Element): void {
  for (const entry of resizeObservers) {
    if (entry.targets.includes(el)) entry.callback([], undefined as never)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resizeObservers.length = 0
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const t: ConversationContentProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const wid = (id: string) => id as WorkspaceId
const SID = sid('s1')

type SessionSlotProps = ConversationSessionSlotProps

function workspace(id = 'w1'): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id, sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Host scratch cwd advertised by the Workspace baseline (no-directory tasks live there). */
const SCRATCH = '/dsh-home/no-workspace'
const workspaceState = (items: readonly WorkspaceView[]): WorkspaceSnapshot => ({
  items, archivedSessionIds: [], pinnedSessionIds: [], scratchCwd: SCRATCH, state: 'idle', phase: 'ready', error: null,
})

function sessionSnapshotOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { ...sessionFixture(SID), ...overrides }
}

function mount(
  snapshot: SessionSnapshot,
  workspaceRows: WorkspaceView[] = [{ ...workspace('one'), sessionIds: [SID] }],
  retargetWorkspace = vi.fn(async (_workspaceId: WorkspaceId) => {}),
  options: {
    /** Explicit undefined exercises the shell before a Session is selected. */
    sessionId?: SessionId | undefined
    /** When true, mimic overlay:true chain siblings (hidden fallback + takeover). */
    overlayTakeover?: boolean
    /** The session list summary's `blank` flag — independent of the snapshot's. */
    summaryBlank?: boolean
    /** Persistent plugin-owned presentation metadata from the session list. */
    summaryPresentation?: SessionSummary['presentation']
    /** Drop the session's summary row entirely (a session the list has not caught up with). */
    omitSummaryRow?: boolean
    /** Classify the selected child as a subagent. */
    summaryOrigin?: 'subagent'
    /** Insert a first-level subagent between the root and selected child. */
    nestedSubagent?: boolean
    /** A composer block another plugin raised for this session. */
    composerBlock?: { reason: string }
    /** Mutable view ledger used by registration-order regressions. */
    viewTabs?: ViewTab[]
    /** Hide the Chat/Trajectory tablist while keeping views.list intact. */
    viewTabsChrome?: boolean
    /** The selected session's list-summary cwd (defaults to the fixture Workspace path). */
    summaryCwd?: string
    /** No-directory pick callback injected by apply. */
    selectNoDirectory?: () => Promise<void>
  } = {},
) {
  const sessionId = 'sessionId' in options ? options.sessionId : SID
  const root = sid('root')
  const parent = sid('parent')
  const rootRow = { id: root, displayTitle: 'Root', running: false, retainedBy: {}, blank: false, updatedAt: 1 }
  const parentRow = {
    id: parent, displayTitle: 'Parent', parentId: root, origin: 'subagent' as const,
    running: false, retainedBy: {}, blank: false, updatedAt: 2,
  }
  const summaryTitle = options.summaryPresentation?.title ?? 'Child'
  const childRow = {
    id: SID, displayTitle: summaryTitle, parentId: options.nestedSubagent === true ? parent : root,
    cwd: options.summaryCwd ?? '/projects/one', running: false, blank: options.summaryBlank ?? false, updatedAt: 3,
    retainedBy: { mainView: 1 },
    ...(options.summaryOrigin === undefined ? {} : { origin: options.summaryOrigin }),
    ...(options.summaryPresentation === undefined ? {} : {
      title: summaryTitle,
      presentation: options.summaryPresentation,
    }),
  }
  const listed = options.omitSummaryRow !== true
  const sessions = createSnapshotStore<SessionListState>({
    ids: listed
      ? [root, ...options.nestedSubagent === true ? [parent] : [], SID]
      : [root],
    byId: {
      [root]: rootRow,
      ...listed && options.nestedSubagent === true && { [parent]: parentRow },
      ...listed && { [SID]: childRow },
    },
    phase: 'ready', projectionsBySession: {},
  })
  const workspaces = createSnapshotStore<WorkspaceSnapshot>(workspaceState(workspaceRows))
  const session = createSnapshotStore<SessionSnapshot>(snapshot)
  const useSession = bindSnapshotSelector(session)
  const conversation = createSnapshotStore<ConversationSnapshot>(EMPTY_CONVERSATION_SNAPSHOT)
  const useConversation = bindSnapshotSelector(conversation)
  const useSessionStatus = bindSnapshotSelector(
    createSnapshotStore<SessionStatusSnapshot>(new Map()),
  )
  const store = createConversationStore().create()
  store.actions.setDraft('ordinary draft')
  const { wiring, sink } = fakeWiring()
  wiring.setDraft(store.store.getSnapshot().draft)
  const useInput = bindSnapshotSelector(wiring.state)
  const inputActions = wiring.actions
  const stop = vi.fn()
  const open = vi.fn()
  const slotCalls: string[] = []
  const composerSlotCalls: string[] = []
  const lineageOwners: ConversationHeaderLineageOwnerProps[] = []
  let sessionBodyChainOwner: unknown
  const viewTabs = options.viewTabs ?? [
    { id: 'chat', label: 'Chat' },
    { id: 'trajectory', label: 'Trajectory' },
  ]
  const useConversationViews: SessionSlotProps['useConversationViews'] = selector => selector(viewTabs)
  /** Owner share handed to the two composer tool-row seats, per render. */
  const seatOwners: { key: string; owner: unknown }[] = []
  let pickerOwner: unknown
  const renderSlot = ((key: string, owner: object, opts?: { only?: string; fallback?: ReactNode }) => {
    slotCalls.push(key)
    if (key === 'conversation.input.model' || key === 'conversation.input.plan'
      || key === 'conversation.input.managed') {
      seatOwners.push({ key, owner })
    }
    if (key === 'conversation.hero.workspace') { pickerOwner = owner; return null }
    if (key === 'conversation.session.header.lineage') {
      lineageOwners.push(owner as ConversationHeaderLineageOwnerProps)
      return opts?.fallback ?? null
    }
    if (key === 'conversation.header') {
      return <ConversationHeader {...runtimeProps} renderSlot={renderSlot as never} />
    }
    if (key === 'conversation.session.header') {
      return (
        <ConversationSessionHeader
          hideChrome={(owner as Pick<ConversationSessionHeaderSlotProps, 'hideChrome'>).hideChrome}
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useChat={unusedView}
          useTrajectory={unusedView}
          useConversationViews={useConversationViews}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useResource={useResource}
          useSessionStatus={useSessionStatus}
          useSessionRetainInfo={() => undefined}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          useViewTabs={sel => sel(options.viewTabsChrome !== false)}
          open={open}
          selectView={(view) => { store.actions.setView(view) }}
          t={t}
        />
      )
    }
    if (key === 'conversation.session') {
      return (
        <ConversationSession
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useSession={useSession}
          useConversation={useConversation}
          useChat={unusedView}
          useTrajectory={unusedView}
          useConversationViews={useConversationViews}
          useInspectCall={selector => selector(undefined)}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useResource={useResource}
          useSessionStatus={useSessionStatus}
          useSessionRetainInfo={() => undefined}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          useStore={bindSnapshotSelector(store)}
          actions={store.actions}
          renderSlot={renderSlot as never}
          renderSlotChain={renderSessionSlotChain}
          bindDraftPersistence={write => wiring.bindDraftPersistence(write)}
          openView={(view, focus) => { store.actions.openView(view, focus) }}
        />
      )
    }
    if (key === 'conversation.composer.bar') {
      // The real entry, mounted the way the outlet composes it: standard kit
      // (shared with the root's props below) + this entry's inject + owner.
      const bar = owner as ComposerBarOwnerProps
      return (
        <InputBar
          sessionId={SID}
          SessionProvider={({ children }) => children}
          useResource={useResource}
          useSession={useSession}
          useConversation={useConversation}
          useSessions={props.useSessions}
          usePanelInfo={props.usePanelInfo}
          useSessionStatus={useSessionStatus}
          useSessionRetainInfo={() => undefined}
          useWorkspaces={props.useWorkspaces}
          useProjection={(() => undefined)}
          useInput={useInput}
          inputActions={inputActions}
          keyboard={wiring}
          addFiles={() => null}
          useFileUploads={bindSnapshotSelector(createSnapshotStore({}))}
          retryFileUpload={undefined}
          removeAttachment={() => {}}
          resolveDraftAttachments={() => []}
          toggleCommandMenu={vi.fn()}
          useBusyEnter={bindSnapshotSelector(createSnapshotStore<'queue' | 'steer'>('queue'))}
          useStopShortcut={bindSnapshotSelector(createSnapshotStore<readonly string[]>([]))}
          useNotices={bindSnapshotSelector(wiring.notices)}
          useLexicon={bindSnapshotSelector(wiring.lexicon)}
          useMenuLauncher={bindSnapshotSelector(createSnapshotStore<string | null>(null))}
          useComposerBeam={sel => sel(false)}
          useComposerBeamStyle={sel => sel(DEFAULT_COMPOSER_BEAM_STYLE)}
          useTypingFx={sel => sel(false)}
          useTypingFxStyle={sel => sel(DEFAULT_TYPING_FX_STYLE)}
          useComposerResize={sel => sel(false)}
          useComposerResizeHeight={sel => sel(null)}
          useComposerResizeWidth={sel => sel(null)}
          setComposerResizeSize={() => {}}
          stop={stop}
          t={t}
          renderSlot={((key: string, seatOwner: object) => {
            composerSlotCalls.push(key)
            // The bar's own seats: recorded so a case can assert what share
            // each tool-row control received.
            seatOwners.push({ key, owner: seatOwner })
            return null
          }) as InputBarProps['renderSlot']}
          {...bar}
        />
      )
    }
    return <div data-testid={`view-${opts?.only ?? key}`} />
  }) as ConversationContentProps['renderSlot']
  const renderSessionSlotChain: ComponentProps<typeof ConversationSession>['renderSlotChain'] = (
    _key, owner, opts,
  ) => {
    sessionBodyChainOwner = owner
    return opts?.fallback ?? null
  }
  const renderSlotChain = ((_key, _owner, opts) => (
    options.overlayTakeover === true
      ? (
        <>
          <div data-chain-overlay-fallback="conversation.composer" style={{ display: 'none' }}>
            {opts?.fallback ?? null}
          </div>
          <div data-testid="composer-takeover">TAKEOVER</div>
        </>
      )
      : (opts?.fallback ?? null)
  )) as ConversationContentProps['renderSlotChain']
  const SessionProvider: ConversationContentProps['SessionProvider'] = ({ children }) => children
  const renderFactorySlot = ((_name: string, input: ConversationContentInputProps, factoryOptions?: {
    slots?: Record<string, (props: never) => ReactNode>
  }) => {
    const common: ConversationViewsProps = {
      sessionId: SID,
      SessionProvider,
      useSession,
      useConversation,
      useChat: unusedView,
      useTrajectory: unusedView,
      useSessions: bindSnapshotSelector(sessions),
      usePanelInfo: selector => selector({ activePanelId: null }),
      useResource,
      useSessionStatus,
      useSessionRetainInfo: () => undefined,
      useWorkspaces: bindSnapshotSelector(workspaces),
      useProjection: (() => undefined),
      useComposerBlock: select => select(options.composerBlock),
      useInput,
      inputActions,
      renderSlot,
      renderSlotChain,
      renderFactorySlot,
      selectWorkspace: retargetWorkspace,
      selectNoDirectory: options.selectNoDirectory ?? vi.fn(async () => {}),
      t,
    }
    const useFactorySlot = ((name: string, fallback: (props: never) => ReactNode) => (
      name === 'views' ? StableConversationViews : factoryOptions?.slots?.[name] ?? fallback
    )) as ConversationContentProps['useFactorySlot']
    return (
      <FactoryViewsTestContext.Provider value={common}>
        <ConversationContent {...({ ...common, ...runtimeProps, ...input, useFactorySlot })} />
      </FactoryViewsTestContext.Provider>
    )
  }) as ConversationSlotProps['renderFactorySlot']
  const runtimeProps: PropsRuntime<'main.conversation'> & Pick<ConversationSlotProps, 'SessionProvider'> = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    sessionId,
    SessionProvider,
    useSession: sessionId === undefined ? () => undefined : useSession,
    useConversation: sessionId === undefined ? () => undefined : useConversation,
    useSessions: bindSnapshotSelector(sessions),
    useSessionStatus,
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: bindSnapshotSelector(workspaces),
    useProjection: (() => undefined),
    useInput,
    inputActions,
  }
  const props: ConversationSlotProps = { ...runtimeProps, renderSlot, renderFactorySlot }
  const view = render(<ConversationMainPanel {...props} />)
  return {
    view, store, wiring, sink, retargetWorkspace, session, conversation, slotCalls, composerSlotCalls, lineageOwners, seatOwners, open,
    workspaces,
    pickerOwner: () => pickerOwner,
    sessionBodyChainOwner: () => sessionBodyChainOwner,
    rerender: () => { view.rerender(<ConversationMainPanel {...props} />) },
  }
}

describe('Hero chrome', () => {
  it('renders the English preview badge through the hero locale seat', () => {
    const renderSlot = vi.fn<HeroShellProps['renderSlot']>(() => null)
    const view = render(<HeroShell t={makeTranslate(en, commonEn)} renderSlot={renderSlot} />)
    expect(view.getByText('Into the Unknown')).toBeTruthy()
    expect(view.getByText('Preview')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledOnce()
    expect(renderSlot.mock.calls[0]?.[0]).toBe('conversation.hero.brand.mark')
    const brandMarkOwner = renderSlot.mock.calls[0]?.[1]
    if (brandMarkOwner === undefined || !('size' in brandMarkOwner) || !('className' in brandMarkOwner)) {
      throw new Error('hero brand-mark owner must provide size and className')
    }
    expect(brandMarkOwner.size).toBe(34)
    expect(brandMarkOwner.className).toBeTypeOf('string')
    expect(renderSlot.mock.calls[0]?.[2]?.fallback).toBeTruthy()
  })
})

describe('ConversationRoot resident composer', () => {
  it('keeps global header navigation without selecting a Session', () => {
    const b = mount(sessionSnapshotOf(), [], undefined, { sessionId: undefined })
    expect(b.view.container.querySelector('header')).not.toBeNull()
    expect(b.view.getByTestId('view-conversation.header.leading')).toBeTruthy()
    expect(b.slotCalls).not.toContain('conversation.session.header')
    expect(b.view.queryByRole('tablist')).toBeNull()
    expect(b.view.queryByTestId('view-conversation.session.header.corner')).toBeNull()
  })

  it('does not redispatch composer child slots for an unrelated Session publication', () => {
    const b = mount(sessionSnapshotOf())
    const childKeys = new Set([
      'conversation.input.overlay',
      'conversation.input.left',
      'conversation.input.right',
      'conversation.composer.dock',
    ])
    const dispatchCount = () => b.slotCalls.filter(key => childKeys.has(key)).length
    const before = dispatchCount()

    act(() => {
      const current = b.session.getSnapshot()
      b.session.set({ ...current, hasMore: !current.hasMore })
    })

    expect(dispatchCount()).toBe(before)
  })

  it('renders the composer inert with the blocker\u2019s own reason', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      composerBlock: { reason: 'select a model first' },
    })
    const box = b.view.getByRole('textbox')
    // One disabled composer with the blocker's placeholder, never a second
    // tree: the DOM survives the block being raised and cleared.
    expect(box.getAttribute('aria-disabled')).toBe('true')
    expect(box.getAttribute('data-placeholder')).toBe('select a model first')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).not.toHaveBeenCalled()

    // The model seat stays live. Locking it too would leave the composer
    // asking for the one thing it prevents — every block this contract has is
    // cleared by choosing a model.
    const seat = (key: string) => b.seatOwners.filter(call => call.key === key).at(-1)?.owner
    expect(seat('conversation.input.model')).toEqual({ locked: false })
    expect(seat('conversation.input.plan')).toEqual({ locked: true })
  })

  it('uses explicit managed presentation for the profile seat and hides independent chrome', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      summaryPresentation: { owner: 'plugin', title: 'Managed room', composer: 'managed' },
    })
    const seat = (key: string) => b.seatOwners.filter(call => call.key === key).at(-1)?.owner

    expect(b.view.getByRole('textbox').getAttribute('data-placeholder')).toBe('发送消息')
    expect(b.composerSlotCalls).toContain('conversation.input.managed')
    expect(b.seatOwners.some(call => call.key === 'conversation.input.model')).toBe(false)
    expect(b.seatOwners.some(call => call.key === 'conversation.input.plan')).toBe(false)
    expect(b.composerSlotCalls).not.toContain('conversation.composer.dock')
    expect(b.slotCalls).not.toContain('conversation.session.header.lineage')
    expect(b.slotCalls).not.toContain('conversation.session.header.actions')
    expect(b.slotCalls).not.toContain('conversation.session.header.utilities')
    expect(b.view.getByText('Managed room').tagName).toBe('SPAN')
    expect(b.view.queryByRole('tablist')).toBeNull()
    expect(b.view.queryByRole('tab', { name: 'Trajectory' })).toBeNull()
    expect(b.view.getByRole('button', { name: '添加文件或调用指令' })).toBeTruthy()
    expect(seat('conversation.input.managed')).toEqual({ locked: false })
  })

  it('managed presentation ignores stale trajectory selection and renders the default view', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      summaryPresentation: { owner: 'plugin', title: 'Managed room', composer: 'managed' },
    })
    act(() => { b.store.actions.setView('trajectory') })

    expect(b.view.getByText('Managed room').tagName).toBe('SPAN')
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    expect(b.view.queryByTestId('view-trajectory')).toBeNull()
    expect(b.view.queryByRole('tab', { name: 'Trajectory' })).toBeNull()
  })

  it('keeps the managed profile seat actionable while a model block is raised', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      composerBlock: { reason: 'select a model first' },
      summaryPresentation: { owner: 'plugin', title: 'Managed room', composer: 'managed' },
    })
    const seat = b.seatOwners.filter(call => call.key === 'conversation.input.managed').at(-1)?.owner
    expect(seat).toEqual({ locked: false })
  })

  it('lets the no-workspace posture win over a block', () => {
    // Picking a workspace is the earlier prerequisite; naming a model first
    // would send the user somewhere they cannot act yet.
    const b = mount(sessionSnapshotOf({ blank: true }), [], undefined, {
      summaryBlank: true,
      composerBlock: { reason: 'select a model first' },
    })
    const box = b.view.getByRole('textbox')
    expect(box.getAttribute('aria-disabled')).not.toBe('true')
    expect(box.getAttribute('contenteditable')).not.toBe('true')
    expect(box.getAttribute('aria-haspopup')).toBe('menu')
    expect(box.getAttribute('data-placeholder')).not.toBe('select a model first')
    const modelSeat = b.seatOwners.filter(call => call.key === 'conversation.input.model').at(-1)?.owner
    expect(modelSeat).toEqual({ locked: true })
  })

  it('keeps composer text in the machine, mirrors to the Conversation store, and submits through the sink', () => {
    const b = mount(sessionSnapshotOf())
    const box = b.view.getByRole('textbox')
    expect(b.wiring.snapshot.draft).toBe('ordinary draft')
    act(() => { b.wiring.setDraft('ordinary revised') })
    expect(b.store.store.getSnapshot().draft).toEqual({ text: 'ordinary revised', references: [] })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(b.sink).toHaveBeenCalledWith('ordinary revised', [], 'queue', expect.any(AbortSignal))
    expect(b.view.queryByRole('button', { name: 'Child' })).toBeNull()
    expect(b.view.getByText('Child').tagName).toBe('SPAN')
    expect(b.view.queryByText('Root')).toBeNull()
  })

  it('shows hierarchy only for subagents and opens their ordinary owner', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { summaryOrigin: 'subagent' })
    const root = b.view.getByRole('button', { name: 'Root' })
    expect(b.view.queryByRole('button', { name: 'Child' })).toBeNull()
    expect(b.view.getByText('Child').tagName).toBe('SPAN')
    fireEvent.click(root)
    expect(b.open).toHaveBeenCalledWith(sid('root'))
  })

  it('keeps intermediate subagent breadcrumbs at the compact title size', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, {
      summaryOrigin: 'subagent',
      nestedSubagent: true,
    })
    expect(b.view.getByRole('button', { name: 'Root' }).className).not.toContain('crumbSubagent')
    expect(b.view.getByRole('button', { name: 'Parent' }).className).toContain('crumbSubagent')
    expect(b.view.getByText('Child').className).toContain('crumbSubagent')
    expect(b.lineageOwners.slice(-2).map(owner => owner.lineageSessionId)).toEqual([
      sid('parent'),
      SID,
    ])
    expect(b.lineageOwners.at(-2)?.openTitle).toEqual(expect.any(Function))
    expect(b.lineageOwners.at(-1)?.openTitle).toBeUndefined()
  })

  it('active phase: fixed header outside the scrollport; viewport composer seat inside it', () => {
    const b = mount(sessionSnapshotOf())
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const header = b.view.container.querySelector('header')
    const textarea = b.view.container.querySelector<HTMLDivElement>('[data-composer-input]')
    expect(host).not.toBeNull()
    expect(seat).not.toBeNull()
    expect(header).not.toBeNull()
    expect(header?.querySelector('[data-dshd-caption="title"]')).not.toBeNull()
    expect(header?.querySelector('[data-dshd-caption="blank"]')).toBeNull()
    expect(b.sessionBodyChainOwner()).toMatchObject({
      sessionId: SID,
      presentation: undefined,
    })
    // Header is column chrome above the scrollport; the viewport seat remains a DOM child for ownership.
    expect(host?.contains(header)).toBe(false)
    expect(host?.contains(seat)).toBe(true)
    expect(seat?.contains(textarea)).toBe(true)
    expect(b.slotCalls).toContain('conversation.session.header.lineage')
    expect(b.slotCalls).toContain('conversation.header.leading')
    expect(b.slotCalls).toContain('conversation.session.header.actions')
    expect(b.slotCalls).toContain('conversation.session.header.utilities')
    expect(b.slotCalls).toContain('conversation.session.header.corner')
    expect(b.view.getByRole('tablist')).toBeTruthy()
    expect(b.view.getByRole('tab', { name: 'Chat' })).toBeTruthy()
    expect(b.view.getByRole('tab', { name: 'Trajectory' })).toBeTruthy()
  })

  it('viewport composer seat wraps the whole overlay chain, not only the fallback stack', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { overlayTakeover: true })
    const seat = b.view.container.querySelector('[data-composer-seat]')
    const takeover = b.view.getByTestId('composer-takeover')
    const fallback = b.view.container.querySelector('[data-chain-overlay-fallback="conversation.composer"]')
    expect(seat?.contains(takeover)).toBe(true)
    expect(seat?.contains(fallback)).toBe(true)
  })

  it('preserves transcript wheel scrolling over a viewport-anchored takeover', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { overlayTakeover: true })
    const host = b.view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    const seat = b.view.container.querySelector<HTMLElement>('[data-composer-seat]')!
    const scrollBy = vi.fn()
    host.scrollBy = scrollBy
    host.style.lineHeight = '20px'
    Object.defineProperty(host, 'clientHeight', { value: 400 })
    seat.style.position = 'absolute'
    const wheel = (deltaY: number, deltaMode = 0, ctrlKey = false) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, deltaMode, ctrlKey })
      seat.dispatchEvent(event)
      return event
    }
    expect(wheel(120).defaultPrevented).toBe(true)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 120 })
    wheel(-2, WheelEvent.DOM_DELTA_LINE)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -40 })
    wheel(1, WheelEvent.DOM_DELTA_PAGE)
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 400 })
    expect(wheel(120, 0, true).defaultPrevented).toBe(false)
    expect(scrollBy).toHaveBeenCalledTimes(3)
    seat.style.position = 'static'
    expect(wheel(120).defaultPrevented).toBe(false)
    expect(scrollBy).toHaveBeenCalledTimes(3)
  })

  it('leaves answer scrolling and contained takeover boundaries to the browser, and releases the listener', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { overlayTakeover: true })
    const host = b.view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    const seat = b.view.container.querySelector<HTMLElement>('[data-composer-seat]')!
    const scrollBy = vi.fn()
    host.scrollBy = scrollBy
    seat.style.position = 'absolute'
    const inner = document.createElement('div')
    inner.style.overflowY = 'auto'
    Object.defineProperties(inner, { clientHeight: { value: 40 }, scrollHeight: { value: 100 } })
    inner.scrollTop = 10
    seat.appendChild(inner)
    fireEvent.wheel(inner, { deltaY: 120 })
    expect(scrollBy).not.toHaveBeenCalled()
    inner.scrollTop = 60
    fireEvent.wheel(inner, { deltaY: 120 })
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 120 })
    inner.style.overscrollBehaviorY = 'contain'
    fireEvent.wheel(inner, { deltaY: 120 })
    expect(scrollBy).toHaveBeenCalledTimes(1)
    b.view.unmount()
    fireEvent.wheel(seat, { deltaY: 120 })
    expect(scrollBy).toHaveBeenCalledTimes(1)
  })

  it('hero phase: keeps sidebar controls accessible while hiding conversation chrome', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [
        { ...workspace('one'), sessionIds: [SID] },
        { ...workspace('second'), title: 'Selected Folder' },
      ],
    )
    // Hero chrome is present and the selected View slot remains absent.
    const host = b.view.container.querySelector('[data-conversation-scroll]')
    const header = b.view.container.querySelector('header[aria-hidden]')
    expect(host).not.toBeNull()
    expect(header?.getAttribute('aria-hidden')).toBe('true')
    expect(header?.querySelector('[data-dshd-caption="blank"]')).not.toBeNull()
    expect(header?.querySelector('[data-dshd-caption="title"]')).toBeNull()
    expect(b.view.getByTestId('view-conversation.session.header.corner')).toBeTruthy()
    expect(b.view.queryByRole('tablist')).toBeNull()
    expect(b.slotCalls).not.toContain('conversation.session.header.utilities')
    expect(b.slotCalls).not.toContain('conversation.session.header.actions')
    expect(b.view.getByText('探索未至之境')).toBeTruthy()
    expect(b.view.getByText('预览版')).toBeTruthy()
    expect(b.view.queryByTestId('view-chat')).toBeNull()
    // The same machine-backed textarea is live in the hero, and the
    // persistence mirror stays bound (ConversationSession mounts chrome-hidden
    // for blank sessions): hero typing reaches the Conversation store.
    const box = b.view.getByRole('textbox')
    expect(host?.contains(box)).toBe(true)
    act(() => { b.wiring.setDraft('draft in hero') })
    expect(b.store.store.getSnapshot().draft).toEqual({ text: 'draft in hero', references: [] })
    // Picker: open through the chip; a pick switches to the other
    // workspace's blank session (draft carry is apply-layer wiring).
    fireEvent.click(b.view.getByRole('button', { name: '选择工作区' }))
    const owner = b.pickerOwner() as { open: boolean; onPick(id: WorkspaceId): void }
    expect(owner.open).toBe(true)
    act(() => { owner.onPick(wid('second')) })
    expect(b.retargetWorkspace).toHaveBeenCalledWith(wid('second'))
    expect(b.view.getByText('Selected Folder')).toBeTruthy()
  })

  it('keeps a rejected first prompt engaging instead of returning to the Hero', () => {
    const failed = sessionSnapshotOf({
      blank: true,
      promptAttempted: true,
      awaitingFirstTurn: true,
      promptError: {
        op: 'send',
        error: new RemoteError('session/agent-busy', 'busy', { reason: 'busy' }),
      },
    })

    expect(conversationPhase(failed, EMPTY_CONVERSATION_SNAPSHOT)).toBe('engaging')
    const b = mount(failed, undefined, undefined, { summaryBlank: true })
    expect(b.view.container.querySelector('[data-phase]')?.getAttribute('data-phase')).toBe('active')
    expect(b.view.queryByText('探索未至之境')).toBeNull()
  })

  it('settling phase: a summary that does not prove the session blank hides the composer while it opens', () => {
    const b = mount(sessionSnapshotOf({ blank: true, openState: 'loading' }))
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('settling')
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
  })

  it('keeps a presentation-owned blank Session docked without changing blank lifecycle state', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      undefined,
      undefined,
      {
        summaryBlank: true,
        summaryPresentation: { owner: 'dshbot', title: 'Bot room' },
      },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('active')
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
    expect(b.slotCalls).not.toContain('conversation.hero.workspace')
    expect(b.view.getByRole('textbox').getAttribute('aria-haspopup')).toBeNull()
    const header = b.view.container.querySelector('header')
    expect(header?.getAttribute('aria-hidden')).toBeNull()
    expect(header?.querySelector('[data-dshd-caption="title"]')).not.toBeNull()
    expect(b.view.getByText('Bot room')).toBeTruthy()
    expect(header?.querySelector('[data-dshd-caption="blank"]')).toBeNull()
    // Presentation ownership changes navigation chrome only; with no elected
    // body-chain occupant, the resident Conversation fallback remains visible.
    expect(b.view.queryByTestId('view-chat')).not.toBeNull()
    expect(b.view.container.querySelector('[data-plugin-session-canvas]')).not.toBeNull()
  })

  it('removes the ordinary blank canvas from flex layout when a plugin body owns the composer overlay', () => {
    expect(rootCss).toMatch(
      /\.scrollBody:has\(\[data-conversation-composer-overlay\]\)\s*>\s*:global\(\[data-plugin-session-canvas\]\)\s*\{\s*display:\s*none;/,
    )
  })

  it('settling phase: a session the list has no row for settles conservatively', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      undefined,
      { omitSummaryRow: true },
    )
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('settling')
  })

  it('startup auto-selection: a summary-proven blank session opens straight into the hero', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true, openState: 'loading' }),
      undefined,
      undefined,
      { summaryBlank: true },
    )
    // The summary already proves the outcome, so the settling hide would only
    // blank the column for the history round-trip.
    const root = b.view.container.querySelector('[data-phase]')
    expect(root?.getAttribute('data-phase')).toBe('hero')
    expect(b.view.getByText('探索未至之境')).toBeTruthy()
    expect(b.view.getByRole('textbox')).toBeTruthy()
  })

  it('same textarea DOM node survives the hero → active flip into the sticky scrollport', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const before = b.view.getByRole('textbox')
    act(() => { b.wiring.setDraft('kept across flip') })
    // First message landed: content exists, phase leaves blank. Composer
    // already sat in the resident scrollport during hero, so the textarea
    // node and InputHub draft both survive.
    b.session.set(sessionSnapshotOf({ blank: false }))
    b.rerender()
    const after = b.view.getByRole('textbox')
    expect(after).toBe(before)
    expect(b.wiring.snapshot.draft).toBe('kept across flip')
    expect(b.store.store.getSnapshot().draft).toEqual({ text: 'kept across flip', references: [] })
    expect(b.view.container.querySelector('[data-conversation-scroll]')?.contains(after)).toBe(true)
    expect(b.view.queryByTestId('hero-headline')).toBeNull()
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
  })

  it('starts first-send motion from the measured hero card and clears it on completion', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const input = b.view.getByRole('textbox')
    const card = b.view.container.querySelector<HTMLElement>('[data-composer-card]')!
    const scroller = b.view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    let top = 400
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => ({
      top, bottom: top + 100, left: 0, right: 600, width: 600, height: 100,
      x: 0, y: top, toJSON: () => ({}),
    }))
    fireResize(scroller)
    top = 700
    act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
    const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
    expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-300px')
    expect(b.view.getByRole('textbox')).toBe(input)
    fireEvent.animationEnd(card)
    expect(entering.hasAttribute('data-composer-entering')).toBe(true)
    fireEvent.animationEnd(entering)
    expect(entering.hasAttribute('data-composer-entering')).toBe(false)
    expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('')
    act(() => { b.session.set(sessionSnapshotOf({ blank: false, promptAttempted: true, running: true })) })
    expect(b.view.container.querySelector('[data-composer-entering]')).toBeNull()
  })

  it('pins the held card at the draft position while the send commit settles', async () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const card = b.view.container.querySelector<HTMLElement>('[data-composer-card]')!
    const scroller = b.view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    let base = 400
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => {
      const entering = card.closest<HTMLElement>('[data-composer-entering]')
      const offset = Number.parseFloat(entering?.style.getPropertyValue('--dsh-composer-enter-offset') ?? '') || 0
      const top = base + offset
      return { top, bottom: top + 100, left: 0, right: 600, width: 600, height: 100, x: 0, y: top, toJSON: () => ({}) }
    })
    fireResize(scroller)
    vi.useFakeTimers()
    try {
      base = 800
      act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
      const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
      // 400 (held draft top) - 800 (resting spot) = the initial hold offset.
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-400px')
      // A quiet settle notification leaves the offset alone.
      act(() => { fireResize(entering) })
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-400px')
      // Drift from the send commit folds back into the offset so the rendered
      // card stays pinned at the draft position.
      base = 804
      act(() => { fireResize(entering) })
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-404px')
      base = 806
      fireEvent.scroll(scroller)
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-406px')
      base = 812
      await act(async () => { entering.setAttribute('data-probe-settle', '') })
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-412px')
      // Structural churn re-arms the quiet window, so the glide stays paused.
      act(() => { vi.advanceTimersByTime(60) })
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('')
      const text = document.createTextNode('a')
      await act(async () => { entering.appendChild(text) })
      act(() => { vi.advanceTimersByTime(60) })
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('')
      // Streaming-class text edits still pin drift but do not extend the hold.
      await act(async () => { text.data = 'b' })
      act(() => { vi.advanceTimersByTime(25) })
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('running')
      // Once the glide runs the card owns the motion; late drift is not
      // pinned back.
      base = 900
      act(() => { fireResize(entering) })
      fireEvent.scroll(scroller)
      await act(async () => { entering.setAttribute('data-probe-late', '') })
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('-412px')
      fireEvent.animationEnd(entering)
      expect(entering.dataset.composerEntering).toBeUndefined()
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('')
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not extend the first-send hold for its own pin style', async () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    vi.useFakeTimers()
    try {
      act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
      const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
      await act(async () => {})
      act(() => { vi.advanceTimersByTime(60) })
      await act(async () => {
        entering.style.setProperty('--dsh-composer-enter-offset', '-1px')
      })
      act(() => { vi.advanceTimersByTime(20) })
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('running')
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases the hold pin when the transition clears before the glide', async () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const card = b.view.container.querySelector<HTMLElement>('[data-composer-card]')!
    const scroller = b.view.container.querySelector<HTMLElement>('[data-conversation-scroll]')!
    let base = 400
    vi.spyOn(card, 'getBoundingClientRect').mockImplementation(() => {
      const entering = card.closest<HTMLElement>('[data-composer-entering]')
      const offset = Number.parseFloat(entering?.style.getPropertyValue('--dsh-composer-enter-offset') ?? '') || 0
      const top = base + offset
      return { top, bottom: top + 100, left: 0, right: 600, width: 600, height: 100, x: 0, y: top, toJSON: () => ({}) }
    })
    fireResize(scroller)
    vi.useFakeTimers()
    try {
      base = 800
      act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
      const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
      fireEvent.animationEnd(entering)
      expect(entering.dataset.composerEntering).toBeUndefined()
      // A hold timer firing after the transition cleared is a no-op: it must
      // not resurrect the offset or release a play-state that was never held.
      act(() => { vi.advanceTimersByTime(500) })
      expect(entering.style.getPropertyValue('animation-play-state')).toBe('')
      // The removal itself is an observed mutation; the pin sees the cleared
      // transition and disconnects instead of pinning a dead offset.
      await act(async () => {})
      base = 900
      act(() => { fireResize(entering) })
      fireEvent.scroll(scroller)
      expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles immediately under reduced motion instead of holding', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }))
    const b = mount(sessionSnapshotOf({ blank: true }))
    act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
    const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
    // Zero-length timers release the paused glide on the next task, so the
    // settled position lands without a held beat.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(entering.style.getPropertyValue('animation-play-state')).toBe('running')
    fireEvent.animationEnd(entering)
    expect(entering.dataset.composerEntering).toBeUndefined()
  })

  it('does not animate when loaded history replaces an empty shell', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    act(() => { b.session.set(sessionSnapshotOf({ blank: false })) })
    expect(b.view.container.querySelector('[data-composer-entering]')).toBeNull()
  })

  it('clears canceled motion so an overlay cannot replay it when dismissed', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
    const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
    fireEvent(entering, new Event('animationcancel', { bubbles: true }))
    expect(entering.hasAttribute('data-composer-entering')).toBe(false)
    expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('')
  })

  it('cancels first-send motion when the composer returns to a blank session', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    act(() => { b.session.set(sessionSnapshotOf({ blank: true, promptAttempted: true })) })
    const entering = b.view.container.querySelector<HTMLElement>('[data-composer-entering]')!
    act(() => { b.session.set(sessionSnapshotOf({ blank: true })) })
    expect(entering.hasAttribute('data-composer-entering')).toBe(false)
    expect(entering.style.getPropertyValue('--dsh-composer-enter-offset')).toBe('')
  })

  it('keeps the Chat fallback selected by id when a view is inserted before it', () => {
    const viewTabs: ViewTab[] = [
      { id: 'chat', label: 'Chat' },
      { id: 'trajectory', label: 'Trajectory' },
    ]
    const b = mount(sessionSnapshotOf(), undefined, undefined, { viewTabs })
    // A removed dynamic view leaves its persisted id behind. The visible
    // fallback is Chat and must stay Chat when another lower-order view lands.
    act(() => { b.store.actions.setView('removed-view') })
    expect(b.view.getByTestId('view-chat')).toBeTruthy()

    viewTabs.unshift({ id: 'new-view', label: 'New view' })
    b.rerender()

    expect(b.view.getByTestId('view-chat')).toBeTruthy()
    expect(b.view.queryByTestId('view-new-view')).toBeNull()
    expect(b.view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true')
    expect(b.view.getByRole('tab', { name: 'New view' }).getAttribute('aria-selected')).toBe('false')
    // The browser drag lane anchors its header tab-strip probe on this marker.
    expect(b.view.getByRole('tablist').hasAttribute('data-conversation-tabs')).toBe(true)
  })

  it('keeps title and session actions in one caption row with view switching below it', () => {
    const b = mount(sessionSnapshotOf())
    const row = b.view.container.querySelector('[data-dshd-caption="title"]')
    const header = row?.parentElement
    const tabs = b.view.getByRole('tablist')
    expect(row?.contains(b.view.getByText('Child'))).toBe(true)
    expect(row?.contains(b.view.getByTestId('view-conversation.session.header.actions'))).toBe(true)
    expect(header?.tagName).toBe('HEADER')
    expect(tabs.parentElement).toBe(header)
    expect(row?.contains(tabs)).toBe(false)
    expect(row?.nextElementSibling).toBe(tabs)
    expect(tabs.hasAttribute('data-conversation-tabs')).toBe(true)

    fireEvent.click(b.view.getByRole('tab', { name: 'Trajectory' }))
    expect(b.view.getByRole('tab', { name: 'Trajectory' }).getAttribute('aria-selected')).toBe('true')
    expect(b.store.getSnapshot().view).toBe('trajectory')
    expect(b.view.getByTestId('view-trajectory')).toBeTruthy()
    fireEvent.click(b.view.getByRole('tab', { name: 'Chat' }))
    expect(b.view.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true')
    expect(b.store.getSnapshot().view).toBe('chat')
    expect(b.view.getByTestId('view-chat')).toBeTruthy()
  })

  it('hides the Chat/Trajectory tablist when view tabs are disabled', () => {
    const b = mount(sessionSnapshotOf(), undefined, undefined, { viewTabsChrome: false })
    expect(b.view.queryByRole('tablist')).toBeNull()
  })

  it('rolls the pending workspace label back when switching fails', async () => {
    const selectWorkspace = vi.fn(async () => { throw new Error('connect failed') })
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [
        { ...workspace('one'), sessionIds: [SID] },
        { ...workspace('second'), title: 'Selected Folder' },
      ],
      selectWorkspace,
    )
    fireEvent.click(b.view.getByRole('button', { name: '选择工作区' }))
    const owner = b.pickerOwner() as { onPick(id: WorkspaceId): void }
    await act(async () => { owner.onPick(wid('second')); await Promise.resolve() })
    expect(selectWorkspace).toHaveBeenCalledWith(wid('second'))
    expect(b.view.queryByText('Selected Folder')).toBeNull()
    expect(b.view.getByText('one')).toBeTruthy()
  })

  it('offers No workspace folder from the chip menu, shows that copy while pending, and rolls back on failure', async () => {
    const selectNoDirectory = vi.fn(async () => {})
    const b = mount(sessionSnapshotOf({ blank: true }), undefined, undefined, { selectNoDirectory })
    fireEvent.click(b.view.getByRole('button', { name: '选择工作区' }))
    const owner = b.pickerOwner() as {
      open: boolean
      noDirectorySelected?: boolean
      onPickNoDirectory(): void
    }
    expect(owner.open).toBe(true)
    expect(owner.noDirectorySelected).toBe(false)
    await act(async () => { owner.onPickNoDirectory(); await Promise.resolve() })
    expect(selectNoDirectory).toHaveBeenCalledTimes(1)
    // The chip speaks for the pending target and the picker marks that entry.
    expect(b.view.getByText('无工作目录')).toBeTruthy()
    expect((b.pickerOwner() as { noDirectorySelected?: boolean }).noDirectorySelected).toBe(true)
    // Picking a Workspace afterwards drops the no-directory pending state.
    act(() => { (b.pickerOwner() as { onPick(id: WorkspaceId): void }).onPick(wid('one')) })
    expect((b.pickerOwner() as { noDirectorySelected?: boolean }).noDirectorySelected).toBe(false)
    b.view.unmount()

    const failing = mount(sessionSnapshotOf({ blank: true }), undefined, undefined, {
      selectNoDirectory: vi.fn(async () => { throw new Error('connect failed') }),
    })
    fireEvent.click(failing.view.getByRole('button', { name: '选择工作区' }))
    const failingOwner = failing.pickerOwner() as { onPickNoDirectory(): void }
    await act(async () => { failingOwner.onPickNoDirectory(); await Promise.resolve() })
    expect(failing.view.queryByText('无工作目录')).toBeNull()
    expect(failing.view.getByText('one')).toBeTruthy()
  })

  it('a blank session in the Host scratch cwd is a no-directory task: chip copy, composer unlocked', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [workspace('one')],
      undefined,
      { summaryBlank: true, summaryCwd: SCRATCH },
    )
    // Never the scratch directory's basename — membership plus cwd decide.
    expect(b.view.getByText('无工作目录')).toBeTruthy()
    expect(b.view.queryByText('no-workspace')).toBeNull()
    // The composer is a live text surface, not the Workspace trigger.
    const box = b.view.getByRole('textbox')
    expect(box.getAttribute('aria-haspopup')).toBeNull()
    expect(box.getAttribute('data-placeholder')).not.toBe('选择一个工作区开始')
    expect((b.pickerOwner() as { noDirectorySelected?: boolean }).noDirectorySelected).toBe(true)
  })

  it('a blank session whose Workspace was deleted stays inert instead of posing as a task', () => {
    const b = mount(
      sessionSnapshotOf({ blank: true }),
      [workspace('other')],
      undefined,
      { summaryBlank: true, summaryCwd: '/projects/deleted' },
    )
    expect(b.view.queryByText('无工作目录')).toBeNull()
    expect(b.view.queryByText('deleted')).toBeNull()
    expect(b.view.getByRole('button', { name: '选择工作区' })).toBeTruthy()
    // The composer stays the Workspace trigger (inert) until a target is picked.
    const box = b.view.getByRole('textbox')
    expect(box.getAttribute('aria-haspopup')).toBe('menu')
    expect(box.getAttribute('data-placeholder')).toBe('选择一个工作区开始')
    expect((b.pickerOwner() as { noDirectorySelected?: boolean }).noDirectorySelected).toBe(false)
  })

  it('blank session keeps the interactive picker chip (workspace switchable until the first message)', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    const chip = b.view.getByRole('button', { name: '选择工作区' })
    expect((chip as HTMLButtonElement).disabled).toBe(false)
    expect(b.slotCalls).toContain('conversation.hero.workspace')
    // The agent-preset chip sits in the same row, for the same reason: both
    // choices are only open before the first message.
    expect(b.slotCalls).toContain('conversation.hero.agentPreset')
  })

  it('prompt failure renders the promptError strip (ordinary failure, no transaction UI)', () => {
    const b = mount(sessionSnapshotOf({
      promptError: { op: 'send', error: { code: 'offline', message: 'Message send failed' } as never },
    }))
    expect(b.view.getByRole('alert').textContent).toContain('Message send failed (offline)')
    expect(b.view.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('publishes the column width as a px variable for the shared width axis', () => {
    const b = mount(sessionSnapshotOf())
    const content = b.view.container.querySelector('[data-conversation-content]') as HTMLElement
    const root = content.parentElement as HTMLElement
    // jsdom offsetWidth is 0 until faked: the observer publishes whatever the
    // layout reports, and the CSS clamp() floors the axis at 680px either way.
    Object.defineProperty(content, 'offsetWidth', { value: 1200, configurable: true })
    act(() => { fireResize(content) })
    expect(root.style.getPropertyValue('--dsh-conversation-column-width')).toBe('1200px')
    // No dragged preference: the user-width override stays absent so the
    // adaptive clamp term applies.
    expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('')
  })

  it('drag → persist → window clamp round-trip on a width handle', () => {
    const b = mount(sessionSnapshotOf())
    const content = b.view.container.querySelector('[data-conversation-content]') as HTMLElement
    const root = content.parentElement as HTMLElement
    Object.defineProperty(content, 'offsetWidth', { value: 1600, configurable: true })
    act(() => { fireResize(content) })
    const handle = b.view.container.querySelector('[data-width-handle="right"]') as HTMLElement
    expect(handle).not.toBeNull()
    // jsdom lacks pointer capture: emulate per-element so hasPointerCapture
    // gates pass; the finally block restores the original descriptors so the
    // stubs cannot leak into later tests.
    const names = ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const
    const originals = names.map(name =>
      [name, Object.getOwnPropertyDescriptor(Element.prototype, name)] as const)
    const captured = new Set<Element>()
    Element.prototype.setPointerCapture = function () { captured.add(this) }
    Element.prototype.releasePointerCapture = function () { captured.delete(this) }
    Element.prototype.hasPointerCapture = function () { return captured.has(this) }
    try {
      // Base resolves from the adaptive clamp: min(1600*0.64, 920) = 920.
      // Dragging the right handle outward by 25px widens by 2×25 = 50 → 970,
      // inside both bounds (max = 1600 − 176 = 1424 keeps the handles on-column).
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 825, clientY: 300 })
      expect(handle.style.getPropertyValue('--dsh-width-handle-pointer-y')).toBe('300px')
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 825, clientY: 300 })
      expect(handle.hasAttribute('data-dragging')).toBe(false)
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('970px')
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('970')
      // Window shrinks: the displayed width re-clamps (900 − 176 = 724) but the
      // preference stays.
      Object.defineProperty(content, 'offsetWidth', { value: 900, configurable: true })
      act(() => { fireResize(content) })
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('724px')
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('970')
      // A press without travel (a real double-click delivers two such
      // press/release rounds) must not commit the clamped display value over
      // the stored preference.
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      fireEvent.pointerUp(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('970')
      expect(root.style.getPropertyValue('--dsh-chat-user-width')).toBe('724px')
      // No reset affordance on the handle: double-click leaves the preference alone.
      fireEvent.doubleClick(handle)
      expect(localStorage.getItem('dsh.conversation.contentWidth')).toBe('970')
    } finally {
      for (const [name, descriptor] of originals) {
        if (descriptor === undefined) Reflect.deleteProperty(Element.prototype, name)
        else Object.defineProperty(Element.prototype, name, descriptor)
      }
    }
  })

  it('forwards wheel scrolling from a width handle to the transcript', () => {
    const b = mount(sessionSnapshotOf())
    const scrollport = b.view.container.querySelector('[data-conversation-scroll]') as HTMLElement
    const handle = b.view.container.querySelector('[data-width-handle="right"]') as HTMLElement
    const scrollBy = vi.fn()
    Object.defineProperty(scrollport, 'clientHeight', { value: 480, configurable: true })
    Object.defineProperty(scrollport, 'scrollBy', { value: scrollBy, configurable: true })
    scrollport.style.lineHeight = '20px'

    fireEvent.wheel(handle, { deltaY: 120, deltaMode: 0 })
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 120 })

    fireEvent.wheel(handle, { deltaY: 3, deltaMode: 1 })
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 60 })
    scrollport.style.lineHeight = 'normal'
    fireEvent.wheel(handle, { deltaY: 3, deltaMode: 1 })
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 48 })
    fireEvent.wheel(handle, { deltaY: -1, deltaMode: 2 })
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -480 })
    const calls = scrollBy.mock.calls.length
    fireEvent.wheel(handle, { deltaY: 0, deltaMode: 0 })
    fireEvent.wheel(handle, { ctrlKey: true, deltaY: 120, deltaMode: 0 })
    expect(scrollBy).toHaveBeenCalledTimes(calls)

    scrollport.removeAttribute('data-conversation-scroll')
    const nestedScrollport = document.createElement('div')
    nestedScrollport.setAttribute('data-conversation-scroll', '')
    const nestedScrollBy = vi.fn()
    Object.defineProperty(nestedScrollport, 'scrollBy', { value: nestedScrollBy, configurable: true })
    scrollport.append(nestedScrollport)
    fireEvent.wheel(handle, { deltaY: 120, deltaMode: 0 })
    expect(scrollBy).toHaveBeenCalledTimes(calls)
    expect(nestedScrollBy).not.toHaveBeenCalled()
  })

  it('does not check capture, measure, style, or schedule width-handle moves before dragging', () => {
    const b = mount(sessionSnapshotOf())
    const handle = b.view.container.querySelector('[data-width-handle="right"]') as HTMLElement
    const capture = vi.fn(() => false)
    Object.defineProperty(handle, 'hasPointerCapture', { value: capture })
    const measure = vi.spyOn(handle, 'getBoundingClientRect')
    const style = vi.spyOn(handle.style, 'setProperty')
    const schedule = vi.spyOn(globalThis, 'requestAnimationFrame')
    try {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 800, clientY: 300 })
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 802, clientY: 302 })
      expect(capture).not.toHaveBeenCalled()
      expect(measure).not.toHaveBeenCalled()
      expect(style).not.toHaveBeenCalled()
      expect(schedule).not.toHaveBeenCalled()
    } finally {
      schedule.mockRestore()
      style.mockRestore()
      measure.mockRestore()
    }
  })

  it('starts width dragging only from the primary pointer button', () => {
    const b = mount(sessionSnapshotOf())
    const handle = b.view.container.querySelector('[data-width-handle="right"]') as HTMLElement
    const captured = new Set<number>()
    Object.defineProperties(handle, {
      setPointerCapture: { configurable: true, value: (pointerId: number) => { captured.add(pointerId) } },
      releasePointerCapture: { configurable: true, value: (pointerId: number) => { captured.delete(pointerId) } },
      hasPointerCapture: { configurable: true, value: (pointerId: number) => captured.has(pointerId) },
    })
    fireEvent.pointerDown(handle, { pointerId: 1, button: 1, clientX: 800, clientY: 300 })
    expect(handle.hasAttribute('data-dragging')).toBe(false)
    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 800, clientY: 300 })
    expect(handle.hasAttribute('data-dragging')).toBe(true)
    fireEvent.pointerCancel(handle, { pointerId: 2 })
    expect(handle.hasAttribute('data-dragging')).toBe(false)
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 825, clientY: 300 })
    expect(handle.style.getPropertyValue('--dsh-width-handle-pointer-y')).toBe('')
  })

  it('hero phase renders no width handles (no transcript to size)', () => {
    const b = mount(sessionSnapshotOf({ blank: true }))
    expect(b.view.container.querySelector('[data-width-handle]')).toBeNull()
  })

  it.each(['full', 'cozy', 'compact'])('keeps one inline action instance at %s density', async density => {
    document.documentElement.dataset.titlebarDensity = density
    const b = mount(sessionSnapshotOf())
    expect(b.view.getAllByTestId('view-conversation.session.header.actions')).toHaveLength(1)
    expect(b.view.queryByRole('button', { name: '更多会话操作' })).toBeNull()
    act(() => { document.documentElement.dataset.titlebarDensity = 'full' })
    await act(async () => {})
    expect(b.view.getAllByTestId('view-conversation.session.header.actions')).toHaveLength(1)
    delete document.documentElement.dataset.titlebarDensity
  })
})
