# Lead 补充端到端验证（执行记录）

只使用 API26 emulator-5580；原 Android15 真机仍被 MIUI USB 安装限制阻塞，未把这些结果记成真机通过。当前客户端为 fixed-nativeqa SHA256 04CA34D91EA700472453C705645217159C0CD01F8FF5819151A01046B5691C86。桌面为当前工作区源码创建的隔离 Electron（userData=.tmp/android-device-qa-20261026/desktop/user-data，Harness53876，daemon53878），与实际用户会话的3080、3181分开。所有业务写入仅本轮新建会话和仓库外 C:/AI/WhaleIsle-AndroidQA-20261026。

已执行：

- current-source Electron成功启动；短桌面模型请求收到ANDROID_QA_READY_20261026。
- 实际Gateway /api/remote.mux：当前hooks订阅后，改名测试会话收到session/projection（real-mux-results.json）。
- 当前host tunnel读现有只读子会话历史，携带直接parent/child/mode，读取252events成功（real-child-history-results.json）。只读数据，不向该会话发送或修改。
- 模拟器从旧source3181实际切到隔离current53876 offer，配对成功、当前历史和GPT6.1 Low/权限可见（emu-e2e-09）。
- Android从新会话选择repo外QA workspace；实际键盘输入短请求后点Send。工具误用Ctrl+A产生前缀aa，实际发送文本为`aaReply only ANDROID_QA_20261026. Do not use tools.`，不是产品输入串改；host记录与Android一致。运行中Stop/queue按钮可见；收到ANDROID_QA_20261026，草稿清空（12/13）。未实际点Stop/queue，不能记它们业务通过。
- 通过Android系统GetContent相册选择生成的Android-QA.png，原生预览可见（18/19），发送含图提示并收到IMAGE_QA_RECEIVED，用户气泡持久图可见（20/22）。Host历史实际存attachmentId sha256:ce41275f9fd78520adfe028985a22ce864c0679b892c2ef6e5eb7e274ad27e16，current helper按session.attachment读回显示。android-e2e-results.json核对两次回复和image id。
- Android打开repo外非Git目录的Git页，Initialize入口可达（14），实际点初始化返回“Git操作完成”（15），shell只读git rev-parse确认新.git只在C:/AI/WhaleIsle-AndroidQA-20261026，status显示No commits yet on main。已验证首次非仓库入口修复。
- Android输入android-qa-branch并点“创建并切换分支”，git只读核实unborn branch已为该名；创建QA测试文件后Android Commit，首次因隔离仓无作者报Author identity unknown（31），保留commit草稿/选择且没有永久busy；只给该临时仓git config --local设置测试作者，Android再Commit成功（33）。未Push/Publish任何测试仓。

- 权限按钮实际由workspace-write切换到read-only，等待host响应后35截图回显“仅可查看”。通过composer发送`/plan`后38截图出现Plan，host projection active=true；再点Plan chip，40截图消失且host active=false/pending=false。不是把命令当聊天文本发到模型。

未取得通过的尝试：

- 真实审批：让隔离桌面请求写仓库外测试文件，sandbox直接拒绝且没有Gateway approval事件，55秒观察未收到可裁决审批。没有放松安全策略重试，不能记真实approve/reject通过（approval-body.txt）；单测覆盖审批身份/重放/获胜解决。
- 预启动完整桌面构建client bundle原生进程3221226505退出，Web阶段未执行。当前源码宿主与已有Web产物可启动，未称完整桌面重建通过。
- daemon重启第一次30秒未ready，确定动态导入可完成后再启动恢复ready且relayConnected。此为单次启动环境观察，不新增重试代码，未将它记录为一次启动必成。
- UI自动化tap最初选到同名标题而非clickable按钮、填框content-desc定位不匹配、命令空参数/控制键传递与桌面sidebar selector超时等均属于工具操作失败，后续修helper并逐步确认，不把失败命令输出标通过。
