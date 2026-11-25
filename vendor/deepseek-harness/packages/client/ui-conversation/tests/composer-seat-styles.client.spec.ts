import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readStyles(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

const conversationCss = readStyles('../src/client/skeleton/ConversationRoot.module.css')
const inputBarCss = readStyles('../src/client/skeleton/InputBar.module.css')

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
    expect(conversationCss).toContain(".embeddedBody[data-content-phase='active'] .composerSeat:has([data-trigger-menu])")
  })

  it('keeps embedded composer seats transparent over wallpaper, gradient, and transparent themes', () => {
    expect(conversationCss).toMatch(/\.embeddedBody\s*\{[^}]*height:\s*100%;/)
    expect(conversationCss).toContain(".embeddedBody[data-content-phase='active'] .composerSeat")
    expect(conversationCss).toContain("html[data-dsh-wallpaper]) .embeddedBody[data-content-phase='active'] .composerSeat")
    expect(conversationCss).toContain("html[data-dsh-gradient]) .embeddedBody[data-content-phase='active'] .composerSeat")
    expect(conversationCss).toContain("html[data-dsh-transparent]) .embeddedBody[data-content-phase='active'] .composerSeat")
  })
})

describe('input bar resize and collapsed bar styles', () => {
  it('keeps resized width bounded by the unified axis or standalone fallback instead of 100%', () => {
    const resizedRule = rule(inputBarCss, '.card[data-composer-resized-width]')
    expect(resizedRule).toContain('min(100%, var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width)))')
    expect(resizedRule).not.toMatch(/max-width:\s*100%;/)
  })

  it('keeps collapsed bar full-width, directly editable on one horizontally scrollable line, and free of horizontal scale', () => {
    const collapsedCard = rule(inputBarCss, '.card[data-composer-collapsed]')
    expect(collapsedCard).not.toContain('380px')
    expect(collapsedCard).not.toMatch(/max-width:/)
    expect(collapsedCard).toMatch(/cursor:\s*text;/)

    const collapsedInput = rule(inputBarCss, '.card[data-composer-collapsed] .input')
    expect(collapsedInput).toMatch(/white-space:\s*pre;/)
    expect(collapsedInput).toMatch(/overflow-x:\s*auto;/)
    expect(collapsedInput).toMatch(/cursor:\s*text;/)
    expect(collapsedInput).not.toContain('text-overflow: ellipsis')

    const collapseKeyframes = /@keyframes composer-collapse-in\s*\{([\s\S]*?)\n\}/.exec(inputBarCss)?.[1] ?? ''
    const expandKeyframes = /@keyframes composer-expand-in\s*\{([\s\S]*?)\n\}/.exec(inputBarCss)?.[1] ?? ''
    expect(collapseKeyframes).not.toContain('scale(')
    expect(expandKeyframes).not.toContain('scale(')
  })
})
