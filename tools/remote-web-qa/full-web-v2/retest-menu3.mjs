/**
 * Final chain retest: NEW-005 (heads via aria), MENU-003/007 (longer waits),
 * ARCH-002/007/003/005 (reordered), MENU-017/018.
 */
import { readdirSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, clickSheet, fillDialog, spaSessions,
  desktop, desktopSessions, desktopShot, sendAndIdle, switchGrok,
} from './lib.mjs';

const TMP = process.env.DSH_QA_TMP || 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const TMP_NAME = TMP.split('\\').pop();
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function waitHeads(predicate, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = await spaSessions(page);
    if (predicate(p)) return p;
    await sleep(2000);
  }
  return null;
}

async function sessionMenu(id) {
  await dismissOverlays(page);
  await openDrawer(page);
  const ok = await page.evaluate((want) => {
    const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .find((n) => n.dataset.sessionId === want);
    row?.querySelector('[aria-label="会话操作"]')?.click();
    return Boolean(row);
  }, id);
  if (!ok) throw new Error(`行不存在: ${id}`);
  await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet-title')), 'menu');
}

async function workspaceMenu(name) {
  await dismissOverlays(page);
  await openDrawer(page);
  const ok = await page.evaluate((want) => {
    const head = [...document.querySelectorAll('#session-list .workspace-head')]
      .find((n) => (n.querySelector('b')?.textContent || '').includes(want));
    head?.querySelector('[aria-label="工作区操作"]')?.click();
    return Boolean(head);
  }, name);
  if (!ok) throw new Error(`工作区头不存在: ${name}`);
  await waitFor(page, () => Boolean(document.querySelector('#sheet-root .sheet-title')), 'ws menu');
}

async function archiveViaPhone(id) {
  // Titles regenerate on the host after the first turn; always read the live
  // title right before archiving so archived-sheet lookups match.
  const fresh = (await spaSessions(page)).rows.find((r) => r.id === id)?.title;
  if (fresh) title = fresh;
  await sessionMenu(id);
  await clickSheet(page, '归档', { exact: true });
  await waitFor(page, () => /归档「/.test(document.querySelector('.dialog')?.textContent || ''), 'confirm', 8_000);
  await page.evaluate(() => {
    [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '归档')?.click();
  });
  await waitFor(
    page,
    (want) => ![...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .some((r) => r.dataset.sessionId === want),
    'left live',
    12_000,
    id,
  );
}

let sid = '';
let title = '';

try {
  await pairInto(page, url);

  await runCase('NEW-005', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(
      page,
      () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
        && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
      'browse',
      20_000,
    );
    const found = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want);
      hit?.click();
      return Boolean(hit);
    }, TMP_NAME);
    if (!found) throw new Error(`浏览无 ${TMP_NAME}`);
    await waitFor(
      page,
      (name) => {
        const use = [...document.querySelectorAll('#sheet-root .sheet-item')]
          .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === '使用此目录作为工作区');
        return (use?.querySelector('.sheet-hint')?.textContent || '').includes(name);
      },
      'landed',
      15_000,
      TMP_NAME,
    );
    await clickSheet(page, '使用此目录作为工作区', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'created', 25_000);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !sid) {
      sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      if (!sid) await sleep(800);
    }
    if (!sid) throw new Error('无 sessionId');
    const p = await waitHeads((pp) => pp.heads.some((h) => h.includes(TMP_NAME)));
    if (!p) throw new Error('手机头未出现');
    const dl2 = Date.now() + 30_000;
    let onDesk = false;
    let dHeads = [];
    while (Date.now() < dl2 && !onDesk) {
      const d = await desktopSessions(dPage);
      dHeads = d.heads;
      onDesk = d.heads.some((h) => h.includes(TMP_NAME));
      if (!onDesk) await sleep(2500);
    }
    const e1 = await shot(page, 'new-005-phone');
    const e2 = await desktopShot(dPage, 'new-005-desktop');
    if (!onDesk) throw new Error(`桌面无头（${dHeads.join('|')}）`);
    return { status: 'Pass', note: `工作区两端同现（桌面头=${dHeads.join('、')}）`, evidence: [e1, e2] };
  });

  await runCase('SEED', async () => {
    await switchGrok(page);
    const view = await sendAndIdle(page, '请只回复：SEED', 180_000);
    title = (await spaSessions(page)).rows.find((r) => r.id === sid)?.title || '';
    return { status: 'Pass', note: `种子完成，行标题=「${title}」` };
  });

  await runCase('MENU-003', async () => {
    const before = await spaSessions(page);
    const beforeIds = new Set(before.rows.map((r) => r.id));
    await sessionMenu(sid);
    await clickSheet(page, 'Fork', { exact: true });
    await waitFor(page, () => !document.querySelector('#sheet-root .sheet-title'), 'fork sheet', 15_000);
    const deadline = Date.now() + 25_000;
    let forked = null;
    while (Date.now() < deadline && !forked) {
      await sleep(2500);
      const after = await spaSessions(page);
      forked = after.rows.find((r) => r.id && !beforeIds.has(r.id)) || null;
    }
    if (!forked) throw new Error('25s 无新 fork 行');
    const p = await spaSessions(page);
    if (!p.rows.some((r) => r.id === sid)) throw new Error('父行消失');
    const dl2 = Date.now() + 30_000;
    let dHas = false;
    while (Date.now() < dl2 && !dHas) {
      const d = await desktopSessions(dPage);
      dHas = [...d.titles, ...d.childTitles].map(norm).includes(norm(forked.title));
      if (!dHas) await sleep(2500);
    }
    if (!dHas) throw new Error(`桌面无 fork「${forked.title}」`);
    const hasHistory = await page.evaluate(() => (document.querySelector('#log')?.textContent || '').includes('SEED'));
    return { status: 'Pass', note: `Fork「${forked.title}」两端都有；父在；fork 含父历史=${hasHistory}` };
  });

  // A seed + its fork is not a valid ordering fixture: the fork renders under
  // its parent, so moving the parent cannot change the visible order.
  // retest-move.mjs owns MENU-007 on a 3-row non-fork group.
  await runCase('MENU-007(2-row-fork, informational)', async () => {
    const orderOf = async () => (await spaSessions(page)).rows.filter((r) => !r.child).map((r) => r.id);
    const before = await orderOf();
    if (before.length < 3) return { status: 'NA-pre', note: `组内 ${before.length} 个顶级行（fork 折在父下），交由 retest-move 的 3 行组判定` };
    await sessionMenu(sid);
    const menu = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .map((n) => (n.textContent || '').trim()));
    const dir = menu.some((t) => t.includes('上移')) ? '上移' : menu.some((t) => t.includes('下移')) ? '下移' : '';
    if (!dir) { await dismissOverlays(page); return { status: 'NA-pre', note: '组内单条' }; }
    await clickSheet(page, dir, { exact: true });
    const deadline = Date.now() + 20_000;
    let changed = false;
    while (Date.now() < deadline && !changed) {
      await sleep(2500);
      const after = await orderOf();
      changed = JSON.stringify(before) !== JSON.stringify(after);
    }
    if (!changed) throw new Error(`${dir} 20s 顺序未变`);
    return { status: 'Pass', note: `${dir}生效（20s 内顺序变化，insertSessionBefore 往返）` };
  });

  // ARCH reordered: phone archive → phone unarchive (ARCH-002) → live menu no delete
  // (ARCH-007) → archive → desktop unarchive (ARCH-003) → archive → delete (ARCH-005).
  await runCase('ARCH-002', async () => {
    title = (await spaSessions(page)).rows.find((r) => r.id === sid)?.title || title;
    await archiveViaPhone(sid, title);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const hit = rows.find((n) => (n.textContent || '').includes(want) && (n.textContent || '').includes('取消归档'));
      hit?.click();
    }, title);
    await waitFor(
      page,
      (want) => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .some((r) => r.dataset.sessionId === want),
      'restored',
      25_000,
      sid,
    );
    const opened = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    if (opened === sid) throw new Error('自动打开了');
    return { status: 'Pass', note: `手机归档→取消归档往返 OK（「${title}」）；不自动打开` };
  });

  await runCase('ARCH-007', async () => {
    await sessionMenu(sid);
    const labels = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
      .map((n) => (n.textContent || '').trim()));
    await dismissOverlays(page);
    if (labels.some((t) => t.startsWith('删除'))) throw new Error(`活菜单有删除: ${labels.join('|')}`);
    return { status: 'Pass', note: `活菜单=${labels.map((t) => t.slice(0, 5)).join('/')}` };
  });

  await runCase('ARCH-003', async () => {
    await archiveViaPhone(sid, title);
    // desktop: expand 已归档, find row action.
    await dPage.evaluate(() => {
      const el = [...document.querySelectorAll('[aria-expanded]')]
        .find((n) => /已归档/.test(n.textContent || '') && n.getAttribute('aria-expanded') === 'false');
      el?.click();
    });
    await sleep(1200);
    const arias = await dPage.evaluate((want) => [...document.querySelectorAll('button[aria-label*="的操作"]')]
      .map((b) => b.getAttribute('aria-label'))
      .filter((a) => a.includes(want)), title);
    if (!arias.length) {
      return { status: 'Blocked', note: `桌面已归档区无「${title}」action（aria 列表未含；已归档行菜单驱动待补真人操作）` };
    }
    const res = await dPage.evaluate((aria) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === aria);
      btn?.click();
      return Boolean(btn);
    }, arias[0]);
    await sleep(700);
    const clicked = await dPage.evaluate(() => {
      const items = [...document.querySelectorAll('[role="menuitem"], button')]
        .filter((el) => el.getBoundingClientRect().width > 0);
      const hit = items.find((el) => /取消归档|恢复|unarchive/i.test(el.textContent || ''));
      hit?.click();
      return Boolean(hit);
    });
    if (!res || !clicked) return { status: 'Blocked', note: '桌面已归档菜单项未命中' };
    const deadline = Date.now() + 30_000;
    let back = false;
    while (Date.now() < deadline && !back) {
      await sleep(2500);
      const p = await spaSessions(page);
      back = p.rows.some((r) => r.id === sid);
    }
    if (!back) throw new Error('30s 手机未恢复（若为 DEF-SYNC-REVERSE 同源请并档）');
    return { status: 'Pass', note: '桌面取消归档 → 手机恢复' };
  });

  await runCase('ARCH-005', async () => {
    // ensure archived
    const live = (await spaSessions(page)).rows.some((r) => r.id === sid);
    if (live) await archiveViaPhone(sid, title);
    await dismissOverlays(page);
    await openDrawer(page);
    await clickSheet(page, '已归档会话');
    await waitFor(page, () => (document.querySelector('#sheet-root .sheet-title')?.textContent || '').includes('已归档'), 'history');
    const clicked = await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
      const del = rows.find((n) => (n.textContent || '').includes(want) && (n.textContent || '').includes('删除'));
      del?.click();
      return Boolean(del);
    }, title);
    if (!clicked) throw new Error('无删除入口');
    await waitFor(page, () => /删除「/.test(document.querySelector('.dialog')?.textContent || ''), 'del confirm', 8_000);
    const text = await page.evaluate(() => (document.querySelector('.dialog')?.textContent || ''));
    if (!/不可恢复/.test(text)) throw new Error(`确认缺不可恢复: ${text.slice(0, 80)}`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '删除')?.click();
    });
    await sleep(2500);
    await dismissOverlays(page);
    const p = await spaSessions(page);
    if (p.rows.some((r) => r.id === sid)) throw new Error('闪回活列表');
    const deadline = Date.now() + 30_000;
    let gone = false;
    while (Date.now() < deadline && !gone) {
      const d = await desktopSessions(dPage);
      gone = ![...d.titles, ...d.childTitles].map(norm).includes(norm(title));
      if (!gone) await sleep(2500);
    }
    if (!gone) throw new Error('桌面仍有该行');
    return { status: 'Pass', note: `删除「${title}」两端永久消失；确认含不可恢复` };
  });

  await runCase('MENU-017', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(TMP_NAME);
    await clickSheet(page, '重命名工作区', { exact: true });
    await fillDialog(page, renamed);
    const p = await waitHeads((pp) => pp.heads.some((h) => h === renamed), 25_000);
    if (!p) throw new Error('手机头未改名');
    const deadline = Date.now() + 30_000;
    let onDesk = false;
    let dHeads = [];
    while (Date.now() < deadline && !onDesk) {
      const d = await desktopSessions(dPage);
      dHeads = d.heads;
      onDesk = d.heads.some((h) => h.includes(renamed));
      if (!onDesk) await sleep(2500);
    }
    if (!onDesk) throw new Error(`桌面头未改名（${dHeads.join('|')}）`);
    return { status: 'Pass', note: `工作区改名两端可见（桌面=${dHeads.find((h) => h.includes(renamed))}）` };
  });

  await runCase('MENU-018', async () => {
    const renamed = `${TMP_NAME}-r`;
    await workspaceMenu(renamed);
    await clickSheet(page, '从列表移除', { exact: true });
    await waitFor(page, () => (document.querySelector('.dialog')?.textContent || '').includes('移除工作区'), 'confirm', 8_000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => (b.textContent || '').trim() === '移除')?.click();
    });
    const gone = await waitHeads((pp) => !pp.heads.some((h) => h.includes(TMP_NAME)), 20_000);
    if (!gone) throw new Error('手机头未消失');
    const onDisk = readdirSync(TMP).length >= 1;
    if (!onDisk) throw new Error('磁盘被删！');
    const deadline = Date.now() + 30_000;
    let dGone = false;
    while (Date.now() < deadline && !dGone) {
      const d = await desktopSessions(dPage);
      dGone = !d.heads.some((h) => h.includes(TMP_NAME));
      if (!dGone) await sleep(2500);
    }
    if (!dGone) throw new Error('桌面头仍在');
    return { status: 'Pass', note: 'unlist 两端消失；磁盘仍在' };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
console.log('[retest-menu3] done');
