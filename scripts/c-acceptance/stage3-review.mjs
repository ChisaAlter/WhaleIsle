// C-acceptance stage 3: open the changes-review tab from the changed-files
// card and collect the C1/D3/D5 evidence on the real desktop composition.
import { chromium } from 'file:///C:/Ai/Deepseek-Harness-Desktop/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const OUT = 'docs/superpowers/evidence/2026-09-25-upstream-adoption/c-phase'
fs.mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }).catch((error) => { console.warn('[scripts/c-acceptance/stage3-review.mjs] background operation failed', error); }) }

const browser = await chromium.connectOverCDP('http://localhost:9333')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1:3080'))
if (!page) throw new Error('web page not found')
page.setDefaultTimeout(10_000)
const evidence = { steps: [] }

// 1. Open the review tab via the card's file row.
const cardBtn = page.getByLabel('查看 c1-probe.ts 的改动')
await cardBtn.waitFor({ state: 'visible', timeout: 15_000 })
await cardBtn.click()
const review = page.locator('[data-changes-review]')
await review.waitFor({ state: 'visible', timeout: 15_000 })
evidence.steps.push('card-to-tab')
await page.waitForTimeout(2500) // let highlight settle
await shot(page, 'c1-review-tab-unified')

// 2. Collect renderer facts (unified first).
const facts = await page.evaluate(() => {
  const view = document.querySelector('[data-review-view]')?.getAttribute('data-review-view')
  const lines = document.querySelectorAll('[data-diff-line]').length
  const codeSpans = [...document.querySelectorAll('[data-diff-code]')]
  const shikiColored = codeSpans.filter(s => (s.getAttribute('style') ?? '').includes('--shiki-')).length
  const spanStyles = codeSpans.slice(0, 5).map(s => s.getAttribute('style'))
  const workerMarks = performance.getEntriesByName('dsh.reviewDiff.worker', 'mark').length
  const slices = performance.getEntriesByName('dsh.reviewDiff.slice', 'measure').map(m => m.duration)
  const reviewFiles = [...document.querySelectorAll('[data-review-file]')].map(b => b.getAttribute('data-review-file'))
  const tools = [...document.querySelectorAll('[data-review-tool]')].map(b => ({ tool: b.getAttribute('data-review-tool'), pressed: b.getAttribute('aria-pressed') }))
  return { view, lines, codeSpans: codeSpans.length, shikiColored, spanStyles, workerMarks, sliceMax: Math.max(0, ...slices), slices: slices.length, reviewFiles, tools }
})
evidence.unified = facts

// 3. D-5: select a code row's text — selection must contain code, no numbers/signs.
const d5 = await page.evaluate(() => {
  const line = document.querySelector('[data-diff-line]')
  if (!line) return { ok: false, reason: 'no diff line' }
  const code = line.querySelector('[data-diff-code]')
  if (!code) return { ok: false, reason: 'no code span' }
  const range = document.createRange()
  range.selectNodeContents(line)
  const sel = window.getSelection()
  sel.removeAllRanges(); sel.addRange(range)
  const selected = sel.toString()
  const number = line.querySelector('[data-diff-number]')?.textContent ?? ''
  const sign = line.querySelector('[data-diff-sign]')?.textContent ?? ''
  return {
    ok: true,
    selected,
    numberText: number,
    signText: sign,
    containsNumber: number !== '' && selected.includes(number),
    containsCode: code.textContent !== null && selected.includes(code.textContent.trim().slice(0, 20)),
    numberUserSelect: getComputedStyle(line.querySelector('[data-diff-number]') ?? line).userSelect,
  }
})
evidence.d5 = d5

// 4. D-3/C1: toggle split, keep selection; then wrap.
await page.locator('[data-review-tool="split"]').click()
await page.waitForTimeout(1200)
await shot(page, 'c1-review-tab-split')
const splitState = await page.evaluate(() => ({
  view: document.querySelector('[data-review-view]')?.getAttribute('data-review-view'),
  selectionAfterToggle: window.getSelection()?.toString() ?? '',
  scrollY: document.querySelector('[data-changes-review] [data-diff-scroll], [data-changes-review] [class*="scroll"]')?.scrollTop ?? null,
}))
evidence.split = splitState

await page.locator('[data-review-tool="wrap"]').click()
await page.waitForTimeout(800)
evidence.wrap = await page.evaluate(() => ({
  wrapOn: document.querySelector('[data-review-tool="wrap"]')?.getAttribute('aria-pressed'),
  view: document.querySelector('[data-review-view]')?.getAttribute('data-review-view'),
}))
await shot(page, 'c1-review-tab-split-wrap')

// 5. Worker evidence: count marks again post-toggles (re-highlight may rerun).
evidence.workerFinal = await page.evaluate(() => ({
  workerMarks: performance.getEntriesByName('dsh.reviewDiff.worker', 'mark').length,
  sliceCount: performance.getEntriesByName('dsh.reviewDiff.slice', 'measure').length,
  sliceMax: Math.max(0, ...performance.getEntriesByName('dsh.reviewDiff.slice', 'measure').map(m => m.duration)),
}))

fs.writeFileSync(`${OUT}/c1-evidence.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 1))
await browser.close()
