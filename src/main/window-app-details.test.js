'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { windowsAppDetails, applyWindowsAppDetails } = require('./window-app-details');

const sourceOptions = {
  isPackaged: false,
  execPath: 'C:\\开发 目录\\electron.exe',
  appPath: 'C:\\开发 目录\\Whale Isle',
  iconPath: 'C:\\开发 目录\\Whale Isle\\assets\\icon.ico',
};

test('source taskbar relaunch quotes only executable and absolute application path', () => {
  const details = windowsAppDetails({ ...sourceOptions, argv: ['--session=private', '--auth-token=private', '--qa'] });
  assert.equal(details.relaunchCommand, '"C:\\开发 目录\\electron.exe" "C:\\开发 目录\\Whale Isle"');
  assert.equal(details.appIconPath, sourceOptions.iconPath);
  assert.equal(details.appIconIndex, 0);
  assert.equal(details.relaunchDisplayName, 'Whale Isle');
  assert.equal(details.appId, require('../../package.json').build.appId);
});

test('packaged taskbar relaunch keeps the installed desktop and slim identities', () => {
  for (const launcher of [false, true]) {
    const details = windowsAppDetails({ ...sourceOptions, launcher, isPackaged: true });
    assert.equal(details.relaunchCommand, '"C:\\开发 目录\\electron.exe"');
    assert.equal(details.appIconPath, sourceOptions.execPath);
    assert.equal(details.appIconIndex, 0);
    assert.equal(details.relaunchDisplayName, launcher ? 'Whale Isle Launcher' : 'Whale Isle');
    assert.equal(details.appId, launcher ? 'ai.deepseek.harness.launcher' : 'ai.deepseek.harness.gui');
  }
});

test('packaged Shell icons never use the ASAR virtual asset path', () => {
  const details = windowsAppDetails({
    ...sourceOptions,
    isPackaged: true,
    execPath: 'C:\\软件\\Whale Isle\\Whale Isle.exe',
    iconPath: 'C:\\软件\\Whale Isle\\resources\\app.asar\\assets\\icon.ico',
  });
  assert.equal(details.appIconPath, 'C:\\软件\\Whale Isle\\Whale Isle.exe');
  assert.equal(details.relaunchCommand, '"C:\\软件\\Whale Isle\\Whale Isle.exe"');
});

test('quoted source application paths preserve trailing backslashes', () => {
  const details = windowsAppDetails({ ...sourceOptions, appPath: 'C:\\' });
  assert.equal(details.relaunchCommand, '"C:\\开发 目录\\electron.exe" "C:\\\\"');
});

function shellFactoryFixture({ platform, launcher, isPackaged }) {
  const source = fs.readFileSync(path.join(__dirname, 'window.js'), 'utf8').replace(/\r\n/g, '\n');
  const attach = source.slice(source.indexOf('function attachWindowsAppDetails'), source.indexOf('function createMainWindow'));
  const main = source.slice(source.indexOf('function createMainWindow'), source.indexOf('/**\n * Pin a privileged'));
  const launcherFactory = source.slice(source.indexOf('function createLauncherWindow'), source.indexOf('/** Create or reuse the launcher'));
  const boot = source.slice(source.indexOf('function showBoot'), source.indexOf('function showHarness'));
  const showMain = source.slice(source.indexOf('function showMain'), source.indexOf('/** Tear down the desktop shell window'));
  const events = [];
  const showCalls = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = {};
      this.minimized = false;
      events.push('construct');
    }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    setAppDetails(details) {
      // Model Chromium's ID-first write and the refresh it triggers.
      if (details.appId) {
        this.details = { ...this.details, appId: details.appId };
        this.refresh = { ...this.details };
        events.push('identity');
      } else {
        events.push('relaunch');
      }
      this.details = { ...this.details, ...details };
    }
    loadFile() { return Promise.resolve(); }
    show() { events.push('show'); showCalls.push('show'); }
    showInactive() { showCalls.push('show-inactive'); }
    restore() { this.minimized = false; showCalls.push('restore'); }
    focus() { showCalls.push('focus'); }
  }
  const api = vm.runInNewContext(`let mainWindow = null, launcherWindow = null;\nfunction getMainWindow() { return mainWindow; }\n${attach}\n${main}\n${boot}\n${showMain}\n${launcherFactory}\n({ createMainWindow, createLauncherWindow, showBoot, showMain, showLauncher })`, {
    app: { isPackaged, getAppPath: () => sourceOptions.appPath },
    process: { platform, execPath: sourceOptions.execPath, argv: ['--auth-token=private', '--qa'] },
    require: () => ({ isLauncherPackage: () => launcher }),
    applyWindowsAppDetails,
    assetFile: () => sourceOptions.iconPath,
    iconImage: () => 'whale-icon',
    BrowserWindow: Window,
    shellWindowChrome: options => options,
    markWindowTransparent() {},
    attachIntegratedChrome() { events.push('chrome'); },
    hideNativeMenu() {},
    attachPrivilegedNavigationGuards() {},
    attachRendererRecovery() {},
    isLocalAppNavigationUrl: () => true,
    isLauncherNavigationUrl: () => true,
    isLauncherLoaded: () => false,
    rendererFile: name => name,
    preloadFile: () => 'isolated-preload.js',
    hideHarnessView() {},
    isBootLoaded: () => false,
    paintBackground() {},
    currentTheme: () => ({ bg: '#151517' }),
  });
  return { api, events, showCalls };
}

for (const launcher of [false, true]) {
  for (const isPackaged of [false, true]) {
    test(`Windows ${launcher ? 'slim' : 'desktop'} ${isPackaged ? 'package' : 'source'} shell windows declare identity before show`, async () => {
      const { api, events } = shellFactoryFixture({ platform: 'win32', launcher, isPackaged });
      const main = api.createMainWindow();
      assert.deepEqual(events, ['construct', 'relaunch', 'identity', 'chrome']);
      main.emit('ready-to-show');
      assert.deepEqual(events, ['construct', 'relaunch', 'identity', 'chrome', 'show']);
      assert.equal(api.createMainWindow(), main, 'reuse retains the already declared identity');
      const expected = windowsAppDetails({ ...sourceOptions, launcher, isPackaged });
      assert.deepEqual(main.details, expected);
      assert.deepEqual(main.refresh, expected, 'all branding exists at the ID-triggered refresh');
      events.length = 0;
      const launch = await api.showLauncher();
      assert.deepEqual(events, ['construct', 'relaunch', 'identity', 'chrome', 'show']);
      assert.deepEqual(launch.details, expected);
      assert.deepEqual(launch.refresh, expected);
      assert.equal(main.options.show, false);
      assert.equal(launch.options.show, false);
    });
  }
}

test('other platform shell windows do not call the Windows-only API', async () => {
  for (const platform of ['linux', 'darwin']) {
    const { api, events } = shellFactoryFixture({ platform, launcher: false, isPackaged: false });
    api.createMainWindow().emit('ready-to-show');
    await api.showLauncher();
    assert.equal(events.includes('relaunch') || events.includes('identity'), false);
    assert.equal(events.filter(event => event === 'show').length, 2);
  }
});

test('background boot and launcher show inactive without restore or focus; explicit opening keeps normal activation', async () => {
  const { api, showCalls } = shellFactoryFixture({ platform: 'win32', launcher: false, isPackaged: false });
  await api.showBoot({ activate: false });
  const main = api.createMainWindow();
  main.emit('ready-to-show');
  assert.deepEqual(showCalls, ['show-inactive']);
  main.minimized = true;
  api.showMain({ activate: false });
  assert.deepEqual(showCalls, ['show-inactive', 'show-inactive']);
  api.showMain();
  assert.deepEqual(showCalls.slice(2), ['restore', 'show', 'focus']);

  showCalls.length = 0;
  const launcher = await api.showLauncher({ activate: false });
  launcher.minimized = true;
  await api.showLauncher({ activate: false });
  assert.deepEqual(showCalls, ['show-inactive', 'show-inactive']);
  await api.showLauncher();
  assert.deepEqual(showCalls.slice(2), ['restore', 'show', 'focus']);
});

test('main ready-to-show uses the explicit creation activation option', () => {
  for (const activate of [true, false]) {
    const { api, showCalls } = shellFactoryFixture({ platform: 'win32', launcher: false, isPackaged: false });
    api.createMainWindow({ activate }).emit('ready-to-show');
    assert.deepEqual(showCalls, [activate ? 'show' : 'show-inactive']);
  }
});
