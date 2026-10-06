const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { HarnessController } = require('./harness-controller');
const { DshManager } = require('./dsh');

class FakeClock {
  constructor() {
    this.time = 10_000;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout = (fn, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, fn });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  async tick(ms) {
    const end = this.time + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) {
        break;
      }
      const [id, timer] = due;
      this.timers.delete(id);
      this.time = timer.at;
      timer.fn();
      await settle();
    }
    this.time = end;
    await settle();
  }
}

class FakeDsh extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle';
    this.error = '';
    this.failure = null;
    this.baseUrl = '';
    this.port = 3080;
    this.logs = [];
    this.startCalls = 0;
    this.stopCalls = 0;
    this.startResults = [];
    this.startOptions = [];
  }

  snapshot() {
    return {
      state: this.state,
      error: this.error,
      failure: this.failure,
      baseUrl: this.baseUrl,
      logs: [...this.logs],
    };
  }

  setState(state, extra = {}) {
    this.state = state;
    if (Object.prototype.hasOwnProperty.call(extra, 'error')) this.error = extra.error;
    if (Object.prototype.hasOwnProperty.call(extra, 'failure')) this.failure = extra.failure;
    if (Object.prototype.hasOwnProperty.call(extra, 'baseUrl')) this.baseUrl = extra.baseUrl;
    this.emit('state', this.snapshot());
  }

  log(line, source = 'app') {
    const entry = `[${source}] ${line}`;
    this.logs.push(entry);
    this.emit('log', entry);
  }

  async start(options = {}) {
    this.startCalls += 1;
    this.startOptions.push(options);
    const result = this.startResults.length ? this.startResults.shift() : 'http://127.0.0.1:3080';
    if (result instanceof Error) {
      if (result.pluginTree) this.log('plugin tree failed to load', 'dsh');
      this.setState('error', {
        error: result.message,
        failure: { phase: 'startup', message: result.message },
      });
      throw result;
    }
    this.setState('ready', { baseUrl: result, error: '', failure: null });
    return result;
  }

  async stop() {
    this.stopCalls += 1;
    this.setState('idle', { error: '', failure: null });
  }

  crash(message = 'dsh exited') {
    this.setState('error', {
      error: message,
      failure: {
        phase: 'runtime',
        message,
        code: 1,
        signal: null,
        occurredAt: Date.now(),
      },
    });
  }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fixture(overrides = {}) {
  const clock = new FakeClock();
  const dsh = new FakeDsh();
  const events = [];
  const window = {
    url: 'file:///boot.html',
    webContents: {
      openDevTools: () => events.push('devtools'),
      getURL: () => window.url,
    },
    loadURL: async (url) => {
      window.url = url;
      events.push(`reload:${url}`);
    },
  };
  let config = {
    workspace: 'C:/workspace',
    harnessAutoRestart: true,
    harnessRestartMaxAttempts: 3,
    harnessRestartBaseDelayMs: 1000,
    openDevTools: false,
    pluginRecovery: { skipUserPlugins: false, reason: '', at: '', appVersion: '' },
  };
  if (overrides.initialConfig) {
    config = { ...config, ...overrides.initialConfig };
  }
  const remote = {
    syncCalls: 0,
    stopCalls: 0,
    async sync() {
      this.syncCalls += 1;
      events.push('remote:sync');
    },
    // Real face is DshdRemote: teardown is stopDaemon(), not stop().
    async stopDaemon() {
      this.stopCalls += 1;
      events.push('remote:stop');
    },
  };
  const controller = new HarnessController({
    dsh,
    remote,
    loadConfig: () => config,
    createMainWindow: () => window,
    getMainWindow: () => window,
    showBoot: async () => {
      window.url = 'file:///boot.html';
      events.push('boot');
    },
    showHarness: async (url) => {
      window.url = url;
      events.push(`harness:${url}`);
    },
    sendToBoot: (channel, payload) => events.push(`${channel}:${payload?.recovery?.status || payload?.state || payload}`),
    isBootLoaded: (win) => win.url.includes('boot.html'),
    resolveLaunchTarget: async () => ({ port: 3080 }),
    stripDroppedPlugins: () => {},
    ensureWorkspace: async () => {},
    saveConfig: (patch) => {
      config = { ...config, ...patch };
    },
    appVersion: '1.2.3',
    setTimer: clock.setTimeout,
    clearTimer: clock.clearTimeout,
    now: () => clock.time,
    stableMs: 60_000,
    ...overrides,
  });
  return {
    clock,
    dsh,
    events,
    window,
    remote,
    controller,
    setConfig(patch) {
      config = { ...config, ...patch };
    },
  };
}

test('writes the desktop install plugin before launching Harness', async () => {
  const calls = [];
  const f = fixture({
    ensureDesktopInstallPlugin: () => {
      calls.push('ensure');
    },
  });
  await f.controller.start();
  assert.deepEqual(calls, ['ensure']);
});

test('missing selected optional provider uses visible recovery and resumes after installation', async () => {
  let installed = false;
  const provider = '@deepseek-ai/dsh-subagent-claude-code';
  const f = fixture({
    healDanglingBundles: () => ({ ok: true, removed: [], requiresInstall: installed ? [] : [provider] }),
  });
  await f.controller.start();
  assert.equal(f.dsh.startCalls, 1);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
  assert.match(f.controller.snapshot().pluginRecovery.reason, /已保留所选 Codex\/Claude 插件配置/);
  assert.match(f.controller.snapshot().pluginRecovery.reason, /dsh plugin --profile web add @deepseek-ai\/dsh-subagent-claude-code/);
  installed = true;
  await f.controller.retryFullPlugins();
  assert.equal(f.dsh.startOptions.at(-1).skipUserPlugins, false);
  assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, false);
});

test('cleans dshmarket preset residue after the desktop install plugin and before Harness start', async () => {
  const order = [];
  const f = fixture({
    ensureDesktopInstallPlugin: () => {
      order.push('desktop-install');
      return { ok: true };
    },
    removeDshMarketPreset: async () => {
      order.push('dshmarket-cleanup');
      return { ok: true, changed: true, stripped: true };
    },
  });
  const origStart = f.dsh.start.bind(f.dsh);
  f.dsh.start = async (options) => {
    order.push('start');
    return origStart(options);
  };
  await f.controller.start();
  assert.deepEqual(order, ['desktop-install', 'dshmarket-cleanup', 'start']);
  assert.ok(f.dsh.logs.some((line) => /已清理 dshmarket 桌面预置残留/.test(line)));
});

test('logs and continues when the dshmarket residue cleanup fails', async () => {
  const f = fixture({
    removeDshMarketPreset: async () => ({ ok: false, error: 'stuck-link' }),
  });
  await f.controller.start();
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(f.dsh.logs.some((line) => /dshmarket/.test(line) && /stuck-link/.test(line)));
});

test('skip-user-plugins start still cleans dshmarket preset residue', async () => {
  const order = [];
  const f = fixture({
    removeDshMarketPreset: async () => {
      order.push('dshmarket-cleanup');
      return { ok: true, changed: false };
    },
  });
  f.controller.writePluginSkip(new Error('recovery'));
  await f.controller.start();
  assert.deepEqual(order, ['dshmarket-cleanup']);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
});

test('default start cleans legacy dshbot residue then mounts the built-in overlay', async () => {
  const order = [];
  const botOverlay = 'C:/profiles/web/desktop-plugins/dshbot/desktop-dshbot.patch.yml';
  let botArgs = null;
  const f = fixture({
    initialConfig: { dshbotEnabled: true },
    ensureDshbotPlugin: async (options) => {
      botArgs = options;
      order.push('dshbot-ensure');
      return { ok: true, added: true, overlayFile: botOverlay };
    },
    removeLegacyDshbotPreset: async () => {
      order.push('dshbot-cleanup');
      return { ok: true, changed: true, stripped: true };
    },
  });
  await f.controller.start();
  assert.deepEqual(order, ['dshbot-cleanup', 'dshbot-ensure']);
  assert.deepEqual(botArgs, { enabled: true });
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(f.dsh.startOptions[0].patchFiles.includes(botOverlay));
  assert.ok(f.dsh.logs.some((line) => /已清理 dshbot 旧版预置残留/.test(line)));
  assert.ok(f.dsh.logs.some((line) => /桌面内置 dshbot/.test(line)));
});

test('dshbotEnabled defaults off: ensure is called with enabled:false and no overlay mounts', async () => {
  let botArgs = null;
  const f = fixture({
    ensureDshbotPlugin: async (options) => {
      botArgs = options;
      return { ok: true, added: false, disabled: true };
    },
  });
  await f.controller.start();
  assert.deepEqual(botArgs, { enabled: false });
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(!f.dsh.startOptions[0].patchFiles.some((file) => /dshbot/.test(file)));
  assert.ok(f.dsh.logs.some((line) => /桌面内置 dshbot 已按设置关闭/.test(line)));
});

test('obsolete dshbotPreset config does not change the built-in mount', async () => {
  const order = [];
  const f = fixture({
    initialConfig: { dshbotPreset: true },
    ensureDesktopInstallPlugin: () => {
      order.push('desktop-install');
      return { ok: true };
    },
    removeDshMarketPreset: async () => {
      order.push('dshmarket-cleanup');
      return { ok: true, changed: false };
    },
    ensureUsagePanelPlugin: async () => {
      order.push('usage-panel');
      return { ok: true, added: true };
    },
    ensureDshImPlugin: async () => {
      order.push('dsh-im');
      return { ok: true, added: true };
    },
    ensureDshbotPlugin: async () => {
      order.push('dshbot-ensure');
      return { ok: true, added: true };
    },
    removeLegacyDshbotPreset: async () => {
      order.push('dshbot-cleanup');
      return { ok: true, changed: false };
    },
    applyDisabledBundles: () => {
      order.push('disabled-bundles');
      return { ok: true, changed: false };
    },
  });
  const origStart = f.dsh.start.bind(f.dsh);
  f.dsh.start = async (options) => {
    order.push('start');
    return origStart(options);
  };
  await f.controller.start();
  assert.deepEqual(order, ['desktop-install', 'dshmarket-cleanup', 'usage-panel', 'dsh-im', 'dshbot-cleanup', 'dshbot-ensure', 'disabled-bundles', 'start']);
  assert.ok(!f.dsh.logs.some((line) => /已预置 dshbot（开发模式）/.test(line)));
});

test('skip-user-plugins still wires built-in dshbot (every start rides it)', async () => {
  const order = [];
  const botOverlay = 'C:/profiles/web/desktop-plugins/dshbot/desktop-dshbot.patch.yml';
  let botArgs = null;
  const f = fixture({
    initialConfig: { dshbotPreset: true, dshbotEnabled: true },
    ensureDshbotPlugin: async (options) => {
      botArgs = options;
      order.push('dshbot-ensure');
      return { ok: true, added: true, overlayFile: botOverlay };
    },
    removeLegacyDshbotPreset: async () => {
      order.push('dshbot-cleanup');
      return { ok: true, changed: false };
    },
  });
  f.controller.writePluginSkip(new Error('recovery'));
  await f.controller.start();
  assert.deepEqual(order, ['dshbot-cleanup', 'dshbot-ensure']);
  assert.deepEqual(botArgs, { enabled: true });
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
  assert.ok(f.dsh.startOptions[0].patchFiles.includes(botOverlay));
});

test('a failed usage-panel ensure blocks Harness start (desktop runtime damage)', async () => {
  const f = fixture({
    ensureUsagePanelPlugin: async () => ({ ok: false, error: 'missing-zod' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置用量统计失败/);
      assert.match(String(error.message), /missing-zod/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('skip-user-plugins still wires first-party usage-panel and dsh-im', async () => {
  const order = [];
  const usageOverlay = 'C:/profiles/web/desktop-plugins/dsh-usage-panel/desktop-usage-panel.patch.yml';
  const imOverlay = 'C:/profiles/web/desktop-plugins/dsh-im/desktop-dsh-im.patch.yml';
  const f = fixture({
    ensureUsagePanelPlugin: async () => {
      order.push('usage-panel');
      return { ok: true, added: false, overlayFile: usageOverlay };
    },
    ensureDshImPlugin: async () => {
      order.push('dsh-im');
      return { ok: true, added: false, overlayFile: imOverlay };
    },
  });
  f.controller.writePluginSkip(new Error('recovery'));
  await f.controller.start();
  assert.deepEqual(order, ['usage-panel', 'dsh-im']);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
  assert.ok(f.dsh.startOptions[0].patchFiles.includes(usageOverlay));
  assert.ok(f.dsh.startOptions[0].patchFiles.includes(imOverlay));
  assert.ok(f.dsh.logs.some((line) => /桌面内置用量统计/.test(line)));
  assert.ok(f.dsh.logs.some((line) => /桌面内置 dsh-im/.test(line)));
});

test('a failed Office runtime ensure blocks Harness start (desktop runtime damage)', async () => {
  const f = fixture({
    ensureDesktopOfficeRuntime: async () => ({ ok: false, error: 'missing-payload' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置 Office 运行时失败/);
      assert.match(String(error.message), /missing-payload/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('Office overlay rides full and skip-user-plugins starts', async () => {
  const officeOverlay = 'C:/profiles/web/desktop-plugins/office/desktop-office.patch.yml';
  for (const skipUserPlugins of [false, true]) {
    const f = fixture({
      ensureDesktopOfficeRuntime: async () => ({ ok: true, present: true, overlayFile: officeOverlay }),
    });
    if (skipUserPlugins) f.controller.writePluginSkip(new Error('recovery'));
    await f.controller.start();
    assert.equal(f.dsh.startOptions[0].skipUserPlugins, skipUserPlugins);
    assert.ok(f.dsh.startOptions[0].patchFiles.includes(officeOverlay));
    assert.ok(f.dsh.logs.some((line) => /Office/.test(line)));
  }
});

test('an explicitly disabled Office runtime mounts no overlay but still starts', async () => {
  const f = fixture({
    ensureDesktopOfficeRuntime: async () => ({ ok: true, disabled: true, present: false }),
  });
  await f.controller.start();
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(!f.dsh.startOptions[0].patchFiles.some((file) => /office/.test(file)));
  assert.ok(f.dsh.logs.some((line) => /Office.*关闭/.test(line)));
});

test('dsh-im failure blocks Harness start', async () => {
  const f = fixture({
    ensureDshImPlugin: async () => ({ ok: false, error: 'missing-source:node_modules:zod' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置 dsh-im 失败/);
      assert.match(String(error.message), /missing-source/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('dshbot failure blocks Harness start (desktop runtime damage)', async () => {
  const f = fixture({
    ensureDshbotPlugin: async () => ({ ok: false, error: 'missing-source:package.json' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置 dshbot 失败/);
      assert.match(String(error.message), /missing-source/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('logs and continues when legacy preset cleanup fails', async () => {
  const f = fixture({
    initialConfig: { dshbotPreset: true },
    removeLegacyDshbotPreset: async () => ({ ok: false, error: 'locked-preset' }),
  });
  await f.controller.start();
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(f.dsh.logs.some((line) => /清理 dshbot 预置残留失败/.test(line) && /locked-preset/.test(line)));
});

test('current-start evidence opens before preparation and does not revive an old plugin failure', async (t) => {
  for (const phase of ['preparation', 'window']) {
    await t.test(phase, async (t) => {
      const dsh = new DshManager({ loadConfig: () => ({ workspace: 'C:/workspace' }) });
      const previousError = 'plugin tree failed to load: old-user-pack';
      dsh.log(previousError, 'dsh');
      dsh.setState('error', { error: previousError, failure: { phase: 'startup', message: previousError } });
      let prepares = 0;
      let windows = 0;
      let starts = 0;
      const message = phase === 'window' ? 'window creation failed' : 'invalid workspace path';
      const assertFreshAttempt = () => {
        assert.deepEqual(dsh.currentStartLogs(), []);
        assert.equal(dsh.snapshot().error, '');
        assert.equal(dsh.snapshot().failure, null);
      };
      dsh.start = async () => { starts += 1; return 'http://127.0.0.1:3080'; };
      const f = fixture({
        dsh,
        ...(phase === 'window' ? {
          createMainWindow: () => {
            windows += 1;
            assertFreshAttempt();
            throw new Error(message);
          },
        } : {}),
        resolveLaunchTarget: async () => {
          prepares += 1;
          assertFreshAttempt();
          dsh.log('preparation failed: invalid workspace path');
          throw new Error(message);
        },
      });
      t.after(() => f.controller.shutdown());
      await assert.rejects(f.controller.start(), { message });
      assert.equal(prepares, phase === 'preparation' ? 1 : 0, 'old plugin evidence must not trigger a skip preparation');
      assert.equal(windows, phase === 'window' ? 1 : 0, 'window failure must not trigger a second skip attempt');
      assert.equal(starts, 0);
      assert.equal(f.controller.pluginRecovery.skipUserPlugins, false);
      assert.equal(dsh.snapshot().error, message);
      assert.equal(dsh.snapshot().failure.message, message);
      assert.ok(dsh.currentStartLogs().some((line) => line.includes(message)));
      assert.ok(dsh.logs.some((line) => line.includes('old-user-pack')));
      assert.equal(dsh.currentStartLogs().some((line) => line.includes('old-user-pack')), false);
    });
  }
});

test('current-start evidence retains the failed full boot when skip starts a second log boundary', async (t) => {
  const report = 'web boot: 1 entry did not activate\nuser-pack: import failed (see console for the import error)';
  const dsh = new DshManager({ loadConfig: () => ({ workspace: 'C:/workspace' }) });
  dsh.log('listen EADDRINUSE from an earlier attempt', 'error');
  const starts = [];
  dsh.start = async (options) => {
    starts.push(options.skipUserPlugins);
    if (!options.skipUserPlugins) {
      dsh.log(report, 'error');
      throw new Error(report);
    }
    dsh.log('skip boot is healthy');
    dsh.setState('ready', { baseUrl: 'http://127.0.0.1:3080', error: '', failure: null });
    return 'http://127.0.0.1:3080';
  };
  const f = fixture({ dsh });
  t.after(() => f.controller.shutdown());
  await f.controller.start();
  assert.deepEqual(starts, [false, true]);
  assert.ok(dsh.currentStartLogs().some((line) => line.includes('skip boot is healthy')));
  assert.equal(dsh.currentStartLogs().some((line) => line.includes('user-pack')), false);
  const recovery = f.controller.pluginRecovery;
  assert.equal(recovery.skipUserPlugins, true);
  assert.equal(recovery.reason, report);
  assert.ok(recovery.logTail.includes('web boot: 1 entry did not activate'));
  assert.ok(recovery.logTail.includes('user-pack: import failed (see console for the import error)'));
  assert.equal(recovery.logTail.some((line) => line.includes('EADDRINUSE')), false);
  assert.equal(recovery.logTail.some((line) => line.includes('skip boot is healthy')), false);
});

test('plugin-tree startup failure retries once with the desktop overlay on both rounds', async () => {
  const first = Object.assign(new Error('dsh exited'), { pluginTree: true });
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({
      ok: true,
      patchFile: 'C:/profiles/web/cordis.patch.yml',
      overlayFile: installOverlay,
    }),
  });
  f.dsh.startResults.push(first);
  await f.controller.start();

  assert.equal(f.dsh.startCalls, 2);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, false);
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, [installOverlay]);
  assert.equal(f.dsh.startOptions[1].skipUserPlugins, true);
  // Never the profile's own cordis.patch.yml: --patch overlays still apply
  // under --skip-user-plugins, so that file would resurrect the user layer.
  assert.deepEqual(f.dsh.startOptions[1].patchFiles, [installOverlay]);
  assert.equal(f.controller.snapshot().pluginRecovery.skipUserPlugins, true);
});

test('full start rides the usage overlay after the install overlay; skip start also rides it', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const usageOverlay = 'C:/profiles/web/desktop-plugins/dsh-usage-panel/desktop-usage-panel.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureUsagePanelPlugin: async () => ({ ok: true, added: false, overlayFile: usageOverlay }),
  });
  await f.controller.start();
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, [installOverlay, usageOverlay]);

  const skipped = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureUsagePanelPlugin: async () => ({ ok: true, added: false, overlayFile: usageOverlay }),
  });
  skipped.controller.writePluginSkip(new Error('recovery'));
  await skipped.controller.start();
  assert.equal(skipped.dsh.startOptions[0].skipUserPlugins, true);
  assert.deepEqual(skipped.dsh.startOptions[0].patchFiles, [installOverlay, usageOverlay]);
});

test('full start rides the session-search overlay; skip start drops it', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const searchOverlay = 'C:/profiles/web/desktop-plugins/session-search/desktop-session-search.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureSessionSearchOverlay: async () => ({ ok: true, overlayFile: searchOverlay }),
  });
  await f.controller.start();
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, [installOverlay, searchOverlay]);

  const skipped = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureSessionSearchOverlay: async () => ({ ok: true, overlayFile: searchOverlay }),
  });
  skipped.controller.writePluginSkip(new Error('recovery'));
  await skipped.controller.start();
  assert.equal(skipped.dsh.startOptions[0].skipUserPlugins, true);
  assert.deepEqual(skipped.dsh.startOptions[0].patchFiles, [installOverlay]);
});

test('a failed session-search ensure never contributes a stale overlay path', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureSessionSearchOverlay: async () => ({ ok: false, error: 'missing-home', overlayFile: 'C:/stale.yml' }),
  });
  await f.controller.start();
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, [installOverlay]);
});

test('dsh-im, usage-panel, market, dshbot, and remote overlays ride --patch on full and skip starts', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const usageOverlay = 'C:/profiles/web/desktop-plugins/dsh-usage-panel/desktop-usage-panel.patch.yml';
  const imOverlay = 'C:/profiles/web/desktop-plugins/dsh-im/desktop-dsh-im.patch.yml';
  const marketOverlay = 'C:/profiles/web/desktop-plugins/dsh-market/desktop-dsh-market.patch.yml';
  const botOverlay = 'C:/profiles/web/desktop-plugins/dshbot/desktop-dshbot.patch.yml';
  const remoteOverlay = 'C:/profiles/web/desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureUsagePanelPlugin: async () => ({ ok: true, added: false, overlayFile: usageOverlay }),
    ensureDshImPlugin: async () => ({ ok: true, added: false, overlayFile: imOverlay }),
    ensureDesktopMarket: async () => ({ ok: true, added: false, overlayFile: marketOverlay }),
    ensureDshbotPlugin: async () => ({ ok: true, added: false, overlayFile: botOverlay }),
    ensureDshRemotePlugin: async (options) => {
      assert.deepEqual(options, { enabled: true });
      return { ok: true, added: false, overlayFile: remoteOverlay };
    },
  });
  await f.controller.start();
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, [installOverlay, usageOverlay, imOverlay, marketOverlay, botOverlay, remoteOverlay]);

  const skipped = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureUsagePanelPlugin: async () => ({ ok: true, added: false, overlayFile: usageOverlay }),
    ensureDshImPlugin: async () => ({ ok: true, added: false, overlayFile: imOverlay }),
    ensureDesktopMarket: async () => ({ ok: true, added: false, overlayFile: marketOverlay }),
    ensureDshbotPlugin: async () => ({ ok: true, added: false, overlayFile: botOverlay }),
    ensureDshRemotePlugin: async (options) => {
      assert.deepEqual(options, { enabled: true });
      return { ok: true, added: false, overlayFile: remoteOverlay };
    },
  });
  skipped.controller.writePluginSkip(new Error('recovery'));
  await skipped.controller.start();
  assert.equal(skipped.dsh.startOptions[0].skipUserPlugins, true);
  assert.deepEqual(skipped.dsh.startOptions[0].patchFiles, [installOverlay, usageOverlay, imOverlay, marketOverlay, botOverlay, remoteOverlay]);
});

test('remote workspace can be disabled without mounting its overlay', async () => {
  const remoteOverlay = 'C:/profiles/web/desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml';
  let args;
  const f = fixture({
    initialConfig: { remoteWorkspaceEnabled: false },
    ensureDshRemotePlugin: async (options) => {
      args = options;
      return { ok: true, added: false, disabled: true };
    },
  });
  await f.controller.start();
  assert.deepEqual(args, { enabled: false });
  assert.equal(f.dsh.startCalls, 1);
  assert.ok(!f.dsh.startOptions[0].patchFiles.includes(remoteOverlay));
  assert.ok(f.dsh.logs.some((line) => /dsh-remote 已按设置关闭/.test(line)));
});

test('remote workspace is ensured before disabled bundles and Harness spawn', async () => {
  const events = [];
  const remoteOverlay = 'C:/profiles/web/desktop-plugins/dsh-remote/desktop-dsh-remote.patch.yml';
  const f = fixture({
    ensureDshRemotePlugin: async () => {
      events.push('remote');
      return { ok: true, overlayFile: remoteOverlay };
    },
    applyDisabledBundles: () => {
      events.push('disabled-bundles');
      return { ok: true, changed: false };
    },
  });
  const start = f.dsh.start.bind(f.dsh);
  f.dsh.start = async (options) => {
    events.push('start');
    return start(options);
  };
  await f.controller.start();
  assert.ok(events.indexOf('remote') >= 0);
  assert.ok(events.indexOf('remote') < events.indexOf('disabled-bundles'));
  assert.ok(events.indexOf('disabled-bundles') < events.indexOf('start'));
  assert.ok(f.dsh.startOptions[0].patchFiles.includes(remoteOverlay));
});

test('broken enabled remote runtime fails closed on full and skip starts', async () => {
  for (const skipUserPlugins of [false, true]) {
    const f = fixture({
      ensureDshRemotePlugin: async () => ({
        ok: false,
        error: 'missing-source:package.json',
        overlayFile: 'C:/stale/remote.patch.yml',
      }),
    });
    if (skipUserPlugins) f.controller.writePluginSkip(new Error('recovery'));
    await assert.rejects(
      () => f.controller.start(),
      (error) => {
        assert.match(String(error.message), /桌面内置 dsh-remote 失败/);
        assert.match(String(error.message), /missing-source:package.json/);
        return true;
      },
    );
    assert.equal(f.dsh.startCalls, 0);
    assert.equal(f.dsh.startOptions.length, 0);
  }
});

test('a failed usage-panel ensure blocks Harness start and never passes a stale overlay', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureUsagePanelPlugin: async () => ({ ok: false, error: 'missing-zod', overlayFile: 'C:/stale.yml' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置用量统计失败/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('a failed market ensure blocks Harness start and never passes a stale overlay', async () => {
  const installOverlay = 'C:/profiles/web/desktop-plugins/install-dsh-plugin/desktop-install.patch.yml';
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, overlayFile: installOverlay }),
    ensureDesktopMarket: async () => ({ ok: false, error: 'missing-source:package.json', overlayFile: 'C:/stale-market.yml' }),
  });
  await assert.rejects(
    () => f.controller.start(),
    (error) => {
      assert.match(String(error.message), /桌面内置市场失败/);
      return true;
    },
  );
  assert.equal(f.dsh.startCalls, 0);
});

test('skip start without a desktop-owned overlay passes no patch files', async () => {
  const f = fixture({
    ensureDesktopInstallPlugin: () => ({ ok: true, patchFile: 'C:/profiles/web/cordis.patch.yml' }),
  });
  f.controller.writePluginSkip(new Error('recovery'));
  await f.controller.start();
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
  assert.deepEqual(f.dsh.startOptions[0].patchFiles, []);
});

test('sticky plugin recovery retains skip mode on restart and clears it only after full retry stops the old Harness', async () => {
  const f2 = fixture({
    appVersion: '1.2.3',
    initialConfig: {
      pluginRecovery: {
        skipUserPlugins: true,
        reason: 'plugin tree failed',
        at: '2026-08-18T00:00:00.000Z',
        appVersion: '1.2.3',
      },
    },
  });
  await f2.controller.start();
  assert.equal(f2.dsh.startOptions[0].skipUserPlugins, true);
  await f2.controller.restart();
  assert.equal(f2.dsh.startOptions.at(-1).skipUserPlugins, true);
  const marker = f2.controller.snapshot().pluginRecovery;
  let releaseStop;
  const stopped = new Promise((resolve) => { releaseStop = resolve; });
  f2.dsh.stop = async () => { await stopped; f2.dsh.setState('idle'); };
  const retry = f2.controller.retryFullPlugins();
  await settle();
  assert.deepEqual(f2.controller.snapshot().pluginRecovery, marker);
  assert.deepEqual(f2.controller.loadConfig().pluginRecovery, marker);
  assert.equal(f2.dsh.startCalls, 2);
  releaseStop();
  await retry;
  assert.deepEqual(f2.dsh.startOptions.map(options => options.skipUserPlugins), [true, true, false]);
  assert.equal(f2.dsh.startOptions.at(-1).skipUserPlugins, false);
  assert.equal(f2.controller.snapshot().pluginRecovery.skipUserPlugins, false);
  assert.equal(f2.controller.loadConfig().pluginRecovery.skipUserPlugins, false);
});

test('sticky plugin recovery survives full retry when the old Harness stop fails', async () => {
  const f = fixture();
  f.controller.writePluginSkip(new Error('plugin import failed'));
  await f.controller.start();
  const marker = f.controller.snapshot().pluginRecovery;
  f.dsh.stop = async () => { throw new Error('old Harness stop failed'); };

  await assert.rejects(f.controller.retryFullPlugins(), { message: 'old Harness stop failed' });

  assert.deepEqual(f.controller.snapshot().pluginRecovery, marker);
  assert.deepEqual(f.controller.loadConfig().pluginRecovery, marker);
  assert.equal(f.dsh.startCalls, 1);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
});

test('sticky plugin recovery survives full retry cancelled while the old Harness stops', async () => {
  const f = fixture();
  f.controller.writePluginSkip(new Error('plugin import failed'));
  await f.controller.start();
  const marker = f.controller.snapshot().pluginRecovery;
  let releaseStop;
  const stopped = new Promise((resolve) => { releaseStop = resolve; });
  f.dsh.stop = async () => { await stopped; f.dsh.setState('idle'); };
  const retry = f.controller.retryFullPlugins();
  const rejected = assert.rejects(retry, { code: 'HARNESS_OPERATION_CANCELLED' });
  await settle();
  const cancel = f.controller.stopDesktop();
  releaseStop();
  await Promise.all([rejected, cancel]);

  assert.deepEqual(f.controller.snapshot().pluginRecovery, marker);
  assert.deepEqual(f.controller.loadConfig().pluginRecovery, marker);
  assert.equal(f.dsh.startCalls, 1);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, true);
});

test('runtime crash returns to boot, disconnects Remote, and schedules one restart', async () => {
  const f = fixture();
  await f.controller.start();
  f.events.length = 0;
  f.dsh.crash();
  await settle();

  assert.equal(f.window.url, 'file:///boot.html');
  assert.equal(f.remote.syncCalls, 2);
  assert.equal(f.controller.snapshot().recovery.status, 'scheduled');
  assert.equal(f.controller.snapshot().recovery.attempt, 1);
  assert.equal(f.controller.snapshot().recovery.nextRetryAt, f.clock.time + 1000);
  assert.equal(f.clock.timers.size, 1);
  assert.ok(f.events.indexOf('remote:sync') >= 0);
  assert.ok(f.events.indexOf('boot') >= 0);
});

test('runtime crash during aborted Harness navigation preserves the runtime failure', async () => {
  let rejectNavigation;
  const aborted = Object.assign(new Error('net::ERR_ABORTED'), { code: 'ERR_ABORTED' });
  const f = fixture({
    showHarness: async () => new Promise((_resolve, reject) => {
      rejectNavigation = reject;
    }),
  });
  const start = f.controller.start();
  await settle();
  f.dsh.crash('crashed while loading');
  rejectNavigation(aborted);
  await assert.rejects(start, { code: 'HARNESS_OPERATION_CANCELLED' });
  await settle();

  assert.equal(f.controller.snapshot().failure.phase, 'runtime');
  assert.equal(f.controller.snapshot().failure.message, 'crashed while loading');
  assert.equal(f.controller.snapshot().recovery.status, 'scheduled');
  assert.equal(f.window.url, 'file:///boot.html');
});

test('automatic recovery uses exponential delays and exhausts the configured budget', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.startResults.push(new Error('first failed'), new Error('second failed'), new Error('third failed'));
  f.dsh.crash();
  await settle();

  assert.equal(f.controller.snapshot().recovery.nextRetryAt - f.clock.time, 1000);
  await f.clock.tick(1000);
  assert.equal(f.controller.snapshot().recovery.status, 'scheduled');
  assert.equal(f.controller.snapshot().recovery.attempt, 2);
  assert.equal(f.controller.snapshot().recovery.nextRetryAt - f.clock.time, 2000);

  await f.clock.tick(2000);
  assert.equal(f.controller.snapshot().recovery.attempt, 3);
  assert.equal(f.controller.snapshot().recovery.nextRetryAt - f.clock.time, 4000);

  await f.clock.tick(4000);
  assert.equal(f.controller.snapshot().recovery.status, 'exhausted');
  assert.equal(f.controller.snapshot().recovery.attempt, 3);
  assert.equal(f.clock.timers.size, 0);
});

test('successful recovery retains the crash budget until the stable window completes', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  await f.clock.tick(1000);

  assert.equal(f.controller.snapshot().recovery.status, 'monitoring');
  assert.equal(f.controller.snapshot().recovery.attempt, 1);
  assert.equal(f.dsh.state, 'ready');
  await f.clock.tick(59_999);
  assert.equal(f.controller.snapshot().recovery.status, 'monitoring');
  await f.clock.tick(1);
  assert.equal(f.controller.snapshot().recovery.status, 'inactive');
  assert.equal(f.controller.snapshot().recovery.attempt, 0);
});

test('a second crash during monitoring consumes the next attempt', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  await f.clock.tick(1000);
  f.dsh.crash('again');
  await settle();

  assert.equal(f.controller.snapshot().recovery.status, 'scheduled');
  assert.equal(f.controller.snapshot().recovery.attempt, 2);
  assert.equal(f.controller.snapshot().recovery.nextRetryAt - f.clock.time, 2000);
  assert.equal(f.clock.timers.size, 1);
});

test('cancel and manual restart prevent the scheduled timer from starting another process', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  const startsBefore = f.dsh.startCalls;
  f.controller.cancelRecovery();
  await f.clock.tick(5000);
  assert.equal(f.dsh.startCalls, startsBefore);
  assert.equal(f.controller.snapshot().recovery.status, 'cancelled');

  await f.controller.restart();
  assert.equal(f.dsh.startCalls, startsBefore + 1);
  assert.equal(f.controller.snapshot().recovery.status, 'inactive');
});

test('restart shows recovery before waiting for the old Harness to stop', async () => {
  const f = fixture();
  await f.controller.start();
  let releaseStop;
  const stopped = new Promise((resolve) => { releaseStop = resolve; });
  f.dsh.stop = async () => { await stopped; f.dsh.setState('idle'); };
  const restart = f.controller.restart();
  await settle();
  const visibleWhileStopping = f.window.url;
  releaseStop();
  await restart;
  assert.equal(visibleWhileStopping, 'file:///boot.html', 'settings must not remain stranded while the backend stops');
});

test('stopDesktop cancels scheduled recovery and stops the kernel', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  const startsBefore = f.dsh.startCalls;
  await f.controller.stopDesktop();
  await f.clock.tick(5000);
  assert.equal(f.dsh.startCalls, startsBefore);
  assert.equal(f.dsh.stopCalls, 1);
  assert.equal(f.dsh.state, 'idle');
  assert.equal(f.controller.snapshot().recovery.status, 'cancelled');
  assert.equal(f.controller.snapshot().recovery.reason, 'user-stop');
});

test('manual restart invalidates a recovery task that is still waiting for boot navigation', async () => {
  let releaseOldNavigation;
  let bootCalls = 0;
  const f = fixture({
    showBoot: async () => {
      bootCalls += 1;
      if (bootCalls === 1) {
        await new Promise((resolve) => {
          releaseOldNavigation = resolve;
        });
      }
    },
  });
  f.window.url = 'http://127.0.0.1:3080';
  f.dsh.state = 'ready';
  f.dsh.baseUrl = f.window.url;
  f.dsh.crash();
  await settle();

  const restart = f.controller.restart();
  releaseOldNavigation();
  await restart;
  await settle();

  assert.equal(f.controller.snapshot().recovery.status, 'inactive');
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.dsh.state, 'ready');
});

test('manual restart waits for an already-pending boot navigation before revealing Harness', async () => {
  const order = [];
  let bootCalls = 0;
  let markFirstBootStarted;
  let releaseFirstBoot;
  const firstBootStarted = new Promise((resolve) => {
    markFirstBootStarted = resolve;
  });
  const firstBoot = new Promise((resolve) => {
    releaseFirstBoot = resolve;
  });
  let f;
  f = fixture({
    showBoot: async () => {
      const call = ++bootCalls;
      order.push(`boot:${call}:start`);
      if (call === 1) {
        markFirstBootStarted();
        await firstBoot;
      }
      order.push(`boot:${call}:done`);
    },
    showHarness: async (url) => {
      f.window.url = url;
      order.push('harness');
    },
  });
  f.window.url = 'http://127.0.0.1:3080';
  f.dsh.state = 'ready';
  f.dsh.baseUrl = f.window.url;
  f.dsh.crash('runtime before manual restart');
  await firstBootStarted;
  await settle();

  const oldRecovery = f.controller.recoveryTask;
  assert.ok(oldRecovery, 'runtime recovery should be waiting on the deferred boot navigation');
  let restartSettled = false;
  const restart = f.controller.restart().then(() => {
    restartSettled = true;
  });
  await settle();
  const blockedBeforeRelease = !restartSettled && !order.includes('harness');

  releaseFirstBoot();
  await restart;
  await oldRecovery;

  assert.equal(blockedBeforeRelease, true, `restart ordering before release: ${JSON.stringify(order)}`);
  const bootDone = order.indexOf('boot:1:done');
  const harness = order.indexOf('harness');
  assert.ok(bootDone >= 0 && harness > bootDone, `unexpected restart ordering: ${JSON.stringify(order)}`);
  assert.equal(f.controller.snapshot().recovery.status, 'inactive');
  assert.equal(f.clock.timers.size, 0, 'the stale recovery generation must not schedule a new failure');
  assert.equal(f.dsh.failure, null);
  assert.equal(f.dsh.state, 'ready');
});

test('restart during startup cancels the old operation and starts a fresh generation', async () => {
  let releaseStart;
  const f = fixture();
  const originalStart = f.dsh.start.bind(f.dsh);
  let first = true;
  f.dsh.start = async () => {
    if (first) {
      first = false;
      f.dsh.startCalls += 1;
      await new Promise((resolve) => {
        releaseStart = resolve;
      });
      const error = new Error('cancelled');
      error.code = 'DSH_CANCELLED';
      throw error;
    }
    return originalStart();
  };

  const initial = f.controller.start();
  await settle();
  const restart = f.controller.restart();
  releaseStart();
  await assert.rejects(initial, { code: 'DSH_CANCELLED' });
  await restart;

  assert.equal(f.dsh.startCalls, 2);
  assert.equal(f.dsh.state, 'ready');
  assert.equal(f.window.url, 'http://127.0.0.1:3080');
});

test('concurrent manual restarts await then start a fresh operation', async () => {
  const f = fixture();
  await f.controller.start();
  const first = f.controller.restart();
  const second = f.controller.restart();
  assert.notEqual(first, second);
  await Promise.all([first, second]);
  // initial start + first restart + second restart after awaiting the first
  assert.equal(f.dsh.startCalls, 3);
  assert.equal(f.dsh.stopCalls, 2);
});

test('second restart after in-flight restart re-reads skipUserPlugins', async () => {
  let releaseFirstStart;
  const f = fixture();
  await f.controller.start();

  const originalStart = f.dsh.start.bind(f.dsh);
  let gateNext = false;
  f.dsh.start = async (options) => {
    f.dsh.startOptions.push(options);
    if (gateNext) {
      gateNext = false;
      f.dsh.startCalls += 1;
      await new Promise((resolve) => {
        releaseFirstStart = resolve;
      });
      f.dsh.setState('ready', { baseUrl: 'http://127.0.0.1:3080', error: '', failure: null });
      return 'http://127.0.0.1:3080';
    }
    return originalStart(options);
  };

  f.dsh.startOptions.length = 0;
  f.dsh.startCalls = 0;
  gateNext = true;

  const first = f.controller.restart();
  await settle();
  f.controller.writePluginSkip(new Error('mid-restart-skip'));
  const second = f.controller.restart();
  releaseFirstStart();
  await Promise.all([first, second]);

  assert.equal(f.dsh.startCalls, 2);
  assert.equal(f.dsh.startOptions[0].skipUserPlugins, false);
  assert.equal(f.dsh.startOptions[1].skipUserPlugins, true);
});

test('reload reopens the ready Web UI through showHarness', async () => {
  const f = fixture();
  await f.controller.start();
  f.events.length = 0;
  await f.controller.reload();
  assert.deepEqual(f.events.filter((event) => event.startsWith('harness:') || event.startsWith('reload:')), [
    'harness:http://127.0.0.1:3080',
  ]);
});

test('remote sync failure during start is logged, not fatal', async () => {
  const f = fixture();
  f.remote.sync = async () => { throw new Error('EADDRINUSE :3180'); };
  await f.controller.start();
  assert.ok(f.dsh.logs.some((line) => /手机 Remote 同步失败/.test(line) && /EADDRINUSE/.test(line)));
});

test('shutdown cancels recovery and does not navigate or restart afterward', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  const startsBefore = f.dsh.startCalls;
  await f.controller.shutdown();
  await f.clock.tick(10_000);

  assert.equal(f.dsh.startCalls, startsBefore);
  assert.equal(f.remote.stopCalls, 1);
  assert.equal(f.clock.timers.size, 0);
});

test('disabling auto restart cancels a pending recovery immediately', async () => {
  const f = fixture();
  await f.controller.start();
  f.dsh.crash();
  await settle();
  f.setConfig({ harnessAutoRestart: false });
  f.controller.refreshPolicy();

  assert.equal(f.controller.snapshot().recovery.status, 'cancelled');
  assert.equal(f.controller.snapshot().recovery.reason, 'disabled');
  assert.equal(f.clock.timers.size, 0);
});

test('dsh log lines are batched into one shell:log send per flush window', async () => {
  const sends = [];
  const flushTimers = new Map();
  let nextTimerId = 1;
  const pendingFlush = [];
  const f = fixture({
    sendToBoot: (channel, payload) => sends.push({ channel, payload }),
    setLogTimer: (fn) => {
      const id = nextTimerId++;
      flushTimers.set(id, fn);
      pendingFlush.push(fn);
      return id;
    },
    clearLogTimer: (id) => {
      flushTimers.delete(id);
    },
  });
  const flush = () => pendingFlush.splice(0).forEach((fn) => fn());
  f.dsh.log('one');
  f.dsh.log('two');
  f.dsh.log('three');
  assert.equal(sends.filter((row) => row.channel === 'shell:log').length, 0);
  flush();
  const logs = sends.filter((row) => row.channel === 'shell:log');
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0].payload, ['[app] one', '[app] two', '[app] three']);
  f.dsh.log('late');
  flush();
  assert.deepEqual(sends.filter((row) => row.channel === 'shell:log').map((row) => row.payload).flat(),
    ['[app] one', '[app] two', '[app] three', '[app] late']);
});

test('a start reads one config snapshot for port, toggles, and dsh options', async () => {
  const revisions = [];
  let configRevision = 7;
  let currentConfig = {
    workspace: 'C:/workspace',
    harnessAutoRestart: true,
    harnessRestartMaxAttempts: 3,
    harnessRestartBaseDelayMs: 1000,
    openDevTools: false,
    dshbotEnabled: true,
    disabledPlugins: ['a'],
  };
  const f = fixture({
    loadConfig: () => currentConfig,
    readConfigSnapshot: () => {
      revisions.push(configRevision);
      return { config: { ...currentConfig }, revision: configRevision };
    },
    currentConfigRevision: () => configRevision,
    resolveLaunchTarget: async (snapshot) => ({ port: 3100, configRevision: snapshot.revision }),
    ensureDshbotPlugin: async (options) => {
      // The built-in toggle must come from the snapshot, not a fresh config read.
      assert.equal(options.enabled, true);
      return { ok: true, overlayFile: 'C:/overlay/bot.yml' };
    },
    applyDisabledBundles: (disabled) => {
      assert.deepEqual(disabled, ['a']);
      return { ok: true, changed: false };
    },
  });
  await f.controller.start();
  assert.equal(revisions.length, 1, 'one snapshot read when nothing changes mid-start');
  assert.equal(f.dsh.startOptions[0].port, 3100);
  assert.equal(f.dsh.startOptions[0].configSnapshot.dshbotEnabled, true);
});

test('a config save during port resolution re-reads instead of mixing two versions', async () => {
  let configRevision = 1;
  let currentConfig = {
    workspace: 'C:/workspace',
    harnessAutoRestart: true,
    harnessRestartMaxAttempts: 3,
    harnessRestartBaseDelayMs: 1000,
    openDevTools: false,
    dshbotEnabled: false,
  };
  const f = fixture({
    loadConfig: () => currentConfig,
    readConfigSnapshot: () => ({ config: { ...currentConfig }, revision: configRevision }),
    currentConfigRevision: () => configRevision,
    resolveLaunchTarget: async (snapshot) => {
      if (snapshot.revision === 1) {
        // A Settings save lands while the port is being resolved.
        configRevision = 2;
        currentConfig = { ...currentConfig, dshbotEnabled: true };
      }
      return { port: 3080, configRevision: snapshot.revision };
    },
  });
  await f.controller.start();
  // The start must use the post-save snapshot, never a mix of the two.
  assert.equal(f.dsh.startOptions[0].configSnapshot.dshbotEnabled, true);
});
