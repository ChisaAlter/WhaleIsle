# 动效规范

中文 | [English](motion.en.md)

本文件记录产品动效合同，以及各 recipe 用在哪些产品面上。视觉规则见 [设计语言](design-language.md)。时长、缓动、位移的权威值在官方 [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css) 与 [`motion.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)；工程规则见 [`web-styling.md`](../vendor/deepseek-harness/docs/web-styling.md)；决策依据见 [动效系统 Agent Note](../vendor/deepseek-harness/.agents/notes/implemented/architecture/2026-08-14-web-motion-presence-and-recipes.md)。

对照表按 recipe 与产品面分组，不枚举每一个 Tooltip 或按钮 hover。核对实现时以源码为准：搜 `data-dsh-motion`、`usePresence`、`FlipText`。

## 适用范围

凡改动可见进出场、换文案或持续指示，都受约束，包括：

- 官方 Web UI：`vendor/deepseek-harness/packages/client/**`、`apps/web/**`
- 桌面壳：`src/renderer/**`、`src/main/closing-overlay.js`
- 桌面自有分区与手机端：设置市场（`ui-settings-market`）、远程设置（`ui-settings-remote`）、用量统计（`vendor/dsh-usage-panel`）、手机 Web（`mobile/web`）复用同一套 token 与家族（见下）

## 原则

1. **只动 `opacity` 和 `transform`。** 禁止动画 `backdrop-filter`，禁止引入动画库。布局属性（栏宽、行高、轨道 top/left、进度 width）只允许出现在**布局轨道**清单里（见「同 token、非 recipe」），且拖拽中与减弱动效必须停。
2. **新对话框、菜单、同层切换走 recipe。** 表面从 `usePresence` 写上 `data-dsh-motion` 和 `data-state`，不得另起一套时长或缓动。
3. **触发器换文案用 `FlipText`。** 权限、模型、推理等级这类芯片在所选值替换旧文案时翻转，不闪切。
4. **`prefers-reduced-motion: reduce` 把 `--ds-transition-duration*` 和 `--ds-motion-duration-*` 收成 `0s`。** 新动效必须吃这些 token，才能一并关掉。字面量时长不随 token 归零，减弱动效下会照播——功能 CSS 禁止写死毫秒，这是 token 化的可达性理由，不只是风格。
5. **先复用原语。** `Modal` / `Menu` / `Tooltip` / `HoverCard` / `DisclosureRow` / `OnboardingSurface` 已经带齐 Presence 与 recipe。

## Token

当前值来自 `ui-theme` 的 `base.css`。改时长改主题表，不要在功能 CSS 里写死毫秒。

| Token | 当前值 | 用途 |
| --- | --- | --- |
| `--ds-ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 共享缓动 |
| `--ds-transition-duration-fast` | 100ms | 快过渡；overlay 退场、swap / fade、微交互 hover / 按压 |
| `--ds-transition-duration` | 200ms | 默认过渡；overlay 进场、卡片级 hover、布局轨道 |
| `--ds-transition-duration-slow` | 300ms | 栏开合、Hero 小动效 |
| `--ds-motion-duration-overlay` | 200ms | overlay 进场 |
| `--ds-motion-duration-overlay-out` | 100ms | overlay 退场 |
| `--ds-motion-duration-popover` | 160ms | 菜单 / 浮层、卡片 hover 反馈 |
| `--ds-motion-duration-swap` | 100ms | fade、swap |
| `--ds-motion-duration-flip` | 400ms | `FlipText` |
| `--ds-motion-distance-overlay` | 8px | overlay 面板上移 |
| `--ds-motion-distance-popover` | 4px | popover 上移 |
| `--ds-motion-scale-overlay` | 0.96 | overlay 面板缩放 |

档位只有五档：fast 100 / popover 160 / default 200 / slow 300 / flip 400。历史上散落的 80 / 120 / 140 / 180 / 220ms 字面量已归并到 100 / 160 / 200；不再新增档位，需要新档先改主题表。

`usePresence` 的退场挂载默认 200ms（`PRESENCE_EXIT_MS`），与 overlay 进场 token 对齐。`FlipText` 的 400ms 挂载（`FLIP_TEXT_MS`）独立于 Presence。

## Recipe

共享进出场在 `motion.css`。调用方渲染 `mounted` 为真的树，并把 `aria-hidden` 绑在逻辑 `open` 上，不要绑 `data-state`：进场第一帧是 `closed`，那时隐藏会让辅助技术在进入时读不到表面。

| Recipe | 视觉 | 何时用 |
| --- | --- | --- |
| `overlay` | 遮罩淡入淡出；面板淡入并从 8px / 0.96 落到原位 | 全屏接管：对话框、设置、灯箱、Onboarding |
| `popover` | 卡片淡入并上移 4px | 锚定浮层：菜单、斜杠命令、模型面板、HoverCard |
| `fade` | 只动透明度 | 节点自己用 `transform` 做定位：Tooltip、Disclosure 展开体 |
| `swap` | 仅进场淡入（`animation`，无退场） | 同层换页，例如设置分区 |
| `flip` | 旧文案 `rotateX(-80deg)` 翻出，新文案翻入 | 触发器标签替换，只通过 `FlipText` |

关闭时 `data-state="closed"` 的节点 `pointer-events: none`，避免退场 200ms 内误点。

## 使用对照

### overlay

遮罩 + 面板。设置根不是 `Modal`，但同一套 recipe。

| 产品面 | 实现 |
| --- | --- |
| 设置整页 | `SettingsRoot` |
| 通用对话框 | `Modal`（下面各行都走它） |
| 首次使用接管 | `OnboardingSurface` |
| 图片灯箱 | `ImageLightbox` |
| 风险确认 | `RiskConfirmation` → `Modal`（权限切换、斜杠命令等） |
| Git：提交说明、建分支、错误、提交 / 推送确认 | `CommitDialog`、`CreateBranchDialog`、`GitErrorDialog`、`GitActionsControl` |
| Diff：丢弃更改 | `DiffPanel` |
| 工作区：重命名、删会话、选择失败 | `WorkspaceBrowser`、`WorkspacePicker` |
| 目录选择、新建文件夹 | `DirectoryBrowser` |
| 设置：MCP 增改删、Skills 增改删、模型删除 / 拉取候选、Agent 预设复制 / 查看 / 删除、首次模型引导 | `McpSection`、`SkillsSection` / `SkillForm`、`ModelsSection`、`ModelListEditor`、`AgentPresetSection`、`OnboardingModal` |
| 设置：插件市场分区 | `MarketSection`（桌面自有 `ui-settings-market`） |

### popover

composer 上四个浮层共用此时长：加号斜杠菜单、权限 `Menu`、模型菜单、ContextMeter。

| 产品面 | 实现 |
| --- | --- |
| 通用菜单 | `Menu`（下面各行都走它） |
| 斜杠 / 命令菜单 | `MenuView` |
| `/` 与 `/model` 等弹出选择 | `PopupSelectView` |
| 输入栏模型 / 推理菜单 | `ModelSelect` |
| 上下文用量面板 | `ContextMeter` |
| 工作区行预览卡 | `HoverCard`（`Rows`） |
| 标题栏分支、Git 更多操作 | `BranchMenu`、`GitActionsControl` |
| 输入栏权限 | `PermissionSelect` |
| 工作区切换、会话分组排序、工作区 / 会话行操作 | `WorkspacePicker`、`WorkspaceBrowser`、`Rows` |
| 右边栏加表面、标签上下文 | `SurfaceTabs` |
| 文件树复制路径 | `FileTree` |
| Agent 预设 | `AgentPresetSeat`、`PresetMenu` |
| 设置行：语言、关闭行为、回车发送、权限预设、Harness 重启次数 / 延迟、MCP 启用过滤、Skills 来源过滤 | `LanguageRow`、`CloseBehaviorRow`、`EnterBehaviorRow`、`PermissionRow`、`HarnessRestartRow`、`McpSection`、`SkillsSection` |

### fade

| 产品面 | 实现 |
| --- | --- |
| 所有 Tooltip | `Tooltip`（侧栏、标题栏栏开关、输入栏、队列、消息操作、终端、Git 提示等） |
| 展开行正文 | `DisclosureRow`：推理、工具行、命令卡、上下文注入、Diff 文件、工作流状态 |
| 侧栏工作目录下的会话列表 | `GroupSessionRun`：`fade` 进出场；内层 `0fr` / `1fr` 用 `--ds-transition-duration` 收合，箭头同步旋转 |

### swap

| 产品面 | 实现 |
| --- | --- |
| 设置左侧换分区 | `SettingsRoot` 以 `key={active}` 包一层 `data-dsh-motion="swap"` |

### flip

| 产品面 | 实现 |
| --- | --- |
| 权限芯片文案 | `PermissionSelect` → `FlipText` |
| 模型名、推理等级 | `ModelSelect` → `FlipText` |
| 远程设置芯片 | `RemoteSection` → `FlipText`（桌面自有 `ui-settings-remote`） |
| 设置选择器（语言、回车行为、权限预设、关闭行为、自启、重启策略、MCP / Skills 过滤、视觉模型、协议、网关、图源、价格面板） | `SettingsSelect` → `FlipText` |
| 转录呈现、Agent 预设芯片 | `TranscriptViewRow`、`AgentPresetSeat` → `FlipText` |

### 同 token、非 recipe

这些过渡吃 `--ds-transition-*` / `--ds-ease-in-out`，但没有 `data-dsh-motion`。不要为它们新造时长。

| 产品面 | 行为 |
| --- | --- |
| 侧栏 / 栏开合 | `AppFrame` 过渡 `grid-template-columns` / `rows`、把手 `left`、图标位移；拖拽中暂停；减弱动效时停下 |
| 草稿首次发送 | `ConversationRoot` 测量输入卡位移，短暂停留期间钉住草稿位置；仅真实布局变化延长停留，自身样式写入不重置静默计时。放行后以 `transform: translateY()` 在合成层滑到会话位置，使用 `--ds-transition-duration-slow` 与 `--ds-ease-in-out`；内置 fixed 浮层使用页面 portal，结束后移除 transform；减弱动效归零，切换会话取消 |
| 开关 | `Switch` 滑块 `transform`，`--ds-transition-duration-fast` |
| 按钮、输入、行 hover | 交互色 token，不是进出场 recipe |
| 微交互 | 图标按钮按压、卡片按压位移等 `transform` 反馈，`--ds-transition-duration-fast`；卡片级 hover（边框 / 底色）用 `--ds-motion-duration-popover` |
| 布局轨道 | `TurnNavigator` 回合轨（`height` / `top` / mark 宽，自有 swift 曲线）、`WorkspaceBrowser` 行收合（`max-width` / `margin` / `padding` / `width` + `visibility` 延迟）：布局属性动画，时长 `--ds-transition-duration`，减弱动效停 |
| 侧栏轨道收合编排 | `SidebarRoot`：收合相位 150ms + 回宽 200ms（`wide-in`），跟随 AppFrame 300ms 轨道；减弱动效停 |
| 空会话 Hero 小鱼 | 悬停且未减弱动效时，1.6s 轻摆循环 |

### 手机交互 inventory

`mobile/web` 是[设计语言的手机承载面](design-language.md#手机远程交互)，Android WebView 加载同一份源码；不引入另一套主题或动画库。下表记录当前实现，不把共享 token 等同于已接入官方 React `usePresence`。

| 产品面 | 当前行为与源码 |
| --- | --- |
| 输入框触发的底部面板（附件来源、模型／思考、权限） | `ui/surfaces.js` 的 `bottom` 变体（`data-surface="bottom"`）；`app.css` 的 `bottom-sheet-in` 仅在 `prefers-reduced-motion: no-preference` 下入场：面板 translateY(100%)→0、遮罩 opacity 0→1，使用 `--ds-motion-duration-overlay` 与 `--ds-ease-in-out`；同面板内下钻换页不重播入场 |
| 行菜单与 Git 菜单短面板；目录、Git 表单与完整会话列表全屏任务、确认层 | `ui/surfaces.js` 生成 `.surface-panel`；`app.css` 的 `mobile-surface-in` 仅在 `prefers-reduced-motion: no-preference` 下入场：opacity + translateY(8px)，使用 `--ds-motion-duration-overlay`（回退 `--ds-transition-duration`）和 `--ds-ease-in-out`。全屏任务无浮卡边框，头部与操作区不参与正文滚动 |
| 同一表面刷新/异步结果 | `app.js` 保持 surface identity，设置 `data-refreshed`；CSS 禁止重复入场，避免模型选中、查询结果等更新使整个面板重播。焦点与滚动恢复不是动效 |
| 关闭与返回 | `ui/navigation.js` 与 `app.js` 按当前层处理按钮、浏览器及 Android 返回；当前树直接隐藏/移除，没有官方 Presence 的 200ms 退场挂载，不声称已具备完整 overlay 退场 recipe。返回不能借动画完成事件重放业务写请求 |
| 会话抽屉 | `.drawer` 使用 transform 与 `--ds-transition-duration-slow` / `--ds-ease-in-out`；减弱动效关闭 transition。此项不代表已接入或验收拖动手势 |
| 设置目录/详情、草稿阅读/编辑、灯箱 | 当前为内容/可见状态切换；不登记未实现的 `swap` / `flip` 或高度动画。键盘、viewport 与焦点恢复另行验收 |
| Android 系统返回/IME、媒体选择和前后台恢复 | `RemoteWebScreen.kt` / `RemoteWebBack.kt` / `WebFileChooser.kt` 负责原生承载，不新增网页 motion recipe；系统键盘和活动切换需真机证据 |

减弱动效由 `mobile/web/tokens.css` 将 duration token 归零，并由 `app.css` 的媒体查询关闭入场、抽屉与持续指示。入场/刷新抑制和减弱动效均须在实际动画模式复测。截至 2026-09-06，**早期候选的 60/60 受控 DOM 检查覆盖六种尺寸，不认证最新修订**；snap 动画状态只证明当时的 DOM/几何，不能当作播放时序、退场、焦点时序或真机键盘/手势证据。之后源码已修改，最终源复测因 T3 Code preview 的 evaluate/snapshot/navigate 工具超时未完成。当前 debug APK 已构建，但公网与物理设备尚未验收，不等于 T3 Pass；详见[本轮证据](../tools/mobile-web-qa/results/2026-09-06-interaction/README.md)。

### 指示器家族

无限循环的忙碌 / 加载指示是产品语言，不是 recipe；循环周期是设计值，**不进 token 表**。规则：每个使用处必须自带 `prefers-reduced-motion` 停止；新忙碌指示优先复用家族图形，不要另造一种新旋转。

| 家族 | 实例（周期） |
| --- | --- |
| 骨架扫光 | ReasoningRow / ToolRow / SkillRow / GenericCommandCard / bash-sample 的行扫光 2.6s；`MenuView` 菜单骨架 2s |
| Composer 光束 | `InputBar`：`beam-spin` 默认 1.96s（设置可调顺/逆/往返方向与 0.8～60s 周期）、`beam-hue` 默认 12s（可关闭并调整范围/周期）、呼吸可独立开关；模式、色板、色相、夜间时段和缓动只作用于运行态视觉 profile。stroke track width 可调 0.5～4px，bloom blur 可调 0～12px；1.5px bloom 光源、4px 圆角裁切壳、22px 圆角、两层 ring mask 与强度窗口保持固定；不做重复 `clip-path`。`mobile/web` 手机端仍复刻默认时间值，不跟随桌面自定义 |
| Spinner | `TodoPanel` 1s、`GitProgressToast` 0.7s、`AppearanceSection` 图库 0.7s、`TrajectoryTable` 历史加载 700ms、`TurnNavigator` busy 1s、`ChatView` 回合状态 1.8s、`MessageItem` 重试 1.6s、`InputBar` 待发 1s |
| 指示灯 | `StateDot` 追逐 1s（行内 `-125ms` 错相）、`ConnectionIndicator` 点阵 1.5s step-end |
| 手机 flow | `mobile/web`：`flow-dot-spin` 0.9s、`flow-sweep` 2.6s、`flow-caret` 1s steps(2) |
| 背景特效光斑 | Appearance「背景特效 · 流动渐变」：1–5 光斑 transform 循环，基准 ÷ 用户速度系数（20–300%）；形态变体 orbs 光球（20s/30s/40s）/ aurora 飘带（30–48s 横向 drift）/ chaos（11–18s 多轴乱序 + scale 脉动）/ rays（24–40s conic 楔形旋转）；reduced-motion 全部停（`wallpaper.css`） |
| 按钮悬停金属漆 | `metallic-paint.css`：原生 `button:hover` 叠半透明银灰渐变，`background-position` 4.5s ease-in-out 往返扫（绘制属性而非 transform，仅作用自身背景层、不引发布局，按本条登记）；reduced-motion 停动画、保留静态光泽 |

### 独立例外

这些不走 `motion.css` recipe，也不得扩散到新的 Web UI 弹层。

| 产品面 | 行为 | 源 |
| --- | --- | --- |
| Toast | 160ms 滑入，停留 3s，再 1s 淡出；组件自己计时卸载 | `Toast.tsx` / `Toast.module.css`。输入栏附件上限、模型选择失败等 |
| 桌面启动页 | 海平线场景：亮星 `twinkle` 5.5s 呼吸；`brand-sheen` 6s 周期扫掠（2s 扫 + 4s 停）；水下微粒 `drift` 缓沉；启动态省略号三点 `breath` 依次呼吸；ticker 点 `pulse`；日志抽屉 `drawer-fade` 0.18s 遮罩 + `drawer-rise` 0.24s 升起；boot→harness 在窗控与全尺寸布局就绪后，以 `3 × --ds-transition-duration`（默认 600ms）和 `--ds-ease-in-out` 将启动页快照按 62% 海天线分成上下两片，以 `transform: translateY(-100%) / translateY(100%)` 移出窗口，露出原尺寸主界面；只移动独立透明覆盖窗口中的两片静态图层，不对整个主界面动画裁切，boot 保持不透明到过渡结束；减弱动效直切，不缩放或模糊 | [`boot.css`](../src/renderer/boot.css) / [`boot-reveal.css`](../src/renderer/boot-reveal.css)。海平线画布属文档化例外，见 [桌面启动页](design-language.md#桌面启动页) |
| 关闭遮罩 | 本地 0.85s 无限旋转；不读 `--ds-motion-*`，也没有减弱动效分支 | [`closing-overlay.js`](../src/main/closing-overlay.js) |
| dshbot 机器人头像 | 思考时用同命令数路径连续压扁/鼓边/拉长/侧倾（软泥）；眼白眨眼与瞳孔只动 `transform`；上传图 `scale` 脉冲。缓动走 `--ds-ease-in-out`，减弱动效全停 | [`vendor/dshbot/client/client.js`](../vendor/dshbot/client/client.js)。不得扩散到官方 Web UI 弹层 |
| Agent 预设席位入场 | 图标 150ms / 文案 400ms，`cubic-bezier(0.16, 1, 0.3, 1)` 一次性入场；减弱动效停 | `AgentPresetSeat.module.css` |
| 用量统计图表入场 | 热力格 0.45s、柱 / 环 0.9s，同曲线一次性生长；减弱动效停 | `dsh-usage-panel` `styles.ts` |
| 输入特效 | `TypingFxLayer`：每个键入字符在其字形位置播一次性 echo（`dsh-typing-fx-drop` / `rise` / `flash`，仅 opacity/transform，时长 `--ds-motion-duration-flip` × 100/速度档，速度档 40–240%），活跃 echo 上限 24；`block` / `underline` 自定义光标闪烁 `--ds-motion-duration-flip` × 2.5 step-end。回显画在叠加层，从不包装或改写 Lexical 文本 DOM；粘贴 / 撤销 / 种子不触发；IME 组合进行中不播，提交时整段文本播一次 echo。回显/光标/文本颜色在弹窗配色分区切换：跟随主题（`--dsw-alias-*` token）、6 个内置配色、自定义三色，经 `--dsh-typing-fx-echo-color`/`--dsh-typing-fx-caret-color`/`--dsh-typing-fx-text-color` 变量下发（text 染 `.input` 整体 color）。JS `matchMedia` 生成闸 + CSS 归零双闸，减弱动效全停 | `TypingFxLayer.tsx` / `TypingFxLayer.module.css`（ui-conversation）；外观分区「输入特效」行开关与齿轮弹窗配置 |
| 指针特效 | `applyCursorFxLayer`：全屏叠加层 canvas，指针驱动而非循环——像素拖尾格子 700ms ÷ 速度系数（20–300%）淡出，流体飞溅 Navier-Stokes 染料按速度系数消散；rAF 循环 4s 闲置停帧 + `document.hidden` 暂停；减弱动效整层不挂 | `cursor-fx.ts` / `cursor-fluid.ts`（ui-theme）；外观分区「指针特效」行开关与齿轮弹窗配置 |

## 如何新增

| 要做的事 | 用法 |
| --- | --- |
| 全屏对话框或遮罩面板 | `Modal`，或 `usePresence` + `data-dsh-motion="overlay"`（`mask` / `panel`） |
| 锚定菜单或卡片 | `Menu` / `HoverCard`，或 `usePresence` + `popover` |
| 已用 transform 定位的提示 | `Tooltip`，或 `fade` |
| 同层换一块内容 | 换 `key` 的节点加 `swap` |
| 触发器标签从 A 变成 B | `FlipText` |
| 短暂成功 / 失败条 | 现有 `Toast`，不要新写一套停留和淡出 |
| 持续忙碌指示 | 加入指示器家族（上表），必须带 `prefers-reduced-motion` 停止；不要为一次性反馈另造新的无限循环 |
| 布局属性动画 | 先进「布局轨道」清单（本文档裁决），时长吃 token，拖拽与减弱动效必须停 |

逻辑关闭后树还要挂 200ms。测试用 `aria-hidden` / `queryByRole` 判断已关，不要断言立刻卸载。商店在关闭时清空的，退场帧保留最后一次打开的快照。

## 源码

- Recipe：[`motion.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)
- Token：[`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)
- Presence：[`usePresence.ts`](../vendor/deepseek-harness/packages/client/ui-primitives/src/usePresence.ts)
- 翻转文案：[`FlipText.tsx`](../vendor/deepseek-harness/packages/client/ui-primitives/src/FlipText.tsx)
- 桌面启动页 token：[`boot-tokens.css`](../src/renderer/boot-tokens.css)、[`dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css)

## Windows 原生窗口过渡

主窗口和启动器最大化、最小化与还原由 Windows DWM 执行，服从系统动画设置，不套页面 recipe。壳窗保留透明自绘 20px 圆角，由窄 Win32 桥补回 caption/thick-frame 样式；圆角与原生动画同时验收，不能互相牺牲。页面内部动效不变。门禁与实机验收见 [window-motion](features/window-motion.md)。
