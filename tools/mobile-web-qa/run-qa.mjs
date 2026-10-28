/**
 * Browser integration QA for the paired mobile/web SPA against the fake
 * host-tunnel DaemonClient (session.list / gitRpc / mux — not ACP agents).
 *
 * Usage: node tools/mobile-web-qa/run-qa.mjs [--screenshots <dir>] [--port 0] [--prefix /dshd/]
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
const SHOT_DIR = serverOptions.screenshots || 'docs/qa/results/2026-08-30';

const results = [];
let failures = 0;
let activePage = null;

async function check(name, fn) {
  try {
    await fn();
    results.push(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`NOT OK - ${name}: ${error?.message || error}`);
    await activePage?.screenshot({ path: join(SHOT_DIR, `failure-${failures}.png`), fullPage: true });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitFor(page, fn, message, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return;
    await sleep(60);
  }
  throw new Error(`timeout: ${message}`);
}

async function clickByText(page, selector, text) {
  const clicked = await page.evaluate((sel, needle) => {
    const nodes = [...document.querySelectorAll(sel)];
    const hit = nodes.find((node) => node.textContent.includes(needle) && !node.disabled);
    if (hit) {
      hit.click();
      return true;
    }
    return false;
  }, selector, text);
  assert(clicked, `no clickable "${text}" in ${selector}`);
}

async function qaCalls(page, method) {
  return page.evaluate(
    (name) => window.__qa.calls.filter((call) => call.method === name).map((call) => call.args),
    method,
  );
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

async function clickId(page, id) {
  const clicked = await page.evaluate((elementId) => {
    const node = document.getElementById(elementId);
    if (!node || node.disabled) return false;
    node.click();
    return true;
  }, id);
  assert(clicked, `no clickable #${id}`);
}

async function main() {
  const server = await startQaServer(serverOptions);
  const BASE = qaServerUrl(server).replace(/\/$/, '');
  let browser;
  try {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  activePage = page;
  await page.setViewport({ width: 390, height: 844 });
  const consoleErrors = [];
  page.on('console', (message) => {
    const url = message.location()?.url || '';
    if (message.type() === 'error' && !message.text().includes('favicon') && !url.includes('favicon')) {
      consoleErrors.push(`${message.text()} (${url})`);
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));
  await mkdir(SHOT_DIR, { recursive: true });
  const shot = (name) => page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
  await check('配对：offer 链接进入 chat', async () => {
    await clickId(page, 'paste-toggle');
    await page.type('#paste', `${BASE}/#offer=QAFAKE`);
    await clickId(page, 'paste-enter');
    await waitFor(page, () => !document.querySelector('#screen-chat').classList.contains('hidden'), 'chat visible');
  });

  await openDrawer(page);
  await check('抽屉：全量 session.list，无 blank / dshbot / 加载更多', async () => {
    await waitFor(page, () => document.querySelectorAll('#session-list .session').length >= 3, 'sessions rendered');
    const view = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('#session-list .session b')].map((node) => node.textContent),
      loadMore: [...document.querySelectorAll('#session-list .session-list-action')]
        .some((node) => node.textContent.includes('加载更多')),
      workspace: document.querySelector('#session-list .workspace-head')?.textContent || '',
    }));
    assert(view.titles.includes('会话 1'), `missing 会话 1: ${view.titles}`);
    assert(view.titles.includes('会话 2'), `missing 会话 2: ${view.titles}`);
    assert(!view.titles.includes('blank'), `blank leaked: ${view.titles}`);
    assert(!view.titles.includes('bot'), `dshbot leaked: ${view.titles}`);
    assert(!view.titles.includes('归档的旧会话'), `archived leaked: ${view.titles}`);
    assert(!view.loadMore, 'load-more still visible');
    assert(view.workspace.includes('mobile'), `workspace head: ${view.workspace}`);
    const lists = await qaCalls(page, 'session.list');
    assert(lists.length >= 1, 'session.list was not called');
    const agents = await qaCalls(page, 'fetchAgents');
    assert(agents.length === 0, `fetchAgents was called: ${JSON.stringify(agents)}`);
  });
  await check('子智能体：折叠在父会话下并标注', async () => {
    const child = await page.evaluate(() => {
      const row = document.querySelector('#session-list .session-row.session-child');
      return row ? row.textContent : '';
    });
    assert(child.includes('子任务'), 'child row missing');
    assert(child.includes('子智能体'), 'child row missing 子智能体 tag');
  });
  await check('活会话菜单没有删除', async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#session-list .session-row')]
        .find((node) => node.querySelector('.session b')?.textContent === '会话 2');
      row?.querySelector('.session-more')?.click();
    });
    await waitFor(page, () => document.querySelector('#sheet-root .sheet'), 'menu sheet');
    const labels = await page.evaluate(
      () => [...document.querySelectorAll('#sheet-root .sheet-item')].map((node) => node.textContent),
    );
    assert(labels.some((label) => label.includes('归档')), `archive missing: ${labels}`);
    assert(labels.some((label) => label.includes('Fork')), `fork missing: ${labels}`);
    assert(!labels.some((label) => label === '删除' || label.includes('删除会话')), `live delete leaked: ${labels}`);
    await page.evaluate(() => document.querySelector('#sheet-root .sheet-mask')?.click());
  });
  await shot('mobile-web-phase1-sessions');

  await check('搜索：session.search 展示 snippet', async () => {
    await page.evaluate(() => {
      const input = document.querySelector('#search');
      input.value = 'unique-snippet-needle';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(
      page,
      () => [...document.querySelectorAll('#session-list .session')].some((node) => node.textContent.includes('unique-snippet-needle')),
      'search snippet visible',
      3000,
    );
    const searches = await qaCalls(page, 'session.search');
    assert(searches.length >= 1, 'session.search was not called');
    await page.evaluate(() => {
      const input = document.querySelector('#search');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(250);
  });

  await check('打开会话：host history + 富渲染 + XSS 安全', async () => {
    await clickByText(page, '#session-list .session', '会话 1');
    await waitFor(page, () => document.querySelectorAll('#log > *').length > 20, 'timeline rendered');
    const state = await page.evaluate(() => ({
      rows: document.querySelectorAll('#log > *').length,
      hasOlderBtn: Boolean(document.querySelector('#log .load-older')),
      mdCode: Boolean(document.querySelector('#log .md-code')),
      mdHeading: Boolean(document.querySelector('#log .md-heading')),
      toolSummary: document.querySelector('#log .tool-row .flow-summary')?.textContent || '',
      todo: Boolean(document.querySelector('#log .todo-card')),
      changes: Boolean(document.querySelector('#log .changes-card')),
      meta: [...document.querySelectorAll('#log .meta-row')].map((node) => node.textContent).join('|'),
      errorRow: Boolean(document.querySelector('#log .turn-error')),
      reasoning: Boolean(document.querySelector('#log .think-body')),
      injectedImg: Boolean(document.querySelector('#log .assistant img')),
      literalImgText: [...document.querySelectorAll('#log .assistant')]
        .some((node) => node.textContent.includes('<img src=x onerror=alert(1)>')),
      link: document.querySelector('#log .assistant a')?.href || '',
    }));
    assert(state.hasOlderBtn, 'load-older button missing');
    assert(state.mdCode && state.mdHeading, 'markdown blocks missing');
    assert(state.toolSummary.includes('npm test'), 'tool detail summary missing');
    assert(state.todo && state.changes && state.errorRow && state.reasoning, 'rich rows missing');
    assert(state.meta.includes('上下文已压缩') || state.meta.includes('压缩'), `compaction meta: ${state.meta}`);
    assert(state.meta.includes('qa_future_kind'), `unknown-type fallback: ${state.meta}`);
    assert(!state.injectedImg && state.literalImgText, 'raw HTML was not neutralized');
    assert(state.link === 'https://example.com/doc', 'markdown link missing');
  });
  await shot('mobile-web-phase1-timeline');

  await check('向上分页：seq 去重 + 滚动锚点保持', async () => {
    const anchor = await page.evaluate(() => {
      const log = document.querySelector('#log');
      log.scrollTop = 120;
      const row = log.children[3];
      return { text: row.textContent, offsetBefore: row.getBoundingClientRect().top };
    });
    await page.evaluate(() => document.querySelector('#log .load-older').click());
    await waitFor(page, () => document.querySelectorAll('#log > *').length > 100, 'older entries merged');
    const after = await page.evaluate((needle) => {
      const log = document.querySelector('#log');
      const row = [...log.children].find((node) => node.textContent === needle);
      return {
        offsetAfter: row ? row.getBoundingClientRect().top : NaN,
        hasOlderBtn: Boolean(log.querySelector('.load-older')),
      };
    }, anchor.text);
    assert(
      Math.abs(after.offsetAfter - anchor.offsetBefore) <= 2,
      `scroll anchor moved ${anchor.offsetBefore} → ${after.offsetAfter}`,
    );
  });

  const emitMuxEvent = (seq, text) => page.evaluate((eventSeq, eventText) => {
    window.__qa.emitMux({
      rpcId: `mux-${eventSeq}`,
      envelope: {
        payload: {
          type: 'session/event',
          sessionId: 's-1',
          event: {
            type: 'assistant/message',
            seq: eventSeq,
            data: { message: { content: [{ type: 'text', text: eventText }] } },
          },
        },
      },
    });
  }, seq, text);

  await check('流事件：阅读历史时保持位置不拉底', async () => {
    const before = await page.evaluate(() => {
      const log = document.querySelector('#log');
      log.scrollTop = 300;
      return { rows: log.children.length, scrollTop: log.scrollTop };
    });
    await emitMuxEvent(500, '阅读历史时到达的流事件');
    await waitFor(
      page,
      () => [...document.querySelectorAll('#log .assistant')]
        .some((node) => node.textContent.includes('阅读历史时到达的流事件')),
      'stream row appended',
    );
    const after = await page.evaluate(() => {
      const log = document.querySelector('#log');
      return { rows: log.children.length, scrollTop: log.scrollTop };
    });
    assert(after.rows === before.rows + 1, `rows ${before.rows} → ${after.rows}`);
    assert(after.scrollTop === before.scrollTop, `scrollTop yanked ${before.scrollTop} → ${after.scrollTop}`);
  });

  await check('打开会话失败：清空旧内容并显示错误占位', async () => {
    await page.click('#menu');
    await page.evaluate(() => window.__qa.setFail('session.history', 'timeline exploded'));
    await clickByText(page, '#session-list .session', '会话 3');
    await waitFor(
      page,
      () => Boolean(document.querySelector('#log .timeline-error')),
      'error placeholder rendered',
    );
    const view = await page.evaluate(() => ({
      rows: document.querySelector('#log').children.length,
      placeholder: document.querySelector('#log .timeline-error')?.textContent || '',
      staleAssistant: [...document.querySelectorAll('#log .assistant')].length,
    }));
    assert(view.rows === 1, `stale rows still in log: ${view.rows}`);
    assert(view.staleAssistant === 0, 'previous session rows leaked under the new session');
    assert(view.placeholder.includes('载入会话失败'), `placeholder copy: ${view.placeholder}`);
    assert(view.placeholder.includes('timeline exploded'), 'daemon error text missing from placeholder');
  });
  await shot('mobile-web-phase3-open-failure');

  await check('打开会话失败：重试恢复时间线', async () => {
    await clickByText(page, '#log .timeline-error button', '重试');
    await waitFor(
      page,
      () => !document.querySelector('#log .timeline-error')
        && document.querySelectorAll('#log > *').length >= 2,
      'retry recovered the timeline',
    );
    await page.click('#menu');
    await clickByText(page, '#session-list .session', '会话 1');
    await waitFor(page, () => document.querySelectorAll('#log > *').length > 20, 's-1 reopened');
  });

  await check('斜杠命令：/ 弹出 host 命令', async () => {
    await page.focus('#draft');
    await page.type('#draft', '/');
    await waitFor(page, () => document.querySelectorAll('#slash-pop .slash-item').length >= 2, 'slash popup');
    const names = await page.evaluate(
      () => [...document.querySelectorAll('#slash-pop .slash-item b')].map((node) => node.textContent),
    );
    assert(names.some((name) => name.includes('/permission')), `slash: ${names}`);
    await page.evaluate(() => {
      const input = document.querySelector('#draft');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await shot('mobile-web-phase1-slash');

  await check('模型：chip 显示 effort；selectModel；无 reasoning 的模型无假档', async () => {
    await waitFor(page, () => document.querySelector('#model-chip').textContent.includes('R3'), 'model chip');
    const chip = await page.evaluate(() => document.querySelector('#model-chip').textContent);
    assert(chip.includes('high'), `effort missing on chip: ${chip}`);
    await page.click('#model-chip');
    await waitFor(page, () => document.querySelectorAll('#sheet-root .mode-row').length >= 2, 'model rows');
    const copy = await page.evaluate(() => document.querySelector('#sheet-root').textContent);
    assert(copy.includes('含思考档'), 'reasoning hint missing on R3');
    await clickByText(page, '#sheet-root .mode-row', 'Lite');
    await waitFor(page, () => document.querySelector('#model-chip').textContent.includes('Lite'), 'chip updated');
    await page.click('#model-chip');
    const afterLite = await page.evaluate(() => document.querySelector('#sheet-root').textContent);
    assert(!afterLite.includes('思考强度'), `fake effort chip after Lite: ${afterLite}`);
    const selects = await qaCalls(page, 'session.selectModel');
    assert(selects.length >= 1, 'session.selectModel was not called');
    await clickByText(page, '#sheet-root .mode-row', 'DeepSeek R3');
    await waitFor(page, () => document.querySelector('#model-chip').textContent.includes('R3'), 'R3 selected');
    await page.click('#model-chip');
    await waitFor(page, () => document.querySelector('#sheet-root').textContent.includes('思考强度'), 'effort rows');
    await clickByText(page, '#sheet-root .effort-option', 'Low');
    await waitFor(page, () => document.querySelector('#model-chip').textContent.includes('low'), 'effort chip');
    await closeOverlays(page);
  });
  await shot('mobile-web-phase1-model');

  await check('审批：mux approval/requested → hostRpc respond', async () => {
    await page.evaluate(() => {
      window.__qa.emitMux({
        rpcId: 'r-approve',
        envelope: {
          type: 'server-request',
          rpcId: 'r-approve',
          payload: {
            type: 'approval/requested',
            sessionId: 's-1',
            approvalId: 'a-1',
            toolName: 'bash',
            reason: 'rm -rf build',
          },
        },
      });
    });
    await waitFor(page, () => !document.querySelector('#approval').classList.contains('hidden'), 'approval visible');
    await shot('mobile-web-phase1-approval');
    await clickByText(page, '#approval-actions button', '允许一次');
    await waitFor(page, () => document.querySelector('#approval').classList.contains('hidden'), 'approval cleared');
    const responds = await qaCalls(page, 'respond');
    assert(responds.length >= 1, 'respond was not called');
  });

  await check('审批：跨端 approval/resolved 清除 pending', async () => {
    await page.evaluate(() => {
      window.__qa.emitMux({
        rpcId: 'r-approve-2',
        envelope: {
          payload: {
            type: 'approval/requested',
            sessionId: 's-1',
            approvalId: 'a-2',
            toolName: 'bash',
            reason: 'ls',
          },
        },
      });
    });
    await waitFor(page, () => !document.querySelector('#approval').classList.contains('hidden'), 'approval visible');
    await page.evaluate(() => {
      window.__qa.emitMux({
        rpcId: 'r-resolve',
        envelope: { type: 'approval/resolved', approvalId: 'a-2' },
      });
    });
    await waitFor(page, () => document.querySelector('#approval').classList.contains('hidden'), 'cleared remotely');
  });

  await check('草稿：文本随会话切换互不串', async () => {
    await page.focus('#draft');
    await page.type('#draft', '会话1的草稿');
    await page.click('#menu');
    await clickByText(page, '#session-list .session', '会话 2');
    await waitFor(page, () => document.querySelector('#draft').value === '', 's-2 draft empty');
    await page.focus('#draft');
    await page.type('#draft', '会话2的草稿');
    await page.click('#menu');
    await clickByText(page, '#session-list .session', '会话 1');
    await waitFor(page, () => document.querySelector('#draft').value === '会话1的草稿', 's-1 draft restored');
  });

  await check('子智能体打开为只读', async () => {
    await page.click('#menu');
    await clickByText(page, '#session-list .session-child .session', '子任务');
    await waitFor(page, () => !document.querySelector('#readonly-note').classList.contains('hidden'), 'readonly note');
    const view = await page.evaluate(() => ({
      note: document.querySelector('#readonly-note').textContent,
      composerHidden: document.querySelector('#composer').classList.contains('hidden'),
    }));
    assert(view.note.includes('子智能体会话（只读）'), `note: ${view.note}`);
    assert(view.composerHidden, 'composer must hide for read-only');
  });
  await shot('mobile-web-phase1-readonly');

  await check('重命名：host session.rename 后更新标题', async () => {
    await page.click('#menu');
    const opened = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#session-list .session-row')]
        .find((node) => node.querySelector('.session b')?.textContent === '会话 2');
      row?.querySelector('.session-more')?.click();
      return Boolean(row);
    });
    assert(opened, 'session-more for 会话 2 missing');
    await waitFor(page, () => document.querySelector('#sheet-root .sheet'), 'menu sheet open');
    await clickByText(page, '#sheet-root .sheet-item', '重命名');
    await waitFor(page, () => document.querySelector('#dialog-root .dialog input'), 'rename dialog');
    await page.evaluate(() => {
      const input = document.querySelector('#dialog-root .dialog input');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#dialog-root .dialog input', 'QA 改名');
    await clickByText(page, '#dialog-root .dialog button', '保存');
    await waitFor(
      page,
      () => !document.querySelector('#dialog-root .dialog')
        && [...document.querySelectorAll('#session-list .session b')].some((node) => node.textContent === 'QA 改名'),
      'renamed row visible',
    );
    const calls = await qaCalls(page, 'session.rename');
    assert(calls.length >= 1, 'session.rename was not called');
  });

  await check('归档：活会话归档后离开抽屉', async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#session-list .session-row')]
        .find((node) => node.textContent.includes('QA 改名'));
      row.querySelector('.session-more').click();
    });
    await clickByText(page, '#sheet-root .sheet-item', '归档');
    await waitFor(page, () => document.querySelector('#dialog-root .dialog'), 'confirm dialog');
    await clickByText(page, '#dialog-root .dialog button', '归档');
    await waitFor(
      page,
      () => ![...document.querySelectorAll('#session-list .session b')].some((node) => node.textContent === 'QA 改名'),
      'archived row left drawer',
    );
    const calls = await qaCalls(page, 'workspace.archiveSession');
    assert(calls.length >= 1, 'workspace.archiveSession was not called');
  });

  await check('已归档：取消归档 / 删除走 host', async () => {
    await clickByText(page, '#session-list .session-list-action', '已归档会话');
    await waitFor(page, () => document.querySelector('#sheet-root .sheet')?.textContent.includes('归档的旧会话'), 'history sheet');
    const labels = await page.evaluate(
      () => [...document.querySelectorAll('#sheet-root .sheet-item')].map((node) => node.textContent),
    );
    assert(labels.some((label) => label.includes('删除')), `delete archived missing: ${labels}`);
    await clickByText(page, '#sheet-root .sheet-item', '归档的旧会话');
    await waitFor(
      page,
      () => [...document.querySelectorAll('#session-list .session b')].some((node) => node.textContent === '归档的旧会话'),
      'unarchived into drawer',
    );
    const unarchive = await qaCalls(page, 'workspace.unarchiveSession');
    assert(unarchive.length >= 1, 'workspace.unarchiveSession was not called');
    await closeOverlays(page);
  });

  await check('新会话：已有工作区 + 无目录 + 浏览本机；零 createAgent', async () => {
    await openDrawer(page);
    await clickId(page, 'new-session');
    await waitFor(page, () => document.querySelector('#sheet-root .sheet')?.textContent.includes('无工作区文件夹'), 'chooser');
    const labels = await page.evaluate(
      () => [...document.querySelectorAll('#sheet-root .sheet-item')].map((node) => node.textContent),
    );
    assert(labels.some((label) => label.includes('mobile')), `workspace missing: ${labels}`);
    assert(labels.some((label) => label.includes('浏览本机目录')), `browse missing: ${labels}`);
    await clickByText(page, '#sheet-root .sheet-item', '浏览本机目录');
    await waitFor(page, () => document.querySelector('#sheet-root .sheet')?.textContent.includes('使用此目录'), 'browse listing');
    const clickedDir = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('#sheet-root .sheet-item')]
        .find((node) => node.querySelector('.sheet-item-main span')?.textContent === 'new-app');
      if (!hit) return false;
      hit.click();
      return true;
    });
    assert(clickedDir, 'new-app directory row missing');
    await waitFor(page, () => document.querySelector('#sheet-root .sheet')?.textContent.includes('/repo/new-app'), 'entered new-app');
    await clickByText(page, '#sheet-root .sheet-item', '使用此目录作为工作区');
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet'), 'chooser closed');
    const created = await qaCalls(page, 'workspace.create');
    const sessions = await qaCalls(page, 'session.create');
    const agents = await qaCalls(page, 'createAgent');
    assert(created.length >= 1, 'workspace.create was not called');
    assert(sessions.length >= 1, 'session.create was not called');
    assert(agents.length === 0, `createAgent leaked: ${JSON.stringify(agents)}`);
  });

  await check('Git：胶囊 Commit & push；创建并检出分支', async () => {
    await openDrawer(page);
    await clickByText(page, '#session-list .session', '会话 1');
    await waitFor(page, () => document.querySelectorAll('#log > *').length > 2, 's-1 open');
    await openDrawer(page);
    await clickId(page, 'nav-workspace');
    await waitFor(page, () => document.querySelector('#options .git-capsule'), 'git capsule');
    const primary = await page.evaluate(() => document.querySelector('#options .cap-primary')?.textContent || '');
    assert(primary.includes('Commit & push') || primary.includes('Commit'), `primary: ${primary}`);
    // refreshGit can replace the capsule between pointer-down and pointer-up.
    // Dispatch on the current control, then verify the actual branch RPC/UI.
    await page.$eval('#options .cap-branch', (node) => node.click());
    await waitFor(page, () => document.querySelector('#sheet-root .sheet')?.textContent.includes('创建并检出'), 'branch sheet');
    await page.evaluate(() => {
      const input = document.querySelector('#sheet-root input.paste');
      input.value = 'qa-branch';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickByText(page, '#sheet-root .sheet-item', '创建并检出分支「qa-branch」');
    await waitFor(page, () => document.querySelector('#dialog-root .dialog'), 'create dialog');
    await clickByText(page, '#dialog-root .dialog button', 'Create branch');
    await waitFor(
      page,
      () => window.__qa.calls.some((call) => call.method === 'git-create-branch' || (call.method === 'gitRpc' && call.args[0] === 'git-create-branch')),
      'git-create-branch called',
    );
    await page.click('#close-settings');
  });

  await check('Git：Commit & push 先 commit 再 push', async () => {
    await openDrawer(page);
    await clickId(page, 'nav-workspace');
    await waitFor(page, () => document.querySelector('#options .git-capsule'), 'git capsule');
    await page.evaluate(() => {
      window.__qa.world.git.hasWorkingTreeChanges = true;
      window.__qa.world.git.hasUpstream = true;
      window.__qa.world.git.isDefaultRef = true;
      window.__qa.world.git.refName = 'main';
    });
    await closeOverlays(page);
    await openDrawer(page);
    await clickId(page, 'nav-workspace');
    await waitFor(page, () => (document.querySelector('#options .cap-primary')?.textContent || '').includes('Commit'), 'primary restored');
    const label = await page.evaluate(() => document.querySelector('#options .cap-primary')?.textContent || '');
    if (label.includes('Commit & push')) {
      await page.click('#options .cap-primary');
      await waitFor(page, () => document.querySelector('#dialog-root .dialog'), 'commit dialog');
      await clickByText(page, '#dialog-root .dialog button', '提交');
      await waitFor(
        page,
        () => {
          const git = window.__qa.calls.filter((call) => call.method === 'gitRpc').map((call) => call.args[0]);
          const commit = git.lastIndexOf('git-commit');
          const push = git.lastIndexOf('git-push');
          return commit >= 0 && push > commit;
        },
        'commit then push',
      );
    }
    await page.click('#close-settings');
  });

  await check('Files/Diff/MCP：正式服务的真实内容，不是空列表', async () => {
    await openDrawer(page);
    await clickId(page, 'nav-workspace');
    await waitFor(page, () => document.querySelector('#options .diff-file'), 'git-diff files');
    await clickByText(page, '#options .ws-tab', '文件');
    await waitFor(page, () => [...document.querySelectorAll('#options .file-name')].some((node) => node.textContent === 'README.md'), 'workspaceFiles.list rows');
    await page.click('#settings-back');
    await clickByText(page, '#options .link-row', 'MCP');
    await waitFor(page, () => document.querySelectorAll('#options .ext-row').length > 0, 'mcpServers.list rows');
    await page.click('#close-settings');
  });
  await shot('mobile-web-phase2-files');

  await check('Kill-list：全程零 fetchAgents/createAgent/写文件 RPC', async () => {
    const banned = await page.evaluate(() => {
      const names = [
        'fetchAgents', 'createAgent', 'writeFile', 'saveFile',
        'upsertAgentMcpServer', 'git-stage',
      ];
      return window.__qa.calls.filter((call) => names.includes(call.method)).map((call) => call.method);
    });
    assert(banned.length === 0, `banned RPCs: ${banned.join(', ')}`);
  });

  await check('已保存电脑：断开后连接页列出其它电脑', async () => {
    await closeOverlays(page);
    await openDrawer(page);
    await clickId(page, 'open-settings');
    await clickByText(page, '#options .link-row', '连接详情');
    await page.evaluate(() => {
      const key = 'dsh-chisacode-device-secrets';
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      all['qa-second'] = {
        deviceId: 'dev_qa2', deviceSecret: 'secret_qa2',
        daemonPublicKeyB64: 'pk2', relayEndpoint: '10.0.0.2:8411',
        computerName: 'Whale Office',
        savedAt: Date.now() - 86400000,
      };
      all['qa-third'] = {
        deviceId: 'dev_qa3', deviceSecret: 'secret_qa3',
        daemonPublicKeyB64: 'pk3', relayEndpoint: '10.0.0.3:8411',
        computerName: 'Whale Studio',
        savedAt: Date.now() - 1000,
      };
      localStorage.setItem(key, JSON.stringify(all));
    });
    await clickByText(page, '#options button', '断开这台设备');
    await waitFor(page, () => !document.querySelector('#screen-connect').classList.contains('hidden'), 'connect screen');
    const view = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('#saved-computers .saved-open')].map((row) => row.textContent),
      secrets: Object.keys(JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets') || '{}')),
    }));
    assert(!view.secrets.includes('qa-server'), 'disconnect must clear the active secret');
    assert(view.rows.length === 2, `saved rows: ${JSON.stringify(view.rows)}`);
    assert(view.rows[0].includes('Whale Studio'), `readable name + newest first: ${view.rows[0]}`);
    assert(!view.rows.some((row) => row.includes('qa-second') || row.includes('qa-third')), `server ids stay hidden: ${JSON.stringify(view.rows)}`);
  });
  await shot('mobile-web-phase3-saved-computers');

  await check('已保存电脑：忘记移除该台', async () => {
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#saved-computers .saved-row')]
        .find((node) => node.textContent.includes('Whale Studio'));
      row.querySelector('.saved-forget').click();
    });
    await waitFor(
      page,
      () => document.querySelectorAll('#saved-computers .saved-row').length === 1,
      'row removed after forget',
    );
  });

  await check('已保存电脑：点选后 sticky 重连走 session.list', async () => {
    await page.evaluate(() => {
      window.__qa.calls = window.__qa.calls.filter((call) => call.method !== 'session.list');
      const row = [...document.querySelectorAll('#saved-computers .saved-row')]
        .find((node) => node.textContent.includes('Whale Office'));
      row.querySelector('.saved-open').click();
    });
    await waitFor(page, () => !document.querySelector('#screen-chat').classList.contains('hidden'), 'chat visible');
    await waitFor(page, () => window.__qa.calls.some((call) => call.method === 'session.list'), 'session.list after reconnect');
    const agents = await qaCalls(page, 'fetchAgents');
    assert(agents.length === 0, 'fetchAgents after reconnect');
  });

  await check('Harness 未就绪：抽屉明示桌面端未启动', async () => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/?qa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      await import(new URL('./chisacode/daemon-client.bundle.js', location.href).href);
    });
    await waitFor(page, () => Boolean(window.__qa), 'fake host world loaded');
    await page.evaluate(() => window.__qa.setFail('session.list', '桌面端未启动'));
    await waitFor(
      page,
      () => !document.querySelector('#screen-connect').classList.contains('hidden'),
      'connect screen',
    );
    await clickId(page, 'paste-toggle');
    await page.type('#paste', `${BASE}/#offer=QAFAKE`);
    await clickId(page, 'paste-enter');
    await waitFor(page, () => !document.querySelector('#screen-chat').classList.contains('hidden'), 'chat visible');
    await openDrawer(page);
    await waitFor(
      page,
      () => (document.querySelector('#session-list')?.textContent || '').includes('桌面端未启动'),
      'harness-down copy',
    );
    const titles = await page.evaluate(
      () => [...document.querySelectorAll('#session-list .session b')].map((node) => node.textContent),
    );
    assert(!titles.includes('新会话') || titles.length === 0, `empty new-session pretend: ${titles}`);
  });

  await check('控制台：0 应用错误', async () => {
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(' | ')}`);
  });

  await check('目录同步失败：抽屉重试恢复真实目录', async () => {
    await clickByText(page, '#session-list button', '重试');
    await waitFor(page, () => document.querySelectorAll('#session-list .session').length >= 3, 'catalog retry');
    assert(!(await page.$eval('#banner', (node) => node.textContent)), 'sync error did not clear');
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
