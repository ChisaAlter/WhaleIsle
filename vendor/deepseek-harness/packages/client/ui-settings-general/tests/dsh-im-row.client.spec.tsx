// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { DshImRow } from '../src/client/DshImRow.tsx'
import type { DshImRowProps } from '../src/client/DshImRow.tsx'
import { en, zh } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by DshImRow') }) as never

function mount(dict: Record<string, string> = en) {
  const props: DshImRowProps = {
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: (key, params) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? '')),
  }
  render(<DshImRow {...props} />)
}

describe('DshImRow', () => {
  it('renders on by default and persists the toggle through saveConfig', async () => {
    const saveConfig = vi.fn(async () => ({ dshImEnabled: false }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshImEnabled: true }),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Message channels (IM)' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(toggle).toHaveProperty('disabled', true)
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ dshImEnabled: false })
    expect(screen.getByRole('switch', { name: 'Message channels (IM)' }).getAttribute('aria-checked')).toBe('false')
  })

  it('loads the disabled state from the desktop config', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshImEnabled: false }),
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Message channels (IM)' }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('shows the restart hint in both locales', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshImEnabled: true }),
      saveConfig: async () => ({}),
    }
    mount(zh)
    expect(screen.getByText('消息渠道（IM）')).toBeTruthy()
    expect(screen.getByText('切换后会自动重启 Harness。')).toBeTruthy()

    cleanup()
    mount()
    expect(screen.getByText('Message channels (IM)')).toBeTruthy()
    expect(screen.getByText('Toggling restarts the Harness automatically.')).toBeTruthy()
  })

  it('stays on when the desktop config cannot be read', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => { throw new Error('unavailable') },
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Message channels (IM)' }).getAttribute('aria-checked')).toBe('true')
    })
  })
})

for (const failure of ['cancelled', 'rejected'] as const) {
  it(`restores the IM switch and shows feedback when saving is ${failure}`, async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshImEnabled: true }),
      saveConfig: async () => {
        if (failure === 'rejected') throw new Error('write failed')
        return { dshImEnabled: true, restartCancelled: true }
      },
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Message channels (IM)' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    expect(screen.getByText(failure === 'rejected' ? en['feedback.saveError'].replace('{message}', 'write failed') : en['feedback.restartCancelled'])).toBeTruthy()
  })
}
