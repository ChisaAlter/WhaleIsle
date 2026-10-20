// Desktop fork (composer-family-width): an approval takeover covers the
// drag-resized composer card exactly. The keyless approval-composer replay
// raises one bash approval after the composer was narrowed and heightened by
// its own edge handles; the approval card must take the input card's rect
// (left, top, width, height) instead of sliding by its own padding.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/approval-composer/session.v3.jsonl', import.meta.url))
// The recorded prompt (approval-composer.e2e.ts): one inline bash write that needs approval.
const TOKENS = Array.from({ length: 220 }, (_, index) => `tok${((index + 1) * 7919 % 99991).toString(36)}`).join(' ')
const PROMPT = `Write a file named notes.txt in the workspace containing exactly this text on one line: ${TOKENS}. Use one bash command with the literal text inline. Then reply with the single word DONE and stop.`

interface Box { left: number, top: number, width: number, height: number }

/** The visible composer card, or the approval card once the takeover is elected. */
function cardBox(page: Page, which: 'input' | 'approval'): Promise<Box | null> {
  return page.evaluate((target) => {
    const card = target === 'input'
      ? document.querySelector('[data-composer-seat] [data-chain-overlay-fallback="conversation.composer"] [data-composer-card]')
      : document.querySelector('[data-approval-scroll]')?.closest('[data-approval-key] > *')
    if (!card) return null
    const box = card.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }, which)
}

async function dragEdge(page: Page, edge: 'right' | 'top', dx: number, dy: number): Promise<void> {
  const box = (await page.locator(`[data-composer-resize-edge="${edge}"]`).first().boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 10 })
  await page.mouse.up()
}

describe('desktop fork: approval takeover covers the resized composer card', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-approval-resize-'))
    await writeFile(join(home, 'settings.yaml'), 'ui-conversation:\n  composerResize: true\n')
    scaffold = await launchWebScaffold({ harnessHome: home, replayFixture: FIXTURE, paceMs: 15, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1600, height: 1000 })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('places the approval card on the input card rect', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-fork-approval-resize'))
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor()
    await page.locator('[aria-label^="Access mode"]').click()
    await page.getByRole('menuitem', { name: 'Read Only' }).click()
    await dragEdge(page, 'right', -180, 0)
    await dragEdge(page, 'top', 0, -120)

    const settled = scaffold.whenTurnSettled(60_000)
    await input.fill(PROMPT)
    await input.press('Enter')
    const panel = page.locator('[data-approval-key]')
    await panel.waitFor({ timeout: 60_000 })
    // The seat settles a frame or two after the takeover mounts (both cards
    // move together), so record the approval rect once two reads agree.
    let approval: Box | null = null
    await expect.poll(async () => {
      const previous = approval
      approval = await cardBox(page, 'approval')
      return approval !== null && previous !== null
        && (['left', 'top', 'width', 'height'] as const).every(key => Math.abs(approval![key] - previous[key]) < 0.5)
    }, { timeout: 5_000, interval: 100 }).toBe(true)

    // The answered takeover hands the seat back: the input card returns to the
    // rect the approval card covered.
    await panel.getByRole('button', { name: 'Allow once' }).click()
    await panel.waitFor({ state: 'detached', timeout: 10_000 })
    // The returning card settles within a few frames of the takeover's removal.
    await expect.poll(async () => {
      const after = await cardBox(page, 'input')
      if (after === null) return 'no input card'
      const off = (['left', 'top', 'width', 'height'] as const)
        .filter(key => Math.abs(approval![key] - after[key]) > 1)
        .map(key => `${key} ${approval![key].toFixed(1)} vs ${after[key].toFixed(1)}`)
      return off.join(', ') || 'aligned'
    }, { timeout: 3_000 }).toBe('aligned')
    await settled
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
