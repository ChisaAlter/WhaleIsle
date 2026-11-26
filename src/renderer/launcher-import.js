'use strict';

// 导入页：扫描、分组渲染、勾选状态与执行摘要。
// 启动器按功能拆分的经典脚本：与页面其余脚本共享同一全局作用域，跨文件函数与状态在调用时解析。

let importSourceHome;
const extraSkillDirs = [];

function skillSourceLabel(source) {
  if (source === 'home') {
    return '官方 home';
  }
  if (source === 'agents') {
    return '用户技能目录';
  }
  return '额外目录';
}

function pluginSkipLabel(reason) {
  if (reason === 'template') {
    return '官方模板，不重装';
  }
  if (reason === 'dropped') {
    return '已下架';
  }
  if (reason === 'local-spec') {
    return '本地 file / link / workspace，不重装';
  }
  if (reason === 'unsupported') {
    return '规格不受支持，无法自动重装';
  }
  return reason || '跳过';
}

function checkedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`)].map((node) => node.value);
}

function setGroupChecked(name, on) {
  document.querySelectorAll(`input[name="${name}"]:not(:disabled)`).forEach((node) => {
    node.checked = Boolean(on);
  });
}

const IMPORT_CATS = {
  sessions: { name: 'session-rel', hint: '按会话目录分组' },
  skills: { name: 'skill-id', hint: '官方 skills、用户技能根与额外目录' },
  plugins: { name: 'plugin-name', hint: '按名单重装，不拷 node_modules' },
  mcp: { name: 'mcp-id', hint: '按 id 合并，密钥不出现在界面' },
  settings: { name: 'setting-id', hint: '整节搬运白名单设置；API key 随模型配置落盘，不在界面显示' },
  presets: { name: 'preset-id', hint: '官方 .agent-presets 按目录拷贝' },
};

const SETTING_LABELS = {
  'llm-deepseek': 'DeepSeek 模型与提供方',
  'llm-pi-ai': '自定义提供方（pi-ai）',
  'agent-default-model': '默认模型',
  'vision-fallback': '视觉回退模型',
  'ui-theme': '主题与外观',
  'agents-md': '全局指令 AGENTS.md',
};

function settingRowMeta(row) {
  if (row.id === 'agents-md') {
    return 'home 级指令文件，逐字拷贝';
  }
  const refs = Array.isArray(row.credentialRefs) ? row.credentialRefs : [];
  if (refs.length) {
    return `settings.yaml 整节 · 同步 API key 引用 ${refs.join('、')}`;
  }
  return 'settings.yaml 整节';
}

let importCat = 'sessions';
let importHomeDir = '';
let importListRendered = false;
let attachmentsTouched = false;

const IMPORT_COLLAPSE_AT = 8;

function sessionGroupKey(rel) {
  const text = String(rel || '');
  const slash = text.indexOf('/');
  return slash === -1 ? text : text.slice(0, slash);
}

function sessionItemTitle(rel) {
  const text = String(rel || '');
  const key = sessionGroupKey(text);
  return text.startsWith(`${key}/`) ? text.slice(key.length + 1) : text;
}

function shortenHomePath(cwd) {
  const home = String(importHomeDir || '').replace(/[/\\]+$/, '');
  const text = String(cwd || '');
  if (!text) {
    return '';
  }
  if (home && (text === home || text.startsWith(`${home}\\`) || text.startsWith(`${home}/`))) {
    const rest = text.slice(home.length).replace(/\\/g, '/');
    return rest ? `~${rest}` : '~';
  }
  return text.replace(/\\/g, '/');
}

function sessionGroupLabel(key, items) {
  const withCwd = (items || []).find((row) => row && row.cwd);
  if (withCwd && withCwd.cwd) {
    return shortenHomePath(withCwd.cwd);
  }
  if (key === '_no-cwd') {
    return '无工作区';
  }
  if (/^--.+--$/.test(key)) {
    return `工作区（路径编码） ${key.slice(2, -2)}`;
  }
  return key || '未分组';
}

function sessionRowTitle(row) {
  return (row && (row.title || row.id)) || sessionItemTitle(row && row.rel);
}

function formatCreatedAt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return '';
  }
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
}

function sessionRowMeta(row) {
  const notes = [];
  if (row.id) {
    notes.push(row.id);
  }
  const when = formatCreatedAt(row.createdAt);
  if (when) {
    notes.push(when);
  }
  if (row.mixedEncoding) {
    notes.push('编码混用');
  }
  if (row.unsupported) {
    notes.push('不兼容旧库');
  }
  if (row.compressedLog) {
    notes.push('压缩日志未解析');
  }
  return notes.join(' · ');
}

function countChecked(name) {
  return document.querySelectorAll(`input[name="${name}"]:checked:not(:disabled)`).length;
}

function countBoxes(name) {
  return document.querySelectorAll(`input[name="${name}"]`).length;
}

function showImportCat(name) {
  if (!IMPORT_CATS[name]) {
    return;
  }
  importCat = name;
  document.querySelectorAll('[data-import-cat]').forEach((button) => {
    const on = button.dataset.importCat === name;
    button.classList.toggle('is-active', on);
    button.setAttribute('aria-selected', on ? 'true' : 'false');
    button.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('[data-import-pane]').forEach((pane) => {
    const on = pane.dataset.importPane === name;
    pane.classList.toggle('is-active', on);
    pane.hidden = !on;
  });
  $('import-board-hint').textContent = IMPORT_CATS[name].hint;
}

function syncImportSummary() {
  const sessionsChecked = countChecked('session-rel');
  const skillsChecked = countChecked('skill-id');
  const pluginsChecked = countChecked('plugin-name');
  const mcpChecked = countChecked('mcp-id');
  const settingsChecked = countChecked('setting-id');
  const presetsChecked = countChecked('preset-id');
  $('import-sessions-count').textContent = `${sessionsChecked}/${countBoxes('session-rel')}`;
  $('import-skills-count').textContent = `${skillsChecked}/${countBoxes('skill-id')}`;
  $('import-plugins-count').textContent = `${pluginsChecked}/${countBoxes('plugin-name')}`;
  $('import-mcp-count').textContent = `${mcpChecked}/${countBoxes('mcp-id')}`;
  $('import-settings-count').textContent = `${settingsChecked}/${countBoxes('setting-id')}`;
  $('import-presets-count').textContent = `${presetsChecked}/${countBoxes('preset-id')}`;
  // Selection counts live on their own line — they must never overwrite the
  // persistent terminal summary in #import-result.
  const selLine = $('import-selection-line');
  if (selLine) {
    selLine.textContent = `已选 会话 ${sessionsChecked} · 技能 ${skillsChecked} · 插件 ${pluginsChecked} · MCP ${mcpChecked} · 设置 ${settingsChecked} · 预设 ${presetsChecked}`;
  }
  const scope = $('import-scope');
  if (scope) {
    scope.textContent = [
      $('import-overwrite').checked
        ? '覆盖已选项中同名的会话、技能、MCP、预设和设置（含全局指令及关联凭据）；重新安装已勾选插件。'
        : '保留已有同名项及关联凭据；跳过已安装的插件。',
      $('import-attachments').checked
        ? `附件会合并整个 attachments/ 目录，包括未勾选会话的附件；同路径附件${$('import-overwrite').checked ? '覆盖' : '保留'}。`
        : '不导入附件。',
    ].join(' ');
  }
}

function syncSessionClusters() {
  const host = $('import-sessions');
  host.querySelectorAll('[data-import-cluster]').forEach((input) => {
    const key = input.dataset.importCluster;
    const boxes = [...host.querySelectorAll('input[name="session-rel"]')]
      .filter((node) => !node.disabled && sessionGroupKey(node.value) === key);
    const selected = boxes.filter((node) => node.checked).length;
    input.checked = boxes.length > 0 && selected === boxes.length;
    input.indeterminate = selected > 0 && selected < boxes.length;
  });
}

function setSessionGroupExpanded(key, expanded) {
  const host = $('import-sessions');
  const fold = host.querySelector(`[data-import-fold="${CSS.escape(key)}"]`);
  if (fold) {
    fold.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    fold.classList.toggle('is-collapsed', !expanded);
  }
  host.querySelectorAll(`[data-import-group-item="${CSS.escape(key)}"]`).forEach((node) => {
    node.hidden = !expanded;
  });
}

function captureImportSelections() {
  if (!importListRendered) {
    return null;
  }
  return {
    'session-rel': new Set(checkedValues('session-rel')),
    'skill-id': new Set(checkedValues('skill-id')),
    'plugin-name': new Set(checkedValues('plugin-name')),
    'mcp-id': new Set(checkedValues('mcp-id')),
    'setting-id': new Set(checkedValues('setting-id')),
    'preset-id': new Set(checkedValues('preset-id')),
  };
}

function captureSessionFoldState() {
  const folded = new Map();
  $('import-sessions').querySelectorAll('[data-import-fold]').forEach((button) => {
    folded.set(button.dataset.importFold, button.getAttribute('aria-expanded') !== 'false');
  });
  return folded;
}

function shouldCheckImportItem(selections, name, value, defaultChecked) {
  if (!selections || !selections[name]) {
    return defaultChecked;
  }
  return selections[name].has(value);
}

function renderSessionList(rows, options = {}) {
  const selections = options.selections;
  const foldState = options.foldState;
  const host = $('import-sessions');
  if (!rows.length) {
    mount(host, h('li', {}, h('span', { class: 'row-meta' }, '没有可列出的项。')));
    return;
  }
  const groups = new Map();
  for (const row of rows) {
    const key = sessionGroupKey(row.rel);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  const nodes = [];
  const groupEntries = [...groups.entries()].sort((left, right) => {
    const rank = (items) => {
      let score = 0;
      if (items.some((row) => row && row.title)) {
        score += 2;
      }
      if (items.some((row) => row && row.cwd)) {
        score += 1;
      }
      return score;
    };
    const byRank = rank(right[1]) - rank(left[1]);
    if (byRank !== 0) {
      return byRank;
    }
    return sessionGroupLabel(left[0], left[1]).localeCompare(sessionGroupLabel(right[0], right[1]), 'zh');
  });
  for (const [key, items] of groupEntries) {
    const enabled = items.filter((row) => !row.unsupported);
    const expanded = foldState?.has(key)
      ? foldState.get(key)
      : items.length < IMPORT_COLLAPSE_AT;
    const label = sessionGroupLabel(key, items);
    nodes.push(h('li', { class: 'import-cluster' },
      h('div', { class: 'import-cluster-head' },
        h('button', {
          type: 'button',
          class: `import-fold${expanded ? '' : ' is-collapsed'}`,
          dataset: { importFold: key },
          'aria-expanded': expanded ? 'true' : 'false',
          'aria-label': '折叠或展开分组',
        },
          h('svg', { class: 'import-fold-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('path', { fill: 'currentColor', d: 'M6.2 3.2 10.8 8 6.2 12.8 5.2 11.8 8.8 8 5.2 4.2z' }))),
        h('label', { class: 'check-row' },
          h('input', {
            type: 'checkbox',
            dataset: { importCluster: key },
            checked: enabled.length ? true : undefined,
            disabled: enabled.length ? undefined : true,
          }),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, label),
            h('span', { class: 'row-meta' }, `${items.length} 项`))))));
    for (const row of items) {
      const disabled = Boolean(row.unsupported);
      const checked = !disabled && shouldCheckImportItem(selections, 'session-rel', row.rel, true);
      nodes.push(h('li', { class: 'import-item', dataset: { importGroupItem: key }, hidden: expanded ? undefined : true },
        h('label', { class: 'check-row' },
          h('input', {
            type: 'checkbox',
            name: 'session-rel',
            value: row.rel,
            disabled: disabled || undefined,
            checked: checked || undefined,
          }),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, sessionRowTitle(row), disabled ? badge('不兼容', true) : (row.conflict ? badge('已存在') : null)),
            h('span', { class: 'row-meta' }, sessionRowMeta(row))))));
    }
  }
  mount(host, ...nodes);
}

function renderCheckList(targetId, rows, options) {
  const host = $(targetId);
  const selections = options.selections;
  if (!rows.length) {
    mount(host, h('li', {}, h('span', { class: 'row-meta' }, '没有可列出的项。')));
    return;
  }
  mount(host, ...rows.map((row) => {
    const disabled = options.disabled(row);
    const defaultChecked = !disabled;
    const checked = shouldCheckImportItem(selections, options.name, options.value(row), defaultChecked);
    const marks = typeof options.marks === 'function' ? options.marks(row) : null;
    return h('li', {},
      h('label', { class: 'check-row' },
        h('input', {
          type: 'checkbox',
          name: options.name,
          value: options.value(row),
          disabled: disabled || undefined,
          checked: checked || undefined,
        }),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' },
            options.title(row),
            disabled ? badge(options.skipLabel(row), true) : null,
            marks,
            !disabled && row.conflict ? badge('已存在') : null),
          h('span', { class: 'row-meta' }, options.meta(row)))));
  }));
}

function scanOptions() {
  return {
    sourceHome: importSourceHome,
    extraSkillDirs: extraSkillDirs.slice(),
  };
}

function countStatus(rows, status) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row.status === status).length;
}

const IMPORT_PHASE_LABELS = {
  sessions: '会话',
  attachments: '附件',
  skills: '技能',
  plugins: '插件',
  presets: '预设',
};

function importProgressText(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  if (payload.phase === 'done') {
    return '导入完成。';
  }
  if (payload.phase === 'cancelled') {
    return '已取消。';
  }
  if (payload.phase === 'blocked') {
    return '导入被阻止：存在未完成的事务需要恢复。';
  }
  const label = IMPORT_PHASE_LABELS[payload.phase];
  if (!label) {
    return '';
  }
  const item = payload.rel || payload.id || payload.name || '';
  return `正在导入${label} ${payload.done}/${payload.total}${item ? `：${item}` : ''}`;
}

function summarizeImport(result) {
  if (!result) {
    return '没有返回结果。';
  }
  if (result.cancelled) {
    return '导入已取消。已拷贝的内容保留，下次可按原规则续导（已存在的会跳过）。';
  }
  if (result.empty) {
    return '未选择任何项，没有写入桌面 home。';
  }
  // Surface the service's top-level refusal reason first — a resolved
  // ok:false with a capability/recovery/ambiguity error must explain itself
  // rather than collapse into a generic "incomplete" line.
  const refusalText = {
    'slim-import-unsupported': '当前为精简启动器：无法安全地停止并隔离正在运行的桌面端，导入已拒绝。请打开完整桌面端启动器执行导入。',
    'import-recovery-blocked': '检测到未完成的导入事务，已阻止本次导入以免破坏数据。请先重启桌面端让恢复流程完成，或检查导入目录中的残留事务。',
    'ambiguous-destination': '所选技能存在同名目标目录且来自不同来源，必须每个目标只保留一个来源。请取消其中冲突项后重试。',
    'transaction-needs-recovery': '导入过程中发生需要人工恢复的替换失败，已停止后续写入。请重启桌面端完成恢复后再导入。',
    'shutdown-committed': '应用正在退出，导入已取消。',
    'import-in-progress': '已有导入任务进行中。',
  }[result.error];
  const lines = [
    refusalText,
    `会话 已拷 ${countStatus(result.sessions, 'copied')} · 跳过 ${countStatus(result.sessions, 'skipped')} · 拒绝 ${countStatus(result.sessions, 'rejected')}`,
    `技能 已拷 ${countStatus(result.skills, 'copied')} · 跳过 ${countStatus(result.skills, 'skipped')} · 拒绝 ${countStatus(result.skills, 'rejected')}`,
    `插件 已装 ${countStatus(result.plugins, 'installed')} · 跳过 ${countStatus(result.plugins, 'skipped')} · 失败 ${countStatus(result.plugins, 'failed')}`,
    `MCP 已写入 ${countStatus(result.mcp, 'copied')} · 跳过 ${countStatus(result.mcp, 'skipped')} · 拒绝 ${countStatus(result.mcp, 'rejected')}`,
    `设置 已写入 ${countStatus(result.settings, 'copied')} · 跳过 ${countStatus(result.settings, 'skipped')} · 凭据引用 已同步 ${countStatus(result.credentials, 'copied')} · 跳过 ${countStatus(result.credentials, 'skipped')}`,
    `预设 已拷 ${countStatus(result.presets, 'copied')} · 跳过 ${countStatus(result.presets, 'skipped')} · 拒绝 ${countStatus(result.presets, 'rejected')}`,
    `附件 ${result.attachments || 'absent'}`,
  ].filter(Boolean);
  const totalFailed = ['sessions', 'skills', 'plugins', 'mcp', 'settings', 'credentials', 'presets']
    .reduce((n, key) => n + countStatus(result[key], 'failed'), 0)
    + (typeof result.attachments === 'string' && result.attachments.startsWith('failed:') ? 1 : 0);
  if (totalFailed > 0) {
    lines.push(`共 ${totalFailed} 项失败。`);
    // Item-level failures: name + reason, capped so a long run stays readable.
    const failedItems = [];
    for (const key of ['sessions', 'skills', 'plugins', 'mcp', 'settings', 'credentials', 'presets']) {
      for (const row of Array.isArray(result[key]) ? result[key] : []) {
        if (row && row.status === 'failed' && failedItems.length < 8) {
          failedItems.push(`${row.rel || row.id || row.name || row.ref || '项'}：${row.error || '失败'}`);
        }
      }
    }
    if (failedItems.length) {
      lines.push(failedItems.join('\n'));
    }
  }
  if (result.ok === false) {
    lines.push('导入未完全成功。官方来源未改写。');
  }
  if (result.kernelStopped) {
    lines.push('桌面端已停止，请在首页重新启动。');
  }
  return lines.join('\n');
}

/** @param {any} scan @param {any[]} sessions */
function syncDefaultAttachments(scan, sessions) {
  if (!attachmentsTouched) {
    $('import-attachments').checked = Boolean(scan?.hasAttachments) && sessions.some((row) => !row.unsupported);
  }
}

async function refreshImport(options = {}) {
  const api = pageShell();
  if (!api) {
    return;
  }
  const btn = $('btn-scan');
  let showFeedback = options.silent !== true;
  const savedSelections = captureImportSelections();
  const foldState = captureSessionFoldState();
  if (btn.disabled) return;
  const restore = launcherButtonBusy(btn, '正在扫描…');
  try {
    const scan = await api.scanImport(scanOptions());
    importHomeDir = typeof scan?.homeDir === 'string' ? scan.homeDir : '';
    const sourceLine = scan?.sourceHome
      ? `${scan.sourceHome}${scan.sourceHasData ? '（有可导入数据）' : '（没有可导入数据）'}${scan.destEmpty ? '；桌面会话为空' : ''}`
      : '还没有扫描结果。';
    $('import-source').textContent = sourceLine;
    $('import-source').title = scan?.sourceHome || '';
    $('import-skill-roots').hidden = extraSkillDirs.length === 0;
    $('import-skill-roots').textContent = extraSkillDirs.length
      ? `额外技能目录 ${extraSkillDirs.join('；')}`
      : '';

    const sessions = Array.isArray(scan?.sessions) ? scan.sessions : [];
    const skills = Array.isArray(scan?.skills) ? scan.skills : [];
    const plugins = Array.isArray(scan?.plugins) ? scan.plugins : [];
    const mcp = Array.isArray(scan?.mcp) ? scan.mcp : [];
    const settings = Array.isArray(scan?.settings) ? scan.settings : [];
    const presets = Array.isArray(scan?.presets) ? scan.presets : [];
    const renderOptions = { selections: savedSelections, foldState };

    renderSessionList(sessions, renderOptions);
    renderCheckList('import-skills', skills, {
      name: 'skill-id',
      value: (row) => row.id,
      title: (row) => row.displayName || row.name,
      meta: (row) => {
        const base = skillSourceLabel(row.source);
        if (Array.isArray(row.sourceCollision) && row.sourceCollision.length > 1) {
          const peers = row.sourceCollision.filter((id) => id !== row.id).join('、');
          return `${base} · 同名冲突：与 ${peers} 写入同一目录，二者选其一`;
        }
        return base;
      },
      disabled: () => false,
      skipLabel: () => '',
      marks: (row) => (Array.isArray(row.sourceCollision) && row.sourceCollision.length > 1
        ? badge('同名冲突', true)
        : null),
      selections: savedSelections,
    });
    const slimPackage = lastStatus?.launcherPackage === true;
    renderCheckList('import-plugins', plugins, {
      name: 'plugin-name',
      value: (row) => row.name,
      title: (row) => row.name,
      meta: (row) => (row.skipped ? pluginSkipLabel(row.reason)
        : (slimPackage ? '轻量启动器不含插件工具链' : (row.spec || ''))),
      disabled: (row) => Boolean(row.skipped) || slimPackage,
      skipLabel: (row) => (slimPackage && !row.skipped ? '需在桌面端内重装' : pluginSkipLabel(row.reason)),
      marks: (row) => (!row.skipped && row.alreadyInstalled ? badge('已安装') : null),
      selections: savedSelections,
    });
    renderCheckList('import-mcp', mcp, {
      name: 'mcp-id',
      value: (row) => row.id,
      title: (row) => row.name || row.id,
      meta: (row) => [
        row.enabled === false ? '已停用' : '已启用',
        row.id,
        row.endpoint,
      ].filter(Boolean).join(' · '),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-settings', settings, {
      name: 'setting-id',
      value: (row) => row.id,
      title: (row) => SETTING_LABELS[row.id] || row.id,
      meta: (row) => settingRowMeta(row),
      disabled: () => false,
      skipLabel: () => '',
      selections: savedSelections,
    });
    renderCheckList('import-presets', presets, {
      name: 'preset-id',
      value: (row) => row.id,
      title: (row) => row.id,
      meta: (row) => (row.broken ? 'agent.cordis.yml 缺失或无效' : 'agent.cordis.yml'),
      disabled: (row) => Boolean(row.broken),
      skipLabel: () => '组合损坏',
      selections: savedSelections,
    });

    syncDefaultAttachments(scan, sessions);
    importListRendered = true;
    syncSessionClusters();
    syncImportSummary();
  } catch (error) {
    showFeedback = false;
    setHint(errText(error));
  } finally {
    restore();
  }
  // The lists below show what was found; the button only confirms the scan.
  if (showFeedback) window.shellFeedback.buttonDone(btn, '扫描完成');
}
