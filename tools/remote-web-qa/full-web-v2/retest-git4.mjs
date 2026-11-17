/**
 * GIT last pass: corrected records for 010/019 (pushes landed on bare `main`),
 * then Pull/diverge/bad-remote on the *main* lineage.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  launchSpa, pairInto, pairingUrl, record, runCase, sleep, shot,
  openDrawer, dismissOverlays,
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
    return { label: '', body: (document.querySelector('#options')?.innerText || '').replace(/\n+/g, '|').slice(0, 160) };
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
  await sleep(800);
  return hit;
}

try {
  await pairInto(page, url);
  await openTmpSession();

  await runCase('GIT-011', async () => {
    const C3 = mkdtempSync(`${tmpdir()}\\dshd-qa-c3-`);
    execFileSync('git', ['clone', '-b', 'main', BARE, `${C3}\\r`], { encoding: 'utf8' });
    writeFileSync(`${C3}\\r\\behind-main.txt`, 'bm\n');
    git(`${C3}\\r`, 'add', '-A');
    execFileSync('git', ['-C', `${C3}\\r`, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'behind-main'], { encoding: 'utf8' });
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
    return { status: 'Pass', note: 'main 谱系 behind → primary=Pull → 拉平' };
  });

  await runCase('GIT-012', async () => {
    const C3 = mkdtempSync(`${tmpdir()}\\dshd-qa-c3b-`);
    execFileSync('git', ['clone', '-b', 'main', BARE, `${C3}\\r`], { encoding: 'utf8' });
    writeFileSync(`${C3}\\r\\div-main.txt`, 'dm\n');
    git(`${C3}\\r`, 'add', '-A');
    execFileSync('git', ['-C', `${C3}\\r`, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div-main clone'], { encoding: 'utf8' });
    git(`${C3}\\r`, 'push', 'origin', 'main');
    writeFileSync(`${TMP}\\div-main-l-${Date.now()}.txt`, 'l\n');
    git(TMP, 'add', '-A');
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'commit', '-m', 'div-main local'], { encoding: 'utf8' });
    git(TMP, 'fetch', 'origin');
    const primary = await waitPrimary(/Sync branch/, 60_000);
    const body = await page.evaluate(() => (document.querySelector('#options')?.innerText || '').slice(0, 300));
    const file = await shot(page, 'git-012-diverged');
    await dismissOverlays(page);
    const hint = /变基|合并|rebase|merge|分叉/i.test(body);
    if (!primary.disabled && !hint) throw new Error(`未禁用无 hint（${JSON.stringify(primary)}）`);
    return { status: 'Pass', note: `分叉（main 谱系）：Sync branch disabled=${primary.disabled} hint=${hint}`, evidence: [file] };
  });

  await runCase('GIT-014', async () => {
    execFileSync('git', ['-C', TMP, '-c', 'user.email=qa@dshd', '-c', 'user.name=dshd-qa', 'pull', '--rebase', 'origin', 'main'], { encoding: 'utf8' });
    git(TMP, 'remote', 'set-url', 'origin', 'C:\\Ai\\no-such-remote.git');
    const primary = await waitPrimary(/^Push$|Push & create PR/, 60_000);
    await clickPrimary(/^Push$|Push & create PR/);
    const deadline = Date.now() + 30_000;
    let err = '';
    while (Date.now() < deadline && !err) {
      await sleep(2000);
      const t = await page.evaluate(() => (document.querySelector('#toast-root')?.textContent || '')
        + '|' + (document.querySelector('#banner')?.textContent || ''));
      if (/失败|错误|error|fatal|无法|not appear/i.test(t)) err = t;
    }
    const file = await shot(page, 'git-014-fail');
    await dismissOverlays(page);
    if (!err) throw new Error('30s 无失败文案');
    await sleep(4000);
    const still = await page.evaluate(() => /进行中/.test(document.querySelector('#toast-root')?.textContent || ''));
    if (still) throw new Error('永久 loading');
    return { status: 'Pass', note: `坏 remote Push 失败可见：「${err.replace(/\s+/g, ' ').slice(0, 70)}」；无永久 loading`, evidence: [file] };
  });
} finally {
  try { git(TMP, 'remote', 'set-url', 'origin', BARE); } catch { /* */ }
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
console.log('[retest-git4] done');
