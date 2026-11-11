# Windows 0.3.3 候选推进记录

## 范围与授权

用户要求准备 Windows 新版本，随后报告 Files 查看器把 `sidebar://desktop-file` 当成磁盘路径的 ENOENT，并指出「文件」与「文件查看器」入口重复。2026-10-01 用户明确要求修好后继续发布。版本保持 0.3.3，仅构建 Windows x64；此前候选 `36604949879` 不含本轮审查和 Files 修复，不可晋级为本轮产物。

本轮沿用 [发布手册](../../../handbook/modules/build-release.md) 和 [生产验收表](../../../qa/production-acceptance-test-cases.md) 的门禁，不把源码测试或 unpacked 演练写成正式安装版 Pass。

## 源码修复与预检

- 全面审查修复已提交为 `ddb966a20`，证据见 [审查报告](../2026-09-30-project-audit-fixes/README.md)。
- Files guide 只保留目录入口，具体文件继续进入编辑页；旧无文件查看器原位显示所属 Session 目录，不迁移布局、浮窗或有效文件草稿。决定见 [Files 地址恢复](../../../decisions/implemented/bug-fix/2026-10-01-sidebar-files-guide-address.md)。
- 使用 `.nvmrc` 钉定的 Node 24.21.0。新真实 Guide / registry / controller / keyed body / 恢复布局回归 9/9，独立复跑 9/9；既有 adapter / apply 16/16。窄 lint 无错误或警告，client aggregate `tsc -b tsconfig.client.json` exit 0，官方 client catalog 检查通过。
- `scripts/prestart-ensure.mjs` 官方 native / host / client / web 构建 exit 0，记录 372 个 client 产物；构建日志为本机 `%TEMP%/dshd-files-guide-build-final.log`。
- 关闭按钮与夹具修复提交 `9c4572b6582f69abe734b45b4982bc4c20a7f0f9` 的官方构建再次 exit 0，记录 372 个 client 产物，公开构建身份 `9c4572b`；`npm start` 重启后 protected peer 实际返回 `kernel: ready`、`webReady: true`。日志 `%TEMP%/dshd-alignment-official-build.log`、`%TEMP%/dshd-alignment-restart-out.log`。
- 本机全量 GUI 首轮受待机恢复影响出现多条超时和 worker 终止异常，未取得有效全组汇总，另有文件 symlink 夹具权限失败；未修改 timeout、断言或 skip，不宣称本机全组通过。该提交在 CI 的完整 GUI 结果见下节。
- 首次源码 QA 因 `ERR_NETWORK_IO_SUSPENDED` 后超过 600 秒而失败，未生成可通过的走查结果；保留 `%TEMP%/dshd-files-guide-source-qa.log` 和 `%TEMP%/dsh-source-qa-vlFYC8/` 供复查，不把该次启动写成通过。
- 第二次源码 QA 执行 77 步：68 通过、8 必需项失败、1 可选项跳过；Files 工作环 8/8 通过。隔离仓缺本地 Git author、账户/远程旧入口与文案、未解析 `aria-labelledby`、模型确认与页面等待等夹具问题正在修正；推理停止后的输入状态与技能装配仍须复跑排除，未将静态诊断记为 Pass。证据为 `%TEMP%/dsh-source-qa-DLnGCu/`，不得将含隔离会话 token 的原始结果全文发布。
- 隔离 Git fixture 已写入仅该仓库的 author，`smoke-workspace.test.mjs` 7/7 通过，既有真实 workspace 模式仍不做 Git 修改。未改全局 Git 身份。
- 用户随后指出右栏关闭按钮偏低；24px 桌面 tab 仍使用共享 28px tab 的固定顶部定位，导致下偏 2 CSS px。已改为随标题 cross-axis 居中，保持关闭在标题右侧及原命中区。隔离真实 Electron 12 组宽度/字号/缩放下盒中心差不超过 0.006 CSS px，关闭一次、未触发拖拽；既有 DockKit 组件 87/87。证据 `%TEMP%/dshd-tab-close-alignment/`，新候选须包含该修复。
- 源码 UI 走查接线已按现行账户入口、可访问名称和保存凭据状态修正，并严格等待停止后输入与技能页内容就绪；原 required 项和超时保留。VM 反例/正例 12/12 通过，真实 UI 重跑见下一条；见 [走查契约](../../../decisions/implemented/process/2026-10-01-release-ui-walk-contract.md)。
- 第三次源码 QA（`9c4572b`）77 步：73 通过、3 必需项失败、1 可选项跳过。Git 提交、账户 / 远程实际弹窗、技能页和 Off → Low 推理切换已通过；剩余自定义模型保存 UI 确认、MCP 搜索与会话日志开关仍在诊断，未标 Pass。证据 `%TEMP%/dsh-source-qa-zbLvTV/`、`%TEMP%/dshd-alignment-source-qa.log`。
- 第四次源码 QA 77 步：75 通过、1 必需项失败、1 可选项跳过。MCP 就绪等待和原生 checkbox 状态已修正；剩余自定义模型确认。随后确认旧 helper 在提交按钮变成 `Creating… / 创建中…` 时把仍存在的表单误判为关闭，提前 dismiss / 重开设置。已补忙碌态反例并修正判断，15/15 单测通过，12 秒总预算不变；此前“47ms 已关闭”及产品热刷新故障归因撤回。证据 `%TEMP%/dsh-source-qa-AAsEOO/`、`%TEMP%/dshd-qa-fixture-source-qa.log`。
- 生产验收表三处旧示例已机械同步：artifact 名为 `Whale-Isle-windows-x64`，Harness 比较候选包内 pin，随包 Harness Node 的完整版本比较候选 SHA `.nvmrc` 与 CI 日志（当前 24.21.0）。原步骤、P0、同 CI Setup 与正式安装验收要求保持，历史 §15 / §16 签字不继承到本轮。
- 第五次源码 QA 仍为 75 通过、1 必需项失败、1 可选项跳过，自定义模型重开设置后的确认未通过；忙碌态误判修正不能独自解释该结果。证据 `%TEMP%/dsh-source-qa-QSIRqS/`、`%TEMP%/dshd-qa-busy-fix-source-qa.log`。用户随后要求以安装包正确为准，源码专用问题不阻断发行；此项不写 Pass，是否影响安装版由同一 CI Setup 实测决定。
- 用户报告任务栏再次显示 Electron。已声明首次显示前的 Shell 身份、真实 ICO / 安装 EXE 内嵌图标及安全重启命令，并阻止原始 Windows Electron 源码系统通知再次注册同身份快捷方式。定向 71/71；真实隐藏 desktop / slim 共四窗口的同进程 Shell 属性通过，旧 WM 图标保持鲸鱼；同进程未声明对照属性为空。跨进程属性探针在本机不可靠，已撤回该空值解释。证据 `%TEMP%/dshd-taskbar-icon-readonly/IMPLEMENTATION-VERIFICATION.md`，见 [任务栏身份决定](../../../decisions/implemented/bug-fix/2026-10-01-windows-taskbar-identity.md)。
- 本次任务栏代码批次源码已通过 protected peer 自然退出后正常 `npm start` 重启，PID 20496，实际返回 `kernel: ready`、`webReady: true`。安装版 / 用户任务栏实显尚未据此标 Pass。
- 原生窗口 QA 主窗 / 启动器的生产工厂与 IPC 最大化、还原、最小化及页角 alpha 通过。合成桌面检查 `main-active` 未通过：角落 inset 0 / 1 有两像素边缘，2–4 透明；证据 `%TEMP%/dshd-taskbar-composed-corners/`。该结果不能认证可见圆角或 DWM 动画，正在对照旧工厂，并须在同一 CI 安装版复测。
- 同环境未声明 metadata 对照两窗八阶段通过；声明后的第一次复采 `main-restored` 左上被含字形的黑色矩形遮挡，且延伸到窗口外，样本标为无效，不能推断 DWM 回归。仅将自有 QA 窗口位置右移、保持尺寸和全部断言后，有效声明复采两窗八阶段通过，160 个角落采样 delta 均为 0。首次细边线失败仍保留，不以反复运行挑选结果；见 `%TEMP%/dshd-taskbar-full-tests-summary.md`。源码合成结果不代替安装版和人工可见动画验收。

## 候选身份与晋级

首轮源提交 `c28101455f5cdbccf6dcc2463e466ed3d9553954`：

- [Desktop tests 36793951096](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36793951096) 整体失败。Windows 2886 项：2880 通过、6 跳过、0 失败；原生窗控契约通过，本机 EPERM 的 symlink 用例在该 CI 真实执行通过。macOS 2886 项：2857 通过、13 失败、16 跳过。
- 同运行 vendor GUI 748 文件：11089 通过、1 跳过；新 Files 注册 9/9；核心 215 文件：5009 通过、5 跳过；无密钥 malformed-tool 恢复 1 通过、134 个未选用例跳过；catalog / notices 最新。
- [Windows 候选 36794053414](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36794053414) 已取消。该 SHA 整体测试未绿且随后出现关闭按钮对齐修复，不生成可晋级身份，不使用其二进制。
- macOS 的 13 条失败来自旧 Windows `.exe` 夹具未声明目标平台；仅修正 `runtime-install.test.js` / `update.test.js` 的逐测试平台与三个直接安装参数，保留所有断言，新增 2 条默认 API 的 arm64 DMG 回归。定向四文件原生 Windows 86/86、模拟 darwin/arm64 86/86，均无跳过；实际 macOS CI 必须由新 SHA 重新证明。

待新候选 `release.yml` 与同 SHA 的 `test.yml` 完成后，记录源提交、运行 URL、原始 artifact、Setup SHA256、离线资产校验和包内 Node / Harness 身份。不得沿用旧候选摘要。

`9c4572b6582f69abe734b45b4982bc4c20a7f0f9` 的 [Desktop tests 36798464888](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36798464888) 整体成功：Windows 2894 项，2888 通过、6 跳过、0 失败；macOS 2894 项，2878 通过、16 跳过、0 失败。vendor GUI 748 文件、11089 通过、1 跳过；核心 215 文件、5009 通过、5 跳过。该 SHA 尚不包含本次任务栏及后续 QA helper 修复，不能认证更新后的工作树。

首轮任务栏身份修复源提交为 `953bb20a16a0ea8becf63bd5311c1feae7f35279`，已推送并核对远端 main 相同。[Windows 候选 36804159162](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36804159162) 与同 SHA [Desktop tests 36804047677](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36804047677) 均为 `completed / success`。Windows 2924 项：2918 通过、0 失败、6 跳过；macOS 2924 项：2908 通过、0 失败、16 跳过。vendor GUI 748 文件、11089 通过、1 跳过；核心 215 文件、5009 通过、5 跳过。Windows 的 6 跳过包括 POSIX 信号分支及 5 个未准备 remote dist / dependencies 的分支，不把真实 daemon e2e 写为 CI Pass；该 daemon 本机独立串行复跑通过。

候选仅构建 Windows，macOS job 按 dispatch 参数跳过。NSIS、afterPack、阻断式 packaged smoke 和 artifact 上传成功；日志中的实际 smoke 仅执行一次且首轮通过，UI / titlebar hits / PTY 正常、`pageErrors: []`。这仍是 CI unpacked 检查，不替代正式安装版、任务栏持续正确、合成圆角及可见动画验收。原始 artifact `Whale-Isle-windows-x64` ID `11137831307`，归档大小 `593569940` 字节、未过期、关联精确 SHA `953bb20a16a0ea8becf63bd5311c1feae7f35279`。原始日志与计数证据 `%TEMP%/dshd-ci-953-summary.md`。无新增 tag / Release。

## 原始 CI 安装包离线核对

首轮下载因 `unexpected EOF` 失败，第二轮未取得数据；改为可续传下载后，完整 ZIP SHA256 与 GitHub artifact API 的 `5dce2989903dc30f9f10530fb660fc695d8511120fa7f9927320ff357493fa5b` 一致。ZIP 只有预期的三个平面文件，ZIP / NSIS / x64 内层 7z 完整性检查通过；本节为当时的离线阶段，仅解压且没有运行 Setup 或 Whale Isle；后续实际执行另记在下一节。

| 原始文件 | 字节数 / 本轮结果 |
| --- | --- |
| `Whale-Isle-Setup-0.3.3.exe` | 594836810；SHA256 `18dbc8421c4ad960d7f17065408f8f7cbf9e9a553894e3eb0078f98d48fe6701` |
| `Whale-Isle-Setup-0.3.3.exe.blockmap` | 583541；对应同一 Setup 文件名，未捏造元数据不提供的 blockmap 摘要字段 |
| `latest.yml` | 349；版本、文件名、Setup size、SHA512 均与实际文件一致 |

`check-release-version v0.3.3` 与 `check-release-assets` 通过；原始三件套的下载目录副本再次通过相同摘要和资产校验：`C:\Users\48818\Downloads\Whale-Isle-CI-36804159162`。这些离线检查不认证安装版；实际安装后的失败与恢复见下一节。

- 实际 `app.asar` 的版本 / 产品为 `0.3.3` / `Whale Isle`；七个任务栏身份与通知相关模块逐文件匹配 `953bb20a`，仅归一化换行。首次离线 helper 用 POSIX 分隔符调用 Windows ASAR API 导致读取失败；改用 `path.normalize` 后实际文件读取并比对通过，未改变包内字节或产品代码。
- 实际 `resources/node.exe --version` 为 `v24.21.0`；随包 Harness pin 为 `dsh-v0.1.7-rc.2` / `477b4f420553e8a52c2fbccc464d7561b239c443` / `0.1.7-rc.2`。运行时 tar 为 1166144512 字节，SHA256 `79c708e03a5f4131402cdff54848ce5df0e8bd83b54123fba0cfbfa07261f2f0` 与随包 manifest 相同。
- 实际 `Whale Isle.exe` 为 x64，PE 产品名 / 描述是 `Whale Isle`、文件版本 `0.3.3`，图标索引 0 的 32px / 16px 资源均成功提取并释放 HICON；人工查看 32px PNG 是鲸鱼头像。见 [CI EXE 图标](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-exe-icon-32.png)。这只证明内嵌图标，不认证 Windows 当前分组、快捷方式或可见任务栏。
- 随包 official build record 为 `953bb20` / `official` / `Whale Isle` / `0.1.7-rc.2`，构建前裁剪记录 372 个 client 产物；没有对剥除 maps 的运行时重算该构建前摘要。实际物理模块在 `packages/client`，`.dsh-runtime-links.json` 将公开 package alias 指向这些目录，启动后才重建链接。最初按 `node_modules` 物理路径取样无文件，按真实计划核对后通过；不能将这一预期布局写成缺包。
- 实际 `ui-files/lib/client.js` 含唯一目录 guide，文件 viewer 仅认 Session 文件资源且不再提供空 viewer guide；旧空 / 内部地址回退 `SidebarFilesPanel`。实际 DockKit CSS 的关闭控件按标题轴居中并保留 `right: 4px`，全文换行归一化后匹配 `953bb20a` 源码；对应组件及右栏入口确实消费该样式和包。此为修复打包存在性证据，不代替实际 UI 工作环。

完整只读结果见 [原始包证明](ARTIFACT-PROOF.json)。其中未运行安装器 / 应用的字段记录离线核对阶段，不代表后续安装状态；后续执行见下一节。安装版 P0、Models 保存复测和 §16 签字仍未完成。

## 原始 CI 安装版执行与任务栏失败

用户明确同意安装并操作窗口验收后，源码实例经 authenticated protected peer 正常退出。原始 Setup 安装到用户指定的安装目录，安装器退出码 0，已安装 EXE / app.asar 与原始 CI 载荷字节一致；已有配置和凭据文件在安装后摘要不变。桌面和开始菜单快捷方式均指向已安装 EXE、无参数、图标 index 0、正式 GUI AppID。

首次启动带了隐藏参数，早期没有有效的任务栏样本，不能将该次不可见窗口诊断记为产品图标失败。后续从正常快捷方式启动，精确安装 EXE / CDP socket owner / peer PID 与 generation 均匹配，实际 kernel ready、webReady true。Codex 宿主的 APPDATA 文件观察者视图重定向到 LocalCache；仅凭观察者 realpath 不等于逻辑路径不能给默认 profile 验收下结论。后续已以实际主窗 IPC 的 dshHome / 版本、随包 Node CLI 的运行时路径及 peer / socket 身份证明同一默认 profile，不复制到隔离用户目录作为正式安装验收。

用户截图确认该安装版任务栏仍显示 Electron 原子，记 Fail。只读检查找到同 AppID 的旧开始菜单 Electron.lnk，目标为源码 Electron、空参数、默认图标；与新 Whale Isle.lnk 冲突。此候选未覆盖存量恢复，不可用之前正确的窗口属性 / EXE 图标证明宣称问题已修。

对精确匹配的旧条目保留完整字节备份并移出开始菜单，再通知 Shell 已完成的精确旧路径 → 备份路径并冷启动。PID 29108 的生产 AppID 任务栏按钮得到有效 66×72 像素，截图前后安装 EXE / socket owner / peer PID 与 generation 相同，人工查看确为鲸鱼头像，见 [恢复后的实际任务栏](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-after-recovery.png)。早期自动定位无结果 / 全黑图片 / helper 取摘要错误均为无效取样，不能作为图标 Pass 或 Fail。该有效样本只证明人工恢复后的当次像素，不证明原候选自动恢复；没有重启 Explorer、清全局缓存或修改用户固定项。此为历史捕获记录，不把 PID 29108 写成持续存活保证。

后续持久修复按 [任务栏身份决定](../../../decisions/implemented/bug-fix/2026-10-01-windows-taskbar-identity.md)补存量恢复：严格匹配、唯一原字节备份，只在成功移动后异步通知精确路径，不匹配分支不加载原生桥，通知失败保留备份并继续启动。Shell 通知等待自身也有 500ms 期限。此前身份及存量恢复定向累计 97/97，加入原生通知与期限后的旧条目最终定向 32/32；真实 Electron 读取旧用户备份的 TEMP 副本，原字节恢复及精确 SHCNE_RENAMEITEM / SHCNF_PATHW | SHCNF_FLUSHNOWAIT 通知成功（16ms），原用户备份不变，未改实际开始菜单或初始化通知。这不替代新安装版的自动恢复验收。

## 原始安装版退出失败与绘制等待修复

原候选 PID 2188 完成 protected peer 退出确认且 peer 文件已删除，但主窗和 Harness Node 仍长时间存活，记 Fail。精确 EXE / socket owner 绑定下，boot 页面已隐藏且关闭遮罩存在；500ms 与 700ms 只读探针均未收到第一帧或第二帧。退出链在正常 Harness shutdown 之前无限等待遮罩的双 requestAnimationFrame。代码核对撤回“before-quit 监听器注册迟到”假设，监听器在 whenReady Promise 外同步注册。

修复在主进程对 CSS / 脚本 / 两帧的整个等待设置 500ms 期限，继续原任务检查、接纳锁、排空、资源清理和正常关停，不使用 app.exit 或强杀。定向 43/43，其中遮罩 9/9，包含不响应 CSS / 脚本、正常清 timer、错误和迟到拒绝。真实隔离 Electron 隐藏页中，旧包 helper 超过 700ms 未完成，新 helper 511ms 返回且遮罩存在、正常关停继续、无未处理拒绝或强制退出；未展示窗口、改用户 profile 或操作原安装应用。见 [绘制等待决定](../../../decisions/implemented/bug-fix/2026-10-01-closing-overlay-paint-deadline.md)。隔离夹具通过不能写成新安装版退出 Pass。

## 本机全量结果与下一候选边界

原 SHA 953 的本机 Node 24.21.0 全量为 2924 项、2897 通过、18 失败、9 跳过；不得宣称本机全量通过。14 项涉及链接权限（其中部分 EPERM 被导入错误包装为缺失文件）；其余 4 项窄复跑后预览清理、personality 重试和真实 daemon 通过，启动器 zoom 原夹具几何断言仍失败。新增 27 项任务栏 / notification permission 回归在全量中通过。上述本机失败在精确 SHA 的 Windows CI 中实际执行通过。

加入旧条目恢复、尚未加入绘制期限与最终 Shell 通知测试时，本机全量为 2950 项、2927 通过、14 失败、9 跳过；失败均为本机 Windows 文件 symlink 权限夹具。原额外 4 项在此轮实际通过；没有修改断言、跳过或降低超时。日志只作该批次记录，不覆盖随后工作树。后续最终批次必须重新核对同 SHA CI 与必要的本机测试。

最终产品批次的本机 Node 24.21.0 全量为 2962 项、2939 通过、14 失败、9 跳过，耗时 195454ms；不宣称全量通过。失败仍是相同的 14 个文件 symlink 权限夹具：Setup 1 项、config / mcp-settings / credentials 各 4 项、gitCheckLargeFiles 1 项。新遮罩期限与旧快捷方式恢复没有新增失败；日志为本机 `%TEMP%/dshd-final-0.3.3-root-tests.log`。最终 SHA 的新 CI 仍须实际证明这些用例通过。官方 source prestart 构建通过并记录 372 个 client 产物，源码启动器已启动本批代码；尚未据此宣称 kernel ready 或安装版验收通过。

安全执行摘要见 [执行证明](EXECUTION-PROOF.json)，与 [离线原始包证明](ARTIFACT-PROOF.json)分阶段保留。原 36804159162 实际任务栏与退出均失败，不再晋级。持久存量恢复与绘制期限是新增产品改动，必须生成新的 CI 原始 Setup、核对完整身份和摘要，并完成同一安装包的生产 P0、Models / 实际工作环、合成圆角 / 可见动画以及 §16 签字。目前新候选安装版未验收，未创建 v0.3.3 tag 或 Release；publish.yml 必须下载并验证最终实际验收的原始候选字节。

## 新候选 e3：同 SHA CI 与原始包静态核验

本节对应精确产品提交 `e3cdc4dd34b4763dcc110e05889a213bad105b94`，包含旧通知快捷方式自动恢复、定向 Shell rename 通知的 500ms 期限，以及关闭遮罩绘制等待的 500ms 期限。[Windows 候选 36820230025](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36820230025) 与同 SHA [Desktop tests 36820208830](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36820208830) 均经 GitHub CLI 重新核对为 `completed / success`，两者 `headSha` 均等于该完整 SHA。测试运行的 Windows、macOS、vendor GUI jobs 均成功；候选只构建 Windows，macOS job 按参数跳过。

候选 Windows job 的 NSIS 构建、阻断式 win-unpacked packaged smoke 和原始 artifact 上传均成功。CI smoke 属于安装树检查，不认证正式安装版工作环、任务栏、圆角或可见 DWM 动画。原始 artifact `Whale-Isle-windows-x64` 的 ID 为 `11143147766`，完整 ZIP 为 `593574528` 字节，实际 SHA256 `8fda10f6afef3249508ec38a0ea76fa55e7470b589a0d424938abf8d3a3cce9f` 与 GitHub artifact digest 一致。ZIP 只含以下原始三件套，ZIP、NSIS、内嵌 x64 `app-64.7z` 的完整 7Zip 检查均通过。

| 原始文件 | 字节数 / 本次核验 |
| --- | --- |
| `Whale-Isle-Setup-0.3.3.exe` | 594842754；SHA256 `070a2a60cbb2da53aa9ecc6363a21d4e07bda9e1c8c7817722bbf82baaf6135b` |
| `Whale-Isle-Setup-0.3.3.exe.blockmap` | 582512；SHA256 `e55f2f7928721d9fbb6a69a84d39accb03937251ae4dc418fda9e3e6998383b1`；元数据未提供独立 blockmap 对应摘要，不据此认证其与 Setup 的密码学对应 |
| `latest.yml` | 349；版本、文件名、Setup size、`files[].sha512` 和顶层 `sha512` 均与实际 Setup 一致 |

`check-release-version v0.3.3`、`check-release-assets` 和全量只读静态 verifier 均退出 0。静态阶段未运行安装器或 Whale Isle；仅执行随包 `resources/node.exe --version`。可公开的字段与完整摘要见 [e3 原始包证明](ARTIFACT-PROOF-e3.json)，未附本机绝对路径、用户配置或原始日志。

- 实际 `app.asar` 为 `63705746` 字节，SHA256 `8dd2c77b58102e6c738aafd12b9895b70da8a2c4b73bee0e00757c44e859b7a2`，产品 / 版本为 `Whale Isle` / `0.3.3`。九个实际模块逐个读取并仅归一化换行后匹配精确 e3 源码：`window-app-details`、`system-notifications`、`window`、`media-permissions`、`index`、`update-attention`、`product-identity`、`legacy-notification-shortcut`、`closing-overlay`。
- 随包 Node 实际为 `v24.21.0`，与候选 `.nvmrc` 一致。Harness pin 为 `dsh-v0.1.7-rc.2` / `477b4f420553e8a52c2fbccc464d7561b239c443` / `0.1.7-rc.2`，与候选 pin 一致。运行时 tar 为 `1166144512` 字节，SHA256 `3a73173b15ba0500a8cbebb998eb7d82aee1617d26195cf5041e657bb428b992` 与随包 manifest 一致。
- 从当前已核对摘要的 tar 直接取出的 official build record 为 `e3cdc4d` / `official` / `Whale Isle` / `0.1.7-rc.2`，记录裁剪前 372 个 client 产物；没有以剥除 maps 的 tar 重算裁剪前摘要。Files、DockKit、右栏的物理 package 与运行时 alias 计划一致。实际编译结果包含唯一目录 guide、资源限定的 viewer、旧空地址目录回退；关闭控件按标题轴居中、保留右侧定位，实际 CSS 全文匹配候选源码。
- 实际 EXE 为 x64，SHA256 `dbaf9016cd260d91717f8aaa253875659370987d4490c1c1e56567d7729332fe`；产品名 / 描述为 `Whale Isle`，Windows 四段 `ProductVersion` 为 `0.3.3.0`，`FileVersion` 为 `0.3.3`。首次 verifier 将 ProductVersion 与三段 package version 直接比较，导致 helper 断言失败；修正为分别精确检查四段 / 三段后整体验证通过，候选字节未改。
- 从本次 EXE 新提取的图标 index 0 为 32px / 16px，两个 HICON 均释放。32px PNG SHA256 为 `413f4161b6a3ebca708126a530c653812a3caca07f13d4190e8205281e686629`，人工重新查看为产品头像，且与已保存的 [图标资源参考图](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-exe-icon-32.png) 字节一致。这只认证资源存在与正确，不能认证实际任务栏分组或持续显示。

本节只完成新候选的 CI 身份和离线静态核验。离线 JSON 中安装及 UI 的 `Not Run` 记录该阶段的边界，后续实际执行见下节。旧 `953bb20a` 的原始任务栏 / 退出 Fail、手动环境恢复和隔离夹具结果保留在前文及旧 JSON；任何历史 Pass 均不继承为 e3 安装版 Pass。尚未发布新 Release。

## 新候选 e3：实际安装、自动备份与首启任务栏 Fail

同一原始 CI Setup 实际安装退出码 0。已安装 EXE、app.asar、随包 Node、Harness tar、runtime manifest、Harness pin 六个文件均与原始载荷完整摘要一致；既有配置、凭据以及 5 个 session / storage 文件保持原字节。安装器未自行启动应用。随后从正式桌面快捷方式正常冷启动，实际 EXE、CDP socket owner、protected peer PID / generation 绑定一致，`kernel: ready`、`webReady: true`；无自定义 profile 参数。完整执行摘要见 [e3 执行证明](EXECUTION-PROOF-e3.json)。

实际默认 profile 绑定另行通过：已安装非 packaged-host 进程、随包 Node 的唯一 Harness runtime CLI、实际配置的默认 dshHome 与 profile 路径别名一致，前后 peer 身份保持。此前未能完成的探针保留，成功 receipt 才用于本项签字；这些结果不继承到后续新候选。

实际 Models UI 自有夹具创建后，关闭 / 重开设置确认保存状态通过，耗时 2343ms，保留原 12000ms 预算，未超时；实际安装身份仍匹配。随后仅通过 UI 删除已确认归属的该夹具，精确行与删除确认均匹配，provider 与托管凭据条目已移除，未直接写原始配置。此项只认证该创建、重开确认及归属夹具清理，不认证 Models 全部操作或整表 P0。

为验证存量自动恢复，将历史已匹配旧通知快捷方式的原字节复制为本轮自有 fixture，未覆盖既有文件，保留原历史备份。实际新安装应用启动后，原位置的该条目已不存在，新增恰好一个备份目录、一个 `Electron.lnk`；1413 字节逐字节等于原 fixture，SHA256 `76680ad8fcb3dee884342e56e787c2464c723d7bba642bc2bc3d66a5fd20691d`，原历史备份摘要保持。此项只记文件匹配与可恢复备份契约 Pass，不认证 Shell 关联已解除或任务栏图标正确。

首个旧 capture helper 的任务栏选择阶段报 `capture-exact-appid-not-unique`，没有有效图片，保留该 Fail。重新只读枚举公开 AppID、按钮矩形和标题分类后，正式 `Appid: ai.deepseek.harness.gui` 按钮唯一；没有输出原始窗口标题，也没有沿用旧固定坐标。新 capture helper 只按精确 AppID 与新观测矩形绑定，前后重新验证实际 PID / peer generation 与 ready 状态。

| 实际阶段 | 绑定与结果 |
| --- | --- |
| 首次自动恢复后的任务栏 | PID 23668、HWND `0x70CD2`；新观测矩形 `1225,1368,66,72`；有效非全黑小图 SHA256 `54f573dd926d46b2fa5233658e4456912b08f1c82378c5a38065dc37181ae943`。主验收者视觉确认白色空白文档图标，记 **Fail**；见 [首启任务栏](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-e3-first-launch.png) |
| 首次 protected quit | 同一已安装 EXE / peer generation 下退出确认通过，主进程与直接 Harness 子进程自然消失，耗时 905ms；未强杀，记此次 protected quit Pass，不认证托盘退出 |
| 第二次正常快捷方式冷启动 | PID 18420、HWND `0x130C6C`；重新观测正式 AppID 唯一、矩形 `1177,1368,66,72`；有效非全黑小图 SHA256 `cb875fe3e7959c9a256b269ee85af82b5fc0a6baef6a34f7cec2e860992801c7`。主验收者视觉确认产品头像，记本次诊断图片 Pass；见 [第二次冷启动任务栏](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-e3-second-cold-launch.png)。首启 Fail 保持 |
| 第二次 protected quit | 同一第二次已安装 EXE / peer generation 下退出确认通过，主进程与直接 Harness 子进程自然消失，耗时 895ms；未强杀，记此次 protected quit Pass，不认证托盘退出 |

两次采集仅保存目标按钮的 66×72 像素，均无输入、激活或窗口动作；期间没有手工 Shell 通知、全局缓存清理、Explorer 重启或用户 pin 修改。第二次冷启动是诊断结果，不能抹掉第一次自动恢复后的正式 Fail，也不认证后续持续显示。原因仍在调查，不依据备份扩展名或第二次正确显示先行作根因结论。

默认 profile 绑定及上述 Models 自有夹具已分别取得实际结果；Files 工作环、关闭按钮实显、合成圆角、可见 DWM 动画、托盘退出、生产 P0 和 §16 签字仍未据本节完成。首启图标问题未闭环，不能将 e3 整体生产验收记 Pass 或晋级发布。

## 6c 原始候选与删除通知的单变量对照

原始候选 `36839675533` / `6c641868632cd11771e676cb99bb829ed5ae45d0` 的构建和测试成功。Setup SHA256 为 `e348846dc431792fe375d8d2f28f95554871f245ea2b33d7d4901e4f8cc2eccc`，安装退出码 0；六个已安装载荷与原始 CI 文件一致，现有配置、凭据与会话保留。Windows 解锁后，首次启动 PID 1748 的实际任务栏仍为白色文档图标，记 **Fail**。原生窗口图标与已安装 EXE 图标均为产品头像，不以这些静态结果替代任务栏验收。

随后仅用已确认归属、原字节保留的旧通知快捷方式夹具，在同一安装目录、正式 GUI AppID、默认 profile 与正常桌面快捷方式启动下进行 A/B/A。各次均正常退出后重新播种同一夹具，无全局缓存清理、Explorer 重启或用户固定项修改：

| 对照 | 实际任务栏结果 |
| --- | --- |
| 原始 ASAR `435383970cea2496d447850a5679932e7e64973309f37d64884e8358a0d08e25`，PID 36124 | 白色文档图标，**Fail**；[图像](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-6c-rename-control.png)，PNG SHA256 `53a88766d7e68f19844145fe4e7762ae8397083893ab203bc682942c54558013` |
| 仅改变旧条目通知为 `SHCNE_DELETE=2`、第二项为 `null` 的本地诊断 ASAR `363c0de7e09c71cf7920bf5e673b97fd389c4582d5ef0973c13b6dbe97d32bd3`，PID 27840 | 同一旧条目冲突下首次启动为产品头像，**诊断 Pass**；[图像](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/diag-taskbar-delete-first.png)，PNG SHA256 `4c2741fd6f0090ccea022d9381e7ad858e2f12df5cf332b6acebde57b2d2c905` |
| 恢复原始 ASAR并重新播种，PID 1284 | 再次为白色文档图标，**Fail**；[图像](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-6c-rename-restored.png)，PNG SHA256 与首行相同 |

诊断包仅改变该模块的两个通知参数及 ASAR 对应完整性字段，EXE、资源和其余模块不变。采集限定正式 AppID 的唯一 66×72 按钮，实际 EXE / CDP owner / 默认 profile 绑定已验证；人工查看图像作上述结论。该对照支持将移出开始菜单的旧入口通知为删除，而不是把其身份延续到不再是快捷方式的备份文件。现已正常退出诊断与对照实例，安装目录恢复原始 ASAR。诊断 Pass 不认证正式新安装包；新候选首启、生产验收和发布签字仍待完成。

## 会话内缓存复核（同日收尾）

A/B/A 之后在本机继续实验：重新播种同一旧条目夹具 → 未修改的 6c 安装版首启仍为白色文档且按钮名回退为 "Electron"；对已迁移完成的会话逐一手发 `SHCNE_ASSOCCHANGED`、`SHCNE_UPDATEITEM`（旧路径）、`SHCNE_DELETE`（备份路径）与 `SHCNE_UPDATEDIR`（Programs）均不能刷新 taskband 的 AppID→快捷方式会话内缓存；重启 Explorer 后同一存活进程即显示鲸鱼头像与 "Whale Isle" 名称，未重启应用。结论：DELETE 修复对干净会话与未污染机器成立；会话已污染的机器需一次 Explorer 重启或注销恢复，产品代码不做会话内强制刷新。种子条目由源码运行期通知注册产生，现已被通知边界阻止再生。

## 新候选 3af7fb6c：正式安装版实测与缓存时机收窄

本节对应精确提交 `3af7fb6c2000383de4edcc6e7d06d7b14e39bdbd`（`SHCNE_DELETE` 旧条目迁移及契约文档同步）。[Windows 候选 36864734935](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36864734935)（workflow_dispatch）与同 SHA [Desktop tests 36864709937](https://github.com/ChisaAlter/Deepseek-Harness-Desktop/actions/runs/36864709937) 均 `completed / success`；候选只构建 Windows，macOS job 按参数跳过。

原始 artifact `Whale-Isle-windows-x64` ID `11164417902`，593574854 字节，SHA256 `b777b1e4e6c1a95beee6609930b190f06826e4675568373e3c99e30a5c575dc9` 与 GitHub artifact digest 一致。本机经 4 路 HTTP Range 并行、逐段断点续传取得；ZIP、NSIS、内层 `app-64.7z` 完整性检查均通过，`Whale-Isle-Setup-0.3.3.exe` SHA256 `60ae76ba9eccba795c6bd106cce2891a83b0bf3969dc7096f2286bdcf57d43b4`。流水线证明 `%TEMP%/dshd-ci-36864734935-extract-wrqtdl/PIPELINE-PROOF.json`。

`/S` 静默安装落在默认每用户目录 `%LOCALAPPDATA%\Programs\Whale Isle`（静默模式不沿用此前自定义的 `C:\软件\Whale Isle`，该旧安装仍为 6c 字节未动，两安装并存）。新安装 `resources\app.asar` SHA256 `3e99d6f2a6806ea590d0f72260d3f0944bb032d7d0b55b58d6afbc9ff2e7496e` 与原始载荷逐字节一致；其中 `legacy-notification-shortcut.js` 归一化后等于提交字节、含 `SHCNE_DELETE` 且无 `SHCNE_RENAMEITEM`，`system-notifications.js` 的源码通知阻断在场。安装 EXE SHA256 `bcb4b99c5eda167ec8a0af00f62b23aa635b608c63a60672d78d5b1712274866`。

| 实际阶段 | 绑定与结果 |
| --- | --- |
| 会话 A（Explorer 启动时磁盘上已存在种子 `Electron.lnk`）首启 | 迁移实际发生：原条目消失，原字节备份 `legacy-system-shortcuts\3667d769…\Electron.lnk.backup`（1279B，22:15:57）落盘；但任务栏按钮为 "Electron - 1 个运行窗口"、白色文档图标，记 **Fail（污染会话边界）** |
| 干净会话 B（会话起始无该条目）内写入种子后启动 | 迁移再次发生（备份 `3562087c…`，22:26:35），任务栏仍显示 "Electron"——证明会话内缓存于 `.lnk` 写入事件或会话起始即建立，不等到窗口映射；delete-before-window 不能驱逐 |
| 干净会话 C（磁盘无该条目）正常启动 | 唯一 `Appid: ai.deepseek.harness.gui` 按钮名 "Whale Isle - 1 个运行窗口"，66×72 图像经人工查看为鲸鱼头像，记 **Pass**；见 [干净会话任务栏](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-3af7f-clean-session.png)，PNG SHA256 `16C66FDED9A3DBF291629CD44E278B305ED367230279DBE51B4548521C0AE67F` |
| 会话 D 前再次播种启动（证据复核） | 迁移第三次发生（备份 `15c97f78…`，22:30:06），任务栏仍 "Electron" + 白色文档；见 [污染会话任务栏](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-10-01-release-candidate/ci-taskbar-3af7f-poisoned-session.png)，PNG SHA256 `8E047136C54F57D9D177FD9A46F8818BE00C61380264AA29F943046F6CC57BAE` |

结论：候选在文件与通知层面行为正确（精确迁移、原字节备份、`SHCNE_DELETE`、源码侧不再产生 `Electron.lnk`）；但 Explorer 会话内 AppID→快捷方式缓存无法被产品代码驱逐，被污染过的会话首启图标必然保持错误直至 Explorer 重启/下次登录，此后永久正常。真实用户自旧版升级即此路径：迁移当次会话可能仍显示旧图标，重启资源管理器或下次登录即恢复。污染会话首启不计 Pass，亦不以干净会话结果宣称首启通过；发布签字仍待生产 P0 与其余验收项。
