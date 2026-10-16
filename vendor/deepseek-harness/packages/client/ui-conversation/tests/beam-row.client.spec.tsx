// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { BeamRow } from '../src/client/settings/BeamRow.tsx'
import type { BeamRowProps } from '../src/client/settings/BeamRow.tsx'
import { en } from '../src/client/locales.ts'
import { DEFAULT_COMPOSER_BEAM_PRESETS, DEFAULT_COMPOSER_BEAM_STYLE } from '../src/submission-settings.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by BeamRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setComposerBeam = vi.fn()
  const setComposerBeamStyle = vi.fn()
  const saveComposerBeamConfiguration = vi.fn()
  const props: BeamRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useComposerBeam: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? true)),
    useComposerBeamStyle: bindSnapshotSelector(createSnapshotStore(DEFAULT_COMPOSER_BEAM_STYLE)),
    useComposerBeamPresets: bindSnapshotSelector(createSnapshotStore(DEFAULT_COMPOSER_BEAM_PRESETS)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setComposerBeam,
    setComposerBeamStyle,
    saveComposerBeamConfiguration,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<BeamRow {...props} />)
  return { setComposerBeam, setComposerBeamStyle, saveComposerBeamConfiguration }
}

describe('BeamRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Thinking glow when sending' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setComposerBeam).toHaveBeenCalledWith(false)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Thinking glow when sending' })).toHaveProperty('disabled', true)
  })

  it('keeps the Switch on the shared trailing axis by placing the settings button before it', () => {
    mount()
    const button = screen.getByRole('button', { name: 'Configure thinking glow' })
    const toggle = screen.getByRole('switch', { name: 'Thinking glow when sending' })
    expect(button.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(toggle.parentElement?.parentElement?.lastElementChild).toBe(toggle.parentElement)
  })

  it('opens a draft modal, previews edits, and saves or resets the complete style', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    expect(screen.getByRole('dialog', { name: 'Thinking glow' })).toBeTruthy()

    fireEvent.change(screen.getByRole('slider', { name: 'Rotation period' }), { target: { value: '3.25' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Overall intensity' }), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.saveComposerBeamConfiguration).toHaveBeenCalledWith({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      period: 3.25,
      intensity: 120,
      mode: 'custom',
    }, {})

    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mounted.saveComposerBeamConfiguration).toHaveBeenLastCalledWith(DEFAULT_COMPOSER_BEAM_STYLE, {})
  })

  it('rotates palette swatches with the hue offset so chips preview effective colors', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    const swatch = screen.getByRole('button', { name: 'Aurora' }).firstElementChild as HTMLElement
    expect(swatch.style.filter).toBe('hue-rotate(0deg)')
    fireEvent.change(screen.getByRole('slider', { name: 'Hue offset' }), { target: { value: '90' } })
    expect(swatch.style.filter).toBe('hue-rotate(90deg)')
  })

  it('discards modal edits on cancel', () => {
    const mounted = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Configure thinking glow' }))
    fireEvent.change(screen.getByRole('slider', { name: 'Hue offset' }), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mounted.saveComposerBeamConfiguration).not.toHaveBeenCalled()
  })
})
