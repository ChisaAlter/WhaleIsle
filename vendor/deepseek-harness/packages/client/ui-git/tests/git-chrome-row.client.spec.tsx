// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { GitChromeRow } from '../src/client/GitChromeRow.tsx'
import type { GitChromeRowProps } from '../src/client/GitChromeRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by GitChromeRow') }) as never

function mount(opts: { visible?: boolean; writable?: boolean } = {}) {
  const setTitlebarGit = vi.fn()
  const props: GitChromeRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: unused,
    useWorkspaces: unused,
    useTitlebarGit: bindSnapshotSelector(createSnapshotStore(opts.visible ?? true)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setTitlebarGit,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<GitChromeRow {...props} />)
  return { setTitlebarGit }
}

describe('GitChromeRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Titlebar Git actions' })
    expect(toggle).toHaveProperty('checked', true)
    fireEvent.click(toggle)
    expect(writable.setTitlebarGit).toHaveBeenCalledWith(false)
    cleanup()
    mount({ visible: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Titlebar Git actions' })).toHaveProperty('disabled', true)
  })
})
