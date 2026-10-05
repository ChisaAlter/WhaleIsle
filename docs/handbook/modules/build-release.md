# 构建、钉版与发版

本章保存装配实现；开发与发布操作见[发布说明](release-process.md)，项目维护见[维护说明](../../maintenance/README.md)。

## 本地开发与构建

`npm ci` 安装根依赖，`npm run setup:harness` 准备锁定的上游并构建官方 profile，`npm start` 启动桌面。Windows 使用 `npm run dist`，macOS 使用 `npm run dist:mac`。这些是操作入口，不是每次修改必须顺序执行的清单。

Harness 来源由 `vendor/harness-upstream.json` 记录；同步用 `npm run sync:harness -- --ref … --sha …`。整合时查看[上游合并与差异保护](../../maintenance/README.md#上游合并与差异保护)，不要覆盖已经交付的桌面能力。

## 实际装配

- `scripts/setup-harness.js` 使用锁文件中的 pnpm 和官方 `build:official`。客户端修改后构建该 profile，随后重启桌面。
- `package.json` 保存 Electron、NSIS、DMG、资源和 afterPack 配置。根 `build.files` 是应用 ASAR 的唯一白名单；node-pty 平台排除放在该白名单中，`${platform}` 使用构建主机的平台。Windows 和 macOS 发布分别在对应平台原生构建。Windows 经 `scripts/run-electron-builder.cjs` 接入锁定上游的目录事务安装实现；安装器品牌与静默安装行为见[安装器资料](../../features/windows-installer.md)。
- 根 `.nvmrc` 是 CI 构建 Node 版本来源。Windows 随包 Harness 与 Office 共用 `resources/runtime/primary-runtime/dependencies/node/bin/node.exe`，该独立 Node 由上游 primary-runtime 锁文件准备，不再额外复制构建进程的 Node；其它目标仍由 `afterPack` 复制独立 Node。
- `scripts/production-runtime.js` 从 `apps/cli` 与 `src/shared/harness-desktop-forks.js` 的 `DESKTOP_PACKAGES` 出发，选择生产依赖、已安装的 optional 与 peer 依赖闭包；不把所有已构建工作区包作为装配根。web 前端单独复制 `apps/web/dist`。生产依赖必须在 manifest 与锁文件中完整声明，实际装配保留消费者的依赖实例共享/隔离关系。实现与理由见[运行时实例布局](../../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md)。
- Codex / Claude provider 按其 README 通过 Harness 插件管理或 `dsh plugin --profile web add @deepseek-ai/dsh-subagent-codex` / `@deepseek-ai/dsh-subagent-claude-code` 安装到 profile，不再因复制整个工作区而预装 CLI / SDK。直接可切换的 agent-team、voice、auto-review、inspector 四个官方实验 bundle 仍在生产闭包内。旧配置若仅手写这两个 provider bundle 而没有独立安装，保留原选择并显示补装命令；临时通过现有 `skip-user-plugins` 路径恢复基础界面，补装后可重试完整插件启动。其它无法解析的失效 bundle 仍按原修复行为删除。此次不删除旧 userData 运行时缓存。
- 内置插件的暂存依赖树完成完整性检查后，删除生产闭包外的包；只处理 `node_modules` 中的包槽位，不把包内子路径当成独立依赖。运行时文件筛选保留 LICENSE、LICENCE、NOTICE、第三方许可说明，以及含独立许可证正文的 README。只裁剪分发副本中的声明、source map、已确认的插件开发目录/宣传图、Zod 的 `src`、node-pty 非目标 prebuild 和第三方 ConPTY 构建副本、domino 的测试/锁文件、web 的重复 public 树及移动端 map；目标 ConPTY 与包的 JS 子路径仍保留。
- 两份 pnpm 保持各自版本与调用入口，均剔除非目标平台的 reflink 原生包。桌面 pnpm 只复制 `package.json`、`bin`、`dist` 和 `LICENSE`，不携带重复的 `artifacts/exe`。
- `afterPack` 对 Harness 归档计算 SHA256。Windows Setup 在暂存安装目录运行 `scripts/install-harness.cjs`，核验大小和摘要、提取 Harness 并创建指向最终目录的 junction，随后删除 tar；目录晋级后应用直接使用安装目录内的运行时。`pack --dir`、macOS 和旧 tar 布局仍保留启动时提取与内容身份校验，不能用文件长度或版本号替代摘要。
- 上游 `scripts/build-stage-credentials.mjs` 按 native/host/client/web 的输入与产物身份复用阶段，避免无变化时重复编译。该缓存属于构建实现，不是人工验收凭据。
- Office runtime 通过 `prepare:office-runtime` 进入 Windows 安装包。`afterPack` 仅在分发副本中移除 Python 的 `test`、`tests`、`benchmarks` 目录及存在对应 `.py` 源码的字节码；`numpy.testing`、`pandas.testing`、`pandas._testing` 等公开 API 保留。暂存载荷按实际文件内容与版本元数据重新计算 `runtime.json.payloadDigest`，装配断言复算，避免复用旧的未裁剪载荷。其资源、依赖和能力边界见[Office runtime](../../features/office-runtime.md)。

## CI 产物与分发

`test.yml` 在开发阶段产生 `Whale-Isle-windows-x64`，包含版本化 Setup、blockmap 和 latest.yml；启动打包后的应用后上传。请求 macOS 时还产生同一次运行的 DMG。

`release.yml` 从成功的 main 开发构建下载资产。版本高于已发布版本才分发，失败上传可重试原 CI run。资产检查由 `scripts/check-release-assets.mjs` 核对文件与更新元数据；不运行候选计划或签署检查。

`SHA512SUMS.txt` 是桌面更新器的实际输入，发布时必须包含同批资产的 SHA512。下载、安装、用户数据迁移等变更需要相应实际操作验证；打包启动成功只证明它观察到的行为。历史候选报告不是当前流程。
