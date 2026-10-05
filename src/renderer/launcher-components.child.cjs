'use strict';

// Production launcher window, preload and authorized IPC with real component
// processes. Only user data and the existing sample catalog are isolated.
const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-launcher-components-'));
const userData = path.join(root, 'user-data');
const appData = path.join(root, 'app-data');
for (const directory of [userData, appData]) fs.mkdirSync(directory);
app.setPath('userData', userData);
app.setPath('appData', appData);
process.env.DSHD_LAUNCHER_PACKAGE = '1';
const desktopHome = path.join(appData, 'Deepseek-Harness-Desktop', 'dsh-home');
fs.mkdirSync(desktopHome, { recursive: true });
require('../shared/dsh-home').setDesktopDshHome(desktopHome);
const catalog = path.join(root, 'catalog');
fs.cpSync(path.join(__dirname, '../../tests/fixtures/components'), catalog, { recursive: true });
const second = path.join(catalog, 'second-tool', '1.0.0');
fs.mkdirSync(second, { recursive: true });
fs.writeFileSync(path.join(second, 'manifest.json'), JSON.stringify({ id: 'second-tool', name: '第二个工具', version: '1.0.0', entry: 'tool.js', kind: 'tool', description: '选择切换用的独立工具' }));
fs.writeFileSync(path.join(second, 'tool.js'), 'setInterval(() => {}, 60000);');
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({ autoStartDesktop: false, askOnUpdate: false, quitAfterStart: false, downloadRoute: 'github' }));
const components = require('../main/ipc-components');
components._configureForTest({ userDataDir: userData, samplesRoot: catalog });
const { registerSlimIpc } = require('../main-launcher/ipc');
const { prepareLauncher } = require('../main/window');
let win;
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (source) => win.webContents.executeJavaScript(source);
async function wait(source) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await js(source)) return;
    await delay(50);
  }
  throw new Error(`UI did not settle: ${source}\n${JSON.stringify(await js("({ detail: document.querySelector('[data-comp-detail]').textContent, hint: document.querySelector('[data-comp-hint]').textContent })"))}`);
}
async function action(name) {
  await js(`document.querySelector('[data-comp-action="${name}"]').click()`);
}
async function confirm(name, accept) {
  await js("document.querySelector('.more-operations').open = true");
  await action(name);
  await wait("!document.getElementById('app-confirm').hidden");
  await js(`document.getElementById('app-confirm-${accept ? 'ok' : 'cancel'}').click()`);
}
async function capture(name) {
  if (!process.env.DSHD_COMPONENT_EVIDENCE_DIR) return;
  fs.mkdirSync(process.env.DSHD_COMPONENT_EVIDENCE_DIR, { recursive: true });
  await js("document.querySelector('main').scrollTop = 0");
  await delay(100);
  fs.writeFileSync(path.join(process.env.DSHD_COMPONENT_EVIDENCE_DIR, name), (await win.webContents.capturePage()).toPNG());
}

app.whenReady().then(async () => {
  try {
    registerSlimIpc();
    win = await prepareLauncher();
    win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    await wait("document.querySelectorAll('[data-comp-select]').length === 2");
    assert.equal(await js("document.querySelectorAll('.overview-row').length"), 2);
    await capture('home-light.png');
    await js("document.querySelector('[data-tab=components]').click()");
    // Install the old version through the production IPC as update prerequisite.
    assert.equal((await js("window.shell.componentsInstall({ id: 'launcher-notes', version: '1.0.0' })")).ok, true);
    await js("document.querySelector('[data-comp-refresh]').click()");
    await wait("!!document.querySelector('[data-comp-action=update]')");
    await action('update');
    await wait("document.querySelector('.component-metadata').textContent.includes('2.0.0') && !document.querySelector('[data-comp-action=update]') && !document.querySelector('[data-comp-action=start]').disabled");
    await action('start');
    await wait("document.querySelector('[data-comp-action=start]')?.disabled === true");
    assert.equal(await js("document.getElementById('btn-install-runtime').disabled"), false, 'component operation does not lock desktop installation');
    await js("document.querySelector('[data-comp-select=second-tool]').click(); document.querySelector('[data-comp-select=launcher-notes]').click()");
    assert.equal(await js("document.querySelector('[data-comp-action=start]').disabled"), true);
    assert.ok(await js("document.querySelector('[data-comp-progress]').textContent.length > 0"));
    await wait("!!document.querySelector('[data-comp-action=stop]') && !document.querySelector('[data-comp-action=stop]').disabled");
    let rows = await js('window.shell.componentsList()');
    let note = rows.components.find((row) => row.id === 'launcher-notes');
    assert.equal((await (await fetch(note.url)).json()).version, '2.0.0');
    assert.ok(await js("document.querySelector('.component-metadata').textContent.includes('进程 PID') && document.querySelector('.component-metadata').textContent.includes('http://127.0.0.1:')"));
    await capture('components-light.png');
    const layouts = [];
    for (const dark of [false, true]) {
      await js(`document.documentElement.toggleAttribute('data-ds-dark-theme', ${dark})`);
      for (const [width, height, zoom] of [[1060,660,1], [860,560,1.25], [860,560,2]]) {
        win.setContentSize(width, height);
        win.webContents.setZoomFactor(zoom);
        layouts.push(await js(`(() => {
          const reachable = ['[data-comp-select=second-tool]', '[data-comp-action=stop]', '.more-operations summary'].map(selector => {
            const el = document.querySelector(selector); el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return hit === el || el.contains(hit);
          });
          return { dark: ${dark}, width: ${width}, zoom: ${zoom}, reachable, overflow: document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth };
        })()`));
        if (dark && zoom === 1.25) await capture('components-dark-125.png');
      }
    }
    assert.ok(layouts.every((layout) => layout.reachable.every(Boolean) && !layout.overflow), JSON.stringify(layouts));
    win.setContentSize(1060,660);
    win.webContents.setZoomFactor(1);
    await confirm('rollback', false);
    assert.equal((await js('window.shell.componentsList()')).components[0].installedVersion, '2.0.0');
    await confirm('rollback', true);
    await wait("!!document.querySelector('[data-comp-action=stop]') && !document.querySelector('[data-comp-action=stop]').disabled && document.querySelector('.component-metadata').textContent.includes('已安装版本v1.0.0')");
    note = (await js('window.shell.componentsList()')).components.find((row) => row.id === 'launcher-notes');
    assert.equal((await (await fetch(note.url)).json()).version, '1.0.0');
    await action('stop');
    await wait("!!document.querySelector('[data-comp-action=start]') && !document.querySelector('[data-comp-action=start]').disabled");
    await confirm('uninstall', false);
    assert.ok((await js('window.shell.componentsList()')).components[0].installedVersion);
    await confirm('uninstall', true);
    await wait("!!document.querySelector('[data-comp-action=install]') && !document.querySelector('[data-comp-action=install]').disabled");
    assert.ok(fs.existsSync(path.join(userData, 'components/launcher-notes/data/state.json')), 'uninstall preserves component data');
    await action('install');
    await wait("!!document.querySelector('[data-comp-action=start]') && !document.querySelector('[data-comp-action=start]').disabled");
    const entry = path.join(userData, 'components/launcher-notes/versions/2.0.0/notes.js');
    fs.renameSync(entry, entry + '.removed');
    await action('start');
    await wait("!document.querySelector('[data-comp-action=start]').disabled && document.querySelector('[data-comp-hint]').textContent.includes('缺失')");
    await js("document.querySelector('[data-comp-select=second-tool]').click(); document.querySelector('[data-comp-select=launcher-notes]').click(); document.querySelector('[data-comp-refresh]').click()");
    await wait("document.querySelector('[data-comp-progress]').textContent.includes('缺失')");
    assert.equal(await js("document.querySelector('[data-comp-select=launcher-notes]').getAttribute('aria-pressed')"), 'true');
    assert.deepEqual(errors, []);
    console.log('COMPONENT_RESULT:' + JSON.stringify({ realHttpVersions: ['2.0.0','1.0.0'], layouts, dataPreserved: true, pendingPreserved: true, errorPreserved: true, rendererErrors: errors }));
    app.quit();
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
    app.quit();
  }
});
