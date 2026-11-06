/* dsh-acp-agents client: T3 Code-parity Provider & Account Settings + Composer Agent-first ModelSelect. */
window.__ModuleLoader__.load({
  id: 'dsh-acp-agents',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const react = require('react');
    const reactDom = require('react-dom');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');

    const {
      createElement: h,
      Fragment,
      useState,
      useEffect,
      useLayoutEffect,
      useMemo,
      useCallback,
      useRef,
      useId,
      useSyncExternalStore,
    } = react;
    const { createPortal } = reactDom;

    const {
      Button,
      FlipText,
      Input,
      MenuGroup,
      MenuSurface,
      Modal,
      SettingsSelect,
      StateDot,
      Switch,
      Toast,
      observeStickyMenuGroups,
      rankByName,
      usePresence,
      IconCheckOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronRightOutlineRegular,
      IconCloseFillRegular,
      IconDataOutlineRegular,
      IconPlusOutline16,
      IconRefreshOutline16,
      IconSettingsOutline16,
      IconTrashOutline16,
      IconWarningOutlineRegular,
    } = primitives;

    const NS = 'dsh-acp-agents';
    const SETTINGS_SECTION_ID = 'acp-agents';
    const ACP_PREFIX = 'acp:';

    const zh = {
      nav: 'Agent',
      'page.title': 'Agent 与账号管理',
      'page.subtitle': '管理本地 CLI 智能体（Claude Code、Codex、Antigravity、Devin）的账号登录、OAuth 授权、多账号实例、API 密钥与可用模型。',
      'page.addInstance': '添加账号 / Agent',
      'page.refresh': '刷新状态',
      'status.authenticated': '已登录',
      'status.unauthenticated': '未登录',
      'status.missing': '未安装 CLI',
      'status.ready': '已就绪',
      'status.activeSessions': '{count} 个活跃会话',
      'action.test': '测试连接并同步模型',
      'action.testing': '连接中…',
      'action.login': '登录账号',
      'action.relogin': '切换 / 重新登录',
      'action.logout': '退出登录',
      'action.cancelLogin': '取消登录',
      'action.openBrowser': '打开浏览器登录',
      'action.copyUrl': '复制登录链接',
      'action.copied': '已复制链接',
      'action.saveCredentials': '保存密钥并生效',
      'action.saveRuntime': '保存配置',
      'action.addAccount': '新建同类型账号',
      'action.reset': '恢复默认',
      'action.delete': '删除实例',
      'section.account': '账号与登录认证',
      'section.accountDesc': '查看当前 CLI 登录账号与订阅状态，支持浏览器 OAuth 登录、设备码授权或 API Key 接入。',
      'section.models': '模型管理',
      'section.modelsDesc': '搜索、收藏、启用或隐藏该 Agent 在底部模型选择器中展示的模型。',
      'section.runtime': '运行时与权限设置',
      'section.runtimeDesc': '自定义 CLI 可执行文件路径、启动参数、独立账号配置目录与工具审批策略。',
      'section.env': '环境变量与网关配置',
      'section.envDesc': '为该 Agent 进程注入自定义环境变量（如 ANTHROPIC_BASE_URL、HTTPS_PROXY 等）。',
      'account.email': '登录账号',
      'account.plan': '订阅 / 认证类型',
      'account.method': '认证方式',
      'account.profileDir': '独立配置目录',
      'account.reveal': '点击显示/隐藏完整邮箱',
      'account.notLoggedIn': '当前未登录账号',
      'models.searchPh': '搜索模型名称或 ID…',
      'models.addPh': '输入新模型 ID（可选：model-id | 显示名称）',
      'models.addBtn': '添加模型',
      'models.syncBtn': '从 CLI 同步模型',
      'models.count': '已启用 {enabled} / 共 {total} 个模型',
      'models.showAll': '全部启用',
      'models.favorite': '设为常用置顶',
      'models.discovered': 'CLI 发现',
      'field.name': '显示名称',
      'field.badge': '厂商标签',
      'field.command': '可执行命令 / 路径',
      'field.args': '启动参数（空格分隔）',
      'field.profileDir': '独立配置目录（多账号隔离）',
      'field.permission': '工具权限策略',
      'field.permission.ask': '每次操作前询问确认（默认）',
      'field.permission.read': '只读操作自动允许，写入与命令询问确认',
      'field.permission.all': '自动批准全部工具操作',
      'env.addRow': '添加环境变量',
      'env.keyPh': '变量名 (如 HTTPS_PROXY)',
      'env.valPh': '变量值',
      'env.empty': '暂未配置额外环境变量。',
      'modal.addTitle': '添加新账号实例或自定义 Agent',
      'modal.addType': '选择类型',
      'modal.addName': '实例显示名称',
      'modal.addNamePh': '例如：Claude Code (工作号) / Codex #2',
      'modal.close': '关闭',
      'modal.cancel': '取消',
      'modal.create': '创建实例',
      'test.ok': '{name} 连接成功（{binary}）',
      'test.failed': '{name} 连接失败：{error}',
      'saved': '配置已保存并生效',
      'saveFailed': '操作失败：{message}',
      'loadFailed': '读取配置失败：{message}',
      'login.started': '已发起登录流程，请在浏览器中完成授权。',
      'logout.done': '已退出登录：{name}',
      'provider.account': 'DeepSeek 账号',
      'menu.agent': 'Agent',
      'menu.model': '模型',
      'menu.effort': '推理等级',
      'menu.aria': 'Agent、模型与推理等级',
      'menu.manageAgents': '管理 Agent 与账号设置…',
      'agent.defaultName': 'DeepSeek Harness',
      'agent.defaultBadge': '内置 / API',
      'agent.externalBadge': 'ACP',
      'trigger.loading': '正在加载模型…',
      'trigger.fallback': '请选择模型',
      'trigger.selectAria': '请选择模型',
      'trigger.aria': '选择模型，当前 {model}',
      'trigger.ariaEffort': '选择模型，当前 {model}，推理等级 {effort}',
      'trigger.ariaAgent': '选择智能体与模型，当前 {agent} · {model}',
      'trigger.ariaAgentEffort': '选择智能体与模型，当前 {agent} · {model}，推理等级 {effort}',
      'effort.providerDefault': '默认',
      'search.placeholder': '搜索模型…',
      'search.clear': '清除搜索',
      'search.empty': '没有匹配的模型。',
      'empty.models': '当前 Agent 暂无可用模型，请前往设置检查配置。',
      'empty.efforts': '当前模型未提供推理等级。',
      'warning.groupLoad': '{name} 加载失败：{message}',
      'error.sessionInUse': '当前会话正在运行或被占用，请稍后切换模型。',
      'error.action': '模型切换失败：{message}',
      'action.reload': '重新加载',
    };

    const en = {
      nav: 'Agent',
      'page.title': 'Agents & Accounts',
      'page.subtitle': 'Manage local CLI coding agents (Claude Code, Codex, Antigravity, Devin), OAuth sign-in, multi-account instances, API keys, and models.',
      'page.addInstance': 'Add Account / Agent',
      'page.refresh': 'Refresh',
      'status.authenticated': 'Signed in',
      'status.unauthenticated': 'Not signed in',
      'status.missing': 'CLI not found',
      'status.ready': 'Ready',
      'status.activeSessions': '{count} active session(s)',
      'action.test': 'Test & Sync Models',
      'action.testing': 'Testing…',
      'action.login': 'Sign in',
      'action.relogin': 'Switch / Re-authenticate',
      'action.logout': 'Sign out',
      'action.cancelLogin': 'Cancel sign-in',
      'action.openBrowser': 'Open in Browser',
      'action.copyUrl': 'Copy Sign-in Link',
      'action.copied': 'Link Copied',
      'action.saveCredentials': 'Save Credentials',
      'action.saveRuntime': 'Save Settings',
      'action.addAccount': 'Add Another Account',
      'action.reset': 'Reset Default',
      'action.delete': 'Delete Instance',
      'section.account': 'Account & Authentication',
      'section.accountDesc': 'View signed-in account and subscription tier, or authenticate via browser OAuth, device code, or API key.',
      'section.models': 'Models',
      'section.modelsDesc': 'Search, favorite, enable, or hide models exposed by this Agent in the composer picker.',
      'section.runtime': 'Runtime & Permissions',
      'section.runtimeDesc': 'Configure CLI binary path, arguments, isolated profile directory, and tool approval policy.',
      'section.env': 'Environment Variables',
      'section.envDesc': 'Inject custom environment variables (e.g. ANTHROPIC_BASE_URL, HTTPS_PROXY) into the Agent process.',
      'account.email': 'Account',
      'account.plan': 'Plan / Auth Type',
      'account.method': 'Auth Method',
      'account.profileDir': 'Isolated Profile Dir',
      'account.reveal': 'Click to reveal/hide full email',
      'account.notLoggedIn': 'Not signed in',
      'models.searchPh': 'Search model name or ID…',
      'models.addPh': 'Add custom model ID (or model-id | Display Name)',
      'models.addBtn': 'Add Model',
      'models.syncBtn': 'Sync from CLI',
      'models.count': '{enabled} enabled / {total} total models',
      'models.showAll': 'Enable All',
      'models.favorite': 'Pin as favorite',
      'models.discovered': 'Discovered',
      'field.name': 'Display Name',
      'field.badge': 'Vendor Badge',
      'field.command': 'Executable Command / Path',
      'field.args': 'Launch Arguments (space-separated)',
      'field.profileDir': 'Isolated Profile Directory',
      'field.permission': 'Tool Permission Policy',
      'field.permission.ask': 'Always ask before running tools (Default)',
      'field.permission.read': 'Auto-allow read-only tools, ask on edits and commands',
      'field.permission.all': 'Auto-approve all tool operations',
      'env.addRow': 'Add Variable',
      'env.keyPh': 'KEY (e.g. HTTPS_PROXY)',
      'env.valPh': 'VALUE',
      'env.empty': 'No custom environment variables configured.',
      'modal.addTitle': 'Add Account Instance or Custom Agent',
      'modal.addType': 'Provider Type',
      'modal.addName': 'Instance Display Name',
      'modal.addNamePh': 'e.g. Claude Code (Work) / Codex #2',
      'modal.close': 'Close',
      'modal.cancel': 'Cancel',
      'modal.create': 'Create Instance',
      'test.ok': '{name} connected ({binary})',
      'test.failed': '{name} connection failed: {error}',
      'saved': 'Configuration saved',
      'saveFailed': 'Operation failed: {message}',
      'loadFailed': 'Failed to load configuration: {message}',
      'login.started': 'Sign-in started. Complete authentication in your browser.',
      'logout.done': 'Signed out of {name}',
      'provider.account': 'DeepSeek Account',
      'menu.agent': 'Agent',
      'menu.model': 'Model',
      'menu.effort': 'Effort',
      'menu.aria': 'Agent, model, and reasoning effort',
      'menu.manageAgents': 'Manage Agents & Accounts…',
      'agent.defaultName': 'DeepSeek Harness',
      'agent.defaultBadge': 'Built-in / API',
      'agent.externalBadge': 'ACP',
      'trigger.loading': 'Loading models…',
      'trigger.fallback': 'Select model',
      'trigger.selectAria': 'Select model',
      'trigger.aria': 'Select model, current {model}',
      'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
      'trigger.ariaAgent': 'Select agent and model, current {agent} · {model}',
      'trigger.ariaAgentEffort': 'Select agent and model, current {agent} · {model}, reasoning effort {effort}',
      'effort.providerDefault': 'Default',
      'search.placeholder': 'Search models…',
      'search.clear': 'Clear search',
      'search.empty': 'No matching models.',
      'empty.models': 'No models available for this Agent. Check Settings -> Agent.',
      'empty.efforts': 'This model provides no reasoning effort levels.',
      'warning.groupLoad': '{name} failed to load: {message}',
      'error.sessionInUse': 'This session is currently busy. Try switching models once the turn finishes.',
      'error.action': 'Model operation failed: {message}',
      'action.reload': 'Reload',
    };

    const CSS_TEXT = `
/* T3 Code Master-Detail Provider & Account Settings */
.dsh-acp-settings {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 980px;
  padding: 6px 0 32px;
  color: var(--dsw-alias-label-primary);
  gap: 14px;
}
.dsh-acp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-subtitle {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.dsh-acp-banner {
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 18px;
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.04));
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-banner[data-error="true"] {
  color: var(--dsw-alias-state-error-primary, #ef4444);
  border-color: rgba(239, 68, 68, 0.35);
}

/* Top 2-Column Agent Switcher Grid + Full-Width Selected Agent Detail Stack (fits 564px Settings .options) */
.dsh-acp-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}

.dsh-acp-rail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  width: 100%;
}
@media (max-width: 520px) {
  .dsh-acp-rail {
    grid-template-columns: 1fr;
  }
}
.dsh-acp-rail-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08));
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  text-align: left;
  min-width: 0;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
.dsh-acp-rail-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-rail-item[data-selected="true"] {
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.07));
  border-color: var(--dsw-alias-label-primary, rgba(255,255,255,0.45));
  box-shadow: 0 0 0 0.5px var(--dsw-alias-label-primary, rgba(255,255,255,0.25));
}
.dsh-acp-rail-item-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-rail-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.dsh-acp-rail-name {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-rail-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Full-Width Detail Stack */
.dsh-acp-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  min-width: 0;
}
.dsh-acp-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,0.02));
  min-width: 0;
  box-sizing: border-box;
}
.dsh-acp-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.dsh-acp-card-header-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
  flex: 1;
}
.dsh-acp-card-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.dsh-acp-card-title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
}
.dsh-acp-card-desc {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}
.dsh-acp-card-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-cmd-bar {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.22);
  border: 0.5px solid var(--dsw-alias-border-l2);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-acp-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.06));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-badge[data-tone="success"] {
  color: #10b981;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.28);
}
.dsh-acp-badge[data-tone="warning"] {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.28);
}
.dsh-acp-badge[data-tone="plan"] {
  color: #60a5fa;
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
}

/* Account Info Grid */
.dsh-acp-account-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3, rgba(255,255,255,0.03));
  border: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.dsh-acp-account-user {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-account-email {
  font-size: 13px;
  line-height: 18px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  border: 0.5px dashed var(--dsw-alias-border-l2);
}
.dsh-acp-account-email:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-account-msg {
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
}

/* Auth method tabs */
.dsh-acp-auth-methods {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}
.dsh-acp-auth-method-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease;
}
.dsh-acp-auth-method-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-auth-method-card[data-active="true"] {
  border-color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active, rgba(255,255,255,0.06));
}
.dsh-acp-auth-method-title {
  font-size: 12px;
  line-height: 17px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-auth-method-desc {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}

/* Live OAuth Flow Box */
.dsh-acp-flow-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.06);
}
.dsh-acp-flow-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-acp-flow-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-code {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-flow-url-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-flow-url {
  flex: 1;
  min-width: 180px;
  padding: 5px 8px;
  border-radius: 6px;
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  background: rgba(0, 0, 0, 0.2);
  border: 0.5px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-flow-logs {
  max-height: 90px;
  overflow-y: auto;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.25);
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  white-space: pre-wrap;
}

/* Models Manager */
.dsh-acp-models-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dsh-acp-models-toolbar-input {
  flex: 1;
  min-width: 180px;
}
.dsh-acp-models-list {
  display: flex;
  flex-direction: column;
  max-height: 290px;
  overflow-y: auto;
  border-radius: 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  divide-y: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.dsh-acp-model-row:last-child {
  border-bottom: none;
}
.dsh-acp-model-row[data-hidden="true"] {
  opacity: 0.52;
}
.dsh-acp-model-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.dsh-acp-star-btn {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-star-btn[data-fav="true"] {
  color: #f59e0b;
}
.dsh-acp-model-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-id {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-model-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* Form fields & Env table */
.dsh-acp-grid-2 {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.dsh-acp-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dsh-acp-field-label {
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-env-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-acp-env-row {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) minmax(160px, 1.5fr) auto;
  gap: 8px;
  align-items: center;
}
.dsh-acp-meta-line {
  font-family: var(--dsw-font-family-mono, monospace);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}
.dsh-acp-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* Composer Agent-First ModelSelect */
.dsh-acp-ms-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}
.dsh-acp-ms-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  max-width: 340px;
  padding: 0 10px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
}
.dsh-acp-ms-trigger:hover:not(:disabled),
.dsh-acp-ms-trigger[aria-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-ms-trigger:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dsh-acp-ms-trigger-icon {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-ms-trigger-agent {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-3, rgba(255, 255, 255, 0.08));
}
.dsh-acp-ms-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-trigger-effort {
  flex-shrink: 0;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
.dsh-acp-ms-chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 160ms ease;
}
.dsh-acp-ms-chevron-open {
  transform: rotate(180deg);
}
.dsh-acp-ms-initial-label {
  display: inline-grid;
}
.dsh-acp-ms-initial-reserve {
  grid-area: 1 / 1;
  visibility: hidden;
  pointer-events: none;
  height: 0;
  overflow: hidden;
}
.dsh-acp-ms-initial-caption {
  grid-area: 1 / 1;
}
.dsh-acp-ms-menu {
  position: fixed;
  z-index: 1200;
  width: 284px;
  max-width: calc(100vw - 24px);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-acp-ms-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dsh-acp-ms-cell:hover,
.dsh-acp-ms-cell:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-cell-label {
  flex-shrink: 0;
  color: var(--dsw-alias-label-secondary);
}
.dsh-acp-ms-cell-value {
  flex: 1;
  min-width: 0;
  text-align: right;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-cell-chevron {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-ms-groups {
  display: flex;
  flex-direction: column;
  max-height: 310px;
  overflow-y: auto;
  gap: 2px;
}
.dsh-acp-ms-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.dsh-acp-ms-option:hover,
.dsh-acp-ms-option:focus-visible,
.dsh-acp-ms-option[data-active="true"] {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-option:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dsh-acp-ms-option-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.dsh-acp-ms-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dsh-acp-ms-option-sub {
  font-size: 11px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-acp-ms-check {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-primary);
}
.dsh-acp-ms-divider {
  height: 0.5px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l2);
}
.dsh-acp-ms-search-row {
  position: relative;
  display: flex;
  align-items: center;
  padding: 2px 2px 6px;
}
.dsh-acp-ms-search {
  width: 100%;
}
.dsh-acp-ms-search-with-query {
  padding-right: 26px;
}
.dsh-acp-ms-search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-60%);
  border: none;
  background: transparent;
  padding: 2px;
  border-radius: 4px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  display: inline-flex;
}
.dsh-acp-ms-search-clear:hover,
.dsh-acp-ms-search-clear:focus-visible {
  outline: none;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dsh-acp-ms-empty {
  padding: 8px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}
`;

    function injectCss() {
      if (typeof document === 'undefined') return;
      let style = document.getElementById('dsh-acp-agents-styles');
      if (!style) {
        style = document.createElement('style');
        style.id = 'dsh-acp-agents-styles';
        document.head.appendChild(style);
      }
      style.textContent = CSS_TEXT;
    }

    function rpcValue(response) {
      if (response && typeof response === 'object' && 'ok' in response) {
        if (response.ok) return response.value;
        const msg = response.error?.message || response.error?.code || 'RPC error';
        throw new Error(msg);
      }
      return response;
    }

    function maskEmail(email) {
      const clean = String(email || '').trim();
      const at = clean.indexOf('@');
      if (at <= 1) return clean;
      const local = clean.slice(0, at);
      const domain = clean.slice(at);
      const visible = local.slice(0, Math.min(2, local.length));
      return `${visible}***${domain}`;
    }

    function unwrapSwitchChecked(val, fallback) {
      if (typeof val === 'boolean') return val;
      if (typeof val?.target?.checked === 'boolean') return val.target.checked;
      return fallback;
    }

    /**
     * T3 Code-parity Provider & Account Settings Panel (`Settings -> Agent`).
     */
    function AgentsSettingsSection(props) {
      const { rpc, t } = props;
      const [catalog, setCatalog] = useState(null);
      const [selectedId, setSelectedId] = useState('claude-code');
      const [loading, setLoading] = useState(true);
      const [busyAction, setBusyAction] = useState('');
      const [banner, setBanner] = useState(null);
      const [revealEmail, setRevealEmail] = useState(false);
      const [copiedUrl, setCopiedUrl] = useState(false);

      // Selected Agent draft states
      const [activeAuthMethod, setActiveAuthMethod] = useState('');
      const [credDraft, setCredDraft] = useState({});
      const [modelQuery, setModelQuery] = useState('');
      const [newModelInput, setNewModelInput] = useState('');
      const [runtimeDraft, setRuntimeDraft] = useState({
        name: '',
        badge: '',
        command: '',
        argsText: '',
        profileDir: '',
        permissionPolicy: 'ask',
        envRows: [],
      });

      // Add Account / Custom Agent Modal
      const [addModal, setAddModal] = useState(null);

      const loadCatalog = useCallback(
        async (refreshAccounts = false) => {
          try {
            setLoading(true);
            const data = await rpc('catalog', { refreshAccounts });
            setCatalog(data);
          } catch (err) {
            setBanner({ error: true, text: t('loadFailed', { message: err?.message || String(err) }) });
          } finally {
            setLoading(false);
          }
        },
        [rpc, t],
      );

      useEffect(() => {
        void loadCatalog(true);
      }, [loadCatalog]);

      const agents = catalog?.agents || [];
      const selectedAgent = useMemo(
        () => agents.find((a) => a.id === selectedId) || agents[0] || null,
        [agents, selectedId],
      );

      // Sync local drafts when switching selected Agent
      useEffect(() => {
        if (!selectedAgent) return;
        const methods = selectedAgent.account?.availableMethods || [];
        const currentMethod =
          selectedAgent.account?.authMethod
          || selectedAgent.authMethod
          || methods[0]?.id
          || '';
        setActiveAuthMethod(currentMethod);

        const nextCreds = {};
        for (const m of methods) {
          for (const f of m.fields || []) {
            nextCreds[f.key] = selectedAgent.env?.[f.key] || '';
          }
        }
        setCredDraft(nextCreds);

        const envEntries = Object.entries(selectedAgent.env || {}).map(([key, value]) => ({
          key,
          value: String(value ?? ''),
        }));
        setRuntimeDraft({
          name: selectedAgent.name || '',
          badge: selectedAgent.badge || 'ACP',
          command: selectedAgent.command || '',
          argsText: Array.isArray(selectedAgent.args) ? selectedAgent.args.join(' ') : '',
          profileDir: selectedAgent.profileDir || '',
          permissionPolicy: selectedAgent.permissionPolicy || 'ask',
          envRows: envEntries,
        });
        setModelQuery('');
        setNewModelInput('');
      }, [selectedAgent?.id]);

      // Auto-poll when an interactive OAuth / Device Code login flow is running
      const activeFlow = selectedAgent?.authFlow;
      useEffect(() => {
        if (!activeFlow || (activeFlow.status !== 'starting' && activeFlow.status !== 'awaiting-browser')) {
          return undefined;
        }
        const timer = setInterval(() => {
          void rpc('catalog', { refreshAccounts: false })
            .then((data) => {
              if (data) setCatalog(data);
            })
            .catch(() => {});
        }, 1500);
        return () => clearInterval(timer);
      }, [activeFlow?.status, selectedAgent?.id, rpc]);

      const toggleAgentEnabled = async (agent, nextVal) => {
        const enabled = unwrapSwitchChecked(nextVal, !agent.enabled);
        setBusyAction(`toggle:${agent.id}`);
        setBanner(null);
        try {
          const next = await rpc('agent/toggle', { id: agent.id, enabled });
          setCatalog(next);
          if (enabled) {
            setTimeout(() => {
              void rpc('catalog').then((d) => d && setCatalog(d)).catch(() => {});
            }, 2200);
          }
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const testAndSyncAgent = async (agent) => {
        setBusyAction(`test:${agent.id}`);
        setBanner(null);
        try {
          const res = await rpc('agent/test', { id: agent.id });
          if (res?.catalog) setCatalog(res.catalog);
          if (res?.ok) {
            setBanner({
              error: false,
              text: t('test.ok', { name: agent.name, binary: res.binaryPath || agent.command }),
            });
          } else {
            setBanner({
              error: true,
              text: t('test.failed', { name: agent.name, error: res?.error || 'Handshake failed' }),
            });
          }
        } catch (err) {
          setBanner({
            error: true,
            text: t('test.failed', { name: agent.name, error: err?.message || String(err) }),
          });
        } finally {
          setBusyAction('');
        }
      };

      const startLoginFlow = async (forceNewToken = false) => {
        if (!selectedAgent) return;
        setBusyAction('login');
        setBanner(null);
        try {
          const res = await rpc('agent/login', {
            id: selectedAgent.id,
            methodId: activeAuthMethod,
            forceNewToken,
            autoOpenBrowser: true,
          });
          if (res?.catalog) setCatalog(res.catalog);
          setBanner({ error: false, text: t('login.started') });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const saveApiKeyCredentials = async () => {
        if (!selectedAgent) return;
        setBusyAction('save-creds');
        setBanner(null);
        try {
          const res = await rpc('agent/login', {
            id: selectedAgent.id,
            methodId: activeAuthMethod,
            credentials: credDraft,
            onlySaveCredentials: true,
          });
          if (res?.catalog) setCatalog(res.catalog);
          setBanner({ error: false, text: t('saved') });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const cancelLoginFlow = async () => {
        if (!selectedAgent) return;
        const next = await rpc('agent/login/cancel', { id: selectedAgent.id });
        setCatalog(next);
      };

      const logoutCurrentAgent = async () => {
        if (!selectedAgent) return;
        setBusyAction('logout');
        setBanner(null);
        try {
          const next = await rpc('agent/logout', {
            id: selectedAgent.id,
            clearApiKeys: true,
          });
          setCatalog(next);
          setBanner({ error: false, text: t('logout.done', { name: selectedAgent.name }) });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const saveAgentPatch = async (patch) => {
        if (!selectedAgent) return;
        setBusyAction('save');
        setBanner(null);
        try {
          const next = await rpc('agent/save', {
            agent: {
              ...selectedAgent,
              models: selectedAgent.configuredModels || selectedAgent.models,
              ...patch,
              id: selectedAgent.id,
            },
          });
          setCatalog(next);
          setBanner({ error: false, text: t('saved') });
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const toggleModelFavorite = async (modelId) => {
        if (!selectedAgent) return;
        const currentFavs = new Set(selectedAgent.favoriteModels || []);
        if (currentFavs.has(modelId)) currentFavs.delete(modelId);
        else currentFavs.add(modelId);
        await saveAgentPatch({ favoriteModels: Array.from(currentFavs) });
      };

      const toggleModelVisible = async (modelId, visible) => {
        if (!selectedAgent) return;
        const currentHidden = new Set(selectedAgent.hiddenModels || []);
        if (visible) currentHidden.delete(modelId);
        else currentHidden.add(modelId);
        await saveAgentPatch({ hiddenModels: Array.from(currentHidden) });
      };

      const addCustomModel = async () => {
        if (!selectedAgent || !newModelInput.trim()) return;
        const raw = newModelInput.trim();
        const pipe = raw.indexOf('|');
        const id = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
        const name = (pipe >= 0 ? raw.slice(pipe + 1) : raw).trim() || id;
        if (!id) return;
        const baseModels = [...(selectedAgent.configuredModels || selectedAgent.models || [])];
        if (!baseModels.some((m) => m.id === id)) {
          baseModels.unshift({ id, name, defaultEffort: 'medium' });
        }
        const currentHidden = (selectedAgent.hiddenModels || []).filter((hId) => hId !== id);
        setNewModelInput('');
        await saveAgentPatch({ models: baseModels, hiddenModels: currentHidden });
      };

      const saveRuntimeAndEnv = async () => {
        if (!selectedAgent) return;
        const envObj = {};
        for (const row of runtimeDraft.envRows) {
          const k = String(row.key || '').trim();
          if (k) envObj[k] = String(row.value ?? '');
        }
        await saveAgentPatch({
          name: runtimeDraft.name.trim() || selectedAgent.name,
          badge: runtimeDraft.badge.trim() || selectedAgent.badge,
          command: runtimeDraft.command.trim() || selectedAgent.command,
          args: runtimeDraft.argsText.trim().split(/\s+/).filter(Boolean),
          profileDir: runtimeDraft.profileDir.trim(),
          permissionPolicy: runtimeDraft.permissionPolicy,
          env: envObj,
        });
      };

      const deleteOrResetAgent = async () => {
        if (!selectedAgent) return;
        setBusyAction('delete');
        try {
          const next = await rpc('agent/delete', { id: selectedAgent.id });
          setCatalog(next);
          if (!selectedAgent.builtin && next?.agents?.[0]) {
            setSelectedId(next.agents[0].id);
          }
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const createAccountInstance = async () => {
        if (!addModal) return;
        setBusyAction('create-instance');
        try {
          if (addModal.baseAgentId === 'custom') {
            const customId = addModal.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || `custom-${Date.now()}`;
            const next = await rpc('agent/save', {
              agent: {
                id: customId,
                baseAgentId: 'custom',
                name: addModal.name.trim() || 'Custom ACP Agent',
                badge: 'ACP',
                command: addModal.command.trim() || 'custom-acp',
                args: ['--acp'],
                enabled: true,
              },
            });
            setCatalog(next);
            setSelectedId(customId);
          } else {
            const res = await rpc('agent/create-account', {
              baseAgentId: addModal.baseAgentId,
              name: addModal.name.trim(),
            });
            if (res?.catalog) setCatalog(res.catalog);
            if (res?.createdId) setSelectedId(res.createdId);
          }
          setAddModal(null);
        } catch (err) {
          setBanner({ error: true, text: t('saveFailed', { message: err?.message || String(err) }) });
        } finally {
          setBusyAction('');
        }
      };

      const permissionOptions = useMemo(
        () => [
          { id: 'ask', label: t('field.permission.ask') },
          { id: 'auto-allow-read', label: t('field.permission.read') },
          { id: 'auto-allow', label: t('field.permission.all') },
        ],
        [t],
      );

      const account = selectedAgent?.account;
      const availableMethods = account?.availableMethods || [];
      const currentMethodDef =
        availableMethods.find((m) => m.id === activeAuthMethod) || availableMethods[0] || null;

      const allModels = selectedAgent?.allModels || selectedAgent?.models || [];
      const enabledCount = allModels.filter((m) => !m.hidden).length;
      const filteredModels = useMemo(() => {
        const q = modelQuery.trim().toLowerCase();
        if (!q) return allModels;
        return allModels.filter(
          (m) =>
            String(m.name || '').toLowerCase().includes(q)
            || String(m.id || '').toLowerCase().includes(q),
        );
      }, [allModels, modelQuery]);

      return h(
        'div',
        { className: 'dsh-acp-settings' },
        /* Top Page Header */
        h(
          'div',
          { className: 'dsh-acp-header' },
          h(
            'div',
            { className: 'dsh-acp-header-copy' },
            h('h3', { className: 'dsh-acp-title' }, t('page.title')),
            h('p', { className: 'dsh-acp-subtitle' }, t('page.subtitle')),
          ),
          h(
            'div',
            { className: 'dsh-acp-header-actions' },
            h(
              Button,
              {
                variant: 'outline',
                size: 'sm',
                icon: h(IconRefreshOutline16, { size: 14 }),
                disabled: loading,
                onClick: () => void loadCatalog(true),
              },
              t('page.refresh'),
            ),
            h(
              Button,
              {
                variant: 'primary',
                size: 'sm',
                icon: h(IconPlusOutline16, { size: 14 }),
                onClick: () =>
                  setAddModal({
                    baseAgentId: selectedAgent?.baseAgentId || 'claude-code',
                    name: '',
                    command: '',
                  }),
              },
              t('page.addInstance'),
            ),
          ),
        ),

        banner
          ? h(
              'div',
              {
                className: 'dsh-acp-banner',
                'data-error': banner.error ? 'true' : undefined,
              },
              banner.text,
            )
          : null,

        /* T3 Code Split Workspace: Left Provider Rail + Right Selected Provider Detail */
        h(
          'div',
          { className: 'dsh-acp-workspace' },
          /* Left Sidebar Rail */
          h(
            'div',
            { className: 'dsh-acp-rail', role: 'tablist', 'aria-label': 'Agents' },
            agents.map((agent) => {
              const acc = agent.account;
              const isSelected = agent.id === selectedAgent?.id;
              const dotState = !agent.binaryFound
                ? 'idle'
                : acc?.authenticated
                  ? 'done'
                  : 'warning';
              const subParts = [];
              if (!agent.binaryFound) {
                subParts.push(t('status.missing'));
              } else if (acc?.authenticated) {
                if (acc.email) subParts.push(maskEmail(acc.email));
                else if (acc.plan) subParts.push(acc.plan);
                else subParts.push(t('status.authenticated'));
              } else {
                subParts.push(t('status.unauthenticated'));
              }
              if (agent.version) subParts.push(`v${agent.version}`);

              return h(
                'div',
                {
                  key: agent.id,
                  role: 'tab',
                  tabIndex: 0,
                  'aria-selected': isSelected,
                  'data-selected': isSelected ? 'true' : 'false',
                  'data-agent-id': agent.id,
                  className: 'dsh-acp-rail-item',
                  onClick: () => setSelectedId(agent.id),
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(agent.id);
                    }
                  },
                },
                h(
                  'div',
                  { className: 'dsh-acp-rail-item-main' },
                  h(
                    'div',
                    { className: 'dsh-acp-rail-title-row' },
                    h(StateDot, { state: dotState, size: 10 }),
                    // First text leaf is agent.name for Settings search indexing
                    h('span', { className: 'dsh-acp-rail-name' }, agent.name),
                  ),
                  h('span', { className: 'dsh-acp-rail-sub' }, subParts.join(' · ')),
                ),
                h(
                  'div',
                  {
                    onClick: (e) => e.stopPropagation(),
                  },
                  h(Switch, {
                    'aria-label': agent.name,
                    checked: agent.enabled === true,
                    disabled: busyAction === `toggle:${agent.id}`,
                    loading: busyAction === `toggle:${agent.id}`,
                    onChange: (val) => void toggleAgentEnabled(agent, val),
                  }),
                ),
              );
            }),
          ),

          /* Right Detail Column */
          selectedAgent
            ? h(
                'div',
                { className: 'dsh-acp-detail' },

                /* 1. Overview Header Card */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h(
                        'div',
                        { className: 'dsh-acp-card-title-row' },
                        h('h4', { className: 'dsh-acp-card-title' }, selectedAgent.name),
                        h('span', { className: 'dsh-acp-badge' }, selectedAgent.badge || 'ACP'),
                        selectedAgent.version
                          ? h('span', { className: 'dsh-acp-badge' }, `v${selectedAgent.version}`)
                          : null,
                        h(
                          'span',
                          {
                            className: 'dsh-acp-badge',
                            'data-tone': !selectedAgent.binaryFound
                              ? 'warning'
                              : account?.authenticated
                                ? 'success'
                                : 'warning',
                          },
                          !selectedAgent.binaryFound
                            ? t('status.missing')
                            : account?.authenticated
                              ? t('status.authenticated')
                              : t('status.unauthenticated'),
                        ),
                      ),
                      h('p', { className: 'dsh-acp-card-desc' }, selectedAgent.description || ''),
                    ),
                  ),
                  h(
                    'div',
                    {
                      className: 'dsh-acp-cmd-bar',
                      title: selectedAgent.binaryPath
                        ? `${selectedAgent.binaryPath} ${(selectedAgent.args || []).join(' ')}`
                        : `$ ${selectedAgent.command} ${(selectedAgent.args || []).join(' ')}`,
                    },
                    selectedAgent.binaryPath
                      ? `$ ${selectedAgent.command} ${(selectedAgent.args || []).join(' ')} \u00b7 ${selectedAgent.binaryPath}`
                      : `$ ${selectedAgent.command} ${(selectedAgent.args || []).join(' ')}`,
                  ),
                  h(
                    'div',
                    { className: 'dsh-acp-card-actions-bar' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          loading: busyAction === `test:${selectedAgent.id}`,
                          onClick: () => void testAndSyncAgent(selectedAgent),
                        },
                        busyAction === `test:${selectedAgent.id}` ? t('action.testing') : t('action.test'),
                      ),
                      selectedAgent.baseAgentId && selectedAgent.baseAgentId !== 'custom'
                        ? h(
                            Button,
                            {
                              variant: 'outline',
                              size: 'sm',
                              icon: h(IconPlusOutline16, { size: 14 }),
                              onClick: () =>
                                setAddModal({
                                  baseAgentId: selectedAgent.baseAgentId,
                                  name: `${selectedAgent.name} #2`,
                                  command: selectedAgent.command,
                                }),
                            },
                            t('action.addAccount'),
                          )
                        : null,
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconTrashOutline16, { size: 14 }),
                          onClick: () => void deleteOrResetAgent(),
                        },
                        selectedAgent.builtin ? t('action.reset') : t('action.delete'),
                      ),
                    ),
                  ),
                ),

                /* 2. Account & Authentication Card (T3 Code ProviderAuthenticationSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h('h4', { className: 'dsh-acp-card-title' }, t('section.account')),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.accountDesc')),
                    ),
                  ),

                  /* Current Account Status Box */
                  h(
                    'div',
                    { className: 'dsh-acp-account-box' },
                    h(
                      'div',
                      { className: 'dsh-acp-account-row' },
                      h(
                        'div',
                        { className: 'dsh-acp-account-user' },
                        h(StateDot, {
                          state: account?.authenticated ? 'done' : 'warning',
                          size: 12,
                        }),
                        account?.email
                          ? h(
                              'span',
                              {
                                className: 'dsh-acp-account-email',
                                title: t('account.reveal'),
                                onClick: () => setRevealEmail((v) => !v),
                              },
                              revealEmail ? account.email : maskEmail(account.email),
                            )
                          : h(
                              'span',
                              { style: { fontWeight: 600, fontSize: '13px' } },
                              account?.authenticated
                                ? account.name || account.authLabel || t('status.authenticated')
                                : t('account.notLoggedIn'),
                            ),
                        account?.plan
                          ? h(
                              'span',
                              { className: 'dsh-acp-badge', 'data-tone': 'plan' },
                              account.plan,
                            )
                          : null,
                        account?.authLabel
                          ? h('span', { className: 'dsh-acp-badge' }, account.authLabel)
                          : null,
                      ),
                      h(
                        'div',
                        { className: 'dsh-acp-card-actions' },
                        currentMethodDef?.type !== 'api_key'
                          ? h(
                              Button,
                              {
                                variant: 'primary',
                                size: 'sm',
                                loading: busyAction === 'login',
                                disabled: !selectedAgent.binaryFound,
                                onClick: () => void startLoginFlow(Boolean(account?.authenticated)),
                              },
                              account?.authenticated ? t('action.relogin') : t('action.login'),
                            )
                          : null,
                        account?.authenticated
                          ? h(
                              Button,
                              {
                                variant: 'outline',
                                size: 'sm',
                                loading: busyAction === 'logout',
                                onClick: () => void logoutCurrentAgent(),
                              },
                              t('action.logout'),
                            )
                          : null,
                      ),
                    ),
                    account?.message
                      ? h('div', { className: 'dsh-acp-account-msg' }, account.message)
                      : null,
                    account?.profileDir || selectedAgent.profileDir
                      ? h(
                          'div',
                          { className: 'dsh-acp-meta-line' },
                          `${t('account.profileDir')}: ${selectedAgent.profileDir || account.profileDir}`,
                        )
                      : null,
                  ),

                  /* Auth Method Selector Tabs */
                  availableMethods.length > 1
                    ? h(
                        'div',
                        { className: 'dsh-acp-auth-methods' },
                        availableMethods.map((m) =>
                          h(
                            'button',
                            {
                              key: m.id,
                              type: 'button',
                              className: 'dsh-acp-auth-method-card',
                              'data-active': m.id === activeAuthMethod ? 'true' : 'false',
                              onClick: () => setActiveAuthMethod(m.id),
                            },
                            h('span', { className: 'dsh-acp-auth-method-title' }, m.label),
                            h('span', { className: 'dsh-acp-auth-method-desc' }, m.description),
                          ),
                        ),
                      )
                    : null,

                  /* Live OAuth / Device Code Flow Box when active */
                  activeFlow
                    ? h(
                        'div',
                        { className: 'dsh-acp-flow-box' },
                        h(
                          'div',
                          { className: 'dsh-acp-flow-top' },
                          h(
                            'div',
                            { className: 'dsh-acp-flow-status' },
                            h(StateDot, {
                              state:
                                activeFlow.status === 'authenticated'
                                  ? 'done'
                                  : activeFlow.status === 'error'
                                    ? 'warning'
                                    : 'ongoing',
                              size: 14,
                            }),
                            h('span', null, activeFlow.message || '正在等待浏览器授权…'),
                          ),
                          activeFlow.userCode
                            ? h('span', { className: 'dsh-acp-flow-code' }, activeFlow.userCode)
                            : null,
                          h(
                            Button,
                            {
                              variant: 'outline',
                              size: 'sm',
                              onClick: () => void cancelLoginFlow(),
                            },
                            t('action.cancelLogin'),
                          ),
                        ),
                        activeFlow.url
                          ? h(
                              'div',
                              { className: 'dsh-acp-flow-url-row' },
                              h('div', { className: 'dsh-acp-flow-url', title: activeFlow.url }, activeFlow.url),
                              h(
                                Button,
                                {
                                  variant: 'primary',
                                  size: 'sm',
                                  onClick: () => void rpc('agent/open-url', { url: activeFlow.url }),
                                },
                                t('action.openBrowser'),
                              ),
                              h(
                                Button,
                                {
                                  variant: 'outline',
                                  size: 'sm',
                                  onClick: () => {
                                    navigator.clipboard?.writeText?.(activeFlow.url);
                                    setCopiedUrl(true);
                                    setTimeout(() => setCopiedUrl(false), 1800);
                                  },
                                },
                                copiedUrl ? t('action.copied') : t('action.copyUrl'),
                              ),
                            )
                          : null,
                        Array.isArray(activeFlow.logs) && activeFlow.logs.length > 0
                          ? h('div', { className: 'dsh-acp-flow-logs' }, activeFlow.logs.join('\n'))
                          : null,
                      )
                    : null,

                  /* Credential Fields when API Key / Vertex AI method is selected */
                  currentMethodDef?.fields && currentMethodDef.fields.length > 0
                    ? h(
                        'div',
                        { className: 'dsh-acp-account-box' },
                        h(
                          'div',
                          { className: 'dsh-acp-grid-2' },
                          currentMethodDef.fields.map((field) =>
                            h(
                              'div',
                              { key: field.key, className: 'dsh-acp-field' },
                              h('label', { className: 'dsh-acp-field-label' }, field.label),
                              h(Input, {
                                variant: 'form',
                                type: field.secret ? 'password' : 'text',
                                value: credDraft[field.key] ?? '',
                                placeholder: field.placeholder || '',
                                onChange: (e) =>
                                  setCredDraft({ ...credDraft, [field.key]: e.target.value }),
                              }),
                            ),
                          ),
                        ),
                        h(
                          'div',
                          { style: { display: 'flex', justifyContent: 'flex-end' } },
                          h(
                            Button,
                            {
                              variant: 'primary',
                              size: 'sm',
                              loading: busyAction === 'save-creds',
                              onClick: () => void saveApiKeyCredentials(),
                            },
                            t('action.saveCredentials'),
                          ),
                        ),
                      )
                    : null,
                ),

                /* 3. Models Section (T3 Code ProviderModelsSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h(
                        'div',
                        { className: 'dsh-acp-card-title-row' },
                        h('h4', { className: 'dsh-acp-card-title' }, t('section.models')),
                        h(
                          'span',
                          { className: 'dsh-acp-badge' },
                          t('models.count', {
                            enabled: String(enabledCount),
                            total: String(allModels.length),
                          }),
                        ),
                      ),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.modelsDesc')),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-card-actions' },
                      (selectedAgent.hiddenModels || []).length > 0
                        ? h(
                            Button,
                            {
                              variant: 'outline',
                              size: 'sm',
                              onClick: () => void saveAgentPatch({ hiddenModels: [] }),
                            },
                            t('models.showAll'),
                          )
                        : null,
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconRefreshOutline16, { size: 14 }),
                          loading: busyAction === `test:${selectedAgent.id}`,
                          onClick: () => void testAndSyncAgent(selectedAgent),
                        },
                        t('models.syncBtn'),
                      ),
                    ),
                  ),

                  /* Search + Add custom model toolbar */
                  h(
                    'div',
                    { className: 'dsh-acp-models-toolbar' },
                    h(
                      'div',
                      { className: 'dsh-acp-models-toolbar-input' },
                      h(Input, {
                        variant: 'form',
                        value: modelQuery,
                        placeholder: t('models.searchPh'),
                        onChange: (e) => setModelQuery(e.target.value),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-models-toolbar-input' },
                      h(Input, {
                        variant: 'form',
                        value: newModelInput,
                        placeholder: t('models.addPh'),
                        onChange: (e) => setNewModelInput(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addCustomModel();
                          }
                        },
                      }),
                    ),
                    h(
                      Button,
                      {
                        variant: 'outline',
                        size: 'sm',
                        icon: h(IconPlusOutline16, { size: 14 }),
                        disabled: !newModelInput.trim(),
                        onClick: () => void addCustomModel(),
                      },
                      t('models.addBtn'),
                    ),
                  ),

                  /* Scrollable Model Rows */
                  h(
                    'div',
                    { className: 'dsh-acp-models-list' },
                    filteredModels.map((m) =>
                      h(
                        'div',
                        {
                          key: m.id,
                          className: 'dsh-acp-model-row',
                          'data-hidden': m.hidden ? 'true' : 'false',
                        },
                        h(
                          'div',
                          { className: 'dsh-acp-model-left' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'dsh-acp-star-btn',
                              'data-fav': m.favorite ? 'true' : 'false',
                              title: t('models.favorite'),
                              onClick: () => void toggleModelFavorite(m.id),
                            },
                            m.favorite ? '★' : '☆',
                          ),
                          h('span', { className: 'dsh-acp-model-name' }, m.name || m.id),
                          m.name && m.name !== m.id
                            ? h('span', { className: 'dsh-acp-model-id' }, m.id)
                            : null,
                          m.discovered
                            ? h('span', { className: 'dsh-acp-badge' }, t('models.discovered'))
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'dsh-acp-model-right' },
                          h(Switch, {
                            'aria-label': m.name || m.id,
                            checked: !m.hidden,
                            onChange: (val) =>
                              void toggleModelVisible(m.id, unwrapSwitchChecked(val, Boolean(m.hidden))),
                          }),
                        ),
                      ),
                    ),
                  ),
                ),

                /* 4. Runtime & Environment Variables Card (T3 Code ProviderSetupSection) */
                h(
                  'div',
                  { className: 'dsh-acp-card' },
                  h(
                    'div',
                    { className: 'dsh-acp-card-header' },
                    h(
                      'div',
                      { className: 'dsh-acp-card-header-copy' },
                      h('h4', { className: 'dsh-acp-card-title' }, t('section.runtime')),
                      h('p', { className: 'dsh-acp-card-desc' }, t('section.runtimeDesc')),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'dsh-acp-grid-2' },
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.name')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.name,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, name: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.command,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, command: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.args')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.argsText,
                        onChange: (e) => setRuntimeDraft({ ...runtimeDraft, argsText: e.target.value }),
                      }),
                    ),
                    h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.profileDir')),
                      h(Input, {
                        variant: 'form',
                        value: runtimeDraft.profileDir,
                        placeholder: '留空则使用本机默认目录 (~/.claude / ~/.codex / ~/.dsh/antigravity)',
                        onChange: (e) =>
                          setRuntimeDraft({ ...runtimeDraft, profileDir: e.target.value }),
                      }),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'dsh-acp-field' },
                    h('label', { className: 'dsh-acp-field-label' }, t('field.permission')),
                    h(SettingsSelect, {
                      variant: 'block',
                      'aria-label': t('field.permission'),
                      value: runtimeDraft.permissionPolicy,
                      options: permissionOptions,
                      onChange: (val) =>
                        setRuntimeDraft({ ...runtimeDraft, permissionPolicy: val }),
                    }),
                  ),

                  /* Environment Variables Interactive Editor */
                  h(
                    'div',
                    { className: 'dsh-acp-field', style: { marginTop: '4px' } },
                    h(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        },
                      },
                      h('label', { className: 'dsh-acp-field-label' }, t('section.env')),
                      h(
                        Button,
                        {
                          variant: 'outline',
                          size: 'sm',
                          icon: h(IconPlusOutline16, { size: 14 }),
                          onClick: () =>
                            setRuntimeDraft({
                              ...runtimeDraft,
                              envRows: [...runtimeDraft.envRows, { key: '', value: '' }],
                            }),
                        },
                        t('env.addRow'),
                      ),
                    ),
                    runtimeDraft.envRows.length === 0
                      ? h('div', { className: 'dsh-acp-meta-line' }, t('env.empty'))
                      : h(
                          'div',
                          { className: 'dsh-acp-env-list' },
                          runtimeDraft.envRows.map((row, idx) =>
                            h(
                              'div',
                              { key: idx, className: 'dsh-acp-env-row' },
                              h(Input, {
                                variant: 'form',
                                value: row.key,
                                placeholder: t('env.keyPh'),
                                onChange: (e) => {
                                  const nextRows = [...runtimeDraft.envRows];
                                  nextRows[idx] = { ...row, key: e.target.value };
                                  setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                },
                              }),
                              h(Input, {
                                variant: 'form',
                                type: /KEY|TOKEN|SECRET|PASSWORD/i.test(row.key) ? 'password' : 'text',
                                value: row.value,
                                placeholder: t('env.valPh'),
                                onChange: (e) => {
                                  const nextRows = [...runtimeDraft.envRows];
                                  nextRows[idx] = { ...row, value: e.target.value };
                                  setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                },
                              }),
                              h(
                                Button,
                                {
                                  variant: 'outline',
                                  size: 'sm',
                                  icon: h(IconTrashOutline16, { size: 14 }),
                                  onClick: () => {
                                    const nextRows = runtimeDraft.envRows.filter((_, i) => i !== idx);
                                    setRuntimeDraft({ ...runtimeDraft, envRows: nextRows });
                                  },
                                },
                                '',
                              ),
                            ),
                          ),
                        ),
                  ),

                  h(
                    'div',
                    { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } },
                    h(
                      Button,
                      {
                        variant: 'primary',
                        size: 'sm',
                        loading: busyAction === 'save',
                        onClick: () => void saveRuntimeAndEnv(),
                      },
                      t('action.saveRuntime'),
                    ),
                  ),
                ),
              )
            : null,
        ),

        /* Modal for creating a new isolated account instance or custom ACP agent */
        addModal
          ? h(
              Modal,
              {
                open: true,
                onClose: () => setAddModal(null),
                title: t('modal.addTitle'),
                closeLabel: t('modal.close'),
                footer: h(
                  'div',
                  { className: 'dsh-acp-modal-footer' },
                  h(
                    Button,
                    {
                      variant: 'outline',
                      size: 'sm',
                      onClick: () => setAddModal(null),
                    },
                    t('modal.cancel'),
                  ),
                  h(
                    Button,
                    {
                      variant: 'primary',
                      size: 'sm',
                      loading: busyAction === 'create-instance',
                      onClick: () => void createAccountInstance(),
                    },
                    t('modal.create'),
                  ),
                ),
              },
              h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
                h(
                  'div',
                  { className: 'dsh-acp-field' },
                  h('label', { className: 'dsh-acp-field-label' }, t('modal.addType')),
                  h(SettingsSelect, {
                    variant: 'block',
                    value: addModal.baseAgentId,
                    options: [
                      { id: 'claude-code', label: 'Claude Code (独立账号实例)' },
                      { id: 'codex', label: 'OpenAI Codex (独立账号实例)' },
                      { id: 'antigravity', label: 'Google Antigravity (独立账号实例)' },
                      { id: 'devin', label: 'Cognition Devin (独立账号实例)' },
                      { id: 'custom', label: '自定义 ACP 智能体 (Custom ACP)' },
                    ],
                    onChange: (val) => setAddModal({ ...addModal, baseAgentId: val }),
                  }),
                ),
                h(
                  'div',
                  { className: 'dsh-acp-field' },
                  h('label', { className: 'dsh-acp-field-label' }, t('modal.addName')),
                  h(Input, {
                    variant: 'form',
                    value: addModal.name,
                    placeholder: t('modal.addNamePh'),
                    onChange: (e) => setAddModal({ ...addModal, name: e.target.value }),
                  }),
                ),
                addModal.baseAgentId === 'custom'
                  ? h(
                      'div',
                      { className: 'dsh-acp-field' },
                      h('label', { className: 'dsh-acp-field-label' }, t('field.command')),
                      h(Input, {
                        variant: 'form',
                        value: addModal.command,
                        placeholder: 'e.g. my-agent-binary',
                        onChange: (e) => setAddModal({ ...addModal, command: e.target.value }),
                      }),
                    )
                  : null,
              ),
            )
          : null,
      );
    }

    const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };

    /**
     * T3 Code-style Composer Agent + Model + Effort Selector.
     * Shadows `conversation.input.model` at priority -10.
     */
    function AgentModelSelect(props) {
      const { locked, available, directory, load, select, openAgentSettings, t } = props;
      const state = useSyncExternalStore(
        (fn) => directory.subscribe(fn),
        () => directory.getSnapshot(),
      );
      const [open, setOpen] = useState(false);
      const { mounted, state: motionState } = usePresence(open);
      const [pane, setPane] = useState('root'); // 'root' | 'agent' | 'model' | 'effort'
      const [query, setQuery] = useState('');
      const [highlightedIndex, setHighlightedIndex] = useState(null);
      const [selectionFocus, setSelectionFocus] = useState(false);
      const lastActionRef = useRef('load');
      const [toast, setToast] = useState(null);
      const toastSeq = useRef(0);

      const rootRef = useRef(null);
      const triggerRef = useRef(null);
      const searchRef = useRef(null);
      const menuRef = useRef(null);
      const groupsRef = useRef(null);
      const itemRefs = useRef([]);
      const [menuPos, setMenuPos] = useState(null);
      const id = useId();

      const menuItems = () =>
        Array.from(
          menuRef.current?.querySelectorAll('[role="menuitem"], [role="menuitemradio"]') ?? [],
        );

      useEffect(() => {
        if (available) load();
      }, [available, load]);

      useEffect(() => {
        if (!open || lastActionRef.current !== 'load') return;
        const text = [
          ...(state.error === null || state.error === undefined
            ? []
            : [t('error.action', { message: state.error })]),
          ...(state.failures || []).map((failure) =>
            t('warning.groupLoad', {
              name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
              message: failure.message,
            }),
          ),
        ].join('\n');
        if (text !== '') {
          toastSeq.current += 1;
          setToast({ seq: toastSeq.current, text, catalog: true });
        } else {
          setToast((current) => (current?.catalog === true ? null : current));
        }
      }, [open, state.error, state.failures, t]);

      const accountProviderName = t('provider.account');

      const { agents, allChoices } = useMemo(() => {
        const dshGroups = [];
        const acpGroups = [];
        for (const group of state.groups || []) {
          if (typeof group.id === 'string' && group.id.startsWith(ACP_PREFIX)) {
            acpGroups.push({
              ...group,
              provider: { id: group.id, name: group.name },
            });
          } else {
            dshGroups.push({
              ...group,
              provider: {
                id: group.id,
                name: group.id === 'deepseek-account' ? accountProviderName : group.name,
              },
            });
          }
        }

        const agentEntries = [
          {
            id: 'dsh',
            name: t('agent.defaultName'),
            badge: t('agent.defaultBadge'),
            isExternal: false,
            groups: dshGroups,
          },
          ...acpGroups.map((g) => ({
            id: g.id,
            name: g.name,
            badge: t('agent.externalBadge'),
            isExternal: true,
            groups: [g],
          })),
        ];

        const flatChoices = [...dshGroups, ...acpGroups].flatMap((group) =>
          (group.models || []).map((model) => ({
            agentId: group.id.startsWith(ACP_PREFIX) ? group.id : 'dsh',
            group,
            model,
            selection: {
              provider: group.id,
              model: model.id,
              ...(model.reasoning?.defaultEffort === undefined
                ? {}
                : { reasoningEffort: model.reasoning.defaultEffort }),
            },
          })),
        );

        return { agents: agentEntries, allChoices: flatChoices };
      }, [state.groups, accountProviderName, t]);

      const currentProviderId = state.current?.provider || '';
      const activeAgentId = currentProviderId.startsWith(ACP_PREFIX) ? currentProviderId : 'dsh';
      const activeAgent = agents.find((a) => a.id === activeAgentId) || agents[0];

      const currentChoice = useMemo(
        () =>
          state.current === null
            ? undefined
            : allChoices.find(
                (c) =>
                  c.selection.provider === state.current?.provider
                  && c.selection.model === state.current?.model,
              ),
        [allChoices, state.current],
      );

      const agentGroups = activeAgent?.groups || [];
      const agentChoices = useMemo(
        () =>
          agentGroups.flatMap((group) =>
            (group.models || []).map((model) => ({
              group,
              model,
              selection: {
                provider: group.id,
                model: model.id,
                ...(model.reasoning?.defaultEffort === undefined
                  ? {}
                  : { reasoningEffort: model.reasoning.defaultEffort }),
              },
            })),
          ),
        [agentGroups],
      );

      const showSearch = agentChoices.length > 4;
      const filteredGroups = useMemo(
        () =>
          agentGroups
            .map((group) => ({
              ...group,
              models: rankByName(group.models || [], showSearch ? query.trim() : ''),
            }))
            .filter((group) => group.models.length > 0),
        [agentGroups, query, showSearch],
      );

      const visibleModels = useMemo(
        () =>
          filteredGroups.flatMap((group) =>
            group.models.map((model) => ({
              provider: group.id,
              model: model.id,
              reasoningEffort: model.reasoning?.defaultEffort,
            })),
          ),
        [filteredGroups],
      );

      const currentVisibleIndex = visibleModels.findIndex(
        (m) => m.provider === state.current?.provider && m.model === state.current?.model,
      );
      const activeModelIndex = Math.min(
        highlightedIndex ?? Math.max(0, currentVisibleIndex),
        Math.max(0, visibleModels.length - 1),
      );

      const reasoning = currentChoice?.model?.reasoning;
      const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
      const effortLabel =
        reasoning === undefined
          ? state.retainedEffort
          : effectiveEffort === undefined
            ? t('effort.providerDefault')
            : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort;

      const effortChoices = useMemo(
        () =>
          reasoning === undefined
            ? []
            : [
                ...(reasoning.defaultEffort === undefined
                  ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
                  : []),
                ...reasoning.efforts.map((effort) => ({
                  key: `effort:${effort.id}`,
                  effort: effort.id,
                  label: effort.name,
                })),
              ],
        [reasoning, t],
      );

      const busy = state.pending !== null;

      const reload = () => {
        lastActionRef.current = 'load';
        setToast((current) => (current?.catalog === true ? null : current));
        load();
      };

      useEffect(() => {
        if (!open) return undefined;
        const closeOutside = (event) => {
          if (event.target instanceof Element && event.target.closest('[data-dsh-toast]') !== null) return;
          if (rootRef.current?.contains(event.target) === true) return;
          if (menuRef.current?.contains(event.target) === true) return;
          setOpen(false);
        };
        document.addEventListener('mousedown', closeOutside);
        return () => document.removeEventListener('mousedown', closeOutside);
      }, [open]);

      useEffect(() => {
        if (!mounted) setPane('root');
      }, [mounted]);

      useLayoutEffect(() => {
        if (!showSearch) {
          setQuery('');
          setHighlightedIndex(null);
        }
      }, [showSearch]);

      const paneFocus = useRef(null);
      const previousShowSearch = useRef(showSearch);
      useEffect(() => {
        const changedSearchMode = previousShowSearch.current !== showSearch;
        previousShowSearch.current = showSearch;
        const intent = paneFocus.current ?? (changedSearchMode && pane === 'model' ? 'drill' : null);
        paneFocus.current = null;
        if (!open || intent === null) return;
        if (intent === 'drill') {
          if (pane === 'model' && showSearch) {
            searchRef.current?.focus();
            return;
          }
          const checked = menuRef.current?.querySelector(
            '[role="menuitemradio"][aria-checked="true"]:not([disabled])',
          );
          const target = checked ?? menuItems().find((item) => !item.disabled);
          (target ?? triggerRef.current)?.focus();
          return;
        }
        const cellMap = { agent: 0, model: 1, effort: 2 };
        const idx = cellMap[intent] ?? 0;
        const cell = menuItems()[idx];
        (cell && !cell.disabled ? cell : triggerRef.current)?.focus();
      }, [open, pane, showSearch]);

      useEffect(() => {
        const viewport = groupsRef.current;
        if (!viewport) return undefined;
        return observeStickyMenuGroups(viewport);
      }, [available, open, pane, filteredGroups]);

      useLayoutEffect(() => {
        if (open && pane === 'model' && activeModelIndex >= 0) {
          itemRefs.current[activeModelIndex]?.scrollIntoView?.({ block: 'nearest' });
        }
      }, [open, pane, activeModelIndex, visibleModels]);

      useLayoutEffect(() => {
        if (!available || !mounted) {
          setMenuPos(null);
          return undefined;
        }
        if (!open) return undefined;
        const place = () => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const MARGIN = 12;
          const lw = menuRef.current?.offsetWidth ?? 0;
          const lh = menuRef.current?.offsetHeight ?? 0;
          let x = rect.right - lw;
          let y = rect.top - 8 - lh;
          if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
          if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
          setMenuPos({ left: x, top: y });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        const menu = menuRef.current;
        const observer = typeof ResizeObserver !== 'undefined' && menu ? new ResizeObserver(place) : null;
        if (menu) observer?.observe(menu);
        return () => {
          observer?.disconnect();
          window.removeEventListener('scroll', place, true);
          window.removeEventListener('resize', place);
        };
      }, [available, mounted, open, pane, state, query]);

      if (!available) return null;

      const close = (restoreFocus = false) => {
        setOpen(false);
        if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
      };

      const closeAfterSelection = () => {
        setSelectionFocus(true);
        close(true);
      };

      const show = () => {
        setSelectionFocus(false);
        triggerRef.current?.focus();
        setQuery('');
        setHighlightedIndex(null);
        setPane('root');
        setOpen(true);
        reload();
      };

      const drill = (nextPane) => {
        setQuery('');
        setHighlightedIndex(null);
        paneFocus.current = 'drill';
        setPane(nextPane);
      };

      const back = (fromPane) => {
        paneFocus.current = fromPane;
        setPane('root');
      };

      const moveFocus = (offset) => {
        const items = menuItems();
        if (items.length === 0) return;
        const active = items.findIndex((item) => item === document.activeElement);
        const next =
          active === -1
            ? offset > 0
              ? 0
              : items.length - 1
            : (active + offset + items.length) % items.length;
        items[next]?.focus();
      };

      const announceFailure = (error) => {
        toastSeq.current += 1;
        setToast({
          seq: toastSeq.current,
          text:
            error?.code === 'session/writer-held'
              ? t('error.sessionInUse')
              : t('error.action', { message: `${error?.code || 'error'}: ${error?.message || String(error)}` }),
        });
      };

      const submitSelection = (selection, keepOpenInRoot = false) => {
        lastActionRef.current = 'select';
        if (!keepOpenInRoot) {
          setSelectionFocus(true);
          triggerRef.current?.focus();
          closeAfterSelection();
        }
        void select(selection).then(
          (result) => {
            if (!result) return;
            if (result.ok) {
              if (keepOpenInRoot) {
                back('agent');
              } else if (rootRef.current !== null) {
                closeAfterSelection();
              }
              return;
            }
            announceFailure(result.error);
          },
          (err) => announceFailure(err),
        );
      };

      const chooseAgent = (targetAgent) => {
        if (targetAgent.id === activeAgent?.id) {
          back('agent');
          return;
        }
        const firstGroup = targetAgent.groups?.[0];
        const firstModel = firstGroup?.models?.[0];
        if (firstGroup && firstModel) {
          const selection = {
            provider: firstGroup.id,
            model: firstModel.id,
            ...(firstModel.reasoning?.defaultEffort === undefined
              ? {}
              : { reasoningEffort: firstModel.reasoning.defaultEffort }),
          };
          submitSelection(selection, true);
        } else {
          back('agent');
        }
      };

      const chooseModel = (selection) => {
        if (
          state.current?.provider === selection.provider
          && state.current?.model === selection.model
        ) {
          closeAfterSelection();
          return;
        }
        submitSelection(selection, false);
      };

      const chooseEffort = (effort) => {
        if (!state.current) return;
        if (effectiveEffort === effort) {
          closeAfterSelection();
          return;
        }
        submitSelection(
          {
            provider: state.current.provider,
            model: state.current.model,
            ...(effort === undefined ? {} : { reasoningEffort: effort }),
          },
          false,
        );
      };

      const onRootKeyDown = (event) => {
        if (event.nativeEvent?.isComposing) return;
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          if (pane !== 'root') back(pane);
          else close(true);
          return;
        }
        if (!open) return;
        if (pane === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          if (!busy && visibleModels.length > 0) {
            const dir = event.key === 'ArrowDown' ? 1 : -1;
            setHighlightedIndex((activeModelIndex + dir + visibleModels.length) % visibleModels.length);
            searchRef.current?.focus();
          }
          return;
        }
        if (
          pane === 'model'
          && showSearch
          && event.target instanceof HTMLInputElement
          && (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey))
        ) {
          if (event.key === 'Tab' && visibleModels.length === 0) return;
          event.preventDefault();
          const highlighted = visibleModels[activeModelIndex];
          if (!busy && highlighted) chooseModel(highlighted);
          return;
        }
        if (event.key === 'Tab') {
          if (event.shiftKey) {
            event.preventDefault();
            if (pane !== 'root') back(pane);
            else close(true);
            return;
          }
          const focused = document.activeElement;
          const rows = menuItems();
          if (focused && rows.includes(focused)) {
            event.preventDefault();
            focused.click();
            return;
          }
          if (focused !== triggerRef.current) return;
          event.preventDefault();
          if (pane === 'model' && showSearch) {
            setHighlightedIndex(null);
            searchRef.current?.focus();
            return;
          }
          const checked = menuRef.current?.querySelector(
            '[role="menuitemradio"][aria-checked="true"]:not([disabled])',
          );
          (checked ?? rows.find((item) => !item.disabled))?.focus();
          return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        }
      };

      const onRootBlur = (event) => {
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[data-dsh-toast]') !== null) {
          return;
        }
        if (
          event.relatedTarget
          && (rootRef.current?.contains(event.relatedTarget) === true
            || menuRef.current?.contains(event.relatedTarget) === true)
        ) {
          return;
        }
        close();
      };

      const waiting = state.current === null && state.status === 'loading';
      const modelLabel = waiting
        ? t('trigger.loading')
        : currentChoice?.model?.name
          ?? (state.current === null
            ? t('trigger.fallback')
            : `${state.current.provider}/${state.current.model}`);
      const isExternalAgent = Boolean(activeAgent?.isExternal);
      const triggerTitle = isExternalAgent
        ? `${activeAgent.name} · ${modelLabel}${effortLabel ? ` · ${effortLabel}` : ''}`
        : effortLabel
          ? `${modelLabel} · ${effortLabel}`
          : modelLabel;
      const triggerAria = waiting
        ? t('trigger.loading')
        : state.current === null
          ? t('trigger.selectAria')
          : isExternalAgent
            ? effortLabel === undefined
              ? t('trigger.ariaAgent', { agent: activeAgent.name, model: modelLabel })
              : t('trigger.ariaAgentEffort', {
                  agent: activeAgent.name,
                  model: modelLabel,
                  effort: effortLabel,
                })
            : effortLabel === undefined
              ? t('trigger.aria', { model: modelLabel })
              : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel });

      let modelRowIdx = 0;

      return h(
        'div',
        {
          ref: rootRef,
          className: 'dsh-acp-ms-root',
          onKeyDown: onRootKeyDown,
          onBlur: onRootBlur,
          onMouseDown: (event) => {
            if (event.target instanceof Element && event.target.closest('button') !== null) {
              event.preventDefault();
            }
          },
        },
        h(
          'button',
          {
            ref: triggerRef,
            type: 'button',
            className: 'dsh-acp-ms-trigger',
            'aria-label': triggerAria,
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            'aria-controls': open ? `${id}-menu` : undefined,
            title: triggerTitle,
            'aria-busy': busy || waiting,
            'data-selection-focus': selectionFocus ? '' : undefined,
            onBlur: () => setSelectionFocus(false),
            disabled: locked,
            onClick: () => {
              if (open) close(true);
              else show();
            },
          },
          h(IconDataOutlineRegular, { className: 'dsh-acp-ms-trigger-icon', size: 16 }),
          isExternalAgent
            ? h('span', { className: 'dsh-acp-ms-trigger-agent' }, activeAgent.name)
            : null,
          state.current === null
            ? h(
                'span',
                { className: 'dsh-acp-ms-trigger-label dsh-acp-ms-initial-label' },
                h('span', { className: 'dsh-acp-ms-initial-reserve', 'aria-hidden': true }, t('trigger.fallback')),
                h('span', { className: 'dsh-acp-ms-initial-reserve', 'aria-hidden': true }, t('trigger.loading')),
                h(FlipText, { className: 'dsh-acp-ms-initial-caption', text: modelLabel }),
              )
            : h(FlipText, { className: 'dsh-acp-ms-trigger-label', text: modelLabel }),
          effortLabel !== undefined
            ? h(FlipText, { className: 'dsh-acp-ms-trigger-effort', text: effortLabel })
            : null,
          busy || waiting
            ? h(StateDot, { state: 'ongoing', size: 16 })
            : h(IconChevronDownOutlineRegular, {
                className: `dsh-acp-ms-chevron${open ? ' dsh-acp-ms-chevron-open' : ''}`,
              }),
        ),
        mounted
          && createPortal(
            h(
              MenuSurface,
              {
                ref: menuRef,
                id: `${id}-menu`,
                className: 'dsh-acp-ms-menu',
                style: menuPos ?? MEASURE_STYLE,
                role: pane === 'model' ? 'group' : 'menu',
                'aria-label': t('menu.aria'),
                'aria-busy': state.status === 'loading' || busy,
                'data-dsh-motion': 'popover',
                'data-state': motionState,
                'aria-hidden': open ? undefined : true,
                ...(open ? {} : { inert: '' }),
              },
              pane === 'root'
                && h(
                  Fragment,
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      className: 'dsh-acp-ms-cell',
                      'data-dsh-ms-row': 'agent',
                      onClick: () => drill('agent'),
                    },
                    h('span', { className: 'dsh-acp-ms-cell-label' }, t('menu.agent')),
                    h('span', { className: 'dsh-acp-ms-cell-value' }, activeAgent?.name || t('agent.defaultName')),
                    h(IconChevronRightOutlineRegular, { className: 'dsh-acp-ms-cell-chevron' }),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      className: 'dsh-acp-ms-cell',
                      'data-dsh-ms-row': 'model',
                      onClick: () => drill('model'),
                    },
                    h('span', { className: 'dsh-acp-ms-cell-label' }, t('menu.model')),
                    h('span', { className: 'dsh-acp-ms-cell-value' }, modelLabel),
                    h(IconChevronRightOutlineRegular, { className: 'dsh-acp-ms-cell-chevron' }),
                  ),
                  reasoning !== undefined
                    && h(
                      'button',
                      {
                        type: 'button',
                        role: 'menuitem',
                        className: 'dsh-acp-ms-cell',
                        'data-dsh-ms-row': 'effort',
                        onClick: () => drill('effort'),
                      },
                      h('span', { className: 'dsh-acp-ms-cell-label' }, t('menu.effort')),
                      h('span', { className: 'dsh-acp-ms-cell-value' }, effortLabel),
                      h(IconChevronRightOutlineRegular, { className: 'dsh-acp-ms-cell-chevron' }),
                    ),
                ),
              pane === 'agent'
                && h(
                  'div',
                  { className: 'dsh-acp-ms-groups scrollable' },
                  agents.map((agent) => {
                    const selected = agent.id === activeAgent?.id;
                    return h(
                      'button',
                      {
                        key: agent.id,
                        type: 'button',
                        role: 'menuitemradio',
                        'aria-checked': selected,
                        disabled: busy,
                        className: 'dsh-acp-ms-option',
                        onClick: () => chooseAgent(agent),
                      },
                      h(
                        'span',
                        { className: 'dsh-acp-ms-option-copy' },
                        h('span', { className: 'dsh-acp-ms-option-name' }, agent.name),
                        h('span', { className: 'dsh-acp-ms-option-sub' }, agent.badge),
                      ),
                      h(
                        'span',
                        { className: 'dsh-acp-ms-check', 'aria-hidden': true },
                        selected ? h(IconCheckOutlineRegular) : null,
                      ),
                    );
                  }),
                  h('div', { className: 'dsh-acp-ms-divider' }),
                  h(
                    'button',
                    {
                      type: 'button',
                      role: 'menuitem',
                      className: 'dsh-acp-ms-option',
                      onClick: () => {
                        close(false);
                        openAgentSettings?.();
                      },
                    },
                    h(IconSettingsOutline16, { size: 14 }),
                    h(
                      'span',
                      { className: 'dsh-acp-ms-option-copy' },
                      h('span', { className: 'dsh-acp-ms-option-name' }, t('menu.manageAgents')),
                    ),
                  ),
                ),
              pane === 'model'
                && h(
                  Fragment,
                  null,
                  showSearch
                    ? h(
                        'div',
                        { className: 'dsh-acp-ms-search-row' },
                        h(Input, {
                          ref: searchRef,
                          className: `dsh-acp-ms-search${query !== '' ? ' dsh-acp-ms-search-with-query' : ''}`,
                          type: 'text',
                          role: 'searchbox',
                          'aria-label': t('search.placeholder'),
                          'aria-controls': `${id}-models`,
                          'aria-activedescendant':
                            activeModelIndex < 0 ? undefined : `${id}-model-${activeModelIndex}`,
                          placeholder: t('search.placeholder'),
                          value: query,
                          readOnly: busy,
                          onChange: (e) => {
                            setQuery(e.target.value);
                            setHighlightedIndex(0);
                          },
                        }),
                        query !== ''
                          ? h(
                              'button',
                              {
                                type: 'button',
                                className: 'dsh-acp-ms-search-clear',
                                'aria-label': t('search.clear'),
                                disabled: busy,
                                onClick: () => {
                                  setQuery('');
                                  setHighlightedIndex(0);
                                  searchRef.current?.focus();
                                },
                              },
                              h(IconCloseFillRegular),
                            )
                          : null,
                      )
                    : null,
                  h(
                    'div',
                    {
                      ref: groupsRef,
                      id: `${id}-models`,
                      className: 'dsh-acp-ms-groups scrollable',
                      role: 'menu',
                      'aria-label': t('menu.model'),
                      hidden: filteredGroups.length === 0,
                    },
                    filteredGroups.map((group) =>
                      h(
                        MenuGroup,
                        { key: group.id, label: group.provider?.name || group.name },
                        group.models.map((model) => {
                          const idx = modelRowIdx++;
                          const selected =
                            state.current?.provider === group.id
                            && state.current?.model === model.id;
                          const selectingThis =
                            state.pending?.provider === group.id
                            && state.pending?.model === model.id;
                          const selection = {
                            provider: group.id,
                            model: model.id,
                            ...(model.reasoning?.defaultEffort === undefined
                              ? {}
                              : {
                                  reasoningEffort:
                                    selected
                                      ? state.current?.reasoningEffort ?? model.reasoning.defaultEffort
                                      : model.reasoning.defaultEffort,
                                }),
                          };
                          return h(
                            'button',
                            {
                              ref: (node) => {
                                itemRefs.current[idx] = node;
                              },
                              key: `${group.id}/${model.id}`,
                              id: `${id}-model-${idx}`,
                              type: 'button',
                              role: 'menuitemradio',
                              'aria-checked': selected,
                              tabIndex: showSearch ? -1 : 0,
                              'data-active': idx === activeModelIndex ? 'true' : undefined,
                              disabled: busy,
                              className: 'dsh-acp-ms-option',
                              title: model.name,
                              onFocus: () => setHighlightedIndex(idx),
                              onMouseMove:
                                busy || idx === activeModelIndex
                                  ? undefined
                                  : () => {
                                      if (showSearch) setHighlightedIndex(idx);
                                      else itemRefs.current[idx]?.focus();
                                    },
                              onClick: () => chooseModel(selection),
                            },
                            h(
                              'span',
                              { className: 'dsh-acp-ms-option-copy' },
                              h('span', { className: 'dsh-acp-ms-option-name' }, model.name),
                            ),
                            h(
                              'span',
                              { className: 'dsh-acp-ms-check', 'aria-hidden': true },
                              selectingThis
                                ? h(StateDot, { state: 'ongoing', size: 14 })
                                : selected
                                  ? h(IconCheckOutlineRegular)
                                  : null,
                            ),
                          );
                        }),
                      ),
                    ),
                  ),
                  state.status === 'ready' && filteredGroups.length === 0
                    ? h(
                        'div',
                        { className: 'dsh-acp-ms-empty', role: 'status' },
                        t(agentChoices.length === 0 ? 'empty.models' : 'search.empty'),
                      )
                    : null,
                ),
              pane === 'effort'
                && h(
                  'div',
                  { className: 'dsh-acp-ms-groups scrollable' },
                  effortChoices.length === 0
                    ? h('div', { className: 'dsh-acp-ms-empty' }, t('empty.efforts'))
                    : effortChoices.map((choice) => {
                        const selected = effectiveEffort === choice.effort;
                        const selectingEffort =
                          state.pending !== null
                          && state.pending.provider === state.current?.provider
                          && state.pending.model === state.current?.model
                          && state.pending.reasoningEffort === choice.effort;
                        return h(
                          'button',
                          {
                            key: choice.key,
                            type: 'button',
                            role: 'menuitemradio',
                            'aria-checked': selected,
                            disabled: busy,
                            className: 'dsh-acp-ms-option',
                            onClick: () => chooseEffort(choice.effort),
                          },
                          h(
                            'span',
                            { className: 'dsh-acp-ms-option-copy' },
                            h('span', { className: 'dsh-acp-ms-option-name' }, choice.label),
                          ),
                          h(
                            'span',
                            { className: 'dsh-acp-ms-check', 'aria-hidden': true },
                            selectingEffort
                              ? h(StateDot, { state: 'ongoing', size: 14 })
                              : selected
                                ? h(IconCheckOutlineRegular)
                                : null,
                          ),
                        );
                      }),
                ),
            ),
            document.body,
          ),
        toast
          && h(Toast, {
            key: toast.seq,
            text: toast.text,
            icon: IconWarningOutlineRegular ? h(IconWarningOutlineRegular) : undefined,
            holdMs: toast.catalog === true ? null : undefined,
            dismissLabel: t('modal.close'),
            actions: toast.catalog === true ? [{ label: t('action.reload'), onClick: reload }] : undefined,
            anchor: rootRef.current?.closest?.('[data-composer-card]') ?? null,
            onDone: () => setToast(null),
          }),
      );
    }

    function apply(ctx) {
      injectCss();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-acp-agents: dictionaries');
      const t = ctx.locale.bind(NS);
      const connection = ctx.connection ?? ctx.get?.('connection');
      const settingsNavigation = ctx.settingsNavigation ?? ctx.get?.('settingsNavigation');

      const rpc = async (endpoint, input = {}) =>
        rpcValue(await connection.rpc.call('/dsh-acp-agents', endpoint, input));

      const openAgentSettings = () => {
        try {
          const nav = ctx.settingsNavigation ?? ctx.get?.('settingsNavigation');
          nav?.open?.(SETTINGS_SECTION_ID);
        } catch {
          // ignore
        }
      };

      // 1. Register Settings -> Agent row (`settings.section` with id 'acp-agents').
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: SETTINGS_SECTION_ID,
            order: 12,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ rpc, t, settingsNavigation }),
          },
          AgentsSettingsSection,
        ),
      );

      // 2. Shadow `conversation.input.model` at priority -10 so the composer
      // model picker shows Agent -> Model -> Effort just like T3 Code.
      ctx.inject(['slots', 'modelDirectories', 'sessions'], (scope) => {
        const models = scope.modelDirectories;
        const sessions = scope.sessions;
        scope.slots.inject('conversation.input.model', () =>
          scope.slots.register(
            {
              name: 'conversation.input.model',
              priority: -10,
              locale: NS,
              inject: (sessionId) => {
                const directory = models.directoryFor(sessionId);
                const available = sessions.subagentAddress(sessionId) === undefined;
                return {
                  available,
                  directory: directory.store,
                  load: () => {
                    if (available) {
                      directory.load().catch(() => {});
                    }
                  },
                  select: (selection) =>
                    available ? directory.select(selection) : Promise.resolve(undefined),
                  openAgentSettings,
                  t,
                };
              },
            },
            AgentModelSelect,
          ),
        );
      });
    }

    exports.name = NS;
    exports.inject = ['slots', 'locale', 'connection', 'settingsNavigation'];
    exports.apply = apply;
    return module.exports;
  },
});
