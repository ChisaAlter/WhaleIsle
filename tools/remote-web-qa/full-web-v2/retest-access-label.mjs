import { launchSpa, pairInto, pairingUrl, runCase, sleep, waitFor, openDrawer, dismissOverlays, spaSessions, desktop, desktopComposer } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();
try {
  await pairInto(page, url);
  await sleep(2500);
  await runCase('CMP-009(label)', async () => {
    await openDrawer(page);
    const p = await spaSessions(page);
    const row = p.rows.find((r) => !r.child);
    await page.evaluate((want) => {
      const n = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].find((x) => x.dataset.sessionId === want);
      n?.querySelector('.session')?.click();
    }, row.id);
    await sleep(2500);
    await dismissOverlays(page);
    await page.click('#access-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'access pane');
    const labels = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')].map((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || n.textContent || '').trim()));
    await dismissOverlays(page);
    const chip = await page.evaluate(() => (document.querySelector('#access-chip')?.textContent || '').trim());
    const d = await desktopComposer(dPage);
    const want = ['仅可查看', '可写入工作区', '完全权限'];
    for (const w of want) if (!labels.some((l) => l.startsWith(w))) throw new Error(`缺 ${w}: ${labels.join('|')}`);
    const desktopCurrent = (d.accessAria.match(/当前[:：]\s*(.+)$/) || [])[1] || '';
    return { status: 'Pass', note: `SPA 三档=${labels.filter((l) => want.some((w) => l.startsWith(w))).join('/')}；chip=${chip}；桌面 aria 当前=${desktopCurrent}（同词表）` };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
