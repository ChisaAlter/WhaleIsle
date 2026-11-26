// @vitest-environment jsdom
/**
 * Desktop fork (composer-family-width, A4 unified width axis): dragging the
 * composer edge inside `[data-conversation-content]` writes the content width
 * (card width minus the 32px clearance pair) to the Conversation body's
 * non-inheriting `--dsh-chat-user-width` axis, so the transcript column,
 * composer card, docks, Hero row, width handles, and `ui-session-panel`
 * end-reserve all compute from one source. Standalone bars without a
 * `[data-conversation-content]` ancestor fall back to `--dsh-composer-resized-width`.
 */
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useComposerResizeDrag } from '../src/client/skeleton/ComposerResizeHandles.tsx'

afterEach(cleanup)

function ConversationHarness({
  onCommit,
  persistedWidth = null,
}: {
  onCommit?: (size: Partial<{ height: number; width: number }>) => void
  persistedWidth?: number | null
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useComposerResizeDrag(true, cardRef, scrollRef, { height: null, width: persistedWidth }, onCommit)
  return (
    <div data-conversation-content="">
      <div data-conversation-scroll="">
        <div data-chat-flow="">
          <p data-message="">transcript</p>
        </div>
        <div data-composer-seat="">
          <div data-composer-root="">
            <div ref={cardRef} data-composer-card="">
              <div ref={scrollRef} data-input-scroll="" />
              <div
                data-composer-resize-edge="left"
                onPointerDown={drag.onResizePointerDown}
                onPointerMove={drag.onResizePointerMove}
                onPointerUp={drag.onResizePointerUp}
              />
              <div
                data-composer-resize-edge="right"
                onPointerDown={drag.onResizePointerDown}
                onPointerMove={drag.onResizePointerMove}
                onPointerUp={drag.onResizePointerUp}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function StandaloneHarness() {
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useComposerResizeDrag(true, cardRef, scrollRef)
  return (
    <div data-composer-seat="">
      <div ref={cardRef} data-composer-card="">
        <div ref={scrollRef} data-input-scroll="" />
        <div
          data-composer-resize-edge="right"
          onPointerDown={drag.onResizePointerDown}
          onPointerMove={drag.onResizePointerMove}
          onPointerUp={drag.onResizePointerUp}
        />
      </div>
    </div>
  )
}

describe('composer width drag publishing', () => {
  it('bridges centered horizontal drags (2x symmetric) onto --dsh-chat-user-width on [data-conversation-content]', () => {
    const onCommit = vi.fn()
    const view = render(<ConversationHarness onCommit={onCommit} />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const rightHandle = q('[data-composer-resize-edge="right"]')
    const leftHandle = q('[data-composer-resize-edge="left"]')

    fireEvent.pointerDown(rightHandle, { pointerId: 1, button: 0, clientX: 800, clientY: 10 })
    fireEvent.pointerMove(rightHandle, { pointerId: 1, clientX: 700, clientY: 10 })

    // 100px inward on a centered bar shrinks width by 200px -> 400px card = 368px content width.
    expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('368px')
    expect(q('[data-conversation-content]').dataset.composerUserWidth).toBe('368')
    expect(q('[data-composer-seat]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('')
    expect(q('[data-chat-flow]').style.getPropertyValue('--dsh-composer-flow-width')).toBe('')
    expect(card.style.width).toBe('')
    expect(card.dataset.composerResizedWidth).toBe('400')

    fireEvent.pointerUp(rightHandle, { pointerId: 1, clientX: 700, clientY: 10 })
    expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('368px')
    expect(onCommit).toHaveBeenLastCalledWith({ width: 400 })

    // Dragging left edge outward by 50px grows width symmetrically by 100px -> 700px card = 668px content width.
    fireEvent.pointerDown(leftHandle, { pointerId: 2, button: 0, clientX: 200, clientY: 10 })
    fireEvent.pointerMove(leftHandle, { pointerId: 2, clientX: 150, clientY: 10 })
    fireEvent.pointerUp(leftHandle, { pointerId: 2, clientX: 150, clientY: 10 })
    expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('668px')
    expect(onCommit).toHaveBeenLastCalledWith({ width: 700 })
  })

  it('uses 1x width scaling when the seat keeps an end reserve inset', () => {
    const view = render(<ConversationHarness />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    const seat = q('[data-composer-seat]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const computed = globalThis.getComputedStyle
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el, pseudo) => el === seat
      ? { paddingInlineEnd: '120px' } as CSSStyleDeclaration
      : computed(el, pseudo))
    try {
      const leftHandle = q('[data-composer-resize-edge="left"]')
      fireEvent.pointerDown(leftHandle, { pointerId: 1, button: 0, clientX: 200, clientY: 10 })
      fireEvent.pointerMove(leftHandle, { pointerId: 1, clientX: 150, clientY: 10 })
      expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('618px')
      expect(card.dataset.composerResizedWidth).toBe('650')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('clamps persisted width to the viewport column while keeping the preferred width', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get() {
        if ((this as HTMLElement).hasAttribute('data-composer-root')) return 700
        if ((this as HTMLElement).hasAttribute('data-conversation-content')) return 700
        return 0
      },
    })
    try {
      const view = render(<ConversationHarness persistedWidth={900} />)
      const content = view.container.querySelector<HTMLElement>('[data-conversation-content]')!
      // 900px preferred card width -> 868px preferred content width, clamped to 700 - 32 = 668px.
      expect(content.dataset.composerUserWidth).toBe('868')
      expect(content.style.getPropertyValue('--dsh-chat-user-width')).toBe('668px')
    } finally {
      if (original === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
      else Object.defineProperty(HTMLElement.prototype, 'clientWidth', original)
    }
  })

  it('falls back to --dsh-composer-resized-width on standalone bars without [data-conversation-content]', () => {
    const view = render(<StandaloneHarness />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const handle = q('[data-composer-resize-edge="right"]')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 600, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 550, clientY: 10 })

    expect(q('[data-composer-seat]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('500px')
    expect(card.style.width).toBe('500px')
  })
})
