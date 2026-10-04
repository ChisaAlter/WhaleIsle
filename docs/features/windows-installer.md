# Feature: Windows 安装器（NSIS 品牌化）

| Field | Value |
| --- | --- |
| **id** | `windows-installer` |
| **status** | `active` |
| **last verified (release process)** | 2026-10-02 — 原始包身份、验收校验和单次 smoke 工作流接线定向验证通过，详见 [发布流程验证记录](release-process.md)。本机 3 项符号链接测试受 EPERM 限制；未生成或安装新候选。 |
| **last verified** | 2026-09-20 — 晋级前资产核对收敛到共享只读校验器 `scripts/check-release-assets.mjs`（32 项单测含四条变异检验全绿；`ci-isolation.test.js` 静态钉住 publish.yml 顺序 / 稀疏检出 / `npm ci --ignore-scripts` / 无 `npx` / 缺 helper 时显式失败），`release.yml` 与 `publish.yml` 的 action 引用钉到不可变 SHA。本轮**未**调度 `publish.yml`（需真实候选 run 与 tag），也**未**做安装器实机走查。旧记录：2026-09-18 — 应用、窗口/任务栏、托盘、安装器共用用户提供的头像 `assets/whale-head.png`，包在白色圆角方形底板内（22% 圆角、四边 4% 内缩）；`npm run icon` 生成 PNG/多尺寸 ICO，`installer:assets` 生成品牌 BMP。宠物生成器不再改写应用图标；32 项定向测试与治理/文档门禁通过，源图 hash 一致，桌面/开始菜单快捷方式图标已更新。旧记录：2026-09-12 — 新增 `customInit` 注册表净化（死 InstallLocation/UninstallString 记录删除 + `$INSTDIR` 按 `/D`>活记录>卸载器目录>默认 重算 + 绝对性兜底），修复损坏/陈旧安装记录劫持升级目标的问题（事故：mangled 记录把 0.3.0 装进 `tmp\inst-verify`）。真实 Setup 七场景 29 项实机验证全过（fresh `/D`、drive-relative 记录、wiped-tmp 记录、原地升级、UninstallString 兜底、mangled `/D`、带空格 `/D`、静默卸载自清）；makensis 编译通过。旧记录：2026-09-06 — Windows `v0.2.9` 已按维护者明确授权公开为 Latest。固定源码 `583b6fa92d93df2ee56363e96e2891b356af75b9` 的 Desktop tests `34015974835` attempt 2 与 Windows build/packaged smoke `34015983516` 均成功；Setup SHA256 `1eb5bd7c3769e1d09a6e863f8948706359f255a91608f0989e7982d19c380117`，版本资源 `0.2.9`，未做 Authenticode 签名。三个发布资产与本机已校验 CI 文件逐项匹配；自动触发的重复构建 `34018917540` 已取消。新包完整实机 P0 未完成，不继承 [旧 e11fb52 安装验证](../qa/results/2026-09-06/candidate-e11fb52/WINDOWS-CANDIDATE.md)。授权与发布证明见 [发布记录](../qa/results/2026-09-06/candidate-583b6fa/RELEASE-STATUS.md)。 |

## User paths

1. 双击 Setup（GUI）：欢迎页（品牌侧栏：官方浅色侧栏底 `rgb(249,250,251)` + 鲸鱼娘大头徽标 + 产品名 `Whale Isle` + 细蓝强调线 + 右缘发丝线，MUI 本地化中文/英文文案）→ MIT 许可页 → 安装模式/目录选择（可改目录）→ 安装进度（右上白底鲸鱼娘大头徽标 header）→ 完成页（默认勾选「运行 Whale Isle」+ 产品仓库链接）。
2. 静默安装 `Whale-Isle-Setup-<version>.exe /S`：跳过全部页面直接装完；同版本覆盖与升级通过目录事务替换应用文件，保留用户数据（QA TC-INST-009/012、dshbot smoke 依赖）。
3. 卸载（设置 → 应用 / 开始菜单）：品牌化卸载向导，灰阶侧栏区分移除语境；不删 `userData`（桌面 dsh-home、会话都在那里）。

## Invariants

- `oneClick: false`、`allowToChangeInstallationDirectory: true`、桌面 + 开始菜单快捷方式、发行 artifact 名 `Whale-Isle-Setup-${version}.exe` 必须与 release.yml globs、SHA512SUMS 和资产校验器一致；旧版 `Deepseek-Harness-Desktop-Setup-*` 仍可被更新客户端识别。
- `/S` 静默安装必须保持可用。品牌 GUI 仍由 `customWelcomePage` / `customUnWelcomePage` / `customHeader` 三个宏定义，`customInit` 只负责下述注册表净化。目录事务由上游 `installer-directories.nsh` 与 `scripts/windows-directory-installer.cjs` 接入；`customInstallerExtract` 解压暂存应用并准备 Harness，`customInstall` 在注册完成后清理旧目录。`customUnWelcomePage` 是纯页面声明（替换 electron-builder 模板里的裸 `MUI_UNPAGE_WELCOME` 插入点），必须自己重插 `MUI_UNPAGE_WELCOME` 并重定义 `MUI_WELCOMEPAGE_TITLE_3LINES`——MUI2 每插一页就 UNSET 欢迎页设置，安装侧的 define 到不了卸载器，否则卸载欢迎页标题第三行（「…Uninstall」）被裁。
- 安装顺序参考锁定的官方桌面实现：在目标目录同卷创建 `.new-<GUID>` 暂存树，7za 解压完成后再关闭旧应用；旧目录改名为 `.old-<GUID>`，新目录晋级到最终路径，再注册安装信息和快捷方式，最后清理旧目录。提取或晋级失败走目录回滚，恢复受阻时保留完整备份；不直接向正在运行的旧目录覆盖文件。保留 Whale Isle 的品牌、AppID、快捷方式及用户数据策略。
- 暂存树回滚、旧安装目录清理与正常卸载共用 `build/remove-directory.nsh`：递归枚举普通目录，但遇到目录联接或其它目录 reparse point 时只移除联接自身，不进入目标目录。暂存联接可能已指向仍在使用的最终安装目录，旧目录联接也可能在晋级后指向新树，因此不能直接使用会遍历联接目标的递归删除。正常卸载删除失败返回错误；用户数据不在应用目录清理范围内。
- 换目录或用户范围的升级仍按 electron-builder 顺序调用旧卸载器，再晋级新目录。`--updated` 卸载先把文件和联接本身移动到同卷 `.uninstall-<GUID>` 备份，任何移动或应用目录移除失败都先还原再退出；还原受阻时保留备份并明确报告位置，不交给临时目录自动删除。此路径不遍历联接目标，也支持长路径。
- 新安装提交后的 `.old-<GUID>` 删除失败不回滚可用的新应用：显示警告，并在残留目录旁保存 `<残留目录>.cleanup.txt`，包含原 Setup 的准确清理命令。释放文件锁后可执行 `Setup /S "--cleanup-old=<残留目录>" /D=<原安装目录>`；该模式仅允许原目录的 `.old-{GUID}` 或 `.uninstall-{GUID}` 同级目录，在安装区段、关闭应用及注册表净化之前退出，不影响当前运行的应用、注册信息或用户数据。清理仍失败返回退出码 2；说明文件创建、写入或关闭失败返回退出码 3；成功后移除说明文件。
- 晋级后回滚若被新目录的文件锁阻止，不清除事务状态、不尝试覆盖完整旧备份；旧目录恢复改名失败也返回退出码 2。两条路径都会报告当前目录与完整备份路径，在备份旁保存 `.rollback.txt`，指导释放占用、移开未完整目录，再把完整旧备份改回原目录；不把残留状态当作成功回滚。
- 完整桌面包在暂存目录使用 primary-runtime 的独立 Node 运行 `install-harness.cjs`：核验 `deepseek-harness.tar` 大小与 SHA256，提取到 `resources/vendor/deepseek-harness`，按最终安装路径创建 junction，删除 tar 后才晋级应用。小启动器包没有 Harness 载荷，跳过这一步。安装后首次启动直接使用资源目录中的运行时，不重复提取到 userData；旧 tar 布局仍可由应用启动提取。
- `customInit` 注册表净化（2026-09-12 事故修复）：在 `.onInit` 内 `initMultiUser` 之后、页面/区段之前运行——**含静默路径，这是有意为之**（坏记录恰恰在 `/S` 升级时造成破坏）。记录存活的条件 = 绝对路径（`X:\`/`\\`，含引号包裹形态）**且** 文件还在盘上：`InstallLocation` 要求 `<dir>\${APP_EXECUTABLE_FILENAME}` 或对应旧版 `<dir>\Deepseek-Harness-Desktop.exe` / `<dir>\Deepseek-Harness-Launcher.exe` 存在，`UninstallString` 要求引号内卸载器存在（`Call GetInQuotes`/`GetFileParent`——它们是 installUtil.nsh 的 Function，`Call` 目标编译期可解析，但其 `!macro` 包装在 .onInit 后才定义，不能直接 `!insertmacro`）。死记录删除：`InstallLocation` 删值、`UninstallString` 死 → 删整个卸载子键。`$INSTDIR` 按序重算：显式 `/D` > 活 `InstallLocation` > 活卸载器父目录（升级回原目录）> `$LocalAppData\Programs\${APP_FILENAME}`；末尾绝对性兜底同时挡掉 mangled `/D`（drive-relative 复位到默认，不落幻影目录）。不得在此宏里加 UI、exec、网络或其它逻辑。
- 默认 per-user 安装；已有 `%LOCALAPPDATA%\Programs\Deepseek-Harness-Desktop` 安装继续原地升级，不设 `perMachine`，不设 `deleteAppDataOnUninstall`。
- 位图是经典 24 位无压缩 BMP，几何固定：sidebar 164×314、header 150×57。改品牌图先改 `scripts/render-installer-assets.js` 再 `npm run installer:assets` 重新生成，禁止手改二进制或另起配色——色板是官方浅色表（`src/shared/dsh-webui-tokens.css`）的构建期镜像，与启动器同源：侧栏底 `--dsw-specific-sidebar-fill` `rgb(249,250,251)`、画布 `--dsw-alias-bg-base` 白、文字 `--dsw-alias-label-primary/secondary/tertiary`、强调仅细线用 `--dsw-static-deepseek-500` `rgb(65,118,230)`、发丝线 `rgba(0,0,0,.10)`。品牌标 = `assets/icon.png`（源图 `assets/whale-head.png` 保持原字节；白色圆角方形底板、22% 圆角、头像四边各内缩 4%，保持完整比例），安装页原色、卸载页 `grayscale(0.85)+opacity(0.75)` 弱化。禁止近黑营销面板（第二皮肤）、禁止 `--boot-*` 仪器画布扩散进安装器；卸载侧栏是同一浅色构图的灰阶弱化版。
- 安装器语言 zh_CN（首位 = 兜底）+ en_US；产品中文文案走 MUI 本地化串，不烙进位图。
- 许可页读根 `LICENSE`（MIT）原文。
- 安装器/卸载器图标 = `assets/icon.ico`（与应用同一白色圆角底板鲸鱼头像，`icon.svg` → `npm run icon` 生成）。
- 开发 CI 的 windows job 在 dist 后启动打包应用，成功后上传该安装包；发布阶段复用这些字节。macOS 按需选择。
- 自动分发遵循[发布说明](../handbook/modules/release-process.md)：只接收成功 main 构建，核对资产与更新元数据，生成 SHA512SUMS；没有候选签署流程。
- 资产核对由 `scripts/check-release-assets.mjs` 单点执行（workflow、测试、本地排障共用同一实现，禁止在 workflow 里重写一套）：恰好一个版本化 Setup + 同名 `.exe.blockmap` + `latest.yml`，三者都是普通文件且不逃出资产目录；Setup 文件名 / tag / package 版本 / 元数据版本四者一致；Setup SHA256 等于操作者摘要；`latest.yml` 的 `files[]` 只引用本地那个 Setup 且大小与 base64 sha512 与字节一致；旧式顶层 `path`/`sha512` 可缺失但存在时必须一致。校验器只读、离线、不读凭据、有界。它**不**证明 `.blockmap` 与 Setup 的密码学对应——v26 元数据没有该字段，不得发明。

## Allowed touch

- `package.json` 的 `build.nsis` / `build.win` — 安装器配置
- `assets/whale-head.png`、`assets/icon.svg` / `.png` / `.ico`、`scripts/render-icon.js`；`scripts/render-pet-head.js` 仅解除应用品牌资源写入
- `build/` — `installer.nsh`、`remove-directory.nsh` 与生成的 BMP
- `scripts/windows-directory-installer.cjs`、`scripts/install-harness.cjs`、`scripts/run-electron-builder.cjs` — 上游目录事务适配与安装阶段 Harness 准备
- `scripts/render-installer-assets.js`、`scripts/run-render-installer-assets.js` — 位图生成
- `src/main/installer-branding.test.js` — 自动门禁
- `.github/workflows/test.yml` 构建安装包，`.github/workflows/release.yml` 与 `scripts/publish-release.mjs` 分发原始资产。
- `.github/workflows/test.yml` 构建安装包，`.github/workflows/release.yml` 与 `scripts/publish-release.mjs` 分发原始资产。
- 本卡与 [build-release handbook](../handbook/modules/build-release.md)

## Do not touch

- SHA512SUMS / 更新器校验流
- 资产内容完整性校验与旧版安装目录的原地升级能力
- mac DMG 打包配置与上传命名；本卡只控制手动工作流是否调度既有 macOS job

## Gates

| Kind | What |
| --- | --- |
| Automated | `node --test src/main/installer-branding.test.js src/main/ci-isolation.test.js`：NSIS、资源与工作流接线；`npm run test:release`：冻结 SHA、核心/影响计划、真实资产摘要、安装签字与限制、CI 平台资格、续传以及首次 smoke 失败阻断。GitHub 实际运行结果另行记录。 |
| Automated | `node --test scripts/check-release-assets.test.mjs`：32 项，含合法 v26/缺 legacy 通过、SHA256/大小/版本/tag/元数据 sha512/blockmap stem/重复 Setup/重复键/畸形 YAML/类型错误/遍历/远程与绝对 URL/超大元数据/缺失资产/符号链接/目录顶替/读取失败全部拒绝，以及四条**变异检验**（禁用 SHA256、SHA512、`files[].url` 名称比对、`files[].size` 比对后，变异副本必须接受出厂版会拒绝的坏资产集、且仍接受合法资产集） |
| Manual / QA | `TC-INST-001`（GUI 安装走查）、`TC-INST-009`（`/S` 覆盖升级）、`TC-INST-010`（卸载）、`TC-INST-012/013` in [production-acceptance-test-cases.md](../qa/production-acceptance-test-cases.md)；每次改品牌位图后对 CI windows artifact 目检欢迎/许可/目录/完成/卸载五页——实机执行清单（artifact 下载/SHA256/逐页 checklist/zh_CN）固化在 [TC-INST-RUNBOOK.md](../qa/results/2026-08-25/installer-branding/TC-INST-RUNBOOK.md) |

## Sources

- Decision: [统一鲸鱼品牌资源](../decisions/implemented/product/2026-09-18-whale-brand-assets.md)，[对外应用名统一为 Whale Isle](../decisions/implemented/product/2026-09-25-whale-isle-application-name.md)，[晋级前由共享的只读校验器核对发布资产](../decisions/proposed/process/2026-09-20-release-asset-validation.md)，[发布与晋级工作流使用不可变 action 版本](../decisions/proposed/process/2026-09-19-workflow-action-sha-pinning.md)

- Design: [design-language.md](../design-language.md)（官方浅色表 / 品牌蓝仅强调 / 鲸鱼娘大头徽标；安装器 chrome 对齐「桌面启动器」一节，不是启动页仪器画布），[dsh-webui-tokens.css](../../src/shared/dsh-webui-tokens.css)，`assets/whale-head.png`（用户提供的品牌源图）
- Spec: electron-builder NSIS 选项（assisted installer 默认无欢迎页、默认 `nsis3-metro.bmp` 侧栏——本卡替换为品牌资产）
- Implementation entry: `package.json` `build.nsis`、`build/installer.nsh`、`scripts/windows-directory-installer.cjs`、`scripts/install-harness.cjs`、`scripts/render-installer-assets.js`
