// @vitest-environment jsdom
// PeakValleyRow (composer.dock entry): session-cost gate × peak/route
// disjunction, Beijing-time
// phase/countdown rendering, and the per-second tick across a boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { PeakValleyRow, type PeakValleyRowProps } from '../src/client/chat/PeakValleyRow.tsx'
import type { ComposerModelFact } from '../src/client/input/model-facts.ts'
import { en, zh } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const t = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonEn)

beforeEach(() => {
  vi.useFakeTimers()
  // Beijing Monday 2026-03-02 11:59:00 — peak, one minute before the 12:00 close.
  vi.setSystemTime(new Date(Date.UTC(2026, 2, 2, 3, 59, 0, 0)))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function mount(opts: {
  peakValley?: boolean
  provider?: string | null
  sessionCost?: boolean
  t?: PeakValleyRowProps['t']
} = {}) {
  const peakStore = createSnapshotStore(opts.peakValley ?? false)
  const factStore = createSnapshotStore<ComposerModelFact>({ provider: opts.provider ?? null })
  const costStore = createSnapshotStore(opts.sessionCost ?? false)
  const view = render(<PeakValleyRow
    usePeakValley={bindSnapshotSelector(peakStore)}
    useModelProvider={bindSnapshotSelector(factStore)}
    useSessionCost={bindSnapshotSelector(costStore)}
    t={opts.t ?? t}
  />)
  return {
    view,
    setPeakValley: (value: boolean) => act(() => { peakStore.set(value) }),
    setProvider: (provider: string | null) => act(() => { factStore.set({ provider }) }),
    setSessionCost: (value: boolean) => act(() => { costStore.set(value) }),
  }
}

const textOf = (view: ReturnType<typeof mount>): string => view.view.container.textContent ?? ''

describe('PeakValleyRow visibility', () => {
  it('renders nothing while the switch is off and no DeepSeek route is known', () => {
    expect(textOf(mount())).toBe('')
  })

  it('renders nothing for a non-DeepSeek route while the switch is off', () => {
    expect(textOf(mount({ provider: 'anthropic-relay' }))).toBe('')
  })

  it('renders nothing for a detected DeepSeek route while session cost is off', () => {
    expect(textOf(mount({ provider: 'deepseek-official' }))).toBe('')
  })

  it('renders nothing while the peak/valley switch is on and session cost is off', () => {
    expect(textOf(mount({ peakValley: true, provider: 'deepseek-official' }))).toBe('')
  })

  it('reserves the enabled cost row while provider and usage projections are pending', () => {
    const view = mount({ sessionCost: true })
    expect(textOf(view)).toBe('')
    expect(view.view.container.querySelector('[data-composer-cost-placeholder]')?.getAttribute('aria-hidden')).toBe('true')
    view.setProvider('deepseek-official')
    expect(view.view.container.querySelector('[data-composer-cost-placeholder]')).toBeNull()
    expect(view.view.container.querySelector('[data-phase]')).not.toBeNull()
    view.setSessionCost(false)
    expect(view.view.container.firstChild).toBeNull()
  })

  it('renders for a detected DeepSeek route while session cost is on and the peak/valley switch is off', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true })
    expect(view.view.container.querySelector('[data-phase="peak"]')).not.toBeNull()
  })

  it('renders while both switches are on regardless of the route', () => {
    expect(textOf(mount({ peakValley: true, sessionCost: true }))).not.toBe('')
    expect(textOf(mount({ peakValley: true, sessionCost: true, provider: 'anthropic-relay' }))).not.toBe('')
  })

  it('appears and disappears live with the cost gate, with no cached row left behind', () => {
    const view = mount({ provider: 'deepseek' })
    expect(textOf(view)).toBe('')
    view.setSessionCost(true)
    expect(view.view.container.querySelector('[data-phase]')).not.toBeNull()
    view.setSessionCost(false)
    expect(textOf(view)).toBe('')
    view.setPeakValley(true)
    expect(textOf(view)).toBe('')
    view.setSessionCost(true)
    expect(view.view.container.querySelector('[data-phase]')).not.toBeNull()
  })
})

describe('PeakValleyRow phase and countdown', () => {
  it('paints the Beijing-time phase, its name, and the countdown to the next switch', () => {
    const view = mount({ peakValley: true, sessionCost: true })
    const row = view.view.container.querySelector('[data-phase="peak"]')
    expect(row).not.toBeNull()
    expect(textOf(view)).toContain('高峰时段')
    expect(textOf(view)).toContain('距离切换剩余时间：00:01:00')
    // The schedule hint rides the phase group's native title — the cost figure
    // is a button with its own detail card, so the row itself must not put a
    // native tooltip on it.
    expect(view.view.container.querySelector('[class*="phaseGroup"]')?.getAttribute('title'))
      .toBe(zh['peakValley.hint.peak'])
  })

  it('ticks every second and flips color, text, and countdown at the boundary', () => {
    const view = mount({ peakValley: true, sessionCost: true })
    // First aligned tick lands at 11:59:01.005 Beijing → 58 whole seconds left.
    act(() => { vi.advanceTimersByTime(1_005) })
    expect(textOf(view)).toContain('距离切换剩余时间：00:00:58')
    // Advance across the 12:00:00 close: the row flips to off-peak without a
    // remount and recomputes the countdown to the 14:00 reopen.
    act(() => { vi.advanceTimersByTime(59_000) })
    const row = view.view.container.querySelector('[data-phase="off-peak"]')
    expect(row).not.toBeNull()
    expect(textOf(view)).toContain('空闲时段')
    expect(textOf(view)).toContain('距离切换剩余时间：01:59:59')
    expect(view.view.container.querySelector('[class*="phaseGroup"]')?.getAttribute('title'))
      .toBe(zh['peakValley.hint.offPeak'])
  })

  it('takes the labels from the active locale', () => {
    const view = mount({ peakValley: true, sessionCost: true, t: tEn })
    expect(textOf(view)).toContain('Peak hours')
    expect(textOf(view)).toContain('Switches in 00:01:00')
  })
})
