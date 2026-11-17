/**
 * Shared driver for the v2 full-web rehearsal (T2 rehearsal track).
 * SPA via Edge headless; desktop oracle via CDP 9229 (running source Electron).
 * Never logs full #offer=; never touches non dshd-qa workspaces for writes.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadServerApi } = require('../../../src/main/dshd-remote.js');
const { DEFAULT_RELAY_ENDPOINT } = require('../../../src/shared/lan.js');
const puppeteer = require('puppeteer-core');

/** Evidence directory: `DSH_QA_OUT` (set by run.mjs) or a dated results folder. */
export const OUT = path.resolve(process.env.DSH_QA_OUT
  || path.join(process.cwd(), 'docs', 'qa', 'results', new Date().toISOString().slice(0, 10), 'full-web-v2'));
export const RESULTS = path.join(OUT, 'results.json');
const USER_DATA = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Deepseek-Harness-Desktop');

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** The SPA the phone loaded must be the tree's current cache-bust (no stale app.js). */
export function assertFreshApp(appSrc) {
  const html = readFileSync(path.join(process.cwd(), 'mobile', 'web', 'index.html'), 'utf8');
  const want = (html.match(/app\.js\?v=([^"']+)/) || [])[1] || '';
  if (!want || !String(appSrc).includes(`v=${want}`)) throw new Error(`stale app.js: ${appSrc} (want v=${want})`);
  return want;
}

export function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
  });
}

export function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return c.find((f) => existsSync(f)) || c[0];
}

// ---------- results ----------
export function record(id, status, note = '', evidence = []) {
  let all = {};
  try { all = JSON.parse(readFileSync(RESULTS, 'utf8')); } catch { /* first */ }
  all[id] = { status, note: String(note).slice(0, 500), evidence, at: new Date().toISOString() };
  writeFileSync(RESULTS, `${JSON.stringify(all, null, 2)}\n`);
  console.log(`${status.padEnd(8)} ${id}${note ? ` — ${String(note).slice(0, 140)}` : ''}`);
}

export async function runCase(id, fn) {
  try {
    const out = await fn();
    if (out && out.status) record(id, out.status, out.note || '', out.evidence || []);
    else record(id, 'Pass', typeof out === 'string' ? out : '');
  } catch (error) {
    record(id, 'Fail', error?.message || String(error));
  }
}

// ---------- pairing ----------
export async function pairingUrl() {
  const api = await loadServerApi();
  const pairing = await api.generateLocalPairingOffer({
    chisacodeHome: path.join(USER_DATA, 'chisacode-home'),
    relayEnabled: true,
    relayEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayPublicEndpoint: DEFAULT_RELAY_ENDPOINT,
    relayUseTls: false,
    relayPublicUseTls: false,
    appBaseUrl: 'http://127.0.0.1:3180',
    includeQr: false,
  });
  const u = new URL(pairing.url);
  u.hostname = '127.0.0.1';
  return u.toString();
}

export function offerSummary(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}#offer=<${Math.max(0, u.hash.length - 7)} chars>`;
}

// ---------- SPA ----------
export async function launchSpa({ headless = true } = {}) {
  await mkdir(OUT, { recursive: true });
  for (const p of [3080, 3180, 6767]) {
    if (!(await portOpen(p))) throw new Error(`port ${p} down`);
  }
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  return { browser, page };
}

export async function waitFor(page, fn, message, timeout = 10_000, arg) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn, arg)) return;
    await sleep(100);
  }
  throw new Error(`timeout: ${message}`);
}

export async function pairInto(page, url) {
  const u = new URL(url);
  await page.goto(`${u.origin}${u.pathname}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'paste ui');
  await page.evaluate((offer) => {
    const input = document.querySelector('#paste');
    if (input) input.value = offer;
    document.querySelector('#paste-enter')?.click();
  }, url);
  await waitFor(
    page,
    () => !document.querySelector('#screen-chat')?.classList.contains('hidden')
      || Boolean(document.querySelector('#connect-error:not(.hidden)')?.textContent),
    'chat or error',
    90_000,
  );
  const view = await page.evaluate(() => ({
    chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
    error: document.querySelector('#connect-error')?.textContent || '',
  }));
  if (!view.chat) throw new Error(`pair failed: ${view.error.slice(0, 200)}`);
}

export async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelector('#close-settings')?.click();
    document.querySelector('.sheet-mask')?.click();
    document.querySelector('.dialog-mask')?.click();
    document.querySelector('#backdrop')?.click();
  });
  await sleep(250);
}

export async function openDrawer(page) {
  const open = await page.evaluate(() => document.querySelector('#phone')?.hasAttribute('data-drawer'));
  if (!open) await page.evaluate(() => document.querySelector('#menu')?.click());
  await waitFor(page, () => document.querySelector('#phone')?.hasAttribute('data-drawer'), 'drawer');
  await sleep(300);
}

export async function closeDrawer(page) {
  await page.evaluate(() => document.querySelector('#backdrop')?.click());
  await sleep(200);
}

export async function spaSessions(page) {
  await openDrawer(page);
  return page.evaluate(() => ({
    heads: [...document.querySelectorAll('#session-list .workspace-head b')].map((n) => (n.textContent || '').trim()),
    titles: [...document.querySelectorAll('#session-list .session-row:not(.workspace-head):not(.session-child) .session b')]
      .map((n) => (n.textContent || '').trim()),
    childTitles: [...document.querySelectorAll('#session-list .session-row.session-child .session b')]
      .map((n) => (n.textContent || '').trim()),
    rows: [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].map((r) => ({
      id: r.dataset.sessionId || '',
      title: (r.querySelector('.session b')?.textContent || '').trim(),
      child: r.classList.contains('session-child'),
    })),
  }));
}

export async function clickSheet(page, label, { exact = false } = {}) {
  const hit = await page.evaluate((want, exactMatch) => {
    const items = [...document.querySelectorAll('#sheet-root .sheet-item, #session-list .session-list-action')];
    const matches = items.filter((item) => {
      const title = item.querySelector('.sheet-item-main > span:first-child')?.textContent
        || (item.textContent || '').trim();
      return exactMatch ? title === want : title === want || (item.textContent || '').includes(want);
    });
    const node = exactMatch
      ? (matches.find((item) => !item.querySelector('.sheet-hint')) || matches[matches.length - 1])
      : matches[0];
    node?.click();
    return Boolean(node);
  }, label, exact);
  if (!hit) throw new Error(`sheet item missing: ${label}`);
  await sleep(400);
}

export async function fillDialog(page, value, { confirmLabel = '' } = {}) {
  await waitFor(page, () => Boolean(document.querySelector('.dialog input.paste, .dialog input')), 'dialog input');
  await page.evaluate((text) => {
    const input = document.querySelector('.dialog input.paste') || document.querySelector('.dialog input');
    if (!input) return;
    input.focus();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.evaluate((label) => {
    const btns = [...document.querySelectorAll('.dialog button')];
    const btn = label ? btns.find((b) => (b.textContent || '').trim() === label)
      : document.querySelector('.dialog .primary-btn');
    btn?.click();
  }, confirmLabel);
  await sleep(800);
}

export async function sendAndIdle(page, text, timeout = 240_000, { autoAllow = true } = {}) {
  // A session may still be running (or an approval pending) from a previous
  // step; the composer swaps Send for Stop then. Wait for idle like a user would.
  const idleStart = Date.now();
  while (Date.now() - idleStart < 60_000) {
    const busy = await page.evaluate(() => ({
      stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
      approval: !document.querySelector('#approval')?.classList.contains('hidden'),
    }));
    if (!busy.stop && !busy.approval) break;
    if (busy.approval && autoAllow) {
      await page.evaluate(() => [...document.querySelectorAll('#approval-actions button')]
        .find((b) => (b.textContent || '').includes('允许一次'))?.click());
    }
    await sleep(1000);
  }
  const before = await page.evaluate(() => document.querySelectorAll('#log .assistant').length);
  // Focus + DOM click: coordinate clicks fail once a long timeline pushes the
  // composer below the fold in the headless viewport.
  await page.evaluate(() => { const d = document.querySelector('#draft'); if (d) { d.scrollIntoView(); d.value = ''; d.focus(); } });
  await page.type('#draft', text);
  await page.evaluate(() => document.getElementById('send-btn')?.click());
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const view = await page.evaluate((prev, allow) => {
      if (allow) {
        const btn = [...document.querySelectorAll('#approval-actions button')]
          .find((b) => (b.textContent || '').includes('允许一次'));
        if (btn) btn.click();
      }
      const assistants = [...document.querySelectorAll('#log .assistant')].map((n) => n.textContent || '');
      return {
        banner: document.querySelector('#banner')?.textContent || '',
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
        lastAssistant: assistants[assistants.length - 1] || '',
        gained: assistants.length > prev,
        model: document.querySelector('#model-chip')?.textContent || '',
        access: document.querySelector('#access-chip')?.textContent || '',
        log: (document.querySelector('#log')?.textContent || '').slice(-500),
      };
    }, before, autoAllow);
    if (/无法|失败|host HTTP|typert|断开/i.test(view.banner)) throw new Error(view.banner);
    if (view.gained && view.lastAssistant.trim() && !view.stop && !view.approval) {
      await sleep(800);
      const settled = await page.evaluate(() => ({
        stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
        approval: !document.querySelector('#approval')?.classList.contains('hidden'),
      }));
      if (!settled.stop && !settled.approval) return view;
    }
    await sleep(400);
  }
  const dump = await page.evaluate(() => ({
    stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
    approval: !document.querySelector('#approval')?.classList.contains('hidden'),
    users: document.querySelectorAll('#log .user').length,
    assistants: [...document.querySelectorAll('#log .assistant')].map((n) => (n.textContent || '').slice(0, 30)),
    banner: document.querySelector('#banner')?.textContent || '',
    tail: (document.querySelector('#log')?.textContent || '').slice(-160),
  }));
  throw new Error(`idle timeout: ${text.slice(0, 24)} :: ${JSON.stringify(dump)}`);
}

// ---------- desktop oracle (CDP) ----------
export async function desktop() {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9229',
    defaultViewport: null,
    protocolTimeout: 45_000,
  });
  const page = (await browser.pages()).find((p) => p.url().includes('127.0.0.1:3080'));
  if (!page) { browser.disconnect(); throw new Error('desktop 3080 page missing'); }
  return { browser, page };
}

/** Type into desktop composer without puppeteer mouse (background-window safe). */
export async function desktopType(page, text) {
  const focused = await page.evaluate(() => {
    const el = document.querySelector('[data-composer-input]');
    if (!el) return false;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  });
  if (!focused) return 'no-input';
  const cdp = await page.createCDPSession();
  try {
    await cdp.send('Input.insertText', { text });
  } finally {
    await cdp.detach().catch(() => { /* The temporary CDP target may have already detached; preserve the original QA outcome. */ });
  }
  const got = await page.evaluate(() => (document.querySelector('[data-composer-input]')?.innerText || '').trim());
  return got.includes(text.slice(0, 8)) ? 'ok' : `mismatch:${got.slice(0, 30)}`;
}

export async function desktopSend(page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-composer-card]');
    const send = card && [...card.querySelectorAll('button')]
      .find((b) => /发送消息|send message/i.test((b.getAttribute('aria-label') || '') + b.textContent));
    if (!send || send.disabled) return false;
    send.click();
    return true;
  });
}

export async function desktopSessions(page) {
  // 1) Expand collapsed workspace folders (aria-expanded=false, excluding 已归档).
  for (let i = 0; i < 4; i += 1) {
    const expanded = await page.evaluate(() => {
      let n = 0;
      for (const el of [...document.querySelectorAll('[class*="_folder"][aria-expanded="false"], [class*="groupSection"] [aria-expanded="false"]')]) {
        const label = (el.textContent || '').trim();
        if (/已归档/.test(label)) continue;
        el.click();
        n += 1;
      }
      return n;
    });
    if (!expanded) break;
    await sleep(700);
  }
  // 2) Expansion may reveal further "展开其余 N" buttons; loop until none remain.
  for (let i = 0; i < 6; i += 1) {
    const clicked = await page.evaluate(() => {
      let n = 0;
      for (const btn of [...document.querySelectorAll('button')]) {
        if (/展开其余 \d+ 个会话/.test(btn.textContent || '')) { btn.click(); n += 1; }
      }
      return n;
    });
    if (!clicked) break;
    await sleep(700);
  }
  return page.evaluate(() => new Promise((resolve) => {
    setTimeout(() => {
      // Rows under the desktop 已归档 section are not live rows (D excludes them).
      // The desktop 已归档 block is the 已归档 header plus every group section
      // after it in document order; none of those rows belong to D.
      const archivedHead = [...document.querySelectorAll('[aria-expanded]')]
        .find((n) => /已归档/.test((n.textContent || '').trim().slice(0, 12)));
      const rows = [...document.querySelectorAll('[class*="sessionRow"]')]
        .filter((row) => !(archivedHead && (archivedHead.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)));
      const titles = [];
      const childTitles = [];
      for (const row of rows) {
        const title = (row.querySelector('[class*="title"]')?.textContent || row.textContent || '')
          .replace(/\s+/g, ' ').trim();
        if (!title) continue;
        const indent = /child|sub/i.test(String(row.className))
          || Boolean(row.closest('[class*="child"], [class*="Sub"]'));
        (indent ? childTitles : titles).push(title);
      }
      // Workspace heads via their action-button aria: 工作区“X”的操作 (CSS-hash safe).
      const heads = [...document.querySelectorAll('button[aria-label^="工作区“"]')]
        .map((b) => {
          const m = /^工作区“(.+)”的操作$/.exec(b.getAttribute('aria-label') || '');
          return m ? m[1] : '';
        }).filter(Boolean);
      resolve({ titles, childTitles, heads });
    }, 900);
  }));
}

export async function desktopComposer(page) {
  return page.evaluate(() => {
    const byAria = (re) => [...document.querySelectorAll('button')]
      .find((el) => re.test(el.getAttribute('aria-label') || ''));
    const model = byAria(/选择模型|select model/i);
    const access = byAria(/访问模式|access mode/i);
    return {
      modelAria: model ? `${model.getAttribute('aria-label')} ${model.textContent}`.replace(/\s+/g, ' ').trim() : '',
      accessAria: access ? access.getAttribute('aria-label') : '',
    };
  });
}

export async function desktopGit(page) {
  return page.evaluate(() => {
    const branch = [...document.querySelectorAll('button')]
      .find((el) => /切换分支/.test(el.getAttribute('aria-label') || ''));
    const buttons = [...document.querySelectorAll('button')].map((el) => ({
      aria: el.getAttribute('aria-label') || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    const primary = buttons.find((b) => /^(Commit & push|Commit, push & PR|Push & create PR|Publish repository|View PR|Commit|Push|Pull|Sync branch)$/.test(b.aria || b.text));
    return {
      refName: branch ? (branch.textContent || '').replace(/\s+/g, ' ').trim() : null,
      primary: primary ? (primary.aria || primary.text) : null,
    };
  });
}

/** Switch the open SPA session to Ayase grok-4.6 (spec §0.9). */
export async function switchGrok(page) {
  await dismissOverlays(page);
  await page.click('#model-chip');
  await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model pane');
  await waitFor(
    page,
    () => [...document.querySelectorAll('#options .sheet-item')].some((n) => /grok-4\.6/i.test(n.textContent || ''))
      || /读取模型失败/.test(document.querySelector('#options')?.textContent || ''),
    'model rows',
    15_000,
  );
  const switched = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#options .sheet-item')];
    const row = rows.find((n) => /grok-4\.6/i.test(n.textContent || '') && /ayase/i.test(n.textContent || ''))
      || rows.find((n) => /grok-4\.6/i.test(n.textContent || ''));
    row?.click();
    return Boolean(row);
  });
  await sleep(700);
  await page.evaluate(() => document.querySelector('#close-settings')?.click());
  if (!switched) throw new Error('session.models 无 grok-4.6');
  const chip = await page.evaluate(() => (document.querySelector('#model-chip')?.textContent || '').trim());
  if (!/grok-4\.6/i.test(chip)) throw new Error(`chip 未变: ${chip}`);
  return chip;
}

/** Ensure the desktop open session uses grok-4.6 (ModelSelect menu drive). */
export async function desktopEnsureGrok(page) {
  const label = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((el) => /选择模型|select model/i.test(el.getAttribute('aria-label') || ''));
    return btn ? `${btn.getAttribute('aria-label')} ${btn.textContent}` : '';
  });
  if (/grok-4\.6/i.test(label)) return 'already';
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((el) => /选择模型|select model/i.test(el.getAttribute('aria-label') || ''));
    btn?.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
      .find((el) => /^模型$|^Model$/i.test((el.textContent || '').trim()))
      || [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')]
        .find((el) => /模型/.test(el.textContent || ''));
    row?.click();
  });
  await sleep(500);
  const picked = await page.evaluate(() => {
    const item = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')]
      .find((el) => el.getBoundingClientRect().width > 0 && /grok-4\.6/i.test(el.textContent || ''));
    item?.click();
    return Boolean(item);
  });
  await sleep(700);
  return picked ? 'switched' : 'not-found';
}

export async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export async function desktopShot(page, name) {
  try {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, timeout: 8_000 });
    return file;
  } catch {
    return '';
  }
}
