# Android 竖屏续测与 Shift+Enter 修复

2026-10-27，接续 [上轮 desktop parity](../2026-10-26-android-device/desktop-parity-followup.md) 与 GitHub [#285](https://github.com/ChisaAlter/WhaleIsle/issues/285)。基线 main `031fdff4d34fdd7872f28aa9308347d9ee2dbd47`，独立分支 `fix/android-followup-20261027`，独立 worktree，不写主仓 mobile。议题继续 OPEN；本轮没有完成所有功能或桌面差异验收。

## 已推进的真实手机操作

原授权设备 `1836e17d / 23127PN0CC / Android16` 重新在线；1200×2670、density480、font_scale1.0、accelerometer_rotation0、user_rotation0。全程竖屏，没有更改旋转或系统字号，没有卸载或清数据。

先实际验签并 `adb install -r` 覆盖 r6 nativeqa（SHA256 `D949B9ABA40C11C5819EAB8B343CB259EBF2BE170B723871F226F83FD2E59F19`）；Success，冷启 COLD1041ms / Status ok。原保存电脑与本机阅读偏好保留。标准应用没有修改。

- **首连失败、重试、取消**：注入语法有效的专用不可达 QA offer，手机实际显示 `Failed to connect to /127.0.0.1:9`、重试连接，没有聊天输入；点击重试再次留连接页。另以只经原授权手机 ADB reverse 的本机 inert TCP 端口保持连接中，真实显示“正在连接电脑…/取消连接”，点击“取消连接”回入口，保留原配对，超过30秒仍不自动进入 Chat。首次自动化误用“取消”标签、以及期望未渲染的“已取消连接”，均属工具断言错误，后续按实际“取消连接/重试连接”检查。
- **运行状态**：真实专用会话 `tool/call pwsh` 等待期间，侧栏当前会话出现转圈。两个自动截图像素相同，能够证明运行指示存在，不能单凭这两张静态图证明动画时间推进。
- **队列编辑、移除、steer**：手机明确进入本轮独立 `Android QA 20261027`，session `session-e1e51b8a-3a19-4a89-b339-3eb0dcd9bd90`。通过该专用会话实际一次待审批写操作保持 turn（最后点拒绝，没有创建 probe 文件）；手机把第一条文字改为 `QA_EDIT_AFTER_20261027`，服务器确认同 ID 内容；移除第二条，服务器确认该 ID 消失；点“发送到当前回复”，同第一条 ID 从 next-turn 移入 next-step。不是仅确认按钮可点。队列需要向上滚动才露出当前视区下方的操作按钮，滚动后全部可达。
- **Enter 实际消费**：打开本机 Enter 发送，给实际消息输入框焦点后按系统 Enter，服务器同 ID history 收到精确 `Reply only QA_ENTER_TRUE_20261027. No tools.`。第一次脚本误点输入框上方，未发送，修正焦点后通过。
- **字号与显示偏好**：当前工作树包真实选择“特大”与“较小”，返回同一 QA 历史的文字实际变大/变小；真实切换显示思考过程和默认展开工具详情，返回历史可见推理/工具详情变化。此轮未完成每档字号、表格/代码/公式全部消费者的逐项尺寸对账。

证据只收录专用 QA 内容；私有 host history、配对 URL/凭据、扫码相机预览、私人应用与图库截图不提交。

## 实际修复

Enter 发送开启时，旧代码只拦截不带 Shift 的 Enter，把 Shift+Enter 留给输入控件。真机系统 keycombination 实测会触发发送，未按偏好说明保留换行。现将 Enter 组合统一在 preview 消费：普通 Enter 仍发送；Shift+Enter 使用真实 `TextFieldValue.selection` 插入一个换行并更新草稿，同时消费 key-up，防止编辑器继续映射 `ImeAction.Send`。

修复包保留数据安装后实际复测：系统 Shift+Enter 在当前光标位置插入恰一换行，原文字完整，服务器没有该文本的 user/message。首次断言只接受末尾换行，实际点击把光标置于中间，得到 `QA_SHIFT_FIRST_202\n61027`，这是正确选区行为；断言已改为原文字完整、恰一 newline、没有远端消息。

临时新增的空 Activity 输入/阅读 instrumentation 虽已编译，但手机 `startActivitySync` 未完成、一直停留 launcher；主动 force-stop 自有 QA 包终止，结果是 `Process crashed`，不计通过。未将这套无效夹具提交。当前生产改动仅上述 Shift+Enter 消费。

## 构建、包与主机边界

本轮在独立 worktree 实际运行 `:protocol:test :app:testDebugUnitTest :app:assembleDebug :app:lintDebug` 成功，App64（Remote39、VM3、AnchoredMenu5、ChatState8、Markdown5、SessionData4）及 protocol15全部0失败/错误/跳过；lint0error/11warning/2information。生产输入修复后再次实际运行 App tests/assemble/instrument compile/lint 成功；protocol本次追加未重跑。旧r6报告的59不能替代本轮64，也不把JVM当真机。

手机后续保留数据安装当前main nativeqa `1289C8D2F999FBE5B1B7CED140B820686D93D2EC9E08FDB40341DEB8F920AFE9`，然后安装含Shift修复的工作树 QA 包；最终包身份与收尾结果见追加记录。证书仍为 debug `14d5f33de2d182088f220f393693eda8468d9d4b1398f748c37bcfe01ca58222`，不代表正式签名升级。

专用 host 在53876/CDP53877/remote53878，独立复制的 QA profile，未修改用户3080/6767或安装版 PID6308。主仓官方构建输出只读复用。初始 Electron44.4.3 默认 daemon runner在30秒内未ready；为推进手机功能，临时 QA wrapper仅DI daemon `execPath=C:/Program Files/nodejs/node.exe`（Node24.21.0）后真实公网 Ayase relay connected/listening。此对照不修改产品 spawn，也不能认证正式Electron daemon启动。

两个保存电脑均名Ayase，首次按顺序选择误连到用户电脑，只导航和搜索标题，没有发送prompt或远程写入；发现目录身份后立即离开，不提交私人截图。此后从自有53876生成offer按专用server身份连接，创建唯一QA标题/工作区，并在每个写操作前核对。

## 真实扫码、相机与剩余

原生 scanner已真实打开；用户一次光学扫描旧码返回“配对码已过期”，能证明读取到码，但不能记新配对成功。随后独立桌面卡改为每60秒通过自有 host rotateRemoteToken自动生成新码，固定窗口显示生成时刻与有效秒数，未把URL/token输出聊天。重开scanner后尚无新码成功结果，不能将VIEW intent配对替代光学扫码。真实拍照发送也未执行；需用户后摄对准无私人背景的专用蓝圆/ANDROID QA测试卡后，继续系统相机拍摄、预览和发送/attachmentId对账。

外部Git鉴权/PR/MR、ACK幂等、完整历史分页/竞争/资源上限、正式签名升级/旧Web迁移仍未完成。Files/Diff/MCP/技能/插件、lightbox、子会话树、桌面Git快速动作、完整账户设置等既有差异没有在本轮删减或宣称完成。需要专用外部测试仓库/分支与写权限，正式签名需同证书和递增versionCode；这些前提交lead处理。

## 最终收尾

移除临时 instrumentation/QA Activity 后，独立 worktree 再次 `:app:assembleDebug` 成功。最终 nativeqa SHA256 `B84B9B7108C237412CA32B59CCAD81BADF252C760DB6D0DBEA8B40E7A1346E54`，保留数据覆盖 Success，冷启 COLD907ms / Status ok。含临时空 Activity 的前一手机实测包为 `DF0FC6E3226E431A48E8C04A6C8A94C1046C70740921B4E10D7ADE99B97373FF`；两包生产输入代码相同。最终收尾不把空 Activity 的运行失败改写为通过。

已通过手机设置恢复本轮初始本机偏好，并实际读回：messageScale1.0、showReasoningfalse、expandToolDetailstrue、sendWithEnterfalse，运行发送模式未修改（默认queue）。系统font_scale1.0、accelerometer_rotation0、user_rotation0保持原值，输入法没有修改；原配对、文字草稿与标准应用未清除。自有自动刷新测试卡已正常关闭；相机预览未存档，新码光学配对和拍照发送没有新结果，仍未覆盖。
