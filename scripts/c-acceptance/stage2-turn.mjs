// C-acceptance stage 2: one real model turn in the scratch workspace that
// writes a file, producing a genuine changed-files card. Polls for approvals
// and clicks the allow action when one appears.
import { chromium } from 'file:///C:/Ai/Deepseek-Harness-Desktop/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const OUT = 'docs/superpowers/evidence/2026-09-25-upstream-adoption/c-phase'
fs.mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }).catch((error) => { console.warn('[scripts/c-acceptance/stage2-turn.mjs] background operation failed', error); }) }

const PROMPT = 'Create a file c1-probe.ts in this workspace containing exactly this one line: export const c1 = "acceptance". Then stop. Do not run anything else.'
const DEADLINE = Date.now() + 150_000

const browser = await chromium.connectOverCDP('http://localhost:9333')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1:3080'))
if (!page) throw new Error('web page not found')
page.setDefaultTimeout(10_000)

const wsBtn = page.locator('[aria-label="在“dshd-c1-workspace”中新建会话"]')
// The button is hover-revealed inside its workspace row.
await wsBtn.evaluate(el => {
  let row = el.parentElement
  while (row && !row.querySelector('[aria-label*="的操作"]')) row = row.parentElement
  ;(row ?? el).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  ;(row ?? el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
})
await page.waitForTimeout(400)
await wsBtn.click({ timeout: 8000 }).catch(() => wsBtn.dispatchEvent('click'))
const input = page.locator('[data-composer-input]').first()
await input.waitFor({ state: 'visible' })
await input.fill(PROMPT)
await shot(page, 'c-stage2-prompt')
await input.press('Enter')

let approved = 0
let cardFound = false
let lastShot = 0
while (Date.now() < DEADLINE) {
  if (await page.locator('[data-changed-files]').count() > 0) { cardFound = true; break }
  // approval affordances: buttons labelled 允许/批准/Approve/Allow/Always
  const approve = page.locator('button').filter({ hasText: /^(允许|批准|Approve|Allow|Always allow|始终允许)/ }).first()
  if (await approve.count() > 0 && await approve.isVisible().catch(() => false)) {
    await approve.click().catch((error) => { console.warn('[scripts/c-acceptance/stage2-turn.mjs] background operation failed', error); })
    approved++
    continue
  }
  if (Date.now() - lastShot > 20_000) { await shot(page, `c-stage2-wait-${Math.floor((DEADLINE - Date.now()) / 1000)}`); lastShot = Date.now() }
  await page.waitForTimeout(1200)
}
await shot(page, 'c-stage2-card' )
const files = await page.locator('[data-changed-files]').evaluateAll(els => els.map(e => e.textContent?.trim().slice(0, 120))).catch(() => [])
const evidence = { cardFound, approved, cardText: files, ts: Date.now() }
fs.writeFileSync(`${OUT}/stage2.json`, JSON.stringify(evidence, null, 2))
console.log(JSON.stringify(evidence, null, 1))
await browser.close()
if (!cardFound) process.exit(1)
