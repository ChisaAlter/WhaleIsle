# @deepseek-ai/dsh-client-ui-files

[English](README.md) | 中文

桌面 Files 树与编辑器注册原生 Sidebar 的 `files`、`desktop-file` 页签类型，主体位于 keyed `sidebar.right.pane.tab` 槽位。树和搜索主点击携带所属 Session 及其 cwd 进入 `workspaces.openPath`，HTML/PDF 同样走共享的 Files 与 Browser 打开链。旧 `surfaces.files`、`surfaces.file` 注册保留为兼容座位。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.zh.md)。

guide 只提供一个「文件」目录入口，`desktop-file` 编辑器由具体 Session 文件资源打开。旧无文件、内部 Sidebar、absolute、畸形与空根地址不挂载编辑器、不执行文件读取；主体复用标准 Files 目录面板，标题显示本地化 Files，所属 Session 取槽位标准 share。没有替换或持久布局迁移，页签记录、pane、展开与浮窗状态不变。有效文件地址、页签身份、缺 cwd 时的草稿与保存队列不变。

工作区根是所属 Session 的 `cwd`，经 `useSessions` 读取。目录与文件字节来自桌面 `window.shell` 的 `listDir`／`readFile`／`readFileMedia`／`writeFile`；渲染进程不加载 Node。目录按需展开，树顶可以按文件名搜索（工作区根下无上限 DFS；完整路径的选择器行打开文件）。在输入框键入 `@` 走官方 ui-reference，不是 Files 的 path 菜单。提及是行内控件写入输入框（markdown 文件链接），没有 session id 时不展示；文件树行可拖进输入框，载荷同样是该 markdown 链接（`application/x-dshd-composer-mention`）。技能走官方 `/`（ui-skill）。根目录列出未完成时显示列出中，不画空目录。刷新会重载根目录；搜索进行中时会重新走搜索，不会丢掉嵌套匹配。右键可在文件夹中显示、用已探测到的编辑器打开，或用系统默认程序打开。右键复制相对或绝对路径。图片以 data URL 渲染；桌面 preload 提供 `previewOpenFileWindow` 时，预览工具栏还可把当前文件打开到壳层的单实例只读置顶窗；该窗口从磁盘读取工作区文件，不共享此编辑器的脏缓冲区或保存队列。未超出 1 MiB 读取上限的文本可编辑保存（写入上限同样 1 MiB）；保存失败时编辑器和未保存缓冲区仍在，错误显示在上方。Tab 变为活动时 FilePreview 会重读磁盘。脏草稿在重读失败、返回截断或二进制、或当时没有 cwd 时仍留在编辑器（含 Markdown 源码）；只要有 cwd 就可以保存，写入成功后清除截断／二进制标记。保存会先重读；若磁盘相对基线和草稿都已变化，则保留草稿并显示 `error.changed`，再次保存才覆盖。Files 所有者把未保存草稿写入 localStorage，刷新或退出后再打开仍能恢复。`.md` 可在源码与 `MarkdownText` 之间切换。跳行（`revealLine`／`revealRequestId`）会滚动源码 textarea，并在该次跳行未处理完时强制显示源码。源码里选中若干行后会出现「添加到对话」，把该 `L` 范围和 `text` 围栏追加到输入框；点击外部或 Escape 会收起选区。

原生 Sidebar 文件主体隐藏时保持挂载，500ms 保存队列因此跨页签和会话切换保留。Files 所有者按稳定的 Session 资源地址把每次未保存编辑写入 localStorage，刷新或退出不依赖卸载事件。关闭或替换脏文件时先同步暂停自动保存，再通过共享 Modal 提供继续编辑、丢弃、保存并关闭。已发出的写入结束前，关闭操作不可用；缓冲区若已完整保存，则直接关闭，不再要求丢弃确认。确认期间自动保存始终暂停，选择继续编辑才恢复。保存失败或保存期间新增字符会保留页签与草稿；成功保存清除持久草稿。丢弃移除已确认的草稿，不把它写入磁盘，迟到的写入完成不能重新创建它。过期关闭确认不能关闭恢复后的 occurrence，也不能丢弃它的草稿。Mac 的 Command+Shift+Z（含原生菜单转发）使用源码 textarea 的浏览器编辑历史。

`/client` 导出表层只包含插件主体（`apply`／`inject`）及约定类型；FilesPanel、FilePreview 与 FileTree 仍由 slot 注册封装在包内。

搜索先按文件名或路径子序列过滤本地文件列表，再应用结果数量上限。不匹配的文件不显示；空查询保留文件顺序。

## 模型体验

无。Files 面板只为展示读取工作区；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包（package）既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **树不改工作区结构**：没有新建、重命名、删除。

不发布运行时 invariant companion；本包不拥有独立的持久事件关系，UI 或服务行为由聚焦的包测试覆盖。
