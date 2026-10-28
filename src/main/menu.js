const { Menu, shell, app } = require('electron');
const { openHarnessSettings, openMarketplace } = require('./window');
const { loadConfig } = require('./config');

function buildMenu({ onOpenWorkspace, onOpenLauncher, onRestart, onReload, shortcuts }) {
  // Commands with a registry owner dispatch by command id so the accepted
  // configuration, modal policy, and revision checks all apply; their menu
  // keycaps mirror the effective binding and refresh on config change.
  const commandItem = (id, fallbackAccelerator, fallbackClick) => {
    // Once a config revision is accepted the registry binding is the only
    // keycap — an unbound command shows none. Before the first snapshot
    // (loading/unreadable) the shipped default keeps the menu usable.
    const resolved = shortcuts?.currentRevision?.() !== undefined
      ? shortcuts.acceleratorFor(id) : fallbackAccelerator;
    return {
      ...(resolved ? { accelerator: resolved } : {}),
      click: () => { if (!shortcuts?.dispatchMenuCommand(id)) fallbackClick(); },
    };
  };
  const isMac = process.platform === 'darwin';
  const settingsItem = {
    label: '设置…',
    ...commandItem('settings.open', 'CmdOrCtrl+,', () => { openHarnessSettings(); }),
  };

  const template = [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: 'about', label: `关于 ${app.name}` },
          { type: 'separator' },
          settingsItem,
          { type: 'separator' },
          { role: 'services', label: '服务' },
          { type: 'separator' },
          { role: 'hide', label: `隐藏 ${app.name}` },
          { role: 'hideOthers', label: '隐藏其他应用' },
          { role: 'unhide', label: '全部显示' },
          { type: 'separator' },
          { role: 'quit', label: `退出 ${app.name}` },
        ],
      }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开工作区…',
          ...commandItem('workspace.add', 'CmdOrCtrl+O', onOpenWorkspace),
        },
        {
          label: '打开启动器',
          click: () => onOpenLauncher && onOpenLauncher(),
        },
        {
          label: isMac ? '在 Finder 中打开工作区' : '在资源管理器中打开工作区',
          click: () => {
            const { workspace } = loadConfig();
            if (workspace) {
              shell.openPath(workspace);
            }
          },
        },
        { type: 'separator' },
        ...(!isMac ? [settingsItem] : []),
        {
          label: '插件市场…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => { openMarketplace(); },
        },
        {
          label: 'MCP…',
          click: () => { openHarnessSettings('mcp'); },
        },
        {
          label: '技能…',
          click: () => { openHarnessSettings('skills'); },
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    ...(isMac ? [{ role: 'editMenu', label: '编辑' }] : []),
    {
      label: '运行',
      submenu: [
        {
          label: '重启 Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => onRestart(),
        },
        {
          // Ctrl+R is the registry's page.refresh on desktop; window reload
          // moves to F5 so one chord never has two owners.
          label: '重新加载界面',
          accelerator: 'CmdOrCtrl+F5',
          click: () => onReload(),
        },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    ...(isMac ? [{
      role: 'windowMenu',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' },
      ],
    }] : []),
    {
      label: '帮助',
      submenu: [
        {
          label: 'Web UI 指南',
          click: () => shell.openExternal('https://deepseek-harness.github.io/deepseek-harness/guide/'),
        },
        {
          label: 'Python SDK',
          click: () => shell.openExternal('https://deepseek-harness.github.io/deepseek-harness/guide/python-sdk'),
        },
        { type: 'separator' },
        {
          label: '关于',
          click: () => { openHarnessSettings('about'); },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (isMac) {
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: '打开工作区…', click: () => onOpenWorkspace() },
      { label: '打开启动器', click: () => onOpenLauncher && onOpenLauncher() },
    ]));
  }
}

module.exports = { buildMenu };
