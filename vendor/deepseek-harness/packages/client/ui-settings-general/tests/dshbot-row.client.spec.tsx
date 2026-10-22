// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import { DshbotRow } from '../src/client/DshbotRow.tsx'
import type { DshbotRowProps } from '../src/client/DshbotRow.tsx'
import { en, zh } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by DshbotRow') }) as never

function mount(dict: Record<string, string> = en) {
  const props: DshbotRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: (key, params) => Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] ?? key),
  }
  render(<DshbotRow {...props} />)
}

describe('DshbotRow', () => {
  it('renders off by default and persists the toggle through saveConfig', async () => {
    const saveConfig = vi.fn(async () => ({ dshbotEnabled: true }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshbotEnabled: false }),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Bots' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle).toHaveProperty('disabled', true)
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ dshbotEnabled: true })
    expect(screen.getByRole('switch', { name: 'Bots' }).getAttribute('aria-checked')).toBe('true')
  })

  it('loads the enabled state from the desktop config', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshbotEnabled: true }),
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Bots' }).getAttribute('aria-checked')).toBe('true')
    })
  })

  it('shows the Beta badge and the restart hint in both locales', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshbotEnabled: false }),
      saveConfig: async () => ({}),
    }
    mount(zh)
    expect(screen.getByText('机器人（Bots）')).toBeTruthy()
    expect(screen.getByText('测试中')).toBeTruthy()
    expect(screen.getByText('切换后会自动重启 Harness。')).toBeTruthy()

    cleanup()
    mount()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByText('Toggling restarts the Harness automatically.')).toBeTruthy()
  })

  it('reverts the switch when saveConfig rejects and blocks input while busy', async () => {
    const pending = Promise.withResolvers<object>()
    const saveConfig = vi.fn(() => pending.promise)
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshbotEnabled: false }),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Bots' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ dshbotEnabled: true })
    expect(toggle).toHaveProperty('disabled', true)
    toggle.click()
    expect(saveConfig).toHaveBeenCalledOnce()
    await act(async () => { pending.reject(new Error('write failed')) })
    await waitFor(() => {
      const reverted = screen.getByRole('switch', { name: 'Bots' })
      expect(reverted.getAttribute('aria-checked')).toBe('false')
      expect((reverted as HTMLButtonElement).disabled).toBe(false)
    })
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save settings: write failed')
  })

  it('reverts with the cancellation notice when the restart was cancelled', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ dshbotEnabled: false }),
      saveConfig: async () => ({ dshbotEnabled: false, restartCancelled: true }),
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Bots' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe('Restart cancelled; the setting was not changed.')
    expect(screen.getByRole('switch', { name: 'Bots' }).getAttribute('aria-checked')).toBe('false')
  })

  it('stays off when the desktop config cannot be read', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => { throw new Error('unavailable') },
      saveConfig: async () => ({}),
    }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Bots' }).getAttribute('aria-checked')).toBe('false')
    })
  })
})
