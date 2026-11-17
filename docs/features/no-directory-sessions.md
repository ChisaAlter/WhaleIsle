# Feature: No-directory sessions & Workspace-membership listing

| Field | Value |
| --- | --- |
| **id** | `no-directory-sessions` |
| **status** | `active` |
| **last verified** | 2026-09-27 |

历史验证与变更记录见 [docs/history/no-directory-sessions.md](../history/no-directory-sessions.md)。

## User paths

1. 空会话 Hero 的工作区芯片菜单里，「添加工作区…」上方固定一项「无工作目录」（`IconNewChatOutline16`）。选中后当前草稿随会话带走，芯片显示「无工作目录」，输入框解锁，可直接对话；不登记任何工作区、不弹目录选择器。
2. 侧栏「按工作区」视图末尾有一节「无工作目录」（无文件夹图标、无重命名/删除菜单），列出所有 scratch 会话；节头 `＋` 直接新建一个无工作目录会话。空节不渲染。
3. 删除某个工作区（登记）后：其全部会话（含已归档的）立刻从侧栏消失——分组视图、单列表、搜索、已归档区都不再出现；若正在浏览其中一个会话，选择被清空回到「新会话」页。文件夹与会话日志本身不删。
4. 再次添加同一目录为工作区：Host 自动把该目录下所有历史会话重新记入这个工作区，侧栏原样回来（含归档状态）。目录已经登记时也刷新历史索引并接纳后来导入的未归属会话，保留工作区 ID、标题与原成员顺序；启动时不可用、后来恢复的原目录会重新校验。
5. 冷启动没有任何会话时仍是「选择工作区」占位 + 惰性输入框；被删工作区遗留的空白会话也保持惰性，不会伪装成无工作目录任务。
6. 启动时为仍登记的工作区补全遗漏的历史成员（包括已归档会话），保留工作区身份、标题与原成员相对顺序；只读会话 header，不重建已删除的工作区，不修改归档集合。

## Invariants

- Host 通过 Workspace `follow` baseline 公布 `scratchCwd`（`$DSH_HOME/no-workspace`，`WorkspaceController` init 时 `mkdir -p`）。客户端 `WorkspaceSnapshot.scratchCwd` 在 baseline 到达前为 `undefined`，此时不会列出任何 scratch 会话；但 Hero 的「无工作目录」入口在加载期仍可点——`connectNoDirectory()` 经 `connectScratchCwd()` 排队等待第一份 baseline 后继续，只有 baseline 已 ready/error 仍缺 `scratchCwd` 才失败（经 `createFailed` 提示）。宿主 `workspace` 插件挂载失败（如会话根编码冲突）时该提示即用户可见的失败面，不静默。
- scratch 会话的产物在右栏文档页可读：`shell:read-file` / `shell:list-dir` 的生产 authority 与 preview 一致携带 `allowScratchCwd: true`，授权的边界仍是 Host 固定的 `$DSH_HOME/no-workspace`（父目录与外部绝对路径继续被拒绝），不扩大为任意路径。
- 「无工作目录会话」= 不属于任何已登记工作区的 `sessionIds` **且** `cwd === scratchCwd`。只满足前者（被删工作区的会话、其他进程在别处建的会话）一律不列出。判断集中在 `tree.ts` 的 `isNoDirectorySession` / `currentGroupKey`，四个 derive 函数共用。
- `connectNoDirectory()` 只在「空白 + scratch cwd + 非成员 + 未归档 + 非 subagent」的候选通过只读 Host `session.blankReuse({ sessionId })` 后复用，否则 `session.create({ cwd: scratchCwd })`；客户端在提交复用前重查当前成员关系、归档状态和摘要，并发调用把完整的检查加创建合并为一次；绝不调用 `workspace.create`。空白仍表示没有开始过 turn；已有 `session/title` pin 的会话不参与 New Session 复用，但用户显式打开时保留原 pin。
- `WorkspaceRegistry.create(path)` 新记录的 `sessionIds` = 该规范化目录下所有未被其他工作区记账的会话（按 `createdAt` 新→旧）；创建时刷新一次持久化 header 索引，保证跨重启也能找回。
- 删除工作区走 `uiWorkspace.deleteWorkspace`：先 `workspaces.delete`，再在当前会话属于该工作区时 `sessions.clear()`。
- 添加工作区仍只有一条路径（选目录）；「无工作目录」不是第二条 `workspace.create` 路径。
- 文案：`workspace` 命名空间 `group.ungrouped` 现为「无工作目录 / No workspace folder」，`delete.desc` 说明「重新添加该工作目录后会话会回来」；不得再出现 “Ungrouped”。

- 历史中非空的 `agent/inbox/spliced` 输入、`goal/change` 或 `schedule/change` 同样排除复用：它们可以在首个 turn 之前保存待处理工作。后来取消输入或清除目标不会把旧身份变成新草稿；空的 inbox 操作和普通配置不受影响。

## Allowed touch

- `vendor/deepseek-harness/packages/workspace/workspace/src/index.ts`（启动成员补全、`readoptableSessionIds`）
- `vendor/deepseek-harness/packages/api/workspace-controller/{src/types.ts,src/feed.ts,src/index.ts,src/client/model.ts,package.json,tsconfig.host.json}`
- `vendor/deepseek-harness/packages/client/ui-workspace/src/client/{navigation.ts,tree.ts,WorkspacePicker.tsx,rows/WorkspaceBrowser.tsx,rows/Rows.tsx,locales.ts,index.ts,contract/slots.ts}`
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/{apply.ts,contract/slots.ts,locales.ts,skeleton/ConversationContent.tsx}`
- 对应 tests；`src/shared/harness-desktop-forks.js` 的 marker 行

## Do not touch

- Host `session.create` 默认 cwd（`process.cwd()`）与 Agent 创建流程
- 归档/删除会话语义（[session-archive](session-archive.md)）
- 目录选择器（native/browse）与「添加工作区」单路径

## Gates

| Kind | What |
| --- | --- |
| Automated | vendor：`npx vitest run packages/workspace packages/api/workspace-controller packages/client/ui-workspace packages/client/ui-conversation`；桌面：`node --test src/shared/harness-desktop-forks.test.js`（marker：`scratchCwd`、`readoptableSessionIds`、`NO_DIRECTORY`、`TasksSectionHeader`、`selectNoDirectory`，且 `ui-workspace/locales.ts` 不含 `Ungrouped`） |
| Manual / QA | Hero 选「无工作目录」→ 直接发消息成功；侧栏出现「无工作目录」节；删除某工作区 → 其会话消失、当前会话回到新会话页；重新添加同一目录 → 会话回来 |

## Sources

- Decision: [blank Session reuse after presentation release](../decisions/implemented/bug-fix/2026-09-18-blank-session-reuse.md)
- Decision: [Let the document tab read scratch-session files](../decisions/implemented/bug-fix/2026-09-23-scratch-cwd-document-tab-read.md)
- Decision: [工作区列表加载中也可选择无工作目录](../decisions/implemented/bug-fix/2026-09-27-no-directory-pick-during-workspace-load.md)

- Agent Note：[2026-08-15-no-directory-task-sessions.md](../../vendor/deepseek-harness/.agents/notes/implemented/feature/2026-08-15-no-directory-task-sessions.md)
- 合树背景：alpha.1/alpha.2 pin 时该 leftover 被上游覆盖（仅残留 `connectNoDirectory` 桩与 `menu.noDirectory` 文案），本卡在 alpha.4 上重建并加 marker 防再次丢失
- Implementation entry：`ui-workspace/src/client/tree.ts`、`ui-workspace/src/client/navigation.ts`、`api/workspace-controller/src/index.ts`
