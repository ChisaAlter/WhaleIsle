'use strict';

// Isolated real-renderer regression: production HTML/preload, read-only IPC.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RendererConsoleTail, attachRendererConsoleTail, writeCrashReport } = require('../main/crash-report');
const { waitForDom, waitForMain } = require('./fixture-wait.cjs');
// 父测试进程创建并回收夹具目录，经 argv 传入（#478）；独立运行时退回自建目录。
const root = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-layout-'));
const evidence = process.env.DSHD_LAYOUT_EVIDENCE_DIR;
if (evidence) fs.mkdirSync(evidence, { recursive: true });
app.setPath('userData', root);
app.on('window-all-closed', () => {});
let scheme = 'light';
const config = () => ({ themeTokens: { scheme }, downloadRoute: 'github' });
const handlers = {
  'shell:get-config': config,
  'shell:window-state': () => ({ maximized: false }),
  'shell:components-list': () => ({ components: [] }),
  'shell:launcher-status': () => ({ ok: true, config: config(), downloadRoute: 'github', routes: [], desktop: { state: 'error' }, lastStart: { ok: false, error: 'fixture failure' }, forensics: { plugins: [] } }),
  'shell:scan-import': () => ({ ok: true, sourceHome: 'C:\\fixture\\source', homeDir: 'C:\\fixture\\target', sessions: Array.from({ length: 6 }, (_, i) => ({ rel: `workspace/session-${i}`, title: `会话 ${i}`, cwd: 'C:\\fixture\\workspace' })), skills: [], plugins: [], mcp: [], settings: [], presets: [] }),
  'shell:launcher-check-update': () => ({ status: 'none' }),
  'shell:check-update': () => ({ status: 'none' }),
  'shell:app-confirm:response': () => ({ ok: true }),
};
for (const [channel, fn] of Object.entries(handlers)) ipcMain.handle(channel, fn);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1060, height: 660, useContentSize: true, frame: false, show: false,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, additionalArguments: ['--dshd-shell-role=launcher'] } });
  const tail = new RendererConsoleTail();
  attachRendererConsoleTail(win.webContents, tail);
  await win.loadFile(path.join(__dirname, 'launcher.html'));
  const js = (source) => win.webContents.executeJavaScript(source);
  const baseDpr = (await js('devicePixelRatio')) / (win.webContents.getZoomFactor() || 1);
  /** @param {number} zoom */
  const waitForStableViewport = async (zoom) => {
    const expectedDpr = baseDpr * zoom;
    await waitForMain(
      () => Math.abs(win.webContents.getZoomFactor() - zoom) < 0.01,
      `zoom factor ${zoom}`,
    );
    await js('window.__layoutViewport = null');
    await waitForDom(js, `(() => {
      if (Math.abs(devicePixelRatio - ${expectedDpr}) >= ${0.05 * baseDpr}) return false;
      const now = innerWidth + 'x' + innerHeight + '@' + devicePixelRatio;
      const prev = window.__layoutViewport;
      window.__layoutViewport = { now, same: prev && prev.now === now ? prev.same + 1 : 0 };
      return window.__layoutViewport.same >= 5;
    })()`);
  };
  const feedbackSurfaces = await js("['install-progress-card','update-progress-card','import-progress-card','home-update'].map(id=>({id,floating:!!document.getElementById(id).closest('.shell-feedback-stack'),position:getComputedStyle(document.getElementById(id).closest('.shell-feedback-stack')).position}))");
  await js("console.info('LAYOUT_INFO_CONTROL'); console.error('LAYOUT_ERROR_SENTINEL')");
  // Tail lines carry a timestamp prefix, so match the message inside each line.
  const logged = (text) => tail.snapshot().some((line) => line.includes(text));
  // console-message events reach the main process asynchronously; poll the
  // tail until the error sentinel arrives instead of a fixed wait. The tail
  // keeps error-level lines only — the info sentinel must NEVER appear (the
  // test asserts infoCaptured stays false), so it cannot be waited on.
  await waitForMain(() => logged('LAYOUT_ERROR_SENTINEL'), 'renderer console tail');
  const report = await writeCrashReport(path.join(root, 'logs'), { time: new Date(), source: 'renderer', phase: 'test', app: { name: 'fixture', electron: process.versions.electron }, error: new Error('fixture'), rendererConsole: tail.snapshot() });
  const diagnostics = { errorCaptured: logged('LAYOUT_ERROR_SENTINEL'), infoCaptured: logged('LAYOUT_INFO_CONTROL'), reportHasError: fs.readFileSync(report, 'utf8').includes('LAYOUT_ERROR_SENTINEL') };
  const cases = [];
  for (scheme of ['light', 'dark']) {
    await js(`document.documentElement.toggleAttribute('data-ds-dark-theme', ${scheme === 'dark'})`);
    for (const [width, height, zoom] of [[1060, 660, 1], [860, 560, 1], [860, 560, 1.25], [1060, 660, 1.5], [860, 560, 2]]) {
      win.setContentSize(width, height);
      win.webContents.setZoomFactor(zoom);
      await js("document.querySelector('[data-tab=import]').click()");
      // The import scan IPC, its render, the resize event and the zoom factor
      // all land asynchronously. Wait for the six session rows, then for the
      // CSS viewport to stop changing. Do not require it to equal the
      // requested size: a CI display smaller than the window (xvfb-run's
      // default screen) clamps the content size, and the measurements below
      // are relative to whatever viewport the window actually has.
      await waitForDom(js, `document.querySelectorAll('.import-board-body input[name="session-rel"]').length === 6`);
      await waitForStableViewport(zoom);
      for (const expanded of [false, true]) {
        await js(`document.querySelector('.import-scope-detail').open = ${expanded}`);
        const measured = await js(`(() => {
          const body = document.querySelector('.import-board-body');
          const inputs = [...body.querySelectorAll('input[type=checkbox]')];
          const controls = [...inputs, document.querySelector('#btn-import')];
          const reachable = controls.map(el => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
            const hit = document.elementFromPoint(x, y);
            return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && (hit === el || el.contains(hit) || !!el.closest('label')?.contains(hit));
          });
          return { bodyHeight: body.getBoundingClientRect().height, items: inputs.length, reachable };
        })()`);
        cases.push({ scheme, width, height, zoom, expanded, ...measured });
        if (evidence && width === 860 && zoom === 1.25 && !expanded) {
          await js("document.querySelector('main').scrollTop = 0");
          fs.writeFileSync(path.join(evidence, `import-${scheme}-125.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        }
      }
    }
  }
  await js("document.querySelector('[data-tab=home]').click(); document.querySelector('#home-recovery').hidden = false");
  const heading = await js("(() => { const s = getComputedStyle(document.querySelector('.recovery-head h3')); return [s.fontSize, s.lineHeight]; })()");
  const dialogs = [];
  let dialogSeq = 0;
  for (const zoom of [1, 1.5, 2]) {
    win.webContents.setZoomFactor(zoom);
    // Do not require innerWidth * zoom to equal win.getContentSize(): on Linux
    // Xvfb, viewport clamping or rounding at fractional zoom (1.5x) makes the
    // CSS viewport differ from the content size, just like the import tab.
    await waitForStableViewport(zoom);
    for (const text of ['更新说明\n'.repeat(120).slice(0, 600), '诊断内容 connection interrupted\n'.repeat(100)]) {
      const dialogId = `layout-test-${++dialogSeq}`;
      win.webContents.send('shell:app-confirm', { id: dialogId, title: '确认更新', body: text, confirmText: '继续', cancelText: '取消' });
      await waitForDom(js, `!document.getElementById('app-confirm').hidden
        && document.getElementById('app-confirm-body').textContent === ${JSON.stringify(text)}
        && Math.abs(devicePixelRatio - ${baseDpr * zoom}) < ${0.05 * baseDpr}`);
      dialogs.push(await js(`(() => {
        const body = document.querySelector('.modal-body');
        return { zoom: ${zoom}, length: ${text.length}, bodyHeight: body.clientHeight, buttons: ['app-confirm-ok', 'app-confirm-cancel'].map(id => {
          const el = document.getElementById(id), r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.top >= 0 && r.bottom <= innerHeight && (hit === el || el.contains(hit));
        }) };
      })()`));
      if (evidence && zoom === 1.5) fs.writeFileSync(path.join(evidence, `confirm-${text.length}-150.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      // Dismiss each modal cleanly before sending the next one so the confirm
      // IPC response path settles between cases instead of racing a fresh modal.
      await js("document.getElementById('app-confirm-cancel').click()");
      await waitForDom(js, "document.getElementById('app-confirm').hidden === true");
    }
  }
  const result = { diagnostics, cases, heading, dialogs, feedbackSurfaces };
  if (evidence) fs.writeFileSync(path.join(evidence, 'layout.json'), JSON.stringify(result, null, 2));
  process.stdout.write('LAYOUT_RESULT:' + JSON.stringify(result) + '\n');
  win.destroy();
  app.exit(0);
}).catch((error) => { process.stderr.write(String(error.stack)); app.exit(1); });
