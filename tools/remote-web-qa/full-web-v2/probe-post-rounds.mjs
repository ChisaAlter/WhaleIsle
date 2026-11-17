import { launchSpa, pairInto, pairingUrl, sleep, waitFor, openDrawer, dismissOverlays, sendAndIdle, switchGrok } from './lib.mjs';

const WS = process.env.DSH_QA_WS || 'dshd-qa-ws-2026-08-30';
const ROUNDS = [
  '\u7528\u4e00\u53e5\u8bdd\u56de\u590d\uff1a\u4f60\u5df2\u8fde\u901a\uff0c\u5e76\u7ed9\u51fa\u4e00\u4e2a\u4e09\u4f4d\u6570\u9a8c\u8bc1\u7801\u3002',
  '\u5728\u5de5\u4f5c\u533a\u6267\u884c\u4e00\u547d\u4ee4\u6253\u5370\u5f53\u524d\u76ee\u5f55\u540d\uff0c\u628a\u547d\u4ee4\u8f93\u51fa\u539f\u6837\u8d34\u7ed9\u6211\u3002',
];
const dump = (page) => page.evaluate(() => ({
  composerHidden: document.querySelector('#composer')?.classList.contains('hidden'),
  approvalHidden: document.querySelector('#approval')?.classList.contains('hidden'),
  approvalTitle: document.querySelector('#approval-title')?.textContent,
  readonly: document.querySelector('#readonly-note')?.textContent || '',
  stop: !document.querySelector('#stop-btn')?.classList.contains('hidden'),
  run: !document.querySelector('#run-flag')?.classList.contains('hidden'),
  sendDisabled: document.querySelector('#send-btn')?.disabled,
  sendVisible: Boolean(document.querySelector('#send-btn')?.offsetParent),
  draftVisible: Boolean(document.querySelector('#draft')?.offsetParent),
  chipVisible: Boolean(document.querySelector('#access-chip')?.offsetParent),
  users: document.querySelectorAll('#log .user').length,
  banner: document.querySelector('#banner')?.textContent || '',
  settingsOpen: !document.querySelector('#settings')?.classList.contains('hidden'),
  sheet: document.querySelector('#sheet-root .sheet-title')?.textContent || '',
}));

const url = await pairingUrl();
const { browser, page } = await launchSpa();
try {
  await pairInto(page, url);
  await sleep(2500);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#new-session')?.click());
  await waitFor(page, () => (document.querySelector('.sheet-title')?.textContent || '').includes('\u65b0\u4f1a\u8bdd'), 'chooser');
  await page.evaluate((want) => {
    [...document.querySelectorAll('#sheet-root .sheet-item')].find((n) => (n.textContent || '').includes(want))?.click();
  }, WS);
  let sid = '';
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !sid) { sid = await page.evaluate(() => document.querySelector('#phone')?.dataset.sessionId || ''); if (!sid) await sleep(800); }
  await switchGrok(page);
  // set 可写入工作区 so round 2 runs a tool
  await page.click('#access-chip');
  await waitFor(page, () => !document.querySelector('#settings')?.classList.contains('hidden'), 'access');
  await page.evaluate(() => [...document.querySelectorAll('#options .sheet-item')].find((n) => (n.textContent || '').includes('\u53ef\u5199\u5165\u5de5\u4f5c\u533a'))?.click());
  await sleep(800);
  await dismissOverlays(page);
  for (const r of ROUNDS) {
    const v = await sendAndIdle(page, r, 240_000);
    console.log('round done:', v.lastAssistant.slice(0, 40).replace(/\s+/g, ' '));
    console.log('  state:', JSON.stringify(await dump(page)));
  }
  console.log('now try ACK send');
  const s0 = await dump(page);
  console.log('before ACK:', JSON.stringify(s0));
  try {
    await page.click('#draft');
    await page.type('#draft', 'ACK-PROBE');
    await page.click('#send-btn');
    await sleep(3000);
    console.log('after ACK click:', JSON.stringify(await dump(page)));
  } catch (e) {
    console.log('ACK click error:', String(e.message).slice(0, 80));
    console.log('state at error:', JSON.stringify(await dump(page)));
  }
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
