// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { CustomInstructionsRow } from '../src/client/settings/CustomInstructionsRow.tsx'
import type { CustomInstructionsRowProps } from '../src/client/settings/CustomInstructionsRow.tsx'
import { CUSTOM_INSTRUCTIONS_MAX_LENGTH } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

function mount({ writable = true, text = '' } = {}) {
  const customInstructions = createSnapshotStore(text)
  const writableStore = createSnapshotStore(writable)
  const setCustomInstructions = vi.fn((next: string) => { customInstructions.set(next) })
  const props: CustomInstructionsRowProps = {
    ...allowAllAccess,
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noPendingInteraction(),
    useSessionRetainInfo: () => undefined,
    useResource,
    useWorkspaces: emptyWorkspaces(),
    useCustomInstructions: bindSnapshotSelector(customInstructions),
    useWritable: bindSnapshotSelector(writableStore),
    setCustomInstructions,
    t: makeTranslate(en),
  }
  render(<CustomInstructionsRow {...props} />)
  return { customInstructions, writableStore, setCustomInstructions }
}

describe('CustomInstructionsRow', () => {
  it('renders the titled editor with a character counter', () => {
    mount({ text: 'Always answer tersely.' })
    expect(screen.getByText('Custom instructions')).toBeDefined()
    expect(screen.getByText(
      'Set a few standing rules for the agent; they apply to every later task',
    )).toBeDefined()
    const textarea = screen.getByRole('textbox', { name: 'Custom instructions' })
    expect((textarea as HTMLTextAreaElement).value).toBe('Always answer tersely.')
    expect(screen.getByText(`22 / ${CUSTOM_INSTRUCTIONS_MAX_LENGTH}`)).toBeDefined()
  })

  it('forwards edits and adopts later store changes', () => {
    const b = mount()
    const textarea = screen.getByRole('textbox', { name: 'Custom instructions' })
    fireEvent.change(textarea, { target: { value: 'Reply in Chinese' } })
    expect(b.setCustomInstructions).toHaveBeenCalledWith('Reply in Chinese')
    act(() => { b.customInstructions.set('adopted') })
    expect((textarea as HTMLTextAreaElement).value).toBe('adopted')
    expect(screen.getByText(`7 / ${CUSTOM_INSTRUCTIONS_MAX_LENGTH}`)).toBeDefined()
  })

  it('disables the editor while the Host document is not writable', () => {
    mount({ writable: false })
    const textarea = screen.getByRole('textbox', { name: 'Custom instructions' })
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true)
  })
})
