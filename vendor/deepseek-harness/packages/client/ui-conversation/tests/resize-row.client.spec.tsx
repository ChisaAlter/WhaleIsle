// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { ResizeRow } from '../src/client/settings/ResizeRow.tsx'
import type { ResizeRowProps } from '../src/client/settings/ResizeRow.tsx'
import { en } from '../src/client/locales.ts'
const panelInfoStub = ((selector: (s: unknown) => unknown) => selector({ activePanelId: null })) as never
const resourceStub = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as never


afterEach(cleanup)

const unused = (() => { throw new Error('unused by ResizeRow') }) as never

function mount(opts: { enabled?: boolean; writable?: boolean } = {}) {
  const setComposerResize = vi.fn()
  const props: ResizeRowProps = {
    ...allowAllAccess,
    usePanelInfo: panelInfoStub,
    useResource: resourceStub,
    useSessions: unused,
    useSessionStatus: unused,
    useSessionRetainInfo: () => undefined,
    useWorkspaces: unused,
    useComposerResize: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? false)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setComposerResize,
    t: key => (en as Record<string, string>)[key] ?? key,
  }
  render(<ResizeRow {...props} />)
  return { setComposerResize }
}

describe('ResizeRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const writable = mount()
    const toggle = screen.getByRole('switch', { name: 'Resize input by dragging' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    expect(writable.setComposerResize).toHaveBeenCalledWith(true)
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'Resize input by dragging' })).toHaveProperty('disabled', true)
  })
})
