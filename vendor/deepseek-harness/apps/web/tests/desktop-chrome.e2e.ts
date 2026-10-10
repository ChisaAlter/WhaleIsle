// Web e2e: assembled desktop chrome on the shipped web composition —
// titlebar trailing cluster (Git, terminal + surfaces toggles), Session menu,
// and the right-panel guide. Zero model calls: a connected
// workspace supplies one settled turn so the Session menu mounts. A desktop
// IPC fixture supplies a clean main branch so the real Git controls and menu
// mount. A stray stream fails loud on the open llm seam.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-chrome', import.meta.url))
const TITLEBAR_EXPECTED = join(SNAPSHOT_DIR, 'titlebar.expected.md')
const GUIDE_EXPECTED = join(SNAPSHOT_DIR, 'sidebar-guide.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: titlebar cluster and right sidebar guide', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.addInitScript(() => {
      const status = {
        refName: 'main', isRepo: true, isDefaultRef: true,
        hasWorkingTreeChanges: false, hasUpstream: true, hasPrimaryRemote: true,
        aheadCount: 0, behindCount: 0,
        workingTree: { files: [], insertions: 0, deletions: 0 }, pr: null,
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
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (!agent) throw new Error('workspace did not create an Agent')
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Check desktop chrome.' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      stream: [], turn: 1, step: 1,
      message: createMessage({
        role: 'assistant', content: [{ type: 'text', text: 'Desktop chrome ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Desktop chrome ready.').waitFor({ timeout: 10_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps logs in the Session menu and Git with two panel toggles at the frame edge', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-titlebar'))
    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    await cluster.waitFor({ timeout: 15_000 })
    const sessionLog = cluster.getByRole('button', { name: /session log/i })
    const branch = cluster.getByRole('button', { name: 'Switch branch' })
    const git = cluster.getByRole('button', { name: 'Commit' })
    const gitMenu = cluster.getByRole('button', { name: 'Git actions' })
    const terminal = cluster.getByRole('button', { name: 'Toggle terminal drawer' })
    const surfaces = cluster.getByRole('button', { name: 'Toggle right panel' })
    expect(await sessionLog.count()).toBe(0)
    const more = page.getByRole('button', { name: 'More actions', exact: true })
    await more.click()
    const download = page.getByRole('menuitem', { name: 'Download session log', exact: true })
    await download.waitFor({ state: 'visible', timeout: 5_000 })
    expect(await download.isEnabled()).toBe(true)
    await page.keyboard.press('Escape')
    await branch.waitFor({ state: 'visible', timeout: 5_000 })
    expect(await branch.isVisible()).toBe(true)
    expect(await git.isVisible()).toBe(true)
    expect(await gitMenu.isVisible()).toBe(true)
    expect(await terminal.isVisible()).toBe(true)
    expect(await surfaces.isVisible()).toBe(true)
    const boxes = await Promise.all([
      branch.boundingBox(),
      git.boundingBox(),
      terminal.boundingBox(),
      surfaces.boundingBox(),
    ])
    for (const box of boxes) expect(box).not.toBeNull()
    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1]!
      const current = boxes[index]!
      expect(current.x + 1).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
    const snapshot = await captureStableAria(page, '#dshd-shell-titlebar-trailing', scaffold.workspaceCwd)
    await compareOrRefreshGolden(TITLEBAR_EXPECTED, snapshot, MODE)
    expect(snapshot).not.toMatch(/session log/i)
    expect(snapshot).toContain('Switch branch')
    expect(snapshot).toContain('Commit')
    expect(snapshot).toContain('Git actions')
    expect(snapshot).toContain('Toggle terminal drawer')
    expect(snapshot).toContain('Toggle right panel')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('keeps disabled Commit legible in light and dark titlebars', async () => {
    const git = page.getByRole('button', { name: 'Commit', exact: true })
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme'))
          .toBe(colorScheme === 'dark' ? '' : null)
        expect(await git.isDisabled()).toBe(true)
        const pixels = await git.screenshot()
        const contrast = await git.evaluate(async (button, png) => {
          const image = new Image()
          image.src = `data:image/png;base64,${png}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          // This inset is inside the button's empty padding, away from its icon/text.
          const backdrop = context.getImageData(3, 3, 1, 1).data
          context.fillStyle = getComputedStyle(button).color
          context.fillRect(0, 0, 1, 1)
          const foreground = context.getImageData(0, 0, 1, 1).data
          const luminance = (color: Uint8ClampedArray) => {
            const channels = [...color].slice(0, 3).map((n) => {
              const c = n / 255
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            })
            return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
          }
          const a = luminance(foreground)
          const b = luminance(backdrop)
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }, pixels.toString('base64'))
        // Muted controls still need to remain recognizable on the titlebar.
        expect(contrast, `${colorScheme} disabled Commit contrast`).toBeGreaterThanOrEqual(3)
        expect(await page.getByRole('button', { name: 'Git actions', exact: true }).isEnabled()).toBe(true)
      }
    } finally {
      await page.emulateMedia({ colorScheme: null })
    }
  })

  it('publishes complete platform UI exports to runtime-loaded plugins', async () => {
    const exportTypes = await page.evaluate(async () => {
      const modules = (window as Window & {
        __DSH_MODULES__?: {
          import: (specifier: string, parentURL: string, attrs: Record<string, never>) => Promise<unknown>
        }
      }).__DSH_MODULES__
      if (modules === undefined) throw new Error('client module system missing')
      const primitives = await modules.import(
        '@deepseek-ai/dsh-client-ui-primitives',
        '',
        {},
      ) as Record<string, unknown>
      return {
        cloudUpload: typeof primitives.IconCloudUploadOutline16,
        commit: typeof primitives.IconCommitOutline16,
        pullRequest: typeof primitives.IconPullRequestOutline16,
      }
    })
    expect(exportTypes).toEqual({
      cloudUpload: 'function',
      commit: 'function',
      pullRequest: 'function',
    })
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens the right panel on the shipped guide', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-surfaces'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    await expect.poll(() => surfaces.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true')
    const guide = page.locator('[data-sidebar-right-guide]')
    await guide.waitFor({ state: 'visible', timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[data-sidebar-right-guide]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(GUIDE_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('heading "Open a panel"')
    expect(snapshot).toContain('New terminal')
    expect(snapshot).toContain('Files')
    expect(snapshot).toContain('Workspace diff')
    expect(snapshot).toContain('Agents and jobs')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens Files from the guide and keeps the add-tab control', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-files-tabs'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    if (!await page.locator('[data-sidebar-right-guide]').isVisible()) {
      await page.locator('[data-dockkit-add-tab]').click()
    }
    await page.locator('[data-sidebar-right-guide-entry="files"]').click()
    const tab = page.locator('[data-dockkit-tab]').filter({ hasText: 'Files' })
    await tab.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await tab.getAttribute('aria-selected')).toBe('true')
    expect(await page.locator('[data-dockkit-add-tab]').isVisible()).toBe(true)
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('keeps trailing controls apart and opens the branch menu while surfaces is open', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-surfaces-titlebar'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    await expect.poll(() => surfaces.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true')
    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    const branch = cluster.getByRole('button', { name: 'Switch branch' })
    const git = cluster.getByRole('button', { name: 'Commit' })
    const boxes = await Promise.all([
      branch.boundingBox(),
      git.boundingBox(),
    ])
    for (const box of boxes) expect(box).not.toBeNull()
    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1]!
      const current = boxes[index]!
      expect(current.x + 1).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
    await branch.click()
    await expect.poll(() => branch.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    await page.getByRole('menuitem', { name: 'main', exact: true }).waitFor({ state: 'visible', timeout: 5_000 })
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('commits exactly the fixtures it reads', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['titlebar.expected.md', 'sidebar-guide.expected.md'])
  })
})
