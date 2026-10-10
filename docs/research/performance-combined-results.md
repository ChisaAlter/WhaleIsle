# 应用候选组合观察与最终目录包

候选基线 `26205a89fb7a6d416ef446d6281cb77afe610bcd`，目录 `C:/AI/WhaleIsle-application-performance`，分支 `codex/application-performance-full`。30分钟源码观察的实际标准入口为 Electron 44.1.1 的 `.`，带原有 `--dshd-from-launcher` 进入主应用路径，应用版本 0.3.3；独立 profile/workspace、Harness 54505、CDP 54506，主 PID 26384。该源码观察早于后续sandbox PiP preload修正，不回填成最新源码全部路径已重验；下述最终目录包另有独立装配/启动证据。没有使用用户凭据或操作日常实例。此前临时入口的错误准备样本未计入观察。此处不代表用户日常 0.3.4/已发布 0.3.5 已获得这些改动。

以下主界面的输入、状态与截图通过自有Harness CDP目标取得。记录中有 `document.visibilityState=visible`，但旧30分钟样本没有同时记录原生主窗口的可见性；完整renderer图像不能被扩大为原生整个窗口已在屏幕显示的验收。后续独立PiP/Files观察另行核实这一边界，不回填成旧样本的证明。

## 桌宠与文件

- 标准入口的完整 pet manager 窗口实际运行 `sessionOnGpu=true`、packed output 与 Anime4K SR 同时开启。正常节拍/显示 rAF 没有被探针替换。并行构建期间一个约243秒的自然运行片段记录约18.5次推理/秒，inference p50约39ms、p95约42.4ms；与安静配对实验工作负载不同，不混作加速百分比。
- 20次通过真实 shell IPC 禁用→启用桌宠，每次等GPU和SR实际就绪；全部成功。第二至二十次就绪并观察用时约2.0–2.3秒；首轮还包含额外提示观察等待，不宣传冷启动加速。
- 第一轮关闭后向独立 profile 的真实 outbox 写入67字节通知。隐藏4.5秒（覆盖两轮2秒节拍），持久化游标未推进；重开后真实画面显示该固定通知，游标为67。其余19次重开均未重播该通知，游标保持67。见 [原始记录](./performance-pet-lifecycle-measurements.json) 和 [通知画面](./performance-pet-notification.png)。这是提示/窗口生命周期的实际观察；原生鼠标穿透、跨屏、所有护理动作和真实模型聊天仍未验证。
- 用真实文件侧栏搜索64个目录中的 `performance-match`：观察到“正在搜索文件…”状态，最终64条全部返回，顺序00→63。完整主renderer图像中搜索栏/状态与输入框没有叠压，原生可见性限制同上。见 [搜索中的画面](./performance-files-search.png)。没有以该单次本地路径推算组件模拟基准的百分比。
- 在真实 Markdown 文件源码 textarea 输入约512KiB内容，观察到即时本地草稿记录。独立窗口预览入口创建了真实 file-preview 窗口；随后原有保存流程将规范化的524311字符写入磁盘，刷新后磁盘内容仍在。后续侧栏与标签恢复出现可见性缺口，因此不能把本次写盘证据扩大成全部草稿/布局恢复通过。调用和状态见 [记录](./performance-combined-actions.jsonl)。

## 30分钟驻留与退出

标准入口持续观察1800609ms（30分钟），每约1分钟共30个进程树/两renderer heap样本，未强制GC。期间包含文件编辑/刷新、20次宠物开关、设置入口与预览服务探针，同时本机有独立构建/QA。结束后通过本应用的正常关闭路径退出，`code=0, signal=null`；最后记录的8个自有进程均已结束。

| 观察 | 本候选数据 | 解释边界 |
| --- | --- | --- |
| 进程数 | 启动期10，其余样本8 | 没有按宠物开关次数累计进程；不代表线程/GPU驱动资源完全无增长 |
| 私有提交内存 | 1分钟约1579.8MiB；29分钟约1683.5MiB | 混合操作后增加约104MiB，不能宣称内存下降或已排除泄漏 |
| 工作集 | 暖机样本约1217.5–1380.1MiB；末样本1350.9MiB | 瞬时工作集受Windows与其他构建竞争影响，无旧版整机配对 |
| 主UI JS heap | 首样本28.1MiB，末样本24.7MiB | 不等于整体原生/ORT/GPU内存 |
| 宠物 JS heap | 首样本5.9MiB，末样本8.3MiB | 开关会创建新renderer；不是同一堆的连续泄漏审计 |

原始 [30分钟数据](./performance-combined-measurements.json) 和 [汇总](./performance-combined-summary.json)。该观察没有崩溃，但未测整应用输入p95、全程长任务、VRAM/能耗或与旧版的同场景差值。

## 实际目录包

最终完整目录builder完成，exit0，输出 `dist/win-unpacked/Whale Isle.exe` 仍为0.3.3。完整目录文件逻辑长度1,186,198,983B，ASAR62,481,814B；相较前轮目录仅增加100B，没有包体缩小结论。首次提取runtime约392.7MB，这些体积包含关系重叠，不相加。runtime装配623个依赖实例、3038条链接、真实CLI skip/full compose及Office staged runtime闭包检查通过。最终包153个main生产JS与当前源码逐字节一致，PiP preload SHA256 `3EBACD1D9063FA5C9AC511479A93A0975B2B37E2FB0E8F811A0F9F6AB3F3EEFC`；watch worker/smoke/preview源码也与冻结快照一致。

最终packaged smoke用新独立profile `C:/Users/48818/AppData/Local/Temp/dsh-packaged-smoke-3v4heU`，清除外部NODE_PATH/ELECTRON_PATH等环境后，实际完成首次runtime提取、3038链接恢复、Web UI ready、scoped API和PTY `echoed:ok`，`pageErrors=[]`。右栏probe仍宽0，原判定 `ok:false`；脚本140.490秒后exit1，应用本身code1/signalnull正常失败退出，没有此前原生异常码。不把该轮标为整体验收通过；packagedP0为null，这次没有测PiP帧、Office编辑或升级恢复。完整数据和保留日志见 [装配报告](./performance-query-results.md)。此前旧ASAR成员查询的Windows路径误报已更正，不能据它断言旧包缺失全部生产依赖。

没有制作或安装NSIS、替换用户日常版本或发布；Office实际编辑、升级/恢复与整个目录包视觉验收仍未完成。

## 未通过与缺证据

已有完整 source QA 的23个必需步骤失败，截图缺失；其退出阶段出现属于自有PID3892的 `0xc0000409`。新增watch worker清理随后补到QA专用退出路径，定向基础smoke正常返回原失败码1，但右栏probe仍失败。标准入口30分钟正常退出补充了另一条退出证据，不能覆盖原QA的失败。详情见 [宿主报告](./performance-host-results.md#组合源码-qa-观察2026-10-09单次)。

实际主UI刷新后，右侧栏及已留存标签没有恢复为先前可见状态；设置截图还出现前后层内容同时可见、文字过浅的问题。缺少旧基线同路径对照，不能归因于本轮性能改动，但不评为视觉通过。账户菜单和设置入口可打开的观察也不能覆盖整组未通过检查。

真实 localhost HTTP 预览服务可创建；此前直接IPC探针的PiP data URL `ERR_FAILED (-2)` 未在真实 Browser→More→PiP公共入口复现。公共入口取得了基线已存在的sandbox preload本地require失败；最小修正后bridge已恢复，6项相关检查通过，权限/导航/JPEG80/节拍保持，但实际PiP仍没有网页帧。后续准确guest对象取样发现：More前它已附着可见主窗、bounds非零时，capture就抛 `Current display surface not available for capture`；More/PiP后及一次Electron showInactive后也同样失败。没有返回NativeImage，不能把它写成零尺寸捕获或支持owner修复。原生窗口可见与Chromium document持续hidden并存，环境/显示生命周期来源尚未区分，完整PiP/录制未通过。见 [完整公共入口及捕获记录](./performance-render-results.md#t13-第二层区分实验附着时也无可捕获-display-surface)。

长历史诊断夹具已对齐真实工作区/控件/Windows工具契约；同一500轮seed分别加载24/500轮、续写8轮（2个工具轮）的完整场景均PASS、exit0，未裁剪内容。取得约4047/44978初始DOM及CDP成本；规模增长主要关联样式与DevTools成本，但自动化Send→文本等待窗包含定位/actionability，不是实际click→paint。补充单次修正trace在原文本定位处超时，未形成函数因果证据，因此本轮保留原分页/列表，不能报告此处已优化。见 [计时定义与完整结果](./performance-history-results.md)。真实SSH/其他GPU/跨屏/高输出终端、全部护理/模型聊天仍未覆盖。

两条独立代码评审对最终新增QA退出契约、sandbox preload与诊断夹具复查无新finding；逐项体验报告的独立只读核对也未发现实质性夸大，并已补充混合负载/受控测量口径。代码评审不替代以上UI/性能缺口。包含最后preload修正的完整目录包装配已完成并实际启动；右栏失败仍保留。当前仍不能宣称全部体验无影响、组合验收通过或可发布。
