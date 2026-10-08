// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DshdMiniPlayer } from '../src/client/DshdMiniPlayer.tsx'
import { en } from '../src/client/locales.ts'
import { clearMiniPlayer, closeMiniPlayer, openMiniPlayer, readMiniPlayer, setMiniPlayerRuntime, setMiniPlayerSuspended } from '../src/client/mini-player-state.ts'

const t = (key: keyof typeof en): string => en[key]

afterEach(() => { clearMiniPlayer(); cleanup() })

describe('dshd mini-player', () => {
  it('presents the first float when its runtime binds after opening and follows rebinds', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches?.('[data-preview-mini-player-viewport]')) return { left: 480, top: 40, width: 320, height: 172, right: 800, bottom: 212 } as DOMRect
      return originalRect.call(this)
    }
    const frame = document.createElement('div')
    frame.dataset.shellOverlay = ''
    const chat = document.createElement('div')
    chat.dataset.conversationScroll = ''
    Object.defineProperty(chat, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) })
    frame.append(chat)
    document.body.append(frame)
    try {
      openMiniPlayer('preview-first', 'first.html')
      render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
      expect(readMiniPlayer().runtime).toBeNull()
      const bounds = { x: 480, y: 40, width: 320, height: 172 }
      const runtime = { previewShow: vi.fn(async () => {}), previewResize: vi.fn(async () => {}), previewHide: vi.fn(async () => {}) }
      act(() => { setMiniPlayerRuntime('preview-first', runtime) })
      await waitFor(() => expect(runtime.previewShow).toHaveBeenCalledWith('preview-first', bounds))
      expect(runtime.previewResize).toHaveBeenCalledWith('preview-first', bounds)
      const rebound = { previewShow: vi.fn(async () => {}), previewResize: vi.fn(async () => {}), previewHide: vi.fn(async () => {}) }
      act(() => { setMiniPlayerRuntime('preview-first', rebound) })
      await waitFor(() => expect(rebound.previewShow).toHaveBeenCalledWith('preview-first', bounds))
      expect(rebound.previewResize).toHaveBeenCalledWith('preview-first', bounds)
      act(() => { setMiniPlayerSuspended(true) })
      expect(rebound.previewHide).toHaveBeenCalledWith('preview-first')
      expect(runtime.previewHide).not.toHaveBeenCalled()
    } finally {
      frame.remove()
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('shows the same preview through the overlay and restores it', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.matches?.('[data-preview-mini-player-viewport]')) return { left: 0, top: 28, width: 320, height: 172, right: 320, bottom: 200 } as DOMRect
      if (this.matches?.('[data-preview-mini-player]')) return { left: 0, top: 0, width: 320, height: 200, right: 320, bottom: 200 } as DOMRect
      return originalRect.call(this)
    }
    const previewShow = vi.fn(async () => {})
    const previewResize = vi.fn(async () => {})
    const previewHide = vi.fn(async () => {})
    const restore = vi.fn()
    const frame = document.createElement('div')
    frame.dataset.shellOverlay = ''
    const chat = document.createElement('div')
    chat.dataset.conversationScroll = ''
    Object.defineProperty(chat, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) })
    frame.append(chat)
    document.body.append(frame)
    setMiniPlayerRuntime('preview-1', { previewShow, previewResize, previewHide, restore })
    openMiniPlayer('preview-1', 'pelican-bike.html')
    render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
    await waitFor(() => expect(previewShow).toHaveBeenCalled())
    expect(previewShow).toHaveBeenCalledWith('preview-1', expect.anything())
    expect(screen.getByRole('region', { name: 'pelican-bike.html' })).toBeTruthy()
    expect(screen.getByText('pelican-bike.html')).toBeTruthy()
    expect(screen.getByRole('button', { name: en.miniClose })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)
    const hides = previewHide.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: en.miniRestore }))
    expect(restore).toHaveBeenCalledTimes(1)
    expect(previewHide).toHaveBeenCalledTimes(hides)
    HTMLElement.prototype.getBoundingClientRect = originalRect
  })

  it('resizes from the frame edge while preserving the opposite edge', async () => {
    const capture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
    const hasCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture')
    const release = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'releasePointerCapture')
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} })
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: () => {} })
    try {
      const frame = document.createElement('div')
      frame.dataset.shellOverlay = ''
      const chat = document.createElement('div')
      chat.dataset.conversationScroll = ''
      Object.defineProperty(chat, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) })
      frame.append(chat)
      document.body.append(frame)
      setMiniPlayerRuntime('preview-1', { previewShow: async () => {}, previewResize: async () => {}, previewHide: async () => {} })
      openMiniPlayer('preview-1', 'pelican-bike.html')
      const { container } = render(<DshdMiniPlayer {...({ t } as Parameters<typeof DshdMiniPlayer>[0])} />)
      const west = container.querySelector<HTMLElement>('[data-resize-side="w"]')!
      fireEvent.pointerDown(west, { pointerId: 1, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(west, { pointerId: 1, clientX: 60, clientY: 100 })
      await waitFor(() => expect(readMiniPlayer().geometry).toMatchObject({ x: 428, width: 360, height: 200 }))
      fireEvent.pointerUp(west, { pointerId: 1 })
      const southeast = container.querySelector<HTMLElement>('[data-resize-side="se"]')!
      fireEvent.pointerDown(southeast, { pointerId: 2, button: 0, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(southeast, { pointerId: 2, clientX: 100, clientY: 130 })
      await waitFor(() => expect(readMiniPlayer().geometry).toMatchObject({ x: 428, width: 360, height: 230 }))
    } finally {
      for (const [name, descriptor] of [['setPointerCapture', capture], ['hasPointerCapture', hasCapture], ['releasePointerCapture', release]] as const) {
        if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
        else Reflect.deleteProperty(HTMLElement.prototype, name)
      }
    }
  })

  it('closes the frame without hiding the guest so the panel can reclaim it', async () => {
    const previewHide = vi.fn(async () => {})
    setMiniPlayerRuntime('preview-1', {
      previewShow: async () => {},
      previewResize: async () => {},
      previewHide,
    })
    openMiniPlayer('preview-1', 'pelican-bike.html')
    closeMiniPlayer()
    expect(readMiniPlayer().open).toBe(false)
    expect(previewHide).not.toHaveBeenCalled()
  })
})
