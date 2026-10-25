/** Real browser checks for trigger placement, dynamic viewport changes and menu focus. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { startQaServer, qaServerUrl } from './server.mjs';

const require = createRequire(resolve('vendor/chisacode-remote/package.json'));
const { chromium } = require('playwright-core');
const server = process.env.QA_PUBLIC_ORIGIN ? null : await startQaServer({ port: 0, prefix: '/dshd/' });
const base = process.env.QA_PUBLIC_ORIGIN || qaServerUrl(server);
const output = resolve(process.argv[2] || '.tmp/remote-anchored-focused');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const results = [];
const near = (actual, expected, why) => assert.ok(Math.abs(actual - expected) < 2, `${why}: ${actual} vs ${expected}`);
async function check(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
let page;
async function anchored(trigger = '#model-chip') {
  await page.waitForFunction((selector) => {
    const panel = document.querySelector('#sheet-root .surface-panel')?.getBoundingClientRect();
    const button = document.querySelector(selector)?.getBoundingClientRect();
    return panel && button && panel.x >= 11 && panel.y >= 11 && panel.right <= innerWidth - 11 && panel.bottom <= innerHeight - 11 && Math.abs(panel.bottom + 8 - button.top) < 2;
  }, trigger);
  const panel = await page.locator('#sheet-root .surface-panel').boundingBox();
  const button = await page.locator(trigger).boundingBox();
  const viewport = page.viewportSize();
  near(panel.y + panel.height + 8, button.y, 'above anchor');
  near(panel.x + panel.width, Math.max(12 + panel.width, Math.min(button.x + button.width, viewport.width - 12)), 'right edge');
}
try {
  page = await browser.newPage({ viewport: { width: 1661, height: 971 }, reducedMotion: 'reduce' });
  if (!server) {
    const fixture = await readFile(resolve('tools/mobile-web-qa/fake-daemon-client.mjs'), 'utf8');
    await page.route('**/chisacode/daemon-client.bundle.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: fixture }));
  }
  await page.goto(`${base}#offer=QAFAKE`, { waitUntil: 'networkidle' });
  await page.locator('#menu').click();
  await page.locator('#drawer-directory .session-row[data-session-id="s-2"] > .session').click();
  await page.locator('#phone[data-session-id="s-2"]').waitFor();
  await check('wide root opens above the clicked model control without modal chrome', async () => {
    await page.locator('#model-chip').click(); await anchored();
    assert.equal(await page.locator('#sheet-root .surface-head, #sheet-root .modal-layer').count(), 0);
    assert.equal(await page.locator('#model-chip').getAttribute('aria-haspopup'), 'menu');
    await page.screenshot({ path: resolve(output, 'root-wide.png') });
  });
  await check('open menu follows rotation, narrowed viewport and composer growth', async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await anchored();
    await page.evaluate(() => {
      const input = document.querySelector('#draft'); input.value = Array(8).fill('Changed composer height').join('\n'); input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await anchored(); await page.setViewportSize({ width: 844, height: 390 }); await anchored();
  });
  await check('search and no-match content resize within the anchored menu', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#sheet-root .drill').filter({ hasText: '更多模型' }).click();
    await page.locator('.model-search').fill('does-not-exist');
    assert.equal(await page.locator('.model-results .mode-row').count(), 0); await anchored();
    await page.locator('.model-search').fill(''); await page.locator('.model-results .mode-row').first().waitFor(); await anchored();
    await page.locator('#sheet-root .surface-title').focus(); await page.keyboard.press('ArrowUp');
    assert.ok(await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#sheet-root .surface-panel button:not([disabled])')]; return document.activeElement === rows.at(-1);
    }), 'ArrowUp from the drill heading must focus the last row');
    await page.screenshot({ path: resolve(output, 'models-search.png') });
  });
  await check('Escape leaves a drill then closes root and restores trigger focus', async () => {
    await page.keyboard.press('Escape'); await page.locator('#sheet-root .drill').first().waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.pickerPage), 'more', 'Back must restore the drill that opened the list');
    await page.keyboard.press('Escape'); await page.locator('#sheet-root .surface-panel').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement.id), 'model-chip');
  });
  await check('arrow keys move rows and outside click dismisses without dimming', async () => {
    await page.locator('#model-chip').click();
    const before = await page.evaluate(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowDown'); assert.notEqual(await page.evaluate(() => document.activeElement.textContent), before);
    const mask = await page.locator('.menu-layer .sheet-mask').evaluate((node) => ({ color: getComputedStyle(node).backgroundColor, blur: getComputedStyle(node).backdropFilter }));
    assert.deepEqual(mask, { color: 'rgba(0, 0, 0, 0)', blur: 'none' });
    await page.mouse.click(20, 100); await page.locator('#sheet-root .surface-panel').waitFor({ state: 'detached' });
  });
  await check('a model selection rehomes keyboard focus after async row replacement', async () => {
    await page.locator('#model-chip').click();
    await page.locator('#sheet-root .mode-row').filter({ hasText: 'Lite' }).click();
    await page.waitForFunction(() => document.querySelector('#model-chip').textContent.includes('Lite') && !document.querySelector('#model-chip').disabled);
    assert.ok(await page.evaluate(() => document.activeElement.closest('#sheet-root .surface-panel') !== null));
    const before = await page.evaluate(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowDown'); assert.notEqual(await page.evaluate(() => document.activeElement.textContent), before);
    await page.keyboard.press('Escape');
  });
  await check('live sidebar row replacement keeps context menu bound to the new control', async () => {
    await page.locator('#menu').click();
    const more = '#drawer-directory .session-row[data-session-id="s-3"] .session-more';
    await page.locator(more).click();
    await page.evaluate(() => window.__qa.emitMux({ rpcId: 'qa-menu-row', envelope: { type: 'server-request', payload: { type: 'host/session-status', sessionId: 's-3', running: true } } }));
    await page.setViewportSize({ width: 412, height: 915 });
    await page.waitForFunction((selector) => {
      const trigger = document.querySelector(selector).getBoundingClientRect();
      const menu = document.querySelector('#sheet-root .surface-panel').getBoundingClientRect();
      return menu.right <= innerWidth - 11 && menu.y >= 11 && Math.abs(menu.y - trigger.bottom - 8) < 2;
    }, more);
    await page.keyboard.press('Escape'); await page.locator('#drawer-close').click();
  });
  await check('permission menu follows a trigger moved by a sibling model label', async () => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.locator('#access-chip').click(); await anchored('#access-chip');
    await page.evaluate(() => window.__qa.emitMux({ rpcId: 'qa-model-width', envelope: { type: 'server-request', payload: { type: 'session/projection', sessionId: 's-2', key: 'modelSelection', value: { next: { provider: 'dsh', model: 'r3', reasoningEffort: 'high' } } } } }));
    await page.waitForFunction(() => document.querySelector('#model-chip').textContent.includes('DeepSeek R3'));
    await anchored('#access-chip'); await page.keyboard.press('Escape');
  });
  await check('session search page row menu uses its visible trigger rather than hidden drawer', async () => {
    await page.locator('#menu').click(); await page.locator('#nav-sessions').click();
    const selector = '#sessions-page .session-row[data-session-id="s-3"] .session-more';
    await page.locator(selector).click();
    await page.waitForFunction((selector) => {
      const button = document.querySelector(selector).getBoundingClientRect();
      const menu = document.querySelector('#sheet-root .surface-panel').getBoundingClientRect();
      const layer = document.querySelector('#sheet-root .menu-layer');
      const x = Math.max(12, Math.min(button.left, innerWidth - menu.width - 12));
      const gap = layer.dataset.placement === 'above' ? button.top - menu.bottom : menu.top - button.bottom;
      return Math.abs(menu.left - x) < 2 && Math.abs(gap - 8) < 2;
    }, selector);
    await page.keyboard.press('Escape'); await page.locator('#sessions-back').click();
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check('loading root keeps a keyboard target and hands focus to loaded choices', async () => {
    const isolated = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await isolated.addInitScript(() => localStorage.setItem('dshd-debug-mux', '1'));
    if (!server) {
      const fixture = await readFile(resolve('tools/mobile-web-qa/fake-daemon-client.mjs'), 'utf8');
      await isolated.route('**/chisacode/daemon-client.bundle.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: fixture }));
    }
    const loading = await isolated.newPage();
    try {
      await loading.goto(`${base}#offer=QAFAKE`, { waitUntil: 'networkidle' });
      await loading.waitForFunction(() => !!window.__qa && !!window.__dshdDebug);
      await loading.evaluate(() => {
        const client = window.__qa.clients.at(-1), rpc = client.hostRpc;
        client.hostRpc = function(method, ...args) {
          if (method === 'session.models') return new Promise((done) => { window.__qa.resolveModels = () => done(rpc.call(this, method, ...args)); });
          return rpc.call(this, method, ...args);
        };
        window.__dshdDebug.previewSheet('model', { sessionId: 's-2' });
      });
      await loading.waitForFunction(() => typeof window.__qa.resolveModels === 'function');
      assert.equal(await loading.evaluate(() => document.activeElement.getAttribute('role')), 'menu');
      await loading.evaluate(() => window.__qa.resolveModels());
      await loading.locator('#sheet-root .mode-row').first().waitFor();
      assert.ok(await loading.evaluate(() => document.activeElement.closest('#sheet-root .surface-panel') !== null));
    } finally { await isolated.close(); }
  });
  await check('an incoming approval closes input menus and exposes approval actions', async () => {
    await page.locator('#model-chip').click();
    await page.evaluate(() => window.__qa.emitMux({ rpcId: 'qa-menu-approval', envelope: { type: 'server-request', payload: { type: 'approval/requested', sessionId: 's-2', approvalId: 'qa-anchor-a1', toolName: 'bash', reason: 'QA approval anchor transition' } } }));
    await page.locator('#sheet-root .surface-panel').waitFor({ state: 'detached' });
    assert.ok(await page.locator('#approval [data-approval-action="allowed-once"]').isVisible());
    assert.ok(await page.locator('#approval').evaluate((node) => !node.closest('[inert]')));
    await page.evaluate(() => window.__qa.emitMux({ rpcId: 'qa-menu-resolved', envelope: { type: 'approval/resolved', approvalId: 'qa-anchor-a1' } }));
    await page.locator('#model-chip').waitFor({ state: 'visible' });
  });
  if (server) await check('existing focused interactions remain intact', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const result = await page.evaluate(async (url) => {
      const { runInteractionCases } = await import(`${url}__qa__/interaction-cases.mjs`); return runInteractionCases();
    }, base);
    await writeFile(resolve(output, 'interactions.json'), JSON.stringify(result, null, 2));
    assert.deepEqual(result.results.filter((row) => !row.pass), []); console.log(`Existing interactions ${result.results.length}/${result.results.length}`);
  });
} finally {
  await browser.close();
  if (server) await new Promise((done) => server.close(done));
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ origin: base, source: 'real frontend + controlled daemon fixture', results }, null, 2));
}
if (results.some((row) => !row.ok)) process.exitCode = 1;
