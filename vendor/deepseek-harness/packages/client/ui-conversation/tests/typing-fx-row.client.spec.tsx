// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { TypingFxRow } from '../src/client/settings/TypingFxRow.tsx'
import type { TypingFxRowProps } from '../src/client/settings/TypingFxRow.tsx'
import { en } from '../src/client/locales.ts'
import { DEFAULT_TYPING_FX_PRESETS, DEFAULT_TYPING_FX_STYLE } from '../src/submission-settings.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by TypingFxRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setTypingFx = vi.fn()
  const saveTypingFxConfiguration = vi.fn()
  const props: TypingFxRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useTypingFx: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? false)),
    useTypingFxStyle: bindSnapshotSelector(createSnapshotStore(DEFAULT_TYPING_FX_STYLE)),
    useTypingFxPresets: bindSnapshotSelector(createSnapshotStore(DEFAULT_TYPING_FX_PRESETS)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setTypingFx,
    saveTypingFxConfiguration,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<TypingFxRow {...props} />)
  return { setTypingFx, saveTypingFxConfiguration }
}

describe('TypingFxRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Typing effects' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    expect(writable.setTypingFx).toHaveBeenCalledWith(true)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Typing effects' })).toHaveProperty('disabled', true)
  })

  it('keeps the Switch on the shared trailing axis by placing the settings button before it', () => {
    mount()
    const button = screen.getByRole('button', { name: 'Configure typing effects' })
    const toggle = screen.getByRole('switch', { name: 'Typing effects' })
    expect(button.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.parentElement?.parentElement?.lastElementChild).toBe(toggle.parentElement)
  })

  it('opens a draft modal, previews edits, and saves or resets the complete style', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure typing effects' }))
    expect(screen.getByRole('dialog', { name: 'Typing effects' })).toBeTruthy()

    fireEvent.change(screen.getByRole('slider', { name: 'Echo speed' }), { target: { value: '160' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Caret blink/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.saveTypingFxConfiguration).toHaveBeenCalledWith({
      ...DEFAULT_TYPING_FX_STYLE,
      speed: 160,
      cursorBlink: false,
    }, {})

    fireEvent.click(screen.getByRole('button', { name: 'Configure typing effects' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.saveTypingFxConfiguration).toHaveBeenLastCalledWith(DEFAULT_TYPING_FX_STYLE, {})
  })

  it('discards modal edits on cancel', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure typing effects' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Echo speed' }), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mounted.saveTypingFxConfiguration).not.toHaveBeenCalled()
  })
})
