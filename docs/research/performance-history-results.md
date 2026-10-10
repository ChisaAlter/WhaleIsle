# T10/T11 同候选的24轮与500轮观察

2026-10-09，本隔离候选的已构建assembled web/headless Chromium，使用同一份完整500轮seed/replay，分别让UI加载24轮与500轮，随后续写8轮，其中2个工具轮。两个场景各单次PASS、exit0，warnings/pageErrors与cleanup均通过；500场20次Load earlier，最终508轮。不是旧版与优化版的收益对照，也不替代Electron完整画面、滚动/查找/选择体验。

已有诊断夹具需要对齐当前真实契约：v4首system head先于user；工作区create并全量attach所有seed IDs；当前Workspace row不再显示旧数量文案，改为真实membership等于原expectedSessions且UI row可见；精确标题使用当前会话名称搜索；Windows continued工具采用standard preset已启用的pwsh。原500历史内容、工具负载、8续写、两个工具轮、marker/错误/消息数量断言均保留。失败时partial与主体/cleanup错误仍输出/抛出，没有通过skip/减少场景规模制造通过。

## 当前已测成本与解释

8轮均值，单位ms；两个历史规模使用相同混合负载：前7轮各输入698字、响应24 chunks，第8轮输入8232字、响应120 chunks。不是8次相同短输入。Script/Layout/Style/DevTools为原CDP before/after差。

| 指标 | UI加载24轮 | UI加载500轮 |
| --- | ---: | ---: |
| 填充自动化操作wall | 36.233 | 426.139 |
| 填充Script | 5.044 | 6.285 |
| 填充Layout | 2.279 | 2.962 |
| 填充Style | 11.482 | 332.622 |
| 填充DevTools | 7.178 | 78.045 |
| 自动化Send→文本等待窗 | 297.775 | 2200.203 |
| 续写Script | 215.446 | 371.033 |
| 续写Layout | 30.491 | 79.948 |
| 续写Style | 117.834 | 1606.682 |
| 续写DevTools | 105.405 | 1538.511 |

初始DOM nodes为4047对44978，8续写分别增加599/598；mutation batches约12–24/12–23，每轮新增量相近。规模关联更集中于样式与自动化命令成本，不能仅从节点总数推导需裁剪原文或虚拟化。

上述自动化wall包含Playwright的role/text查询、actionability、fill后的textContent与poll；Send文本查询没有限定transcript。原500场1.25–3.60秒因此不能称真实browser click→DOM/paint。它不等turn/end，显式前后CDP请求也在这一个wall窗口外。Task累计差包含采样边界，曾有一次fill Task399ms而wall182ms，不能当作连续用户卡死399ms。

500场没有历史CPU采样，期间有独立PiP诊断app并行；24场CPU前后快照20%/22%，不是运行中均值。不能宣称CPU隔离因果。现有数据没有main函数栈/连续longtask，也没有证明heap泄漏。

原始数据：[24轮](./performance-history-24-measurements.json)、[500轮](./performance-history-500-measurements.json)。原日志为 TEMP 的 `whaleisle-complex-history-20261009-v6-expanded-windows-shell.log` 与后续24轮对照日志。

## 因果诊断的最终边界

只读源码定位到一个候选：`ConversationContent.tsx` 的 ResizeObserver 在会话祖先写入尺寸 CSS 变量；真实调用耗时与相同值写入是否被 Chromium 消除没有证据。现有列表已经使用 memo、keyed source 与增量组装，不能仅凭DOM规模决定裁剪或虚拟化。

随后在TEMP复用同一500轮seed与公开操作，尝试一次fill/send trace。第一轮诊断准备异常被replay清理覆盖，没有trace。获授权的修正实验将浏览器计时明确写为 `globalThis.performance`，保留主体与cleanup的各自错误；执行84.85秒后exit1，原 `getByText('LONG_CONTINUATION_USER_1').last().waitFor` 超过15秒。没有失败当时的DOM/事件证据，因此不能把该定位超时当作产品未回显，也不能归因于上述CSS变量。预定result/CPU/trace均未产生，详见 [宿主诊断记录](./performance-host-results.md#t11-长历史输入链路的只读诊断未采用产品修复)。

最终保留完整24/500功能场景通过与额外追踪失败两个事实，本轮不采用缺少因果证据的长历史产品变更。没有减少消息、弱化断言、延长超时、增加skip或反复运行该追踪。真正的browser事件→回显/绘制、连续longtask、滚动/选择/查找与原生完整画面仍待验。
