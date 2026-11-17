// Real Electron window factories, isolated from the user's app/profile and Harness.
const { app, BrowserWindow, screen } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
const { createSupervisedDir, startDirCleanupSupervisor } = require('./lib/owned-dir-supervisor.cjs');
// Electron userData 被 Chromium 持有至 app.exit，本进程 finally 无法回收；
// 交给共享的 detached cleanup supervisor 在宿主退出后按归属标记回收。
const profile = createSupervisedDir({ prefix: 'dsh-window-motion-', receiptPrefix: 'dsh-window-motion-cleanup-' });
const userData = profile.root;
app.setPath('userData', userData);
startDirCleanupSupervisor(profile);
app.on('window-all-closed', () => {});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(25);
  assert.ok(predicate(), label);
}
app.whenReady().then(async () => {
  const windows = require('../src/main/window');
  const { rendererFile } = require('../src/main/paths');
  const composed = process.argv.includes('--composed');
  // Composed-mode evidence must outlive the run: the supervised userData is
  // removed after exit, so the default lands in the repo's explicit .tmp
  // output area instead of the system temp directory.
  const evidence = path.resolve(process.argv.find(arg => arg.startsWith('--evidence-dir='))?.slice('--evidence-dir='.length) || path.join(__dirname, '..', '.tmp', 'qa-window-motion', 'composed-corners'));
  let stage;
  let focusSink;
  if (composed) {
    fs.mkdirSync(evidence, { recursive: true });
    stage = new BrowserWindow({ ...screen.getPrimaryDisplay().workArea, frame: false, focusable: false, skipTaskbar: true, backgroundColor: '#d020d0' });
    stage.setAlwaysOnTop(true, 'screen-saver');
    await stage.loadURL('data:text/html,<body style="background:%23d020d0"></body>');
    stage.show();
    const area = screen.getPrimaryDisplay().workArea;
    focusSink = new BrowserWindow({ x: area.x + area.width - 80, y: area.y + area.height - 80, width: 64, height: 64,
      frame: false, show: false, skipTaskbar: true, backgroundColor: '#d020d0' });
    focusSink.setAlwaysOnTop(true, 'screen-saver');
    await focusSink.loadURL('data:text/html,<body style="background:%23d020d0"></body>');
    console.log(`Composed desktop corner evidence: ${evidence}`);
  }
  async function checkComposed(win, label) {
    if (!composed) return;
    await delay(350);
    const result = await exec('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'probe-window-corners.ps1'),
      '-WindowHandle', String(win.getNativeWindowHandle().readBigUInt64LE()), '-OutputPath', path.join(evidence, `${label}.png`)], { encoding: 'utf8', windowsHide: true });
    const pixels = JSON.parse(result.stdout);
    fs.writeFileSync(path.join(evidence, `${label}.json`), JSON.stringify(pixels, null, 2));
    assert.equal(pixels.filter(p => p.kind === 'cutout').length, 20);
    assert.equal(pixels.filter(p => p.kind === 'inside').length, 4);
    assert.ok(pixels.filter(p => p.kind === 'cutout').every(p => p.delta <= 24), `${label}: composed four corners must not contain a native rectangle`);
    assert.ok(pixels.filter(p => p.kind === 'inside').every(p => p.delta > 24), `${label}: test window must be visible, not hidden behind the backdrop`);
    console.log(`PASS ${label}: composed four-corner cutouts + visible interior`);
  }
  for (const [name, factory, page] of [
    ['main', windows.createMainWindow, 'boot.html'],
    ['launcher', windows.createLauncherWindow, 'launcher.html'],
  ]) {
    const win = factory();
    await win.loadFile(rendererFile(page));
    if (composed) win.setAlwaysOnTop(true, 'screen-saver');
    win.show();
    const native = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File',
      path.join(__dirname, 'probe-window-motion.ps1'), '-WindowHandle',
      String(win.getNativeWindowHandle().readBigUInt64LE())], { encoding: 'utf8', windowsHide: true }));
    console.log(`${name}: ${JSON.stringify(native)}`);
    assert.ok(native.caption, `${name}: WS_CAPTION required for native window transitions`);
    assert.ok(native.thickFrame, `${name}: WS_THICKFRAME required for native window transitions`);
    assert.equal(native.layered, false, `${name}: shell must not be a layered window`);
    assert.ok(native.dwmReadOk, `${name}: must inspect the composed native frame`);
    assert.equal(native.nonClientRendering, false, `${name}: no DWM rectangle outside the page silhouette`);
    win.setBounds({ x: 80, y: 80, width: 1000, height: 700 });
    await delay(300);
    const appearance = await win.webContents.executeJavaScript(`({
      radius: getComputedStyle(document.querySelector('${name === 'main' ? '.scene' : '.shell'}')).borderTopLeftRadius,
      hairlinePixels: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-window-hairline')) * devicePixelRatio,
    })`);
    assert.equal(appearance.radius, '20px', `${name}: preserve the project silhouette alongside native motion`);
    assert.ok(Math.abs(appearance.hairlinePixels - 1) < 0.002, `${name}: silhouette ring must be one physical pixel`);
    const corner = await win.webContents.capturePage({ x: 0, y: 0, width: 30, height: 30 });
    const size = corner.getSize();
    const pixels = corner.toBitmap();
    const alpha = (x, y) => pixels[(Math.floor(y * size.height / 30) * size.width + Math.floor(x * size.width / 30)) * 4 + 3];
    assert.equal(alpha(3, 3), 0, `${name}: 20px corner cutout must be truly transparent (8px system corner is insufficient)`);
    assert.ok(alpha(20, 20) > 240, `${name}: inside the corner must remain painted`);
    const coverage = new Set();
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0 && pixels[i] < 255) coverage.add(pixels[i]);
    assert.ok(coverage.size >= 8, `${name}: preserve alpha antialiasing rather than a binary corner mask`);
    await checkComposed(win, `${name}-active`);
    if (composed) {
      focusSink.show();
      focusSink.focus();
      await until(() => !win.isFocused(), `${name}: focus moved to isolated QA target`);
      win.moveTop(); // Keep the inactive window above the QA backdrop without activating it.
      assert.equal(win.isFocused(), false, `${name}: inactive-window scenario`);
      await checkComposed(win, `${name}-inactive`);
      focusSink.hide();
      win.focus();
      win.setBounds({ x: 100, y: 100, width: 1050, height: 740 });
      await checkComposed(win, `${name}-resized`);
    }
    const normal = win.getBounds();
    // Drive the actual preload -> authorized IPC route, not a fake geometry helper.
    await win.webContents.executeJavaScript("window.shell.windowAction('maximize')");
    try {
      await until(() => win.isMaximized(), `${name}: must enter native maximized state (transparent-window regression)`);
    } catch (error) {
      console.error('Maximize failure context:', { bounds: win.getBounds(), display: screen.getDisplayMatching(win.getBounds()).workArea,
        native: execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'probe-window-motion.ps1'),
          '-WindowHandle', String(win.getNativeWindowHandle().readBigUInt64LE())], { encoding: 'utf8', windowsHide: true }).trim() });
      throw error;
    }
    const maximizedNative = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, 'probe-window-motion.ps1'),
      '-WindowHandle', String(win.getNativeWindowHandle().readBigUInt64LE())], { encoding: 'utf8', windowsHide: true }));
    assert.equal(maximizedNative.nativeZoomed, true, `${name}: Windows IsZoomed must confirm actual maximization, not work-area geometry`);
    await win.webContents.executeJavaScript("window.shell.windowAction('maximize')");
    await until(() => !win.isMaximized(), `${name}: native unmaximize`);
    assert.deepEqual(win.getBounds(), normal, `${name}: restore normal bounds`);
    await win.webContents.executeJavaScript("window.shell.windowAction('minimize')");
    await until(() => win.isMinimized(), `${name}: native minimize`);
    win.restore();
    await until(() => !win.isMinimized(), `${name}: taskbar-style restore`);
    assert.deepEqual(win.getBounds(), normal, `${name}: minimize/restore bounds`);
    const after = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-File',
      path.join(__dirname, 'probe-window-motion.ps1'), '-WindowHandle',
      String(win.getNativeWindowHandle().readBigUInt64LE())], { encoding: 'utf8', windowsHide: true }));
    assert.ok(after.caption && after.thickFrame, `${name}: motion styles must survive transitions`);
    assert.ok(after.dwmReadOk && !after.nonClientRendering, `${name}: DWM rectangle must remain suppressed after transitions`);
    await checkComposed(win, `${name}-restored`);
    console.log(`PASS ${name}: 20px alpha corners AND native maximize/unmaximize/minimize/restore through production factories + IPC`);
    win.destroy();
  }
  stage?.destroy();
  focusSink?.destroy();
  console.log('Native state verified; visible DWM interpolation still requires interactive Windows QA.');
}).then(() => app.exit(0)).catch(error => {
  console.error(error);
  for (const win of BrowserWindow.getAllWindows()) win.destroy();
  app.exit(1);
});
