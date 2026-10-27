'use strict';

// Deliberately independent of product modules, config, credentials and history.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const output = process.env.WINDOWS_STARTUP_PROBE_OUTPUT;
if (!output) throw new Error('Run with scripts/diagnose-windows-startup.py');
const events = [];
function record(event, details = {}) {
  events.push({ event, at: new Date().toISOString(), ...details });
  fs.writeFileSync(path.join(output, 'events.json'), `${JSON.stringify(events, null, 2)}\n`);
}
record('js-entry', { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome });
app.setPath('userData', path.join(output, 'profile'));
app.whenReady().then(async () => {
  record('ready');
  const win = new BrowserWindow({
    width: 560,
    height: 340,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.on('render-process-gone', (_event, details) => record('render-process-gone', details));
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html><head><title>Electron startup probe</title></head><body style="font:20px system-ui;padding:28px"><h1>Minimal GUI ready</h1><p>No product resources or user configuration loaded.</p></body></html>')}`);
  win.showInactive();
  record('did-finish-load', { visible: win.isVisible() });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, 'window.png'), image.toPNG());
  record('captured', image.getSize());
  win.destroy();
  app.quit();
}).catch(error => {
  record('error', { message: error.message });
  app.exit(1);
});
setTimeout(() => { record('timeout'); app.exit(2); }, 15000).unref();
