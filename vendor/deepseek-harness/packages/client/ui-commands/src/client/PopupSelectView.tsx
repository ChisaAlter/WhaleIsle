/**
 * Official popupSelect shell: renders one session's PopupSelectController
 * store into the conversation.input.overlay anchor. Unlike the slash menu
 * (combobox — textarea keeps focus), this shell HOLDS focus while open: the
 * inner search input takes focus, plain typing filters the loaded options
 * locally, Enter and Tab accept the filtered highlight, ↑↓ walk it (wrapping,
 * scrolled into view), and Escape and Shift+Tab dismiss back to the composer.
 * ←→ keep the search input's native caret. Any pointer interaction outside the
 * box dismisses (the click's own target takes focus). Closed state renders
 * null; the overlay slot stays mounted. The card height clamps to the space
 * above the composer.
 */
import { MenuGroup, MenuSurface, observeStickyMenuGroups } from '@deepseek-ai/dsh-client-ui-primitives'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconCheckOutlineRegular, RiskConfirmation, useAnchoredMaxHeight, usePresence } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { filterOptions } from './popup.ts'
import type { SelectOption } from './contract.ts'
import { groupOptions } from './option-groups.ts'
import type { PopupSelectController } from './popup.ts'
import css from './PopupSelectView.module.css'

/** Design cap on the card height (same MenuDropdown family as the slash menu). */
const MAX_HEIGHT = 320

/** A settle must outlast this beat before the status line inserts — faster
 *  settles close first, so the row never pops in just to flash back out. */
const APPLYING_NOTICE_MS = 160

/** Injected business face of the popupSelect overlay entry. */
export interface PopupSelectInjected {
  /** The session's shell controller (state store + verbs; the view never touches the open-context type). */
  popup: PopupSelectController
}

/** Full shell props: injected face + the locale seat. */
export type PopupSelectViewProps = PopupSelectInjected & PropsLocale<'command'>

/**
 * Render the popupSelect shell overlay entry.
 * @param props - injected face: the session's shell controller; `t` rides the standard locale seat.
 * @returns the select card while open; null while closed.
 */
export function PopupSelectView({ popup, t }: PopupSelectViewProps) {
  const state = useSyncExternalStore(
    fn => popup.state.subscribe(fn),
    () => popup.state.getSnapshot(),
  )
  const cardRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const lastOpen = useRef(state)
  if (state.open) lastOpen.current = state
  const view = state.open ? state : lastOpen.current
  const { mounted, state: motionState } = usePresence(state.open)
  const viewportRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => filterOptions(view.options, view.search, state.searchMode),
    [state.options, state.search, state.searchMode])
  const groups = useMemo(() => groupOptions(rows), [rows])
  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    return observeStickyMenuGroups(viewport)
  }, [state.open, state.status, state.confirming, groups])
  // The card is bottom-anchored above the composer; clamp the design cap to
  // the space above it, re-measured on every store update.
  const maxHeight = useAnchoredMaxHeight(cardRef, MAX_HEIGHT, mounted)
  const active = state.open ? state.active : null

  // The search input keeps focus while arrows move a virtual highlight, so
  // the browser never scrolls the active row into view — do it here.
  useEffect(() => {
    if (active === null) return
    cardRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, rows, state.confirming])

  // Focus ownership: the search input grabs on open, and ANY outside
  // pointer interaction dismisses —
  // capture phase so a click landing anywhere else (textarea included)
  // closes the shell before its own handlers run; that click's target then
  // takes focus naturally, so no focusComposer here.
  useEffect(() => {
    if (!state.open || state.confirming !== null) return
    const onPointerDown = (ev: PointerEvent): void => {
      if (cardRef.current !== null && ev.target instanceof Node && cardRef.current.contains(ev.target)) return
      popup.dismiss()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [state.open, state.confirming, popup])

  // Focus the search input after it mounts (separate effect so the ref is populated).
  useEffect(() => {
    if (mounted && state.open && state.confirming === null) searchRef.current?.focus()
  }, [mounted, state.open, state.confirming])

  // The applying line waits one beat: a settle that lands inside it (the
  // common case) never inserts the row, so a fast pick doesn't flash the
  // card open → line → gone. Once earned it stays through the frozen exit
  // frame, and the next open resets it.
  const [applyingShown, setApplyingShown] = useState(false)
  useEffect(() => {
    if (!state.open) return
    if (!state.submitting) { setApplyingShown(false); return }
    const timer = setTimeout(() => { setApplyingShown(true) }, APPLYING_NOTICE_MS)
    return () => { clearTimeout(timer) }
  }, [state.open, state.submitting])

  if (!mounted) return null

  const confirmation = view.confirming?.confirmation
  const emptyLabel = view.searchLabels === null
    ? t('status.empty')
    : view.options.length === 0 ? view.searchLabels.empty : view.searchLabels.noResults

  const onKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>): void => {
    // ArrowLeft/ArrowRight fall through on purpose: the search input keeps
    // its native caret movement.
    if (ev.nativeEvent.isComposing) return
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault()
        popup.move(1)
        return
      case 'ArrowUp':
        ev.preventDefault()
        popup.move(-1)
        return
      case 'Enter':
        ev.preventDefault()
        void popup.select(state.active)
        return
      // Tab settles like Enter and Shift+Tab dismisses like Escape, so the
      // card's keys mean what they mean in the composer. Both must be consumed:
      // the shell HOLDS focus, and native traversal would leave an open card
      // whose search input lost focus.
      case 'Tab':
        // With nothing to settle — still loading, failed, or filtered empty —
        // the keystroke stays the browser's, which is how the error strip's
        // retry button remains reachable.
        if (!ev.shiftKey && (state.status !== 'ready' || rows.length === 0)) return
        ev.preventDefault()
        if (ev.shiftKey) popup.dismiss({ focusComposer: true })
        else void popup.select(state.active)
        return
      case 'Escape':
        ev.preventDefault()
        popup.dismiss({ focusComposer: true })
        return
      default:
    }
  }

  const renderOption = (option: SelectOption, index: number) => (
    <div
      key={option.id}
      role="option"
      aria-selected={index === state.active}
      aria-label={option.badge === undefined ? undefined : `${option.label} ${option.badge}`}
      className={clsx(css.row, index === state.active && css.rowActive)}
      onClick={() => { void popup.select(index) }}
      onMouseEnter={() => { popup.highlight(index) }}
    >
      <span className={css.label}>
        <span className={css.labelText}>{option.label}</span>
        {option.badge !== undefined && <sup className={css.badge}>{option.badge}</sup>}
      </span>
      {option.detail !== undefined && <span className={css.detail}>{option.detail}</span>}
      {option.active === true && <span className={css.check}><IconCheckOutlineRegular /></span>}
    </div>
  )
  let optionIndex = 0
  return (
    <>
      {view.confirming === null && (
        <MenuSurface
          ref={cardRef}
          className={css.card}
          style={{ maxHeight }}
          data-dsh-motion="popover"
          data-state={motionState}
          aria-hidden={state.open ? undefined : true}
          {...state.open ? {} : { inert: '' }}
          aria-label={t('overlay.aria', { command: String(view.command) })}
          onKeyDown={onKeyDown}
        >
          <input
            ref={searchRef}
            className={css.search}
            type="text"
            placeholder={state.searchLabels?.placeholder ?? t('search.placeholder')}
            aria-label={t('search.aria')}
            value={view.search}
            readOnly={view.submitting}
            onChange={(ev) => { popup.setSearch(ev.currentTarget.value) }}
          />
          {view.error !== null && (
            <div className={css.error} role="alert">
              <span className={css.errorText}>{view.error}</span>
              {view.status === 'failed' && (
                <button type="button" className={css.retry} onClick={() => { popup.retry() }}>{t('retry')}</button>
              )}
            </div>
          )}
          {view.status === 'pending' && <div className={css.status}>{t('status.loading')}</div>}
          {view.submitting && applyingShown && <div className={css.status}>{t('status.applying')}</div>}
          {view.status === 'ready' && rows.length === 0 && <div className={css.status}>{emptyLabel}</div>}
          {view.status === 'ready' && (
            <div ref={viewportRef} role="listbox" aria-label={t('listbox.aria', { command: String(view.command) })} className={css.viewport}>
              {groups.map(({ group, rows: groupRows }) => group === undefined
                ? <Fragment key="ungrouped">{groupRows.map(option => renderOption(option, optionIndex++))}</Fragment>
                : <MenuGroup key={`group:${group.name}`} label={group.label}>
                  {groupRows.map(option => renderOption(option, optionIndex++))}
                </MenuGroup>)}
            </div>
          )}
        </MenuSurface>
      )}
      {confirmation !== undefined && (
        <RiskConfirmation
          open
          title={confirmation.title}
          description={confirmation.description}
          acknowledgeLabel={confirmation.acknowledgeLabel}
          cancelLabel={confirmation.cancelLabel}
          closeLabel={t('close')}
          confirmLabel={confirmation.confirmLabel}
          acknowledged={view.acknowledged}
          onAcknowledgedChange={(value) => { popup.acknowledge(value) }}
          onCancel={() => { popup.cancelConfirmation() }}
          onConfirm={() => { void popup.confirm() }}
        />
      )}
    </>
  )
}
