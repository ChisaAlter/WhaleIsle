import { describe, expect, it } from 'vitest'
import {
  COMPOSER_RESIZE_MAX_VH, COMPOSER_RESIZE_MIN_PX, COMPOSER_RESIZE_MIN_WIDTH_PX,
  composerResizeHeight, composerResizeMaxWidth, composerResizeWidth,
} from '../src/client/skeleton/composer-resize.ts'

describe('composerResizeHeight', () => {
  it('grows the box when the pointer moves up and clamps to the min and viewport fraction', () => {
    expect(composerResizeHeight(80, 400, 350, 1000)).toBe(130)
    expect(composerResizeHeight(80, 400, 500, 1000)).toBe(COMPOSER_RESIZE_MIN_PX)
    expect(composerResizeHeight(80, 400, -1000, 1000)).toBe(1000 * COMPOSER_RESIZE_MAX_VH)
  })
})

describe('composerResizeWidth', () => {
  it('grows the card symmetrically from either vertical edge by default and clamps to the min and column', () => {
    expect(composerResizeWidth(400, 500, 560, 'right', 800)).toBe(520)
    expect(composerResizeWidth(400, 100, 40, 'left', 800)).toBe(520)
    expect(composerResizeWidth(400, 500, 560, 'right', 800, 1)).toBe(460)
    expect(composerResizeWidth(400, 100, 40, 'left', 800, 1)).toBe(460)
    expect(composerResizeWidth(400, 500, -200, 'right', 800)).toBe(COMPOSER_RESIZE_MIN_WIDTH_PX)
    expect(composerResizeWidth(400, 500, 2000, 'right', 800)).toBe(800)
    expect(composerResizeWidth(200, 50, 0, 'left', 240)).toBe(240)
  })
})

describe('composerResizeMaxWidth', () => {
  it('uses the parent content box and falls back when that box is missing or empty', () => {
    expect(composerResizeMaxWidth({ clientWidth: 900 }, '16px', '16px', 400)).toBe(868)
    expect(composerResizeMaxWidth(null, '16px', '16px', 400)).toBe(400)
    expect(composerResizeMaxWidth({ clientWidth: 0 }, '0px', '0px', 400)).toBe(400)
    expect(composerResizeMaxWidth({ clientWidth: 800 }, 'not-a-number', '0px', 400)).toBe(800)
  })
})
