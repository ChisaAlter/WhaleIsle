// Real-profile first-send geometry, including the frames before Host admission.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import {
  compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/composer-draft-transition/geometry.expected.md', import.meta.url))
const CASES = [
  { name: 'desktop-click', width: 1680, height: 1000, reduced: false, enter: false, lines: 1 },
  { name: 'desktop-narrow', width: 960, height: 640, reduced: false, enter: true, lines: 1 },
  { name: 'desktop-reduced', width: 1680, height: 1000, reduced: true, enter: true, lines: 1 },
  { name: 'mobile-enter', width: 390, height: 844, reduced: false, enter: true, lines: 1 },
  { name: 'desktop-multiline', width: 1680, height: 1000, reduced: false, enter: true, lines: 5 },
] as const

describe('web e2e: draft composer transition', () => {
  it.skipIf(MODE === 'record').each(CASES)('$name: keeps first-send geometry continuous', async (scenario) => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-draft-transition-'))
    const replayOverride = join(dir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(['TRANSITION-REPLY', 'SECOND-REPLY'].map(text => ({ kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] }))))
    const scaffold = await launchWebScaffold({
      replayFixture: join(dir, 'override-only.jsonl'), replayOverride,
    })
    const browser = await chromium.launch(process.env.DSH_WEB_HEADED === '1'
      ? { headless: false, channel: 'msedge' }
      : process.env.DSH_TEST_CHROMIUM_PATH === undefined
        ? {}
        : { executablePath: process.env.DSH_TEST_CHROMIUM_PATH })
    const page = await newEnglishPage(browser)
    let failed = false
    try {
      await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      const prompt = scaffold.ctx.sessionController.prompt.bind(scaffold.ctx.sessionController)
      vi.spyOn(scaffold.ctx.sessionController, 'prompt').mockImplementation(async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return prompt(...args)
      })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]')
        .waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /Select model/ }).click()
      await page.getByRole('menuitem').filter({ hasText: 'Model' }).click()
      await page.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash', exact: true }).click()
      await page.setViewportSize({ width: scenario.width, height: scenario.height })
      await page.emulateMedia({ reducedMotion: scenario.reduced ? 'reduce' : 'no-preference' })
      const composer = page.locator('[data-composer-input]')
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]')
        .waitFor({ timeout: 30_000 })
      await composer.fill(Array.from({ length: scenario.lines }, () => 'Respond with TRANSITION-REPLY.').join('\n'))
      // Await the sidebar track and the final draft size before sampling.
      await composer.evaluate(async (input) => {
        let previous = input.getBoundingClientRect().top
        let stable = 0
        while (stable < 6) {
          await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
          const top = input.getBoundingClientRect().top
          stable = Math.abs(top - previous) < 0.01 ? stable + 1 : 0
          previous = top
        }
      })
      const capture = page.evaluate(async () => {
        const card = document.querySelector<HTMLElement>('[data-composer-card]')!
        const input = document.querySelector<HTMLElement>('[data-composer-input]')!
        const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
        // The entering marker outlives the load-throttled rAF cadence here; a
        // mutation observer catches it even when no mid-glide frame is sampled.
        let sawEntering = false
        let sawCompositedMotion = false
        const marker = new MutationObserver(() => {
          if (card.closest('[data-composer-entering]') !== null) sawEntering = true
        })
        marker.observe(document.body, {
          attributes: true, attributeFilter: ['data-composer-entering'], subtree: true,
        })
        const measure = () => {
          const rect = card.getBoundingClientRect()
          const entering = card.closest<HTMLElement>('[data-composer-entering]')
          const effect = entering?.getAnimations()[0]?.effect
          if (effect instanceof KeyframeEffect) {
            const keyframes = effect.getKeyframes()
            sawCompositedMotion ||= keyframes.some(frame => typeof frame.transform === 'string')
              && keyframes.every(frame => !Object.hasOwn(frame, 'top'))
          }
          return {
            top: rect.top, bottom: rect.bottom, height: rect.height,
            phase: card.closest('[data-phase]')?.getAttribute('data-phase'),
            sameInput: document.querySelector('[data-composer-input]') === input,
            scrollTop: host.scrollTop,
            entering: entering !== null,
            time: performance.now(),
          }
        }
        const samples = [measure()]
        const t0 = performance.now()
        for (let frame = 0; frame < 240 && performance.now() - t0 < 5000; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
          samples.push(measure())
        }
        marker.disconnect()
        return { samples, sawEntering, sawCompositedMotion }
      })
      if (scenario.enter) await composer.press('Enter')
      else await page.getByRole('button', { name: 'Send message', exact: true }).click()
      const { samples: frames, sawEntering, sawCompositedMotion } = await capture
      await writeFile(join(dir, 'frames.json'), JSON.stringify(frames, null, 2))
      await page.screenshot({ path: join(dir, 'settled.png') })
      console.log('Composer transition evidence:', JSON.stringify({ scenario: scenario.name, directory: dir }))
      const last = frames.at(-1)!
      await page.getByText('TRANSITION-REPLY', { exact: true }).waitFor({ timeout: 20_000 })
      expect(frames.every(frame => frame.sameInput)).toBe(true)
      expect(last.phase).toBe('active')
      expect(last.top - frames[0]!.top).toBeGreaterThan(20)
      // Resize-driven settle noise can lag one sampled frame before the hold
      // pins it back; real rebounds are an order of magnitude larger.
      expect(Math.max(...frames.map(frame => frame.top)) - last.top).toBeLessThanOrEqual(8)
      expect(Math.max(...frames.slice(1).map((frame, index) =>
        frames[index]!.top - frame.top))).toBeLessThanOrEqual(8)
      const intermediate = frames.some(frame => frame.phase === 'active'
        && frame.top > frames[0]!.top + 1 && frame.top < last.top - 8)
      expect(scenario.reduced ? !intermediate : sawEntering).toBe(true)
      if (!scenario.reduced) expect(sawCompositedMotion).toBe(true)
      expect(last.bottom).toBeLessThanOrEqual(scenario.height)
      expect(last.entering).toBe(false)
      expect(await page.locator('[data-composer-card]').evaluate(card =>
        getComputedStyle(card.parentElement!).transform)).toBe('none')
      const footerGeometry = () => page.evaluate(() => {
        const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
        const seat = document.querySelector<HTMLElement>('[data-composer-seat]')!
        const scrollBox = scroll.getBoundingClientRect()
        const seatBox = seat.getBoundingClientRect()
        return { scrollBottom: scrollBox.bottom, scrollHeight: scrollBox.height,
          seatTop: seatBox.top, seatHeight: seatBox.height, seatBottom: seatBox.bottom }
      })
      const assertFooterBoundary = async () => {
        await expect.poll(async () => {
          const geometry = await footerGeometry()
          return Math.abs(geometry.scrollBottom - geometry.seatTop)
        }).toBeLessThanOrEqual(2)
        const geometry = await footerGeometry()
        expect(geometry.scrollHeight).toBeGreaterThan(0)
        expect(geometry.seatHeight).toBeGreaterThan(0)
        expect(geometry.seatBottom).toBeLessThanOrEqual(scenario.height)
      }
      await assertFooterBoundary()
      await composer.fill('Respond with SECOND-REPLY.')
      await composer.press('Enter')
      await page.getByText('SECOND-REPLY', { exact: true }).waitFor({ timeout: 20_000 })
      expect(await page.locator('[data-composer-entering]').count()).toBe(0)
      const secondTop = await page.locator('[data-composer-card]').evaluate(card => card.getBoundingClientRect().top)
      expect(secondTop).toBe(last.top)
      await composer.fill(Array.from({ length: 8 }, (_, index) => `Unsent draft line ${index + 1}`).join('\n'))
      await assertFooterBoundary()
      await compareOrRefreshGolden(EXPECTED, [
        '# First draft submission geometry', '',
        '- Editor DOM is retained: true',
        '- Card overshoots its settled position: false',
        '- Normal motion includes intermediate positions: true',
        '- Reduced motion settles without intermediate positions: true',
        '- Subsequent sends retain the dock position: true',
        '- Card stays inside the viewport: true',
      ].join('\n'), MODE)
      expect(tripwire.pageErrors).toEqual([])
    } catch (error) {
      failed = true
      await saveFailureShot(page, 'web-e2e-draft-transition')
      throw error
    } finally {
      await browser.close()
      try { await scaffold.close() } catch (error) { if (!failed) throw error }
    }
  }, 120_000)
})
