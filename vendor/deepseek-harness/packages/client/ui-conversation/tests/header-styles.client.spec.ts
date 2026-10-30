/** Conversation navigation spacing: identity and tools share the first row; view tabs sit below it. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

describe('conversation header geometry', () => {
  it('sizes the view row from the 16px tab line and its 11px bar inset', () => {
    expect(css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 27px')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('min-height: 27px')
    expect(css.match(/\.tab\s*\{([^}]*)\}/)?.[1]).toContain('padding: 0 0 11px')
  })

  it('keeps 36px between view labels and 16px/20px around the More launcher', () => {
    expect(css.match(/\.viewTabs\s*\{([^}]*)\}/)?.[1]).toContain('gap: 36px')
    expect(css.match(/\.tabs\s*\{([^}]*)\}/)?.[1]).toContain('gap: 16px 20px')
  })
})
