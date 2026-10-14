/** Shared modal keyboard ownership and focus lifetime. */
import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { observeComposition } from './keyboard-composition.ts'
import { focusWithoutRing } from './focus.ts'

/** Dialog and menu elements whose document order determines foreground shortcut ownership. */
export const modalSelector = '[role="dialog"][aria-modal="true"], [role="menu"]'

/**
 * Markers that mean "this surface is no longer logically open" even though the
 * exit recipe keeps its DOM mounted. Surfaces hidden by an ancestor count too:
 * a closing Modal keeps `aria-hidden` on its overlay root, not on the panel.
 */
const inactiveSelector = '[aria-hidden="true"], [inert], [hidden]'

/**
 * Foreground candidates in document order. A retained exit frame must not keep
 * owning keyboard input: a menu closed inside a dialog would otherwise stay the
 * last `modalSelector` match and block the dialog's own close command.
 *
 * Filtering on `data-state` would be wrong — an entering surface is logically
 * open while its first frames still read `closed` — so logical activity is read
 * from the accessibility/inert markers the surfaces already publish.
 * @param document - product document to measure.
 * @returns the surfaces that can own foreground input right now.
 */
export function foregroundModalSurfaces(document: Document): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(modalSelector)]
    .filter(element => element.closest(inactiveSelector) === null
      && !(layers.get(document)?.some(layer => layer.element === element
        && layer.owner !== undefined && ownerHidden(layer.owner)) ?? false))
}

interface ModalLayer {
  element: HTMLElement
  owner?: HTMLElement | undefined
  close: () => void
  /**
   * Return target captured by a layer that retired while another layer was
   * still in front of it. Without this, closing a parent and its child in one
   * commit would drop the parent's own opener: the parent never restores
   * (it was not top) and the child's opener lives inside the now-inactive
   * parent, leaving no candidate at all.
   */
  outerOpener?: HTMLElement | undefined
}

const layers = new WeakMap<Document, ModalLayer[]>()

interface ToastLayer {
  owner: HTMLElement
  element: HTMLElement
  modal: HTMLElement | null
  modalParent: HTMLElement | null
  resolved: boolean
  visibility: (visible: boolean) => void
}
interface ToastStack {
  element: HTMLElement
  leases: number
  items: Set<ToastLayer>
  observer: MutationObserver
  scheduled: boolean
  resize: () => void
}
const toastStacks = new WeakMap<Document, ToastStack>()
const dialogSelector = '[role="dialog"][aria-modal="true"]'

function ownerHidden(owner: HTMLElement): boolean {
  for (let element = owner.parentElement; element !== null; element = element.parentElement) {
    if (element.matches('[hidden], [aria-hidden="true"]')) return true
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return true
  }
  return !owner.isConnected
}

function toastModal(owner: HTMLElement): HTMLElement | null {
  const candidates = layers.get(owner.ownerDocument) ?? []
  // A notice rendered beside a Modal keeps the same original owner. Do not
  // associate through body: unrelated application overlays share that parent.
  // Walk from the notice outward so a sibling editor owns its notice before
  // an enclosing settings dialog can claim it.
  for (let parent = owner.parentElement; parent !== null && parent !== owner.ownerDocument.body; parent = parent.parentElement) {
    const sibling = [...candidates].reverse().find(layer => layer.owner !== undefined && layer.owner.parentElement === parent
      && layer.element.closest(inactiveSelector) === null && !ownerHidden(layer.owner))
    if (sibling !== undefined) return sibling.element
    if (parent.matches(dialogSelector)) return parent
  }
  return null
}

function updateToastStack(document: Document, stack: ToastStack): void {
  const foreground = foregroundModalSurfaces(document).filter(element => element.matches(dialogSelector)).at(-1)
  for (const item of stack.items) {
    if (!item.resolved) {
      item.modal = toastModal(item.owner)
      item.modalParent = layers.get(document)?.find(layer => layer.element === item.modal)?.owner?.parentElement ?? null
      item.resolved = true
    } else if (item.modal !== null && !item.modal.isConnected && item.modalParent !== null) {
      // A persistent sibling notice outlives the modal's 200ms exit unmount.
      // Reopening that same owner creates a new dialog; keep the notice hidden
      // until a layer at its original position owns it again.
      const replacement = toastModal(item.owner)
      if (replacement !== null && layers.get(document)?.find(layer => layer.element === replacement)?.owner?.parentElement === item.modalParent) {
        item.modal = replacement
      }
    }
    const layer = item.modal === null ? undefined : layers.get(document)?.find(entry => entry.element === item.modal)
    const visible = !ownerHidden(item.owner)
      && (item.modal === null || (item.modal.isConnected && item.modal.closest(inactiveSelector) === null
        && (layer?.owner === undefined || !ownerHidden(layer.owner))))
    item.element.hidden = !visible
    item.element.inert = !visible || (foreground !== undefined && item.modal !== foreground)
    item.visibility(visible)
  }
  // Measure the visible stack before placing it above the dialog. Two notices
  // need more room than one; keep the titlebar and dialog controls clear.
  const header = foreground?.querySelector<HTMLElement>('[data-dsh-modal-header]')
  const footer = foreground?.querySelector<HTMLElement>('[data-dsh-modal-footer]')
  const headerRect = header?.getBoundingClientRect()
  const height = stack.element.scrollHeight
  const aboveHeader = headerRect !== undefined && headerRect.top - 56 >= Math.max(48, height)
  const top = aboveHeader ? Math.max(48, Math.min(120, headerRect.top - 8 - height))
    : Math.max(120, (headerRect?.bottom ?? 0) + 8)
  const viewportBottom = (document.defaultView?.innerHeight ?? 0) - 24
  const bottom = Math.min(viewportBottom, aboveHeader ? headerRect.top - 8
    : footer === null || footer === undefined ? Infinity : footer.getBoundingClientRect().top - 8)
  stack.element.style.top = `${String(top)}px`
  stack.element.style.maxHeight = `${String(Math.max(0, bottom - top))}px`
}

function scheduleToastStack(document: Document): void {
  const stack = toastStacks.get(document)
  if (stack === undefined || stack.scheduled) return
  stack.scheduled = true
  queueMicrotask(() => {
    stack.scheduled = false
    if (toastStacks.get(document) === stack) updateToastStack(document, stack)
  })
}

/**
 * Lease the shared fixed body stack without moving an owner's content.
 * @param document - document containing the owner and its portal.
 * @param className - shared stack styling.
 * @returns portal target and the lease release action.
 */
export function acquireToastStack(document: Document, className: string): { element: HTMLElement; release: () => void } {
  let stack = toastStacks.get(document)
  if (stack === undefined) {
    const element = document.createElement('div')
    element.className = className
    element.dataset.dshToastStack = ''
    document.body.append(element)
    const observer = new MutationObserver(mutations => {
      if (mutations.some(mutation => !element.contains(mutation.target))) scheduleToastStack(document)
    })
    const resize = (): void => { scheduleToastStack(document) }
    stack = { element, leases: 0, items: new Set(), observer, scheduled: false, resize }
    toastStacks.set(document, stack)
    document.defaultView?.addEventListener('resize', resize)
    observer.observe(document.documentElement, {
      attributes: true, childList: true, subtree: true,
      attributeFilter: ['hidden', 'aria-hidden', 'inert', 'style', 'class'],
    })
  }
  stack.leases++
  const leased = stack
  return { element: leased.element, release: () => {
    leased.leases--
    if (leased.leases !== 0) return
    // Notice registrations retire later in the same layout cleanup. Keep the
    // focused portal connected until they have captured return-focus ownership.
    queueMicrotask(() => {
      if (leased.leases !== 0 || toastStacks.get(document) !== leased) return
      leased.observer.disconnect()
      document.defaultView?.removeEventListener('resize', leased.resize)
      leased.element.remove()
      toastStacks.delete(document)
    })
  } }
}

/**
 * Associate a portaled notice with its original owner and keyboard layer.
 * @param owner - hidden marker in the caller's original DOM position.
 * @param element - portaled Toast surface.
 * @param visibility - update the display clock when the owner is hidden.
 * @returns disposal of this notice's registration.
 */
export function registerToastLayer(owner: HTMLElement, element: HTMLElement, visibility: (visible: boolean) => void): () => void {
  const document = owner.ownerDocument
  const stack = toastStacks.get(document)
  if (stack === undefined) return () => {}
  const item: ToastLayer = { owner, element, modal: null, modalParent: null, resolved: false, visibility }
  stack.items.add(item)
  scheduleToastStack(document)
  return () => {
    const focused = element.contains(document.activeElement)
    stack.items.delete(item)
    scheduleToastStack(document)
    if (!focused || item.modal === null) return
    const modal = item.modal
    queueMicrotask(() => {
      if (foregroundModalSurfaces(document).filter(surface => surface.matches(dialogSelector)).at(-1) !== modal) return
      const active = document.activeElement
      if (active !== document.body && active !== null && active.isConnected && active.closest(inactiveSelector) === null) return
      const next = tabStops(modal)[0] ?? modal
      focusWithoutRing(next, { preventScroll: true })
    })
  }
}

/**
 * Whether a Toast pointer belongs to a particular original or portaled surface.
 * @param target - pointer event target.
 * @param surface - popover root or its body portal.
 * @returns true only for an active notice owned by that surface.
 */
export function isToastOwnedBySurface(target: Node, surface: HTMLElement | null): boolean {
  if (surface === null) return false
  const stack = toastStacks.get(surface.ownerDocument)
  if (stack === undefined) return false
  return [...stack.items].some(item => !item.element.hidden && !item.element.inert
    && item.element.contains(target) && (surface.contains(item.owner) || item.modal === surface))
}

/**
 * Whether a modal's focus traversal includes active portaled notice actions.
 * @param modal - dialog retaining keyboard ownership.
 * @returns true when its visible notices contain an enabled focus target.
 */
export function modalHasToastControls(modal: HTMLElement): boolean {
  return [...toastStacks.get(modal.ownerDocument)?.items ?? []].some(item => item.modal === modal
    && !item.element.hidden && !item.element.inert && tabStops(item.element).length > 0)
}

/**
 * Request closure of the foreground registered modal using its current onClose callback.
 * A newer menu or unregistered dialog blocks dismissal of the modal behind it.
 * @param document - product document whose modal owns the close command.
 */
export function closeTopModal(document: Document): void {
  const top = layers.get(document)?.at(-1)
  if (top === undefined) return
  const foreground = foregroundModalSurfaces(document).at(-1)
  if (foreground === top.element) top.close()
}
/**
 * Whether an anchor belongs behind the current modal and must yield keyboard input.
 * @param anchor - local control owning the input handler.
 * @returns true when another modal owns the foreground.
 */
export function isBehindModal(anchor: HTMLElement | null): boolean {
  if (anchor === null) return false
  const top = layers.get(anchor.ownerDocument)?.at(-1)
  return top !== undefined && !top.element.contains(anchor)
}

const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'

/** Eligible Tab stops in document order, excluding roving inactive tabs. */
function tabStops(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(focusable)]
    .filter(item => item.tabIndex >= 0 && item.closest(inactiveSelector) === null)
    .sort((left, right) => left === right ? 0
      : left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
}

/**
 * Give only the top modal Escape and Tab ownership, then restore its previous focus.
 * Automatic entry and return focus omit outlines; keyboard traversal retains its indicators.
 * Controls mounted with the dialog use data-modal-autofocus for initial focus;
 * React autoFocus runs before this layer can capture the invoking control.
 * Local menus handle their Escape during capture before this bubble listener.
 * @param dialog - mounted dialog element.
 * @param open - whether this layer is active.
 * @param onClose - top-layer Escape or application close action.
 * @param owner - optional marker in the original caller, used for sibling Toast ownership.
 */
export function useModalLayer(dialog: RefObject<HTMLElement | null>, open: boolean, onClose: () => void,
  owner?: RefObject<HTMLElement | null>): void {
  const close = useRef(onClose)
  close.current = onClose
  /** Return-focus work deferred to the closing commit's layout-effect setup. */
  const pendingRestore = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) {
      // Closing commit. React destroys layout effects during its mutation phase
      // and then restores its own notion of selection in `resetAfterCommit`,
      // which would undo a focus call made from this effect's cleanup — the
      // exit recipe keeps the closing control connected, so React can still
      // see it. This setup runs after `resetAfterCommit`, which makes it the
      // earliest point where return focus actually survives the commit.
      const restore = pendingRestore.current
      pendingRestore.current = null
      restore?.()
      return
    }
    pendingRestore.current = null
    const document = element.ownerDocument
    const composition = observeComposition(document)
    const previous = document.activeElement
    const stack = layers.get(document) ?? []
    layers.set(document, stack)
    const layer: ModalLayer = { element, close: () => { close.current() },
      ...owner?.current == null ? {} : { owner: owner.current } }
    stack.push(layer)
    scheduleToastStack(document)
    /**
     * A surface that is only being retained for its exit recipe is not a
     * foreground owner. Read the published inactivity markers instead of
     * `data-state`, because an entering surface is logically open while its
     * first frames still report `closed`.
     */
    const inactive = (): boolean => element.closest(inactiveSelector) !== null
      || (layer.owner !== undefined && ownerHidden(layer.owner))
    const initial = element.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? tabStops(element)[0] ?? element
    if (!element.contains(document.activeElement)) focusWithoutRing(initial)
    const keydown = (event: KeyboardEvent): void => {
      const composing = composition.guards(event)
      if (stack.at(-1) !== layer || inactive() || event.defaultPrevented || composing
        || event.ctrlKey || event.altKey || event.metaKey) return
      if (foregroundModalSurfaces(document).at(-1) !== element) return
      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
      }
      if (event.key !== 'Tab') return
      // Portaled menus own their traversal while they contain focus, but a
      // menu retained for its exit recipe must not suppress this dialog's
      // traversal: an owner can close a focused menu without the menu's own
      // Escape handoff, leaving focus inside the retiring subtree.
      const focusedMenu = document.activeElement?.closest<HTMLElement>('[role="menu"]')
      if (focusedMenu != null && focusedMenu.closest(inactiveSelector) === null) return
      const items = tabStops(element)
      for (const toast of toastStacks.get(document)?.items ?? []) {
        if (toast.modal !== element || toast.element.hidden || toast.element.inert) continue
        items.push(...tabStops(toast.element))
      }
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      /**
       * Focus inside a retired subtree (a menu retained for its exit recipe)
       * needs explicit recovery: it is still a DOM descendant of this dialog,
       * so it is neither "outside" nor at an eligible edge, and staying there
       * would leave the keyboard in DOM the user can no longer see.
       */
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest(inactiveSelector) !== null && element.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
        return
      }
      event.preventDefault()
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1
      const next = index < 0 ? (event.shiftKey ? last : first)
        : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length] ?? element
      next.focus()
    }
    document.addEventListener('keydown', keydown)
    return () => {
      composition.dispose()
      const wasTop = stack.at(-1) === layer
      stack.splice(stack.indexOf(layer), 1)
      document.removeEventListener('keydown', keydown)
      if (stack.length === 0) layers.delete(document)
      scheduleToastStack(document)
      if (wasTop) {
        const fallback = stack.at(-1)?.element
        // A lower layer that retired beneath this one handed its opener over
        // before this layer was spliced out, so read it from `layer` itself —
        // by now the captured stack may already be empty.
        const inherited = layer.outerOpener
        const restore = (): void => {
          // Resolve ownership against the document when this actually runs. A
          // newer layer may have registered after `wasTop` was decided — in the
          // same commit, or after the stack array was replaced — and that layer
          // owns the keyboard now. The captured `stack` array cannot answer
          // this: cleanup deletes the WeakMap entry once that array drains, so
          // a later layer registers into a different array.
          const currentStack = layers.get(document)
          const current = currentStack?.at(-1)
          if (current !== undefined && current.element !== fallback) return
          /**
           * Eligibility is tested BEFORE choosing. `isConnected` alone is not
           * enough: an opener inside another closing modal stays connected
           * while that modal is retained for its exit. Choosing the opener
           * first and rejecting it afterwards would strand focus in the
           * retiring subtree even though the surviving parent is a valid
           * destination — e.g. closing a child whose opener lives in a hidden
           * parent, or closing parent and child in the same commit.
           */
          const eligible = (target: HTMLElement | undefined): target is HTMLElement =>
            target !== undefined && target.isConnected && target.closest(inactiveSelector) === null
            && !target.matches(':disabled, [aria-disabled="true"]')
          const active = document.activeElement
          // An owner may deliberately focus a surviving control while closing.
          if (active instanceof HTMLElement && active !== document.body && eligible(active)
            && !element.contains(active) && (current === undefined || current.element.contains(active))) return
          const opener = previous instanceof HTMLElement ? previous : undefined
          const parentAutofocus = fallback?.querySelector<HTMLElement>('[data-modal-autofocus]') ?? undefined
          // A lower layer that retired beneath this one handed us its own
          // opener; prefer the nearest eligible ancestor target so a nested
          // dialog does not strand focus inside a modal that is itself leaving.
          const candidate = eligible(opener) ? opener
            : eligible(inherited) ? inherited
              : eligible(parentAutofocus) ? parentAutofocus
                : eligible(fallback) ? fallback : undefined
          if (candidate !== undefined) focusWithoutRing(candidate)
        }
        // Keep the deferred retry for the commit path, and also apply it now so
        // a full unmount (where no later layout setup runs) still returns focus.
        pendingRestore.current = restore
        restore()
      } else {
        // Not the top layer: this retirement runs before the layer in front of
        // it retires. Hand our opener down so the eventual topmost restoration
        // can still reach an eligible target outside every closing surface,
        // instead of finding only an opener that lives inside a retired parent.
        const above = stack.at(-1)
        if (above !== undefined && above.outerOpener === undefined
          && previous instanceof HTMLElement && previous.isConnected) {
          above.outerOpener = previous
        }
      }
    }
  }, [dialog, open, owner])
}
