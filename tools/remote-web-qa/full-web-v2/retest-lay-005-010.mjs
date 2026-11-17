import {
  launchSpa, pairInto, pairingUrl, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, clickSheet,
} from './lib.mjs';

const VIEWPORTS = [['360', 360, 640], ['390', 390, 844], ['430', 430, 932]];
const visibleSheetItems = () => [...document.querySelectorAll('#sheet-root .sheet-item')]
  .map((el) => ({ el, r: el.getBoundingClientRect() }))
  .filter(({ el, r }) => r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden')
  .map(({ el, r }) => ({ t: (el.textContent || '').trim().slice(0, 16), w: r.width, h: r.height }));

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);

  await runCase('LAY-005', async () => {
    const files = [];
    for (const [label, w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#session-list .session-row:not(.workspace-head) [aria-label="会话操作"]')?.click());
      await sleep(400);
      files.push(await shot(page, `lay-rowmenu-${label}`));
      const items = await page.evaluate(visibleSheetItems);
      if (items.length < 3) throw new Error(`${label}: 菜单项 ${items.length}`);
      const names = items.map((i) => i.t).join('|');
      if (!/重命名/.test(names) || !/Fork/.test(names) || !/归档/.test(names)) throw new Error(`${label}: ${names}`);
      for (const it of items) if (it.h < 28) throw new Error(`${label}: ${it.t} 高 ${Math.round(it.h)}`);
      await dismissOverlays(page);
    }
    return { status: 'Pass', note: '行菜单三视口（前次 Fail 为脚本 offsetParent 过滤 fixed 层）', evidence: files };
  });

  await runCase('LAY-010', async () => {
    const files = [];
    for (const [label, w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#new-session')?.click());
      await waitFor(page, () => Boolean(document.querySelector('.sheet-title')), 'chooser');
      files.push(await shot(page, `lay-newsession-${label}`));
      let items = await page.evaluate(visibleSheetItems);
      if (!items.length) throw new Error(`${label}: 选工作区 sheet 空`);
      for (const it of items) if (it.h < 28) throw new Error(`${label} 选择: ${it.t} 高 ${Math.round(it.h)}`);
      await clickSheet(page, '浏览本机目录…', { exact: true });
      await waitFor(
        page,
        () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
          && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
        'browse',
        20_000,
      );
      files.push(await shot(page, `lay-browse-${label}`));
      items = await page.evaluate(visibleSheetItems);
      if (!items.length) throw new Error(`${label}: 浏览 sheet 空`);
      for (const it of items) if (it.h < 28) throw new Error(`${label} 浏览: ${it.t} 高 ${Math.round(it.h)}`);
      await dismissOverlays(page);
    }
    return { status: 'Pass', note: '新会话+浏览目录三视口（行高复核通过）', evidence: files };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
