/**
 * Titlebar caption: one AppFrame drag band, a max-content trailing no-drag
 * hole, and phone-menu no-drag. Conversation and surfaces must not add a
 * second disjoint drag rectangle.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

describe('AppFrame.module.css titlebar trailing cluster', () => {
  it('owns one caption drag band across sidebar, conversation, details, and surfaces', () => {
    const band = declarations('.captionDrag')
    expect(band?.get('grid-column')).toBe('1 / -1')
    expect(band?.get('grid-row')).toBe('1')
    expect(band?.get('height')).toBe('48px')
    expect(band?.get('-webkit-app-region')).toBe('drag')
    expect(band?.get('z-index')).toBeUndefined()
  })

  it('packs cluster controls with an 8px gap and marks the cluster no-drag', () => {
    const trailing = declarations('.titlebarTrailing')
    expect(trailing?.get('gap')).toBe('8px')
    expect(trailing?.get('width')).toBe('max-content')
    expect(trailing?.get('max-width')).toBe('100%')
    expect(trailing?.get('-webkit-app-region')).toBe('no-drag')
    expect(trailing?.get('display')).toBe('flex')
    expect(trailing?.get('margin-right')).toBe('var(--dshd-wco-controls, 8px)')
    expect(css).not.toContain('--dshd-wco-pad')
  })

  it('keeps the phone menu clickable beside the blank caption', () => {
    expect(declarations('.phoneMenu')?.get('-webkit-app-region')).toBe('no-drag')
  })

  it('punches holes for handles, overlay entries, and open phone drawers', () => {
    expect(declarations('.handle')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.overlayLayer > *')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.phoneBackdrop')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.frame[data-phone-sidebar] .sidebarCol')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.frame[data-phone-details] .detailsCol')?.get('-webkit-app-region')).toBe('no-drag')
    // Closed drawers translate offscreen; the hole must not apply while closed
    // or the transformed rect could subtract a band segment.
    expect(declarations('.frame[data-phone] .sidebarCol')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.frame[data-phone] .detailsCol')?.get('-webkit-app-region')).toBeUndefined()
  })

  it('keeps Git at the caption right edge and places pane tabs below that row', () => {
    const trailing = declarations('.titlebarTrailing')
    expect(trailing?.get('grid-column')).toBe('2 / -1')
    expect(trailing?.get('grid-row')).toBe('1')
    expect(trailing?.get('height')).toBe('27px')
    expect(trailing?.get('flex-shrink')).toBe('0')
    expect(declarations('.frame:not([data-rightbar-collapsed]) .titlebarTrailing')).toBeUndefined()
    expect(declarations('.detailsCol')?.get('grid-row')).toBe('2 / 4')
    expect(declarations('.titlebarBand')?.get('min-height')).toBe('52px')
    expect(declarations('.frame[data-titlebar-trailing-hidden] .titlebarTrailing')?.get('display')).toBe('none')
    expect(declarations('.frame[data-compact-header] .titlebarTrailing')).toBeUndefined()
  })
})
