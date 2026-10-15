// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { StatsLineRow } from '../src/client/settings/StatsLineRow.tsx'
import type { StatsLineRowProps } from '../src/client/settings/StatsLineRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by StatsLineRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setStatsLine = vi.fn()
  const props: StatsLineRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useStatsLine: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? true)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setStatsLine,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<StatsLineRow {...props} />)
  return { setStatsLine }
}

describe('StatsLineRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Session stats' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setStatsLine).toHaveBeenCalledWith(false)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Session stats' })).toHaveProperty('disabled', true)
  })
})
