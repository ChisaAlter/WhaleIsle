import { assertFreshApp, launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions, switchGrok } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await sleep(2000);
  const appSrc = await page.evaluate(() => document.querySelector('script[type="module"]')?.src || '');
  assertFreshApp(appSrc);
  await dismissOverlays(page);
  await openDrawer(page);
  const p = await spaSessions(page);
  const target = p.rows.find((r) => !r.child && /DRAFTPROBE|PING2/.test(r.title)) || p.rows.find((r) => !r.child);
  await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((n) => n.dataset.sessionId === want);
    row?.querySelector('.session')?.click();
  }, target.id);
  await sleep(2500);
  await switchGrok(page);
  await sleep(500);
  const usersBefore = await page.evaluate(() => document.querySelectorAll('#log .user').length);
  await page.evaluate(async () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'qa.png', { type: 'image/png' });
    const input = document.querySelector('#file-gallery');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(1200);
  await page.click('#draft');
  await page.type('#draft', '\u8bf7\u53ea\u56de\u590d\u4e00\u884c\uff1a\u6536\u5230\u56fe\u7247');
  await page.click('#send-btn');
  await sleep(2500);
  const view = await page.evaluate((n) => ({
    banner: document.querySelector('#banner')?.textContent || '',
    usersGained: document.querySelectorAll('#log .user').length - n,
    railVisible: !document.querySelector('#attach-rail')?.classList.contains('hidden'),
    chip: document.querySelector('#model-chip')?.textContent,
  }), usersBefore);
  console.log(JSON.stringify(view));
  await page.screenshot({ path: 'docs/qa/results/2026-09-01/full-web-v2/cmp-021-attach-guard.png' });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
