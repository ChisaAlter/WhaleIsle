# 竖屏富文本与键盘操作复测

2026-10-26，接续[前一竖屏候选](portrait-final-results.md)。用户要求继续审查并修复可定位差距。本节保留9881包的失败证据；后续候选的实际构建、安装与手机结果按各自身份补录，未完成项不计通过。

## 已完成的本机 Git 传输补测

Android16同机、nativeqa包9881…、普通Fork `session-e7f2d5af-efc9-4b3c-b2ef-f9dc78fec2aa`、专用仓 `C:/AI/WhaleIsle-AndroidQA-20261026`。夹具裸仓位于仓外 `C:/AI/WhaleIsle-AndroidQA-20261026-remote.git`，第二克隆只准备变更；产品操作从手机原生Git页触发。

| 手机动作 | 主机对账 | 结论 |
| --- | --- | --- |
| Publish，明确填本机裸仓路径 | origin新增，分支physical-portrait-qa-1754在裸仓出现，SHA53b977ef与本地相等 | 本机Git传输通过，没有创建外部私有仓库。 |
| Pull | 第二克隆先推164e4aa，手机使测试仓53b977ef→164e4aa快进；phone-pull-probe.txt到账 | 真实Pull通过，不是只观察按钮。 |
| Commit & Push | 测试文件phone-push-probe.txt；手机显示默认分支确认并继续，提交说明匹配；本地与裸仓SHA均3f11585dafb66f70a993aba6887bfcee5c8e2d22；statusclean，上游差0/0 | 两步组合实际完成。 |

[脱敏结果](evidence/physical-git-remote-result.json)保留精确ID与SHA。[发布前](evidence/newphone-129-git-local-publish-form.png)、[Pull控件](evidence/newphone-133-git-pull-ready.png)、[默认分支确认](evidence/newphone-137-local-commit-push-sent.png)属于对应动作阶段；主机结果完成对账。该补测未使用外部GitHub/GitLab鉴权，没有创建PR/MR，不推及分叉合并、失败重试和全部状态反向同步。

## 修复实现与回归过程

配对页在键盘显示时让出品牌区，长内容仍可滚动，将“连接”操作固定在滚动区外，避免操作按钮被内容高度裁切。无键盘时保持原连接入口布局。主Activity仍固定竖屏。

Markdown复用Markwon4.6.2官方tables、latex与inline-parser扩展，按解析树分别显示正文、表格与代码；表格和代码有各自水平滚动区域，正文保持窄屏换行；单美元公式与官方双美元公式共用原生数学渲染。没有引入聊天WebView或外部渲染服务。

第一次新增解析回归中，原40项通过，新4项有1项失败：价格$20.00被误配成公式，跨入后续inlinecode。此失败促成解析定界修正，保留原断言；不能将该第一次执行写为44项通过。修正后18:59:04–07（UTC+8，XML10:59:04–07 UTC）第二轮44项全部通过：Remote29、基础VM3、NativeChatState8、NativeMarkdown4，零失败/错误/跳过；[本轮JVM汇总](evidence/richtext-jvm-results.json)。两次执行如实分开；真机渲染不以纯解析测试替代。

## 首个6259候选真机结果与后续修正

6259候选保留数据覆盖安装成功、冷启1130ms，方向仍为SCREEN_ORIENTATION_PORTRAIT；[构建摘要](evidence/richtext-build-summary.json)。本次两身份构建成功，lint实际0error/17warning，新4条为Markdown表格物理LEFT/RIGHT对齐的RtlHardcoded重复提示，没有沿用旧13计数。

真机深色中，行内E=mc²和独立分式均已排版，价格$12.50/$20.00与inlinecode $HOME保持原文，长代码呈单行。**表格仅出现边框，单元格文字为空，首个候选未通过表格验收**；[正文裁切图](evidence/newphone-143-richtext-first-dark-output.png)保留失败。随后定位官方TablePlugin与Table.parse单元格渲染冲突：TablePlugin的cell visitor消费文本，原生单元格拿到空Spanned。后续改用官方TableEntryPlugin同样的parser-only配置，并补单元格原文/对齐回归。代码区域第一次横滑截图变化不明显；后续连续横滑的图156已明确显示_END，证明原生横滚可达末尾。lead先前依据较早截图误判为宽度问题，随后读回图156已纠正并撤回额外代码改动；不把自动化手势首次无效当成已确定产品故障。

配对页在真实WeType键盘、保存电脑、无效链接错误和已展开输入同时存在时，字号1与2均无需先滚动即可完整显示并点击“连接”，实际错误反馈可见。[字号1](evidence/newphone-147-pairing-font1-ime-initial.png)、[字号2](evidence/newphone-151-pairing-font2-ime-error.png)确认旧按钮裁切问题已在这些场景修复。字号变化会重建Activity并尝试恢复保存连接，已重新进入配对页验证，没有把恢复过程截图误写为配对页通过。字号最终恢复1.0。

## 当前r2候选验证

r2 QA包SHA-256为`4A756ED75A019729F5AB8BF8971CE58CBCDF48C1DF1A9E528EEEB426F19CF6C3`，标准包为`82A1C4A43D5D09B63135418E3F4408C801ECBA87AF79B00A48D8BFB97DDAAA7B`。两包aapt确认分别是nativeqa/standard身份，原debug证书不变；本机安装的是隔离QA包，保留数据Success，COLD **1253ms**，保存连接与Fork历史仍在。[r2构建、回归与安装摘要](evidence/richtext-r2-build-summary.json)。

| 定向复测 | 当前r2实际结果 |
| --- | --- |
| 表格内容和对齐 | 深浅主题三列三行九个单元格文字可见，Value数字右对齐，长Detail单元格换行。见[深色](evidence/newphone-158-r2-table-dark-output.png)、[浅色](evidence/newphone-159-r2-table-light-output.png)。 |
| 表格横滚 | 手机实际横滑，右侧Detail边界完整可达，正文和输入栏没有跟着横移。[横滑结果](evidence/newphone-160-r2-table-horizontal-light-output.png)。 |
| 公式与价格 | 行内E=mc²和独立分式排版可读；$12.50/$20.00不误成公式，inlinecode $HOME原文保持。两主题均实际可见。 |
| 长代码 | 原生独立横滚保持单行；连续手势能读到_END，[r2末尾图](evidence/newphone-164-r2-code-final-end-output.png)。此前6259也实际可横滚到末尾，未引入多余触摸拦截。 |
| 键盘连接按钮 | r2保留6259中已在font1/2真机验证的同一DshScreens修复；r2后未重复全部字号配对步骤，不能把旧候选所有测试认证为新包重跑。 |
| 安装后真实发送 | r2手机实际发送短请求，host同Fork最后turn为completed，精确回复R2_NATIVE_OK。[对账](evidence/r2-smoke-result.json)、[恢复系统主题后的实际回复](evidence/newphone-165-r2-smoke-system-output.png)。 |

r2原任务`:app:testDebugUnitTest`与两身份assemble/lint均BUILD SUCCESSFUL，App **45项**（29+3+8+5）、0失败/错误/跳过；lint **0error/17warning**。原r2逐suite XML没有另存快照，后来取消的Compose代码实验覆盖XML，当前19:13:56/58记录不归r2；这里只以原任务成功输出、当时读到19:10:56结果和测试清单计数记账。临时Compose代码改动已按literal逆操作还原并读回，最终原生渲染器源码SHA为DE93B26D96DA9B65A98BB0A8B7E750A3D42D34825E049BE1AB2FBBCD9B884A28；没有伪造构建前预存hash比较。协议15项与Node33项未重新执行。

剩余范围：相机真实QR/拍照发送、外部Git鉴权与PR/MR、完整分页/并发/资源极限、正式签名升级和旧Web迁移仍未验收；长非法TeX在窄表格回退缩放只是静态候选，未写成已确认故障。长草稿收起、图片lightbox、队列管理、子会话树和桌面Git快速动作等已有差异保留。上述定向修复通过不代表完整桌面一致性或发布签收。

最终读回[恢复值](evidence/r2-final-restoration.json)：font_scale1.0、自动旋转0、user_rotation0、USB常亮15、系统night1，应用已重新选择跟随系统；原输入法保持。仅测试隔离包和专仓，未清原应用数据、未自动合并。

## CI归属

前一提交521cc3a9dd的[Windows CI](https://github.com/ChisaAlter/WhaleIsle/actions/runs/40306509243)已成功结束，scope/windows成功，macOS/tools/web跳过。当前富文本与连接页修复已推送为80f833a93c，[本次CI](https://github.com/ChisaAlter/WhaleIsle/actions/runs/40315796727)在收尾读取时scope成功、Windows进行中，其余三项跳过；不以旧提交成功替代新提交状态。Android定向构建和真机结果独立记账。
