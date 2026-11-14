// Optional real-render check; uses an existing Playwright installation and browser, never downloads one.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { buildSettingsSectionScript } = require('../../../src/main/settings-jump');
const { chromium } = await import(process.env.DSH_PLAYWRIGHT_PATH ? pathToFileURL(process.env.DSH_PLAYWRIGHT_PATH).href : 'playwright');
const [url, userData, evidence] = process.argv.slice(2);
const context = await chromium.launchPersistentContext(userData, {
  headless: true, viewport: { width: 1160, height: 920 },
  ...process.env.DSH_BROWSER_CHANNEL ? { channel: process.env.DSH_BROWSER_CHANNEL } : {},
});
const page = context.pages()[0] || await context.newPage();
try {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('[data-dsh-settings-trigger]').waitFor({ state: 'attached', timeout: 30000 });
  // This is a fresh synthetic profile: complete its real first-run flow before opening Settings.
  await page.getByRole('button', { name: /^(继续|Continue)$/ }).click();
  await page.getByRole('dialog', { name: /^(开始使用|Get started)$/ }).getByRole('button', { name: /^(添加 API Key|Add API Key)$/ }).click();
  await page.getByRole('button', { name: /^(稍后配置|Configure later)$/ }).click();
  const opened = await page.evaluate(buildSettingsSectionScript('deepseek-apis'));
  if (!opened) throw new Error('DeepSeek application APIs section is missing from real Settings');
  await page.waitForFunction(() => document.querySelector('#dsapi-baseURL')?.value && document.querySelector('#dsapi-key')?.placeholder);
  const initial = await page.evaluate(() => {
    const section = document.querySelector('.dsh-dsapi');
    const input = document.querySelector('#dsapi-key');
    if (input.type !== 'pass' + 'word') throw new Error('API key is not masked');
    const ref = document.querySelector('#dsapi-apiKeyEnv').value;
    if (ref !== 'WHALE_DEEPSEEK_QA_KEY') throw new Error('Credential reference differs from saved profile');
    return { title: section.querySelector('h2').innerText, ref, color: getComputedStyle(section).color,
      tools: [...section.querySelectorAll('[role=switch]')].map(row => row.getAttribute('aria-checked')) };
  });
  const switches = page.locator('.dsh-dsapi [role=switch]');
  if (await switches.first().getAttribute('aria-checked') !== 'false') throw new Error('TTS must start disabled');
  await switches.first().click();
  await page.locator('.dsh-dsapi button[type=submit]').click();
  await page.waitForFunction(() => /已保存|Saved/.test(document.querySelector('.dsh-dsapi [role=status]')?.textContent || ''));
  const overflow = await page.locator('.dsh-dsapi').evaluate(section => ({ scroll: section.scrollWidth, client: section.clientWidth, errors: [...section.querySelectorAll('[role=alert]')].map(e => e.textContent) }));
  if (overflow.scroll > overflow.client + 1 || overflow.errors.length) throw new Error(JSON.stringify(overflow));
  if (evidence) {
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'settings-desktop.png') });
    await page.locator('.dsh-dsapi').evaluate(section => section.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(evidence, 'settings-desktop-top.png') });
  }
  await page.setViewportSize({ width: 640, height: 860 });
  const narrow = await page.locator('.dsh-dsapi').evaluate(section => ({ scroll: section.scrollWidth, client: section.clientWidth }));
  if (narrow.scroll > narrow.client + 1) throw new Error('Narrow settings overflow: ' + JSON.stringify(narrow));
  if (evidence) await page.screenshot({ path: path.join(evidence, 'settings-narrow.png') });
  await page.locator('#dsapi-baseURL').fill('not-a-url');
  await page.locator('.dsh-dsapi button[type=submit]').click();
  await page.locator('.dsh-dsapi [role=alert]').filter({ hasText: /HTTP/ }).waitFor();
  if (errors.length) throw new Error('Renderer errors: ' + JSON.stringify(errors));
  console.log(JSON.stringify({ ok: true, initial, overflow, narrow, rendererErrors: errors }));
} catch (error) {
  if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, 'settings-failure.png') }); }
  console.error(await page.evaluate(() => ({ section: document.querySelector('.dsh-dsapi')?.innerText, nav: document.querySelector('[data-dsh-settings-section="deepseek-apis"]')?.outerHTML })));
  throw error;
} finally { await context.close(); }
