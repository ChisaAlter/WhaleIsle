'use strict';

// Components panel module (lane C, refactor plan §5.0/§5.2). Lane A's
// launcher.html owns the <section id="panel-components"> container and the
// <script src="launcher-components.js"> tag; this file owns everything inside
// the container and mounts via window.__launcherComponents.mount(el, shell).
// Mounting twice is harmless — the second call just re-renders the list.
(function () {
  const { h, mount: mountNodes } = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/dom')
    : window.whaleDom;
  const state = {
    el: null,
    shell: null,
    unsubscribe: null,
    pending: new Map(),
    rows: new Map(),
    list: null,
    homeEl: null,
    homeList: null,
    refreshing: null,
    // A failed action stays on its component row until the next action.
    failures: new Map(),
  };

  function badge(text, variant) {
    return h('span', { class: `badge${variant ? ` ${variant}` : ''}` }, text);
  }

  const STATE_LABELS = {
    available: '可安装',
    installed: '已安装',
    stopped: '已停止',
    running: '运行中',
    error: '异常',
    unsupported: '暂不支持',
  };

  const STATE_VARIANTS = {
    running: 'green',
    error: 'warn',
  };

  const KIND_LABELS = {
    service: ['服务', 'amber'],
    tool: ['工具', ''],
  };

  const PHASE_LABELS = {
    download: '正在下载组件',
    copy: '正在拷贝组件文件',
    verify: '正在校验组件',
    switch: '正在切换版本',
    spawn: '正在启动进程',
    wait: '正在等待组件就绪',
    stop: '正在停止进程',
    remove: '正在移除组件',
    retry: '进程退出，准备重启',
    done: '完成',
    error: '失败',
  };

  function stateBadge(row) {
    const label = STATE_LABELS[row.state] || row.state || '未知';
    if (row.message) {
      return h('button', {
        type: 'button',
        class: `badge comp-state-details${STATE_VARIANTS[row.state] ? ` ${STATE_VARIANTS[row.state]}` : ''}`,
        dataset: { compInfo: row.id },
        'aria-label': `${row.name || row.id}${label}，查看状态详情`,
        title: '查看状态详情',
      }, label);
    }
    return badge(label, STATE_VARIANTS[row.state] || '');
  }

  function kindBadge(row) {
    const kind = KIND_LABELS[row.kind] || (row.kind ? [row.kind, ''] : null);
    return kind ? badge(kind[0], kind[1]) : null;
  }

  function iconGlyph(row) {
    const name = String(row.name || row.id || '?').trim();
    return (name[0] || '?').toUpperCase();
  }

  function rowMeta(row) {
    const bits = [];
    if (row.description) {
      bits.push(row.description);
    }
    if (row.state !== 'unsupported') bits.push(`v${row.version || '?'}`);
    if (row.installedVersion && row.installedVersion !== row.version) {
      bits.push(`已装 v${row.installedVersion}`);
    }
    return bits.join(' · ');
  }

  function rowDetail(row) {
    const bits = [];
    if (row.updateAvailable) {
      bits.push(`有更新 v${row.version}`);
    }
    return bits.length ? bits.join(' · ') : '';
  }

  function failureLine(row) {
    const failure = state.failures.get(row.id);
    return failure
      ? h('p', { class: 'comp-failure', dataset: { compFailure: '' }, role: 'status' }, `操作未完成：${failure}`)
      : null;
  }

  /** @param {any} row */
  function rowCapabilities(row) {
    const caps = row?.capabilities;
    if (caps && typeof caps === 'object') return caps;
    const isRunning = row.state === 'running';
    const isInstalled = Boolean(row.installedVersion || (row.state && row.state !== 'available' && row.state !== 'unsupported'));
    return {
      canInstall: row.state === 'available',
      canStart: isInstalled && !isRunning,
      canStop: isInstalled && isRunning,
      canOpen: Boolean(row.configurable && isRunning),
      canUpdate: Boolean(row.updateAvailable),
      canRollback: Boolean(row.previousVersion),
      canUninstall: isInstalled,
      canDeleteData: false,
      externalUpdateUrl: '',
    };
  }

  function rowActions(row) {
    const buttons = [];
    const btn = (action, label, cls) => h('button', {
      type: 'button',
      class: `${cls} small`,
      dataset: { compAction: action, compId: row.id },
    }, label);
    if (row.state === 'unsupported') return buttons;
    const caps = rowCapabilities(row);
    if (caps.canInstall) {
      buttons.push(btn('install', '安装', 'primary'));
      return buttons;
    }
    if (row.state === 'running') {
      if (caps.canOpen) buttons.push(btn('open', '打开设置', 'primary'));
      if (caps.canStop) buttons.push(btn('stop', '停止', 'ghost'));
    } else if (caps.canStart) {
      buttons.push(btn('start', row.state === 'error' ? '重试启动' : '启动', 'primary'));
    }
    if (caps.canUpdate) {
      buttons.push(btn('update', `更新至 v${row.latest || row.version}`, 'ghost'));
    } else if (caps.externalUpdateUrl) {
      buttons.push(btn('update', `前往更新 v${row.latest || row.version}`, 'ghost'));
    }
    const management = [];
    if (caps.canRollback && row.previousVersion) {
      management.push(btn('rollback', `回滚至 v${row.previousVersion}`, 'ghost'));
    }
    if (caps.canUninstall) {
      management.push(btn('uninstall', '卸载', 'danger'));
    }
    if (management.length) {
      buttons.push(h('details', { class: 'comp-manage' },
        h('summary', { 'aria-label': `管理${row.name || row.id}` },
          '管理',
          h('svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('path', { d: 'm4 6 4 4 4-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3' }))),
        h('div', { class: 'comp-manage-menu' },
          h('span', { class: 'row-meta' }, `当前 v${row.installedVersion || row.version}`),
          ...management)));
    }
    return buttons;
  }

  function renderRows(payload) {
    const rows = payload && Array.isArray(payload.components) ? payload.components : [];
    const changed = rows.filter(row => state.rows.has(row.id) && state.rows.get(row.id).state !== row.state);
    if (changed.length) {
      const status = document.getElementById('component-status');
      if (status) status.textContent = changed.map(row => `${row.name || row.id}：${STATE_LABELS[row.state] || row.state}`).join('；');
    }
    state.rows = new Map(rows.map((row) => [row.id, row]));
    renderHomeRows(rows);
    const badgeNode = document.getElementById('tab-badge-components');
    if (badgeNode) {
      const count = rows.filter(row => row.updateAvailable || row.state === 'error').length;
      badgeNode.hidden = count === 0;
      badgeNode.textContent = count ? String(count) : '';
    }
    const host = state.list;
    if (!host) {
      return;
    }
    if (!rows.length) {
      mountNodes(host, h('li', {}, h('span', { class: 'row-meta' }, '暂无可安装的组件。')));
      return;
    }
    mountNodes(host, ...rows.map((row) => {
      const ownershipBadge = row.ownership === 'external' || row.ownership === 'external-ui-companion'
        ? badge('复用本机', 'blue')
        : (row.ownership === 'managed-shared-config' ? badge('共享配置', 'blue') : null);
      const marks = [
        kindBadge(row),
        row.source === 'official' ? badge('官方组件', 'blue') : (row.source === 'bundled' ? badge('内置', 'blue') : null),
        ownershipBadge,
        row.updateAvailable ? badge('可更新') : null,
        row.orphan ? badge('目录外组件', 'warn') : null,
      ];
      const detail = rowDetail(row);
      return h('li', { class: 'comp-row', dataset: { compRow: row.id } },
        h('div', { class: 'row-main' },
          componentIcon(row),
          h('div', { class: 'comp-copy' },
            h('div', { class: 'row-title' }, `${row.name || row.id} `, ...marks),
            h('div', { class: 'row-meta' }, rowMeta(row)),
            detail ? h('div', { class: 'row-meta' }, detail) : null,
            failureLine(row))),
        h('div', { class: 'comp-status' },
          stateBadge(row),
          h('div', { class: 'row-actions' }, ...rowActions(row))));
    }));
    bindActions(host);
    syncPendingButtons();
  }

  function componentIcon(row) {
    return row.source === 'official'
      ? h('img', { class: 'comp-icon comp-brand', src: '../../assets/whale-head.png', alt: '鲸屿', width: '36', height: '36' })
      : h('span', { class: 'comp-icon', 'aria-hidden': 'true' }, iconGlyph(row));
  }

  function bindActions(host) {
    host.querySelectorAll('[data-comp-action]').forEach((button) => {
      button.addEventListener('click', () => {
        void runAction(button.dataset.compAction, button.dataset.compId, button);
      });
    });
    host.querySelectorAll('[data-comp-info]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = state.rows.get(button.dataset.compInfo);
        if (row?.message) {
          void window.appNotice({ title: `${row.name || row.id}状态`, body: errorText(row.message, '无法读取组件状态'), holdMs: null });
        }
      });
    });
  }

  function renderHomeRows(rows) {
    if (!state.homeEl || !state.homeList) return;
    const installed = rows.filter((row) => row.installedVersion || row.ownership === 'external' || row.ownership === 'external-ui-companion');
    state.homeEl.hidden = installed.length === 0;
    mountNodes(state.homeList, ...installed.map(row => {
      const caps = rowCapabilities(row);
      const running = row.state === 'running';
      const name = row.name || row.id;
      const control = (running && caps.canStop) || (!running && caps.canStart)
        ? h('button', {
          type: 'button',
          class: `${running ? 'ghost' : 'primary'} small`,
          dataset: { compAction: running ? 'stop' : 'start', compId: row.id },
        }, `${running ? '关闭' : '开启'}${name}`)
        : null;
      const settings = caps.canOpen && running
        ? h('button', { type: 'button', class: `${control ? 'ghost' : 'primary'} small`, dataset: { compAction: 'open', compId: row.id } }, '打开设置')
        : null;
      return h('article', { class: 'home-component', dataset: { compRow: row.id } },
        h('div', { class: 'home-component-head' },
          row.source === 'official' ? null : componentIcon(row),
          h('div', { class: 'comp-copy' },
            h('h4', {}, name),
            h('span', { class: 'row-meta' }, row.installedVersion ? `v${row.installedVersion}` : '外部运行中')),
          stateBadge(row)),
        h('p', { class: 'home-component-description' }, row.description || '鲸屿扩展组件'),
        failureLine(row),
        h('div', { class: 'home-component-controls' }, control, settings));
    }));
    bindActions(state.homeList);
    syncPendingButtons();
  }

  function errorText(error, fallback) {
    return window.dshdErrText(error, fallback);
  }

  function syncPendingButtons() {
    for (const [id, pending] of state.pending) {
      for (const [button, restore] of pending.restoreButtons) {
        if (!button.isConnected) {
          restore();
          pending.restoreButtons.delete(button);
        }
      }
      for (const host of [state.el, state.homeEl]) {
        if (!host) continue;
        host.querySelectorAll(`[data-comp-id="${CSS.escape(id)}"]`).forEach((button) => {
          const restore = pending.restoreButtons.get(button);
          if (button.dataset.compAction === pending.action) {
            if (restore) restore.update(pending.label, buttonLabel(pending.label));
            else pending.restoreButtons.set(button, window.launcherButtonBusy(button, pending.label, buttonLabel(pending.label)));
          } else if (!restore) {
            const disabled = button.disabled;
            button.disabled = true;
            pending.restoreButtons.set(button, () => { button.disabled = disabled; });
          }
        });
      }
    }
  }

  // The button keeps a short form of the phase ("正在下载组件 42%：…" →
  // "下载中 42%"); the full sentence stays in the status line and aria-label.
  function buttonLabel(text) {
    const head = String(text).split('：')[0];
    const percent = head.match(/\d+%/)?.[0];
    const base = head.startsWith('正在') ? `${head.slice(2, 4)}中` : head.replace(/\s*\d+%$/, '').split('，').at(-1);
    return percent ? `${base.replace(/中$/, '')} ${percent}` : `${base.replace(/…$/, '')}…`;
  }

  function progressText(payload) {
    const label = PHASE_LABELS[payload?.phase] || payload?.phase || '处理中';
    const detail = payload?.message || '';
    const percent = payload?.percent === undefined || payload.phase === 'done' || payload.phase === 'error'
      ? ''
      : ` ${payload.percent}%`;
    return `${label}${percent}${detail ? `：${detail}` : ''}`;
  }

  // A list that cannot be read is reported where the list would be, not in a
  // floating notice.
  function showListFailure(message) {
    const text = `组件列表读取失败：${message}`;
    const status = document.getElementById('component-status');
    if (status) status.textContent = text;
    if (state.list && !state.rows.size) {
      mountNodes(state.list, h('li', {},
        h('span', { class: 'comp-failure', dataset: { compFailure: '' }, role: 'status' }, text)));
    }
  }

  function refresh(checkUpdates = false, notifyError = true) {
    if (!state.shell || typeof state.shell.componentsList !== 'function') {
      return Promise.resolve();
    }
    if (state.refreshing) return state.refreshing;
    const button = state.el?.querySelector('[data-comp-refresh]');
    const restore = button ? window.launcherButtonBusy(button, '正在刷新组件…') : () => {};
    state.refreshing = Promise.resolve().then(async () => {
      try {
        renderRows(await state.shell.componentsList(checkUpdates ? { refresh: true } : undefined));
      } catch (error) {
        if (notifyError) showListFailure(errorText(error, '无法读取组件列表'));
      } finally {
        restore();
        state.refreshing = null;
      }
    });
    return state.refreshing;
  }

  const ACTION_METHODS = {
    open: 'componentsOpen',
    install: 'componentsInstall',
    start: 'componentsStart',
    stop: 'componentsStop',
    update: 'componentsUpdate',
    rollback: 'componentsRollback',
    uninstall: 'componentsUninstall',
  };

  const ACTION_ERRORS = {
    'invalid-id': '组件 id 无效。',
    'unknown-component': '组件目录中没有这个组件。',
    'unknown-version': '没有该版本可供安装。',
    'already-installed': '组件已安装，请使用更新。',
    'not-installed': '组件未安装。',
    'spawn-failed': '组件进程启动失败。',
    'early-exit': '组件启动后立即退出，详见组件日志。',
    'payload-missing': '组件负载缺失，请重新安装。',
    'no-newer-version': '已是最新版本。',
    'nothing-to-rollback': '没有可回滚的版本。',
    'rollback-payload-missing': '回滚版本已被清理，无法回滚。',
    busy: '该组件有操作进行中。',
  };

  const ACTION_LOADING = {
    open: '正在打开组件设置…',
    install: '正在安装组件…',
    start: '正在启动组件…',
    stop: '正在停止组件…',
    update: '正在更新组件…',
    rollback: '正在回滚组件…',
    uninstall: '正在卸载组件…',
  };

  function canRestoreActionFocus(button, host) {
    if (!host?.checkVisibility() || !document.getElementById('app-confirm').hidden) return false;
    const active = document.activeElement;
    return active === button || active === document.body || active === document.documentElement
      || Boolean(active?.closest('#app-confirm'));
  }

  function restoreActionFocus(button, host, action, id) {
    if (!canRestoreActionFocus(button, host)) return;
    const buttons = [...host.querySelectorAll(`[data-comp-id="${CSS.escape(id)}"]`)]
      .filter(control => !control.disabled && control.checkVisibility());
    const target = buttons.find(control => control.dataset.compAction === action)
      || buttons[0] || host.querySelector('[data-comp-refresh]');
    if (target && !target.disabled && target.checkVisibility()) target.focus();
  }

  /**
   * @param {string} id
   * @param {string} name
   * @param {any} row
   * @param {any} caps
   * @param {any} pending
   */
  async function promptUninstall(id, name, row, caps, pending) {
    const shell = /** @type {any} */ (state.shell);
    const info = typeof shell?.componentsUninstallInfo === 'function'
      ? (await shell.componentsUninstallInfo(id) || {})
      : {};
    pending.label = '等待确认卸载…';
    syncPendingButtons();
    const sharedNote = info.sharedConfig ? '本机共享配置 ~/.config/magpie 将完整保留。' : '';
    const channelNote = row?.source === 'official' ? `桌面端的 ${name} 渠道会移除，聊天记录和其他渠道会保留。` : '';
    const defaultNote = info.defaultModel ? `当前默认模型使用 ${name}，卸载后需要重新选择默认模型。` : '';
    const ok = await window.appConfirm({
      title: `卸载组件「${name}」`,
      body: `将停止并删除组件「${name}」及其程序文件，其配置数据会保留。${channelNote}${sharedNote}${defaultNote}`,
      confirmText: '卸载',
      danger: true,
    });
    if (!ok) return { cancelled: true, argument: id };
    if (!caps.canDeleteData) return { cancelled: false, argument: id };
    const removeData = await window.appConfirm({
      title: `是否同时删除 ${name} 配置？`,
      body: `删除会清除 ${name} 的供应商密钥、账户和用量数据。保留后重新安装可继续使用。`,
      confirmText: '删除配置', cancelText: '保留配置', danger: true,
    });
    return { cancelled: false, argument: { id, removeData } };
  }

  /**
   * @param {any} action
   * @param {string} id
   * @param {string} name
   * @param {any} row
   * @param {any} pending
   */
  async function confirmComponentAction(action, id, name, row, pending) {
    if (typeof window.appConfirm !== 'function') return { cancelled: false, argument: id };
    if (action === 'uninstall') {
      return promptUninstall(id, name, row, row ? rowCapabilities(row) : {}, pending);
    }
    if (action === 'rollback') {
      const ok = await window.appConfirm({
        title: `回滚组件「${name}」`,
        body: `将把组件「${name}」回滚到上一个版本${row?.previousVersion ? `（v${row.previousVersion}）` : ''}，当前进程会先停止。`,
        confirmText: '回滚',
      });
      return { cancelled: !ok, argument: id };
    }
    return { cancelled: false, argument: id };
  }

  /** @param {string} text */
  function setComponentStatusText(text) {
    const status = document.getElementById('component-status');
    if (status) status.textContent = text;
  }

  /**
   * @param {any} shell
   * @param {string} method
   * @param {any} argument
   * @param {any} action
   */
  async function invokeComponentAction(shell, method, argument, action) {
    try {
      const result = await shell[method](argument);
      if (result && result.ok === false) {
        return { failure: ACTION_ERRORS[result.error] || errorText(result, '操作失败'), completionMessage: '' };
      }
      return { failure: '', completionMessage: result?.message || '' };
    } catch (error) {
      return { failure: errorText(error, action === 'uninstall' ? '无法卸载组件' : '操作失败'), completionMessage: '' };
    }
  }

  /** @param {any} action @param {string} id @param {any} button */
  async function runAction(action, id, button) {
    const shell = /** @type {any} */ (state.shell);
    const method = ACTION_METHODS[action];
    if (!method || typeof shell?.[method] !== 'function' || state.pending.has(id)) return;
    const row = state.rows.get(id);
    const name = row?.name || id;
    const focusHost = state.homeEl?.contains(button) ? state.homeEl : state.el;
    const pending = {
      action,
      label: action === 'uninstall' && typeof shell.componentsUninstallInfo === 'function'
        ? `正在读取${name}状态…` : ACTION_LOADING[action],
      restoreButtons: new Map(),
    };
    state.pending.set(id, pending);
    state.failures.delete(id);
    syncPendingButtons();
    let res = { failure: '', completionMessage: '' };
    try {
      const conf = await confirmComponentAction(action, id, name, row, pending);
      if (conf.cancelled) return;
      pending.label = ACTION_LOADING[action];
      setComponentStatusText(`${name}：${pending.label}`);
      syncPendingButtons();
      res = await invokeComponentAction(shell, method, conf.argument, action);
    } finally {
      if (res.failure) state.failures.set(id, res.failure);
      const restoreFocus = canRestoreActionFocus(button, focusHost);
      pending.restoreButtons.forEach(restore => restore());
      state.pending.delete(id);
      await refresh(false, !res.failure);
      if (restoreFocus) restoreActionFocus(button, focusHost, action, id);
    }
    if (res.failure) setComponentStatusText(`${name}操作未完成：${res.failure}`);
    else if (res.completionMessage) void window.appNotice({ title: `${name}操作结果`, body: res.completionMessage });
  }

  function onProgress(payload) {
    if (!payload || !payload.id) {
      return;
    }
    const pending = state.pending.get(payload.id);
    if (pending) {
      const text = progressText(payload);
      const status = document.getElementById('component-status');
      if (status) status.textContent = `${state.rows.get(payload.id)?.name || payload.id}：${text}`;
      pending.label = text;
      syncPendingButtons();
    } else if (payload.phase === 'done' || payload.phase === 'error') {
      void refresh();
    }
  }

  function mount(el, shell) {
    if (!el) {
      return;
    }
    if (state.el === el && state.shell === shell) {
      // Double-mount: keep the existing DOM/subscription, refresh data only.
      void refresh();
      return;
    }
    state.el = el;
    connect(shell);
    mountNodes(el,
      h('header', { class: 'page-head' },
        h('h2', {}, '组件'),
        h('span', { class: 'head-line row-meta', dataset: { compRoute: '' }, hidden: true },
          '当前线路 ', h('b', { class: 'cur-line' }))),
      h('p', { class: 'lede lede-block' }, '按需安装独立工具与服务。Magpie 可复用本机实例或由启动器托管更新，并自动接入桌面端的模型渠道。'),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'ghost', dataset: { compRefresh: '' } }, '刷新')),
      h('ul', { class: 'list', dataset: { compList: '' } }));
    state.list = el.querySelector('[data-comp-list]');
    el.querySelector('[data-comp-refresh]').addEventListener('click', () => void refresh(true));
    void refresh();
  }

  function connect(shell) {
    if (state.shell === shell) return;
    state.unsubscribe?.();
    state.shell = shell || null;
    state.unsubscribe = state.shell?.onComponentsProgress?.(onProgress) || null;
  }

  function mountHome(el, shell) {
    state.homeEl = el;
    state.homeList = el?.querySelector('#home-components-list') || null;
    connect(shell);
  }

  window.__launcherComponents = { mount, mountHome, refresh };
})();
