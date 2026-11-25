/** Pure state machine controlling scroll-driven composer collapse into a floating pill. */

export const COMPOSER_EXPAND_BOTTOM_THRESHOLD_PX = 24
export const COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX = 64
export const COMPOSER_UNPIN_SCROLL_DELTA_PX = 32

export type ComposerCollapseMode = 'expanded' | 'collapsed' | 'pinned-expanded'

export type ComposerCollapseState = {
  readonly mode: ComposerCollapseMode
  readonly pinnedScrollTop: number | null
}

export type ComposerScrollSample = {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
  readonly prevScrollTop: number
  readonly prevScrollHeight: number
  readonly followingTail: boolean
}

export type ComposerCollapseGuards = {
  readonly activePhase: boolean
  readonly hasOverlay: boolean
  readonly hasPendingInteraction: boolean
  readonly hasDraftOrAttachment: boolean
  readonly hasEditSession: boolean
  readonly hasOpenPopover: boolean
}

export const INITIAL_COMPOSER_COLLAPSE_STATE: ComposerCollapseState = {
  mode: 'expanded',
  pinnedScrollTop: null,
}

/** Whether the composer is allowed to collapse under current UI and draft guards. */
export function canCollapseComposer(guards: ComposerCollapseGuards): boolean {
  return (
    guards.activePhase
    && !guards.hasOverlay
    && !guards.hasPendingInteraction
    && !guards.hasDraftOrAttachment
    && !guards.hasEditSession
    && !guards.hasOpenPopover
  )
}

/** Whether the composer should currently render in collapsed pill form. */
export function isComposerCollapsed(
  state: ComposerCollapseState,
  guards: ComposerCollapseGuards,
): boolean {
  return state.mode === 'collapsed' && canCollapseComposer(guards)
}

/** Pin the composer expanded after an explicit user click/focus while scrolled up. */
export function pinComposerExpanded(scrollTop: number): ComposerCollapseState {
  return { mode: 'pinned-expanded', pinnedScrollTop: scrollTop }
}

/** Advance composer collapse state on a conversation scrollport sample. */
export function reduceComposerScroll(
  state: ComposerCollapseState,
  sample: ComposerScrollSample,
  guards: ComposerCollapseGuards,
): ComposerCollapseState {
  const maxScroll = Math.max(0, sample.scrollHeight - sample.clientHeight)
  const distanceFromBottom = Math.max(0, maxScroll - sample.scrollTop)

  if (maxScroll <= COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX || distanceFromBottom <= COMPOSER_EXPAND_BOTTOM_THRESHOLD_PX) {
    return state.mode === 'expanded' && state.pinnedScrollTop === null
      ? state
      : INITIAL_COMPOSER_COLLAPSE_STATE
  }

  if (!canCollapseComposer(guards)) {
    if (state.mode === 'collapsed') return INITIAL_COMPOSER_COLLAPSE_STATE
    if (state.mode === 'pinned-expanded') {
      return state.pinnedScrollTop === sample.scrollTop
        ? state
        : { mode: 'pinned-expanded', pinnedScrollTop: sample.scrollTop }
    }
    return state
  }

  const scrolledUp = sample.scrollTop < sample.prevScrollTop - 0.5
  const contentGrew = sample.scrollHeight > sample.prevScrollHeight + 0.5

  if (
    state.mode === 'expanded'
    && distanceFromBottom >= COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX
    && (scrolledUp || (!sample.followingTail && !contentGrew))
  ) {
    return { mode: 'collapsed', pinnedScrollTop: null }
  }

  if (
    state.mode === 'pinned-expanded'
    && distanceFromBottom >= COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX
    && !contentGrew
    && state.pinnedScrollTop !== null
    && Math.abs(sample.scrollTop - state.pinnedScrollTop) >= COMPOSER_UNPIN_SCROLL_DELTA_PX
  ) {
    return { mode: 'collapsed', pinnedScrollTop: null }
  }

  return state
}
