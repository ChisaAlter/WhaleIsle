# 替换真机 UI / 硬件初检

2026-10-26，android-ui；仅 serial 1836e17d，model 23127PN0CC，Android 16 / API 36。设备规格由lead提供：1200×2670，density480，约400dp。应用 ai.deepseek.harness.mobile.nativeqa，Activity ai.deepseek.harness.mobile.MainActivity。未操作其它设备，未配对、未读私人照片、未变更开发者/安全设置、未写产品代码。

## 安装事实

lead 已实际通过 ADB 成功安装替换真机上的 nativeqa，报告版本为 versionCode 4 / versionName 0.3.10，包摘要前缀 04CA34…，与前期 fixed 相同；原包不存在。这些安装/版本/摘要事实来自 lead，本成员没有重复安装或独立核对完整摘要。本成员只验证 launch 返回应用 Activity intent 已送达，但设备锁屏，尚未看到应用首屏。

## 初始状态

已先读原值并保存 `newphone-ui-original.json`：font_scale=1.0，accelerometer_rotation=0，user_rotation=0，`cmd uimode night` 为 `Night mode: no`，secure ui_night_mode=1。runner `newphone-ui-run.py` 必须显式DSH_QA_SERIAL=1836e17d，否则拒绝运行；仍通过原device.py。

## 当前事实

- 启动应用返回top-most intent delivered；此时截图为全黑、UI tree只有时钟，不能当作landing通过。
- 对1836e17d发送KEYCODE_WAKEUP后，UI tree显示“请用数字密码或指纹解锁”和PIN区域。read_image实际查看截图，受锁屏安全显示保护，画面为黑色+指纹圈。
- 没有输入/尝试PIN，没有发起绕过锁屏操作；已通知lead物理解锁，不索取密码。
- 当前系统font/theme/rotation从未改动，因此仍为上方原值，无待恢复的系统设置；未授权camera。
- 尚未执行landing/font2/明暗/扫码授权/持续scanner/torch开关/返回/粘贴无效输入/IME和API36 edge-to-edge检查，不能记通过。

证据：`evidence/newphone-ui-01-landing-original.png/.xml`、`evidence/newphone-ui-02-awake.png/.xml`，两张PNG均已read_image实看。操作流水 `evidence/newphone-ui-actions.jsonl`。

首轮交接：随后lead通知用户已物理解锁，由lead接管ADB执行pair/functions。以下为之后另行授权的connected UI短窗口；不将首轮锁屏阻塞误记为之后仍锁屏。

## 第二轮：已连接真机短窗口

lead再次授权本成员独占1836e17d约5分钟，只做UI、不发消息、不改输入法。窗口开始已由lead配对owned53876，QA session71637c50；现有draft含WeType adbtext扭曲文本，本成员没有编辑或发送该draft。没有安装额外IME、读取私人照片或修改产品代码。

实际步骤与结果，以下PNG均已read_image实看：

| 步骤 | 实际观察 | evidence/ 下截图 |
|---|---|---|
| 已连接chat | font1竖屏浅色，空态、标题/电脑名、模型、48dp操作轨和Send可见；状态栏深色图标与背景对比可见，无明显重叠。输入是已有损坏draft | newphone-ui-10-connected.png |
| helper点菜单 | 取图仍chat，下一步Settings/深色标签不在树内，两次操作失败，未成功切主题 | newphone-ui-11-work.png |
| 根据当前XML菜单bounds [900,140][1044,284]，点970,210 | 打开白色会话与工作区Dialog，标题/关闭/工作区行和说明可见；新会话/搜索/Git灰显，明确显示“重新连接电脑”，证明当时offline。Settings项可见，未执行写动作 | newphone-ui-14-menu-coord.png |
| 再点Settings | 下一次取树已回chat，无Settings控制；深色点击也未执行。随后Back回连接landing，Ayase保存行/继续/扫描/粘贴/说明均完整，未见底卡遮挡 | newphone-ui-17-chat-dark.png（名称不符，实际浅色landing） |
| 改font1.3 | 命令执行，capture为会话加载瞬间，标题/加载文案/禁用输入轨可见。没有等待稳定，不计完整font1.3可用性通过 | newphone-ui-18-font13.png |
| restore与handoff | font_scale1.0/auto0/rotation0/night no/secure1读回正确；实际已回connected Ayase的Android QA Response Instruction，文本QA/图片QA及回复可见，输入框为空。历史是lead执行，本成员从未点Send | newphone-ui-99-restored.png |

本轮未完成：Settings明暗切换、font2、稳定font1.3、横屏/IME聚焦编辑、长draft首尾滚动；scanner/camera授权/无QR持续取景/torch/真实扫码、无效粘贴错误均未执行，不能计通过。没有15-settings/16-settings-dark成功截图，不按尝试名字冒认完成。

恢复：font1.0、accelerometer_rotation0、user_rotation0、Night mode no、secure ui_night_mode1；app主题没成功改过，保持跟随系统。按lead本轮交接要求USB常亮保持临时值stay_on_while_plugged_in=2供继续测试，lead告知其global原值15，最终由lead恢复。默认输入法未变更，配对和会话资料未删除。

菜单瞬间消失：本成员未看到/截到Software caused connection abort文字横幅，图14弹窗遮住timeline，但offline灰态与“重新连接电脑”可直接证实。lead随后独立复现transport断线并自动重连清空panel；本成员只读核对VM可见连接失败后generation++并panel=""（DshViewModel约187–197），不将现象直接归因于点击坐标或API36系统栏。具体30秒断连周期/transport原因由lead诊断，非本成员本轮已证实事实。

交接：已向lead立即交回ADB，lead可独占安装/运行文本helper；本成员此后无ADB、仅本地read_image/报告更新，无运行设备job，无产品写操作。第二轮交接状态以当时图99和上述restore读数为准。后续图99被第三轮restore同名文件覆盖，不能再作为第二轮chat历史留存证据；第二轮文字/动作流水仍可核对。后续AI/审批/CRUD由lead继续记录。

## 第三轮：主题、字级与扫码硬件初检

本轮为lead再次授权的真机UI窗口，设备仍仅1836e17d，使用当时已安装的fixed包（摘要前缀04CA34…，不含此后同电脑重连UI保留/强制竖屏/停止文案最后修复）。本成员没有安装后续candidate，因此本节不能充当最终候选包验收。只操作lead QA会话Physical QA A，不发送AI消息、不读取私人会话/相册、不改默认输入法。中文文本用现有phoneqa.fill的UiAutomation exactset，未用adb input text。

2026-10-26 16:13左右，lead转达用户明确要求“别测横屏，强制竖屏”。收到后立即停止横屏/rotation测试，恢复user_rotation0/accelerometer_rotation0，之后只执行竖屏。本节图34为该指示之前的历史观察，不纳入后续强制竖屏验收matrix，也不继续提出横屏覆盖要求。

| 实际步骤 | 结果与边界 | evidence/ 下截图 |
|---|---|---|
| 打开会话与工作区 | 起初标签tap后下一步控制不在树，失败已记录；第二次按当前可见菜单按钮坐标打开，Dialog完整可见。本轮菜单为在线态“重新同步目录与会话” | newphone-ui-31-menu.png |
| 设置→深色 | 真实点击深色，选中勾可见，Dialog和chat立即变深；顶部系统状态图标白色，仍有对比 | newphone-ui-32-dark-settings.png |
| font2竖屏深色 | 标题/电脑名均可读，顶部不叠；消息跟随大字缩放，composer与模型/权限/发送工具轨可见；模型长标签省略。不是空态，本页有lead停止测试历史 | newphone-ui-33-font2-dark.png |
| exactset中文草稿 | 设置“安卓真机输入区域与光标检查。横屏大字草稿只编辑不发送。”成功，helper验证精确字符串，未发送；不是模型输出或AI测试。本段文字保留在QA草稿 | 同后续图34–37 |
| 指示前font2横屏聚焦 | 图中WeType为悬浮键盘，遮住中部，文本仍可见一部分、Send/轨道可达。不能推断底部占位IME紧高布局通过；收到竖屏指示后不再执行 | newphone-ui-34-font2-landscape-ime.png，仅历史 |
| font2/font1.3竖屏 | 草稿完整中文换行，模型/附件/权限/Send仍在；这两张实际没有键盘，35名字含IME不符合画面，不能计竖屏IME通过 | newphone-ui-35-font2-portrait-ime.png、newphone-ui-36-font13-portrait.png |
| 恢复font1→浅色→跟随系统 | 浅色选中勾与白Dialog可见，随后点击跟随系统；系统本身浅色，最终保持原app scheme | newphone-ui-37-light-settings.png |
| 断开这台设备→扫描二维码 | 保存配对保留；进入相机系统授权，真实文案“仅在使用中允许／本次使用允许／拒绝”。未点拒绝、未读照片 | newphone-ui-38-camera-permission.png |
| 点击“仅在使用中允许” | 首次helper点击后仍在授权页，图39名字scanner但实际仍权限，不能算成功。第二次根据当时XML准确bounds [110,2029][1090,2182]点击；42立即capture仍为过渡权限，稍后同一个串行job取树已进入scanner | newphone-ui-39-scanner.png、newphone-ui-42-scanner-permission-result.png（实际权限过渡） |
| 无QR scanner→手电筒开→关 | camera权限已授予、取景真实出现，扫码页没有立即跳走。点“手电筒”后文案变“关闭手电”，再点后回“手电筒”；read_image43/44实看，开启时取景整体明亮、关闭后暗，支持camera预览/torch调用生效。没有人肉确认机背LED，不额外声称硬件光度验收。无屏前QR，未测试成功识码/配对 | newphone-ui-43-torch-on.xml、newphone-ui-44-torch-off.xml；本地PNG已看，含相机实景只留本地临时证据，不纳正式归档/提交图片 |
| Back与系统恢复 | 从scanner Back回保存Ayase的连接首页，未清配对；restore读回font1.0/auto0/rotation0/nightno/secure1，app已跟随系统，USB常亮保持lead临时2（原15待lead最后恢复）。交接时是landing，lead之后自行重连chat | newphone-ui-99-restored.png（同名覆盖，当前只作为第三轮landing证据） |

本节31–39、43/44截图均已read_image实际查看；42只确认取树仍是权限过渡，未用它宣称scanner。第一次点击未生效与权限授权异步过渡均如实保留，没有以尝试按钮名当通过项。所有设备job已收集完成，无剩余运行job；交接后没有本成员ADB操作。

仍未执行：正常底部占位IME竖屏编辑/返回、font2新建空态、invalid配对链接与错误恢复、真实QR识码、相机附件拍摄/取消/上传。没有调用gallery或发出私图。现有工具停止显示“本轮运行失败”来自lead的用户停止测试，lead已认领停止文案修复，本成员不将它记为本轮新崩溃。

## 后续产品变更记录（未冒充本节已装包实测）

lead另行授权后，本成员仅修改NativeRemoteScreen.kt：顶部选中对象/改名/确认、TaskPage搜索/新文件夹/搜索状态使用vm.uiOwnerEpoch+sessionId作为保存键，chat SaveableStateProvider也使用稳定UI owner；Git仍保留transport epoch。VM及JVM回归由android-state独占负责。

同文件补齐远端操作离线/同步中/忙碌禁用条件，包括目录导航/新建/注册、搜索/搜索结果开会话、rename/Fork/排序/归档/远端移除确认；文本离线可编辑、Back/关闭不受busy锁住。TaskPage显示当前断线原因并保留旧内容；同步失败显示错误与“重试同步”，new面板有明确重试，work现有同步动作不再主动清panel；设置/管理弹窗显示同步错误。没有自动重发写操作，没有改transport/输入法/系统栏。

最终产品文件LastWriteTime=2026-10-26 16:25:11+08:00，之后本成员没有产品写操作。源码交lead统一build/lint/install与真机复测；本成员未独立运行Gradle或声明这些新行为已在真机通过。此后最后候选包及新强制竖屏验收由lead主报告记录。
