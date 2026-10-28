'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadMenu(platform, shortcuts) {
  const calls = [];
  let applicationMenu;
  let dockMenu;
  const modules = {
    electron: {
      Menu: {
        buildFromTemplate: template => template,
        setApplicationMenu: menu => { applicationMenu = menu; },
      },
      app: {
        name: 'Whale Isle',
        // Non-Mac platforms have no Dock API.
        ...(platform === 'darwin' ? { dock: { setMenu: menu => { dockMenu = menu; } } } : {}),
      },
      shell: {
        openPath: target => calls.push(['openPath', target]),
        openExternal: target => calls.push(['openExternal', target]),
      },
    },
    './window': {
      openHarnessSettings: section => calls.push(['settings', section]),
      openMarketplace: () => calls.push(['marketplace']),
    },
    './config': { loadConfig: () => ({ workspace: '/workspace/project' }) },
  };
  const context = {
    require: id => {
      assert.ok(id in modules, `Unexpected dependency: ${id}`);
      return modules[id];
    },
    process: { platform },
    module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'menu.js'), 'utf8'), context);
  context.module.exports.buildMenu({
    onOpenWorkspace: () => calls.push(['workspace']),
    onOpenLauncher: () => calls.push(['launcher']),
    onRestart: () => calls.push(['restart']),
    onReload: () => calls.push(['reload']),
    shortcuts,
  });
  return { applicationMenu, dockMenu, calls };
}

test('macOS exposes native application, editing and window menus', () => {
  const { applicationMenu: menu, dockMenu, calls } = loadMenu('darwin');
  const app = menu.find(item => item.label === 'Whale Isle');
  for (const role of ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']) {
    assert.ok(app.submenu.some(item => item.role === role), role);
  }
  const settings = app.submenu.find(item => item.label === '设置…');
  assert.equal(settings.accelerator, 'CmdOrCtrl+,');
  settings.click();
  assert.deepEqual(calls.pop(), ['settings', undefined]);
  const file = menu.find(item => item.label === '文件');
  assert.equal(file.submenu.some(item => item.label === '设置…'), false);
  assert.equal(file.submenu.at(-1).role, 'close');
  file.submenu.find(item => item.label === '在 Finder 中打开工作区').click();
  assert.deepEqual(calls.pop(), ['openPath', '/workspace/project']);
  assert.ok(menu.some(item => item.role === 'editMenu'));
  const window = menu.find(item => item.role === 'windowMenu');
  for (const role of ['minimize', 'zoom', 'front']) {
    assert.ok(window.submenu.some(item => item.role === role), role);
  }
  dockMenu[0].click();
  dockMenu[1].click();
  assert.deepEqual(calls, [['workspace'], ['launcher']]);
});

test('Mac settings keep registry dispatch and do not restore an unbound accelerator', () => {
  for (const bound of [true, false]) {
    const dispatched = [];
    const { applicationMenu, calls } = loadMenu('darwin', {
      currentRevision: () => 4,
      acceleratorFor: id => bound && id === 'settings.open' ? 'Command+Alt+S' : undefined,
      dispatchMenuCommand: id => { dispatched.push(id); return true; },
    });
    const settings = applicationMenu[0].submenu.find(item => item.label === '设置…');
    assert.equal(settings.accelerator, bound ? 'Command+Alt+S' : undefined);
    settings.click();
    assert.deepEqual(dispatched, ['settings.open']);
    assert.deepEqual(calls, []);
  }
});

for (const platform of ['win32', 'linux']) {
  test(`${platform} keeps the existing menu without Mac-only roles or Dock calls`, () => {
    const { applicationMenu: menu, dockMenu, calls } = loadMenu(platform);
    assert.equal(dockMenu, undefined);
    assert.equal(menu.some(item => ['editMenu', 'windowMenu'].includes(item.role)), false);
    assert.equal(menu.some(item => item.label === 'Whale Isle'), false);
    const file = menu.find(item => item.label === '文件');
    assert.equal(file.submenu.at(-1).role, 'quit');
    file.submenu.find(item => item.label === '设置…').click();
    assert.deepEqual(calls.pop(), ['settings', undefined]);
    assert.ok(file.submenu.some(item => item.label === '在资源管理器中打开工作区'));
  });
}
