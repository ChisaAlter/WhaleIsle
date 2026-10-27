// Keyless browser coverage for pending queue actions through the shipped Web
// composition and real HTTP/SSE wire. Replay overrides park consecutive turns
// so the page can edit and remove exact occurrences, then stop the active turn
// while proving the preserved Queue advances in FIFO order.
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed, vi } from 'vitest'
import { deriveReplayScript, parseSessionLog, type ReplayEntry } from '@deepseek-ai/dsh-llm-replay'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureExpandedTurnProcessAria, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expectTooltipOnTop, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/queue-actions', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/live-interactions/session.v3.jsonl', import.meta.url))
const COLLAPSED_EXPECTED = join(SNAPSHOT_DIR, 'collapsed.expected.md')
const EDITING_EXPECTED = join(SNAPSHOT_DIR, 'editing.expected.md')
const LAYOUT_EXPECTED = join(SNAPSHOT_DIR, 'layout.expected.md')
const PRESERVED_EXPECTED = join(SNAPSHOT_DIR, 'preserved.expected.md')
const PRESERVED_EXPANDED_EXPECTED = join(SNAPSHOT_DIR, 'preserved-expanded.expected.md')
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const SENDING_EXPECTED = join(SNAPSHOT_DIR, 'sending.expected.md')
const WRITER_HELD_EXPECTED = join(SNAPSHOT_DIR, 'writer-held.expected.md')
const FAILED_EXPECTED = join(SNAPSHOT_DIR, 'failed.expected.md')
const GOAL_STOP_EXPECTED = join(SNAPSHOT_DIR, 'goal-stop.expected.md')
const MODE = webSnapshotMode()

/** Desktop fork: four-column composer/context rails can sit ~2px off token insets. */
const CONTEXT_PANEL_PX = 4

const ACTIVE_PROMPT = 'Reply with a one-sentence description of event sourcing, then stop.'
const REMOVE = 'Queue item to remove'
const EDIT = 'Queue item to edit'
// The edited value is deliberately multi-line: the inline editor must keep the
// line breaks through the queue mutation and into the model-bound user message.
const EDITED_CONTENT = 'Edited\nqueue item'
// The dock preview flattens the queued text, so row locators match this form.
const EDITED = 'Edited queue item'
const TAIL = 'Queue item preserved after stop'
const WAKE = 'Wake the preserved queue'
const FAILED = 'Queue submission to retry'

/** Durable turn-end classifications observed by the scenario. */
function turnEndReasons(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : [])
}

describe('web e2e: queue row actions', () => {
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
      await rm(overrideDir, { recursive: true, force: true })
        .catch((error: unknown) => failures.push(error))
    }
    overrideDir = undefined
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'queue-actions teardown failed')
  })

  /** Wait for the exact queue mutation response before observing its unlocked actions. */
  async function settleQueueAction(action: () => Promise<void>, remainingText: string): Promise<void> {
    const response = page.waitForResponse('**/api/session/updateQueue')
    await action()
    expect((await response).ok()).toBe(true)
    const row = page.locator('[data-queue-dock] li', { hasText: remainingText })
    await expect.poll(() => row.getByRole('button', { name: 'Edit queued message' }).isEnabled()).toBe(true)
    await expect.poll(() => row.getByRole('button', { name: 'Remove queued message' }).isEnabled()).toBe(true)
  }

  it.skipIf(MODE === 'record').each(['button', 'keyboard'] as const)('edits and removes exact occurrences and preserves Queue across %s stop', async (method) => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-queue-actions-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    const recorded = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    expect(recorded).toHaveLength(1)
    const replay: ReplayEntry[] = [
      { kind: 'hang', readyFile },
      recorded[0]!,
      recorded[0]!,
      recorded[0]!,
    ]
    await writeFile(overridePath, JSON.stringify(replay))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath, compareReplaySession: false })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-queue-actions'))

    const input = page.locator('[data-composer-input]').first()
    const firstSettled = scaffold.whenTurnSettled()
    await input.fill(ACTIVE_PROMPT)
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)

    const admitted = page.waitForResponse('**/api/session/prompt')
    const received = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    await page.route('**/api/session/prompt', async (route) => {
      received.resolve(undefined)
      await release.promise
      await route.continue()
    }, { times: 1 })
    try {
      await input.fill(REMOVE)
      await input.press('Enter')
      await received.promise
      const pending = page.locator('[data-queue-dock] [data-submission-echo]')
      await pending.getByRole('status').waitFor()
      expect(await pending.getByRole('status').textContent()).toBe('Sending…')
      expect(await pending.getByRole('button').count()).toBe(3)
      expect(await pending.getByRole('button').evaluateAll(buttons =>
        buttons.every(button => (button as HTMLButtonElement).disabled))).toBe(true)
      expect(await input.textContent()).toBe('')
      expect(await input.getAttribute('contenteditable')).toBe('true')
      const sending = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(SENDING_EXPECTED, sending, MODE)
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.locator('[data-sidebar-collapsed="true"]').waitFor()
      await expect.poll(() => pending.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.setViewportSize({ width: 1680, height: 1000 })
      await page.locator('[data-sidebar-collapsed="true"]').waitFor({ state: 'detached' })
    } finally {
      release.resolve(undefined)
    }
    expect((await admitted).ok()).toBe(true)
    await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).isEnabled()).toBe(true)
    expect(await page.locator('[data-queue-dock] [data-submission-echo]').count()).toBe(0)
    expect(await page.locator('[data-queue-dock]').getByRole('status').count()).toBe(0)
    await input.fill(EDIT)
    await input.press('Enter')
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')
    await expect.poll(() => queueHeader.getByRole('status').count(), { timeout: 10_000 }).toBe(0)
    const collapsedSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(COLLAPSED_EXPECTED, collapsedSnapshot, MODE)
    await queueHeader.click()
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message', disabled: false }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    await page.setViewportSize({ width: 640, height: 1000 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor()
    // The responsive sidebar and composer settle independently; sample both
    // rectangles in one browser task so the comparison uses one layout.
    await vi.waitFor(async () => {
      const metrics = await page.evaluate(() => {
        const queue = document.querySelector('[data-queue-dock]')
        const composer = document.querySelector('[data-composer-card]')
        if (queue === null || composer === null) return undefined
        const queueBox = queue.getBoundingClientRect()
        const composerBox = composer.getBoundingClientRect()
        return {
          leftInset: queueBox.left - composerBox.left,
          rightInset: composerBox.right - queueBox.right,
          dockInset: Number.parseFloat(getComputedStyle(composer).getPropertyValue('--dsh-composer-dock-inset')),
        }
      })
      expect(metrics).toBeDefined()
      expect(metrics!.leftInset).toBeGreaterThanOrEqual(0)
      expect(metrics!.rightInset).toBeGreaterThanOrEqual(0)
      // Desktop fork: four-column composer/context rails can sit ~2px off the
      // token inset, so compare with pixel slack instead of exact equality.
      expect(Math.abs(metrics!.leftInset - metrics!.dockInset)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
      expect(Math.abs(metrics!.rightInset - metrics!.dockInset)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
    }, { timeout: 10_000 })
    await page.setViewportSize({ width: 1680, height: 1000 })

    const editRow = page.locator('[data-queue-dock] li', { hasText: EDIT })
    await editRow.getByRole('button', { name: 'Edit queued message' }).click()
    const editor = page.getByRole('textbox', { name: 'Edit queued message' })
    await editor.fill(EDITED_CONTENT)
    const save = page.getByRole('button', { name: 'Save queued message' })
    await save.hover()
    const saveTooltip = page.getByRole('tooltip', { name: 'Save queued message', exact: true })
    await saveTooltip.waitFor()
    // The dock tucks under the input card, which paints later; the bubble must
    // escape the panel's stacking context instead of landing behind it.
    await expectTooltipOnTop(saveTooltip)
    const tooltipGeometry = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[role="tooltip"]')
      if (element === null) return null
      const tooltip = element.getBoundingClientRect()
      return {
        declaredLeft: Number.parseFloat(element.style.left),
        declaredTop: Number.parseFloat(element.style.top),
        tooltipCenter: tooltip.left + tooltip.width / 2,
        tooltipTop: tooltip.top,
      }
    })
    expect(tooltipGeometry).not.toBeNull()
    expect(Math.abs(tooltipGeometry!.tooltipCenter - tooltipGeometry!.declaredLeft)).toBeLessThan(2)
    expect(Math.abs(tooltipGeometry!.tooltipTop - tooltipGeometry!.declaredTop)).toBeLessThan(2)
    const editingSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EDITING_EXPECTED, editingSnapshot, MODE)
    await settleQueueAction(() => save.click(), EDITED)
    await page.getByText(EDITED, { exact: true }).waitFor()

    const removeRow = page.locator('[data-queue-dock] li', { hasText: REMOVE })
    await settleQueueAction(() => removeRow.getByRole('button', { name: 'Remove queued message' }).click(), EDITED)
    await expect.poll(() => page.getByText(REMOVE, { exact: true }).count()).toBe(0)
    // The queue stream can remove the row before the mutation reply clears busy.
    const remainingEdit = page.getByRole('button', { name: 'Edit queued message', exact: true })
    await expect.poll(() => remainingEdit.isEnabled(), { timeout: 10_000 }).toBe(true)
    await remainingEdit.hover()
    const editTooltip = page.getByRole('tooltip', { name: 'Edit queued message', exact: true })
    await editTooltip.waitFor()
    await expectTooltipOnTop(editTooltip)

    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(sessionEvents.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
    await page.route('**/api/session/prompt', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          type: 'server-response', rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: { code: 'session/agent-busy', message: 'Queue submission failed', details: { reason: 'admission refused' } },
          },
        },
      })
    }, { times: 1 })
    await input.fill(FAILED)
    await input.press('Enter')
    const failure = page.getByRole('alert').filter({ hasText: 'Queue submission failed' })
    await failure.waitFor()
    await expect.poll(() => input.textContent()).toBe(FAILED)
    expect(await page.locator('[data-queue-dock] [data-submission-echo]').count()).toBe(0)
    const failed = [
      await failure.ariaSnapshot(),
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
    ].join('\n')
    await compareOrRefreshGolden(FAILED_EXPECTED, failed, MODE)

    await page.route('**/api/session/prompt', async (route) => {
      const envelope = route.request().postDataJSON() as { rpcId: string }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          type: 'server-response', rpcId: envelope.rpcId,
          result: {
            ok: false,
            error: { code: 'session/writer-held', message: 'writer held', details: { sessionId: 'held-session' } },
          },
        },
      })
    }, { times: 1 })
    await input.press('Enter')
    const writerHeld = page.getByRole('alert').filter({ hasText: 'This session is already in use' })
    await writerHeld.waitFor()
    await expect.poll(() => input.textContent()).toBe(FAILED)
    await compareOrRefreshGolden(WRITER_HELD_EXPECTED, [
      await writerHeld.ariaSnapshot(),
      await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd),
    ].join('\n'), MODE)

    await input.fill(TAIL)
    await input.press('Enter')
    await expect.poll(
      () => page.getByRole('button', { name: 'Remove queued message', disabled: false }).count(),
      { timeout: 10_000 },
    ).toBe(2)

    const stopButton = page.getByRole('button', { name: 'Stop generating' })
    await stopButton.hover()
    await page.getByRole('tooltip', { name: 'Stop generating Esc Esc', exact: true }).waitFor()
    if (method === 'button') await stopButton.click()
    else {
      await input.focus()
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    await firstSettled
    await expect.poll(() => page.getByRole('button', { name: 'Stop generating' }).count())
      .toBe(0)
    await expect.poll(() => page.getByRole('button', { name: 'Remove queued message' }).count())
      .toBe(2)

    // The disabled Send button must dismiss the active Stop tooltip without mouseleave.
    await expect.poll(() => page.getByRole('tooltip').count()).toBe(0)
    const preservedSnapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PRESERVED_EXPECTED, preservedSnapshot, MODE)
    const expanded = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(PRESERVED_EXPANDED_EXPECTED, expanded, MODE)

    const settled = scaffold.whenTurnSettled()
    await input.fill(WAKE)
    await input.press('Enter')
    await settled
    await expect.poll(() => turnEndReasons(sessionEvents), { timeout: 15_000 })
      .toEqual(['aborted', 'completed', 'completed', 'completed'])
    expect(sessionEvents.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual([ACTIVE_PROMPT, EDITED_CONTENT, TAIL, WAKE])
    await expect.poll(() => page.locator('[data-queue-dock]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('orders Todo before Goal and Queue on one responsive card column', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-context-layout-'))
    const readyFile = join(overrideDir, '.hang-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    await writeFile(overridePath, JSON.stringify([{ kind: 'hang', readyFile } satisfies ReplayEntry]))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath, compareReplaySession: false })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-context-layout'))

    const input = page.locator('[data-composer-input]').first()
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill('/goal Keep the composer context panels aligned')
    await input.press('Enter')
    await expect.poll(() => existsSync(readyFile), { timeout: 15_000 }).toBe(true)
    await page.locator('[data-goal-bar]').waitFor({ timeout: 10_000 })
    await page.locator('[data-phase="active"] [data-composer-input]').waitFor({ timeout: 10_000 })
    await page.locator('[data-composer-entering]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    const activeInput = await input.elementHandle()
    if (activeInput === null) throw new Error('active composer input is missing')
    const todoPanel = page.getByTestId('todo-panel')
    const todoHeader = todoPanel.getByRole('button')
    const sessions = scaffold.ctx.sessions.list()
    expect(sessions).toHaveLength(1)
    const writeTodos = () => sessions[0]!.append('todo/write', {
      todos: [
        { content: 'Confirm the panel order', status: 'completed' },
        { content: 'Align the panel widths', status: 'in_progress' },
      ],
    })

    const sampleContextMotion = async (label: string, selector: string, action: () => Promise<void>) => {
      const probe = await page.evaluateHandle(async ({ originalInput, selector }) => {
        const card = originalInput.closest<HTMLElement>('[data-composer-card]')!
        const seat = card.closest<HTMLElement>('[data-composer-seat]')!
        const measure = () => {
          const box = card.getBoundingClientRect()
          const seatBox = seat.getBoundingClientRect()
          const panel = seat.querySelector<HTMLElement>(selector)
          let layoutParent = panel?.parentElement ?? null
          while (layoutParent !== null && getComputedStyle(layoutParent).display === 'contents') {
            layoutParent = layoutParent.parentElement
          }
          const surface = panel?.querySelector<HTMLElement>('[data-dsh-motion="fade"]')
          const surfaceStyle = surface === null || surface === undefined ? null : getComputedStyle(surface)
          return {
            surfaceTransition: surfaceStyle?.transitionProperty ?? '',
            surfaceDuration: surfaceStyle?.transitionDuration ?? '',
            top: box.top, bottom: box.bottom, left: box.left, width: box.width,
            seatTop: seatBox.top, seatHeight: seatBox.height,
            panelHeight: panel?.getBoundingClientRect().height ?? 0,
            panelGap: layoutParent === null ? 0 : Number.parseFloat(getComputedStyle(layoutParent).rowGap),
            hidden: panel?.getAttribute('aria-hidden') === 'true',
            inert: panel?.hasAttribute('inert') === true,
            sameInput: originalInput.isConnected
              && document.querySelector('[data-phase="active"] [data-composer-input]') === originalInput
              && originalInput.closest('[data-composer-card]') === card,
          }
        }
        const settle = async () => {
          const deadline = performance.now() + 5_000
          let previous = measure()
          let stable = 0
          while (performance.now() < deadline) {
            await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
            const current = measure()
            const animating = seat.getAnimations({ subtree: true }).some(animation =>
              (animation.playState === 'running' || animation.pending)
              && animation.effect?.getComputedTiming().iterations !== Infinity)
            stable = !animating && (['top', 'bottom', 'left', 'width', 'seatTop', 'seatHeight', 'panelHeight'] as const)
              .every(key => Math.abs(current[key] - previous[key]) < 0.01) ? stable + 1 : 0
            if (stable >= 6) return
            previous = current
          }
          throw new Error('composer context geometry did not settle')
        }
        await settle()
        const frames = [measure()]
        let frame = 0
        const sampledTransitions = new WeakSet<Animation>()
        const sample = () => {
          cancelAnimationFrame(frame)
          const panel = seat.querySelector<HTMLElement>(selector)
          // Sample each real height track at its midpoint as well: busy hosts can
          // deliver rAF callbacks less frequently than the 200ms transition.
          for (const animation of panel?.getAnimations({ subtree: true }) ?? []) {
            if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'grid-template-rows'
              || sampledTransitions.has(animation)) continue
            sampledTransitions.add(animation)
            const currentTime = animation.currentTime
            const duration = Number(animation.effect?.getTiming().duration)
            if (duration > 0) {
              animation.currentTime = duration / 2
              frames.push(measure())
              animation.currentTime = currentTime
            }
          }
          frames.push(measure())
          frame = requestAnimationFrame(sample)
        }
        const observer = new MutationObserver(sample)
        observer.observe(seat, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
        const cancel = () => { cancelAnimationFrame(frame); observer.disconnect() }
        // Resolve only after a real sampled frame, before the Host write or click.
        await new Promise<void>(resolve => requestAnimationFrame(() => { sample(); resolve() }))
        return {
          finish: async () => { await settle(); cancel(); return frames },
          cancel,
        }
      }, { originalInput: activeInput, selector })
      try {
        await action()
        const frames = await probe.evaluate(capture => capture.finish())
        const first = frames[0]!
        const last = frames.at(-1)!
        const visible = frames.find(frame => frame.panelHeight > 1)!
        expect(visible.surfaceTransition.split(',').map(property => property.trim()), `${label}: keeps the surface movement in the cascade`)
          .toEqual(['opacity', 'transform'])
        expect(visible.surfaceDuration.split(',').every(duration => Number.parseFloat(duration) > 0.1), `${label}: fades for the full height transition`).toBe(true)
        expect(frames.every(frame => frame.sameInput), `${label}: retains the active input DOM`).toBe(true)
        expect(Math.max(...frames.map(frame => Math.abs(frame.top - first.top))), `${label}: input card top`)
          .toBeLessThanOrEqual(1)
        expect(Math.max(...frames.map(frame => Math.abs(frame.bottom - first.bottom))), `${label}: input card bottom`)
          .toBeLessThanOrEqual(1)
        const low = Math.min(first.panelHeight, last.panelHeight)
        const high = Math.max(first.panelHeight, last.panelHeight)
        expect(high - low, `${label}: changes the context panel height`).toBeGreaterThan(2)
        expect(frames.some(frame => frame.panelHeight > low + 1 && frame.panelHeight < high - 1),
          `${label}: includes an intermediate panel height`).toBe(true)
        if (first.panelHeight === 0 || last.panelHeight === 0) {
          const stackGap = first.panelHeight === 0 ? last.panelGap : -first.panelGap
          const gap = selector === '[data-queue-dock]' ? (first.panelHeight === 0 ? -3 : 3) : stackGap
          expect(Math.abs(last.seatHeight - first.seatHeight - (last.panelHeight - first.panelHeight + gap)),
            `${label}: reserves exactly the panel and one stack gap`).toBeLessThanOrEqual(1)
        }
        if (last.panelHeight === 0) {
          expect(frames.some(frame => frame.hidden && frame.inert && frame.panelHeight > 1),
            `${label}: closing content leaves keyboard and accessibility access before unmount`).toBe(true)
        }
        return { first, last }
      } finally {
        await probe.evaluate((capture) => { capture.cancel() })
        await probe.dispose()
      }
    }
    const addTodos = async () => {
      writeTodos()
      await todoPanel.waitFor({ timeout: 10_000 })
    }
    const clearTodos = async () => {
      sessions[0]!.append('todo/write', { todos: [] })
      await expect.poll(() => page.getByRole('region', { name: 'To-dos', exact: true }).count(), { timeout: 10_000 }).toBe(0)
      await todoPanel.waitFor({ state: 'detached', timeout: 10_000 })
    }
    const toggleTodos = async (expanded: boolean) => {
      await todoHeader.click()
      await expect.poll(() => todoHeader.getAttribute('aria-expanded')).toBe(String(expanded))
      await expect.poll(() => todoPanel.getByRole('listitem').count()).toBe(expanded ? 2 : 0)
    }
    const todoSelector = '[data-testid="todo-panel"]'
    const initialTodo = await sampleContextMotion('Todo added', todoSelector, addTodos)
    await sampleContextMotion('Todo expanded', todoSelector, () => toggleTodos(true))
    await sampleContextMotion('Todo collapsed', todoSelector, () => toggleTodos(false))
    const clearedTodo = await sampleContextMotion('Todo cleared', todoSelector, clearTodos)
    expect(Math.abs(clearedTodo.last.seatTop - initialTodo.first.seatTop)).toBeLessThanOrEqual(1)
    expect(Math.abs(clearedTodo.last.seatHeight - initialTodo.first.seatHeight)).toBeLessThanOrEqual(1)
    await sampleContextMotion('Todo added again', todoSelector, addTodos)

    await sampleContextMotion('Queue added', '[data-queue-dock]', async () => {
      await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
      await input.fill('Layout queue first')
      await input.press('Enter')
      await page.locator('[data-queue-dock]').waitFor({ timeout: 10_000 })
    })
    await page.locator('[data-composer-input][contenteditable="true"]').first().waitFor({ timeout: 10_000 })
    await input.fill('Layout queue second')
    await input.press('Enter')
    const queueHeader = page.getByRole('button', { name: '2 queued messages' })
    await expect.poll(() => queueHeader.getAttribute('aria-expanded'), { timeout: 10_000 })
      .toBe('false')
    await expect.poll(() => queueHeader.getByRole('status').count(), { timeout: 10_000 }).toBe(0)

    const layoutSnapshot = await captureStableAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(LAYOUT_EXPECTED, layoutSnapshot, MODE)

    const expectAlignedContextPanels = async () => {
      // Sample one layout: the responsive grid can move between separate browser round trips.
      await vi.waitFor(async () => {
        const [queuePanelBox, todoBox, goalBox] = await page.evaluate(() => [
          document.querySelector('[data-queue-dock] ul')?.parentElement,
          document.querySelector('[data-testid="todo-panel"]'),
          // The action row belongs to the visible card, inside its height clip.
          document.querySelector('[data-goal-bar] button[aria-label="Clear goal"]')?.parentElement?.parentElement,
        ].map((element) => {
          const box = element?.getBoundingClientRect()
          return box === undefined ? null : { x: box.x, y: box.y, width: box.width }
        }))
        expect(queuePanelBox).not.toBeNull()
        expect(todoBox).not.toBeNull()
        expect(goalBox).not.toBeNull()
        expect(todoBox!.y).toBeLessThan(goalBox!.y)
        expect(goalBox!.y).toBeLessThan(queuePanelBox!.y)
        expect(Math.abs(todoBox!.x - goalBox!.x)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
        expect(Math.abs(todoBox!.x - queuePanelBox!.x)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
        expect(Math.abs(todoBox!.width - goalBox!.width)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
        expect(Math.abs(todoBox!.width - queuePanelBox!.width)).toBeLessThanOrEqual(CONTEXT_PANEL_PX)
      }, { timeout: 10_000 })
    }
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 640, height: 1000 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor({ timeout: 10_000 })
    await expectAlignedContextPanels()
    const narrowTodo = await sampleContextMotion('Narrow Todo cleared', todoSelector, clearTodos)
    const narrowReadded = await sampleContextMotion('Narrow Todo added again', todoSelector, addTodos)
    expect(Math.abs(narrowReadded.last.seatHeight - narrowTodo.first.seatHeight)).toBeLessThanOrEqual(1)
    await sampleContextMotion('Narrow Todo expanded', todoSelector, () => toggleTodos(true))
    await sampleContextMotion('Narrow Todo collapsed', todoSelector, () => toggleTodos(false))
    await expectAlignedContextPanels()
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.locator('[data-sidebar-collapsed="true"]').waitFor({ state: 'detached', timeout: 10_000 })
    await expectAlignedContextPanels()

    await queueHeader.click()
    const removeButtons = page.getByRole('button', { name: 'Remove queued message' })
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(2)
    await removeButtons.first().click()
    await expect.poll(() => removeButtons.count(), { timeout: 10_000 }).toBe(1)
    await sampleContextMotion('Queue cleared', '[data-queue-dock]', async () => {
      await removeButtons.first().click()
      await page.locator('[data-queue-dock]').waitFor({ state: 'detached', timeout: 10_000 })
    })
    const finalTodo = await sampleContextMotion('Final Todo cleared', todoSelector, clearTodos)
    expect(Math.abs(finalTodo.last.seatTop - initialTodo.first.seatTop)).toBeLessThanOrEqual(1)
    expect(Math.abs(finalTodo.last.seatHeight - initialTodo.first.seatHeight)).toBeLessThanOrEqual(1)
    await sampleContextMotion('Goal cleared', '[data-goal-bar]', async () => {
      await page.getByRole('button', { name: 'Clear goal', exact: true }).click()
      await expect.poll(() => page.getByRole('button', { name: 'Clear goal', exact: true }).count(), { timeout: 10_000 }).toBe(0)
      await page.locator('[data-goal-bar]').waitFor({ state: 'detached', timeout: 10_000 })
    })
    expect(await todoPanel.count()).toBe(0)
    expect(await page.locator('[data-goal-bar]').count()).toBe(0)
    expect(await page.locator('[data-queue-dock]').count()).toBe(0)
    expect(await activeInput.evaluate(element => element.isConnected
      && document.querySelector('[data-phase="active"] [data-composer-input]') === element)).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const reducedTop = await page.locator('[data-composer-card]').evaluate(card => card.getBoundingClientRect().top)
    await addTodos()
    await expect.poll(() => todoPanel.getAttribute('data-state')).toBe('open')
    expect(await todoPanel.locator('[data-dsh-motion="fade"]').first().evaluate(surface =>
      getComputedStyle(surface).transitionDuration.split(',').every(duration => Number.parseFloat(duration) === 0))).toBe(true)
    await toggleTodos(true)
    await clearTodos()
    expect(await page.locator('[data-composer-card]').evaluate(card => card.getBoundingClientRect().top)).toBe(reducedTop)
    await activeInput.dispose()
    const settled = scaffold.whenTurnSettled()
    await page.getByRole('button', { name: 'Stop generating' }).click()
    await settled

    expect(turnEndReasons(sessionEvents)).toEqual(['aborted'])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('runs a prompt sent after Stop when a Goal round was queued behind stopped work', async () => {
    overrideDir = await mkdtemp(join(tmpdir(), 'dsh-web-goal-stop-'))
    const roundReady = join(overrideDir, '.round-ready')
    const humanReady = join(overrideDir, '.human-ready')
    const overridePath = join(overrideDir, 'replay.override.json')
    const recorded = deriveReplayScript(parseSessionLog(await readFile(FIXTURE, 'utf8')))
    await writeFile(overridePath, JSON.stringify([
      { kind: 'hang', readyFile: roundReady },
      { kind: 'hang', readyFile: humanReady },
      recorded[0]!,
    ] satisfies ReplayEntry[]))

    const sessionEvents: SessionEvent[] = []
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: overridePath, compareReplaySession: false })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-stop'))

    const input = page.locator('[data-composer-input]').first()
    const editable = page.locator('[data-composer-input][contenteditable="true"]').first()
    const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
    await editable.waitFor({ timeout: 10_000 })
    await input.fill('/goal Keep working after Stop')
    await input.press('Enter')
    await expect.poll(() => existsSync(roundReady), { timeout: 15_000 }).toBe(true)

    // Human work queued behind the running round survives the first Stop.
    await editable.waitFor({ timeout: 10_000 })
    await input.fill(REMOVE)
    await input.press('Enter')
    await page.getByRole('button', { name: 'Remove queued message', disabled: false }).waitFor({ timeout: 10_000 })
    await stop.click()
    await page.getByRole('button', { name: 'Resume goal' }).waitFor({ timeout: 10_000 })

    // Resuming queues the next round behind that human prompt, which runs first.
    await page.getByRole('button', { name: 'Resume goal' }).click()
    await expect.poll(() => existsSync(humanReady), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => page.locator('[data-queue-dock] li', { hasText: '<goal_round>' }).count(), { timeout: 10_000 })
      .toBe(1)
    await stop.click()
    await expect.poll(() => stop.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(() => page.locator('[data-queue-dock]').count(), { timeout: 10_000 }).toBe(0)

    const settled = scaffold.whenTurnSettled()
    await editable.waitFor({ timeout: 10_000 })
    await input.fill(WAKE)
    await input.press('Enter')
    await settled
    await expect.poll(() => turnEndReasons(sessionEvents), { timeout: 15_000 })
      .toEqual(['aborted', 'aborted', 'completed'])
    expect(sessionEvents.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])).toEqual([REMOVE, WAKE])
    expect(sessionEvents.some(event => event.type === 'agent/inbox/spliced' && event.data.target === 'next-turn'
      && event.data.outcome === 'canceled')).toBe(true)
    await expect.poll(() => stop.count(), { timeout: 10_000 }).toBe(0)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GOAL_STOP_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it.skipIf(MODE === 'record')('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(
      SNAPSHOT_DIR,
      [
        'collapsed.expected.md', 'editing.expected.md', 'layout.expected.md',
        'preserved.expected.md', 'preserved-expanded.expected.md', 'ui.expected.md',
        'sending.expected.md', 'failed.expected.md', 'writer-held.expected.md',
        'goal-stop.expected.md',
      ],
    )
  })
})
