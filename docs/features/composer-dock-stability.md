# Feature: 输入区上方卡片稳定（目标 / 任务 / 队列 / 分支菜单）

| Field | Value |
| --- | --- |
| **id** | `composer-dock-stability` |
| **status** | `active` |
| **last verified** | 2026-10-31 — 隔离实例 + 假模型，对话约 22 万像素（3.5 万个元素）时，任务栏展开/收起结束后整段对话的样式重算单次 524ms（该次收起的样式耗时共 1032ms）；改后在约 12 万像素的对话里同一操作样式耗时合计 80ms，没有超过 70ms 的任务；目标续跑 22 秒内队列卡零次挂载/卸载、任务栏零次收起；分支菜单首次打开即为 888px 满高，不再从 88px 跳高。发送时任务栏退出的起点从发送后 136–795ms 提前到 26–65ms（一次 209ms），退出前 6–7 帧主线程帧距 4–12ms。vendor client `ui-conversation`、`ui-primitives`、`ui-goal`、`ui-chat`、`ui-git` 全量 230 个文件 3780 项通过（含新增）；`harness-desktop-forks` 21/21（含真实树）。 |

## User paths

1. 输入框上方有目标栏和任务栏时输入、发送：任务栏随发送立刻开始退出（上游行为是新一轮开始时清空计划，这里保持），退出由合成线程完成，不再等 Host 回报、也不再一步一步卡着走；目标连续续跑时，队列卡不再每轮弹出又收回。
2. 目标栏、任务栏出现、消失、展开、收起：动画结束后不再出现一次整段对话的样式重算卡顿（对话越长越明显）。
3. 顶部「切换分支」：第一次点开就是完整列表，不再先弹出一个空卡再变高。

## Invariants

- 输入区尺寸变化只写非继承的 `--dsh-composer-reserve`（`@property … inherits: false`）。桌面端**不得**把 `--dsh-composer-height` / `--dsh-conversation-viewport-height` 写在对话滚动体上：继承型自定义属性的一次写入会让整段对话每个元素重算样式（约 15ms/千元素），而它在每次输入区尺寸稳定后都会发生。两个桌面消费方自己量：转向导航栏（`TurnNavigator`，`--turn-rail-band` 写在导航框上）和轨迹视图（`TrajectoryView`，`--dsh-trajectory-seat` 写在视图根上）。手机布局（祖先有 `[data-phone]`）里外部插件仍读这两个变量，所以那里保持原来的稳定后发布。
- 任务栏：上游投影在每个 `turn/start` 清空计划，这一行为不变。退出的起点提前到发送本身：空闲会话里提交回显（`placement: transcript`，composer 在点击的同一帧登记）落到一份在场的计划上时，卡片立即开始退出（`TodoPanel` 的 `usePlanLeavingOnSend`）；之后 Host 清空计划只是确认。排队/插话的发送不触发。回显消失后 1 秒（或回显存在满 8 秒）计划仍在，说明这次发送没开新一轮（被拒绝、不开轮的命令），计划回来。回显之后才写出的新计划不受影响。
- 任务栏退出时布局轨道立即收起（`TaskDock.module.css` 的 `.root[data-state='closed']` `transition: none`），卡片继续在槽的裁切框里用 transform/opacity 在合成线程上滑出淡出。退出因此不需要每帧一次对话区布局，发送时主线程再忙也不会一步一步卡着走。进入仍用动画轨道。目标栏、队列卡的退出保持原样：它们不是栈顶，立即收起会让上方的卡片一步跳下来。
- 队列卡：来源不是用户的排队行（目标续跑的 `<goal_round>`、通知等）存活满 400ms 才打开卡片；用户自己排队的消息和本地发送回显立即打开（`QueueDock` 的 `SYSTEM_ROW_SETTLE_MS`）。
- 分支菜单：工作区稳定 1.5 秒后读一次分支列表，指针或焦点到达触发按钮时再读（15 秒内读过则跳过）；每次打开仍重新读取，行相同则不重绘；已有行时不显示读取中的转圈；切换或新建分支后丢弃旧列表并重读；没有任何行可用时显示「正在读取分支…」，不显示空卡。读取失败仍走原来的进度通知。

## Allowed touch

- vendor `ui-conversation` 的 `ConversationContent.tsx`、`queue/QueueDock.tsx`、`skeleton/TodoPanel.tsx`；`ui-chat` 的 `TurnNavigator.tsx`；`ui-trajectory` 的 `TrajectoryView.tsx` 与 `views.module.css`；`ui-git` 的 `BranchMenu.tsx` 与 `locales.ts`；对应 client specs
- `src/shared/harness-desktop-forks.js` 与其测试（位置标记）

## Do not touch

- 上游 `todo` 投影的 `turn/start` 清空规则与 `goal` 续跑入队方式（本卡只在显示层保留/延迟）
- `ui-primitives` 的 `Menu` 与 `usePresence`（其他菜单共用）

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-conversation/tests/{queue-dock,todo-panel,skeleton}.client.spec.tsx`、`ui-chat/tests/turn-navigator.client.spec.tsx`、`ui-git/tests`；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 长对话 + 目标 + 任务栏：发送、目标续跑、展开/收起任务栏，用 DevTools Performance 看动画结束后有无整段 `UpdateLayoutTree`；分支菜单首次打开高度 |

## Sources

- 同类做法：[composer-family-width](composer-family-width.md)（拖动宽度时同样避免写继承属性）
- 卡片动效基础：vendor `docs/motion.md`
