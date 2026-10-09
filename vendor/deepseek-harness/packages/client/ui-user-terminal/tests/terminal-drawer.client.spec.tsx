// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Ghostty needs a real layout to fit; the pane integration is asserted against
// a scripted fake that records writes, data handlers, and disposal.
const ghosttyState = vi.hoisted(() => ({ instances: [] as Array<{
  writes: string[]
  resets: string[]
  dataHandlers: Array<(data: string) => void>
  selectionHandlers: Array<() => void>
  selection: string
  disposed: boolean
  cols: number
  rows: number
  fontFamily: string
  fontSize: number
  themeWrites: unknown[]
  focusCalls: number
  scrollToBottomCalls: number
  atBottom: boolean
  options: {
    onData: (data: string) => void
    onResize: (cols: number, rows: number) => void
    onSelectionChange: () => void
    onCopy: (text: string) => void
    beforeKey: (event: KeyboardEvent) => boolean
    onLinkActivate: (text: string, event: MouseEvent) => void
    font?: { family?: string, size?: number }
    theme?: unknown
  }
  getSelection: () => string
  hasSelection: () => boolean
  clearSelection: () => void
  focus: () => void
  scrollToBottom: () => void
  isAtBottom: () => boolean
  fit: () => boolean
  write: (data: string) => void
  resetAndWrite: (data: string) => void
  setTheme: (theme: unknown) => void
}>, throwFit: false, cols: 80, rows: 24, delayMs: 0, createError: null as unknown }))

vi.mock('../src/client/ghostty/surface.ts', () => {
  class FakeGhosttySurface {
    cols = 80
    rows = 24
    writes: string[] = []
    resets: string[] = []
    dataHandlers: Array<(data: string) => void> = []
    selectionHandlers: Array<() => void> = []
    selection = ''
    disposed = false
    fontFamily = ''
    fontSize = 0
    themeWrites: unknown[] = []
    focusCalls = 0
    scrollToBottomCalls = 0
    atBottom = true
    options: (typeof ghosttyState)['instances'][number]['options']
    constructor(options: (typeof ghosttyState)['instances'][number]['options']) {
      this.options = options
      this.fontFamily = options.font?.family ?? ''
      this.fontSize = options.font?.size ?? 0
      this.themeWrites = options.theme === undefined ? [] : [options.theme]
      this.cols = ghosttyState.cols
      this.rows = ghosttyState.rows
      this.dataHandlers.push(options.onData)
      this.selectionHandlers.push(options.onSelectionChange)
      options.onSelectionChange()
    }
    static async create(_mount: HTMLElement, options: FakeGhosttySurface['options']): Promise<FakeGhosttySurface> {
      if (ghosttyState.createError !== null) {
        const error = ghosttyState.createError
        ghosttyState.createError = null
        throw error
      }
      if (ghosttyState.delayMs > 0) {
        await new Promise<void>(resolve => { window.setTimeout(resolve, ghosttyState.delayMs) })
      }
      const surface = new FakeGhosttySurface(options)
      ghosttyState.instances.push(surface as never)
      return surface
    }
    write(data: string): void { this.writes.push(data) }
    resetAndWrite(data: string): void {
      this.resets.push(data)
      this.writes.push(data)
    }
    setTheme(theme: unknown): void { this.themeWrites.push(theme) }
    fit(): boolean {
      if (ghosttyState.throwFit) return false
      if (this.cols <= 0 || this.rows <= 0) return false
      this.options.onResize(this.cols, this.rows)
      if (this.atBottom) this.scrollToBottom()
      return true
    }
    focus(): void { this.focusCalls += 1 }
    scrollToBottom(): void { this.scrollToBottomCalls += 1 }
    isAtBottom(): boolean { return this.atBottom }
    getSelection(): string { return this.selection }
    hasSelection(): boolean { return this.selection.length > 0 }
    clearSelection(): void { this.selection = '' }
    dispose(): void { this.disposed = true }
  }
  return {
    GhosttyTerminalSurface: FakeGhosttySurface,
    DEFAULT_TERMINAL_FONT_SIZE: 12,
    DEFAULT_TERMINAL_FONT_FAMILY:
      '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", ' +
      '"Symbols Nerd Font Mono", "Symbols Nerd Font", "JetBrainsMono Nerd Font", ' +
      '"JetBrainsMono NF", "FiraCode Nerd Font", "Hack Nerd Font", "MesloLGS NF", ' +
      '"CaskaydiaCove Nerd Font", "PowerlineSymbols", monospace',
  }
})

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TerminalDrawerProps } from '../src/client/TerminalDrawer.tsx'
import { TerminalDrawer } from '../src/client/TerminalDrawer.tsx'
import { TerminalPane } from '../src/client/TerminalPane.tsx'
import type { TerminalSurfaceProps } from '../src/client/TerminalSurface.tsx'
import { TerminalSurface } from '../src/client/TerminalSurface.tsx'
import { createTerminalSessionStore, DEFAULT_TERMINAL_COLS, DEFAULT_TERMINAL_ROWS, MAX_TERMINALS_PER_GROUP, type TerminalSessionRecord } from '../src/client/stores.ts'
import { clampDrawerHeight, maxDrawerHeight, TERMINAL_DRAWER_MIN } from '../src/client/height.ts'
import { FIT_SETTLE_MS, PTY_RESIZE_DEBOUNCE_MS } from '../src/client/fit.ts'
import { en, zh } from '../src/client/locales.ts'
import { bindPtyListeners } from '../src/client/pty-bridge.ts'

const SID = 'session-term' as SessionId
const t: TerminalDrawerProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('terminal drawer must not read this hook') }) as never
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never

function sessionList(cwd: string | undefined, workingDirectory?: string): SessionListState {
  const current = cwd === undefined ? undefined : SID
  const byId = current === undefined
    ? {}
    : {
        [SID]: {
          id: SID,
          displayTitle: 'proj',
          running: false,
          blank: false,
          retainedBy: { mainView: 1 },
          updatedAt: 1,
          ...(cwd ? { cwd } : {}),
          ...(workingDirectory === undefined ? {} : { presentation: { owner: 'project', title: 'Project', workingDirectory } }),
        },
      }
  return {
    ids: current === undefined ? [] : [SID],
    byId,
    phase: 'ready',
    projectionsBySession: {},
  }
}

function bindStore(instance: ReturnType<ReturnType<typeof createTerminalSessionStore>['create']>) {
  return {
    useStore: <S,>(sel: (state: ReturnType<typeof instance.getSnapshot>) => S) => {
      const snap = useSyncExternalStore(instance.subscribe, instance.getSnapshot, instance.getSnapshot)
      return sel(snap)
    },
    actions: instance.actions,
  }
}

function mount(opts: {
  cwd?: string | undefined
  workingDirectory?: string
  sessionId?: SessionId | undefined | null
  handle?: ReturnType<typeof createTerminalSessionStore>
  instance?: ReturnType<ReturnType<typeof createTerminalSessionStore>['create']>
  surface?: boolean
  surfaceHandle?: ReturnType<typeof createTerminalSessionStore>
  surfaceInstance?: ReturnType<ReturnType<typeof createTerminalSessionStore>['create']>
  ptyCreate?: (input: { cwd: string }) => Promise<{ id: string }>
  t?: TerminalDrawerProps['t']
} = {}) {
  const handle = opts.handle ?? createTerminalSessionStore()
  const instance = opts.instance ?? handle.create('session-1')
  const surfaceHandle = opts.surfaceHandle ?? (opts.surface ? createTerminalSessionStore() : handle)
  const surfaceInstance = opts.surfaceInstance ?? (opts.surface ? surfaceHandle.create('session-1') : instance)
  let seq = 0
  const ptyCreate = opts.ptyCreate ?? vi.fn(async (_input: { cwd: string }) => ({ id: `pty-${++seq}` }))
  const ptyWrite = vi.fn(async () => {})
  const ptyAck = vi.fn(async () => {})
  const ptyResize = vi.fn(async () => {})
  const ptyKill = vi.fn(async () => {})
  const dataHandlers: Array<(payload: { id: string; data: string; seq: number }) => void> = []
  const exitHandlers: Array<(payload: { id: string; code: number }) => void> = []
  const onPtyData = vi.fn((handler: (payload: { id: string; data: string; seq: number }) => void) => {
    dataHandlers.push(handler)
    return () => {}
  })
  const onPtyExit = vi.fn((handler: (payload: { id: string; code: number }) => void) => {
    exitHandlers.push(handler)
    return () => {}
  })
  const toggleTerminalDrawer = vi.fn()
  const setTerminalDrawer = vi.fn()
  const mentionTerminal = vi.fn()
  const writeClipboard = vi.fn(async () => {})
  const openWorkspacePath = vi.fn()
  const openLocalUrl = vi.fn()
  const openExternal = vi.fn()
  const store = bindStore(instance)
  const surfaceStore = opts.surface ? bindStore(surfaceInstance) : store
  const shared = {
    sessionId: opts.sessionId === null
      ? undefined
      : (opts.sessionId === undefined && opts.cwd === undefined ? undefined : (opts.sessionId ?? SID)),
    useSession: neverHook,
    useSessions: ((sel: (s: SessionListState) => unknown) => sel(sessionList(opts.cwd, opts.workingDirectory))) as TerminalDrawerProps['useSessions'],
    useWorkspaces: neverHook,
    useProjection: neverHook,
    useConversation: neverHook,
    useSessionStatus: neverHook,
    useSessionRetainInfo: () => undefined,
    useInput: neverHook,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    inputActions: undefined,
    ...store,
    ptyCreate,
    ptyWrite,
    ptyAck,
    ptyResize,
    ptyKill,
    onPtyData,
    onPtyExit,
    toggleTerminalDrawer,
    setTerminalDrawer,
    mentionTerminal,
    writeClipboard,
    openWorkspacePath,
    openLocalUrl,
    openExternal,
    t: opts.t ?? t,
  }
  const view = render(
    <>
      <TerminalDrawer {...shared} />
      {opts.surface
        ? <TerminalSurface {...(shared as unknown as TerminalSurfaceProps)} {...surfaceStore} />
        : null}
    </>,
  )
  return {
    ptyCreate, ptyWrite, ptyAck, ptyResize, ptyKill, toggleTerminalDrawer, setTerminalDrawer,
    mentionTerminal, writeClipboard, openWorkspacePath, openLocalUrl, openExternal,
    instance, handle,
    surfaceHandle, surfaceInstance,
    onPtyData, onPtyExit, dataHandlers, exitHandlers,
    rerender: view.rerender, shared,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  ghosttyState.instances.length = 0
  ghosttyState.throwFit = false
  ghosttyState.cols = 80
  ghosttyState.rows = 24
  ghosttyState.delayMs = 0
  ghosttyState.createError = null
})

describe('clampDrawerHeight', () => {
  it('floors at TERMINAL_DRAWER_MIN and caps at 75% of the viewport', () => {
    expect(clampDrawerHeight(1, 800)).toBe(TERMINAL_DRAWER_MIN)
    expect(clampDrawerHeight(900, 800)).toBe(maxDrawerHeight(800))
    expect(maxDrawerHeight(800)).toBe(600)
  })
})

describe('TerminalDrawer', () => {
  it('starts a user terminal in the bound Project directory instead of the coordinator storage cwd', async () => {
    const b = mount({ cwd: '/profile/project-store', workingDirectory: '/work/project-code' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledExactlyOnceWith({ cwd: '/work/project-code' }))
  })

  it('does not create a PTY when the session has no cwd', () => {
    const b = mount({ cwd: undefined, sessionId: undefined })
    expect(screen.getByText('A workspace is required to start a terminal')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'New terminal' }).disabled).toBe(true)
    expect(b.ptyCreate).not.toHaveBeenCalled()
  })

  it('creates a PTY on New and closes it from the toolbar', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledWith({ cwd: '/work' }))
    expect(await screen.findByRole('log', { name: 'pty-1' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
    await waitFor(() => expect(b.ptyKill).toHaveBeenCalledWith('pty-1'))
    expect(screen.queryByRole('log', { name: 'pty-1' })).toBeNull()
  })

  it('splits up to MAX_TERMINALS_PER_GROUP and then disables split', async () => {
    mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    for (let index = 2; index <= MAX_TERMINALS_PER_GROUP; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Split left/right' }))
      await screen.findByRole('log', { name: `pty-${index}` })
    }
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Split left/right (max 4 per group)' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Split top/bottom (max 4 per group)' }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Split left/right (max 4 per group)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Split top/bottom (max 4 per group)' }))
    expect(screen.queryByRole('log', { name: 'pty-5' })).toBeNull()
  })

  it('keeps drawer and surface session tables independent', async () => {
    const handle = createTerminalSessionStore()
    const instance = handle.create('session-1')
    const surfaceHandle = createTerminalSessionStore()
    const surfaceInstance = surfaceHandle.create('session-1')
    mount({ cwd: '/work', handle, instance, surface: true, surfaceHandle, surfaceInstance })
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[0]!)
    await screen.findByRole('log', { name: 'pty-1' })
    expect(instance.getSnapshot().sessions.map(session => session.id)).toEqual(['pty-1'])
    expect(surfaceInstance.getSnapshot().sessions).toHaveLength(0)
    expect(screen.queryAllByRole('log', { name: 'pty-1' })).toHaveLength(1)
  })

  it('writes a clamped height through setTerminalDrawer on drag', () => {
    const b = mount({ cwd: '/work' })
    const handle = screen.getByRole('separator', { name: 'Resize terminal drawer' })
    handle.getBoundingClientRect = () => ({
      x: 0, y: 400, width: 800, height: 6, top: 400, left: 0, bottom: 406, right: 800, toJSON() { return {} },
    })
    fireEvent.pointerDown(handle, { button: 0, clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(b.setTerminalDrawer).toHaveBeenCalled()
    const next = b.setTerminalDrawer.mock.calls.at(-1)?.[0] as number
    expect(next).toBeGreaterThanOrEqual(TERMINAL_DRAWER_MIN)
    expect(next).toBeLessThanOrEqual(maxDrawerHeight(window.innerHeight))
  })

  it('maximize writes 75% of the viewport and restore writes the previous height', () => {
    const b = mount({ cwd: '/work' })
    const root = document.querySelector('[data-terminal-owner="drawer"]') as HTMLElement
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 280 })
    fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(b.setTerminalDrawer).toHaveBeenCalledWith(maxDrawerHeight(window.innerHeight))
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expect(b.setTerminalDrawer).toHaveBeenLastCalledWith(280)
  })

  it('omits maximize on the surfaces.terminal occupant', async () => {
    mount({ cwd: '/work', surface: true })
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[0]!)
    await screen.findAllByRole('log')
    const surface = document.querySelector('[data-terminal-owner="surface"]') as HTMLElement
    expect(surface).toBeTruthy()
    expect(surface.querySelector('[aria-label="Maximize"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeTruthy()
  })

  it('copies a selection, appends it to chat, and opens a URL from the selection bar', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.selection = 'http://127.0.0.1:5173\n'
    for (const handler of term.selectionHandlers) handler()
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }))
    expect(b.writeClipboard).toHaveBeenCalledWith('http://127.0.0.1:5173')
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }))
    expect(b.openLocalUrl).toHaveBeenCalledWith('http://127.0.0.1:5173')
    fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
    expect(b.mentionTerminal).toHaveBeenCalledWith(SID, 'http://127.0.0.1:5173')
    term.options.onCopy('copied-bytes')
    expect(b.writeClipboard).toHaveBeenCalledWith('copied-bytes')
    expect(term.options.beforeKey(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true)
    expect(term.options.beforeKey(new KeyboardEvent('keydown', {
      key: 'l', ctrlKey: true, bubbles: true, cancelable: true,
    }))).toBe(false)
    expect(b.ptyWrite).toHaveBeenCalledWith('pty-1', '\u000c')
    expect(term.options.beforeKey(new KeyboardEvent('keydown', {
      key: 'ArrowLeft', ctrlKey: true, bubbles: true, cancelable: true,
    }))).toBe(false)
    expect(b.ptyWrite).toHaveBeenCalledWith('pty-1', '\u001bb')
    const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel')
    expect(term.options.beforeKey(new KeyboardEvent('keydown', {
      key: 'Backspace', metaKey: true, bubbles: true, cancelable: true,
    }))).toBe(false)
    expect(b.ptyWrite).toHaveBeenCalledWith('pty-1', '\u0015')
    platform.mockRestore()
  })

  it('refuses Ctrl+` so the drawer toggle bubbles instead of feeding the PTY', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    b.ptyWrite.mockClear()
    const ctrlBackquote = new KeyboardEvent('keydown', {
      key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true,
    })
    expect(term.options.beforeKey(ctrlBackquote)).toBe(false)
    // The pane must not consume the event: the titlebar window listener owns
    // the toggle and the preventDefault.
    expect(ctrlBackquote.defaultPrevented).toBe(false)
    const metaBackquote = new KeyboardEvent('keydown', {
      key: '`', code: 'Backquote', metaKey: true, bubbles: true, cancelable: true,
    })
    expect(term.options.beforeKey(metaBackquote)).toBe(false)
    // A plain backtick still reaches the shell.
    expect(term.options.beforeKey(new KeyboardEvent('keydown', { key: '`', code: 'Backquote' }))).toBe(true)
    expect(b.ptyWrite).not.toHaveBeenCalled()
  })

  it('opens a non-loopback URL from the selection bar in the system browser', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.selection = 'https://example.com/docs\n'
    for (const handler of term.selectionHandlers) handler()
    fireEvent.click(await screen.findByRole('button', { name: 'Open link' }))
    expect(b.openExternal).toHaveBeenCalledWith('https://example.com/docs')
    expect(b.openLocalUrl).not.toHaveBeenCalled()
  })

  it('disables Add to chat when the session id is missing', async () => {
    const b = mount({ cwd: '/work', sessionId: null })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.selection = 'ls\n'
    for (const handler of term.selectionHandlers) handler()
    const add = await screen.findByRole('button', { name: 'Add to chat' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(add)
    expect(b.mentionTerminal).not.toHaveBeenCalled()
  })

  it('activates a Ctrl-clicked terminal URL through the Ghostty link callback', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' })
    term.options.onLinkActivate('http://127.0.0.1:5173', { ctrlKey: true, metaKey: false } as MouseEvent)
    expect(b.openLocalUrl).toHaveBeenCalledWith('http://127.0.0.1:5173')
    term.options.onLinkActivate('http://127.0.0.1:5173', { ctrlKey: false, metaKey: false } as MouseEvent)
    expect(b.openLocalUrl).toHaveBeenCalledTimes(1)
  })

  it('does not register its own Ctrl+` listener; the titlebar toggle owns the shortcut', () => {
    const withCwd = mount({ cwd: '/work' })
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(withCwd.toggleTerminalDrawer).not.toHaveBeenCalled()
    cleanup()
    const without = mount({ cwd: undefined, sessionId: undefined })
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(without.toggleTerminalDrawer).not.toHaveBeenCalled()
  })

  it('fans one PTY subscription to both stores and only the owner records data', async () => {
    const handle = createTerminalSessionStore()
    const instance = handle.create('session-1')
    const surfaceHandle = createTerminalSessionStore()
    const surfaceInstance = surfaceHandle.create('session-1')
    const b = mount({ cwd: '/work', handle, instance, surface: true, surfaceHandle, surfaceInstance })
    bindPtyListeners([handle, surfaceHandle], { onPtyData: b.onPtyData, onPtyExit: b.onPtyExit, ptyAck: b.ptyAck })
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[0]!)
    await screen.findByRole('log', { name: 'pty-1' })
    expect(b.onPtyData).toHaveBeenCalledTimes(1)
    for (const handler of b.dataHandlers) handler({ id: 'pty-1', data: 'hello', seq: 1 })
    expect(instance.getSnapshot().sessions[0]?.buffer).toBe('hello')
    expect(surfaceInstance.getSnapshot().sessions).toHaveLength(0)
    await waitFor(() => {
      expect(ghosttyState.instances.every(term => term.writes.join('') === 'hello')).toBe(true)
    })
  })

  it('lets each empty shell auto-create its own PTY', async () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 })
        const run = () => { this.cb([] as never, this as never) }
        observers.push(run)
        run()
      }
      disconnect() {}
      unobserve() {}
    })
    const b = mount({ cwd: '/work', surface: true })
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledTimes(2))
    for (const run of observers) run()
    await Promise.resolve()
    expect(b.ptyCreate).toHaveBeenCalledTimes(2)
    expect(b.instance.getSnapshot().sessions).toHaveLength(1)
    expect(b.surfaceInstance.getSnapshot().sessions).toHaveLength(1)
  })

  it('keeps a stale empty-state New click idempotent after auto-create settles', async () => {
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        this.cb([] as never, this as never)
      }
      disconnect() {}
      unobserve() {}
    })
    const b = mount({ cwd: '/work' })
    const emptyStateNew = screen.getByRole('button', { name: 'New terminal' })
    await screen.findByRole('log', { name: 'pty-1' })

    expect(emptyStateNew.isConnected).toBe(false)
    fireEvent.click(emptyStateNew)
    expect(b.ptyCreate).toHaveBeenCalledTimes(1)
    expect(b.instance.getSnapshot().sessions.map(session => session.id)).toEqual(['pty-1'])

    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-2' })
    expect(b.ptyCreate).toHaveBeenCalledTimes(2)
  })

  it('closes the session when onPtyExit fires', async () => {
    const handle = createTerminalSessionStore()
    const instance = handle.create('session-1')
    const b = mount({ cwd: '/work', handle, instance })
    bindPtyListeners([handle], { onPtyData: b.onPtyData, onPtyExit: b.onPtyExit, ptyAck: b.ptyAck })
    fireEvent.click(screen.getAllByRole('button', { name: 'New terminal' })[0]!)
    await screen.findAllByRole('log', { name: 'pty-1' })
    for (const handler of b.exitHandlers) handler({ id: 'pty-1', code: 0 })
    await waitFor(() => expect(instance.getSnapshot().sessions).toHaveLength(0))
    expect(screen.queryByRole('log', { name: 'pty-1' })).toBeNull()
  })

  it('forwards Ghostty input to the PTY and does not nest a button around the pane', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    const log = await screen.findByRole('log', { name: 'pty-1' })
    expect(log.closest('button')).toBeNull()
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    for (const handler of term.dataHandlers) handler('ls\r')
    expect(b.ptyWrite).toHaveBeenCalledWith('pty-1', 'ls\r')
  })

  it('does not auto-create after the last pane is closed', async () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 })
        const run = () => { this.cb([] as never, this as never) }
        observers.push(run)
        run()
      }
      disconnect() {}
      unobserve() {}
    })
    const b = mount({ cwd: '/work' })
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))
    await waitFor(() => expect(b.ptyKill).toHaveBeenCalledWith('pty-1'))
    expect(screen.queryByRole('log', { name: 'pty-1' })).toBeNull()
    for (const run of observers) run()
    await Promise.resolve()
    expect(b.ptyCreate).toHaveBeenCalledTimes(1)
    expect(b.instance.getSnapshot().sessions).toHaveLength(0)
  })

  it('constructs Ghostty with a resolved monospace family', async () => {
    mount({ cwd: '/work' })
    expect(screen.getByRole('button', { name: 'Split left/right' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Split top/bottom' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    expect(term.fontFamily.includes('var(')).toBe(false)
    expect(term.fontFamily.length).toBeGreaterThan(0)
    expect(term.themeWrites.length).toBeGreaterThanOrEqual(2)
    document.documentElement.classList.add('dark')
    await waitFor(() => expect(term.themeWrites.length).toBeGreaterThanOrEqual(3))
    document.documentElement.classList.remove('dark')
    document.body.setAttribute('data-ds-dark-theme', '')
    await waitFor(() => expect(term.themeWrites.length).toBeGreaterThanOrEqual(4))
    document.body.removeAttribute('data-ds-dark-theme')
  })

  it('writes Ghostty init failure copy onto the mount', async () => {
    ghosttyState.createError = new Error('wasm-down')
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => {
      expect(screen.getByRole('log', { name: 'pty-1' }).textContent).toContain('wasm-down')
    })
    expect(b.ptyWrite).not.toHaveBeenCalled()
  })

  it('uses Ghostty fallback copy when create rejects a non-Error', async () => {
    ghosttyState.createError = 'nope'
    mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => {
      expect(screen.getByRole('log', { name: 'pty-1' }).textContent).toContain(
        'Unable to initialize libghostty-vt',
      )
    })
  })

  it('does not answer ConPTY DA from the pane; Ghostty owns device attributes', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    await waitFor(() => expect(ghosttyState.instances.at(-1)).toBeTruthy())
    expect(b.ptyWrite).not.toHaveBeenCalledWith('pty-1', '\x1b[?61;4c')
  })

  it('shows a session list after a second PTY and can activate or close a row', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => expect(b.instance.getSnapshot().sessions).toHaveLength(2))
    const list = screen.getByRole('list', { name: 'Terminal sessions' })
    expect(list).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Group 2$/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Group 2$/ }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-2')
    fireEvent.click(screen.getByRole('button', { name: /^Group 1$/ }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-1')
    fireEvent.click(screen.getByRole('button', { name: /^Terminal 2$/ }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-2')
    fireEvent.click(screen.getByRole('button', { name: /^Terminal 1$/ }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-1')
    fireEvent.click(screen.getByRole('button', { name: /^Close terminal Terminal 2$/ }))
    await waitFor(() => expect(b.ptyKill).toHaveBeenCalledWith('pty-2'))
    expect(b.instance.getSnapshot().sessions.map(session => session.id)).toEqual(['pty-1'])
    expect(screen.queryByRole('list', { name: 'Terminal sessions' })).toBeNull()
  })

  it('tiles a vertical split as stacked panes', async () => {
    mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Split top/bottom' }))
    await screen.findByRole('log', { name: 'pty-2' })
    const panes = document.querySelector('[data-split-direction="vertical"]')
    expect(panes).toBeTruthy()
    expect((panes as HTMLElement).style.gridTemplateRows).toContain('minmax(0, 1fr)')
  })

  it('does not resize the PTY from workspace width/8 math', async () => {
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 })
        this.cb([] as never, this as never)
      }
      disconnect() {}
      unobserve() {}
    })
    const b = mount({ cwd: '/work' })
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledTimes(1))
    await screen.findByRole('log', { name: 'pty-1' })
    expect(b.instance.getSnapshot().sessions[0]?.cols).toBe(DEFAULT_TERMINAL_COLS)
    expect(b.instance.getSnapshot().sessions[0]?.rows).toBe(DEFAULT_TERMINAL_ROWS)
  })

  it('does not settle-fit a zero-used-box pane', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    const fit = vi.spyOn(term, 'fit')
    await new Promise(resolve => {
      window.setTimeout(resolve, FIT_SETTLE_MS + 20)
    })
    expect(fit).not.toHaveBeenCalled()
    expect(b.ptyResize).not.toHaveBeenCalled()
  })

  it('forwards Ghostty onResize like TerminalViewport', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.options.onResize(80, 24)
    expect(b.ptyResize).toHaveBeenCalledWith('pty-1', 80, 24)
  })

  it('resizes the PTY from Ghostty fit once the host has a used box', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledTimes(1))
    const log = await screen.findByRole('log', { name: 'pty-1' })
    Object.defineProperty(log, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(log, 'clientHeight', { configurable: true, value: 200 })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.fit()
    expect(b.ptyResize).toHaveBeenCalledWith('pty-1', 80, 24)
    const resizes = b.ptyResize.mock.calls.length
    term.fit()
    expect(b.ptyResize.mock.calls.length).toBeGreaterThanOrEqual(resizes)
  })

  it('keeps the scrollback position on the settle fit unless the viewport was at the bottom', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await waitFor(() => expect(b.ptyCreate).toHaveBeenCalledTimes(1))
    await screen.findByRole('log', { name: 'pty-1' })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    term.atBottom = true
    term.fit()
    expect(term.scrollToBottomCalls).toBeGreaterThan(0)
    const followsAtBottom = term.scrollToBottomCalls
    term.atBottom = false
    term.fit()
    expect(term.scrollToBottomCalls).toBe(followsAtBottom)
    term.atBottom = true
    term.fit()
    expect(term.scrollToBottomCalls).toBeGreaterThan(followsAtBottom)
  })

  it('does not follow output on the settle fit when Ghostty is not at the bottom', async () => {
    mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    const before = term.scrollToBottomCalls
    term.atBottom = false
    await new Promise(resolve => {
      window.setTimeout(resolve, FIT_SETTLE_MS + 20)
    })
    expect(term.scrollToBottomCalls).toBe(before)
  })

  it('replays the PTY buffer when a pane remounts', async () => {
    const handle = createTerminalSessionStore()
    const instance = handle.create('session-1')
    const b = mount({ cwd: '/work', handle, instance })
    bindPtyListeners([handle], { onPtyData: b.onPtyData, onPtyExit: b.onPtyExit, ptyAck: b.ptyAck })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    for (const handler of b.dataHandlers) handler({ id: 'pty-1', data: 'hello-seed', seq: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-2' })
    fireEvent.click(screen.getByRole('button', { name: /^Group 1$/ }))
    await screen.findByRole('log', { name: 'pty-1' })
    await waitFor(() => {
      expect(ghosttyState.instances.some(term => term.resets.join('').includes('hello-seed'))).toBe(true)
    })
  })

  it('opens Ghostty when ResizeObserver is missing', async () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    await waitFor(() => expect(ghosttyState.instances.at(-1)).toBeTruthy())
    expect(b.ptyResize).not.toHaveBeenCalled()
  })

  it('focuses the active pane and follows sidebar activation', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Split top/bottom' }))
    await screen.findByRole('log', { name: 'pty-2' })
    await waitFor(() => {
      expect(ghosttyState.instances[1]?.focusCalls).toBeGreaterThan(0)
    })
    const firstFocus = ghosttyState.instances[0]!.focusCalls
    fireEvent.click(screen.getByRole('button', { name: /^Terminal 1$/ }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-1')
    await waitFor(() => {
      expect(ghosttyState.instances[0]!.focusCalls).toBeGreaterThan(firstFocus)
    })
  })

  it('activates a pane from pointerdown on its host without waiting for click', async () => {
    const b = mount({ cwd: '/work' })
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    await screen.findByRole('log', { name: 'pty-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Split top/bottom' }))
    await screen.findByRole('log', { name: 'pty-2' })
    expect(b.instance.getSnapshot().activeId).toBe('pty-2')
    fireEvent.pointerDown(screen.getByRole('log', { name: 'pty-1' }))
    expect(b.instance.getSnapshot().activeId).toBe('pty-1')
  })

  it('skips PTY resize when FitAddon throws or the grid is empty', async () => {
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 })
        this.cb([] as never, this as never)
      }
      disconnect() {}
      unobserve() {}
    })
    ghosttyState.throwFit = true
    const throwing = mount({ cwd: '/work' })
    await waitFor(() => expect(throwing.ptyCreate).toHaveBeenCalledTimes(1))
    await screen.findByRole('log', { name: 'pty-1' })
    await new Promise(resolve => {
      window.setTimeout(resolve, FIT_SETTLE_MS + PTY_RESIZE_DEBOUNCE_MS + 50)
    })
    expect(throwing.ptyResize).not.toHaveBeenCalled()
    cleanup()
    ghosttyState.throwFit = false
    ghosttyState.cols = 0
    ghosttyState.rows = 0
    const empty = mount({ cwd: '/work' })
    await waitFor(() => expect(empty.ptyCreate).toHaveBeenCalledTimes(1))
    await screen.findByRole('log', { name: 'pty-1' })
    await new Promise(resolve => {
      window.setTimeout(resolve, FIT_SETTLE_MS + PTY_RESIZE_DEBOUNCE_MS + 50)
    })
    expect(empty.ptyResize).not.toHaveBeenCalled()
  })

  it('shows Chinese copy on ptyCreate rejection and does not auto-retry', async () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) { this.cb = cb }
      observe(el: Element) {
        Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
        Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 })
        const run = () => { this.cb([] as never, this as never) }
        observers.push(run)
        run()
      }
      disconnect() {}
      unobserve() {}
    })
    const ptyCreate = vi.fn(async () => { throw new Error('node-pty is not available') })
    mount({
      cwd: '/work',
      ptyCreate,
      t: key => (zh as Record<string, string>)[key] ?? key,
    })
    await waitFor(() => expect(screen.getByText('无法启动终端')).toBeTruthy())
    expect(ptyCreate).toHaveBeenCalledTimes(1)
    for (const run of observers) run()
    await Promise.resolve()
    expect(ptyCreate).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalPane', () => {
  function renderPane(overrides: { active?: boolean, session?: TerminalSessionRecord } = {}) {
    return render(
      <TerminalPane
        id="pty-1"
        session={overrides.session}
        active={overrides.active ?? true}
        onActivate={() => {}}
        onData={() => {}}
        onResize={() => {}}
        sessionId={SID}
        cwd="/work"
        mentionTerminal={() => {}}
        writeClipboard={async () => {}}
        openWorkspacePath={() => {}}
        openLocalUrl={() => {}}
        openExternal={() => {}}
        t={t}
      />,
    )
  }

  it('does not steal focus when created inactive', async () => {
    renderPane({ active: false })
    const term = await waitFor(() => {
      const next = ghosttyState.instances.at(-1)
      if (next === undefined) throw new Error('ghostty not ready')
      return next
    })
    await new Promise<void>(resolve => { window.requestAnimationFrame(() => { resolve() }) })
    expect(term.focusCalls).toBe(0)
  })

  it('seeds Ghostty with resetAndWrite like the adapter', async () => {
    const session: TerminalSessionRecord = {
      id: 'pty-1', cwd: '/work', cols: 80, rows: 24, buffer: 'seed-bytes',
    }
    const view = renderPane({ session })
    await waitFor(() => {
      expect(ghosttyState.instances.some(term => term.resets.includes('seed-bytes'))).toBe(true)
    })
    view.rerender(
      <TerminalPane
        id="pty-1"
        session={{ id: 'pty-1', cwd: '/work', cols: 80, rows: 24, buffer: 'x' }}
        active
        onActivate={() => {}}
        onData={() => {}}
        onResize={() => {}}
        sessionId={SID}
        cwd="/work"
        mentionTerminal={() => {}}
        writeClipboard={async () => {}}
        openWorkspacePath={() => {}}
        openLocalUrl={() => {}}
        openExternal={() => {}}
        t={t}
      />,
    )
  })

  it('disposes a surface that finishes after unmount', async () => {
    ghosttyState.delayMs = 20
    const view = renderPane()
    view.unmount()
    await new Promise<void>(resolve => { window.setTimeout(resolve, 40) })
    expect(ghosttyState.instances.at(-1)?.disposed).toBe(true)
  })
})

describe('ui-user-terminal production imports', () => {
  it('does not import another plugin src/client from production code', () => {
    const dir = join(process.cwd(), 'packages/client/ui-user-terminal/src/client')
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(name)) continue
      const text = readFileSync(join(dir, name), 'utf8')
      expect(text.includes('@deepseek-ai/dsh-client-ui-layout/src/'), name).toBe(false)
    }
  })

  it('does not stretch a Ghostty canvas with xterm screen CSS', () => {
    const css = readFileSync(
      join(process.cwd(), 'packages/client/ui-user-terminal/src/client/TerminalWorkspace.module.css'),
      'utf8',
    )
    expect(css).not.toMatch(/xterm-screen/)
    expect(css).not.toMatch(/xterm-viewport/)
  })

  it('keeps the workspace transparent and paints an opaque terminal pane', () => {
    const terminalCss = readFileSync(
      join(process.cwd(), 'packages/client/ui-user-terminal/src/client/TerminalWorkspace.module.css'),
      'utf8',
    )
    expect(terminalCss).toMatch(/\.root\s*{[\s\S]{0,220}background:\s*transparent/)
    expect(terminalCss).toMatch(/\.paneTerminal\s*{[\s\S]{0,280}background:\s*var\(--dsw-alias-terminal-pane\)/)
    expect(terminalCss).not.toMatch(/backdrop-filter/)
    expect(terminalCss).not.toMatch(/\.paneTerminal\s*{[\s\S]{0,320}--dsw-alias-bg-layer-2/)
    expect(terminalCss).toMatch(new RegExp(['t', '3', '-ghostty-canvas'].join('')))
    expect(terminalCss).not.toMatch(/canvas[\s\S]{0,120}background:/)
  })

  it('never restyles TUI rows; Ghostty paints cells on the opaque well', () => {
    const terminalCss = readFileSync(
      join(process.cwd(), 'packages/client/ui-user-terminal/src/client/TerminalWorkspace.module.css'),
      'utf8',
    )
    expect(terminalCss).not.toMatch(/xterm-bg-257/)
    expect(terminalCss).not.toMatch(/xterm-bold[^{]*\{[^}]*background/)
    expect(terminalCss).not.toMatch(/data-dsh-tui-selected/)
    expect(terminalCss).not.toMatch(/dsh-tui-selected-bar/)
    expect(terminalCss).toMatch(/\.paneTerminalWrap\s*\{[^}]*isolation:\s*isolate/)
  })
})
