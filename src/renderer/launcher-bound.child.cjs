// Electron main for the bound-handler regression: load the REAL launcher.html
// + the REAL preload (which exposes window.shell via contextBridge), register
// fixture shell:* IPC handlers, and drive the page through executeJavaScript.
// A deferred-cancel A->B and a route-save refusal->retry are exercised against
// the real bind() and the real bridge — not pure functions.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
// Keep hidden QA capture independent of the user's GPU compositor.
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');
const os = require('os');

// All launcher state belongs to the fixture, never the installed application.
const fixtureUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-launcher-bound-'));
app.setPath('userData', fixtureUserData);

const LAUNCHER_HTML = path.join(__dirname, 'launcher.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'index.js');
const visualOnly = process.env.QA_LAUNCHER_VISUAL_ONLY === '1';
const visualSourceHome = path.join(fixtureUserData, '官方 DeepSeek Harness 的会话与技能备份',
  '包含空格的目录', '2026-10-12_团队工作目录与迁移验证', '来源目录_需保留完整位置并可读取说明');
if (visualOnly) fs.mkdirSync(visualSourceHome, { recursive: true });
if (visualOnly) ipcMain.handle('shell:window-state', event => ({
  maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() || false,
}));

// IPC fixtures the test controls via process.env / argv switches.
const results = { calls: [] };
const deltaFeedback = process.env.QA_DELTA_FEEDBACK === '1';
let deltaResolve;
let statusReads = 0;
let releaseReads = 0;
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
ipcMain.handle('shell:scan-import', () => ({
  ok: true, skills: [], plugins: [], mcp: [], settings: [], presets: [],
  sessions: visualOnly ? [{
    rel: 'launcher-layout/session.jsonl', id: 'session-long-title',
    title: '迁移验收：包含中文、空格和较长来源路径的会话，确认保留原标题并呈现完整的导入影响说明',
    cwd: visualSourceHome, createdAt: '2026-10-12T06:00:00.000Z',
  }] : [],
  ...(visualOnly ? { sourceHome: visualSourceHome, homeDir: fixtureUserData, sourceHasData: true, destEmpty: false, hasAttachments: true } : {}),
}));
ipcMain.handle('shell:launcher-status', () => { statusReads++; return ({
  ok: true,
  ...(visualOnly ? { version: '0.3.6', desktop: { state: 'stopped' },
    installed: { version: '0.3.6', registeredInstall: true, installPath: visualSourceHome } } : {}),
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
}); });
ipcMain.handle('shell:launcher-check-update', () => process.env.QA_COMPONENTS_HOME === '1' ? { status: 'available', latest: '0.3.3', currentVersion: '0.3.2', hint: '发现正式版 0.3.3。' } : { status: 'none' });
ipcMain.handle('shell:check-update', () => process.env.QA_COMPONENTS_HOME === '1' ? { status: 'available', latest: '0.3.3', currentVersion: '0.3.2', hint: '发现正式版 0.3.3。' } : { status: 'none' });
const componentFeedback = process.env.QA_COMPONENT_FEEDBACK === '1';
let componentInstalled = componentFeedback || visualOnly;
let componentRunning = visualOnly;
let componentLatest = visualOnly ? '1.1.1' : '1.0.3';
let componentVersion = visualOnly ? '1.1.1' : '1.0.3';
let componentMessage = '';
let componentStartResolve, componentStopResolve, componentInstallResolve, componentUpdateResolve;
let componentListResolve, componentUninstallInfoResolve;
const componentRow = () => ({ id: 'whalebridge', name: '鲸桥', description: '连接供应商和订阅账号，在鲸屿使用模型。', version: componentLatest, installedVersion: componentInstalled ? componentVersion : '', previousVersion: '1.0.2', updateAvailable: componentInstalled && componentVersion !== componentLatest, message: componentMessage, state: componentInstalled ? (componentRunning ? 'running' : 'stopped') : 'available', configurable: componentInstalled, source: 'official', kind: 'service' });
const componentPayload = () => ({ components: process.env.QA_COMPONENTS_HOME === '1' || componentFeedback || visualOnly ? [componentRow()] : [] });
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
ipcMain.handle('shell:install-delta', (_event, tag) => {
  results.calls.push({ op: 'install-delta', tag });
  return new Promise(resolve => { deltaResolve = resolve; });
});
ipcMain.handle('shell:list-releases', () => { releaseReads++; return ({ status: 'ok', releases: deltaFeedback ? [{
  tag: 'v9.9.9', version: '9.9.9', newer: true, installable: true, delta: { size: 20 },
}] : [],
  ...(deltaFeedback ? { current: '9.9.8' } : {}),
  installed: visualOnly ? { version: '0.3.6', registeredInstall: true, installPath: visualSourceHome } : { version: '0' },
  ...(visualOnly ? { current: '0.3.6' } : {}),
}); });
ipcMain.handle('shell:list-marketplace', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:list-installed-plugins', () => ({ plugins: [], bundles: [] }));
ipcMain.handle('shell:list-wallpapers', () => ({ ok: true, items: [] }));
ipcMain.handle('shell:get-config', () => ({ theme: 'midnight', locale: 'zh',
  ...(visualOnly ? { themeTokens: { scheme: 'dark' } } : {}),
}));
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
      offscreen: !visualOnly,
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      // The preload builds window.shell only for a declared shell role.
      additionalArguments: ['--dshd-shell-role=launcher'],
    },
  });
  try {
    await win.loadFile(LAUNCHER_HTML);
    // Media emulation belongs to the debugger session; detaching restores the
    // host preference. Keep it attached until this fixture window is destroyed.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
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
    const captureBound = async name => {
      if (!process.env.QA_HOME_ARTIFACTS) return;
      fs.mkdirSync(process.env.QA_HOME_ARTIFACTS, { recursive: true });
      await win.webContents.executeJavaScript("document.getAnimations().filter(a => a instanceof CSSTransition || a.animationName === 'shell-feedback-in').forEach(a => a.finish()); void 0");
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 80));
      fs.writeFileSync(path.join(process.env.QA_HOME_ARTIFACTS, name),
        (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      if (win.isVisible() || win.isFocused()) throw new Error('bound fixture must remain hidden and unfocused');
    };

    if (deltaFeedback) {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
      const js = source => win.webContents.executeJavaScript(source);
      const waitFor = async expression => {
        for (let i = 0; i < 100; i++) {
          if (await js(expression)) return;
          await delay(20);
        }
        throw new Error('delta DOM did not settle: ' + expression);
      };
      const read = () => js(`(() => {
        const card = document.getElementById('update-progress-card');
        const button = document.querySelector('#ver-cta [data-delta-tag]');
        return { title: document.getElementById('update-progress-title').textContent,
          body: document.getElementById('update-progress').textContent,
          pct: document.getElementById('update-progress-pct').textContent,
          phasesHidden: document.getElementById('update-progress-phases').hidden,
          barHidden: document.getElementById('update-progress-bar').parentElement.hidden,
          modalHidden: document.getElementById('app-confirm').hidden,
          progressVisible: card.checkVisibility(), busy: card.getAttribute('aria-busy'),
          focus: document.activeElement === button, toasts: document.querySelectorAll('.shell-feedback-toast').length };
      })()`);
      await js('document.querySelector("[data-tab=versions]").click()');
      await waitFor('!!document.querySelector("#ver-cta [data-delta-tag]")');
      const cases = [];
      for (const [name, reply] of [
        ['waiting', { mode: 'full', status: 'waiting', ok: true }],
        ['delta-installed', { mode: 'delta', ok: true, to: '9.9.9' }],
        ['full-installed', { mode: 'full', status: 'installed', installed: { version: '9.9.9' } }],
      ]) {
        deltaResolve = undefined;
        await js('document.querySelector("#ver-cta [data-delta-tag]").focus(); document.querySelector("#ver-cta [data-delta-tag]").click()');
        await waitFor('!document.getElementById("app-confirm").hidden');
        const confirmationFocus = await js('document.activeElement.id');
        await js('document.getElementById("app-confirm-ok").click()');
        await waitFor('document.getElementById("update-progress-card").getAttribute("aria-busy") === "true"');
        const pending = await read();
        const readsBefore = { status: statusReads, releases: releaseReads };
        deltaResolve(reply);
        await waitFor('document.getElementById("update-progress-card").getAttribute("aria-busy") === "false"');
        await delay(30);
        const terminal = await read();
        const readsAfter = { status: statusReads, releases: releaseReads };
        await captureBound(`bound-delta-${name}.png`);
        cases.push({ name, confirmationFocus, pending, terminal, readsBefore, readsAfter });
      }
      process.stdout.write('BOUND_RESULT:' + JSON.stringify({ cases, calls: results.calls }));
      app.exit(0);
      return;
    }

    if (visualOnly) {
      if (!process.env.QA_HOME_ARTIFACTS) throw new Error('visual capture requires QA_HOME_ARTIFACTS');
      const artifactDir = process.env.QA_HOME_ARTIFACTS;
      const captionOnly = process.env.QA_LAUNCHER_VISUAL_SCOPE === 'caption';
      fs.mkdirSync(artifactDir, { recursive: true });
      const settle = () => win.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.allSettled(document.getAnimations().filter(animation =>
          animation.effect.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
        return new Promise(resolve => requestAnimationFrame(() => resolve(true)));
      })()`);
      const waitForDom = expression => win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = () => {
          if (${expression}) return resolve(true);
          if (Date.now() >= deadline) return reject(new Error('visual DOM did not settle: ' + ${JSON.stringify(expression)}));
          setTimeout(poll, 20);
        };
        poll();
      })`);
      const captures = [];
      const capture = async (name, selectors) => {
        // A hidden native window can retain a partly repainted composited frame
        // after theme / tab changes. Resize back to the requested geometry to
        // invalidate the full surface without showing or focusing the fixture.
        const [width, height] = win.getContentSize();
        win.setContentSize(width + 1, height);
        await settle();
        win.setContentSize(width, height);
        await settle();
        win.webContents.invalidate();
        // capturePage reads the composited frame; allow the existing 100ms
        // color transition to reach that frame after its DOM animation ends.
        await new Promise(resolve => setTimeout(resolve, 180));
        if (captionOnly) {
          const center = await win.webContents.executeJavaScript(`(() => {
            const close = document.querySelector('.window-controls button[data-act="close"]');
            if (!close) throw new Error('launcher close control is missing');
            const r = close.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          })()`);
          win.webContents.sendInputEvent({ type: 'mouseMove', ...center });
          await waitForDom(`(() => {
            const close = document.querySelector('.window-controls button[data-act="close"]');
            const hit = document.elementFromPoint(${center.x}, ${center.y});
            return close?.matches(':hover') && (hit === close || close.contains(hit));
          })()`);
          await settle();
        }
        const layout = await win.webContents.executeJavaScript(`(() => {
          const boxes = Object.fromEntries(${JSON.stringify(selectors)}.map(selector => {
            const el = document.querySelector(selector);
            const rect = el?.getBoundingClientRect();
            const style = el && getComputedStyle(el);
            return [selector, !el ? null : { visible: el.checkVisibility(), text: el.textContent.trim(),
              disabled: el.disabled, color: style.color, background: style.backgroundColor, opacity: style.opacity,
              paddingTop: Number.parseFloat(style.paddingTop),
              scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
              x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              clippedByViewport: rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight }];
          }));
          return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
            theme: document.documentElement.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light',
            documentWidth: document.documentElement.scrollWidth,
            mainWidth: document.querySelector('main').clientWidth,
            mainScrollWidth: document.querySelector('main').scrollWidth, boxes,
            ...( ${captionOnly} ? (() => {
              const close = document.querySelector('.window-controls button[data-act="close"]');
              const r = close.getBoundingClientRect();
              const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return { closeHovered: close.matches(':hover'), closeCenterHit: hit === close || close.contains(hit),
                closeTopGap: r.top, closeRightGap: innerWidth - r.right };
            })() : {}) };
        })()`);
        const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true });
        const file = `${name}.png`;
        fs.writeFileSync(path.join(artifactDir, file), screenshot.toPNG());
        captures.push({ file, nativeBounds: win.getBounds(), nativeContentBounds: win.getContentBounds(),
          pixels: screenshot.getSize(), layout });
      };
      await waitForDom('document.querySelector("#home-version").textContent === "v0.3.6" && !!document.querySelector("#home-components [data-comp-action=open]")');
      let darwinCssGeometry;
      if (captionOnly) {
        const selectors = ['.window-controls', '.window-controls button[data-act="close"]',
          '[data-goto="versions"]', '.caption', '.rail-head', '.home-heading', '.stage'];
        for (const theme of ['dark', 'light']) {
          win.webContents.send('shell:theme', { scheme: theme });
          await waitForDom(`document.documentElement.hasAttribute('data-ds-dark-theme') === ${theme === 'dark'}`);
          for (const [label, width, height] of [['normal', 1060, 660], ['narrow', 860, 560]]) {
            win.setContentSize(width, height);
            await capture(`caption-${theme}-${label}-close-hover`, selectors);
            const item = captures.at(-1);
            if (win.isVisible() || win.isFocused()) throw new Error('caption fixture must remain hidden and unfocused');
            for (const selector of selectors) {
              const box = item.layout.boxes[selector];
              if (!box?.visible || box.clippedByViewport) throw new Error(`caption control clipped or missing: ${selector}`);
            }
            const caption = item.layout.boxes['.caption'];
            const captionBottom = caption.y + caption.height;
            if (caption.height !== 48 || !item.layout.closeHovered || !item.layout.closeCenterHit
              || item.layout.closeTopGap < 8 || item.layout.closeRightGap < 8) {
              throw new Error(`caption hover or window spacing failed: ${item.file}`);
            }
            for (const selector of ['.rail-head', '.home-heading', '[data-goto="versions"]']) {
              if (item.layout.boxes[selector].y < captionBottom + 8) throw new Error(`caption overlaps content: ${selector}`);
            }
            if (item.layout.boxes['.stage'].paddingTop !== 56) throw new Error('Windows stage must clear the caption');
          }
        }
        darwinCssGeometry = await win.webContents.executeJavaScript(`(() => {
          const previous = document.documentElement.dataset.platform;
          document.documentElement.dataset.platform = 'darwin';
          try {
            return { evidence: 'Windows renderer CSS with simulated platform; not a native Mac screenshot',
              caption: document.querySelector('.caption').getBoundingClientRect().height,
              railPaddingTop: Number.parseFloat(getComputedStyle(document.querySelector('.rail')).paddingTop),
              stagePaddingTop: Number.parseFloat(getComputedStyle(document.querySelector('.stage')).paddingTop) };
          } finally { document.documentElement.dataset.platform = previous; }
        })()`);
        if (darwinCssGeometry.caption !== 32 || darwinCssGeometry.railPaddingTop !== 40 || darwinCssGeometry.stagePaddingTop !== 40) {
          throw new Error('Windows caption spacing changed Darwin CSS geometry');
        }
      } else {
      if (process.env.QA_LAUNCHER_VISUAL_SCOPE !== 'import') {
        const homeSelectors = ['.caption', '.rail-head', '.rail nav', '.rail-foot', '#btn-start', '#btn-check-update', '#home-components [data-comp-action="open"]'];
        for (const theme of ['dark', 'light']) {
          win.webContents.send('shell:theme', { scheme: theme });
          await waitForDom(`document.documentElement.hasAttribute('data-ds-dark-theme') === ${theme === 'dark'}`);
          win.setContentSize(1280, 800);
          await capture(`home-${theme}-normal`, homeSelectors);
          win.setContentSize(860, 560);
          await capture(`home-${theme}-narrow`, homeSelectors);
        }
        await win.webContents.executeJavaScript('document.querySelector("#rail-route-btn").click()');
        await capture('home-light-route-narrow', ['#rail-route-btn', '#rail-route-pop']);
        await win.webContents.executeJavaScript('document.querySelector("#rail-route-btn").click(); document.querySelector("[data-tab=versions]").click()');
        await capture('versions-light-long-path-narrow', ['#ver-lead', '#installed-uninstall-note', '#btn-refresh-releases']);
      }
      win.webContents.send('shell:theme', { scheme: 'light' });
      await waitForDom("!document.documentElement.hasAttribute('data-ds-dark-theme')");
      await win.webContents.executeJavaScript('document.querySelector("[data-tab=import]").click()');
      await waitForDom('document.querySelector("#import-source").textContent.includes("来源目录")');
      await win.webContents.executeJavaScript('document.querySelector("#import-overwrite").click(); document.querySelector("#import-attachments").checked || document.querySelector("#import-attachments").click()');
      win.setContentSize(1280, 800);
      const importSelectors = ['#import-source', '.import-board-body', '.import-cluster-head', '.import-cluster .row-title', '#import-scope', '#btn-import'];
      await capture('import-light-long-path-normal', importSelectors);
      win.setContentSize(860, 560);
      await capture('import-light-long-path-narrow', importSelectors);
      await win.webContents.executeJavaScript('document.querySelector("#btn-import").scrollIntoView({ block: "nearest" })');
      await capture('import-light-actions-narrow', ['#import-scope', '#import-selection-line', '#btn-import']);
      for (const item of captures.filter(item => item.file.startsWith('import-'))) {
        if (item.layout.documentWidth > item.layout.width || item.layout.mainScrollWidth > item.layout.mainWidth) {
          throw new Error(`import surface overflow: ${item.file}`);
        }
        const body = item.layout.boxes['.import-board-body'];
        if (body && body.scrollWidth > body.clientWidth) throw new Error(`import list horizontal overflow: ${item.file}`);
      }
      if (captures.find(item => item.file === 'import-light-actions-narrow.png').layout.boxes['#btn-import'].clippedByViewport) {
        throw new Error('import primary action not reachable in narrow window');
      }
      }
      const crypto = require('crypto');
      const sourceHashes = Object.fromEntries(['launcher.html', 'launcher.css', 'launcher.js', 'theme.js'].map(name =>
        [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex')]));
      sourceHashes.preload = crypto.createHash('sha256').update(fs.readFileSync(PRELOAD)).digest('hex');
      const display = screen.getDisplayMatching(win.getBounds());
      const report = { entry: LAUNCHER_HTML, preload: PRELOAD, scan, fixtureUserData,
        sourceHashes, display: { scaleFactor: display.scaleFactor, bounds: display.bounds, workArea: display.workArea },
        activated: false, captures, calls: results.calls, ...(darwinCssGeometry ? { darwinCssGeometry } : {}) };
      fs.writeFileSync(path.join(artifactDir, 'capture.json'), JSON.stringify(report, null, 2));
      process.stdout.write('BOUND_RESULT:' + JSON.stringify(report));
      app.exit(0);
      return;
    }

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
        const label = button.querySelector('.shell-button-label');
        const track = label?.querySelector('.shell-button-label-text');
        const mask = document.querySelector('#app-confirm');
        const toast = [...document.querySelectorAll('.shell-feedback-toast')].at(-1);
        const progress = [...document.querySelectorAll('.shell-feedback-progress')].at(-1);
        return {
          sameButton: button.isConnected, caption: (button.querySelector('.shell-button-label')?.textContent ?? button.textContent), width: box.width, height: box.height,
          spinner: !!button.querySelector('.shell-button-spinner'),
          labelColor: label ? getComputedStyle(label).color : '',
          scrolling: label?.classList.contains('is-scrolling') || false,
          labelWidth: label?.clientWidth || 0, textWidth: track?.scrollWidth || 0,
          animationName: track ? getComputedStyle(track).animationName : '',
          spinnerColor: button.querySelector('.shell-button-spinner') ? getComputedStyle(button.querySelector('.shell-button-spinner')).borderTopColor : '',
          busy: button.getAttribute('aria-busy'), loadingLabel: button.getAttribute('aria-label'),
          homeHeight: document.querySelector('#home-components').getBoundingClientRect().height,
          controls: [...document.querySelectorAll('[data-comp-id="whalebridge"]')].map(control => ({
            action: control.dataset.compAction, disabled: control.disabled, busy: control.getAttribute('aria-busy'),
          })),
          extraFeedbackNodes: document.querySelectorAll('#hint, [data-comp-hint], #home-components-hint, [data-comp-progress]').length,
          modalVisible: !mask.hidden,
          noticeVisible: !!toast?.checkVisibility(), noticeRole: toast?.getAttribute('role') || '',
          noticeTitle: window.qaComponentNotices.at(-1)?.title || '',
          noticeBody: toast?.querySelector('.shell-feedback-text')?.textContent || '',
          confirmTitle: document.querySelector('#app-confirm-title').textContent,
          confirmBody: document.querySelector('#app-confirm-body').textContent,
          progressVisible: !!progress?.checkVisibility(), progressBusy: progress?.getAttribute('aria-busy') || '',
          progressBody: progress?.querySelector('p')?.textContent || '',
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
        await win.webContents.executeJavaScript('document.querySelectorAll(".shell-feedback-toast").forEach(node => node.remove())');
        await waitForDom('!document.querySelector(".shell-feedback-toast")');
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
      await waitForDom('!!document.querySelector(".shell-feedback-toast")');
      const failed = await readFeedback();
      await captureBound('bound-component-start-failed.png');
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
      await waitForDom('(window.qaComponentButton.querySelector(".shell-button-label")?.textContent ?? window.qaComponentButton.textContent).startsWith("安装")');
      const installing = await readFeedback();
      const installScroll = await win.webContents.executeJavaScript(`(async () => {
        const button = window.qaComponentButton;
        const label = button.querySelector('.shell-button-label');
        const text = label.querySelector('.shell-button-label-text');
        const animation = text.getAnimations()[0];
        window.qaScrollText = text;
        if (!animation) return { missingAnimation: true };
        const duration = animation.effect.getTiming().duration;
        animation.currentTime = duration * .2;
        animation.play();
        const movingStart = text.getBoundingClientRect().x;
        await new Promise(resolve => setTimeout(resolve, 120));
        const movingEnd = text.getBoundingClientRect().x;
        animation.pause();
        const box = label.getBoundingClientRect();
        animation.currentTime = 0;
        const atStart = text.getBoundingClientRect();
        animation.currentTime = duration / 2;
        const atEnd = text.getBoundingClientRect();
        window.qaScrollAnimation = animation;
        return { start: atStart.x, end: atEnd.x, left: box.left, right: box.right,
          movingStart, movingEnd, startRight: atStart.right, endRight: atEnd.right };
      })()`);
      await captureBound('bound-component-install-scrolling.png');
      componentProgress({ phase: 'download', percent: 42 });
      await waitForDom('window.qaComponentButton.title.includes("下载组件 42%")');
      const downloading = await readFeedback();
      const continuousScroll = await win.webContents.executeJavaScript(`(() => {
        const text = window.qaComponentButton.querySelector('.shell-button-label-text');
        return { sameText: text === window.qaScrollText,
          sameAnimation: text.getAnimations()[0] === window.qaScrollAnimation,
          time: text.getAnimations()[0]?.currentTime || 0 };
      })()`);
      await captureBound('bound-component-download.png');
      let reducedMotion;
      try {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        reducedMotion = await readFeedback();
      } finally {
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
      }
      componentProgress({ phase: 'verify', percent: 60 });
      await waitForDom('window.qaComponentButton.title.includes("校验组件 60%")');
      const verifying = await readFeedback();
      componentInstallResolve();
      await waitForDom('!!document.querySelector("#tab-components [data-comp-action=open]") && !document.querySelector("[data-comp-id=whalebridge][aria-busy=true]")');
      const installed = await readFeedback();
      await captureBound('bound-component-installed.png');
      const installDismissed = installed;

      componentLatest = '1.0.4';
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      await win.webContents.executeJavaScript('document.querySelector(".comp-manage").open = true');
      const updateBefore = await rememberButton('#tab-components [data-comp-action="update"]');
      await click('#tab-components [data-comp-action="update"]');
      await waitFor(() => typeof componentUpdateResolve === 'function');
      componentProgress({ phase: 'download', percent: 51 });
      await waitForDom('window.qaComponentButton.title.includes("下载组件 51%")');
      const updating = await readFeedback();
      componentProgress({ phase: 'error', percent: 100, message: 'fixture package refused' });
      componentUpdateResolve({ ok: false, message: 'fixture package refused' });
      await waitForDom('document.querySelector(".shell-feedback-toast .shell-feedback-text")?.textContent.startsWith("鲸桥操作未完成：")');
      const updateFailed = await readFeedback();
      win.setSize(860, 560);
      await captureBound('bound-component-update-failed-narrow.png');
      win.setSize(1280, 800);
      await closeNotice();
      const updateDismissed = await readFeedback();

      componentMessage = 'fixture catalog is unavailable';
      await win.webContents.executeJavaScript('window.__launcherComponents.refresh()');
      const persistentErrorInline = await win.webContents.executeJavaScript('document.querySelector("[data-comp-list]").innerText.includes("fixture catalog")');
      await click('#tab-components [data-comp-info="whalebridge"]');
      await waitForDom('document.querySelector(".shell-feedback-toast .shell-feedback-text")?.textContent.startsWith("鲸桥状态：")');
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
      await captureBound('bound-component-uninstall-confirm.png');
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
        installBefore, installing, installScroll, downloading, continuousScroll, reducedMotion, verifying, installed, installDismissed, updateBefore, updating, updateFailed, updateDismissed,
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
          toastCount: document.querySelectorAll('.shell-feedback-toast').length,
          updateText: document.querySelector('#home-update-text').textContent,
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
      await captureBound('bound-home-update.png');
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
        // Chromium innerText includes text inside closed <details>. Measure
        // laid-out text so hidden diagnostics do not count as visible copy.
        const visibleText = [];
        const homeVisibleText = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.parentElement?.checkVisibility()) continue;
          const collapsed = node.parentElement.closest('details:not([open])');
          if (collapsed && !collapsed.querySelector(':scope > summary')?.contains(node)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if ([...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) {
            visibleText.push(node.textContent);
            if (!node.parentElement.closest('.shell-feedback-stack')) homeVisibleText.push(node.textContent);
          }
        }
        return {
          duplicateRetry: Boolean(get('btn-recovery-retry')),
          startText: (get('btn-start').querySelector('.shell-button-label')?.textContent ?? get('btn-start').textContent), startDisabled: get('btn-start').disabled,
          startBusy: get('btn-start').getAttribute('aria-busy'), startLabel: get('btn-start').getAttribute('aria-label'),
          startHidden: get('btn-start').hidden, stopHidden: get('btn-stop').hidden,
          stopDisabled: get('btn-stop').disabled, stopText: (get('btn-stop').querySelector('.shell-button-label')?.textContent ?? get('btn-stop').textContent),
          stopBusy: get('btn-stop').getAttribute('aria-busy'), stopLabel: get('btn-stop').getAttribute('aria-label'),
          skipDisabled: get('btn-skip').disabled, fullDisabled: get('btn-retry-full').disabled,
          diagnosticsHidden: get('home-recovery').hidden, diagnosticsOpen: get('home-recovery').open === true,
          visibleText: visibleText.join(' '),
          homeVisibleText: homeVisibleText.join(' '),
          errorToasts: [...document.querySelectorAll('.shell-feedback-toast[role="alert"] .shell-feedback-text')].map(node => node.textContent),
          modalHidden: get('app-confirm').hidden,
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
            rawErrorCount: document.getElementById('panel-home').innerText.split('EEXIST').length - 1 };
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

    const keyboard = await win.webContents.executeJavaScript(`(() => {
      const chip = document.getElementById('rail-route-btn');
      const pop = document.getElementById('rail-route-pop');
      chip.click();
      const read = () => document.activeElement.dataset.routeOpt;
      const key = value => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
      const opened = read(); key('ArrowDown'); const down = read();
      key('End'); const end = read(); key('Home'); const home = read();
      key('ArrowUp'); const up = read(); key('Escape');
      const escaped = document.activeElement === chip && pop.hidden;
      document.getElementById('import-overwrite').click();
      document.getElementById('import-attachments').click();
      const scope = document.getElementById('import-scope').textContent;
      return { opened, down, end, home, up, escaped, scope };
    })()`);

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
      const cancelBefore = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById('btn-import-cancel'), r = b.getBoundingClientRect(); return { width: r.width, height: r.height }; })()`);
      // Click cancel for A (handler captures opA and awaits cancel reply).
      await win.webContents.executeJavaScript(`document.getElementById('btn-import-cancel').click()`);
      const cancelPending = await win.webContents.executeJavaScript(`(() => { const b = document.getElementById('btn-import-cancel'), r = b.getBoundingClientRect(); return { width: r.width, height: r.height, label: b.querySelector('.shell-button-label-text')?.textContent, busy: b.getAttribute('aria-busy'), disabled: b.disabled, spinner: Boolean(b.querySelector('.shell-button-spinner')) }; })()`);
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
        cancelBusy: document.getElementById('btn-import-cancel').getAttribute('aria-busy'),
        cancelDisabled: document.getElementById('btn-import-cancel').disabled,
        cancelOverlay: document.getElementById('btn-import-cancel').hasAttribute('data-button-label'),
      })`);
      delayedCancel = {
        opA, opB, dom, cancelBefore, cancelPending,
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

    const report = { scan, keyboard, delayedCancel, routeRetry, calls: results.calls.map((c) => ({ op: c.op, hasOp: Boolean(c.opts && c.opts.opId) })) };
    process.stdout.write('BOUND_RESULT:' + JSON.stringify(report));
    app.exit(0);
  } catch (error) {
    process.stdout.write('BOUND_ERROR:' + JSON.stringify({ message: String(error), stack: error && error.stack }));
    app.exit(1);
  }
});
