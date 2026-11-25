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

function ConversationHarness({ onCommit }: { onCommit?: (size: Partial<{ height: number; width: number }>) => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useComposerResizeDrag(true, cardRef, scrollRef, { height: null, width: null }, onCommit)
  return (
    <div data-conversation-content="">
      <div data-conversation-scroll="">
        <div data-chat-flow="">
          <p data-message="">transcript</p>
        </div>
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
  it('bridges horizontal drag onto --dsh-chat-user-width on [data-conversation-content]', () => {
    const onCommit = vi.fn()
    const view = render(<ConversationHarness onCommit={onCommit} />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const handle = q('[data-composer-resize-edge="right"]')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 600, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 10 })

    // 500px card width maps to 468px content width on the unified width axis.
    expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('468px')
    expect(q('[data-conversation-content]').dataset.composerUserWidth).toBe('468')
    expect(q('[data-composer-seat]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('')
    expect(q('[data-chat-flow]').style.getPropertyValue('--dsh-composer-flow-width')).toBe('')
    expect(card.style.width).toBe('')

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500, clientY: 10 })
    expect(q('[data-conversation-content]').style.getPropertyValue('--dsh-chat-user-width')).toBe('468px')
    expect(onCommit).toHaveBeenCalledWith({ width: 500 })
  })

  it('falls back to --dsh-composer-resized-width on standalone bars without [data-conversation-content]', () => {
    const view = render(<StandaloneHarness />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const handle = q('[data-composer-resize-edge="right"]')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 600, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 10 })

    expect(q('[data-composer-seat]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('500px')
    expect(card.style.width).toBe('500px')
  })
})
