# 开发 CI 与自动发布

开发者在工作分支完成修改并提 PR，由用户确认合入 main。准备发布时在 PR 中更新 `package.json` 和锁文件的版本、更新 [.github/release-notes.md](../../../.github/release-notes.md) 及需要的译文。不修改版本的合并只产生开发反馈。

## 开发检查

[Development CI](../../../.github/workflows/test.yml) 在 PR 和 main 推送时运行。路径选择位于 `scripts/ci-scope.mjs`，只有产品、工具、上游、窗口四个固定分组，没有候选验收计划。

- 纯文档与规则说明不启动产品构建。
- Windows 产品检查构建官方 profile，执行桌面回归，生成 NSIS 安装包并启动 unpacked 应用。后者证明分发树能启动，不冒充已经验证所有安装和升级场景。
- 上游和窗口检查仅在相应改动时执行。
- 工具测试独立运行，不混入 `npm test`。
- 需要 macOS 时手动运行 Development CI，勾选 `include_macos`；默认只交付 Windows。
- `Release macOS single-file diagnosis` 的手动运行负责 Mac 打包与真实包内窗口验收。普通运行检查当前 ref；显式填写 `source_tag` 时检出该不可变产品标签，只覆盖两项已记录哈希的客户端构建工具，并输出产品提交与构建工具提交的来源记录。工作流本身不发布；新版本仍使用同次 main Development CI 原始附件，既有版本的 Mac 补发使用下述独立入口。
- 汇总检查名为 `CI`，失败或取消不会变成通过。main 的 GitHub 分支保护要求经 PR 合并，并要求 GitHub Actions 的 `CI` 检查通过；管理员同样受保护，禁止强推与删除。不强制第二位审查者批准，合并仍由用户决定。保护设置不要求分支必须追上最新 main，避免仅因无关合并重复构建。

安装或升级行为发生变化时，在开发阶段验证相应实际操作，并在 PR 说明结果。没有固定的每版人工验收全表。

## 自动分发

[Release](../../../.github/workflows/release.yml) 在 main 的 Development CI 成功后自动运行，发布实现位于 `scripts/publish-release.mjs`。

它使用同一次 CI 的 `Whale-Isle-windows-x64`（及存在时的 macOS）资产，核对版本、Setup、blockmap 和 latest.yml，生成更新器需要的 `SHA512SUMS.txt`，上传至 draft release，上传完成后公开。tag 指向产生资产的源码提交。不会运行产品测试、重新构建或要求验收 JSON。

同版本已发布、版本不高于 latest、或该 CI 只有文档/工具而没有安装包时不发布。PR 和 fork 的构建不能进入自动分发。现有正式版本与 tag 不覆盖。

### 既有正式版本补发 Mac

用户明确要求补发时，先在 `Release macOS single-file diagnosis` 填写既有 `source_tag`，完成该标签的 Mac 打包、原生按钮及窗口检查，并实际审阅普通、窄窗、侧栏和全屏截图。产品源码保持标签提交；构建来源附件记录两项编译工具的原始哈希。工具提交须经评审合入 main。

随后在 main 手动运行 `CNB mirror`，同时填写 `tag` 和成功的 `macos_run_id`。该入口核验同仓库成功运行、不可变产品提交、已合入 main 的工具提交和唯一原始 ARM64 DMG，复用原包向 GitHub 与 CNB 补发。保留已发布 Windows EXE、blockmap、latest.yml 的字节及资产 ID，保留 release/tag/latest；唯一可扩展的旧附件是 `SHA512SUMS.txt`，原条目逐字不变，只增加该 DMG 一行。先扩展清单，再新增 DMG，完成后匿名校验镜像。普通镜像的缺失或变更保护保持不变，不使用补发入口重传 Windows。

Mac 更新走完整 DMG 下载并使用 `SHA512SUMS.txt` 校验，不生成 `latest-mac.yml`。当前提供 Apple Silicon arm64 包，未签名、未公证。

### Android 独立发布

[Release Android](../../../.github/workflows/release-android.yml) 手动构建原生 Android APK；`publish=false` 可检查工作分支，`publish=true` 只允许 main。执行协议与应用 JVM 测试、release lint、正式签名和模拟器安装/启动/连接入口检查，再记录 APK 版本、来源提交、摘要及签名证书。

Android 使用 `android-v<版本>` 独立标签，初次版本为 0.3.10 / versionCode 4，包名 `ai.deepseek.harness.mobile`，最低 Android 8.0。发布脚本只上传 APK、`android-release.json` 和独立 `SHA512SUMS.txt`，GitHub 与 CNB 均不设为桌面 latest，不改原桌面附件或校验清单。CNB 先预发布，匿名下载校验后公开；上传失败复用匹配原字节的未完成版本，冲突失败。

正式私钥由 `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` Actions secrets 提供；`ANDROID_KEY_ALIAS` / `ANDROID_SIGNING_CERT_SHA256` 为公开配置。私钥不进 Git，更新须保留同签名并递增 versionCode；历史 debug 签名不等于正式签名。模拟器结果不证明真机相机、扫码配对、公网流式对话或旧签名升级，实际未测范围写在 Android 发布说明中。

## CNB 国内镜像

[CNB mirror](../../../.github/workflows/cnb-mirror.yml) 在 main 推送后同步 main 与标签；正式 GitHub Release 发布后同步原始附件。自动 Release 使用 GitHub 内置 token，其发布事件不会启动第二个工作流，因此也监听 Release 的成功完成。手动运行 CNB mirror，可指定已有正式版本（例如 `v0.3.3`），留空同步 GitHub latest。实现为 `scripts/sync-cnb.mjs`，不重新编译。

仓库 Actions variable `CNB_REPO` 设为 `ayasealter/WhaleIsle`。Actions secret `CNB_TOKEN` 使用仅限此仓库的访问令牌，开启 `repo-code:rw` 与 `repo-release:rw`，必须具有 `ayasealter/WhaleIsle` 的 Git 推送和 Release 写权限。缺凭据、分支或标签冲突、CNB 容量限制、上传或校验失败会使镜像工作流失败；不强推、不覆盖已有正式版本。GitHub 分发不因 CNB 故障回滚。

附件包括安装包、blockmap、latest.yml、SHA512SUMS.txt 和 GitHub Release 的其他附件。下载时核对 GitHub 的资产摘要及更新校验清单；CNB 先创建预发布版本，附件上传后逐个匿名下载核对原始字节的 SHA512，再转为正式版。中断版本保持预发布，重新运行会校验已有附件并补上传缺项。启动器只展示 CNB 正式版本，使用 `cnb.cool` 公共 JSON 接口（`Accept: application/vnd.cnb.api+json`，`page_size=30`，无需用户登录）获取最近版本并按版本号选择最新项，避免选中未完成镜像或后补上传的旧版。

实际可用性以 CNB main/tag、正式 Release 与匿名附件下载结果为准；仅合并工作流或设置 secret 不代表同步成功。

## 鲸桥组件

组件源码和 CI 已迁至 [WhaleBridge](https://github.com/ChisaAlter/WhaleBridge) 独立仓库。其 `upstream.json` 管理组件版本，`scripts/build.mjs` 生成 Windows 二进制及包含大小、SHA256、MIT 版权的清单。鲸屿不再编译或发布 Go 组件，只维护下载、启动、原生管理窗口与实际联动 QA。

独立仓库的 Windows CI 保留网关与设置回归，并验证构建后二进制的实际启动协议及组件页面交互。成功的 main 构建在组件版本尚未发布时发布 `whalebridge-v<版本>`，附件契约保持 `WhaleBridge-win32-x64.exe` 和 `WhaleBridge-component.json`。工作分支与 PR 只产生检查和开发产物。

桌面安装包不携带组件二进制，安装桌面更新也不等于已更新组件。用户从启动器明确安装或更新鲸桥，社区插件同样需要用户选择与信任确认。组件能力与版本以实际下载的组件清单和二进制为准，不能从桌面版本推断已经更新。

鲸屿的 CNB 工作流只监听桌面 Release；现有镜像中的历史组件和手动校验能力保留。独立仓库已公开，稳定 1.1.0 原始资产已迁入并通过宿主实际匿名下载安装验证。独立鲸桥的 `CNB_TOKEN` 已加密迁入，新工作流只同步新组件 tag 和发布原始字节；首次新版本的实际 CNB 镜像仍待发布后校验。1.2.0 的代码及工作流尚在开发分支，未发布新版；旧仓库手动关闭的发布和镜像工作流没有重新启用。

## 失败处理

开发检查失败时修复对应问题；需要重跑时使用 GitHub 的失败 job 重跑。发布上传失败保留 draft，手动运行 Release 并提供原 Development CI 的 `run_id`，复用原包完成分发。artifact 保留 30 天；过期后需要新的开发构建，不从另一个版本补包。

历史候选和验收报告保留原结果，不作为新流程的输入。没有人工签署、发布审批状态机或按文件路径扩张的人工检查表。

发布完成以实际 GitHub Release、资产和更新入口为准；仅修改配置不代表已发布。当前账号权限与 main 保护属于 GitHub 设置，不能从本文件推断已经生效。
