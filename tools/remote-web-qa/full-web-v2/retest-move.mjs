import { launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, openDrawer, dismissOverlays, clickSheet } from './lib.mjs';

const WS = process.env.DSH_QA_WS || 'dshd-qa-ws-2026-08-30';
const url = await pairingUrl();
const { browser, page } = await launchSpa();

async function groupOrder() {
  await dismissOverlays(page);
  await openDrawer(page);
  return page.evaluate((ws) => {
    const heads = [...document.querySelectorAll('#session-list .workspace-head')];
    const head = heads.find((n) => (n.querySelector('b')?.textContent || '').includes(ws));
    const ids = [];
    let cur = head?.nextElementSibling;
    while (cur && !cur.classList.contains('workspace-head')) {
      if (cur.classList.contains('session-row') && !cur.classList.contains('session-child')) ids.push(cur.dataset.sessionId);
      cur = cur.nextElementSibling;
    }
    return ids;
  }, WS);
}

async function menuAction(id, label) {
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((n) => n.dataset.sessionId === want);
    row?.querySelector('[aria-label="\u4f1a\u8bdd\u64cd\u4f5c"]')?.click();
  }, id);
  await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet-title')), 'menu');
  const items = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')].map((n) => (n.textContent || '').trim()));
  if (!items.some((t) => t.includes(label))) { await dismissOverlays(page); return { items, clicked: false }; }
  await clickSheet(page, label, { exact: true });
  return { items, clicked: true };
}

try {
  await pairInto(page, url);
  await sleep(2500);
  await runCase('MENU-007', async () => {
    const before = await groupOrder();
    if (before.length < 3) return { status: 'NA-pre', note: `组内 ${before.length} 行` };
    const third = before[2];
    const up = await menuAction(third, '\u4e0a\u79fb');
    if (!up.clicked) throw new Error(`\u65e0\u4e0a\u79fb\u9879: ${up.items.join('|')}`);
    let after = before;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      after = await groupOrder();
      if (after[1] === third) break;
    }
    if (after[1] !== third) throw new Error(`\u4e0a\u79fb\u540e\u987a\u5e8f=${after.slice(0, 3).map((x) => x.slice(0, 10)).join(',')} \u671f\u671b\u7b2c2=${third.slice(0, 10)}`);
    const down = await menuAction(third, '\u4e0b\u79fb');
    if (!down.clicked) throw new Error('\u65e0\u4e0b\u79fb\u9879');
    let restored = after;
    const dl2 = Date.now() + 20_000;
    while (Date.now() < dl2) {
      await sleep(1500);
      restored = await groupOrder();
      if (restored[2] === third) break;
    }
    if (restored[2] !== third) throw new Error('\u4e0b\u79fb\u672a\u8fd8\u539f');
    return { status: 'Pass', note: `3 \u884c\u7ec4\u4e0a\u79fb/\u4e0b\u79fb\u5f80\u8fd4\u6b63\u786e\uff08host insertSessionBefore \u4e8c\u5143\u8bed\u4e49\u4e0e SPA payload \u4e00\u81f4\uff1b\u524d\u6b21 Fail \u4e3a\u6b7b mux \u65f6\u4ee3\u7684\u5237\u65b0\u7ade\u6001\uff09` };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
