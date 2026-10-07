'use strict';

// Components panel module (lane C, refactor plan §5.0/§5.2). Lane A's
// launcher.html owns the <section id="panel-components"> container and the
// <script src="launcher-components.js"> tag; this file owns everything inside
// the container and mounts via window.__launcherComponents.mount(el, shell).
// Mounting twice is harmless — the second call just re-renders the list.
(function () {
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
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badge(text, variant) {
    return `<span class="badge${variant ? ` ${variant}` : ''}">${escapeHtml(text)}</span>`;
  }

  const STATE_LABELS = {
    available: '可安装',
    installed: '已安装',
    stopped: '已停止',
    running: '运行中',
    error: '异常',
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
    return badge(label, STATE_VARIANTS[row.state] || '');
  }

  function kindBadge(row) {
    const kind = KIND_LABELS[row.kind] || (row.kind ? [row.kind, ''] : null);
    return kind ? badge(kind[0], kind[1]) : '';
  }

  function iconGlyph(row) {
    const name = String(row.name || row.id || '?').trim();
    return escapeHtml((name[0] || '?').toUpperCase());
  }

  function rowMeta(row) {
    const bits = [];
    if (row.description) {
      bits.push(row.description);
    }
    bits.push(`v${row.version || '?'}`);
    if (row.installedVersion && row.installedVersion !== row.version) {
      bits.push(`已装 v${row.installedVersion}`);
    }
    return escapeHtml(bits.join(' · '));
  }

  function rowDetail(row) {
    const bits = [];
    if (row.updateAvailable) {
      bits.push(`有更新 v${row.version}`);
    }
    return bits.length ? escapeHtml(bits.join(' · ')) : '';
  }

  function rowActions(row) {
    const buttons = [];
    const btn = (action, label, cls) => `<button type="button" class="${cls} small" data-comp-action="${action}" data-comp-id="${escapeHtml(row.id)}">${label}</button>`;
    if (row.state === 'available') {
      buttons.push(btn('install', '安装', 'primary'));
    } else {
      if (row.state === 'running') {
        if (row.configurable) buttons.push(btn('open', '打开设置', 'primary'));
        buttons.push(btn('stop', '停止', 'ghost'));
      } else {
        buttons.push(btn('start', row.state === 'error' ? '重试启动' : '启动', 'primary'));
      }
      const management = [];
      if (row.updateAvailable) management.push(btn('update', `更新至 v${escapeHtml(row.version)}`, 'ghost'));
      if (row.previousVersion) management.push(btn('rollback', `回滚至 v${escapeHtml(row.previousVersion)}`, 'ghost'));
      management.push(btn('uninstall', '卸载', 'danger'));
      buttons.push(`<details class="comp-manage"><summary aria-label="管理${escapeHtml(row.name || row.id)}">管理<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></summary><div class="comp-manage-menu"><span class="row-meta">当前 v${escapeHtml(row.installedVersion || row.version)}</span>${management.join('')}</div></details>`);
    }
    if (row.message) buttons.push(statusDetailsButton(row));
    return buttons.join('');
  }

  function statusDetailsButton(row) {
    return `<button type="button" class="ghost small" data-comp-info="${escapeHtml(row.id)}">状态详情</button>`;
  }

  function renderRows(payload) {
    const rows = payload && Array.isArray(payload.components) ? payload.components : [];
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
      host.innerHTML = '<li><span class="row-meta">暂无可安装的组件。</span></li>';
      return;
    }
    host.innerHTML = rows.map((row) => {
      const marks = [
        kindBadge(row),
        row.source === 'official' ? badge('官方组件', 'blue') : (row.source === 'bundled' ? badge('内置', 'blue') : ''),
        row.updateAvailable ? badge('可更新') : '',
        row.orphan ? badge('目录外组件', 'warn') : '',
      ].join('');
      const detail = rowDetail(row);
      return `<li class="comp-row" data-comp-row="${escapeHtml(row.id)}">
        <div class="row-main">
          ${componentIcon(row)}
          <div class="comp-copy">
            <div class="row-title">${escapeHtml(row.name || row.id)} ${marks}</div>
            <div class="row-meta">${rowMeta(row)}</div>
            ${detail ? `<div class="row-meta">${detail}</div>` : ''}
          </div>
        </div>
        <div class="comp-status">
          ${stateBadge(row)}
          <div class="row-actions">${rowActions(row)}</div>
        </div>
      </li>`;
    }).join('');
    bindActions(host);
    syncPendingButtons();
  }

  function componentIcon(row) {
    return row.id === 'whalebridge'
      ? '<img class="comp-icon comp-brand" src="../../assets/whale-head.png" alt="鲸屿" width="36" height="36">'
      : `<span class="comp-icon" aria-hidden="true">${iconGlyph(row)}</span>`;
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
          void window.appNotice({ title: `${row.name || row.id}状态`, body: errorText(row.message, '无法读取组件状态') });
        }
      });
    });
  }

  function renderHomeRows(rows) {
    if (!state.homeEl || !state.homeList) return;
    const installed = rows.filter(row => row.installedVersion);
    state.homeEl.hidden = installed.length === 0;
    state.homeList.innerHTML = installed.map(row => {
      const running = row.state === 'running';
      const name = row.name || row.id;
      const control = `<button type="button" class="${running ? 'ghost' : 'primary'} small" data-comp-action="${running ? 'stop' : 'start'}" data-comp-id="${escapeHtml(row.id)}">${running ? '关闭' : '开启'}${escapeHtml(name)}</button>`;
      const settings = row.configurable && running ? `<button type="button" class="ghost small" data-comp-action="open" data-comp-id="${escapeHtml(row.id)}">打开设置</button>` : '';
      const details = row.message ? statusDetailsButton(row) : '';
      return `<article class="home-component" data-comp-row="${escapeHtml(row.id)}"><div class="home-component-head">${row.id === 'whalebridge' ? '' : componentIcon(row)}<div class="comp-copy"><h4>${escapeHtml(name)}</h4><span class="row-meta">v${escapeHtml(row.installedVersion)}</span></div>${stateBadge(row)}</div><p class="home-component-description">${escapeHtml(row.description || '鲸屿扩展组件')}</p><div class="home-component-controls">${control}${settings}${details}</div></article>`;
    }).join('');
    bindActions(state.homeList);
    syncPendingButtons();
  }

  function errorText(error, fallback) {
    return window.dshdErrText(error, fallback);
  }

  function syncPendingButtons() {
    for (const [id, pending] of state.pending) {
      pending.restoreButtons.forEach(restore => restore());
      pending.restoreButtons = [];
      for (const host of [state.el, state.homeEl]) {
        if (!host) continue;
        host.querySelectorAll(`[data-comp-id="${CSS.escape(id)}"]`).forEach((button) => {
          if (button.dataset.compAction === pending.action) {
            pending.restoreButtons.push(window.launcherButtonBusy(button, pending.label));
          } else {
            const disabled = button.disabled;
            button.disabled = true;
            pending.restoreButtons.push(() => { button.disabled = disabled; });
          }
        });
      }
    }
  }

  function progressText(payload) {
    const label = PHASE_LABELS[payload?.phase] || payload?.phase || '处理中';
    const detail = payload?.message || '';
    const percent = payload?.percent === undefined || payload.phase === 'done' || payload.phase === 'error'
      ? ''
      : ` ${payload.percent}%`;
    return `${label}${percent}${detail ? `：${detail}` : ''}`;
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
        if (notifyError) void window.appNotice({ title: '组件列表读取失败', body: errorText(error, '无法读取组件列表') });
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

  async function runAction(action, id, button) {
    const method = ACTION_METHODS[action];
    if (!method || typeof state.shell?.[method] !== 'function' || state.pending.has(id)) {
      return;
    }
    const row = state.rows.get(id);
    const name = row?.name || id;
    const focusHost = state.homeEl?.contains(button) ? state.homeEl : state.el;
    const pending = {
      action,
      label: action === 'uninstall' && id === 'whalebridge' ? '正在读取鲸桥状态…' : ACTION_LOADING[action],
      progress: null,
      restoreButtons: [],
    };
    state.pending.set(id, pending);
    syncPendingButtons();
    let argument = id;
    let failure = '';
    let completed = false;
    let completionMessage = '';
    try {
      if (action === 'uninstall' && typeof window.appConfirm === 'function') {
        const info = id === 'whalebridge' ? await state.shell.componentsUninstallInfo(id) : {};
        pending.label = '等待确认卸载…';
        syncPendingButtons();
        const ok = await window.appConfirm({
          title: `卸载组件「${name}」`,
          body: `将停止并删除组件「${name}」及其程序文件，其配置数据会保留。${id === 'whalebridge' ? '桌面端的鲸桥渠道会移除，聊天记录和其他渠道会保留。' : ''}${info.defaultModel ? '当前默认模型使用鲸桥，卸载后需要重新选择默认模型。' : ''}`,
          confirmText: '卸载',
          danger: true,
        });
        if (!ok) return;
        if (id === 'whalebridge') {
          const removeData = await window.appConfirm({
            title: '是否同时删除鲸桥配置？',
            body: '删除会清除鲸桥的供应商密钥、账户和用量数据。保留后重新安装可继续使用。',
            confirmText: '删除配置', cancelText: '保留配置', danger: true,
          });
          argument = { id, removeData };
        }
      } else if (action === 'rollback' && typeof window.appConfirm === 'function') {
        const ok = await window.appConfirm({
          title: `回滚组件「${name}」`,
          body: `将把组件「${name}」回滚到上一个版本${row?.previousVersion ? `（v${row.previousVersion}）` : ''}，当前进程会先停止。`,
          confirmText: '回滚',
        });
        if (!ok) return;
      }
      pending.label = ACTION_LOADING[action];
      syncPendingButtons();
      if (action === 'install' || action === 'update') {
        pending.progress = window.appProgress({
          title: `${action === 'install' ? '安装' : '更新'}${name}`,
          body: '正在获取组件版本…',
        });
      }
      const result = await state.shell[method](argument);
      if (result && result.ok === false) {
        failure = ACTION_ERRORS[result.error] || errorText(result, '操作失败');
      } else {
        completed = true;
        completionMessage = result?.message || '';
      }
    } catch (error) {
      failure = errorText(error, action === 'uninstall' ? '无法卸载组件' : '操作失败');
    } finally {
      pending.progress?.close();
      const restoreFocus = canRestoreActionFocus(button, focusHost);
      pending.restoreButtons.forEach(restore => restore());
      state.pending.delete(id);
      await refresh(false, !failure);
      if (restoreFocus) restoreActionFocus(button, focusHost, action, id);
    }
    if (failure) {
      void window.appNotice({ title: `${name}操作未完成`, body: failure });
    } else if (completed && completionMessage) {
      void window.appNotice({ title: `${name}操作结果`, body: completionMessage });
    } else if (completed && (action === 'install' || action === 'update')) {
      const version = state.rows.get(id)?.installedVersion;
      void window.appNotice({
        title: `${name}${action === 'install' ? '安装' : '更新'}完成`,
        body: version ? `当前版本为 v${version}。` : '组件已就绪。',
      });
    }
  }

  function onProgress(payload) {
    if (!payload || !payload.id) {
      return;
    }
    const pending = state.pending.get(payload.id);
    if (pending) {
      const text = progressText(payload);
      pending.progress?.update(text);
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
    el.innerHTML = `
      <header class="page-head">
        <h2>组件</h2>
        <span class="head-line row-meta" data-comp-route hidden>当前线路 <b class="cur-line"></b></span>
      </header>
      <p class="lede lede-block">按需安装独立工具与服务。鲸桥可统一管理模型，安装后自动连接桌面端的模型渠道。</p>
      <div class="actions">
        <button type="button" class="ghost" data-comp-refresh>刷新</button>
      </div>
      <ul class="list" data-comp-list></ul>`;
    state.list = el.querySelector('[data-comp-list]');
    el.querySelector('[data-comp-refresh]').addEventListener('click', () => void refresh(true));
    const routeNode = el.querySelector('[data-comp-route]');
    if (routeNode && state.shell && typeof state.shell.launcherStatus === 'function') {
      void state.shell.launcherStatus().then((status) => {
        const routes = Array.isArray(status?.routes) ? status.routes : [];
        const current = routes.find((route) => route.id === status?.downloadRoute);
        if (current) {
          routeNode.querySelector('.cur-line').textContent = current.label || current.id;
          routeNode.hidden = false;
        }
      }).catch(() => {});
    }
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
