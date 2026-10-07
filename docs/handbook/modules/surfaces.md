# 模块：Surfaces 工作环

## 职责与非目标

**职责：** DSHD 单一右栏上的 Files / Terminal / Browser / Diff / Agents ——可搜索、导航、选区进对话的工作环。
**非目标：** 不做空态「功能卡片墙」，不保留第二套可见右栏；不做 GPU 终端嵌入、worktree、turn-diff、review-comment pick（见 work-loops note 范围外）。

## 用户路径

1. `Ctrl+\` 打开右栏。  
2. 对话文件提及、工具行和产物芯片通过 `workspaces.openPath` 进入发起 Session 的 DSHD 工作环；交付卡片和收尾正文中的产出文件芯片先进入聊天区悬浮预览。HTML / HTM / XHTML / PDF 复用桌面 token URL 与 Browser guest；Markdown、文本、图片及其他文件复用已有 Sidebar 文件查看器与 DockKit 浮动面板，保留原文件身份、编辑与保存状态。悬浮预览不展开右栏，点击浮层的返回右栏按钮才展开；普通文件提及和工具路径仍在右栏打开，工作区根目录打开 Files。缺 cwd 或不在工作区内的路径交回 Host 打开。
3. Files：从唯一的「文件」目录入口搜文件、打开具体文件预览、Mention / 加入对话；文件预览头部的“独立窗口预览”按钮把当前**已保存**文件送入单实例置顶只读原生窗口。点击对话引用不会直接创建原生窗口。
4. Browser：URL 导航、可选截图 / PiP / 录制；交付卡片中的浏览器文档先浮在聊天区，浮层“在右侧栏打开”再展开 Browser 右栏。右栏 Browser 工具栏仍可将预览移回聊天区，来回切换保留 URL / history。
5. Tab 关闭在标题右侧。栏内分栏、全屏和收起按钮隐藏；标题栏按钮与快捷键仍可开合右栏。

## 架构要点

- UI 在 harness client；Browser 与独立窗口文件预览栈在 main `preview.js` 及 `preview-*`。独立文件窗复用 `preview-workspace.js` 的工作区 token URL，主进程使用 preview 专属的 `allowScratchCwd` authority + 有界只读适配器，不复制 Files 的编辑 / 保存状态。
- DSHD 只有一个全高右栏，guide 与内容由 `ui-sidebar-right` 的同一份页签状态承载；`ui-surfaces` 仅适配文件/预览打开请求，不再挂载独立栏体。点卡原位开页、末页关闭原位回到 guide，栏宽和聊天区保持连续。页签关闭控件保留在标题右侧，DockKit 用 flex 交叉轴居中共享标题的实际盒中心；桌面覆盖页签为 24px 高时仍沿用该布局，不继承通用 28px 页签的固定顶部位置。
- 右栏展开会减少会话标题行的实际内容宽度；`ConversationRoot.module.css` 在扣除 AppFrame 尾簇预留后的标题行上做局部容器查询，文字保持单行并按空间省略，窄到 520px 时子智能体、团队与后台任务入口只显示图标，保留点击、完整名称提示与运行状态。AppFrame 对尾簇的实测小数宽度向上取整，保留打开方式与尾簇至少 8px 间距。整列宽度决定的尾簇密度不改，以免测量宽度反馈振荡。几何验收用 `node scripts/verify-titlebar-fit.mjs` 连到带 CDP 端口的源码 Electron 普通工作区会话。
- 无页签时使用 DSHD 原有的居中两列方形入口；终端入口选择 shell。
- Files 由原生 Sidebar 的 `files` / `desktop-file` 类型承载。文件主体 `keepMounted`，树与搜索携带所属 Session 经 `workspaces.openPath`，HTML/PDF 保持 Files 与 Browser 打开链。插件内 `DesktopFileState` 按 Session 资源地址逐次持久化脏草稿，接管关闭/替换确认；`FileSaveCoordinator` 保留串行保存，确认中的保存失败或新增输入不会关闭页签。Sidebar 的一次性 `proceed()` 回调只提交原 occurrence 的移除，过期确认保留恢复页签的草稿。
- `files` 提供唯一目录 guide，`desktop-file` 只在打开具体文件时使用。旧查看器的 `sidebar://` 等无文件地址不进入编辑器或文件读取；标准 Files 目录主体与本地化标题原位兼容呈现，Session 来自槽位标准 share。没有替换或持久布局重写，pane、展开与浮窗状态不变；有效文件和草稿保留原身份。理由见 [Files 地址恢复](../../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。
- Browser 悬浮预览复用同一原生 guest。顶部 28px 窄条展示文件名与右栏、关闭按钮；网页视口从其下方铺满。由于 BrowserView 会盖住网页矩形内的 renderer 事件，四边与四角缩放命中区放在该矩形外侧，使用 pointer capture 并由几何函数限制在聊天可视区。
- Feature card：[../../features/surfaces-work-loops.md](../../features/surfaces-work-loops.md)

## 实现入口

- Main：`preview.js`、`preview-file-window.js`、`preview-session.js`、`preview-workspace.js`、`preview-url.js` 等
- Renderer：`src/renderer/file-preview.*`；窄 preload：`src/preload/file-preview.js`
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`

## 不变量

- 工作区授权使用原生物理路径，与异步文件读写一致；Windows 短名和 macOS 路径别名不扩大或缩小已授权边界，外链与 `.git` 仍被拒绝。
- 工作环，不是空态卡片网格。  
- 关闭控件在标题右侧。  
- 工作区文件的主点击统一经过 `workspaces.openPath`；Chat 显式携带发起 Session，桌面接管层使用该 Session 的真实 cwd，在 DSHD 页签内打开文件与 Browser。缺 cwd 或无法接管的路径交给 Host。
- Files 根目录 `listDir` 未完成时显示列出中，不把空 `root` 画成「此目录为空。」
- 文件草稿在刷新或退出后仍可恢复；切页保留防抖保存。添加到对话追加路径、行范围和围栏原文；文件提及的链接序列化只用于 Mention。工作区预览 URL 按路径段编码，文件名里的 `#`、`?`、`%` 等字符不改变 URL 结构。
- 独立文件窗单实例、只读、置顶；文件预览头部的 Desktop 动作使用 `{cwd, relativePath}` 或 `{absolutePath}`。成功要求 `ok === true`，失败必须可见，绝不回落到系统打开器 / `workspaces.openPath` / Browser tab。HTML sandbox，文件 URL 仍受 workspace authority 与大小上限约束。

## 门槛

- QA：`TC-SURF-001` … `TC-SURF-007`

## 延伸阅读

- [../superpowers/specs/2026-08-19-files-browser-logic-port-design.md](../../superpowers/specs/2026-08-19-files-browser-logic-port-design.md)
- [terminal.md](terminal.md)
