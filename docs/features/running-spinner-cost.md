# Feature: 运行中的转圈不再每帧整页布局（running spinner）

| Field | Value |
| --- | --- |
| **id** | `running-spinner-cost` |
| **status** | `active` |
| **last verified** | 2026-11-01 — 隔离实例 + 假模型，对话在线增长到约 250 行、约 3 万个 DOM 节点，一轮运行中且左栏有一个转圈。改前（248 行/3.1 万节点）页面每秒帧数 40，事件循环延迟（8ms 定时器实际晚多少）中位数 39.0ms、p95 52.5ms；改后真实构建（252 行/2.9 万节点）155 帧，中位数 4.3ms、p95 13.0ms。转圈在 7 个动画时刻（含非 90° 倍数）与旧实现逐像素比较，每通道最大差 ≤ 24/255（只在弧线边缘的抗锯齿）。vendor ui-primitives 全部 1501 项通过；`harness-desktop-forks` 含真实树通过。 |

## User paths

1. 一轮对话运行中（流式输出、工具调用），左栏会话行和对话里的「进行中」圆环一直在转：长对话里页面不再被它拖到只剩 40 帧，输入、滚动和流式渲染跟手。
2. 圆环外观与旧版一致：底环 + 呼吸的弧线 + 整体匀速旋转，周期同为 1.5 秒，所有圆环仍相位一致。

## Invariants

- 根因：旋转写在 SVG 内部的 `<g>` 上。SVG 子元素的 `transform` 动画每一帧都会让该 SVG 重新布局，而布局之后的收尾工作（`LocalFrameView::performPostLayoutTasks`）要遍历整个文档里所有可滚动区域；对话里有上百个代码块/表格，实测每帧约 12ms，在 120Hz 屏上主线程被占满，只剩 40 帧。
- 做法：旋转挪到 `<svg>` 根元素（`.spinner`，`transform-origin: center`）。它是普通 CSS 盒的变换，只引起样式和绘制，不再触发布局。`StateDot.tsx` 因此不再有 `<g>`；弧线呼吸动画（`stroke-dasharray`/`stroke-dashoffset`）仍在两个 `<circle>` 上。
- **不得**把旋转放回 SVG 内部元素；**不得**给旋转写 `will-change: transform` 期望它上合成线程——SVG 根元素的变换动画不会被合成（Chromium 以 `kTransformRelatedPropertyDependsOnBoxSize` 拒绝，实测）。要合成需要在外面再包一层 HTML 元素，这会改变调用方依赖的 DOM 形状（`className` 落在 svg 上），暂不做。
- `syncSpinner` 仍用 `getAnimations({ subtree: true })` 把根上的旋转和圆上的呼吸一起钉到文档时间 0；`subtree: true` 包含元素自身，不用改。
- `prefers-reduced-motion`：旋转与呼吸都关闭，弧线保持中间长度（`18 150`，偏移 `-3`），与旧版一致。

## 已知但未处理（实测）

- 输入框运行光束（`ComposerBeam`）靠动画 `@property --dsh-composer-beam-angle` 驱动，仍是主线程动画：空会话约占 40% 主线程，长会话更多。已试过用 `transform: rotate` 把三层都改成合成线程动画（外层静态环形遮罩 + 内层旋转的锥形渐变；内光层用反向旋转抵消），像素等价，但 Chromium 仍会每帧为每个动画元素重算一次样式，收益只有 p95 延迟 20.6 → 13ms，改动面（标记、CSS、`input-bar-beam` 的 7 项样式断言、功能卡）与视觉风险不成比例，没有采纳。
- 背景光斑（`ui-theme/wallpaper.ts` 的 12Hz 定时器）空闲时约占 5% 主线程，上游设计，未动。

## Allowed touch

- vendor `ui-primitives` 的 `StateDot.module.css`、`StateDot.tsx` 及其两个 spec
- `src/shared/harness-desktop-forks.js` 与其测试（位置标记）

## Do not touch

- 转圈的几何、颜色、周期与呼吸曲线（`dsh-state-dot-dash` 关键帧）
- 其他组件各自的 `.spinner`（它们没有 SVG 内部动画）

## Gates

| Kind | What |
| --- | --- |
| Automated | `packages/client/ui-primitives/tests/state-dot-styles.client.spec.ts`（旋转在 `.spinner` 上、没有 `.spinnerMotion`）与 `state-dot.client.spec.tsx`（svg 内没有 `g`）；`node --test src/shared/harness-desktop-forks.test.js` |
| Manual / QA | 长对话里发一条消息，DevTools Performance 看运行期间主线程：不应出现每帧 `Layout`（`Style changed` 指向 `g`）；左栏圆环旋转、呼吸与以前一致 |

## Sources

- 同类问题：[chat-cold-rows](chat-cold-rows.md)、[composer-dock-stability](composer-dock-stability.md)（都是「开销随整段对话变大」）
