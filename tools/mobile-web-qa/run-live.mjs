/**
 * Dev-tree SPA on loopback :3180. This is NOT the Away QR path.
 *
 * Away-mode cameras open DEFAULT_PUBLIC_APP_BASE_URL
 * (https://ayase.cn/dshd/). Claiming 实机 against this script
 * while the product QR still points at public nginx is invalid.
 *
 * Product-path live check: node tools/mobile-web-qa/run-public-live.mjs
 * (public origin, Electron-owned daemon, no bounce, no :3180).
 *
 * This file still bounces the daemon child if dist is stale — that is a
 * protocol debug harness, not a phone-path gate.
 *
 * Does not: stop Harness, commit/push/publish the product repo, or log the
 * full #offer= URL.
 *
 * Usage: node tools/mobile-web-qa/run-live.mjs
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn as spawnChild, execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const {
  loadServerApi,
  buildDaemonChildEnv,
  dshVendorDirForChild,
  ensureDshAcpShim,
  RUNNER_PATH,
} = require('../../src/main/dshd-remote.js');
const {
  createMobileWebServer,
  listenMobileWebServer,
} = require('../../src/main/mobile-web-server.js');
const { startGitTunnelServer } = require('../../src/main/dshd-git-tunnel.js');
const git = require('../../src/main/git.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../src/shared/lan.js');
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
const BASE = 'http://127.0.0.1:3180';
const HARNESS = 'http://127.0.0.1:3080';
const SHOT_DIR = path.join(process.cwd(), '.tmp', 'mobile-web-qa', 'live');
const FOLDER_NAME = `dshd-live-webui-qa-${Date.now()}`;
const BRANCH_NAME = `qa-live-${Date.now().toString(36)}`;

const results = [];
let failures = 0;
const created = {
  folderPath: '',
  workspaceId: '',
  sessionId: '',
};

const bounce = {
  child: null,
  gitTunnel: null,
};

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function waitForPort(port, { wantOpen, timeoutMs = 20_000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const open = await portOpen(port);
    if (open === wantOpen) return;
    await sleep(200);
  }
  throw new Error(`port ${port} still ${wantOpen ? 'closed' : 'open'} after ${timeoutMs}ms`);
}

function daemonRunnerPids() {
  const script = [
    'Get-CimInstance Win32_Process |',
    'Where-Object { $_.CommandLine -match \'chisacode-daemon-runner\' } |',
    'ForEach-Object { $_.ProcessId }',
  ].join(' ');
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
  return out.split(/\s+/).map((value) => Number(value)).filter((id) => Number.isInteger(id) && id > 0);
}

function stopDaemonRunners() {
  for (const pid of daemonRunnerPids()) {
    try {
      execFileSync('taskkill', ['/F', '/PID', String(pid), '/T'], { stdio: 'ignore' });
      console.log(`[live] stopped stale daemon pid ${pid}`);
    } catch {
      // already gone
    }
  }
}

async function bounceLiveDaemon(home) {
  stopDaemonRunners();
  await waitForPort(6767, { wantOpen: false, timeoutMs: 15_000 });
  bounce.gitTunnel = await startGitTunnelServer({ git });
  const electron = path.join(process.cwd(), 'node_modules', 'electron', 'dist', 'electron.exe');
  assert(existsSync(electron), `missing ${electron}`);
  const launchFile = path.join(home, 'daemon-launch.json');
  assert(existsSync(launchFile), `missing ${launchFile}`);
  let api = null;
  try {
    api = await loadServerApi();
  } catch {
    api = null;
  }
  let shimDir = '';
  try {
    shimDir = ensureDshAcpShim({ home, execPath: electron }) || '';
  } catch {
    shimDir = '';
  }
  const env = buildDaemonChildEnv({
    baseEnv: process.env,
    home,
    vendorDir: dshVendorDirForChild(api),
    shimDir,
    config: { apiKey: '', baseUrl: '' },
    harnessOrigin: HARNESS,
    gitTunnelUrl: bounce.gitTunnel.url,
    gitTunnelToken: bounce.gitTunnel.token,
  });
  const child = spawnChild(electron, [RUNNER_PATH, launchFile], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  bounce.child = child;
  let ready = false;
  const onReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('replacement daemon not ready in 30s')), 30_000);
    const onData = (chunk) => {
      const text = String(chunk);
      if (text.includes('dshd_daemon_ready')) {
        ready = true;
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve();
      }
      if (text.includes('dshd_daemon_start_failed')) {
        clearTimeout(timer);
        reject(new Error(text.slice(0, 400)));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      if (!ready) console.log(`[daemon stderr] ${text.slice(0, 200)}`);
    });
    child.on('exit', (code, signal) => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(`replacement daemon exited ${signal || code}`));
      }
    });
  });
  await onReady;
  await waitForPort(6767, { wantOpen: true, timeoutMs: 10_000 });
  console.log('[live] replacement daemon ready (new protocol dist + harness origin + git tunnel)');
}

async function stopBouncedDaemon() {
  const child = bounce.child;
  bounce.child = null;
  if (child && child.exitCode == null) {
    try { child.stdin.write('stop\n'); } catch { /* ignore */ }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        resolve();
      }, 5000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  if (bounce.gitTunnel) {
    try { await bounce.gitTunnel.close(); } catch { /* ignore */ }
    bounce.gitTunnel = null;
  }
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

function skip(name, reason) {
  results.push(`SKIP - ${name}: ${reason}`);
  console.log(`SKIP - ${name}: ${reason}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(page, fn, message, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(80);
  }
  throw new Error(`timeout: ${message}`);
}

async function clickByText(page, selector, text) {
  const clicked = await page.evaluate((sel, needle) => {
    const hit = [...document.querySelectorAll(sel)]
      .find((node) => node.textContent.includes(needle) && !node.disabled);
    if (!hit) return false;
    hit.click();
    return true;
  }, selector, text);
  assert(clicked, `no clickable "${text}" in ${selector}`);
}

async function closeOverlays(page) {
  await page.evaluate(() => {
    document.querySelector('#sheet-root .sheet-mask')?.click();
    document.querySelector('#dialog-root .dialog-mask')?.click();
    const closer = document.querySelector('#close-settings');
    if (closer && !document.querySelector('#settings')?.classList.contains('hidden')) closer.click();
  });
}

async function openDrawer(page) {
  await closeOverlays(page);
  await page.evaluate(() => document.querySelector('#menu')?.click());
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer open');
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

function pairingSummary(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}#offer=<${parsed.hash.length - 7} chars>`;
  } catch {
    return '<unparseable pairing url>';
  }
}

async function dumpDrawer(page) {
  return page.evaluate(() => ({
    titles: [...document.querySelectorAll('#session-list .session b')].map((node) => node.textContent),
    heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((node) => node.textContent),
    childTitles: [...document.querySelectorAll('#session-list .session-child .session b')].map((node) => node.textContent),
    error: [...document.querySelectorAll('#session-list .row-desc')].map((node) => node.textContent).join('|'),
    loadMore: [...document.querySelectorAll('#session-list .session-list-action')]
      .some((node) => node.textContent.includes('加载更多')),
    footer: [...document.querySelectorAll('#session-list .session-list-action')].map((node) => node.textContent),
    body: document.querySelector('#session-list')?.textContent || '',
  }));
}

async function cleanupCreated() {
  if (created.sessionId) {
    try {
      const workspaces = await harnessRpc('workspace.list');
      const archived = new Set(workspaces?.archivedSessionIds || []);
      if (!archived.has(created.sessionId)) {
        const row = (await harnessRpc('session.list'))?.items
          ?.find((item) => item.sessionId === created.sessionId);
        const workspaceId = created.workspaceId
          || (workspaces?.items || []).find((item) => (item.sessionIds || []).includes(created.sessionId))?.workspaceId;
        if (workspaceId) {
          await harnessRpc('workspace.archiveSession', {
            workspaceId,
            sessionId: created.sessionId,
          });
        }
      }
      await harnessRpc('session.delete', { sessionId: created.sessionId });
    } catch (error) {
      console.log(`[cleanup] session.delete: ${error?.message || error}`);
    }
  }
  if (created.workspaceId) {
    try {
      await harnessRpc('workspace.delete', { workspaceId: created.workspaceId });
    } catch (error) {
      console.log(`[cleanup] workspace.delete: ${error?.message || error}`);
    }
  }
  if (created.folderPath) {
    try {
      await rm(created.folderPath, { recursive: true, force: true });
    } catch (error) {
      console.log(`[cleanup] rm folder: ${error?.message || error}`);
    }
  }
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });

  const probe = await fetch(`${HARNESS}/api/session.list`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-encoding': 'identity',
      host: '127.0.0.1:3080',
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: randomUUID(),
      method: 'session.list',
      payload: {},
    }),
  });
  assert(probe.ok, `harness session.list HTTP ${probe.status}`);

  const hostSessions = await harnessRpc('session.list');
  const hostWorkspaces = await harnessRpc('workspace.list');
  const hostLive = liveHostRows(hostSessions, hostWorkspaces);
  const hostTitles = new Set(hostLive.map(titleOf));
  const hostWorkspaceTitles = (hostWorkspaces?.items || []).map((item) => item.title || item.path);
  console.log(`[live] host live sessions=${hostLive.length} workspaces=${hostWorkspaceTitles.length}`);

  const home = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Deepseek-Harness-Desktop',
    'chisacode-home',
  );
  assert(existsSync(home), `missing chisacode-home at ${home}`);
  try {
    await bounceLiveDaemon(home);
  } catch (error) {
    await stopBouncedDaemon();
    throw error;
  }

  const api = await loadServerApi();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: home,
    relayEnabled: true,
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayPublicEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: BASE,
    includeQr: false,
  });
  assert(pairing?.url && /#offer=/.test(pairing.url), 'no pairing url');
  console.log(`[live] pairing ${pairingSummary(pairing.url)}`);

  const server = createMobileWebServer({ bindAddress: '127.0.0.1', port: 3180 });
  await listenMobileWebServer(server, '127.0.0.1', 3180);

  const headed = process.env.LIVE_QA_HEADLESS === '1' ? 'new' : false;
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const consoleErrors = [];
  const consoleAll = [];
  page.on('console', (message) => {
    const url = message.location()?.url || '';
    const line = `[${message.type()}] ${message.text()} (${url})`;
    consoleAll.push(line);
    if (message.type() === 'error' && !message.text().includes('favicon') && !url.includes('favicon')) {
      consoleErrors.push(`${message.text()} (${url})`);
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(String(error));
    consoleAll.push(`[pageerror] ${error}`);
  });
  page.on('requestfailed', (request) => {
    consoleAll.push(`[requestfailed] ${request.url()} ${request.failure()?.errorText || ''}`);
  });

  let promptReply = null;
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'prompt' && promptReply != null) {
      const value = promptReply;
      promptReply = null;
      await dialog.accept(value);
      return;
    }
    await dialog.dismiss();
  });

  const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });

  try {
    let paired = false;
    await check('配对：本仓库 SPA + 实机 daemon 进入 chat', async () => {
      // First load must include #offer=. Same-document hash-only navigation
      // does not re-run the module boot block.
      await page.goto(pairing.url, { waitUntil: 'networkidle0', timeout: 30_000 });
      try {
        await waitFor(
          page,
          () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
            || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
          'chat or connect error',
          90_000,
        );
      } catch (error) {
        await shot('live-pair-timeout');
        const view = await page.evaluate(() => ({
          hrefLen: location.href.length,
          hashLen: location.hash.length,
          chatHidden: document.querySelector('#screen-chat')?.classList.contains('hidden'),
          connectHidden: document.querySelector('#screen-connect')?.classList.contains('hidden'),
          error: document.querySelector('#connect-error')?.textContent || '',
          errorHidden: document.querySelector('#connect-error')?.classList.contains('hidden'),
          line: document.querySelector('#device-line')?.textContent || '',
          banner: document.querySelector('#banner')?.textContent || '',
        }));
        console.log('[live] pair dump', JSON.stringify(view));
        console.log('[live] console tail\n', consoleAll.slice(-40).join('\n'));
        throw error;
      }
      const view = await page.evaluate(() => ({
        chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
        line: document.querySelector('#device-line')?.textContent || '',
        error: document.querySelector('#connect-error')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      if (view.error && !view.chat) {
        throw new Error(`connect error: ${view.error}`);
      }
      assert(view.chat, `did not reach chat: ${JSON.stringify(view)}`);
      paired = true;
    });
    await shot('live-paired');
    if (!paired) {
      throw new Error('pairing failed; remaining MUST rows skipped');
    }

    await check('host RPC：daemon 识别 dshd.host.rpc.request', async () => {
      const banner = await page.evaluate(() => document.querySelector('#banner')?.textContent || '');
      const list = await page.evaluate(() => document.querySelector('#session-list')?.textContent || '');
      const dump = `${banner}\n${list}`;
      assert(
        !dump.includes('unknown_schema') && !dump.includes('Unknown request'),
        `daemon schema mismatch: ${dump.slice(0, 280)}`,
      );
      assert(!dump.includes('无法加载会话'), `catalog failed: ${dump.slice(0, 280)}`);
    });

    await openDrawer(page);
    await waitFor(
      page,
      () => document.querySelectorAll('#session-list .session b').length >= 3
        || (document.querySelector('#session-list')?.textContent || '').includes('无法加载'),
      'drawer populated',
      20_000,
    );
    await shot('live-drawer');

    await check('抽屉：活会话标题 ∪ 工作区分组 = host session.list / workspace.list', async () => {
      const drawer = await dumpDrawer(page);
      assert(!drawer.body.includes('桌面端未启动'), `harness-down copy on live desktop: ${drawer.body.slice(0, 200)}`);
      assert(!drawer.loadMore, 'load-more still visible');
      assert(drawer.footer.some((label) => label.includes('已归档会话')), `archived footer missing: ${drawer.footer}`);
      const spaTitles = new Set(drawer.titles.filter((title) => !hostWorkspaceTitles.includes(title)));
      const missing = [...hostTitles].filter((title) => !spaTitles.has(title) && !drawer.titles.includes(title));
      const extra = drawer.titles.filter((title) => (
        !hostTitles.has(title)
        && !hostWorkspaceTitles.includes(title)
        && title !== '一个列表'
        && title !== '按工作区分组'
        && title !== '已归档会话'
      ));
      assert(missing.length === 0, `SPA missing host titles (${missing.length}): ${missing.slice(0, 8).join(' | ')}`);
      assert(extra.length === 0, `SPA extra titles: ${extra.slice(0, 8).join(' | ')}`);
      for (const name of hostWorkspaceTitles) {
        assert(drawer.heads.includes(name), `workspace head missing: ${name} in ${drawer.heads}`);
      }
      assert(!drawer.titles.includes('blank'), 'blank leaked');
      assert(hostLive.every((row) => row.origin !== 'dshbot' || !drawer.titles.includes(titleOf(row))), 'dshbot leaked');
    });

    await check('子智能体：折叠在父下并标注', async () => {
      const drawer = await dumpDrawer(page);
      const childHost = hostLive.filter((row) => row.parentSessionId);
      assert(childHost.length >= 1, 'host has no parentSessionId rows to compare');
      assert(drawer.childTitles.length >= 1, `no session-child rows; titles=${drawer.titles.slice(0, 6)}`);
      const expected = titleOf(childHost[0]);
      assert(
        drawer.childTitles.includes(expected) || drawer.titles.includes(expected),
        `child title missing: ${expected}`,
      );
    });

    await check('活会话菜单没有删除', async () => {
      const opened = await page.evaluate(() => {
        const row = [...document.querySelectorAll('#session-list .session-row')]
          .find((node) => node.querySelector('.session b') && !node.classList.contains('workspace-head') && !node.classList.contains('session-child'));
        row?.querySelector('.session-more')?.click();
        return Boolean(row);
      });
      assert(opened, 'no live session-more');
      await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet')), 'menu sheet');
      const labels = await page.evaluate(
        () => [...document.querySelectorAll('#sheet-root .sheet-item')].map((node) => node.textContent),
      );
      assert(labels.some((label) => label.includes('归档')), `archive missing: ${labels}`);
      assert(labels.some((label) => label.includes('Fork')), `fork missing: ${labels}`);
      assert(labels.some((label) => label.includes('重命名')), `rename missing: ${labels}`);
      assert(!labels.some((label) => label === '删除' || label.includes('删除会话')), `live delete leaked: ${labels}`);
      await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
    });

    await check('搜索：session.search 展示 snippet', async () => {
      const needle = [...hostTitles].find((title) => title.includes('长颈鹿')) || [...hostTitles][0];
      await page.evaluate((value) => {
        const input = document.querySelector('#search');
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, needle.slice(0, 6));
      await waitFor(
        page,
        () => document.querySelectorAll('#session-list .session b').length >= 1
          && !(document.querySelector('#session-list')?.textContent || '').includes('正在搜索'),
        'search results',
        8000,
      );
      const view = await dumpDrawer(page);
      assert(
        view.titles.some((title) => title.includes(needle.slice(0, 4))) || view.body.includes(needle.slice(0, 4)),
        `search miss: ${view.titles} / ${view.body.slice(0, 180)}`,
      );
      await page.evaluate(() => {
        const input = document.querySelector('#search');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(300);
    });
    await shot('live-search');

    const gitWorkspaceTitle = '长颈鹿打螺丝SVG动画';
    await check('打开会话：host history 时间线', async () => {
      await openDrawer(page);
      const opened = await page.evaluate((title) => {
        const hit = [...document.querySelectorAll('#session-list .session')]
          .find((node) => node.querySelector('b')?.textContent === title);
        if (!hit) return false;
        hit.click();
        return true;
      }, gitWorkspaceTitle);
      assert(opened, `missing session ${gitWorkspaceTitle}`);
      await waitFor(
        page,
        () => document.querySelectorAll('#log > *').length >= 1
          || Boolean(document.querySelector('#log .timeline-error'))
          || !document.querySelector('#blank')?.classList.contains('hidden'),
        'timeline or blank',
        20_000,
      );
      const view = await page.evaluate(() => ({
        title: document.querySelector('#chat-title')?.textContent || '',
        rows: document.querySelectorAll('#log > *').length,
        error: document.querySelector('#log .timeline-error')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      assert(!view.error, `timeline error: ${view.error}`);
      assert(view.title.includes('长颈鹿') || view.rows >= 1, `open failed: ${JSON.stringify(view)}`);
    });
    await shot('live-timeline');

    await check('子智能体打开为只读', async () => {
      await openDrawer(page);
      const opened = await page.evaluate(() => {
        const hit = document.querySelector('#session-list .session-child .session');
        if (!hit) return '';
        hit.click();
        return hit.querySelector('b')?.textContent || 'child';
      });
      assert(opened, 'no child row to open');
      await waitFor(
        page,
        () => !document.querySelector('#readonly-note')?.classList.contains('hidden')
          || document.querySelector('#composer')?.classList.contains('hidden'),
        'readonly composer',
        15_000,
      );
      const view = await page.evaluate(() => ({
        note: document.querySelector('#readonly-note')?.textContent || '',
        composerHidden: document.querySelector('#composer')?.classList.contains('hidden'),
      }));
      assert(view.note.includes('只读') || view.composerHidden, `not readonly: ${JSON.stringify(view)}`);
    });
    await shot('live-readonly');

    await check('权限 chip 与 host projections 一致', async () => {
      await openDrawer(page);
      const opened = await page.evaluate((title) => {
        const hit = [...document.querySelectorAll('#session-list .session')]
          .find((node) => node.querySelector('b')?.textContent === title && !node.closest('.session-child'));
        if (!hit) return false;
        hit.click();
        return true;
      }, gitWorkspaceTitle);
      assert(opened, 'could not reopen git workspace session');
      await waitFor(page, () => document.querySelector('#chat-title')?.textContent?.includes('长颈鹿'), 'title', 15_000);
      await sleep(800);
      const chip = await page.evaluate(() => document.querySelector('#access-chip')?.textContent || '');
      const hostRow = hostLive.find((row) => titleOf(row) === gitWorkspaceTitle);
      const value = hostRow?.projections?.values?.permissions?.currentValue
        || hostRow?.projections?.values?.permission
        || '';
      assert(chip.length > 0, `empty access chip`);
      if (value === 'danger-full-access') {
        assert(chip.includes('完全访问') || chip.includes('权限'), `chip=${chip} host=${value}`);
      }
    });

    await check('模型 chip：session.models 可读且含思考档则显示 effort', async () => {
      await waitFor(
        page,
        () => {
          const text = document.querySelector('#model-chip')?.textContent || '';
          return text && text !== '模型';
        },
        'model chip populated',
        12_000,
      );
      await page.click('#model-chip');
      await waitFor(page, () => document.querySelectorAll('#options .mode-row, #options button').length >= 1, 'model pane');
      const copy = await page.evaluate(() => document.querySelector('#options')?.textContent || '');
      assert(copy.length > 10, `empty model pane: ${copy}`);
      await page.click('#close-settings');
    });
    await shot('live-model');

    await check('斜杠：/ 拉取 host 命令', async () => {
      await page.evaluate(() => {
        const input = document.querySelector('#draft');
        if (input) input.value = '';
      });
      await page.focus('#draft');
      await page.type('#draft', '/');
      await waitFor(
        page,
        () => document.querySelectorAll('#slash-pop .slash-item').length >= 1
          || document.querySelector('#slash-pop')?.classList.contains('hidden') === false,
        'slash popup',
        8000,
      );
      const names = await page.evaluate(
        () => [...document.querySelectorAll('#slash-pop .slash-item')].map((node) => node.textContent),
      );
      assert(names.length >= 1, `no slash items: ${names}`);
      await page.evaluate(() => {
        const input = document.querySelector('#draft');
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    await check('Git（产品仓，只读）：胶囊 + 创建并检出，不提交', async () => {
      await openDrawer(page);
      await page.click('#nav-workspace');
      await waitFor(
        page,
        () => Boolean(document.querySelector('#options .git-capsule'))
          || (document.querySelector('#options')?.textContent || '').includes('Git'),
        'git capsule',
        15_000,
      );
      const view = await page.evaluate(() => ({
        branch: document.querySelector('#options .cap-branch')?.textContent || '',
        primary: document.querySelector('#options .cap-primary')?.textContent || '',
        body: document.querySelector('#options')?.textContent || '',
      }));
      assert(!view.body.includes('创建新分支请在电脑端') && !view.body.includes('创建分支请在电脑端'), view.body.slice(0, 200));
      assert(view.primary.length > 0, `empty primary: ${JSON.stringify(view)}`);
      const branchBtn = await page.$('#options .cap-branch');
      if (branchBtn) {
        await branchBtn.click();
        await waitFor(
          page,
          () => (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('创建并检出'),
          'branch sheet',
          15_000,
        );
        const sheet = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
        assert(sheet.includes('创建并检出'), `create-branch missing: ${sheet.slice(0, 200)}`);
        await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
      }
      await page.click('#close-settings');
    });
    await shot('live-git-product');

    await check('Files/Diff/MCP：真实内容或明确失败，不是空列表', async () => {
      await openDrawer(page);
      await page.click('#nav-workspace');
      await waitFor(page, () => Boolean(document.querySelector('#options .ws-tab')), 'ws tabs', 10_000);
      await clickByText(page, '#options .ws-tab', '文件');
      await waitFor(page, () => Boolean(document.querySelector('#options .file-row, #options .ext-error, #options .ext-empty')), 'files settled', 15_000);
      await clickByText(page, '#options .ws-tab', '更改');
      await waitFor(page, () => Boolean(document.querySelector('#options .diff-file, #options .ext-error, #options .ext-empty')), 'diff settled', 15_000);
      await page.click('#settings-back');
      await waitFor(page, () => (document.querySelector('#options')?.textContent || '').includes('MCP'), 'settings hub');
      await clickByText(page, '#options .link-row', 'MCP');
      await waitFor(page, () => Boolean(document.querySelector('#options .ext-row, #options .ext-error, #options .ext-empty')), 'mcp settled', 15_000);
      await page.click('#close-settings');
    });
    await shot('live-desktop-services');

    await check('新会话：已有工作区 + 无目录 + 浏览本机', async () => {
      await openDrawer(page);
      await page.click('#new-session');
      await waitFor(
        page,
        () => (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('无工作区文件夹'),
        'chooser',
      );
      const labels = await page.evaluate(
        () => [...document.querySelectorAll('#sheet-root .sheet-item')].map((node) => node.textContent),
      );
      assert(labels.some((label) => label.includes('无工作区文件夹')), `no-folder missing: ${labels}`);
      assert(labels.some((label) => label.includes('浏览本机目录')), `browse missing: ${labels}`);
      assert(labels.some((label) => label.includes('Deepseek-Harness-Desktop') || label.includes('ChisaTerminal')), `workspace missing: ${labels}`);
    });

    await check('浏览新目录并创建工作区（host.listDirectory / createDirectory / workspace.create）', async () => {
      await clickByText(page, '#sheet-root .sheet-item', '浏览本机目录');
      await waitFor(
        page,
        () => (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('使用此目录')
          || (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('无法')
          || (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('电脑没有'),
        'browse listing',
        20_000,
      );
      const listing = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
      assert(listing.includes('使用此目录'), `browse failed: ${listing.slice(0, 240)}`);
      const parentPath = await page.evaluate(() => document.querySelector('#sheet-root .sheet .row-desc')?.textContent || '');
      promptReply = FOLDER_NAME;
      await clickByText(page, '#sheet-root .sheet-item', '新建文件夹');
      await waitFor(
        page,
        () => (document.querySelector('#sheet-root .sheet .row-desc')?.textContent || '').includes(FOLDER_NAME)
          || (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('无法创建'),
        'created folder listed',
        15_000,
      );
      const afterCreate = await page.evaluate(() => document.querySelector('#sheet-root .sheet')?.textContent || '');
      assert(!afterCreate.includes('无法创建'), `createDirectory failed: ${afterCreate.slice(0, 240)}`);
      created.folderPath = path.join(parentPath, FOLDER_NAME);
      await clickByText(page, '#sheet-root .sheet-item', '使用此目录作为工作区');
      await waitFor(
        page,
        () => !document.querySelector('#sheet-root .sheet')
          || (document.querySelector('#sheet-root .sheet')?.textContent || '').includes('无法')
          || (document.querySelector('#banner')?.textContent || '').includes('无法'),
        'chooser closed or error',
        20_000,
      );
      const err = await page.evaluate(() => (
        document.querySelector('#sheet-root .sheet-error')?.textContent
        || document.querySelector('#banner')?.textContent
        || ''
      ));
      assert(!err.includes('无法'), `workspace.create failed: ${err}`);
      await sleep(500);
      const listed = await harnessRpc('workspace.list');
      const hit = (listed?.items || []).find((item) => String(item.path || '').includes(FOLDER_NAME));
      assert(hit, `created workspace missing from host workspace.list`);
      created.workspaceId = hit.workspaceId;
      created.sessionId = (hit.sessionIds || [])[0] || '';
      if (!created.sessionId) {
        const sessions = await harnessRpc('session.list');
        const row = (sessions?.items || []).find((item) => String(item.cwd || '').includes(FOLDER_NAME));
        created.sessionId = row?.sessionId || '';
      }
    });
    await shot('live-new-workspace');

    await check('Git：非仓库 Initialize Git', async () => {
      await openDrawer(page);
      await page.click('#nav-workspace');
      await waitFor(
        page,
        () => (document.querySelector('#options .cap-primary')?.textContent || '').includes('Initialize')
          || Boolean(document.querySelector('#options .git-capsule')),
        'git capsule on throwaway',
        15_000,
      );
      const primary = await page.evaluate(() => document.querySelector('#options .cap-primary')?.textContent || '');
      const body = await page.evaluate(() => document.querySelector('#options')?.textContent || '');
      assert(!body.includes('请在电脑端'), `git deferred to desktop: ${body.slice(0, 200)}`);
      if (!primary.includes('Initialize')) {
        throw new Error(`expected Initialize Git, got "${primary}" body=${body.slice(0, 160)}`);
      }
      await page.click('#options .cap-primary');
      await waitFor(
        page,
        () => {
          const label = document.querySelector('#options .cap-primary')?.textContent || '';
          return !label.includes('Initialize') || (document.querySelector('#banner')?.textContent || '').length > 0;
        },
        'init finished',
        20_000,
      );
      const after = await page.evaluate(() => ({
        primary: document.querySelector('#options .cap-primary')?.textContent || '',
        branch: document.querySelector('#options .cap-branch')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      assert(!after.banner.includes('失败') && !after.banner.includes('桌面端未启动'), `gitInit failed: ${JSON.stringify(after)}`);
      assert(
        after.branch.trim() && !after.branch.includes('—'),
        `no branch after init: ${JSON.stringify(after)}`,
      );
    });
    await shot('live-git-init');

    await check('Git：创建并检出新分支', async () => {
      await page.click('#options .cap-branch');
      await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet')), 'branch sheet', 10_000);
      await page.evaluate((name) => {
        const input = document.querySelector('#sheet-root input.paste, #sheet-root input');
        if (!input) return;
        input.value = name;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, BRANCH_NAME);
      await clickByText(page, '#sheet-root .sheet-item', '创建并检出');
      await waitFor(page, () => Boolean(document.querySelector('#dialog-root .dialog')), 'create dialog', 8000);
      await clickByText(page, '#dialog-root .dialog button', 'Create branch');
      await waitFor(
        page,
        () => (document.querySelector('#options .cap-branch')?.textContent || '').includes(BRANCH_NAME)
          || (document.querySelector('#banner')?.textContent || '').includes('失败'),
        'branch switched',
        20_000,
      );
      const branch = await page.evaluate(() => document.querySelector('#options .cap-branch')?.textContent || '');
      const banner = await page.evaluate(() => document.querySelector('#banner')?.textContent || '');
      assert(!banner.includes('失败'), `create branch failed: ${banner}`);
      assert(branch.includes(BRANCH_NAME), `branch pill: ${branch}`);
    });
    await shot('live-git-branch');

    await check('Git：Commit 一次（临时仓）后出现 Publish', async () => {
      assert(created.folderPath, 'no throwaway folder');
      await writeFile(path.join(created.folderPath, 'README.md'), 'dshd live webui qa\n', 'utf8');
      await closeOverlays(page);
      await openDrawer(page);
      await page.click('#nav-workspace');
      await waitFor(page, () => Boolean(document.querySelector('#options .cap-primary')), 'primary', 10_000);
      await sleep(800);
      const label = await page.evaluate(() => document.querySelector('#options .cap-primary')?.textContent || '');
      if (label.includes('Commit')) {
        await page.click('#options .cap-primary');
        await waitFor(page, () => Boolean(document.querySelector('#dialog-root .dialog')), 'commit dialog');
        await page.evaluate(() => {
          const input = document.querySelector('#dialog-root textarea, #dialog-root input');
          if (!input) return;
          input.value = 'dshd live qa';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await clickByText(page, '#dialog-root .dialog button', '提交');
        await waitFor(
          page,
          () => {
            const primary = document.querySelector('#options .cap-primary')?.textContent || '';
            const banner = document.querySelector('#banner')?.textContent || '';
            return primary.includes('Publish') || banner.includes('失败');
          },
          'publish or error',
          20_000,
        );
      }
      const after = await page.evaluate(() => ({
        primary: document.querySelector('#options .cap-primary')?.textContent || '',
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      assert(!after.banner.includes('失败'), `commit failed: ${JSON.stringify(after)}`);
      assert(after.primary.includes('Publish'), `expected Publish after commit, got ${after.primary}`);
      await page.click('#options .cap-primary');
      await waitFor(
        page,
        () => (document.querySelector('#dialog-root .dialog')?.textContent || '').includes('Publish'),
        'publish dialog',
      );
      const dialog = await page.evaluate(() => document.querySelector('#dialog-root .dialog')?.textContent || '');
      assert(dialog.includes('Publish repository') || dialog.includes('远程'), `publish dialog: ${dialog.slice(0, 200)}`);
      assert(!dialog.includes('请在电脑上发布') && !dialog.includes('请在电脑端发布'), dialog.slice(0, 200));
      await page.evaluate(() => document.querySelector('#dialog-root .dialog-mask')?.click());
      const cancel = await page.evaluate(() => {
        const hit = [...document.querySelectorAll('#dialog-root .dialog button')]
          .find((node) => node.textContent.includes('取消'));
        hit?.click();
        return Boolean(hit);
      });
      if (!cancel) {
        await page.evaluate(() => document.querySelector('#close-settings')?.click());
      }
    });
    await shot('live-git-publish');

    skip(
      'Git：Commit & push 一次完成（产品仓）',
      '产品仓工作区有未提交改动；实机不在用户仓库上 commit/push。stacked 标签已在脏仓胶囊上只读核对。',
    );
    skip(
      'Harness 停掉后抽屉是「桌面端未启动」',
      '会停掉你正在用的桌面 dsh web；本次不杀进程。fake-daemon QA 已覆盖该文案。',
    );

    await check('Kill-list：页面无 fetchAgents 产品路径 / 无电脑端创建分支文案', async () => {
      const body = await page.evaluate(() => document.body.innerText);
      assert(!body.includes('创建新分支请在电脑端'), body.slice(0, 120));
      assert(!body.includes('创建分支请在电脑端'), 'create-branch deferred copy');
      const hrefs = await page.evaluate(() => [...document.scripts].map((node) => node.src).join(' '));
      assert(!hrefs.includes('fetchAgents'), hrefs);
    });

    await check('控制台：无应用错误（忽略配对期间中继噪声）', async () => {
      const serious = consoleErrors.filter((line) => (
        !line.includes('favicon')
        && !line.includes('net::ERR_')
        && !/WebSocket/.test(line)
      ));
      assert(serious.length === 0, serious.slice(0, 5).join(' | '));
    });
  } finally {
    await cleanupCreated();
    await shot('live-final').catch(() => {});
    await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
    await stopBouncedDaemon();
  }

  const reportPath = path.join(SHOT_DIR, 'report.txt');
  await writeFile(reportPath, `${results.join('\n')}\n\n${results.length - failures}/${results.length} checks recorded\n`, 'utf8');
  console.log(results.join('\n'));
  console.log(`\n${results.filter((line) => line.startsWith('ok')).length} ok, ${failures} failed, ${results.filter((line) => line.startsWith('SKIP')).length} skipped`);
  console.log(`[live] screenshots ${SHOT_DIR}`);
  if (failures > 0) process.exit(1);
}

main().catch(async (error) => {
  console.error(error);
  await stopBouncedDaemon();
  process.exit(1);
});
