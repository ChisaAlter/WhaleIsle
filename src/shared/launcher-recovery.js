'use strict';

const GENERIC_LABELS = {
  'session-cache': '历史会话缓存格式不兼容，导致内核启动失败。跳过用户插件无法修复；请更新到包含缓存兼容修复的桌面版本，并保留日志。不要删除原始会话或清空历史数据。',
  oom: '检测到内存不足（OOM），与单个插件无关。',
  'port-excluded': '端口被系统保留或无权监听（listen EACCES），与插件无关，跳过用户插件无法修复。请重试启动——预检会自动改用可绑定的相邻端口；若仍失败，可在管理员终端运行 netsh int ipv4 show excludedportrange protocol=tcp 查看保留段，并更换启动端口。',
  'port-in-use': '检测到端口被占用，与单个插件无关。',
  'missing-node': '未找到 Node 运行时，与单个插件无关。',
};

const PLUGIN_ERROR_LABELS = {
  preset: '桌面预置插件不可移除。',
  'official-template': '官方模板插件不可禁用。',
  'desktop-builtin': '桌面内置组件不可禁用。',
  'missing-name': '缺少插件名称。',
};

/**
 * @param {string} code
 * @returns {string}
 */
function pluginErrorLabel(code) {
  return PLUGIN_ERROR_LABELS[code] || code || '操作失败';
}

/**
 * @param {{ ok?: boolean|null, error?: string }|null|undefined} lastStart
 * @param {{ skipUserPlugins?: boolean }|null|undefined} recovery
 * @param {{ genericCause?: string|null, suspects?: Array<{name:string}>, pluginTreeFailure?: boolean }|null|undefined} forensics
 * @param {{ state?: string }|null|undefined} desktop
 * @returns {boolean}
 */
function shouldShowRecovery(lastStart, recovery, forensics, desktop) {
  if (recovery?.skipUserPlugins) {
    return true;
  }
  if (lastStart?.ok === false) {
    return true;
  }
  if (desktop?.state === 'error') {
    return true;
  }
  if (!forensics) {
    return false;
  }
  if (forensics.genericCause) {
    return true;
  }
  if (forensics.pluginTreeFailure) {
    return true;
  }
  return Array.isArray(forensics.suspects) && forensics.suspects.length > 0;
}

/**
 * @param {{ desktopRuntimeDamage?: boolean, orphanSuspects?: Array<{name:string, inBox?:boolean}> }|null|undefined} forensics
 * @returns {string}
 */
function desktopRuntimeDamageVerdict(forensics) {
  const names = (forensics?.orphanSuspects || [])
    .filter((row) => row.inBox)
    .map((row) => row.name)
    .join('、');
  return `检测到桌面内置组件损坏${names ? `：${names}` : ''}。禁用插件或跳过用户插件都无法修复；请重新安装桌面端安装包（源码运行则执行 npm run setup:harness）。`;
}

/** Only installed user plugins named by the failure can be disabled for recovery. */
function disableableSuspectNames(forensics) {
  if (forensics?.genericCause || forensics?.desktopRuntimeDamage) return [];
  return [...new Set((forensics?.plugins || [])
    .filter((row) => row.suspect && !row.disabled && !row.orphan && !row.inBox
      && !row.preset && !row.officialTemplate)
    .map((row) => row.name))];
}

/** A suggested action is not consent; the launcher asks before changing plugins. */
function startupRecoveryGuidance(status) {
  const forensics = status?.forensics;
  if (!forensics || forensics.genericCause || forensics.desktopRuntimeDamage) return null;
  const recovery = status.recovery || status.desktop?.pluginRecovery || forensics.recovery;
  if (!recovery?.skipUserPlugins && status.lastStart?.ok !== false && status.desktop?.state !== 'error') return null;
  if (!recovery?.skipUserPlugins && ['ready', 'running-external'].includes(status.desktop?.state)) return null;
  const names = disableableSuspectNames(forensics);
  if (names.length) {
    return {
      kind: 'disable',
      names,
      title: '插件加载失败',
      body: `启动日志显示以下用户插件未能加载：${names.join('、')}。可能存在冲突或版本不兼容。\n\n建议禁用这些插件后启动鲸屿，其余插件保持启用。此操作不会卸载插件或删除会话、角色卡等数据；之后可在「插件排查」中重新启用。`,
      confirmText: '禁用并启动鲸屿',
    };
  }
  if (!recovery?.skipUserPlugins && forensics.pluginTreeFailure) {
    return {
      kind: 'skip',
      names: [],
      title: '用户插件加载失败',
      body: '启动日志尚不能确定具体的冲突插件。可先跳过全部用户插件启动鲸屿，再在「插件排查」中逐项排查。\n\n不会卸载插件或删除用户数据；跳过期间，用户插件功能暂不可用。',
      confirmText: '跳过用户插件并启动',
    };
  }
  return null;
}

/**
 * @param {{ ok?: boolean|null, error?: string }|null|undefined} lastStart
 * @param {{ skipUserPlugins?: boolean, reason?: string }|null|undefined} recovery
 * @param {{ genericCause?: string|null, desktopRuntimeDamage?: boolean, suspects?: Array<{name:string}>, orphanSuspects?: Array<{name:string, inBox?:boolean}>, pluginTreeFailure?: boolean }|null|undefined} forensics
 * @returns {string}
 */
function recoveryVerdict(lastStart, recovery, forensics) {
  if (forensics?.genericCause === 'session-cache') {
    return GENERIC_LABELS['session-cache'];
  }
  // In-box damage outranks the sticky-skip banner: neither「恢复完整插件」nor
  // per-plugin disable can repair a broken harness runtime, so saying so first
  // is the only honest verdict. port-excluded joins that family: no plugin
  // choice can un-reserve a Windows port block.
  if (forensics?.desktopRuntimeDamage) {
    return desktopRuntimeDamageVerdict(forensics);
  }
  if (forensics?.genericCause === 'port-excluded') {
    return GENERIC_LABELS['port-excluded'];
  }
  if (recovery?.skipUserPlugins) {
    const names = disableableSuspectNames(forensics);
    return names.length
      ? `鲸屿已跳过用户插件启动。失败插件：${names.join('、')}。建议点击「禁用并启动鲸屿」，恢复其余用户插件。`
      : '当前在跳过用户插件模式下运行；完整加载请点「恢复完整插件并启动」。禁用单项不会自动加载全部用户插件。';
  }
  if (forensics?.genericCause) {
    return GENERIC_LABELS[forensics.genericCause] || String(forensics.genericCause);
  }
  if (forensics?.pluginTreeFailure || (forensics?.suspects && forensics.suspects.length)) {
    const names = (forensics.suspects || []).map((row) => row.name).join('、');
    return names
      ? `启动日志指向可疑插件：${names}。可逐项禁用后重新启动。`
      : '插件树加载失败。可逐项禁用下列插件后重新启动。';
  }
  if (lastStart?.ok === false) {
    return `上次启动失败：${lastStart.error || '原因未知'}`;
  }
  return '桌面端未就绪。可检查下列插件后重新启动。';
}

/**
 * @param {Array<{ name: string, suspect?: boolean, preset?: boolean, officialTemplate?: boolean, disabled?: boolean, orphan?: boolean, inBox?: boolean }>} rows
 * @returns {typeof rows}
 */
function sortPluginRows(rows) {
  const list = Array.isArray(rows) ? [...rows] : [];
  const rank = (row) => {
    if (row.inBox) return 0;
    if (row.orphan) return 1;
    if (row.suspect) return 2;
    if (row.officialTemplate) return 5;
    if (row.preset) return 4;
    return 3;
  };
  list.sort((a, b) => {
    const delta = rank(a) - rank(b);
    if (delta !== 0) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
  return list;
}

const launcherRecovery = {
  GENERIC_LABELS,
  PLUGIN_ERROR_LABELS,
  pluginErrorLabel,
  shouldShowRecovery,
  desktopRuntimeDamageVerdict,
  disableableSuspectNames,
  startupRecoveryGuidance,
  recoveryVerdict,
  sortPluginRows,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = launcherRecovery;
}
if (typeof window !== 'undefined') {
  window.launcherRecovery = launcherRecovery;
}
