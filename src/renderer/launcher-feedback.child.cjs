'use strict';

// Production renderer and preload, with deferred read-only IPC fixtures.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-feedback-'));
app.setPath('userData', profile);
let checkResolve;
let checkCalls = 0;
let pluginReject;
let recoveryResolve;
let recoveryCalls = 0;
let recoveryNames;
let statusReadFails = false;
let desktopStatus = { version: '0.3.3', desktop: { state: 'ready' }, config: {}, routes: [], forensics: { plugins: [] } };
const handlers = {
  'shell:get-config': () => ({ themeTokens: { scheme: 'light' } }),
  'shell:window-state': () => ({ maximized: false }),
  'shell:launcher-status': () => { if (statusReadFails) throw new Error('fixture status read failed'); return desktopStatus; },
  'shell:disable-suspects-and-start': (_event, names) => { recoveryCalls++; recoveryNames = names; return new Promise(resolve => { recoveryResolve = resolve; }); },
  'shell:components-list': () => ({ components: [] }),
  'shell:list-releases': () => ({ status: 'ok', releases: [], installed: { version: '0.3.3' } }),
  'shell:plugin-forensics': () => new Promise((_resolve, reject) => { pluginReject = reject; }),
  'shell:save-launcher-config': () => { throw new Error('fixture settings save failed'); },
  'shell:scan-import': () => ({ sessions: [], skills: [], plugins: [], mcp: [], settings: [], presets: [] }),
  'shell:check-update': () => { checkCalls++; return new Promise(resolve => { checkResolve = resolve; }); },
};
for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1060, height: 660, useContentSize: true, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, additionalArguments: ['--dshd-shell-role=launcher'] } });
  const js = source => win.webContents.executeJavaScript(source);
  const waitFor = async condition => {
    for (let i = 0; i < 100; i++) {
      if (await js(condition)) return;
      await delay(20);
    }
    throw new Error(`condition timed out: ${condition}`);
  };
  const evidence = process.env.DSHD_FEEDBACK_EVIDENCE_DIR;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const capture = async name => {
    if (!evidence) return;
    await delay(100);
    fs.writeFileSync(path.join(evidence, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const read = () => js(`(() => {
    const b = document.getElementById('btn-check-update'), rect = b.getBoundingClientRect();
    const modal = document.getElementById('app-confirm'), card = modal.querySelector('.modal-card').getBoundingClientRect();
    return { button: { width: rect.width, height: rect.height, text: b.textContent, busy: b.getAttribute('aria-busy'), disabled: b.disabled,
      color: getComputedStyle(b).color, spinner: getComputedStyle(b, '::after').content },
      homeTop: document.querySelector('#panel-home .home-heading').getBoundingClientRect().top,
      modalHidden: modal.hidden, title: document.getElementById('app-confirm-title').textContent,
      body: document.getElementById('app-confirm-body').textContent, cancelVisible: document.getElementById('app-confirm-cancel').checkVisibility(),
      okVisible: document.getElementById('app-confirm-ok').checkVisibility(), focus: document.activeElement.id,
      centered: Math.abs(card.x + card.width / 2 - innerWidth / 2) < 1 && Math.abs(card.y + card.height / 2 - innerHeight / 2) < 1,
      extraLines: document.querySelectorAll('#hint, #home-components-hint, #home-start-progress, #import-scan-status, [data-comp-hint], [data-comp-progress]').length,
      versionsBusy: document.getElementById('btn-check-update-versions').getAttribute('aria-busy'),
      updateVisible: !document.getElementById('home-update').hidden };
  })()`);
  try {
    await win.loadFile(path.join(__dirname, 'launcher.html'));
    if (evidence) win.showInactive();
    await waitFor("document.getElementById('home-version').textContent === 'v0.3.3'");
    const result = { cases: [], errors: [] };
    win.webContents.on('console-message', (_event, ...args) => {
      const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
      if (details.level === 3 || details.level === 'error') result.errors.push(details.message);
    });
    for (const scheme of ['light', 'dark']) {
      await js(`document.documentElement.toggleAttribute('data-ds-dark-theme', ${scheme === 'dark'})`);
      for (const [width, height] of [[1060, 660], [860, 560]]) {
        win.setContentSize(width, height);
        const before = await read();
        await js("document.getElementById('btn-check-update').focus(); document.getElementById('btn-check-update').click(); document.getElementById('btn-check-update-versions').click()");
        await waitFor("document.getElementById('btn-check-update').getAttribute('aria-busy') === 'true'");
        const pending = await read();
        await capture(`checking-${scheme}-${width}`);
        checkResolve({ status: 'current', current: '0.3.3', latest: '0.3.3' });
        await waitFor("!document.getElementById('app-confirm').hidden");
        const current = await read();
        await capture(`current-${scheme}-${width}`);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await delay(30);
        const tabFocus = await js('document.activeElement.id');
        await js("document.getElementById('app-confirm-ok').click(); refreshStatus()");
        await delay(30);
        const dismissed = await read();
        result.cases.push({ scheme, width, before, pending, current, tabFocus, dismissed });
      }
    }
    result.checkCalls = checkCalls;
    result.outcomes = [];
    for (const payload of [{ status: 'none' }, { status: 'error', message: 'ETIMEDOUT' }, { status: 'available', latest: '0.3.4' }, null]) {
      checkResolve = null;
      await js("document.querySelector('[data-tab=versions]').click(); document.getElementById('btn-check-update-versions').click()");
      while (!checkResolve) await delay(10);
      await delay(20);
      checkResolve(payload);
      await waitFor("!document.getElementById('app-confirm').hidden");
      result.outcomes.push({ status: payload?.status || 'invalid', ...await read() });
      await js("document.getElementById('app-confirm-ok').click()");
    }
    // Background results wait for a destructive confirmation instead of replacing it.
    await js("window.confirmAnswer = null; void window.appConfirm({title:'确认删除',body:'fixture',danger:true}).then(value => {window.confirmAnswer=value}); void window.appNotice({title:'后台结果',body:'fixture'})");
    result.confirmSafe = await js("({ title: document.getElementById('app-confirm-title').textContent, focus: document.activeElement.id })");
    await js("document.getElementById('app-confirm').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitFor("document.getElementById('app-confirm-title').textContent === '后台结果'");
    result.confirmAnswer = await js('window.confirmAnswer');
    await js("document.getElementById('app-confirm-ok').click(); window.taskProgress = window.appProgress({title:'安装组件',body:'正在校验'}); document.getElementById('app-confirm').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); window.taskProgress.update('正在下载组件 42%')");
    result.progress = await read();
    await js("window.taskProgress.close(); document.querySelector('[data-tab=plugins]').click()");
    await waitFor("document.getElementById('btn-refresh-plugins').getAttribute('aria-busy') === 'true'");
    pluginReject(new Error('fixture scan failed'));
    await waitFor("!document.getElementById('app-confirm').hidden");
    result.pluginFailure = await js("({ disabled: document.getElementById('btn-refresh-plugins').disabled, busy: document.getElementById('btn-refresh-plugins').getAttribute('aria-busy'), body:document.getElementById('app-confirm-body').textContent })");
    await js("document.getElementById('app-confirm-ok').click(); document.querySelector('[data-tab=import]').click()");
    await waitFor("!document.getElementById('btn-scan').disabled");
    await js("document.getElementById('btn-scan').click()");
    await waitFor("!document.getElementById('app-confirm').hidden");
    result.scan = await read();
    await js("document.getElementById('app-confirm-ok').click(); document.querySelector('[data-tab=settings]').click(); document.getElementById('opt-auto').click()");
    await waitFor("!document.getElementById('app-confirm').hidden");
    result.settings = await read();
    await js("document.getElementById('app-confirm-ok').click(); showTab('home')");
    desktopStatus = { ...desktopStatus, desktop: { state: 'error' }, lastStart: { ok: false, at: 'failure-1' },
      forensics: { pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }, { name: 'healthy-plugin' }] } };
    win.show();
    win.focus();
    await js('refreshStatus()');
    await waitFor("!document.getElementById('app-confirm').hidden");
    result.recoveryPrompt = await read();
    await capture('plugin-recovery-confirm');
    await js("document.getElementById('app-confirm-cancel').click(); refreshStatus()");
    await delay(100);
    result.recoveryCancelled = { ...(await read()), calls: recoveryCalls, guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden") };
    await js("document.getElementById('btn-recover-plugins').click()");
    await waitFor("!document.getElementById('app-confirm').hidden");
    await js("document.getElementById('app-confirm-ok').click(); document.getElementById('btn-recover-plugins').click()");
    await waitFor("document.getElementById('app-confirm').classList.contains('is-loading')");
    result.recoveryPending = { ...(await read()), calls: recoveryCalls, names: recoveryNames,
      controlsDisabled: await js("['btn-start', 'btn-stop', 'btn-retry-full', 'btn-disable-suspects', 'btn-recover-plugins'].every(id => document.getElementById(id).disabled)") };
    desktopStatus = { ...desktopStatus, desktop: { state: 'ready' }, lastStart: { ok: true, at: 'recovered-1' },
      forensics: { plugins: [{ name: 'dsh-tavern', disabled: true }, { name: 'healthy-plugin' }] } };
    recoveryResolve({ ok: true, harnessRestarted: true });
    await waitFor("document.getElementById('app-confirm-title').textContent === '已禁用并启动鲸屿'");
    result.recoverySuccess = { ...(await read()), guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden"), calls: recoveryCalls };
    await capture('plugin-recovery-success');
    await js("document.getElementById('app-confirm-ok').click()");
    desktopStatus = { ...desktopStatus, desktop: { state: 'error' }, lastStart: { ok: false, at: 'failure-2' },
      forensics: { pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }] } };
    await js('refreshStatus()');
    await waitFor("document.getElementById('app-confirm-title').textContent === '插件加载失败'");
    await js("document.getElementById('app-confirm-ok').click()");
    await waitFor("document.getElementById('app-confirm').classList.contains('is-loading')");
    statusReadFails = true;
    recoveryResolve({ ok: true, harnessRestarted: true, forensics: { recovery: { skipUserPlugins: true } } });
    await waitFor("document.getElementById('app-confirm-title').textContent === '插件已禁用，仍需排查'");
    result.recoveryStillSkipped = await read();
    statusReadFails = false;
    await js("document.getElementById('app-confirm-ok').click()");
    await waitFor("document.getElementById('app-confirm-body').textContent.includes('暂时无法读取桌面状态')");
    result.statusReadFailure = await read();
    await js("document.getElementById('app-confirm-ok').click()");
    desktopStatus = { ...desktopStatus, desktop: { state: 'error' }, lastStart: { ok: false, at: 'generic-1' },
      forensics: { genericCause: 'port-in-use', pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }] } };
    await js('refreshStatus()');
    await delay(100);
    result.nonPluginFailure = { ...(await read()), guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden") };
    if (evidence) fs.writeFileSync(path.join(evidence, 'feedback.json'), JSON.stringify(result, null, 2));
    process.stdout.write('FEEDBACK_RESULT:' + JSON.stringify(result) + '\n');
    win.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error.stack));
    win.destroy();
    app.exit(1);
  }
}).catch(error => { process.stderr.write(String(error.stack)); app.exit(1); });
