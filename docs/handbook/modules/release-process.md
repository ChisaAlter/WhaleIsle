# 开发 CI 与自动发布

开发者在工作分支完成修改并提 PR，由用户确认合入 main。准备发布时在 PR 中更新 `package.json` 和锁文件的版本、更新 [.github/release-notes.md](../../../.github/release-notes.md) 及需要的译文。不修改版本的合并只产生开发反馈。

## 开发检查

[Development CI](../../../.github/workflows/test.yml) 在 PR 和 main 推送时运行。路径选择位于 `scripts/ci-scope.mjs`，只有产品、工具、上游、窗口四个固定分组，没有候选验收计划。

- 纯文档与规则说明不启动产品构建。
- Windows 产品检查构建官方 profile，执行桌面回归，生成 NSIS 安装包并启动 unpacked 应用。后者证明分发树能启动，不冒充已经验证所有安装和升级场景。
- 上游和窗口检查仅在相应改动时执行。
- 工具测试独立运行，不混入 `npm test`。
- 需要 macOS 时手动运行 Development CI，勾选 `include_macos`；默认只交付 Windows。
- 汇总检查名为 `CI`，失败或取消不会变成通过。main 的 GitHub 分支保护要求经 PR 合并，并要求 GitHub Actions 的 `CI` 检查通过；管理员同样受保护，禁止强推与删除。不强制第二位审查者批准，合并仍由用户决定。保护设置不要求分支必须追上最新 main，避免仅因无关合并重复构建。

安装或升级行为发生变化时，在开发阶段验证相应实际操作，并在 PR 说明结果。没有固定的每版人工验收全表。

## 自动分发

[Release](../../../.github/workflows/release.yml) 在 main 的 Development CI 成功后自动运行，发布实现位于 `scripts/publish-release.mjs`。

它使用同一次 CI 的 `Whale-Isle-windows-x64`（及存在时的 macOS）资产，核对版本、Setup、blockmap 和 latest.yml，生成更新器需要的 `SHA512SUMS.txt`，上传至 draft release，上传完成后公开。tag 指向产生资产的源码提交。不会运行产品测试、重新构建或要求验收 JSON。

同版本已发布、版本不高于 latest、或该 CI 只有文档/工具而没有安装包时不发布。PR 和 fork 的构建不能进入自动分发。现有正式版本与 tag 不覆盖。

## CNB 国内镜像

[CNB mirror](../../../.github/workflows/cnb-mirror.yml) 在 main 推送后同步 main 与标签；正式 GitHub Release 发布后同步原始附件。自动 Release 使用 GitHub 内置 token，其发布事件不会启动第二个工作流，因此也监听 Release 的成功完成。手动运行 CNB mirror，可指定已有正式版本（例如 `v0.3.3`），留空同步 GitHub latest。实现为 `scripts/sync-cnb.mjs`，不重新编译。

仓库 Actions variable `CNB_REPO` 设为 `ayasealter/WhaleIsle`。Actions secret `CNB_TOKEN` 使用仅限此仓库的访问令牌，开启 `repo-code:rw` 与 `repo-release:rw`，必须具有 `ayasealter/WhaleIsle` 的 Git 推送和 Release 写权限。缺凭据、分支或标签冲突、CNB 容量限制、上传或校验失败会使镜像工作流失败；不强推、不覆盖已有正式版本。GitHub 分发不因 CNB 故障回滚。

附件包括安装包、blockmap、latest.yml、SHA512SUMS.txt 和 GitHub Release 的其他附件。下载时核对 GitHub 的资产摘要及更新校验清单；CNB 先创建预发布版本，附件上传后逐个匿名下载核对原始字节的 SHA512，再转为正式版。中断版本保持预发布，重新运行会校验已有附件并补上传缺项。启动器只展示 CNB 正式版本，使用 `cnb.cool` 公共 JSON 接口（`Accept: application/vnd.cnb.api+json`，`page_size=30`，无需用户登录）获取最近版本并按版本号选择最新项，避免选中未完成镜像或后补上传的旧版。

实际可用性以 CNB main/tag、正式 Release 与匿名附件下载结果为准；仅合并工作流或设置 secret 不代表同步成功。

## 鲸桥组件

`.github/workflows/whalebridge.yml` 单独编译 `vendor/whalebridge` 并验证真实 Windows 程序的生命周期和本机网关。PR 提供开发资产；成功的 main 构建在组件版本尚未发布时自动创建 `whalebridge-v<版本>`，附件为 `WhaleBridge-win32-x64.exe` 和包含大小、SHA256、MIT 版权的 `WhaleBridge-component.json`。组件版本位于 `vendor/whalebridge/upstream.json`，独立于桌面 package.json。

该工作流成功后 CNB mirror 同步组件 tag 与原始资产，按组件清单检查二进制并完成匿名字节校验。GitHub 和 CNB 都保持桌面程序的 latest，不把组件设为最新桌面安装包。源码构建入口为 `node scripts/build-whalebridge.mjs`。

## 失败处理

开发检查失败时修复对应问题；需要重跑时使用 GitHub 的失败 job 重跑。发布上传失败保留 draft，手动运行 Release 并提供原 Development CI 的 `run_id`，复用原包完成分发。artifact 保留 30 天；过期后需要新的开发构建，不从另一个版本补包。

历史候选和验收报告保留原结果，不作为新流程的输入。没有人工签署、发布审批状态机或按文件路径扩张的人工检查表。

发布完成以实际 GitHub Release、资产和更新入口为准；仅修改配置不代表已发布。当前账号权限与 main 保护属于 GitHub 设置，不能从本文件推断已经生效。
