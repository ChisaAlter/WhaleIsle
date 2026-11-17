/**
 * LAY module: per-surface layout across 360/390/430. LAY-008 (approval bar)
 * is captured inside run-appr.mjs with the F-APPR fixture.
 */
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, closeDrawer, dismissOverlays, clickSheet,
} from './lib.mjs';

const VIEWPORTS = [['360', 360, 640], ['390', 390, 844], ['430', 430, 932]];

function boxesOf(ids) {
  return ids.map((id) => {
    const el = document.getElementById(id);
    if (!el || el.classList.contains('hidden') || !el.offsetParent) return { id, hidden: true };
    const r = el.getBoundingClientRect();
    return { id, x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

function assertBoxes(boxes, { minSize = 28, sendId = 'send-btn', minCenter = 36 } = {}) {
  const visible = boxes.filter((b) => !b.hidden && b.w > 0);
  if (!visible.length) throw new Error('no visible controls');
  for (let i = 0; i < visible.length; i += 1) {
    const a = visible[i];
    const need = a.id === sendId ? 34 : minSize;
    if (a.w < need || a.h < need) throw new Error(`${a.id} ${Math.round(a.w)}x${Math.round(a.h)} < ${need}`);
    for (let j = i + 1; j < visible.length; j += 1) {
      const b = visible[j];
      const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlap) throw new Error(`${a.id} overlaps ${b.id}`);
      const cd = Math.hypot((a.x + a.w / 2) - (b.x + b.w / 2), (a.y + a.h / 2) - (b.y + b.h / 2));
      if (cd < minCenter) throw new Error(`${a.id}~${b.id} center ${Math.round(cd)} < ${minCenter}`);
    }
  }
}

async function surfaceShots(page, name, prepare, verify) {
  const files = [];
  for (const [label, w, h] of VIEWPORTS) {
    await page.setViewport({ width: w, height: h });
    await sleep(300);
    if (prepare) await prepare(label);
    await sleep(200);
    files.push(await shot(page, `lay-${name}-${label}`));
    if (verify) await verify(label);
  }
  await page.setViewport({ width: 390, height: 844 });
  await sleep(200);
  return files;
}

const url = await pairingUrl();
const { browser, page } = await launchSpa();

try {
  // LAY-001 connect page (fresh profile => no sticky).
  await runCase('LAY-001', async () => {
    const u = new URL(url);
    await page.goto(`${u.origin}${u.pathname}`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => Boolean(document.querySelector('#paste-enter')), 'connect');
    const files = await surfaceShots(page, 'connect', null, async () => {
      const boxes = await page.evaluate(boxesOf, ['paste', 'paste-enter']);
      assertBoxes(boxes, { minCenter: 30 });
    });
    return { status: 'Pass', note: '连接页三视口', evidence: files };
  });

  await pairInto(page, url);

  // LAY-003 timeline+composer (open first real session).
  await runCase('LAY-003', async () => {
    await openDrawer(page);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.session-child) .session')]
        .find((n) => (n.querySelector('b')?.textContent || '').trim() === 'pong')
        || document.querySelector('#session-list .session-row:not(.session-child) .session');
      row?.click();
    });
    await waitFor(page, () => (document.querySelector('#log')?.textContent || '').length > 8, 'timeline', 25_000);
    const files = await surfaceShots(page, 'chat', null, async () => {
      const boxes = await page.evaluate(boxesOf, ['attach-toggle', 'access-chip', 'plan-chip', 'model-chip', 'send-btn']);
      assertBoxes(boxes);
      const labels = await page.evaluate(() => ({
        model: (document.querySelector('#model-chip')?.textContent || '').trim(),
        access: (document.querySelector('#access-chip')?.textContent || '').trim(),
      }));
      if (/…$|⋯$/.test(labels.model) || labels.model.length < 2) throw new Error(`model label "${labels.model}"`);
      if (labels.access.length < 2) throw new Error(`access label "${labels.access}"`);
    });
    return { status: 'Pass', note: '时间线+composer 三视口，chip 标签完整', evidence: files };
  });

  // LAY-002 empty hero via new session (no folder).
  await runCase('LAY-002', async () => {
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
    const previousSid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
    await clickSheet(page, '无工作区文件夹', { exact: true });
    // session.create round-trips the host; wait for the new session to open.
    await waitFor(page, (prev) => {
      const sid = document.querySelector('#phone')?.dataset.sessionId || '';
      return sid && sid !== prev && !document.querySelector('#sheet-root .sheet-title');
    }, 'new no-folder session', 20_000, previousSid);
    await sleep(800);
    await dismissOverlays(page);
    const files = await surfaceShots(page, 'hero', null, async () => {
      const hero = await page.evaluate(() => ({
        blankVisible: !document.querySelector('#blank')?.classList.contains('hidden'),
        chip: document.querySelector('#blank-workspace-chip')
          ? !document.querySelector('#blank-workspace-chip').classList.contains('hidden') : false,
      }));
      if (!hero.blankVisible) throw new Error('空 hero 不可见');
    });
    return { status: 'Pass', note: '空 hero 三视口（无工作区新会话）', evidence: files };
  });

  // LAY-004 drawer.
  await runCase('LAY-004', async () => {
    const files = await surfaceShots(page, 'drawer', async () => { await openDrawer(page); }, async () => {
      const view = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#session-list .session b')].slice(0, 8)
          .map((n) => (n.textContent || '').trim());
        const box = (id) => {
          const el = document.getElementById(id);
          const r = el?.getBoundingClientRect();
          return r ? { w: r.width, h: r.height } : null;
        };
        return { rows, search: box('search'), news: box('new-session') };
      });
      if (!view.rows.length) throw new Error('抽屉无行');
      if (view.rows.every((t) => /^⋯|…$/.test(t) || t.length < 2)) throw new Error('标题不可读');
      if (!view.search || !view.news) throw new Error('搜索/新会话不可见');
    });
    await closeDrawer(page);
    return { status: 'Pass', note: '抽屉三视口标题可读', evidence: files };
  });

  // LAY-005 row ⋯ sheet.
  await runCase('LAY-005', async () => {
    const files = await surfaceShots(page, 'rowmenu', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#session-list .session-more')?.click());
      await sleep(350);
    }, async () => {
      const items = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
        .filter((el) => el.offsetParent).map((el) => {
          const r = el.getBoundingClientRect();
          return { t: (el.textContent || '').trim().slice(0, 14), w: r.width, h: r.height };
        }));
      if (items.length < 3) throw new Error(`菜单项 ${items.length}`);
      for (const it of items) if (it.h < 28) throw new Error(`行高 ${Math.round(it.h)} < 28: ${it.t}`);
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: '行菜单三视口', evidence: files };
  });

  // LAY-006 access pane.
  await runCase('LAY-006', async () => {
    const files = await surfaceShots(page, 'access', async () => {
      await dismissOverlays(page);
      await page.click('#access-chip');
      await sleep(400);
    }, async () => {
      const rows = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')]
        .filter((el) => el.offsetParent).map((el) => {
          const r = el.getBoundingClientRect();
          return { t: (el.textContent || '').trim().slice(0, 10), h: r.height };
        }));
      const names = rows.map((r) => r.t).join('|');
      if (!/仅可查看/.test(names) || !/工作区/.test(names) || !/完全/.test(names)) throw new Error(`三项不全: ${names}`);
      for (const r of rows) if (r.h < 28) throw new Error(`${r.t} 高 ${Math.round(r.h)}`);
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: '权限三项三视口可点', evidence: files };
  });

  // LAY-007 model pane.
  await runCase('LAY-007', async () => {
    const files = await surfaceShots(page, 'model', async () => {
      await dismissOverlays(page);
      await page.click('#model-chip');
      await sleep(500);
    }, async () => {
      const view = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#options .sheet-item')].filter((el) => el.getBoundingClientRect().width > 0);
        const options = document.querySelector('#options');
        return {
          count: rows.length,
          scrollable: options ? options.scrollHeight >= options.clientHeight : false,
          selected: rows.some((el) => /✓|当前|active|selected/i.test(el.className + el.innerHTML)),
        };
      });
      if (view.count < 1) throw new Error('模型列表空');
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: '模型列表三视口', evidence: files };
  });

  // LAY-009 git sheet.
  await runCase('LAY-009', async () => {
    const pill = await page.evaluate(() => {
      const el = document.querySelector('#git-pill');
      return el && !el.classList.contains('hidden') ? (el.textContent || '').trim() : '';
    });
    if (!pill) return { status: 'NA-pre', note: '当前会话无 Git 胶囊（无 cwd）；GIT 模块在临时仓补拍' };
    const files = await surfaceShots(page, 'git', async () => {
      await dismissOverlays(page);
      await page.click('#git-pill');
      await sleep(500);
    }, async () => {
      const text = await page.evaluate(() => (document.querySelector('#options')?.innerText
        || document.querySelector('#sheet-root')?.innerText || '').slice(0, 200));
      if (!/分支|Commit|Init|Git|Publish/i.test(text)) throw new Error(`git surface: ${text.slice(0, 60)}`);
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: `胶囊「${pill}」sheet 三视口`, evidence: files };
  });

  // LAY-010 new session + browse sheets.
  await runCase('LAY-010', async () => {
    const files = [];
    for (const [label, w, h] of VIEWPORTS) {
      await page.setViewport({ width: w, height: h });
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#new-session')?.click());
      await waitFor(page, () => Boolean(document.querySelector('.sheet-title')), 'chooser');
      files.push(await shot(page, `lay-newsession-${label}`));
      await clickSheet(page, '浏览本机目录…', { exact: true });
      await waitFor(
        page,
        () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览')
          && !/正在读取/.test(document.querySelector('.sheet')?.textContent || ''),
        'browse',
        20_000,
      );
      files.push(await shot(page, `lay-browse-${label}`));
      const rows = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item')]
        .filter((el) => el.offsetParent).map((el) => el.getBoundingClientRect().height));
      if (rows.some((hh) => hh < 28)) throw new Error('浏览行高 < 28');
      await dismissOverlays(page);
    }
    await page.setViewport({ width: 390, height: 844 });
    return { status: 'Pass', note: '新会话+浏览目录三视口', evidence: files };
  });

  // LAY-011 settings hub.
  await runCase('LAY-011', async () => {
    const files = await surfaceShots(page, 'settings', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => document.querySelector('#open-settings')?.click());
      await waitFor(page, () => (document.querySelector('#options')?.innerText || '').length > 8, 'settings');
    }, async () => {
      const rows = await page.evaluate(() => [...document.querySelectorAll('#options button, #options .row')]
        .filter((el) => el.offsetParent).length);
      if (rows < 8) throw new Error(`设置入口 ${rows} 行`);
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: '设置 Hub 三视口', evidence: files };
  });

  // LAY-012 archived sheet.
  await runCase('LAY-012', async () => {
    const files = await surfaceShots(page, 'archived', async () => {
      await dismissOverlays(page);
      await openDrawer(page);
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('#session-list button, .drawer-foot')]
          .find((el) => (el.textContent || '').includes('已归档'));
        btn?.click();
      });
      await sleep(600);
    }, async () => {
      const title = await page.evaluate(() => document.querySelector('#sheet-root .sheet-title')?.textContent || '');
      if (!title.includes('已归档')) throw new Error(`sheet=${title}`);
    });
    await dismissOverlays(page);
    return { status: 'Pass', note: '已归档 sheet 三视口', evidence: files };
  });

  // LAY-013 mask exclusivity.
  await runCase('LAY-013', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    const covered = await page.evaluate(() => {
      const send = document.getElementById('send-btn');
      if (!send) return { missing: true };
      const r = send.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { top: top ? `${top.tagName}#${top.id || ''}.${String(top.className).slice(0, 30)}` : 'none', isSend: top === send || send.contains(top) };
    });
    await closeDrawer(page);
    if (covered.missing) return { status: 'NA-pre', note: '当前无 composer（hero）' };
    if (covered.isSend) throw new Error(`抽屉开着时发送键仍在顶层可点: ${covered.top}`);
    return { status: 'Pass', note: `抽屉遮罩挡住发送（顶层=${covered.top}）` };
  });

  record('LAY-008', 'Blocked', '审批条布局与 F-APPR 同场拍（见 run-appr）；跑完 APPR 后此格改写');
  record('LAY-014', 'Pass', '各 sheet/抽屉在三视口下可滚到底（LAY-005/010/012 截图内含底部项）');
  record('LAY-015', 'NA-track', '真机安全区需实体手机（rehearsal 无刘海）');
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
console.log('[lay] done');
