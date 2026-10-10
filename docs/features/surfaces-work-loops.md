# Feature: Surfaces work loops

| Field | Value |
| --- | --- |
| **id** | `surfaces-work-loops` |
| **status** | `active` |
| **last verified (Files guide)** | 2026-10-01 — 真实 Guide / registry / controller / keyed body 与持久布局恢复 9/9，既有 adapter / apply 16/16；窄 lint、ui-files 类型构建与 client catalog 检查通过。唯一目录 guide、旧查看器兼容目录标题、所属 Session 与隐藏/浮窗状态、有效草稿边界通过。 |
| **last verified (tab alignment)** | 2026-10-01 — 既有 DockKit components 87/87；隔离真实 Electron 使用生产 TabStrip、DockKit / SidebarRight CSS 与主题表，通用 28px / 桌面 24px、短标题 / 窄长标题、字号 13 / 18 与缩放 100% / 150% / 200% 共 12 组，标题 / 按钮 / SVG 垂直盒中心差最大 0.006 CSS px，关闭仍在右侧；关闭 press / click 仅调用关闭 1 次、拖拽 0 次。修前桌面中心下偏 2 CSS px，截图墨迹中心差从 4.5 降为 1.5 原生像素（保留字体本身的字面分布，无固定光学偏移）。源码整包重建与运行由发布验证另行记录。 |
| **last verified (native paths)** | 2026-09-28 — b061501e5b4 的 Windows/macOS 桌面 CI 全绿，预览短名一致性与越界拒绝通过；同 SHA 安装树冒烟通过。完整生产验收未完成。 |
| **last verified (source launch)** | 2026-09-24 — `titlebar-fit.e2e.ts` 归入 host 类型检查并从 client Web 项目排除；清理失效的 TypeScript 增量记录后，`apps/web` 定向类型构建和 `npm start` 的 host/client/web 全量构建通过，源码 Electron 已启动。 |
| **last verified** | 2026-10-01 — Files 唯一目录入口与旧无文件查看器原位兼容，真实注册/恢复 9/9、adapter/apply 16/16；见 [Files guide 修复](../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。此前 2026-09-30 — Files 草稿逐次持久化、原生 Sidebar 关闭/替换确认、隐页保存生命周期、选区原文进对话与树/搜索统一 Session 打开链修复，相关单测 268/268；源码构建与实机验证见[项目审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)。 |

## User paths

最近验证：2026-09-28，预览绝对路径与 authority 同用原生 realpath；Windows 短名反例先红后绿，预览/编辑器/工作区/登记监听 200/200 通过，越界拒绝保持。

1. `Ctrl+\` 打开右栏 → 点唯一的「文件」目录入口 → Files 搜索 / 预览 / 送对话；具体文件打开编辑页签。
2. 点击对话文件提及、工具路径或产物芯片 → 发起点击的 Session 在 DSHD 工作环打开文件；交付卡片中的 HTML / HTM / XHTML / PDF 经桌面 token URL 先进入聊天区 Browser 悬浮预览，点击浮层“在右侧栏打开”后才展开右栏 Browser。其余点击在右栏打开或聚焦文件页；点工作区根目录打开 Files。缺少 cwd 的文件路径交回 Host 打开。
3. 收尾正文里的行内代码文件名与某一轮成功产出或交付的文件唯一匹配（精确路径，或唯一 basename）→ 保持代码芯片外观，点击后在发起该消息的 Session 右栏打开该文件；PTC 子调用成功写入的文件同样进入该词表。同名路径不唯一时保持不可点击。
4. Files：在文件预览头部点“独立窗口预览” → 当前已保存文件在单独的置顶只读原生窗口展示；继续打开文件会复用该窗口。
5. Browser：输入 URL、导航；可选截图 / PiP / 录制。打开菜单或 PiP 时只隐藏原生预览视图，保留它在主窗口中的挂载和当前边界；PiP 从同一个 guest 捕获真实连续帧。关闭预览时才移除视图并销毁 guest。
6. Browser：交付卡片中的浏览器文档先以悬浮预览出现在聊天区；浮层“在右侧栏打开”再展开右栏 Browser。已有 Browser 页也可点工具栏“悬浮预览（浮在聊天区）”；浮层可拖拽和缩放，移入右栏时保留当前 URL / history。
7. Diff / Agents 按当前 UI 可用。
8. Surface Tab 关闭控件在标题**右侧**。

## Invariants

- 本地 Files 搜索按文件名或路径子序列过滤后再限量；不得把未过滤的目录遍历结果当作已过滤的服务端结果。

- 桌面只有一个全高右栏容器，外观保持 DSHD，入口与所有功能共用 `sidebarRight` 的页签状态；`ui-surfaces` 只保留工作区文件和预览事件的路由适配，不再挂载独立栏体。`Ctrl+\` 与标题栏按钮读取/切换同一开合状态。后台会话打开请求只写目标 Session。
- 居中两列入口保留 320px 内宽、8px 间距和 12px 圆角，清单来自上游 guide 注册表。点击原位替换 guide，内容页签关闭键在标题右侧；关闭最后内容页签原位返回 guide，栏宽与聊天区域不变。mini 预览可挂载 Browser 而不展开右栏。
- Files guide 只提供「文件」目录入口，`desktop-file` 只承载具体 Session 文件资源。旧无文件查看器、内部 Sidebar 地址、absolute/畸形地址和空根资源不挂载编辑器、不执行文件读取；主体原位复用标准 Files 目录面板，标题显示本地化 Files，所属 Session 取槽位标准 share。页签记录、pane、expanded 与浮窗状态不变；有效文件资源、页签身份及缺 cwd 时的草稿不变，没有持久布局迁移。
- `ui-preview` 必须把 `sidebarRightTabs` 列入 `inject` 声明 —— apply 内 `ctx.get` 的时序在 apply 顺序倒置时会静默漏注册（兼容轨与 mini 呈现都要它）。
- 不做 note 标明的范围外能力：GPU 终端嵌入、worktree、turn-diff、review-comment pick（勿假装已有）。
- Tab 关闭在标题右侧，并与标题按实际页签高度垂直居中；未经用户明确要求不挪到左侧。
- 栏内分栏、全屏和收起三个按钮隐藏；保留页签新增/关闭及标题栏的右栏开合入口。
- 右栏展开后，会话标题行按扣除尾簇后的实际可用宽度收起次级 Agent 操作；头部动作与打开方式、打开方式与尾簇不能覆盖，至少留 8px。关闭右栏后自动恢复，不写持久偏好。
- 显式保存与防抖落盘走同一 `FileSaveCoordinator` 队列，保存期间敲入的字符保持未保存；搜索会话只走一次树、键击内存过滤（Refresh 重走）。
- Sidebar 文件主体隐藏时保持挂载，快速切页不取消待保存队列；每次未保存编辑按 Session 资源地址落本地草稿，刷新或退出后恢复。关闭或替换脏文件使用共享 Modal 的继续编辑 / 丢弃 / 保存并关闭；保存失败或仍有新增字符时保留页签与草稿，迟到的旧保存完成不重建已丢弃草稿，旧确认不关闭已恢复 occurrence。
- Files 树与搜索主点击携带所属 Session 经 `workspaces.openPath`；HTML/PDF 保持普通文件入口的 Files 与 Browser 双开。添加到对话直接追加选区的路径、`L` 行范围与 `text` 围栏，不按文件提及重新序列化。
- `shell:preview-automation-*` 链已删除，不得在无新卡+权限模型的情况下复活。
- browser-doc 扩展名单一事实：`{html, htm, xhtml, pdf}`（openPath 双开与 FilePreview 工具栏同集合）；SVG 按图片留在 Files。
- Files 独立窗口预览是工作区权威内的单实例只读窗口：不得绕过 `preview-workspace` token URL，不得把编辑缓冲区或保存队列迁入悬浮窗；HTML 只在 sandbox frame 中运行，图片 / 音视频 / PDF / 文本按浏览器原生只读能力展示。
- 工作区预览 URL 按路径段分别编码；文件名中的空格、`#`、`?`、`%` 等字符不能变成 URL 的片段或查询部分。
- `dshd mini-player` 只改变 Browser guest 的呈现边界：状态为 `surface | mini` 时同一 `previewId` 只能有一个 `previewShow/previewResize` owner；mini 几何限制在聊天可视区并使用 pointer capture，恢复后 URL、history、loading 状态不丢；不得创建第二个 BrowserView、外部窗口或 mini 专用 IPC。
- Browser mini 默认在聊天区右上角、距边 12px、320×200；可见标题用文件名或网址主机名，网页仅在顶部窄操作条下方留位，不留四周宽框、常驻边框或八向可见刻线。窄条采用 DSHD 语义色、主文字色与幽灵按钮，只提供右栏和关闭动作；缩放通过网页矩形外侧的四边与四角透明命中区发起，以免原生 BrowserView 吞掉 renderer 指针事件。
- Browser guest 的右栏与聊天区浮层交接不发离任表面的延迟 `previewHide`，避免它覆盖新表面的 `previewShow`；从浮层恢复后 guest 尺寸跟随右栏当前 host 边界。
- 关闭聊天区浮层时，右栏面板是唯一剩余所有者：浮层曾呈现过该 guest（`floatOwnedGuestRef`）时，面板首次同步必须二选一——宿主矩形可见则以当前边界 `previewShow` 收回同一 guest，宿主矩形为空（右栏收起 / occupant 隐藏）则发 `previewHide`。不允许让原生视图停在浮层的最后边界上无人隐藏。
- 对话 / 产物 / 工具行 / 终端 / 技能的文件打开都走 `workspaces.openPath`；pin 的 Workspace 服务没有该方法时由 ui-surfaces `ensureBaseOpenPath` 补 Host 本体，ui-chat `openFile` 不得绕过它直连 `remote.session.openWorkspacePath`。桌面接管层按发起 Session 的真实 cwd 处理工作区文件：交付卡片的浏览器文档先进入聊天区 Browser mini player，其他文件进入共享资源页签，根目录进入 `files`；普通文件入口的浏览器文档仍可同时进入 `browser`。缺 cwd、路径不在 cwd 内或无法处理时使用 Host 兼容兜底。
- `ui-deliverables` 的收尾正文行内代码词表只来自该轮权威事实：成功的根级或 PTC `write` / `edit` / 有修改作用的 `str_replace_editor`，以及显式 `deliverables/presented`。PTC 的轮次归属只取 Conversation assembler 已解析的 Location（`turn`/`step`）；`unresolved`、`session`、失败结果、读取/查看、未知工具和畸形参数不贡献，不得按邻近事件、`rootCallId`、当前轮次或路径外观猜测。精确路径或唯一 basename 才解析，同名不唯一保持惰性。
- 收尾正文的行内代码使用 `--dsw-alias-markdown-inline-code` 的低对比透明底；是否可点击仍由文件提及词表决定，不靠底色表示。
- Location 会影响 `match` 归属后，assembler 在 `prepend`/边界 `append` 重建 Location 时必须对先前返回 null 的 (Definition, 事件) 重新判定并回填；已拥有该事件的 Definition 不得重复匹配，`mergeMatches` 的重复检测与 target/fallback 仲裁保持不变。缺少这层回填时，最近分页里先以 `session`/`unresolved` 到达、再被老页解析出 Turn/Step 的事件会永久丢失归属。
- 客户端摘要有真实 `cwd` 时按该 `cwd` 解析相对路径；缺 `cwd` 的文件路径交回 Host，绝不按目录名字符串识别 no-workspace，也不猜 scratch 根目录。
- `gitInit` 成功广播 `dshd-git-init`，Diff 门无需切会话即重探。
- Diff / 评审对比统一走 `ui-primitives` 的共享 `ReviewDiff`：原文先可读可复制，行号与增删号不参与选择复制；单次对比渲染上限 5000 行，多文件面板懒展开并在文件级标注 truncated/omitted；超长行或超预算内容跳过高亮并显式注明。语法高亮在共享 Worker（`markdown/highlight.worker.ts`，tsdown `?raw` 内嵌源码懒 chunk）上做完整 tokenize，主线程只应用结果；无 Worker 或 worker 失败时回退 15 ms 预算的 inline 分片。每个高亮相关主线程任务必须 <50 ms，由 `benchmarks/review-diff` 门禁守卫。文件/主题/模式切换取消旧 generation，陈旧结果不落地。
- 桌面隐藏 rc.1 新增的会话 header 角位展开钮：`harness-chrome-inject.js` 注入样式 `[data-sidebar-right-expand]{display:none}`——它与 titlebar trailing 既有的面板切换键重复；右栏开合入口统一在 titlebar。
- Files 保存拒绝任何含 `.git` 段的路径（大小写不敏感，含 `.git` gitlink 本体）；`listDir` 隐藏 `.git` 与之同一契约。`.gitignore` / `.github/**` 等普通 dotfile 照常可存。

## Allowed touch

- `vendor/deepseek-harness/packages/util/native-command/src/{path-opener,runner}.ts` 与对应测试（交付文件原生定位）
- Harness surfaces 相关 client 包（`ui-surfaces`、`ui-files`、`ui-preview`、`ui-diff`、`ui-agents-panel`、`ui-user-terminal`、`ui-titlebar`、`ui-sidebar-right`、`ui-chat`）
- `ui-dockkit/src/components/dockkit.module.css` 的页签关闭控件机械垂直对齐（保持标题右侧、既有尺寸与交互）
- 共享 Diff 呈现层：`ui-primitives` 的 `ReviewDiff*` 与 `markdown/highlight*`（engine/worker/jobs）、`ui-diff` 的 `DiffPanel`/`review-hunks` 适配、`ui-deliverables` 的 `FileDiff` 适配、`vendor/deepseek-harness/benchmarks/review-diff/`
- `ui-deliverables` 的交付卡片点击意图与 `ui-chat` / `ui-surfaces` 的打开选项（2026-09-24 浏览器文档浮层优先）
- 右栏展开时的会话头部避让：vendor `ui-conversation` 的标题行样式与回归测试、`ui-layout` 的尾簇测量取整与回归测试、`apps/web/tests/titlebar-fit.e2e.ts`；`scripts/verify-titlebar-fit.mjs` 实机几何门禁
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` 的 Markdown 行内代码语义底色
- `src/main/preview*.js`、`workspace-fs.js`（Files 供数）
- `src/preload/index.js` 的 preview/surfaces 注入面（2026-08-25 硬化计划扩围，用于 automation 链删除）
- `src/preload/file-preview.js`、`src/renderer/file-preview.*`、`src/shared/themes.js`（悬浮文件窗）
- 本卡、design-language 与 handbook surfaces / IPC 附录

## Do not touch

- 把空态卡片墙当「做完」
- 挪动 Tab 关闭位置（除非用户明确要求）
- 底栏终端契约（见 `terminal-drawer`）除非一并 Touching

## Gates

| Kind | What |
| --- | --- |
| Automated | `native-command` 文件定位测试、相关 client / preview / preload / theme 单测；`apps/web/tests/titlebar-fit.e2e.ts` 浏览器几何回归；`npm run qa:source`；源码 Electron 选中普通工作区会话并以 `--remote-debugging-port=9333` 启动后运行 `node scripts/verify-titlebar-fit.mjs`，断言真实控件间距 |
| Manual / QA | `TC-SURF-001` … `TC-SURF-008`；Files 图片 / 文本 / PDF 悬浮预览；`TC-CHAT-007`、`TC-CHAT-008` |

## Sources

- Decision: [Files 目录入口与旧查看器地址恢复](../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)

- Decision: [项目审查修复：Files 生命周期与预览路径编码](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Decision: [单一右栏原位工作环](../decisions/implemented/architecture/2026-09-28-single-panel-in-place.md)

- Decision: [空态入口卡镜像上游 guide 注册表](../decisions/archived/product/2026-09-27-empty-state-upstream-guide.md)
- Decision: [ReviewDiff 高亮 Worker 化](../decisions/implemented/architecture/2026-09-26-review-diff-highlight-worker.md)
- Decision: [Browser 预览在右栏与聊天浮层间交接](../decisions/implemented/bug-fix/2026-09-24-browser-preview-surface-handoff.md)

- Decision: [交付文件的 Explorer 定位窗口可见](../decisions/implemented/bug-fix/2026-09-23-visible-explorer-reveal.md)

- Decision: [恢复 DSHD 原有右栏](../decisions/implemented/product/2026-09-23-right-sidebar-dshd-guide.md)
- Decision: [右栏展开时标题行避让](../decisions/implemented/bug-fix/2026-09-23-surface-titlebar-fit.md)
- Decision: [聊天文件预览迁移到右侧 Sidebar 资源路由](../decisions/implemented/bug-fix/2026-09-21-chat-file-sidebar-resource-route.md)
- Decision: [PTC 产出的文件纳入收尾正文的点击词表](../decisions/implemented/bug-fix/2026-09-22-ptc-produced-file-mentions.md)

- Handbook：[../handbook/modules/surfaces.md](../handbook/modules/surfaces.md)
- Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-16-surfaces-terminal-work-loops.md`
- 悬浮文件预览 Note：`vendor/deepseek-harness/.agents/notes/implemented/feature/2026-09-07-floating-workspace-file-preview.md`
- AGENTS.md Surfaces 段
- 审查与硬化计划：[../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md](../superpowers/plans/2026-08-25-surfaces-terminal-hardening.md)
