# surfaces-work-loops · 历史记录

自功能卡 [docs/features/surfaces-work-loops.md](../features/surfaces-work-loops.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified (Files guide)** | 2026-10-01 — 真实 Guide / registry / controller / keyed body 与持久布局恢复 9/9，既有 adapter / apply 16/16；窄 lint、ui-files 类型构建与 client catalog 检查通过。唯一目录 guide、旧查看器兼容目录标题、所属 Session 与隐藏/浮窗状态、有效草稿边界通过。 |
| **last verified (tab alignment)** | 2026-10-01 — 既有 DockKit components 87/87；隔离真实 Electron 使用生产 TabStrip、DockKit / SidebarRight CSS 与主题表，通用 28px / 桌面 24px、短标题 / 窄长标题、字号 13 / 18 与缩放 100% / 150% / 200% 共 12 组，标题 / 按钮 / SVG 垂直盒中心差最大 0.006 CSS px，关闭仍在右侧；关闭 press / click 仅调用关闭 1 次、拖拽 0 次。修前桌面中心下偏 2 CSS px，截图墨迹中心差从 4.5 降为 1.5 原生像素（保留字体本身的字面分布，无固定光学偏移）。源码整包重建与运行由发布验证另行记录。 |
| **last verified (native paths)** | 2026-09-28 — b061501e5b4 的 Windows/macOS 桌面 CI 全绿，预览短名一致性与越界拒绝通过；同 SHA 安装树冒烟通过。完整生产验收未完成。 |
| **last verified (source launch)** | 2026-09-24 — `titlebar-fit.e2e.ts` 归入 host 类型检查并从 client Web 项目排除；清理失效的 TypeScript 增量记录后，`apps/web` 定向类型构建和 `npm start` 的 host/client/web 全量构建通过，源码 Electron 已启动。 |
| **last verified** | 2026-10-01 — Files 唯一目录入口与旧无文件查看器原位兼容，真实注册/恢复 9/9、adapter/apply 16/16；见 [Files guide 修复](../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。此前 2026-09-30 — Files 草稿逐次持久化、原生 Sidebar 关闭/替换确认、隐页保存生命周期、选区原文进对话与树/搜索统一 Session 打开链修复，相关单测 268/268；源码构建与实机验证见[项目审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)。 |

## 正文历史段落

最近验证：2026-09-28，预览绝对路径与 authority 同用原生 realpath；Windows 短名反例先红后绿，预览/编辑器/工作区/登记监听 200/200 通过，越界拒绝保持。
