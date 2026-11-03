// Keyless browser coverage for reordering the pending Queue through the shipped
// Web composition and real HTTP/SSE wire. A parked first turn keeps three
// messages queued; the page then drags one to the bottom and moves it back up
// with the keyboard, and the Host's durable Inbox must follow each move as one
// splice that no consumer can mistake for a claim.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { deriveReplayScript, parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const MODE = webSnapshotMode()

const ACTIVE_PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const QUEUED = ['Queue item A', 'Queue item B', 'Queue item C'] as const

describe('web e2e: queue reorder', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page
  let overrideDir: string | undefined

  afterEach(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    browser = undefined
    const closing = scaffold
    scaffold = undefined
    await closing?.close().catch((error: unknown) => failures.push(error))
    if (overrideDir !== undefined) {
      await rm(overrideDir, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
    }
    overrideDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'queue-reorder teardown failed')
  })

  /** Row texts in dock order. */
  const rowOrder = (): Promise<string[]> => page.locator('[data-queue-dock] li').evaluateAll(
    rows => rows.map(row => (row.textContent ?? '').trim()),
  )

  it.skipIf(MODE === 'record')('moves a queued message by dragging its grip and with the arrow keys', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-queue-reorder-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    // Only the parked turn runs; the queue is never drained.
    await writeFile(overridePath, JSON.stringify([{ kind: 'hang', readyFile }]))
    expect(deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))).toHaveLength(1)

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath, compareReplaySession: false })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-queue-reorder'))

    const input = page.locator('[data-composer-input]').first()
    await input.fill(ACTIVE_PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    for (const [index, text] of QUEUED.entries()) {
      const queued = page.waitForResponse('**/api/session/prompt')
      await input.fill(text)
      await input.press('Enter')
      expect((await queued).ok()).toBe(true)
      if (index > 0) {
        await page.getByRole('button', { name: `${index + 1} queued messages` }).waitFor({ timeout: 10_000 })
      }
    }
    const header = page.getByRole('button', { name: '3 queued messages' })
    if (await header.getAttribute('aria-expanded') === 'false') await header.click()
    await expect.poll(rowOrder, { timeout: 10_000 }).toEqual([...QUEUED])

    const grips = page.locator('[data-queue-dock] [role="button"][draggable="true"]')
    await expect.poll(() => grips.count()).toBe(3)
    const rowCount = sessionEvents.filter(event => event.type === 'agent/inbox/spliced').length

    // Drag the first message onto the lower half of the last row.
    const moved = page.waitForResponse('**/api/session/updateQueue')
    await page.locator('[data-queue-dock] li', { hasText: QUEUED[0] }).getByRole('button', { name: /^Reorder queued message/ })
      .dragTo(page.locator('[data-queue-dock] li', { hasText: QUEUED[2] }), { targetPosition: { x: 80, y: 30 } })
    expect((await moved).ok()).toBe(true)
    await expect.poll(rowOrder, { timeout: 10_000 }).toEqual([QUEUED[1], QUEUED[2], QUEUED[0]])

    // The move is one durable splice over the shifted range, shaped like an edit.
    const splices = sessionEvents.filter(event => event.type === 'agent/inbox/spliced').slice(rowCount)
    expect(splices).toHaveLength(1)
    const splice = splices[0]!
    if (splice.type !== 'agent/inbox/spliced') throw new Error('unreachable')
    expect(splice.data).toMatchObject({ target: 'next-turn', start: 0, removedCount: 3, outcome: 'canceled' })
    expect(splice.data.inserted).toHaveLength(3)

    // The keyboard moves it back up one place, and focus stays on its grip.
    const grip = page.locator('[data-queue-dock] li', { hasText: QUEUED[0] }).getByRole('button', { name: /^Reorder queued message/ })
    await grip.focus()
    const movedUp = page.waitForResponse('**/api/session/updateQueue')
    await grip.press('ArrowUp')
    expect((await movedUp).ok()).toBe(true)
    await expect.poll(rowOrder, { timeout: 10_000 }).toEqual([QUEUED[1], QUEUED[0], QUEUED[2]])
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toBe('Reorder queued message 2 of 3')

    // Reordering never let a queued message start a turn: only the parked one is running.
    expect(sessionEvents.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)
})
