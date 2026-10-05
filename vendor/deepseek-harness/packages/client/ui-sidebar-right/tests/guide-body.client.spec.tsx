// @vitest-environment jsdom
/**
 * The guide tab's body: the chain seam, and the shipped guide behind it.
 *
 * The contract a type relies on is the entry capsule: one per guide entry every
 * registered type contributed, in the registry's order, and picking one opens
 * that type as a page in the guide's own tab. The chain is asserted through
 * what the body hands it — the tab and the shipped guide as the fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { GlobalStandardProps, RenderOpts, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { GuideBody } from '../src/client/tabs/guide/GuideBody.tsx'
import type { GuideBodyProps } from '../src/client/tabs/guide/GuideBody.tsx'
import type { SidebarRightGuideBox } from '../src/client/tab-registry.ts'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import css from '../src/client/tabs/guide/GuideBody.module.css'

afterEach(cleanup)

const SESSION = 's-guide' as SessionId
const unused = (): never => { throw new Error('This isolated component does not consume framework hooks') }
const standard: GlobalStandardProps & SessionStandardProps = {
  sessionId: SESSION, useSession: unused, useProjection: unused, useConversation: unused,
  useInput: unused, useChat: unused, useTrajectory: unused,
  usePanelInfo: unused, useSessions: unused, useSessionStatus: unused,
  useSessionRetainInfo: unused, useResource: unused, useWorkspaces: unused,
  inputActions: { captureInsertion: unused, insertText: unused, setDraft: unused, persistDraft: unused,
    addAttachments: unused, removeAttachment: unused, pruneAttachments: unused, submit: unused },
}

const TAB = { id: 'tab-1' as TabId, kind: 'guide', contentId: 'sidebar://guide', title: 'Start' }

/** A glyph that marks its box, so a spec can tell an entry with an icon from one without. */
function Glyph({ size }: IconProps): ReactNode {
  return <span data-guide-glyph={size} />
}

/** One entry capsule as the registry lists it. */
function box(kind: string, order: number, icon?: SidebarRightGuideBox['icon'], description?: string): SidebarRightGuideBox {
  return {
    kind, providerId: `provider/${kind}`, id: `${kind}-${order}`,
    order,
    title: () => `${kind} title`,
    ...icon === undefined ? {} : { icon },
    ...description === undefined ? {} : { description: () => description },
  }
}

/**
 * Mount the body with the entries observable and a chain that renders its
 * fallback, which is what the chain does with no registrant.
 */
function mountGuide(entries: readonly SidebarRightGuideBox[], custom?: (key: string) => ReactNode,
  shortcuts: readonly ShortcutCatalogEntry[] = [], uniformEntries = false) {
  const guideEntries = createSnapshotStore<readonly SidebarRightGuideBox[]>(entries)
  const openTab = vi.fn()
  const renderSlot = vi.fn<GuideBodyProps['renderSlotChain']>((_seat, _owner, options) => options?.fallback)
  const props: GuideBodyProps = {
    uniformEntries,
    ...standard, SessionProvider: ({ children }) => children,
    useShortcuts: <T,>(selector: (entries: readonly ShortcutCatalogEntry[]) => T): T => selector(shortcuts),
    useTabInfo: () => ({ sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane-guide' as PaneId },
      tab: { ...TAB, visible: true, signal: new AbortController().signal,
        navigation: { address: TAB.contentId, params: undefined, revision: 0 },
        actions: { bindCommands: vi.fn(() => vi.fn()), openResource: vi.fn(), openTab, close: vi.fn() } } }),
    useGuideEntries: bindSnapshotSelector(guideEntries),
    renderSlotChain: renderSlot,
    t: (key: string) => key,
    renderSlot: vi.fn((_slot: string, _owner: unknown, options?: RenderOpts) =>
      (options?.entryKey === undefined ? undefined : custom?.(options.entryKey)) ?? options?.fallback),
  }
  const view = render(<GuideBody {...props} />)
  const boxes = (): string[] =>
    [...view.container.querySelectorAll('[data-sidebar-right-guide-entry]')].map(node => node.getAttribute('data-sidebar-right-guide-entry') ?? '')
  return { view, guideEntries, openTab, renderSlot, entrySlot: props.renderSlot, boxes, useTabInfo: props.useTabInfo }
}

describe('GuideBody', () => {
  it('keeps desktop cards uniform and opens the selected type in the same tab', () => {
    const custom = vi.fn(() => <button>Choose a shell</button>)
    const h = mountGuide([box('terminal', 20, Glyph, 'Run commands')], custom, [], true)
    expect(h.view.queryByText('Choose a shell')).toBeNull()
    expect(h.view.getByText('Run commands')).toBeDefined()
    fireEvent.click(h.view.getByRole('button'))
    expect(h.openTab).toHaveBeenCalledWith('terminal', { replaceTab: true })
    expect(custom).not.toHaveBeenCalled()
  })
  it('shows configured guide bindings and omits cleared key labels', () => {
    for (const keys of [['Ctrl', 'P'], []]) {
      const entry: ShortcutCatalogEntry = { id: 'workspace.files' as never, label: 'Files', aliases: [],
        binding: null, keys, aria: keys.length ? 'Control+P' : undefined, modified: true, conflicts: [], issue: null }
      const { view } = mountGuide([{ ...box('files', 10), commandId: entry.id }], undefined, [entry])
      expect(view.getByRole('button').getAttribute('aria-keyshortcuts')).toBe(entry.aria ?? null)
      expect(view.getByRole('button').textContent).toBe('files title')
      cleanup()
    }
  })
  it('renders the chain with the same tab hook, and the shipped guide as its fallback', () => {
    const { view, renderSlot, boxes, useTabInfo } = mountGuide([box('files', 10, Glyph), box('terminal', 20)])
    expect(renderSlot).toHaveBeenCalledWith('sidebar.right.tab.guide', {}, {
      hookContext: useTabInfo, fallback: expect.anything() as ReactNode,
    })
    const guide = view.container.querySelector('[data-sidebar-right-guide]')
    expect(guide?.textContent).toBe('tab.guide.headingtab.guide.subtitlefiles titleterminal title')
    // One capsule per entry, in the registry's order, each with its own title; only the first brought a glyph.
    expect(boxes()).toEqual(['files', 'terminal'])
    const [files, terminal] = [...view.container.querySelectorAll('[data-sidebar-right-guide-entry]')]
    expect(files?.textContent).toBe('files title')
    expect(files?.querySelector('[data-guide-glyph]')?.getAttribute('data-guide-glyph')).toBe('20')
    expect(terminal?.querySelector('[data-guide-glyph]')).toBeNull()
    // The entry without a glyph falls back to the shipped cube, at the same size, on the quieter ink.
    const placeholder = terminal?.querySelector('svg')
    expect(placeholder?.getAttribute('width')).toBe('20')
    expect(placeholder?.getAttribute('class')).toBe(css.placeholderInk)
    expect(files?.querySelector('svg')).toBeNull()
    cleanup()
  })

  it('picking a box without a reveal preference preserves the default opening behavior', () => {
    const { view, openTab } = mountGuide([box('files', 10)])
    const entry = view.container.querySelector('[data-sidebar-right-guide-entry="files"]')
    if (entry === null) throw new Error('expected the files box')
    fireEvent.click(entry)
    expect(openTab).toHaveBeenCalledWith('files', { replaceTab: true })
    cleanup()
  })


  it('draws an empty guide while no type contributed an entry, and follows the registry when one does', () => {
    const { view, guideEntries, boxes } = mountGuide([])
    expect(view.container.querySelector('[data-sidebar-right-guide]')).not.toBeNull()
    expect(boxes()).toEqual([])
    act(() => { guideEntries.set([box('files', 10)]) })
    expect(boxes()).toEqual(['files'])
    cleanup()
  })

  it('shows every entry description at a fixed glyph size regardless of entry count', () => {
    const four = [box('a', 10, Glyph, 'a desc'), box('b', 20), box('c', 30, undefined, 'c desc'), box('d', 40)]
    const { view, guideEntries } = mountGuide(four)
    const capsule = (kind: string) => view.container.querySelector(`[data-sidebar-right-guide-entry="${kind}"]`)
    expect(capsule('a')?.textContent).toBe('a titlea desc')
    expect(capsule('b')?.textContent).toBe('b title')
    expect(capsule('c')?.textContent).toBe('c titlec desc')
    // Descriptions keep rendering past four entries — the capsule grid clamps
    // them to two lines instead of dropping the text.
    act(() => { guideEntries.set([...four, box('e', 50)]) })
    expect(capsule('a')?.textContent).toBe('a titlea desc')
    expect(capsule('c')?.textContent).toBe('c titlec desc')
    cleanup()
  })

  it('keeps two boxes of one type at the same order apart', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { boxes } = mountGuide([
        { ...box('notes', 10), providerId: 'a:b', id: 'c' },
        { ...box('notes', 10), providerId: 'a', id: 'b:c' },
      ])
      expect(boxes()).toEqual(['notes', 'notes'])
      // React reports colliding keys through console.error; two boxes rendered
      // without one is the whole assertion.
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
      cleanup()
    }
  })
})

it('dispatches custom guide content by active provider identity and retains the fallback for other entries', () => {
  const custom = (key: string) => key === 'extension/terminal' ? <button>Choose a shell</button> : undefined
  const terminal = { ...box('terminal', 20), providerId: 'extension/terminal' }
  const h = mountGuide([box('files', 10), terminal], custom)
  expect(h.view.getByText('Choose a shell')).toBeDefined()
  expect(h.view.getByText('files title')).toBeDefined()
  expect(h.entrySlot).toHaveBeenCalledWith('sidebar.right.tab.guide.entry', {
    entryId: terminal.id, kind: 'terminal', title: 'terminal title',
  }, expect.objectContaining({ entryKey: 'extension/terminal', hookContext: h.useTabInfo }))
  act(() => { h.guideEntries.set([{ ...terminal, providerId: 'builtin/terminal' }]) })
  expect(h.view.queryByText('Choose a shell')).toBeNull()
  expect(h.view.getByText('terminal title')).toBeDefined()
})
