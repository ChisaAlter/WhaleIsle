# DSHD 设计语言

中文 | [English](design-language.en.md)

Windows 任务栏品牌在窗口首次显示前完成：先提交图标、产品名与重启命令，再声明窗口 AppUserModelID，使任务栏刷新时读取完整的品牌信息。

DSHD（Deepseek-Harness-Desktop，本仓库的桌面端应用；区别于 `dsh` CLI，也区别于 `src/main` 里的 dshd 守护进程）的设计语言定义在本文档：它是 DSHD 全部可见界面的唯一视觉权威。语言的基线固定为随仓库钉版的 `vendor/deepseek-harness` Web UI——当前钉 `dsh-v0.1.7-rc.2`（`477b4f420553e8a52c2fbccc464d7561b239c443`），记录在 [`vendor/harness-upstream.json`](../vendor/harness-upstream.json)，由 `npm run sync:harness` 更新。桌面壳、关闭遮罩、标题栏注入、右边栏、手机远程打开的 Web UI 页、以及任何新增前端，都实现同一套语言，不得另起一套皮肤。

「与基线一致」不靠主观印象，按三条硬标准判定，全部落在实物上：

1. **同一张 token 表。** 颜色只来自 vendor `ui-theme` 的 [`design-platform.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css) / [`base.css`](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)；不能 import 主题包的面用同值镜像表：壳层 [`src/shared/dsh-webui-tokens.css`](../src/shared/dsh-webui-tokens.css)（文件头自述与 design-platform.css 同值）、手机 SPA 的 `mobile/web/tokens.css`、Android Compose 的 `DshTokens`。
2. **同一套原语。** 控件复用 [`ui-primitives`](../vendor/deepseek-harness/packages/client/ui-primitives/)：`Button` / `Input` / `Menu` / `Modal` / `Tooltip` / `Switch` / `HoverCard` / `DisclosureRow` / `FlipText` / `usePresence` / `Toast` / `ic_ds_*` 图标（`icons/`）。
3. **同一组数值。** 描边与 hover 透明度、圆角、字号行高、间距、阴影层级以本文档固定值为准（见[强制规则](#强制规则)、[视觉锚点](#视觉锚点)）；这些数值就是从钉版基线蒸馏出的合同。

责任方向是单向的：**先改本文档，再改代码。** `sync:harness` 换钉版只更新代码基线，不自动改设计语言；新基线带来的视觉差异必须先写进本文档裁决，再落到实现。启动页的海平线画布只活在 [`src/renderer/boot.html`](../src/renderer/boot.html)，见 [桌面启动页](#桌面启动页)，不得扩散。

UI 改动先读本文。工程细则（CSS Modules、token 分层、动效 recipe）以钉版 vendor 文档为准：

- Token 源码：[design-platform.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css)、[base.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css)、[gradient-shadow-text.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/gradient-shadow-text.css)、[motion.css](../vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css)
- 控件原语：`vendor/deepseek-harness/packages/client/ui-primitives/`（`Button` / `Input` / `Menu` / `Modal` / `Tooltip` / 图标）
- 工程规则：[web-styling.md](../vendor/deepseek-harness/docs/web-styling.md)
- 动效规范与使用对照：[motion.md](motion.md)

应用对外称 Whale Isle；侧栏保留「鲸屿 / WHALE ISLE」字标与 DeepSeek Harness 来源说明。桌面与 Web 侧栏左侧使用透明头像 [`assets/whale-head.png`](../assets/whale-head.png)，字标下方是「BASED ON DEEPSEEK HARNESS」。仅「屿」使用品牌蓝，头像不带方形底板；收起时左上角的展开按钮保留头像，悬停或键盘聚焦时换显面板图标，点击仍展开侧栏。明暗色只从主题 token 取得，不绘制独立光晕。应用图标沿用白色圆角方形底板（半径为边长 22%），头像居中并四边各内缩 4%；安装器读取相同的生成图标 `assets/icon.png`。窗口、任务栏、托盘和安装器共享此源；`assets/icon.svg` 包装此图，`npm run icon` 生成 `assets/icon.png` 与多尺寸 `assets/icon.ico`。Windows 窗口首次显示前显式声明既有 AppUserModelID、同源图标、成对的重启命令与产品名；源码使用真实 ICO 与绝对项目入口，安装版使用 EXE 内嵌图标及该 EXE 重启命令。原始 Electron 源码运行保留应用内提示，禁止系统通知注册同身份的 Electron 快捷方式。启动时将旧通知自动生成的同身份 Electron 开始菜单条目原字节移到唯一的 `Electron.lnk.backup` 可恢复备份，备份不保留 `.lnk` 扩展名：必须同时匹配固定文件名、应用 ID、Electron 目标、空参数及默认图标；不改用户固定项或其它应用条目。移动成功后仅异步通知 Shell 旧开始菜单入口已移除，使用 SHCNE_DELETE（旧路径，NULL）与 SHCNF_PATHW | SHCNF_FLUSH，不向 Shell 登记备份为新启动入口；原生回调最多等待 500ms，通知失败或超时保留备份并继续启动，不清全局缓存或重启 Explorer。FLUSH 只等待事件投递，不证明任务栏像素正确；首次启动须另行验收。宠物立绘生成器不再拥有应用图标。

关闭遮罩沿用同一主题、文案和动效。等待首次绘制属于尽力显示：主进程最多等待 500ms，隐藏页面不产帧或 renderer 没有响应时继续正常关停，不让视觉反馈阻断已经获准的退出。

## 适用范围

凡改动可见界面，都受约束，包括但不限于：

- `vendor/deepseek-harness/packages/client/**`、`apps/web/**`
- `src/renderer/**`、`src/main/closing-overlay.js`、`src/main/harness-chrome-inject.js`

终端、diff、代码块按基线约定保留等宽、不换行；那是内容排版，不是另做一套 chrome。

## 强制规则

发布整改遵循[回归契约](decisions/implemented/bug-fix/2026-09-28-release-gui-contract-reconciliation.md)。

「新会话」沿用现有入口、草稿画布和输入框，只复用没有历史身份的普通空草稿；已有标题、曾由插件管理或属于分叉的会话保留原身份，不作为新草稿打开。不新增控件或改变视觉样式。

macOS 更新按当前架构选择 DMG，SHA 校验后通过系统打开安装映像；既有更新反馈区提示用户手动拖入 Applications，不宣称已经安装，不自动退出应用。

Harness 同步保持视觉合同；新增组件复用既有 token/原语。布局、slot 或属性迁移须保留标题栏、工作表面、透明壁纸、输入框联动与键入特效。Surface 关闭钮在标题右侧，标题与关闭图标按实际页签盒子共用垂直中心线；通用 28px 与桌面 24px 页签均由布局居中，不用固定顶部偏移补偿。启动页例外不扩散。Files 未保存草稿跨重载与退出保留；关闭脏文件复用 Modal 的「继续编辑 / 丢弃 / 保存并关闭」，保存失败保留页签与草稿。切换页签继续既有防抖保存；选区加入对话保留行号与代码围栏，文件主点击统一进入会话所属的应用内预览。

Files 只保留「文件」目录入口，编辑器由具体文件打开；旧的无文件查看器页签恢复为所属会话的目录。内部 `sidebar://` 地址不作为磁盘路径，已有文件页签与草稿保持原身份。

窗口控件（`window-controls.css`）的系统色例外：最小化/最大化悬停走 `--dsw-alias-interactive-bg-hover` token；唯独关闭钮悬停用 Windows 系统语义色 `#e81123`（红）+ `#fff` 前景，这是平台级「危险/关闭」约定、非主题色，属有意例外，不得改为 token。

已有会话的模型控件在进入或返回会话时自动加载当前选择，不要求先打开模型菜单。发送消息与控件重新挂载不得把已保存的模型显示为「选择模型」；首次同步沿用既有加载文案，目录缺少显示名时沿用 provider/model 标识，不新增控件或改变样式。草稿页行为不变。

消息编辑复用常驻 composer、现有编辑横幅与气泡标记。确认后始终在当前会话重新生成，包括首条消息；侧栏不新增或切换会话，被替换轮次的旧问答从聊天视图移除。取消和失败保留既有草稿恢复与提示样式。

发送消息后，本地回显由同一条持久化用户消息气泡接替；用户消息始终使用基线气泡呈现，不露出未知事件占位或短暂空白。

草稿发送转入会话时，常驻输入框连续到达会话位置，不得先贴底再回弹；消息区、统计行与输入框尺寸变化不能暴露中间布局。沿用已有动效时长与缓动，减少动态效果时直接稳定落位，不新增装饰或改变最终布局。

界面设置的「会话统计」开关即时控制输入框下方的统计数字，不等待配置写回；关闭时保留既有行间隔，重新开启恢复统计，输入框不跳位。

「会话统计 / 会话累计费用 / 官方峰谷时」连续切换时，开关和底部显示始终跟随各自最新选择；写入途中的旧配置推送与过期请求不得令其往返跳变。最新保存失败时才回到已确认配置；费用关闭仍隐藏整条费用与峰谷行。

工作区选择器遵循[远程工作区卡](features/remote-workspace.md)：本机 / 远程页签不移位，统一内容留白与固定操作底栏；加载及失败可取消，错误可重试。

手机远程的连接前入口是桌面鲸屿启动页的窄屏亲缘画布：62% 海平线分割，浅色为雾白天光／蓝海，深色为克制星空／深海，中央使用 `Whale Isle` 与「鲸屿 · MOBILE」锁定品牌；底部紧凑操作坞承载扫码、粘贴、已保存电脑与连接状态。它只覆盖连接、相机权限和扫码入口，不进入已配对聊天。手机端以 `--mobile-connect-*` / Compose `DshTokens` 复述同一语义，不直接导入 `--boot-*`，不复制桌面日志、状态机或窗口控件。

首次连接及保存设备重连显示「正在连接电脑…」；失败在操作坞内显示一条短状态，恢复连接按钮并保留已保存设备，不将长错误独占首屏。不得在连接中继续显示「等待配对」，不得无期限禁用按钮；已连接后的断线自动重连保持不变。Android 内置 WebView 的首要动作必须能进入原生扫码，不得把它误判为普通浏览器并显示“不支持应用内扫码”。

远程 Web 与 Android 共用连接恢复状态：认证后同步目录期间显示同步状态；目录失败在既有抽屉错误行下提供「重试」，不把失败画成空目录。新配对链接取代旧连接尝试，成功后移除 URL 中的一次性 offer；前后台恢复保留草稿并检查连接、重新同步目录与当前会话。沿用现有控件和状态条，不新增独立皮肤。

远程设置的连接方式使用既有分段选择控件，选项命名为「局域网 / 服务器」（英文 LAN / Server）；默认选择服务器，局域网仅作为手动选项。服务器默认中继显示为 `ayase.cn:443`，经 TLS 连接；公网扫码页为 `https://ayase.cn/dshd/`。网关安全信息为只读说明：手机会话经中继端到端加密并使用中继 TLS，局域网 HTTP 配对页仅提供应用文件；不显示无法生效的 TLS 选择器，端口显示实际 daemon 配对端口。地址切换只更新既有说明与输入占位，不改变控件布局、配色或配对协议。

插件市场不额外注入 dshbot 第一方推荐卡；目录来源、卡片原语与通用安装管理保持不变。已安装且目录仍收录的插件在发现卡片与「已安装」行内显示版本或提交差异；有更新时复用小号主按钮提供「更新」。更新状态使用正文 / 次文字与既有成功、警告反馈，不新增彩色卡片、独立进度皮肤或第二套弹窗；更新后仍由桌面 HarnessController 重启生效。

1. **先复用，再绘制。** 按钮、输入、菜单、对话框、Tooltip、开关行，用 `ui-primitives`。不要再造一套圆角、高度、hover。禁用的菜单项可用左侧 Tooltip 解释原因；沿用原语的提示样式。
2. **颜色只走 `--dsw-alias-*` / `--dsw-specific-*`。** 功能 CSS 禁止写 `#hex`、`rgb()`、独立 `--bg` / `--accent`。缺 token 先加主题表，再引用语义别名。
3. **明暗只发生在主题表。** 功能 CSS 不得写 `[data-theme]`、`[data-ds-dark-theme]`、`prefers-color-scheme` 分支。
4. **主色不是电光蓝。** 默认主按钮是近黑（浅色）/ 近白（深色）：`--dsw-alias-button-primary-fill`（浅色即 `rgb(15, 17, 21)`）。品牌蓝是 `--dsw-static-deepseek-500`（`rgb(65, 118, 230)`）及其 alias（`--dsw-alias-button-info-fill`、`--dsw-alias-state-business-primary`），用于信息强调、用户气泡、选中态。禁止 `#2b5cff`、`#6ea8ff`、`#3964fe` 这类平行色板。
5. **描边用透明度，不用实心灰。** 浅色 `rgba(0,0,0,.04/.10/.12)`，深色 `rgba(255,255,255,.06/.12/.16)`，对应 `--dsw-alias-border-l1`～`l3`。栏与栏之间是 1px 发丝线，不是投影卡片墙。
6. **Hover / Active 用交互 token。** 浅色 `rgba(38, 49, 72, .06 / .10)`，深色 `rgba(255,255,255,.08 / .14)`：`--dsw-alias-interactive-bg-hover` / `active`。不要新造一层实心灰底。
7. **圆角按角色分配。** 主胶囊 18（高 36）/ 紧凑 14（高 28）；输入 8；菜单 12；对话框 24；tooltip 8；图标热区 8。禁止 6px 小方块，除胶囊与开关外不使用 999px。主窗口（boot / Harness）与启动器保留项目既定的 20px 透明自绘外框、`corner-shape: round` 和细缘线（宽度为一个物理像素，随 devicePixelRatio 换算；沿用 border-l2 颜色和浏览器 alpha 抗锯齿，不加硬 region 或模糊），最大化归零；不得以系统小圆角代替。Windows 专用原生桥在窗口显示前补回 `WS_CAPTION` / `WS_THICKFRAME`，保留系统最大化、最小化和还原动画；最大化/还原经 Win32 状态切换并用 IsZoomed 确认，不能把 Electron 的铺满工作区判定当作原生状态；`roundedCorners: false` 防止 OS 遮罩再次裁小自绘圆弧。补回样式后必须禁用 DWM 非客户区绘制（`DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED`），禁止透明圆角外出现系统矩形描边或填充；验收须包含桌面合成后的完整四角，页面截图不能替代。20px 圆角与原生动画是同时成立的验收要求，不能互相牺牲。内部内容角、壁纸、透明主题、桌宠与覆盖层保持各自合同。完整契约见 [window-motion](features/window-motion.md)。
8. **字号必须配行高。** 标题 16/24，正文 14/22，紧凑 12/18，Tooltip 13/20。字重 400 / 500 / 600 / 700；Figma 510 渲染为 500。禁止 `font-weight: 650`。
9. **间距是 4 的倍数。** 控件内边距、gap、栏间距用 4 / 8 / 12 / 14 / 16 / 20 / 24。
10. **图标 16px、`currentColor`。** 用 `ui-primitives` 的 `ic_ds_*`。密集标题栏可用 14px。不要引入另一套图标库或彩色填充图标。
11. **动效只动 opacity 和 transform。** 时长走 `--ds-transition-duration*`（100–200ms，flip 400ms）。新对话框 / 菜单用 `usePresence` + `motion.css` recipe。禁止动画 `backdrop-filter` 和大面板宽高，禁止引入动画库。对照与例外见 [动效规范](motion.md)。
12. **阴影只用 lv1 / lv2 / lv3。** 菜单和对话框用 `lv3`；悬浮卡片用 `lv2`；输入条不铺外投影（静止轮廓光 + 发丝描边承担分离）。禁止 `0 18px 40px` 这类重阴影。
13. **毛玻璃止于基线配方。** 遮罩 `blur(2px)`（`--dsw-mask-blur`）+ `--dsw-alias-bg-mask-*`；抬起面用 `color-mix(..., var(--dsw-alias-glass-opacity), transparent)`。使用 `--dsw-specific-menu` 填充的抬起菜单须配对 `--dsw-menu-backdrop-filter`。不要加更重的 blur，也不要每层都铺投影。
14. **滚动条用共享样式。** 禁止组件内 `::-webkit-scrollbar`。
15. **产品文案中文，代码注释英文。** 不要把 VS Code / Material / iOS 的密度和装饰搬进来压过基线 Web UI。
16. **应用对外主名用 Whale Isle，侧栏字标保持既有设计。** `setup:harness` 走 vendor 树自带的 `pnpm run build:official`（`DSH_CLIENT_BUILD_PROFILE=official`）；源码 `npm start` 消费 vendor 产物前确认官方构建记录，发现旧的普通 `build` 产物即补做 official build。桌面与 Web 官方构建沿用上述侧栏字标；「屿」为品牌蓝，头像不带方形底板或本地构建回退文案。字标可使用适配 40px Windows 标题栏的紧凑字级，不改变其余控件字号。改 client 后也用同一条命令重建，不要单独 `build:lib:client` 把品牌打回本地包。
17. **代码高亮按需、分片，不把长任务搬了个位置。** 会话里没有代码块时，语法高亮器一次都不构造；有代码内容时，原文先可见、可复制、可选中，再在同一位置换成高亮结果，不先显示占位。初始化与每个 grammar 的首次 tokenize 各自独立调度，都是后台任务：单个高亮相关主线程任务必须小于 50 ms，且不得靠 `requestIdleCallback` / `setTimeout` 把同一个长任务原样推迟来「达标」。高亮失败或未就绪时降级为完整等宽原文，绝不显示旧输入的高亮结果。已完成的增量 Markdown 缓存、streaming→settled 的 DOM 语义、复制文本不含行号保持基线不变。
18. **终端高吞吐输出有界，背压必须真的约束生产者。** PTY 输出先按 burst 合并再跨 IPC，帧带每会话单调序号；renderer 只有在**把该帧写入自己的终端会话状态之后**才回执，收到 IPC 即回执不算消费完成。主进程按未确认字节数设高/低水位：越过上限就暂停后端 PTY 读取，回落到低水位再恢复。暂停期间输入写入与 resize 不受影响；恢复后必须零丢失、零乱序，退出前的尾部输出照常先 flush。不允许用丢弃数据、无上限队列或「只在 renderer 侧丢弃」冒充背压；后端无法真正停读时必须如实标注背压未完成，而不是假装达标。

## 独立 dshbot 工作流程

插件拥有的固定会话不使用通用 New Session 品牌首屏。空白 Bot/群聊保留底部输入框与消息画布，标题显示实际 Bot/群聊名称；受管会话顶部只保留该标题以及桌面窗口、侧栏/工作台面板控制，隐藏通用会话的预设标签、轨迹切换、Session 日志下载、Git 分支与 Commit 操作。插件正文可像 Hermes Bots 群聊一样提供自己的成员、设置和解散动作，不把开发会话工具混入机器人工作流。不要求用户重新选择工作区，不另造聊天引擎或装饰卡片。普通会话列表、搜索和 New Session 空白复用排除插件拥有的会话；已绑定会话仍可从插件入口打开。

Bot/群聊输入区复用现有编辑器、附件、发送/停止与主题原语，通过通用的受管输入区展示标记收起独立模型选择、工作区权限快捷选择、计划模式、开发统计和预设标签。模型入口由插件提供，单聊显示机器人配置中的模型并直接打开资料编辑，群聊打开群资料而不显示虚假的统一模型。模型配置唯一归属于机器人资料；未指定时跟随当前应用默认，切换联系人不得写入应用默认。此展示标记不是权限控制，既有工具审批与能力限制仍然生效。参考 Hermes 的共享编辑器和 Bot profile 跟随规则；单一配置入口是针对本产品重复模型入口问题的适配，不声称 Hermes 删除了模型选择器。

受管输入区隐藏开发统计行时仍保留与普通会话统计行等高的底部占位，使输入卡到视口底边的呼吸空间在普通会话、Bot 与群聊之间一致。展开侧栏的一级区域切换占满可用宽度并将选项等分；Bot 页的「联系人 / 任务 / 定时」使用同一 32px 高、8px 圆角、透明静止面与 hover/selected token 的区域切换合同，也占满可用宽度并等分，不再使用内容宽度的独立 Pill 外观。折叠侧栏维持既有圆形纵向导航。

固定 Bot 会话保留同一身份和历史边界；在该会话中执行通用 `/new`、`/reset` 时改为同 Session 压缩上下文，不得创建、切换或复用普通草稿会话，普通会话命令行为不变。Bot 的 `name` 是稳定地址，`title` 是可编辑展示身份；标题为空时回退名称，标题变化同步联系人、会话标题、群成员显示、任务/A2A 可见来源与 Agent 目录，但不得改写 ID、路由或名称唯一性。联系人行的主预览取绑定 Session 的最近安全文本，群聊取最近用户或成员可见消息；模型名只作辅助元数据，不能替代最近活动。后台回复、A2A、任务与定时结果以持久 last-seen 水位产生未读标记，打开对应 Bot/群聊后清除，客户端重启后仍保留，首次启用不得把安装前旧历史误报为新消息。A2A 历史使用真实发送 Bot 的稳定 Session 身份呈现，不退化成无来源注入。群聊主动停止显示 stopped / held，清除待处理交互并抑制不应接纳的晚到回复，不得把用户停止渲染为成员失败；sticky hold 只由后续用户的明确恢复或重新点名解除，普通新消息不得静默释放。

群聊正文采用 Hermes Bots 的 thread 结构而不是普通 DSH 对话记录：底部常驻输入框发送时创建新 thread，展开 thread 内的「回复」动作复用同一常驻输入框、附件上传和提交状态，并继续目标 thread；取消回复恢复进入前草稿和附件。每条用户/成员消息持久归属一个稳定 thread，历史无标记记录只在读取时确定性迁移，不改写原日志。最新 thread 默认展开且不显示无必要的收起命令；较早 thread 折叠为首条摘要、回复数和最近时间，展开后才显示「收起本轮对话」。用户可独立展开/收起这些历史轮次，每个展开 thread 显示完整成员身份、附件、失败/停止/等待交互状态。成员选择、轮次、发言上限、水位、提及接力和迟到结果均按目标 thread 隔离；房间级 held 状态跨 thread 保留。新 thread 不得让旧 thread 的完成结果消失，thread 回复不得带入其他 thread 或私聊历史。Host/桌面端重启后恢复原 thread、原成员调用和原待处理审批/提问，不复制用户消息、成员消息或工具调用。群聊正文通过通用按 Session 选择的 Conversation body 扩展点接入，普通会话仍使用原 Chat View，不为 dshbot 硬编码宿主判断。

群聊的信息层级参考 OpenBot 的多人会话而不是复制其皮肤：宿主会话头部是群名的唯一标题，正文不得再次重复群名和成员数。正文顶部只保留一条无卡片的紧凑参与者栏，以头像表示成员并通过 tooltip / 无障碍名称提供身份和实时状态；设置与解散仍是尾部图标动作。最新 thread 视觉上是一段连续多人对话，不画左侧 thread 轨道；只有显式展开的历史 thread 使用缩进轨道说明轮次边界。成员全部空闲时不铺「空闲」状态行，没有运行活动时也不显示「活动 / 还没有活动」占位。只有成员运行、等待、跳过、失败、停止或运行态加载失败时才显示紧凑状态/活动入口，停止动作与错误必须保持可见。没有正文的 passed / failed / timeout / held / stopped / capped 等成员执行结果归入当前轮次活动区，不得带头像伪装成一条聊天消息；真正的用户和成员发言才进入正文。OpenBot 的 AgentGroup 广播属于向成员分别创建后台任务，不得冒充或替换这里的 Hermes 共享群聊语义。

群聊正文使用 Conversation 已有的 composer-overlay 展示标记：正文高度必须被限制在标题栏与输入区之间，由群聊内部滚动区滚动，最后一条消息、线程操作和活动区不得落在输入框下方或把扩展视图按历史内容撑出视口。插件 body 已接管空白 Session 时，宿主用于普通空会话的占位画布不得继续参与 flex 布局或分走正文高度。已有成员但没有消息的新群沿用 Hermes Bots 的群聊空态语义「说点什么 — 这个群里的每个机器人都会听到。」，不得显示添加联系人或成员数量要求。左栏不重复常驻一块群运行态面板；正常、加载中和无成员运行数据只在群联系人行与群页状态条呈现。只有待审批/提问、成员错误或成员会话缺失等需要处理的状态，才在左栏联系人列表上方展开可操作区域。

完整工作流扩展沿用相同表面：Bot 页增加「定时」Pill，采用可滚动任务行和编辑 Modal，不新增仪表盘。联系人可归入用户创建的命名分组；新增、重命名、排序、折叠、移动和删除均在列表原位完成，删除分组只让成员回到「未分组」并提供限时撤销，绝不删除联系人。筛选菜单复用紧凑 Menu，提供 Bot/群聊、活跃/最近/较早以及真实来源选择；没有多来源注册表时只显示当前来源，不制造虚假网关。列表仍以置顶优先、最近活动次序排列，筛选与分组不能让任一匹配联系人消失。定时编辑使用名称、机器人选择、任务正文、结构化频率选择、启用复选框与可选运行次数上限；频率覆盖一次执行、分钟/小时/天间隔、每天/工作日/每周/每月以及五段 cron 高级输入，展示并持久化实际时区。窄屏下间隔数量、单位和运行次数不得把中文字段名挤成逐字竖排；标签占独立一行，数值与单位在下一行保持稳定网格。行内提供运行、启停、编辑、删除，显示原始计划、下次时间与实际排队/失败状态，不把排队写成执行成功。能力配置在机器人资料中按工具、Skills、MCP 工具分组，以 SettingsSelect 的继承 / 指定模式加复选框选择已发现能力；不可用与已失效项明确呈现。Bot 资料里的管理入口必须调用 Harness 真实的 Skills 安装/启停、工具凭据配置与 MCP 增删/启停/测试/登录能力；Skills 安装面展示公开仓库与精确路径，区分用户/当前项目作用域，执行前确认，禁止静默覆盖，并将 GitHub CLI 缺失、版本不足和冲突错误保留在当前上下文。搜索结果区分可安装、同一 GitHub 来源已安装与本地同名冲突；已安装状态通过技能目录内的持久来源元数据跨重启恢复，同名但来源不明的技能禁止覆盖。若宿主缺少按 Bot 隔离作用域，应明确标为应用级并要求用户确认范围，不能复制一套不生效的假配置。群聊轮数和发言上限使用有界数字输入。任务操作只按真实状态开放：排队可暂停、暂停可恢复、未结束可取消、失败/取消可重新委派；重试和取消先确认，取消记录与停止整个机器人会话不得混淆。停止会话用明确命令和确认，不暗示可撤销已发生的副作用。所有编辑窗、来源与能力列表在 320px 窄屏可滚动且无横向溢出。

群成员需要审批或澄清时，Bot 页的群运行态在对应成员行内直接呈现真实待处理交互，不要求用户离开群聊去寻找隐藏成员会话。审批提供拒绝与单次允许；提问保留完整问题批次、单选/多选、自定义回答、跳过和取消，并调用 Harness pending interaction 自身的 `answer()` / `cancel()` 完成原请求。待处理交互以 Session 日志中的稳定请求 ID 为准；Host 或桌面端重启后重新加载同一请求，回应必须幂等地续接原 turn / step / tool call，不重发用户消息、不复制工具调用，也不把已回应请求重新显示为待处理。对已开始但结果未知的外部工具执行保守失败，不能为恢复而重复副作用。界面不得复制请求、预填未经用户选择的答案或在交互仍等待时显示为已完成；只有真实 pending carrier 不可用时，才显示打开精确成员 Session 的降级入口和明确错误。

独立安装的 dshbot 沿用本语言，不改变桌面默认装配或市场推荐。Bot 页内以同一级区域切换合同切换「联系人 / 任务 / 定时」；任务是紧凑可滚动行列表，搜索与状态筛选使用 Input / SettingsSelect，不铺统计卡片。任务详情复用居中 Modal，展示状态、参与者、任务正文、约束、验收条件、结果或错误、时间与事件记录；参与者会话通过明确按钮打开，不占右侧 surfaces。所有长名称、任务 ID 和正文可换行，窄屏不横向溢出。当前可操作状态只对应 queued / delivered / paused / completed / failed / cancelled，「已送达」不写成「运行中」；旧数据中的 expired 仅作为不可变终态兼容显示，不进入新建、筛选或重试选项。排队可暂停、暂停可恢复、未结束可取消、失败或取消可重试为新的关联任务；界面只展示 Host 已提供真实执行接口的动作。

Bot 编辑资料中的「消息与任务来源」使用 SettingsSelect 选择「默认规则 / 指定机器人」，后者以复选框选已有联系人。默认规则保留现有语义：消息不限制、仅同群成员可委派；指定列表非空时仅列出的机器人可发消息与委派，包括同群成员。列表为空不能冒充拒绝全部。加载、不可用、只读、保存错误及版本冲突使用既有状态文字与错误行，不能伪装成空列表或保存成功。复用现有头像、主题 token、原语和动效，不引入新配色或新侧栏皮肤。

Bot 的确定性形状头像沿用 Hermes Bots 的状态化动态脸：空闲时只做低幅呼吸、轻摆和自然眨眼，绑定 Session 或群成员运行时切换为更明显的姿态、视线与三点工作节奏；联系人当前选中态在头像外增加基于现有边框与业务色 token 的双层环。所有形状头像共用一个最高 15fps 的可见性时钟，窗口隐藏、头像离屏或没有挂载头像时停止更新；`prefers-reduced-motion` 下保持静态。用户上传的图片头像不得拉伸变形，只保留选中环和既有状态点。不得借此恢复头像生成。

机器人资料页中的工具、Skills 与 MCP 能力组保持紧凑：主表单只呈现模式、授权范围、选择摘要和“选择”命令；具体复选框清单在同一套 `Modal` 弹层中编辑。弹层必须可滚动，在 320px 宽度下不得横向溢出；“取消”丢弃本次弹层改动，“完成”仅写回资料草稿，最终仍由资料页“保存”持久化。

## 视觉锚点

预览动作按呈现位置命名：Browser 浮在聊天可视区内的预览称「悬浮预览」，Files 将已保存文件送入置顶原生子窗口的动作称「独立窗口预览」。Browser 的系统级 PiP 也属于独立窗口。交付卡片中的 HTML / HTM / XHTML / PDF 主点击先在聊天区显示 Browser 悬浮预览，右栏保持关闭；浮层上的「在右侧栏打开」再把同一个 guest 放到 Browser 右栏。Browser 页仍保留显式悬浮入口。

Browser 悬浮预览参照 T3 Code 的 mini player：默认 320×200，距聊天区右上角 12px；网页是主体，不加四周宽边框与外露的八向缩放刻线。桌面原生 BrowserView 会盖住 renderer 控件，因此顶部只留承载文件名与操作的窄条，网页从窄条下方铺满窗口。可见标题取当前文件名，普通网址退回主机名；顶部采用 DSHD 的语义底色、主文字色与幽灵图标按钮，只保留打开右栏和关闭动作，不放缩放按钮或装饰性状态点。四边与四角在网页矩形外侧提供透明拖动命中区，沿对应方向调整大小；不画常驻边框。外壳沿用 Web UI 的轻量阴影，不另造面板皮肤。

Browser guest 在右栏与聊天区浮层间迁移时，离任表面的卸载不得再隐藏 guest；只有当前呈现所有者负责 `previewShow` / `previewResize` / `previewHide`。恢复右栏后 guest 立即采用右栏当前可视边界，并保留 URL 与页面状态。

会话正文的行内代码沿用等宽字与现有小圆角，但底色使用低对比的中性透明层（浅色约 6%、深色约 8%），不得用接近纯白的实色胶囊盖住聊天画布。可点击的文件提及仍用既有链接色与焦点反馈区分，不能仅凭底色暗示可点击。

Browser 空白页、导航工具栏与尚未加载网页的 guest 占位区透出 `AppFrame` 已绘制的右栏底色，不在嵌套容器重复铺半透明填充；地址输入保持既有抬升面，其占位文案与空态提示使用次级文字色，禁用图标使用三级文字色。网页加载后由网页自身绘制内容。

对照基线自检——基线就是本地 `npm start` 起来的钉版 Web UI，不是记忆或截图里的某个版本：侧栏浅灰蓝底、会话区干净画布、用户气泡淡蓝、发丝分隔、胶囊主按钮、16px 线框图标、菜单 12 圆角 + 轻阴影。新块放进 DSHD 的任何一面时，不应一眼能看出是「另一套产品」。

| 角色 | Token / 几何 |
| --- | --- |
| 画布 | `--dsw-alias-bg-base` |
| 侧栏 | `--dsw-specific-sidebar-fill`；rail 铬面经间接 token `--dsh-sidebar-rail-fill` 解析，外观「隐藏侧栏遮罩」开启时写为 `transparent`：透出 `.frame` 画布底色与工作区完全对齐，只留右缘分割线 |
| 抬起层 | `--dsw-alias-bg-layer-1`～`3` |
| 终端井 | `--dsw-alias-terminal-pane`；背景激活时按独立的「终端透明度」滑杆混色（40–100，默认 75），不跟随玻璃滑杆；低于 75 时设置页给 TUI 选中行可读性提示，不钳制 |
| 主文字 / 次文字 / 说明 | `--dsw-alias-label-primary` / `secondary` / `tertiary` |
| 用户气泡 | `--dsw-specific-bubble` |
| 选中行 | `--dsw-specific-sidebar-nav-item-active`（强调用 `*-accent`）；设置侧栏导航沿用上游中性选中底色，浅色为 `#EBEEF2`，不使用强调色 |
| 字体栈 | `--dsw-font-family`（系统 UI + 苹方 / 雅黑）；代码 `--ds-font-family-code` |

设置侧栏导航禁止浏览器默认的黄色焦点轮廓。仅键盘焦点使用与设置入口一致的 `2px solid var(--dsw-alias-label-primary)` 内描边（`outline-offset: -2px`）；鼠标选中只显示中性选中底色，不额外画边框。

助理身份统一用 [`assets/whale-head.png`](../assets/whale-head.png)，禁 emoji：侧栏、空态、桌宠卡、16px 标题栏头像。

侧栏有官方账户入口时，设置与远程配对收进账户菜单；否则保留原入口。更新和连接状态独立呈现，空行不占位。两种入口打开同一设置面板；从菜单打开的弹窗关闭后焦点回到账户按钮。远程菜单复用 16px 手机图标和原配对弹窗。不可见的设置触发点供深链和快捷键使用。设置导航与页标题称「鲸鱼娘」，用既有 SegmentedTabs 分「聊天与能力」「桌面形象与行为」；复用 Setting-Cell、控件和弹窗。助理身份与 IM 在前页，形象、行为和互动在后页。

桌面账户登录在授权链接就绪后自动打开系统浏览器；等待弹窗继续显示复制链接的手动入口，浏览器打开失败不关闭该弹窗。同一登录尝试不重复弹出浏览器。

布局：`AppFrame` 是栏，不是卡片网格。关着的栏宽度为 0 且不画分隔线。标题栏尾簇是 28×28 图标按钮，给窗口控件留出实测避让，不要自绘一套窗口皮肤。`main` slot 的非会话面板（插件管理等）只挂在标题栏行之下的内容行，由 `AppFrame` 的 `mainPanel` 容器承接；`conversation` 是唯一跨整列两行、自带 subgrid 的面板，其他面板不得把内容伸进标题栏行。桌面只用**一个全高右栏**：`ui-sidebar-right` 统一入口与内容页签；移除 `ui-surfaces` 独立栏及互斥切换。顶部页签末尾有新增键；隐藏栏内的分栏、全屏和收起按钮。`Ctrl+\` 与标题栏按钮开合同一容器。点卡、切页不得改变栏宽、分隔线或聊天区；关闭末页原位返回入口。无页签时使用 DSHD 原有居中两列方形入口：内宽上限 320px、间距 8px、圆角 12px，图标 / 标题 / 说明纵向居中。右栏 surface Tab 的关闭控件在标题**右侧**；未经用户明确要求，不要把它挪到左侧。工作区文件与产物的主点击留在应用工作环内：交付卡片中的 HTML / HTM / XHTML / PDF 先进入聊天区 Browser 悬浮预览，其余浏览器文档进入右栏 Browser，其他可读文件进入右栏 Document Preview；统一右栏文档预览头部的独立窗口预览是显式次级动作，系统默认程序仅用于右键命令或工作区权威之外的回退。独立窗口文件预览是单实例、只读、置顶的原生子窗口：保留系统标题栏与关闭命中区，内容面直接使用官方 Web UI canvas / `--dsw-alias-*` token，不套卡片、不引入第二套壳层皮肤；图片、音视频按 contain 居中，文本 / HTML / PDF 占满可滚动内容区，打开下一文件原位替换。它与 DockKit 的页内 float 是不同层级，后者不创建原生窗口。Browser 另提供 `dshd mini-player`：它是同一 Browser guest 的 renderer 浮层投影，挂在 `shell.overlay`、限定在聊天可视区内，可拖拽，并从四边与四角拖动调整大小；浮层只迁移 guest 的呈现边界，不创建第二个 BrowserView 或外部窗口。浮层工具条使用现有 `ui-primitives` 图标按钮与 `--dsw-alias-*` 角色色，guest 像素区与拖拽/缩放命中区分离，关闭或恢复后回到原 Browser surface 且保留 URL / history。

会话顶部：常驻 header 与 Session header 共用一条标题布局轨道，只由外层提供内边距；标题、视图页签和右栏顶部保持基准对齐。嵌套 Session header 不再独立占列或重复推开内容。右栏展开后，标题行按扣除标题栏尾簇的**实际可用宽度**收起次级 Agent 操作；打开方式和右侧尾簇之间至少留 8px，按钮不可互相覆盖。标题可省略，但不能靠裁掉相邻按钮来假装有空间；收起项由箭头找回。

会话标题栏的「在应用中打开」、默认收起的 Session 日志和 Git 操作胶囊统一为 32px 高、18px 圆角、`0.5px solid var(--dsw-alias-border-l2)` 外描边，图标统一为 14px；分段控件内分隔线也用 `--dsw-alias-border-l2`。Git 状态尚未载入、会话无工作目录或状态读取不可用时，整组 Git 操作（分支、主按钮、下拉）隐藏；已确认是非 Git 仓库时仍显示「初始化 Git」，有效仓库的禁用动作仍可通过菜单说明原因。文档预览栏的文件打开控件仍使用自身的紧凑尺寸。

48px 标题栏仅空白可拖拽；会话层级导航、Agent 操作、目录按钮和插件入口在 Windows/macOS 均须可点击。当前会话标题和 Agent 预设为只读标签；祖先会话、Agent Team 及其它按钮可点击。

后台任务菜单须跳出标题栏裁切；思考折叠行不画底线。

输入条：`InputBar` 胶囊卡（22 圆角）静止态自带整圈轮廓光——`inset 0 0 12px 1px rgba(255, 255, 255, 0.25)`，四条边与四个圆角均匀包裹（inset 光天然跟随 `border-radius`；浅色主题白上加白自然隐形，不写主题分支）。卡片不带外投影（elevation-soft 不上输入条），分离由轮廓光 + 发丝描边承担；壁纸亮部透过玻璃只做环境叠加，轮廓光才是自有合同。运行态思考炫光（beam）参照 Libraries.dev Border Beam 的 Rotate / Large / Colorful 层次叠加在这圈轮廓光之上：未滤镜的命中壳在卡边外扩 4px 并继续 `overflow: hidden`，22px stroke / inner 内缩回原卡边，stroke 以 0.6 透明度、inner 以旋转窗口共同形成移动亮区，masked bloom 光源由外层容器以 `blur(8px)` 模糊并以 0.36 透明度进入这圈圆角光晕；4px 小于 composer stack 的 6px 间距，因此不盖住 dock。空会话 Hero 的 workspace / agent-preset 行与输入卡共享实际宽轴：有已保存宽度时读取 `--dsh-composer-resized-width`，否则回退 `--dsh-composer-card-max-width`，整行在 composer stack 内居中，不能留在外层满宽左缘。静止/运行的层级靠流光对比，不加新色板。壁纸模式下输入条背后不铺座位暗带：输入卡与统计行直接坐在壁纸上，任何带状填充都会读成输入框投下的阴影。

草稿首次发送只在切入会话的短暂滑行期对输入卡栈使用 `transform` 位移，让位移由合成层绘制；Hero 静止布局不使用 transform。内置的 fixed 浮层挂在页面 portal，滑行结束即清除栈的 transform，后续弹层继续使用视口坐标。减少动态效果时直接落位。

思考炫光不是常亮彩色整圈：2px stroke 使用参考实现的旋转 conic 强度窗口，inner 使用同方向的双 conic 窗口，允许尾迹之外透明；移动 filament / bloom 是唯一高亮峰，静态 rim 负责始终完整的四边与四角轮廓。圆角按**整轮经过性**验收：24 个冻结角度内，亮峰必须完整经过四个 22px 圆角弧，经过时与相邻直边连续、没有平切或缺口；同时至少存在暗帧，防止再次退化成整圈等亮霓虹。stroke 保留 `border-radius + 两层 ring mask`，不得叠加第二层 `clip-path` 抗锯齿。

输入卡及其 beam 裁切壳、stroke、inner、bloom 光源明确使用 `corner-shape: round`，不跟随全局 superellipse。各层共用圆弧几何，保证 inset 静止轮廓光可见，并与 inner 的圆弧裁切一致。stroke 升至 2px 以覆盖 100% 缩放下的圆角抗锯齿像素；bloom 光源仍为 1.5px。像素验收必须加载产品全局圆角样式、归一化系统缩放，并额外检查静止轮廓的四角覆盖，不能只检查动态亮峰。

界面设置里的「发送消息时的思考炫光」保留即时开关，并在开关左侧提供 28px 齿轮图标按钮打开官方 `Modal`；Switch 的右边界必须与同组其他设置行共用同一条对齐线，不能因增加齿轮而左移。弹窗只配置这一条运行态 beam：第一批提供顺/逆时针/往返方向、0.8～60s 单圈周期、整体强度、bloom 强度、整体色相、呼吸与色相循环；第二批增加 lounge / aurora / reactive / custom 模式、8 个内置色板或 2～6 个自定义颜色、0.5～4px stroke 宽度、0～12px bloom blur、夜间时段与亮度、缓动、最多 5 个用户预设，以及 v1 JSON 剪贴板导入导出。弹窗内用同一套 beam 图层实时预览，保存时将 active style 与预设库作为一次 `ui-conversation` namespace mutation 写入，取消不改当前值，恢复默认回到现有 1.96s / 原方向 / 原强度 / 原色相的 legacy 视觉基线。模式只是视觉 / 运动 profile，不读取聚焦、输入、发送、完成、失败或其他业务状态，也不扩展为第二套状态灯。

配置允许调整 stroke 的 track width 与 bloom 的 blur，但不得改变 1.5px bloom 光源、4px 裁切壳、22px 圆角、两层 ring mask、pointer-events 或强度窗口；legacy 默认值必须与改动前等价。减弱动效下预览与实际 beam 都隐藏，但设置值保留；移动端继续使用默认时间值，不继承桌面自定义。

背景特效「流动渐变」是无背景图时的环境底：复用壁纸固定层，线性渐变底 + 1–5 个循环位移光斑，`mix-blend-mode: hard-light` 收进一层模糊容器。默认颜色只来自主题表新增的 `--dsw-specific-gradient-*`（`design-platform.css` 明暗两半各一份）。设置侧是 Appearance 收束行（标题 + 说明 + 齿轮 + Switch，与「输入特效」同款）；齿轮打开 `Modal`：与画布共用光斑形态规则的实时预览（配色、速度、数量、形态均随草稿变化，弹窗开启期间无关主题刷新不重置草稿）+ 预设方案卡片（跟随主题 / 极光 / 晚霞 / 海洋 / 樱花，预设只写配色）+ 常显自定义控件（7 色槽留空回 token、速度 20–300% 作 keyframe 时长除数、光斑 1–5、光斑形态：光球 / 极光带 / 混沌 / 光束，经 `#dsh-gradient[data-variant]` 切换且仍只动 transform）+ 重置 / 取消 / 保存。光斑动画只动 transform（20–40s 基准，见 [动效规范](motion.md) 指示器家族），`prefers-reduced-motion` 全停。有背景图时特效暂停不绘制；特效不算壁纸，透明主题仍只认背景图。特效与壁纸共用 `--dsw-alias-bg-mask-1` 压暗与玻璃透明度表面混合，不开第二套遮罩；输入区遮罩带与聊天滚动条对特效同样放开（滚动条滑块默认隐藏、悬停才显示）。控件不进壁纸行、不在页内联展开。

指针特效是指针划过处的装饰层：全屏固定叠加层（`#dsh-cursor-fx`，pointer-events 全穿透、画在整个 UI 之上）内二选一——「像素拖尾」按网格给指针轨迹盖章淡出（2D canvas，ReactBits `PixelTrail` 等价移植），「流体飞溅」把指针位移注入 WebGL Navier-Stokes 染料模拟（ReactBits `SplashCursor` 移植）。设置侧是同款收束行（标题 + 说明 + 齿轮 + Switch），齿轮开 `Modal`：特效类型卡片 + 画布实时预览 + 预设方案（跟随主题 / 彩虹 / 极光 / 晚霞 / 海洋 / 樱花，预设整包写配色 + 速度 + 大小）+ 常显自定义（6 色槽留空回主题 accent、速度 20–300%、大小 25–300%）+ 重置 / 取消 / 保存。开关只写 enabled 位，特效与滑块值保留；`prefers-reduced-motion` 不挂载，无 Canvas/WebGL 静默不挂、无 DOM 残留。rAF 循环带 4s 闲置停帧与 `document.hidden` 暂停；空配色回退 `--dsw-alias-brand-primary`，控件与卡片只走 `--dsw-alias-*` token，不写颜色字面量、不写明暗分支、不引动画库。

按钮悬停金属漆（`metallic-paint.css`，源自 ayase motion 目录 MetallicPaint 的 CSS 移植）是全局唯一的附加 hover 层：主 Web UI 内非禁用原生 `button` 悬停时，在原有 hover 填充之上叠一层半透明 `linear-gradient` 色带（115deg、320% 尺寸、4.5s ease-in-out 往返扫过），即「原本效果 + 金属漆」叠加而非替换。扫光画在按钮自身 `background-image`：随控件 `border-radius`（含全局 corner-shape）自然裁切，不改 `position` / `overflow`，不占 `::before` / `::after`。色带只经 `color-mix` 取 label alias token 的透明度：亮带 `--dsw-alias-label-primary-foreground`（主按钮文字色，与填充天然对比、保护图标可读性），暗带 `--dsw-alias-label-primary`，过渡带 `--dsw-alias-label-secondary`——不写颜色字面量、不写明暗分支，随主题明暗自动反转并随自定义主题染色。覆盖范围止于原生 `button`：`role='button'` 行（DisclosureRow / ToolRow / 命令卡）、`<select>` / `<input>`、boot 页、启动器、壁纸图库窗与 mobile/web 不扫。`prefers-reduced-motion` 停扫光、保留静态光泽。界面设置「按钮悬停光泽」开关（`metallicPaintEnabled`，默认开）在 document root 增删 `data-dsh-metallic-paint` 属性——关闭后扫光规则整体不命中，按钮只剩原 hover 填充。

## 允许的例外

- **xterm / diff / 代码**：等宽、ANSI、字符网格，不套胶囊按钮。
- **原生窗口控件**：最小化 / 最大化 / 关闭保持系统命中区；颜色仍跟随当前主题 token。
- **无法 import 主题包的壳层**（远程登录页、手机 Web SPA、Android Compose）：复用同一套语义色和几何。手机 SPA 把 `--dsw-alias-*` 抄进 `mobile/web/tokens.css`；Android 抄进 `mobile/android` 的 Compose `DshTokens` / `Color` 表。都不挂官方 CSS Modules，也不把启动页 `--boot-*` 带过去。禁止再开 `--bg` / `--accent` 平行色板，禁止 Material 默认紫或动态取色覆盖语义表。Git 胶囊上的 Commit / Push / Pull 等 action 标签保持英文。
- **桌面启动页**：整页海平线画布与独立 `--boot-*` 表，详见 [桌面启动页](#桌面启动页)。

## 手机远程交互

远程 Web 与 Android 原生聊天的已配对页面结构参照 Claude 移动端；连接前入口采用受控的鲸屿海平线画布。Android 的 Compose 聊天主路径暂复用不可见的同源 Web 客户端作加密传输，复杂工作页保留明确的过渡入口；颜色、字体栈与明暗仍只取同值语义 token 表，不引入第二套产品皮肤，桌面端不受影响。完整契约见 [design-language-mobile.md](design-language-mobile.md)；决策见[手机远程 Claude 式结构](decisions/implemented/product/2026-09-24-mobile-remote-claude-structure.md)。

## 桌面欢迎窗

启动直达工作区，不弹欢迎或引导；配置留在设置，见[契约](features/desktop-welcome.md)。

## 桌面启动页

安装与首次准备沿用现有反馈面：启动器进度卡显示真实下载字节、速度、重试次数与等待安装向导的提示；未知总大小不显示百分比，校验和安装阶段不沿用下载百分比。首次解压在底缘日志 ticker 中报告已耗时及目标目录，不估算完成比例。空间不足、安装失败和同版本修复未确认必须有可执行说明，未确认不得显示「安装完成」。

内置插件开关获准重启后，先切回本恢复画布，再异步停止旧服务；等待期间不得把失去后端的设置页留作静止画面。

启动页是整窗一张海平线画布，不是中间再套卡片。源文件是 [`boot.html`](../src/renderer/boot.html)、[`boot.css`](../src/renderer/boot.css)、[`boot-tokens.css`](../src/renderer/boot-tokens.css)、[`boot.js`](../src/renderer/boot.js)。

62% 高度的交接线分上下两半：线上天空（深色=深空，星云、银河带、星尘与亮星闪烁；浅色=高空，积云与天光），线下深海（调暗、表层透光、悬浮微粒、暗角）。交接线是 1px 细线，不加辉光；水下无光束、无涟漪。中央依次是 `Whale Isle` 衬线字标（Didot/Bodoni 系，窄亮带 6s 扫掠）与状态；副标两行：鲸屿字标两侧细线 / BASED ON DEEPSEEK HARNESS（不闪）。启动态只呈现「启动中」与三点呼吸省略号，其余态收起。异常或恢复时动作面回中央（重试 / 取消自动重启 / 下载日志 / 回启动器排查，按 recovery gating）。

日志收进底缘：单行 ticker（脉冲点 + 最新行 + `L NN` +「全部日志」；优先级：恢复/动作回执 > 状态提示 > 最新日志），点击、Enter 或 Space 升起带行号的毛玻璃日志抽屉（上限 400 行），Escape / 遮罩 / × 收回；不自动弹，重要行经 `isImportantBootLog` 标红。进度只展示真实事件；插件加载留在本画布。桌面完成窗控与布局后用双倍基础时长淡入，加载画面保持不透明垫底，完成后才遮盖；减弱动效直切，不缩放或模糊。启动器跳板只在 settled `error` 且恢复非 `scheduled`/`restarting` 时出现。

色与主题：[`boot-tokens.css`](../src/renderer/boot-tokens.css) 是唯一色表（天空/海面、星场与水下各层、交接线、告警、字标扫光、抽屉面板全部进 token）。`html[data-boot-theme]` 让 [`theme.js`](../src/renderer/theme.js) 只切 `theme.scheme` 明暗半，不写用户主题 `bg` / `accent`。[`boot.css`](../src/renderer/boot.css) 只引用 `--boot-*` 与基线字体、动效 token，不写明暗分支与颜色字面量。`prefers-reduced-motion` 冻结扫光、星闪、微粒、省略号与抽屉动效。

窗控沿用 [`window-controls.css`](../src/renderer/window-controls.css) 交互色；boot 与主界面同为 32px 方钮、8px 圆角、零间距、内边距 12px 8px 4px。禁用 NERV / MAGI / SEELE / EVA 标志；`--boot-*` 不得外溢。

## 桌面宠物

桌面宠物是 Desktop shell 的受限 overlay，不是启动页装饰，也不是 Harness Web UI 的插件或 DOM 注入。它只在 Harness ready/revealed 后出现；boot、启动器、关闭遮罩、重启和 Harness teardown 期间必须隐藏并销毁自己的 BrowserView。

- 宠物 BrowserView 只覆盖约 80–96px 的小矩形，避开顶部标题栏，并在窗口缩放、最大化和恢复后重新 clamp；禁止用全窗口透明 BrowserView，透明区域不得吞掉 Harness 点击。
- 视觉资产可复用仓库已有品牌矢量资产；容器透明，颜色、字体、圆角和反馈只引用 `src/shared/dsh-webui-tokens.css` 与现有 motion token，不使用 `--boot-*`，不新增独立色板。
- 交互面保持点击反馈（挥手）、拖拽定位（行走）与右键菜单（选择已发现的 Codex 宠物或隐藏宠物）。托盘提供「桌面宠物」checkbox；状态只持久化 `{ enabled, xRatio, yRatio, petId }`，位置用归一化坐标，异常值回退安全默认，瞬时表情不落盘。缺失或失效的 `petId` 自动回退到可用 Codex 宠物或内置占位资产。
- 宠物兼容 `${CODEX_HOME:-$HOME/.codex}/pets/<pet-id>/` 下的 `pet.json` 与相邻图集，双读 Codex v1 的 `1536x1872 / 8x9` 和 Desktop v2 的 `1536x2288 / 8x11`；v2 由 `spriteVersionNumber: 2` 或尺寸确认，禁止绝对路径和 `..` 穿越。
- 宠物 preload 只暴露读取初始状态、状态订阅、提交归一化位置、右键菜单和主题订阅；主进程按精确 pet BrowserView sender 与 `pet.html` 主 frame 校验 IPC。不得复用 Harness 的 workspace、Git、文件、远程或插件权限。
- `prefers-reduced-motion` 下反馈直接落位；Codex 图集行动画（idle 循环、一次性状态行、v2 悬停视线）是唯一的持续动画，占位资产仍只用 opacity/transform 短反馈，不新增第二套桌面皮肤。

### Live2D 鲸鱼娘对话气泡

Live2D 桌宠以整窗透明 Canvas 绘制，独立于主窗内的小矩形 Codex 宠物视图。整屏窗口的原生背板在浅色、深色、跟随系统及窗口重建后始终透明；全局主题重绘不得给它填充不透明底色。

在支持原生窗口区域的 Windows/Linux 上，整屏 Canvas 只是坐标空间：原生可见区域必须裁到角色、特效、气泡和已打开卡片各自的绘制矩形，不能把相隔表面合并成大矩形。鼠标命中同样逐块判断，透明空隙应交还下层应用；显示及恢复桌宠不激活窗口，仅用户打开聊天卡时取得输入焦点。

鲸鱼娘扩展动画以 `pet-live2d/avatar/character.png` 为唯一身份母版：蓝发、鲸鳍耳、呆毛、白色女仆头饰、海军蓝裙、鲸纹白围裙、蓝鞋与长鲸尾的比例和笔触保持一致。目标资源包覆盖 24 种身体动作与 12 种表情，独立动作使用透明连续帧；蜷缩睡眠、抱食进食、悬挂等必须有真实姿态差异。泡泡、星星与爱心只辅助表达。待机保留实时呼吸、眨眼与视线；长时间无互动先逐渐困倦，再进入睡眠，任何互动立即打断困倦；自主表情需与当前心情和亲密度相符。进食必须看得出抱食、咀嚼与收尾，不能用浮动饭碗遮住围裙来冒充手部动作；甩出与悬挂需有可辨的姿态和表情差异。新图集不得覆盖原始母版。每段提供进入/循环/退出语义，拖拽方向与甩动惯性由交互物理驱动。帧数由实际播放效果决定；单帧身份和身形检查、连续播放检查通过后才进入正式素材。动画源图、清单、生成提示词与可播放预览同批保存，未经验收的素材不标为已接入。

闭眼保持母版双眼的间距与宽度，用模型自然闭眼形态。待机眨眼、单眼眨眼与互动闭眼在姿态合成后，按每眼闭合程度渐弱同侧冲突眼形；双眼闭合退出瞳向控制，睁开恢复，不清除另眼表情或嘴形。入睡渐退其他面部形态与视线，熟睡仅留自然闭眼；唤醒恢复待机表情控制。动作库扩展见[暂缓实施方案](superpowers/plans/2026-09-25-whale-full-animation-library.md)。

呼吸、眨眼、视线、气泡和拖拽跟随屏幕刷新，不另限 60 fps。推理间隔 50 ms；开启省电且空闲 5 分钟后为 110 ms，睡眠不另降频。透明窗不得停顿、残影或黑边。

「聊聊」卡的模型与思考选择保持 248px 宽的轻量对话面，沿用桌面端输入栏的模型入口和两级菜单：线程下方发丝线之后是一枚 28px 中性圆角入口，紧凑呈现模型名、思考档位与下拉箭头，长名称省略且悬停可看全名。菜单从入口向上浮出、右边对齐并限制在显示器内，以共享 menu/label/hover/elevation token 呈现；首层是「模型」「思考」及当前值，进入次级列表后模型按 provider 分组、当前项勾选，思考档位显示中文可读名，长列表限高滚动。浮层不参与对话卡排版，开关菜单不改变卡片高度；切换后收起并保持原会话选择，重复点当前项只收列表、不重置思考档位。Escape 从次级列表返回首层，再收菜单，下一次才关卡。菜单本身加入透明窗的可点击范围，关闭后立即恢复穿透，卡片继续随角色锚定。

鲸鱼娘周围只保留贴近可见身体的小幅交互余量；指针离开身体和气泡的实际可操作区域后，透明窗口应及时恢复点击穿透。拖拽时气泡以当前被拎起的头部位置为锚点，不以绘制清除范围或状态卡的外接框定位。

气泡随角色头部定位，与角色共用 Canvas；主体和尾巴须为单条闭合轮廓，一次填充、描边，不得用无描边三角形盖线。头顶空间不足时翻到角色下方，气泡含尾巴和描边不得越出屏幕。采用共享主题 token 的 layer-1 / border-l2 / label-primary 与 `--dsw-font-family`，9px 圆角、12px 字号 / 16px 行高、9px 水平内边距、上下各约 6px（`bh = 行数×16 + 12`），文字以 `textBaseline: middle` 在气泡内垂直居中；不扩大宠物交互命中区。

「看看」请求在途期间独占同一个加载气泡，普通台词丢弃，提醒暂存且可撤销，结果或错误原位替换后恢复仲裁；不按固定秒数提前消失。右键状态卡保留现有宽度、字体、配色与图标，文字和图标以各自真实墨迹边界垂直居中；动作格两者独立绘制、间隔 4px、整体水平居中，不用拼接字符串的字体基线代替光学对齐。

桌宠 Canvas 按当前显示器的 devicePixelRatio 建立像素缓冲，绘制与命中保持 CSS 像素坐标；跨不同缩放的显示器时同步重建，文字不得经低分辨率画布放大。右键状态卡投喂按钮距上方统计行的 12px 行框留 12px 空隙（按钮顶距统计行中心 18px），下方分隔线与属性区保持原位置。

## 桌面启动器

导入手动打开，事务恢复例外。首页只显版本、状态和启停（失败改重试）；忙碌显示真实耗时并锁住冲突操作。错误与插件恢复默认折叠于「启动诊断」，不显空列表。

诊断标题 16/24；导入正文至少 120px，缩放时外层滚动。确认框上下留 24px，正文滚动、标题按钮不收缩。缓存故障优先于跳过状态，不归咎插件、不清会话。

复用共享 token 浅/深表；official 模式只切 scheme，不写壁纸种子。禁用 boot 令牌及第二色板。实现见[启动生命周期](handbook/modules/boot-lifecycle.md)。

## 现有偏差（不要再扩散）

产品页使用本语言的 token 与 `ui-primitives`。手机远程 Web（`mobile/web`）是文档化例外：抄 `--dsw-alias-*`，不嵌入基线插件树，不用启动页海平线画布。设置里的插件市场是桌面自有包 `ui-settings-market` 的 `settings.section`（id `market`），必须跟设置页基线同一套 token / primitives。用量统计是预置改版 `dsh-usage-panel`（id `usage-stats`），必须跟设置页基线同一套 token / primitives，不沿用上游插件色板。不要再开 `--bg` / `--accent` 平行色板。桌面启动页是文档化的海平线画布例外，见 [桌面启动页](#桌面启动页)，不得扩散。冷启动启动器走基线 token，见 [桌面启动器](#桌面启动器)，不是第二套例外。

用量统计的活跃热力图采用紧凑月历：星期为列、每周为行，单元格固定小尺寸，避免随设置面板宽度膨胀为大色块。标题下方独立放月份选择和 UTC 起止日期筛选；所选范围以清晰的边界和汇总反馈呈现，未选日期降权但保留月历位置。窄面板里控件换行，月历不横向溢出；颜色、边框、按钮和表单沿用设置页 token 与原语。

用量统计 KPI 以 Token 总量和估算费用为第一层两张宽卡，会话数、最常用模型、缓存命中率为第二层三张辅助卡；窄于两列空间时自然回落为单列，数值与说明不裁切。

### 市场功能迁移

市场扩展使用「发现 / 收藏 / 已安装 / 操作记录」页签。排序与时间范围复用 Menu，收藏用带 Tooltip 的图标按钮；
详情与安装 / 卸载 / 批量更新确认使用 ui-primitives Modal。详情展示目录截图（固定比例、contain）、来源与主页，
不引入上游样式或不可信 HTML；README 使用既有 MarkdownText 原语。操作记录使用紧凑列表和可展开纯文本日志，批量更新串行执行后只重启一次。

## 自检

提交 UI 改动前：

- [ ] 有现成原语却手写了按钮 / 菜单 / 对话框？
- [ ] 功能 CSS 里出现了颜色字面量或第二套 CSS 变量？
- [ ] 圆角、高度、字号行高不在上表？
- [ ] 深色模式写在了组件里？
- [ ] 新弹层没用 `usePresence` / 基线 recipe？
- [ ] 看起来像另一款 IDE 或手机皮肤，而不是钉版基线（`vendor/deepseek-harness` 渲染的 Web UI）？
