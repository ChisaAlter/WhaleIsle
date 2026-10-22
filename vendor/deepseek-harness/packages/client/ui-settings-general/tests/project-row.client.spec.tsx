// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { allowAllAccess } from '@deepseek-ai/dsh-client-test-runtime'
import { ProjectRow } from '../src/client/ProjectRow.tsx'
import type { ProjectRowProps } from '../src/client/ProjectRow.tsx'
import { en, zh } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

const unusedHook = (() => { throw new Error('unused by ProjectRow') }) as never

function mount(dict: Record<string, string> = en, leaveProjectLead: () => Promise<void> = async () => {}) {
  const props: ProjectRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unusedHook,
    useSessionStatus: unusedHook,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unusedHook,
    leaveProjectLead,
    t: (key, params) => Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), dict[key] ?? key),
  }
  render(<ProjectRow {...props} />)
}

describe('ProjectRow', () => {
  it('stays off when the config has no Project setting and persists the toggle', async () => {
    const saveConfig = vi.fn(async () => ({ projectEnabled: true }))
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({}), saveConfig }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Project' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => { expect(saveConfig).toHaveBeenCalledWith({ projectEnabled: true }) })
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Project' }).getAttribute('aria-checked')).toBe('true') })
  })

  it('loads the enabled state from the desktop config', async () => {
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({ projectEnabled: true }), saveConfig: async () => ({}) }
    mount()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Project' }).getAttribute('aria-checked')).toBe('true')
    })
  })

  it('explains the feature from the help button in both locales', async () => {
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({ projectEnabled: false }), saveConfig: async () => ({}) }
    mount(zh)
    expect(screen.getByText('切换后会自动重启 Harness。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Project 是什么' }))
    expect((await screen.findByRole('tooltip')).textContent).toBe(zh['project.help'])

    cleanup()
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'What is Project?' }))
    expect((await screen.findByRole('tooltip')).textContent).toBe(en['project.help'])
  })

  it('leaves an open Lead before writing the off state, and only when turning off', async () => {
    const order: string[] = []
    const leave = vi.fn(async () => { order.push('leave') })
    const saveConfig = vi.fn(async (patch: { projectEnabled: boolean }) => { order.push(`save:${patch.projectEnabled}`); return patch })
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({ projectEnabled: true }), saveConfig }
    mount(en, leave)
    const toggle = screen.getByRole('switch', { name: 'Project' })
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
    fireEvent.click(toggle)
    await waitFor(() => { expect(order).toEqual(['leave', 'save:false']) })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await waitFor(() => { expect(order).toEqual(['leave', 'save:false', 'save:true']) })
    expect(leave).toHaveBeenCalledOnce()
  })

  it('keeps Project on without writing when leaving the Lead fails', async () => {
    const saveConfig = vi.fn(async () => ({ projectEnabled: false }))
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({ projectEnabled: true }), saveConfig }
    mount(en, async () => { throw new Error('navigation failed') })
    const toggle = screen.getByRole('switch', { name: 'Project' })
    await waitFor(() => { expect(toggle.getAttribute('aria-checked')).toBe('true') })
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save settings: navigation failed')
    expect(screen.getByRole('switch', { name: 'Project' }).getAttribute('aria-checked')).toBe('true')
    expect(saveConfig).not.toHaveBeenCalled()
  })

  it('tells the user when the restart was cancelled and the setting stayed', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ projectEnabled: false }),
      saveConfig: async () => ({ projectEnabled: false, restartCancelled: true }),
    }
    mount(zh)
    const toggle = screen.getByRole('switch', { name: 'Project' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe('已取消重启，设置未更改。')
    expect(screen.getByRole('switch', { name: 'Project' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reverts the switch when the write is refused', async () => {
    const pending = Promise.withResolvers<object>()
    ;(window as Window & { shell?: unknown }).shell = { getConfig: async () => ({ projectEnabled: false }), saveConfig: vi.fn(() => pending.promise) }
    mount()
    const toggle = screen.getByRole('switch', { name: 'Project' })
    await waitFor(() => { expect(toggle).toHaveProperty('disabled', false) })
    fireEvent.click(toggle)
    await act(async () => { pending.resolve({ projectEnabled: false }) })
    await waitFor(() => { expect(screen.getByRole('switch', { name: 'Project' }).getAttribute('aria-checked')).toBe('false') })
    expect((await screen.findByRole('alert')).textContent).toBe(en['feedback.notSaved'])
  })
})
