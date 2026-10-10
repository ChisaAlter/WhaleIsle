import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const conversationCss = readFileSync(fileURLToPath(new URL(
  '../src/client/skeleton/ConversationRoot.module.css',
  import.meta.url,
)), 'utf8')

/** Return one stylesheet rule body for an exact class selector. */
function rule(css: string, selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's').exec(css)
  expect(match, `missing ${selector} rule`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('conversation width handle styles', () => {
  it('keeps the gutter hit target narrow', () => {
    const handle = rule(conversationCss, '.widthHandle')
    const width = /width:\s*([^;]+);/s.exec(handle)?.[1]?.replace(/\s+/g, '')
    // Never wider than 10px; collapse to zero when the content column leaves
    // no room for the 24px inner inset and 24px outer safe zone.
    expect(width).toBe(
      'max(0px,min(10px,calc((100%-var(--dsh-chat-content-width))/2-24px-24px)))',
    )
  })

  it('keeps the hover indicator compact', () => {
    const indicator = rule(conversationCss, '.widthHandle::after')
    expect(indicator).toMatch(/width:\s*2px/)
    expect(indicator).toContain('var(--dsw-alias-scrollbar-bg-l1)')
    expect(indicator).not.toContain('var(--dsw-alias-scrollbar-hover-l1)')
    expect(indicator).toContain('var(--dsh-width-handle-pointer-y, 50%) - 36px')
    expect(indicator).toContain('var(--dsh-width-handle-pointer-y, 50%) + 36px')
  })

  it('keeps the indicator above the composer after drag capture begins', () => {
    expect(conversationCss).toMatch(/\.widthHandle\[data-dragging\]\s*\{[^}]*z-index:\s*8/s)
  })
})
