/**
 * Product Away-path live check: the URL the desktop QR actually opens.
 *
 * - Origin: DEFAULT_PUBLIC_APP_BASE_URL (nginx /dshd), never :3180
 * - Daemon: whatever is already listening on :6767 (Electron child). No bounce.
 * - Host catalog: loopback dsh web session.list vs the public SPA drawer
 *
 * Does not: start mobile-web-server, replace the daemon, stop Harness,
 * commit/push, or log the full #offer= URL.
 *
 * Usage: node tools/mobile-web-qa/run-public-live.mjs
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../src/main/dshd-remote.js');
const {
  DEFAULT_PUBLIC_APP_BASE_URL,
  DEFAULT_RELAY_ENDPOINT,
} = require('../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  return candidates.find((file) => existsSync(file)) || candidates[0];
}

const CHROME = chromePath();
const HARNESS = 'http://127.0.0.1:3080';
const PUBLIC_APP = DEFAULT_PUBLIC_APP_BASE_URL.replace(/\/$/, '');
const SHOT_DIR = path.join(process.cwd(), '.tmp', 'mobile-web-qa', 'public-live');
const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Deepseek-Harness-Desktop',
);

const results = [];
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    const message = error?.message || String(error);
    results.push(`NOT OK - ${name}: ${message}`);
    console.log(`NOT OK - ${name}: ${message}`);
  }
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${Math.max(0, parsed.hash.length - 7)} chars>`;
  } catch {
    return '<unparseable pairing url>';
  }
}

function isPublicLanding(url) {
  try {
    const parsed = new URL(url);
    const expected = new URL(`${PUBLIC_APP}/`);
    return parsed.origin === expected.origin
      && parsed.pathname.replace(/\/$/, '') === expected.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function harnessRpc(method, payload = {}) {
  const rpcId = randomUUID();
  const res = await fetch(`${HARNESS}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-encoding': 'identity',
      host: '127.0.0.1:3080',
    },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
  });
  const json = await res.json();
  if (json?.error) {
    throw new Error(json.error.message || json.error.code || method);
  }
  return json.result?.value !== undefined ? json.result.value : json.result;
}

function liveHostRows(sessions, workspaces) {
  const archived = new Set(workspaces?.archivedSessionIds || []);
  return (sessions?.items || []).filter((session) => (
    session.blank !== true
    && session.origin !== 'dshbot'
    && !archived.has(session.sessionId)
  ));
}

function titleOf(session) {
  const title = session?.projections?.values?.title;
  return typeof title === 'string' && title.trim() ? title.trim() : String(session.sessionId || '').slice(0, 7);
}

async function dumpDrawer(page) {
  return page.evaluate(() => ({
    titles: [...document.querySelectorAll('#session-list .session b')].map((node) => node.textContent),
    heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((node) => node.textContent),
    error: [...document.querySelectorAll('#session-list .row-desc')].map((node) => node.textContent).join('|'),
    footer: [...document.querySelectorAll('#session-list .session-list-action')].map((node) => node.textContent),
    body: document.querySelector('#session-list')?.textContent || '',
    banner: document.querySelector('#banner')?.textContent || '',
  }));
}

function readDesktopConfig() {
  const file = path.join(USER_DATA, 'config.json');
  assert(existsSync(file), `missing ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function main() {
  await rmShotDir();
  await mkdir(SHOT_DIR, { recursive: true });

  assert(await portOpen(3080), 'dsh web is not on 127.0.0.1:3080');
  assert(await portOpen(6767), 'Electron daemon is not listening on :6767 — will not start a replacement');

  const config = readDesktopConfig();
  const mode = config.remoteMode === 'relay' || config.remoteMode === 'away' ? 'relay' : 'lan';
  assert(mode === 'relay', `desktop remoteMode is ${config.remoteMode || 'lan'}; Away QR is not this path`);
  assert(config.remoteEnabled === true, 'remoteEnabled is false');

  const appJs = await (await fetch(`${PUBLIC_APP}/app.js`)).text();
  assert(!appJs.includes('fetchAgents'), 'public app.js still has fetchAgents — nginx SPA is stale');
  assert(appJs.includes('session.list'), 'public app.js has no session.list');

  const hostSessions = await harnessRpc('session.list');
  const hostWorkspaces = await harnessRpc('workspace.list');
  const hostLive = liveHostRows(hostSessions, hostWorkspaces);
  const hostTitles = new Set(hostLive.map(titleOf));
  console.log(`[public-live] host live sessions=${hostLive.length}`);
  assert(hostLive.length > 0, 'desktop session.list is empty; nothing to sync');

  const home = path.join(USER_DATA, 'chisacode-home');
  assert(existsSync(home), `missing chisacode-home at ${home}`);

  const api = await loadServerApi();
  const relayEndpoint = (config.remoteRelayEndpoint || DEFAULT_RELAY_ENDPOINT).trim();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: home,
    relayEnabled: true,
    relayEndpoint,
    relayPublicEndpoint: relayEndpoint,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: PUBLIC_APP,
    includeQr: false,
  });
  assert(pairing?.url && /#offer=/.test(pairing.url), 'no pairing url');
  console.log(`[public-live] pairing ${pairingSummary(pairing.url)}`);
  assert(isPublicLanding(pairing.url), `pairing URL is not the Away landing: ${pairingSummary(pairing.url)}`);
  assert(!/:(3180|8411)\b/.test(pairing.url), `pairing URL used a non-product port: ${pairingSummary(pairing.url)}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.LIVE_QA_HEADLESS === '0' ? false : 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => { consoleErrors.push(String(error)); });

  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

  try {
    await check('公网页 JS 是 host 切面（无 fetchAgents）', async () => {
      assert(!appJs.includes('fetchAgents'));
      assert(appJs.includes("hostCall(client, 'session.list'"));
    });

    await check('配对 URL origin = 外出二维码落地页', async () => {
      assert(isPublicLanding(pairing.url), pairingSummary(pairing.url));
    });

    let paired = false;
    await check('用公网 /dshd/#offer= 配对进 chat（不经过 :3180）', async () => {
      await page.goto(pairing.url, { waitUntil: 'networkidle0', timeout: 45_000 });
      const landing = await page.evaluate(() => ({
        origin: location.origin,
        path: location.pathname,
        hashOffer: location.hash.startsWith('#offer='),
      }));
      assert(landing.origin === new URL(`${PUBLIC_APP}/`).origin, `page origin ${landing.origin}`);
      assert(landing.path.replace(/\/$/, '') === '/dshd', `page path ${landing.path}`);
      assert(landing.hashOffer, 'hash lost #offer=');
      try {
        await waitFor(
          page,
          () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
            || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
          'chat or connect error',
          90_000,
        );
      } catch (error) {
        await shot('pair-timeout');
        const view = await page.evaluate(() => ({
          chatHidden: document.querySelector('#screen-chat')?.classList.contains('hidden'),
          error: document.querySelector('#connect-error')?.textContent || '',
          line: document.querySelector('#device-line')?.textContent || '',
          banner: document.querySelector('#banner')?.textContent || '',
        }));
        console.log('[public-live] pair dump', JSON.stringify(view));
        throw error;
      }
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        error: document.querySelector('#connect-error')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      if (view.error && !view.chat) throw new Error(`connect error: ${view.error}`);
      assert(view.chat, `did not reach chat: ${JSON.stringify(view)}`);
      paired = true;
    });
    await shot('paired');
    if (!paired) {
      throw new Error('pairing failed; drawer check skipped');
    }

    await page.evaluate(() => document.querySelector('#menu')?.click());
    await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer open', 10_000);
    await waitFor(
      page,
      () => document.querySelectorAll('#session-list .session b').length >= 1
        || (document.querySelector('#session-list')?.textContent || '').includes('无法加载')
        || (document.querySelector('#session-list')?.textContent || '').includes('桌面端未启动'),
      'drawer populated or error',
      20_000,
    );
    await shot('drawer');

    await check('抽屉活会话与桌面 session.list 对齐（非空）', async () => {
      const drawer = await dumpDrawer(page);
      const dump = `${drawer.banner}\n${drawer.body}`;
      assert(!dump.includes('unknown_schema'), `daemon schema mismatch: ${dump.slice(0, 280)}`);
      assert(!dump.includes('桌面端未启动'), `harness-down: ${dump.slice(0, 200)}`);
      assert(!dump.includes('无法加载会话'), `catalog failed: ${dump.slice(0, 280)}`);
      assert(drawer.titles.length > 0, `empty drawer. banner=${drawer.banner} body=${drawer.body.slice(0, 200)}`);
      const missing = [...hostTitles].filter((title) => !drawer.titles.includes(title) && !drawer.heads.includes(title));
      const extraEmpty = drawer.titles.length === 0 && hostTitles.size > 0;
      assert(!extraEmpty, `SPA empty vs host ${hostTitles.size} live sessions`);
      if (missing.length) {
        throw new Error(`SPA missing host titles (${missing.length}): ${missing.slice(0, 8).join(' | ')}`);
      }
    });

    await check('控制台无应用错误', async () => {
      const noise = consoleErrors.filter((line) => !/favicon|WebSocket/i.test(line));
      assert(noise.length === 0, noise.slice(0, 5).join(' | '));
    });
  } finally {
    await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
    await writeFile(path.join(SHOT_DIR, 'report.txt'), `${results.join('\n')}\n`, 'utf8');
  }

  console.log(`\n${results.length} checks, ${failures} failed. shots ${SHOT_DIR}`);
  if (failures) process.exitCode = 1;
}

async function rmShotDir() {
  const { rm } = await import('node:fs/promises');
  await rm(SHOT_DIR, { recursive: true, force: true });
}

main().catch(async (error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
