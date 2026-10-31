// @vitest-environment jsdom
/**
 * Cold rows: rows far from the reader skip layout through `content-visibility`. jsdom has neither
 * IntersectionObserver nor layout, so the observers are stand-ins the case fires by hand. The stylesheet
 * half lives in chat-cold-rows-styles.client.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLD_ATTRIBUTE, COLD_HEIGHT_PROPERTY, ColdRows } from '../src/client/chat/chat-cold-rows.ts'

interface FakeEntry { target: Element; isIntersecting: boolean; boundingClientRect: { height: number } }

class FakeIntersectionObserver {
  static readonly all: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  disconnected = false
  constructor(readonly callback: (entries: FakeEntry[]) => void, readonly options: IntersectionObserverInit) {
    FakeIntersectionObserver.all.push(this)
  }

  observe(target: Element): void { this.observed.add(target) }
  unobserve(target: Element): void { this.observed.delete(target) }
  disconnect(): void { this.disconnected = true; this.observed.clear() }
  fire(target: Element, isIntersecting: boolean, height = 0): void {
    this.callback([{ target, isIntersecting, boundingClientRect: { height } }])
  }
}

/** The two observers, by margin: warming at 200%, cooling at 300%. */
function observers(): { warm: FakeIntersectionObserver; cold: FakeIntersectionObserver } {
  const warm = FakeIntersectionObserver.all.find(observer => observer.options.rootMargin === '200% 0px 200% 0px')
  const cold = FakeIntersectionObserver.all.find(observer => observer.options.rootMargin === '300% 0px 300% 0px')
  if (warm === undefined || cold === undefined) throw new Error('observers missing')
  return { warm, cold }
}

function transcript(rows: number) {
  const scroller = document.createElement('div')
  const column = document.createElement('div')
  const flow = document.createElement('div')
  flow.setAttribute('data-slot', 'conversation.chat.flow')
  const items: HTMLElement[] = []
  for (let index = 0; index < rows; index++) items.push(row(flow, index))
  column.append(flow)
  scroller.append(column)
  document.body.append(scroller)
  return { scroller, column, flow, items }
}

function row(flow: HTMLElement, index: number): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-chat-flow-key', `row-${String(index)}`)
  flow.append(element)
  return element
}

beforeEach(() => {
  FakeIntersectionObserver.all.length = 0
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('ColdRows', () => {
  it('marks a row beyond the cold margin and remembers its height, leaving near rows alone', () => {
    const { scroller, column, items } = transcript(10)
    const cold = new ColdRows()
    cold.attach(scroller, column)
    const { warm, cold: coldObserver } = observers()
    expect([...warm.observed]).toEqual(items)
    expect([...coldObserver.observed]).toEqual(items)

    coldObserver.fire(items[0]!, false, 419.6015625)
    expect(items[0]!.hasAttribute(COLD_ATTRIBUTE)).toBe(true)
    // Written whole (layout units), so the transcript keeps its length to the pixel.
    expect(items[0]!.style.getPropertyValue(COLD_HEIGHT_PROPERTY)).toBe('419.6015625px')
    // Inside the cold margin the row keeps rendering, however far it is from the viewport proper.
    coldObserver.fire(items[1]!, true, 300)
    expect(items[1]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
  })

  it('warms a cold row once it comes within the warm margin', () => {
    const { scroller, column, items } = transcript(10)
    new ColdRows().attach(scroller, column)
    const { warm, cold } = observers()
    cold.fire(items[2]!, false, 100)
    expect(items[2]!.hasAttribute(COLD_ATTRIBUTE)).toBe(true)
    warm.fire(items[2]!, true, 100)
    expect(items[2]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
    // Leaving the warm margin alone does not cool it: only the farther margin does.
    warm.fire(items[3]!, false, 100)
    expect(items[3]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
  })

  it('keeps the newest rows, and any row holding focus, warm', () => {
    const { scroller, column, items } = transcript(10)
    const button = document.createElement('button')
    items[1]!.append(button)
    button.focus()
    new ColdRows().attach(scroller, column)
    const { cold } = observers()
    for (const index of [9, 8, 7, 6]) cold.fire(items[index]!, false, 50)
    cold.fire(items[1]!, false, 50)
    for (const index of [9, 8, 7, 6, 1]) expect(items[index]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
    cold.fire(items[5]!, false, 50)
    expect(items[5]!.hasAttribute(COLD_ATTRIBUTE)).toBe(true)
  })

  it('stands in for the content box: padding and borders come off the measured height', () => {
    const { scroller, column, items } = transcript(8)
    items[0]!.style.padding = '10px 0 6px'
    items[0]!.style.borderTop = '2px solid red'
    new ColdRows().attach(scroller, column)
    observers().cold.fire(items[0]!, false, 100)
    expect(items[0]!.style.getPropertyValue(COLD_HEIGHT_PROPERTY)).toBe('82px')
  })

  it('leaves hidden rows and rows in a fold alone', () => {
    const { scroller, column, items } = transcript(10)
    items[0]!.hidden = true
    items[1]!.setAttribute('data-chat-motion', '')
    new ColdRows().attach(scroller, column)
    observers().cold.fire(items[0]!, false, 50)
    observers().cold.fire(items[1]!, false, 50)
    expect(items[0]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
    expect(items[1]!.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
  })

  it('does not write a zero height, so the stylesheet fallback stays in force', () => {
    const { scroller, column, items } = transcript(8)
    new ColdRows().attach(scroller, column)
    observers().cold.fire(items[0]!, false, 0)
    expect(items[0]!.hasAttribute(COLD_ATTRIBUTE)).toBe(true)
    expect(items[0]!.style.getPropertyValue(COLD_HEIGHT_PROPERTY)).toBe('')
  })

  it('observes rows that arrive later and stops watching rows that leave', async () => {
    const { scroller, column, flow, items } = transcript(6)
    new ColdRows().attach(scroller, column)
    const { warm, cold } = observers()
    const added = row(flow, 6)
    items[0]!.remove()
    await Promise.resolve()
    expect(warm.observed.has(added)).toBe(true)
    expect(cold.observed.has(added)).toBe(true)
    expect(warm.observed.has(items[0]!)).toBe(false)
    expect(cold.observed.has(items[0]!)).toBe(false)
  })

  it('follows a flow anchor that appears after the column', async () => {
    const scroller = document.createElement('div')
    const column = document.createElement('div')
    scroller.append(column)
    document.body.append(scroller)
    new ColdRows().attach(scroller, column)
    const flow = document.createElement('div')
    flow.setAttribute('data-slot', 'conversation.chat.flow')
    const first = row(flow, 0)
    column.append(flow)
    await Promise.resolve()
    expect(observers().cold.observed.has(first)).toBe(true)
  })

  it('gives every row back to normal layout on detach', () => {
    const { scroller, column, items } = transcript(10)
    const rows = new ColdRows()
    rows.attach(scroller, column)
    const { warm, cold } = observers()
    cold.fire(items[0]!, false, 80)
    cold.fire(items[1]!, false, 90)
    rows.detach()
    for (const item of items) {
      expect(item.hasAttribute(COLD_ATTRIBUTE)).toBe(false)
      expect(item.style.getPropertyValue(COLD_HEIGHT_PROPERTY)).toBe('')
    }
    expect(warm.disconnected).toBe(true)
    expect(cold.disconnected).toBe(true)
  })

  it('does nothing where IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { scroller, column } = transcript(4)
    expect(() => { new ColdRows().attach(scroller, column) }).not.toThrow()
    expect(FakeIntersectionObserver.all).toHaveLength(0)
  })
})
