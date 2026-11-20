'use strict';

const { app, ipcMain, nativeImage } = require('electron');
const { createRegisterIpc, unauthorizedError } = require('../ipc-register');
const { currentTheme } = require('../chrome');
const { getMinimalMode } = require('../render-mode');
const {
  createInitialState,
  selectBadgeCount,
  reduceApprovalState,
  projectPopupView,
} = require('./state');
const { createApprovalWireClient } = require('./wire');
const { createBadgePresenter } = require('./badge');
const { APPROVAL_POPUP_IPC, createApprovalPopupController } = require('./popup');

/** @type {ReadonlySet<import('./state').ApprovalAction>} */
const ALLOWED_ACTIONS = new Set(['allow-once', 'allow-always', 'reject', 'request-changes']);

/**
 * Register the five incoming IPC channels owned by the approval popup window.
 * @param {object} options
 * @param {any} options.ipcMain
 * @param {(event: any) => boolean} options.authorize
 * @param {() => import('./state').PopupView} options.getState
 * @param {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} options.decide
 * @param {(payload: Record<string, unknown>) => void} options.select
 * @param {(payload: Record<string, unknown>) => Promise<Record<string, unknown>>} options.openSession
 * @param {() => void} options.dismiss
 */
function registerApprovalPopupIpc(options) {
  const register = createRegisterIpc(options.ipcMain);
  const check = (/** @type {any} */ event) => {
    if (!options.authorize(event)) throw unauthorizedError();
    return 'approval-popup';
  };

  register({
    channel: APPROVAL_POPUP_IPC.state,
    authorize: check,
    handler: () => options.getState(),
  });
  register({
    channel: APPROVAL_POPUP_IPC.decide,
    authorize: check,
    handler: async (/** @type {unknown} */ _event, /** @type {Record<string, unknown>} */ payload) => options.decide(payload),
  });
  register({
    channel: APPROVAL_POPUP_IPC.select,
    authorize: check,
    handler: (/** @type {unknown} */ _event, /** @type {Record<string, unknown>} */ payload) => {
      options.select(payload);
    },
  });
  register({
    channel: APPROVAL_POPUP_IPC.openSession,
    authorize: check,
    handler: async (/** @type {unknown} */ _event, /** @type {Record<string, unknown>} */ payload) => options.openSession(payload),
  });
  register({
    channel: APPROVAL_POPUP_IPC.dismiss,
    authorize: check,
    handler: () => {
      options.dismiss();
    },
  });
}

/**
 * @param {any} win
 * @returns {boolean}
 */
function isMainWindowVisible(win) {
  return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
}

/**
 * @param {object} deps
 * @param {() => any} deps.getMainWindow
 * @param {(sessionId: string) => unknown} deps.openHarnessSession
 * @param {() => Record<string, any>} deps.loadConfig
 * @param {() => ({ width: number, height: number, bgra: Buffer } | null)} deps.getBaseTrayIcon
 * @param {(indicator: { image?: any, tooltip?: string } | null) => void} deps.setTrayBadge
 * @param {() => string} [deps.getSessionCookie]
 * @param {(message: string) => void} [deps.log]
 * @param {any} [deps.ipcMainImpl]
 * @param {any} [deps.appImpl]
 * @param {any} [deps.nativeImageImpl]
 * @param {() => { scheme: string }} [deps.getTheme]
 * @param {() => boolean} [deps.getMinimal]
 */
function createApprovalMonitor(deps) {
  const log = typeof deps.log === 'function' ? deps.log : () => {};
  const readTheme = deps.getTheme || currentTheme;
  const readMinimal = deps.getMinimal || getMinimalMode;
  const getCookie = deps.getSessionCookie || (() => '');

  /** @returns {'zh' | 'en'} */
  function currentLocale() {
    return deps.loadConfig?.()?.locale === 'en' ? 'en' : 'zh';
  }

  /** @returns {boolean} */
  function isPopupEnabled() {
    return deps.loadConfig?.()?.approvalPopupEnabled !== false;
  }

  let state = createInitialState({
    harnessActive: false,
    mainVisible: isMainWindowVisible(deps.getMainWindow()),
    popupEnabled: isPopupEnabled(),
  });
  let started = false;
  let disposed = false;
  let lastBadgeCount = -1;
  let lastBadgeLocale = currentLocale();
  /** @type {any} */
  let boundMainWin = null;
  /** @type {(() => void) | null} */
  let unbindMainWin = null;

  const badge = createBadgePresenter({
    app: deps.appImpl || app,
    nativeImage: deps.nativeImageImpl || nativeImage,
    getMainWindow: deps.getMainWindow,
    getBaseTrayIcon: deps.getBaseTrayIcon,
    setTrayBadge: deps.setTrayBadge,
    getLocale: currentLocale,
  });

  const popup = createApprovalPopupController({ log });

  const wire = createApprovalWireClient({
    log,
    onReady: () => {
      dispatch({ type: 'ADVANCE_EPOCH' });
    },
    onReconcileEpoch: (activeEpoch) => {
      dispatch({ type: 'RECONCILE_EPOCH', activeEpoch });
    },
    onApprovalUpsert: (item) => {
      dispatch({ type: 'UPSERT', item });
    },
    onApprovalCancel: (eventId) => {
      dispatch({ type: 'REMOVE', eventId });
    },
    onCommandPreview: (eventId, commandPreview) => {
      dispatch({ type: 'SET_COMMAND_PREVIEW', eventId, commandPreview });
    },
    onSessionTitles: (titles, meta) => {
      dispatch({ type: 'SET_SESSION_TITLES', titles, replace: meta.replace });
    },
  });

  /** @returns {import('./state').PopupView} */
  function currentPopupView() {
    const theme = readTheme();
    return projectPopupView(state, {
      locale: currentLocale(),
      theme: {
        scheme: theme?.scheme === 'dark' ? 'dark' : 'light',
        minimalMode: Boolean(readMinimal()),
      },
    });
  }

  function syncOutputs() {
    if (disposed) return;
    const count = selectBadgeCount(state);
    const locale = currentLocale();
    if (count !== lastBadgeCount || locale !== lastBadgeLocale) {
      lastBadgeCount = count;
      lastBadgeLocale = locale;
      badge.applyCount(count);
    }
    popup.sync(currentPopupView());
  }

  /** @param {import('./state').ApprovalStateAction} action */
  function dispatch(action) {
    if (disposed) return;
    state = reduceApprovalState(state, action);
    syncOutputs();
  }

  function detachMainWindow() {
    if (unbindMainWin) {
      unbindMainWin();
      unbindMainWin = null;
    }
    boundMainWin = null;
  }

  /** @param {any} win */
  function attachMainWindow(win) {
    if (disposed) return;
    if (win === boundMainWin) {
      dispatch({ type: 'SET_MAIN_VISIBLE', visible: isMainWindowVisible(win) });
      if (win && !win.isDestroyed()) badge.reapplyOverlay(win);
      return;
    }
    detachMainWindow();
    if (!win || win.isDestroyed()) {
      dispatch({ type: 'SET_MAIN_VISIBLE', visible: false });
      return;
    }
    boundMainWin = win;
    const onVisibility = () => {
      const visible = isMainWindowVisible(win);
      dispatch({ type: 'SET_MAIN_VISIBLE', visible });
      if (visible) badge.reapplyOverlay(win);
    };
    const onClosed = () => {
      if (boundMainWin === win) detachMainWindow();
      dispatch({ type: 'SET_MAIN_VISIBLE', visible: false });
    };
    const events = ['minimize', 'restore', 'hide', 'show'];
    for (const name of events) win.on(name, onVisibility);
    win.once('closed', onClosed);
    unbindMainWin = () => {
      if (!win.isDestroyed()) {
        for (const name of events) win.removeListener(name, onVisibility);
        win.removeListener('closed', onClosed);
      }
    };
    dispatch({ type: 'SET_MAIN_VISIBLE', visible: isMainWindowVisible(win) });
    badge.reapplyOverlay(win);
  }

  /**
   * @param {string} origin
   * @param {string} [cookie]
   */
  function setHarnessOrigin(origin, cookie = getCookie()) {
    if (disposed) return;
    const trimmed = typeof origin === 'string' ? origin.trim() : '';
    if (!trimmed) {
      wire.disconnect();
      dispatch({ type: 'SET_HARNESS_ACTIVE', active: false });
      return;
    }
    dispatch({ type: 'SET_HARNESS_ACTIVE', active: true });
    wire.connect(trimmed, cookie || '');
  }

  /** @param {Record<string, any>} [config] */
  function syncConfig(config = deps.loadConfig()) {
    dispatch({
      type: 'SET_POPUP_ENABLED',
      enabled: config?.approvalPopupEnabled !== false,
    });
  }

  /** @param {Record<string, unknown>} payload */
  async function handleDecide(payload) {
    const eventId = typeof payload.eventId === 'string' ? payload.eventId : '';
    const action = /** @type {import('./state').ApprovalAction} */ (payload.action);
    if (!eventId || !ALLOWED_ACTIONS.has(action)) {
      throw new TypeError('Invalid approval decision payload');
    }
    const target = state.items.find((item) => item.eventId === eventId);
    if (!target) return { ok: true };
    if (state.inflight.has(eventId)) return { ok: false, error: 'busy' };

    dispatch({ type: 'SETTLE_START', eventId, action });
    try {
      await wire.settle(eventId, action);
      // Gateway omits `cancel` frames for the submitting client; remove locally now.
      dispatch({ type: 'REMOVE', eventId });
      if (target.kind === 'plan-review' && action === 'request-changes') {
        deps.openHarnessSession(target.sessionId);
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'SETTLE_FAILED', eventId, message });
      return { ok: false, error: message };
    }
  }

  /** @param {Record<string, unknown>} payload */
  function handleSelect(payload) {
    if (typeof payload.eventId !== 'string' || !payload.eventId) return;
    dispatch({ type: 'SELECT', eventId: payload.eventId });
  }

  /** @param {Record<string, unknown>} payload */
  async function handleOpenSession(payload) {
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    if (!sessionId) throw new TypeError('sessionId is required');
    deps.openHarnessSession(sessionId);
    return { ok: true };
  }

  function handleDismiss() {
    dispatch({ type: 'DISMISS_POPUP' });
  }

  function start() {
    if (started || disposed) return;
    started = true;
    registerApprovalPopupIpc({
      ipcMain: deps.ipcMainImpl || ipcMain,
      authorize: (event) => popup.ownsEvent(event),
      getState: currentPopupView,
      decide: handleDecide,
      select: handleSelect,
      openSession: handleOpenSession,
      dismiss: handleDismiss,
    });
    attachMainWindow(deps.getMainWindow());
    syncOutputs();
  }

  function recreatePopupIfVisible() {
    if (disposed) return;
    popup.recreateIfVisible();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachMainWindow();
    wire.dispose();
    popup.dispose();
    badge.clear();
  }

  return {
    start,
    attachMainWindow,
    setHarnessOrigin,
    syncConfig,
    recreatePopupIfVisible,
    dispose,
  };
}

module.exports = {
  APPROVAL_POPUP_IPC,
  registerApprovalPopupIpc,
  createApprovalMonitor,
};
