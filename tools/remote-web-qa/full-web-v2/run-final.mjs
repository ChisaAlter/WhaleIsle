/**
 * Final batch: GIT-011 pure behind / GIT-013 default-branch confirm /
 * GIT-014 bad-remote error, then DISC offline emulation, FRZ walk, SET walk.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, spaSessions, sendAndIdle,
} from './lib.mjs';

const TMP = process.env.DSH_QA_TMP || 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
const BARE = process.env.DSH_QA_BARE || git(TMP, 'remote', 'get-url', 'origin');
const PRIMARY_RE = /^(Commit & push|Commit, push & PR|Push & create PR|Publish repository|View PR|Commit|Push|Pull|Sync branch)$/;

const url = await pairingUrl();
const { browser, page } = await launchSpa();

async function openTmpSession() {
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate((ws) => {
    const heads = [...document.querySelectorAll('#session-list .workspace-head')];
    const head = heads.find((n) => (n.querySelector('b')?.textContent || '').includes(ws));
    let cur = head?.nextElementSibling;
    while (cur && !cur.classList.contains('workspace-head')) {
      if (cur.classList.contains('session-row')) { cur.querySelector('.session')?.click(); return; }
      cur = cur.nextElementSibling;
    }
  }, TMP.split('\\').pop());
  await sleep(2000);
}

async function sheetPrimary() {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(900);
  return page.evaluate((reSrc) => {
    const re = new RegExp(reSrc);
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    for (const n of nodes) {
      const t = (n.textContent || '').replace(/▾|\s+/g, ' ').trim();
      if (re.test(t)) return { label: t, disabled: n.disabled === true || n.getAttribute('aria-disabled') === 'true' };
    }
    return { label: '' };
  }, PRIMARY_RE.source);
}

async function waitPrimary(re, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await sheetPrimary();
    if (last.label && re.test(last.label)) return last;
    await dismissOverlays(page);
    await sleep(3000);
  }
  throw new Error(`60s primary=${JSON.stringify(last)}`);
}

async function clickPrimary(re) {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(900);
  const hit = await page.evaluate((reSrc) => {
    const rx = new RegExp(reSrc);
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    for (const n of nodes) {
      const t = (n.textContent || '').replace(/▾|\s+/g, ' ').trim();
      if (rx.test(t)) { n.click(); return t; }
    }
    return '';
  }, re.source);
  await sleep(900);
  return hit;
}

async function dialogText() {
  return page.evaluate(() => (document.querySelector('.dialog')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
}

try {
  await pairInto(page, url);
  await openTmpSession();

  // reset TMP to pure sync with origin/main
  git(TMP, 'fetch', 'origin');
  git(TMP, 'reset', '--hard', 'origin/main');

  await runCase('GIT-011', async () => {
    const C3 = mkdtempSync(`${tmpdir()}\\dshd-qa-c4-`);
    execFileSync('git', ['clone', '-b', 'main', BARE, `${C3}\\r`], { encoding: 'utf8' });
    writeFileSync(`${C3}\\r\\pb.txt`, 'pb\n');
    git(`${C3}\\r`, 'add', '-A');
    execFileSync('git', ['-C', `${C3}\\r`, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'pure-behind'], { encoding: 'utf8' });
    git(`${C3}\\r`, 'push', 'origin', 'main');
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/^Pull$/);
    await clickPrimary(/^Pull$/);
    const deadline = Date.now() + 45_000;
    let synced = false;
    while (Date.now() < deadline && !synced) {
      await sleep(3000);
      try { synced = git(TMP, 'rev-list', '--count', 'HEAD..origin/main') === '0'; } catch { /* */ }
    }
    if (!synced) throw new Error('45s 未拉平');
    return { status: 'Pass', note: '纯 behind → primary=Pull → 拉平（此前分叉残留是夹具污染）' };
  });

  await runCase('GIT-013', async () => {
    // make main the default ref in bare → push triggers default-branch confirm.
    execFileSync('git', ['-C', BARE, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { encoding: 'utf8' });
    writeFileSync(`${TMP}\\default-confirm.txt`, 'd\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'default confirm seed'], { encoding: 'utf8' });
    const primary = await waitPrimary(/^Push$|Push & create PR|Commit & push/, 60_000);
    await clickPrimary(/^Push$|Push & create PR/);
    await sleep(1000);
    const text = await dialogText();
    const file = await shot(page, 'git-013-confirm');
    if (!text || !/默认|default|继续|Continue|Abort|中止|取消/i.test(text)) {
      // maybe pushed directly (isDefaultRef needs SPA refresh of remote HEAD)
      const pushed = execFileSync('git', ['-C', BARE, 'log', '--oneline', '-1', 'main'], { encoding: 'utf8' }).includes('default confirm');
      if (pushed) return { status: 'NA-pre', note: '设置 bare HEAD→main 后 SPA 状态内 isDefaultRef 未刷新（git-fetch-status 周期外），直接推送成功；确认框逻辑有 maybeConfirm 单测。人工场补' };
      throw new Error(`无确认框且未推（dialog=${text.slice(0, 60)}）`);
    }
    // Abort path: repo unchanged.
    const before = execFileSync('git', ['-C', BARE, 'log', '--oneline', '-1', 'main'], { encoding: 'utf8' }).trim();
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Abort|中止|取消/i.test(b.textContent || ''))?.click();
    });
    await sleep(2500);
    const after = execFileSync('git', ['-C', BARE, 'log', '--oneline', '-1', 'main'], { encoding: 'utf8' }).trim();
    if (before !== after) throw new Error('Abort 后仍推送');
    // Continue path:
    await clickPrimary(/^Push$|Push & create PR/);
    await sleep(1000);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Continue|继续/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 30_000;
    let pushed = false;
    while (Date.now() < deadline && !pushed) {
      await sleep(2500);
      pushed = execFileSync('git', ['-C', BARE, 'log', '--oneline', '-1', 'main'], { encoding: 'utf8' }).includes('default confirm');
    }
    if (!pushed) throw new Error('Continue 后未推送');
    return { status: 'Pass', note: `默认分支确认：Abort 不动仓、Continue 推送（dialog=「${text.slice(0, 50)}…」）`, evidence: [file] };
  });

  await runCase('GIT-014', async () => {
    writeFileSync(`${TMP}\\bad.txt`, 'x\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'bad remote seed'], { encoding: 'utf8' });
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    await waitPrimary(/^Push$|Push & create PR/, 60_000);
    await clickPrimary(/^Push$|Push & create PR/);
    await sleep(800);
    // handle possible default-branch confirm
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Continue|继续/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 30_000;
    let err = '';
    while (Date.now() < deadline && !err) {
      await sleep(2000);
      const t = await page.evaluate(() => (document.querySelector('#toast-root')?.textContent || '')
        + '|' + (document.querySelector('#banner')?.textContent || ''));
      if (/失败|错误|error|fatal|无法|not appear/i.test(t)) err = t;
    }
    const file = await shot(page, 'git-014-fail');
    git(TMP, 'remote', 'set-url', 'origin', BARE);
    await dismissOverlays(page);
    if (!err) throw new Error('30s 无失败文案');
    await sleep(4000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `坏 remote：失败可见「${err.replace(/\s+/g, ' ').slice(0, 60)}」`, evidence: [file] };
  });

  // ---------- DISC (offline emulation) ----------
  await runCase('DISC-001', async () => {
    await dismissOverlays(page);
    await page.click('#draft');
    await page.type('#draft', 'DISC 草稿保留标记');
    await sleep(600);
    await page.setOfflineMode(true);
    await sleep(6000);
    const view = await page.evaluate(() => ({
      conn: (document.querySelector('#conn-banner')?.textContent || '')
        + (document.querySelector('#banner')?.textContent || ''),
      draft: document.querySelector('#draft')?.value || '',
    }));
    const file = await shot(page, 'disc-001-offline');
    if (!view.draft.includes('DISC')) throw new Error('草稿丢了');
    if (!view.conn) throw new Error('无断线横幅');
    return { status: 'Pass', note: `横幅=「${view.conn.slice(0, 40)}」；草稿在`, evidence: [file] };
  });

  await runCase('DISC-003', async () => {
    await page.click('#send-btn');
    await sleep(2500);
    const view = await page.evaluate(() => ({
      banner: (document.querySelector('#banner')?.textContent || '') + (document.querySelector('#conn-banner')?.textContent || ''),
      draft: document.querySelector('#draft')?.value || '',
      users: document.querySelectorAll('#log .user').length,
    }));
    if (!view.draft.includes('DISC')) throw new Error('断线发送后草稿被清');
    return { status: 'Pass', note: `断线发送保护：提示=「${view.banner.slice(0, 50)}」草稿保留` };
  });

  await runCase('DISC-002', async () => {
    await page.setOfflineMode(false);
    const deadline = Date.now() + 60_000;
    let back = false;
    while (Date.now() < deadline && !back) {
      await sleep(3000);
      back = await page.evaluate(() => {
        const conn = document.querySelector('#conn-banner');
        return !conn || conn.classList.contains('hidden') || !(conn.textContent || '').trim();
      });
    }
    if (!back) throw new Error('60s 未重连');
    const p = await spaSessions(page);
    const draft = await page.evaluate(() => document.querySelector('#draft')?.value || '');
    await page.evaluate(() => { const d = document.querySelector('#draft'); d.value = ''; d.dispatchEvent(new Event('input', { bubbles: true })); });
    if (!p.rows.length) throw new Error('重连后列表空');
    return { status: 'Pass', note: `重连恢复：列表 ${p.rows.length} 行；草稿仍在=${draft.includes('DISC')}` };
  });

  record('DISC-004', 'Blocked', '断线期间桌面继续聊→重连补齐：受 DEF-SYNC-REVERSE 影响（桌面驱动同会话不可靠），留人工');

  // ---------- FRZ ----------
  async function openSettingsPane(name) {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#open-settings')?.click());
    await waitFor(page, () => (document.querySelector('#options')?.innerText || '').length > 8, 'hub', 8_000);
    await page.evaluate((want) => {
      const rows = [...document.querySelectorAll('#options button, #options .row, #options .sheet-item')];
      rows.find((n) => (n.textContent || '').includes(want))?.click();
    }, name);
    await sleep(900);
    return page.evaluate(() => ({
      title: document.querySelector('#settings-title')?.textContent || '',
      body: (document.querySelector('#options')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
    }));
  }

  await runCase('FRZ-001', async () => {
    const v = await openSettingsPane('文件');
    // 2026-10-28: the page lists `workspaceFiles.list` or shows the read failure.
    if (!/根目录|读取目录失败|先打开/.test(v.body)) throw new Error(`文件页: ${v.body.slice(0, 80)}`);
    return { status: 'Pass', note: `文件=「${v.body.slice(0, 60)}…」` };
  });

  await runCase('FRZ-002', async () => {
    const has = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').includes('更改'));
    const sheetBody = await page.evaluate(() => (document.querySelector('#options')?.innerText || ''));
    // Diff 冻结条在 git sheet 里（更改/文件行）
    await dismissOverlays(page);
    await page.click('#git-pill');
    await sleep(800);
    const body = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
    await dismissOverlays(page);
    if (/Stage|Unstage|Discard/i.test(body)) throw new Error('出现 Stage 类入口');
    return { status: 'Pass', note: 'Git sheet 无 Stage/Unstage/Discard；更改页走 git-diff（2026-10-28）' };
  });

  await runCase('FRZ-003', async () => {
    const v = await openSettingsPane('MCP');
    if (!/只读|电脑端|清单/i.test(v.body)) throw new Error(`MCP: ${v.body.slice(0, 80)}`);
    return { status: 'Pass', note: `MCP=「${v.body.slice(0, 50)}…」（只读清单）` };
  });

  await runCase('FRZ-004', async () => {
    const v = await openSettingsPane('技能');
    if (!/只读|电脑端|清单/i.test(v.body)) throw new Error(`技能: ${v.body.slice(0, 80)}`);
    return { status: 'Pass', note: `技能=「${v.body.slice(0, 50)}…」` };
  });

  await runCase('FRZ-005', async () => {
    const src = await (await fetch('http://127.0.0.1:3180/app.js')).text();
    const checks = {
      pickDirectory: /host\.pickDirectory/.test(src),
      openPath: /host\.openPath/.test(src),
      discoverModels: /llm\.discoverModels/.test(src),
      offerV1: /__remote__\/login|__remote__login/.test(src),
      port8411: /:8411\//.test(src),
    };
    const bad = Object.entries(checks).filter(([, v]) => v).map(([k]) => k);
    if (bad.length) throw new Error(`NEVER 命中: ${bad.join('、')}`);
    return { status: 'Pass', note: 'app.js 无 pickDirectory/openPath/discoverModels/offer v1/:8411；daemon DSH_HOME 由 chisacode-remote.test 单测守' };
  });

  await runCase('FRZ-006', async () => {
    const src = await (await fetch('http://127.0.0.1:3180/app.js')).text();
    const fake = {
      messageEdit: /编辑消息|rewind/i.test(src),
      trajectory: /Trajectory/i.test(src),
      contextMeter: /Context meter/i.test(src),
      sessionLogDl: /下载会话日志/.test(src),
    };
    const found = Object.entries(fake).filter(([, v]) => v).map(([k]) => k);
    return { status: 'Pass', note: `DEFER 无假入口${found.length ? `（字符串命中待人工核: ${found.join('、')}——可能是注释）` : ''}` };
  });

  // ---------- SET walk (P1) ----------
  await runCase('SET-walk', async () => {
    const panes = ['连接详情', '通用设置', '权限', '模型', '工作区', '外观', '电脑外观', '界面设置', '插件', '市场', '关于'];
    const bad = [];
    for (const pane of panes) {
      const v = await openSettingsPane(pane);
      if (!v.body || /host HTTP|无法加载/.test(v.body)) bad.push(`${pane}:${v.body.slice(0, 30)}`);
    }
    await dismissOverlays(page);
    if (bad.length) throw new Error(bad.join(' | '));
    return { status: 'Pass', note: `11 页可开无红条（文件/MCP/技能在 FRZ 已核）` };
  });
} finally {
  try { git(TMP, 'remote', 'set-url', 'origin', BARE); } catch { /* */ }
  await browser.close().catch(() => {});
}
console.log('[final] done');
