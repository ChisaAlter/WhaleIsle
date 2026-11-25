import { describe, expect, it } from 'vitest'
import {
  COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX,
  COMPOSER_EXPAND_BOTTOM_THRESHOLD_PX,
  COMPOSER_UNPIN_SCROLL_DELTA_PX,
  INITIAL_COMPOSER_COLLAPSE_STATE,
  canCollapseComposer,
  isComposerCollapsed,
  pinComposerExpanded,
  reduceComposerScroll,
  type ComposerCollapseGuards,
  type ComposerScrollSample,
} from '../src/client/skeleton/composer-scroll-collapse.ts'

const ALL_CLEAR: ComposerCollapseGuards = {
  activePhase: true,
  hasOverlay: false,
  hasPendingInteraction: false,
  hasDraftOrAttachment: false,
  hasEditSession: false,
  hasOpenPopover: false,
}

function sample(overrides: Partial<ComposerScrollSample> = {}): ComposerScrollSample {
  return {
    scrollTop: 500,
    scrollHeight: 2000,
    clientHeight: 800,
    prevScrollTop: 600,
    prevScrollHeight: 2000,
    followingTail: false,
    ...overrides,
  }
}

describe('composer-scroll-collapse state machine', () => {
  it('checks all collapse guards', () => {
    expect(canCollapseComposer(ALL_CLEAR)).toBe(true)
    expect(canCollapseComposer({ ...ALL_CLEAR, activePhase: false })).toBe(false)
    expect(canCollapseComposer({ ...ALL_CLEAR, hasOverlay: true })).toBe(false)
    expect(canCollapseComposer({ ...ALL_CLEAR, hasPendingInteraction: true })).toBe(false)
    expect(canCollapseComposer({ ...ALL_CLEAR, hasDraftOrAttachment: true })).toBe(false)
    expect(canCollapseComposer({ ...ALL_CLEAR, hasEditSession: true })).toBe(false)
    expect(canCollapseComposer({ ...ALL_CLEAR, hasOpenPopover: true })).toBe(false)

    const collapsed = { mode: 'collapsed' as const, pinnedScrollTop: null }
    expect(isComposerCollapsed(collapsed, ALL_CLEAR)).toBe(true)
    expect(isComposerCollapsed(collapsed, { ...ALL_CLEAR, hasDraftOrAttachment: true })).toBe(false)
    expect(isComposerCollapsed(INITIAL_COMPOSER_COLLAPSE_STATE, ALL_CLEAR)).toBe(false)
    expect(isComposerCollapsed(pinComposerExpanded(400), ALL_CLEAR)).toBe(false)
  })

  it('stays expanded with stable identity when scroll range is too short or near bottom', () => {
    const shortSample = sample({
      scrollTop: 0,
      scrollHeight: 800 + COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX,
      clientHeight: 800,
      prevScrollTop: 10,
      prevScrollHeight: 800 + COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX,
    })
    expect(reduceComposerScroll(INITIAL_COMPOSER_COLLAPSE_STATE, shortSample, ALL_CLEAR)).toBe(
      INITIAL_COMPOSER_COLLAPSE_STATE,
    )

    const nearBottom = sample({
      scrollTop: 1200 - COMPOSER_EXPAND_BOTTOM_THRESHOLD_PX,
      scrollHeight: 2000,
      clientHeight: 800,
      prevScrollTop: 1200,
    })
    expect(reduceComposerScroll(INITIAL_COMPOSER_COLLAPSE_STATE, nearBottom, ALL_CLEAR)).toBe(
      INITIAL_COMPOSER_COLLAPSE_STATE,
    )
    expect(reduceComposerScroll({ mode: 'collapsed', pinnedScrollTop: null }, nearBottom, ALL_CLEAR)).toBe(
      INITIAL_COMPOSER_COLLAPSE_STATE,
    )
  })

  it('collapses when scrolling up past the collapse threshold and expands when returning near bottom', () => {
    // Distance from bottom = (2000 - 800) - 1136 = 64px (>= threshold).
    const collapsed = reduceComposerScroll(
      INITIAL_COMPOSER_COLLAPSE_STATE,
      sample({ scrollTop: 1200 - COMPOSER_COLLAPSE_BOTTOM_THRESHOLD_PX, prevScrollTop: 1200 }),
      ALL_CLEAR,
    )
    expect(collapsed).toEqual({ mode: 'collapsed', pinnedScrollTop: null })

    // Still far from bottom stays collapsed.
    expect(
      reduceComposerScroll(
        collapsed,
        sample({ scrollTop: 900, prevScrollTop: 800, followingTail: false }),
        ALL_CLEAR,
      ),
    ).toBe(collapsed)

    // Back within expand threshold restores initial expanded state.
    expect(
      reduceComposerScroll(
        collapsed,
        sample({ scrollTop: 1200 - COMPOSER_EXPAND_BOTTOM_THRESHOLD_PX, prevScrollTop: 900 }),
        ALL_CLEAR,
      ),
    ).toBe(INITIAL_COMPOSER_COLLAPSE_STATE)
  })

  it('collapses when unpinned from tail without growth, but does not collapse solely from content growth', () => {
    const grown = reduceComposerScroll(
      INITIAL_COMPOSER_COLLAPSE_STATE,
      sample({
        scrollTop: 900,
        prevScrollTop: 900,
        scrollHeight: 2100,
        prevScrollHeight: 2000,
        followingTail: false,
      }),
      ALL_CLEAR,
    )
    expect(grown).toBe(INITIAL_COMPOSER_COLLAPSE_STATE)

    const steadyUnfollowed = reduceComposerScroll(
      INITIAL_COMPOSER_COLLAPSE_STATE,
      sample({
        scrollTop: 900,
        prevScrollTop: 900,
        scrollHeight: 2000,
        prevScrollHeight: 2000,
        followingTail: false,
      }),
      ALL_CLEAR,
    )
    expect(steadyUnfollowed).toEqual({ mode: 'collapsed', pinnedScrollTop: null })
  })

  it('keeps pinned-expanded until scrolled past the unpin delta without content growth', () => {
    const pinned = pinComposerExpanded(500)

    const smallMove = reduceComposerScroll(
      pinned,
      sample({
        scrollTop: 500 - (COMPOSER_UNPIN_SCROLL_DELTA_PX - 1),
        prevScrollTop: 500,
      }),
      ALL_CLEAR,
    )
    expect(smallMove).toBe(pinned)

    const largeMoveWhileGrowing = reduceComposerScroll(
      pinned,
      sample({
        scrollTop: 500 - COMPOSER_UNPIN_SCROLL_DELTA_PX,
        prevScrollTop: 500,
        scrollHeight: 2100,
        prevScrollHeight: 2000,
      }),
      ALL_CLEAR,
    )
    expect(largeMoveWhileGrowing).toBe(pinned)

    const largeMove = reduceComposerScroll(
      pinned,
      sample({
        scrollTop: 500 - COMPOSER_UNPIN_SCROLL_DELTA_PX,
        prevScrollTop: 500,
      }),
      ALL_CLEAR,
    )
    expect(largeMove).toEqual({ mode: 'collapsed', pinnedScrollTop: null })
  })

  it('resets collapsed or updates pinnedScrollTop when a guard blocks collapse', () => {
    const blocked = { ...ALL_CLEAR, hasDraftOrAttachment: true }
    expect(
      reduceComposerScroll({ mode: 'collapsed', pinnedScrollTop: null }, sample({ scrollTop: 400 }), blocked),
    ).toBe(INITIAL_COMPOSER_COLLAPSE_STATE)

    const pinned = pinComposerExpanded(500)
    expect(reduceComposerScroll(pinned, sample({ scrollTop: 320 }), blocked)).toEqual({
      mode: 'pinned-expanded',
      pinnedScrollTop: 320,
    })
  })
})
