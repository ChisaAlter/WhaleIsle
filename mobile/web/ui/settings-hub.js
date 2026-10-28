// 设置 Hub 分组与 pane 路由。镜像 Android DshScreens.kt SettingsHub / SettingsOverlay 的分组表。

function channelLabel(origin) {
  return /^https/i.test(String(origin || '')) ? 'HTTPS 中继' : '局域网 :3180';
}

// 镜像 DshViewModel.gitStatusLine()。
function gitStatusLine(status) {
  const parts = [];
  if (status?.hasWorkingTreeChanges) parts.push('有未提交改动');
  if (status?.aheadCount > 0) parts.push(`领先 ${status.aheadCount}`);
  if (status?.behindCount > 0) parts.push(`落后 ${status.behindCount}`);
  if (status?.pr?.state === 'open' && status.pr.number != null) parts.push(`PR #${status.pr.number}`);
  if (!parts.length) parts.push('已与上游同步');
  return `${status?.refName ?? '—'} · ${parts.join(' · ')}`;
}

function schemeLabel(scheme) {
  if (scheme === 'dark') return '深色';
  if (scheme === 'light') return '浅色';
  return '跟随系统';
}

function schemeIsDark(scheme, systemDark) {
  if (scheme === 'dark') return true;
  if (scheme === 'light') return false;
  return systemDark === true;
}

// 镜像 Android HostRequestPane 的 pane → openSettings sectionId 映射。
function hostSettingsSection(pane) {
  switch (pane) {
    case 'MCP': return 'mcp';
    case '技能': return 'skills';
    case '插件': return 'plugins';
    case '市场': return 'market';
    default: return '';
  }
}

// 设置首页分组（与 Android 完整设置的分区对应）。每一行都通向可用页面：
// 手机偏好只存本机，MCP / 技能 / 插件调用已配对 Host 的正式管理服务。
function settingsGroups({ channel, accessMode, gitLine, scheme, usage } = {}) {
  return [
    {
      label: '这次连接',
      rows: [
        { pane: '连接详情', desc: channel || '' },
        { pane: '断开这台设备', desc: '退出并清除本机登录', danger: true, action: 'logout' },
      ],
    },
    {
      label: '当前会话',
      rows: [
        { pane: '权限', desc: accessMode || '由提供方决定' },
        { pane: '模型', desc: '当前会话' },
        { pane: '会话用量', desc: usage || '当前会话' },
      ],
    },
    {
      label: '工作区',
      rows: [
        { pane: '工作区', desc: gitLine || '' },
        { pane: '文件', desc: '浏览 · 预览 · 插入路径' },
      ],
    },
    {
      label: '这台手机',
      rows: [
        { pane: '外观', desc: schemeLabel(scheme) },
        { pane: '阅读与输入', desc: '字号 · 思考过程 · Enter 发送' },
      ],
    },
    {
      label: '电脑',
      rows: [
        { pane: 'MCP', desc: '服务器状态 · 启用 · 测试' },
        { pane: '技能', desc: '查看 · 调用开关' },
        { pane: '插件', desc: '插件包与插件启停' },
      ],
    },
    {
      label: '关于',
      rows: [{ pane: '关于', desc: 'Whale Isle' }],
    },
  ];
}

export { channelLabel, gitStatusLine, schemeLabel, schemeIsDark, hostSettingsSection, settingsGroups };
