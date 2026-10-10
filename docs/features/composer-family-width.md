# Feature: Composer 家族宽度联动（会话统计 / Dock 卡 / Hero 控件）

| Field | Value |
| --- | --- |
| **id** | `composer-family-width` |
| **status** | `active` |
| **last verified** | 2026-09-10 — 同步 `dsh-v0.1.5-rc.1`：统计行随上游 StatsLine→StatsPills 重构，跟随契约（`dsh-composer-resized-width`）迁至 `StatsPills.module.css` 并入 FORK_FILE_MARKERS；宽度合同 8/8、fork marker 与 post-merge UI 测试全过，Desktop tests 1450 全绿。宽度联动 e2e（composer-resize-dock）未复跑：其回放 fixture（live-interactions session.jsonl）为 v2 形态，被 rc.1 的 v2→v3 迁移规则拒绝（首 step 前出现 surface 事件），需重录或手迁 v3 后再验。此前 2026-09-04 — official build 记录 246 个客户端产物；实机保存宽度 654px 时 Hero 行与输入卡均为 x=529、width=654，左右与中心偏差均 0px；宽度合同 8/8、fork marker 10/10、conversation skeleton 26/26 通过。 |

## User paths

1. 界面设置开启「输入框拖动调整」（composerResize）后，拖动输入卡左右边缘改宽度 → 会话统计行（StatsPills，rc.1 起由 StatsLine 重构而来）、输入卡上方的 Dock 卡（QueueDock / TodoPanel / GoalBar）、以及对话信息框（`data-chat-flow` 聊天流转列）随卡宽联动，保持原有的「卡宽 − 固定内凹」关系；拖动结束、刷新、切会话后仍保持。
2. 未拖动时全部回退到静止宽轴（`--dsh-chat-content-width` / `--dsh-composer-card-max-width`），与旧行为像素级一致；关闭「输入框拖动调整」清除座位尺寸变量一并回退。
3. 空会话 Hero 重新出现时，workspace / agent-preset 行跟随已保存的输入卡宽度并居中；窄卡不会留下满宽、贴左的控制行。

## Invariants

- 单一事实源：座位（`[data-composer-seat]`）**和**列宿主（`[data-conversation-scroll]`）同值发布 `--dsh-composer-resized-width`；各消费方只读该变量，**不得**另存宽度或自行计算。双发原因：聊天流转列（`.column`）是 seat 的兄弟，读不到只发在 seat 上的变量。
- 静止回退：`var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))`，变量缺失时 = 旧值。
- 关系钉死：统计 dock = 卡宽 − 2×side-clearance；聊天流转列 = 卡宽 − 2×side-clearance；QueueDock = 卡宽 − 2×dock-inset；TodoPanel / GoalBar = 卡宽 − 4×dock-inset。TodoPanel 使用共享 `ui-primitives/TaskDock`，宽度约定位于 `TaskDock.module.css` 的 `.root`。0.2.1-alpha.1 起 ActivityPill 与 UsagePill 各自占一个 dock 条目，宽度约定位于 `InputBar.module.css` 的 `.dock`；`PeakValleyRow` 在该容器中独占下一行。
- Hero 行直接以 `var(--dsh-composer-resized-width, var(--dsh-composer-card-max-width))` 为 `max-width`，在外层 stack 内 `align-self: center`；不得按 stack 满宽留在左缘。
- vendored 上游 CSS/TS 改动经 `FORK_FILE_MARKERS`（harness-desktop-forks.js）+ `src/shared/composer-family-width.test.js` 双重标记，sync:harness 不得静默丢。
- 宽高独立：高度拖动不受影响（高度变量不同，家族行不读）。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.module.css`（统计 dock 宽度）；`vendor/deepseek-harness/packages/client/ui-chat/src/client/chat/ChatView.module.css`（聊天流宽度）
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/queue/QueueDock.module.css`、`skeleton/TodoPanel.tsx`、`skeleton/ComposerResizeHandles.tsx`、`skeleton/ConversationRoot.module.css`
- `vendor/deepseek-harness/packages/client/ui-primitives/src/TaskDock.tsx`、`TaskDock.module.css`
- `vendor/deepseek-harness/packages/client/ui-conversation/README*.md`
- `vendor/deepseek-harness/packages/client/ui-goal/src/client/GoalBar.module.css`
- `src/shared/harness-desktop-forks.js` / `harness-desktop-forks.test.js`、`src/shared/composer-family-width.test.js`
- `vendor/deepseek-harness/apps/web/tests/composer-resize-dock.e2e.ts`（桌面 fork 的 keyless 拖动联动驱动）
- 本卡、`docs/features/README.md` 索引、`docs/handbook/modules/usage-stats.md`

## Do not touch

- 上游 composer-resize 的手势/几何数学（`composer-resize.ts` 纯函数）
- 高度线（`--dsh-composer-resized-height`）
- 其它槽：approval / question / sidebar / settings
- `--dsh-chat-content-width` 值本身（748px 静止轴）

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/shared/composer-family-width.test.js`；`npm test`（桌面全集含 fork 标记 fixture）；vendor `pnpm vitest run packages/client/ui-chat packages/client/ui-conversation packages/client/ui-goal`；vendor `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/composer-resize-dock.e2e.ts` |
| Manual / QA | 开 composerResize → 左右拖动输入卡 → 统计行/Dock 卡同宽联动；回到 blank-session Hero → workspace / preset 行与窄卡同宽居中；关闭开关 → 全部回退；切换会话 + 刷新后尺寸保持 |

## Sources

- Decision: none

- Agent Note（上游）：[approval-panel-composer-resize](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-20-approval-panel-composer-resize.md)（座位发布尺寸变量的先例）
- 上游实现：`ComposerResizeHandles.tsx` / `composer-resize.ts`
