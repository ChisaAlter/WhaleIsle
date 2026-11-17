import { launchSpa, pairInto, pairingUrl, runCase, sleep, openDrawer, dismissOverlays } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await sleep(2500);
  await runCase('SRCH-001', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    const immediate = await page.evaluate(() => {
      const s = document.querySelector('#search');
      s.value = '\u9a8c\u8bc1\u7801';
      s.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        rows: document.querySelectorAll('#session-list .session-row:not(.workspace-head)').length,
        text: (document.querySelector('#session-list')?.textContent || '').slice(0, 30),
      };
    });
    if (immediate.rows > 0) throw new Error(`\u9632\u6296\u7a97\u53e3\u4ecd\u663e\u793a ${immediate.rows} \u884c`);
    let settled = null;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await sleep(1500);
      settled = await page.evaluate(() => ({
        rows: document.querySelectorAll('#session-list .session-row:not(.workspace-head)').length,
        more: /\u66f4\u591a|\u8fd8\u6709/.test(document.querySelector('#session-list')?.textContent || ''),
        text: (document.querySelector('#session-list')?.textContent || '').slice(0, 40),
        banner: document.querySelector('#banner')?.textContent || '',
      }));
      if (settled.rows > 0 || settled.banner) break;
    }
    if (settled.rows < 1 || settled.rows > 20) throw new Error(`\u547d\u4e2d ${settled.rows} text=${settled.text} banner=${settled.banner}`);
    await page.evaluate(() => { const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await sleep(800);
    const back = await page.evaluate(() => document.querySelectorAll('#session-list .session-row:not(.workspace-head)').length);
    return { status: 'Pass', note: `\u8f93\u5165\u5373\u5207\u641c\u7d22\u6001\uff08\u201c${immediate.text}\u201d\uff09\uff1b3s \u540e ${settled.rows} \u884c\uff08\u226420${settled.more ? '\uff0c\u6709\u66f4\u591a\u63d0\u793a' : ''}\uff09\uff1b\u6e05\u7a7a\u540e\u56de\u5230 ${back} \u884c\u5168\u91cf` };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
