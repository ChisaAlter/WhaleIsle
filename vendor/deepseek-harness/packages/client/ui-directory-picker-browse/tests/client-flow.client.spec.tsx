// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, bindSnapshotSelector, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { apply, inject } from '../src/client/index.ts'
import { BrowseDirectoryFlowHero, BrowseDirectoryFlowSidebar } from '../src/client/flow.ts'
import type { RemoteFlowOwnerProps } from '../src/client/contract/slots.ts'
import { apply as nodeApply } from '../src/index.ts'
import { createPickerPreferenceStore } from '../src/client/store.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

const HOLES = ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow'] as const
const REMOTE_HOLES = [
  'conversation.hero.workspace.directoryFlow.remote',
  'sidebar.workspaces.directoryFlow.remote',
] as const

const HOME = '/home/u'
const homeListing: DirectoryListing = {
  path: HOME,
  home: HOME,
  crumbs: [{ name: '/', path: '/', hidden: false }, { name: 'u', path: HOME, hidden: false }],
  entries: [{ name: 'Documents', path: `${HOME}/Documents`, hidden: false }],
  truncated: false,
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const listDirectory = vi.fn(async (): Promise<DirectoryListing> => homeListing)
  const createDirectory = vi.fn(async (path: string, name: string) => `${path}/${name}`)
  ctx.provide('uiWorkspace', { listDirectory, createDirectory } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  return { ctx, slots, listDirectory, createDirectory, declare }
}

function owner(overrides: Partial<DirectoryFlowOwnerProps> = {}): DirectoryFlowOwnerProps {
  return {
    open: true, busy: false,
    onPicked: vi.fn(), onCancel: vi.fn(), onError: vi.fn(),
    ...overrides,
  }
}

// Every fixture carries the framework's standard props the slot renderer
// attaches to each entry; the flow components read none of them, so the
// snapshots stay empty.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

function standardProps(): GlobalStandardProps {
  return {
    ...allowAllAccess,
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
  }
}

/**
 * The framework-wired props a slot entry adds to the owner conversation:
 * the bound remote-occupancy selector hook and the narrowed renderSlot.
 * `remoteOwners` collects the owner share each renderSlot call passed, so a
 * spec can assert the remote occupant's contract verbatim.
 */
function slotProps<C extends typeof BrowseDirectoryFlowHero | typeof BrowseDirectoryFlowSidebar>(overrides: {
  occupied?: boolean
  renderSlot?: (share: RemoteFlowOwnerProps) => ReactNode
} = {}): Pick<ComponentProps<C>, 'useRemoteFlow' | 'renderSlot' | 'useStore' | 'actions'> & { remoteOwners: RemoteFlowOwnerProps[] } {
  const preference = createPickerPreferenceStore().create()
  const remoteOwners: RemoteFlowOwnerProps[] = []
  const renderSlot = ((_key: string, share: RemoteFlowOwnerProps): ReactNode => {
    remoteOwners.push(share)
    return overrides.renderSlot?.(share) ?? null
  }) as ComponentProps<C>['renderSlot']
  const useRemoteFlow = (<S,>(selector: (snapshot: boolean) => S): S =>
    selector(overrides.occupied ?? false))
  return { useRemoteFlow, renderSlot, remoteOwners, useStore: bindSnapshotSelector(preference), actions: preference.actions }
}

describe('directory-picker-browse client half', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'uiWorkspace', 'locale'])
  })

  it('fills both directory-flow holes for declarations before or after apply, and leaves with its fiber', async () => {
    const before = await bench()
    before.declare()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)
    // Registry-contribution disposal proof: the fiber going down empties the holes.
    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declare()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('declares a distinct remote child hole inside each flow entry, released with its fiber', async () => {
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // Each remote hole accepts an occupant only because its parent flow
    // entry declared it — a registration against an undeclared key throws.
    for (const hole of REMOTE_HOLES) {
      const dispose = b.slots.register({ name: hole } as never, () => null)
      expect(b.slots.entries(hole)).toHaveLength(1)
      dispose()
    }
    // Teardown releases the child declarations with the flow entries: a
    // remote registration against a released hole throws again.
    await fiber.dispose()
    for (const hole of REMOTE_HOLES) {
      expect(() => b.slots.register({ name: hole } as never, () => null)).toThrow()
    }
  })

  it('rolls back the outer injection when the second hole is already occupied', async () => {
    const b = await bench()
    b.declare()
    // Foreign occupant in the SECOND registered hole: the pair construction
    // throws after the outer injection installed its subscription.
    b.slots.register({ name: HOLES[1] } as never, () => null)
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      const fiber = b.ctx.plugin({ inject: [...inject], apply })
      await expect(fiber.await()).rejects.toThrow(/already has a registration/)
      // A leaked first deferral would now race this probe registration and
      // throw from its orphaned subscription against the HERO hole; the
      // rollback leaves only the activation failure itself (cordis re-raises
      // the apply throw as a late rejection — installFailLoud's contract).
      const disposeProbe = b.slots.register({ name: HOLES[0] } as never, () => null)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(rejections.map(String).filter(text => text.includes(HOLES[0]))).toEqual([])
      disposeProbe()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('rolls back wholesale and reports loudly when a rival injection wins declaration activation', async () => {
    const b = await bench()
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    process.on('uncaughtException', onUnhandled)
    try {
      // The rival subscribes first, so synchronous declaration notifications
      // let it occupy the pair before this provider's waiting injection runs.
      b.slots.inject(HOLES[0], () => b.slots.inject(HOLES[1], function* () {
        yield b.slots.register({ name: HOLES[0] } as never, () => null)
        yield b.slots.register({ name: HOLES[1] } as never, () => null)
      }))
      await b.ctx.plugin({ inject: [...inject], apply }).await()
      b.declare()
      await new Promise(resolve => setTimeout(resolve, 20))
      // The rival keeps both holes; this provider rolled back wholesale and
      // surfaced the conflict on the fail-loud channel — no partial mix.
      for (const hole of HOLES) expect(b.slots.entries(hole)).toHaveLength(1)
      expect(rejections.map(String).join('\n')).toContain('already has a registration')

      // Non-Error conflicts wrap before the loud rethrow (same channel).
      const c = await bench()
      await c.ctx.plugin({ inject: [...inject], apply }).await()
      const original = c.slots.register.bind(c.slots)
      const slotsAny = c.slots as { register: typeof original }
      slotsAny.register = ((options: never, component: never) => {
        if ((options as { name?: string }).name === HOLES[0]) throw 'string conflict'
        return original(options, component)
      }) as typeof original
      c.declare()
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(rejections.map(String).join('\n')).toContain('string conflict')
    } finally {
      process.off('unhandledRejection', onUnhandled)
      process.off('uncaughtException', onUnhandled)
    }
  })

  it('rolls back the zh dictionary when a rival already owns the namespace en slot', async () => {
    const b = await bench()
    b.declare()
    const locale = b.ctx.get('locale') as LocaleRuntime
    const disposeRival = locale.register('directory-browser', 'en', { 'browser.title': 'rival' })
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    // cordis re-raises the apply throw as a late rejection (installFailLoud's contract).
    process.on('unhandledRejection', onUnhandled)
    try {
      const fiber = b.ctx.plugin({ inject: [...inject], apply })
      await expect(fiber.await()).rejects.toThrow(/already has locale/)
      // The zh registration rolled back with the failure: once the rival
      // leaves, a fresh registrant owns the whole namespace again.
      disposeRival()
      const disposeZh = locale.register('directory-browser', 'zh', { 'browser.title': '空闲' })
      disposeZh()
    } finally {
      await new Promise(resolve => setTimeout(resolve, 0))
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('registers the dialog dictionaries and binds this package namespace', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(HOLES[0])[0]!
    const injected = (entry.inject as () => { t: (key: string) => string })()
    // zh is the shipped default locale.
    expect(injected.t('browser.title')).toBe('选择工作区目录')
    expect(injected.t('browser.newFolder')).toBe('新建文件夹')
    expect(injected.t('browser.showHidden')).toBe('显示隐藏文件')
    expect(injected.t('browser.tabLocal')).toBe('本机')
    expect(injected.t('browser.tabRemote')).toBe('远程')
  })

  it('shares the Windows preference across entry points and injects only an available Windows chooser', async () => {
    const pickWorkspaceDirectory = vi.fn(async () => 'D:\\project')
    vi.stubGlobal('shell', { platform: 'win32', pickWorkspaceDirectory })
    const b = await bench()
    b.declare()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const hero = b.slots.entries(HOLES[0])[0]!
    const sidebar = b.slots.entries(HOLES[1])[0]!
    const injected = (hero.inject as () => { pickNativeDirectory: (options: { title: string }) => Promise<string | null> })()
    await expect(injected.pickNativeDirectory({ title: 'Choose directory' })).resolves.toBe('D:\\project')
    expect(pickWorkspaceDirectory).toHaveBeenCalledExactlyOnceWith({ title: 'Choose directory' })
    expect(hero.store).toBe(sidebar.store)
    await fiber.dispose()
  })

  it('drives the injected browse calls through the hole entry', async () => {
    const b = await bench()
    b.declare()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries(HOLES[1])[0]!
    const injected = (entry.inject as () => {
      listDirectory: (path?: string) => Promise<DirectoryListing>
      createDirectory: (path: string, name: string) => Promise<string>
    })()
    await expect(injected.listDirectory()).resolves.toBe(homeListing)
    await expect(injected.createDirectory(HOME, 'fresh')).resolves.toBe(`${HOME}/fresh`)
    expect(b.listDirectory).toHaveBeenCalledOnce()
    expect(b.createDirectory).toHaveBeenCalledWith(HOME, 'fresh')
  })

  it('adapts the owner conversation onto the dialog: confirm picks, dismissal cancels', async () => {
    const props = owner()
    const listDirectory = vi.fn(async (): Promise<DirectoryListing> => homeListing)
    const t = (key: string): string => key
    render(
      <BrowseDirectoryFlowHero
        {...props}
        {...standardProps()}
        {...slotProps<typeof BrowseDirectoryFlowHero>()}
        listDirectory={listDirectory}
        createDirectory={vi.fn(async () => '')}
        t={t}
      />,
    )
    // The dialog opened at home; its confirm (browser.open) adopts the listed level.
    const openButton = screen.getByRole<HTMLButtonElement>('button', { name: 'browser.open' })
    await waitFor(() => { expect(openButton.disabled).toBe(false) })
    fireEvent.click(openButton)
    expect(props.onPicked).toHaveBeenCalledWith(HOME)
    fireEvent.click(screen.getByRole('button', { name: 'browser.cancel' }))
    expect(props.onCancel).toHaveBeenCalled()
    expect(props.onError).not.toHaveBeenCalled()
  })

  it('shows no tab strip while the remote hole is unoccupied', async () => {
    const slots = slotProps<typeof BrowseDirectoryFlowSidebar>({ occupied: false })
    render(
      <BrowseDirectoryFlowSidebar
        {...owner()}
        {...standardProps()}
        {...slots}
        listDirectory={vi.fn(async () => homeListing)}
        createDirectory={vi.fn(async () => '')}
        t={key => key}
      />,
    )
    await waitFor(() => { expect(screen.getByRole('button', { name: 'browser.open' })).toBeTruthy() })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(slots.remoteOwners).toEqual([])
  })

  it('shows the local/remote strip while occupied and feeds the occupant the owner share', async () => {
    const props = owner()
    const slots = slotProps<typeof BrowseDirectoryFlowHero>({
      occupied: true,
      renderSlot: share => (
        <div data-testid="remote-pane">
          {`open:${String(share.open)} active:${String(share.active)} busy:${String(share.busy)}`}
          <button onClick={() => { share.onPicked('/mirror/ws') }}>remote-pick</button>
        </div>
      ),
    })
    const flow = (flowProps: DirectoryFlowOwnerProps) => (
      <BrowseDirectoryFlowHero
        {...flowProps}
        {...standardProps()}
        {...slots}
        listDirectory={vi.fn(async () => homeListing)}
        createDirectory={vi.fn(async () => '')}
        t={key => key}
      />
    )
    const view = render(flow(props))
    // The strip renders with local selected; the remote pane stays unmounted
    // until first visited (lazy: an SSH occupant must not connect unseen).
    expect(screen.getByRole('tablist')).toBeTruthy()
    expect(screen.queryByTestId('remote-pane')).toBeNull()
    const localTab = screen.getByRole('tab', { name: 'browser.tabLocal' })
    const remoteTab = screen.getByRole('tab', { name: 'browser.tabRemote' })
    expect(localTab.getAttribute('aria-selected')).toBe('true')
    expect(remoteTab.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(remoteTab)
    const pane = screen.getByTestId('remote-pane')
    expect(pane.textContent).toContain('open:true active:true busy:false')
    // The remote pick carries the owner conversation verbatim.
    fireEvent.click(screen.getByRole('button', { name: 'remote-pick' }))
    expect(props.onPicked).toHaveBeenCalledWith('/mirror/ws')
    // A busy flip mid-interaction reaches the occupant through the share.
    view.rerender(flow(owner({ ...props, busy: true })))
    expect(pane.textContent).toContain('busy:true')

    // Switching back hides the pane but keeps it mounted (occupant state
    // survives): active flips to false on the SAME mounted element. (Tabs
    // disable while busy, so the flip is withdrawn first.)
    view.rerender(flow(props))
    fireEvent.click(localTab)
    expect(pane.isConnected).toBe(true)
    expect(pane.textContent).toContain('active:false')
    expect(screen.getByRole('button', { name: 'browser.open' })).toBeTruthy()
  })

  it('keeps the remote occupant mounted (hidden) while the dialog is closed', () => {
    const slots = slotProps<typeof BrowseDirectoryFlowHero>({
      occupied: true,
      renderSlot: share => <span data-testid="remote-pane">{`open:${String(share.open)}`}</span>,
    })
    const flow = (open: boolean) => (
      <BrowseDirectoryFlowHero
        {...owner({ open })}
        {...standardProps()}
        {...slots}
        listDirectory={vi.fn(async () => homeListing)}
        createDirectory={vi.fn(async () => '')}
        t={key => key}
      />
    )
    const view = render(flow(true))
    fireEvent.click(screen.getByRole('tab', { name: 'browser.tabRemote' }))
    expect(screen.getByTestId('remote-pane').isConnected).toBe(true)
    // Closing withdraws the request but does not unmount the occupant: its
    // share flips to open:false on the same mounted element.
    view.rerender(flow(false))
    const pane = screen.getByTestId('remote-pane')
    expect(pane.isConnected).toBe(true)
    expect(pane.textContent).toBe('open:false')
  })

  it('renders nothing while the flow is closed and the remote hole was never visited', () => {
    const view = render(
      <BrowseDirectoryFlowHero
        {...owner({ open: false })}
        {...standardProps()}
        {...slotProps<typeof BrowseDirectoryFlowHero>({ occupied: true })}
        listDirectory={vi.fn(async () => homeListing)}
        createDirectory={vi.fn(async () => '')}
        t={key => key}
      />,
    )
    expect(view.container.innerHTML).toBe('')
  })
})

describe('directory-picker-browse node half', () => {
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
