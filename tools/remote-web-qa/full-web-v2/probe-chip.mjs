import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  const p = await spaSessions(page);
  const row = p.rows.find((r) => !r.child);
  await page.evaluate((want) => {
    const n = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((x) => x.dataset.sessionId === want);
    n?.querySelector('.session')?.click();
  }, row.id);
  await sleep(1500);
  const before = await page.evaluate(() => {
    const el = document.getElementById('access-chip');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, top: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 30)}` : 'none', drawer: document.querySelector('#phone')?.hasAttribute('data-drawer'), backdropHidden: document.querySelector('#backdrop')?.classList.contains('hidden') };
  });
  console.log('after openSid:', JSON.stringify(before));
  await dismissOverlays(page);
  await page.evaluate(() => document.querySelector('#backdrop')?.click());
  await sleep(400);
  const after = await page.evaluate(() => {
    const el = document.getElementById('access-chip');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { top: top ? `${top.tagName}#${top.id}.${String(top.className).slice(0, 30)}` : 'none', drawer: document.querySelector('#phone')?.hasAttribute('data-drawer'), viewport: { w: window.innerWidth, h: window.innerHeight } };
  });
  console.log('after dismiss:', JSON.stringify(after));
  try { await page.click('#access-chip'); console.log('click ok'); } catch (e) { console.log('click failed:', String(e.message).slice(0, 80)); }
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
