// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { ApprovalPopupRow, type ApprovalPopupRowProps } from '../src/client/ApprovalPopupRow.tsx'
import { en, zh } from '../src/client/locales.ts'

const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never
const unusedHook = (() => { throw new Error('unused by ApprovalPopupRow') }) as never

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

function mount(dict: Record<string, string> = en) {
  const props: ApprovalPopupRowProps = {
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    t: key => dict[key] ?? key,
  }
  render(<ApprovalPopupRow {...props} />)
}

describe('ApprovalPopupRow', () => {
  it('renders on by default and persists toggles through saveConfig', async () => {
    const saveConfig = vi.fn(async () => ({ approvalPopupEnabled: false }))
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ approvalPopupEnabled: true }),
      saveConfig,
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Show approval popup when minimized' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect(saveConfig).toHaveBeenCalledWith({ approvalPopupEnabled: false })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Show approval popup when minimized' }).getAttribute('aria-checked')).toBe('false')
    })
  })

  it('loads the disabled state and renders both Chinese and English copy', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ approvalPopupEnabled: false }),
      saveConfig: async () => ({}),
    }
    mount(zh)
    expect(screen.getByText('最小化时弹出审批窗口')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: '最小化时弹出审批窗口' }).getAttribute('aria-checked')).toBe('false')
    })

    cleanup()
    mount(en)
    expect(screen.getByText('Show approval popup when minimized')).toBeTruthy()
  })

  it('reverts the toggle when saveConfig rejects', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ approvalPopupEnabled: true }),
      saveConfig: async () => { throw new Error('disk full') },
    }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Show approval popup when minimized' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Show approval popup when minimized' }).getAttribute('aria-checked')).toBe('true')
    })
  })
})
