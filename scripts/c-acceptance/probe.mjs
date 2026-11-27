// CDP probe: dump live UI landmarks of the running WhaleIsle web UI.
import { chromium } from 'file:///C:/Ai/Deepseek-Harness-Desktop/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const browser = await chromium.connectOverCDP('http://localhost:9333')
const contexts = browser.contexts()
console.log('contexts:', contexts.length)
for (const ctx of contexts) {
  for (const p of ctx.pages()) console.log('page:', p.url())
}
const page = contexts.flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1:3080'))
if (!page) { console.log('NO WEB PAGE'); process.exit(1) }
page.setDefaultTimeout(5000)

const probe = await page.evaluate(() => {
  const pick = sel => ({ n: document.querySelectorAll(sel).length })
  return {
    title: document.title,
    rightbar: pick('[data-rightbar-col]'),
    guideEntries: pick('[data-sidebar-right-guide-entry]'),
    expand: pick('[data-sidebar-right-expand]'),
    addTab: pick('[data-dockkit-add-tab]'),
    dockkitTabs: pick('[data-dockkit-tab]'),
    composer: pick('textarea'),
    sessionRows: pick('[data-session-row], [data-session-item], a[href*="session"]'),
    buttons: [...document.querySelectorAll('button')].slice(0, 40).map(b => ({
      t: (b.textContent || '').trim().slice(0, 30),
      label: b.getAttribute('aria-label') || b.getAttribute('title') || '',
      dt: b.getAttribute('data-testid') || Object.keys(b.dataset).slice(0,3).join(','),
    })),
  }
})
console.log(JSON.stringify(probe, null, 1).slice(0, 4000))
await browser.close()
