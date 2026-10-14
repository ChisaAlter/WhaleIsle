// @vitest-environment jsdom
/** The outside-pointer dismissal primitive as observable popover behavior. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toast, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

function Popover({ portaled }: { portaled: boolean }) {
  const [open, setOpen] = useState(true)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  useDismissOnOutsidePointer(rootRef, open, setOpen, portaled ? panelRef : undefined)
  return (
    <div ref={rootRef} data-testid="root">
      <button type="button">trigger</button>
      {open && !portaled && <div data-testid="surface">surface</div>}
      {open && portaled && createPortal(<div ref={panelRef} data-testid="surface">surface</div>, document.body)}
    </div>
  )
}

describe('useDismissOnOutsidePointer', () => {
  it('closes on an outside pointerdown but not on one inside the root', () => {
    const view = render(<Popover portaled={false} />)
    fireEvent.pointerDown(view.getByTestId('root'))
    expect(view.queryByTestId('surface')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(view.queryByTestId('surface')).toBeNull()
  })

  it('counts the portaled surface as inside while still closing outside it', () => {
    const view = render(<Popover portaled />)
    fireEvent.pointerDown(view.getByTestId('surface'))
    expect(view.queryByTestId('surface')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(view.queryByTestId('surface')).toBeNull()
  })

  it('keeps its portaled notice action reachable without treating unrelated notices as inside', async () => {
    const retry = vi.fn()
    function Owner() {
      const [open, setOpen] = useState(true)
      const rootRef = useRef<HTMLDivElement | null>(null)
      useDismissOnOutsidePointer(rootRef, open, setOpen)
      return <div ref={rootRef}>{open && <>
        <div data-testid="surface">surface</div>
        <Toast text="Could not load" holdMs={null} onDone={() => {}} actions={[{ label: 'Retry', onClick: retry }]} />
      </>}</div>
    }
    render(<Owner />)
    render(<Toast text="Unrelated" holdMs={null} onDone={() => {}} actions={[{ label: 'Other action', onClick: vi.fn() }]} />)
    await act(async () => {})
    const action = screen.getByRole('button', { name: 'Retry' })
    fireEvent.pointerDown(action)
    expect(screen.getByTestId('surface')).toBeTruthy()
    fireEvent.click(action)
    expect(retry).toHaveBeenCalledOnce()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Other action' }))
    expect(screen.queryByTestId('surface')).toBeNull()
  })
})
