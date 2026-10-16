// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ViewTabsRow } from '../src/client/settings/ViewTabsRow.tsx'
import type { ViewTabsRowProps } from '../src/client/settings/ViewTabsRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by ViewTabsRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setViewTabs = vi.fn()
  const props: ViewTabsRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useViewTabs: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? true)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setViewTabs,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<ViewTabsRow {...props} />)
  return { setViewTabs }
}

describe('ViewTabsRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Chat and Trajectory tabs' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setViewTabs).toHaveBeenCalledWith(false)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Chat and Trajectory tabs' })).toHaveProperty('disabled', true)
  })
})
