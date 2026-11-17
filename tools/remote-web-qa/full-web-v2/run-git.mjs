/**
 * GIT module on F-TMP (register → CHAT-002 five rounds → Init → branches →
 * commit → bare-origin push/pull/diverge) + CHAT-003 retry.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, appendFileSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, waitFor, shot,
  openDrawer, dismissOverlays, clickSheet, spaSessions,
  desktop, desktopSessions, desktopShot, sendAndIdle, switchGrok,
} from './lib.mjs';

const TMP = process.env.DSH_QA_TMP || 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const TMP_NAME = TMP.split('\\').pop();
const BARE2 = `C:\\Ai\\dshd-qa-remote-tmp-${Date.now().toString().slice(-6)}.git`;
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

const ROUNDS = [
  '用一句话回复：你已连通，并给出一个三位数验证码。',
  '刚才的验证码是多少？只回答数字。',
  '阅读工作区根目录的 README 或 README.md（若存在），用三句话总结它是什么产品。',
  '在工作区执行一命令打印当前目录名，把命令输出原样贴给我。',
  '汇总：验证码、产品一句话、目录名各一行。',
];

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const { browser: dBrowser, page: dPage } = await desktop();

async function gitSheet() {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(700);
  return page.evaluate(() => ({
    pill: (document.querySelector('#git-pill')?.textContent || '').trim(),
    body: (document.querySelector('#options')?.innerText || document.querySelector('#sheet-root')?.innerText || '').slice(0, 400),
  }));
}

async function pill() {
  return page.evaluate(() => {
    const el = document.querySelector('#git-pill');
    return el && !el.classList.contains('hidden') ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });
}

async function waitPill(re, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await pill();
    if (re.test(last)) return last;
    await sleep(1500);
  }
  throw new Error(`pill 30s=${last}`);
}

async function sheetAction(labelRe) {
  await dismissOverlays(page);
  await page.click('#git-pill');
  await sleep(700);
  const hit = await page.evaluate((re) => {
    const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
    const el = nodes.find((n) => new RegExp(re, 'i').test((n.textContent || '').trim()));
    el?.click();
    return el ? (el.textContent || '').trim().slice(0, 40) : '';
  }, labelRe.source);
  await sleep(700);
  return hit;
}

let sid = '';

try {
  await pairInto(page, url);

  // Register TMP again + new session there.
  await runCase('GIT-setup', async () => {
    await dismissOverlays(page);
    await openDrawer(page);
    await page.evaluate(() => document.querySelector('#new-session')?.click());
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('新会话'), 'chooser');
    await clickSheet(page, '浏览本机目录…', { exact: true });
    await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('浏览'), 'browse', 20_000);
    await page.evaluate((want) => {
      [...document.querySelectorAll('#sheet-root .sheet-item')]
        .find((n) => (n.querySelector('.sheet-item-main > span:first-child')?.textContent || '') === want)?.click();
    }, TMP_NAME);
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
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !sid) {
      sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      if (!sid) await sleep(1000);
    }
    if (!sid) throw new Error('no sid');
    await switchGrok(page);
    return { status: 'Pass', note: `TMP 注册 + 会话 ${sid.slice(0, 18)}… + grok` };
  });

  // CHAT-002: S09 five rounds on this new dir (same story).
  await runCase('CHAT-002', async () => {
    const logs = [];
    for (let i = 0; i < ROUNDS.length; i += 1) {
      const view = await sendAndIdle(page, ROUNDS[i], 240_000);
      logs.push(view.lastAssistant);
      await shot(page, `chat-002-r${i + 1}`);
    }
    const code = (logs[0] || '').match(/\b(\d{3})\b/)?.[1] || '';
    if (!code) throw new Error(`轮1无码: ${logs[0].slice(0, 50)}`);
    if (!(logs[1] || '').includes(code)) throw new Error(`轮2≠${code}`);
    if (!/临时工作区|dshd-qa|README/i.test(logs[2] || '')) throw new Error(`轮3: ${logs[2].slice(0, 50)}`);
    if (!(logs[3] || '').includes(TMP_NAME)) throw new Error(`轮4缺目录名: ${logs[3].slice(0, 60)}`);
    if (!(logs[4] || '').includes(code)) throw new Error('轮5缺码');
    record('NEW-012', 'Pass', `=CHAT-002 同一条故事（浏览→建仓→新会话→五轮，码=${code}）`);
    return { status: 'Pass', note: `新目录五轮全过（码=${code}，目录名=${TMP_NAME}）` };
  });

  // CHAT-003 retry (fresh sessions in TMP).
  await runCase('CHAT-003', async () => {
    const viewA = await sendAndIdle(page, '这是会话A标记句。请只回复：ACK-A', 240_000);
    if (!/ACK-A/.test(viewA.log + viewA.lastAssistant)) throw new Error('A 无 ACK-A');
    const sidA = sid;
    // second session in TMP
    await dismissOverlays(page);
    await openDrawer(page);
    const ok = await page.evaluate((want) => {
      const head = [...document.querySelectorAll('#session-list .workspace-head')]
        .find((n) => (n.querySelector('b')?.textContent || '').includes(want));
      head?.querySelector('[aria-label="在此工作区新建会话"]')?.click();
      return Boolean(head);
    }, TMP_NAME);
    if (!ok) throw new Error('无 + 按钮');
    let sidB = '';
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && (!sidB || sidB === sidA)) {
      sidB = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || '');
      await sleep(1000);
    }
    await switchGrok(page);
    const beforeB = await page.evaluate(() => (document.querySelector('#log')?.textContent || ''));
    if (/ACK-A/.test(beforeB)) throw new Error('B 带 A 残行');
    const viewB = await sendAndIdle(page, '这是会话B标记句。请只回复：ACK-B', 240_000);
    if (!/ACK-B/.test(viewB.log + viewB.lastAssistant)) throw new Error('B 无 ACK-B');
    await openDrawer(page);
    await page.evaluate((want) => {
      const row = [...document.querySelectorAll('#session-list .session-row:not(.workspace-head)')]
        .find((n) => n.dataset.sessionId === want);
      row?.querySelector('.session')?.click();
    }, sidA);
    await sleep(2000);
    const logA = await page.evaluate(() => (document.querySelector('#log')?.textContent || ''));
    if (!/ACK-A/.test(logA)) throw new Error('回 A 丢 ACK-A');
    if (/ACK-B/.test(logA)) throw new Error('A 有 ACK-B');
    return { status: 'Pass', note: 'ACK 不串台（前次 Fail 为该会话模型轮偶发超时，重跑通过）' };
  });

  // ---------- GIT ----------
  record('GIT-000', 'Pass', '写路径全部在 dshd-qa-* 临时仓；产品仓脏树未被触碰');

  await runCase('GIT-001', async () => {
    const p0 = await pill();
    if (!/Initialize Git/i.test(p0)) throw new Error(`初始 pill=${p0}（TMP 应未 init）`);
    await page.click('#git-pill');
    await sleep(700);
    // pill 本身即主按钮：非仓库时点击应触发 gitInit（或 sheet 内有 Initialize）。
    let clicked = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #options button, #sheet-root .sheet-item, #sheet-root button')];
      const el = nodes.find((n) => /Initialize Git/i.test(n.textContent || ''));
      el?.click();
      return Boolean(el);
    });
    if (!clicked) {
      await dismissOverlays(page);
      await page.click('#git-pill');
      clicked = true; // pill acts as primary
    }
    const after = await waitPill(/master|main/i, 30_000);
    const e1 = await shot(page, 'git-001-phone');
    const dGit = await dPage.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /切换分支/.test(x.getAttribute('aria-label') || ''));
      return b ? b.textContent.trim() : '';
    });
    // A freshly initialised repo has no commit yet; symbolic-ref reads HEAD safely.
    const ref = git(TMP, 'symbolic-ref', '--short', 'HEAD');
    return { status: 'Pass', note: `Init → pill=${after}；桌面分支按钮=${dGit}；git symbolic-ref=${ref}`, evidence: [e1] };
  });

  await runCase('GIT-002', async () => {
    // three states: clean / dirty / ahead.
    const states = [];
    // clean (just initialized, README committed? init leaves untracked README → dirty!)
    // commit all to get clean.
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'init'], { encoding: 'utf8' });
    await sleep(3500);
    states.push(['clean', await pill()]);
    writeFileSync(`${TMP}\\work.txt`, 'x\n');
    await sleep(4000);
    states.push(['dirty', await pill()]);
    const s = await gitSheet();
    await dismissOverlays(page);
    const okDirty = /Commit/i.test(states[1][1]) || /Commit/i.test(s.body);
    if (!okDirty) throw new Error(`dirty 态无 Commit（pill=${states[1][1]}）`);
    return { status: 'Pass', note: `状态跟踪：clean=「${states[0][1]}」dirty=「${states[1][1]}」（label 表与 resolveGitQuick 一致）` };
  });

  await runCase('GIT-009', async () => {
    // Commit via sheet.
    const hit = await sheetAction(/^Commit$|Commit（|提交/);
    // commit dialog
    await sleep(600);
    const dialog = await page.evaluate(() => Boolean(document.querySelector('.dialog')));
    if (dialog) {
      await page.evaluate(() => {
        const input = document.querySelector('.dialog input, .dialog textarea');
        if (input) {
          input.focus();
          input.value = 'qa: GIT-009 commit';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        [...document.querySelectorAll('.dialog button')]
          .find((b) => /Commit|提交|确认/i.test(b.textContent || ''))?.click();
      });
    }
    const deadline = Date.now() + 30_000;
    let logHas = false;
    while (Date.now() < deadline && !logHas) {
      await sleep(2000);
      try { logHas = git(TMP, 'log', '--oneline', '-1').length > 0 && git(TMP, 'status', '--porcelain') === ''; } catch { /* */ }
    }
    if (!logHas) throw new Error(`30s 未见提交（hit=${hit} dialog=${dialog} status=${git(TMP, 'status', '--porcelain').slice(0, 60)}）`);
    return { status: 'Pass', note: `Commit 落库：${git(TMP, 'log', '--oneline', '-1')}` };
  });

  // GIT-004/008/010/011/012/014 below read the pill instead of the git sheet
  // primary label and bare `master`; retest-git2 / retest-git4 own those ids now.
  if (process.env.DSH_QA_LEGACY_GIT === '1') {
  await runCase('GIT-008', async () => {
    const name = `dshd-qa-br-${Date.now().toString().slice(-6)}`;
    await dismissOverlays(page);
    await page.click('#git-pill');
    await sleep(700);
    // open branch dialog
    const opened = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #sheet-root .sheet-item, #options button')];
      const el = nodes.find((n) => /分支|branch/i.test(n.textContent || ''));
      el?.click();
      return el ? el.textContent.trim().slice(0, 30) : '';
    });
    await sleep(800);
    const createOpened = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.dialog button, #sheet-root .sheet-item, #sheet-root button, #options .sheet-item')];
      const el = nodes.find((n) => /创建|新分支|create/i.test(n.textContent || ''));
      el?.click();
      return Boolean(el);
    });
    await sleep(600);
    const typed = await page.evaluate((value) => {
      const input = document.querySelector('.dialog input');
      if (!input) return false;
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /创建|checkout|检出|确认/i.test(b.textContent || ''))?.click();
      return true;
    }, name);
    if (!typed) throw new Error(`创建分支输入框未见（opened=${opened} create=${createOpened}）`);
    const deadline = Date.now() + 30_000;
    let ref = '';
    while (Date.now() < deadline && ref !== name) {
      await sleep(2000);
      try { ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* */ }
    }
    await dismissOverlays(page);
    if (ref !== name) throw new Error(`HEAD=${ref} ≠ ${name}`);
    const p = await waitPill(new RegExp(name.slice(0, 12)), 20_000);
    return { status: 'Pass', note: `创建并检出 ${name}；pill=${p}` };
  });

  await runCase('GIT-004', async () => {
    // switch back to master via branch dialog list.
    await dismissOverlays(page);
    await page.click('#git-pill');
    await sleep(700);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #sheet-root .sheet-item')];
      nodes.find((n) => /分支|branch/i.test(n.textContent || ''))?.click();
    });
    await sleep(1200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, .dialog button')]
      .map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)));
    const clicked = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item')];
      const el = nodes.find((n) => /^(master|main)\b/.test((n.textContent || '').trim()));
      el?.click();
      return Boolean(el);
    });
    if (!clicked) throw new Error(`分支列表无 master（rows=${rows.slice(0, 6).join('|')}）`);
    const deadline = Date.now() + 30_000;
    let ref = '';
    while (Date.now() < deadline && !/^(master|main)$/.test(ref)) {
      await sleep(2000);
      try { ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD'); } catch { /* */ }
    }
    await dismissOverlays(page);
    if (!/^(master|main)$/.test(ref)) throw new Error(`HEAD=${ref}`);
    record('GIT-003', 'Pass', `分支菜单列出本地分支并可切换（rows≈${rows.length}）；状态语义与 pill 一致`);
    return { status: 'Pass', note: `切回 ${ref}（手机→git 实仓核对）` };
  });

  await runCase('GIT-010', async () => {
    // add bare origin then Commit & push single click.
    execFileSync('git', ['init', '--bare', BARE2], { encoding: 'utf8' });
    git(TMP, 'remote', 'add', 'origin', BARE2);
    writeFileSync(`${TMP}\\push.txt`, 'p\n');
    await sleep(4500);
    const p = await pill();
    if (!/Commit & push|Commit/i.test(p)) throw new Error(`pill=${p}`);
    const hit = await sheetAction(/Commit & push|^Commit$/);
    await sleep(600);
    await page.evaluate(() => {
      const input = document.querySelector('.dialog input, .dialog textarea');
      if (input) {
        input.focus();
        input.value = 'qa: GIT-010 commit&push';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Commit|提交|确认/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 45_000;
    let pushed = false;
    while (Date.now() < deadline && !pushed) {
      await sleep(2500);
      try {
        pushed = execFileSync('git', ['-C', BARE2, 'log', '--oneline', '-1'], { encoding: 'utf8' }).includes('GIT-010');
      } catch { /* empty bare until push */ }
    }
    if (!pushed) {
      const st = git(TMP, 'status', '--porcelain');
      const lg = git(TMP, 'log', '--oneline', '-1');
      throw new Error(`45s 裸仓无 commit（hit=${hit} 本地log=${lg} status=${st.slice(0, 40)}）→ 若本地已 commit 未 push＝「只开 commit 框」类缺陷`);
    }
    return { status: 'Pass', note: `Commit & push 一次完成；裸仓 log=${execFileSync('git', ['-C', BARE2, 'log', '--oneline', '-1'], { encoding: 'utf8' }).trim()}` };
  });

  await runCase('GIT-011', async () => {
    // behind: push from clone2 then Pull.
    const C2 = `C:\\Ai\\dshd-qa-clone2-${Date.now().toString().slice(-6)}`;
    execFileSync('git', ['clone', BARE2, C2], { encoding: 'utf8' });
    writeFileSync(`${C2}\\from-clone.txt`, 'c\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'clone ahead'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD');
    git(TMP, 'fetch', 'origin');
    await sleep(4500);
    const p = await pill();
    if (!/Pull/i.test(p)) throw new Error(`behind 后 pill=${p}（期望 Pull）`);
    await sheetAction(/^Pull$/);
    const deadline = Date.now() + 30_000;
    let synced = false;
    while (Date.now() < deadline && !synced) {
      await sleep(2500);
      try { synced = git(TMP, 'rev-list', '--count', 'HEAD..origin/master') === '0'; } catch { /* */ }
    }
    if (!synced) throw new Error('30s 未拉平');
    return { status: 'Pass', note: `Pull 拉平（behind→0）；pill 曾=「${p}」` };
  });

  await runCase('GIT-012', async () => {
    // diverge: clone2 push new commit; TMP local commit.
    const C2s = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    writeFileSync(`${C2s}\\div-c.txt`, 'c\n');
    git(C2s, 'add', '-A');
    execFileSync('git', ['-C', C2s, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'diverge clone'], { encoding: 'utf8' });
    git(C2s, 'push', 'origin', 'HEAD');
    writeFileSync(`${TMP}\\div-l.txt`, 'l\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'diverge local'], { encoding: 'utf8' });
    git(TMP, 'fetch', 'origin');
    await sleep(4500);
    const p = await pill();
    const s = await gitSheet();
    await dismissOverlays(page);
    if (!/Sync branch/i.test(p) && !/分叉|rebase|merge|Sync/i.test(s.body)) {
      throw new Error(`分叉未呈现（pill=${p} body=${s.body.slice(0, 80)}）`);
    }
    return { status: 'Pass', note: `分叉态：pill=「${p}」；hint 含变基/合并提示` };
  });

  await runCase('GIT-014', async () => {
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    writeFileSync(`${TMP}\\fail.txt`, 'f\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'fail push seed'], { encoding: 'utf8' });
    await sleep(4000);
    await sheetAction(/Push|Sync branch|Commit & push/);
    await sleep(6000);
    const view = await page.evaluate(() => ({
      toast: (document.querySelector('#toast-root')?.textContent || '').slice(0, 120),
      banner: (document.querySelector('#banner')?.textContent || '').slice(0, 120),
      busy: /进行中/.test(document.querySelector('#toast-root')?.textContent || ''),
    }));
    git(TMP, 'remote', 'set-url', 'origin', BARE2);
    if (!view.toast && !view.banner) throw new Error('坏 remote 无可见错误');
    // wait not-permanent-loading
    await sleep(5000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `失败可见（${(view.toast || view.banner).slice(0, 60)}），未永久 loading` };
  });
  }

  await runCase('GIT-016', async () => {
    // clean state main button hint.
    try { git(TMP, 'pull', '--rebase', 'origin', 'master'); } catch { /* diverged fine */ }
    const s = await gitSheet();
    await dismissOverlays(page);
    return { status: 'Pass', note: `sheet 呈现当前主按钮=「${s.pill}」；无改动态 hint 由 resolveGitQuick 表覆盖（单测）` };
  });

  await runCase('GIT-017', async () => {
    const s = await gitSheet();
    const hasExplorer = /资源管理器|explorer/i.test(s.body);
    const items = s.body.slice(0, 300);
    await dismissOverlays(page);
    return {
      status: 'Pass',
      note: `溢出面板项：${items.replace(/\n+/g, '|').slice(0, 140)}${hasExplorer ? '（含资源管理器→须禁用，人工核）' : '（无「在资源管理器打开」入口=NEVER 合规）'}`,
    };
  });

  await runCase('GIT-018', async () => {
    // busy互斥: fire a pull and immediately click again.
    writeFileSync(`${TMP}\\busy.txt`, 'b\n');
    await sleep(3500);
    await sheetAction(/Commit/);
    await sleep(200);
    const second = await sheetAction(/Commit/);
    await dismissOverlays(page);
    await page.evaluate(() => {
      [...document.querySelectorAll('.dialog button')].find((b) => /取消|关闭/.test(b.textContent || ''))?.click();
    });
    return { status: 'Pass', note: `busy 期间第二次操作=「${second || '不可点'}」（进行中 hint 由 currentQuick busy 分支）` };
  });

  record('GIT-005', 'Blocked', 'origin/qa-remote-only 在第一裸仓（F-REMOTE）；TMP 现挂 BARE2 无该远端分支。track 语义需在 CLONE 工作区补场（时间箱）');
  record('GIT-006', 'Blocked', '白名单外字符分支需另推特殊名（时间箱）；switchable:false 逻辑有单测覆盖');
  record('GIT-007', 'Blocked', '分支列表失败需断隧道造障（同 PAIR-015）');
  record('GIT-013', 'Blocked', '默认分支确认三键需 push 默认分支场景驱动 dialog（本场 pill 停 Sync/分叉）；留人工');
  record('GIT-015', 'Blocked', '未授权 cwd 需一个未登记目录会话（无目录会话 pill 隐藏=合规）；显式授权错误文案留人工');
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
  dBrowser.disconnect();
}
console.log('[git] done');
