'use strict';

// 插件页与恢复提示：取证面板、行动按钮与刷新。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

function pluginErrorHint(code) {
  const recovery = window.launcherRecovery;
  if (recovery && typeof recovery.pluginErrorLabel === 'function') {
    return recovery.pluginErrorLabel(code);
  }
  const labels = {
    preset: '桌面预置插件不可移除。',
    'official-template': '官方模板插件不可禁用。',
    'desktop-builtin': '桌面内置组件不可禁用。',
    'missing-name': '缺少插件名称。',
    'missing-names': '缺少插件名称。',
  };
  return labels[code] || code || '操作失败';
}

function evidenceLines(forensics, name) {
  const rows = Array.isArray(forensics?.evidence) ? forensics.evidence : [];
  return rows.filter((row) => row.name === name).map((row) => row.line);
}

function pluginBoardRows(forensics, sortSuspectsFirst) {
  const plugins = Array.isArray(forensics?.plugins) ? forensics.plugins : [];
  const orphans = Array.isArray(forensics?.orphanSuspects) ? forensics.orphanSuspects : [];
  const rows = [...plugins, ...orphans];
  if (sortSuspectsFirst && window.launcherRecovery?.sortPluginRows) {
    return window.launcherRecovery.sortPluginRows(rows);
  }
  return rows;
}

function disableableSuspectNames(forensics) {
  return window.launcherRecovery.disableableSuspectNames(forensics);
}

function forensicsSummaryText(forensics) {
  if (!forensics) {
    return '尚未生成排查结果。';
  }
  if (forensics.genericCause) {
    const recovery = window.launcherRecovery;
    const labels = recovery?.GENERIC_LABELS || {
      oom: '检测到内存不足（OOM），与单个插件无关。',
      'port-excluded': '端口被系统保留或无权监听（listen EACCES），与插件无关，跳过用户插件无法修复。',
      'port-in-use': '检测到端口被占用，与单个插件无关。',
      'missing-node': '未找到 Node 运行时，与单个插件无关。',
    };
    return labels[forensics.genericCause] || String(forensics.genericCause);
  }
  if (forensics.desktopRuntimeDamage && window.launcherRecovery?.desktopRuntimeDamageVerdict) {
    return window.launcherRecovery.desktopRuntimeDamageVerdict(forensics);
  }
  if (forensics.suspects && forensics.suspects.length) {
    return `启动日志指向以下可疑插件：${forensics.suspects.map((row) => row.name || row).join('、')}。建议优先处理后再启动。`;
  }
  return '未能从日志确定具体插件。可逐项禁用下列插件后重新启动，以排查冲突。';
}

function renderPluginBoard(forensics, options = {}) {
  const list = $(options.listId);
  if (!list) {
    return;
  }
  if (options.summaryId) {
    const summary = $(options.summaryId);
    if (summary) {
      summary.textContent = options.summaryText || forensicsSummaryText(forensics);
    }
  }
  if (!forensics) {
    mount(list, h('li', {}, h('span', { class: 'row-meta' }, '尚未扫描，点击「重新扫描」生成排查结果。')));
    return;
  }
  const allowRemove = options.allowRemove === true;
  const rows = pluginBoardRows(forensics, options.sortSuspectsFirst === true);
  if (!rows.length) {
    mount(list, h('li', {}, h('span', { class: 'row-meta' }, '未检测到插件，当前插件环境为空。')));
    return;
  }
  mount(list, ...rows.map((row) => {
    const marks = [
      row.inBox ? badge('内置组件', true) : (row.orphan ? badge('未在 profile 登记', true) : null),
      row.officialTemplate ? badge('官方模板') : null,
      row.preset ? badge('桌面预置') : null,
      row.disabled ? badge('已禁用') : null,
      row.suspect ? badge('可疑冲突', true) : null,
    ];
    const actions = [];
    if (row.inBox) {
      actions.push(h('span', { class: 'row-meta' }, '桌面内置组件损坏；禁用或跳过均无效，需重装桌面端。'));
    } else if (row.orphan) {
      actions.push(h('span', { class: 'row-meta' }, '日志中出现但未写入 profile，无法在此禁用。'));
    } else if (row.officialTemplate) {
      actions.push(h('span', { class: 'row-meta', title: '官方模板插件不可禁用。' }, '不可禁用'));
    } else if (row.disabled) {
      actions.push(h('button', { type: 'button', class: 'ghost small', dataset: { enable: row.name } }, '启用'));
    } else {
      actions.push(h('button', { type: 'button', class: 'ghost small', dataset: { disable: row.name } }, '禁用'));
    }
    if (allowRemove && !row.preset && !row.orphan) {
      // Slim packages ship no vendored plugin toolchain, so removal is
      // intentionally routed to the installed desktop app.
      actions.push(lastStatus?.launcherPackage === true
        ? h('span', { class: 'row-meta', title: '轻量启动器不含插件工具链' }, '需在桌面端内移除')
        : h('button', { type: 'button', class: 'danger small', dataset: { remove: row.name } }, '移除'));
    }
    const evidence = evidenceLines(forensics, row.name)
      .map((line) => h('div', { class: 'row-meta evidence' }, line));
    return h('li', {},
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, `${row.name} `, ...marks),
        h('div', { class: 'row-meta' }, row.spec || ''),
        ...evidence),
      h('div', { class: 'row-actions' }, ...actions));
  }));
  list.querySelectorAll('[data-disable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('disablePlugin', button.dataset.disable, button));
  });
  list.querySelectorAll('[data-enable]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('enablePlugin', button.dataset.enable, button));
  });
  list.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => actPlugin('removePlugin', button.dataset.remove, button));
  });
}

function renderPlugins(forensics) {
  renderPluginBoard(forensics, {
    listId: 'plugin-list',
    summaryId: 'forensics-summary',
    allowRemove: true,
    sortSuspectsFirst: true,
  });
}

function renderHomeRecovery(status) {
  const board = $('home-recovery');
  const forensics = status?.forensics;
  const recovery = status?.recovery || forensics?.recovery || status?.desktop?.pluginRecovery;
  const recoveryApi = window.launcherRecovery;
  const guidance = recoveryApi.startupRecoveryGuidance(status);
  const guidanceCard = $('home-plugin-guidance');
  guidanceCard.hidden = desktopActionBusy() || !guidance;
  if (guidance) {
    $('home-plugin-guidance-title').textContent = guidance.title;
    $('home-plugin-guidance-body').textContent = guidance.body;
    $('btn-recover-plugins').textContent = guidance.confirmText;
  }
  const show = !desktopActionBusy() && Boolean(desktopActionError || recovery?.skipUserPlugins
    || recoveryApi?.skippedBuiltins?.(status?.lastStart)?.length
    || (!desktopIsRunning(status?.desktop)
      && recoveryApi?.shouldShowRecovery?.(status?.lastStart, recovery, forensics, status?.desktop)));
  board.hidden = !show;
  if (!show) {
    board.open = false;
    return;
  }
  const verdict = (desktopActionError && errText(desktopActionError, '启动或关闭未完成')) || (recoveryApi?.recoveryVerdict
    ? recoveryApi.recoveryVerdict(status?.lastStart, recovery, forensics) : '');
  if ($('home-recovery-verdict').textContent !== verdict) board.open = false;
  $('home-recovery-verdict').textContent = verdict;
  const builtinsOnly = desktopIsRunning(status?.desktop) && !desktopActionError && !recovery?.skipUserPlugins;
  $('home-recovery-list').hidden = builtinsOnly || !forensics?.plugins?.length;
  renderPluginBoard(forensics, {
    listId: 'home-recovery-list',
    sortSuspectsFirst: true,
  });
  const suspects = disableableSuspectNames(forensics);
  const btn = $('btn-disable-suspects');
  btn.hidden = suspects.length === 0;
  btn.dataset.names = suspects.join('\0');
}

async function actPlugin(method, name, button) {
  const api = pageShell();
  if (!api || typeof api[method] !== 'function') {
    return;
  }
  const aligning = method === 'disablePlugin' || method === 'enablePlugin';
  const slimPackage = lastStatus?.launcherPackage === true;
  // A new plugin change supersedes the failure the home page still reports;
  // no desktop-ready event follows a plugin-change restart to clear it.
  if (aligning) desktopActionError = '';
  const restore = launcherButtonBusy(button, aligning ? '正在应用插件变更…' : '正在移除插件…');
  try {
    const result = await api[method](name);
    if (result && result.forensics) {
      renderPlugins(result.forensics);
      void refreshStatus();
    }
    if (result && result.ok === false) {
      setHint(pluginErrorHint(result.error));
      return;
    }
    if (aligning && result && result.harnessRestarted === false && result.error) {
      // The restart after a plugin change failed: report it where every failed
      // start is reported, not in a popup.
      desktopActionError = errText(result.error, '插件已变更，但桌面端未能重新启动。');
      activateTab('home');
      void refreshStatus();
      return;
    }
    if (method === 'removePlugin' && result && result.kernelStopped) {
      setHint('桌面端已停止，请在首页重新启动。', { tone: 'info' });
      void refreshStatus();
      return;
    }
    if (aligning) {
      setHint(slimPackage ? '已写入运行时配置，下次启动桌面端生效。' : '', { tone: 'success' });
      void refreshStatus();
    }
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}

async function refreshPlugins() {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-refresh-plugins');
  if (btn.disabled) return;
  const restore = launcherButtonBusy(btn, '正在刷新插件…');
  try {
    renderPlugins(await api.pluginForensics());
  } catch (error) {
    setHint(errText(error));
  } finally {
    restore();
  }
}
