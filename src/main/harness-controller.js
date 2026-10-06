const EventEmitter = require('events');
const { isPluginTreeFailure } = require('./plugin-tree-failure');
const { stickySkipActive, kernelLogTail } = require('./launcher-gate');
const importGuard = require('./import-guard');

const DEFAULT_STABLE_MS = 60_000;
const MAX_RESTART_DELAY_MS = 30_000;

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message;
  return String(error || 'Harness 启动失败');
}

function operationCancelled(message = 'Harness 启动已取消') {
  const error = new Error(message);
  error.code = 'HARNESS_OPERATION_CANCELLED';
  return error;
}

function isCancellation(error) {
  return error?.code === 'DSH_CANCELLED' || error?.code === 'HARNESS_OPERATION_CANCELLED';
}

function emptyPluginRecovery() {
  return { skipUserPlugins: false, reason: '', at: '', appVersion: '' };
}

class HarnessController extends EventEmitter {
  constructor(options) {
    super();
    this.dsh = options.dsh;
    this.remote = options.remote;
    this.loadConfig = options.loadConfig;
    this.createMainWindow = options.createMainWindow;
    this.getMainWindow = options.getMainWindow;
    this.showBoot = options.showBoot;
    this.showHarness = options.showHarness;
    this.sendToBoot = options.sendToBoot;
    this.saveConfig = options.saveConfig || (() => {});
    this.appVersion = String(options.appVersion || '0.0.0');
    this.healDanglingBundles = options.healDanglingBundles || (() => ({ ok: true, changed: false }));
    this.isBootLoaded = options.isBootLoaded || (() => false);
    this.getHarnessWebContents = options.getHarnessWebContents || (() => null);
    this.resolveLaunchTarget = options.resolveLaunchTarget;
    this.readConfigSnapshot = options.readConfigSnapshot || (() => ({ config: this.loadConfig(), revision: undefined }));
    this.currentConfigRevision = options.currentConfigRevision || (() => undefined);
    this.stripDroppedPlugins = options.stripDroppedPlugins;
    this.ensureDesktopInstallPlugin = options.ensureDesktopInstallPlugin || (() => {});
    this.ensureTaskControlPlugin = options.ensureTaskControlPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDesktopPlatformSession = options.ensureDesktopPlatformSession
      || (async () => ({ ok: true, added: false }));
    this.removeDshMarketPreset = options.removeDshMarketPreset
      || (async () => ({ ok: true, changed: false }));
    this.ensureUsagePanelPlugin = options.ensureUsagePanelPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureSessionSearchOverlay = options.ensureSessionSearchOverlay
      || (async () => ({ ok: true }));
    this.ensureDshImPlugin = options.ensureDshImPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDshbotPlugin = options.ensureDshbotPlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDshWhalePlugin = options.ensureDshWhalePlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDshRemotePlugin = options.ensureDshRemotePlugin
      || (async () => ({ ok: true, added: false }));
    this.ensureDesktopMarket = options.ensureDesktopMarket
      || (async () => ({ ok: true, added: false }));
    this.ensureDesktopOfficeRuntime = options.ensureDesktopOfficeRuntime
      || (async () => ({ ok: true, present: false }));
    this.removeLegacyDshbotPreset = options.removeLegacyDshbotPreset
      || (async () => ({ ok: true, changed: false }));
    this.applyDisabledBundles = options.applyDisabledBundles
      || (() => ({ ok: true, changed: false }));
    this.ensureWorkspace = options.ensureWorkspace;
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.now = options.now || Date.now;
    this.stableMs = Number(options.stableMs) >= 0
      ? Number(options.stableMs)
      : DEFAULT_STABLE_MS;

    this.operation = null;
    this.operationGeneration = 0;
    this.restartOperation = null;
    this.bootOperation = null;
    this.recoveryTimer = null;
    this.stableTimer = null;
    this.recoveryTask = null;
    this.pluginRecoveryTask = null;
    this.recoveryAdmissionCheck = () => null;
    this.recoveryGeneration = 0;
    this.shuttingDown = false;
    this.recovery = {
      status: 'inactive',
      attempt: 0,
      nextRetryAt: null,
      reason: '',
    };
    this.pluginRecovery = {
      ...emptyPluginRecovery(),
      ...((this.loadConfig() || {}).pluginRecovery || {}),
    };

    this.logBatch = [];
    this.logFlushTimer = null;
    this.setLogTimer = options.setLogTimer
      || ((fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return timer;
      });
    this.clearLogTimer = options.clearLogTimer || ((timer) => clearTimeout(timer));

    this.onDshState = (snapshot) => {
      this.sendState(snapshot);
      if (!this.shuttingDown && snapshot?.state === 'error' && snapshot?.failure?.phase === 'runtime') {
        this.operationGeneration += 1;
        const task = this.looksLikePluginTreeFailure()
          ? this.beginPluginTreeRecovery()
          : this.beginRuntimeRecovery();
        task.catch((error) => {
          if (isCancellation(error)) return;
          this.dsh.log(`恢复流程失败：${errorMessage(error)}`, 'error');
        });
      }
    };
    // Plugin boot writes hundreds of dsh lines in bursts; forward them to the
    // boot page as one send per flush window instead of one IPC per line. The
    // flush timer is not part of the recovery FSM clock: it uses its own seam
    // so quiescence is not gated on a pending log flush.
    this.onDshLog = (line) => {
      this.logBatch.push(line);
      if (this.logFlushTimer === null) {
        this.logFlushTimer = this.setLogTimer(() => this.flushLogBatch(), 60);
      }
    };
    this.dsh.on('state', this.onDshState);
    this.dsh.on('log', this.onDshLog);
  }

  policy() {
    const config = this.loadConfig() || {};
    return {
      enabled: config.harnessAutoRestart !== false,
      maxAttempts: Number(config.harnessRestartMaxAttempts) || 3,
      baseDelayMs: Number(config.harnessRestartBaseDelayMs) || 1000,
    };
  }

  snapshot(dshSnapshot = this.dsh.snapshot()) {
    const policy = this.policy();
    return {
      ...dshSnapshot,
      // The dsh snapshot only carries the 80-line tail for its own
      // consumers; the boot drawer owns the full capped ring buffer.
      logs: this.dsh.logs.slice(),
      pluginRecovery: { ...this.pluginRecovery },
      recovery: {
        ...this.recovery,
        enabled: policy.enabled,
        maxAttempts: policy.maxAttempts,
      },
    };
  }

  sendState(dshSnapshot) {
    // Deliver pending log lines before the state push: the snapshot below
    // already contains them, so an unflushed batch would re-send the same
    // tail lines after the replay and duplicate them in the boot drawer.
    this.flushLogBatch();
    const snapshot = this.snapshot(dshSnapshot);
    this.sendToBoot('shell:state', snapshot);
    this.emit('state', snapshot);
    return snapshot;
  }

  setRecovery(patch) {
    this.recovery = { ...this.recovery, ...patch };
    return this.sendState();
  }

  clearRecoveryTimer() {
    if (this.recoveryTimer) {
      this.clearTimer(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  clearStableTimer() {
    if (this.stableTimer) {
      this.clearTimer(this.stableTimer);
      this.stableTimer = null;
    }
  }

  clearTimers() {
    this.clearRecoveryTimer();
    this.clearStableTimer();
    this.flushLogBatch();
  }

  flushLogBatch() {
    if (this.logFlushTimer !== null) {
      this.clearLogTimer(this.logFlushTimer);
      this.logFlushTimer = null;
    }
    if (this.logBatch.length) {
      const lines = this.logBatch;
      this.logBatch = [];
      this.sendToBoot('shell:log', lines);
    }
  }

  async ensureBootVisible(assertCurrent = () => {}) {
    if (!this.bootOperation) {
      // A stale recovery navigation must settle before a new restart reveals
      // Harness; otherwise it can cover the newly ready BrowserView afterward.
      const task = Promise.resolve().then(() => {
        assertCurrent();
        return this.showBoot();
      }).finally(() => {
        if (this.bootOperation === task) this.bootOperation = null;
      });
      this.bootOperation = task;
    }
    await this.bootOperation;
  }

  async beginRuntimeRecovery() {
    if (this.recoveryTask) {
      return this.recoveryTask;
    }
    const generation = ++this.recoveryGeneration;
    const task = (async () => {
      this.clearTimers();
      await Promise.allSettled([
        this.syncRemoteLogged(),
        this.ensureBootVisible(),
      ]);
      if (this.shuttingDown || generation !== this.recoveryGeneration) {
        return this.snapshot();
      }
      return this.scheduleRecovery();
    })().finally(() => {
      if (this.recoveryTask === task) {
        this.recoveryTask = null;
      }
    });
    this.recoveryTask = task;
    return task;
  }

  looksLikePluginTreeFailure(error = null) {
    const snapshot = this.dsh.snapshot();
    return [
      errorMessage(error),
      snapshot?.error,
      snapshot?.failure?.message,
      ...kernelLogTail(this.dsh),
    ].some((value) => isPluginTreeFailure(value));
  }

  writePluginSkip(error) {
    this.pluginRecovery = {
      skipUserPlugins: true,
      reason: errorMessage(error),
      at: new Date(this.now()).toISOString(),
      appVersion: this.appVersion,
      logTail: kernelLogTail(this.dsh).concat(errorMessage(error).split(/\r?\n/)).slice(-80),
    };
    this.saveConfig({ pluginRecovery: this.pluginRecovery });
    return this.sendState();
  }

  clearPluginRecovery() {
    this.pluginRecovery = emptyPluginRecovery();
    this.saveConfig({ pluginRecovery: this.pluginRecovery });
    return this.sendState();
  }

  shouldSkipUserPlugins() {
    if (!this.pluginRecovery.skipUserPlugins) return false;
    // Shared predicate with ipc.js — one truth for "sticky for this build".
    if (stickySkipActive(this)) return true;
    this.clearPluginRecovery();
    return false;
  }

  setRecoveryAdmissionCheck(check) {
    this.recoveryAdmissionCheck = check;
  }

  async beginPluginTreeRecovery() {
    if (this.pluginRecoveryTask) return this.pluginRecoveryTask;
    const generation = ++this.recoveryGeneration;
    let token = null;
    const assertCurrent = () => {
      if (this.shuttingDown || generation !== this.recoveryGeneration) throw operationCancelled();
      const refusal = this.recoveryAdmissionCheck();
      if (refusal) throw operationCancelled(refusal.error);
      if (token ? !importGuard.holdsMaintenance(token) : importGuard.isMaintenanceHeld()) {
        throw operationCancelled('maintenance-in-progress');
      }
    };
    const task = (async () => {
      const snapshot = this.dsh.snapshot();
      assertCurrent();
      this.clearTimers();
      await this.ensureBootVisible(assertCurrent);
      assertCurrent();
      // Navigation may be pending while import stops the desktop. Only take
      // ownership once it settles, before the first profile write, and retain
      // it through all asynchronous repair/start work (including failures).
      token = importGuard.acquireMaintenance('plugin-recovery');
      if (!token) throw operationCancelled('maintenance-in-progress');
      assertCurrent();
      this.writePluginSkip(snapshot.failure || snapshot.error);
      return await this.replaceOperation({ showBoot: false, assertCurrent });
    })().catch((error) => {
      if (isCancellation(error) && !this.shuttingDown) return this.snapshot();
      throw error;
    }).finally(() => {
      importGuard.releaseMaintenance(token);
      if (this.pluginRecoveryTask === task) this.pluginRecoveryTask = null;
    });
    this.pluginRecoveryTask = task;
    return task;
  }

  scheduleRecovery() {
    if (this.shuttingDown) {
      return this.snapshot();
    }
    this.clearRecoveryTimer();
    const policy = this.policy();
    const consumedAttempts = this.recovery.attempt || 0;
    if (!policy.enabled) {
      return this.setRecovery({
        status: 'cancelled',
        attempt: consumedAttempts,
        nextRetryAt: null,
        reason: 'disabled',
      });
    }
    if (consumedAttempts >= policy.maxAttempts) {
      return this.setRecovery({
        status: 'exhausted',
        attempt: consumedAttempts,
        nextRetryAt: null,
        reason: 'attempts-exhausted',
      });
    }

    const attempt = consumedAttempts + 1;
    const delay = Math.min(
      policy.baseDelayMs * (2 ** (attempt - 1)),
      MAX_RESTART_DELAY_MS,
    );
    const nextRetryAt = this.now() + delay;
    const snapshot = this.setRecovery({
      status: 'scheduled',
      attempt,
      nextRetryAt,
      reason: '',
    });
    this.recoveryTimer = this.setTimer(() => {
      this.recoveryTimer = null;
      this.runAutomaticRestart(attempt).catch((error) => {
        this.dsh.log(`自动恢复失败：${errorMessage(error)}`, 'error');
      });
    }, delay);
    return snapshot;
  }

  async runAutomaticRestart(attempt) {
    if (this.shuttingDown || this.recovery.status !== 'scheduled' || this.recovery.attempt !== attempt) {
      return this.snapshot();
    }
    const recoveryGeneration = this.recoveryGeneration;
    this.setRecovery({ status: 'restarting', nextRetryAt: null, reason: '' });
    try {
      await this.replaceOperation({ showBoot: false });
      if (this.shuttingDown || recoveryGeneration !== this.recoveryGeneration) {
        return this.snapshot();
      }
      this.startStableWindow(attempt);
      return this.snapshot();
    } catch (error) {
      if (this.shuttingDown || recoveryGeneration !== this.recoveryGeneration) {
        throw error;
      }
      await this.ensureBootVisible().catch(() => {});
      this.recovery = {
        ...this.recovery,
        status: 'failed',
        attempt,
        nextRetryAt: null,
      };
      this.scheduleRecovery();
      throw error;
    }
  }

  startStableWindow(attempt) {
    this.clearStableTimer();
    this.setRecovery({ status: 'monitoring', attempt, nextRetryAt: null, reason: '' });
    this.stableTimer = this.setTimer(() => {
      this.stableTimer = null;
      if (this.shuttingDown || this.dsh.state !== 'ready') {
        return;
      }
      this.setRecovery({ status: 'inactive', attempt: 0, nextRetryAt: null, reason: '' });
    }, this.stableMs);
  }

  runOperation(work) {
    if (this.operation) {
      return this.operation;
    }
    const generation = ++this.operationGeneration;
    const task = Promise.resolve()
      .then(() => work(generation))
      .finally(() => {
        if (this.operation === task) {
          this.operation = null;
        }
      });
    this.operation = task;
    return task;
  }

  assertOperationCurrent(generation) {
    if (this.shuttingDown || generation !== this.operationGeneration) {
      throw operationCancelled();
    }
  }

  start() {
    return this.runOperation((generation) => this.performStart({ showBoot: true, generation }));
  }

  async replaceOperation({ showBoot, fullPluginRetry = false, assertCurrent = () => {} }) {
    assertCurrent();
    const previousOperation = this.operation;
    const generation = ++this.operationGeneration;
    const checkCurrent = () => {
      this.assertOperationCurrent(generation);
      assertCurrent();
    };
    checkCurrent();
    await this.ensureBootVisible(checkCurrent).catch(() => {});
    checkCurrent();
    await this.dsh.stop();
    checkCurrent();
    await previousOperation?.catch(() => {});
    checkCurrent();
    if (fullPluginRetry) this.clearPluginRecovery();
    return this.runOperation((generation) => this.performStart({ showBoot, generation, assertCurrent }));
  }

  restart({ fullPluginRetry = false } = {}) {
    // Never join an in-flight restart: callers that mutate skip/disabled lists
    // before restart() must get a performStart that re-reads those flags.
    const previous = this.restartOperation;
    const task = (async () => {
      if (previous) {
        await previous.catch(() => {});
      }
      if (this.shuttingDown) {
        throw operationCancelled();
      }
      this.recoveryGeneration += 1;
      this.recoveryTask = null;
      this.pluginRecoveryTask = null;
      this.clearTimers();
      this.recovery = { status: 'inactive', attempt: 0, nextRetryAt: null, reason: '' };
      return this.replaceOperation({ showBoot: true, fullPluginRetry });
    })().finally(() => {
      if (this.restartOperation === task) {
        this.restartOperation = null;
      }
    });
    this.restartOperation = task;
    return task;
  }

  setStartupFailure(error) {
    const message = errorMessage(error);
    const current = this.dsh.snapshot();
    if (current.failure?.phase === 'runtime') {
      return;
    }
    if (current.state !== 'error' || current.failure?.phase !== 'startup') {
      this.dsh.setState('error', {
        error: message,
        failure: {
          phase: 'startup',
          message,
          code: null,
          signal: null,
          occurredAt: new Date(this.now()).toISOString(),
        },
      });
      this.dsh.log(message, 'error');
    }
  }

  async performStartOnce({ showBoot, generation, skipUserPlugins, assertCurrent = () => {} }) {
    const checkCurrent = () => {
      this.assertOperationCurrent(generation);
      assertCurrent();
    };
    checkCurrent();
    this.dsh.beginStartLog?.();
    this.dsh.setState('starting', { error: '', failure: null });
    const win = this.createMainWindow();
    if (showBoot) {
      await this.ensureBootVisible(checkCurrent);
    }
    checkCurrent();
    // One config read for the whole start. Port, disabled list, and every
    // built-in toggle read the *same* snapshot, so a Settings save landing
    // mid-start cannot produce a start that mixes two config versions. If a
    // save does land while the port is being resolved, take a fresh snapshot
    // instead of spawning a child against half-applied settings.
    let snapshot = this.readConfigSnapshot();
    let startConfig = snapshot?.config || this.loadConfig();
    let target = await this.resolveLaunchTarget(snapshot);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      checkCurrent();
      const revision = snapshot?.revision;
      if (typeof revision !== 'number' || this.currentConfigRevision?.() === revision) break;
      snapshot = this.readConfigSnapshot();
      startConfig = snapshot?.config || this.loadConfig();
      target = await this.resolveLaunchTarget(snapshot);
    }
    checkCurrent();
    try {
      this.stripDroppedPlugins();
    } catch (error) {
      checkCurrent();
      this.dsh.log(`插件清理失败：${errorMessage(error)}`, 'app');
    }
    let healed;
    try {
      healed = this.healDanglingBundles();
      if (healed?.removed?.length) {
        this.dsh.log(`已修复悬挂插件 bundle：${healed.removed.join(', ')}`, 'app');
      }
    } catch (error) {
      checkCurrent();
      this.dsh.log(`插件 bundle 修复失败：${errorMessage(error)}`, 'app');
    }
    if (healed?.requiresInstall?.length) {
      const commands = healed.requiresInstall.map(name => `dsh plugin --profile web add ${name}`).join('；');
      const message = `已保留所选 Codex/Claude 插件配置，但对应插件尚未安装。请补装后重试完整插件：${commands}`;
      this.dsh.log(message, 'app');
      if (!skipUserPlugins) {
        throw Object.assign(new Error(message), { code: 'DSH_OPTIONAL_PROVIDER_NOT_INSTALLED' });
      }
    }
    const desktopInstall = this.ensureDesktopInstallPlugin();
    if (desktopInstall && desktopInstall.ok === false) {
      throw new Error(`桌面安装插件写入失败：${desktopInstall.reason || 'unknown'}`);
    }
    // Desktop-owned rows ride --patch overlays on EVERY start; the profile's
    // cordis.patch.yml is purely user-owned (ensure only strips legacy
    // managed blocks). Never pass that file to --patch: overlays still apply
    // under --skip-user-plugins, so it would re-mount every user row the
    // skip exists to bypass. The install, usage-panel, dsh-im, and market
    // overlays are required on all starts (dshbot only while `dshbotEnabled`
    // is on); full starts insert session-search before dsh-im.
    const patchFiles = [];
    // Task control mounts first among the overlay plugins so its webServer /
    // resolveAgent guards are installed before later overlay plugins (dshbot,
    // dsh-im, remote) register their routes during apply.
    try {
      const taskControl = await this.ensureTaskControlPlugin();
      checkCurrent();
      if (taskControl && taskControl.ok === false) {
        throw new Error(`桌面内置任务保护失败：${taskControl.error || 'unknown'}`);
      }
      if (taskControl?.overlayFile) {
        patchFiles.push(taskControl.overlayFile);
      }
      if (taskControl && taskControl.ok) {
        this.dsh.log(taskControl.added ? '已接入桌面任务保护' : '桌面任务保护已就绪', 'app');
      }
      // Platform session publisher rides --patch on every start too: embedded
      // usage/top-up documents need the account row's desktopPlatform identity
      // and the loopback session route. Log-only on failure — account embed
      // degrades to a closed surface, never blocks boot.
      try {
        const platformSession = typeof this.ensureDesktopPlatformSession === 'function'
          ? await this.ensureDesktopPlatformSession()
          : null;
        checkCurrent();
        if (platformSession?.overlayFile) {
          patchFiles.push(platformSession.overlayFile);
        }
        if (platformSession && platformSession.ok === false) {
          this.dsh.log(`平台文档会话路由未接入：${platformSession.error || 'unknown'}`, 'app');
        }
      } catch (error) {
        checkCurrent();
        if (isCancellation(error)) throw error;
        this.dsh.log(`平台文档会话路由未接入：${errorMessage(error)}`, 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置任务保护失败：')) {
        throw error;
      }
      throw new Error(`桌面内置任务保护失败：${errorMessage(error)}`);
    }
    if (desktopInstall?.overlayFile) {
      patchFiles.push(desktopInstall.overlayFile);
    }
    // Office is desktop built-in: the workspace-dependencies + skill-office
    // rows ride --patch on every start (including skipUserPlugins recovery);
    // the disable list never applies. A missing packaged payload or an
    // incomplete kit closure is desktop runtime damage — fail the start;
    // skip cannot fix it.
    try {
      const office = await this.ensureDesktopOfficeRuntime();
      checkCurrent();
      if (office && office.ok === false) {
        throw new Error(`桌面内置 Office 运行时失败：${office.error || 'unknown'}`);
      }
      if (office?.overlayFile) {
        patchFiles.push(office.overlayFile);
      }
      if (office && office.ok && office.disabled) {
        this.dsh.log('桌面内置 Office 已按环境变量关闭', 'app');
      } else if (office && office.ok && office.present) {
        this.dsh.log(office.added ? '已接入桌面内置 Office 运行时' : '桌面内置 Office 运行时已就绪', 'app');
      } else if (office && office.warning) {
        this.dsh.log(office.warning, 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 Office 运行时失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 Office 运行时失败：${errorMessage(error)}`);
    }
    // The marketplace is desktop-owned (settings section `market` +
    // main-process curated engine); every start only clears legacy
    // dshmarket preset residue, log-only on failure.
    try {
      const market = await this.removeDshMarketPreset();
      checkCurrent();
      if (market && market.ok === false) {
        this.dsh.log(`清理 dshmarket 预置残留失败：${market.error || 'unknown'}`, 'app');
      } else if (market && market.changed) {
        this.dsh.log('已清理 dshmarket 桌面预置残留（市场已内置到桌面设置）', 'app');
      }
    } catch (error) {
      checkCurrent();
      this.dsh.log(`清理 dshmarket 预置残留失败：${errorMessage(error)}`, 'app');
    }
    // Usage stats is desktop built-in Settings → 用量统计 — not a user
    // plugin. Its overlay rides --patch on every start (including
    // skipUserPlugins recovery); the disable list never applies; missing
    // vendor deps fail start (desktop runtime damage, skip cannot fix it).
    try {
      const usage = await this.ensureUsagePanelPlugin();
      checkCurrent();
      if (usage && usage.ok === false) {
        throw new Error(`桌面内置用量统计失败：${usage.error || 'unknown'}`);
      }
      if (usage?.overlayFile) {
        patchFiles.push(usage.overlayFile);
      }
      if (usage && usage.ok) {
        this.dsh.log(usage.added ? '已接入桌面内置用量统计' : '桌面内置用量统计已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置用量统计失败：')) {
        throw error;
      }
      throw new Error(`桌面内置用量统计失败：${errorMessage(error)}`);
    }
    if (!skipUserPlugins) {
      try {
        const search = await this.ensureSessionSearchOverlay();
        checkCurrent();
        if (search && search.ok === false) {
          this.dsh.log(`预置会话搜索失败：${search.error || 'unknown'}`, 'app');
        } else if (search?.overlayFile) {
          patchFiles.push(search.overlayFile);
        }
      } catch (error) {
        checkCurrent();
        this.dsh.log(`预置会话搜索失败：${errorMessage(error)}`, 'app');
      }
    } else {
      this.dsh.log('跳过用户插件：不预置会话搜索', 'app');
    }
    // dsh-im is desktop built-in Settings → Remote → Channels — not a user
    // plugin. Its overlay rides --patch on every start (including
    // skipUserPlugins recovery); the disable list never applies; missing
    // vendor deps fail start (desktop runtime damage, skip cannot fix it).
    try {
      const im = await this.ensureDshImPlugin();
      checkCurrent();
      if (im && im.ok === false) {
        throw new Error(`桌面内置 dsh-im 失败：${im.error || 'unknown'}`);
      }
      if (im?.overlayFile) {
        patchFiles.push(im.overlayFile);
      }
      if (im && im.ok) {
        this.dsh.log(im.added ? '已接入桌面内置 dsh-im（消息渠道）' : '桌面内置 dsh-im 已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 dsh-im 失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 dsh-im 失败：${errorMessage(error)}`);
    }
    // Marketplace is desktop-owned Settings → 市场 — not a user plugin.
    // Its overlay rides --patch on every start (including
    // skipUserPlugins recovery); the disable list never applies; missing
    // runtime package fails the post-extraction dsh preflight (desktop
    // runtime damage, skip cannot fix it). Overlay generation itself runs
    // before dsh.start extracts the packaged Harness, so it must not require
    // the package directory to exist yet.
    try {
      const market = await this.ensureDesktopMarket();
      checkCurrent();
      if (market && market.ok === false) {
        throw new Error(`桌面内置市场失败：${market.error || 'unknown'}`);
      }
      if (market?.overlayFile) {
        patchFiles.push(market.overlayFile);
      }
      if (market && market.ok) {
        this.dsh.log(market.added ? '已接入桌面内置市场（设置分区）' : '桌面内置市场已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置市场失败：')) {
        throw error;
      }
      throw new Error(`桌面内置市场失败：${errorMessage(error)}`);
    }
    try {
      const removed = await this.removeLegacyDshbotPreset();
      checkCurrent();
      if (removed && removed.ok === false) {
        this.dsh.log(`清理 dshbot 预置残留失败：${removed.error || 'unknown'}`, 'app');
      } else if (removed && removed.changed) {
        this.dsh.log('已清理 dshbot 旧版预置残留', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      this.dsh.log(`清理 dshbot 预置残留失败：${errorMessage(error)}`, 'app');
    }
    // dshbot is desktop built-in sidebar Bots — not a user plugin. Its
    // overlay rides --patch on every start (including skipUserPlugins
    // recovery) only while `dshbotEnabled` is on in 界面设置 (default off);
    // the disable list never applies; a missing vendor copy fails start
    // (desktop runtime damage, skip cannot fix it).
    try {
      const bots = await this.ensureDshbotPlugin({
        enabled: startConfig.dshbotEnabled === true,
      });
      checkCurrent();
      if (bots && bots.ok === false) {
        throw new Error(`桌面内置 dshbot 失败：${bots.error || 'unknown'}`);
      }
      if (bots?.overlayFile) {
        patchFiles.push(bots.overlayFile);
      }
      if (bots && bots.ok && bots.disabled) {
        this.dsh.log('桌面内置 dshbot 已按设置关闭', 'app');
      } else if (bots && bots.ok) {
        this.dsh.log(bots.added ? '已接入桌面内置 dshbot（Bots）' : '桌面内置 dshbot 已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 dshbot 失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 dshbot 失败：${errorMessage(error)}`);
    }
    // dsh-whale is the desktop built-in whale-girl assistant — same contract
    // as dshbot: overlay on every start only while `whaleAssistantEnabled`
    // (default off, toggled from the pet settings page) is true; the disable
    // list never applies; a missing vendor copy fails the start.
    try {
      const whale = await this.ensureDshWhalePlugin({
        enabled: startConfig.whaleAssistantEnabled === true,
      });
      checkCurrent();
      if (whale && whale.ok === false) {
        throw new Error(`桌面内置 dsh-whale 失败：${whale.error || 'unknown'}`);
      }
      if (whale?.overlayFile) {
        patchFiles.push(whale.overlayFile);
      }
      if (whale && whale.ok && whale.disabled) {
        this.dsh.log('桌面内置 dsh-whale 已按设置关闭', 'app');
      } else if (whale && whale.ok) {
        this.dsh.log(whale.added ? '已接入桌面内置 dsh-whale（鲸鱼娘助理）' : '桌面内置 dsh-whale 已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 dsh-whale 失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 dsh-whale 失败：${errorMessage(error)}`);
    }
    // dsh-remote is the desktop built-in SSH remote-workspace host — same
    // contract as dshbot/dsh-whale: its overlay rides --patch on every start
    // (including skipUserPlugins recovery) while `remoteWorkspaceEnabled` is on in
    // 界面设置 (default ON); the disable list never applies; a missing
    // vendor copy fails start (desktop runtime damage, skip cannot fix it).
    try {
      const remotePlugin = await this.ensureDshRemotePlugin({
        enabled: startConfig.remoteWorkspaceEnabled !== false,
      });
      checkCurrent();
      if (remotePlugin && remotePlugin.ok === false) {
        throw new Error(`桌面内置 dsh-remote 失败：${remotePlugin.error || 'unknown'}`);
      }
      if (remotePlugin?.overlayFile) {
        patchFiles.push(remotePlugin.overlayFile);
      }
      if (remotePlugin && remotePlugin.ok && remotePlugin.disabled) {
        this.dsh.log('桌面内置 dsh-remote 已按设置关闭', 'app');
      } else if (remotePlugin && remotePlugin.ok) {
        this.dsh.log(remotePlugin.added ? '已接入桌面内置 dsh-remote（远程工作区）' : '桌面内置 dsh-remote 已就绪', 'app');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error)) throw error;
      if (error instanceof Error && error.message.startsWith('桌面内置 dsh-remote 失败：')) {
        throw error;
      }
      throw new Error(`桌面内置 dsh-remote 失败：${errorMessage(error)}`);
    }
    try {
      const disabled = this.applyDisabledBundles(startConfig.disabledPlugins);
      if (disabled && disabled.changed) {
        this.dsh.log('已按启动器禁用名单更新插件 bundles', 'app');
      } else if (disabled && disabled.ok === false && disabled.reason) {
        this.dsh.log(`应用插件禁用名单跳过：${disabled.reason}`, 'app');
      }
    } catch (error) {
      checkCurrent();
      this.dsh.log(`应用插件禁用名单失败：${errorMessage(error)}`, 'app');
    }
    const startOptions = {
      ...target,
      configSnapshot: startConfig,
      skipUserPlugins,
      patchFiles,
    };
    checkCurrent();
    const url = await this.dsh.start(startOptions);
      checkCurrent();
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在打开界面前已停止');
      }
      const { workspace } = this.loadConfig();
      try {
        await this.ensureWorkspace(url, workspace);
        checkCurrent();
        this.dsh.log(`已注册工作区 ${workspace}`);
      } catch (error) {
        checkCurrent();
        this.dsh.log(`工作区自动注册跳过：${errorMessage(error)}`, 'app');
      }
      checkCurrent();
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在打开界面前已停止');
      }
    try {
      await this.showHarness(url);
      checkCurrent();
      if (this.dsh.state !== 'ready') {
        throw operationCancelled('Harness 在界面加载期间已停止');
      }
    } catch (error) {
      checkCurrent();
      if (isCancellation(error) || this.dsh.failure?.phase === 'runtime') {
        await this.ensureBootVisible(checkCurrent).catch(() => {});
        throw isCancellation(error)
          ? error
          : operationCancelled('Harness 在界面加载期间已停止');
      }
      await this.dsh.stop();
      checkCurrent();
      throw new Error(`Web UI 加载失败：${errorMessage(error)}`);
    }
    checkCurrent();
    await this.syncRemoteLogged();
    checkCurrent();
    if (this.loadConfig().openDevTools) {
      const harnessWc = this.getHarnessWebContents(win);
      (harnessWc || win.webContents).openDevTools({ mode: 'detach' });
    }
    return url;
  }

  async performStart({ showBoot, generation, assertCurrent = () => {} }) {
    const checkCurrent = () => {
      this.assertOperationCurrent(generation);
      assertCurrent();
    };
    checkCurrent();
    const skipUserPlugins = this.shouldSkipUserPlugins();
    try {
      return await this.performStartOnce({ showBoot, generation, skipUserPlugins, assertCurrent });
    } catch (error) {
      if (isCancellation(error)) throw error;
      checkCurrent();
      if (!skipUserPlugins && !this.shuttingDown && !isCancellation(error)
          && (error?.code === 'DSH_OPTIONAL_PROVIDER_NOT_INSTALLED' || this.looksLikePluginTreeFailure(error))) {
        await this.dsh.stop().catch(() => {});
        checkCurrent();
        this.writePluginSkip(error);
        try {
          return await this.performStartOnce({ showBoot: false, generation, skipUserPlugins: true, assertCurrent });
        } catch (recoveryError) {
          checkCurrent();
          if (!this.shuttingDown && !isCancellation(recoveryError)) {
            this.setStartupFailure(recoveryError);
            await this.ensureBootVisible(checkCurrent).catch(() => {});
            checkCurrent();
            this.sendState();
          }
          throw recoveryError;
        }
      }
      if (!this.shuttingDown && !isCancellation(error)) {
        this.setStartupFailure(error);
        await this.ensureBootVisible(checkCurrent).catch(() => {});
        checkCurrent();
        this.sendState();
      }
      throw error;
    }
  }

  retryFullPlugins() {
    return this.restart({ fullPluginRetry: true });
  }

  reload() {
    const win = this.getMainWindow();
    if (!win) {
      return Promise.resolve(null);
    }
    if (this.dsh.state === 'ready' && this.dsh.baseUrl) {
      return this.showHarness(this.dsh.baseUrl);
    }
    return this.start();
  }

  cancelRecovery() {
    this.recoveryGeneration += 1;
    this.recoveryTask = null;
    this.pluginRecoveryTask = null;
    this.clearTimers();
    return this.setRecovery({
      status: 'cancelled',
      nextRetryAt: null,
      reason: 'user',
    });
  }

  /**
   * User-initiated stop from the launcher: cancel recovery/restart work,
   * stop the dsh kernel, and leave the shell idle without quitting Electron.
   */
  async stopDesktop() {
    this.recoveryGeneration += 1;
    this.operationGeneration += 1;
    this.recoveryTask = null;
    this.pluginRecoveryTask = null;
    this.clearTimers();
    this.setRecovery({
      status: 'cancelled',
      attempt: 0,
      nextRetryAt: null,
      reason: 'user-stop',
    });
    const pendingRestart = this.restartOperation;
    const pendingOperation = this.operation;
    await Promise.allSettled([
      pendingRestart?.catch(() => {}),
      pendingOperation?.catch(() => {}),
    ]);
    if (this.dsh.state !== 'idle') {
      await this.dsh.stop();
    }
    return this.snapshot();
  }

  refreshPolicy() {
    const policy = this.policy();
    if (!policy.enabled && this.recovery.status === 'scheduled') {
      this.recoveryGeneration += 1;
      this.clearTimers();
      return this.setRecovery({
        status: 'cancelled',
        nextRetryAt: null,
        reason: 'disabled',
      });
    }
    if (this.recovery.status === 'scheduled' && this.recovery.attempt > policy.maxAttempts) {
      this.clearRecoveryTimer();
      return this.setRecovery({
        status: 'exhausted',
        nextRetryAt: null,
        reason: 'attempts-exhausted',
      });
    }
    return this.sendState();
  }

  /**
   * Remote startup failures must never be silent: the popup only shows
   * `snapshot().error`, so the dsh log is the sole boot-time trace.
   */
  async syncRemoteLogged() {
    try {
      await this.remote?.sync?.();
    } catch (error) {
      this.dsh.log(`手机 Remote 同步失败：${errorMessage(error)}`, 'app');
    }
  }

  async shutdown() {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this.recoveryGeneration += 1;
    this.recoveryTask = null;
    this.pluginRecoveryTask = null;
    this.clearTimers();
    const currentOperation = this.operation;
    const currentRestart = this.restartOperation;
    await Promise.allSettled([
      this.dsh.stop(),
      // DshdRemote's teardown face is stopDaemon() — a bare stop() call
      // would optional-chain into a silent no-op and leak the daemon + :3180.
      this.remote?.stopDaemon?.(),
      currentOperation,
      currentRestart,
    ].filter(Boolean));
    this.dsh.off('state', this.onDshState);
    this.dsh.off('log', this.onDshLog);
  }
}

module.exports = {
  HarnessController,
  DEFAULT_STABLE_MS,
  MAX_RESTART_DELAY_MS,
};
