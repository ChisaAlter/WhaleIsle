/** Stable tab siblings in one horizontal Grid, including viewport-positioned floats. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import clsx from 'clsx'
import type { DockIntents } from '../contract/adapter.ts'
import type { LayoutState, PaneNode, TabId, TabRecord } from '../contract/types.ts'
import { FLOAT_MINIMIZED_HEIGHT } from '../engine/constraints.ts'
import { findTabPane, floatRect, getNode, getPane } from '../engine/tree.ts'
import type { SizePreview } from './PaneTree.tsx'
import type { PaneCallbacks } from './render.ts'
import { FloatHeader, useFloatGestures } from './FloatLayer.tsx'
import { PaneDropHints, TabPanel, TabStrip } from './TabPanel.tsx'
import css from './dockkit.module.css'

/** Host policy for lazily retaining a tab body without reparenting it. */
export interface TabRetention {
  /** Whether a visited body survives hiding; omitted means visibility-mounted. */
  readonly keepMounted?: (tab: TabRecord) => boolean
  /** Mount a body in the active Session before its docked pane is shown. */
  readonly mountOnOpen?: (tab: TabRecord) => boolean
  /** Whether this layout's Session is on screen; defaults to true. */
  readonly active?: boolean
}

interface LayoutProps extends TabRetention {
  readonly state: LayoutState
  readonly callbacks: PaneCallbacks
  readonly preview: SizePreview | undefined
  readonly intents: DockIntents
}

interface TabHostProps extends LayoutProps {
  readonly tab: TabRecord
  readonly pane: PaneNode
  readonly column: number
  readonly floats: ReturnType<typeof useFloatGestures>
  readonly focusRequest: MutableRefObject<{ readonly tabId: TabId; readonly origin: Element | null } | undefined>
}

/** The untransformed viewport box behind an opt-in floating morph. */
interface FloatMorphRect {
  readonly right: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface FloatMorphPart {
  readonly element: HTMLElement
  readonly rect: FloatMorphRect
  readonly shellStyle?: { background: string; borderRadius: string; boxShadow: string; cornerShape: string }
}

interface FloatMorphSkin {
  readonly element: HTMLElement
  readonly rect: FloatMorphRect
}

function presentedFloatRect(element: HTMLElement, rect: FloatMorphRect): FloatMorphRect {
  const transform = getComputedStyle(element).transform
  if (!transform || transform === 'none') return rect
  const matrix = new DOMMatrixReadOnly(transform)
  return { right: rect.right + matrix.e, top: rect.top + matrix.f,
    width: rect.width * matrix.a, height: rect.height * matrix.d }
}

/** A tab's ancestors stay identical across selection, pane moves and floating. */
function TabHost({ state, callbacks, intents, tab, pane, column, floats, focusRequest, keepMounted, mountOnOpen,
  active = true }: TabHostProps): ReactNode {
  const floating = pane.host === 'float'
  const [contentChrome, setContentChrome] = useState(false)
  const minimized = floating && !contentChrome && (pane.rect?.height ?? 0) <= FLOAT_MINIMIZED_HEIGHT
  const selected = floating || pane.activeTabId === tab.id
  const visible = active && selected && (floating || state.expanded)
  const retained = keepMounted?.(tab) ?? false
  const ready = visible || (active && (mountOnOpen?.(tab) ?? false))
  const [visited, setVisited] = useState(ready)
  if (ready && !visited) setVisited(true)
  const host = useRef<HTMLElement | null>(null)
  const body = useRef<HTMLDivElement | null>(null)
  const morph = useRef<{ animations: Animation[]; skins: Map<HTMLElement, FloatMorphSkin[]>;
    shells: Map<HTMLElement, { background: string; shadow: string }>; pending: number } | undefined>()
  const morphRect = useRef<FloatMorphRect | undefined>()
  const morphParts = useRef(new Map<string, FloatMorphPart>())
  const stopMorph = (): void => {
    const running = morph.current
    morph.current = undefined
    running?.animations.forEach(animation => { animation.cancel() })
    running?.skins.forEach(skins => { skins.forEach(skin => { skin.element.remove() }) })
    running?.shells.forEach((style, element) => {
      element.style.backgroundColor = style.background
      element.style.boxShadow = style.shadow
    })
    host.current?.removeAttribute('data-dockkit-float-morphing')
  }
  useLayoutEffect(() => {
    // Content may own the float's chrome without changing its retained ancestors.
    const owned = Boolean(body.current?.querySelector('[data-dockkit-float-chrome="content"]'))
    if (owned !== contentChrome) setContentChrome(owned)
  })
  useLayoutEffect(() => {
    const element = body.current as HTMLDivElement
    element.inert = minimized
    if (minimized && element.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }, [minimized])
  useLayoutEffect(() => {
    // Both refs target unconditional descendants attached before these effects.
    const section = host.current as HTMLElement
    section.inert = !visible
    const focused = document.activeElement
    if (!visible && focused instanceof HTMLElement && section.contains(focused)) focused.blur()
    const request = focusRequest.current
    if (!visible || request?.tabId !== tab.id) return
    focusRequest.current = undefined
    // Preserve deliberate focus taken by another control or the newly shown body.
    if (focused !== null && focused !== document.body && focused !== document.documentElement && focused !== request.origin) return
    const strip = section.querySelector('[data-dockkit-strip]')
    const chip = [...strip?.querySelectorAll<HTMLElement>('[data-dockkit-tab]') ?? []]
      .find(element => element.dataset.dockkitTab === tab.id)
    chip?.focus({ preventScroll: true })
  }, [visible, tab.id, focusRequest])
  // Electron emits a non-bubbling focus event on the webview element.
  useEffect(() => {
    const element = body.current as HTMLDivElement
    const focus = (): void => {
      if (!visible) return
      if (floating) floats.raise(pane.id)
      else if (state.activePaneId !== pane.id) callbacks.onFocusPane(pane.id)
    }
    element.addEventListener('focus', focus, true)
    return () => { element.removeEventListener('focus', focus, true) }
  }, [visible, floating, floats, pane.id, state.activePaneId, callbacks])
  const lifted = floating && floats.preview?.paneId === pane.id ? floats.preview.rect : undefined
  const rect = floating ? floats.visibleRect(lifted ?? floatRect(pane)) : undefined
  const depth = lifted === undefined ? state.floats.indexOf(pane.id) + 1 : state.floats.length + 1
  useLayoutEffect(() => {
    const section = host.current as HTMLElement
    const enabled = section.querySelector('[data-dockkit-float-motion="morph"]') !== null
    if (!enabled || !floating || !visible) {
      stopMorph()
      morphRect.current = undefined
      morphParts.current.clear()
      return
    }
    const previous = morphRect.current
    const previousParts = morphParts.current
    // Each stable part continues from its own presented box. Foreground text
    // and history rows keep their natural metrics.
    const presented = new Map<string, FloatMorphPart>()
    for (const [key, part] of previousParts) {
      presented.set(key, { ...part, rect: presentedFloatRect(part.element, part.rect) })
    }
    // Preserve each presented skin on interruption, before canceling its
    // compositor animation. The real shell stays at its natural geometry.
    const carried = new Map<HTMLElement, Array<FloatMorphSkin & { presented: FloatMorphRect; opacity: string }>>()
    morph.current?.skins.forEach((skins, element) => {
      carried.set(element, skins.map(skin => {
        const current = { ...skin, presented: presentedFloatRect(skin.element, skin.rect),
          opacity: getComputedStyle(skin.element).opacity }
        skin.element.remove()
        return current
      }))
    })
    stopMorph()
    const next = section.getBoundingClientRect()
    morphRect.current = next
    const parts = new Map<string, FloatMorphPart>()
    section.querySelectorAll<HTMLElement>('[data-dockkit-float-motion-part]').forEach(element => {
      const key = element.dataset.dockkitFloatMotionPart as string
      const shellStyle = element.hasAttribute('data-dockkit-float-motion-shell') ? getComputedStyle(element) : undefined
      parts.set(key, { element, rect: element.getBoundingClientRect(), ...(shellStyle ? { shellStyle: {
        background: shellStyle.backgroundColor, borderRadius: shellStyle.borderRadius,
        boxShadow: shellStyle.boxShadow, cornerShape: shellStyle.getPropertyValue('corner-shape'),
      } } : {}) })
    })
    morphParts.current = parts
    if (lifted || !previous
      || previous.width === next.width && previous.height === next.height
      || Math.min(next.width, next.height) <= 0
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const style = getComputedStyle(section)
    const token = style.getPropertyValue('--ds-motion-duration-flip').trim()
    const duration = Number.parseFloat(token) * (token.endsWith('ms') ? 1 : 1000)
    if (!(duration > 0)) return
    const running = { animations: [] as Animation[], skins: new Map<HTMLElement, FloatMorphSkin[]>(),
      shells: new Map<HTMLElement, { background: string; shadow: string }>(), pending: 0 }
    morph.current = running
    const follow = (animation: Animation): void => {
      running.animations.push(animation)
      running.pending++
      animation.onfinish = () => {
        if (morph.current !== running) return
        if (--running.pending === 0) stopMorph()
      }
    }
    for (const [key, part] of parts) {
      const from = presented.get(key)
      const previousPart = previousParts.get(key)
      if (!from || !previousPart || from.element !== part.element || Math.min(from.rect.width, from.rect.height, part.rect.width, part.rect.height) <= 0) continue
      const dx = from.rect.right - part.rect.right, dy = from.rect.top - part.rect.top
      const shell = part.element.hasAttribute('data-dockkit-float-motion-shell')
      const retained = carried.get(part.element)
      // A second natural-height fit can leave the shell's box unchanged while
      // its decorative layers are still morphing. Continue those layers.
      if (dx === 0 && dy === 0 && from.rect.width === part.rect.width && from.rect.height === part.rect.height && !retained) continue
      const options = { duration, easing: style.getPropertyValue('--ds-ease-in-out').trim() || 'ease-in-out', fill: 'forwards' as const }
      if (shell && from.shellStyle && part.shellStyle) {
        const makeSkin = (rect: FloatMorphRect, skinStyle: NonNullable<FloatMorphPart['shellStyle']>): FloatMorphSkin => {
          const element = document.createElement('div')
          element.className = css.floatMorphGhost!
          element.setAttribute('aria-hidden', 'true')
          Object.assign(element.style, {
            width: `${rect.width}px`, height: `${rect.height}px`,
            backgroundColor: skinStyle.background, borderRadius: skinStyle.borderRadius,
            boxShadow: skinStyle.boxShadow,
          })
          element.style.setProperty('corner-shape', skinStyle.cornerShape)
          return { element, rect }
        }
        const sources = retained ?? [{ ...makeSkin(previousPart.rect, from.shellStyle), presented: from.rect, opacity: '1' }]
        const target = makeSkin(part.rect, part.shellStyle)
        const skins: FloatMorphSkin[] = [target]
        running.shells.set(part.element, { background: part.element.style.backgroundColor, shadow: part.element.style.boxShadow })
        part.element.style.backgroundColor = 'transparent'
        part.element.style.boxShadow = 'none'
        // The incoming skin always uses its natural target geometry. A pill is
        // never stretched into the old card's large rounded ellipse.
        part.element.append(target.element)
        follow(target.element.animate([{ opacity: 0 }, { opacity: 1 }], options))
        for (const source of sources) {
          const rect = { right: part.rect.right, top: part.rect.top, width: source.rect.width, height: source.rect.height }
          skins.push({ element: source.element, rect })
          part.element.append(source.element)
          // Outgoing skins can shrink, but never grow beyond their presented
          // box: reversing a strip must not magnify its pill while it fades.
          follow(source.element.animate([
            { transform: `translate(${source.presented.right - rect.right}px, ${source.presented.top - rect.top}px) scale(${source.presented.width / rect.width}, ${source.presented.height / rect.height})`, opacity: source.opacity },
            { transform: `translate(0, 0) scale(${Math.min(part.rect.width, source.presented.width) / rect.width}, ${Math.min(part.rect.height, source.presented.height) / rect.height})`, opacity: 0 },
          ], options))
        }
        running.skins.set(part.element, skins)
        continue
      }
      // Top-right is the anchor; ordinary parts only translate.
      const animation = part.element.animate([
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 0)' },
      ], { duration, easing: style.getPropertyValue('--ds-ease-in-out').trim() || 'ease-in-out' })
      follow(animation)
    }
    if (running.pending) section.setAttribute('data-dockkit-float-morphing', 'true')
    else morph.current = undefined
  }, [floating, visible, contentChrome, lifted, rect?.x, rect?.y, rect?.width, rect?.height])
  useEffect(() => {
    if (!host.current?.querySelector('[data-dockkit-float-motion="morph"]')) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stop = (): void => { if (preference.matches) stopMorph() }
    preference.addEventListener('change', stop)
    return () => {
      preference.removeEventListener('change', stop)
      stopMorph()
    }
  }, [contentChrome, floating])
  return (
    <div className={clsx(css.tabCell, floating && css.floatingCell)} hidden={!selected}
      data-dockkit-host={floating ? 'float' : 'dock'} data-dockkit-column={floating ? undefined : column}
      style={{ gridColumn: floating ? 1 : column * 2 + 1, gridRow: 1, order: floating ? depth : 0 }}>
      <section ref={host} tabIndex={-1} className={clsx(css.tabHost, floating ? css.float : css.pane)}
        aria-hidden={!visible || undefined}
        data-dockkit-content={tab.id}
        data-dockkit-pane={!floating && selected ? pane.id : undefined}
        data-dockkit-pane-active={!floating && state.activePaneId === pane.id || undefined}
        data-dockkit-float={floating ? pane.id : undefined}
        data-dockkit-float-active={floating && state.activePaneId === pane.id || undefined}
        data-dockkit-column={!floating ? column : undefined}
        style={rect === undefined ? undefined : {
          left: rect.x, top: `max(var(--dsh-dockkit-float-top, 0px), ${rect.y}px)`, width: rect.width, height: rect.height,
        }}
        onPointerDown={(event) => {
          if (!floating) return
          const target = event.target instanceof Element ? event.target : undefined
          const handle = target?.closest('[data-dockkit-float-drag-handle]')
          if (handle && host.current?.contains(handle)
            && !target?.closest('button, a[href], input, textarea, select, summary, [contenteditable="true"], [role="button"], [role="link"]')) {
            stopMorph()
            floats.drag('move', pane.id, event)
          } else floats.raise(pane.id)
        }}
        onClick={() => { if (!floating && state.activePaneId !== pane.id) callbacks.onFocusPane(pane.id) }}>
        <div className={css.tabHostHeader}>
          {selected && (floating
            ? <FloatHeader paneId={pane.id} tab={tab} labels={callbacks.labels} intents={intents}
              renderTabTitle={callbacks.renderTabTitle} canCloseTab={callbacks.canCloseTab}
              canDockTab={callbacks.canDockTab} drag={floats.drag} />
            : <TabStrip state={state} pane={pane} callbacks={callbacks} />)}
        </div>
        <div ref={body} className={clsx(css.tabHostBody, floating ? css.floatBody : css.paneBody)}
          hidden={minimized} aria-hidden={minimized || undefined}>
          {visited && (retained || (active && selected)) ? callbacks.renderTab(tab) : null}
          {!floating && <PaneDropHints pane={pane} callbacks={callbacks} />}
        </div>
        {floating && !minimized && <div className={css.floatResize} data-dockkit-float-resize={pane.id}
          onPointerDown={(event) => { stopMorph(); floats.drag('resize', pane.id, event) }} />}
      </section>
    </div>
  )
}

/**
 * One or two horizontal panes; CSS resolves content sizes from track fractions.
 * @param props - committed layout, gesture preview and body retention policy.
 * @returns stable tab containers, including floating tabs.
 * @throws if the docked tree is not one pane or two horizontal panes.
 */
export function TabLayout(props: LayoutProps): ReactNode {
  const { state, callbacks, preview } = props
  const focusRequest = useRef<{ readonly tabId: TabId; readonly origin: Element | null }>()
  const tabCallbacks: PaneCallbacks = {
    ...callbacks,
    onFocusTab: (tabId) => {
      // Only changing the selected body replaces its strip; pane-only focus does not.
      focusRequest.current = findTabPane(state, tabId).activeTabId === tabId
        ? undefined : { tabId, origin: document.activeElement }
      callbacks.onFocusTab(tabId)
    },
  }
  const root = getNode(state, state.rootId)
  if (root.kind === 'split' && (root.axis !== 'row' || root.children.length !== 2)) {
    throw new Error('DockLayout requires one pane or two horizontally split panes')
  }
  const panes = root.kind === 'pane' ? [root] : root.children.map(id => getPane(state, id))
  const sizes = root.kind === 'split' ? preview?.splitId === root.id ? preview.sizes : root.sizes : [1]
  const floats = useFloatGestures(state, props.intents)
  const columns = sizes.map(size => `minmax(0, ${size}fr)`).join(' 0px ')
  return (
    <div className={css.tabLayout} data-dockkit-split={root.kind === 'split' ? root.id : undefined}
      style={{ gridTemplateColumns: columns }}>
      {/* Logical order changes must not make React move a connected webview's ancestor. */}
      {Object.values(state.tabs).sort((a, b) => a.id.localeCompare(b.id)).map((tab) => {
        const pane = findTabPane(state, tab.id)
        return <TabHost key={tab.id} {...props} callbacks={tabCallbacks} tab={tab} pane={pane}
          column={panes.findIndex(candidate => candidate.id === pane.id)} floats={floats} focusRequest={focusRequest} />
      })}
      {panes.filter(pane => pane.tabs.length === 0).map(pane => (
        <div key={pane.id} className={css.emptyTabHost} data-dockkit-empty style={{ gridColumn: panes.indexOf(pane) * 2 + 1, gridRow: 1 }}>
          <TabPanel state={state} pane={pane} callbacks={callbacks} />
        </div>
      ))}
      {root.kind === 'split' && <div className={clsx(css.divider, css.tabLayoutDivider)}
        data-dockkit-divider={`${root.id}:0`} style={{ gridColumn: 2, gridRow: 1 }}
        onPointerDown={(event) => { callbacks.onDividerPressed(root.id, 0, event) }} />}
    </div>
  )
}
