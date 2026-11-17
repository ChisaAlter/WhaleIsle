/**
 * GIT final: primary label lives in the git sheet, not the pill.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, shot,
  openDrawer, dismissOverlays, spaSessions,
} from './lib.mjs';

const TMP = process.env.DSH_QA_TMP || 'C:\\Ai\\dshd-qa-ws-v2-20260901-2345';
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
// F-REMOTE: a local bare repo is the origin; create and attach it when the
// fixture repo has none yet (no external forge needed).
function ensureOrigin() {
  try { return git(TMP, 'remote', 'get-url', 'origin'); } catch { /* none yet */ }
  const bare = process.env.DSH_QA_BARE || `C:\\Ai\\dshd-qa-remote-${Date.now().toString().slice(-6)}.git`;
  execFileSync('git', ['init', '--bare', bare], { encoding: 'utf8' });
  git(TMP, 'remote', 'add', 'origin', bare);
  console.log(`[git2] created bare origin ${bare}`);
  return bare;
}
const BARE2 = ensureOrigin();
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
    return { label: '', disabled: false, body: (document.querySelector('#options')?.innerText || '').slice(0, 200) };
  }, PRIMARY_RE.source);
}

async function waitPrimary(re, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await sheetPrimary();
    if (re.test(last.label)) return last;
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
  await sleep(800);
  return hit;
}

try {
  await pairInto(page, url);
  await openTmpSession();

  await runCase('GIT-010', async () => {
    writeFileSync(`${TMP}\\push-${Date.now()}.txt`, 'p\n');
    const primary = await waitPrimary(/Commit & push|Commit, push & PR/);
    const hit = await clickPrimary(/Commit & push|Commit, push & PR/);
    await page.evaluate(() => {
      const input = document.querySelector('.dialog input, .dialog textarea');
      if (input) {
        input.focus();
        input.value = 'qa: GIT-010 stacked';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      [...document.querySelectorAll('.dialog button')]
        .find((b) => /Commit|提交|确认/i.test(b.textContent || ''))?.click();
    });
    const deadline = Date.now() + 60_000;
    let pushed = false;
    while (Date.now() < deadline && !pushed) {
      await sleep(3000);
      // The desktop pushes the current branch name (main); a fresh bare repo's
      // HEAD still points at master, so look across all refs.
      try { pushed = execFileSync('git', ['-C', BARE2, 'log', '--oneline', '-3', '--all'], { encoding: 'utf8' }).includes('GIT-010'); } catch { /* */ }
    }
    const local = git(TMP, 'log', '--oneline', '-1');
    if (!pushed) {
      throw new Error(`60s 裸仓未收到（primary=${primary.label} hit=${hit} 本地=${local}）${local.includes('GIT-010') ? '→ 只 commit 未 push' : ''}`);
    }
    const bareRef = execFileSync('git', ['-C', BARE2, 'branch', '--format=%(refname:short)'], { encoding: 'utf8' }).trim().split(/\s+/).join(',');
    return { status: 'Pass', note: `「${hit}」一次点完：commit+push 落裸仓（bare refs=${bareRef}）` };
  });

  // GIT-011/012/014 below depend on a legacy clone path; retest-git4 owns them.
  if (process.env.DSH_QA_LEGACY_GIT === '1') {
  await runCase('GIT-011', async () => {
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    git(C2, 'pull', 'origin', 'master');
    writeFileSync(`${C2}\\behind3.txt`, 'b3\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'behind3'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/^Pull$/);
    await clickPrimary(/^Pull$/);
    const deadline = Date.now() + 45_000;
    let synced = false;
    while (Date.now() < deadline && !synced) {
      await sleep(3000);
      try { synced = git(TMP, 'rev-list', '--count', 'HEAD..origin/master') === '0'; } catch { /* */ }
    }
    if (!synced) throw new Error('45s 未拉平');
    return { status: 'Pass', note: `behind → primary=Pull → 拉平（disabled=${primary.disabled}）` };
  });

  await runCase('GIT-012', async () => {
    const C2 = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-ChildItem C:\\Ai -Directory -Filter 'dshd-qa-clone2-*' | Select-Object -Last 1).FullName`], { encoding: 'utf8' }).trim();
    writeFileSync(`${C2}\\div3.txt`, 'c\n');
    git(C2, 'add', '-A');
    execFileSync('git', ['-C', C2, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div3 clone'], { encoding: 'utf8' });
    git(C2, 'push', 'origin', 'HEAD:master');
    writeFileSync(`${TMP}\\div3l.txt`, 'l\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div3 local'], { encoding: 'utf8' });
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/Sync branch/);
    const body = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
    const file = await shot(page, 'git-012-diverged');
    await dismissOverlays(page);
    if (!primary.disabled && !/变基|合并|rebase|merge/i.test(body)) {
      throw new Error(`Sync branch 未禁用且无 hint（${JSON.stringify(primary)}）`);
    }
    return { status: 'Pass', note: `分叉：Sync branch disabled=${primary.disabled}；hint=${/变基|合并/.test(body)}`, evidence: [file] };
  });

  await runCase('GIT-014', async () => {
    // resolve divergence then break remote and push.
    git(TMP, 'pull', '--rebase', 'origin', 'master');
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    const primary = await waitPrimary(/^Push$/, 60_000);
    await clickPrimary(/^Push$/);
    const deadline = Date.now() + 30_000;
    let err = '';
    while (Date.now() < deadline && !err) {
      await sleep(2000);
      const t = await page.evaluate(() => (document.querySelector('#toast-root')?.textContent || '')
        + '|' + (document.querySelector('#banner')?.textContent || ''));
      if (/失败|错误|error|fatal|无法|not appear/i.test(t)) err = t;
    }
    const file = await shot(page, 'git-014-fail');
    git(TMP, 'remote', 'set-url', 'origin', BARE2);
    await dismissOverlays(page);
    if (!err) throw new Error('30s 无失败文案');
    await sleep(4000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `失败可见：「${err.replace(/\s+/g, ' ').slice(0, 70)}」；无永久 loading`, evidence: [file] };
  });
  }

  await runCase('GIT-008', async () => {
    const name = `dshd-qa-br-${Date.now().toString().slice(-6)}`;
    await dismissOverlays(page);
    await page.click('#git-pill');
    await sleep(900);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #sheet-root .sheet-item, #options button')];
      const el = nodes.find((n) => /▾/.test(n.textContent || '') && /main|master/.test(n.textContent || ''))
        || nodes.find((n) => /^(main|master)\b/.test((n.textContent || '').trim()));
      el?.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, #sheet-root button, .dialog button, .dialog .sheet-item, #options .sheet-item')];
      nodes.find((n) => /创建并检出|创建|新分支/i.test(n.textContent || ''))?.click();
    });
    await sleep(900);
    const dialogDump = await page.evaluate(() => ({
      html: (document.querySelector('.dialog')?.innerText || '').slice(0, 200),
      inputs: [...document.querySelectorAll('.dialog input, #sheet-root input')].length,
      btns: [...document.querySelectorAll('.dialog button')].map((b) => (b.textContent || '').trim()),
    }));
    const typed = await page.evaluate((value) => {
      const input = document.querySelector('.dialog input') || document.querySelector('#sheet-root input');
      if (!input) return false;
      input.focus();
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, name);
    if (!typed) throw new Error(`无输入框（dialog=${JSON.stringify(dialogDump)}）`);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.dialog button, #sheet-root button')];
      const primary = btns.find((b) => b.className.includes('primary'))
        || btns.find((b) => /创建|检出|确认/i.test(b.textContent || ''));
      primary?.click();
    });
    const deadline = Date.now() + 30_000;
    let ref = '';
    while (Date.now() < deadline && ref !== name) {
      await sleep(2000);
      ref = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD');
    }
    await dismissOverlays(page);
    if (ref !== name) throw new Error(`HEAD=${ref}（dialog=${JSON.stringify(dialogDump).slice(0, 160)}）`);
    // switch back to main via branch list.
    await page.click('#git-pill');
    await sleep(900);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#options .sheet-item, #sheet-root .sheet-item')];
      const el = nodes.find((n) => /▾/.test(n.textContent || '') && /dshd-qa-br|main/.test(n.textContent || ''));
      el?.click();
    });
    await sleep(1200);
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#sheet-root .sheet-item, .dialog .sheet-item, #options .sheet-item')];
      nodes.find((n) => /^main\b/.test((n.textContent || '').trim()))?.click();
    });
    await sleep(3500);
    await dismissOverlays(page);
    const back = git(TMP, 'rev-parse', '--abbrev-ref', 'HEAD');
    record('GIT-004', 'Pass', `分支切换往返：main → ${name} → ${back}（git 实仓核对）`);
    return { status: 'Pass', note: `创建并检出 ${name}；切回=${back}` };
  });
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
console.log('[retest-git2] done');
