// Desktop fork (composer editor): typing never scrolls a reader-scrolled
// transcript. The composer seat renders inside the conversation scroller but
// below its box, so Lexical's ancestor scroll-into-view used to pull the
// transcript down on every keystroke. The draft's own scrollport still keeps
// the caret visible once the draft outgrows it.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SCROLLER = '[data-conversation-scroll]'
const BODY = 'Event sourcing stores every change as an immutable event. '.repeat(30)

function transcriptTop(page: Page): Promise<number> {
  return page.evaluate(selector => Math.round(document.querySelector(selector)!.scrollTop), SCROLLER)
}

describe('desktop fork: typing keeps the reader position', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1400, height: 900 })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('workspace did not create an Agent')
    for (let turn = 1; turn <= 12; turn++) {
      agent.session.append('turn/start', { turn })
      agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Question ${turn}` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      agent.session.append('step/start', { turn, step: 1 })
      agent.session.append('assistant/message', {
        stream: [], turn, step: 1,
        message: createMessage({
          role: 'assistant', content: [{ type: 'text', text: `Answer ${turn}. ${BODY}` }],
          source: { kind: 'model', provider: 'fixture', model: 'fixture' },
        }),
      }, { surfaceOp: 'append' })
      agent.session.append('step/end', { turn, step: 1 })
      agent.session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Answer 12.').waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('types, grows, and overflows the draft without moving the transcript', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-fork-composer-typing-reading'))
    await page.mouse.move(700, 300)
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -400)
      await page.waitForTimeout(50)
    }
    // Let wheel momentum settle before taking the reader position.
    let reading = -1
    await expect.poll(async () => {
      const top = await transcriptTop(page)
      const settled = top === reading
      reading = top
      return settled
    }, { timeout: 5_000, interval: 300 }).toBe(true)
    const max = await page.evaluate(selector => {
      const el = document.querySelector(selector)!
      return el.scrollHeight - el.clientHeight
    }, SCROLLER)
    expect(reading).toBeLessThan(max - 500)

    await page.locator('[data-composer-input]').first().click()
    await page.keyboard.type('hello')
    await page.waitForTimeout(300)
    expect(await transcriptTop(page), 'one typed line').toBe(reading)

    for (let line = 0; line < 3; line++) {
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type(`line ${line}`)
    }
    await page.waitForTimeout(300)
    expect(await transcriptTop(page), 'draft grew to four lines').toBe(reading)

    for (let line = 0; line < 30; line++) {
      await page.keyboard.press('Shift+Enter')
      await page.keyboard.type(`overflow ${line}`)
    }
    await page.waitForTimeout(300)
    expect(await transcriptTop(page), 'draft outgrew its scrollport').toBe(reading)
    const caret = await page.evaluate(() => {
      const scrollport = document.querySelector('[data-input-scroll]')!
      const box = scrollport.getBoundingClientRect()
      const range = getSelection()!.getRangeAt(0).getBoundingClientRect()
      return { inside: range.top >= box.top - 1 && range.bottom <= box.bottom + 1, scrolled: scrollport.scrollTop > 0 }
    })
    expect(caret, 'caret stays visible in the draft scrollport').toEqual({ inside: true, scrolled: true })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
