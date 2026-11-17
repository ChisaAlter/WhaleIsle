import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, clickSheet, waitFor, desktop, desktopSessions } from './lib.mjs';

const WANT = ['\u8bf7\u53ea\u56de\u590d\uff1aSEED', 'SEED', 'dshd-qa-bk-841217'];
const { browser: dBrowser, page: dPage } = await desktop();
await desktopSessions(dPage);
const deskInfo = await dPage.evaluate((want) => {
  const archivedHead = [...document.querySelectorAll('[aria-expanded]')].find((n) => /已归档/.test((n.textContent || '').trim().slice(0, 12)));
  const out = [];
  for (const row of document.querySelectorAll('[class*="sessionRow"]')) {
    const title = (row.querySelector('[class*="title"]')?.textContent || '').trim();
    if (!want.includes(title)) continue;
    let cur = row; let head = '';
    while (cur && !head) {
      const prev = cur.previousElementSibling;
      const label = prev?.querySelector?.('button[aria-label^="工作区“"]')?.getAttribute('aria-label') || '';
      if (label) head = label;
      cur = prev || cur.parentElement;
      if (cur === document.body) break;
    }
    out.push({
      title,
      afterArchivedHead: archivedHead ? Boolean(archivedHead.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      section: (row.closest('[class*="groupSection"]')?.querySelector('button[aria-label^="工作区“"]')?.getAttribute('aria-label')) || '(no ws label in section)',
    });
  }
  return out;
}, WANT);
console.log('desktop:', JSON.stringify(deskInfo, null, 1));
dBrowser.disconnect();

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  await clickSheet(page, '\u5df2\u5f52\u6863\u4f1a\u8bdd');
  await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('\u5df2\u5f52\u6863'), 'history');
  const arch = await page.evaluate((want) => [...document.querySelectorAll('#sheet-root .sheet-item')]
    .map((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '').trim())
    .filter((t) => want.includes(t)), WANT);
  console.log('phone archived sheet has:', JSON.stringify(arch));
  await dismissOverlays(page);
  const ws = await page.evaluate(() => window.__dshdDebug ? 'dbg' : 'no-dbg');
  console.log(ws);
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
