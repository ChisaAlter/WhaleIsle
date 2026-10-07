const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('desktop entry reveals the workspace without waiting for credentials or welcome', async () => {
  const body = source.match(/showHarness: async \(url, extra\) => \{([\s\S]*?)\n  \},/)[1];
  for (const backgroundStartup of [false, true]) {
    const calls = [];
    const context = vm.createContext({
      backgroundStartup,
      enteredWorkspace: false,
      openInitialWelcome: async () => true,
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
  assert.doesNotMatch(source, /openWelcomeWindow|showWelcome\(|pendingHarnessEntry/);
});

function accountFixture(connect) {
  const calls = { opened: [], refreshed: 0 };
  const context = vm.createContext({
    URL, quitting: false, console,
    connectWelcome: connect,
    dsh: { sessionCookie: 'session=test' },
    nativeTheme: { shouldUseDarkColors: false },
    shell: { openExternal: async url => calls.opened.push(url) },
    app: { getLocale: () => 'zh-CN' },
    resolveDesktopStartupLocale: preference => ({ id: preference || 'zh-CN' }),
    refresh: () => { calls.refreshed++; },
  });
  const block = source.slice(source.indexOf('// Desktop account integration'), source.indexOf('function showForeground()'));
  vm.runInContext(`${block}\nplatformSessionRefresh = refresh;`, context);
  return { calls, initialize: vm.runInContext('initializeDesktopAccount', context) };
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
