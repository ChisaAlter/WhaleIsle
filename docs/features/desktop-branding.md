# Feature: Whale Isle 应用品牌

| Field | Value |
| --- | --- |
| **id** | `desktop-branding` |
| **status** | `active` |
| **last verified (window icon)** | 2026-10-01 — 属性顺序与通知定向测试 23/23；`36839675533` 安装版单变量 A/B/A 证实 `SHCNE_DELETE`（旧路径,NULL）首启为鲸鱼而 `SHCNE_RENAMEITEM` 为白色文档。正式候选 `36864734935`（`3af7fb6c`）安装版实测：迁移精确执行（原字节备份、DELETE 通知、源码侧不再生成 Electron.lnk），干净 Explorer 会话下任务栏为鲸鱼头像与 Whale Isle 名称；已收窄边界——会话内缓存于旧 `.lnk` 写入事件或会话起始即建立，被污染会话的首启仍显示旧读数（白文档+"Electron"），Explorer 重启/注销后永久恢复，产品不做会话内强制刷新。定向回归 42/42。历史证据见 [执行记录](../qa/results/2026-10-01-release-candidate/README.md)。 |
| **last verified** | 2026-09-25 — 已恢复定稿的中文主字标及原字号，仅应用其他入口使用英文主名；品牌与侧栏定向测试 25/25、官方 profile 完整构建、`check:governance` 与 `doc-sync` 通过。桌面应用已重启。 |

## User paths

1. 在桌面应用或 Web 展开侧栏时，左上角保持已定稿的字标：透明鲸鱼娘头像、同排按界面语言排列：中文模式「鲸屿」大字在前、「WHALE ISLE」小字在后；英文模式交换顺序与字级，下一行显示「BASED ON DEEPSEEK HARNESS」。
2. 收起侧栏时，左上角展开按钮显示同一透明头像；悬停或键盘聚焦时切换为面板图标，点击仍展开侧栏。
3. 切换浅色、深色主题时，文字与主名称中的蓝色「屿」或「ISLE」随主题 token 变化，头像保持透明原图。
4. 窗口、启动器、安装器、快捷方式、托盘、Web/PWA 与手机伴侣界面统一显示 Whale Isle；已有配置和会话继续从原数据目录读取。

## Invariants

- Windows 窗口先提交图标、重启命令与产品名，再单独声明 AppUserModelID；不得合并为一次 `setAppDetails`，Electron 的原生实现会先写 ID 并过早触发任务栏刷新。
- 侧栏头像复用 `assets/whale-head.png` 的透明图像，不显示方形底板。字标随界面语言交换主副名称的顺序与字号：中文模式「鲸屿」在前为 18px 大字，仅「屿」为品牌蓝；英文模式「WHALE ISLE」在前为 18px 大字，仅「ISLE」为品牌蓝。另一名称在同一行后方为 10px 小字；完整「BASED ON DEEPSEEK HARNESS」来源说明位于下一行且始终可读。
- `appId`、仓库名、包名与数据目录路径保持稳定；安装与更新识别旧版 Deepseek-Harness-Desktop 资产及可执行文件。
- Windows 主窗和启动器在首次显示前声明既有 Shell 身份、同源图标、成对的产品名与重启命令。源码图标为真实 ICO，安装版为 EXE 内嵌图标；重启不携带会话、认证、调试或 QA 参数。Windows 原始 Electron 源码运行在通知 presenter 初始化前拒绝系统通知注册，安装版通知保持可用。
- 安装版桌面启动前恢复旧通知生成的 `Electron.lnk`：固定当前用户开始菜单路径、正式 GUI AppID、普通文件、绝对 Electron EXE 目标、空参数及默认 index 0 图标必须全部匹配。原字节移到 userData 的唯一 `Electron.lnk.backup` 备份，不保留 `.lnk` 扩展名；仅在移动成功后异步通知 Shell 该旧开始菜单条目已删除（`SHCNE_DELETE`：旧路径，第二项 NULL；`SHCNF_PATHW | SHCNF_FLUSH`），不把备份路径登记为新入口——RENAME 会让 Shell 把该 AppID 的快捷方式关联延续到不再是 `.lnk` 的备份文件，首启任务栏解析为白色文档（候选 `36839675533` 单变量 A/B/A 证实）。原生回调最多等待 500ms，失败或超时仍保留备份并继续启动；期限只结束启动等待，不取消原生调用。FLUSH 只保证事件投递，不证明任务栏像素正确，首次冷启动另行验收。不碰用户固定项、其它快捷方式或全局缓存；不匹配、读失败或备份失败时保留原条目且不调用原生桥。
- 收起态只保留头像作为左上角品牌标记；它仍是既有展开按钮，保留可访问名称、快捷键与焦点反馈。展开态右上角的收起按钮继续显示原面板图标，不放头像。桌面标题栏与普通 Web 侧栏使用同一收起态。
- 桌面壳与 Web 的官方构建共用鲸屿侧栏及首屏品牌槽位；首屏使用同一头像的单色标记，随主文字色适配浅色与深色主题。首屏文案见[设计语言](../design-language.md)。应用图标沿用现有资源。
- 两端侧栏仍使用已有的品牌槽位、标题栏拖拽与新建会话行为。明暗颜色只在 `ui-theme` 主题 token 表定义。

## Allowed touch

- 2026-10-01 用户再次报告任务栏 Electron 图标：`src/main/window.js`、`src/main/index.js`、`src/main/update-attention.js`、`src/main/media-permissions.js`、`src/main-launcher/`、`src/main/window-app-details.js`、`src/main/system-notifications.js` 与对应测试 — 首次显示前的 Windows Shell 品牌属性，以及原始 Electron 源码运行的系统通知注册边界；保留安装版通知、既有 appId / 数据路径 / 资源设计。
- 同日安装版存量条目恢复：`src/main/legacy-notification-shortcut.js` 与对应测试、`src/main/index.js` 的显示前接线、`docs/handbook/modules/boot-lifecycle.md` — 精确匹配旧自动条目并保留可恢复备份。

- 本次任务栏图标修复（2026-09-29 用户确认）：`src/main/window.js` 的窗口图标加载及其测试、现有品牌决策与 QA 证据；仅更换资源格式选择，不改图标设计。

- `docs/design-language.md` / `docs/design-language.en.md`、本卡与索引、品牌决策记录和对应翻译 sidecar — 品牌合同。
- `vendor/deepseek-harness/packages/client/ui-brand-official/` — 桌面品牌槽位内容及测试。
- `vendor/deepseek-harness/packages/client/ui-sidebar/src/client/SidebarRoot.tsx` / `SidebarRoot.module.css` 及定向测试 — 收起态品牌标记、展开按钮和行高。
- `vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css` — 深浅色品牌强调 token。
- `vendor/deepseek-harness/apps/web/public/whale-isle-head.png` — 桌面与 Web 共用的透明头像副本。
- `docs/handbook/modules/design-and-spine.md` — 当前态入口。
- `package.json`、`electron-builder.launcher.yml`、`build/installer.nsh`、`scripts/render-installer-assets.js`、发布工作流及资产校验 — 打包显示名和发行资产。
- `src/main/`、`src/main-launcher/`、`src/launcher/`、`src/renderer/`、`src/shared/product-identity.js` 中的产品显示名及旧安装兼容；`scripts/prestart-ensure.mjs`、`scripts/measure-whale-runtime.ps1`、`vendor/deepseek-harness/scripts/client-build-environment.ts`、Web manifest 与相关测试 — 官方客户端标题。
- `vendor/deepseek-harness/packages/client/ui-settings-{general,account}/`、`ui-plugin-manager/`、`ui-sidebar-documentpreview/` — 应用自有界面的显示文案与相关测试。
- `mobile/web/`、`mobile/android/app/src/main/`、`mobile/app.json` — 手机伴侣显示名。
- `README.md` / `README.en.md`、`.github/release-notes.md` / `.github/release-notes.en.md` — 对外介绍名称。

## Do not touch

- 不改窗口、任务栏与托盘图标设计。
- 侧栏导航与标题栏交互。

## Gates

| Kind | What |
| --- | --- |
| Automated | 品牌组件定向测试与必要的官方客户端构建；文档引用/配对仅在相关内容变化时核对，不默认全量治理或 doc-sync |
| Automated / Windows | Shell 属性在首次显示前声明；源通知入口不得调用 presenter；真实 HWND 同进程读取身份与图标，保留原生窗控及透明圆角 QA；首次冷启动任务栏像素须独立验收，后续启动正确不抵消首启失败 |
| Automated / Windows | 旧通知快捷方式严格匹配、普通文件与路径边界、备份幂等及失败保留；仅完成移动后通知精确路径，500ms 期限及 missing / error / late callback 不丢备份，超时不翻转为投递成功；恢复在首次窗口 / 通知前完成 |
| Manual / QA | 桌面与 Web 侧栏展开/收起、浅色/深色、标题栏拖拽和新建会话 |

## Sources

- Design: [DSHD 设计语言](../design-language.md)
- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)，[对外应用名统一为 Whale Isle](../decisions/implemented/product/2026-09-25-whale-isle-application-name.md)，[Windows 任务栏身份](../decisions/implemented/bug-fix/2026-10-01-windows-taskbar-identity.md)
- Implementation entry: `vendor/deepseek-harness/packages/client/ui-brand-official/src/client/Brand.tsx`
