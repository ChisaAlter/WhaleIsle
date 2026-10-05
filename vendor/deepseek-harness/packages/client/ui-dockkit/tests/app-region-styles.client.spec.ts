/**
 * Window-drag subtraction, asserted against dockkit.module.css on disk: the
 * strip row marks itself `data-window-drag` in markup (TabPanel) and ui-web
 * base.css drags the row over its own box on macOS, while the desktop caption
 * band spans every platform — so `.menu` and `.float` subtract themselves
 * unguarded. Electron composes app-regions from geometry in DOM order — every
 * box that must stay usable subtracts itself from that row. The divider must
 * be listed explicitly: it is a plain div, so base.css's interactive-element
 * subtraction never matches it, and an unsubtracted vertical divider's top
 * run would drag the window instead of resizing the split.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Comments are stripped so a rule's captured selector is exactly its selector.
const css = readFileSync(resolve(import.meta.dirname, '../src/components/dockkit.module.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')

/** The sheet's app-region rules, as `[selector, value]` in source order. */
const regionRules = [...css.matchAll(/(?<sel>[^{}]+)\{(?<body>[^{}]*)\}/g)]
  .map(match => [match.groups!['sel']!.trim(), match.groups!['body']!] as const)
  .filter(([, body]) => body.includes('-webkit-app-region'))
  .map(([selector, body]) => [
    selector,
    /-webkit-app-region:\s*([^;]+);/.exec(body)?.[1]?.trim(),
  ] as const)

it('keeps Windows floating headers 20px below the caption, including restored positions', () => {
  const captionRule = css.split(':global(html[data-windows-titlebar]) .float')[1]?.split('}')[0]
  expect(captionRule).toContain('--dsh-dockkit-float-top: calc(var(--dsh-windows-titlebar-height) + 20px);')
  expect(css).toMatch(/:global\(html\[data-windows-titlebar\]\[data-fullscreen\]\) \.float\s*\{\s*--dsh-dockkit-float-top: 20px;/)
})

describe('macOS app-region ownership', () => {
  it('subtracts the chip run, strip-end chrome, pane body, and divider, and declares no drag itself', () => {
    // The strip row's drag is the markup mark's job: a sheet that declares it
    // here would drag the same box twice and hide the row from the ownership gate.
    expect(regionRules).toHaveLength(3)
    for (const [, value] of regionRules) {
      expect(value).toBe('no-drag')
    }
    const [selector] = regionRules.find(([name]) => name.includes('.stripTabs'))!
    for (const part of ['.stripTabs', '.stripChrome', '.paneBody', '.float', '.divider']) {
      expect(selector, part).toContain(`:global(html[data-platform='darwin']) ${part}`)
    }
  })

  it('punches unguarded no-drag holes for the fixed .menu and .float layers', () => {
    // Desktop fork: the caption band drags on every platform, so fixed layers
    // must subtract themselves outside the darwin gate.
    expect(regionRules.some(([name]) => name === '.menu')).toBe(true)
    expect(regionRules.some(([name]) => name === '.float')).toBe(true)
  })
})
