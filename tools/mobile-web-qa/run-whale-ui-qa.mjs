/**
 * Whale UI on the paired mobile/web SPA: fixture host + real Chromium at a
 * phone viewport. Verifies a `whale-ui` fence renders the real sandboxed
 * viewer, the coarse density flag reaches the isolated document, card chrome
 * keeps the shared 44px touch contract, and preview/source switching works.
 *
 * Usage: node tools/mobile-web-qa/run-whale-ui-qa.mjs [--screenshots <dir>] [--port 0] [--prefix /dshd/]
 * Requires puppeteer-core (dev-only): npm i --no-save puppeteer-core
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startQaServer, qaServerOptions, qaServerUrl } from './server.mjs';

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((path) => existsSync(path)) || candidates[0];
}

const CHROME = chromePath();
const serverOptions = qaServerOptions();
const SHOT_DIR = serverOptions.screenshots || 'tools/mobile-web-qa/results/whale-ui';

const results = [];
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL - ${name}: ${error.message}`);
  }
}

async function waitFor(page, fn, label, timeout = 15000) {
  try {
    await page.waitForFunction(fn, { timeout, polling: 200 });
  } catch (error) {
    throw new Error(`timeout waiting for ${label}: ${error.message}`);
  }
}

async function clickId(page, id) {
  const clicked = await page.evaluate((elementId) => {
    const node = document.getElementById(elementId);
    if (!node) return false;
    node.click();
    return true;
  }, id);
  assert(clicked, `#${id} missing`);
}

const WHALE_PROGRAM = [
  '下面是生成的面板：',
  '',
  '```whale-ui',
  'root = Col([',
  '  Title("移动适配检查"),',
  '  Text("粗指针密度应放大主控件。"),',
  '  Button("刷新数据"),',
  '])',
  '```',
  '',
  '卡片到此结束。',
].join('\n');

async function main() {
  const server = await startQaServer(serverOptions);
  const BASE = qaServerUrl(server);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1'],
  });
  const consoleErrors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    page.on('console', (message) => {
      const url = message.location()?.url || '';
      if (message.type() === 'error' && !/net::|favicon|\.map$/i.test(url)) {
        consoleErrors.push(`${message.text()} (${url})`);
      }
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await mkdir(SHOT_DIR, { recursive: true });
    const shot = (name) => page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });

    await page.goto(BASE, { waitUntil: 'networkidle0' });
    await check('配对：offer 链接进入 chat', async () => {
      await clickId(page, 'paste-toggle');
      await page.type('#paste', `${BASE}/#offer=QAFAKE`);
      await clickId(page, 'paste-enter');
      await waitFor(page, () => !document.querySelector('#screen-chat').classList.contains('hidden'), 'chat visible');
    });

    await check('whale-ui fence 渲染为卡片与沙箱 viewer', async () => {
      await clickId(page, 'menu');
      await waitFor(page, () => document.querySelectorAll('#session-list .session').length >= 3, 'sessions rendered');
      await page.evaluate(() => {
        [...document.querySelectorAll('#session-list .session')]
          .find((node) => node.textContent.includes('会话 1'))?.click();
      });
      await waitFor(page, () => document.querySelector('#log'), 's-1 log');
      await page.evaluate((programText) => {
        // Persist into the fake host's history first — s-1 is marked running,
        // so the 1.5s poll would otherwise overwrite a mux-only append.
        const event = {
          type: 'assistant/message',
          seq: 500,
          data: { message: { content: [{ type: 'text', text: programText }] } },
        };
        window.__qa.appendEvent('s-1', event);
        window.__qa.emitMux({
          rpcId: 'mux-whale',
          envelope: { payload: { type: 'session/event', sessionId: 's-1', event } },
        });
      }, WHALE_PROGRAM);
      await waitFor(page, () => document.querySelector('.whale-ui-card iframe.whale-ui-frame'), 'whale-ui card frame');
      // The viewer bundle is ~5MB inline; script eval + React mount + render
      // handshake can take >10s on a slow machine.
      let buttonReady = false;
      for (let attempt = 0; attempt < 100 && !buttonReady; attempt += 1) {
        const viewer = page.frames().find((frame) => frame.url().includes('whale-ui/viewer.html'));
        if (viewer) {
          buttonReady = await viewer.evaluate(() => Boolean(document.querySelector('.whale-viewer-root .whale-button'))).catch(() => false);
        }
        if (!buttonReady) await new Promise((resolve) => setTimeout(resolve, 400));
      }
      assert(buttonReady, 'viewer rendered button');
      await shot('whale-ui-card');
    });

    await check('粗指针密度到达隔离文档并放大主控件', async () => {
      const viewer = page.frames().find((frame) => frame.url().includes('whale-ui/viewer.html'));
      assert(viewer, 'viewer frame not found');
      const view = await viewer.evaluate(() => {
        const button = document.querySelector('.whale-button');
        return {
          density: document.documentElement.hasAttribute('data-density-coarse'),
          buttonHeight: button?.getBoundingClientRect().height || 0,
          lang: document.documentElement.lang || '',
        };
      });
      assert(view.density, 'viewer missing data-density-coarse');
      assert(view.buttonHeight >= 44, `coarse button height ${view.buttonHeight}px < 44px`);
      assert(view.lang.startsWith('zh'), `viewer lang: ${view.lang}`);
    });

    await check('卡片外框满足 44px 触控契约', async () => {
      const view = await page.evaluate(() => {
        const head = document.querySelector('.whale-ui-head');
        const tab = document.querySelector('.whale-ui-tab');
        const before = tab ? getComputedStyle(tab, '::before') : null;
        return {
          headHeight: head?.getBoundingClientRect().height || 0,
          hitInset: before ? before.inset : '',
        };
      });
      assert(view.headHeight >= 44, `card head ${view.headHeight}px < 44px`);
      assert(view.hitInset === '-6px -4px', `tab hit expansion: ${view.hitInset}`);
    });

    await check('源码/预览切换与同帧保留', async () => {
      await page.evaluate(() => {
        window.__qaFrameBefore = document.querySelector('.whale-ui-frame');
        [...document.querySelectorAll('.whale-ui-tab')].find((node) => node.textContent.includes('源码'))?.click();
      });
      await waitFor(
        page,
        () => {
          const source = document.querySelector('.whale-ui-source');
          return source && !source.classList.contains('hidden') && source.textContent.includes('移动适配检查');
        },
        'source view',
      );
      await page.evaluate(() => {
        [...document.querySelectorAll('.whale-ui-tab')].find((node) => node.textContent.includes('预览'))?.click();
      });
      await waitFor(page, () => document.querySelector('.whale-ui-frame')?.isConnected, 'preview restored');
      const same = await page.evaluate(() => document.querySelector('.whale-ui-frame') === window.__qaFrameBefore);
      assert(same, 'viewer iframe was rebuilt on source toggle');
    });

    await check('控制台：0 应用错误', async () => {
      assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
    });

    console.log(results.join('\n'));
    console.log(`\n${results.length - failures}/${results.length} checks passed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    try { await browser?.close(); }
    finally { await new Promise((resolve) => server.close(resolve)); }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
