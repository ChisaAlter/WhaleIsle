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
    // +8px is the cluster's own margin; +16px absorbs .headerCorner's -16px
    // reach so the corner seat cannot paint under the cluster's left edge.
    expect(css).toContain('max(28px, calc(var(--dshd-titlebar-conversation-reserve, 0px) + 8px + 16px))')
    expect(css).toContain('var(--dshd-wco-controls, 8px))\n      + 16px')
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
    expect(declarations('.crumbs')?.get('flex')).toBe('1 1 0')
  })

  it('marks interactive chrome no-drag and leaves caption rows without a second drag region', () => {
    expect(declarations('.titleRow')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.blankCaption')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.crumbs')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.headerActions')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.headerUtilities')?.get('-webkit-app-region')).toBe('no-drag')
    expect(declarations('.tabs')?.get('-webkit-app-region')).toBeUndefined()
    expect(declarations('.header')?.get('-webkit-app-region')).toBeUndefined()
  })

  it('keeps a blank caption in the titlebar row instead of collapsing the header', () => {
    expect(declarations('.headerHidden')).toBeUndefined()
    expect(declarations('.blankCaption')?.get('min-height')).toBe('32px')
    expect(declarations('.headerBlank::after')?.get('display')).toBe('none')
  })

  it('drops the header hairline when no tab strip renders', () => {
    expect(declarations('.headerNoTabs::after')?.get('display')).toBe('none')
  })

  it('keeps phone left padding so the caption does not cover the menu', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?padding-left:\s*56px/)
  })

  it('nests in the centerCol subgrid so the header sits in the titlebar row and the body in the 1fr row', () => {
    expect(declarations('.root')?.get('display')).toBe('grid')
    expect(declarations('.root')?.get('grid-template-rows')).toBe('subgrid')
    expect(declarations('.root')?.get('grid-row')).toBe('1 / -1')
    expect(declarations('.header')?.get('grid-row')).toBe('1')
    expect(declarations('.body')?.get('grid-row')).toBe('2')
  })
})
