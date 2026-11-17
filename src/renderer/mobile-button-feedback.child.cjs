'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { waitForDom } = require('./fixture-wait.cjs');
const temporary = process.argv[2];
app.setPath('userData', path.join(temporary, 'profile'));
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 390, height: 800, useContentSize: true, frame: false, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
  const js = source => win.webContents.executeJavaScript(source);
  try {
    const cases = [];
    for (const width of [320, 390]) {
      for (const preference of ['no-preference', 'reduce']) {
        win.setContentSize(width, 800);
        await win.loadFile(path.join(__dirname, '../../mobile/web/ui/button-busy.fixture.html'));
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: preference }] });
        await waitForDom(js, 'window.fixtureReady === true', 3000);
        const result = await js('window.runButtonBusyFixture()');
        cases.push(result);
        win.webContents.debugger.detach();
      }
    }
    console.log('MOBILE_BUTTON_RESULT:' + JSON.stringify(cases));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
    app.exit(process.exitCode || 0);
  }
}).catch(error => { console.error(error); app.exit(1); });
