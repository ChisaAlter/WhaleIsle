// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { TabLayout } from '../src/components/TabLayout.tsx'
import { DockController } from '../src/engine/controller.ts'
import { getNode, getPane } from '../src/engine/tree.ts'
import type { PaneCallbacks } from '../src/components/render.ts'
import type { TabId } from '../src/contract/types.ts'
import { followPointer } from '../src/components/pointer.ts'
import { seededController, TEST_LABELS } from './fixtures.client.ts'
import css from '../src/components/dockkit.module.css'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function mounted(controller = seededController(), options: Partial<ComponentProps<typeof TabLayout>> = {}, renderBody?: PaneCallbacks['renderTab']) {
  const callbacks: PaneCallbacks = {
    onFocusTab: (id) => { controller.focusTab(id); redraw() },
    onFocusPane: (id) => { controller.focusPane(id); redraw() },
    onSplitPane: vi.fn(), onAddTab: vi.fn(), onCloseTab: vi.fn(), onTabPressed: vi.fn(), onDividerPressed: vi.fn(),
    splitBlock: () => undefined, canAddTab: () => true, canCloseTab: () => true, canDockTab: () => true,
    dropTarget: undefined, draggingTabId: undefined, labels: TEST_LABELS,
    renderTab: renderBody ?? (tab => <input data-body={tab.id} defaultValue={tab.title} />),
    renderTabTitle: undefined, renderTabMenuItems: undefined,
    chromePaneId: getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).id,
    chrome: undefined,
  }
  const props = () => ({ state: controller.getSnapshot().state, callbacks, intents: controller, preview: undefined, ...options })
  const view = render(<TabLayout {...props()} />)
  function redraw(next: typeof options = {}) {
    options = { ...options, ...next }
    view.rerender(<TabLayout {...props()} />)
  }
  const node = (selector: string): HTMLElement => {
    const element = view.container.querySelector<HTMLElement>(selector)
    if (element === null) throw new Error(`missing ${selector}`)
    return element
  }
  return { controller, view, redraw, callbacks, node, body: (id: TabId) => node(`[data-body="${id}"]`) }
}

/** Use the shipped stylesheet with the class names Vitest gives its CSS module. */
function floatStyles(extra = ''): void {
  const style = document.createElement('style')
  style.textContent = readFileSync(resolve(import.meta.dirname, '../src/components/dockkit.module.css'), 'utf8')
    .replace(/\.([a-zA-Z][\w-]*)/g, (selector, name: string) => css[name] ? `.${css[name]}` : selector) + extra
  document.head.append(style)
  onTestFinished(() => { style.remove() })
}

/** jsdom has no layout or compositor; supply only those browser primitives. */
function floatBrowser(reduced = false) {
  vi.stubGlobal('innerWidth', 1400)
  vi.stubGlobal('innerHeight', 1000)
  const preference = new EventTarget() as MediaQueryList
  Object.defineProperties(preference, { matches: { get: () => reduced }, media: { value: '(prefers-reduced-motion: reduce)' } })
  vi.stubGlobal('matchMedia', vi.fn(() => preference))
  const transforms = new Map<Element, string>()
  const opacities = new Map<Element, string>()
  const frames: Array<{ target: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: ReturnType<typeof vi.fn>; finish: () => void }> = []
  const animationDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
  class TestPlaybackEvent extends Event implements AnimationPlaybackEvent {
    readonly currentTime = null
    readonly timelineTime = null
  }
  class TestAnimation extends EventTarget implements Animation {
    currentTime: Animation['currentTime'] = 0
    effect: AnimationEffect | null = null
    id = ''
    oncancel: Animation['oncancel'] = null
    onfinish: Animation['onfinish'] = null
    onremove: Animation['onremove'] = null
    readonly overallProgress: Animation['overallProgress'] = null
    pending = false
    playbackRate = 1
    playState: AnimationPlayState = 'running'
    replaceState: AnimationReplaceState = 'active'
    startTime: Animation['startTime'] = 0
    timeline: AnimationTimeline | null = null
    constructor(private readonly target: HTMLElement, private readonly endOpacity?: string) { super() }
    readonly cancel = vi.fn(() => {
      transforms.delete(this.target)
      opacities.delete(this.target)
      this.playState = 'idle'
      this.oncancel?.call(this, new TestPlaybackEvent('cancel'))
    })
    finish(): void {
      transforms.delete(this.target)
      if (this.endOpacity !== undefined) opacities.set(this.target, this.endOpacity)
      this.playState = 'finished'
      this.onfinish?.call(this, new TestPlaybackEvent('finish'))
    }
    // The fixture models the compositor operations this surface consumes; any
    // unexpected WAAPI use must request its own browser primitive observation.
    get finished(): Promise<Animation> { throw new Error('The fixture does not observe finished promises') }
    get ready(): Promise<Animation> { throw new Error('The fixture does not observe ready promises') }
    commitStyles(): void { throw new Error('The fixture does not commit compositor styles') }
    pause(): void { throw new Error('The fixture does not schedule paused animations') }
    persist(): void { throw new Error('The fixture does not persist replaced animations') }
    play(): void { throw new Error('The fixture does not reschedule animations') }
    reverse(): void { throw new Error('The fixture does not reverse animations') }
    updatePlaybackRate(): void { throw new Error('The fixture does not change animation playback rates') }
  }
  const animate = vi.fn(function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    if (keyframes[0]?.opacity !== undefined) opacities.set(this, String(keyframes[0].opacity))
    const opacity = keyframes.at(-1)?.opacity
    const animation = new TestAnimation(this, opacity === undefined ? undefined : String(opacity))
    frames.push({ target: this, keyframes, options, cancel: animation.cancel, finish: () => { animation.finish() } })
    return animation
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  onTestFinished(() => {
    if (animationDescriptor) Object.defineProperty(HTMLElement.prototype, 'animate', animationDescriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  })
  const computed = window.getComputedStyle.bind(window)
  vi.stubGlobal('getComputedStyle', (element: Element) => {
    const style = computed(element)
    return new Proxy(style, {
      get(target, property) {
        if (property === 'transform') return transforms.get(element) ?? target.transform
        if (property === 'opacity') return opacities.get(element) ?? target.opacity
        if (property === 'getPropertyValue') return (name: string) => name === '--ds-motion-duration-flip' ? '400ms'
          : name === '--ds-ease-in-out' ? 'cubic-bezier(0.4, 0, 0.2, 1)' : target.getPropertyValue(name)
        return Reflect.get(target, property)
      },
    })
  })
  class TestMatrix {
    readonly a: number
    readonly b: number
    readonly c: number
    readonly d: number
    readonly e: number
    readonly f: number
    constructor(transform: string) {
      const match = /^matrix\(([^)]+)\)$/.exec(transform)
      if (!match) throw new Error(`Expected a computed 2D matrix: ${transform}`)
      const values = match[1]!.split(',').map(Number)
      if (values.length !== 6 || values.some(value => !Number.isFinite(value))) throw new Error('Invalid computed matrix')
      ;[this.a, this.b, this.c, this.d, this.e, this.f] = values as [number, number, number, number, number, number]
    }
  }
  vi.stubGlobal('DOMMatrixReadOnly', TestMatrix)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const host = this.closest<HTMLElement>('[data-dockkit-float]') ?? this
    let x = Number.parseFloat(host.style.left) || 0
    let y = Number.parseFloat(host.style.top.match(/(-?\d+(?:\.\d+)?)px\)?$/)?.[1] ?? '') || 0
    let width = Number.parseFloat(host.style.width) || 0
    let height = Number.parseFloat(host.style.height) || 0
    // The fixture has a background shell and a clipped history viewport; its
    // rows keep their natural height while the viewport moves as one part.
    if (this.hasAttribute('data-dockkit-float-motion-shell')) height = this.style.height ? Number.parseFloat(this.style.height) : height - 40
    else if (this.hasAttribute('data-history-viewport') || this.hasAttribute('data-history-row')) {
      x += 12; y += height - 32; width -= 24; height = 32
      if (this.hasAttribute('data-history-row')) y += [...this.parentElement!.children].indexOf(this) * 32
    }
    const transform = transforms.get(this) ?? transforms.get(this.closest('[data-dockkit-float-motion-part]') ?? this)
    if (!transform) return new DOMRect(x, y, width, height)
    const matrix = new TestMatrix(transform)
    return new DOMRect(x + width + matrix.e - width * matrix.a, y + matrix.f, width * matrix.a, height * matrix.d)
  })
  return {
    animate, frames,
    present: (element: Element, matrix: string) => { transforms.set(element, matrix) },
    fade: (element: Element, opacity: number) => { opacities.set(element, String(opacity)) },
    reduce: (value: boolean) => { reduced = value; preference.dispatchEvent(new Event('change')) },
  }
}

function contentFloat(height = 300, motion = false) {
  const controller = seededController()
  const tab = controller.openContent({ kind: 'companion', contentId: 'companion:content', title: 'Content' })
  const pane = controller.floatTab(tab, { x: 400, y: 70, width: 360, height })
  const h = mounted(controller, { keepMounted: () => true }, record => (
    <div data-dockkit-float-chrome="content" data-dockkit-float-motion={motion ? 'morph' : undefined}>
      <span data-dockkit-float-motion-part="surface" data-dockkit-float-motion-shell aria-hidden="true"
        style={{ backgroundColor: 'rgb(255, 255, 255)', borderRadius: '24px' }} />
      <div data-dockkit-float-drag-handle>
        <span data-drag-label>Drag here</span>
        <button type="button">Action</button>
        <a href="#result">Result</a>
        <input data-body={record.id} defaultValue={record.title} />
      </div>
      <div data-dockkit-float-motion-part="history" data-history-viewport style={{ height: 32, overflow: 'auto' }}>
        <button type="button" data-history-row>Earlier finished request</button>
        <button type="button" data-history-row>Another finished request outside the viewport</button>
      </div>
    </div>
  ))
  // Gestures settle through the same observable controller subscription as an embedder.
  onTestFinished(controller.subscribe(() => { h.redraw() }))
  return { ...h, tab, pane, host: h.node(`[data-dockkit-float="${pane}"]`) }
}

it('lets content own its chrome at 38px while retaining the same editable body and resize corner', () => {
  floatStyles()
  const h = contentFloat(38)
  const host = h.host
  const draft = h.body(h.tab) as HTMLInputElement
  const body = draft.closest<HTMLElement>(`.${css.floatBody}`)!
  fireEvent.change(draft, { target: { value: 'Unsaved content' } })
  expect(getComputedStyle(h.node('[data-dockkit-float-grip]').parentElement!).display).toBe('none')
  expect(getComputedStyle(host).boxShadow).toBe('none')
  expect(body.hidden).toBe(false)
  expect(body.inert).toBe(false)
  expect(body.getAttribute('aria-hidden')).toBeNull()
  expect(h.node('[data-dockkit-float-resize]')).toBeDefined()
  for (const height of [260, 520, 38]) {
    h.controller.resizeFloat(h.pane, { x: 400, y: 70, width: 360, height })
    h.redraw()
    expect(h.body(h.tab)).toBe(draft)
    expect(draft.value).toBe('Unsaved content')
    expect(draft.closest('[data-dockkit-float]')).toBe(host)
    expect(body.hidden).toBe(false)
    expect(body.inert).toBe(false)
  }
  h.redraw({ active: false })
  h.redraw({ active: true })
  expect(h.body(h.tab)).toBe(draft)
  expect(draft.value).toBe('Unsaved content')
})

it('moves from an internal grip and leaves nested buttons, links and inputs interactive', () => {
  const h = contentFloat()
  const moved = vi.spyOn(h.controller, 'moveFloat')
  fireEvent.pointerDown(h.node('[data-drag-label]'), { pointerId: 31, button: 0, clientX: 500, clientY: 90 })
  expect(h.host.dataset.dockkitPointer).toBe('31')
  fireEvent.pointerMove(window, { pointerId: 31, clientX: 550, clientY: 120 })
  fireEvent.pointerUp(window, { pointerId: 31, clientX: 550, clientY: 120 })
  h.redraw()
  expect(moved).toHaveBeenCalledExactlyOnceWith(h.pane, 450, 100)
  expect(getPane(h.controller.getSnapshot().state, h.pane).rect).toMatchObject({ x: 450, y: 100 })
  expect(h.host.dataset.dockkitPointer).toBeUndefined()
  moved.mockClear()
  for (const selector of ['button', 'a', 'input']) {
    fireEvent.pointerDown(h.node(`[data-dockkit-float-drag-handle] ${selector}`), { pointerId: 32, button: 0, clientX: 500, clientY: 100 })
    expect(h.host.dataset.dockkitPointer).toBeUndefined()
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 570, clientY: 150 })
    fireEvent.pointerUp(window, { pointerId: 32, clientX: 570, clientY: 150 })
  }
  expect(moved).not.toHaveBeenCalled()
})

it('keeps incoming pill geometry natural and carries fading skins and clipped history through rapid changes', () => {
  floatStyles('.fixtureMorphShell { background-color: rgb(255, 255, 255); border-radius: 24px; box-shadow: 0 4px 20px black; } .fixtureMorphShell.dark { background-color: rgb(20, 20, 20); border-radius: 22px; }')
  const browser = floatBrowser()
  const h = contentFloat(520, true)
  const draft = h.body(h.tab)
  const shell = h.node('[data-dockkit-float-motion-shell]')
  const history = h.node('[data-history-viewport]')
  const historyRow = h.node('[data-history-row]')
  expect(browser.animate).not.toHaveBeenCalled()
  shell.style.backgroundColor = ''
  shell.style.borderRadius = ''
  shell.className = 'fixtureMorphShell dark'
  h.controller.resizeFloat(h.pane, { x: 280, y: 80, width: 480, height: 84 })
  h.redraw()
  expect(browser.frames).toHaveLength(3)
  const incoming = browser.frames[0]!.target
  const outgoing = browser.frames[1]!.target
  for (const skin of [incoming, outgoing]) {
    expect(skin.getAttribute('aria-hidden')).toBe('true')
    expect(skin.querySelector('input, button, [data-body]')).toBeNull()
    expect(getComputedStyle(skin).pointerEvents).toBe('none')
    expect(skin.parentElement).toBe(shell)
  }
  expect(incoming.style.backgroundColor).toBe('rgb(20, 20, 20)')
  expect(incoming.style.borderRadius).toBe('22px')
  expect(incoming.style.width).toBe('480px')
  expect(incoming.style.height).toBe('44px')
  expect(outgoing.style.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(outgoing.style.borderRadius).toBe('24px')
  expect(outgoing.style.width).toBe('360px')
  expect(outgoing.style.height).toBe('480px')
  expect(shell.style.backgroundColor).toBe('transparent')
  expect(shell.style.boxShadow).toBe('none')
  expect(browser.frames[0]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  expect(browser.frames[0]!.options.fill).toBe('forwards')
  expect(browser.frames[2]!.target).toBe(history)
  expect(getComputedStyle(history).overflow).toBe('auto')
  expect(browser.frames.some(frame => frame.target === h.host || frame.target === shell || frame.target.contains(draft))).toBe(false)
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(true)
  expect(browser.frames[1]!.options).toEqual({ duration: 400, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
  expect(browser.frames[1]!.keyframes).toEqual([
    { transform: 'translate(0px, -10px) scale(1, 1)', opacity: '1' },
    { transform: 'translate(0, 0) scale(1, 0.09166666666666666)', opacity: 0 },
  ])
  expect(browser.frames[2]!.keyframes).toEqual([
    { transform: 'translate(0px, 426px)' }, { transform: 'translate(0, 0)' },
  ])
  // Computed midway transforms are independent; the history retains 32px height.
  browser.present(outgoing, 'matrix(0.8, 0, 0, 0.5, 7, -4)')
  browser.present(history, 'matrix(1, 0, 0, 1, 0, -150)')
  browser.fade(outgoing, 0.35)
  browser.fade(incoming, 0.65)
  expect(historyRow.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(history).overflow).toBe('auto')
  shell.className = 'fixtureMorphShell'
  h.controller.resizeFloat(h.pane, { x: 460, y: 60, width: 300, height: 520 })
  h.redraw()
  expect(browser.frames.slice(0, 3).every(frame => frame.cancel.mock.calls.length === 1)).toBe(true)
  expect(browser.frames).toHaveLength(7)
  const latestIncoming = browser.frames[3]!.target
  expect(latestIncoming.style.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(latestIncoming.style.width).toBe('300px')
  expect(latestIncoming.style.height).toBe('480px')
  expect(browser.frames[4]!.target).toBe(incoming)
  expect(browser.frames[4]!.keyframes).toEqual([
    { transform: 'translate(0px, 20px) scale(1, 1)', opacity: '0.65' },
    { transform: 'translate(0, 0) scale(0.625, 1)', opacity: 0 },
  ])
  expect(browser.frames[5]!.target).toBe(outgoing)
  expect(browser.frames[5]!.keyframes[0]).toEqual({ transform: 'translate(7px, 16px) scale(0.8, 0.5)', opacity: '0.35' })
  expect(browser.frames[6]!.keyframes[0]).toEqual({ transform: 'translate(0px, -566px)' })
  expect(shell.querySelectorAll(`.${css.floatMorphGhost}`)).toHaveLength(3)
  expect(incoming.parentElement).toBe(shell)
  expect(outgoing.parentElement).toBe(shell)
  expect(incoming.querySelector(`.${css.floatMorphGhost}`)).toBeNull()
  expect(historyRow.getBoundingClientRect().height).toBe(32)
  expect(getComputedStyle(history).overflow).toBe('auto')
  expect(h.body(h.tab)).toBe(draft)
  expect(draft.closest('[data-dockkit-float]')).toBe(h.host)
  browser.frames[1]!.finish()
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(true)
  expect(latestIncoming.isConnected).toBe(true)
  browser.frames[3]!.finish()
  browser.frames[4]!.finish()
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(true)
  browser.frames[5]!.finish()
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(true)
  browser.frames[6]!.finish()
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(false)
  expect(latestIncoming.isConnected).toBe(false)
  expect(incoming.isConnected).toBe(false)
  expect(outgoing.isConnected).toBe(false)
  expect(shell.style.backgroundColor).toBe('')
  expect(shell.style.boxShadow).toBe('')
  expect(getComputedStyle(shell).backgroundColor).toBe('rgb(255, 255, 255)')
  expect(getComputedStyle(shell).boxShadow).toBe('0 4px 20px black')
  expect(getComputedStyle(history).overflow).toBe('auto')
  h.controller.moveFloat(h.pane, 500, 90)
  h.redraw()
  expect(browser.frames).toHaveLength(7)
})

it('continues presented background skins when a second natural-height fit leaves the shell box unchanged', () => {
  const browser = floatBrowser()
  const h = contentFloat(520, true)
  const shell = h.node('[data-dockkit-float-motion-shell]')
  shell.style.height = '44px'
  shell.style.backgroundColor = 'rgb(20, 20, 20)'
  shell.style.borderRadius = '22px'
  h.controller.resizeFloat(h.pane, { x: 280, y: 80, width: 480, height: 84 })
  h.redraw()
  expect(browser.frames).toHaveLength(3)
  const incoming = browser.frames[0]!.target
  const outgoing = browser.frames[1]!.target
  browser.fade(incoming, 0.4)
  browser.fade(outgoing, 0.6)
  browser.present(outgoing, 'matrix(0.9, 0, 0, 0.75, 0, -7)')
  const shellBox = shell.getBoundingClientRect()
  // A history measurement fits the outer host again, while strip height stays 44px.
  h.controller.resizeFloat(h.pane, { x: 280, y: 80, width: 480, height: 100 })
  h.redraw()
  expect(shell.getBoundingClientRect()).toEqual(shellBox)
  expect(browser.frames.slice(0, 3).every(frame => frame.cancel.mock.calls.length === 1)).toBe(true)
  expect(browser.frames).toHaveLength(7)
  expect(shell.querySelectorAll(`.${css.floatMorphGhost}`)).toHaveLength(3)
  expect(shell.style.backgroundColor).toBe('transparent')
  expect(browser.frames[3]!.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
  expect(browser.frames[3]!.target.style.height).toBe('44px')
  expect(browser.frames[4]!.target).toBe(incoming)
  expect(browser.frames[4]!.keyframes[0]).toEqual({ transform: 'translate(0px, 0px) scale(1, 1)', opacity: '0.4' })
  expect(browser.frames[5]!.target).toBe(outgoing)
  expect(browser.frames[5]!.keyframes[0]).toEqual({ transform: 'translate(0px, -7px) scale(0.9, 0.75)', opacity: '0.6' })
  expect(browser.frames.some(frame => frame.target === shell)).toBe(false)
  for (const frame of browser.frames.slice(3)) frame.finish()
  expect(shell.querySelector(`.${css.floatMorphGhost}`)).toBeNull()
  expect(shell.style.backgroundColor).toBe('rgb(20, 20, 20)')
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(false)
})

it('skips morphs with reduced motion and cancels a running morph when the preference changes', () => {
  const browser = floatBrowser(true)
  const h = contentFloat(200, true)
  h.controller.resizeFloat(h.pane, { x: 280, y: 80, width: 480, height: 520 })
  h.redraw()
  expect(browser.animate).not.toHaveBeenCalled()
  browser.reduce(false)
  h.controller.resizeFloat(h.pane, { x: 400, y: 70, width: 360, height: 300 })
  h.redraw()
  expect(browser.frames).toHaveLength(3)
  browser.reduce(true)
  expect(browser.frames.every(frame => frame.cancel.mock.calls.length === 1)).toBe(true)
  expect(h.host.querySelector(`.${css.floatMorphGhost}`)).toBeNull()
  expect(h.node('[data-dockkit-float-motion-shell]').style.backgroundColor).toBe('rgb(255, 255, 255)')
  expect(h.host.hasAttribute('data-dockkit-float-morphing')).toBe(false)
  h.controller.resizeFloat(h.pane, { x: 460, y: 70, width: 300, height: 200 })
  h.redraw()
  expect(browser.frames).toHaveLength(3)
})

it('does not morph during manual moves or resize previews and preserves the editable body', () => {
  const browser = floatBrowser()
  const h = contentFloat(200, true)
  const draft = h.body(h.tab)
  fireEvent.pointerDown(h.node('[data-drag-label]'), { pointerId: 41, button: 0, clientX: 500, clientY: 90 })
  fireEvent.pointerMove(window, { pointerId: 41, clientX: 550, clientY: 120 })
  fireEvent.pointerUp(window, { pointerId: 41, clientX: 550, clientY: 120 })
  h.redraw()
  expect(getPane(h.controller.getSnapshot().state, h.pane).rect).toMatchObject({ x: 450, y: 100 })
  fireEvent.pointerDown(h.node('[data-dockkit-float-resize]'), { pointerId: 42, button: 0, clientX: 810, clientY: 300 })
  fireEvent.pointerMove(window, { pointerId: 42, clientX: 850, clientY: 350 })
  expect(h.host.style.width).toBe('400px')
  expect(h.host.style.height).toBe('250px')
  expect(browser.animate).not.toHaveBeenCalled()
  fireEvent.pointerUp(window, { pointerId: 42, clientX: 850, clientY: 350 })
  h.redraw()
  expect(getPane(h.controller.getSnapshot().state, h.pane).rect).toMatchObject({ width: 400, height: 250 })
  expect(browser.animate).not.toHaveBeenCalled()
  expect(h.body(h.tab)).toBe(draft)
})

it('keeps floating-only panels without a dock action while ordinary floating panels retain it', () => {
  const controller = seededController()
  const tab = controller.openContent({ kind: 'observer', contentId: 'observer:project', title: 'Observer' })
  const pane = controller.floatTab(tab, { x: 20, y: 70, width: 360, height: 300 })
  const h = mounted(controller)
  h.redraw({ callbacks: { ...h.callbacks, canDockTab: () => false } })
  expect(h.view.container.querySelector('[data-dockkit-float-dock]')).toBeNull()
  expect(h.view.container.querySelector('[data-dockkit-float-close]')).not.toBeNull()
  const body = h.body(tab)
  controller.resizeFloat(pane, { x: 20, y: 70, width: 360, height: 38 })
  h.redraw()
  expect(h.view.container.querySelector('[data-dockkit-float-dock]')).toBeNull()
  expect(h.body(tab)).toBe(body)
  h.redraw({ callbacks: { ...h.callbacks, canDockTab: () => true } })
  expect(h.view.container.querySelector('[data-dockkit-float-dock]')).not.toBeNull()
})

it('minimizes a floating tab to its native header and restores the same mounted body', () => {
  const controller = seededController()
  controller.setExpanded(true)
  const tab = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  controller.floatTab(tab, { x: 20, y: 70, width: 360, height: 300 })
  const pane = controller.getSnapshot().state.floats[0]!
  const h = mounted(controller)
  const body = h.body(tab)
  fireEvent.change(body, { target: { value: 'Ordinary unsaved draft' } })
  expect(body.closest('[data-dockkit-content]')?.getAttribute('aria-hidden')).toBeNull()
  controller.resizeFloat(pane, { x: 20, y: 70, width: 360, height: 38 })
  h.redraw()
  expect(h.body(tab)).toBe(body)
  expect(body).toHaveProperty('value', 'Ordinary unsaved draft')
  expect(body.parentElement).toHaveProperty('hidden', true)
  expect(body.parentElement).toHaveProperty('inert', true)
  expect(h.view.container.querySelector('[data-dockkit-float-resize]')).toBeNull()
  expect(h.node('[data-dockkit-float-title]')).toBeDefined()
  controller.resizeFloat(pane, { x: 20, y: 70, width: 360, height: 300 })
  h.redraw()
  expect(h.body(tab)).toBe(body)
  expect(body.parentElement).toHaveProperty('hidden', false)
  expect(body.parentElement).toHaveProperty('inert', false)
  expect(h.node('[data-dockkit-float-resize]')).toBeDefined()
})

it('mounts an opted-in hidden body on open while other retained bodies still wait for visibility', () => {
  const controller = seededController()
  const lazy = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  const eager = controller.openContent({ kind: 'browser', contentId: 'browser:preview', title: 'Preview' })
  controller.setExpanded(false)
  const h = mounted(controller, { keepMounted: () => true, mountOnOpen: tab => tab.kind === 'browser', active: false })
  expect(h.view.container.querySelector('[data-body]')).toBeNull()
  h.redraw({ active: true })
  expect(h.body(eager)).toBeDefined()
  expect(h.body(eager).closest('[data-dockkit-content]')).toHaveProperty('inert', true)
  expect(h.view.container.querySelector(`[data-body="${lazy}"]`)).toBeNull()
})

it('retains visited bodies and hands keyboard focus to the newly selected strip', () => {
  const controller = seededController()
  controller.setExpanded(true)
  const first = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  const second = controller.openContent({ kind: 'file', contentId: 'file:b', title: 'B' })
  controller.focusTab(first)
  const h = mounted(controller, { keepMounted: () => true })
  const original = h.body(first)
  expect(h.view.container.querySelector(`[data-body="${second}"]`)).toBeNull()
  const chip = h.node(`[data-dockkit-tab="${second}"]`)
  chip.focus()
  fireEvent.click(chip)
  expect(document.activeElement).toBe(h.node(`[data-dockkit-content="${second}"] [data-dockkit-tab="${second}"]`))
  expect(h.body(first)).toBe(original)
  expect(original.closest('[data-dockkit-host]')).toHaveProperty('hidden', true)
  fireEvent.click(h.node(`[data-dockkit-content="${second}"] [data-dockkit-tab="${second}"]`))
  const body = h.body(second)
  body.focus()
  h.redraw({ active: false })
  expect(body.closest('[data-dockkit-content]')).toHaveProperty('inert', true)
  expect(document.activeElement).not.toBe(body)
  fireEvent.focus(body)
  h.redraw({ active: true })
  expect(h.body(second)).toBe(body)
  expect(body.closest('[data-dockkit-content]')).toHaveProperty('inert', false)
  act(() => { controller.setExpanded(false); h.redraw() })
  expect(h.body(second)).toBe(body)
})

it('keeps body ancestors through pane moves, floating, raising and docking', () => {
  vi.stubGlobal('innerWidth', 1442)
  vi.stubGlobal('innerHeight', 920)
  const controller = seededController()
  controller.setExpanded(true)
  const tab = controller.openContent({ kind: 'file', contentId: 'file:a', title: 'A' })
  const h = mounted(controller, { keepMounted: () => true })
  const body = h.body(tab)
  const host = body.closest('[data-dockkit-host]')!
  act(() => { controller.splitPane(); h.redraw() })
  expect(h.view.container.querySelectorAll('[data-dockkit-pane]')).toHaveLength(2)
  const state = controller.getSnapshot().state
  const split = getNode(state, state.rootId)
  if (split.kind !== 'split') throw new Error('expected a split')
  h.redraw({ preview: { splitId: split.id, sizes: [0.3, 0.7] } })
  expect(h.node('[data-dockkit-split]').style.gridTemplateColumns).toContain('0.3fr')
  fireEvent.pointerDown(h.node('[data-dockkit-divider]'), { button: 0, pointerId: 1 })
  expect(h.callbacks.onDividerPressed).toHaveBeenCalledOnce()
  h.redraw({ preview: undefined })
  const secondPane = getPane(state, split.children[1]!).id
  fireEvent.click(h.node(`[data-dockkit-content="${tab}"] [data-dockkit-tab="${tab}"]`))
  expect(controller.getSnapshot().state.activePaneId).toBe(split.children[0])
  act(() => { controller.focusPane(secondPane); h.redraw() })
  fireEvent.focus(body)
  expect(controller.getSnapshot().state.activePaneId).toBe(split.children[0])
  act(() => { controller.focusPane(secondPane); h.redraw() })
  fireEvent.pointerDown(h.node(`[data-dockkit-content="${tab}"]`), { button: 0, pointerId: 1 })
  fireEvent.click(body)
  fireEvent.focus(body)
  expect(controller.getSnapshot().state.activePaneId).toBe(getPane(state, split.children[0]!).id)
  act(() => { controller.placeTab(tab, secondPane, 0); h.redraw() })
  expect(h.body(tab)).toBe(body)
  expect(body.closest('[data-dockkit-host]')).toBe(host)
  act(() => { controller.floatTab(tab, { x: 1110, y: 690, width: 300, height: 200 }); h.redraw() })
  const floating = controller.getSnapshot().state.floats[0]!
  expect(body.closest('[data-dockkit-host]')).toBe(host)
  expect(host.getAttribute('data-dockkit-host')).toBe('float')
  const saved = controller.getSnapshot()
  vi.stubGlobal('innerWidth', 961)
  vi.stubGlobal('innerHeight', 680)
  fireEvent.resize(window)
  expect(h.node(`[data-dockkit-float="${floating}"]`).style.left).toBe('661px')
  expect(h.node(`[data-dockkit-float="${floating}"]`).style.top).toBe('max(var(--dsh-dockkit-float-top, 0px), 480px)')
  expect(controller.getSnapshot()).toBe(saved)
  expect(h.body(tab)).toBe(body)
  expect(body.closest('[data-dockkit-host]')).toBe(host)
  act(() => { controller.setExpanded(false); h.redraw() })
  expect(body.closest('[data-dockkit-content]')?.getAttribute('aria-hidden')).toBeNull()
  fireEvent.pointerDown(h.node(`[data-dockkit-float="${floating}"]`), { pointerId: 1, button: 0 })
  fireEvent.click(h.node(`[data-dockkit-float="${floating}"]`))
  fireEvent.focus(body)
  const resize = h.node('[data-dockkit-float-resize]')
  fireEvent.pointerDown(resize, { pointerId: 2, button: 0, clientX: 500, clientY: 400 })
  fireEvent.pointerMove(window, { pointerId: 2, clientX: 540, clientY: 440 })
  fireEvent.pointerUp(window, { pointerId: 2, clientX: 540, clientY: 440 })
  act(() => { h.redraw(); controller.unfloatPane(floating); h.redraw() })
  expect(h.body(tab)).toBe(body)
  expect(body.closest('[data-dockkit-host]')).toBe(host)
})

it('unmounts unretained bodies and restores focus to their replacement strip', () => {
  const controller = seededController()
  controller.setExpanded(true)
  const first = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  const second = controller.openContent({ kind: 'file', contentId: 'file:b', title: 'B' })
  controller.focusTab(first)
  const h = mounted(controller)
  const original = h.body(first)
  fireEvent.click(h.node(`[data-dockkit-tab="${second}"]`))
  expect(original.isConnected).toBe(false)
  h.redraw({ active: false })
  expect(h.view.container.querySelector('[data-body]')).toBeNull()
  h.redraw({ active: true })
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  fireEvent.click(h.node(`[data-dockkit-tab="${first}"]`))
  expect(focus).toHaveBeenCalled()
})

it.for(['new-control', 'origin-control', 'document', 'no-focus'] as const)('transfers tab focus without overriding a new owner: %s', (kind, test) => {
  const controller = seededController()
  controller.setExpanded(true)
  const first = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  const second = controller.openContent({ kind: 'file', contentId: 'file:b', title: 'B' })
  controller.focusTab(first)
  const h = mounted(controller)
  const control = document.createElement('button')
  document.body.append(control)
  test.onTestFinished(() => { control.remove() })
  if (kind === 'origin-control') control.focus()
  vi.spyOn(h.callbacks, 'onFocusTab').mockImplementation((id) => {
    if (kind === 'new-control') control.focus()
    if (kind === 'document' || kind === 'no-focus') {
      vi.spyOn(document, 'activeElement', 'get').mockReturnValue(kind === 'document' ? document.documentElement : null)
    }
    controller.focusTab(id)
    h.redraw()
  })
  const focus = vi.spyOn(HTMLElement.prototype, 'focus')
  fireEvent.click(h.node(`[data-dockkit-tab="${second}"]`))
  if (kind === 'new-control') expect(document.activeElement).toBe(control)
  else expect(focus).toHaveBeenCalledWith({ preventScroll: true })
})

it('does not require a docked strip when a selected tab becomes floating in the same update', () => {
  const controller = seededController()
  controller.setExpanded(true)
  const first = getPane(controller.getSnapshot().state, controller.getSnapshot().state.rootId).tabs[0]!
  const second = controller.openContent({ kind: 'file', contentId: 'file:b', title: 'B' })
  controller.focusTab(first)
  const h = mounted(controller)
  vi.spyOn(h.callbacks, 'onFocusTab').mockImplementation((id) => {
    controller.focusTab(id)
    controller.floatTab(id)
    h.redraw()
  })
  fireEvent.click(h.node(`[data-dockkit-tab="${second}"]`))
  expect(h.node(`[data-dockkit-content="${second}"]`).hasAttribute('data-dockkit-float')).toBe(true)
})

it('renders an empty pane and rejects unsupported docked trees', () => {
  const controller = new DockController()
  controller.setExpanded(true)
  const h = mounted(controller)
  expect(h.node('[data-dockkit-empty]')).toBeDefined()
  controller.openContent({ kind: 'file', contentId: 'file:a', title: 'A' })
  controller.splitPane()
  const state = controller.getSnapshot().state
  const root = getNode(state, state.rootId)
  if (root.kind !== 'split') throw new Error('expected a split')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const suppress = (event: ErrorEvent): void => {
    if (event.error instanceof Error && event.error.message === 'DockLayout requires one pane or two horizontally split panes') {
      event.preventDefault()
    }
  }
  window.addEventListener('error', suppress)
  try {
    expect(() =>{  h.redraw({ state: { ...state, nodes: { ...state.nodes, [root.id]: { ...root, axis: 'column' } } } }) })
      .toThrow('two horizontally split panes')
  } finally {
    window.removeEventListener('error', suppress)
  }
})

it('keeps a superseding gesture marker when an older follower detaches', () => {
  const element = document.createElement('div')
  const followers = { move: vi.fn(), up: vi.fn(), cancel: vi.fn() }
  const first = followPointer(element, 1, followers)
  const second = followPointer(element, 2, followers)
  first()
  expect(element.dataset.dockkitPointer).toBe('2')
  second()
  expect(element.dataset.dockkitPointer).toBeUndefined()
})
