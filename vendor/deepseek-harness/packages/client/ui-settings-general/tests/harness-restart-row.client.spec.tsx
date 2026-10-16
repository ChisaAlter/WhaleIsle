// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HarnessRestartRow } from '../src/client/HarnessRestartRow.tsx'
import type { HarnessRestartRowProps } from '../src/client/HarnessRestartRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by HarnessRestartRow') }) as never
const t = makeTranslate(en)

function mount() {
  const props: HarnessRestartRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t,
  }
  render(<HarnessRestartRow {...props} />)
}

function loadedShell(saveConfig: () => Promise<object>) {
  ;(window as Window & { shell?: unknown }).shell = {
    getConfig: async () => ({
      harnessAutoRestart: true,
      harnessRestartMaxAttempts: 3,
      harnessRestartBaseDelayMs: 1000,
    }),
    saveConfig,
  }
}

describe('HarnessRestartRow', () => {
  it('applies a switch click immediately and blocks duplicate writes without a saving row', async () => {
    let resolveSave: (value: object) => void = () => {}
    const saveConfig = vi.fn(() => new Promise<object>((resolve) => { resolveSave = resolve }))
    loadedShell(saveConfig)
    mount()
    const toggle = await screen.findByRole('switch', { name: 'Enable auto-restart' })
    expect(toggle).toHaveProperty('checked', true)

    fireEvent.click(toggle)

    expect(saveConfig).toHaveBeenCalledWith({ harnessAutoRestart: false })
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', false)
    expect(toggle).toHaveProperty('disabled', true)
    toggle.click()
    expect(saveConfig).toHaveBeenCalledOnce()
    expect(screen.queryByText('Saving…')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()

    await act(async () => { resolveSave({ harnessAutoRestart: false }) })
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', false)
    expect(toggle).toHaveProperty('disabled', false)
    expect((await screen.findByRole('alert')).textContent).toBe(en['feedback.saved'])
  })

  it('retains the resting caption while saving and shows the accepted retry count after settlement', async () => {
    let resolveSave: (value: object) => void = () => {}
    const saveConfig = vi.fn(() => new Promise<object>((resolve) => { resolveSave = resolve }))
    loadedShell(saveConfig)
    mount()
    await screen.findByRole('button', { name: 'Max restart attempts' })

    fireEvent.click(screen.getByRole('button', { name: 'Max restart attempts' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '5' }))

    expect(saveConfig).toHaveBeenCalledWith({ harnessRestartMaxAttempts: 5 })
    const trigger = screen.getByRole('button', { name: 'Max restart attempts' })
    expect(trigger.textContent).toBe('3')
    expect(trigger).toHaveProperty('disabled', true)
    expect(screen.queryByText('Saving…')).toBeNull()

    await act(async () => { resolveSave({ harnessRestartMaxAttempts: 5 }) })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Max restart attempts' }).textContent).toContain('5') })
    expect(trigger).toHaveProperty('disabled', false)
  })

  it('reverts the switch and reports when the write fails', async () => {
    let rejectSave: (reason: Error) => void = () => {}
    const saveConfig = vi.fn(() => new Promise<object>((_resolve, reject) => { rejectSave = reject }))
    loadedShell(saveConfig)
    mount()
    const toggle = await screen.findByRole('switch', { name: 'Enable auto-restart' })
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', false)
    await act(async () => { rejectSave(new Error('disk full')) })
    expect(screen.getByRole('alert').textContent).toBe('Failed to read or save settings: disk full')
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
  })

  it('ignores a stale save once a newer pick is in flight', async () => {
    const resolvers: Array<(value: object) => void> = []
    const saveConfig = vi.fn(() => new Promise<object>((resolve) => { resolvers.push(resolve) }))
    loadedShell(saveConfig)
    mount()
    await screen.findByRole('switch', { name: 'Enable auto-restart' })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable auto-restart' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable auto-restart' }))
    expect(saveConfig).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
    await act(async () => { resolvers[0]!({ harnessAutoRestart: false }) })
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
    await act(async () => { resolvers[1]!({ harnessAutoRestart: true }) })
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
  })

  it('does not revert a newer pick when an earlier write fails', async () => {
    const rejectors: Array<(reason: Error) => void> = []
    const saveConfig = vi.fn(() => new Promise<object>((_resolve, reject) => { rejectors.push(reject) }))
    loadedShell(saveConfig)
    mount()
    await screen.findByRole('switch', { name: 'Enable auto-restart' })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable auto-restart' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable auto-restart' }))
    await act(async () => { rejectors[0]!(new Error('stale')) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
    await act(async () => { rejectors[1]!(new Error('disk full')) })
    expect(screen.getByRole('alert').textContent).toBe('Failed to read or save settings: disk full')
  })

  it('stays inert when the shell cannot persist', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({
        harnessAutoRestart: true,
        harnessRestartMaxAttempts: 3,
        harnessRestartBaseDelayMs: 1000,
      }),
    }
    mount()
    const toggle = await screen.findByRole('switch', { name: 'Enable auto-restart' })
    fireEvent.click(toggle)
    expect(screen.getByRole('switch', { name: 'Enable auto-restart' })).toHaveProperty('checked', true)
  })
})
