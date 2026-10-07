/**
 * Conversation header titlebar-crowding contract: reserve the trailing
 * cluster and preserve actions as the row narrows.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')

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

describe('ConversationRoot.module.css titlebar crowding', () => {
  it('pads the header by the conversation reserve AppFrame publishes', () => {
    // AppFrame's measured reserve already includes the native controls inset.
    // Keep the 8px gap and absorb the corner seat's 16px reach exactly once.
    expect(declarations('.header')?.get('padding-right')).toBe('max(28px, calc(var(--dshd-titlebar-conversation-reserve, 0px) + 8px + 16px))')
    expect(css).not.toContain('--dshd-wco-controls')
  })

  it('pins the corner seat reach the reserve padding absorbs', () => {
    expect(declarations('.headerCorner')?.get('margin-right')).toBe('-16px')
  })

  it('keeps actions inline at every frame density and queries the reserved row width', () => {
    expect(declarations('.titleRow')?.get('container-type')).toBe('inline-size')
    expect(declarations('.headerActions')?.get('display')).toBe('flex')
    expect(declarations('.headerActions')?.get('overflow')).toBeUndefined()
    expect(css).not.toContain("[data-titlebar-density='cozy']")
    expect(css).not.toContain("[data-titlebar-density='compact']")
    expect(declarations('.titleRow')?.get('display')).toBe('flex')
    expect(declarations('.titleCluster')?.get('flex')).toBe('1 1 0')
    expect(declarations('.crumbs')?.get('flex')).toBe('0 1 auto')
    expect(declarations('.crumbs')?.get('overflow')).toBe('hidden')
    expect(declarations('.headerActions')?.get('flex')).toBe('none')
    expect(declarations('.tabs')?.get('flex')).toBe('none')
    expect(declarations('.tabs')?.get('margin-top')).toBeUndefined()
    expect(declarations('.tab')?.get('font-size')).toBe('13px')
    expect(declarations('.tab')?.get('line-height')).toBe('16px')
    expect(declarations('.tab')?.get('padding')).toBe('0 0 11px')
    expect(declarations('.tab::after')?.get('left')).toBe('0')
    expect(declarations('.tab::after')?.get('right')).toBe('0')
  })

  it('marks interactive chrome no-drag and leaves caption rows without a second drag region', () => {
    expect(declarations('.titleRow')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.blankCaption')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.crumbs')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.crumbSeg')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.headerActions')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.headerUtilities')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.tabs')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.header')?.get('-webkit-app-region')).toBeUndefined()
  })

  it('keeps a blank caption in the titlebar row instead of collapsing the header', () => {
    expect(declarations('.headerHidden')).toBeUndefined()
    expect(declarations('.blankCaption')?.get('min-height')).toBe('28px')
    expect(declarations('.headerBlank::after')?.get('display')).toBe('none')
  })

  it('drops the header hairline when no tab strip renders', () => {
    expect(declarations('.headerNoTabs::after')?.get('display')).toBe('none')
  })

  it('keeps browser phone menu clearance without adding it to desktop caption controls', () => {
    const phone = declarations(":global(html:not([data-windows-titlebar]):not([data-platform='darwin']) [data-phone]) .header")
    expect(phone?.get('padding-left')).toBe('56px')
    expect(phone?.get('padding-top')).toBe('max(12px, env(safe-area-inset-top, 0px))')
    expect(phone?.get('padding-right')).toBe('max(16px, env(safe-area-inset-right, 0px))')
  })

  it('nests in the centerCol subgrid so the header sits in the titlebar row and the body in the 1fr row', () => {
    expect(declarations('.root')?.get('display')).toBe('grid')
    expect(declarations('.root')?.get('grid-template-rows')).toBe('subgrid')
    expect(declarations('.root')?.get('grid-row')).toBe('1 / -1')
    expect(declarations('.header')?.get('grid-row')).toBe('1')
    expect(declarations('.body')?.get('grid-row')).toBe('2')
  })
})
