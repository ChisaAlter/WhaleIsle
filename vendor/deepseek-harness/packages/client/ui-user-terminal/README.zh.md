# @deepseek-ai/dsh-client-ui-user-terminal

[English](README.md) | 中文

用户终端：对话列底栏（`shell.terminalDrawer`）与右边栏 Terminal surface（`surfaces.terminal`）各自坐在独立的 `createTerminalSessionStore()` handle 上，因此在一侧打开的窗格不会出现在另一侧。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

store 保存 `sessions[]`、`activeId`、每会话的 `cols`／`rows`／`buffer`，以及分屏组，上限为 `MAX_TERMINALS_PER_GROUP`（4）。`appendData` 把回放缓冲封顶在 `MAX_TERMINAL_BUFFER`，并把掐头切点在 `BUFFER_REALIGN_WINDOW` 内对齐到下一个行首或 ESC，重挂载回放不会从转义序列中间开始。桌面 PTY IPC 只挂在 `window.shell`（`ptyCreate`／`ptyWrite`／`ptyResize`／`ptyKill`／`onPtyData`／`onPtyExit`）；渲染进程不加载 Node。没有项目 cwd 时不创建 PTY。每个窗格是 `libghostty-vt` Canvas 适配（`GhosttyTerminalSurface`），不是 xterm。种子回放用 `resetAndWrite`（断开 PTY writer）。Ghostty 自己负责 fit、150 ms 的 PTY resize 防抖、粗体 canvas `font-weight: 700`，以及引擎 ANSI 色板（应用只覆盖 fg/bg/cursor/selection）。`onResize` 按 `TerminalViewport` 原样转发 Ghostty 的 fit。30 ms settle fit 只在 Ghostty 报告视口已在底部时跟随输出。活动窗格会获得焦点；在窗格上 pointerdown 会激活它，但不会把 DOM 焦点移到铬上。窗格填充是 `--dsw-alias-terminal-pane`，壁纸／渐变生效时它随玻璃滑杆向透明混色但不低于 `TERMINAL_PANE_MIN_SOLIDITY`；带 alpha 的画布把重绘区清回该 DOM 填充而不是叠第二层混色，显式 SGR 单元格背景仍画实心。画布字体来自 `--dsw-font-family-terminal`（否则 `--ds-font-family-code`），经 `terminalFontOptions` 传入。Windows PTY 启动使用 `resolveShellCandidates` 和 `createTerminalSpawnEnv`；打开默认 120×30；`name` 为 `xterm-color`。Windows 上丢掉 Electron 的 `TERM=dumb`，使 PTY 与 Windows node-pty 一致（它不会把 `name` 写进 `$TERM`）。

底栏工具条为左右分屏／上下分屏／最大化（还原记住上次高度）／新建／关闭。超过一个 PTY 时显示会话列表。选区提供复制、加入对话（terminal 围栏写入输入框；没有 session id 时禁用），以及在文本是 URL 或工作区路径时打开。⌘／Ctrl-点击激活同样的目标。loopback http(s) 打开 Browser，其它 http(s) 调用 `window.shell.openExternal`。工作区路径走 `workspaces.openPath`，并带上可选的 `{ line }`，供 FilePreview 跳行。高度拖动写入 `setTerminalDrawer`，夹在 `TERMINAL_DRAWER_MIN` ..= 视口 75%。有 cwd 时 Ctrl+` 调用 `toggleTerminalDrawer`。本包 `inject` `surfaces.terminal`，等右边栏壳声明该槽后再挂上；该 occupant 没有单独最大化。

macOS 上先处理终端自身的剪贴板、导航、删除和清屏 Command 快捷键。其余 Command 组合留给应用菜单，不向 PTY 发送按下或释放事件。物理 Control 组合仍作为终端输入。

`/client` 导出表层只包含插件主体（`apply`／`inject`）、store 工厂及约定类型；抽屉与 surface 组件仍由 slot 注册封装在包内。

## 模型体验

无。用户终端只驱动桌面 PTY IPC 与布局几何；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **右边栏壳不由本包拥有**：本包注入 `surfaces.terminal`，不声明 surfaces 列或其空态卡片。
- **最大化只属于会话底栏抽屉**：`surfaces.terminal` 没有单独的最大化控件。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
