// @vitest-environment jsdom
/** The switch displays Host acceptance and reports rejected saves. */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { VisualRepliesSettings } from '../src/config.ts'
import { VisualRepliesRow, type VisualRepliesRowProps } from '../src/client/settings/VisualRepliesRow.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

function fixture() {
  const state = createSnapshotStore<ConfigFormSnapshot<VisualRepliesSettings>>({
    status: 'ready', value: { enabled: false }, base: {}, user: {}, revision: 0, writable: true, mode: 'host',
  })
  const pending = Promise.withResolvers<boolean>()
  const setEnabled = vi.fn(() => pending.promise)
  const props = {
    useSettings: bindSnapshotSelector(state), setEnabled, t: makeTranslate(en),
  } as VisualRepliesRowProps
  render(<VisualRepliesRow {...props} />)
  return { state, pending, setEnabled, toggle: screen.getByRole('switch', { name: en['settings.title'] }) }
}

it('waits for the Host value while saving and enables the accepted preference', async () => {
  const { state, pending, toggle, setEnabled } = fixture()
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(toggle).toHaveProperty('disabled', true)
  expect(screen.getByRole('status').textContent).toBe(en['settings.saving'])
  expect(setEnabled).toHaveBeenCalledWith(true)
  await act(async () => {
    state.set({ ...state.getSnapshot(), value: { enabled: true }, revision: 1 })
    pending.resolve(true)
  })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(toggle).toHaveProperty('disabled', false)
  expect(screen.queryByRole('status')).toBeNull()
})

it.each(['refused', 'rejected'] as const)('retains the accepted preference and allows retry after a %s save', async (failure) => {
  const { pending, toggle } = fixture()
  fireEvent.click(toggle)
  expect(toggle).toHaveProperty('disabled', true)
  await act(async () => {
    if (failure === 'refused') pending.resolve(false)
    else pending.reject(new Error('Disconnected'))
  })
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['settings.saveFailed']) })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(toggle).toHaveProperty('disabled', false)
  expect(screen.queryByRole('status')).toBeNull()
})
