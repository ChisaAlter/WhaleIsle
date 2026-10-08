// Real-browser regression for the conversation header when the DSHD right-panel
// column takes space from a still-wide desktop conversation column.
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

const TEAM_OVERLAY = fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url))
const TEAM_ANCHOR = fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url))

describe('web e2e: right-panel titlebar fit', () => {
  let scaffold: WebScaffold
  let browser: Awaited<ReturnType<typeof chromium.launch>>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: TEAM_OVERLAY, extraInstallAnchors: [TEAM_ANCHOR] })
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps Agent actions, the opener, and trailing controls from overlapping', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, locale: 'en-US' })
    await page.addInitScript(() => {
      Object.assign(window, { shell: { listDir: async () => ({ ok: true, entries: [] }) } })
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (!agent) throw new Error('workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Check the titlebar fit.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({
        role: 'assistant', content: [{ type: 'text', text: 'Ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Ready.').waitFor({ timeout: 10_000 })

    const row = page.locator('[data-dshd-caption="title"]')
    const actions = row.locator('[class*="headerActions"]')
    const utilities = row.locator('[class*="headerUtilities"]')
    const trailing = page.locator('[data-titlebar-trailing]')
    const toggle = trailing.getByRole('button', { name: 'Toggle right panel' })
    if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click()
    await expect.poll(() => page.locator('[data-titlebar-density]').first()
      .getAttribute('data-rightbar-collapsed')).toBe('true')
    // The browser scaffold has no desktop application catalog. Give the real
    // utilities seat the 56px compact split (13px icon, 18px padding, 24px
    // chevron, and border), while keeping
    // the real header actions, AppFrame reserve, and trailing controls.
    await utilities.evaluate(element => {
      const opener = document.createElement('button')
      opener.type = 'button'
      opener.setAttribute('aria-label', 'Open workspace fixture')
      opener.style.cssText = 'display:block;flex:none;width:56px;height:27px;padding:0;border:0'
      element.append(opener)
    })
    await expect.poll(() => actions.isVisible()).toBe(true)
    await expect.poll(() => utilities.isVisible()).toBe(true)
    for (const sidebar of ['expanded', 'collapsed']) {
      if (sidebar === 'collapsed') {
        await page.getByRole('button', { name: 'Collapse sidebar' }).click()
        await expect.poll(() => page.locator('[data-titlebar-density]').first()
          .getAttribute('data-sidebar-collapsed')).toBe('true')
      }
      for (let cycle = 0; cycle < 3; cycle += 1) {
        await toggle.click()
        await expect.poll(() => page.locator('[data-titlebar-density]').first()
          .getAttribute('data-rightbar-collapsed')).toBeNull()
        expect(await utilities.locator('button[aria-label="Open workspace fixture"]').count()).toBe(1)
        await expect.poll(() => actions.isVisible()).toBe(true)
        await expect.poll(async () => {
          const utilityBox = await utilities.boundingBox()
          const trailingBox = await trailing.boundingBox()
          const actionBox = await actions.boundingBox()
          if (!utilityBox || !trailingBox || !actionBox) return false
          return utilityBox.x - (actionBox.x + actionBox.width) >= 8
            && trailingBox.x - (utilityBox.x + utilityBox.width) >= 8
        }, { timeout: 10_000 }).toBe(true)
        await toggle.click()
        await expect.poll(() => page.locator('[data-titlebar-density]').first()
          .getAttribute('data-rightbar-collapsed')).toBe('true')
        await expect.poll(() => actions.isVisible()).toBe(true)
      }
    }
    await page.close()
  }, 120_000)
})
