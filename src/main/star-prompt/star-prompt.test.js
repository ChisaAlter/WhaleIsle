'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  GITHUB_OWNER,
  GITHUB_REPO,
  REPO_URL,
  STAR_API_URL,
  resolveGithubCredentials,
  checkStarStatus,
  starRepository,
} = require('./github-star');
const {
  IDLE_THRESHOLD_MS,
  SNOOZE_DURATION_MS,
  SUCCESS_HIDE_DELAY_MS,
  STAR_PROMPT_CHANNEL,
  createStarPromptController,
} = require('./index');

function createFakeTimers() {
  let nextId = 1;
  /** @type {Map<number, { fn: () => void, ms: number }>} */
  const active = new Map();
  return {
    setTimer(fn, ms) {
      const id = nextId;
      nextId += 1;
      active.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      active.delete(id);
    },
    count() {
      return active.size;
    },
    entries() {
      return [...active.entries()].map(([id, item]) => ({ id, ms: item.ms }));
    },
    fireNextNoAwait() {
      const first = active.entries().next();
      assert.ok(!first.done, 'expected an armed timer');
      const [id, item] = first.value;
      active.delete(id);
      return Promise.resolve(item.fn());
    },
    async fireNext() {
      const first = active.entries().next();
      assert.ok(!first.done, 'expected an armed timer');
      const [id, item] = first.value;
      active.delete(id);
      await item.fn();
    },
    async fireByDelay(ms) {
      for (const [id, item] of active.entries()) {
        if (item.ms === ms) {
          active.delete(id);
          await item.fn();
          return;
        }
      }
      assert.fail(`expected an armed timer with delay ${ms}`);
    },
  };
}

function createFakeWindow({
  destroyed = false,
  visible = true,
  minimized = false,
  focused = true,
} = {}) {
  const emitter = new EventEmitter();
  let isDestroyedState = destroyed;
  let isVisibleState = visible;
  let isMinimizedState = minimized;
  let isFocusedState = focused;

  return Object.assign(emitter, {
    isDestroyed: () => isDestroyedState,
    isVisible: () => isVisibleState,
    isMinimized: () => isMinimizedState,
    isFocused: () => isFocusedState,
    setState(next) {
      if ('destroyed' in next) isDestroyedState = next.destroyed;
      if ('visible' in next) isVisibleState = next.visible;
      if ('minimized' in next) isMinimizedState = next.minimized;
      if ('focused' in next) isFocusedState = next.focused;
    },
  });
}

function createFakeWebContents() {
  /** @type {Array<{ channel: string, payload: any }>} */
  const sent = [];
  let destroyed = false;
  return {
    sent,
    isDestroyed: () => destroyed,
    setDestroyed: (value) => { destroyed = value; },
    send(channel, payload) {
      sent.push({ channel, payload });
    },
  };
}

function createControllerHarness(overrides = {}) {
  const timers = createFakeTimers();
  let currentNow = overrides.now ?? 1_700_000_000_000;
  let config = overrides.config ?? {
    locale: 'zh',
    githubToken: 'cfg-secret-token',
    starPrompt: { starredAt: '', dismissedForever: false, snoozedUntil: '' },
  };
  let win = overrides.win !== undefined ? overrides.win : createFakeWindow();
  let wc = overrides.wc !== undefined ? overrides.wc : createFakeWebContents();
  let harnessLoaded = overrides.harnessLoaded ?? true;
  let overlayBlocked = overrides.overlayBlocked ?? false;
  /** @type {string[]} */
  const logs = [];
  /** @type {Array<Record<string, any>>} */
  const savedPatches = [];
  /** @type {string[]} */
  const openedUrls = [];

  const controller = createStarPromptController({
    loadConfig: () => Object.freeze({
      ...config,
      starPrompt: Object.freeze({ ...(config.starPrompt || {}) }),
    }),
    saveConfig: (patch) => {
      savedPatches.push(patch);
      config = {
        ...config,
        ...patch,
        starPrompt: { ...(config.starPrompt || {}), ...(patch.starPrompt || {}) },
      };
      return config;
    },
    getMainWindow: () => win,
    isHarnessLoaded: () => harnessLoaded,
    isOverlayBlocked: () => overlayBlocked,
    getHarnessWebContents: () => wc,
    openExternal: async (url) => {
      openedUrls.push(url);
      return true;
    },
    checkStarStatus: overrides.checkStarStatus ?? (async () => ({ status: 'unstarred' })),
    starRepository: overrides.starRepository ?? (async () => ({ ok: true })),
    now: () => currentNow,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    log: (msg) => logs.push(msg),
  });

  return {
    controller,
    timers,
    win,
    wc,
    logs,
    savedPatches,
    openedUrls,
    getConfig: () => config,
    setConfig: (next) => { config = next; },
    advanceNow: (ms) => { currentNow += ms; },
    setHarnessLoaded: (value) => { harnessLoaded = value; },
    setOverlayBlocked: (value) => { overlayBlocked = value; },
  };
}

test('github-star targets ChisaAlter/WhaleIsle and resolves credentials in priority order with deduplication', async () => {
  assert.equal(GITHUB_OWNER, 'ChisaAlter');
  assert.equal(GITHUB_REPO, 'WhaleIsle');
  assert.equal(REPO_URL, 'https://github.com/ChisaAlter/WhaleIsle');
  assert.equal(STAR_API_URL, 'https://api.github.com/user/starred/ChisaAlter/WhaleIsle');

  /** @type {Array<{ cmd: string, args: string[] }>} */
  const runCalls = [];
  const tokens = await resolveGithubCredentials({
    getConfigToken: () => '  tok-config  ',
    runCmd: async (cmd, args) => {
      runCalls.push({ cmd, args });
      return { code: 0, stdout: 'tok-gh\n', stderr: '' };
    },
    env: {
      GH_TOKEN: 'tok-gh',
      GITHUB_TOKEN: '  tok-env-github  ',
    },
  });

  assert.deepEqual(tokens, ['tok-config', 'tok-gh', 'tok-env-github']);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].cmd, 'gh');
  assert.deepEqual(runCalls[0].args, ['auth', 'token']);
});

test('github-star ignores gh CLI failures/non-zero exits and invalid/empty tokens', async () => {
  const tokens = await resolveGithubCredentials({
    getConfigToken: () => '   ',
    runCmd: async () => {
      throw new Error('gh not found');
    },
    env: {
      GH_TOKEN: 'tok-1\nbad',
      GITHUB_TOKEN: 'tok-env',
    },
  });
  assert.deepEqual(tokens, ['tok-env']);

  const nonZero = await resolveGithubCredentials({
    getConfigToken: () => '',
    runCmd: async () => ({ code: 1, stdout: 'should-ignore', stderr: 'not logged in' }),
    env: { GH_TOKEN: 'tok-gh-env' },
  });
  assert.deepEqual(nonZero, ['tok-gh-env']);
});

test('checkStarStatus handles no-credentials, 204 starred, 404 unstarred, 401/403/3xx fallback, and network errors', async () => {
  const noCreds = await checkStarStatus({
    getConfigToken: () => '',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
  });
  assert.deepEqual(noCreds, { status: 'no-credentials' });

  /** @type {Array<{ url: string, options: any }>} */
  const requests = [];
  const starred = await checkStarStatus({
    getConfigToken: () => 'secret-tok-1',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(starred, { status: 'starred' });
  assert.equal(requests[0].url, STAR_API_URL);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.redirect, 'manual');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-tok-1');
  assert.equal(requests[0].options.headers.Accept, 'application/vnd.github+json');
  assert.equal(requests[0].options.headers['X-GitHub-Api-Version'], '2022-11-28');

  const unstarred = await checkStarStatus({
    getConfigToken: () => 'secret-tok-1',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async () => new Response(null, { status: 404 }),
  });
  assert.deepEqual(unstarred, { status: 'unstarred' });

  /** @type {string[]} */
  const authHeaders = [];
  const fallbackOk = await checkStarStatus({
    getConfigToken: () => 'bad-tok-1',
    runCmd: async () => ({ code: 0, stdout: 'redirect-tok-2' }),
    env: { GH_TOKEN: 'good-tok-3' },
    fetchImpl: async (_url, options) => {
      authHeaders.push(options.headers.Authorization);
      if (options.headers.Authorization === 'Bearer bad-tok-1') {
        return new Response(null, { status: 401 });
      }
      if (options.headers.Authorization === 'Bearer redirect-tok-2') {
        return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
      }
      return new Response(null, { status: 404 });
    },
  });
  assert.deepEqual(fallbackOk, { status: 'unstarred' });
  assert.deepEqual(authHeaders, ['Bearer bad-tok-1', 'Bearer redirect-tok-2', 'Bearer good-tok-3']);

  const allFailed = await checkStarStatus({
    getConfigToken: () => 'bad-1',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: { GITHUB_TOKEN: 'bad-2' },
    fetchImpl: async (_url, options) => (
      options.headers.Authorization === 'Bearer bad-1'
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 403 })
    ),
  });
  assert.deepEqual(allFailed, { status: 'auth-failed' });

  const netErr = await checkStarStatus({
    getConfigToken: () => 'secret-tok-never-leak',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED secret-tok-never-leak');
    },
  });
  assert.deepEqual(netErr, { status: 'network-error' });
  assert.equal(JSON.stringify(netErr).includes('secret-tok-never-leak'), false);

  const serverErr = await checkStarStatus({
    getConfigToken: () => 'tok-500',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async () => new Response(null, { status: 503 }),
  });
  assert.deepEqual(serverErr, { status: 'network-error' });
});

test('starRepository handles PUT Content-Length 0, 204/304 success, 401/403 fallback, and failures', async () => {
  const noCreds = await starRepository({
    getConfigToken: () => '',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
  });
  assert.deepEqual(noCreds, { ok: false, reason: 'no-credentials' });

  /** @type {any[]} */
  const seenOptions = [];
  const ok204 = await starRepository({
    getConfigToken: () => 'tok-star',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async (_url, options) => {
      seenOptions.push(options);
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(ok204, { ok: true });
  assert.equal(seenOptions[0].method, 'PUT');
  assert.equal(seenOptions[0].redirect, 'manual');
  assert.equal(seenOptions[0].headers['Content-Length'], '0');

  const ok304 = await starRepository({
    getConfigToken: () => 'tok-bad',
    runCmd: async () => ({ code: 0, stdout: 'tok-304' }),
    env: {},
    fetchImpl: async (_url, options) => (
      options.headers.Authorization === 'Bearer tok-bad'
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 304 })
    ),
  });
  assert.deepEqual(ok304, { ok: true });

  const authFailed = await starRepository({
    getConfigToken: () => 'tok-1',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: { GITHUB_TOKEN: 'tok-2' },
    fetchImpl: async () => new Response(null, { status: 403 }),
  });
  assert.deepEqual(authFailed, { ok: false, reason: 'auth-failed' });

  const reqFailed = await starRepository({
    getConfigToken: () => 'tok-1',
    runCmd: async () => ({ code: 1, stdout: '' }),
    env: {},
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(reqFailed, { ok: false, reason: 'request-failed' });
});

test('controller gates 5s idle timer on window state, overlay, harness load, and config persistence', async () => {
  // Unfocused / minimized / hidden / overlay-blocked / harness-not-loaded -> no timer armed
  for (const scenario of [
    { win: createFakeWindow({ focused: false }) },
    { win: createFakeWindow({ minimized: true }) },
    { win: createFakeWindow({ visible: false }) },
    { overlayBlocked: true },
    { harnessLoaded: false },
    {
      config: {
        locale: 'zh',
        starPrompt: { starredAt: '2026-01-01T00:00:00.000Z', dismissedForever: false, snoozedUntil: '' },
      },
    },
    {
      config: {
        locale: 'zh',
        starPrompt: { starredAt: '', dismissedForever: true, snoozedUntil: '' },
      },
    },
    {
      now: 1_700_000_000_000,
      config: {
        locale: 'zh',
        starPrompt: {
          starredAt: '',
          dismissedForever: false,
          snoozedUntil: new Date(1_700_000_060_000).toISOString(),
        },
      },
    },
  ]) {
    const h = createControllerHarness(scenario);
    h.controller.attachMainWindow(h.win);
    assert.equal(h.timers.count(), 0);
    h.controller.recordActivity();
    assert.equal(h.timers.count(), 0);
    h.controller.dispose();
  }

  // Expired snoozedUntil becomes eligible again
  const expired = createControllerHarness({
    now: 1_700_000_100_000,
    config: {
      locale: 'en',
      starPrompt: {
        starredAt: '',
        dismissedForever: false,
        snoozedUntil: new Date(1_700_000_000_000).toISOString(),
      },
    },
  });
  expired.controller.attachMainWindow(expired.win);
  assert.deepEqual(expired.timers.entries().map((e) => e.ms), [IDLE_THRESHOLD_MS]);
  await expired.timers.fireNext();
  assert.deepEqual(expired.controller.getView(), {
    visible: true,
    phase: 'visible',
    mode: 'direct',
    locale: 'en',
    errorCode: '',
  });
  expired.controller.dispose();
});

test('controller resets 5s timer on activity while hidden, ignores activity once visible, and handles blur/minimize', async () => {
  let statusCalls = 0;
  const h = createControllerHarness({
    checkStarStatus: async () => {
      statusCalls += 1;
      return { status: 'unstarred' };
    },
  });

  h.controller.attachMainWindow(h.win);
  assert.equal(h.timers.count(), 1);
  const firstTimerId = h.timers.entries()[0].id;

  // Activity while hidden replaces the 5s timer
  h.controller.recordActivity();
  assert.equal(h.timers.count(), 1);
  assert.notEqual(h.timers.entries()[0].id, firstTimerId);

  // Blur cancels timer; focus re-arms
  h.win.setState({ focused: false });
  h.win.emit('blur');
  assert.equal(h.timers.count(), 0);

  h.win.setState({ focused: true });
  h.win.emit('focus');
  assert.equal(h.timers.count(), 1);

  await h.timers.fireNext();
  assert.equal(statusCalls, 1);
  assert.equal(h.controller.getView().visible, true);
  assert.equal(h.controller.getView().phase, 'visible');
  assert.equal(h.controller.getView().mode, 'direct');

  // Activity while visible does NOT dismiss or re-arm
  h.controller.recordActivity();
  assert.equal(h.controller.getView().visible, true);
  assert.equal(h.timers.count(), 0);

  // Minimize hides card cleanly without setting snoozedUntil
  h.win.setState({ minimized: true });
  h.win.emit('minimize');
  assert.equal(h.controller.getView().visible, false);
  assert.equal(h.controller.getView().phase, 'hidden');
  assert.equal(h.getConfig().starPrompt.snoozedUntil, '');

  // Restore re-arms and uses cached status without calling checkStarStatus again
  h.win.setState({ minimized: false, focused: true });
  h.win.emit('restore');
  assert.equal(h.timers.count(), 1);
  await h.timers.fireNext();
  assert.equal(statusCalls, 1);
  assert.equal(h.controller.getView().visible, true);

  h.controller.dispose();
});

test('controller handles starred, no-credentials/auth-failed browser mode, and network-error retry', async () => {
  // 1. Already starred on GitHub -> persist starredAt, keep hidden
  const starredHarness = createControllerHarness({
    checkStarStatus: async () => ({ status: 'starred' }),
  });
  starredHarness.controller.attachMainWindow(starredHarness.win);
  await starredHarness.timers.fireNext();
  assert.equal(starredHarness.controller.getView().visible, false);
  assert.ok(starredHarness.getConfig().starPrompt.starredAt);
  starredHarness.controller.dispose();

  // 2. no-credentials -> browser mode
  const noCredHarness = createControllerHarness({
    checkStarStatus: async () => ({ status: 'no-credentials' }),
  });
  noCredHarness.controller.attachMainWindow(noCredHarness.win);
  await noCredHarness.timers.fireNext();
  assert.deepEqual(noCredHarness.controller.getView(), {
    visible: true,
    phase: 'visible',
    mode: 'browser',
    locale: 'zh',
    errorCode: '',
  });
  noCredHarness.controller.dispose();

  // 3. network-error is NOT cached permanently and retries on next idle cycle
  let attempt = 0;
  const retryHarness = createControllerHarness({
    checkStarStatus: async () => {
      attempt += 1;
      return attempt === 1 ? { status: 'network-error' } : { status: 'auth-failed' };
    },
  });
  retryHarness.controller.attachMainWindow(retryHarness.win);
  await retryHarness.timers.fireNext();
  assert.equal(retryHarness.controller.getView().visible, false);
  retryHarness.controller.recordActivity();
  await retryHarness.timers.fireNext();
  assert.equal(attempt, 2);
  assert.equal(retryHarness.controller.getView().visible, true);
  assert.equal(retryHarness.controller.getView().mode, 'browser');
  retryHarness.controller.dispose();
});

test('controller direct star success shows success phase then auto-hides after 2000ms without leaking tokens', async () => {
  const secretToken = 'ghp_super_secret_token_value';
  const h = createControllerHarness({
    config: {
      locale: 'zh',
      githubToken: secretToken,
      starPrompt: { starredAt: '', dismissedForever: false, snoozedUntil: '' },
    },
    starRepository: async () => ({ ok: true }),
  });
  h.controller.attachMainWindow(h.win);
  await h.timers.fireNext();

  const res = await h.controller.handleAction({ type: 'star' });
  assert.deepEqual(res, { ok: true });
  assert.equal(h.controller.getView().phase, 'success');
  assert.equal(h.controller.getView().visible, true);
  assert.ok(h.getConfig().starPrompt.starredAt);

  // 2000ms auto-hide
  assert.deepEqual(h.timers.entries().map((e) => e.ms), [SUCCESS_HIDE_DELAY_MS]);
  await h.timers.fireByDelay(SUCCESS_HIDE_DELAY_MS);
  assert.equal(h.controller.getView().visible, false);
  assert.equal(h.controller.getView().phase, 'hidden');

  // Verify pushed IPC payloads & logs never contain the token
  assert.ok(h.wc.sent.length >= 3);
  assert.ok(h.wc.sent.every((item) => item.channel === STAR_PROMPT_CHANNEL));
  const serializedAll = JSON.stringify({ sent: h.wc.sent, logs: h.logs });
  assert.equal(serializedAll.includes(secretToken), false);
  h.controller.dispose();
});

test('controller direct star failure falls back to browser error state and handles open-browser / snooze / dismiss-forever', async () => {
  const h1 = createControllerHarness({
    starRepository: async () => ({ ok: false, reason: 'auth-failed' }),
  });
  h1.controller.attachMainWindow(h1.win);
  await h1.timers.fireNext();

  await assert.rejects(() => h1.controller.handleAction({ type: 'bogus' }), TypeError);

  const failRes = await h1.controller.handleAction({ type: 'star' });
  assert.deepEqual(failRes, { ok: false, errorCode: 'auth-failed' });
  assert.deepEqual(h1.controller.getView(), {
    visible: true,
    phase: 'error',
    mode: 'browser',
    locale: 'zh',
    errorCode: 'auth-failed',
  });

  // Clicking primary action again in browser mode opens repo in external browser & snoozes 7 days
  await h1.controller.handleAction({ type: 'star' });
  assert.deepEqual(h1.openedUrls, [REPO_URL]);
  assert.equal(h1.controller.getView().visible, false);
  assert.equal(
    Date.parse(h1.getConfig().starPrompt.snoozedUntil),
    1_700_000_000_000 + SNOOZE_DURATION_MS,
  );
  // Session latch prevents re-arming even if snooze were cleared in-memory
  h1.controller.recordActivity();
  assert.equal(h1.timers.count(), 0);
  h1.controller.dispose();

  // Snooze action
  const h2 = createControllerHarness();
  h2.controller.attachMainWindow(h2.win);
  await h2.timers.fireNext();
  await h2.controller.handleAction({ type: 'snooze' });
  assert.equal(h2.controller.getView().visible, false);
  assert.equal(
    Date.parse(h2.getConfig().starPrompt.snoozedUntil),
    1_700_000_000_000 + SNOOZE_DURATION_MS,
  );
  h2.controller.dispose();

  // Dismiss forever action
  const h3 = createControllerHarness();
  h3.controller.attachMainWindow(h3.win);
  await h3.timers.fireNext();
  await h3.controller.handleAction({ type: 'dismiss-forever' });
  assert.equal(h3.controller.getView().visible, false);
  assert.equal(h3.getConfig().starPrompt.dismissedForever, true);
  h3.controller.dispose();
});

test('syncConfig updates locale live, clears/re-arms timer on overlay block, and dispose cleans up listeners', async () => {
  const h = createControllerHarness();
  h.controller.attachMainWindow(h.win);
  assert.equal(h.timers.count(), 1);

  h.setOverlayBlocked(true);
  h.setConfig({ ...h.getConfig(), locale: 'en' });
  h.controller.syncConfig(h.getConfig());
  assert.equal(h.timers.count(), 0);
  assert.equal(h.controller.getView().locale, 'en');

  h.setOverlayBlocked(false);
  h.controller.syncConfig();
  assert.equal(h.timers.count(), 1);

  await h.timers.fireNext();
  assert.equal(h.controller.getView().locale, 'en');

  h.setConfig({ ...h.getConfig(), locale: 'zh' });
  h.controller.syncConfig(h.getConfig());
  assert.equal(h.controller.getView().locale, 'zh');
  assert.equal(h.wc.sent.at(-1).payload.locale, 'zh');

  h.controller.dispose();
  assert.equal(h.timers.count(), 0);
  for (const eventName of ['focus', 'show', 'restore', 'blur', 'minimize', 'hide', 'closed']) {
    assert.equal(h.win.listenerCount(eventName), 0);
  }
});

test('window hide during success auto-hide resets to hidden without re-showing, and activity during in-flight check cancels popup', async () => {
  // Activity during in-flight check cancels popup for stale cycle
  let resolveCheck;
  const h1 = createControllerHarness({
    checkStarStatus: () => new Promise((resolve) => { resolveCheck = resolve; }),
  });
  h1.controller.attachMainWindow(h1.win);
  const firePromise = h1.timers.fireNextNoAwait();
  h1.controller.recordActivity();
  resolveCheck({ status: 'unstarred' });
  await firePromise;
  assert.equal(h1.controller.getView().visible, false);
  assert.equal(h1.timers.count(), 1);
  h1.controller.dispose();

  // Hide during success auto-hide resets cleanly
  const h2 = createControllerHarness({
    starRepository: async () => ({ ok: true }),
  });
  h2.controller.attachMainWindow(h2.win);
  await h2.timers.fireNext();
  await h2.controller.handleAction({ type: 'star' });
  assert.equal(h2.controller.getView().phase, 'success');
  assert.equal(h2.timers.count(), 1);

  h2.win.setState({ visible: false });
  h2.win.emit('hide');
  assert.equal(h2.controller.getView().visible, false);
  assert.equal(h2.controller.getView().phase, 'hidden');
  assert.equal(h2.timers.count(), 0);
  h2.controller.dispose();
});
