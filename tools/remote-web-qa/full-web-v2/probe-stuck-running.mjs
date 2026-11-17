import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, spaSessions } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  const p = await spaSessions(page);
  const target = p.rows.find((r) => !r.child && /连通|验证码/.test(r.title)) || p.rows.find((r) => !r.child);
  await page.evaluate((want) => {
    const n = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((x) => x.dataset.sessionId === want);
    n?.querySelector('.session')?.click();
  }, target.id);
  await sleep(3000);
  const info = await page.evaluate(async (sid) => {
    const list = await window.__dshdDebug.hostCall('session.list', {});
    const items = list?.items || list?.value?.items || list;
    const row = (Array.isArray(items) ? items : []).find((s) => s.sessionId === sid);
    const hist = await window.__dshdDebug.hostCall('session.history', { sessionId: sid, maxMessages: 40 });
    const h = hist?.value || hist;
    const events = (h?.events || h?.records || []).map((e) => e?.event || e);
    return {
      listRunning: row?.running,
      listMeta: row?.projections?.values?.sessionListMetadata,
      histKeys: Object.keys(h || {}),
      tailTypes: events.slice(-12).map((e) => `${e?.type}@${e?.seq}`),
      stopVisible: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
      runFlag: !document.querySelector('#run-flag')?.classList.contains('hidden'),
    };
  }, target.id);
  console.log(JSON.stringify(info, null, 1));
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
