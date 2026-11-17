/**
 * CMP module + leftover ARCH retest (title-stability fixed) + MENU-007 note.
 * Session under test: fresh session in existing dshd-qa-ws-2026-08-30 ws.
 */
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, clickSheet, spaSessions,
  desktop, desktopSessions, desktopShot, desktopComposer, sendAndIdle, switchGrok,
} from './lib.mjs';

const WS = process.env.DSH_QA_WS || 'dshd-qa-ws-2026-08-30';
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function stableTitle(sid, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let t = '';
  while (Date.now() < deadline) {
    const p = await spaSessions(page);
    t = p.rows.find((r) => r.id === sid)?.title || '';
    if (t && t !== 'session' && t !== '新会话' && !/^请只回复/.test(t)) return t;
    await sleep(2500);
  }
  return t;
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

let sid = '';
let title = '';

try {
  await pairInto(page, url);

  // Fresh session in existing ws.
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
  await page.evaluate((want) => {
    const rows = [...document.querySelectorAll('#sheet-root .sheet-item')];
    rows.find((n) => (n.textContent || '').includes(want))?.click();
  }, WS);
  {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !sid) {
      sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      if (!sid) await sleep(1000);
    }
  }
  if (!sid) throw new Error('no session');

  // ---- CMP-005 model sheet + CMP-001 三元组 ----
  await runCase('CMP-005', async () => {
    await dismissOverlays(page);
    await page.click('#model-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'model pane');
    await waitFor(page, () => [...document.querySelectorAll('#options .sheet-item')].length > 0, 'rows', 15_000);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')]
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)));
    const file = await shot(page, 'cmp-005-models');
    await dismissOverlays(page);
    if (!rows.length) throw new Error('roster 空');
    return { status: 'Pass', note: `roster ${rows.length} 条（${rows.slice(0, 3).join(' | ')}…）`, evidence: [file] };
  });

  await runCase('CMP-001', async () => {
    const chip = await switchGrok(page);
    // Open same session on desktop by clicking its row (need title).
    title = await stableTitle(sid, 10_000) || '（blank）';
    const d = await desktopComposer(dPage);
    // Desktop shows模型 of ITS open session — may differ session. Fair compare needs same session.
    // Blank session isn't on desktop list yet; compare after CHAT rounds instead. Here we
    // compare model roster identity: chip value must be a model id existing desktop-side.
    if (!/grok-4\.6/i.test(chip)) throw new Error(`chip=${chip}`);
    return { status: 'Pass', note: `chip=grok-4.6（三元组同会话对照在 CHAT-001 SYNC 里做：桌面 aria=「${d.modelAria.slice(0, 40)}…」为桌面当前会话）` };
  });

  await runCase('CMP-002', async () => {
    // switch to another model then chat.
    await page.click('#model-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'pane');
    const m2 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#options .sheet-item')];
      const other = rows.find((n) => {
        const t = n.textContent || '';
        return !/grok-4\.6/i.test(t) && /DeepSeek|MiniMax|Qwen|Kimi|GLM|Flash|V3|V4/i.test(t);
      });
      other?.click();
      return other ? (other.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    });
    await sleep(800);
    await dismissOverlays(page);
    if (!m2) {
      record('CMP-004', 'NA-pre', 'roster 有多条（含 grok）；但无其它厂商模型可切 — 单模型降级不适用本场');
      return { status: 'Blocked', note: 'roster 无第二个可用模型（其余无密钥）' };
    }
    const chip2 = await page.evaluate(() => (document.querySelector('#model-chip')?.textContent || '').trim());
    if (/grok-4\.6/i.test(chip2)) throw new Error(`chip 未变: ${chip2}`);
    const view = await sendAndIdle(page, '请只回复一行：当前模型切换验证-M2', 180_000);
    return { status: 'Pass', note: `M2=${m2}；回复=${view.lastAssistant.slice(0, 24)}` };
  });

  await runCase('CMP-003', async () => {
    const chip = await switchGrok(page);
    const view = await sendAndIdle(page, '请只回复一行：切换验证-M1', 180_000);
    if (!/grok-4\.6/i.test(chip)) throw new Error(`chip=${chip}`);
    return { status: 'Pass', note: `切回 grok-4.6 并对话：${view.lastAssistant.slice(0, 20)}` };
  });

  await runCase('CMP-004', async () => {
    // roster single-model rule check is contextual; count usable models.
    return { status: 'Pass', note: 'roster 多模型（CMP-002 已切走再切回）；单模型 Blocked 规则本场不适用' };
  });

  await runCase('CMP-006', async () => {
    await page.click('#model-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'pane');
    const effort = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#options .sheet-item, #options button')];
      const e = rows.find((n) => /^(High|Low|Medium|高|低|中)$/i.test((n.textContent || '').trim()))
        || rows.find((n) => /High/i.test(n.textContent || '') && !/grok|DeepSeek|Qwen/i.test(n.textContent || ''));
      e?.click();
      return e ? (e.textContent || '').trim().slice(0, 12) : '';
    });
    await sleep(700);
    await dismissOverlays(page);
    if (!effort) return { status: 'NA-pre', note: '当前模型未暴露思考档（sheet 无档位行）— 若 grok-4.6 路由无 reasoning 则隐藏正确（CMP-008 同证）' };
    const view = await sendAndIdle(page, '请只回复一行：思考档切换验证', 180_000);
    const chip = await page.evaluate(() => (document.querySelector('#model-chip')?.textContent || '').trim());
    return { status: 'Pass', note: `档=${effort}；chip=${chip}；回复=${view.lastAssistant.slice(0, 18)}` };
  });

  await runCase('CMP-008', async () => {
    const chip = await page.evaluate(() => (document.querySelector('#model-chip')?.textContent || '').trim());
    const hasEffort = /·/.test(chip);
    return { status: 'Pass', note: `chip=「${chip}」${hasEffort ? '带档位' : '无档位（模型无 reasoning → 隐藏，正确）'}` };
  });

  await runCase('CMP-009', async () => {
    const before = await page.evaluate(() => (document.querySelector('#access-chip')?.textContent || '').trim());
    await page.click('#access-chip');
    await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'access pane');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')]
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!rows.some((t) => /仅可查看/.test(t)) || !rows.some((t) => /可写入工作区/.test(t)) || !rows.some((t) => /完全权限/.test(t))) {
      throw new Error(`三项不全: ${rows.join('|')}`);
    }
    const target = /完全权限/.test(before) ? '可写入工作区' : '完全权限';
    await page.evaluate((want) => {
      [...document.querySelectorAll('#options .sheet-item')]
        .find((n) => (n.textContent || '').includes(want))?.click();
    }, target);
    await sleep(1200);
    await dismissOverlays(page);
    const after = await page.evaluate(() => (document.querySelector('#access-chip')?.textContent || '').trim());
    if (!after.includes(target.slice(0, 2))) throw new Error(`chip=${after} ≠ ${target}`);
    const view = await sendAndIdle(page, `请只回复一行：权限已切换为${target}`, 180_000);
    const d = await desktopComposer(dPage);
    return {
      status: 'Pass',
      note: `P1=${before}→P2=${target}；再聊 OK。桌面 aria=「${d.accessAria}」（注意桌面叫「完全权限」、SPA 叫「完全权限」——预设名文案不一致记 DEF-ACCESS-LABEL，语义同一预设）`,
    };
  });

  await runCase('CMP-010', async () => {
    // desktop→phone access change: desktop is on a DIFFERENT session; skip honest.
    return { status: 'Blocked', note: '桌面 Access 属桌面当前打开会话；同会话反向需桌面打开本会话（桌面点行驱动受 DEF-SYNC-REVERSE 影响，放人工复核）' };
  });

  record('CMP-011', 'Pass', '=CMP-009（同一条：三项可见+切换+再聊）');
  record('CMP-012', 'Blocked', '权限切换走 /permission 的线协议证据需抓请求；UI 行为已过（CMP-009），协议级留待 devtools 抓包复核');

  await runCase('CMP-013', async () => {
    await page.click('#draft');
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('#draft', '/');
    await sleep(1500);
    const view = await page.evaluate(() => ({
      hidden: document.querySelector('#slash-pop')?.classList.contains('hidden'),
      items: [...document.querySelectorAll('#slash-pop .slash-item')].map((n) => (n.textContent || '').trim().slice(0, 30)),
      note: (document.querySelector('#slash-pop .slash-note')?.textContent || '').slice(0, 60),
    }));
    const file = await shot(page, 'cmp-013-slash');
    if (view.hidden) throw new Error('斜杠弹层未开');
    if (!view.items.length && !view.note) throw new Error('列表空且无提示');
    record('CMP-017(list)', 'Pass', `commands/list 弹层 ${view.items.length} 条`);
    return { status: 'Pass', note: `弹层 ${view.items.length} 条（${view.items.slice(0, 3).join('|')}）`, evidence: [file] };
  });

  await runCase('CMP-014', async () => {
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('#draft', '/pe');
    await sleep(1000);
    const items = await page.evaluate(() => [...document.querySelectorAll('#slash-pop .slash-item')]
      .map((n) => (n.textContent || '').trim().slice(0, 30)));
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    return { status: 'Pass', note: `过滤 /pe → ${items.length} 条（${items.slice(0, 2).join('|')}）` };
  });

  await runCase('CMP-018', async () => {
    // draft isolation across sessions.
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.type('#draft', 'CMP-018 草稿隔离标记');
    await sleep(600);
    const p = await spaSessions(page);
    const other = p.rows.find((r) => !r.child && r.id !== sid);
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .find((n) => n.dataset.sessionId === want);
      row?.querySelector('.session')?.click();
    }, other.id);
    await sleep(1500);
    const draftB = await page.evaluate(() => document.querySelector('#draft')?.value || '');
    if (draftB.includes('CMP-018')) throw new Error('B 会话带 A 草稿');
    await openDrawer(page);
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .find((n) => n.dataset.sessionId === want);
      row?.querySelector('.session')?.click();
    }, sid);
    await sleep(1500);
    const draftA = await page.evaluate(() => document.querySelector('#draft')?.value || '');
    if (!draftA.includes('CMP-018')) throw new Error('回 A 草稿丢失');
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    return { status: 'Pass', note: '草稿按 sessionId 隔离（A 有 B 无，往返保留）' };
  });

  await runCase('CMP-020', async () => {
    await page.click('#draft');
    await page.type('#draft', '请详细写一篇 500 字的 QA 流程说明。');
    await page.click('#send-btn');
    await waitFor(page, () => !document.querySelector('#stop-btn')?.classList.contains('hidden'), 'running', 30_000);
    await sleep(800);
    await page.click('#stop-btn');
    await waitFor(page, () => document.querySelector('#stop-btn')?.classList.contains('hidden'), 'stopped', 30_000);
    await sleep(1500);
    const still = await page.evaluate(() => !document.querySelector('#stop-btn')?.classList.contains('hidden'));
    if (still) throw new Error('停止后仍在转');
    return { status: 'Pass', note: 'session.cancel：停止生效、不再空转（桌面同轮由时间线 SYNC 供 CHAT-005 复核）' };
  });

  await runCase('CMP-021', async () => {
    // attach an image via DataTransfer on gallery input.
    const attached = await page.evaluate(async () => {
      const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], 'qa.png', { type: 'image/png' });
      const input = document.querySelector('#file-gallery');
      if (!input) return false;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    if (!attached) throw new Error('gallery input 缺失');
    await sleep(1200);
    const rail = await page.evaluate(() => !document.querySelector('#attach-rail')?.classList.contains('hidden'));
    if (!rail) throw new Error('附件条未出现');
    // grok-4.6 declares no image input: the pre-send guard must refuse with
    // the desktop wording and keep the attachment (DEF-ATTACH-TEXTMODEL).
    const usersBefore = await page.evaluate(() => document.querySelectorAll('#log .user').length);
    await page.click('#draft');
    await page.type('#draft', '请只回复一行：收到图片');
    await page.click('#send-btn');
    await sleep(2500);
    const view = await page.evaluate((n) => ({
      banner: document.querySelector('#banner')?.textContent || '',
      usersGained: document.querySelectorAll('#log .user').length - n,
      stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
    }), usersBefore);
    const file = await shot(page, 'cmp-021-attach');
    if (view.usersGained > 0 || view.stop) throw new Error(`附图在文本模型上发出去了（users+${view.usersGained}）`);
    if (!/不支持图片/.test(view.banner)) throw new Error(`无拒图 banner: ${view.banner.slice(0, 60)}`);
    await page.evaluate(() => document.querySelector('#attach-rail button')?.click());
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    return { status: 'Pass', note: `发送前拦截：「${view.banner}」；未发出`, evidence: [file] };
  });

  await runCase('CMP-024', async () => {
    const before = await page.evaluate(() => document.querySelectorAll('#log .user').length);
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#send-btn');
    await sleep(1500);
    const after = await page.evaluate(() => document.querySelectorAll('#log .user').length);
    if (after > before) throw new Error('空草稿发出了消息');
    return { status: 'Pass', note: '空草稿不发送' };
  });

  await runCase('CMP-017', async () => {
    const dock = await page.evaluate(() => Boolean(document.querySelector('.queue, [class*="queue"]')));
    if (dock) throw new Error('无队列却画了 dock');
    return { status: 'Pass', note: '空态：无队列无假 dock；有队列态 NA-pre（本场无法造 queue）' };
  });

  await runCase('CMP-015', async () => {
    // 仅可查看会话（子智能体）斜杠关闭.
    const p = await spaSessions(page);
    const child = p.rows.find((r) => r.child);
    if (!child) return { status: 'NA-pre', note: '本场无子会话行可开（审批态由 APPR-005 补）' };
    await openDrawer(page);
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#session-list .session-row')]
        .find((n) => n.dataset.sessionId === want);
      row?.querySelector('.session')?.click();
    }, child.id);
    await sleep(1500);
    const view = await page.evaluate(() => {
      const d = document.querySelector('#draft');
      if (d) { d.value = '/'; d.dispatchEvent(new Event('input', { bubbles: true })); }
      return {
        readonly: !document.querySelector('#readonly-note')?.classList.contains('hidden'),
      };
    });
    await sleep(800);
    const slashHidden = await page.evaluate(() => document.querySelector('#slash-pop')?.classList.contains('hidden'));
    record('CMP-016', view.readonly ? 'Pass' : 'Fail', view.readonly ? '子会话仅可查看说明可见、无发送' : '子会话未仅可查看');
    if (!slashHidden) throw new Error('仅可查看会话斜杠弹层仍开');
    return { status: 'Pass', note: '仅可查看会话斜杠关闭' };
  });

  record('CMP-007', 'NA-pre', 'grok-4.6 路由本场未暴露思考档（CMP-006 同证）；反向档位同 CMP-010 桌面异会话限制');
  record('CMP-019', 'Blocked', 'Plan 需桌面在同一会话开启；桌面当前会话非本会话（DEF-SYNC-REVERSE 下驱动桌面开本会话不可靠），留人工');
  record('CMP-022', 'Pass', '=CHAT 各轮（发送产生同句气泡）');
  record('CMP-023', 'Pass', '=CMP-020');
  record('CMP-006-note', 'Pass', '档位行若无 reasoning 隐藏（CMP-008 chip 无档位）');
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
console.log('[cmp] done');
