// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { Toast } from '../src/Toast.tsx'
import { Modal } from '../src/Modal.tsx'

afterEach(cleanup)

const settle = () => act(async () => { await Promise.resolve() })

describe('Toast', () => {
  it('announces its text and reports done after the hold-and-fade lifetime', async () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="最多添加 50 张图片" icon={<svg data-testid="icon" />} onDone={onDone} />)
      await settle()
      const banner = view.getByRole('alert')
      expect(banner.textContent).toContain('最多添加 50 张图片')
      expect(view.getByTestId('icon')).toBeTruthy()
      vi.advanceTimersByTime(3999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds for the owner\'s window and hands the stylesheet the same value', async () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="切换失败" holdMs={6000} onDone={onDone} />)
      await settle()
      // One value drives both, so a banner can never unmount mid-fade: the
      // timer waits the hold plus the fade, and the stylesheet delays the
      // fade by the same hold.
      expect(view.getByRole('alert').style.getPropertyValue('--dsh-toast-hold')).toBe('6000ms')
      vi.advanceTimersByTime(6999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps its original expiry across rerenders and calls the latest completion handler', async () => {
    vi.useFakeTimers()
    try {
      const first = vi.fn()
      const latest = vi.fn()
      const view = render(<Toast text="archived" onDone={first} />)
      await settle()
      vi.advanceTimersByTime(1000)
      view.rerender(<Toast text="archived" onDone={latest} />)
      vi.advanceTimersByTime(2999)
      expect(first).not.toHaveBeenCalled()
      expect(latest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(first).not.toHaveBeenCalled()
      expect(latest).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('centers over its anchor and re-measures on window resize', async () => {
    vi.useFakeTimers()
    try {
      const anchor = document.createElement('div')
      document.body.appendChild(anchor)
      anchor.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      const view = render(<Toast text="anchored" anchor={anchor} onDone={vi.fn()} />)
      await settle()
      expect(view.getByRole('alert').style.left).toBe('300px')
      anchor.getBoundingClientRect = () => ({ left: 200, width: 400 }) as DOMRect
      fireEvent(window, new Event('resize'))
      expect(view.getByRole('alert').style.left).toBe('400px')
      anchor.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flows prefixed actions inline as one sentence and hands each press to the owner', async () => {
    vi.useFakeTimers()
    try {
      const undo = vi.fn()
      const filter = vi.fn()
      const view = render(
        <Toast
          text="会话已归档，可"
          tone="success"
          actions={[
            { label: '撤销', onClick: undo },
            { prefix: '或', label: '筛选已归档会话', onClick: filter },
          ]}
          onDone={vi.fn()}
        />,
      )
      await settle()
      // The success tone brings the circled green check itself; no icon prop.
      const glyph = view.getByRole('alert').querySelector('[aria-hidden]')
      expect(glyph?.className).toContain('success')
      expect(glyph?.querySelector('svg')).toBeTruthy()
      expect(view.getByRole('alert').textContent).toBe('会话已归档，可撤销或筛选已归档会话')
      fireEvent.click(view.getByRole('button', { name: '撤销' }))
      expect(undo).toHaveBeenCalledTimes(1)
      fireEvent.click(view.getByRole('button', { name: '筛选已归档会话' }))
      expect(filter).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders without an icon and cancels its timer on unmount', async () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="plain" onDone={onDone} />)
      await settle()
      expect(view.getByRole('alert').querySelector('[aria-hidden]')).toBeNull()
      view.unmount()
      vi.advanceTimersByTime(10_000)
      expect(onDone).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shares a body stack across owners and releases it after the final notice unmounts', async () => {
    const first = render(<section style={{ transform: 'translateX(10px)' }}><Toast text="First" holdMs={null} onDone={vi.fn()} /></section>)
    const second = render(<Toast text="Second" holdMs={null} onDone={vi.fn()} />)
    await settle()
    const [one, two] = screen.getAllByRole('alert')
    expect(one?.parentElement).toBe(two?.parentElement)
    expect(one?.parentElement?.parentElement).toBe(document.body)
    expect(first.container.contains(one!)).toBe(false)
    expect(document.querySelectorAll('[data-dsh-toast-stack]')).toHaveLength(1)
    first.unmount()
    expect(screen.getByRole('alert').textContent).toBe('Second')
    second.unmount()
    await settle()
    expect(document.querySelector('[data-dsh-toast-stack]')).toBeNull()
  })

  it('keeps actionable failures until dismissed and preserves disabled action gates', async () => {
    vi.useFakeTimers()
    try {
      const retry = vi.fn(), discard = vi.fn(), dismissed = vi.fn()
      render(<Toast text="Rejected" holdMs={null} dismissLabel="Dismiss notice" onDone={dismissed}
        actions={[{ label: 'Retry', disabled: true, onClick: retry }, { label: 'Discard', onClick: discard }]} />)
      await settle()
      act(() => { vi.advanceTimersByTime(60_000) })
      expect(screen.getByRole('alert').textContent).toContain('Rejected')
      expect(dismissed).not.toHaveBeenCalled()
      const retryButton = screen.getByRole('button', { name: 'Retry' })
      expect(retryButton).toHaveProperty('disabled', true)
      fireEvent.click(retryButton)
      expect(retry).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
      expect(discard).toHaveBeenCalledOnce()
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))
      expect(dismissed).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('hides a retained inactive owner and resumes only the remaining visible lifetime', async () => {
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      const view = render(<section><Toast text="Saved" onDone={done} /></section>)
      await settle()
      act(() => { vi.advanceTimersByTime(1000) })
      view.rerender(<section hidden><Toast text="Saved" onDone={done} /></section>)
      await settle()
      expect(screen.queryByRole('alert')).toBeNull()
      act(() => { vi.advanceTimersByTime(10_000) })
      expect(done).not.toHaveBeenCalled()
      view.rerender(<section><Toast text="Saved" onDone={done} /></section>)
      await settle()
      expect(screen.getByRole('alert').textContent).toBe('Saved')
      act(() => { vi.advanceTimersByTime(2999) })
      expect(done).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(1) })
      expect(done).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it.each([false, true])('includes sibling notice actions in its modal keyboard order with background notice %s', async (withBackground) => {
    const retry = vi.fn(), discard = vi.fn()
    function Owner() {
      const [open, setOpen] = useState(true)
      const [notice, setNotice] = useState(true)
      return <><section>
        <Modal open={open} title="Settings" closeLabel="Close settings" onClose={() => { setOpen(false) }}
          onKeyDownCapture={event => { if (event.key === 'Tab') event.preventDefault() }}>
          <button>Inside</button>
        </Modal>
        {notice && <Toast text="Conflict" holdMs={null} dismissLabel="Dismiss conflict" onDone={() => { setNotice(false) }}
          actions={[{ label: 'Retry', onClick: retry }, { label: 'Discard', onClick: discard }]} />}
      </section>{withBackground && <section><Toast text="Background" holdMs={null} onDone={() => {}} actions={[{ label: 'Background action', onClick: vi.fn() }]} /></section>}</>
    }
    render(<Owner />)
    await settle()
    const background = withBackground ? screen.getByText('Background').closest<HTMLElement>('[data-dsh-toast]')! : null
    if (background !== null) expect(background.inert).toBe(true)
    const inside = screen.getByRole('button', { name: 'Inside' })
    inside.focus()
    fireEvent.keyDown(inside, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(document.activeElement!)
    expect(retry).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(document.activeElement!)
    expect(discard).toHaveBeenCalledOnce()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss conflict' }))
    fireEvent.click(document.activeElement!)
    await settle()
    expect(screen.queryByText('Conflict')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close settings' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    if (background !== null) expect(background.inert).toBe(false)
  })

  it('keeps a tall dialog header and footer clear, and uses the space above a compact dialog', async () => {
    let headerTop = 96
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-dsh-modal-header')) return new DOMRect(290, headerTop, 380, 62)
      if (this.hasAttribute('data-dsh-modal-footer')) return new DOMRect(290, 752, 380, 36)
      return new DOMRect()
    })
    try {
      render(<section><Modal open title="Add connection" closeLabel="Close connection" onClose={() => {}}
        footer={<button>Cancel connection</button>}><input aria-label="Connection name" /></Modal>
      <Toast text="A connection name is required" holdMs={null} dismissLabel="Dismiss validation" onDone={() => {}} /></section>)
      await settle()
      const notice = screen.getByRole('alert')
      const stack = notice.parentElement!
      const top = Number.parseFloat(stack.style.top)
      const limit = Number.parseFloat(stack.style.maxHeight)
      expect(top).toBeGreaterThan(158)
      expect(top + limit).toBeLessThan(752)
      expect(screen.getByRole('button', { name: 'Close connection' })).toHaveProperty('disabled', false)
      expect(screen.getByRole('button', { name: 'Cancel connection' })).toHaveProperty('disabled', false)
      headerTop = 360
      fireEvent(window, new Event('resize'))
      await settle()
      const resizedTop = Number.parseFloat(stack.style.top)
      const resizedLimit = Number.parseFloat(stack.style.maxHeight)
      expect(resizedTop).toBeLessThan(headerTop)
      expect(resizedTop + resizedLimit).toBeLessThan(headerTop)
    } finally { measured.mockRestore() }
  })

  it('keeps simultaneous result and conflict notices above a custom dialog header and search', async () => {
    let contentHeight = 100
    const measured = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-dsh-modal-header')) return new DOMRect(480, 156, 480, 106)
      return new DOMRect()
    })
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-dsh-toast-stack') ? contentHeight : 0
    })
    try {
      render(<section><Modal open headless title="Shortcuts" onClose={() => {}}>
        <header data-dsh-modal-header=""><button>Close shortcuts</button></header>
        <input aria-label="Search shortcuts" />
      </Modal>
      <Toast text="Saved" tone="success" dismissLabel="Dismiss result" onDone={() => {}} />
      <Toast text="Conflict" holdMs={null} dismissLabel="Dismiss conflict" onDone={() => {}} /></section>)
      await settle()
      const notices = screen.getAllByRole('alert')
      const stack = notices[0]!.parentElement!
      const top = Number.parseFloat(stack.style.top)
      expect(top).toBeGreaterThanOrEqual(48)
      expect(top + stack.scrollHeight).toBeLessThan(156)
      expect(Number.parseFloat(stack.style.maxHeight)).toBeGreaterThanOrEqual(stack.scrollHeight)
      expect(notices.every(notice => !notice.inert)).toBe(true)
      expect(screen.getByRole('textbox', { name: 'Search shortcuts' })).toBeTruthy()
      contentHeight = 180
      fireEvent(window, new Event('resize'))
      await settle()
      expect(Number.parseFloat(stack.style.top)).toBeGreaterThan(262)
      expect(Number.parseFloat(stack.style.maxHeight)).toBeGreaterThanOrEqual(contentHeight)
    } finally { measured.mockRestore(); height.mockRestore() }
  })

  it('gives an editor sibling notice ownership before its enclosing settings dialog', async () => {
    function Settings() {
      const [editor, setEditor] = useState(false)
      const [failure, setFailure] = useState(false)
      return <Modal open title="Settings" closeLabel="Close settings" onClose={() => {}}>
        <section>
          <button onClick={() => { setEditor(true) }}>Edit prices</button>
          <Modal open={editor} title="Prices" closeLabel="Close prices" onClose={() => { setEditor(false) }}>
            <input aria-label="Draft price" defaultValue="invalid price" />
            <button onClick={() => { setFailure(true) }}>Save prices</button>
          </Modal>
          {failure && <Toast text="Prices rejected" holdMs={null} dismissLabel="Dismiss price error"
            onDone={() => { setFailure(false) }} />}
        </section>
      </Modal>
    }
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit prices' }))
    await settle()
    const save = screen.getByRole('button', { name: 'Save prices' })
    fireEvent.click(save)
    await settle()
    expect(screen.getByRole('alert').inert).toBe(false)
    save.focus()
    fireEvent.keyDown(save, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss price error' }))
    fireEvent.click(document.activeElement!)
    await settle()
    expect(screen.queryByText('Prices rejected')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Prices' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Draft price' })).toHaveProperty('value', 'invalid price')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close prices' }))
  })

  it('keeps a closed editor notice hidden under its parent and restores it when the editor remounts', async () => {
    vi.useFakeTimers()
    try {
      function Settings() {
        const [editor, setEditor] = useState(true)
        return <Modal open title="Settings" closeLabel="Close settings" onClose={() => {}}>
          <section>
            <button onClick={() => { setEditor(true) }}>Edit prices</button>
            <Modal open={editor} title="Prices" closeLabel="Close prices" onClose={() => { setEditor(false) }}>
              <input aria-label="Draft price" defaultValue="invalid price" />
            </Modal>
            <Toast text="Prices rejected" holdMs={null} dismissLabel="Dismiss price error" onDone={() => {}} />
          </section>
        </Modal>
      }
      render(<Settings />)
      await settle()
      const notice = screen.getByRole('alert')
      const firstEditor = screen.getByRole('dialog', { name: 'Prices' })
      fireEvent.click(screen.getByRole('button', { name: 'Close prices' }))
      await act(async () => { vi.advanceTimersByTime(200); await Promise.resolve() })
      expect(firstEditor.isConnected).toBe(false)
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
      expect(screen.queryByRole('alert')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Edit prices' }))
      await settle()
      expect(screen.getByRole('alert')).toBe(notice)
      expect(notice.inert).toBe(false)
      const input = screen.getByRole('textbox', { name: 'Draft price' })
      input.focus()
      fireEvent.keyDown(input, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dismiss price error' }))
    } finally { vi.useRealTimers() }
  })
})
