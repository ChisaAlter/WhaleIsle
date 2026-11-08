import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readStyles(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const conversationCss = readStyles('../src/client/skeleton/ConversationRoot.module.css')

/** Return the body of the rule whose selector list starts with `selector`. */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}[^{]*\\{([^}]*)\\}`).exec(css)
  expect(match, `missing ${selector} rule`).not.toBeNull()
  return match?.[1] ?? ''
}

// The desktop overlays its composer on the floor of the transcript column (a glass seat over a faded band), where
// upstream's seat is a sticky block that takes the column's free space; the stacking contract is the part both share.
describe('docked composer seat styles', () => {
  const seat = rule(conversationCss, ".root[data-phase='active'] .composerSeat,")

  it('overlays the seat on the floor of the column at one steady stacking rank, lifted only while a trigger menu is open', () => {
    expect(seat).toMatch(/position:\s*absolute;/)
    expect(seat).toMatch(/bottom:\s*0;/)
    expect(seat).toMatch(/z-index:\s*7;/)
    // The desktop's one other rank lifts the seat above the back-to-bottom control (z-index 8) while an @/slash menu is open.
    const ranked = [...conversationCss.matchAll(/([^{}]*\.composerSeat[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , body]) => body !== undefined && /z-index/.test(body))
    expect(ranked).toHaveLength(2)
    expect(rule(conversationCss, ".root[data-phase='active'] .composerSeat:has([data-trigger-menu])")).toMatch(/z-index:\s*9;/)
  })
})
