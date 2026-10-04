# Feature: Desktop build runtime contract

| Field | Value |
| --- | --- |
| **id** | `desktop-build-runtime` |
| **status** | `proposed` |
| **last verified (release process)** | 2026-10-02 — 固定源码 SHA、CI 前置和原包晋级定向验证、文档门禁通过，详见 [发布流程验证记录](release-process.md)。未重建正式发行包，未运行新的 GitHub Actions。 |
| **last verified (archive and stage identity)** | 2026-09-30 — 提取/装配/归档摘要定向 73/73、阶段凭据 15/15；同长度 tar 内容变更刷新、旧戳迁移、无变化启动不读大归档、摘要损坏保留旧树、helper/vendor 输入失效与平台 native 产物归属通过。未重建正式发行包。 |
| **last verified (CI candidate)** | 2026-09-29 — `47222716ae8` 的 Desktop tests 与 Windows 构建均成功；CI packaged smoke、原始 artifact 摘要与发布资产校验通过。完整安装版验收未执行，身份见 [候选记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified (release preflight)** | 2026-09-29 — Node 24.21.0 桌面 2863 通过/2 跳过；治理 6/6、文档 7/7；主窗与启动器四角合成检查通过。新候选与正式验收状态见 [发布记录](../qa/results/2026-09-29-release-candidate/README.md)。 |
| **last verified (async links)** | 2026-09-29 — 启动链接操作改为异步 I/O；慢盘取消、路径边界、最终链接失败回滚与装配定向测试 148/148。数千链接响应性演练及全量结果见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)，不代表 WER 根因已确认或新包已发布。 |
| **last verified (extraction recovery)** | 2026-09-29 — 临时解压、空间预检、最终路径 junction 重建与中断替换恢复回归通过；本地旧归档真实提取/复用成功，未改装配内容或重建发行包，见 [QA](../qa/results/2026-09-29-installation-recovery/README.md)。 |
| **last verified (window bridge)** | 2026-09-29 — Koffi 生产闭包/双方解包契约通过全量测试；slim 启动器打包成功，ASAR 内 Koffi + win32 模块解析及真实 HWND 样式桥通过。见 [QA](../qa/results/2026-09-29-corner-motion/README.md)；不代替完整桌面发布验收 |
| **last verified** | 2026-09-30 — 归档内容身份及阶段输入/产物归属修复；提取/装配/共享摘要 73/73、阶段凭据 15/15。未重建正式发行包。此前 2026-09-29 — Node 24.21.0 LTS 全量构建和本地 NSIS 成功，包内 Node 版本核实；桌面 2809 通过/2 跳过，打包 P0（界面、Git/PTY、Ghostty、旧运行时替换）通过。CI 同 SHA 正式验收仍未完成。此前 2026-09-28 — 一源一目录装配通过 747 包 / 3602 边验证；tar 搬迁、循环与严格身份回归通过。桌面 2765 通过/2 跳过；源码与安装树冒烟、NSIS 与资产校验通过。ws 与平台会话资源已随包。当前仅本地演练，CI 同 SHA 候选与正式生产验收未完成。 |

## User paths

1. 维护者在仓库根执行文档记载的入口（`npm start`、`npm test`、`npm run test:tools`、`npm run setup:harness`、`npm run pack`、`npm run dist`、`npm run docs:check`）都能找到对应脚本；文档链接检查按需执行。
2. 打包流程按 `build.extraResources` 装配 `vendor/dsh-remote` 等内置插件；`scripts/after-pack.js` 选择 Harness 与桌面扩展的生产闭包、清理插件开发依赖并完成资源断言。
3. 应用更新读取 `build.publish` 的 GitHub 元数据与 `dependencies.electron-updater`，与安装器 artifact 命名保持一致。

## Invariants

- 开发 CI 与自动分发按[发布操作流程](../handbook/modules/release-process.md)执行；本卡的历史验证不证明当前版本。按真实影响选择构建、测试及实际操作，文档修改不启动产品构建。

- 阶段输入覆盖根构建清单、`scripts/**` 构建 helper、`vendor/**` 源与 native 声明；`vendor/*/lib/**`、`native/system/packages/*/lib/**` 是 host 产物，native 二进制按当前 `platform-arch/bin` 归属。精确产物根不计为源输入；位于 `src/lib/**` 的真实源码仍须失效。

- Harness 装配根是 `apps/cli` 与 `src/shared/harness-desktop-forks.js` 的 `DESKTOP_PACKAGES`；只沿生产依赖和已安装的 optional、peer 依赖选择闭包，不再把所有已构建工作区包纳入。`apps/web/dist` 单独作为前端资源复制，桌面差异包保留。
- Windows Setup 复用上游 NSIS 目录事务：暂存新目录并验证运行时 → 关闭旧应用 → 改名晋级 → 注册安装信息 → 清理旧目录。`scripts/install-harness.cjs` 在暂存目录核验 tar 大小和摘要，解压并创建指向最终安装路径的 junction，完成后删除 tar；应用启动优先使用安装目录内的 `resources/vendor/deepseek-harness`。
- `pack --dir`、macOS 与旧 tar 布局仍保留启动提取。该路径使用同卷临时树，验证后替换；Windows junction 在正式路径重新构造成功后才写戳。旧运行时通过 `.previous` 保留至切换完成，启动时先恢复中断替换，再清理遗留临时树；空间不足或归档损坏不提前删除旧树。启动时批量链接校验/修复/清理使用异步文件 I/O，仍逐次验证路径边界；准备阶段可取消，正式目录切换须完成重建或回滚。
- `afterPack` 对完成的 tar 异步流式计算 SHA-256，随包写 version 1 `vendor/deepseek-harness-runtime.json`（`archiveBytes` + `archiveSha256`）。Windows 安装阶段核验实际归档；启动提取路径的复用戳必须匹配内容摘要，缺摘要的旧戳刷新一次。同版本、同 upstream pin、同 tar 长度也不得复用不同内容。该路径稳态仅读小摘要清单，替换前流式核验实际归档；无清单的旧布局通过流式摘要兼容。摘要无效或核验失败不替换旧树。

- 窗口圆角/动画桥 `koffi@3.3.2` 是生产依赖，锁文件保留平台闭包；桌面包与 slim 启动器解包 Koffi 及其 `@koromix` 原生模块，Windows 不得缺桥静默改为不透明窗口。见 [window-motion](window-motion.md)。

- 桌面构建 Node 由根 `.nvmrc` 指定，当前选用 Node 24.21.0 LTS。Windows 随包 Harness 与 Office 共用 primary-runtime 锁定的独立 Node，位于 `resources/runtime/primary-runtime/dependencies/node/bin/node.exe`；其它目标仍单独复制构建时 Node。Electron 内置 Node 不作为该共享解释器。跨主版本后按影响重新执行构建、桌面测试和打包启动验证。

- 每个运行时源 realpath 对应一个物理包目录；消费者经根内链接解析到相同或隔离的源实例。version 1 `.dsh-runtime-links.json` 仅记录相对路径，归档前移除链接；Windows 安装阶段按最终路径准备链接，其它提取路径解压后恢复，实际解析边与发布文件都须通过验证。
- 内置插件暂存依赖树保留生产、已安装 optional 与 peer 闭包，删除闭包外的包槽位；包内 JS 子路径（如 `zod/v4`）仍作为包资源保留。许可文件和含许可证正文的 README 不随 Markdown 清理删除。运行时筛选仅处理分发副本，排除声明、source map、明确的开发/宣传目录、重复的 web public 与 ConPTY 构建副本，以及非目标平台 native 文件；目标 ConPTY DLL/exe 保留。两份 pnpm 保留各自版本与入口，剔除非目标 reflink；桌面 pnpm 只含 `package.json`、`bin`、`dist`、`LICENSE`，不复制 `artifacts/exe` 中的重复 CLI。
- Windows Office 分发副本移除 Python 测试/基准目录及有对应源码的 `.pyc`，保留公开 `testing` 模块。裁剪后 `runtime.json.payloadDigest` 绑定实际文件内容和版本元数据，装配检查复算摘要，用户目录中的旧载荷按新的身份正常替换。
- 账户启动依赖 `ws` 必须在根生产 dependencies 与锁文件中声明，不能依赖本机额外安装。工作区依赖同源拆分与异源合并均阻断打包，字节相同不豁免；删除副本后的依赖树必须复验，正确收拢不能因复制计数不变而失败。
- `package.json` 必须保留 `scripts`（至少含 start / test / test:tools / setup:harness / sync:harness / pack / dist / docs:check）、`devDependencies`（electron / electron-builder / semver / pnpm）、`dependencies.electron-updater`、engines、overrides 与完整 `build` 块（asarUnpack / electronDist / extraMetadata / afterPack / publish / win / nsis / mac / dmg）。
- `build.extraResources` 的首个 vendor filter 必须包含全部内置插件目录，含 `dsh-remote/**`；`vendor/chisacode-remote/.tmp/desktop-runtime/node_modules → vendor/dshd-remote/node_modules` 的第二条资源映射不得丢。
- NSIS 品牌契约（artifact 名、installerLanguages、`build/installer.nsh`）由 `windows-installer` 卡定义，本卡只保证字段存活，不重复定义取值。
- 结构约束由 `src/main/package-contract.test.js` 机检；清单残缺时该测试本身必须失败，而不是让测试在模块加载期崩溃。`npm test` 目前是单一 glob，不额外前置 manifest preflight；维护者排查时应先直接运行该契约测试。
- **prestart 的 client 失效判定只看真实输入（2026-09-22）**：`scripts/source-scan.mjs` 是唯一谓词来源——`isClientSourceFile()` 决定文件、`createClientSourcePruner()` 决定进入哪些目录。`packages/client/**/{tests,__tests__}`、`*.spec.*`、`*.test.*`、`README*` 不算 client 输入；`docs`/`website`/`mobile`/`benchmarks` 不再被遍历。
- **官方构建按阶段凭据复用（2026-09-22）**：`vendor/deepseek-harness/scripts/build-stage-credentials.mjs` 是唯一判定实现（`scripts/build.ts` 经 `.d.mts` 导入同一份代码，`scripts/prestart-ensure.mjs` 直接消费 `.mjs`）。阶段顺序固定 `native-system → host → client → web`，`build.ts` 调用 `build:lib:host` / `build:lib:client` 子脚本而不再调用 `build:lib`。每个阶段记录 inputs / outputs 的 `size:mtime:ctime` manifest 摘要与路径绑定内容摘要，外加 `environment` 摘要与 `formatVersion`；manifest 命中即复用，manifest 变动时用内容摘要兜底（字节相同的重建仍复用）。`DSH_CLIENT_*` 只绑定在 client 与 web 上，因此 commit/version 变化只重建这两个阶段。`native-system` 在 Windows 上零产物是合法凭据，其它平台为零即 stale。产物归属由 `isGeneratedArtifact()` 按精确产物根判定（`packages/*/*/lib/**`、`vendor/*/lib/**`、`apps/*/lib/**`、`apps/*/dist/**`、`native/system/packages/*/{bin,lib}/**`），不得按目录名 `lib` 通配；host / client 靠 `ownsOutput` 把共用的 `lib/**` 分成两半。判定 fail-closed：凭据缺失、无法解析、schema 不符、缺 stage 条目、计数不符、环境不符、所需产物为零一律重建；`stagesToRun()` 保证前序阶段 stale 时后续全跑。`.dsh-build/client-build-environment.json` 仍是产物凭据，仍需与产物一致才可消费。
- `scripts/prepare-dshd-remote.mjs` 每次运行对同一个源目录只枚举一次（`createScanMemo()`）；server stack 与 mobile bundle 共用 protocol/client 的扫描结果。memo 只在进程内，不得落盘——跨运行的持久 mtime 记录无法区分「文件未变」与「扫描未运行」，会静默留下陈旧产物。
- **装配期复用已验证的插件依赖树（2026-09-22）**：`dsh-im` 的依赖是否重装由 `missingPluginRuntimeClosure()`（自身入口 + 深度 3 的依赖闭包）决定，不再由 `skipIfComplete: false` 无条件删除重装。检查不通过时仍走 `defaultNpmInstall()`；`skipIfComplete` 的浅语义对其余插件不变。复用前提是这些依赖为纯 JS；引入原生依赖前必须把平台与 ABI 纳入判定。

## Allowed touch

- `src/shared/harness-runtime-identity.js`、`.test.js`、`src/main/harness-extract.js`、`.test.js`、`scripts/after-pack.js`、`src/main/after-pack.test.js` — 2026-09-30 用户全面修复授权下的归档内容身份、旧戳迁移与提取前校验。
- `scripts/production-runtime.js`、`scripts/install-harness.cjs`、`scripts/windows-directory-installer.cjs`、`scripts/run-electron-builder.cjs`、`src/main/dsh.js`、`src/shared/runtime-links.js` — 生产依赖闭包、共享 Node 与 Windows 安装阶段运行时准备。
- `vendor/deepseek-harness/.agents/notes/implemented/process/2026-09-30-stage-build-input-ownership.md` 与中文配对/sidecar — 阶段凭据输入和产物归属的长期边界。

- `package.json`、`package-lock.json`、`electron-builder.launcher.yml`、`src/main/package-contract.test.js` — 2026-09-29 圆角与动画修复所需 Koffi 生产闭包/原生模块解包。

- `.nvmrc` — 2026-09-29 用户授权重选合适的 Node 构建版本。

- `scripts/runtime-instance-graph.js`、`src/shared/runtime-links.js`、`src/main/harness-extract.js` 与对应测试 — 2026-09-28 用户全面修复授权下的一源一目录装配、链接清单和提取恢复
- `package.json` — 清单字段与打包配置
- `src/main/package-contract.test.js` — 结构门禁
- `package-lock.json` — 2026-09-28 用户授权补齐 `ws@8.21.3` 生产锁记录，不改已有依赖版本
- `scripts/after-pack.js`、`src/main/after-pack-workspace.test.js`、`src/main/after-pack-identity.test.js` — 2026-09-28 用户授权恢复实例合并/拆分阻断并修正删除后的收敛复验
- `scripts/source-scan.mjs`、`scripts/source-scan.test.mjs` — 构建输入的共享谓词、目录剪枝、单次运行 memo 及其机检
- `scripts/prestart-ensure.mjs` — client 失效判定、阶段凭据调用与输入扫描调用
- `vendor/deepseek-harness/scripts/build-stage-credentials.mjs`、`.d.mts`、`.client.spec.ts` — 阶段凭据的判定实现、类型声明与机检
- `vendor/deepseek-harness/scripts/build.ts` — 阶段驱动与产物记录刷新
- `scripts/prepare-dshd-remote.mjs` — DSHD remote 输入目录的扫描调用
- `scripts/after-pack.js` — 打包期资源断言与内置插件依赖树的完整性判定（与 `remote-workspace` 卡共享，只改断言相关行）
- `scripts/setup-harness.js` — `setup:harness` 复用同一份完整性判定
- `.github/workflows/release.yml` — 打包与上传编排（与 `windows-installer` 卡共享）
- 本卡与 [build-release handbook](../handbook/modules/build-release.md)

## Do not touch

- `package-lock.json` 的其他解析结果与已锁定依赖版本（上述 ws 补齐、窗口桥 Koffi 生产闭包除外）
- `SHA512SUMS.txt` 生成与更新器校验流；发行资产名称按 `windows-installer` 卡同步
- 真实发布、签名与 mac DMG 上传策略

## Gates

实例与生产依赖回归：`node --test src/main/after-pack-identity.test.js src/main/after-pack-workspace.test.js src/main/after-pack.test.js src/main/package-contract.test.js`。

| Kind | What |
| --- | --- |
| Automated | 按实际修改选择：`node --test src/main/package-contract.test.js src/main/installer-branding.test.js`（scripts / runtime deps / build 关键字段 / vendor filter / NSIS 字段）、`node --test scripts/source-scan.test.mjs`（构建输入谓词与剪枝）、`node vendor/deepseek-harness/node_modules/vitest/vitest.mjs run scripts/build-stage-credentials.client.spec.ts --environment node`（阶段凭据复用与失败拒绝）、`node --test src/main/after-pack.test.js`（装配完整性）；不追加无关全量文档治理 |
| Manual / QA | 打包冒烟 `npm run smoke:packaged`（真实产物）；安装器实机项见 `windows-installer` 卡的 `TC-INST-*` |

## Sources

- Decision: [项目审查修复](../decisions/implemented/bug-fix/2026-09-30-project-audit-fixes.md)

- Decision: [安装恢复边界](../decisions/implemented/bug-fix/2026-09-29-installation-recovery.md)

- Decision: [发布构建使用 Node 24 LTS](../decisions/implemented/process/2026-09-29-node24-release-runtime.md)

- Decision: [运行时按源实例装配并在解压后恢复链接](../decisions/implemented/architecture/2026-09-28-runtime-instance-layout.md)
- Decision: [打包实例门禁恢复与账户运行时依赖补齐](../decisions/implemented/bug-fix/2026-09-28-packaging-identity-gates-and-ws.md)
- Decision: [桌面清单保留完整脚本、运行时依赖与打包资源契约](../decisions/proposed/bug-fix/2026-09-19-desktop-manifest-runtime-contract.md)
- Decision: [构建输入按真实来源判定，每次运行只枚举一次](../decisions/proposed/process/2026-09-22-build-input-scan-dedup.md)
- Decision: [官方构建按阶段验证输入-产物凭据，命中即复用](../decisions/proposed/process/2026-09-21-build-stage-credentials.md)
- Decision: [打包装配复用已验证的插件依赖树](../decisions/proposed/process/2026-09-22-packaging-plugin-reuse.md)
- Evidence: [2026-09-19 审计修复计划](../superpowers/plans/2026-09-19-audit-repair-optimization.md)
- Implementation entry: `package.json`、`scripts/after-pack.js`、`scripts/production-runtime.js`、`scripts/install-harness.cjs`、`scripts/source-scan.mjs`、`src/main/package-contract.test.js`
- 相关卡：`windows-installer`（NSIS 品牌）、`remote-workspace`（dsh-remote 资源）、`desktop-launcher`（updater 元数据）
