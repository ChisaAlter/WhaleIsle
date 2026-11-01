# Feature: 远离视口的对话行跳过样式与布局（cold rows）

| Field | Value |
| --- | --- |
| **id** | `chat-cold-rows` |
| **status** | `active` |
| **last verified** | 2026-11-01 — 隔离实例 + 假模型，对话在线增长到 156 行、约 2 万个 DOM 节点（总高约 15.4 万像素）。一次发送 1.8 秒窗口内的样式+布局耗时 862–1121ms → 357–392ms；单次样式重算波及的元素 约 2.1 万 → 约 1300；最长单任务 244–433ms → 60–83ms；对话总高与「全部强制渲染」完全相同（每行被跳过时的高度与真实高度相差 0.011px）；每次滚轮 400px 连续 60 次，内容位移与滚轮距离的偏差 0.0px，总高不变。切换会话（60 行、约 8k 节点）样式耗时 120–280ms → 34–50ms。带工具调用的会话（14 轮、58 行）总高与全部强制渲染完全相同，滚轮 50 步偏差 0.0px，跳到第 1 轮落点正确。vendor ui-chat 相关测试通过；`harness-desktop-forks` 含真实树通过。 |

## User paths

1. 长对话里发送、流式输出、目标/任务栏出现与消失：每次样式重算和布局不再随整段对话变长而变慢，发送瞬间的卡顿明显缩短。
2. 在对话里上下滚动、跳到某一轮、查找文字、选中复制：与以前一致。

## Invariants

- 根因：样式重算和布局的开销与整段对话的大小成正比，与改动多小无关。发送一次，长对话里约 2 万个元素都被重算样式；尾部跟随（`followTail` → `scrollMetrics` 读 `clientHeight`）每次调用还会强制一次整段布局。
- 做法（`chat-cold-rows.ts`，由 `ChatViewport.attach/detach` 管理）：距视口超过 3 屏的对话行加 `data-chat-cold`，样式表据此给该行 `content-visibility: auto`，`contain-intrinsic-size: auto var(--dsh-chat-cold-height)`。进入 2 屏以内时去掉标记。两个阈值不同，边界上的行不会来回切换。
- 标记前先记下该行实测高度（布局单位 1/64 像素，不取整；扣掉内边距与边框，因为固有尺寸替代的是内容框）写入 `--dsh-chat-cold-height`（`@property` 注册为不继承，写入只重算这一行），所以对话总高、滚动条位置和所有滚动位置不变。**不得**改成只用估算高度：未渲染过的行没有被记住的尺寸，总高会缩水（实测 15.4 万 → 2.8 万像素）。
- 标记分两步：IntersectionObserver 回调里先读完所有行的高度和内边距，再统一写属性。解析内边距要布局，读写交替会让每一行强制一次布局；会话切换时首个回调带着全部行，交替版本在 60 行的会话里多花约 360ms（实测，已改）。
- 视口附近 2 屏内的行、最新的 4 行、含焦点的行从不标记，渲染与以前完全相同。**不得**给在屏的行加 `content-visibility`：它带来的绘制包含会把溢出行盒的内容裁掉（回合尾部操作栏悬在行盒外 6px，悬停底色会被裁）。
- 被跳过的内容仍在 DOM 中：页内查找、选择复制、无障碍树、`hidden="until-found"` 都照常工作；`auto` 在行进入视口的同一帧内自行取消跳过，不会闪空白。
- 没有 `IntersectionObserver` 的环境（jsdom）整个机制不启用。

## Allowed touch

- vendor `ui-chat` 的 `chat/chat-cold-rows.ts`、`chat/use-chat-viewport.ts`（挂接两处）、`chat/ChatView.module.css`（一条规则 + 一个 `@property`）及对应 client specs
- `src/shared/harness-desktop-forks.js` 与其测试（位置标记）

## Do not touch

- 上游对话行的结构与 `data-chat-flow-key` 约定（本机制只读它）；`ChatNodeSeat`、`ChatGroupSeat`
- 滚动跟随、阅读位置与轮次导航的逻辑（行高不变，它们不需要知道行是否 cold）

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-chat/tests/chat-cold-rows.client.spec.ts`（观察器行为）与 `chat-cold-rows-styles.client.spec.ts`（样式文本）；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 长对话（上百轮）在线发送：用 DevTools Performance 看有没有整段 `UpdateLayoutTree`；滚到顶部、跳轮次、Ctrl+F 搜索旧内容，滚动不跳、没有空白行 |

## Sources

- 同类做法：[composer-dock-stability](composer-dock-stability.md)（同样是避免「一次改动重算整段对话」）
