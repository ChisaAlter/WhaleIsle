'use strict';

// Production raw renderer/preload in a hidden isolated window. IPC is fixture
// data, so these measurements do not claim normal backend acceptance.
const { app, BrowserWindow, ipcMain } = require('electron');
// Hidden offscreen capture uses software rendering to avoid the Windows GPU
// compositor rejecting capturePage with UnknownVizError before any pixels.
app.disableHardwareAcceleration();
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
let desktopStatus = { version: '0.3.3', desktop: { state: 'ready' }, downloadRoute: 'github', config: { downloadRoute: 'github' }, routes: [], forensics: { plugins: [] } };
let installResolve;
let installCancelCalls = 0;
let importResolve;
let saveBootResolve, saveBootReject, cancelBootResolve, cancelBootReject, openBootResolve;
let saveBootCalls = 0, cancelBootCalls = 0, openBootCalls = 0;
const bootOnly = process.env.DSHD_FEEDBACK_BOOT_ONLY === '1';
const importCalls = [], importCancelCalls = [];
const handlers = {
  'shell:get-config': () => ({ themeTokens: { scheme: 'light' } }),
  'shell:window-state': () => ({ maximized: false }),
  'shell:launcher-status': () => { if (statusReadFails) throw new Error('fixture status read failed'); return desktopStatus; },
  'shell:disable-suspects-and-start': (_event, names) => { recoveryCalls++; recoveryNames = names; return new Promise(resolve => { recoveryResolve = resolve; }); },
  'shell:components-list': () => ({ components: [] }),
  'shell:list-releases': () => ({ status: 'ok', releases: [], installed: { version: '0.3.3' } }),
  'shell:plugin-forensics': () => new Promise((_resolve, reject) => { pluginReject = reject; }),
  'shell:save-launcher-config': () => { throw new Error('fixture settings save failed'); },
  'shell:scan-import': () => ({ ok: true, sourceHome: 'C:\\fixture\\source', homeDir: 'C:\\fixture\\target', sessions: [{ rel: 'fixture/session', title: 'fixture session' }], skills: [], plugins: [], mcp: [], settings: [], presets: [] }),
  'shell:check-update': () => { checkCalls++; return new Promise(resolve => { checkResolve = resolve; }); },
  'shell:install-runtime': () => new Promise(resolve => { installResolve = resolve; }),
  'shell:cancel-runtime-install': () => { installCancelCalls++; return { ok: true }; },
  'shell:run-import': (_event, opts) => { importCalls.push(opts.opId); return new Promise(resolve => { importResolve = resolve; }); },
  'shell:cancel-import': (_event, opts) => { importCancelCalls.push(opts.opId); return { ok: false, error: 'fixture cancellation refused' }; },
  'shell:get-state': () => ({ state: 'error', failure: { phase: 'startup', message: 'fixture startup failure' }, logs: ['fixture failure log'] }),
  'shell:save-boot-log': () => { saveBootCalls++; return new Promise((resolve, reject) => { saveBootResolve = resolve; saveBootReject = reject; }); },
  'shell:cancel-restart': () => { cancelBootCalls++; return new Promise((resolve, reject) => { cancelBootResolve = resolve; cancelBootReject = reject; }); },
  'shell:open-launcher': () => { openBootCalls++; return new Promise(resolve => { openBootResolve = resolve; }); },
};
for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  let boot;
  const win = new BrowserWindow({ width: 1060, height: 660, useContentSize: true, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false,
      offscreen: true, backgroundThrottling: false, additionalArguments: ['--dshd-shell-role=launcher'] } });
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
  const capture = async (name, target = win) => {
    if (!evidence) return;
    // Capture the settled visual state in the hidden offscreen fixture. The
    // animation lifecycle itself is not presented as normal-window acceptance.
    await target.webContents.executeJavaScript("document.getAnimations().filter(a => a instanceof CSSTransition || a.animationName === 'shell-feedback-in').forEach(a => a.finish()); void 0");
    target.webContents.invalidate();
    await delay(50);
    fs.writeFileSync(path.join(evidence, `${name}.png`), (await target.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  };
  const read = () => js(`(() => {
    const b = document.getElementById('btn-check-update'), rect = b.getBoundingClientRect();
    const modal = document.getElementById('app-confirm');
    const toast = [...document.querySelectorAll('.shell-feedback-toast')].at(-1);
    const stack = document.getElementById('shell-feedback-stack'), card = stack.getBoundingClientRect();
    const toastText = toast?.querySelector('.shell-feedback-text').textContent || '';
    const reference = modal.hidden ? document.querySelector('main').getBoundingClientRect() : modal.getBoundingClientRect();
    const surface = modal.hidden ? card : modal.querySelector('.modal-card').getBoundingClientRect();
    return { button: { width: rect.width, height: rect.height, text: b.textContent, busy: b.getAttribute('aria-busy'), disabled: b.disabled,
      color: getComputedStyle(b).color, spinner: getComputedStyle(b, '::after').content },
      homeTop: document.querySelector('#panel-home .home-heading').getBoundingClientRect().top,
      modalHidden: modal.hidden, title: modal.hidden ? toastText.split('：')[0] : document.getElementById('app-confirm-title').textContent,
      body: modal.hidden ? toastText : document.getElementById('app-confirm-body').textContent,
      role: toast?.getAttribute('role'), floating: getComputedStyle(stack).position === 'fixed', cancelVisible: document.getElementById('app-confirm-cancel').checkVisibility(),
      okVisible: document.getElementById('app-confirm-ok').checkVisibility(), focus: document.activeElement.id,
      centered: Math.abs(surface.x + surface.width / 2 - (reference.x + reference.width / 2)) < 1,
      extraLines: document.querySelectorAll('#hint, #home-components-hint, #home-start-progress, #import-scan-status, [data-comp-hint], [data-comp-progress]').length,
      versionsBusy: document.getElementById('btn-check-update-versions').getAttribute('aria-busy'),
      updateVisible: document.getElementById('home-update').checkVisibility(), updateText: document.getElementById('home-update-text').textContent,
      toastCount: document.querySelectorAll('.shell-feedback-toast').length };
  })()`);
  const clearNotices = () => js("document.querySelectorAll('.shell-feedback-toast').forEach(node => node.remove())");
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    await delay(20);
  };
  try {
    const result = { cases: [], errors: [] };
    if (!bootOnly) {
    await win.loadFile(path.join(__dirname, 'launcher.html'));
    await waitFor("document.getElementById('home-version').textContent === 'v0.3.3'");
    win.webContents.on('console-message', (_event, ...args) => {
      const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
      if (details.level === 3 || details.level === 'error') result.errors.push(details.message);
    });
    for (const scheme of ['light', 'dark']) {
      await js(`document.documentElement.toggleAttribute('data-ds-dark-theme', ${scheme === 'dark'})`);
      for (const [width, height] of [[1060, 660], [860, 560]]) {
        win.setContentSize(width, height);
        await delay(30);
        const before = await read();
        await js("document.getElementById('btn-check-update').focus(); document.getElementById('btn-check-update').click(); document.getElementById('btn-check-update-versions').click()");
        await waitFor("document.getElementById('btn-check-update').getAttribute('aria-busy') === 'true'");
        const pending = await read();
        checkResolve({ status: 'current', current: '0.3.3', latest: '0.3.3' });
        await waitFor("!!document.querySelector('.shell-feedback-toast')");
        const current = await read();
        if (scheme === 'light') await capture(`launcher-${width}`);
        await clearNotices();
        await js('refreshStatus()');
        await delay(30);
        const dismissed = await read();
        result.cases.push({ scheme, width, before, pending, current, dismissed });
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
      await waitFor(payload?.status === 'available' ? "document.getElementById('home-update').checkVisibility()" : "!!document.querySelector('.shell-feedback-toast')");
      result.outcomes.push({ status: payload?.status || 'invalid', ...await read() });
      await clearNotices();
    }
    // Parallel results remain interactive without replacing a destructive confirmation.
    await js("document.getElementById('home-update').querySelector('.shell-feedback-close').click(); window.confirmAnswer = null; void window.appConfirm({title:'确认删除',body:'fixture',danger:true}).then(value => {window.confirmAnswer=value}); void window.shellFeedback.notice({title:'后台结果',body:'fixture',tone:'error',actions:[{label:'重试',onClick:()=>{window.retryCalls=(window.retryCalls||0)+1}}]})");
    result.confirmSafe = await js("({ title: document.getElementById('app-confirm-title').textContent, focus: document.activeElement.id })");
    await key('Tab');
    await key('Tab');
    result.confirmRetry = await js('document.activeElement.className');
    await js('document.activeElement.click()');
    result.retryCalls = await js('window.retryCalls');
    await key('Escape');
    result.confirmAfterToastEscape = await js("({ title: document.getElementById('app-confirm-title').textContent, hidden: document.getElementById('app-confirm').hidden, answer: window.confirmAnswer, toasts:document.querySelectorAll('.shell-feedback-toast').length })");
    await key('Tab');
    await key('Escape');
    result.confirmAnswer = await js('window.confirmAnswer');
    await js("window.taskProgress = window.appProgress({title:'安装组件',body:'正在校验'}); window.taskProgress.update('正在下载组件 42%'); document.querySelector('.shell-feedback-progress').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    result.progress = await js("({ modalHidden:document.getElementById('app-confirm').hidden,summaryVisible:document.querySelector('.shell-feedback-progress').parentElement.querySelector('.shell-feedback-task-summary').checkVisibility(),body:document.querySelector('.shell-feedback-progress p').textContent })");
    await js("document.querySelector('.shell-feedback-progress').parentElement.querySelector('.shell-feedback-task-summary').click()");
    result.progress.restored = await js("document.querySelector('.shell-feedback-progress').checkVisibility()");
    await js("window.taskProgress.close(); document.querySelector('[data-tab=plugins]').click()");
    await waitFor("document.getElementById('btn-refresh-plugins').getAttribute('aria-busy') === 'true'");
    pluginReject(new Error('fixture scan failed'));
    await waitFor("!!document.querySelector('.shell-feedback-toast')");
    result.pluginFailure = await js("({ disabled: document.getElementById('btn-refresh-plugins').disabled, busy: document.getElementById('btn-refresh-plugins').getAttribute('aria-busy'), body:document.querySelector('.shell-feedback-text').textContent })");
    await clearNotices();
    await js("document.querySelector('[data-tab=import]').click()");
    await waitFor("!document.getElementById('btn-scan').disabled");
    await js("document.getElementById('btn-scan').click()");
    await waitFor("!!document.querySelector('.shell-feedback-toast')");
    result.scan = await read();
    await clearNotices();
    await js("document.querySelector('[data-tab=settings]').click(); document.getElementById('opt-auto').click()");
    await waitFor("!!document.querySelector('.shell-feedback-toast')");
    result.settings = await read();
    await clearNotices();
    await js("showTab('home'); document.hasFocus = () => true; void 0");
    desktopStatus = { ...desktopStatus, desktop: { state: 'ready' }, lastStart: { ok: false, at: 'failure-1' },
      recovery: { skipUserPlugins: true, at: 'original-failure-1', reason: 'dsh-tavern failed to load' },
      forensics: { pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }, { name: 'healthy-plugin' }] } };
    await js('refreshStatus()');
    await waitFor("!document.getElementById('app-confirm').hidden");
    result.recoveryPrompt = await read();
    await capture('plugin-recovery-confirm');
    await js("document.getElementById('app-confirm-cancel').click()");
    desktopStatus = { ...desktopStatus, lastStart: { ok: true, at: 'skip-completed-1' } };
    await js('refreshStatus()');
    await delay(100);
    result.recoveryCancelled = { ...(await read()), calls: recoveryCalls, guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden"),
      lastStartAt: await js('lastStatus.lastStart.at'), recoveryAt: await js('lastStatus.recovery.at') };
    await js("document.getElementById('btn-recover-plugins').click()");
    await waitFor("!document.getElementById('app-confirm').hidden");
    await js("document.getElementById('app-confirm-ok').click(); document.getElementById('btn-recover-plugins').click()");
    await waitFor("!!document.querySelector('.shell-feedback-progress')");
    result.recoveryPending = { ...(await read()), calls: recoveryCalls, names: recoveryNames,
      controlsDisabled: await js("['btn-start', 'btn-stop', 'btn-retry-full', 'btn-disable-suspects', 'btn-recover-plugins'].every(id => document.getElementById(id).disabled)") };
    desktopStatus = { ...desktopStatus, desktop: { state: 'ready' }, lastStart: { ok: true, at: 'recovered-1' },
      recovery: { skipUserPlugins: false },
      forensics: { plugins: [{ name: 'dsh-tavern', disabled: true }, { name: 'healthy-plugin' }] } };
    recoveryResolve({ ok: true, harnessRestarted: true });
    await waitFor("[...document.querySelectorAll('.shell-feedback-text')].some(node => node.textContent.startsWith('已禁用并启动鲸屿：'))");
    result.recoverySuccess = { ...(await read()), guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden"), calls: recoveryCalls };
    await capture('plugin-recovery-success');
    await clearNotices();
    desktopStatus = { ...desktopStatus, desktop: { state: 'ready' }, lastStart: { ok: false, at: 'failure-2' },
      recovery: { skipUserPlugins: true, at: 'original-failure-2', reason: 'dsh-tavern failed to load' },
      forensics: { pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }] } };
    await js('refreshStatus()');
    await waitFor("document.getElementById('app-confirm-title').textContent === '插件加载失败'");
    const callsBeforeStickyRefresh = recoveryCalls;
    desktopStatus = { ...desktopStatus, lastStart: { ok: true, at: 'skip-completed-2' } };
    await js('refreshStatus()');
    result.recoveryStickyRefresh = { ...(await read()), calls: recoveryCalls,
      lastStartAt: await js('lastStatus.lastStart.at'), recoveryAt: await js('lastStatus.recovery.at') };
    await js("document.getElementById('app-confirm-ok').click()");
    await waitFor("!!document.querySelector('.shell-feedback-progress')");
    result.recoveryStickyConfirmed = { callsBefore: callsBeforeStickyRefresh, calls: recoveryCalls, names: recoveryNames };
    statusReadFails = true;
    recoveryResolve({ ok: true, harnessRestarted: true, forensics: { recovery: { skipUserPlugins: true } } });
    await waitFor("[...document.querySelectorAll('.shell-feedback-text')].some(node => node.textContent.startsWith('插件已禁用，仍需排查：'))");
    result.recoveryStillSkipped = await read();
    statusReadFails = false;
    await js("[...document.querySelectorAll('.shell-feedback-toast')].at(-1).remove()");
    await waitFor("document.querySelector('.shell-feedback-text').textContent.includes('暂时无法读取桌面状态')");
    result.statusReadFailure = await read();
    await clearNotices();
    desktopStatus = { ...desktopStatus, desktop: { state: 'error' }, lastStart: { ok: false, at: 'generic-1' },
      recovery: { skipUserPlugins: false },
      forensics: { genericCause: 'port-in-use', pluginTreeFailure: true, plugins: [{ name: 'dsh-tavern', suspect: true }] } };
    await js('refreshStatus()');
    await delay(100);
    result.nonPluginFailure = { ...(await read()), guidanceVisible: await js("!document.getElementById('home-plugin-guidance').hidden") };
    await clearNotices();
    // Closing pending tasks retains their terminal result and actual cancel entry.
    await js("document.querySelector('[data-tab=home]').click(); void installRuntime()");
    await waitFor("document.getElementById('btn-install-cancel').checkVisibility()");
    await js("void window.appConfirm({title:'确认卸载其他组件',body:'fixture',danger:true}); document.getElementById('app-confirm-cancel').focus()");
    result.installTabTargets = [];
    for (let i = 0; i < 4; i++) {
      await key('Tab');
      result.installTabTargets.push(await js("document.activeElement.id || document.activeElement.className"));
    }
    await js("document.getElementById('btn-install-cancel').click(); document.getElementById('app-confirm-cancel').click(); document.getElementById('install-progress-card').querySelector('.shell-feedback-close').click()");
    result.installSummaryPending = await js("document.getElementById('install-progress-card').parentElement.querySelector('.shell-feedback-task-summary').checkVisibility()");
    installResolve({ ok: false, status: 'error', message: 'fixture install failure' });
    await waitFor("document.querySelector('.shell-feedback-toast')?.textContent.includes('fixture install failure')");
    result.installTerminal = await js("(() => {const card=document.getElementById('install-progress-card'),summary=card.parentElement.querySelector('.shell-feedback-task-summary');return {summaryVisible:summary.checkVisibility(),busy:summary.getAttribute('aria-busy'),failure:document.querySelector('.shell-feedback-text').textContent,cancelHidden:document.getElementById('btn-install-cancel').hidden}})()");
    await js("document.getElementById('install-progress-card').parentElement.querySelector('.shell-feedback-task-summary').click()");
    result.installTerminal.restored = await js("document.getElementById('install-progress').checkVisibility() && document.getElementById('install-progress').textContent === 'fixture install failure'");
    result.installCancelCalls = installCancelCalls;
    await clearNotices();
    await js("document.getElementById('install-progress-card').querySelector('.shell-feedback-close').click(); document.querySelector('[data-tab=import]').click()");
    await waitFor("!document.getElementById('btn-import').disabled");
    await js("document.getElementById('btn-import').click()");
    await waitFor("document.getElementById('btn-import-cancel').checkVisibility()");
    await js("document.getElementById('btn-import-cancel').click()");
    await waitFor("!!document.querySelector('.shell-feedback-toast')");
    result.importRefused = await js("({feedback:document.querySelector('.shell-feedback-text').textContent,retryable:!document.getElementById('btn-import-cancel').disabled,buttonBusy:document.getElementById('btn-import').getAttribute('aria-busy')})");
    await clearNotices();
    await js("document.getElementById('import-progress-card').querySelector('.shell-feedback-close').click()");
    importResolve({ ok: false, error: 'import-recovery-blocked' });
    await waitFor("!!document.querySelector('.shell-feedback-toast')");
    result.importTerminal = await js("(() => {const card=document.getElementById('import-progress-card'),summary=card.parentElement.querySelector('.shell-feedback-task-summary');return {summaryVisible:summary.checkVisibility(),busy:summary.getAttribute('aria-busy'),failure:document.querySelector('.shell-feedback-text').textContent,cancelHidden:document.getElementById('btn-import-cancel').hidden}})()");
    await js("document.getElementById('import-progress-card').parentElement.querySelector('.shell-feedback-task-summary').click()");
    result.importTerminal.restored = await js("document.getElementById('import-result').checkVisibility() && document.getElementById('import-result').textContent.includes('未完成的导入事务')");
    result.importCalls = importCalls;
    result.importCancelCalls = importCancelCalls;
    }
    // Same production feedback assets on the real boot page; controls/logs remain content.
    boot = new BrowserWindow({ width: 1060, height: 660, useContentSize: true, frame: false, show: false,
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false,
        offscreen: true, backgroundThrottling: false, additionalArguments: ['--dshd-shell-role=boot'] } });
    const bootJs = source => boot.webContents.executeJavaScript(source);
    const bootWait = async condition => {
      for (let i = 0; i < 100; i++) {
        if (await bootJs(condition)) return;
        await delay(20);
      }
      throw new Error('boot condition timed out: ' + condition);
    };
    const bootGeometry = () => bootJs("(() => {const brand=document.querySelector('.core .brand'),r=brand.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()");
    await boot.loadFile(path.join(__dirname, 'boot.html'));
    await bootWait("document.getElementById('failure').textContent === 'fixture startup failure'");
    result.boot = { before: await bootGeometry() };
    boot.webContents.send('shell:state', { state: 'error', failure: { phase: 'startup', message: 'fixture long startup failure '.repeat(15) } });
    await bootWait("document.getElementById('failure').textContent.length > 100");
    result.boot.longFailure = await bootGeometry();
    result.boot.floatingFailure = await bootJs("!!document.getElementById('failure').closest('.shell-feedback-stack')");
    await bootJs("document.getElementById('save-log').click()");
    await bootWait("document.getElementById('save-log').getAttribute('aria-busy') === 'true'");
    saveBootResolve({ ok: true, path: 'C:\\fixture\\boot.log' });
    await bootWait("!!document.querySelector('.shell-feedback-toast')");
    result.boot.saved = await bootJs("({text:document.querySelector('.shell-feedback-text').textContent,ticker:document.getElementById('ticker-line').textContent,logCount:document.getElementById('log').children.length})");
    result.boot.afterSave = await bootGeometry();
    if (bootOnly) {
      const buttonState = id => bootJs(`(() => {const b=document.getElementById(${JSON.stringify(id)}),r=b.getBoundingClientRect();return {busy:b.getAttribute('aria-busy'),disabled:b.disabled,hidden:b.hidden,width:r.width,height:r.height,text:b.textContent}})()`);
      const clearBootNotices = async () => {
        await bootJs("document.querySelectorAll('.shell-feedback-toast').forEach(node => node.remove())");
        await bootWait("!document.querySelector('.shell-feedback-toast')");
      };
      const startAction = async (id, calls) => {
        const before = await buttonState(id);
        const count = calls();
        await bootJs(`document.getElementById(${JSON.stringify(id)}).click();document.getElementById(${JSON.stringify(id)}).click()`);
        await bootWait(`document.getElementById(${JSON.stringify(id)}).getAttribute('aria-busy') === 'true'`);
        return { before, pending: await buttonState(id), calls: calls() - count, geometry: await bootGeometry() };
      };
      await capture('boot-feedback-saved', boot);
      await clearBootNotices();
      result.boot.saveCancelled = await startAction('save-log', () => saveBootCalls);
      await capture('boot-feedback-pending', boot);
      saveBootResolve({ canceled: true });
      await bootWait("!document.getElementById('save-log').hasAttribute('aria-busy')");
      Object.assign(result.boot.saveCancelled, { after: await buttonState('save-log'), toasts: await bootJs("document.querySelectorAll('.shell-feedback-toast').length"), afterGeometry: await bootGeometry() });
      result.boot.saveFailed = await startAction('save-log', () => saveBootCalls);
      saveBootReject(new Error('fixture save disconnected'));
      await bootWait("document.querySelector('.shell-feedback-text')?.textContent.includes('fixture save disconnected')");
      Object.assign(result.boot.saveFailed, { after: await buttonState('save-log'), toast: await bootJs("document.querySelector('.shell-feedback-text').textContent"), afterGeometry: await bootGeometry() });
      await capture('boot-feedback-failed', boot);
      await clearBootNotices();
      const scheduled = { state: 'error', failure: { phase: 'startup', message: 'fixture startup failure' }, recovery: { status: 'scheduled', nextRetryAt: Date.now() + 60000, attempt: 1, maxAttempts: 5 } };
      boot.webContents.send('shell:state', scheduled);
      await bootWait("document.getElementById('cancel-restart').checkVisibility()");
      result.boot.cancelFailed = await startAction('cancel-restart', () => cancelBootCalls);
      boot.webContents.send('shell:state', { ...scheduled, failure: { phase: 'startup', message: 'fixture scheduled stream update' } });
      await bootWait("document.getElementById('failure').textContent === 'fixture scheduled stream update' && document.getElementById('cancel-restart').disabled");
      cancelBootReject(new Error('fixture cancellation disconnected'));
      await bootWait("document.querySelector('.shell-feedback-text')?.textContent.includes('fixture cancellation disconnected')");
      Object.assign(result.boot.cancelFailed, { after: await buttonState('cancel-restart'), toast: await bootJs("document.querySelector('.shell-feedback-text').textContent"), afterGeometry: await bootGeometry() });
      await clearBootNotices();
      result.boot.cancelSucceeded = await startAction('cancel-restart', () => cancelBootCalls);
      cancelBootResolve({ ...scheduled, recovery: { status: 'cancelled', reason: 'user' } });
      await bootWait("!document.getElementById('cancel-restart').hasAttribute('aria-busy') && document.getElementById('cancel-restart').hidden");
      Object.assign(result.boot.cancelSucceeded, { after: await buttonState('cancel-restart'), afterGeometry: await bootGeometry() });
      await bootWait("document.getElementById('open-launcher').checkVisibility()");
      result.boot.openFailed = await startAction('open-launcher', () => openBootCalls);
      openBootResolve({ ok: false, error: 'fixture launcher unavailable' });
      await bootWait("document.querySelector('.shell-feedback-text')?.textContent.includes('fixture launcher unavailable')");
      Object.assign(result.boot.openFailed, { after: await buttonState('open-launcher'), toast: await bootJs("document.querySelector('.shell-feedback-text').textContent"), afterGeometry: await bootGeometry() });
      await clearBootNotices();
      result.boot.openSucceeded = await startAction('open-launcher', () => openBootCalls);
      openBootResolve({ ok: true });
      await bootWait("!document.getElementById('open-launcher').hasAttribute('aria-busy')");
      Object.assign(result.boot.openSucceeded, { after: await buttonState('open-launcher'), toasts: await bootJs("document.querySelectorAll('.shell-feedback-toast').length"), afterGeometry: await bootGeometry() });
    }
    if (evidence) fs.writeFileSync(path.join(evidence, bootOnly ? 'feedback-boot.json' : 'feedback.json'), JSON.stringify(result, null, 2));
    process.stdout.write('FEEDBACK_RESULT:' + JSON.stringify(result) + '\n');
    boot.destroy();
    win.destroy();
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error.stack));
    boot?.destroy();
    win.destroy();
    app.exit(1);
  }
}).catch(error => { process.stderr.write(String(error.stack)); app.exit(1); });
