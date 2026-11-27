'use strict';

const {
  REPO_URL,
  checkStarStatus: defaultCheckStarStatus,
  starRepository: defaultStarRepository,
} = require('./github-star');

const IDLE_THRESHOLD_MS = 5000;
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const SUCCESS_HIDE_DELAY_MS = 2000;
const STAR_PROMPT_CHANNEL = 'shell:star-prompt-changed';
const VALID_ACTIONS = new Set(['star', 'open-browser', 'snooze', 'dismiss-forever']);

/**
 * @typedef {'hidden' | 'visible' | 'starring' | 'success' | 'error'} StarPromptPhase
 * @typedef {'direct' | 'browser'} StarPromptMode
 * @typedef {'zh' | 'en'} StarPromptLocale
 * @typedef {'' | 'auth-failed' | 'request-failed'} StarPromptErrorCode
 * @typedef {{
 *   visible: boolean,
 *   phase: StarPromptPhase,
 *   mode: StarPromptMode,
 *   locale: StarPromptLocale,
 *   errorCode: StarPromptErrorCode,
 * }} StarPromptView
 */

/**
 * @param {Record<string, any> | null | undefined} cfg
 * @returns {StarPromptLocale}
 */
function resolveLocale(cfg) {
  return cfg?.locale === 'en' ? 'en' : 'zh';
}

/**
 * @param {any} win
 * @returns {boolean}
 */
function isWindowActiveForPrompt(win) {
  return Boolean(
    win
    && !win.isDestroyed?.()
    && win.isVisible?.()
    && !win.isMinimized?.()
    && win.isFocused?.(),
  );
}

/**
 * @param {Record<string, any> | null | undefined} cfg
 * @param {number} nowMs
 * @returns {boolean}
 */
function isConfigEligible(cfg, nowMs) {
  const sp = cfg?.starPrompt;
  if (!sp || typeof sp !== 'object') return true;
  if (sp.starredAt) return false;
  if (sp.dismissedForever === true) return false;
  if (typeof sp.snoozedUntil === 'string' && sp.snoozedUntil) {
    const snoozedMs = Date.parse(sp.snoozedUntil);
    if (Number.isFinite(snoozedMs) && snoozedMs > nowMs) {
      return false;
    }
  }
  return true;
}

/**
 * Create the main-process controller for the idle GitHub star floating prompt.
 * @param {{
 *   loadConfig?: () => Record<string, any>,
 *   saveConfig?: (patch: Record<string, any>) => any,
 *   getMainWindow?: () => any,
 *   isHarnessLoaded?: (win: any) => boolean,
 *   isOverlayBlocked?: () => boolean,
 *   getHarnessWebContents?: (win: any) => any,
 *   openExternal?: (url: string) => Promise<any>,
 *   checkStarStatus?: typeof defaultCheckStarStatus,
 *   starRepository?: typeof defaultStarRepository,
 *   now?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (id: any) => void,
 *   log?: (msg: string) => void,
 * }} [deps]
 */
function createStarPromptController(deps = {}) {
  const loadConfig = typeof deps.loadConfig === 'function'
    ? deps.loadConfig
    : () => require('../config').loadConfig();
  const saveConfig = typeof deps.saveConfig === 'function'
    ? deps.saveConfig
    : (/** @type {Record<string, any>} */ patch) => require('../config').saveConfig(patch);
  const getMainWindow = typeof deps.getMainWindow === 'function'
    ? deps.getMainWindow
    : () => require('../window').getMainWindow();
  const isHarnessLoaded = typeof deps.isHarnessLoaded === 'function'
    ? deps.isHarnessLoaded
    : (/** @type {any} */ win) => require('../window').isHarnessLoaded(win);
  const isOverlayBlocked = typeof deps.isOverlayBlocked === 'function'
    ? deps.isOverlayBlocked
    : () => false;
  const getHarnessWebContents = typeof deps.getHarnessWebContents === 'function'
    ? deps.getHarnessWebContents
    : (/** @type {any} */ win) => require('../window').getHarnessWebContents(win);
  const openExternal = typeof deps.openExternal === 'function'
    ? deps.openExternal
    : (/** @type {string} */ url) => require('../open-external').openExternalHttp(url);
  const checkStarStatus = typeof deps.checkStarStatus === 'function'
    ? deps.checkStarStatus
    : defaultCheckStarStatus;
  const starRepository = typeof deps.starRepository === 'function'
    ? deps.starRepository
    : defaultStarRepository;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  const setTimer = typeof deps.setTimer === 'function'
    ? deps.setTimer
    : (/** @type {() => void} */ fn, /** @type {number} */ ms) => setTimeout(fn, ms);
  const clearTimer = typeof deps.clearTimer === 'function'
    ? deps.clearTimer
    : (/** @type {any} */ id) => clearTimeout(id);
  const log = typeof deps.log === 'function' ? deps.log : () => {};

  function readConfigSafe() {
    try {
      return loadConfig() || {};
    } catch {
      return {};
    }
  }

  /** @param {Record<string, any>} patch */
  function persistStarPrompt(patch) {
    try {
      const cfg = readConfigSafe();
      const prev = cfg?.starPrompt && typeof cfg.starPrompt === 'object' ? cfg.starPrompt : {};
      saveConfig({
        starPrompt: {
          starredAt: typeof prev.starredAt === 'string' ? prev.starredAt : '',
          dismissedForever: prev.dismissedForever === true,
          snoozedUntil: typeof prev.snoozedUntil === 'string' ? prev.snoozedUntil : '',
          ...patch,
        },
      });
    } catch (error) {
      log(`[star-prompt] persist failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** @type {StarPromptView} */
  let view = {
    visible: false,
    phase: 'hidden',
    mode: 'direct',
    locale: resolveLocale(readConfigSafe()),
    errorCode: '',
  };

  let disposed = false;
  let sessionDismissed = false;
  /** @type {'starred' | 'unstarred' | 'no-credentials' | 'auth-failed' | null} */
  let cachedStarStatus = null;
  /** @type {Promise<{ status: string }> | null} */
  let inFlightStatusCheck = null;
  let idleCycleId = 0;
  let starAttemptId = 0;
  /** @type {any} */
  let idleTimer = null;
  /** @type {any} */
  let autoHideTimer = null;
  /** @type {any} */
  let boundMainWin = null;
  /** @type {(() => void) | null} */
  let unbindMainWin = null;

  /** @returns {StarPromptView} */
  function getView() {
    return { ...view };
  }

  function pushView() {
    if (disposed) return;
    const win = getMainWindow();
    if (!win || win.isDestroyed?.()) return;
    const wc = getHarnessWebContents(win);
    if (!wc || wc.isDestroyed?.()) return;
    wc.send(STAR_PROMPT_CHANNEL, getView());
  }

  /** @param {Partial<StarPromptView>} next */
  function updateView(next) {
    view = { ...view, ...next };
    pushView();
  }

  function resetToHidden({ push = true } = {}) {
    clearAutoHideTimer();
    const shouldPush = push && (view.visible || view.phase !== 'hidden' || view.errorCode !== '');
    view = {
      ...view,
      visible: false,
      phase: 'hidden',
      mode: 'direct',
      errorCode: '',
    };
    if (shouldPush) pushView();
  }

  function clearIdleTimer() {
    idleCycleId += 1;
    if (idleTimer !== null) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
  }

  function clearAutoHideTimer() {
    if (autoHideTimer !== null) {
      clearTimer(autoHideTimer);
      autoHideTimer = null;
    }
  }

  /**
   * @param {Record<string, any>} [cfg]
   * @returns {boolean}
   */
  function isEligible(cfg = readConfigSafe()) {
    if (disposed || sessionDismissed) return false;
    if (!isConfigEligible(cfg, now())) return false;
    const win = getMainWindow();
    if (!isWindowActiveForPrompt(win)) return false;
    if (!isHarnessLoaded(win)) return false;
    if (isOverlayBlocked()) return false;
    return true;
  }

  /** @returns {StarPromptPhase} */
  function currentPhase() {
    return view.phase;
  }

  /** @returns {Promise<{ status: string }>} */
  function readStarStatusCached() {
    if (cachedStarStatus !== null) {
      return Promise.resolve({ status: cachedStarStatus });
    }
    if (inFlightStatusCheck) {
      return inFlightStatusCheck;
    }
    let pending;
    try {
      pending = Promise.resolve(checkStarStatus());
    } catch {
      return Promise.resolve({ status: 'network-error' });
    }
    inFlightStatusCheck = pending
      .then((result) => {
        const status = result?.status || 'network-error';
        if (status !== 'network-error') {
          cachedStarStatus = /** @type {'starred' | 'unstarred' | 'no-credentials' | 'auth-failed'} */ (status);
        }
        return { status };
      })
      .catch(() => ({ status: 'network-error' }))
      .finally(() => {
        inFlightStatusCheck = null;
      });
    return inFlightStatusCheck;
  }

  /** @param {number} cycleId */
  async function onIdleTimerFired(cycleId) {
    idleTimer = null;
    if (disposed || cycleId !== idleCycleId || view.phase !== 'hidden') return;
    const cfg = readConfigSafe();
    if (!isEligible(cfg)) return;

    const result = await readStarStatusCached();
    if (disposed) return;

    if (result.status === 'starred') {
      persistStarPrompt({ starredAt: new Date(now()).toISOString() });
      return;
    }
    if (result.status === 'network-error') {
      return;
    }
    if (cycleId !== idleCycleId || currentPhase() !== 'hidden') return;
    const freshCfg = readConfigSafe();
    if (!isEligible(freshCfg)) return;

    const mode = result.status === 'unstarred' ? 'direct' : 'browser';
    updateView({
      visible: true,
      phase: 'visible',
      mode,
      locale: resolveLocale(freshCfg),
      errorCode: '',
    });
  }

  function armIdleTimer() {
    clearIdleTimer();
    if (disposed || view.phase !== 'hidden' || !isEligible()) return;
    const cycleId = idleCycleId;
    idleTimer = setTimer(() => onIdleTimerFired(cycleId), IDLE_THRESHOLD_MS);
  }

  function handleWindowUnavailable() {
    clearIdleTimer();
    if (view.phase !== 'hidden') {
      starAttemptId += 1;
      resetToHidden({ push: true });
    }
  }

  function handleWindowActivate() {
    if (view.phase === 'hidden') {
      if (isEligible()) armIdleTimer();
      else clearIdleTimer();
    }
  }

  function detachMainWindow() {
    clearIdleTimer();
    if (unbindMainWin) {
      unbindMainWin();
      unbindMainWin = null;
    }
    boundMainWin = null;
    if (view.phase !== 'hidden') {
      starAttemptId += 1;
      resetToHidden({ push: false });
    }
  }

  /** @param {any} win */
  function attachMainWindow(win) {
    if (disposed) return;
    if (win === boundMainWin) {
      handleWindowActivate();
      return;
    }
    detachMainWindow();
    if (!win || win.isDestroyed?.()) return;

    boundMainWin = win;
    const onBlur = () => clearIdleTimer();
    const onActivate = () => handleWindowActivate();
    const onUnavailable = () => handleWindowUnavailable();
    const onClosed = () => {
      if (boundMainWin === win) detachMainWindow();
    };

    win.on('focus', onActivate);
    win.on('show', onActivate);
    win.on('restore', onActivate);
    win.on('blur', onBlur);
    win.on('minimize', onUnavailable);
    win.on('hide', onUnavailable);
    win.once('closed', onClosed);

    unbindMainWin = () => {
      if (!win.isDestroyed?.()) {
        win.removeListener('focus', onActivate);
        win.removeListener('show', onActivate);
        win.removeListener('restore', onActivate);
        win.removeListener('blur', onBlur);
        win.removeListener('minimize', onUnavailable);
        win.removeListener('hide', onUnavailable);
        win.removeListener('closed', onClosed);
      }
    };

    handleWindowActivate();
  }

  function recordActivity() {
    if (disposed || view.phase !== 'hidden') return;
    if (isEligible()) {
      armIdleTimer();
    } else {
      clearIdleTimer();
    }
  }

  /** @param {Record<string, any>} [nextConfig] */
  function syncConfig(nextConfig = readConfigSafe()) {
    if (disposed) return;
    const nextLocale = resolveLocale(nextConfig);
    const localeChanged = nextLocale !== view.locale;
    if (localeChanged) {
      view = { ...view, locale: nextLocale };
      if (view.phase !== 'hidden') {
        pushView();
      }
    }
    if (view.phase === 'hidden') {
      if (!isEligible(nextConfig)) {
        clearIdleTimer();
      } else if (idleTimer === null) {
        armIdleTimer();
      }
    } else if (view.phase !== 'success' && !isConfigEligible(nextConfig, now())) {
      starAttemptId += 1;
      resetToHidden({ push: true });
    }
  }

  async function executeDirectStar() {
    if (view.phase === 'starring') {
      return { ok: false, reason: 'busy' };
    }
    starAttemptId += 1;
    const myAttempt = starAttemptId;
    clearIdleTimer();
    updateView({ visible: true, phase: 'starring', errorCode: '' });

    let result;
    try {
      result = await starRepository();
    } catch {
      result = { ok: false, reason: 'request-failed' };
    }

    if (result && result.ok) {
      cachedStarStatus = 'starred';
      persistStarPrompt({ starredAt: new Date(now()).toISOString() });
      if (disposed || myAttempt !== starAttemptId || currentPhase() !== 'starring') {
        return { ok: true };
      }
      updateView({ visible: true, phase: 'success', errorCode: '' });
      clearAutoHideTimer();
      autoHideTimer = setTimer(() => {
        autoHideTimer = null;
        if (!disposed) {
          resetToHidden({ push: true });
        }
      }, SUCCESS_HIDE_DELAY_MS);
      return { ok: true };
    }

    const reason = result && 'reason' in result ? result.reason : undefined;
    const errorCode = reason === 'auth-failed' ? 'auth-failed' : 'request-failed';
    cachedStarStatus = reason === 'auth-failed'
      ? 'auth-failed'
      : (reason === 'no-credentials' ? 'no-credentials' : null);
    if (disposed || myAttempt !== starAttemptId || currentPhase() !== 'starring') {
      return { ok: false, errorCode };
    }
    updateView({
      visible: true,
      phase: 'error',
      mode: 'browser',
      errorCode,
    });
    return { ok: false, errorCode };
  }

  async function executeOpenBrowser() {
    clearIdleTimer();
    clearAutoHideTimer();
    starAttemptId += 1;
    try {
      await openExternal(REPO_URL);
    } catch (error) {
      log(`[star-prompt] openExternal failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (disposed) return { ok: false, reason: 'disposed' };
    sessionDismissed = true;
    persistStarPrompt({ snoozedUntil: new Date(now() + SNOOZE_DURATION_MS).toISOString() });
    resetToHidden({ push: true });
    return { ok: true };
  }

  /** @param {{ type?: unknown }} payload */
  async function handleAction(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new TypeError('Invalid star prompt action payload');
    }
    const type = /** @type {string} */ (payload.type);
    if (!VALID_ACTIONS.has(type)) {
      throw new TypeError(`Invalid star prompt action: ${String(type)}`);
    }
    if (disposed) return { ok: false, reason: 'disposed' };

    if (type === 'star') {
      if (view.mode === 'direct') {
        return executeDirectStar();
      }
      return executeOpenBrowser();
    }
    if (type === 'open-browser') {
      return executeOpenBrowser();
    }
    if (type === 'snooze') {
      clearIdleTimer();
      starAttemptId += 1;
      sessionDismissed = true;
      persistStarPrompt({ snoozedUntil: new Date(now() + SNOOZE_DURATION_MS).toISOString() });
      resetToHidden({ push: true });
      return { ok: true };
    }
    clearIdleTimer();
    starAttemptId += 1;
    sessionDismissed = true;
    persistStarPrompt({ dismissedForever: true });
    resetToHidden({ push: true });
    return { ok: true };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    starAttemptId += 1;
    clearIdleTimer();
    clearAutoHideTimer();
    detachMainWindow();
  }

  return {
    attachMainWindow,
    detachMainWindow,
    recordActivity,
    getView,
    handleAction,
    syncConfig,
    dispose,
  };
}

module.exports = {
  IDLE_THRESHOLD_MS,
  SNOOZE_DURATION_MS,
  SUCCESS_HIDE_DELAY_MS,
  STAR_PROMPT_CHANNEL,
  createStarPromptController,
};
