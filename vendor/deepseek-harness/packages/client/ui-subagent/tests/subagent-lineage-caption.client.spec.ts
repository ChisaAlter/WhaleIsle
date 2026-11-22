/**
 * Subagent lineage caption: the control renders inside AppFrame's caption
 * band; without a no-drag hole the window drag region swallows the hover and
 * clicks that open the catalog.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SubagentHeaderLineage.module.css', import.meta.url)),
  'utf8',
)

function containerBlock(source: string, query: string): string | null {
  const header = `@container ${query}`
  const start = source.indexOf(header)
  if (start === -1) return null
  const open = source.indexOf('{', start + header.length)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return null
}

describe('SubagentHeaderLineage.module.css caption regions', () => {
  it('keeps the in-band lineage root no-drag', () => {
    expect(css).toMatch(/\.root\s*\{[^}]*-webkit-app-region:\s*no-drag/)
  })

  it('collapses the subagent trigger to a centered 28x28 icon button at <= 560px without absolute-positioning .activitySlot', () => {
    const compact = containerBlock(css, '(max-width: 560px)')
    expect(compact).not.toBeNull()
    expect(css).not.toContain('.catalogIcon')
    expect(css).not.toContain('.catalogChevron')
    expect(css).not.toContain('@container (max-width: 460px)')
    expect(css).not.toMatch(/\.activitySlot\s*\{[^}]*position:\s*absolute/)

    expect(compact).toMatch(/\.trigger\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*padding:\s*0;[^}]*justify-content:\s*center;/)
    expect(compact).toMatch(/\.trigger\s+\.activitySlot\s*\{[^}]*position:\s*static;[^}]*width:\s*15px;[^}]*height:\s*15px;/)
    expect(compact).toMatch(/\.trigger\s+\.activitySlot\s*>\s*svg\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;/)
    expect(compact).toMatch(/\.trigger\s+\.compactIcon\s*\{[^}]*display:\s*block;/)
    expect(compact).toMatch(/\.trigger\s+\.count\s*\{[^}]*display:\s*none;/)
    expect(compact).toMatch(/\.trigger\s+\.textModeActivity\s*\{[^}]*display:\s*none;/)
  })
})
