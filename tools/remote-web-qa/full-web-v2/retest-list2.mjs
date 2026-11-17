/**
 * Retest LIST-001 (full expansion), LIST-003 (blank-verified desktop send),
 * SRCH-001/003 (quiet state).
 */
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, spaSessions,
  desktop, desktopSessions, desktopShot,
} from './lib.mjs';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function multisetDiff(D, P) {
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const cd = count(D); const cp = count(P);
  const missing = []; const extra = [];
  for (const [k, v] of cd) { const g = cp.get(k) || 0; for (let i = g; i < v; i += 1) missing.push(k); }
  for (const [k, v] of cp) { const g = cd.get(k) || 0; for (let i = g; i < v; i += 1) extra.push(k); }
  return { missing, extra };
}

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();
try {
  await pairInto(page, url);

  await runCase('LIST-001', async () => {
    const d = await desktopSessions(dPage);
    const p = await spaSessions(page);
    const D = [...d.titles, ...d.childTitles].map(norm).filter((t) => t && t !== '新会话');
    const P = [...p.titles, ...p.childTitles].map(norm);
    const { missing, extra } = multisetDiff(D, P);
    const e1 = await shot(page, 'list-001-phone');
    const e2 = await desktopShot(dPage, 'list-001-desktop');
    if (missing.length || extra.length) {
      throw new Error(`|D|=${D.length} |P|=${P.length} 缺:${missing.slice(0, 8).join('、')} 多:${extra.slice(0, 8).join('、')}`);
    }
    return { status: 'Pass', note: `D=P 全等（${D.length} 行，父+子多重集；桌面 blank 除外；「展开其余」循环展开）`, evidence: [e1, e2] };
  });

  await runCase('LIST-003', async () => {
    const beforeP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
    await closeDrawer(page);
    const opened = await dPage.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') || '') === '新建会话');
      btn?.click();
      return Boolean(btn);
    });
    if (!opened) return { status: 'Blocked', note: '桌面新建会话按钮未找到' };
    // Wait for blank hero: chat flow should have no assistant rows.
    const blank = await (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const s = await dPage.evaluate(() => ({
          assistants: document.querySelectorAll('[data-chat-flow-kind="assistant"]').length,
          composer: Boolean(document.querySelector('[data-composer-input]')),
        }));
        if (s.composer && s.assistants === 0) return true;
        await sleep(500);
      }
      return false;
    })();
    if (!blank) return { status: 'Blocked', note: '桌面未切到空白新会话（旧会话仍在前台），放弃以免误发' };
    const typed = await dPage.evaluate(() => {
      const el = document.querySelector('[data-composer-input]');
      el.click();
      el.focus();
      document.execCommand('insertText', false, '请只回复一行：LIST-003 反向标记');
      const text = (el.innerText || '').trim();
      if (!text.includes('LIST-003')) return 'type-failed';
      const card = document.querySelector('[data-composer-card]');
      const send = card && [...card.querySelectorAll('button')]
        .find((b) => /发送消息|send message/i.test((b.getAttribute('aria-label') || '') + b.textContent));
      if (!send || send.disabled) return 'send-missing';
      send.click();
      return 'sent';
    });
    if (typed !== 'sent') return { status: 'Blocked', note: `桌面输入=${typed}` };
    const deadline = Date.now() + 60_000;
    let afterP = beforeP;
    while (Date.now() < deadline) {
      await sleep(3000);
      afterP = (await spaSessions(page)).rows.filter((r) => !r.child).length;
      if (afterP > beforeP) break;
    }
    const e1 = await shot(page, 'list-003-phone');
    const e2 = await desktopShot(dPage, 'list-003-desktop');
    if (afterP <= beforeP) throw new Error(`60s 手机未新增（${beforeP}→${afterP}）`);
    return { status: 'Pass', note: `桌面空白新会话+首句 → 手机 ${beforeP}→${afterP}`, evidence: [e1, e2] };
  });

  await runCase('SRCH-001(list-module, informational)', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => {
      const s = document.querySelector('#search');
      s.value = '验证码';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(3000);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
      .map((r) => ({
        title: (r.querySelector('.session b')?.textContent || '').trim(),
        full: (r.textContent || '').trim(),
      })));
    const file = await shot(page, 'srch-001');
    if (!rows.length) throw new Error('无命中');
    if (rows.length > 20) throw new Error(`${rows.length} > 20`);
    const snippet = rows.some((r) => r.full.length > r.title.length + 6);
    return {
      status: 'Pass',
      note: `静态命中 ${rows.length}（≤20）${snippet ? '，带 snippet' : ''}。发现：live 刷新到达时搜索视图会被整表重画（前两次采样 89/93 行），已记 DEF-SRCH-LIVE 待修`,
      evidence: [file],
    };
  });

  await runCase('SRCH-003(list-module, informational)', async () => {
    const rows = await page.evaluate(() => [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')].length);
    if (rows < 20) return { status: 'NA-pre', note: `命中 ${rows} < 20` };
    if (rows > 20) throw new Error(`${rows} > 20`);
    const more = await page.evaluate(() => /更多|还有/.test(document.querySelector('#session-list')?.textContent || ''));
    return { status: 'Pass', note: `cap=20${more ? ' + 更多提示' : ''}` };
  });

  await page.evaluate(() => {
    const s = document.querySelector('#search');
    s.value = '';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
console.log('[retest-list2] done');
