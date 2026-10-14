/** Account and Session menus share material and keep macOS backings aligned and scoped. */
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Locator, type Page } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace } from './support.ts'

const expected = fileURLToPath(new URL('./expected/menu-material', import.meta.url))
const seed = new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url)

async function material(menu: Locator) {
  return menu.evaluate((node) => {
    const style = getComputedStyle(node)
    const background = getComputedStyle(node.querySelector(':scope > [aria-hidden="true"]')!)
    return { fill: background.backgroundColor, blur: background.backdropFilter, radius: style.borderRadius, shadow: style.boxShadow }
  })
}

it('shares menu transparency and blur across palettes and follows native menu bounds', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
  const sessionId = await seedSession(scaffold, await readFile(seed, 'utf8'), 'menu-material-session')
  await workspace.attachSession(sessionId)
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } })
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const account = page.getByRole('button', { name: 'Account menu', exact: true })
  await account.waitFor()

  const results: Record<string, Awaited<ReturnType<typeof material>>> = {}
  const masks: Record<string, { fill: string; blur: string }> = {}
  for (const platform of ['web', 'darwin']) {
    for (const dark of [false, true]) {
      await page.evaluate(({ platform, dark }) => {
        if (platform === 'darwin') document.documentElement.dataset.platform = platform
        else delete document.documentElement.dataset.platform
        document.body.toggleAttribute('data-ds-dark-theme', dark)
      }, { platform, dark })
      const overlayFill = await page.evaluate(() => {
        const overlay = document.createElement('div')
        overlay.style.background = 'var(--dsw-specific-menu)'
        document.body.appendChild(overlay)
        try { return getComputedStyle(overlay).backgroundColor } finally { overlay.remove() }
      })
      expect(overlayFill).toBe(platform === 'darwin'
        ? dark ? 'rgba(48, 49, 54, 0.94)' : 'rgba(248, 249, 250, 0.94)'
        : dark ? 'rgba(67, 69, 74, 0.45)' : 'rgba(248, 249, 250, 0.58)')
      await account.click()
      const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Settings', exact: true }) })
      await menu.waitFor()
      const appearance = await material(menu)
      expect(appearance).toMatchObject({
        fill: dark ? 'rgba(67, 69, 74, 0.45)' : 'rgba(248, 249, 250, 0.58)',
        blur: 'blur(40px) saturate(1.5)',
      })
      expect(appearance.shadow).toContain(`${dark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.04)'} 0px 0px 0px 0.5px`)
      results[`${platform}-${dark ? 'dark' : 'light'}`] = appearance
      const backing = page.locator('[data-menu-backing]')
      if (platform === 'darwin') {
        await backing.waitFor({ state: 'visible' })
        for (const height of [950, 1000]) {
          await page.setViewportSize({ width: 1440, height })
          await expect.poll(async () => {
            const card = await menu.boundingBox()
            const base = await backing.boundingBox()
            return card !== null && base !== null
              && Math.abs(card.x - base.x) < 1 && Math.abs(card.y - base.y) < 1
              && Math.abs(card.width - base.width) < 1 && Math.abs(card.height - base.height) < 1
          }).toBe(true)
        }
        expect(await backing.evaluate(node => getComputedStyle(node).pointerEvents)).toBe('none')
      } else {
        expect(await backing.isVisible()).toBe(false)
      }
      await page.keyboard.press('Escape')
      await expect.poll(() => backing.count()).toBe(0)
      await account.click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
      await settings.waitFor()
      const mask = await settings.locator('..').locator(':scope > [aria-hidden="true"]').evaluate((node) => {
        const style = getComputedStyle(node)
        return { fill: style.backgroundColor, blur: style.backdropFilter }
      })
      expect(mask).toEqual({ fill: dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.24)', blur: 'none' })
      masks[`${platform}-${dark ? 'dark' : 'light'}`] = mask
      await page.keyboard.press('Escape')
      await settings.waitFor({ state: 'hidden' })
    }
  }
  await compareOrRefreshGolden(join(expected, 'materials.expected.json'), JSON.stringify(results, null, 2), webSnapshotMode())
  await compareOrRefreshGolden(join(expected, 'modal-masks.expected.json'), JSON.stringify(masks, null, 2), webSnapshotMode())

  const group = page.locator(`[data-row-key="workspace:${workspace.id}"]`)
  await group.waitFor()
  if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
  const action = page.locator('button[aria-label^="Session actions for "]').first()
  await action.locator('xpath=ancestor::*[@role="treeitem"][1]').hover()
  await action.click()
  const sessionMenu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Rename', exact: true }) })
  await sessionMenu.waitFor()
  expect(await material(sessionMenu)).toEqual(results['darwin-dark'])
  await compareOrRefreshGolden(join(expected, 'session-menu.expected.md'),
    await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd), webSnapshotMode())
  await page.keyboard.press('Escape')
  await expect.poll(() => page.locator('[data-menu-backing]').count()).toBe(0)
})

it('keeps Account and composer permission glass stable through the visible entrance', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'dshDesktop', { value: { protocolVersion: 1 } })
  })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const shots = fileURLToPath(new URL('../../../../../.tmp/popup-glass-raster', import.meta.url))
  await mkdir(shots, { recursive: true })

  await page.evaluate(() => {
    // A detailed bitmap on the shipped wallpaper layer makes lost backdrop
    // sampling visible. It leaves the real controls, menus and material intact.
    document.getElementById('dsh-wallpaper')?.remove()
    document.documentElement.removeAttribute('data-dsh-gradient')
    document.documentElement.setAttribute('data-dsh-wallpaper', '')
    document.body.setAttribute('data-ds-dark-theme', '')
    const layer = document.createElement('div')
    layer.id = 'dsh-wallpaper'
    const image = document.createElement('canvas')
    image.id = 'dsh-wallpaper-inner'
    image.width = innerWidth + 96
    image.height = innerHeight + 96
    const context = image.getContext('2d')!
    const colors = ['#f8d684', '#123f67', '#df6683', '#143f31']
    for (let y = 0; y < image.height; y += 12) {
      for (let x = 0; x < image.width; x += 12) {
        context.fillStyle = colors[(x / 12 + y / 12) % colors.length]!
        context.fillRect(x, y, 12, 12)
      }
    }
    layer.appendChild(image)
    document.body.prepend(layer)
    // Stretch the existing native transitions so browser/tool latency cannot
    // race their end. Capture the same near-end progress in both recipes.
    document.body.style.setProperty('--ds-motion-duration-popover', '60s')
  })

  async function assertStableEntrance(menu: Locator, name: string): Promise<void> {
    await menu.waitFor()
    await expect.poll(() => menu.getAttribute('data-state')).toBe('open')
    await menu.evaluate((node) => {
      const transitions = node.getAnimations().filter(animation => animation instanceof CSSTransition)
      if (transitions.length === 0) throw new Error('The genuine menu entrance did not start a CSS transition')
      for (const animation of transitions) {
        animation.pause()
        animation.currentTime = Number(animation.effect!.getComputedTiming().endTime) * 0.95
      }
    })
    const bounds = await menu.boundingBox()
    if (bounds === null) throw new Error('The entrance menu has no painted bounds')
    const entering = await page.screenshot({ path: join(shots, `${name}-entering.png`), animations: 'allow' })
    await menu.evaluate((node) => {
      for (const animation of node.getAnimations()) animation.finish()
    })
    const settled = await page.screenshot({ path: join(shots, `${name}-settled.png`), animations: 'allow' })
    const meanChange = await rasterChange(page, entering.toString('base64'), settled.toString('base64'), bounds)
    expect(meanChange, `${name}: menu material changes as entrance finishes; see ${shots}`).toBeLessThan(2)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
  }

  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await assertStableEntrance(page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Settings', exact: true }) }), 'account')
  await page.getByRole('button', { name: /^Access mode, current:/ }).click()
  await assertStableEntrance(page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Read Only', exact: true }) }), 'permission')

  async function captureOpenedSurface(surface: Locator, name: string): Promise<void> {
    await surface.waitFor()
    await expect.poll(() => surface.getAttribute('data-state')).toBe('open')
    await surface.evaluate((node) => {
      for (const animation of node.getAnimations()) animation.finish()
    })
    await page.screenshot({ path: join(shots, `${name}.png`), animations: 'allow' })
    await page.keyboard.press('Escape')
    await surface.waitFor({ state: 'hidden' })
  }
  await page.getByRole('button', { name: /^Select model(?:,|$)/ }).click()
  await captureOpenedSurface(page.getByRole('menu', { name: 'Model and reasoning effort', exact: true }), 'model')
  await page.getByRole('button', { name: 'Add files or run commands', exact: true }).click()
  await captureOpenedSurface(page.locator('[data-trigger-menu]'), 'commands')
  await page.setViewportSize({ width: 820, height: 720 })
  await page.getByRole('button', { name: /^Access mode, current:/ }).click()
  await captureOpenedSurface(page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Read Only', exact: true }) }), 'permission-narrow')
})

/** Compare painted interior pixels, excluding the card's rounded edges and shadow. */
async function rasterChange(page: Page, entering: string, settled: string, bounds: { x: number; y: number; width: number; height: number }): Promise<number> {
  return page.evaluate(async ({ entering, settled, bounds }) => {
    const pixels = async (png: string): Promise<Uint8ClampedArray> => {
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      return context.getImageData(Math.ceil(bounds.x + 8), Math.ceil(bounds.y + 8), Math.floor(bounds.width - 16), Math.floor(bounds.height - 16)).data
    }
    const [before, after] = await Promise.all([pixels(entering), pixels(settled)])
    let change = 0
    for (let index = 0; index < before.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) change += Math.abs(before[index + channel]! - after[index + channel]!)
    }
    return change / (before.length / 4 * 3)
  }, { entering, settled, bounds })
}
