import { assertFreshApp, launchSpa, pairInto, pairingUrl, runCase, shot, spaSessions, desktop, desktopSessions, desktopShot,
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
  const appSrc = await page.evaluate(() => document.querySelector('script[type="module"]')?.src || '');
  assertFreshApp(appSrc);

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
    return {
      status: 'Pass',
      note: `D=P 全等（${D.length} 行）。缺陷修复：孤儿子智能体此前平铺顶级（桌面隐藏）→ groupSessionRows 改为隐藏（DEF-ORPHAN-SUB 已修+单测）`,
      evidence: [e1, e2],
    };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
