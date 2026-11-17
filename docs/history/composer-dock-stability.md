# composer-dock-stability · 历史记录

自功能卡 [docs/features/composer-dock-stability.md](../features/composer-dock-stability.md) 迁入（2026-11-17，议题 #458）；以下为该卡原有的历史验证与变更记录，原样保留。

## last verified 记录

| Field | Value |
| --- | --- |
| **last verified** | 2026-11-03 — 队列卡可拖动排序：真实 Host + 真实 Chromium 的 `apps/web/tests/queue-reorder.e2e.ts` 通过（拖到最后一行下半部、方向键上移，Host 各只记一条 `agent/inbox/spliced`，没有新开轮次，焦点留在把手上）；`ui-conversation` 队列卡 44 项、`agent-loop` inbox 8 项、`session-controller` 命令 22 项、`harness-desktop-forks` 15/15（含真实树）。此前：2026-10-31 — 隔离实例 + 假模型，对话约 22 万像素（3.5 万个元素）时，任务栏展开/收起结束后整段对话的样式重算单次 524ms（该次收起的样式耗时共 1032ms）；改后在约 12 万像素的对话里同一操作样式耗时合计 80ms，没有超过 70ms 的任务；目标续跑 22 秒内队列卡零次挂载/卸载、任务栏零次收起；分支菜单首次打开即为 888px 满高，不再从 88px 跳高。发送时任务栏退出的起点从发送后 136–795ms 提前到 26–65ms（一次 209ms），退出前 6–7 帧主线程帧距 4–12ms。vendor client `ui-conversation`、`ui-primitives`、`ui-goal`、`ui-chat`、`ui-git` 全量 230 个文件 3780 项通过（含新增）；`harness-desktop-forks` 21/21（含真实树）。 |
