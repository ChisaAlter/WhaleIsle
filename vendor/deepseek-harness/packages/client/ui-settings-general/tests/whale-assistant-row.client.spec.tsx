// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { WhaleAssistantRow } from '../src/client/WhaleAssistantRow.tsx'
import type { WhaleAssistantRowProps } from '../src/client/WhaleAssistantRow.tsx'
import { en, zh } from '../src/client/locales.ts'

const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never
const unusedHook = (() => { throw new Error('unused by WhaleAssistantRow') }) as never

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

function mount(dict: Record<string, string> = en) {
  const props: WhaleAssistantRowProps = {
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: (key, params) => Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] ?? key),
  }
  render(<WhaleAssistantRow {...props} />)
}

describe('WhaleAssistantRow', () => {
  it('defaults on when config omits whaleAssistantEnabled and persists explicit opt-out', async () => {
    const saveConfig = vi.fn(async () => ({ whaleAssistantEnabled: false }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({}),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: en['pet.whaleAssistant'] })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ whaleAssistantEnabled: false })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: en['pet.whaleAssistant'] }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('reflects an explicit false config and exposes updated zh/en Bots copy', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ whaleAssistantEnabled: false }),
      saveConfig: async () => ({}),
    }
    mount(zh)
    const toggle = screen.getByRole('switch', { name: zh['pet.whaleAssistant'] })
    expect(zh['pet.whaleAssistant']).toContain('大肥鱼队友')
    await waitFor(() => {
      expect(toggle.getAttribute('aria-checked')).toBe('false')
    })
  })
})
