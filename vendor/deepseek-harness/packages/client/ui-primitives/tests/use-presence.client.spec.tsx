// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { PRESENCE_EXIT_MS, usePresence } from '../src/usePresence.ts'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('data-dsh-minimal')
  vi.useRealTimers()
})

function Probe({ open, durationMs }: { open: boolean; durationMs?: number }) {
  const { mounted, state } = usePresence(open, durationMs)
  return <div data-mounted={mounted ? '1' : '0'} data-state={state} />
}

function stubReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') && matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

describe('usePresence', () => {
  it('opens and closes immediately in Minimal mode without allocating animation frames', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    document.documentElement.setAttribute('data-dsh-minimal', '')
    const { container, rerender } = render(<Probe open />)
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('open')
    expect(vi.getTimerCount()).toBe(0)
    rerender(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
  })

  it('releases an existing exit hold when Minimal mode is enabled', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { container, rerender } = render(<Probe open />)
    act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame() })
    rerender(<Probe open={false} />)
    act(() => {
      document.documentElement.setAttribute('data-dsh-minimal', '')
      document.dispatchEvent(new Event('dsh:render-mode'))
    })
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stays unmounted while closed, then enters on the second animation frame', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { rerender, container } = render(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    rerender(<Probe open />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersToNextFrame() })
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersToNextFrame() })
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('open')
  })

  it('keeps the tree mounted through the exit hold, then unmounts', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    const { rerender, container } = render(<Probe open />)
    act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame() })
    rerender(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('closed')
    act(() => { vi.advanceTimersByTime(PRESENCE_EXIT_MS - 1) })
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('1')
    act(() => { vi.advanceTimersByTime(1) })
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
  })

  it('skips the hold when reduced motion is requested', () => {
    stubReducedMotion(true)
    const { rerender, container } = render(<Probe open />)
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('open')
    rerender(<Probe open={false} />)
    expect(container.firstElementChild?.getAttribute('data-mounted')).toBe('0')
  })
})
