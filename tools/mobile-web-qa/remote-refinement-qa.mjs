/** Real browser checks of the mobile frontend against the existing controlled Host fixture. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { startQaServer, qaServerUrl } from './server.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(root, 'vendor/chisacode-remote/package.json'));
const { chromium } = require('playwright-core');
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find(existsSync);
assert.ok(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const output = resolve(process.argv[2] || resolve(root, '.tmp/remote-refinement-browser'));
await mkdir(output, { recursive: true });
const results = [];
const server = await startQaServer({ port: 0, prefix: '/dshd/' });
const base = qaServerUrl(server);
let browser;
let activePage;
const errors = [];
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); }
  catch (error) {
    results.push({ name, ok: false, error: error.stack || String(error) });
    if (activePage) await activePage.screenshot({ path: resolve(output, `failure-${results.length}.png`) }).catch(() => {});
  }
  console.log(`${results.at(-1).ok ? 'PASS' : 'FAIL'} ${name}${results.at(-1).ok ? '' : `: ${results.at(-1).error}`}`);
}
async function backToChat(page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      const target = window.__dshdNavigation?.back();
      if (target === 'root') break;
      await new Promise((done) => requestAnimationFrame(done));
    }
  });
  await page.locator('#screen-chat').waitFor({ state: 'visible' });
}
async function withinViewport(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const view = page.viewportSize();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} is invisible`);
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= view.width + 1 && box.y + box.height <= view.height + 1, `${selector} outside ${JSON.stringify(view)}: ${JSON.stringify(box)}`);
  return box;
}
async function setup(viewport, colorScheme, scenario = '') {
  const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' });
  if (scenario === 'empty') {
    const fixture = await readFile(resolve(root, 'tools/mobile-web-qa/fake-daemon-client.mjs'), 'utf8');
    await context.route('**/chisacode/daemon-client.bundle.js*', (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${fixture}\nqa.world.sessions.items = []; qa.world.workspaces.items = []; qa.world.workspaces.archivedSessionIds = [];`,
    }));
  }
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(8000);
  page.on('pageerror', (error) => errors.push({ scenario, viewport, colorScheme, message: String(error) }));
  await page.goto(`${base}#offer=QAFAKE`, { waitUntil: 'networkidle' });
  await page.locator('#screen-chat').waitFor({ state: 'visible' });
  if (scenario !== 'empty') {
    await page.locator('#menu').click();
    await page.locator('#drawer-directory .session-row[data-session-id="s-2"] > .session').click();
    await page.locator('#phone[data-session-id="s-2"]').waitFor();
  }
  return { context, page };
}
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }]) {
      const { context, page } = await setup(viewport, colorScheme);
      const label = `${viewport.width}x${viewport.height}-${colorScheme}`;
      await check(`${label}: square grouped sidebar and brand`, async () => {
        await page.locator('#menu').click();
        await page.locator('#phone[data-drawer]').waitFor();
        await page.locator('#drawer-directory .session').first().waitFor();
        await withinViewport(page, '#drawer');
        const drawer = await page.locator('#drawer').evaluate((node) => ({
          corners: ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map((key) => getComputedStyle(node)[key]),
          image: [...node.querySelectorAll('img')].some((img) => img.complete && img.naturalWidth > 0 && img.src.includes('whale-head')),
          workspaces: node.querySelectorAll('.workspace-head').length,
          sessions: node.querySelectorAll('.session-row').length,
          text: node.textContent,
        }));
        assert.ok(drawer.corners.every((value) => parseFloat(value) === 0), JSON.stringify(drawer.corners));
        assert.ok(drawer.image, 'product brand image did not load');
        assert.ok(drawer.workspaces && drawer.sessions, 'grouped directory is missing');
        assert.ok(drawer.text.includes('BASED ON DEEPSEEK HARNESS'), 'desktop brand source line missing');
        await withinViewport(page, '#new-session');
        await withinViewport(page, '#drawer-account');
        await page.screenshot({ path: resolve(output, `drawer-${label}.png`) });
        await page.locator('#drawer-close').click();
      });
      await check(`${label}: model menu follows its trigger and retains draft`, async () => {
        await backToChat(page);
        await page.locator('#draft').fill('竖屏草稿\n第二行，保留模型选择前的编辑内容。');
        await withinViewport(page, '#composer');
        await withinViewport(page, '#send-btn');
        const old = await page.locator('#draft').inputValue();
        await page.screenshot({ path: resolve(output, `composer-${label}.png`) });
        await page.locator('#model-chip').click();
        await page.locator('#sheet-root .surface-panel').waitFor();
        assert.equal(await page.locator('#sheet-root .menu-layer').count(), 1, 'model picker must be an anchored menu');
        assert.equal(await page.locator('#sheet-root .modal-layer, #sheet-root .surface-head').count(), 0, 'root menu has modal chrome');
        const panel = await withinViewport(page, '#sheet-root .surface-panel');
        const trigger = await page.locator('#model-chip').boundingBox();
        assert.ok(Math.abs(panel.y + panel.height + 8 - trigger.y) < 2, 'menu did not open 8px above trigger');
        const edge = Math.max(12 + panel.width, Math.min(trigger.x + trigger.width, viewport.width - 12));
        assert.ok(Math.abs(panel.x + panel.width - edge) < 2, 'menu did not align to trigger right edge or viewport margin');
        const mask = await page.locator('#sheet-root .sheet-mask').evaluate((node) => ({ fill: getComputedStyle(node).backgroundColor, blur: getComputedStyle(node).backdropFilter }));
        assert.equal(mask.fill, 'rgba(0, 0, 0, 0)', 'menu dims background like a modal');
        assert.equal(mask.blur, 'none', 'menu blurs background like a modal');
        await page.screenshot({ path: resolve(output, `model-${label}.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#draft').inputValue(), old, 'menu lost the draft');
        const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(horizontal, false, 'horizontal page overflow');
      });
      await check(`${label}: settings stay in a dismissible dialog`, async () => {
        await backToChat(page);
        await page.locator('#menu').click();
        await page.locator('#nav-settings').click();
        await page.locator('#settings').waitFor({ state: 'visible' });
        const panel = await withinViewport(page, '#settings .settings-panel');
        assert.ok(panel.width < viewport.width, 'settings unexpectedly replaces the page');
        await withinViewport(page, '#close-settings');
        await page.screenshot({ path: resolve(output, `settings-${label}.png`) });
        await page.locator('#close-settings').click();
      });
      await check(`${label}: shorter visual viewport keeps send reachable`, async () => {
        await backToChat(page);
        const height = Math.max(300, Math.floor(viewport.height * .58));
        await page.setViewportSize({ width: viewport.width, height });
        await page.locator('#draft').fill(Array(14).fill('长草稿在软键盘可用高度内滚动。').join('\n'));
        await page.locator('#draft').focus();
        await withinViewport(page, '#composer');
        await withinViewport(page, '#send-btn');
        await page.screenshot({ path: resolve(output, `short-viewport-${label}.png`) });
      });
      await context.close();
    }
  }
  await check('empty catalog retains sidebar controls and accurate empty state', async () => {
    const { context, page } = await setup({ width: 390, height: 844 }, 'light', 'empty');
    await page.locator('#menu').click();
    await page.locator('#phone[data-drawer]').waitFor();
    assert.equal(await page.locator('#drawer-directory .session-row').count(), 0);
    assert.ok((await page.locator('#drawer-directory').innerText()).trim().length > 0, 'empty directory has no explanation');
    await withinViewport(page, '#new-session');
    await withinViewport(page, '#drawer-account');
    await page.screenshot({ path: resolve(output, 'empty-directory.png') });
    await context.close();
  });
  await check('model no-match remains recoverable inside the anchored menu', async () => {
    const { context, page } = await setup({ width: 320, height: 640 }, 'dark');
    await page.locator('#model-chip').click();
    await page.locator('#sheet-root button').filter({ hasText: '更多模型' }).click();
    await page.locator('.model-search').fill('no-such-model-20261025');
    assert.equal(await page.locator('.model-results .mode-row').count(), 0);
    assert.ok((await page.locator('.model-results').innerText()).trim(), 'no-match explanation missing');
    await page.locator('.model-search').fill('');
    await page.locator('.model-results .mode-row').first().waitFor();
    await page.screenshot({ path: resolve(output, 'model-search-recovered.png') });
    await context.close();
  });
  await check('browser scripts report no uncaught exceptions', async () => assert.deepEqual(errors, []));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
}
const failed = results.filter((row) => !row.ok);
console.log(`${results.length - failed.length}/${results.length} browser checks passed; artifacts: ${output}`);
if (failed.length) process.exitCode = 1;
