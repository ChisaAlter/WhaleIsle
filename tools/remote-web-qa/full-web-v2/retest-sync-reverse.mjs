/**
 * Task 1 (DEF-SYNC-REVERSE) live retest: desktop-side new session, rename,
 * archive must reach the paired SPA without reconnect.
 */
import { assertFreshApp, launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot, spaSessions,
  desktop, desktopSessions, desktopShot, desktopType, desktopSend, desktopEnsureGrok, openDrawer, dismissOverlays,
} from './lib.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function desktopRowAction(title, actionRe) {
  const opened = await dPage.evaluate((want) => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') || '') === `会话“${want}”的操作`);
    if (!btn) return false;
    btn.click();
    return true;
  }, title);
  if (!opened) return `no-row:${title}`;
  await sleep(700);
  const clicked = await dPage.evaluate((re) => {
    const items = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button')]
      .filter((el) => el.getBoundingClientRect().width > 0);
    const hit = items.find((el) => new RegExp(re).test((el.textContent || '') + (el.getAttribute('aria-label') || '')));
    if (!hit) return false;
    hit.click();
    return true;
  }, actionRe.source);
  await sleep(700);
  return clicked ? 'ok' : 'no-item';
}

async function waitPhone(predicate, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = await spaSessions(page);
    if (predicate(p)) return { ok: true, p, ms: timeout - (deadline - Date.now()) };
    await sleep(2000);
  }
  return { ok: false, p: await spaSessions(page) };
}

let newTitle = '';
try {
  await pairInto(page, url);
  const appSrc = await page.evaluate(() => document.querySelector('script[type="module"]')?.src || '');
  assertFreshApp(appSrc);

  await runCase('NEW-002', async () => {
    const before = (await spaSessions(page)).rows.filter((r) => !r.child).map((r) => r.id);
    await dismissOverlays(page);
    const opened = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      btn?.click();
      return Boolean(btn);
    });
    if (!opened) return { status: 'Blocked', note: '桌面新建会话按钮未找到' };
    await sleep(1500);
    const grok = await desktopEnsureGrok(dPage);
    const stamp = Date.now().toString().slice(-5);
    const typed = await desktopType(dPage, `请只回复一行：REV-${stamp} 桌面反向标记`);
    if (typed !== 'ok') return { status: 'Blocked', note: `desktopType=${typed}` };
    if (!(await desktopSend(dPage))) return { status: 'Blocked', note: '桌面发送不可用' };
    const t0 = Date.now();
    const res = await waitPhone((p) => p.rows.filter((r) => !r.child).some((r) => !before.includes(r.id)), 60_000);
    const e1 = await shot(page, 'new-002-phone');
    const e2 = await desktopShot(dPage, 'new-002-desktop');
    if (!res.ok) throw new Error(`60s 手机未新增（grok=${grok}）`);
    const gained = res.p.rows.find((r) => !r.child && !before.includes(r.id));
    newTitle = gained.title;
    record('LIST-003', 'Pass', `桌面新会话+首句 → 手机 ${Math.round((Date.now() - t0) / 1000)}s 内出现「${gained.title}」（live 帧，未重连）`, [e1, e2]);
    record('MENU-016', 'Pass', '=NEW-002');
    return { status: 'Pass', note: `桌面反向新增 ${Math.round((Date.now() - t0) / 1000)}s：「${gained.title}」`, evidence: [e1, e2] };
  });

  await runCase('MENU-002', async () => {
    // wait title to settle on both ends
    const settled = await waitPhone((p) => p.rows.some((r) => r.title === newTitle && r.title !== 'session' && r.title !== '新会话'), 30_000);
    const current = settled.ok ? newTitle : (await spaSessions(page)).rows.find((r) => r.title.startsWith('REV-') || /反向标记/.test(r.title))?.title;
    if (!current) return { status: 'Blocked', note: '找不到反向会话行' };
    const back = `dshd-qa-bk-${Date.now().toString().slice(-6)}`;
    const res = await desktopRowAction(current, /重命名|rename/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面行菜单=${res}` };
    await sleep(600);
    const typed = await dPage.evaluate((value) => {
      const dialog = [...document.querySelectorAll('[role="dialog"], [class*="dialog" i], [class*="Modal" i]')]
        .find((el) => el.getBoundingClientRect().width > 0);
      const input = dialog && [...dialog.querySelectorAll('input, textarea')].find((el) => el.getBoundingClientRect().width > 0);
      if (!input) return 'no-input';
      input.focus();
      input.select?.();
      document.execCommand('insertText', false, value);
      const ok = [...dialog.querySelectorAll('button')].find((b) => /确认|确定|保存|重命名|OK|rename/i.test(b.textContent || ''));
      if (!ok) return 'no-confirm';
      ok.click();
      return 'ok';
    }, back);
    if (typed !== 'ok') return { status: 'Blocked', note: `桌面重命名对话框=${typed}` };
    const t0 = Date.now();
    const got = await waitPhone((p) => p.rows.some((r) => r.title === back), 45_000);
    const e1 = await shot(page, 'menu-002-phone');
    const e2 = await desktopShot(dPage, 'menu-002-desktop');
    if (!got.ok) throw new Error('45s 手机未跟随桌面改名');
    newTitle = back;
    return { status: 'Pass', note: `桌面改名「${back}」→ 手机 ${Math.round((Date.now() - t0) / 1000)}s 跟随`, evidence: [e1, e2] };
  });

  await runCase('MENU-005', async () => {
    const res = await desktopRowAction(newTitle, /^归档|archive/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面归档菜单=${res}` };
    // confirm dialog if any
    await dPage.evaluate(() => {
      const ok = [...document.querySelectorAll('[role="dialog"] button, [class*="dialog" i] button')]
        .filter((b) => b.getBoundingClientRect().width > 0)
        .find((b) => /归档|确认|确定/.test(b.textContent || '') && !/取消/.test(b.textContent || ''));
      ok?.click();
    });
    const t0 = Date.now();
    const gone = await waitPhone((p) => !p.rows.some((r) => r.title === newTitle), 45_000);
    const e1 = await shot(page, 'menu-005-phone');
    if (!gone.ok) throw new Error('45s 手机活列表仍有该行');
    return { status: 'Pass', note: `桌面归档 → 手机 ${Math.round((Date.now() - t0) / 1000)}s 消失`, evidence: [e1] };
  });

  await runCase('ARCH-004', async () => {
    await dPage.evaluate(() => {
      const el = [...document.querySelectorAll('[aria-expanded]')]
        .find((n) => /已归档/.test(n.textContent || '') && n.getAttribute('aria-expanded') === 'false');
      el?.click();
    });
    await sleep(1000);
    const arias = await dPage.evaluate((want) => [...document.querySelectorAll('button[aria-label*="的操作"]')]
      .map((b) => b.getAttribute('aria-label')).filter((a) => a.includes(want)), newTitle);
    if (!arias.length) return { status: 'Blocked', note: `桌面已归档区无「${newTitle}」action aria` };
    const res = await desktopRowAction(newTitle, /取消归档|恢复|unarchive/i);
    if (res !== 'ok') return { status: 'Blocked', note: `桌面已归档菜单=${res}` };
    const t0 = Date.now();
    const back = await waitPhone((p) => p.rows.some((r) => r.title === newTitle), 45_000);
    if (!back.ok) throw new Error('45s 手机未恢复');
    record('ARCH-003', 'Pass', '=ARCH-004（桌面取消归档 → 手机恢复）');
    return { status: 'Pass', note: `桌面取消归档 → 手机 ${Math.round((Date.now() - t0) / 1000)}s 恢复` };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
console.log('[retest-sync-reverse] done');
