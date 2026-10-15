// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SurfacesToggleRow, TerminalToggleRow } from '../src/client/PanelToggleRow.tsx'
import type { PanelToggleRowProps } from '../src/client/PanelToggleRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by PanelToggleRow') }) as never

function props(opts: { visible?: boolean; writable?: boolean } = {}): {
  setVisible: ReturnType<typeof vi.fn>
  value: PanelToggleRowProps
} {
  const setVisible = vi.fn()
  return {
    setVisible,
    value: {
      ...allowAllAccess,
      usePanelInfo: panelInfoStub,
      useResource: resourceStub,
      useSessions: unused,
      useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
      useWorkspaces: unused,
      useVisible: bindSnapshotSelector(createSnapshotStore(opts.visible ?? true)),
      useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
      setVisible,
      t: key => (en as Record<string, string>)[key] ?? key,
    },
  }
}

describe('PanelToggleRow', () => {
  it('writes the terminal Switch immediately and disables it when the Host is not writable', () => {
    const writable = props()
    render(<TerminalToggleRow {...writable.value} />)
    const toggle = screen.getByRole('switch', { name: 'Terminal drawer toggle' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setVisible).toHaveBeenCalledWith(false)
    cleanup()
    const locked = props({ writable: false })
    render(<TerminalToggleRow {...locked.value} />)
    expect(screen.getByRole('switch', { name: 'Terminal drawer toggle' })).toHaveProperty('disabled', true)
  })

  it('writes the surfaces Switch', () => {
    const b = props()
    render(<SurfacesToggleRow {...b.value} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Right Sidebar button' }))
    expect(b.setVisible).toHaveBeenCalledWith(false)
  })
})
