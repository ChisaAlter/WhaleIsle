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

  it('packs cluster controls with an 8px gap and leaves its gaps to the caption band', () => {
    const trailing = declarations('.titlebarTrailing')
    expect(trailing?.get('gap')).toBe('8px')
    expect(trailing?.get('width')).toBe('max-content')
    expect(trailing?.get('max-width')).toBe('100%')
    expect(trailing?.get('-webkit-app-region')).toBeUndefined()
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
    expect(trailing?.get('height')).toBe('32px')
    expect(trailing?.get('margin-top')).toBe('8px')
    expect(trailing?.get('align-items')).toBe('center')
    expect(trailing?.get('flex-shrink')).toBe('0')
    expect(declarations('.frame:not([data-rightbar-collapsed]) .titlebarTrailing')).toBeUndefined()
    expect(declarations('.detailsCol')?.get('grid-row')).toBe('2 / 4')
    expect(declarations('.titlebarBand')?.get('min-height')).toBe('52px')
    expect(declarations('.frame[data-titlebar-trailing-hidden] .titlebarTrailing')?.get('display')).toBe('none')
    expect(declarations('.frame[data-compact-header] .titlebarTrailing')).toBeUndefined()
  })

  it('paints an opaque drawer canvas only in the phone overlay', () => {
    const drawer = declarations('.frame[data-phone] .sidebarCol')
    expect(drawer?.get('background-color')).toBe('var(--dsh-phone-drawer-canvas)')
    expect(drawer?.get('--dsh-phone-drawer-canvas')).toBe('var(--dsw-alias-phone-drawer-canvas)')
    expect(drawer?.get('background-image')).toContain('var(--dsh-sidebar-rail-fill')
    expect(
      declarations(':global(body[data-ds-dark-theme]) .frame[data-phone] .sidebarCol')
        ?.get('--dsh-phone-drawer-canvas'),
    ).toBe('var(--dsw-alias-phone-drawer-canvas)')
    // The Git cluster clears the phone menu button and leaves the open drawer.
    expect(declarations('.frame[data-phone] .titlebarTrailing')?.get('max-width')).toBe('calc(100% - 64px)')
    expect(declarations('.frame[data-phone-sidebar] .titlebarTrailing')?.get('visibility')).toBe('hidden')
    expect(declarations('.frame[data-phone-sidebar] .titlebarTrailing')?.get('pointer-events')).toBe('none')
    // Desktop layout keeps the theme's translucent rail fill untouched.
    const desktop = declarations('.sidebarCol')
    expect(desktop?.get('background')).toBe('var(--dsh-sidebar-rail-fill, var(--dsw-specific-sidebar-fill))')
    expect(desktop?.get('background-color')).toBeUndefined()
  })
})
