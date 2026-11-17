/** PAIR-007b: logout in-tab then re-pair with a fresh offer (same tab, no reload). */
import { launchSpa, pairInto, pairingUrl, sleep, waitFor, openDrawer, dismissOverlays } from './lib.mjs';

const url = await pairingUrl();
const { browser, page } = await launchSpa();
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE ${m.text().slice(0, 200)}`); });
try {
  await pairInto(page, url);
  await sleep(2000);
  await dismissOverlays(page);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('#open-settings')?.click());
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('#options button, #options .row, #options .sheet-item')]
      .find((n) => (n.textContent || '').includes('\u65ad\u5f00\u8fd9\u53f0\u8bbe\u5907'))?.click();
  });
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('.dialog button, #sheet-root button')]
      .find((b) => /\u65ad\u5f00|\u9000\u51fa|\u786e\u8ba4/.test(b.textContent || ''))?.click();
  });
  await waitFor(page, () => !document.querySelector('#screen-connect')?.classList.contains('hidden'), 'connect', 15_000);
  console.log('logged out; re-pairing in the same tab after 6s');
  if (process.env.ROTATE_CLIENT_ID === '1') {
    const old = await page.evaluate(() => { const v = localStorage.getItem('dsh-chisacode-client-id'); localStorage.removeItem('dsh-chisacode-client-id'); return v; });
    console.log('rotated clientId (was', old, ')');
  }
  await sleep(6000);
  const fresh = await pairingUrl();
  await page.evaluate((offer) => {
    const input = document.querySelector('#paste');
    input.value = offer;
    document.querySelector('#paste-enter')?.click();
  }, fresh);
  for (let i = 0; i < 12; i += 1) {
    await sleep(5000);
    const s = await page.evaluate(() => ({
      chat: !document.querySelector('#screen-chat')?.classList.contains('hidden'),
      error: document.querySelector('#connect-error')?.textContent || '',
      device: document.querySelector('#device-line')?.textContent || '',
    }));
    console.log(`t+${(i + 1) * 5}s`, JSON.stringify(s));
    if (s.chat || s.error) break;
  }
  console.log(errors.slice(0, 8).join('\n') || 'no page errors');
} finally {
  await browser.close().catch(() => { /* Continue writing the QA result after a browser that may already have exited is closed. */ });
}
