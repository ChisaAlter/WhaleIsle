/**
 * Desktop caption drag invariant across every client stylesheet. Chromium
 * builds the window's draggable region as a geometric union of `drag` rects
 * minus `no-drag` rects — stacking order does not matter — so only the
 * frame caption band and macOS logo row may declare `drag`, and every
 * `position: fixed` layer must declare `no-drag`: a floating layer that can
 * cover the band's top 48px without a hole gets its clicks swallowed by
 * window dragging. Both drag regions remain behind content. The wallpaper
 * background is the one allowed fixed-layer exception; it is
 * `pointer-events: none` and a `no-drag` there would subtract the whole
 * viewport from the band.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Repo-relative posix path of a scanned stylesheet. */
type CssFile = { path: string, text: string }

/** Innermost rule block; `@media` context is irrelevant to region geometry. */
type CssBlock = { selector: string, body: string }

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))

const FIXED_NO_DRAG_EXEMPT = new Set([
  // pointer-events: none background layer behind #root; a no-drag hole here
  // would cover the viewport and delete the caption band geometrically.
  'packages/client/ui-theme/src/styles/wallpaper.css :: #dsh-wallpaper',
])

/* Manual walk: fs recursive readdir follows pnpm's cyclic node_modules
   symlinks and never terminates in this workspace. */
function walk(directory: string, relative: string, files: CssFile[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryRelative = `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'lib') continue
      walk(join(directory, entry.name), entryRelative, files)
    } else if (entry.isFile() && entry.name.endsWith('.css') && entryRelative.includes('/src/')) {
      files.push({ path: entryRelative, text: readFileSync(join(directory, entry.name), 'utf8') })
    }
  }
}

function cssFiles(): CssFile[] {
  const files: CssFile[] = []
  for (const group of ['packages/client', 'packages/extensions']) {
    walk(join(repoRoot, group), group, files)
  }
  return files
}

function blocks(text: string): CssBlock[] {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found: CssBlock[] = []
  for (const [, selector = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: selector.trim().replace(/\s+/g, ' '), body })
  }
  return found
}

describe('caption drag regions across client stylesheets', () => {
  const files = cssFiles()

  it('scans the client stylesheet population', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('keeps drag rectangles in the frame band and macOS logo row', () => {
    const dragBlocks = files.flatMap(file => blocks(file.text)
      .filter(block => /-webkit-app-region:\s*drag/.test(block.body))
      .map(block => `${file.path} :: ${block.selector}`))
    expect(dragBlocks).toEqual([
      'packages/client/ui-layout/src/client/AppFrame.module.css :: .captionDrag',
      "packages/client/web/src/base.css :: html[data-platform='darwin'] [data-window-drag]",
    ])
  })

  it('keeps every Session header action seat clickable above the caption band on all platforms', () => {
    const conversation = files.find(file => file.path === 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css')
    expect(conversation).toBeDefined()
    const noDragSelectors = blocks(conversation!.text)
      .filter(block => /-webkit-app-region:\s*no-drag/.test(block.body))
      .filter(block => !block.selector.includes(':global('))
      .flatMap(block => block.selector.split(',').map(selector => selector.trim()))
    expect(noDragSelectors).toEqual(expect.arrayContaining([
      '.headerLeading', '.crumbSeg', '.headerActions', '.headerUtilities', '.headerCorner',
    ]))
    expect(noDragSelectors).not.toContain('.crumbs')
  })

  it('subtracts native and custom interactive controls from drag regions on every platform', () => {
    const base = files.find(file => file.path === 'packages/client/web/src/base.css')
    expect(base).toBeDefined()
    const interactive = blocks(base!.text).find(block => block.selector.startsWith(':is(')
      && /-webkit-app-region:\s*no-drag/.test(block.body))
    expect(interactive?.selector).toContain('button')
    expect(interactive?.selector).toContain("[role='button']")
    expect(interactive?.selector).toContain('[tabindex]')
  })

  it('punches a no-drag hole in every position: fixed layer', () => {
    const missing = files.flatMap(file => blocks(file.text)
      .filter(block => /position:\s*fixed/.test(block.body))
      .filter(block => !/-webkit-app-region:\s*no-drag/.test(block.body))
      .map(block => `${file.path} :: ${block.selector}`)
      .filter(id => !FIXED_NO_DRAG_EXEMPT.has(id)))
    expect(missing).toEqual([])
  })

  it('keeps each exemption present and pointer-inert', () => {
    for (const id of FIXED_NO_DRAG_EXEMPT) {
      const [path = '', selector = ''] = id.split(' :: ')
      const file = files.find(candidate => candidate.path === path)
      const block = file && blocks(file.text).find(candidate => candidate.selector === selector)
      expect(block, id).toBeDefined()
      expect(block?.body, id).toMatch(/pointer-events:\s*none/)
    }
  })
})
