// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CloseBehaviorRow } from '../src/client/CloseBehaviorRow.tsx'
import type { CloseBehaviorRowProps } from '../src/client/CloseBehaviorRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by CloseBehaviorRow') }) as never

function mount() {
  const props: CloseBehaviorRowProps = {
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<CloseBehaviorRow {...props} />)
}

describe('CloseBehaviorRow', () => {
  it('shows Minimize to tray by default and persists Quit', async () => {
    const saveConfig = vi.fn(async () => ({ closeToTray: false }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ closeToTray: true }),
      saveConfig,
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minimize to tray/ })).toBeTruthy()
    })
    expect(screen.getByText('When closing the window')).toBeTruthy()
    expect(screen.getByText(/quit and stop the local Harness service/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Minimize to tray/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quit' }))
    expect(saveConfig).toHaveBeenCalledWith({ closeToTray: false })
    expect(screen.getByRole('button', { name: /Quit/ })).toBeTruthy()
  })

  it('loads Quit from the desktop config and can switch back to tray', async () => {
    const saveConfig = vi.fn(async () => ({ closeToTray: true }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ closeToTray: false }),
      saveConfig,
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Quit/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /Quit/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Minimize to tray' }))
    expect(saveConfig).toHaveBeenCalledWith({ closeToTray: true })
    expect(screen.getByRole('button', { name: /Minimize to tray/ })).toBeTruthy()
  })

  it('keeps the tray default when config is missing, unreadable, or incomplete', async () => {
    const saveConfig = vi.fn(async () => ({}))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => { throw new Error('unavailable') },
      saveConfig,
    }
    mount()
    expect(screen.getByRole('button', { name: /Minimize to tray/ })).toBeTruthy()

    cleanup()
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({}),
      saveConfig,
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Minimize to tray/ })).toBeTruthy()
    })

    cleanup()
    delete (window as Window & { shell?: unknown }).shell
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Minimize to tray/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quit' }))
    expect(screen.getByRole('button', { name: /Minimize to tray/ })).toBeTruthy()
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('ignores a late config read after unmount and closes the menu outside', async () => {
    let resolveConfig: (value: { closeToTray: boolean }) => void = () => {}
    ;(window as Window & { shell?: unknown }).shell = {
      usePanelInfo: panelInfoStub,
      useResource: resourceStub,
      getConfig: () => new Promise<{ closeToTray: boolean }>((resolve) => { resolveConfig = resolve }),
      saveConfig: async () => ({ closeToTray: true }),
    }
    const view = render(<CloseBehaviorRow
      useSessions={unusedHook}
      useSessionStatus={unusedHook}
      useSessionRetainInfo={() => undefined}
      useWorkspaces={unusedHook}
      usePanelInfo={panelInfoStub}
      useResource={resourceStub}
      t={key => (en as Record<string, string>)[key] ?? key}
    />)
    view.unmount()
    await act(async () => { resolveConfig({ closeToTray: false }) })

    mount()
    const trigger = screen.getByRole('button', { name: /Minimize to tray/ })
    expect(trigger).toHaveProperty('disabled', true)
    await act(async () => { resolveConfig({ closeToTray: true }) })
    await waitFor(() => { expect(trigger).toHaveProperty('disabled', false) })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Quit' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Quit' })).toBeNull()
  })
})
