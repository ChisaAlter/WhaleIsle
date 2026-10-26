/** Claude's decorative portraits follow the resolved skin without changing the conversation. */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, writeComposerDraft } from './support.ts'

class PausedArtworkAdapter extends LlmAdapter {
  readonly arrived = Promise.withResolvers<void>()
  readonly proceed = Promise.withResolvers<void>()
  override async listModels(provider: string) { return [{ provider, id: 'paused', name: `${provider}/paused` }] }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: 'Reading the question.' }
    this.arrived.resolve()
    await this.proceed.promise
    options.signal?.throwIfAborted()
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Reading the question.' } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text: 'ARTWORK_DONE' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: 'ARTWORK_DONE' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('selects Claude portraits in light and dark, restores defaults, and keeps running media static', async () => {
  const scaffold = await launchWebScaffold({ publicMount: { prefix: '/tools/dsh/' } })
  const adapter = new PausedArtworkAdapter()
  const browser = await chromium.launch()
  try {
    scaffold.ctx.effect(() => scaffold.ctx.llm.registerAdapter(['artwork-test'], adapter))
    await scaffold.ctx.agentDefaultModel.saveSelection({ provider: 'artwork-test', model: 'paused' })
    await scaffold.ctx.settings.update('ui-theme', {
      preference: 'light', activeLightThemeId: 'claude', activeDarkThemeId: 'claude',
    })
    const page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1247, height: 912 })
    const console = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const expectClaude = async () => {
      await expect.poll(() => page.locator('html').getAttribute('data-dsh-skin')).toBe('claude')
      const portrait = page.locator('[data-whale-isle-brand="name"] img[data-dsh-mascot="claude"]')
      await expect.poll(() => portrait.isVisible()).toBe(true)
      expect(await portrait.evaluate(image => new URL((image as HTMLImageElement).src).pathname)).toBe('/tools/dsh/claude-isle-head.png')
      expect(await portrait.evaluate(async image => {
        await (image as HTMLImageElement).decode()
        return (image as HTMLImageElement).naturalWidth
      })).toBe(512)
      expect(await page.locator('[data-whale-isle-brand="name"] img[data-dsh-mascot="default"]').isVisible()).toBe(false)
    }
    await expectClaude()
    expect(await page.locator('[data-dsh-hero-preview]').isVisible()).toBe(false)
    expect(await page.locator('[data-dsh-hero-headline]').innerText()).toBe('What shall we explore today?')
    const evidence = process.env.DSH_ARTWORK_EVIDENCE_DIR
    if (evidence) {
      await mkdir(evidence, { recursive: true })
      await page.screenshot({ path: join(evidence, 'claude-light.png') })
    }
    await scaffold.ctx.settings.update('ui-theme', { preference: 'dark' })
    await expectClaude()
    if (evidence) await page.screenshot({ path: join(evidence, 'claude-dark.png') })
    await page.reload({ waitUntil: 'load' })
    await expectClaude()
    const toggle = page.locator('[data-dsh-sidebar-toggle]')
    await toggle.click()
    await page.mouse.move(1000, 800)
    const rail = page.locator('[data-dsh-sidebar-toggle] img[data-dsh-mascot="claude"]')
    await expect.poll(() => rail.isVisible()).toBe(true)
    await toggle.hover()
    expect(await rail.isVisible()).toBe(false)
    await toggle.click()
    await page.mouse.move(1000, 800)
    await expectClaude()
    await scaffold.ctx.settings.update('ui-theme', { preference: 'light', activeLightThemeId: 'deepseek' })
    await expect.poll(() => page.locator('html').getAttribute('data-dsh-skin')).toBeNull()
    expect(await page.locator('[data-whale-isle-brand="name"] img[data-dsh-mascot="default"]').isVisible()).toBe(true)
    expect(await page.locator('[data-dsh-hero-preview]').isVisible()).toBe(true)
    await scaffold.ctx.settings.update('ui-theme', { activeLightThemeId: 'codex' })
    await expect.poll(() => page.locator('html').getAttribute('data-dsh-skin')).toBe('codex')
    expect(await page.locator('[data-whale-isle-brand="name"] img[data-dsh-mascot="claude"]').isVisible()).toBe(false)
    await scaffold.ctx.settings.update('ui-theme', { activeLightThemeId: 'claude' })
    await expectClaude()
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled()
    await writeComposerDraft(page, input, 'Check the theme artwork.')
    await input.press('Enter')
    await adapter.arrived.promise
    const running = page.locator('[data-chat-running]')
    const reading = running.locator('img[data-dsh-mascot="claude"]')
    await reading.waitFor()
    for (const media of [
      { reducedMotion: 'no-preference', forcedColors: 'none' },
      { reducedMotion: 'reduce', forcedColors: 'none' },
      { reducedMotion: 'no-preference', forcedColors: 'active' },
    ] as const) {
      await page.emulateMedia(media)
      expect(await reading.isVisible()).toBe(true)
      expect(await running.locator('[data-dsh-mascot="default"]').first().isVisible()).toBe(false)
      expect(await reading.evaluate(async image => {
        await (image as HTMLImageElement).decode()
        return [(image as HTMLImageElement).naturalWidth, (image as HTMLImageElement).naturalHeight]
      })).toEqual([256, 256])
      expect(await running.innerText()).toContain('Thinking')
      expect(await reading.evaluate(element => getComputedStyle(element).animationName)).toBe('none')
    }
    await page.emulateMedia({ reducedMotion: null, forcedColors: null })
    if (evidence) await page.screenshot({ path: join(evidence, 'claude-running.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    const backdrop = page.getByRole('button', { name: 'Close sidebar', exact: true })
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: 350, y: 400 }, force: true })
    await expect.poll(() => page.locator('[data-dsh-frame][data-phone-sidebar]').count()).toBe(0)
    const openSidebar = page.getByRole('button', { name: 'Open sidebar', exact: true }).first()
    await openSidebar.waitFor()
    await expect.poll(() => reading.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth
    })).toBe(true)
    await expect.poll(() => running.evaluate(element => {
      const box = element.getBoundingClientRect()
      return box.width > 280 && box.right <= innerWidth
    })).toBe(true)
    expect(await reading.isVisible()).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (evidence) await page.screenshot({ path: join(evidence, 'claude-narrow.png') })
    await scaffold.ctx.settings.update('ui-theme', { activeLightThemeId: 'deepseek' })
    await expect.poll(() => page.locator('html').getAttribute('data-dsh-skin')).toBeNull()
    expect(await reading.isVisible()).toBe(false)
    expect(await running.innerText()).toContain('Deep diving')
    adapter.proceed.resolve()
    await settled
    await page.getByText('ARTWORK_DONE', { exact: true }).waitFor()
    await running.waitFor({ state: 'detached' })
    expect(console.pageErrors).toEqual([])
  } finally {
    adapter.proceed.resolve()
    await browser.close()
    await scaffold.close()
  }
})
