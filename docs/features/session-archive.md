# Feature: Session archive

| Field | Value |
| --- | --- |
| **id** | `session-archive` |
| **status** | `active` |
| **last verified** | 2026-09-23 — 保留新版 Harness 后恢复侧栏独立归档分区、默认折叠及界面设置显示开关；ui-workspace 包内 367/367 通过，源码桌面待重启验收。此前 2026-09-17 — 核心契约套件 4729 项全绿（workspace 55、session-controller 删除路径 5）；alpha.1 合并吞掉的未知 unarchive id 拒绝已恢复，幂等用例改以已知未归档 id 断言（见 2026-09-17 漂移裁定记录）。尚未替换安装版验证。 |

## User paths

1. 活会话行 ⋯ → 归档会话：在默认筛选下从主会话列表和搜索消失，日志与工作区 `sessionIds` 槽位保留。
2. 视图选项 → **筛选列表与搜索**：**隐藏已归档**（默认）、**全部对话（显示已归档）**、**仅显示已归档**。三态同时作用于工作区分组、工作区树、单列表及会话搜索；归档行点击不打开，⋯ → **取消归档**（不自动打开）或 **删除会话**。
3. 默认筛选下，侧栏底部 **已归档**仍是独立管理区（默认折叠），点标题展开/收起；展开后点行无动作。选择全部或仅归档时，已知会话不再重复列在底部；缺失摘要的归档 id 仍保留管理占位。
4. 已归档 ⋯ → 删除会话：确认后永久删除该会话日志；工作区文件夹不动。确认后该行不得闪回活列表。
5. 设置 → **界面设置** →「显示底部归档管理区」（默认开）：只控制默认筛选下的底部区。关闭后仍可用视图选项查看全部或仅归档会话并管理归档，不更改三态筛选偏好。

## Invariants

- 活会话菜单只有归档，没有删除。
- 恢复与销毁只出现在归档行的 ⋯ 菜单（包括主列表、搜索与底部管理区）；点已归档行标题/整行不恢复、不打开。
- 不得以归档态打开主视图；须先菜单取消归档，再从活列表打开。
- 「已归档」每次加载默认折叠；展开仅当次会话有效，不写入 persist。
- 底部区开关默认开，沿用 `dsh.workspace.view.v5` 持久化键及 `showArchivedList` 字段；三态筛选单独持久化为 `archivedFilter`，旧快照缺该字段时仍默认隐藏主列表归档。两者都不改 `archivedSessionIds`，主列表与搜索的显式归档筛选不受底部区开关屏蔽。
- 桌面不另做会话浏览器；走官方 `ui-workspace`。
- 删除只接受已归档的请求根；子 agent（`origin === 'subagent'`）随根删除；fork 不随根删除。
- 删除成功：先发 `api-session/deleted`，再 unarchive；unary ok 时装归档回声并 `applyDeleted`；对话框仍仅当归档集不再含该 id 时关闭。
- 级联半成功：已 gone 的 id 发 `session-deleted`，根仍归档时 RPC 为 `session-delete-partial`（非 ok）。
- 无摘要的归档 id 可显示「缺失会话」占位行（仍有取消归档/删除）；Host 仅在 persist+live 皆无时修剪幽灵归档成员。
- `unarchiveSession` 对不在归档集且不可知（非 live、持久层亦无）的 id 拒绝且不写盘；不在归档集但可知的 id 幂等 resolve。上游 alpha.1 的纯幂等语义不采用。

## Allowed touch

- `vendor/deepseek-harness/packages/workspace/workspace/`
- `vendor/deepseek-harness/packages/api/session-controller/` / `packages/api/workspace-controller/`
- `vendor/deepseek-harness/packages/client/ui-workspace/`（含 `settings.interface.item` 贡献行）
- `vendor/deepseek-harness/packages/session/session-persistence*`（仅 C2）
- 本卡、QA TC-CHAT-010 / TC-CHAT-013

## Do not touch

- Appearance / 图库 / 市场
- 活会话行上的删除
- Electron / PTY `DSH_HOME`
- 附件 blob GC、message-feedback 级联
- 关显示开关时的紧凑「已归档(N)」入口（会降级卡面）

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor workspace + session/workspace controller + `pnpm run test:gui`（ui-workspace）；可见 UI 另跑 `DSH_SNAPSHOT=replay pnpm run test:web` |
| Manual / QA | `TC-CHAT-010` 取消归档；`TC-CHAT-013` 硬删除（含确认后不闪回活列表）；界面设置开关关后侧栏无「已归档」 |

## Sources

- Decision: none

- Spec / plan: [2026-08-23-github-issues-17-18-19.md](../superpowers/plans/2026-08-23-github-issues-17-18-19.md)
- Agent Note: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-07-31-session-archive-global-set.md`
- Delete: `vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-23-archived-session-delete.md`
