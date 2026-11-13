// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { observeStartupResponsiveness } from '../src/client/startup-responsiveness.ts'

let deliver: (durations: number[]) => void
const disconnect = vi.fn()
const frames = new Map<number, FrameRequestCallback>()
let sequence = 0
let stop: (() => void) | undefined

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    frames.set(++sequence, cb)
    return sequence
  }))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('PerformanceObserver', class {
    static supportedEntryTypes = ['longtask']
    constructor(callback: (list: { getEntries: () => { duration: number; startTime: number }[] }) => void) {
      deliver = durations => { callback({ getEntries: () => durations.map(duration => ({ duration, startTime: performance.now() - duration })) }) }
    }
    observe() {}
    disconnect = disconnect
    takeRecords() { return [] }
  })
  disconnect.mockClear()
})

afterEach(() => {
  stop?.()
  frames.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('bounded startup responsiveness observation', () => {
  it('uses no frame loop while idle and releases the observer and timer after 70 foreground seconds', () => {
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    vi.advanceTimersByTime(70_000)
    expect(requestAnimationFrame).not.toHaveBeenCalled()
    expect(disconnect).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    document.dispatchEvent(new Event('keydown'))
    expect(frames.size).toBe(0)
    expect(detected).not.toHaveBeenCalled()
  })

  it('ignores warmup, isolated stalls, and multiple tasks in one time window', () => {
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    deliver([500, 500, 500])
    vi.advanceTimersByTime(11_000)
    deliver([250, 250, 250])
    expect(detected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    deliver([250])
    expect(detected).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('pauses in the background and drops pre-pause evidence', () => {
    const focus = vi.spyOn(document, 'hasFocus')
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    vi.advanceTimersByTime(11_000)
    deliver([250, 250])
    focus.mockReturnValue(false)
    window.dispatchEvent(new Event('blur'))
    vi.advanceTimersByTime(120_000)
    deliver([1000, 1000, 1000])
    expect(vi.getTimerCount()).toBe(0)
    focus.mockReturnValue(true)
    window.dispatchEvent(new Event('focus'))
    deliver([250])
    expect(detected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(59_000)
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('requires repeated slow interaction samples and stops all animation callbacks on detection', () => {
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    vi.advanceTimersByTime(11_000)
    const sample = () => {
      document.dispatchEvent(new Event('wheel'))
      for (let i = 0; i < 19; i++) {
        vi.advanceTimersByTime(60)
        const entries = [...frames]
        frames.clear()
        for (const [, cb] of entries) cb(performance.now())
      }
    }
    sample()
    expect(detected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    sample()
    expect(detected).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('caps interaction sampling even if every event requests another sample', () => {
    stop = observeStartupResponsiveness(vi.fn())
    vi.advanceTimersByTime(11_000)
    for (let j = 0; j < 5; j++) {
      document.dispatchEvent(new Event('pointerdown'))
      for (let i = 0; i < 70; i++) {
        vi.advanceTimersByTime(16)
        const entries = [...frames]
        frames.clear()
        for (const [, cb] of entries) cb(performance.now())
      }
      vi.advanceTimersByTime(5000)
    }
    expect(requestAnimationFrame).toHaveBeenCalledTimes(64 * 3)
  })

  it('detects repeated multi-second blocking rather than treating severe stalls as sleep', () => {
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    vi.advanceTimersByTime(11_000)
    deliver([3500])
    vi.advanceTimersByTime(5000)
    deliver([3500, 3500])
    expect(detected).toHaveBeenCalledOnce()
  })

  it('clears accumulated evidence on the native resume notification', () => {
    const detected = vi.fn()
    stop = observeStartupResponsiveness(detected)
    vi.advanceTimersByTime(11_000)
    deliver([250, 250])
    document.dispatchEvent(new Event('dsh:render-resume'))
    vi.advanceTimersByTime(5000)
    deliver([250])
    expect(detected).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    deliver([250, 250])
    expect(detected).toHaveBeenCalledOnce()
  })
})
