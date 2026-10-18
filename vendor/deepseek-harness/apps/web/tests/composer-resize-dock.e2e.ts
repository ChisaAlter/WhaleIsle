// Desktop fork (composer-family-width): the queue dock follows a
// drag-resized composer card width, in the keyless replayed web lane.
// The upstream suite covers dock insets at rest (queue-actions.e2e.ts);
// this driver holds a hang turn, queues messages, then drags the card's
// right edge and asserts every input.dock panel keeps the
// card-minus-shared-inset relation during and after the drag.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const ACTIVE_PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const Q1 = 'Queue first'
const Q2 = 'Queue second'
const CONTEXT_PANEL_PX = 4

describe('desktop fork: input.dock panels follow the composer drag width', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined

  it('keeps queue, todo, and goal panels at card minus shared insets during and after a width drag', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-fork-composer-width-'))
    await writeFile(join(home, 'settings.yaml'), 'ui-conversation:\n  composerResize: true\n')
    const readyFile = join(home, '.hang-ready')
    const overridePath = join(home, 'replay.override.json')
    const recorded = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    expect(recorded).toHaveLength(1)
    await writeFile(overridePath, JSON.stringify([
      { kind: 'hang', readyFile },
      recorded[0]!,
      recorded[0]!,
    ] satisfies ReplayEntry[]))

    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath, harnessHome: home, compareReplaySession: false })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page!, 'web-fork-composer-width'))

    const input = page.locator('[data-composer-input]').first()
    await input.fill(ACTIVE_PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    // Goal + Todo + Queue all present, like the upstream layout scenario.
    await input.fill('/goal Keep the composer context panels aligned')
    await input.press('Enter')
    await page.locator('[data-goal-bar]').waitFor({ timeout: 10_000 })
    scaffold.ctx.sessions.list()[0]!.append('todo/write', {
      todos: [
        { content: 'Panel one', status: 'completed' },
        { content: 'Panel two', status: 'in_progress' },
      ],
    })
    await page.locator('[data-testid="todo-panel"]').waitFor({ timeout: 10_000 })

    for (const text of [Q1, Q2]) {
      await input.fill(text)
      await input.press('Enter')
    }
    await page.getByRole('button', { name: '2 queued messages' }).waitFor({ timeout: 10_000 })

    const boxes = async () => {
      const card = await page!.locator('[data-composer-card]').boundingBox()
      const dock = await page!.locator('[data-queue-dock] > div').boundingBox()
      const todo = await page!.locator('[data-testid="todo-panel"]').boundingBox()
      const goal = await page!.locator('[data-goal-bar] > div').boundingBox()
      expect(card).not.toBeNull()
      expect(dock).not.toBeNull()
      expect(todo).not.toBeNull()
      expect(goal).not.toBeNull()
      return { card: card!, dock: dock!, todo: todo!, goal: goal! }
    }

    // Rest: all family rows align to the card minus the shared insets.
    const rest = await boxes()
    for (const [label, b] of [['dock', rest.dock], ['todo', rest.todo], ['goal', rest.goal]] as const) {
      expect(Math.abs(b.x - rest.card.x), `${label} left`).toBeLessThanOrEqual(CONTEXT_PANEL_PX + 12)
      expect(
        Math.abs(rest.card.x + rest.card.width - b.x - b.width),
        `${label} right`,
      ).toBeLessThanOrEqual(CONTEXT_PANEL_PX + 12)
    }
    const restCardWidth = rest.card.width

    // Drag the right edge 240px narrower.
    const handle = page.locator('[data-composer-resize-handle][data-composer-resize-edge="right"]').first()
    await handle.waitFor({ timeout: 10_000 })
    const hb = await handle.boundingBox()
    expect(hb).not.toBeNull()
    const y = hb!.y + hb!.height / 2
    await page.mouse.move(hb!.x + hb!.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(hb!.x + hb!.width / 2 - 240, y, { steps: 12 })
    const during = await boxes()
    await page.mouse.up()
    const after = await boxes()

    for (const [label, b] of [['during', during], ['after', after]] as const) {
      for (const [name, box] of [['dock', b.dock], ['todo', b.todo], ['goal', b.goal]] as const) {
        expect(Math.abs(box.x - b.card.x), `${label} ${name} left`).toBeLessThanOrEqual(CONTEXT_PANEL_PX + 12)
        expect(
          Math.abs(b.card.x + b.card.width - box.x - box.width),
          `${label} ${name} right`,
        ).toBeLessThanOrEqual(CONTEXT_PANEL_PX + 12)
        expect(
          Math.abs(box.width - (b.card.width - 32)),
          `${label} ${name} width`,
        ).toBeLessThanOrEqual(8)
      }
    }
    expect(after.card.width).toBeLessThan(restCardWidth - 200)
    expect(after.dock.width).toBeLessThan(rest.dock.width - 200)
    expect(after.todo.width).toBeLessThan(rest.todo.width - 200)
    expect(after.goal.width).toBeLessThan(rest.goal.width - 200)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
