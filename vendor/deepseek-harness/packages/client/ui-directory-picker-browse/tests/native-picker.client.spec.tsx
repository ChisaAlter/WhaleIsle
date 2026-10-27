// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import { DirectoryBrowser } from '../src/client/DirectoryBrowser.tsx'
import { createPickerPreferenceStore } from '../src/client/store.ts'

const listing: DirectoryListing = {
  path: 'C:\\Users\\test', home: 'C:\\Users\\test',
  crumbs: [{ name: 'test', path: 'C:\\Users\\test', hidden: false }],
  entries: [], truncated: false,
}
afterEach(() => { cleanup(); localStorage.clear() })

function mount(enabled = false, overrides: Partial<Parameters<typeof DirectoryBrowser>[0]> = {}) {
  const pick = vi.fn<NonNullable<Parameters<typeof DirectoryBrowser>[0]['nativePicker']>['pick']>(async () => null)
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const listDirectory = vi.fn(async () => listing)
  function Fixture({ open = true }: { open?: boolean }) {
    const [useNative, setUseNative] = useState(enabled)
    return <DirectoryBrowser open={open} busy={false} listDirectory={listDirectory}
      createDirectory={vi.fn(async () => '')} onOpen={onOpen} onClose={onClose} t={key => key}
      nativePicker={{ enabled: useNative, setEnabled: setUseNative, pick }} {...overrides} />
  }
  const view = render(<Fixture />)
  return { view, Fixture, pick, onOpen, onClose, listDirectory }
}

describe('Windows system directory chooser', () => {
  it('opens immediately on switching and retains the off switch after cancellation', async () => {
    const b = mount()
    await waitFor(() => { expect(b.listDirectory).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('switch', { name: 'browser.nativePicker' }))
    await waitFor(() => { expect(b.pick).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.getByRole('button', { name: 'browser.openNative' }).getAttribute('aria-busy')).toBeNull() })
    expect(b.onOpen).not.toHaveBeenCalled()
    expect(b.onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(screen.getByRole('button', { name: 'browser.open' })).toBeTruthy() })
    expect(b.pick).toHaveBeenCalledOnce()
  })

  it('uses the remembered mode once per open without scanning and keeps remote navigation', async () => {
    const b = mount(true, { remote: { render: active => <span>{active ? 'SSH active' : 'SSH hidden'}</span> } })
    await waitFor(() => { expect(b.pick).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.getByRole('tab', { name: 'browser.tabRemote' }).hasAttribute('disabled')).toBe(false) })
    expect(b.listDirectory).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'browser.tabRemote' }))
    expect(screen.getByText('SSH active')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'browser.tabLocal' }))
    expect(b.pick).toHaveBeenCalledOnce()
    b.view.rerender(<b.Fixture open={false} />)
    b.view.rerender(<b.Fixture />)
    await waitFor(() => { expect(b.pick).toHaveBeenCalledTimes(2) })
  })

  it('adopts a native selection once and blocks duplicate opening while pending', async () => {
    const b = mount()
    let settle!: (path: string | null) => void
    b.pick.mockImplementation(() => new Promise(resolve => { settle = resolve }))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(b.pick).toHaveBeenCalledOnce() })
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'browser.openingNative' })
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'browser.cancel' }).disabled).toBe(true)
    await act(async () => { settle('D:\\work\\project') })
    expect(b.onOpen).toHaveBeenCalledExactlyOnceWith('D:\\work\\project')
    expect(b.pick).toHaveBeenCalledOnce()
  })

  it('keeps failed calls retryable and clears native busy', async () => {
    const b = mount()
    b.pick.mockRejectedValueOnce(new Error('System chooser unavailable'))
    fireEvent.click(screen.getByRole('switch'))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('System chooser unavailable'))
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('switch').disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'browser.retry' }))
    await waitFor(() => { expect(b.pick).toHaveBeenCalledTimes(2) })
    expect(b.onOpen).not.toHaveBeenCalled()
  })

  it('ignores native results from a closed or unmounted request', async () => {
    const b = mount()
    let settle!: (path: string | null) => void
    b.pick.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => { expect(b.pick).toHaveBeenCalledOnce() })
    b.view.rerender(<b.Fixture open={false} />)
    await act(async () => { settle('D:\\stale') })
    expect(b.onOpen).not.toHaveBeenCalled()
    b.view.rerender(<b.Fixture />)
    await waitFor(() => { expect(b.pick).toHaveBeenCalledTimes(2) })
    b.view.unmount()
    expect(b.onOpen).not.toHaveBeenCalled()
  })

  it('does not open a queued native chooser after unmount', async () => {
    const b = mount(true)
    b.view.unmount()
    await act(async () => { await Promise.resolve() })
    expect(b.pick).not.toHaveBeenCalled()
    expect(b.onOpen).not.toHaveBeenCalled()
  })

  it('does not expose the switch without a native capability', () => {
    mount(false, { nativePicker: undefined })
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('button', { name: 'browser.newFolder' })).toBeTruthy()
  })

  it('persists both directions across preference store instances', () => {
    const first = createPickerPreferenceStore().create()
    expect(first.getSnapshot().useNative).toBe(false)
    first.actions.setUseNative(true)
    const reloaded = createPickerPreferenceStore().create()
    expect(reloaded.getSnapshot().useNative).toBe(true)
    reloaded.actions.setUseNative(false)
    expect(createPickerPreferenceStore().create().getSnapshot().useNative).toBe(false)
  })
})
