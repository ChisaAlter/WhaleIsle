# API 26 隔离模拟器 UI 补充回归

记录人 android-ui；2026-10-26，第一版。仅 emulator-5580，Android 8 / API 26，1080×1920，density 480（竖屏约 360dp）。本成员未操作物理设备 9TUCYX8TBI6DLRMZ；模拟器结果不能替代 Android 15 真机验收。

应用 ai.deepseek.harness.mobile.nativeqa，Activity ai.deepseek.harness.mobile.MainActivity。开始时已保存 Ayase 公网配对并连接现有 desktop source 3181。本轮保留原配对/应用资料，未 wipe/移除电脑。只操作本轮新建无目录会话与 C:\AI\WhaleIsle-AndroidQA-20261026 的新会话；原有 First assignment... 只读会话仅被冷启动自动选中，没有编辑或发送。

## 安装阶段与证据

- 阶段 A：lead 已安装的 foreground/loading 修复包，尚不含本轮 tightIme 补修。图 01、04–41 属此阶段。
- 阶段 B：收到 lead 最新构建通知后，通过 helper 对 exact `.tmp/android-device-qa-20261026/fixed-nativeqa.apk` 执行 `install -r`，输出 Success，再 launch。图 42–54 属 tightIme + NativeImage.error 包。没有自行 Gradle/git。
- runner `.tmp/android-device-qa-20261026/emulator-ui-run.py` 启动时必须显式 `DSH_QA_SERIAL=emulator-5580`，所有 adb 通过现有 device.py 并固定该 serial；PYTHONIOENCODING=utf8。
- 操作流水：`evidence/emu-ui-actions.jsonl`。每张引用截图均已通过 read_image 实看；同名 XML 为 uiautomator 快照。截图不能证明未实际点击的业务动作成功。
- 图 02/03 初次横屏新建的同名文件被第二次 new helper 覆盖，当前留存的是阶段 B 竖屏新建弹窗/ready；本报告不将其作为阶段 A 证据。

## 实际走过的路径

| 路径/步骤 | 真实观察 | 证据（evidence/ 下，配套 .xml） |
|---|---|---|
| 初始连接和只读会话 | font1.3 横屏深色双行标题可读，状态栏/导航图标可见；只读提示可见。未修改该会话 | emu-ui-01-current.png |
| 新建无目录会话 | 新会话→无工作目录成功进入可编辑输入面；阶段 A/B 均实际走过 | emu-ui-02-new-modal.png、emu-ui-03-new-ready.png（现存阶段 B） |
| 阶段 A 长草稿 + font1.3 横屏 IME | 无崩溃，工具与发送仍可达，但编辑文字只剩顶部细线，不能作为可用编辑区。已反馈并获准修复 | emu-ui-04-landscape-ime-long.png、emu-ui-07-landscape-rotate-stable.png |
| 阶段 A 长草稿横→竖→横 | 旋转无崩溃/无旧前台错误；草稿内容保留。竖屏聚焦 IME 下可读三行并有工具轨；横屏仍是上述失败 | emu-ui-05-portrait-rotated-ime.png（实际截图无 IME）、emu-ui-06-portrait-ime.png、emu-ui-07-landscape-rotate-stable.png |
| 模型→思考强度 | 点击 Gemini 4 Argon 进入 Low/Medium/High，选择 Low 后输入轨回显“Gemini 4 Argon · Low”。没有发送 AI 请求 | emu-ui-09-model-dialog.png、emu-ui-10-model-selected.png、emu-ui-11-effort-applied.png |
| 权限/Plan 选项入口 | 弹窗显示仅可查看、可写入工作区、完全权限；本轮未成功实际切换权限，也未启用 Plan，不能算业务通过 | emu-ui-12-tools.png |
| 附件来源→取消 | “添加图片”显示相册/拍照，Back 返回长草稿，未丢内容。未进入系统选择器/拍照授权 | emu-ui-14-attachment-source.png、emu-ui-15-attachment-cancel.png |
| 会话与工作区入口 | 菜单可打开；无目录会话 Git 项禁用，settings/search 可见或可滚到 | emu-ui-16-work-menu.png、emu-ui-37-work-before-rename.png |
| font1.3 深→浅主题 | settings 实际点浅色，弹窗与聊天立即变浅，status/nav 图标深色可见；深色此前白图标可见 | emu-ui-17-settings-dark.png、emu-ui-18-settings-light.png、emu-ui-19-chat-light.png |
| font2 设置/聊天明暗 | font2 竖屏 settings 和聊天实际查看；点深色成功，系统栏仍有对比。主题选项可换行，未重叠；系统时钟字在 API26 font2 状态栏有下沿裁切（系统区）。font2 横屏无 IME 时空态标题被正文卡压住部分，属于次要空态可视限制 | emu-ui-21-font2-noime-light.png、emu-ui-24-font2-settings.png、emu-ui-25-font2-settings-dark.png、emu-ui-26-font2-chat-dark.png |
| 侧栏 | font1.3 竖屏可打开，已登记 workspace、session、固定底部 settings 可见，右侧仍留遮罩带。未做320dp/其它密度 | emu-ui-28-drawer.png |
| repo 外 QA workspace 新会话 | 新会话弹窗看到 C:\AI\WhaleIsle-AndroidQA-20261026，选择后进入会话；加载期间输入动作灰态，随后模型 ready；打开菜单看见该 QA cwd。未执行 Git | emu-ui-29-new-workspace.png、emu-ui-30-workspace-ready.png、emu-ui-31-workspace-work.png |
| 会话管理搜索 query 旋转 | 输入 ANDROID_UI_QUERY_20261026，标题过滤显示无匹配；横屏后 query 字符串完整保留。旋转已收键盘，随后 Back 直接回聊天；没有实际执行全文搜索 RPC | emu-ui-32-sessions.png、emu-ui-33-search-query.png、emu-ui-34-search-rotated.png、emu-ui-35-search-ime-hidden.png |
| QA 会话重命名草稿旋转 | 只打开 QA 新会话管理，追加 _ANDROID_UI_RENAME；横屏→竖屏后文本/所选目标仍在，重命名/Fork/排序/归档选项可见。未点提交，因此未改 host 标题 | emu-ui-39-rename-modal.png、emu-ui-40-rename-draft.png、emu-ui-41-rename-rotated.png |
| 阶段 B 覆盖安装重连 | install -r Success、launch，自动使用保存电脑连接 Ayase；冷启动自动选原只读会话，随后新建独立无目录 QA 会话 | emu-ui-42-latest-reconnected.png、emu-ui-02-new-modal.png、emu-ui-03-new-ready.png |
| 阶段 B font1.3 横屏 IME 补修复测 | 长草稿，紧凑头收起 Ayase 次行；至少一行完整文字可读，工具轨/模型/发送不缺。图52实际插入 END_QA 后文字与光标可见。未发出消息 | emu-ui-45-latest-font13-landscape-ime.png、emu-ui-52-latest-font13-end-edit.png |
| 阶段 B font2 横屏 IME 补修复测 | 完整一行文字和蓝色光标可见，工具轨/发送保留，无崩溃。只证明当前1080×1920/density480系统键盘，不推及更小高度/所有输入法；多行其余内容需内部滚动 | emu-ui-46-latest-font2-landscape-ime.png |
| 阶段 B 短模型层往返 | font2 点击模型，键盘收起并打开模型弹窗；Back 返回，长草稿还在。改回font1.3后IME恢复且紧凑头生效 | emu-ui-47-latest-font2-model.png、emu-ui-48-latest-layer-return.png、emu-ui-49-latest-font13-restored.png |
| 阶段 B 再旋转与交回 | 长草稿旋转无崩，Back收键盘；最终font1.3、竖屏、深色、无IME，资料和配对保留 | emu-ui-50-latest-portrait-restored.png（有IME）、emu-ui-53-keyboard-hidden.png、emu-ui-54-handoff-portrait.png |

## 本轮失败与修复状态

1. 已确认/已修复并复测：横屏 IME 剩余高度不足时双行头+输入卡纵向padding将正文压成细线。修复在 NativeChatScreen：高度紧时隐藏host次行，顶栏48dp，紧凑输入卡纵向padding归0，正文最小高度按24sp换算且受实际剩余空间限制，48dp操作轨不缩；图45/46/52证明新包当前模拟器下可读一行/光标可见。
2. 仍有限制：紧凑正文仅一行，下一行会被滚动视口边缘裁去；当前仅证明局部编辑可用，没有独立逐行首尾滚动覆盖。font2系统时钟裁切属于API26系统区，未改产品。空会话欢迎语在font2横屏较矮时间线中会被部分裁去，输入/工具仍可用。
3. 工具操作错误已如实保留流水：一次在effort子层未关闭时尝试点击“权限与 Plan 选项”失败；一次权限弹窗已因重组关闭后点“仅可查看”失败（没有后续权限值验证）；一次搜索旋转后Back已离开task页，点击“搜索内容”失败。它们不构成权限/全文搜索通过。
4. 截图文件名仅是操作意图，不等于实际键盘状态：05实际无IME；20 font2配置变更唤回IME；22为portrait有IME；35已经回chat；50有IME；54才是最终noIME。图52名称含end-edit，但实际是点中当前可见文字中插入，不是文档末尾校验。

## 未执行，不能作为通过项

- 本成员未发送AI请求；普通短回复、流式、工具执行、queue/cancel、真实审批、approve跨会话、平面subagent地址与桌面history核对由lead后续负责。3181旧host不支持最新subagent平面地址，未将其记为新版通过。
- 未测目录浏览/crumbs/新建目录/目录表单旋转、Git init/branch/commit/本地表单旋转、Publish/Push/Pull/PR/MR/默认分支确认/远端失败恢复。repo内 `.tmp/.../test-workspace` 会向上找到产品仓，按lead后续澄清从未对其做Git写；repo外QA目录也尚未做Git写。
- 未实际完成权限切换、Plan启停、斜杠命令、完整模型搜索无结果/清空、模型强度之外的多provider切换。
- 未测相册选择/图片上传和移除、camera/扫码/torch/授权拒绝、NativeImage.error历史坏图占位/混合好坏图、多附件、硬件摄像头。只验证来源弹窗打开取消。
- 未测流式长末条跟随/手动离底/加载older锚点、Markdown复杂语义色、断网/重连写入恢复、删除/取消配对、归档/Fork/排序真实执行。
- 本轮font覆盖1.3和2；未重新执行font1、320dp或不同density。未执行物理Android15真机；MIUI安装认证障碍由lead记录，模拟器不得冒充真机。

## 交接

最终状态见 emu-ui-54-handoff-portrait.png。android-ui 已向lead明确交回 emulator-5580/adb 独占控制，之后不再操作设备；无在运行设备job。未变更用户原有会话、未发消息、未写Git、未清理测试草稿/配对。NativeChatScreen 产品文件保持冻结，后续设备端到端由lead执行。
