const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
const harnessSource = fs.readFileSync(path.join(__dirname, 'app-harness.js'), 'utf8');
const accountSource = fs.readFileSync(path.join(__dirname, 'app-account.js'), 'utf8');

test('desktop entry reveals the workspace without waiting for credentials or welcome', async () => {
  const body = harnessSource.match(/showHarness:\s*async\s*\((?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?url,\s*(?:\/\*\*\s*@type\s*\{[^}]+\}\s*\*\/\s*)?extra\)\s*=>\s*\{([\s\S]*?)\n    \},/)[1];
  for (const backgroundStartup of [false, true]) {
    const calls = [];
    const context = vm.createContext({
      state: { backgroundStartup },
      initializeDesktopAccount: () => new Promise(() => {}),
      dsh: { sessionCookie: 'session=test' },
      showHarness: async (...args) => { calls.push(args); return 'workspace'; },
    });
    const enter = vm.runInContext(`(async (url, extra) => {${body}\n})`, context);
    assert.equal(await enter('http://localhost:3080', { reveal: true }), 'workspace');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].cookie, 'session=test');
    assert.equal(calls[0][1].reveal, true);
    assert.equal(calls[0][1].activate, !backgroundStartup);
  }
});

test('desktop entry never imports or opens upstream welcome', () => {
  assert.doesNotMatch(`${source}\n${harnessSource}`, /openWelcomeWindow|showWelcome\(|pendingHarnessEntry/);
});

function accountFixture(connect) {
  const calls = { opened: [], refreshed: 0 };
  const accountModule = { exports: {} };
  const context = vm.createContext({
    module: accountModule, console, URL,
    require: name => {
      if (name === 'electron') {
        return { app: { getLocale: () => 'zh-CN' }, nativeTheme: { shouldUseDarkColors: false } };
      }
      if (name === './welcome-backend') return { connectWelcome: connect };
      if (name === './open-external') return { openExternalHttp: async url => { calls.opened.push(url); return true; } };
      if (name === './desktop-locale') return { resolveDesktopStartupLocale: preference => ({ id: preference || 'zh-CN' }) };
      if (name === './update') return { currentVersion: () => '0.3.9' };
      return require(name);
    },
  });
  vm.runInContext(accountSource, context);
  const { initializeDesktopAccount } = accountModule.exports.createDesktopAccount({
    state: { quitting: false, platformSessionRefresh: () => { calls.refreshed++; } },
    dsh: { sessionCookie: 'session=test' },
  });
  return { calls, initialize: initializeDesktopAccount };
}

test('sign-out and expiration refresh Platform without gating entry; settings login still opens browser', async () => {
  let stateChanged, expired;
  const { calls, initialize } = accountFixture(async () => ({
    account: { watch: (state, error, expire) => { stateChanged = state; expired = expire; } },
    readLocalePreference: async () => 'zh-CN',
    read: () => assert.fail('entry must not inspect credentials'),
  }));
  await initialize('http://localhost:3080');
  stateChanged({ status: 'credential-stored', attempt: null });
  stateChanged({ status: 'signed-out', attempt: null });
  expired();
  assert.equal(calls.refreshed, 3);
  const pending = { status: 'signed-out', attempt: {
    id: 'login', phase: 'waiting-browser', authorizeUrl: 'https://example.com/login',
  } };
  stateChanged(pending);
  stateChanged(pending);
  assert.deepEqual(calls.opened, ['https://example.com/login?theme=light']);
});

test('account setup is deduplicated while pending and never queries credential state', async () => {
  let resolve, connects = 0, watches = 0;
  const { initialize } = accountFixture(() => {
    connects++;
    return new Promise(done => { resolve = done; });
  });
  const first = initialize('http://localhost:3080');
  const second = initialize('http://localhost:3080');
  assert.equal(connects, 1);
  resolve({ account: { watch: () => { watches++; } }, readLocalePreference: async () => null });
  await Promise.all([first, second]);
  await initialize('http://localhost:3080');
  assert.equal(connects, 1);
  assert.equal(watches, 1);
});
