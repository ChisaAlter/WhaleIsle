import { describe, expect, it } from 'vitest'
import {
  CENTER_MIN, clampWidth, computeColumns,
  RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MIN,
  SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT,
  SURFACES_DEFAULT, SURFACES_MAX, SURFACES_MIN, surfacesMaxForViewport,
} from '../src/client/columns.ts'

describe('clampWidth', () => {
  it('clamps into the range and rounds', () => {
    expect(clampWidth(250.4, 240, 420)).toBe(250)
    expect(clampWidth(100, 240, 420)).toBe(240)
    expect(clampWidth(9999, 240, 420)).toBe(420)
  })
})

describe('computeColumns', () => {
  it('gives each edge column its preference when the center has enough room', () => {
    expect(computeColumns(1920, 280, 864)).toEqual({ sidebar: 280, center: 776, rightbar: 864, surfaces: 0 })
  })

  it('keeps only the left rail when both panels are closed', () => {
    expect(computeColumns(1920, 0, 0)).toEqual({ sidebar: 56, center: 1864, rightbar: 0, surfaces: 0 })
  })

  it('aligns an expanded sidebar to the fold midpoint without widening a collapsed rail', () => {
    expect(computeColumns(951, 280, 864, 0, 56, true)).toEqual({ sidebar: 475.5, center: 475.5, rightbar: 0, surfaces: 0 })
    expect(computeColumns(951, 0, 0, 0, 56, true)).toEqual({ sidebar: 56, center: 895, rightbar: 0, surfaces: 0 })
  })

  it('clamps sidebar preferences and limits the right panel to 70% of the frame', () => {
    expect(computeColumns(3000, 9999, 9999)).toEqual({ sidebar: 420, center: 480, rightbar: 2100, surfaces: 0 })
    expect(computeColumns(1920, 1, 1)).toEqual({ sidebar: 264, center: 1356, rightbar: 300, surfaces: 0 })
  })

  it.each([
    [1300, 280, 620, 400],
    [1100, 280, 420, 400],
    [1120, 420, 300, 400],
    [1119, 420, 0, 699],
    [1024, 420, 0, 604],
    [756, 0, 300, 400],
    [755, 0, 0, 699],
    [455, 0, 0, 399],
    [20, 0, 0, 0],
  ])('solves frame %i and sidebar %i to right %i and center %i', (viewport, sidebar, rightbar, center) => {
    expect(computeColumns(viewport, sidebar, 864)).toEqual({ sidebar: sidebar || 56, center, rightbar, surfaces: 0 })
  })

  it('does not reduce the wide sidebar to keep a normal right panel open', () => {
    expect(computeColumns(1024, 420, 500)).toEqual({ sidebar: 420, center: 604, rightbar: 0, surfaces: 0 })
  })

  it('restores a still-open preference when the frame widens', () => {
    expect(computeColumns(1100, 280, 864).rightbar).toBe(420)
    expect(computeColumns(1920, 280, 864).rightbar).toBe(864)
  })

  it('leaves a closed right track closed when the frame widens', () => {
    expect(computeColumns(755, 0, 0).rightbar).toBe(0)
    expect(computeColumns(1920, 0, 0).rightbar).toBe(0)
  })
})

describe('computeColumns — four-column concession', () => {
  const four = (viewport: number) =>
    computeColumns(viewport, SIDEBAR_DEFAULT, 864, SURFACES_DEFAULT)

  it('wide window: all four columns open at preferred widths', () => {
    // Room for everything: center takes the remainder.
    expect(computeColumns(2200, SIDEBAR_DEFAULT, 864, SURFACES_DEFAULT)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 2200 - SIDEBAR_DEFAULT - 864 - SURFACES_DEFAULT,
      rightbar: 864,
      surfaces: SURFACES_DEFAULT,
    })
  })

  it('narrowing shrinks surfaces first, rightbar stays at its preferred width', () => {
    // 2084 > 2044; surfaces concedes to 2044 - 280 - 864 - 400 = 500.
    expect(four(2044)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      rightbar: 864,
      surfaces: 500,
    })
    // 2084 > 1920; surfaces concedes to 376.
    expect(four(1920)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      rightbar: 864,
      surfaces: 376,
    })
  })

  it('further narrowing shrinks the rightbar after surfaces is at its minimum', () => {
    // surfaces already at 360; rightbar concedes to 1800 - 280 - 360 - 400 = 760.
    expect(four(1800)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      rightbar: 760,
      surfaces: SURFACES_MIN,
    })
    // Boundary: exactly at the step-2/step-3 seam.
    const seam = SIDEBAR_DEFAULT + 864 + SURFACES_MIN + CENTER_MIN
    expect(four(seam)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: CENTER_MIN,
      rightbar: 864,
      surfaces: SURFACES_MIN,
    })
    expect(four(seam - 1).rightbar).toBe(864 - 1)
  })

  it('derived-closes surfaces once the rightbar is at its minimum and center is still starved', () => {
    // 280 + 300 + 360 + 400 = 1340 > 1339 → surfaces 0; rightbar holds its
    // minimum; center = 1339 - 280 - 300 = 759.
    expect(four(1339)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 1339 - SIDEBAR_DEFAULT - RIGHTBAR_MIN,
      rightbar: RIGHTBAR_MIN,
      surfaces: 0,
    })
  })

  it('clamps an open surfaces preference to 70% of the viewport before concession', () => {
    // 70% of 1920 = 1344; store ceiling SURFACES_MAX = 1400.
    expect(surfacesMaxForViewport(1920)).toBe(1344)
    // Sidebar 280 + CENTER_MIN 400 leaves 1240 for surfaces, so concession
    // (1240) is tighter than the 70% cap (1344) and the preference (1400).
    expect(computeColumns(1920, SIDEBAR_DEFAULT, 0, SURFACES_MAX).surfaces).toBe(1240)
  })

  it('derived-closes the rightbar last; the sidebar never concedes', () => {
    // 280 + 300 + 400 = 980 > 979 → rightbar 0; center = 979 - 280 = 699.
    expect(four(979)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 979 - SIDEBAR_DEFAULT,
      rightbar: 0,
      surfaces: 0,
    })
    // 700 < 280 + 400: sidebar keeps 280, center takes 420 < CENTER_MIN.
    expect(computeColumns(700, SIDEBAR_DEFAULT, 864, SURFACES_DEFAULT)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 420,
      rightbar: 0,
      surfaces: 0,
    })
  })

  it('recovery is pure: re-widening restores preferred widths untouched', () => {
    const squeezed = four(1100)
    expect(squeezed).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 1100 - SIDEBAR_DEFAULT - RIGHTBAR_MIN,
      rightbar: RIGHTBAR_MIN,
      surfaces: 0,
    })
    const restored = four(1920)
    expect(restored.surfaces).toBe(376)
    expect(restored.rightbar).toBe(864)
    expect(restored.sidebar).toBe(SIDEBAR_DEFAULT)
  })
})

describe('computeColumns — degenerate viewports', () => {
  it('sidebar closed and viewport below CENTER_MIN: both right columns auto-close, center takes the rest', () => {
    expect(computeColumns(500, 0, 864, SURFACES_DEFAULT))
      .toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 500 - SIDEBAR_COLLAPSED, rightbar: 0, surfaces: 0 })
  })

  it('a closed rightbar preference stays closed while surfaces concedes', () => {
    expect(computeColumns(1200, SIDEBAR_DEFAULT, 0, SURFACES_DEFAULT)).toEqual({
      sidebar: SIDEBAR_DEFAULT,
      center: 1200 - SIDEBAR_DEFAULT - 520,
      rightbar: 0,
      surfaces: 520,
    })
  })
})

describe('surfacesMaxForViewport', () => {
  it('returns 70% of the viewport inside SURFACES_MIN..SURFACES_MAX', () => {
    expect(surfacesMaxForViewport(1920)).toBe(1344)
    expect(surfacesMaxForViewport(100)).toBe(SURFACES_MIN)
    expect(surfacesMaxForViewport(3000)).toBe(SURFACES_MAX)
  })
})

describe('rightbar geometry contract', () => {
  it('opens at the 45% first-open ratio through the caller-supplied preference', () => {
    expect(Math.round(1920 * RIGHTBAR_DEFAULT_RATIO)).toBe(864)
    expect(RIGHTBAR_MIN).toBe(300)
  })
})
