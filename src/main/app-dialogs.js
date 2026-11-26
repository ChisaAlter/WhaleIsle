'use strict';

const { clipboard, dialog } = require('electron');
const { pathToFileURL } = require('node:url');
const { getMainWindow, getLauncherWindow } = require('./window');
const { loadConfig } = require('./config');
const { resolveDesktopLocale } = require('./desktop-locale');
const {
  modelActionConfirmOptions,
  secretDialogOptions,
  detailWithContext,
} = require('./model-action-dialog');
const { NEVER_ALWAYS_LEVELS } = require('../shared/model-tool-effects');
const { UpdateOverlays } = require('./update-overlay');
const { ShellConfirmDialog } = require('./update-dialog');
const { rendererFile } = require('./paths');

/**
 * Shell-modal confirmation layer extracted from index.js (#439 P3-4): the
 * shared overlay confirm dialog plus every desktop confirmation it hosts —
 * unverified installs, model-tool/plugin prompts, secret display, and the
 * task-protection stop prompt. Pure functions and dialogs; dependencies are
 * the leaf modules above and there is no mutable state of its own.
 *
 * @returns {{
 *   shellOverlays: UpdateOverlays,
 *   shellConfirm: () => ShellConfirmDialog,
 *   confirmDialog: (parent: any, options: Record<string, any>) => Promise<any>,
 *   firstVisibleWindow: () => any,
 *   confirmDesktopPluginChange: (request: Record<string, any>) => Promise<boolean>,
 *   confirmModelAction: (request: Record<string, any>) => Promise<any>,
 *   showDesktopSecret: (request: Record<string, any>) => Promise<{ ok: boolean }>,
 *   confirmTaskStop: (operation: string, inspection: Record<string, any>) => Promise<boolean>,
 * }}
 */
function createShellDialogs() {
  // Shell-modal confirmation layer (upstream update-dialog/update-overlay):
  // the same transparent-child modal carries update asks, task-protection
  // prompts, and unverified-install warnings instead of the native messagebox.
  const shellOverlays = new UpdateOverlays();
  /** @type {ShellConfirmDialog|undefined} */
  let shellConfirmInstance;
  let confirmQueue = Promise.resolve();
  let nativeQueue = Promise.resolve();
  function shellConfirm() {
    if (!shellConfirmInstance) {
      shellConfirmInstance = new ShellConfirmDialog(
        require('node:path').join(__dirname, '..', 'preload', 'update-dialog.js'),
        pathToFileURL(rendererFile('update-dialog.html')).href,
        shellOverlays,
      );
    }
    return shellConfirmInstance;
  }

  function presentNativeMessageBox(/** @type {any} */ parent, /** @type {Record<string, any>} */ options) {
    const task = nativeQueue.then(async () => {
      const targetParent = parent && !parent.isDestroyed?.() ? parent : undefined;
      // The native messagebox has no context slot: the fixed attribution line
      // folds ahead of the detail text so the fallback never drops it.
      const nativeDetail = detailWithContext(options);
      if (options.downloadMethods?.length > 0) {
        const methods = options.downloadMethods.filter((/** @type {any} */ method) => !method.disabledReason);
        const result = await dialog.showMessageBox(targetParent, /** @type {any} */ ({
          ...options,
          buttons: [...methods.map((/** @type {any} */ method) => method.label), '稍后'],
          defaultId: 0, cancelId: methods.length,
          detail: options.downloadMethods.map((/** @type {any} */ method) => `${method.label}：${method.disabledReason || method.description}`).join('\n')
            + '\n\n' + nativeDetail,
        }));
        return result.response < methods.length
          ? { response: 0, downloadMode: methods[result.response].id }
          : { response: options.cancelId };
      }
      return dialog.showMessageBox(targetParent, /** @type {any} */ ({ ...options, detail: nativeDetail }));
    });
    nativeQueue = task.then(() => undefined, () => undefined);
    return task;
  }

  async function presentConfirmDialog(/** @type {any} */ parent, /** @type {Record<string, any>} */ options) {
    if (parent && !parent.isDestroyed()) {
      try {
        return await shellConfirm().showQueued(parent, options);
      } catch (error) {
        console.warn('dshd dialog: shell confirm failed, native fallback', error);
      }
    }
    return presentNativeMessageBox(parent, options);
  }

  /**
   * Productized confirmation: serialized shell overlay modal when a window can
   * host it, native messagebox otherwise (no window yet, destroyed parent).
   * @param {any} parent
   * @param {Record<string, any>} options
   */
  async function confirmDialog(parent, options) {
    const cancelId = options?.cancelId ?? (Array.isArray(options?.buttons) ? options.buttons.length - 1 : 0);
    if (options?.signal?.aborted === true) {
      return { response: cancelId };
    }
    const prevQueue = confirmQueue;
    const run = prevQueue.then(async () => {
      if (options?.signal?.aborted === true) {
        return { response: cancelId };
      }
      const resolvedParent = typeof parent === 'function' ? parent() : parent;
      return presentConfirmDialog(resolvedParent, options);
    });
    if (!options?.signal) {
      confirmQueue = run.then(() => undefined, () => undefined);
      return run;
    }
    /** @type {(() => void) | undefined} */
    let onAbort;
    const aborted = new Promise((resolve) => {
      onAbort = () => resolve({ response: cancelId });
      options.signal.addEventListener('abort', onAbort, { once: true });
    });
    // Wait for prior prompts (prevQueue) before advancing, while letting an
    // abort unblock subsequent prompts if this prompt's native dialog hangs.
    const gated = Promise.race([run, aborted]).finally(() => {
      if (onAbort) options.signal.removeEventListener('abort', onAbort);
    });
    confirmQueue = Promise.all([prevQueue, gated]).then(() => undefined, () => undefined);
    return gated;
  }

  // Anchor for productized confirmations: the first VISIBLE window — a hidden
  // main window must not push prompts to the native fallback while the
  // launcher is on screen.
  function firstVisibleWindow() {
    return [getMainWindow(), getLauncherWindow()]
      .find((win) => win && !win.isDestroyed() && win.isVisible()) || null;
  }

  /**
   * Dialog copy dictionary for model-tool prompts, resolved from the app's
   * configured locale (zh default, en for English).
   */
  function desktopDialogMessages() {
    return resolveDesktopLocale(loadConfig().locale === 'en' ? 'en' : 'zh');
  }

  /**
   * Plugin mutations requested over the model-facing control channel
   * (/install and /desktop/plugin) must be approved on the desktop before the
   * main process executes them. Anything the loopback cannot get confirmed
   * stays undone.
   * @param {Record<string, any>} request
   */
  async function confirmDesktopPluginChange(request) {
    const action = String(request?.action || '');
    const target = Array.isArray(request?.target)
      ? request.target.join('、')
      : String(request?.target || '');
    const allowBuilds = Array.isArray(request?.allowBuilds) ? request.allowBuilds : [];
    let message;
    if (action === 'install') {
      message = target.startsWith('github:')
        ? `助理想安装插件 ${target}`
        : `助理想安装目录插件 ${target}`;
    } else if (action === 'remove') {
      message = `助理想卸载插件 ${target}`;
    } else if (action === 'disable') {
      message = `助理想停用插件 ${target}`;
    } else if (action === 'enable') {
      message = `助理想启用插件 ${target}`;
    } else {
      message = `助理想变更插件 ${target || action}`;
    }
    const detail = [
      '执行后桌面会重启 Harness 以应用变更，助理当前会话也会随之重启。',
      action === 'install' ? '插件代码会在本机运行。' : '',
      allowBuilds.length > 0 ? `并允许以下包在沙箱外运行构建脚本：${allowBuilds.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const result = await confirmDialog(firstVisibleWindow, {
      type: 'warning',
      buttons: ['允许', '拒绝'],
      defaultId: 1,
      cancelId: 1,
      dangerIds: [0],
      title: '助理请求变更插件',
      message,
      detail,
      noLink: true,
    });
    return result.response === 0;
  }

  /**
   * Confirmation for high-risk model-tool actions posted to /desktop/confirm.
   * Requests carrying an `effect` field take the model-action dialog; anything
   * else is a plugin mutation and keeps the existing plugin wording (and the
   * boolean answer). Model actions answer 'always' | 'once' | 'deny';
   * destructive/code levels never offer a run-scoped allow, and any unexpected
   * response fails closed as 'deny'. The dialog paints the endpoint-resolved
   * source and level in fixed slots (see model-action-dialog.js) — the
   * caller's summary/details only fill the request-content region.
   * @param {Record<string, any>} request
   */
  async function confirmModelAction(request) {
    if (!request || typeof request.effect !== 'string' || !request.effect) {
      return confirmDesktopPluginChange(request);
    }
    const locale = desktopDialogMessages();
    const result = await confirmDialog(firstVisibleWindow,
      modelActionConfirmOptions(request, locale.messages, locale.id));
    if (result.response === 1) return 'once';
    if (result.response === 2 && !NEVER_ALWAYS_LEVELS.has(request.effect)) return 'always';
    return 'deny';
  }

  /**
   * Show a generated secret (pairing code, public tunnel address) to the user in
   * a desktop dialog with a copy button, so the value never has to travel
   * through model-visible tool output. The fixed attribution line names the
   * requesting tool (or the generic assistant source) so caller-supplied
   * title/label/hint cannot masquerade as the request's origin.
   * @param {Record<string, any>} request
   */
  async function showDesktopSecret(request) {
    const secret = String(request?.secret || '');
    if (!secret) return { ok: false };
    const locale = desktopDialogMessages();
    const options = secretDialogOptions(request, locale.messages, locale.id);
    for (;;) {
      const result = await confirmDialog(firstVisibleWindow, options);
      if (result.response !== 0) return { ok: true };
      clipboard.writeText(secret);
    }
  }

  /** @type {Record<string, string>} */
  const TASK_VERBS = {
    quit: '退出',
    restart: '重启',
    reload: '重新加载',
    stop: '停止桌面端',
    update: '安装更新',
    install: '安装运行时',
    delta: '增量更新',
  };

  /**
   * @param {Record<string, any>} item
   */
  function describeWorkItem(item) {
    switch (item && item.kind) {
      case 'agent':
        return `代理会话运行中（${item.id}）`;
      case 'job':
        return `后台任务运行中（${item.id}）`;
      case 'request':
        return `${item.count || 1} 个在途请求`;
      case 'socket':
        return `${item.count || 1} 条已建立的远程连接`;
      case 'schedule-task':
        return `定时提醒${item.due ? '已到期' : '待触发'}：${item.title || item.id}`;
      case 'pty':
        return `${item.count || 1} 个打开的终端会话`;
      default:
        return item && item.detail ? String(item.detail) : '有后台工作项';
    }
  }

  /**
   * @param {string} operation
   * @param {Record<string, any>} inspection
   * @param {{ signal?: AbortSignal }} [ctx]
   */
  async function confirmTaskStop(operation, inspection, ctx) {
    const verb = TASK_VERBS[operation] || '继续';
    const parts = [];
    for (const item of inspection.activeWork || []) {
      parts.push(describeWorkItem(item));
    }
    for (const item of inspection.scheduledWork || []) {
      parts.push(describeWorkItem(item));
    }
    const unknownCoverage = Object.values(inspection.coverage || {})
      .some((value) => value !== 'ok' && value !== 'intentional-disabled');
    const detail = [
      parts.length > 0 ? `仍在运行：${[...new Set(parts)].join('；')}` : '后台任务状态无法完全确认',
      unknownCoverage ? '注意：部分后台服务状态未知' : '',
    ].filter(Boolean).join('\n');
    const options = {
      type: 'warning',
      // Order matches confirmUnverifiedColdStart / openDesktopUpdate: confirm
      // action at index 0 (primary), cancel at index 1 (secondary). Enter and
      // Esc both land on cancel — the risky verb requires an explicit click.
      buttons: [`仍然${verb}`, '取消'],
      defaultId: 1,
      cancelId: 1,
      dangerIds: [0],
      title: `${verb}前确认`,
      message: `${verb}将中断仍在运行的工作`,
      detail,
      noLink: true,
      ...(ctx?.signal ? { signal: ctx.signal } : {}),
    };
    const result = await confirmDialog(firstVisibleWindow, options);
    return result.response === 0;
  }

  return {
    shellOverlays,
    shellConfirm,
    confirmDialog,
    firstVisibleWindow,
    confirmDesktopPluginChange,
    confirmModelAction,
    showDesktopSecret,
    confirmTaskStop,
  };
}

module.exports = { createShellDialogs };
