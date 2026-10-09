// Electron main for the bound-handler regression: load the REAL launcher.html
// + the REAL preload (which exposes window.shell via contextBridge), register
// fixture shell:* IPC handlers, and drive the page through executeJavaScript.
// A deferred-cancel A->B and a route-save refusal->retry are exercised against
// the real bind() and the real bridge — not pure functions.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// All launcher state belongs to the fixture, never the installed application.
const fixtureUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-launcher-bound-'));
app.setPath('userData', fixtureUserData);

const LAUNCHER_HTML = path.join(__dirname, 'launcher.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');

// IPC fixtures the test controls via process.env / argv switches.
const results = { calls: [] };
const pendingCancels = new Map();
let importResolve = null;
let startResolve = null;
let startReject = null;
let stopResolve = null;
let startupState = 'idle';
const startupError = "EEXIST: symlink C:\\fixture\\vendor\\dsh-im -> C:\\fixture\\profile\\dsh-im";
ipcMain.handle('shell:start-desktop', () => {
  results.calls.push({ op: 'start-desktop' });
  return new Promise((resolve, reject) => { startResolve = resolve; startReject = reject; });
});
ipcMain.handle('shell:stop-desktop', () => {
  results.calls.push({ op: 'stop-desktop' });
  return new Promise(resolve => { stopResolve = resolve; });
});

ipcMain.handle('shell:save-launcher-config', (_e, patch) => {
  results.calls.push({ op: 'save-launcher-config', patch });
  const failOnce = process.env.QA_ROUTE_FAIL_ONCE === '1';
  if (failOnce && results.calls.filter((c) => c.op === 'save-launcher-config').length === 1) {
    return { ok: false, error: 'maintenance-in-progress' };
  }
  return { ok: true };
});
ipcMain.handle('shell:cancel-import', (_e, payload) => {
  results.calls.push({ op: 'cancel-import', payload });
  return new Promise((resolve) => pendingCancels.set(payload && payload.opId, resolve));
});
ipcMain.handle('shell:run-import', (_e, opts) => {
  results.calls.push({ op: 'run-import', opts });
  return new Promise((resolve) => { importResolve = resolve; });
});
ipcMain.handle('shell:scan-import', () => ({ ok: true, sessions: [], skills: [], plugins: [], mcp: [], settings: [], presets: [] }));
ipcMain.handle('shell:launcher-status', () => ({
  ok: true,
  ...(process.env.QA_STARTUP_FLOW === '1' ? {
    version: '0.3.3', desktop: { state: startupState },
    lastStart: { ok: startupState === 'ready', error: startupError },
    forensics: { plugins: [], suspects: [] },
  } : {}),
  state: 'idle',
  downloadRoute: 'stable',
  routes: [
    { id: 'stable', label: 'Stable', verified: true, detail: 'stable channel' },
    { id: 'beta', label: 'Beta', verified: true, detail: 'beta channel' },
    { id: 'nightly', label: 'Nightly', verified: false, detail: 'not verified' },
  ],
}));
ipcMain.handle('shell:launcher-check-update', () => process.env.QA_COMPONENTS_HOME === '1' ? { status: 'available', latest: '0.3.3', currentVersion: '0.3.2', hint: '发现正式版 0.3.3。' } : { status: 'none' });
ipcMain.handle('shell:check-update', () => process.env.QA_COMPONENTS_HOME === '1' ? { status: 'available', latest: '0.3.3', currentVersion: '0.3.2', hint: '发现正式版 0.3.3。' } : { status: 'none' });
const componentFeedback = process.env.QA_COMPONENT_FEEDBACK === '1';
let componentInstalled = componentFeedback;
let componentRunning = false;
let componentLatest = '1.0.3';
let componentVersion = '1.0.3';
let componentMessage = '';
let componentStartResolve, componentStopResolve, componentInstallResolve, componentUpdateResolve;
let componentListResolve, componentUninstallInfoResolve;
const componentRow = () => ({ id: 'whalebridge', name: '鲸桥', description: '连接供应商和订阅账号，在鲸屿使用模型。', version: componentLatest, installedVersion: componentInstalled ? componentVersion : '', previousVersion: '1.0.2', updateAvailable: componentInstalled && componentVersion !== componentLatest, message: componentMessage, state: componentInstalled ? (componentRunning ? 'running' : 'stopped') : 'available', configurable: componentInstalled, source: 'official', kind: 'service' });
const componentPayload = () => ({ components: process.env.QA_COMPONENTS_HOME === '1' || componentFeedback ? [componentRow()] : [] });
ipcMain.handle('shell:components-list', (_event, options) => {
  results.calls.push({ op: 'component-list', refresh: options?.refresh === true });
  if (componentFeedback && options?.refresh) return new Promise(resolve => { componentListResolve = () => resolve(componentPayload()); });
  return componentPayload();
});
ipcMain.handle('shell:components-start', (_event, id) => {
  results.calls.push({ op: 'component-start', id });
  return new Promise(resolve => { componentStartResolve = (result = { ok: true }) => { if (result.ok) componentRunning = true; resolve(result); }; });
});
ipcMain.handle('shell:components-stop', (_event, id) => {
  results.calls.push({ op: 'component-stop', id });
  return new Promise(resolve => { componentStopResolve = () => { componentRunning = false; resolve({ ok: true }); }; });
});
ipcMain.handle('shell:components-open', (_event, id) => { results.calls.push({ op: 'component-open', id }); return { ok: true }; });
ipcMain.handle('shell:components-rollback', (_event, id) => { results.calls.push({ op: 'component-rollback', id }); return { ok: true }; });
ipcMain.handle('shell:components-install', (_event, id) => {
  results.calls.push({ op: 'component-install', id });
  return new Promise(resolve => { componentInstallResolve = () => {
    componentInstalled = true; componentRunning = true; componentVersion = componentLatest;
    resolve({ ok: true, component: componentRow() });
  }; });
});
ipcMain.handle('shell:components-update', (_event, id) => {
  results.calls.push({ op: 'component-update', id });
  return new Promise(resolve => { componentUpdateResolve = resolve; });
});
ipcMain.handle('shell:components-uninstall-info', (_event, id) => {
  results.calls.push({ op: 'component-uninstall-info', id });
  return new Promise(resolve => { componentUninstallInfoResolve = resolve; });
});
ipcMain.handle('shell:components-uninstall', (_event, argument) => {
  results.calls.push({ op: 'component-uninstall', argument });
  componentInstalled = false; componentRunning = false;
  return { ok: true };
});
ipcMain.handle('shell:list-releases', () => ({ status: 'ok', releases: [], installed: { version: '0' } }));
ipcMain.handle('shell:list-marketplace', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:list-installed-plugins', () => ({ plugins: [], bundles: [] }));
ipcMain.handle('shell:list-wallpapers', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:get-config', () => ({ theme: 'midnight', locale: 'zh' }));
ipcMain.handle('shell:get-launcher-config', () => ({ downloadRoute: 'stable' }));
ipcMain.handle('shell:list-routes', () => ({ ok: true, routes: [{ id: 'stable', label: 'Stable' }, { id: 'beta', label: 'Beta' }] }));

function emitProgress(win, payload) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:import-progress', payload);
  }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload builds window.shell only for a declared shell role.
      additionalArguments: ['--dshd-shell-role=launcher'],
    },
  });
  try {
    await win.loadFile(LAUNCHER_HTML);
    const ready = await win.webContents.executeJavaScript(`new Promise((r) => {
      if (document.readyState === 'complete') return r('ready');
      document.addEventListener('DOMContentLoaded', () => r('ready'));
      setTimeout(() => r('timeout'), 4000);
    })`);
    const scan = await win.webContents.executeJavaScript(`({
      hasShell: typeof window.shell === 'object' && window.shell !== null,
      hasCancel: typeof (window.shell && window.shell.cancelImport) === 'function',
      hasProgress: typeof (window.shell && window.shell.onImportProgress) === 'function',
      importBtn: Boolean(document.getElementById('btn-import')),
      cancelBtn: Boolean(document.getElementById('btn-import-cancel')),
      routePicker: Boolean(document.getElementById('route-picker')),
      readyState: document.readyState,
    })`);

    if (componentFeedback) {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async predicate => {
        const deadline = Date.now() + 5000;
        while (!predicate()) {
          if (Date.now() >= deadline) throw new Error('component fixture IPC did not arrive');
          await delay(10);
        }
      };
      const waitForDom = expression => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = () => {
          if (${expression}) return resolve(true);
          if (Date.now() >= deadline) return reject(new Error('component DOM did not settle: ' + ${JSON.stringify(expression)}));
          setTimeout(poll, 20);
        };
        poll();
      })`);
      const rememberButton = selector => win.webContents.executeJavaScript(`(() => {
        window.qaComponentButton = document.querySelector(${JSON.stringify(selector)});
        const box = window.qaComponentButton.getBoundingClientRect();
        return { caption: window.qaComponentButton.textContent, width: box.width, height: box.height,
          homeHeight: document.querySelector('#home-components').getBoundingClientRect().height };
      })()`);
      const readFeedback = () => win.webContents.executeJavaScript(`(() => {
        const button = window.qaComponentButton;
        const box = button.getBoundingClientRect();
        const mask = document.querySelector('#app-confirm');
        return {
          sameButton: button.isConnected, caption: button.textContent, width: box.width, height: box.height,
          busy: button.getAttribute('aria-busy'), loadingLabel: button.getAttribute('aria-label'),
          homeHeight: document.querySelector('#home-components').getBoundingClientRect().height,
          controls: [...document.querySelectorAll('[data-comp-id="whalebridge"]')].map(control => ({
            action: control.dataset.compAction, disabled: control.disabled, busy: control.getAttribute('aria-busy'),
          })),
          extraFeedbackNodes: document.querySelectorAll('#hint, [data-comp-hint], #home-components-hint, [data-comp-progress]').length,
          noticeVisible: !mask.hidden, loadingDialog: mask.classList.contains('is-loading'),
          noticeTitle: document.querySelector('#app-confirm-title').textContent,
          noticeBody: document.querySelector('#app-confirm-body').textContent,
          okHidden: document.querySelector('#app-confirm-ok').hidden,
          cancelHidden: document.querySelector('#app-confirm-cancel').hidden,
          notices: window.qaComponentNotices,
          focusConnected: document.activeElement.isConnected,
          focusVisible: document.activeElement.checkVisibility(),
          focusAction: document.activeElement.dataset.compAction || '',
          focusTab: document.activeElement.dataset.tab || '',
          focusRefresh: document.activeElement.hasAttribute('data-comp-refresh'),
          focusTag: document.activeElement.tagName,
        };
      })()`);
      const click = selector => win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        button.focus(); button.click();
      })()`);
      const closeNotice = async () => {
        await click('#app-confirm-ok');
        await waitForDom('document.querySelector("#app-confirm").hidden');
      };
      const componentProgress = payload => win.webContents.send('shell:components-progress', { id: 'whalebridge', ...payload });
      await waitForDom('!!document.querySelector("#home-components [data-comp-action=start]")');
      await win.webContents.executeJavaScript(`window.qaComponentNotices = [];
        const originalNotice = window.appNotice;
        window.appNotice = options => { window.qaComponentNotices.push(options); return originalNotice(options); };
        true;`);

      const startBefore = await rememberButton('#home-components [data-comp-action="start"]');
      await click('#home-components [data-comp-action="start"]');
      await click('#home-components [data-comp-action="start"]');
      await waitFor(() => results.calls.some(call => call.op === 'component-start'));
      const starting = await readFeedback();
      componentProgress({ phase: 'error', percent: 100, message: 'fixture component startup failed' });
      await waitForDom('window.qaComponentButton.title.includes("fixture component startup failed")');
      const failedPhase = await readFeedback();
      componentStartResolve({ ok: false, error: 'spawn-failed' });
      await waitForDom('!document.querySelector("#app-confirm").hidden');
      const failed = await readFeedback();
      await closeNotice();
      const failureDismissed = await readFeedback();

      await click('#home-components [data-comp-action="start"]');
      await waitFor(() => results.calls.filter(call => call.op === 'component-start').length === 2);
      await click('[data-tab="components"]');
      componentStartResolve();
      await waitForDom('!!document.querySelector("#tab-components [data-comp-action=open]")');
      const switchedTab = await readFeedback();

      componentInstalled = false;
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      await click('[data-tab="components"]');
      const installBefore = await rememberButton('#tab-components [data-comp-action="install"]');
      await click('#tab-components [data-comp-action="install"]');
      await waitFor(() => typeof componentInstallResolve === 'function');
      await waitForDom('document.querySelector("#app-confirm").classList.contains("is-loading")');
      const installing = await readFeedback();
      componentProgress({ phase: 'download', percent: 42 });
      await waitForDom('document.querySelector("#app-confirm-body").textContent.includes("42%")');
      const downloading = await readFeedback();
      componentProgress({ phase: 'verify', percent: 60 });
      await waitForDom('document.querySelector("#app-confirm-body").textContent.includes("校验")');
      const verifying = await readFeedback();
      componentInstallResolve();
      await waitForDom('document.querySelector("#app-confirm-title").textContent === "鲸桥安装完成"');
      const installed = await readFeedback();
      await closeNotice();
      const installDismissed = await readFeedback();

      componentLatest = '1.0.4';
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      await win.webContents.executeJavaScript('document.querySelector(".comp-manage").open = true');
      const updateBefore = await rememberButton('#tab-components [data-comp-action="update"]');
      await click('#tab-components [data-comp-action="update"]');
      await waitFor(() => typeof componentUpdateResolve === 'function');
      componentProgress({ phase: 'download', percent: 51 });
      await waitForDom('document.querySelector("#app-confirm-body").textContent.includes("51%")');
      const updating = await readFeedback();
      componentProgress({ phase: 'error', percent: 100, message: 'fixture package refused' });
      componentUpdateResolve({ ok: false, message: 'fixture package refused' });
      await waitForDom('document.querySelector("#app-confirm-title").textContent === "鲸桥操作未完成"');
      const updateFailed = await readFeedback();
      await closeNotice();
      const updateDismissed = await readFeedback();

      componentMessage = 'fixture catalog is unavailable';
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      const persistentErrorInline = await win.webContents.executeJavaScript('document.querySelector("[data-comp-list]").innerText.includes("fixture catalog")');
      await click('#tab-components [data-comp-info="whalebridge"]');
      await waitForDom('document.querySelector("#app-confirm-title").textContent === "鲸桥状态"');
      const statusDetails = await readFeedback();
      await closeNotice();

      const refreshBefore = await rememberButton('[data-comp-refresh]');
      await click('[data-comp-refresh]');
      await click('[data-comp-refresh]');
      await waitFor(() => typeof componentListResolve === 'function');
      const refreshing = await readFeedback();
      componentListResolve();
      await waitForDom('!document.querySelector("[data-comp-refresh]").disabled');
      const refreshed = await readFeedback();

      await win.webContents.executeJavaScript('document.querySelector(".comp-manage").open = true');
      const uninstallBefore = await rememberButton('#tab-components [data-comp-action="uninstall"]');
      await click('#tab-components [data-comp-action="uninstall"]');
      await click('#tab-components [data-comp-action="uninstall"]');
      await waitFor(() => results.calls.filter(call => call.op === 'component-uninstall-info').length === 1);
      const uninstallReading = await readFeedback();
      componentUninstallInfoResolve({ defaultModel: true });
      await waitForDom('document.querySelector("#app-confirm-title").textContent.includes("卸载组件")');
      const uninstallConfirm = await readFeedback();
      await click('#app-confirm-cancel');
      await waitForDom('!document.querySelector("[data-comp-action=uninstall]").disabled');
      const uninstallCancelled = await readFeedback();
      const uninstallsAfterCancel = results.calls.filter(call => call.op === 'component-uninstall').length;

      await win.webContents.executeJavaScript('document.querySelector(".comp-manage").open = true');
      await click('#tab-components [data-comp-action="uninstall"]');
      await waitFor(() => results.calls.filter(call => call.op === 'component-uninstall-info').length === 2);
      componentUninstallInfoResolve({ defaultModel: true });
      await waitForDom('document.querySelector("#app-confirm-title").textContent.includes("卸载组件")');
      await click('#app-confirm-ok');
      await waitForDom('document.querySelector("#app-confirm-title").textContent === "是否同时删除鲸桥配置？"');
      const keepDataConfirm = await readFeedback();
      await click('#app-confirm-cancel');
      await waitFor(() => results.calls.some(call => call.op === 'component-uninstall'));
      await waitForDom('!!document.querySelector("#tab-components [data-comp-action=install]")');
      const finalState = await readFeedback();
      process.stdout.write('BOUND_RESULT:' + JSON.stringify({ startBefore, starting, failedPhase, failed, failureDismissed, switchedTab,
        installBefore, installing, downloading, verifying, installed, installDismissed, updateBefore, updating, updateFailed, updateDismissed,
        persistentErrorInline, statusDetails, refreshBefore, refreshing, refreshed, uninstallBefore,
        uninstallReading, uninstallConfirm, uninstallCancelled, uninstallsAfterCancel, keepDataConfirm, finalState, calls: results.calls }));
      app.exit(0);
      return;
    }

    if (process.env.QA_COMPONENTS_HOME === '1') {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const read = () => win.webContents.executeJavaScript(`(() => {
        const home = document.querySelector('#home-components');
        const row = document.querySelector('#tab-components [data-comp-row="whalebridge"]');
        const visible = button => !!button && button.checkVisibility();
        return { hidden: home.hidden, homeText: home.innerText,
          homeStart: visible(home.querySelector('[data-comp-action="start"]')),
          homeStop: visible(home.querySelector('[data-comp-action="stop"]')),
          homeOpen: visible(home.querySelector('[data-comp-action="open"]')),
          homeDisabled: home.querySelector('button[data-comp-action]')?.disabled,
          rowStart: row.querySelector('[data-comp-action="start"]')?.textContent,
          rowOpen: !!row.querySelector('[data-comp-action="open"]'),
          rollbackVisible: visible(row.querySelector('[data-comp-action="rollback"]')),
          updateVisible: !document.querySelector('#home-update').hidden,
          extraFeedbackNodes: document.querySelectorAll('#hint, [data-comp-hint], #home-components-hint, [data-comp-progress]').length,
          noticeVisible: !document.querySelector('#app-confirm').hidden,
          noticeTitle: document.querySelector('#app-confirm-title').textContent,
          noticeBody: document.querySelector('#app-confirm-body').textContent,
          updateCount: document.body.innerText.split('可更新至 v0.3.3').length - 1,
          desktopImages: document.querySelectorAll('.home-product img').length,
          homeImages: home.querySelectorAll('img').length,
          sidebarBrand: document.querySelector('.rail-head .brand-avatar')?.naturalWidth,
          catalogBrand: row.querySelector('.comp-brand')?.naturalWidth,
        };
      })()`);
      await delay(150);
      const absent = await read();
      componentInstalled = true;
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      const stopped = await read();
      await win.webContents.executeJavaScript(`document.querySelector('#home-components [data-comp-action="start"]').click(); document.querySelector('#home-components [data-comp-action="start"]').click()`);
      await delay(80);
      const starting = await read();
      componentStartResolve(); await delay(100);
      const running = await read();
      if (process.env.QA_HOME_ARTIFACTS) {
        fs.mkdirSync(process.env.QA_HOME_ARTIFACTS, { recursive: true });
        fs.writeFileSync(path.join(process.env.QA_HOME_ARTIFACTS, 'home-no-card-avatars.png'),
          (await win.webContents.capturePage()).toPNG());
      }
      await win.webContents.executeJavaScript(`document.querySelector('#home-components [data-comp-action="open"]').click()`);await delay(100);
      await win.webContents.executeJavaScript(`document.querySelector('#home-components [data-comp-action="stop"]').click(); document.querySelector('#home-components [data-comp-action="stop"]').click()`);await delay(80);
      const stopping = await read();
      componentStopResolve();await delay(100);
      const stoppedAgain = await read();
      await win.webContents.executeJavaScript(`document.querySelector('[data-tab="components"]').click()`);
      const catalogStopped = await read();
      await win.webContents.executeJavaScript(`document.querySelector('.comp-manage').open = true; document.querySelector('[data-comp-action="rollback"]').click()`);await delay(80);
      await win.webContents.executeJavaScript(`document.querySelector('#app-confirm-cancel').click(); document.querySelector('[data-tab="home"]').click(); document.querySelector('#btn-check-update').click()`);await delay(150);
      const update = await read();
      componentInstalled = false;await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');const removed = await read();
      console.log('BOUND_RESULT:' + JSON.stringify({ absent, stopped, starting, running, stopping, stoppedAgain, catalogStopped, update, removed, calls: results.calls }));app.quit();return;
    }

    if (process.env.QA_STARTUP_FLOW === '1') {
      const captureHome = async name => {
        if (!process.env.QA_HOME_ARTIFACTS) return;
        await new Promise(r => setTimeout(r, 180));
        const fs = require('fs');
        fs.mkdirSync(process.env.QA_HOME_ARTIFACTS, { recursive: true });
        const screenshot = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.QA_HOME_ARTIFACTS, name), screenshot.toPNG());
      };
      const readHome = () => win.webContents.executeJavaScript(`(() => {
        const get = id => document.getElementById(id);
        return {
          duplicateRetry: Boolean(get('btn-recovery-retry')),
          startText: get('btn-start').textContent, startDisabled: get('btn-start').disabled,
          startHidden: get('btn-start').hidden, stopHidden: get('btn-stop').hidden,
          stopDisabled: get('btn-stop').disabled, stopText: get('btn-stop').textContent,
          skipDisabled: get('btn-skip').disabled, fullDisabled: get('btn-retry-full').disabled,
          diagnosticsHidden: get('home-recovery').hidden, diagnosticsOpen: get('home-recovery').open === true,
          visibleText: document.body.innerText,
          status: get('home-status').textContent,
          detail: get('home-recovery-verdict').textContent,
        };
      })()`);
      await new Promise(r => setTimeout(r, 100));
      const initial = await readHome();
      await captureHome('home-collapsed.png');
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click(); document.getElementById('btn-start').click();`);
      await new Promise(r => setTimeout(r, 1100));
      const pending = await readHome();
      await captureHome('home-starting.png');
      const startsWhilePending = results.calls.filter(c => c.op === 'start-desktop').length;
      startupState = 'error';
      startResolve({ ok: false, error: startupError });
      await new Promise(r => setTimeout(r, 120));
      const failed = await readHome();
      const layouts = [];
      for (const zoom of [1, 2]) {
        win.setSize(860, 560);
        win.webContents.setZoomFactor(zoom);
        await new Promise(r => setTimeout(r, 180));
        await win.webContents.executeJavaScript(`document.getElementById('home-recovery').open = true`);
        const layout = await win.webContents.executeJavaScript(`(() => {
          const button = document.getElementById('btn-start');
          button.scrollIntoView();
          const r = button.getBoundingClientRect();
          return { width: innerWidth, reachable: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
            rawErrorCount: document.body.innerText.split('EEXIST').length - 1 };
        })()`);
        layouts.push({ zoom, ...layout });
        await captureHome(`home-failed-${zoom}x.png`);
      }
      win.webContents.setZoomFactor(1);
      await new Promise(r => setTimeout(r, 180));
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click()`);
      await new Promise(r => setTimeout(r, 80));
      startReject(new Error('fixture transport failure'));
      await new Promise(r => setTimeout(r, 120));
      const rejected = await readHome();
      await win.webContents.executeJavaScript(`document.getElementById('btn-start').click()`);
      await new Promise(r => setTimeout(r, 80));
      startupState = 'ready';
      startResolve({ ok: true });
      await new Promise(r => setTimeout(r, 120));
      const readyHome = await readHome();
      await win.webContents.executeJavaScript(`document.getElementById('btn-stop').click(); document.getElementById('btn-stop').click()`);
      await new Promise(r => setTimeout(r, 80));
      const stopping = await readHome();
      startupState = 'stopped';
      stopResolve({ ok: true });
      await new Promise(r => setTimeout(r, 120));
      const stopped = await readHome();
      process.stdout.write('BOUND_RESULT:' + JSON.stringify({ initial, pending, failed, rejected, readyHome,
        stopping, stopped, layouts, startsWhilePending, stops: results.calls.filter(c => c.op === 'stop-desktop').length }));
      app.exit(0);
      return;
    }

    // ---- Delayed cancel A -> B ----
    // Start import A (runs forever until we resolve). While A is in flight,
    // click cancel — the handler captures A's opId and awaits. Then start B
    // (activeImportOpId=B). When A's cancel reply finally arrives, the stale
    // write must be refused (stillOwns is false), leaving B's progress intact.
    const importBtnExists = scan.importBtn;
    let delayedCancel = { skipped: !importBtnExists };
    if (importBtnExists) {
      await win.webContents.executeJavaScript(`document.getElementById('btn-import').click()`);
      await new Promise((r) => setTimeout(r, 60));
      const opA = results.calls.find((c) => c.op === 'run-import')?.opts?.opId;
      // Click cancel for A (handler captures opA and awaits cancel reply).
      await win.webContents.executeJavaScript(`document.getElementById('btn-import-cancel').click()`);
      // Start B: mark a new active op by clicking import again after A's
      // handler finishes? A is still pending — instead simulate B by forcing
      // the shared state: dispatch progress for opB and a stale progress for opA.
      // Resolve A's run-import so its finally clears activeImportOpId, then
      // start B fresh.
      if (importResolve) importResolve({ ok: true, sessions: [], skills: [] });
      await new Promise((r) => setTimeout(r, 30));
      await win.webContents.executeJavaScript(`document.getElementById('btn-import').click()`);
      await new Promise((r) => setTimeout(r, 60));
      const runs = results.calls.filter((c) => c.op === 'run-import');
      const opB = runs.length > 1 ? runs[runs.length - 1].opts.opId : null;
      // Deliver the DELAYED cancel reply for A now (after B started).
      if (pendingCancels.has(opA)) pendingCancels.get(opA)({ ok: false, error: 'not-current-operation' });
      await new Promise((r) => setTimeout(r, 60));
      const dom = await win.webContents.executeJavaScript(`({
        importResult: document.getElementById('import-result').textContent,
        cancelHidden: document.getElementById('btn-import-cancel').hidden,
      })`);
      delayedCancel = {
        opA, opB, dom,
        staleWriteRefused: !/取消被拒绝|取消请求被拒绝/.test(dom.importResult),
      };
    }

    // ---- Route save refusal -> retry (bound radio handler) ----
    // First pick: env QA_ROUTE_FAIL_ONCE makes the first saveLauncherConfig
    // resolve {ok:false} — the bound handler must treat the resolved refusal
    // as a failure and let a retry of the SAME route actually issue.
    let routeRetry = { skipped: true };
    try {
      const radios = await win.webContents.executeJavaScript(`
        Array.from(document.querySelectorAll('#route-picker [data-route-pick]'))
          .map((el) => ({ route: el.dataset.routePick, checked: el.getAttribute('aria-checked'), disabled: el.disabled }))
      `);
      const beta = radios.find((r) => r.route === 'beta' && !r.disabled);
      if (beta) {
        const savesBefore = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        // First pick — will resolve {ok:false} under QA_ROUTE_FAIL_ONCE.
        await win.webContents.executeJavaScript(`
          document.querySelector('#route-picker [data-route-pick="beta"]').click()
        `);
        await new Promise((r) => setTimeout(r, 60));
        const savesAfterFirst = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        // Retry the SAME route — the refusal must not have deduped it away.
        await win.webContents.executeJavaScript(`
          document.querySelector('#route-picker [data-route-pick="beta"]').click()
        `);
        await new Promise((r) => setTimeout(r, 60));
        const savesAfterRetry = results.calls.filter((c) => c.op === 'save-launcher-config').length;
        routeRetry = {
          radios,
          picked: 'beta',
          savesBefore,
          savesAfterFirst,
          savesAfterRetry,
          firstIssued: savesAfterFirst > savesBefore,
          retryIssued: savesAfterRetry > savesAfterFirst,
        };
      } else {
        routeRetry = { radios, reason: 'no-enabled-beta' };
      }
    } catch (error) {
      routeRetry = { error: String(error) };
    }

    const report = { scan, delayedCancel, routeRetry, calls: results.calls.map((c) => ({ op: c.op, hasOp: Boolean(c.opts && c.opts.opId) })) };
    process.stdout.write('BOUND_RESULT:' + JSON.stringify(report));
    app.exit(0);
  } catch (error) {
    process.stdout.write('BOUND_ERROR:' + JSON.stringify({ message: String(error), stack: error && error.stack }));
    app.exit(1);
  }
});
