// Desktop fork (window-motion): the caption band drags everywhere except over
// controls. Windows and Linux compose the window's drag region from the
// AppFrame caption band minus every `no-drag` box after it in document order,
// so any no-drag box without a control under it is a dead patch of titlebar:
// a container's padding, a label, a transparent layer left mounted after a
// menu closes. This lane sweeps the band of the shipped composition in the
// states users move through and fails on every point where the composed
// region and the hit-tested control disagree, in either direction.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { INTERACTIVE_SELECTOR } from '@deepseek-ai/dsh-client-web/src/window-drag/regions.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const RELEASE = '.caption-drag-dead-zones.release'
const COMMAND = `for _ in $(seq 1 3000); do [ -e ${RELEASE} ] && break; sleep 0.2; done`
/** The AppFrame caption band height. */
const BAND = 48
const STEP = 4

/**
 * Sweep the caption band. A point is a control when the hit-tested element sits
 * inside an interactive element or shows a pointer/resize cursor; the composed
 * region is the last collected app-region box containing the point.
 * @returns one line per disagreeing box, empty when the band is consistent.
 */
function sweep(page: Page): Promise<string[]> {
  return page.evaluate(({ interactive, band, step }) => {
    const boxes: { el: Element, drag: boolean, rect: DOMRect }[] = []
    for (const el of document.querySelectorAll('*')) {
      const style = getComputedStyle(el)
      const value = style.getPropertyValue('-webkit-app-region')
      if (value !== 'drag' && value !== 'no-drag') continue
      if (style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.top < band) boxes.push({ el, drag: value === 'drag', rect })
    }
    const name = (el: Element) => el.tagName.toLowerCase()
      + (typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '')
      + [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `[${a.name}]`).join('')
    const isControl = (el: Element | null) => {
      for (let node = el; node !== null; node = node.parentElement) {
        if (node.matches(interactive)) return true
        const cursor = getComputedStyle(node).cursor
        if (cursor === 'pointer' || cursor.endsWith('-resize')) return true
      }
      return false
    }
    // A control's border ring (a pill outline, a divider) may stay a hole: the
    // gate is about blank titlebar, so no-drag within SLOP of a control is fine.
    const SLOP = 2
    const controls = [...document.querySelectorAll(interactive)].map(el => el.getBoundingClientRect())
      .filter(rect => rect.width > 0 && rect.height > 0 && rect.top < band)
    const nearControl = (x: number, y: number) => controls.some(rect => x >= rect.left - SLOP
      && x < rect.right + SLOP && y >= rect.top - SLOP && y < rect.bottom + SLOP)
    const found = new Map<string, { kind: string, points: number, from: number, to: number }>()
    for (let y = 1; y < band; y += step) {
      for (let x = 1; x < innerWidth; x += step) {
        let owner: (typeof boxes)[number] | undefined
        for (const box of boxes) {
          if (x >= box.rect.left && x < box.rect.right && y >= box.rect.top && y < box.rect.bottom) owner = box
        }
        if (owner === undefined) continue
        // A control's own box is a control even at its rounded corners, which hit-test outside it.
        const control = owner.el.matches(interactive) || isControl(document.elementFromPoint(x, y))
        if (owner.drag === !control) continue
        if (!owner.drag && nearControl(x, y)) continue
        const kind = owner.drag ? 'swallowed control' : 'dead no-drag'
        const r = owner.rect
        const key = `${kind}: ${name(owner.el)} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
        const entry = found.get(key) ?? { kind, points: 0, from: x, to: x }
        entry.points += 1
        entry.from = Math.min(entry.from, x)
        entry.to = Math.max(entry.to, x)
        found.set(key, entry)
      }
    }
    return [...found].map(([key, entry]) => `${key} (${entry.points} points, x ${entry.from}..${entry.to})`)
  }, { interactive: INTERACTIVE_SELECTOR, band: BAND, step: STEP })
}

describe('desktop fork: caption band drags everywhere except over controls', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let agent: Agent | undefined
  let jobId: JobId | undefined

  /** Park the pointer over the transcript and let hover chrome and close motion settle. */
  async function settle(): Promise<void> {
    await page.mouse.move(700, 600)
    await page.waitForTimeout(400)
  }

  async function expectConsistent(state: string): Promise<void> {
    await settle()
    expect(await sweep(page), state).toEqual([])
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1430, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    tripwire = watchConsole(page)
    // The real Git controls mount from a desktop IPC fixture, as in desktop-chrome.
    await page.addInitScript(() => {
      const status = {
        refName: 'main', isRepo: true, isDefaultRef: true,
        hasWorkingTreeChanges: true, hasUpstream: true, hasPrimaryRemote: true,
        aheadCount: 0, behindCount: 0,
        workingTree: { files: [], insertions: 1, deletions: 0 }, pr: null,
      }
      const holder = window as Window & { shell?: Record<string, unknown> }
      holder.shell = {
        ...(holder.shell && typeof holder.shell === 'object' ? holder.shell : {}),
        gitStatus: async () => status,
        gitFetchForStatus: async () => status,
        gitReadPullRequest: async () => ({ ok: true, pr: null }),
        gitBranchList: async () => ({
          ok: true,
          branches: [{ name: 'main', isRemote: false, isCurrent: true, isDefault: true }],
        }),
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[data-dshd-caption="band"]', { timeout: 30_000 })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    try {
      await writeFile(join(scaffold.workspaceCwd, RELEASE), '')
      if (jobId !== undefined && agent !== undefined) await scaffold.ctx.jobs.wait(jobId, 15_000, agent.id)
    } catch (error) { failures.push(error) }
    try { await browser?.close() } catch (error) { failures.push(error) }
    try { await scaffold?.close() } catch (error) { failures.push(error) }
    if (failures.length > 0) throw new AggregateError(failures, 'caption drag teardown failed')
  })

  it('keeps the band consistent before a Session opens', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-fork-caption-drag-blank'))
    await expectConsistent('blank window')
  })

  it('keeps the band consistent through a Session with a running background job', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-fork-caption-drag-session'))
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Check the caption band.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({
        role: 'assistant', content: [{ type: 'text', text: 'Caption band ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Caption band ready.').waitFor({ timeout: 10_000 })
    const started = await scaffold.ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('caption-drag-dead-zones-e2e'),
      name: 'bash',
      arguments: { command: COMMAND, description: 'Hold one background job', run_in_background: true },
      agent,
    })
    const matched = /\bbash-[0-9a-f]{16}\b/.exec(started.content.map(block => block.type === 'text' ? block.text : '').join(''))
    if (matched === null) throw new Error('background bash reported no job id')
    jobId = JobId(matched[0])
    const jobs = page.getByRole('button', { name: /^1 background job/ })
    await jobs.waitFor({ timeout: 15_000 })
    await expectConsistent('session header with a running job')

    await jobs.click()
    await page.getByRole('list', { name: 'Background jobs' }).waitFor()
    await page.keyboard.press('Escape')
    await expectConsistent('after the jobs menu closed')

    await page.getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem').first().waitFor()
    await page.keyboard.press('Escape')
    await expectConsistent('after the Session menu closed')

    const sidebarToggle = page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first()
    await sidebarToggle.click()
    await expectConsistent('sidebar collapsed')
    await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click()
    await expectConsistent('sidebar expanded again')

    const rightToggle = page.locator('[data-panel-layout-controls] button').last()
    await rightToggle.click()
    await expectConsistent('right panel open')
    await rightToggle.click()
    await expectConsistent('right panel closed again')

    expect(tripwire.pageErrors).toEqual([])
  })
})
