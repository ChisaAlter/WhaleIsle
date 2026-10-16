// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PeakValleySettingsRow } from '../src/client/settings/PeakValleyRow.tsx'
import type { PeakValleySettingsRowProps } from '../src/client/settings/PeakValleyRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by PeakValleySettingsRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setPeakValley = vi.fn()
  const props: PeakValleySettingsRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    usePeakValley: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? false)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setPeakValley,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<PeakValleySettingsRow {...props} />)
  return { setPeakValley }
}

describe('PeakValleySettingsRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Official peak/valley hours' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    expect(writable.setPeakValley).toHaveBeenCalledWith(true)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Official peak/valley hours' })).toHaveProperty('disabled', true)
  })
})
