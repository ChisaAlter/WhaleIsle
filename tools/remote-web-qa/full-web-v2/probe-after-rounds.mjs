import { launchSpa, pairInto, pairingUrl, sleep, openDrawer, dismissOverlays, spaSessions } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await page.evaluateOnNewDocument(() => { localStorage.setItem('dshd-debug-mux', '1'); });
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  const p = await spaSessions(page);
  // the CHAT-001 session: title contains 验证码 and cwd dshd-qa-ws-2026-08-30; pick newest matching
  const target = p.rows.find((r) => !r.child && /连通|验证码/.test(r.title)) || p.rows.find((r) => !r.child);
  await page.evaluate((want) => {
    const n = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((x) => x.dataset.sessionId === want);
    n?.querySelector('.session')?.click();
  }, target.id);
  await sleep(3000);
  const before = await page.evaluate(() => ({
    title: document.querySelector('#chat-title')?.textContent,
    users: document.querySelectorAll('#log .user').length,
    approvalHidden: document.querySelector('#approval')?.classList.contains('hidden'),
    approvalText: (document.querySelector('#approval')?.textContent || '').slice(0, 80),
    readonly: (document.querySelector('#readonly-note')?.textContent || '').slice(0, 60),
    composerHidden: document.querySelector('#composer')?.classList.contains('hidden') || !document.querySelector('#composer')?.offsetParent,
    draftVisible: Boolean(document.querySelector('#draft')?.offsetParent),
    sendDisabled: document.querySelector('#send-btn')?.disabled,
    stopVisible: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
    banner: document.querySelector('#banner')?.textContent,
  }));
  console.log('before:', JSON.stringify(before));
  if (before.draftVisible) {
    await page.click('#draft');
    await page.type('#draft', '\u8fd9\u662f\u4f1a\u8bddA\u6807\u8bb0\u53e5\u3002\u8bf7\u53ea\u56de\u590d\uff1aACK-A');
    const mid = await page.evaluate(() => ({ sendDisabled: document.querySelector('#send-btn')?.disabled, draft: document.querySelector('#draft')?.value }));
    console.log('typed:', JSON.stringify(mid));
    await page.click('#send-btn');
    await sleep(3000);
    const after = await page.evaluate(() => ({
      users: document.querySelectorAll('#log .user').length,
      banner: document.querySelector('#banner')?.textContent,
      stopVisible: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
      draft: document.querySelector('#draft')?.value,
    }));
    console.log('after send:', JSON.stringify(after));
  }
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
