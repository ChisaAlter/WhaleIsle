# WhaleIsle 开发与维护

维护资料帮助找到代码、理解用户行为和保护桌面差异。开发反馈由 CI 提供，发布由成功构建自动完成。本文取代旧候选验收、签署、文档格式门槛和“CI 只能最终手动执行”的流程；历史记录保留事实，不再规定执行步骤。

## 开发

在工作分支实现需求，使用现有的相关验证，然后提 PR。PR 说明原需求、实际变化和验证结果；由用户决定合入 main。代理不能擅自缩减需求、吞掉错误、削弱有效断言，或为假想场景增加重试、兼容层和配置。遇到不能完成的部分直接说明。

本地用能回答当前问题的检查；开发 CI 提供共享环境、回归与装配反馈，不要求先在本机复制完整 CI。失败先查具体原因，修正后只重跑相关检查。已经通过的验证不因提交、推送或“不放心”重复执行。

新环境执行一次 `npm run setup` 即可搭好本地开发环境：它校验 engines 的 Node 版本、按锁文件装根依赖、跑 `setup:harness` 并准备 whale-ui 与 ChatGPT 插件构建；已就绪的步骤会快速跳过，可重复执行。

`npm test` 运行桌面和移动端行为测试；`npm run test:tools` 运行构建、发布及维护工具测试。定向验证直接调用现有测试文件。新增测试应能发现实际故障，不用测试数量或覆盖率目标替代用户结果。

依赖 Harness 构建产物、vendor 插件运行时、真实 Electron 或打包产物的用例经 `scripts/lib/test-prerequisites.cjs` 检测前提；缺失时按写明补齐命令的原因跳过，`WHALE_REQUIRE_TEST_PREREQS=1`（跑 `npm test` 的 CI 作业均设置）时改为失败，避免环境缺失被误读为真实回归或被跳过掩盖。

在 Linux 上启动真实 Electron 的测试进程会自动处理沙箱：chrome-sandbox 不是 root 所有或缺少 4755（以及测试本身以 root 运行）时，共享辅助 `scripts/lib/electron-sandbox.cjs` 给测试子进程加 `ELECTRON_DISABLE_SANDBOX=1`；`npm start` 与打包产物不受影响。

用户纠正代理的同一个 PR 里，尽量把这次纠正变成一条 lint 规则（eslint.config.mjs / scripts/eslint-rules）或一个测试；规则报错信息写清原因和替代做法，做不到时在 PR 中说明。修掉存量问题后用 `npx eslint . --prune-suppressions` 收缩豁免文件；新增豁免需要在 PR 中说明理由。

### 运行应用

`npm start` 先重建过期的 client 产物再启动 Electron；宿主环境若设有 `ELECTRON_RUN_AS_NODE`，需从启动环境中移除。产品运行时改动后重启仓库应用；文档和工具改动不需要启动。

源码 Electron 接受 `--background`：显示首个 main/launcher 窗口但不抢激活，随后用户进入仍保持正常焦点行为；恢复、更新确认和正常退出仍可要求注意。旧版已在运行的 owner 不支持该旗标，先正常退出该实例再启动新源码。

vendor web 构建对 `apps/web` 之外的包报 TS6059/TS6307 时，先在 vendor 目录执行 `node node_modules/typescript/bin/tsc -b apps/web --clean` 清除过期增量状态再重建；不要改 web 项目的文件列表掩盖错误。

## CI 与发布

### 性能调查

`node scripts/measure-desktop-runtime.mjs --out <新结果目录>` 在已执行 `npm run setup` 的源码环境中启动真实 Electron，用独立配置与 Git 工作区测量首次启动至工作台、经 `shell:restart` 重启至工作台、主线程 25 ms 心跳的最大延迟，以及 Electron 进程工作集的采样峰值总和（不含独立 Harness Node 进程）。首次启动保留操作系统缓存，不等同于清空磁盘缓存的冷启动。`--previous <report.json>` 对比同平台与架构的上次成功结果；源码快照可用 `--source-root <已准备目录>` 只读复用。正常或失败退出后先等待子进程结束，再回收临时配置；日志、原始采样和摘要留在结果目录。报告同时保留总峰值那一刻的进程 PID、Electron 类型和工作集分解，不能把不同时间的各进程峰值相加当作总峰值。

调查预算在 `scripts/desktop-runtime-budgets.json`：启动与重启各 30 秒、主线程最大延迟 200 ms、Electron 工作集峰值 1024 MiB。预算在测量前登记，超出时发出 CI 警告并显示实测值；它们是定位问题的线索，不是产品服务承诺，也不作为普通测试的时间断言。`Desktop performance trend` 每周一与手动在三平台运行，保存 90 天原始报告并与上次成功结果比较。超预算项以报告、平台和源码身份进入 Issue 后再做优化。

原有 `scripts/measure-desktop-lifecycle.mjs --profile c1` 继续只测隔离 Node 进程中的导入与目录列举热路径；其结果不能替代真实 Electron 启动、重启或主线程测量。

`test.yml` 在 PR、main 推送及手动运行时提供开发反馈。文档修改不触发产品构建。产品改动在 Windows 上构建实际分发 profile、运行行为测试、生成安装包并启动打包后的应用；上游行为与原生窗口检查按影响选择。版本号变化的 main 推送会同时构建 macOS 安装包，其他时候按需手动启用。

main 的开发 CI 成功后，`release.yml` 使用该次构建的原始资产。package.json 的版本高于已发布版本时自动发布；版本未增加则不发版。上传失败重试分发，不重编译。具体操作见[发布说明](../handbook/modules/release-process.md)。

不再要求候选计划、固定人工全表、验收 JSON、签字字段、验证日期刷新或累计失败计数表。真实缺陷、数据与权限边界仍按用户影响处理；测试记录只能证明实际执行过的行为。

## 项目知识

- [产品手册](../handbook/README.md)：模块、架构和操作入口。
- [功能资料](../features/README.md)：需要长期保持的用户行为与桌面差异。
- [设计语言](../design-language.md)：视觉规范。
- [历史决定](../decisions/README.md)：值得保留的原因和取舍。

同一个事实只在负责位置维护。AGENTS、rules 和技能只负责导航，不能再各自增加一套流程。普通修复写在 PR 中；产品契约改变时更新对应资料，不要求先建卡才能开发。内部资料可用一种语言；已有译文与历史保留，取消结构配对、摘要确认与格式校验。公开文档按读者需要翻译。

文档链接检查可用 `npm run docs:check`，按需执行，不作为产品发布条件。功能卡中的 Gates 和历史用例库用于寻找现成检查，不是必须全部执行的列表（语义见[功能资料](../features/README.md)）。

## 上游合并与差异保护

先查看 `vendor/harness-upstream.json` 和 `src/shared/harness-desktop-forks.js`，识别本地桌面差异；位置标记不能证明功能仍然正常。

1. 对照旧 pin 到目标版本的上游变化，以及当前 vendor 相对旧 pin 的本地修改；`npm run sync:harness -- --dry-run --ref <ref> --sha <sha>` 可预演。
2. 查看交集及受影响的配置消费者、生成资源和实际装配。没有 Git 冲突也要理解行为变化。
3. 保持已交付能力、用户数据和权限约定。上游提供等价实现时可替换本地补丁；涉及功能删减或产品取舍时由用户决定。
4. 验证本次影响的用户路径，更新 pin、差异位置和相关资料。上游带回的治理、hooks 和测试惯例不自动成为本项目流程。

## 验证结果

区分产品故障、测试工具错误和环境缺失；不能把未执行说成通过。UI、安装、数据保存等行为需要对应的实际观察，单测不能证明所有操作。报告实际改动、已观察结果和剩余问题即可，不建立第二套审批或证据平台。截图和录屏贴在 PR 或 Issue 里，不提交进仓库；`docs/qa/results` 只保留文字记录，旧截图的位置见[该目录的说明](../qa/results/README.md)。
