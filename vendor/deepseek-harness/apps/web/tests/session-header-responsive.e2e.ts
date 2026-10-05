// Real assembled header, host projections and browser hit testing; no model calls.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspaceZh } from './support.ts'

describe('session header responsive actions', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let settle: (outcome: JobOutcome) => void
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./agent-team-panel.overlay.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/experimental/agent-team-profile/package.json', import.meta.url))],
    })
    browser = await chromium.launch(process.env.DSH_WEB_HEADED === '1'
      ? { headless: false, channel: 'msedge' }
      : {})
    page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl)
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]!
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Header layout fixture' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' } }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    agent.session.append('session/title', { title: '创建智能体并检查较长的会话标题', messageSeqs: [], source: { kind: 'user' } })
    for (const child of ['one', 'two']) agent.session.append('subagent/catalog', {
      version: 0, childId: SessionId(`header-${child}`), childCreatedAt: Date.now(), mode: 'one-shot', label: child,
    })
    scaffold.ctx.jobs.start({
      kind: 'bash', owner: agent.id, label: 'Header background job',
      run: () => ({ done: new Promise<JobOutcome>(resolve => { settle = resolve }),
        cancel: () => { settle({ status: 'killed' }) } }),
    })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByRole('button', { name: '2 个子智能体', exact: true }).waitFor()
    await page.getByRole('button', { name: '1 个后台任务运行中', exact: true }).waitFor()
  }, 120_000)

  afterAll(async () => {
    settle?.({ status: 'completed' })
    await browser?.close()
    await scaffold?.close()
  })

  it('truncates labels, preserves icon hit areas and opens every action at narrow widths', async () => {
    const row = page.locator('[data-dshd-caption="title"]')
    let sawEllipsis = false
    let sawIcons = false
    for (const width of [1440, 1280, 1100, 900, 760, 600]) {
      await page.setViewportSize({ width, height: 900 })
      // Wait for the actual row width and its density to settle after sidebar transitions.
      await row.evaluate(async element => {
        let last = 0
        let stable = 0
        for (let frame = 0; frame < 120; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          const width = element.getBoundingClientRect().width
          stable = Math.abs(width - last) < 0.01 ? stable + 1 : 0
          last = width
          if (stable >= 8) return
        }
        throw new Error('Header did not settle')
      })
      const metrics = await row.evaluate(element => {
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('[class*="headerActions"] button')]
        const box = element.getBoundingClientRect()
        return buttons.map(button => {
          const rect = button.getBoundingClientRect()
          const label = button.querySelector<HTMLElement>('[class*="count"], [class*="triggerLabel"]')!
          const style = getComputedStyle(label)
          return {
            name: button.getAttribute('aria-label'), height: rect.height, width: rect.width,
            visible: rect.left >= box.left && rect.right <= box.right,
            hit: button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
            iconOnly: style.display === 'none',
            oneLine: style.whiteSpace === 'nowrap' && label.clientHeight <= 18,
            ellipsis: style.textOverflow === 'ellipsis' && label.scrollWidth > label.clientWidth,
          }
        })
      })
      expect(metrics, `viewport ${width}`).toHaveLength(3)
      for (const metric of metrics) {
        expect(metric.visible && metric.hit, `${width}: ${metric.name}`).toBe(true)
        expect(metric.height).toBe(28)
        expect(metric.width).toBeGreaterThanOrEqual(28)
        expect(metric.iconOnly || metric.oneLine).toBe(true)
      }
      const truncated = metrics.some(metric => !metric.iconOnly && metric.ellipsis)
      if (truncated && !sawEllipsis) await page.screenshot({ path: join(tmpdir(), 'whale-isle-header-ellipsis.png') })
      sawEllipsis ||= truncated
      sawIcons ||= metrics.every(metric => metric.iconOnly)
      if (width === 600) {
        expect(metrics.every(metric => metric.iconOnly)).toBe(true)
        await page.screenshot({ path: join(tmpdir(), 'whale-isle-header-compact.png') })
        for (const [name, role, panel] of [
          ['2 个子智能体', 'tree', '子智能体会话'],
          ['智能体团队', 'dialog', '智能体团队'],
          ['1 个后台任务运行中', 'list', '后台任务'],
        ] as const) {
          const button = row.getByRole('button', { name, exact: true })
          await button.click()
          await page.getByRole(role, { name: panel, exact: true }).waitFor()
          await page.keyboard.press('Escape')
          await page.getByRole(role, { name: panel, exact: true }).waitFor({ state: 'detached' })
        }
      }
    }
    expect(sawEllipsis).toBe(true)
    expect(sawIcons).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the same actions clickable when the right sidebar reduces the conversation width', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const toggle = page.getByRole('button', { name: '切换右侧栏', exact: true })
    await toggle.click()
    await page.locator('[data-sidebar-right-open]').waitFor()
    const row = page.locator('[data-dshd-caption="title"]')
    await expect.poll(() => row.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const buttons = [...element.querySelectorAll('[class*="headerActions"] button')]
      return buttons.length === 3 && buttons.every(button => {
        const rect = button.getBoundingClientRect()
        return rect.width >= 28 && rect.height === 28
          && rect.left >= bounds.left && rect.right <= bounds.right
          && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
      })
    })).toBe(true)
    await row.getByRole('button', { name: '智能体团队', exact: true }).click()
    await page.getByRole('dialog', { name: '智能体团队', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await toggle.click()
    expect(tripwire.pageErrors).toEqual([])
  })
})
