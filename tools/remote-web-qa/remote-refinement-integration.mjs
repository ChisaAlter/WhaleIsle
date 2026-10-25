/** Isolated source-Electron/real-relay pairing checks. Credentials never enter the report. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reservePort } from '../../scripts/smoke-workspace.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'vendor/chisacode-remote/package.json'));
const { chromium } = require('playwright-core');
const { createMobileWebServer, listenMobileWebServer } = require('../../src/main/mobile-web-server.js');
const electron = join(root, 'node_modules/electron/dist/electron.exe');
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert.ok(existsSync(electron) && existsSync(chrome), 'Repository Electron and Chrome are required');
const outputBase = resolve(process.argv[2] || join(root, '.tmp/remote-refinement-integration'));
await mkdir(outputBase, { recursive: true });
const output = await mkdtemp(join(outputBase, 'run-'));
const userData = join(output, 'user-data');
const workspace = join(output, 'workspace');
await mkdir(userData); await mkdir(workspace);
const harnessPort = await reservePort();
const remotePort = await reservePort();
const debugPort = await reservePort();
await writeFile(join(userData, 'config.json'), JSON.stringify({
  workspace, host: '127.0.0.1', port: harnessPort,
  nodeBin: process.execPath, remoteEnabled: false, remoteMode: 'relay', remotePort,
  remoteRelayEndpoint: 'ayase.cn:443', remoteRelayUseTls: true,
  autoStartDesktop: true, quitAfterStart: true, closeToTray: false,
  openAtLogin: false, askOnUpdate: false, pet: { enabled: false },
  live2dPet: { enabled: false }, remoteWorkspaceEnabled: false,
}, null, 2));
const results = [];
const redact = (text) => String(text).replace(/#offer=[A-Za-z0-9_-]+/g, '#offer=<redacted>').replace(/link_[A-Za-z0-9_-]+/g, '<pairing-link>');
let child, desktop, browser, appPage, spa;
let logs = '';
async function until(probe, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Source app exited (${child.exitCode}): ${redact(logs.slice(-2200))}`);
    try { const value = await probe(); if (value) return value; } catch (error) { last = error; }
    await new Promise((done) => setTimeout(done, 300));
  }
  throw new Error(`${message}${last ? `: ${redact(last.message)}` : ''}`);
}
async function check(name, run) {
  await run();
  results.push({ name, ok: true });
  console.log(`PASS ${name}`);
}
const snap = () => appPage.evaluate(() => window.shell.getRemote());
const offer = (url) => JSON.parse(Buffer.from(new URL(url).hash.slice(7), 'base64url'));
const localUrl = (url) => `${spa.origin}/#offer=${new URL(url).hash.slice(7)}`;
async function connectPage(context, url, expected) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(localUrl(url), { waitUntil: 'domcontentloaded' });
  if (expected) {
    await page.locator('#screen-chat:not(.hidden)').waitFor({ timeout: 60000 });
    assert.equal(new URL(page.url()).hash, '', 'Successful enrollment should clear the bootstrap fragment');
  } else {
    try {
      await page.locator('.toast[data-tone="error"]').waitFor({ timeout: 60000 });
      const message = await page.locator('.toast[data-tone="error"]').innerText();
      assert.ok(message.trim(), 'Rejected enrollment needs a visible failure reason');
    } catch (error) {
      await page.screenshot({ path: join(output, 'rejected-browser-failure.png') });
      const state = await page.evaluate(() => ({ chat: !document.querySelector('#screen-chat').classList.contains('hidden'), status: document.querySelector('#device-line').textContent, error: document.querySelector('#toast-root').textContent, hasSavedCredential: Boolean(localStorage.getItem('dsh-chisacode-device-secrets')) }));
      throw new Error(`Revoked-link result missing: ${JSON.stringify(state)}; ${error.message}`);
    }
    assert.equal(await page.locator('#screen-chat:not(.hidden)').count(), 0);
  }
  return page;
}
try {
  console.log(`Source pairing QA starting with isolated ports ${harnessPort}/${remotePort}/${debugPort}`);
  const env = { ...process.env, PATH: `${resolve(process.execPath, '..')};${process.env.PATH || ''}` };
  for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|DSH_HOME|DSHD_HOME|CHISACODE_|DSH_SMOKE|DSH_QA|DSH_REMOTE_PHONE_HOST)/.test(key)) delete env[key];
  child = spawn(electron, ['.', `--user-data-dir=${userData}`, `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=127.0.0.1', '--background', '--dshd-from-launcher', '--no-first-run'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { logs = (logs + redact(chunk.toString())).slice(-100000); });
  await until(async () => { const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`); return response.ok; }, 'Source debugger did not start', 30000);
  desktop = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  appPage = await until(async () => {
    for (const page of desktop.contexts().flatMap((context) => context.pages())) {
      if (!page.url().startsWith(`http://127.0.0.1:${harnessPort}`)) continue;
      if (await page.evaluate(() => typeof window.shell?.getRemote === 'function').catch(() => false)) return page;
    }
    return null;
  }, 'The built Harness page with the authorized remote API did not appear', 180000);
  console.log('Built Harness page and privileged remote API ready');
  await appPage.getByRole('button', { name: /账号菜单|Account menu/ }).waitFor({ timeout: 90000 });
  const initial = await snap();
  assert.equal(initial.enabled, false);
  let first;
  await check('first enable reaches connected QR and independent persistent link', async () => {
    await appPage.evaluate(() => window.shell.saveRemote({ remoteEnabled: true, remoteMode: 'relay' }));
    first = await until(async () => { const s = await snap(); return s.listening && s.relayConnected && s.urls?.[0]?.url && s.pairingLinkUrl ? s : null; }, 'First enable did not reach relay/offer readiness', 90000);
    assert.equal(first.error, '');
    assert.equal(offer(first.pairingLinkUrl).authBootstrap.kind, 'persistent');
    assert.ok(first.pairingExpiresAtMs > Date.now());
    assert.notEqual(first.urls[0].url, first.pairingLinkUrl);
    await appPage.getByRole('button', { name: /账号菜单|Account menu/ }).click();
    await appPage.getByRole('menuitem', { name: /^(远程|Remote)$/ }).click();
    await appPage.locator('[data-dsh-remote-qr] svg').waitFor({ timeout: 15000 });
    assert.equal(await appPage.locator('[data-dsh-remote-copy-link]').isEnabled(), true);
    await appPage.screenshot({ path: join(output, 'desktop-remote-paired.png') });
    await appPage.keyboard.press('Escape');
  });
  await check('refresh changes QR while persistent link stays unchanged', async () => {
    const rotated = await appPage.evaluate(() => window.shell.rotateRemoteToken());
    assert.notEqual(rotated.urls[0].url, first.urls[0].url);
    assert.equal(rotated.pairingLinkUrl, first.pairingLinkUrl);
  });
  const staticServer = createMobileWebServer({ root: join(root, 'mobile/web') });
  await listenMobileWebServer(staticServer, '127.0.0.1', 0);
  spa = { server: staticServer, origin: `http://127.0.0.1:${staticServer.address().port}` };
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const contextB = await browser.newContext({ viewport: { width: 320, height: 640 } });
  let pageA, pageB;
  await check('using the QR refreshes its single-use offer and preserves the persistent link', async () => {
    const before = await snap();
    const scanContext = await browser.newContext();
    await connectPage(scanContext, before.urls[0].url, true);
    const after = await until(async () => { const value = await snap(); return value.urls?.[0]?.url && value.urls[0].url !== before.urls[0].url ? value : null; }, 'Consumed QR did not refresh', 15000);
    assert.equal(after.pairingLinkUrl, before.pairingLinkUrl);
    await scanContext.close();
  });
  await check('same persistent link enrolls two browsers with separate device credentials', async () => {
    pageA = await connectPage(contextA, first.pairingLinkUrl, true);
    pageB = await connectPage(contextB, first.pairingLinkUrl, true);
    const getRecord = (page) => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets') || '{}'))[0]);
    const [a, b] = await Promise.all([getRecord(pageA), getRecord(pageB)]);
    assert.ok(a?.deviceSecret && b?.deviceSecret);
    assert.notEqual(a.deviceId, b.deviceId);
    assert.notEqual(a.deviceSecret, b.deviceSecret);
    await pageA.screenshot({ path: join(output, 'paired-browser.png') });
  });
  await check('an already-paired browser can reopen the same persistent link', async () => {
    const previous = await pageA.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets') || '{}'))[0].deviceId);
    await pageA.goto(localUrl(first.pairingLinkUrl), { waitUntil: 'domcontentloaded' });
    await pageA.locator('#screen-chat:not(.hidden)').waitFor({ timeout: 60000 });
    const next = await pageA.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dsh-chisacode-device-secrets') || '{}'))[0].deviceId);
    assert.notEqual(next, previous, 'Repeated enrollment must issue a new identity instead of replacing an active secret');
    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await pageB.locator('#screen-chat:not(.hidden)').waitFor({ timeout: 60000 });
  });
  let replacement;
  await check('revocation blocks old-link enrollment and keeps existing devices', async () => {
    const before = await snap();
    replacement = await appPage.evaluate(() => window.shell.revokeRemotePairingLink());
    assert.notEqual(replacement.pairingLinkUrl, first.pairingLinkUrl);
    assert.equal(replacement.devices.length, before.devices.length);
    const fresh = await browser.newContext();
    await connectPage(fresh, first.pairingLinkUrl, false);
    await fresh.close();
    const afterRejected = await snap();
    assert.equal(afterRejected.devices.length, before.devices.length, 'Revoked link enrolled a new device');
    for (const page of [pageA, pageB]) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#screen-chat:not(.hidden)').waitFor({ timeout: 60000 });
    }
  });
  await check('replacement persistent link can enroll a new device', async () => {
    const contextC = await browser.newContext();
    await connectPage(contextC, replacement.pairingLinkUrl, true);
    await contextC.close();
  });
  await check('disable and enable preserve replacement link and sticky reconnection', async () => {
    await appPage.evaluate(() => window.shell.saveRemote({ remoteEnabled: false }));
    await appPage.evaluate(() => window.shell.saveRemote({ remoteEnabled: true }));
    const enabled = await until(async () => { const s = await snap(); return s.relayConnected && s.listening ? s : null; }, 'Re-enable did not reconnect relay', 60000);
    assert.equal(enabled.pairingLinkUrl, replacement.pairingLinkUrl);
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.locator('#screen-chat:not(.hidden)').waitFor({ timeout: 60000 });
  });
} catch (error) {
  const message = redact(error.stack || error);
  results.push({ name: 'integration failure', ok: false, error: message });
  console.error(message);
  if (appPage) await appPage.screenshot({ path: join(output, 'desktop-failure.png') }).catch(() => {});
  const statusFile = join(userData, 'last-desktop-start.json');
  if (existsSync(statusFile)) await writeFile(join(output, 'desktop-start.json'), redact(readFileSync(statusFile, 'utf8')));
  process.exitCode = 1;
} finally {
  await appPage?.evaluate(() => window.shell.saveRemote({ remoteEnabled: false })).catch(() => {});
  await browser?.close().catch(() => {});
  await desktop?.close().catch(() => {});
  if (child?.pid && child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  if (spa) await new Promise((done) => spa.server.close(done));
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, fixture: { userData, workspace, harnessPort, remotePort, debugPort } }, null, 2));
  await writeFile(join(output, 'source-log.txt'), logs);
  console.log(`Isolated source results: ${output}`);
}
