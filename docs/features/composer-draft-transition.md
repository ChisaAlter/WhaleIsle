# Feature: 草稿发送布局过渡

| Field | Value |
| --- | --- |
| **id** | `composer-draft-transition` |
| **status** | `active` |
| **last verified** | 2026-10-18：滑动改为在发送那次提交内直接开始，不再由定时器放行；会话标题与对话内容以 swap 淡入；上一条回复的操作行保持到新回复完成。首次发送几何回归 5/5、草稿滚动 e2e、ui-chat / ui-conversation 1953 项测试通过；真实 Web 逐帧截图确认不再停在半空、操作行不随发送消失。更早记录见 Git 历史。 |

## User paths

1. 草稿页输入消息并点击发送或按 Enter，常驻输入框平稳进入会话布局。
2. 减少动态效果时直接落位；后续发送、切换会话和手动输入框尺寸保持现有行为。

## Invariants

- 不先贴底再回弹，不用隐藏输入框或重挂载编辑器遮掩跳动。
- 滑动在离开草稿页的那次提交内、首帧绘制前开始，由合成层 `transform` 推进；不得改回由 JS 定时器放行，否则首次发送的长任务会让输入卡停在半空。
- 同一提交中，会话标题区（不含常驻的左侧控件）与对话内容以 swap 淡入（`--ds-motion-duration-swap`），不在一帧内替换草稿页。
- 上一条回复的操作行在新一轮尚未结束时保持显示；新回复完成后才转为悬停显示。
- 最终尺寸、统计行和 Dock 对齐遵循现有设计语言；不改变消息发送或会话身份。
- 动效只属于首次草稿发送，不影响滚动、浮层定位和持久化尺寸。
- 普通输入框的底部预留统计行高度，准入、运行状态和统计投影分别更新时不得折叠；首次发送使用共享慢速 token 和合成层位移；内置 fixed 浮层保留页面 portal，滑行结束清除 transform。
- 统计占位与真实控件保持相同最小行高，统计数字在同一行内收缩，避免数据到达引起换行和输入卡位移；费用与峰谷内容保留独立第二行，费用开关开启时在路由和用量投影到达前也预留该行。
- 输入框上方的任务、目标及任务正文以共享 token 平滑收展，退场保留最后可见内容，逻辑关闭即退出键盘和辅助技术访问；上方条的显隐不移动底部锚定的输入卡，首次草稿下滑继续独立触发。
- 输入不滚动对话：输入框座位渲染在对话滚动容器内、但位于其盒子下方，Lexical 自带的「光标滚入视野」会逐级滚动祖先，曾让上翻阅读中的对话每次按键都往下滑。草稿编辑器的内容变更、光标移动和删除命令都带 `skip-scroll-into-view`（每个命令单独提交一次更新，草稿已空时的 Backspace / Delete 既不改内容也不动光标，因此删除命令单独加标记），光标只在草稿自身滚动区（`[data-input-scroll]`）内保持可见（`input/editor/runtime.ts`）。`composer-typing-keeps-reading.e2e.ts` 在上翻后输入、换行增高、超出草稿上限，以及按 Backspace / Delete 删除单行字符、删除换行、选中多行并删到草稿上限以下，以及草稿删空后继续按 Backspace / Delete / 方向键，断言对话 `scrollTop` 不变且溢出草稿的光标留在草稿区内。

## Allowed touch

- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/` 及本包定向测试、README 对。
- `vendor/deepseek-harness/packages/client/ui-conversation/src/client/input/editor/runtime.ts`（输入不滚动对话）与 `apps/web/tests/composer-typing-keeps-reading.e2e.ts`。
- `vendor/deepseek-harness/packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx` 与 `ui-chat/tests/chat-view.client.spec.tsx`（操作行保持）。
- `src/shared/harness-desktop-forks.js` 及其测试（差异标记）。
- `vendor/deepseek-harness/apps/web/tests/composer-draft-transition.e2e.ts` 及对应 geometry golden；`apps/web/tsconfig.json` 与 `tsconfig.host.json` 仅登记该测试所属编译面。
- 本卡、功能索引、设计语言与动效文档、对应 Harness Agent Note。

## Gates

- 定向组件测试、Host/Client 类型检查、真实 Web 首次发送逐帧几何回归（含减少动态效果）。
- 真实浏览器检查输入框未重挂载、没有超出终点后回弹；发送内容与回复可见。

本次复现记录：输入卡先从 y=496 跳到 y=900，随后在 y=900 / y=876 间回弹；修复后各帧单向到达终点，统计行不再导致 24px 跳动。桌面点击、减少动态效果、390px 窄视口 Enter、多行草稿与第二次发送均覆盖。新增过渡逻辑和测试的定向 lint 通过；包含 `InputBar.tsx` 的检查仍报其未改动区域原有缩进问题。本次未生成安装包，未运行全量 Web、覆盖率或 doc-sync。

首次发送在离开草稿页的提交内设置 `--dsh-composer-enter-offset` 与 `data-composer-entering`，动画随即运行：提交后的挂载与流式渲染可能占住主线程数百毫秒，合成层位移不受影响。会话标题与对话内容同时以 swap 淡入；减少动态效果时主题把时长置零，直接落位。内置 fixed 浮层使用页面 portal，动效结束清除 transform。此前的「静默约 80ms、上限 450ms 后由定时器放行」会在长任务期间把输入卡停在屏幕中部。

## Sources

- Design: [design-language.md](../design-language.md)、[motion.md](../motion.md)
- Decision: [草稿发送稳定等待与合成层位移](../decisions/implemented/bug-fix/2026-09-23-composer-enter-hold.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/`
