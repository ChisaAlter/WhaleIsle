// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteWorkspaceRow } from '../src/client/RemoteWorkspaceRow.tsx'
import type { RemoteWorkspaceRowProps } from '../src/client/RemoteWorkspaceRow.tsx'
import { en, zh } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by RemoteWorkspaceRow') }) as never

function mount(dict: Record<string, string> = en) {
  const props: RemoteWorkspaceRowProps = {
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: key => dict[key] ?? key,
  }
  render(<RemoteWorkspaceRow {...props} />)
}

describe('RemoteWorkspaceRow', () => {
  it('renders on by default and persists the toggle through saveConfig', async () => {
    const saveConfig = vi.fn(async () => ({ remoteWorkspaceEnabled: false }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ remoteWorkspaceEnabled: true }),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Remote workspaces (SSH)' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle).toHaveProperty('disabled', true)
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ remoteWorkspaceEnabled: false })
    expect(screen.getByRole('switch', { name: 'Remote workspaces (SSH)' }).getAttribute('aria-checked')).toBe('false')
  })

  it('loads the disabled state from the desktop config', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ remoteWorkspaceEnabled: false }),
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Remote workspaces (SSH)' }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('shows the restart hint in both locales', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ remoteWorkspaceEnabled: true }),
      saveConfig: async () => ({}),
    }
    mount(zh)
    expect(screen.getByText('远程工作区（SSH）')).toBeTruthy()
    expect(screen.getByText('切换后会自动重启 Harness。')).toBeTruthy()

    cleanup()
    mount()
    expect(screen.getByText('Remote workspaces (SSH)')).toBeTruthy()
    expect(screen.getByText('Toggling restarts the Harness automatically.')).toBeTruthy()
  })

  it('stays on when the desktop config cannot be read', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => { throw new Error('unavailable') },
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Remote workspaces (SSH)' }).getAttribute('aria-checked')).toBe('true')
    })
  })
})
