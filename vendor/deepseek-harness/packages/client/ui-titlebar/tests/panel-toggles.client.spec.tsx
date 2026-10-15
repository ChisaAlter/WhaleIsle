// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PanelTogglesProps } from '../src/client/PanelToggles.tsx'
import { PanelToggles } from '../src/client/PanelToggles.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


const t: PanelTogglesProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('panel toggles must not read useSessions') }) as never

function workspaces(itemCount: number): PanelTogglesProps['useWorkspaces'] {
  const state = {
    items: Array.from({ length: itemCount }, () => ({})),
    archivedSessionIds: [],
    state: 'ready',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: undefined,
  } as unknown as WorkspaceListState
  return sel => sel(state)
}

function mount(opts: {
  rightbarShown?: boolean
  surfaces?: number
  terminalDrawer?: number
  workspaceCount?: number
  terminalToggle?: boolean
  surfacesToggle?: boolean
} = {}) {
  const toggleSurfaces = vi.fn()
  const toggleTerminalDrawer = vi.fn()
  render(
    <PanelToggles
      {...allowAllAccess}
      usePanelInfo={panelInfoStub}
      useResource={resourceStub}
      surfaces={opts.surfaces ?? 0}
      rightbarShown={opts.rightbarShown ?? false}
      terminalDrawer={opts.terminalDrawer ?? 0}
      managedSession={false}
      useSessions={neverHook}
      useSessionStatus={sel => sel(new Map())}
      useSessionRetainInfo={() => undefined}
      useWorkspaces={workspaces(opts.workspaceCount ?? 1)}
      useTerminalToggle={sel => sel(opts.terminalToggle !== false)}
      useSurfacesToggle={sel => sel(opts.surfacesToggle !== false)}
      toggleSurfaces={toggleSurfaces}
      toggleTerminalDrawer={toggleTerminalDrawer}
      t={t}
    />,
  )
  return { toggleSurfaces, toggleTerminalDrawer }
}

afterEach(cleanup)

describe('PanelToggles', () => {
  it('calls toggleTerminalDrawer when the terminal icon is clicked', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle terminal drawer' }))
    expect(b.toggleTerminalDrawer).toHaveBeenCalledOnce()
    expect(b.toggleSurfaces).not.toHaveBeenCalled()
  })

  it('calls toggleSurfaces when the right-panel icon is clicked', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle right panel' }))
    expect(b.toggleSurfaces).toHaveBeenCalledOnce()
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
  })

  it('marks the right-panel toggle pressed when the shared panel is open', () => {
    mount({ rightbarShown: true })
    expect(screen.getByRole('button', { name: 'Toggle right panel' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Toggle terminal drawer' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the terminal toggle pressed when the drawer is open', () => {
    mount({ terminalDrawer: 280 })
    expect(screen.getByRole('button', { name: 'Toggle terminal drawer' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('Ctrl+\\ toggles the surfaces column', () => {
    const b = mount()
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(b.toggleSurfaces).toHaveBeenCalledOnce()
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
  })

  it('Ctrl+` toggles the terminal drawer when a workspace exists', () => {
    const b = mount()
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(b.toggleTerminalDrawer).toHaveBeenCalledOnce()
    expect(b.toggleSurfaces).not.toHaveBeenCalled()
  })

  it('ignores shortcuts while typing in an input', () => {
    const b = mount()
    const input = document.createElement('input')
    document.body.append(input)
    fireEvent.keyDown(input, { key: '\\', ctrlKey: true })
    fireEvent.keyDown(input, { key: '`', ctrlKey: true })
    expect(b.toggleSurfaces).not.toHaveBeenCalled()
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
    input.remove()
  })

  it('toggles the terminal drawer from the Ghostty pane textarea but not the surfaces column', () => {
    const b = mount()
    const pane = document.createElement('div')
    pane.setAttribute('data-terminal-pane', 'pty-1')
    const input = document.createElement('textarea')
    pane.append(input)
    document.body.append(pane)
    fireEvent.keyDown(input, { key: '`', ctrlKey: true })
    expect(b.toggleTerminalDrawer).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: '\\', ctrlKey: true })
    expect(b.toggleSurfaces).not.toHaveBeenCalled()
    pane.remove()
  })

  it('disables the terminal toggle when no workspace is available', () => {
    const b = mount({ workspaceCount: 0 })
    const terminal = screen.getByRole<HTMLButtonElement>('button', { name: 'Toggle terminal drawer' })
    expect(terminal.disabled).toBe(true)
    fireEvent.click(terminal)
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Toggle right panel' }).disabled).toBe(false)
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(b.toggleSurfaces).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    expect(b.toggleTerminalDrawer).not.toHaveBeenCalled()
  })

  it('keeps shortcuts when both titlebar buttons are hidden', () => {
    const b = mount({ terminalToggle: false, surfacesToggle: false })
    expect(screen.queryByRole('button', { name: 'Toggle terminal drawer' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toggle right panel' })).toBeNull()
    expect(document.querySelector('[data-panel-layout-controls]')).toBeNull()
    fireEvent.keyDown(window, { key: '`', ctrlKey: true })
    fireEvent.keyDown(window, { key: '\\', ctrlKey: true })
    expect(b.toggleTerminalDrawer).toHaveBeenCalledOnce()
    expect(b.toggleSurfaces).toHaveBeenCalledOnce()
  })

  it('omits only the hidden panel button', () => {
    mount({ terminalToggle: false })
    expect(screen.queryByRole('button', { name: 'Toggle terminal drawer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Toggle right panel' })).toBeTruthy()
  })

  it('omits the surfaces button while the terminal toggle stays', () => {
    mount({ surfacesToggle: false })
    expect(screen.getByRole('button', { name: 'Toggle terminal drawer' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Toggle right panel' })).toBeNull()
  })
})
