# Feature: Composer 家族宽度联动（会话统计 / Dock 卡 / Hero 控件）

| Field | Value |
| --- | --- |
| **id** | `composer-family-width` |
| **status** | `active` |
| **last verified** | 2026-10-18 |

历史验证与变更记录见 [docs/history/composer-family-width.md](../history/composer-family-width.md)。

## User paths

1. 界面设置开启「输入框拖动调整」（composerResize）后，拖动输入卡左右边缘改宽度 → 会话统计行（StatsPills，rc.1 起由 StatsLine 重构而来）、输入卡上方的 Dock 卡（QueueDock / TodoPanel / GoalBar）、以及对话信息框（`data-chat-flow` 聊天流转列）随卡宽联动，保持原有的「卡宽 − 固定内凹」关系；拖动结束、刷新、切会话后仍保持。
2. 未拖动时全部回退到静止宽轴（`--dsh-chat-content-width` / `--dsh-composer-card-max-width`），与旧行为像素级一致；关闭「输入框拖动调整」清除座位尺寸变量一并回退。
3. 空会话 Hero 重新出现时，workspace / agent-preset 行跟随已保存的输入卡宽度并居中；窄卡不会留下满宽、贴左的控制行。

## Invariants

- 单一事实源：0.2.3-alpha.2 起，存在 `[data-conversation-content]` 宿主时，`ComposerResizeHandles` 水平拖动直接写入上游 `#8858` 统一非继承宽度轴 `--dsh-chat-user-width`（`contentWidth = width - 32`，并标记 `data-composer-user-width`），使聊天列、输入卡、Dock 卡、Hero 行、宽度手柄与 `ui-session-panel` 右侧留白全部从同一轴派生（废弃分叉的 `--dsh-composer-flow-width`）；脱离对话宿主的独立输入栏回退写入座位上的 `--dsh-composer-resized-width`。各消费方只读 CSS 变量，**不得**另存宽度或自行计算。
- 拖动性能：上游 `#8858` 在 `[data-conversation-content]` 上通过 `@property`（`inherits: false`）驱动 `--dsh-chat-user-width` 与 `--dsh-chat-content-width-resolved`，避免拖动帧触发整页 transcript 样式重算；`composer-resize-publish.client.spec.tsx` 钉住拖动桥接 `--dsh-chat-user-width` 且不写独立列宿主。
- 审批接管：审批卡宽高取被隐藏输入卡的实测尺寸，上下内边距取输入卡在输入区内的实测偏移，覆盖输入卡原位置；`approval-resize-geometry.e2e.ts` 在拉宽拉高后比较两张卡的位置与尺寸（误差 ≤1px）。
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
- 其它槽：question / sidebar / settings（approval 只承接输入卡尺寸与位置，见上）
- `--dsh-chat-content-width` 值本身（748px 静止轴）

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/shared/composer-family-width.test.js`；vendor `vitest run packages/client/ui-conversation/tests/composer-resize-publish.client.spec.tsx`；vendor web e2e `approval-resize-geometry.e2e.ts`；`npm test`（桌面全集含 fork 标记 fixture）；vendor `pnpm vitest run packages/client/ui-chat packages/client/ui-conversation packages/client/ui-goal`；vendor `DSH_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/composer-resize-dock.e2e.ts` |
| Manual / QA | 开 composerResize → 左右拖动输入卡 → 统计行/Dock 卡同宽联动；回到 blank-session Hero → workspace / preset 行与窄卡同宽居中；关闭开关 → 全部回退；切换会话 + 刷新后尺寸保持 |

## Sources

- Decision: none

- Agent Note（上游）：[approval-panel-composer-resize](../../vendor/deepseek-harness/.agents/notes/implemented/bug-fix/2026-08-20-approval-panel-composer-resize.md)（座位发布尺寸变量的先例）
- 上游实现：`ComposerResizeHandles.tsx` / `composer-resize.ts`
