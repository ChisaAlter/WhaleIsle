const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rendererDir = __dirname;
const html = fs.readFileSync(path.join(rendererDir, 'launcher.html'), 'utf8');
const css = fs.readFileSync(path.join(rendererDir, 'launcher.css'), 'utf8');
const themeSrc = fs.readFileSync(path.join(rendererDir, 'theme.js'), 'utf8');

test('launcher.html is an official shell, not the boot canvas', () => {
  assert.match(html, /data-shell-theme="official"/);
  assert.match(html, /dsh-webui-tokens\.css/);
  assert.match(html, /src="theme\.js"/);
  assert.doesNotMatch(html, /data-boot-theme/);
  assert.doesNotMatch(html, /boot-tokens\.css/);
});

test('launcher.css uses official tokens with no second palette', () => {
  assert.match(css, /var\(--dsw-alias-bg-base\)/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}/);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.doesNotMatch(css, /\[data-theme\]/);
  assert.doesNotMatch(css, /--boot-/);
});

function loadApplyTheme(htmlAttrs) {
  const attrs = { ...htmlAttrs };
  const rootVars = new Map();
  const bodyVars = new Map();
  const document = {
    documentElement: {
      getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
      hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
      toggleAttribute(name, on) {
        if (on) attrs[name] = '';
        else delete attrs[name];
      },
      style: {
        setProperty(name, value) { rootVars.set(name, value); },
        removeProperty(name) { rootVars.delete(name); },
        colorScheme: '',
      },
    },
    body: {
      toggleAttribute() {},
      style: {
        setProperty(name, value) { bodyVars.set(name, value); },
        removeProperty(name) { bodyVars.delete(name); },
      },
    },
  };
  const sandbox = { document, window: {}, console };
  vm.runInNewContext(`${themeSrc}\nthis.applyTheme = applyTheme;`, sandbox);
  return { applyTheme: sandbox.applyTheme, rootVars, bodyVars, attrs };
}

test('theme.js clears wallpaper seeds on official shells and still sets dark attribute', () => {
  const { applyTheme, rootVars, bodyVars, attrs } = loadApplyTheme({ 'data-shell-theme': 'official' });
  applyTheme({
    scheme: 'dark',
    bg: '#14100b',
    fg: '#e7f6f1',
    muted: '#8a9a94',
    accent: '#3dd6b5',
    line: '#2a3a34',
  });
  assert.ok(Object.prototype.hasOwnProperty.call(attrs, 'data-ds-dark-theme'));
  assert.equal(rootVars.get('--dsw-alias-bg-base'), undefined);
  assert.equal(bodyVars.get('background'), undefined);
});

test('theme.js still paints wallpaper seeds on ordinary shells', () => {
  const { applyTheme, rootVars } = loadApplyTheme({});
  applyTheme({ scheme: 'light', bg: '#f3efe6', fg: '#1a1714' });
  assert.equal(rootVars.get('--dsw-alias-bg-base'), '#f3efe6');
});

test('launcher.js does not redeclare the preload shell binding', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.doesNotMatch(js, /function\s+shell\s*\(/);
  assert.match(js, /function\s+pageShell\s*\(/);
});

test('launcher import pane lists sessions skills plugins and MCP without dumping JSON', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.match(html, /id="import-sessions"/);
  assert.match(html, /id="import-skills"/);
  assert.match(html, /id="import-plugins"/);
  assert.match(html, /id="import-mcp"/);
  assert.match(html, /id="btn-pick-skill"/);
  assert.match(html, /data-import-cat/);
  assert.match(html, /class="import-foot"/);
  assert.match(html, /id="btn-import"/);
  assert.match(js, /selectedSkillIds/);
  assert.match(js, /pickSkillDir/);
  assert.match(js, /showImportCat/);
  assert.match(js, /sessionGroupKey/);
  assert.match(js, /sessionGroupLabel/);
  assert.match(js, /setSessionGroupExpanded/);
  assert.match(js, /data-import-fold/);
  assert.match(js, /IMPORT_COLLAPSE_AT/);
  assert.match(css, /\.import-fold/);
  assert.match(css, /\.import-list li\[hidden\]/);
  assert.doesNotMatch(js, /JSON\.stringify\(result/);
});

test('launcher import rescan preserves selections and shows scan feedback', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.match(html, /id="installed-uninstall-note"/);
  assert.match(html, /id="btn-scan"/);
  assert.match(js, /captureImportSelections/);
  assert.match(js, /captureSessionFoldState/);
  assert.match(js, /launcherButtonBusy\(btn, '正在扫描…'\)/);
  assert.match(js, /appNotice\(\{ title: '扫描完成'/);
  assert.doesNotMatch(html, /id="import-scan-status"/);
  assert.match(js, /importListRendered/);
});

test('launcher rail footer route chip opens the shared route popover', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.match(html, /id="rail-route-btn"/);
  assert.match(html, /id="rail-route-pop"/);
  assert.match(html, /route-pop-up/);
  assert.match(js, /rail-route-btn/);
  assert.match(js, /rail-route-pop/);
  assert.match(css, /\.route-pop\.route-pop-up/);
  assert.match(css, /\.route-pop-wrap\.rail-route-wrap/);
  assert.match(css, /\.line-chip-btn/);
});

test('launcher home toggles start/stop desktop from running state', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.match(js, /desktopIsRunning/);
  assert.match(js, /关闭桌面端/);
  assert.match(js, /stopDesktop/);
});

test('launcher versions panel: current version on top, expandable release rows, inline route dropdown', () => {
  const js = fs.readFileSync(path.join(rendererDir, 'launcher.js'), 'utf8');
  assert.match(html, /id="ver-now"/);
  assert.match(html, /id="ver-num"/);
  assert.match(html, /id="release-list"/);
  assert.match(html, /id="versions-route-pop"/);
  assert.match(html, /id="versions-route-btn"/);
  assert.match(html, /id="btn-uninstall-app"/);
  assert.match(js, /renderVersionLead/);
  assert.match(js, /data-rel-toggle/);
  assert.match(js, /releaseDetailHtml/);
  assert.match(js, /setRoutePop/);
  assert.match(js, /closeRoutePops/);
  assert.match(js, /renderRouteOptions/);
  assert.match(js, /完全下载/);
  assert.match(js, /data-delta-tag/);
  assert.match(js, /增量更新/);
  assert.match(js, /切换至此版本/);
  assert.match(js, /uninstallApp/);
  assert.match(css, /\.ver-now/);
  assert.match(css, /\.rel-detail/);
  assert.match(css, /\.route-pop/);
});
