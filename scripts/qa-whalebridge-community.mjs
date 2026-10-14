// Targeted acceptance through the original native window and isolated component install.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWhaleBridgeService } from '../src/launcher/whalebridge.js';
import { reservePort } from './smoke-workspace.mjs';

const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const discoveryVisualOnly = process.argv.includes('--discovery-visual-only');
const sourceOnly = process.argv.includes('--source-only') || discoveryVisualOnly;
const resumeVisual = process.argv.includes('--resume-visual');
const visualOnly = process.argv.includes('--visual-only') || resumeVisual;
const updatesTimeOnly = process.argv.includes('--updates-time-only');
const output = process.env.WHALEBRIDGE_QA_OUTPUT;
assert.ok(output, 'WHALEBRIDGE_QA_OUTPUT must name the requested evidence directory');
const executable = process.env.ELECTRON_PATH;
assert.ok(executable && existsSync(executable), 'ELECTRON_PATH must name the existing Electron executable');
mkdirSync(output, { recursive: true });
mkdirSync(join(root, '.tmp'), { recursive: true });
const dir = mkdtempSync(join(root, '.tmp', 'whalebridge-community-qa-'));
const data = join(dir, 'component');
const home = join(dir, 'isolated-home');
const fixture = join(dir, 'trusted-local-opencode-provider-with-a-deliberately-long-readable-directory-name');
const fixtureID = 'whalebridge-community-qa';
const fixtureName = 'WhaleBridge Trusted Local QA';
const fixtureKey = 'local-fixture-only-not-a-real-account-key';
if (!sourceOnly && !updatesTimeOnly) {
 mkdirSync(fixture, { recursive: true });
 writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'whalebridge-community-qa', version: '1.0.0', type: 'module', main: './index.js', magpie: { options: { marker: 'local-example' } } }, null, 2));
 writeFileSync(join(fixture, 'README.md'), '# WhaleBridge Trusted Local QA\n\nLOCAL_FIXTURE_README: API-key wiring only. No real OAuth, paid account, or external provider requests.\n');
 writeFileSync(join(fixture, 'index.js'), `export const LocalQA = async () => ({
  config: async cfg => {
    cfg.provider ||= {};
    cfg.provider[${JSON.stringify(fixtureID)}] = {
      name: ${JSON.stringify(fixtureName)}, npm: '@ai-sdk/openai-compatible', api: 'https://fixture.invalid/v1',
      models: { 'qa-model': { name: 'Local QA Model', limit: { context: 4096, output: 512 } } }
    };
  },
  auth: { provider: ${JSON.stringify(fixtureID)}, methods: [{ type: 'api', label: 'Local fixture key' }],
    loader: async () => ({ baseURL: 'https://fixture.invalid/v1', fetch: async () => { throw new Error('Local QA fixture sends no provider requests'); } }) }
});\n`);
}

const env = { ...process.env, USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), CODEX_HOME: join(home, 'codex'), CLAUDE_CONFIG_DIR: join(home, 'claude'), MAGPIE_ADDR: `127.0.0.1:${await reservePort()}`, MAGPIE_BUN: process.env.MAGPIE_BUN };
for (const key of ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) mkdirSync(env[key], { recursive: true });
for (const key of ['ELECTRON_RUN_AS_NODE', 'MAGPIE_WEB_KEY', 'MAGPIE_WEB_RUNKEY', 'MAGPIE_PLUGIN_MARKET', 'MAGPIE_PLUGINS', 'MAGPIE_PLUGIN_AUTH', 'LAUNCHER_COMPONENT_DATA_DIR', 'WHALEBRIDGE_DSH_HOME']) delete env[key];
const manifest = JSON.parse(readFileSync(join(root, '.tmp', 'whalebridge-package', 'WhaleBridge-component.json')));
const binarySHA256 = createHash('sha256').update(readFileSync(join(root, '.tmp', 'whalebridge-package', 'WhaleBridge-win32-x64.exe'))).digest('hex');
assert.equal(binarySHA256, manifest.platforms['win32-x64'].sha256);
const report = {
  started: new Date().toISOString(), finished: null, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  version: manifest.version, binarySHA256, scope: discoveryVisualOnly ? 'community description visual delta' : updatesTimeOnly ? 'final last-update timestamp delta' : visualOnly ? 'final UI and installed-name delta' : sourceOnly ? 'source-picker CSS-only delta' : 'community discovery and install acceptance', isolatedDirectory: dir, ...(!sourceOnly && !updatesTimeOnly ? { fixtureDirectory: fixture } : {}),
  runtime: { originalWindow: 'src/main/whalebridge-window.js', activate: false, interaction: 'Playwright CDP; no physical mouse or external browser', communitySourcesMocked: false },
  scenarios: [], screenshots: [], consoleErrors: [], nativeDiagnostics: [],
  unverified: ['Real supplier OAuth and paid account acceptance; local API-key fixture is not proof of OAuth', 'User-installed desktop acceptance; this run uses an isolated component and the original native source window', 'Visual acceptance requires reviewers to inspect the saved complete-window screenshots']
};
const previousReport = join(output, 'acceptance.json');
if (resumeVisual) assert.ok(existsSync(previousReport), 'Resume requires the interrupted visual evidence');
if (existsSync(previousReport)) {
  const previous = JSON.parse(readFileSync(previousReport));
  if (resumeVisual) {
    assert.equal(previous.binarySHA256, binarySHA256, 'Resume must use the previously observed binary');
    assert.equal(previous.finished ?? null, null, 'Resume is only for the interrupted visual attempt');
    report.resumedFrom = previous.started;
  }
  report.previousAttempts = [...(previous.previousAttempts || []), { started: previous.started, finished: previous.finished ?? null, binarySHA256: previous.binarySHA256, scope: previous.scope, isolatedDirectory: previous.isolatedDirectory, scenarios: previous.scenarios, screenshots: previous.screenshots, fatal: previous.fatal, stoppedOwnService: previous.stoppedOwnService }];
}
let privateURL = '', electron, page;
const sanitize = value => String(value).replaceAll(privateURL || '\0', '[private-management-url]').replaceAll(fixtureKey, '[local-fixture-key]').replace(/([?&]k=)[a-f0-9]{32}/gi, '$1[redacted]').replace(/magpie_web_\d+=[a-f0-9]{32}/gi, '[management-cookie]');
const persist = () => writeFileSync(join(output, 'acceptance.json'), JSON.stringify(report, null, 2));
const record = (name, status, detail = {}) => { report.scenarios.push({ name, status, ...detail }); persist(); console.log(`${status.toUpperCase()} ${name}${detail.reason ? ': ' + sanitize(detail.reason) : ''}`); };
const scenario = async (name, fn) => {
  try { const detail = await fn(); record(name, 'passed', detail || {}); }
  catch (error) { record(name, 'failed', { reason: sanitize(error.message) }); if (page) await page.screenshot({ path: join(output, `failure-${report.scenarios.length}-${binarySHA256.slice(0, 12)}${resumeVisual ? '-resumed' : updatesTimeOnly ? '-updates-time' : ''}.png`) }).catch(() => {}); }
};
const service = createWhaleBridgeService({ root: data, dshHome: join(home, 'dsh'), devPackage: join(root, '.tmp', 'whalebridge-package'), spawn: (file, args, options) => spawn(file, args, { ...options, env: { ...options.env, ...env }, windowsHide: true }) });
let api;
const click = async (action, scope = page.locator('#fields')) => { await scope.locator(`[data-action="${action}"]`).first().click(); };
const closeEditor = async () => { if (await page.locator('#editor').isVisible()) await page.locator('#close-editor').click(); };
const originalEntry = async kind => {
  await closeEditor();
  await page.locator('#content').locator(`[data-action="${kind === 'api' ? 'add-provider' : 'subscription'}"]`).first().click();
  await page.locator('#source-search').waitFor();
};
const showInstalled = async () => { await page.locator('[data-section-target="installed"]').click(); await page.locator('[data-section="installed"]').waitFor(); };
const localRow = () => page.locator('[data-section="installed"] .adapter-item').filter({ hasText: fixture });
const waitAdapterRefresh = async () => { await page.locator('[data-section="installed"] .adapter-item').first().waitFor({ timeout: 120000 }); };
const capture = async (name, width, height) => {
  const content = await electron.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(size.width, size.height); return win.getContentSize(); }, { width, height });
  await page.waitForFunction(([width, height]) => innerWidth === width && innerHeight === height, content);
  await page.locator('.editor-content').evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(() => document.fonts.ready);
  const path = join(output, name + (resumeVisual ? '-resumed' : '') + '-' + binarySHA256.slice(0, 12) + '.png');
  await page.screenshot({ path, fullPage: false });
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth, editorScrollWidth: document.querySelector('.editor-content')?.scrollWidth, editorClientWidth: document.querySelector('.editor-content')?.clientWidth }));
  report.screenshots.push({ name, path, binarySHA256, requestedNativeSize: { width, height }, geometry }); persist();
  assert.equal(geometry.horizontalOverflow, false, name + ': document has horizontal overflow');
};
const savedPlugin = async () => {
  const file = join(data, 'data', 'plugins.json');
  return existsSync(file) ? JSON.parse(readFileSync(file)).plugins.find(p => p.spec === fixture) : undefined;
};

try {
  const installed = await service.install();
  assert.equal(installed.ok, true, sanitize(installed.message || installed.error || 'component install failed'));
  privateURL = service.state().url;
  const url = new URL(privateURL), cookie = `magpie_web_${url.port}=${url.searchParams.get('k')}`;
  api = async path => { const response = await fetch(url.origin + '/api/' + path, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) }); assert.ok(response.ok, sanitize(await response.clone().text())); return response.json(); };
  const driver = join(dir, 'native-window.cjs');
  // Electron starts with empty globalPaths; initialize the externally supplied NODE_PATH.
  writeFileSync(driver, `require('node:module')._initPaths();\nconst {app}=require('electron');\napp.setPath('userData',${JSON.stringify(join(dir, 'electron-profile'))});\napp.whenReady().then(()=>require(${JSON.stringify(join(root, 'src/main/whalebridge-window.js'))}).openWhaleBridgeWindow(${JSON.stringify(privateURL)},{activate:false}));\napp.on('window-all-closed',()=>app.quit());\n`);
  electron = await _electron.launch({ executablePath: executable, args: [driver], env, timeout: 45000 });
  electron.process().stderr?.on('data', chunk => { report.nativeDiagnostics.push(sanitize(chunk)); });
  page = await electron.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => { report.consoleErrors.push(sanitize(error.message)); });
  await page.locator('#content [data-action="add-provider"]').first().waitFor({ timeout: 60000 });
  assert.equal((await api('state')).version, manifest.version);
  record('final packaged service and original native window ready', 'passed');

  if (discoveryVisualOnly) {
    await originalEntry('api'); await click('source-community'); await page.locator('#adapter-search-query').waitFor();
    await scenario('real npm description remains readable at both native sizes and themes without plugin installation', async () => {
      const query = '@ex-machina/opencode-anthropic-auth';
      const responsePromise = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === query, { timeout: 45000 });
      await page.locator('#adapter-search-query').fill(query); await page.locator('#adapter-search-query').press('Enter');
      const response = await responsePromise; assert.equal(response.status(), 200);
      await page.locator('#adapter-search-results[aria-busy="false"]').waitFor();
      const row = page.locator('#adapter-search-results .adapter-item').filter({ hasText: query }).first();
      await row.waitFor();
      const text = await row.innerText();
      assert.ok(!text.includes('![') && !text.includes('img.shields.io') && !text.includes('<img'), 'Description still contains raw Markdown or image markup');
      assert.ok((await page.locator('#adapter-search-results .adapter-item').first().innerText()).includes(query), 'Affected package must be visible at the top of the search results');
      for (const theme of ['light', 'dark']) {
        await electron.evaluate(({ nativeTheme }, value) => { nativeTheme.themeSource = value; }, theme);
        // Playwright's context color scheme overrides Electron's nativeTheme.
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(dark => document.documentElement.hasAttribute('data-ds-dark-theme') === dark, theme === 'dark');
        await capture(`discovery-description-${theme}-1120x780`, 1120, 780);
        await capture(`discovery-description-${theme}-380x660`, 380, 660);
      }
      assert.equal((await api('subscription/adapters')).installed.length, 0, 'Description observation must not install a provider plugin');
      return { query, renderedDescription: text, pluginInstallationRepeated: false, externalAuthenticationStarted: false };
    });
  } else if (updatesTimeOnly) {
    await originalEntry('api'); await click('source-community'); await page.locator('#adapter-search-query').waitFor(); await showInstalled();
    await scenario('fresh zero update timestamp is hidden in original installed section', async () => {
      const adapters = await api('subscription/adapters');
      assert.equal(adapters.installed.length, 0, 'Timestamp acceptance must use a fresh empty plugin configuration');
      assert.ok(adapters.updates.checked.startsWith('0001-'), 'Fresh service must expose the actual Go zero timestamp');
      const text = await page.locator('[data-section="installed"]').textContent();
      assert.ok(!text.includes('最近检查'), 'Zero timestamp must not show a recent-check label');
      assert.ok(!text.includes('1/1/1'), 'Go zero timestamp must not be formatted as a real date');
      await capture('installed-updates-zero-1120x780', 1120, 780); await capture('installed-updates-zero-380x660', 380, 660);
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
      return { checked: adapters.updates.checked, recentCheckHidden: true, installedPluginCount: 0 };
    });
    await scenario('native update check persists and displays the real current timestamp', async () => {
      assert.equal((await api('subscription/adapters')).installed.length, 0);
      const startedCheck = Date.now();
      const responsePromise = page.waitForResponse(r => r.url().includes('/api/subscription/adapters/check') && r.request().method() === 'POST', { timeout: 45000 });
      await click('adapter-check'); const response = await responsePromise; assert.equal(response.status(), 200);
      const checkedResult = await response.json(); assert.equal(checkedResult.plugins.length, 0);
      await page.waitForFunction(() => document.querySelector('[data-section="installed"]')?.textContent.includes('最近检查'));
      const adapters = await api('subscription/adapters'), checked = adapters.updates.checked;
      assert.equal(adapters.installed.length, 0); assert.equal(checked, checkedResult.at);
      assert.ok(Date.parse(checked) >= startedCheck - 2000 && Date.parse(checked) <= Date.now(), 'Update check timestamp is not the real current time');
      const formatted = await page.evaluate(value => new Date(value).toLocaleString('zh-CN', { hour12: false }), checked);
      const text = await page.locator('[data-section="installed"]').textContent();
      assert.ok(text.includes('最近检查：' + formatted), 'Current update timestamp is not shown correctly'); assert.ok(!text.includes('1/1/1'));
      await capture('installed-updates-checked-1120x780', 1120, 780); await capture('installed-updates-checked-380x660', 380, 660);
      return { checked, formatted, checkedPluginCount: checkedResult.plugins.length, installedPluginCount: 0, communityInstallationRepeated: false, externalAuthenticationStarted: false };
    });
  } else {
  if (!resumeVisual) await scenario('original supplier entry, OpenAI search and real preset endpoints', async () => {
    await originalEntry('api'); await page.locator('#source-search').fill('OpenAI');
    await page.locator('[data-action="source-preset"][data-id="openai"]').waitFor();
    if (sourceOnly || visualOnly) {
      await page.locator('#source-clear').click(); assert.equal(await page.locator('#source-search').inputValue(), '');
      assert.equal(await page.locator('#source-clear').isVisible(), false);
      await page.locator('#source-search').fill('OpenAI');
    }
    await capture('source-picker-1120x780', 1120, 780);
    await capture('source-picker-380x660', 380, 660);
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
    await page.locator('[data-action="source-preset"][data-id="openai"]').click();
    assert.equal(await page.locator('#f-preset').inputValue(), 'openai');
    const preset = (await api('state')).presets.find(p => p.id === 'openai');
    assert.ok(preset.chat?.startsWith('https://api.openai.com/'));
    assert.equal(await page.locator('#f-chat').inputValue(), preset.chat);
    assert.equal(await page.locator('#f-responses').inputValue(), preset.responses);
    return { preset: preset.id, chat: preset.chat, responses: preset.responses, configurationSaved: false };
  });

  if (sourceOnly || visualOnly) {
    if (resumeVisual) {
      await originalEntry('api'); await click('source-community'); await page.locator('#adapter-search-query').waitFor();
      await scenario('remaining search-idle default discovery screenshots', async () => {
        await page.locator('#adapter-search-results[aria-busy="false"] .adapter-item').first().waitFor();
        await page.waitForFunction(() => document.querySelector('#fields [data-action="adapter-search"]')?.disabled === false);
        assert.equal(await page.locator('#adapter-search-query').inputValue(), '');
        await capture('discovery-default-1120x780', 1120, 780); await capture('discovery-default-380x660', 380, 660);
        await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        return { searchIdle: true, noQuery: true, sourceAssertionsRepeated: false };
      });
    } else await scenario('final source picker clear, no-results and community entry', async () => {
      await originalEntry('api'); await page.locator('#source-search').fill('community-no-match-qa');
      assert.equal(await page.locator('[data-action="source-preset"]').count(), 0);
      await click('source-community'); await page.locator('#adapter-search-query').waitFor();
      assert.equal(await page.locator('#adapter-search-query').inputValue(), 'community-no-match-qa');
      return { pluginInstallRepeated: false, oauthStarted: false };
    });
    if (visualOnly) {
      await scenario(resumeVisual ? 'remaining real npm discovery layout with real README' : 'final default and real npm discovery layout with real README', async () => {
        if (!resumeVisual) {
          await click('adapter-suggested');
          await page.locator('#adapter-search-results .adapter-item').first().waitFor();
          await capture('discovery-default-1120x780', 1120, 780); await capture('discovery-default-380x660', 380, 660);
          await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        }
        const responsePromise = page.waitForResponse(r => r.url().includes('/api/subscription/adapters/search?q=anthropic'), { timeout: 45000 });
        await page.locator('#adapter-search-query').fill('anthropic'); await page.locator('#adapter-search-query').press('Enter');
        const response = await responsePromise; assert.equal(response.status(), 200);
        const hits = (await response.json()).hits; assert.ok(hits.length, 'Real npm search returned no provider plugins');
        await page.locator('#adapter-search-results[aria-busy="false"]').waitFor();
        await capture('discovery-search-1120x780', 1120, 780); await capture('discovery-search-380x660', 380, 660);
        await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        await page.locator('#adapter-search-results .adapter-item').first().locator('[data-action="adapter-page"]').click();
        await page.waitForFunction(() => (document.querySelector('#adapter-readme')?.textContent || '').length > 20, undefined, { timeout: 45000 });
        const readmeLength = (await page.locator('#adapter-readme').textContent()).length;
        if (resumeVisual) {
          await capture('npm-readme-1120x780', 1120, 780); await capture('npm-readme-380x660', 380, 660);
          await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        }
        await click('adapter-back'); await page.locator('#adapter-search-query').waitFor();
        return { hitCount: hits.length, readmeLength, npmInstallationRepeated: false };
      });
      await scenario('final local manifest name, path identity and visible installed login at both native sizes', async () => {
        await page.locator('[data-section="discover"] details summary').click(); await page.locator('#f-package').fill(fixture);
        await click('adapter-install-custom'); await page.locator('#confirmation').waitFor(); await page.locator('#accept-confirm').click();
        await localRow().waitFor({ timeout: 120000 });
        const installed = (await api('subscription/adapters')).installed.find(p => p.package === fixture);
        assert.equal(installed.name, 'whalebridge-community-qa'); assert.equal(installed.id, fixture); assert.equal(installed.package, fixture);
        assert.deepEqual(installed.providers, [fixtureID]); assert.equal((await savedPlugin()).spec, fixture);
        assert.equal(await localRow().locator('.adapter-identity strong').textContent(), 'whalebridge-community-qa');
        const visibleLogin = async () => {
          const visibility = await localRow().locator('[data-action="adapter-signin"]').evaluate(button => {
            const r = button.getBoundingClientRect(), content = document.querySelector('.editor-content').getBoundingClientRect();
            return { fullyVisible: r.top >= content.top && r.bottom <= content.bottom && r.left >= content.left && r.right <= content.right, top: r.top, bottom: r.bottom, contentTop: content.top, contentBottom: content.bottom };
          });
          assert.ok(visibility.fullyVisible, 'Installed login is clipped on first screen: ' + JSON.stringify(visibility)); return visibility;
        };
        await capture('installed-1120x780', 1120, 780); const normalLogin = await visibleLogin();
        await capture('installed-long-path-380x660', 380, 660); const narrowLogin = await visibleLogin();
        await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        await localRow().locator('[data-action="adapter-page"]').click();
        assert.equal(await page.locator('#editor-title').textContent(), 'whalebridge-community-qa');
        await page.waitForFunction(() => document.querySelector('#adapter-readme')?.textContent.includes('LOCAL_FIXTURE_README'));
        if (resumeVisual) {
          await capture('local-readme-1120x780', 1120, 780); await capture('local-readme-380x660', 380, 660);
          await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
        }
        await click('adapter-back'); await showInstalled();
        return { manifestName: installed.name, idStillPath: true, normalLogin, narrowLogin, localReadmeCorrect: true, fakeKeyAuthenticationRepeated: false };
      });
      await scenario('final visual fixture removal and preserved isolated data', async () => {
        if (!await localRow().isVisible()) { await closeEditor(); await originalEntry('api'); await click('source-community'); await showInstalled(); }
        await localRow().locator('[data-action="adapter-remove"]').click(); await page.locator('#confirmation').waitFor(); await page.locator('#accept-confirm').click();
        await page.waitForFunction(spec => document.querySelector('[data-section="installed"]') && ![...document.querySelectorAll('[data-section="installed"] .adapter-item code')].some(code => code.textContent === spec), fixture, { timeout: 60000 });
        assert.equal(await savedPlugin(), undefined);
        return { removed: true, dataDirectoryPreserved: existsSync(data), fixtureDirectoryPreserved: existsSync(fixture) };
      });
    }
  } else {

  await scenario('builtin subscription search, login page and both navigation buttons', async () => {
    await originalEntry('subscription'); await page.locator('#source-search').fill('Codex');
    await page.locator('[data-action="source-subscription"][data-id="codex"]').click();
    assert.equal(await page.locator('#f-agent').inputValue(), 'codex');
    await click('source-back'); await page.locator('#source-search').waitFor();
    await page.locator('#source-search').fill('Codex');
    await page.locator('[data-action="source-subscription"][data-id="codex"]').click();
    await click('source-discover'); await page.locator('#adapter-search-query').waitFor();
    return { supplierLoginStarted: false };
  });

  await scenario('source no-results leads to community discovery and direct install field', async () => {
    await originalEntry('api'); await page.locator('#source-search').fill('community-no-match-qa');
    assert.equal(await page.locator('[data-action="source-preset"]').count(), 0);
    await click('source-community'); await page.locator('#adapter-search-query').waitFor();
    await page.locator('#adapter-search-results[aria-busy="false"]').waitFor({ timeout: 45000 });
    assert.equal(await page.locator('#adapter-search-query').inputValue(), 'community-no-match-qa');
    await page.locator('[data-section="discover"] details summary').click();
    await page.locator('#f-package').fill('github:trusted-owner/trusted-repository');
    assert.equal(await page.locator('#f-package').inputValue(), 'github:trusted-owner/trusted-repository');
    return { directSpecSubmitted: false };
  });

  await scenario('real npm search, real README and serialized detail install confirmation cancelled', async () => {
    const before = (await api('subscription/adapters')).installed.length;
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/subscription/adapters/search?q=anthropic'), { timeout: 45000 });
    await page.locator('#adapter-search-query').fill('anthropic'); await page.locator('#adapter-search-query').press('Enter');
    const response = await responsePromise; assert.equal(response.status(), 200);
    const hits = (await response.json()).hits; assert.ok(hits.length, 'Real npm search returned no provider plugins');
    await page.locator('#adapter-search-results[aria-busy="false"]').waitFor();
    await capture('discovery-1120x780', 1120, 780);
    const first = page.locator('#adapter-search-results .adapter-item').first();
    const spec = await first.locator('code').textContent(); await first.locator('[data-action="adapter-page"]').click();
    await page.waitForFunction(() => (document.querySelector('#adapter-readme')?.textContent || '').length > 20, undefined, { timeout: 45000 });
    const readmeLength = (await page.locator('#adapter-readme').textContent()).length;
    await click('adapter-install'); await page.locator('#confirmation').waitFor();
    assert.ok((await page.locator('#confirm-body').textContent()).includes(spec));
    assert.ok((await page.locator('#confirm-body').textContent()).includes('第三方代码'));
    await page.locator('#cancel-confirm').click(); assert.equal((await api('subscription/adapters')).installed.length, before);
    await click('adapter-back'); await page.locator('#adapter-search-query').waitFor();
    return { httpStatus: response.status(), hitCount: hits.length, package: spec, readmeLength, cancelledUnreviewedInstallation: true };
  });

  await scenario('real GitHub repository listing and direct repository entry', async () => {
    if (!await page.locator('#adapter-search-query').isVisible()) { await originalEntry('api'); await click('source-community'); }
    const responsePromise = page.waitForResponse(r => r.url().includes('/api/subscription/adapters/github'), { timeout: 45000 });
    await click('adapter-github'); const response = await responsePromise; assert.equal(response.status(), 200);
    const repos = (await response.json()).repos; await page.locator('#adapter-search-results[aria-busy="false"]').waitFor();
    const rendered = await page.locator('#adapter-search-results .adapter-item').count();
    if (!repos.length) throw new Error('GitHub returned no repositories; cache/limit/source failure is not exposed by this API, delivery remains unverified');
    assert.equal(rendered, repos.filter(p => !['agent', 'middleware'].includes(p.kind)).length);
    await page.locator('[data-section="discover"] details summary').click(); await page.locator('#f-package').fill('github:trusted-owner/trusted-repository');
    return { httpStatus: response.status(), repositoryCount: repos.length, renderedProviderCount: rendered, directSpecSubmitted: false };
  });

  await scenario('upstream-recommended community package README, real npm install, login methods and removal', async () => {
    await closeEditor(); await originalEntry('api'); await click('source-community');
    const spec = '@magpie-community/opencode-zcode-auth';
    assert.ok((await api('subscription/adapters')).available.some(p => p.package === spec && p.community), 'Package is not an upstream community recommendation');
    await click('adapter-suggested');
    const row = page.locator('#adapter-search-results .adapter-item').filter({ hasText: spec });
    await row.locator('[data-action="adapter-page"]').click();
    await page.waitForFunction(() => (document.querySelector('#adapter-readme')?.textContent || '').length > 20, undefined, { timeout: 45000 });
    const readmeLength = (await page.locator('#adapter-readme').textContent()).length;
    await click('adapter-install'); await page.locator('#confirmation').waitFor();
    assert.ok((await page.locator('#confirm-body').textContent()).includes(spec));
    await page.locator('#accept-confirm').click(); await waitAdapterRefresh();
    const installed = (await api('subscription/adapters')).installed.find(p => p.id === spec);
    assert.ok(installed?.enabled, 'Official community package was not installed and enabled');
    assert.ok(installed.providers.length, 'Official community package exposes no provider');
    const subscriptions = (await api('subscriptions')).filter(s => s.plugin && installed.providers.includes(s.pid));
    assert.ok(subscriptions.some(s => s.methods?.length), 'Official community package exposes no login method');
    const installedRow = page.locator('[data-section="installed"] .adapter-item').filter({ hasText: spec });
    assert.ok(await installedRow.locator('[data-action="adapter-signin"]').count());
    await installedRow.locator('[data-action="adapter-remove"]').click(); await page.locator('#accept-confirm').click();
    await page.waitForFunction(spec => document.querySelector('[data-section="installed"]') && ![...document.querySelectorAll('[data-section="installed"] .adapter-item code')].some(code => code.textContent === spec), spec, { timeout: 60000 });
    assert.ok(!(await api('subscription/adapters')).installed.some(p => p.id === spec));
    return { package: spec, readmeLength, providerIDs: installed.providers, signinMethodCounts: subscriptions.map(s => s.methods.length), installedFromRealRegistry: true, removed: true, oauthStarted: false };
  });

  await scenario('trusted long-path local provider install, installed login wiring and complete native screenshots', async () => {
    await originalEntry('api'); await click('source-community');
    await page.locator('[data-section="discover"] details summary').click(); await page.locator('#f-package').fill(fixture);
    await click('adapter-install-custom'); await page.locator('#confirmation').waitFor(); await page.locator('#accept-confirm').click();
    await localRow().waitFor({ timeout: 120000 }); assert.equal((await savedPlugin()).off || false, false);
    const installed = (await api('subscription/adapters')).installed.find(p => p.package === fixture);
    assert.ok(installed.enabled); assert.deepEqual(installed.providers, [fixtureID]);
    await localRow().locator('[data-action="adapter-signin"]').waitFor();
    assert.equal(await localRow().locator('[data-action="adapter-update"]').count(), 0, 'Local folder must not expose a failing npm update');
    await capture('installed-1120x780', 1120, 780); await capture('installed-long-path-380x660', 380, 660);
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 780));
    return { localFixture: true, providerID: fixtureID, durablePluginEntry: true };
  });

  await scenario('local README, options save, disable and enable from detail', async () => {
    await localRow().locator('[data-action="adapter-page"]').click();
    await page.waitForFunction(() => document.querySelector('#adapter-readme')?.textContent.includes('LOCAL_FIXTURE_README'));
    await click('adapter-back'); await showInstalled();
    await localRow().locator('[data-action="adapter-options"]').click(); await page.locator('#f-options').waitFor();
    assert.equal(JSON.parse(await page.locator('#f-options').inputValue()).marker, 'local-example');
    await page.locator('#f-options').fill(JSON.stringify({ marker: 'saved-through-native-ui' })); await page.locator('#save').click(); await waitAdapterRefresh();
    assert.equal((await savedPlugin()).options.marker, 'saved-through-native-ui');
    await localRow().locator('[data-action="adapter-off"]').click(); await localRow().locator('[data-action="adapter-on"]').waitFor();
    assert.equal((await savedPlugin()).off, true); assert.equal(await localRow().locator('[data-action="adapter-signin"]').count(), 0);
    await localRow().locator('[data-action="adapter-page"]').click(); await click('adapter-on'); await waitAdapterRefresh();
    assert.equal((await savedPlugin()).off || false, false); await localRow().locator('[data-action="adapter-signin"]').waitFor();
    return { localReadme: true, durableOptions: true, durableDisable: true, detailEnable: true };
  });

  await scenario('local fixture installed-row login: fake API-key persistence and masked provider state', async () => {
    await localRow().locator('[data-action="adapter-signin"]').click(); await page.locator('#f-key').waitFor();
    assert.ok((await page.locator('#f-method').textContent()).includes('Local fixture key'));
    await page.locator('#f-key').fill(fixtureKey); await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#editor-title')?.textContent.includes('订阅账号接入成功'), undefined, { timeout: 45000 });
    const auth = JSON.parse(readFileSync(join(data, 'data', 'plugin-auth.json')));
    assert.equal(auth[fixtureID].type, 'api'); assert.equal(auth[fixtureID].key, fixtureKey);
    const state = await api('state'); assert.ok(state.providers.some(p => p.id === fixtureID), 'Signed-in provider missing from state');
    assert.ok(!JSON.stringify(state).includes(fixtureKey), 'Public state leaks the fixture key');
    return { durableFakeKey: true, publicStateMasksKey: true, oauthProven: false };
  });

  await scenario('trusted local provider removal through original community path persists', async () => {
    await originalEntry('api'); await click('source-community'); await showInstalled();
    await localRow().locator('[data-action="adapter-remove"]').click(); await page.locator('#confirmation').waitFor(); await page.locator('#accept-confirm').click();
    await page.waitForFunction(spec => document.querySelector('[data-section="installed"]') && ![...document.querySelectorAll('[data-section="installed"] .adapter-item code')].some(code => code.textContent === spec), fixture, { timeout: 60000 });
    assert.equal(await savedPlugin(), undefined); assert.ok(!(await api('subscription/adapters')).installed.some(p => p.package === fixture));
    return { durableRemoved: true, fixtureDirectoryPreserved: existsSync(fixture) };
  });
  }
  }
  if (report.consoleErrors.length) record('renderer uncaught errors', 'failed', { reason: report.consoleErrors.join('; ') });
} catch (error) {
  report.fatal = sanitize(error.stack || error.message); record('native runner startup or component install', 'failed', { reason: sanitize(error.message) });
} finally {
  if (electron) await electron.close().catch(error => { report.nativeDiagnostics.push(sanitize(error.message)); record('own native window cleanup', 'failed', { reason: sanitize(error.message) }); });
  if (service.state()) {
    try { const stopped = await service.stop(); report.stoppedOwnService = stopped.ok; if (!stopped.ok) record('own service cleanup', 'failed', { reason: sanitize(stopped.message || stopped.error || 'service stop failed') }); }
    catch (error) { report.stoppedOwnService = false; record('own service cleanup', 'failed', { reason: sanitize(error.message) }); }
  }
  const log = join(data, 'data', 'component.log');
  if (existsSync(log)) writeFileSync(join(output, 'component-sanitized.log'), sanitize(readFileSync(log, 'utf8')));
  report.finished = new Date().toISOString(); report.passed = report.scenarios.filter(s => s.status === 'passed').length; report.failed = report.scenarios.filter(s => s.status === 'failed').length; persist();
  console.log(`Evidence: ${join(output, 'acceptance.json')}`);
  process.exitCode = report.failed ? 1 : 0;
}
