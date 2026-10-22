# 功能保真检查与同步失效复盘

日期：2026-10-17。对象：`codex/settings-archive-repair`，基线 `a8c931da37376ce7dc7989e6f30b0db885e06d26`，目录 `C:/AI/WhaleIsle-settings-archive-repair-20261017`，另含归档/设置选中态的未提交修复。

## 结论：确有功能断链，但不能把每项都归因于这次同步

检查覆盖 57 个索引表项和单列的 with-chatgpt，共 58 条，以及 Models、MCP、下一句提示等表外入口。确认了下列 **14 项有明确触发条件的缺陷或运行契约冲突**，证据分别来自真实 UI、真实 Host API、资源选择器或完整生产调用链；不是 14 项都做过外部账号实测。

优先处理四处：**MCP 错误读盘后的覆盖风险、自定义指令未进入请求、SSH 远程工作区拒载、IM 既有会话绑定失败**。当前版本不宜据此宣称“同步后全部功能正常”。本次对新增发现只做检查和复盘，没有擅自修复其他 owner 的功能、替换安装版或发布。

| 编号 / 优先级 | 触发条件与实际影响 | 决定性证据 | 与同步的关系 |
|---|---|---|---|
| A1 / P1 | MCP 已载入合法文件后，外部 YAML 编辑损坏或读盘失败；下一次新增、启停、删除会以最后正常的内存文档写回，覆盖尚未修好的外部编辑 | 源码：`packages/mcp/mcp-servers-file/src/service.ts:295-326`，读失败返回旧文档，而 mutation 无条件写入；未操作用户文件 | 早期既有缺陷，`7b11b8ce38` |
| A2 / P1 | 自定义指令字段仍能配置，但没有生产消费者把内容加入模型请求 | 源码、编译产物与历史：`ui-conversation/src/index.ts:57-69` 只保留 settings/nextPrompt；原 `systemPrompt` variable/section 已删除；未发模型请求 | `dsh-v0.1.7-alpha.2` 同步 `135760b141` 遗留，不是本次 alpha.3 新增 |
| A3 / P1 | alpha.3、无 exact-version 兼容豁免时，默认开启的 SSH 插件被整体拒载，远程设置、目录 tab、rw_* 工具缺席 | 原生 `evaluatePluginCompatibility / prepareProfileEntries` 返回 `disabled:true`；独立 QA 中 `remoteWorkspaceEnabled:true`，仍无远程工作区设置分区 | alpha.3 `dab3362250` 更新运行版本，但遗漏 `vendor/dsh-remote/package.json` 四项 peers |
| A4 / P1 | IM 绑定非空或已归档的既有会话，旧调用可能 mint 新空会话后因 ID 不同失败；原会话没有因此被删除 | 完整调用链：`dsh-im/src/channels/shared/harness-session-binding.mjs:88-103` 仍用 `session.create`；新 Host `session-controller/src/commands.ts:117-140`、`agent.ts:459-493` 只复用合格 blank；未绑定外部账号 | alpha.3 改变了 create 业务语义，IM 调用方未迁移 |
| A5 / P2 | 展开 `read_image` 结果时，图片/路径/尺寸仍在，envelope 的 MIME、坐标缩放说明及同块正文消失 | `ui-tool/src/client/tool/models/image-card-model.ts:196-200` 过滤整块 text，`ToolRow.tsx:301` 只渲染 extraText；现有测试明确接受正文缺失 | 上游 `4a9979cea0`，由 alpha.3 `dab3362250` 带入 |
| A6 / P2 | 显式安装 DSH with ChatGPT bundle 且无对应兼容豁免，在 alpha.3 被整体禁用 | 原生 preflight 的 `disabled:true`；`vendor/dsh-with-chatgpt/package.json` 三项 peers 固定 alpha.1 | alpha.3 版本升级暴露旧声明；它本来不随桌面默认分发 |
| A7 / P2 | 启用 Bots 后，catalog 缺失、读失败或 JSON 损坏，检查仍将不可观察误报为 `coverage.bots='ok'`；更新/安装保护可能据此接受“无任务” | 原生 `collectInspection()` 指向不存在的自有测试 home，得到空 work 与 bots=ok；`dsh-task-control/lib/inspection.js:124-143`、`task-protection.js:41` | 既有缺陷，`9e7cbd41fd4`；不能推断每次退出都会丢任务 |
| A8 / P2 | macOS 账户 Host 请求被标为 Windows 身份 | `src/main/platform-session-overlay.js:79` 写死 win32，原生 account consumer 将其映射为 desktop-win | 既有缺陷，`d928fa24516`；当前 Windows 不受影响，未证明服务端拒绝登录 |
| A9 / P2 | pi-ai provider 已有合法 modelOverrides，再从普通模型编辑器添加 models，会触发 Host 的互斥校验，不能保存 | 直接产品 API：override-only 合法，编辑器产生的 models+modelOverrides 被拒；`ProviderEditor.tsx:182,400-455`、`llm-pi-ai/src/catalog.ts:876-884` | 早期既有组合缺陷，不是整页失效 |
| A10 / P2 | MCP stdio 的一个参数含空格，表单普通保存/转 JSON 会把它拆为多项，改变命令含义 | 源码：`McpSection.tsx:1082,1118,1145,1284-1286`，join 空格后按空白 split；未改用户服务器 | 既有缺陷，`d65db506ea` |
| A11 / P2 | MCP 已有 id 与 serverName 不同，切到 JSON 无修改保存，也会丢原 id，并按新增记录触发重名拒绝 | 源码：`McpSection.tsx:1140-1157,1217-1218,474-475` 与 Host upsert；JSON 往返没有保留身份 | 既有缺陷；不是新字段缺席的推测 |
| A12 / P2 | Skills 原 session 已失效，列表回退到默认 scope 后，详情、调用权限、新建、编辑仍带旧 scope，管理动作失败 | 源码：`SkillsSection.tsx:203-216,303,323,625,635`；`skill-inventory/src/index.ts:239-248` 拒绝失效 session | 既有缺陷，`908aec91e3` |
| A13 / P2 | 自定义指令保存被拒或传输失败后，输入框仍保留未持久化的新文本，没有失败提示，重载后仍读到旧值 | 直接调用 `ComposerSubmissionPolicy`，Host 返回 false：displayed=new-unsaved、durable=saved-before；`submission-policy.ts:236-256,473-477` | 既有缺陷，`d133ea7c50`；不是“显示保存成功 toast” |
| A14 / P2 | 打包统一删 Markdown，把实际运行时技能正文一起裁掉：Windows ACL 诊断、可选 badge、Cordis 内置技能/参考 | 真实 `collectFiles()` 排除对应资源；`scripts/after-pack.js:484-486` 只豁免 licenses/复数 agent-presets；当前安装树也缺 ACL/Cordis 正文 | 打包规则的历史缺口；未执行最终 alpha.3 安装包或断言整体启动崩溃 |

vendor 包路径除另标外，均位于 `vendor/deepseek-harness/packages/`。详细因果、调用行和可重放命令见文末分线记录。

## 最初两个问题：已修源码，归档数据未被证明丢失

### 归档开关：空集合把整个区藏掉

旧 `ArchivedSessionSection` 有 `nodes.length === 0` 就返回 null 的条件。因此开关为 true、当前数据目录无可列归档时，侧栏仍看不到任何归档入口。这一条件从 2026-09-24 的 `e6a3d46c0e` 就存在；alpha.3 没删掉底部分区、三态筛选或恢复/删除入口。

源码实例使用的 Source-main 数据集没有归档行，安装版使用的另一数据集仍有两条归档记录。两者不能拼成“同一次升级前有、升级后删掉”的迁移证据。

候选修复：默认筛选、开关开启时，即使零归档也保留折叠的“已归档”；展开显示“暂无已归档会话”。关闭隐藏；“全部对话/仅已归档”仍通过主列表管理，不重复加底部分区。取消归档不跳转原会话，点击归档行不打开，缺摘要占位行为保留。

原失败场景及直接相关的空/非空、开关、三态筛选、最后一条恢复、默认折叠已在自有源码 QA 窗口实际观察；不是安装版验收。

### 设置选中态：按最新要求只加柔阴影、不描边

保留强调底色与蓝色图文，选中外观使用纯外投影 `--dsw-shadow-lv1`，移除此前 inset 轮廓。键盘 `:focus-visible` 提示独立保留，不拿键盘焦点框充当普通选中效果。

最新 official 构建后，实际观察浅色 1441×912、深色原生窄窗 961×720：选中项没有边框或内描边，尺寸/间距不变，设置内容和关闭入口完整。普通选中 computed border 为 0、outline 为 none，阴影为 `0 2px 4px rgba(0,0,0,.05)`。Standards 与 Spec 两条独立评审实际看图后均确认布局通过、视觉可接受。

- [浅色正常窗口](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/shadow-settings-light-normal.png)
- [深色窄窗口](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/shadow-settings-dark-narrow.png)

## 为什么同步后会丢功能

这次能定位到具体整合决策和消费断点，不只是“上游覆盖了文件”。alpha.3 的 `dab3362250` 经 `69b3a862d0` 的集成链，作为 #188 / `a8c931da37` 的祖先进入 main。

1. **配置迁移只保留字段，漏掉最终副作用。** `dsh-v0.1.7-alpha.2` 的 `135760b141` 保留了自定义指令表单，却删掉 system prompt variable/section。与此同时整删 141 行真实 `SystemPrompt.assemble()` 测试，替代检查只验证配置形状/其他字段。字段可保存与请求实际使用已被割裂。
2. **上游展示优化改变了本地产品合同，连测试一起接受退化。** read_image 原来保留整块正文；alpha.3 接纳了过滤 envelope 的实现，也把“可见 MIME”改成“不可见 MIME”、extraText 为 null。测试绿色恰好说明退化被写成预期。
3. **只检查插件文件/入口，没检查实际 Loader。** remote/with-chatgpt 文件、Host export、overlay 都在，但 peers 不满足 alpha.3，真实 preflight 仍置 disabled。ensure 成功不是装配成功。
4. **接口名称没变，业务语义已变。** `session.create({sessionId})` 不再意味着打开任意旧会话，而是复用合格空会话，否则 mint。dshbot 已做迁移，IM 同类调用漏改。旧 mock 的消息传输测试没有区分“绑定原非空 ID”。
5. **提供方已变，消费者/夹具还共享旧假设。** Office alpha.3 删除 check_office.py 并改为七份技能时，runtime、prepare、pack 曾都要求旧文件；旧测试还自行生成这个过期 checker，因而不能发现真实资源变了。`aa024def16` 已在 main 修正这一项，不能再列成当前未修复缺陷。A14 的真实 Markdown 裁剪则仍然存在。

归档空区隐藏与中性选中底色都可追到旧 `e6a3d46c0e`；并非 alpha.3 删除代码。不同配置/数据目录、安装/源码内容差异，也会造成“同名版本但功能不同”。应该逐项归因，而不是用一个覆盖解释全部现象。

维护说明已经要求看消费者语义与实际装配。问题在执行和断言依据，不缺另一套审批文档。后续同步应沿**真实上游变化 → 本地差异 → 直接消费者 → 用户结果**完成受影响迁移；删除行为测试或改变预期时，先判断是否在删用户能力，不能只求本地/CI 变绿。

## 运行身份：两个 0.3.8 不是同一份产品内容

| 对象 | 实际身份 | 本轮观察能证明什么 |
|---|---|---|
| 源码候选 | 上述独立工作分支；宿主 0.3.8；Harness `dsh-v0.2.1-alpha.3` / `2fbf4359b82fb94c03dcce0b831660d87f12ea5c` | 源码、当前构建、独立 QA 的行为；不代表安装版已修 |
| 现装应用 | `C:/软件/Whale Isle/Whale Isle.exe`，宿主 0.3.8；实际 loose runtime 为 Harness alpha.1 / `5badb15009ae1756c3afe0ae0cef1faafc290ccc` | 安装版身份与被只读检查的资源；不等于 alpha.3 |
| 主工作目录 | `C:/AI/Deepseek-Harness-Desktop`，同 HEAD 但另有 Project/IM/remote/with-chatgpt 等未提交工作 | 其他 owner 的 WIP，不能计入 HEAD 或本次修复已交付；未覆盖其修改 |

最新自有 QA 使用工作树对应构建、独立 `qa-user-data`，不是用户日常 home；采用非激活 source 窗口，不接管桌面鼠标/焦点。未启动付费模型请求、登录外部账号或写用户 MCP/Skills/会话数据。

## 额外实际入口检查

| 路径 | 当前实际观察 | 仍未证明 |
|---|---|---|
| 设置→远程→消息渠道 | 微信、飞书、钉钉、企微、QQ、Slack、Telegram、Discord、WhatsApp 和 AI Office 入口可见 | 真实授权、绑定和收发；A4 仍成立 |
| SSH 开关与设置目录 | QA 配置 remoteWorkspaceEnabled=true，但无远程工作区分区；与原生拒载结果一致 | SSH 往返、镜像及冲突处理 |
| 鲸鱼娘→聊天与能力 | 名字/称呼、默认模型、IM 同对话、人设、记忆、技能等插件贡献字段实际出现；侧栏入口存在 | 发话、记忆更新、定时任务和真实模型 |
| 用量统计 | 加载完成，显示明确“暂无统计数据”，导出/设置/刷新入口完整 | 真实账单、扫描/修复和数据准确性 |
| 市场 | 发现目录实际加载；保留当前设置内入口，不期待旧独立窗口 | 插件安装、卸载、升级与回滚 |
| Models / MCP / Skills | 本机页面可达，呈当前独立配置内容或明确空态 | A1、A9–A12 的特殊编辑路径；未改真实服务器/技能 |
| 主壳 | 会话、机器人、自动化任务、鲸鱼娘、工作区、Project、输入区和窗控可见 | 真实多 worker 交付、终端操作、关闭/更新保护、系统快捷键、Live2D 交互 |

## 自动检查：保留失败与证据边界

| 检查 | 实际结果 | 解释 |
|---|---|---|
| 宿主/移动端/Project 现成检查，未重复上一轮 fork 文件 | 3134 项：3109 pass、14 fail、11 skip | 1 fail 是根 pnpm 身份漂移；12 项导入与 1 项 Git 的文件 symlink 夹具未能建立。没有据此证明新产品缺陷；相关 symlink 场景仍未验证 |
| 构建/分发工具定向检查 | 76 项：71 pass、2 fail、3 skip | 2 fail 同属 pnpm 漂移，3 skip 为文件 symlink EPERM；未构建/执行 NSIS 安装器 |
| 设置/外观/快捷键 | 496 项通过 | 不覆盖真实 GPU、外部浏览器登录或本报告具体编辑失败组合 |
| 会话/工作区/目录 | 484 项通过 | 只证明实际测试输入；不是所有真实会话操作验收 |
| OpenUI/插件会话壳 | 73 项通过 | 与 FX 组有一个 skeleton 文件交集，不累加为全新覆盖；本轮未生成模型页面 |
| 编辑/建议/费用；FX/家族宽度/草稿；工具图/Surfaces；guest 边界 | 分别 314、211、127、14 项通过；另 Node 家族宽度 8 项通过 | 部分与根集合重叠，不报“总共全部通过”；A5 正是绿测接受退化的反例 |
| IM 认证/modern transport/whale 共享 | 10 项通过 | 本地协议边界，不覆盖 alpha.3 的普通非空会话绑定 |
| IM 源码 Host import 现成检查 | 1 fail | 源码跨层引用未安装的 ui-primitives；编译 lib 的 Host import 成功，不据此宣称发布版整个 IM 拒载 |
| 原归档/设置改动 | workspace-browser 132、settings-root 39、fork 15 项通过；归档实际场景已观察 | 复用同一行为候选证据；后续仅修改选中态 CSS，未无故重跑行为套件 |
| 最新阴影候选 official 构建 | 9 阶段 pass，0 fail/skip | 随后实际观察深浅主题/正常窄窗；不是完整安装包验收 |

根环境实际 Electron 44.2.0、esbuild 0.25.9、pnpm 12.3.4，声明要求分别为 ^44.3.0、0.28.2、12.4.1；这是已有依赖漂移，未擅自升级。14 项宿主失败中 credentials 的 ENOENT 已通过原错误追踪定位：测试 hook 先删除临时目标，再创建 symlink 遭 EPERM，并非产品删除真实凭据。诊断仍然失败，未削弱断言、扩大 skip 或改记通过。

独立开发目录未准备 Office payload，kit/native 0.1.5 可解析但不挂对应工具/技能；这属于当前开发环境缺项，不能推断正式包 Office 全部丢失。自定义光标失焦残留目前仅是源码候选，未作实际区分，不计入 14 项。旧 composer-resize e2e 仍定位 textarea、产品已用 contenteditable，属于验证入口过期，不自动算新的产品故障。

## 后续修复顺序与真实缺口

1. **数据/核心能力优先：** A1 让读失败明确阻断写入；A2 恢复请求消费者；A3/A4 迁移真实装配与旧会话身份。主目录已有相关未提交修复时由原 owner 继续，不覆盖或重复实现。
2. **恢复保真：** A5 正文、A6 可选 bundle peers、A14 真实运行资源。分别沿工具卡、Loader、最终包实际文件验证，不拿 marker/文件存在替代终点。
3. **处理明确条件失败：** A9–A13 编辑/保存路径，A7 不可观察状态、A8 平台身份。只补对应真实条件，不扩成新平台或泛化兜底。

真实模型、SSH/IM/手机/ChatGPT 账号闭环、Office 文档生成预览、macOS、最终安装包与升级/卸载、线上发布/镜像、活动任务中断与系统焦点交互未执行。它们不影响本报告已定位的源码/契约矛盾，但不能标为通过。58 项覆盖指检查范围完整记录，不意味着 58 项全部实机验收。

归档/阴影修复仍在上述工作分支，未合入主目录或当前安装版，未创建 PR。其余发现本次仅报告，不是已修复清单。

## 可追溯记录

- [设置 / Models / MCP / Skills](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-settings.md)
- [会话 / 输入区 / 工具 / Surfaces](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-conversation.md)
- [插件 / 集成 / 原生 preflight](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-integrations.md)
- [桌面壳 / 安装资源 / 失败分级](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-shell.md)
- [同步历史与具体提交因果](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-sync-history.md)
- [宿主检查日志](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-host-tests.log)、[symlink 诊断原错误](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/audit-shell-host-failures.log)、[最终 official 构建](C:/Users/48818/.codex/visualizations/2026/10/17/01a14898-7a02-7950-97e5-98d08ffed438/shadow-official-build.log)

## 附：57 个索引表项与 with-chatgpt，共 58 条覆盖

下表整理各分线已取得的证据，不把“未发现源码断点”写成“功能通过”。新增实际入口与最新阴影观察以本文上节为准。

来源简写：S＝设置，C＝会话与工具，I＝插件集成，H＝桌面壳与分发，Y＝同步历史；均对应上节的分线记录。

| id | 已取得证据 | 结论 / 尚未覆盖 |
|---|---|---|
| `openui` | C：渲染、frame 桥与原会话路由定向测试 | 本候选未跑真实模型/正常窄窗 OpenUI 路径，安装未验 |
| `release-process` | H：发布脚本、离线 fixture | 不证明当前线上 release/镜像健康；未触发发布 |
| `window-motion` | H：原生桥与窗口调用链 | 桥未丢失；实际动画、失焦与阴影待画面判断 |
| `desktop-branding` | H：源版/安装资源与身份接线 | 不等于任务栏像素、字标与窄窗视觉通过 |
| `vision-fallback` | C：路由、准入、主请求重写源码 | 未发现该链新增断点；真实 provider、联网/权限未验 |
| `core-regression-gates` | 索引已覆盖；四份分线报告无独立 CI 门禁验收记录 | 不能从定向测试或根测试推定 CI 触发/阻断机制通过 |
| `wallpaper-gallery` | S：配置/图库/应用链及定向测试 | 网络缩略图、裁剪画布与真实视觉未验 |
| `background-gradient` | S：预设、保存、互斥与应用定向测试 | 真实动画及预览一致性未验 |
| `cursor-effects` | S：配置、DOM/模拟 canvas 与 engine 检查 | jsdom 不证明真实 GPU/WebGL 绘制 |
| `metallic-paint` | S：开关、属性、样式定向测试 | 默认关闭；真实 hover 对比度/观感未验 |
| `transparent-theme` | S：壁纸门控、混色、透明度定向测试 | 实际表面/TUI/阴影未由此证明 |
| `sidebar-mask` | S：token 消费及定向测试 | 无图/特效/壁纸三种真实背景未验 |
| `marketplace-settings` | I：设置内市场注册、overlay、资源链 | 已迁入设置，不是缺独立窗口；联网安装/卸载/回滚未验 |
| `surfaces-work-loops` | C：文件路由、资源保存/关闭与 guest 定向测试 | 原生 guest、浮窗及完整正常/窄窗布局未由此验收 |
| `tool-result-images` | C/Y：源码与历史，相关现测接受退化 | **已确认 envelope 正文被过滤**；他人 WIP 不算 HEAD 修复 |
| `boot-page` | H：状态、日志、重试/取消/揭示接线 | 动画与真实失败恢复未验 |
| `desktop-welcome` | H：onboarding 显式关闭 | 不弹上游欢迎是现行契约；新账户启动未验 |
| `terminal-drawer` | H：PTY 六调用、事件、背压与资产 | 未创建真实 PTY、输入输出或验证会话存活 |
| `settings-select` | S：公开原语、调用方与定向测试 | 真实弹层、键盘、层叠/宽度未由此验收 |
| `account-settings-entry` | S：菜单/回退互斥、跳转与 SettingsRoot 定向测试 | 真实关闭后的焦点归还未由此验收 |
| `account-browser-sign-in` | S/I：浏览器启动逻辑定向测试、平台身份源码 | **macOS 账户 Host 请求被标 win32**；未判浏览器打开故障，真实登录未验 |
| `mobile-remote` | I：daemon、配对/协议与平台链源码 | 默认配对关闭非回归；relay/扫码/Android 真机未验 |
| `remote-settings` | I：IM Host import、认证/transport 定向测试及契约比对 | **既有非空会话绑定与新 create 语义冲突**；真实账号收发未验 |
| `remote-workspace` | I：真实 alpha.3 peer preflight | **默认开启仍被 disabled:true 拒载**；SSH 往返/文件冲突未验 |
| `dshbot` | I：入口/依赖、overlay 与 peers 检查 | 默认关闭非丢失；真实 Bots/群聊/例程未验，保护检查另有缺陷 |
| `plugin-session-navigation` | C：presentation、blank reuse、导航定向测试 | 核心投影链未见断点；不覆盖 IM/Bots/Project 全壳路径 |
| `dsh-home` | H：home、spawn 环境与绑定路径源码 | 隔离接线在；未读凭据或操作真实 home |
| `desktop-launcher` | H：gate/service/IPC/preload/renderer 接线 | 冷启动、启停、重试、更新真实交互未验 |
| `launcher-distribution` | H：slim 入口、配置与 external runtime 路径 | 未生成/运行 slim 包；proposed 要求不作为已交付回归 |
| `launcher-components` | H：组件清单发现、状态/生命周期源码 | 未下载、启动、更新或停止服务组件 |
| `data-import` | H：主动入口、journal、阻断/取消接线 | 未向真实 home 导入；slim 非空导入不支持为既定条件 |
| `session-archive` | C/Y：Host/树定向测试；主代理持有上一轮 WIP 真实观察 | HEAD 空集合隐藏是旧行为，**无同步删数据证据**；WIP 未算安装修复 |
| `no-directory-sessions` | C：scratch、baseline、membership/reuse 定向测试 | 新建/重载/删目录重加的完整真实路径未验 |
| `git-titlebar` | H：状态/分支/提交/推拉与权限接线 | 未执行真实仓库写入/远端操作，未验完整交互与窄窗布局 |
| `usage-stats` | S/I：唯一设置入口、Host import、peers 与配置链 | 真实统计扫描/计费/修复 RPC 未验；旧卡价格存储说明已落后 |
| `composer-beam` | C：配置→class/CSS 及定向测试 | 真实画面、流畅度与窄窗视觉未由此验收 |
| `composer-typing-fx` | C：特效/Selection/caret 定向测试与源码 | **失焦光标残留为待区分候选**；动画/焦点待实际观察 |
| `composer-family-width` | C：共享宽高状态与定向测试 | 旧 e2e 仍定位 textarea，与当前编辑器失配；真实几何未由此证明 |
| `composer-stats-peak-valley` | C：开关、行绑定与价格/峰谷定向测试 | 实际点击、输入卡对齐及弹层布局未由此验收 |
| `message-edit` | C：Host/Client 编辑、截断、取消身份定向测试 | 未发现源码断链；真实编辑→取消/重发路径未验 |
| `composer-draft-transition` | C：草稿、驻留 composer 与定向测试 | 首发逐帧几何、长草稿/附件/切换视觉未验 |
| `windows-installer` | H：NSIS 与目录处理只读审查 | 未构建/执行安装夹具；安装、卸载与升级未验 |
| `dsh-tools` | C：身份校验→持久化→旧投影源码 | 该域未新跑测试/真实 API/损坏历史续聊；工具卡测试不覆盖此合同 |
| `harness-upstream-sync` | Y：实际 Git 祖先、两版 tree 与工具源码 | alpha.3 经 #188 入 main；**已确认多处消费迁移遗漏**，marker 非保真证明 |
| `desktop-pet` | H：显式 feature=false 与保留实现 | Codex 小宠关闭为既定状态，不是同步丢失 |
| `desktop-live2d-pet` | H：协议映射、模型/ORT/台词真实资产 | 资产齐全不等于渲染/穿透/拖拽/气泡通过；未开启用户宠物 |
| `whale-assistant` | I：Host/tools import、peers 与会话/持久化源码 | 实际设置贡献字段和侧栏入口已见；未打开/发送常驻会话，记忆/定时模型未验 |
| `projects` | I：entry/deps、overlay/peer 实例装配检查 | HEAD 与他人 WIP 分列；主对话、真实模型与多成员交付未验 |
| `directory-picker-drives` | C：真实 Win32 service 及 browser/client flow 定向测试 | 卷 sentinel/可进入盘符受测；真实跨盘对话框未验 |
| `custom-instructions` | C/S/Y：生产/产物与删除历史、内存 ConfigForm API 复现 | **prompt 消费者缺失；保存拒绝后仍显示未持久值**；真实模型请求未验 |
| `session-cost-display` | C：费用数学、token/子代理投影与设置定向测试 | 真实改价同步、费用弹窗与关闭整行视觉未由此验收 |
| `skills-groups` | S：分组/多选/批量调用链及源码 | **失效 session 回退后管理操作仍用旧 scope**；真实文件管理未验 |
| `desktop-build-runtime` | H/I：真实选择器/安装文件、入口/依赖/原生解析与脚本测试 | **运行时 Markdown 被裁剪；根依赖漂移**；现装 alpha.1，未生成最终 alpha.3 包 |
| `task-protection` | I/H：真实 inspection API 探针与壳侧接线 | **Bots 不可观察被误报 coverage=ok**；未中断真实活动任务验退出/更新 |
| `close-behavior` | H：隐藏/退出、托盘与一次性 toast 接线 | 未关闭真实窗口/写 marker；不以源码证明托盘与确认路径通过 |
| `office-runtime` | I/Y：kit/native 可解析、真实 payload 路径与历史适配 | 当前开发 payload 缺失，不认证工具技能已挂载；文档生成/预览及最终包未验 |
| `keyboard-shortcuts` | S：注册/编辑/桌面桥/持久化定向测试 | 未敲真实按键或验系统焦点/guest；索引拟议文案不抹去现有实现 |
| `dsh-with-chatgpt` | I：真实 alpha.3 peer preflight | **显式安装 bundle 被拒载**；非默认分发，依赖/登录/协作闭环未验 |

**表外边界：**索引不是全应用的功能全集。设置报告另已记录 Models 的 modelOverrides 编辑冲突、MCP 损坏文档覆盖、含空格参数及 JSON id 往返缺陷（S1–S4），不能因其没有独立索引行而遗漏；本表不新增检验这些问题。`nextPrompt` 也有现成定向测试记录，但不在本次 58 个索引项内。未发现源码断点或定向测试通过，均不写成“功能全面正常”。
