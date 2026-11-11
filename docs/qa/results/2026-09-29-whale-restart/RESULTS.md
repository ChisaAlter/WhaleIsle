# 鲸鱼娘开关重启验证

- 环境：Windows，本仓库源码 Electron；临时独立 userData、端口 3188；无真实账号或模型请求。
- 通过真实 Harness renderer 的 `window.shell.saveConfig({whaleAssistantEnabled:true})` 触发 IPC、配置保存、任务保护、控制器重启和插件装配。
- 诊断 wrapper 在独立实例自动接受任务保护确认；生产确认链路未改动。用 50ms heartbeat 记录超过 500ms 的主线程延迟。
- 修复前：[trace-before.json](trace-before.json)。切换到恢复完成约 17.5s；停止期间主线程延迟 2096ms。
- 修复后：[trace-after.json](trace-after.json)。真实 false → true 切换约 24.9s；控制器重启后约 16ms 恢复页就绪，然后异步停止；切换期间无超过 500ms 的延迟记录。
- 此结果证明已消除观测到的同步停止阻塞，不证明总启动时间缩短；排空和服务加载仍占时间。
- [focused-tests.log](focused-tests.log)：324/324 通过，覆盖默认开/显式关、进程名称保护、异步停止等待、重启期间恢复页及原有插件装配链路。
- 全量测试和文档门禁结果见后续追加。

## 全量与门禁

- `npm test`：2812 项，2807 通过、3 失败、2 跳过。三个失败是 launcher-notes 生命周期、性格镜像计时和并行编辑中的 launcher-bound 几何用例；对应定向复跑全部通过（2/2 + 3/3），未改测试阈值。
- `npm run check:governance`：6/6 通过。
- `npm run doc-sync`：未全绿。已修复本次英文链接问题；工作区其他并行改动仍有翻译配对问题，设计语言文档整体超字数预算。本次配对 sidecar 已重录。
- 完整输出：[full-tests.log](full-tests.log)、[retry-tests.log](retry-tests.log)、[launcher-retry.log](launcher-retry.log)。

## 默认开启实机复核

共享 Harness 构建完成后，使用不含 `whaleAssistantEnabled` 的独立配置重新启动源码桌面成功。实际设置页开关为开，侧栏有鲸鱼娘入口，助理字段完整加载：[default-result.json](default-result.json)、[default.png](https://github.com/ChisaAlter/WhaleIsle/blob/6503942ca0c9b26144300a2b8001d0b07a324d84/docs/qa/results/2026-09-29-whale-restart/default.png)。此验证运行源码，未重打安装包或覆盖当前安装版。
