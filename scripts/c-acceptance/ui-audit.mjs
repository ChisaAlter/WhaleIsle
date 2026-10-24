// Full-surface UI layout audit for the packaged desktop build.
// Drives every reachable surface via CDP, runs an in-page layout check
// (clipping, overlap, overflow, dead elements), and screenshots each state.
import { chromium } from 'file:///C:/Ai/Deepseek-Harness-Desktop/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const OUT = 'docs/qa/results/2026-09-26-ui-layout-audit'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.connectOverCDP('http://localhost:9333')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1'))
  ?? browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('http'))
if (!page) throw new Error('web page not found')
page.setDefaultTimeout(8_000)

const consoleErrors = []
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)) })
page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + String(e).slice(0, 200)))

const shot = async name => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {})

/** In-page layout audit: overflow, clipping, dead zones, hit-test conflicts. */
async function auditDom(label) {
  const r = await page.evaluate(() => {
    const issues = []
    const vw = innerWidth, vh = innerHeight
    const visible = el => {
      const b = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return b.width > 0 && b.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
    }
    const name = el => (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 60)
    // 1. interactive elements outside viewport or clipped
    for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], [role="switch"], a[href], input, select')) {
      if (!visible(el)) continue
      const b = el.getBoundingClientRect()
      if (b.right < 0 || b.bottom < 0 || b.left > vw || b.top > vh)
        issues.push({ kind: 'offscreen', el: name(el), rect: [b.left|0, b.top|0, b.width|0, b.height|0] })
      // hit-test: is the element the topmost at its own center? (overlay conflict)
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2
      if (cx >= 0 && cy >= 0 && cx < vw && cy < vh) {
        const hit = document.elementFromPoint(cx, cy)
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el))
          issues.push({ kind: 'hit-blocked', el: name(el), by: name(hit), rect: [cx|0, cy|0] })
      }
    }
    // 2. text overflow in buttons/labels/headings
    for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], h1, h2, h3, td, th, label')) {
      if (!visible(el)) continue
      if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible'
          && getComputedStyle(el).overflowX === 'hidden' && getComputedStyle(el).textOverflow !== 'ellipsis')
        issues.push({ kind: 'text-clip', el: name(el), scrollW: el.scrollWidth, clientW: el.clientWidth })
    }
    // 3. dead zero-size elements marked visible, broken imgs
    for (const img of document.querySelectorAll('img'))
      if (img.complete && img.naturalWidth === 0 && img.src) issues.push({ kind: 'img-broken', el: img.src.slice(-60) })
    for (const el of document.querySelectorAll('[data-sidebar-right], [data-rightbar-col], [role="dialog"], [role="menu"], nav, aside')) {
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.width < 8) issues.push({ kind: 'thin-element', el: name(el), w: b.width|0 })
    }
    return { issues, url: location.href, vw, vh }
  })
  return { surface: label, ...r }
}

const report = []
const step = async (label, fn) => {
  try { await fn(); } catch (e) { report.push({ surface: label, fatal: String(e).slice(0, 200) }); await shot(label); return }
  await page.waitForTimeout(900)
  report.push(await auditDom(label))
  await shot(label)
}

// S0. as-is main view
await step('00-main', async () => {})

// S1. sidebar hover states + session row ops
await step('01-sidebar-hover', async () => {
  const ws = page.locator('[aria-label^="工作区“"]').first()
  if (await ws.count()) {
    await ws.evaluate(el => { let r = el.parentElement; while (r && !r.querySelector('[aria-label*="中新建会话"]')) r = r.parentElement; (r ?? el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  }
})

// S2. account menu
await step('02-account-menu', async () => {
  await page.getByLabel('账号菜单').click()
})

// S3. settings dialog — every left-nav section
await step('03-settings-general', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.getByText('设置', { exact: true }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText('通用设置', { exact: true }).click()
})
const sections = ['外观', '界面设置', '对话', '模型', '内置插件', '技能', '市场', '手机远程', 'MCP', 'Agent 预设', '用量与费用', '内置功能', '鲸鱼娘', '远程工作区', '关于', '账号与余额']
for (const s of sections) {
  await step(`03-settings-${s}`, async () => {
    await page.getByText(s, { exact: true }).click()
  })
}

// close settings
await step('04-main-after-settings', async () => {
  await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  await page.keyboard.press('Escape')
})

// S5. right rail guide + each panel
await step('05-rightbar-guide', async () => {
  const tb = page.getByLabel('切换右侧栏')
  await tb.click()
})
for (const [label, name] of [['06-panel-browser', '浏览器'], ['07-panel-terminal', '终端'], ['08-panel-files', '文件'], ['09-panel-diff', '差异'], ['10-panel-agents', '代理']]) {
  await step(label, async () => {
    const g = page.getByText(name, { exact: true }).first()
    if (await g.count()) { await g.click(); await page.waitForTimeout(1500) }
    // reopen guide between panels via the +/add affordance
  })
  // back to guide for next panel
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button, [role="tab"], [role="button"]')].find(e => /打开一个面板|新标签页|\+/.test(e.getAttribute('aria-label') ?? e.textContent ?? ''))
    t?.click()
  }).catch(() => {})
}

// S6. composer affordances (preset, model picker)
await step('11-composer-presets', async () => {
  const preset = page.getByLabel(/访问模式/).first()
  if (await preset.count()) await preset.click()
})
await step('12-model-picker', async () => {
  await page.keyboard.press('Escape')
  const model = page.getByLabel(/选择模型/).first()
  if (await model.count()) await model.click()
})

fs.writeFileSync(`${OUT}/audit-report.json`, JSON.stringify({ report, consoleErrors }, null, 2))
console.log('=== ISSUES ===')
for (const r of report) {
  if (r.fatal) { console.log(`[${r.surface}] FATAL ${r.fatal}`); continue }
  for (const i of r.issues) console.log(`[${r.surface}] ${i.kind} "${i.el}" ${i.by ? '← ' + i.by : ''}`)
}
console.log('=== console errors:', consoleErrors.length)
consoleErrors.slice(0, 15).forEach(e => console.log(' -', e))
await browser.close()
