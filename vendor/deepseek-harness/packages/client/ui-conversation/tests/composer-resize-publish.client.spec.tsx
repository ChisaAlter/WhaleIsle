// @vitest-environment jsdom
/**
 * Desktop fork (composer-family-width): where a width drag writes. An inherited
 * custom property written on an ancestor of the transcript restyles every
 * message, so drag frames write the inherited width only on the composer seat
 * and the non-inheriting flow width on the transcript column; the column host
 * receives the inherited width once, when the drag settles.
 */
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useComposerResizeDrag } from '../src/client/skeleton/ComposerResizeHandles.tsx'

afterEach(cleanup)

function Harness() {
  const cardRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useComposerResizeDrag(true, cardRef, scrollRef)
  return (
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
  )
}

describe('composer width drag publishing', () => {
  it('restyles only the seat and the column during the drag and publishes on the host when it settles', () => {
    const view = render(<Harness />)
    const q = (selector: string) => view.container.querySelector<HTMLElement>(selector)!
    const card = q('[data-composer-card]')
    card.getBoundingClientRect = () => ({ width: 600, height: 120 }) as DOMRect
    Object.defineProperty(card.parentElement!, 'clientWidth', { value: 1000, configurable: true })
    const handle = q('[data-composer-resize-edge="right"]')

    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 600, clientY: 10 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500, clientY: 10 })

    expect(q('[data-composer-seat]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('500px')
    expect(q('[data-chat-flow]').style.getPropertyValue('--dsh-composer-flow-width')).toBe('500px')
    expect(card.style.width).toBe('500px')
    // Nothing above the transcript changes while the pointer moves.
    expect(q('[data-conversation-scroll]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('')

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500, clientY: 10 })
    expect(q('[data-conversation-scroll]').style.getPropertyValue('--dsh-composer-resized-width')).toBe('500px')
  })
})
